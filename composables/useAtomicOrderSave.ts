import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import type { OrderItemDoc } from '~/types/models'
import { buildOrderCode, ORDER_SEQUENCE_START } from '~/utils/orderCode'
import { toNumber } from '~/utils/format'
// @ts-ignore Shared ESM helpers are executed directly by Node client tests.
import {
  assertAtomicOrderWriteLimit,
  assertExpectedOrderRevision,
  buildOrderOperationId,
  nextOrderRevision,
  planAtomicOrderItems,
} from '~/utils/orderAtomicSave.mjs'

type AtomicOrderMode = 'create' | 'edit'

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
}

export function useAtomicOrderSave() {
  const { db } = useFirebaseServices()

  async function saveOrderAtomic(input: AtomicOrderSaveInput): Promise<AtomicOrderSaveResult> {
    if (!input.orderId) throw new Error('Thiếu ID đơn hàng.')
    if (!input.customerId) throw new Error('Thiếu khách hàng của đơn.')
    if (!input.nextItems.length) throw new Error('Vui lòng thêm ít nhất một sản phẩm.')

    const writeCount = assertAtomicOrderWriteLimit({
      mode: input.mode,
      existingItems: input.existingItems,
      nextItems: input.nextItems,
    })
    const itemPlan = planAtomicOrderItems(input.existingItems, input.nextItems)
    const orderRef = doc(db, 'orders', input.orderId)
    const sequenceRef = doc(db, 'order_sequences', input.customerId)
    const activityRef = doc(collection(db, 'activity_logs'))
    const operationId = buildOrderOperationId(input.orderId)
    let finalResult: AtomicOrderSaveResult | null = null

    await runTransaction(db, async transaction => {
      // Firestore requires every read before the first write in a transaction.
      const orderSnapshot = await transaction.get(orderRef)
      const sequenceSnapshot = input.mode === 'create'
        ? await transaction.get(sequenceRef)
        : null

      if (input.mode === 'create' && orderSnapshot.exists()) {
        throw new Error('ID đơn hàng đã tồn tại. Hãy đóng biểu mẫu và tạo lại đơn.')
      }
      if (input.mode === 'edit' && !orderSnapshot.exists()) {
        throw new Error('Đơn hàng không còn tồn tại. Hãy tải lại danh sách.')
      }

      const existingOrder = orderSnapshot.exists() ? orderSnapshot.data() : {}
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

      const finalOrderPayload = {
        ...input.orderPayload,
        order_code: orderCode,
        order_sequence: orderSequence,
        user_code: input.userCode,
        customer_code: input.customerCode,
        revision,
        last_operation_id: operationId,
        updated_at: serverTimestamp(),
      }

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

      const localItems = itemPlan.upsertItems.map(item => {
        const itemPayload = {
          ...item,
          order_id: input.orderId,
          order_code: orderCode,
          owner_email: input.ownerEmail,
          sale_email: input.saleEmail,
          created_by: input.createdBy,
          order_revision: revision,
          last_operation_id: operationId,
          status: 'active',
          active: true,
          deleted: false,
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
      }
    })

    if (!finalResult) throw new Error('Giao dịch lưu đơn không trả về kết quả.')
    return finalResult
  }

  return { saveOrderAtomic }
}
