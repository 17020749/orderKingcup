import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { normalizeEmail, toNumber } from '~/utils/format'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { buildOrderOperationId } from '~/utils/orderAtomicSave.mjs'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import {
  buildFulfilledOrderMetadataPatch,
  isFulfilledOrder,
  normalizeFulfilledOrderMetadata,
} from '~/utils/orderFulfilledMetadataEdit.mjs'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { moduleActionDecision, permissionDecisionMessage } from '~/utils/permissionDecisions.mjs'

type FulfilledOrderMetadataSaveInput = {
  orderId: string
  expectedRevision: number
  orderDate: string
  orderStatus: string
}

type FulfilledOrderMetadataSaveResult = {
  order_date: string
  order_status: string
  revision: number
  last_operation_id: string
}

export function useFulfilledOrderMetadataSave() {
  const { db } = useFirebaseServices()
  const { appUser, permissions } = useAuth()

  async function saveFulfilledOrderMetadata(
    input: FulfilledOrderMetadataSaveInput,
  ): Promise<FulfilledOrderMetadataSaveResult> {
    const orderId = String(input.orderId || '').trim()
    const actor = normalizeEmail(appUser.value?.email || '')
    const normalized = normalizeFulfilledOrderMetadata(input)

    if (!orderId) throw new Error('Thiếu ID đơn hàng.')
    if (!actor) throw new Error('Không xác định được người thao tác.')

    const orderRef = doc(db, 'orders', orderId)
    const activityRef = doc(collection(db, 'activity_logs'))
    let finalResult: FulfilledOrderMetadataSaveResult | null = null

    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(orderRef)
      if (!snapshot.exists()) throw new Error('Đơn hàng không còn tồn tại. Hãy tải lại danh sách.')

      const current = snapshot.data()
      if (!isFulfilledOrder(current)) {
        throw new Error('Trạng thái xuất kho đã thay đổi. Vui lòng tải lại đơn hàng.')
      }

      const decision = moduleActionDecision({
        actionPermission: 'orders.edit',
        viewAllPermission: 'orders.view_all',
        permissions: permissions.value,
        record: { ...current, id: orderId },
        currentUserEmail: actor,
        currentUserCode: appUser.value?.user_code || '',
        allowLegacyOrderCodeOwnership: true,
      })
      if (!decision.allowed) {
        throw new Error(permissionDecisionMessage(decision, {
          operation: 'orders.edit_fulfilled_metadata',
          record: orderId,
          status: current.warehouse_fulfillment_status || '',
        }))
      }

      const currentRevision = toNumber(current.revision)
      if (currentRevision !== toNumber(input.expectedRevision)) {
        throw new Error('Đơn hàng đã được cập nhật ở phiên khác. Hãy tải lại dữ liệu.')
      }

      const operationId = buildOrderOperationId(orderId)
      const updatedAt = serverTimestamp()
      const patch = buildFulfilledOrderMetadataPatch({
        ...normalized,
        currentRevision,
        operationId,
        updatedAt,
      })

      transaction.update(orderRef, patch)
      transaction.set(activityRef, {
        module: 'orders',
        action: 'update_fulfilled_metadata',
        item_code: String(current.order_code || ''),
        item_name: String(current.customer_name || current.order_code || orderId),
        changed_by: actor,
        before_json: JSON.stringify({
          order_date: current.order_date || '',
          order_status: current.order_status || '',
        }),
        after_json: JSON.stringify(normalized),
        operation_id: operationId,
        order_revision: patch.revision,
        created_at: updatedAt,
        active: true,
        deleted: false,
      })

      finalResult = {
        ...normalized,
        revision: patch.revision,
        last_operation_id: operationId,
      }
    })

    if (!finalResult) throw new Error('Giao dịch cập nhật đơn không trả về kết quả.')
    return finalResult
  }

  return { saveFulfilledOrderMetadata }
}
