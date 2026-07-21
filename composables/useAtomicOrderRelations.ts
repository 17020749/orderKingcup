import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore'
import type { InvoiceDoc, OrderDoc, PaymentDoc, ShipmentDoc } from '~/types/models'
import { makeId, normalizeEmail, toNumber } from '~/utils/format'
import { invalidateScopedCache } from '~/composables/useScopedQueries'
// @ts-ignore Shared ESM helpers are executed directly by Node client tests.
import {
  buildOrderRelationPatch,
  buildReconciledOrderRelationPatch,
  isActiveOrderRelation,
  relationCountField,
  relationLockReady,
  relationRecordsByOrder,
  relationReconcileNeeded,
  relationRevisionField,
  removeRelationRecord,
  replaceRelationRecord,
} from '~/utils/orderRelationState.mjs'

type RelationModule = 'payments' | 'invoices' | 'shipments'
type RelationMode = 'create' | 'update' | 'delete'
type RelationRecord = PaymentDoc | InvoiceDoc | ShipmentDoc | Record<string, any>

type MutateRelationInput = {
  module: RelationModule
  mode: RelationMode
  order: OrderDoc
  record: RelationRecord
  existingRecords: RelationRecord[]
  actor: string
}

type MutateRelationResult = {
  record: RelationRecord
  orderPatch: Record<string, any>
  operationId: string
}

function collectionName(module: RelationModule) {
  return module
}

function activePayload(record: RelationRecord, order: OrderDoc, actor: string) {
  const normalizedActor = normalizeEmail(actor)
  return {
    ...record,
    order_id: order.id,
    order_code: order.order_code,
    order_owner_email: order.owner_email || '',
    order_created_by: order.created_by || '',
    order_sale_email: order.sale_email || '',
    created_by: record.created_by || normalizedActor,
    active: true,
    deleted: false,
    status: record.status === 'deleted' ? 'active' : (record.status || 'active'),
  }
}

function softDeletePayload() {
  const timestamp = serverTimestamp()
  return {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: timestamp,
    updated_at: timestamp,
  }
}

function localTimestamp() {
  return new Date().toISOString()
}

