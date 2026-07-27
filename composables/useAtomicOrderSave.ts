import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import type { OrderItemDoc } from '~/types/models'
import { buildOrderCode, ORDER_SEQUENCE_START } from '~/utils/orderCode'
import {
  assertSaleInvoiceStatus,
  buildOrderInvoiceId,
  canSaleTransitionInvoiceStatus,
  normalizeInvoiceStatus,
} from '~/utils/orderInvoiceFlow.mjs'
import { normalizeEmail, toNumber } from '~/utils/format'
// @ts-ignore Shared ESM helpers are executed directly by Node client tests.
import {
  assertAtomicOrderWriteLimit,
  assertExpectedOrderRevision,
  buildOrderItemLifecyclePatch,
  buildOrderOperationId,
  nextOrderRevision,
  planAtomicOrderItems,
  preservePersistedOrderIdentityForEdit,
  resolveOrderOwnershipForSave,
  shouldReadExistingInvoiceSnapshot,
} from '~/utils/orderAtomicSave.mjs'
// @ts-ignore Shared ESM helpers are executed directly by Node client tests.
import { moduleActionDecision, permissionDecisionMessage } from '~/utils/permissionDecisions.mjs'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { isActiveOrderRelation } from '~/utils/orderRelationState.mjs'

type AtomicOrderMode = 'create' | 'edit'

type AtomicInvoiceMutation = {
  mode: 'create' | 'legacy_create' | 'status_update'
  invoiceId: string
  requestedStatus: string
  expectedStatus?: string
  expectedRelationRevision?: number
  payload?: Record<string, any>
}

export type AtomicOrderSaveInput = {
  mode: AtomicOrderMode
  orderId: string
  customerId: string
  customerCode: string
  userCode: string
  expectedRevision?: number
  ownerEmail: string
  saleEmail: string
  createdBy: string
  changedBy: string
  orderPayload: Record<string, any>
  nextItems: Record<string, any>[]
  existingItems: OrderItemDoc[]
  invoiceMutation?: AtomicInvoiceMutation
  activityAction: string
  activityItemName: string
  activityBefore?: Record<string, any> | null
}

export type AtomicOrderSaveResult = {
  orderCode: string
  orderSequence: number
  revision: number
  operationId: string
  orderPayload: Record<string, any>
  items: OrderItemDoc[]
  removedItemIds: string[]
  writeCount: number
  invoiceId?: string
  invoiceStatus?: string
}