export function useAtomicOrderRelations() {
  const { db } = useFirebaseServices()
  const { appUser, isAdmin } = useAuth()

  async function mutateOrderRelation(input: MutateRelationInput): Promise<MutateRelationResult> {
    const { module, mode, order } = input
    const actor = normalizeEmail(input.actor || appUser.value?.email || '')
    const recordId = String(input.record?.id || '').trim()
    if (!actor) throw new Error('Không xác định được người thao tác.')
    if (!order?.id) throw new Error('Thiếu đơn hàng cha.')
    if (!recordId) throw new Error('Thiếu ID chứng từ liên kết.')
    if (!relationLockReady(order)) {
      throw new Error('Đơn hàng cũ chưa hoàn tất đồng bộ khóa thanh toán, hóa đơn và vận chuyển. Vui lòng tải lại sau khi hệ thống xử lý.')
    }
    if (mode !== 'create' && String(input.record.order_id || '') !== String(order.id)) {
      throw new Error('Không được chuyển chứng từ sang đơn hàng khác.')
    }

    const revisionField = relationRevisionField(module)
    const expectedRevision = toNumber((order as any)[revisionField])
    const operationId = makeId(`rel_${module.slice(0, 3)}`)
    const orderRef = doc(db, 'orders', order.id)
    const childRef = doc(db, collectionName(module), recordId)
    const activityRef = doc(collection(db, 'activity_logs'))

    // The list rendered on a page may be cursor-paginated or scoped. Relation
    // summaries must always be calculated from every document of the selected
    // order, otherwise Firestore correctly rejects the parent count transition.
    const relationSnapshot = await getDocs(query(
      collection(db, collectionName(module)),
      where('order_id', '==', order.id),
    ))
    const authoritativeRecords = relationSnapshot.docs.map(snapshot => ({
      ...snapshot.data(),
      id: snapshot.id,
    }) as RelationRecord)

    let localRecord: RelationRecord = { ...input.record }
    let localOrderPatch: Record<string, any> = {}

    await runTransaction(db, async transaction => {
      // A new relation document does not exist yet, and ownership-based read
      // rules cannot authorize reading a missing child. Read the child only for
      // update/delete; the atomic parent marker still protects create collisions.
      const orderSnap = await transaction.get(orderRef)
      const childSnap = mode === 'create' ? null : await transaction.get(childRef)
      if (!orderSnap.exists()) throw new Error('Không tìm thấy đơn hàng cha.')
      const currentOrder = { ...orderSnap.data(), id: orderSnap.id } as OrderDoc
      if (currentOrder.deleted === true || currentOrder.active === false) {
        throw new Error('Đơn hàng cha đã bị xóa hoặc ngừng hoạt động.')
      }
      if (!relationLockReady(currentOrder)) {
        throw new Error('Đơn hàng cũ chưa hoàn tất đồng bộ khóa thanh toán, hóa đơn và vận chuyển.')
      }
      const currentRevision = toNumber((currentOrder as any)[revisionField])
      if (currentRevision !== expectedRevision) {
        throw new Error('Dữ liệu liên kết của đơn đã thay đổi ở phiên khác. Vui lòng tải lại trang trước khi thao tác.')
      }

      if (mode !== 'create' && !childSnap?.exists()) {
        throw new Error('Không tìm thấy chứng từ cần cập nhật.')
      }
      if (mode !== 'create' && String(childSnap?.data()?.order_id || '') !== String(order.id)) {
        throw new Error('Chứng từ không thuộc đơn hàng đã chọn.')
      }

      const timestamp = serverTimestamp()
      const nextRevision = currentRevision + 1
      let nextRecords: RelationRecord[]

      if (mode === 'delete') {
        transaction.update(childRef, softDeletePayload())
        nextRecords = removeRelationRecord(authoritativeRecords, recordId)
        localRecord = {
          ...(childSnap?.data() || input.record),
          id: recordId,
          deleted: true,
          active: false,
          status: 'deleted',
          deleted_at: localTimestamp(),
          updated_at: localTimestamp(),
        }
      } else {
        const payload = activePayload(input.record, currentOrder, actor)
        const firestorePayload: DocumentData = {
          ...payload,
          id: recordId,
          relation_revision: nextRevision,
          last_operation_id: operationId,
          updated_at: timestamp,
          ...(mode === 'create' ? { created_at: timestamp } : {}),
        }
        if (mode !== 'create') delete firestorePayload.created_at
        transaction.set(childRef, firestorePayload, { merge: mode !== 'create' })
        nextRecords = replaceRelationRecord(authoritativeRecords, {
          ...payload,
          id: recordId,
          relation_revision: nextRevision,
          last_operation_id: operationId,
        }, recordId)
        localRecord = {
          ...payload,
          id: recordId,
          relation_revision: nextRevision,
          last_operation_id: operationId,
          created_at: input.record.created_at || localTimestamp(),
          updated_at: localTimestamp(),
        }
      }

      const orderPatch = buildOrderRelationPatch({
        module,
        order: currentOrder,
        records: nextRecords,
        action: mode,
        documentId: recordId,
        actor,
        updatedAt: timestamp,
        revision: nextRevision,
      })
      transaction.update(orderRef, {
        ...orderPatch,
        updated_at: timestamp,
      })
      transaction.set(activityRef, {
        module,
        action: mode === 'delete' ? 'delete' : mode,
        item_code: input.record.order_code || currentOrder.order_code || recordId,
        item_name: input.record.invoice_number || input.record.tracking_code || input.record.payment_type || currentOrder.customer_name || recordId,
        changed_by: actor,
        order_id: currentOrder.id,
        document_id: recordId,
        operation_id: operationId,
        after_json: JSON.stringify({
          module,
          mode,
          order_id: currentOrder.id,
          document_id: recordId,
          relation_revision: nextRevision,
        }),
        created_at: timestamp,
        active: true,
        deleted: false,
      })

      localOrderPatch = {
        ...orderPatch,
        updated_at: localTimestamp(),
      }
    })

    invalidateScopedCache(module)
    invalidateScopedCache('orders')
    invalidateScopedCache('activity_logs')
    return { record: localRecord, orderPatch: localOrderPatch, operationId }
  }

  async function reconcileOrderRelationLocks() {
    if (!isAdmin.value) throw new Error('Chỉ quản trị viên được đồng bộ khóa liên kết đơn.')
    const [orderSnap, paymentSnap, invoiceSnap, shipmentSnap] = await Promise.all([
      getDocs(collection(db, 'orders')),
      getDocs(collection(db, 'payments')),
      getDocs(collection(db, 'invoices')),
      getDocs(collection(db, 'shipments')),
    ])
    const orders = orderSnap.docs.map(snapshot => ({ ...snapshot.data(), id: snapshot.id }) as OrderDoc)
    const orderIds = new Set(orders.map(order => order.id))
    const payments = paymentSnap.docs.map(snapshot => ({ ...snapshot.data(), id: snapshot.id }))
    const invoices = invoiceSnap.docs.map(snapshot => ({ ...snapshot.data(), id: snapshot.id }))
    const shipments = shipmentSnap.docs.map(snapshot => ({ ...snapshot.data(), id: snapshot.id }))
    const paymentMap = relationRecordsByOrder(payments)
    const invoiceMap = relationRecordsByOrder(invoices)
    const shipmentMap = relationRecordsByOrder(shipments)
    const orphanRecords = [...payments, ...invoices, ...shipments]
      .filter(isActiveOrderRelation)
      .filter(record => record.order_id && !orderIds.has(String(record.order_id)))
      .map(record => ({ module: record.invoice_number != null ? 'invoices' : record.tracking_code != null ? 'shipments' : 'payments', id: record.id, order_id: record.order_id }))

    const actor = normalizeEmail(appUser.value?.email || '')
    let batch = writeBatch(db)
    let writes = 0
    let updatedOrders = 0
    const commitBatch = async () => {
      if (!writes) return
      await batch.commit()
      batch = writeBatch(db)
      writes = 0
    }

    for (const order of orders) {
      if (order.deleted === true) continue
      const patch = buildReconciledOrderRelationPatch({
        order,
        payments: paymentMap.get(order.id) || [],
        invoices: invoiceMap.get(order.id) || [],
        shipments: shipmentMap.get(order.id) || [],
        actor,
        updatedAt: serverTimestamp(),
      })
      if (!relationReconcileNeeded(order, patch)) continue
      batch.update(doc(db, 'orders', order.id), patch)
      writes += 1
      updatedOrders += 1
      if (writes >= 350) await commitBatch()
    }
    await commitBatch()

    invalidateScopedCache('orders')
    return {
      updatedOrders,
      orphanRecords,
      orphanCount: orphanRecords.length,
      counts: {
        payments: payments.filter(isActiveOrderRelation).length,
        invoices: invoices.filter(isActiveOrderRelation).length,
        shipments: shipments.filter(isActiveOrderRelation).length,
      },
    }
  }

  return {
    mutateOrderRelation,
    reconcileOrderRelationLocks,
    relationCountField,
    relationRevisionField,
  }
}