export function useAtomicOrderSave() {
  const { db } = useFirebaseServices()
  const { appUser, permissions } = useAuth()

  async function saveOrderAtomic(input: AtomicOrderSaveInput): Promise<AtomicOrderSaveResult> {
    if (!input.orderId) throw new Error('Thiếu ID đơn hàng.')
    if (!input.customerId) throw new Error('Thiếu khách hàng của đơn.')
    if (!input.nextItems.length) throw new Error('Vui lòng thêm ít nhất một sản phẩm.')
    const actor = normalizeEmail(input.changedBy || appUser.value?.email || '')
    if (!actor) throw new Error('Không xác định được người thao tác.')

    const invoiceMutation = input.invoiceMutation
    if (input.mode === 'create') {
      const ownerEmail = normalizeEmail(input.ownerEmail)
      const createdBy = normalizeEmail(input.createdBy)
      if (ownerEmail !== actor || createdBy !== actor) {
        throw new Error('Tạo đơn bị chặn (code=forged_order_ownership, immutable_field=owner_email/created_by).')
      }
      const decision = moduleActionDecision({
        actionPermission: 'orders.create',
        viewAllPermission: 'orders.view_all',
        permissions: permissions.value,
        record: { owner_email: ownerEmail, created_by: createdBy },
        currentUserEmail: actor,
      })
      if (!decision.allowed) {
        throw new Error(permissionDecisionMessage(decision, {
          operation: 'orders.create', record: input.orderId, status: 'new',
        }))
      }
      if (!invoiceMutation || invoiceMutation.mode !== 'create') {
        throw new Error('Đơn hàng mới phải tạo kèm một bản ghi hóa đơn trong cùng giao dịch.')
      }
      if (invoiceMutation.invoiceId !== buildOrderInvoiceId(input.orderId)) {
        throw new Error('ID hóa đơn tự động không khớp đơn hàng.')
      }
    } else if (invoiceMutation?.mode === 'create') {
      throw new Error('Không được tạo thêm hóa đơn khi sửa đơn hàng.')
    } else if (invoiceMutation?.mode === 'legacy_create'
      && invoiceMutation.invoiceId !== buildOrderInvoiceId(input.orderId)) {
      throw new Error('ID hóa đơn legacy không khớp đơn hàng.')
    }

    const writeCount = assertAtomicOrderWriteLimit({
      mode: input.mode,
      existingItems: input.existingItems,
      nextItems: input.nextItems,
      updateInvoiceStatus: invoiceMutation?.mode === 'status_update' || invoiceMutation?.mode === 'legacy_create',
    })
    const itemPlan = planAtomicOrderItems(input.existingItems, input.nextItems)
    const orderRef = doc(db, 'orders', input.orderId)
    const sequenceRef = doc(db, 'order_sequences', input.customerId)
    const activityRef = doc(collection(db, 'activity_logs'))
    const invoiceRef = invoiceMutation ? doc(db, 'invoices', invoiceMutation.invoiceId) : null
    const operationId = buildOrderOperationId(input.orderId)
    let finalResult: AtomicOrderSaveResult | null = null

    await runTransaction(db, async transaction => {
      // Firestore requires every read before the first write in a transaction.
      // New orders do not read their missing order or invoice documents because
      // ownership is established by the after-state of the same transaction.
      const orderSnapshot = input.mode === 'edit'
        ? await transaction.get(orderRef)
        : null
      const sequenceSnapshot = input.mode === 'create'
        ? await transaction.get(sequenceRef)
        : null

      if (input.mode === 'edit' && !orderSnapshot?.exists()) {
        throw new Error('Đơn hàng không còn tồn tại. Hãy tải lại danh sách.')
      }

      const existingOrder = orderSnapshot?.exists() ? orderSnapshot.data() : {}
    const invoiceSnapshot = invoiceRef && shouldReadExistingInvoiceSnapshot({
      mode: input.mode,
      invoiceMutation,
      persistedOrder: existingOrder,
    })
      ? await transaction.get(invoiceRef)
      : null
      const effectiveOwnership = resolveOrderOwnershipForSave({
        mode: input.mode,
        persistedOrder: existingOrder,
        requestedOwnership: {
          ownerEmail: input.ownerEmail,
          createdBy: input.createdBy,
          saleEmail: input.saleEmail,
        },
      })
      if (input.mode === 'edit') {
        const decision = moduleActionDecision({
          actionPermission: 'orders.edit',
          viewAllPermission: 'orders.view_all',
          permissions: permissions.value,
          record: { ...existingOrder, id: input.orderId },
          currentUserEmail: actor,
          currentUserCode: appUser.value?.user_code || '',
          allowLegacyOrderCodeOwnership: true,
        })
        if (!decision.allowed) {
          throw new Error(permissionDecisionMessage(decision, {
            operation: 'orders.edit', record: input.orderId, status: existingOrder.status,
          }))
        }
      }

      let requestedInvoiceStatus = ''
      let existingInvoice: Record<string, any> | null = null
      if (invoiceMutation) {
        const persistedOrderInvoiceStatus = normalizeInvoiceStatus(existingOrder.invoice_status)
        if (invoiceMutation.mode === 'legacy_create' && persistedOrderInvoiceStatus === 'Đã xuất') {
          requestedInvoiceStatus = normalizeInvoiceStatus(invoiceMutation.requestedStatus)
          if (requestedInvoiceStatus !== 'Đã xuất') {
            throw new Error('Đơn legacy đã xuất phải giữ nguyên trạng thái Đã xuất khi tạo hóa đơn.')
          }
        } else {
          requestedInvoiceStatus = assertSaleInvoiceStatus(invoiceMutation.requestedStatus)
        }
        if (invoiceMutation.mode === 'legacy_create') {
          if (invoiceSnapshot?.exists()) {
            const persistedInvoice = invoiceSnapshot.data()
            if (isActiveOrderRelation(persistedInvoice)) {
              throw new Error('Đơn hàng đã có document hóa đơn đang hoạt động. Hãy tải lại dữ liệu.')
            }
            if (String(persistedInvoice.order_id || '') !== input.orderId) {
              throw new Error('Document hóa đơn tự động đang thuộc đơn hàng khác. Hãy xử lý xung đột trước khi lưu.')
            }
            existingInvoice = persistedInvoice
          }
        } else if (invoiceMutation.mode === 'status_update') {
          if (!invoiceSnapshot?.exists()) {
            throw new Error('Không tìm thấy hóa đơn đang hoạt động của đơn. Hãy tải lại dữ liệu.')
          }
          existingInvoice = invoiceSnapshot.data()
          if (existingInvoice.order_id !== input.orderId) {
            throw new Error('Hóa đơn không thuộc đơn hàng đang sửa.')
          }
          const currentInvoiceStatus = normalizeInvoiceStatus(existingInvoice.invoice_status)
          const expectedStatus = normalizeInvoiceStatus(invoiceMutation.expectedStatus)
          if (currentInvoiceStatus !== expectedStatus) {
            throw new Error('Trạng thái hóa đơn đã được cập nhật ở phiên khác. Hãy tải lại dữ liệu.')
          }
          if (toNumber(existingInvoice.relation_revision) !== toNumber(invoiceMutation.expectedRelationRevision)) {
            throw new Error('Phiên bản hóa đơn đã thay đổi. Hãy tải lại dữ liệu trước khi lưu.')
          }
          if (normalizeInvoiceStatus(existingOrder.invoice_status) !== currentInvoiceStatus) {
            throw new Error('Trạng thái hóa đơn và đơn hàng đang lệch nhau. Vui lòng tải lại dữ liệu.')
          }
          if (toNumber(existingOrder.invoice_record_count) !== 1) {
            throw new Error('Đơn hàng phải có đúng một hóa đơn hoạt động để Sale cập nhật trạng thái.')
          }
          if (!canSaleTransitionInvoiceStatus(currentInvoiceStatus, requestedInvoiceStatus)) {
            throw new Error('Hóa đơn đã xuất hoặc trạng thái chuyển đổi không hợp lệ.')
          }
        }
      }

      const actualRevision = input.mode === 'edit'
        ? assertExpectedOrderRevision(input.expectedRevision, existingOrder.revision)
        : 0
      const revision = nextOrderRevision(actualRevision)
      const orderSequence = input.mode === 'create'
        ? (sequenceSnapshot?.exists()
          ? Math.max(ORDER_SEQUENCE_START - 1, toNumber(sequenceSnapshot.data().last_number)) + 1
          : ORDER_SEQUENCE_START)
        : toNumber(existingOrder.order_sequence || input.orderPayload.order_sequence)
      const orderCode = input.mode === 'create'
        ? buildOrderCode(input.userCode, input.customerCode, orderSequence)
        : String(existingOrder.order_code || input.orderPayload.order_code || '')

      const invoiceRelationPatch = invoiceMutation?.mode === 'create'
        ? {
            invoice_status: requestedInvoiceStatus,
            invoice_record_count: 1,
            invoice_relation_revision: 1,
            relation_lock_version: 1,
            relation_last_module: 'invoices',
            relation_last_action: 'create',
            relation_last_document_id: invoiceMutation.invoiceId,
            relation_updated_by: actor,
            relation_updated_at: serverTimestamp(),
          }
        : invoiceMutation?.mode === 'legacy_create'
          ? {
              invoice_status: requestedInvoiceStatus,
              invoice_record_count: 1,
              invoice_relation_revision: Math.max(1, toNumber(existingOrder.invoice_relation_revision) + 1),
              relation_lock_version: 1,
              relation_last_module: 'invoices',
              relation_last_action: 'create',
              relation_last_document_id: invoiceMutation.invoiceId,
              relation_updated_by: actor,
              relation_updated_at: serverTimestamp(),
            }
          : invoiceMutation?.mode === 'status_update'
            ? {
                invoice_status: requestedInvoiceStatus,
                invoice_record_count: toNumber(existingOrder.invoice_record_count),
                invoice_relation_revision: toNumber(existingOrder.invoice_relation_revision) + 1,
                relation_lock_version: 1,
                relation_last_module: 'invoices',
                relation_last_action: 'update',
                relation_last_document_id: invoiceMutation.invoiceId,
                relation_updated_by: actor,
                relation_updated_at: serverTimestamp(),
              }
            : {}

      const candidateFinalOrderPayload = {
        ...input.orderPayload,
        ...invoiceRelationPatch,
        order_code: orderCode,
        order_sequence: orderSequence,
        user_code: input.userCode,
        customer_code: input.customerCode,
        owner_email: effectiveOwnership.ownerEmail,
        created_by: effectiveOwnership.createdBy,
        sale_email: effectiveOwnership.saleEmail,
        revision,
        last_operation_id: operationId,
        updated_at: serverTimestamp(),
      }
      const finalOrderPayload = input.mode === 'edit'
        ? preservePersistedOrderIdentityForEdit(candidateFinalOrderPayload, existingOrder)
        : candidateFinalOrderPayload

      if (input.mode === 'create') {
        transaction.set(sequenceRef, {
          customer_id: input.customerId,
          customer_code: input.customerCode,
          last_number: orderSequence,
          updated_by: input.createdBy,
          updated_at: serverTimestamp(),
          ...(sequenceSnapshot?.exists() ? {} : { created_at: serverTimestamp() }),
        }, { merge: true })
        transaction.set(orderRef, finalOrderPayload)
      } else {
        transaction.set(orderRef, finalOrderPayload, { merge: true })
      }

      if ((invoiceMutation?.mode === 'create' || invoiceMutation?.mode === 'legacy_create') && invoiceRef) {
        transaction.set(invoiceRef, {
          ...(invoiceMutation.payload || {}),
          id: invoiceMutation.invoiceId,
          order_id: input.orderId,
          order_code: orderCode,
          invoice_number: '',
          invoice_date: '',
          invoice_amount: Math.max(0, toNumber(finalOrderPayload.payable_amount)),
          invoice_status: requestedInvoiceStatus,
          created_by: actor,
          order_owner_email: effectiveOwnership.ownerEmail,
          order_created_by: effectiveOwnership.createdBy,
          order_sale_email: effectiveOwnership.saleEmail,
          relation_revision: toNumber(invoiceRelationPatch.invoice_relation_revision),
          last_operation_id: operationId,
          status: 'active',
          active: true,
          deleted: false,
          created_at: existingInvoice?.created_at || serverTimestamp(),
          updated_at: serverTimestamp(),
        })
      } else if (invoiceMutation?.mode === 'status_update' && invoiceRef && existingInvoice) {
        transaction.update(invoiceRef, {
          invoice_status: requestedInvoiceStatus,
          relation_revision: toNumber(existingInvoice.relation_revision) + 1,
          last_operation_id: operationId,
          updated_at: serverTimestamp(),
        })
      }

      const localItems = itemPlan.upsertItems.map(item => {
        const itemPayload = {
          ...item,
          order_id: input.orderId,
          order_code: orderCode,
          owner_email: effectiveOwnership.ownerEmail,
          sale_email: effectiveOwnership.saleEmail,
          created_by: effectiveOwnership.createdBy,
          order_revision: revision,
          last_operation_id: operationId,
          ...buildOrderItemLifecyclePatch(item.isNew),
          updated_at: serverTimestamp(),
          ...(item.isNew ? { created_at: serverTimestamp() } : {}),
        }
        delete (itemPayload as any).isNew
        transaction.set(doc(db, 'order_items', item.id), itemPayload, { merge: !item.isNew })
        return {
          ...itemPayload,
          id: item.id,
          firestore_id: item.id,
        } as OrderItemDoc
      })

      itemPlan.removedItems.forEach(item => {
        const itemId = String(item.id || item.firestore_id || '')
        transaction.update(doc(db, 'order_items', itemId), {
          deleted: true,
          active: false,
          status: 'deleted',
          deleted_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        })
      })

      transaction.set(activityRef, {
        module: 'orders',
        action: input.activityAction,
        item_code: orderCode,
        item_name: input.activityItemName || orderCode,
        changed_by: input.changedBy,
        before_json: JSON.stringify(input.activityBefore || {}),
        after_json: JSON.stringify({
          ...input.orderPayload,
          ...invoiceRelationPatch,
          order_code: orderCode,
          order_sequence: orderSequence,
          user_code: input.userCode,
          customer_code: input.customerCode,
          revision,
          last_operation_id: operationId,
          items_count: localItems.length,
          removed_item_ids: itemPlan.removedItems.map(item => item.id || item.firestore_id),
        }),
        operation_id: operationId,
        order_revision: revision,
        created_at: serverTimestamp(),
        active: true,
        deleted: false,
      })

      finalResult = {
        orderCode,
        orderSequence,
        revision,
        operationId,
        orderPayload: finalOrderPayload,
        items: localItems,
        removedItemIds: itemPlan.removedItems.map(item => String(item.id || item.firestore_id || '')),
        writeCount,
        ...(invoiceMutation ? {
          invoiceId: invoiceMutation.invoiceId,
          invoiceStatus: requestedInvoiceStatus,
        } : {}),
      }
    })

    if (!finalResult) throw new Error('Giao dịch lưu đơn không trả về kết quả.')
    return finalResult
  }

  return { saveOrderAtomic }
}
