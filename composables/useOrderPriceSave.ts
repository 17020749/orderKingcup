import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { normalizeEmail, round2, toNumber } from '~/utils/format'
// @ts-ignore Shared ESM helpers are executed directly by Node client tests.
import { buildOrderOperationId } from '~/utils/orderAtomicSave.mjs'
// @ts-ignore Shared ESM helpers are executed directly by Node client tests.
import {
  assertPriceOnlyItemChange,
  pricePatchForItem,
} from '~/utils/orderPriceEdit.mjs'
import { moduleActionDecision, permissionDecisionMessage } from '~/utils/permissionDecisions.mjs'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { isActiveOrderRelation } from '~/utils/orderRelationState.mjs'

type OrderPriceSaveInput = {
  orderId: string
  expectedRevision: number
  invoiceIds?: string[]
  nextItems: Record<string, any>[]
  orderTotals: Record<string, any>
}

type OrderPriceSaveResult = {
  revision: number
  price_revision: number
  last_operation_id: string
  invoice_status: string
  invoice_needs_adjustment: boolean
}

function paymentStatus(order: Record<string, any>, debt: number) {
  const paid = toNumber(order.paid_amount)
  if (paid <= 0) return 'Chưa thanh toán'
  if (debt === 0) return 'Đã thanh toán'
  if (debt < 0) return 'Thanh toán thừa'
  if (toNumber(order.deposit_count) > 0 && toNumber(order.collect_count) > 0) return 'Đã cọc + thanh toán 1 phần'
  if (toNumber(order.deposit_count) > 0) return 'Đã cọc'
  return 'Thanh toán một phần'
}

function financialNumber(value: any, field: string) {
  const result = toNumber(value)
  if (result < 0) throw new Error(`${field} không được âm.`)
  return round2(result)
}

export function useOrderPriceSave() {
  const { db } = useFirebaseServices()
  const { appUser, permissions } = useAuth()

  async function saveOrderPrice(input: OrderPriceSaveInput): Promise<OrderPriceSaveResult> {
    const orderId = String(input.orderId || '').trim()
    const actor = normalizeEmail(appUser.value?.email || '')
    if (!orderId) throw new Error('Thiếu ID đơn hàng.')
    if (!actor) throw new Error('Không xác định được người thao tác.')
    if (!Array.isArray(input.nextItems) || !input.nextItems.length) {
      throw new Error('Đơn hàng phải có ít nhất một sản phẩm.')
    }

    const orderRef = doc(db, 'orders', orderId)
    const invoiceIds = [...new Set((input.invoiceIds || []).map(value => String(value || '').trim()).filter(Boolean))]
    const invoiceRefs = invoiceIds.map(invoiceId => doc(db, 'invoices', invoiceId))
    const itemRefs = input.nextItems.map(item => doc(db, 'order_items', String(item.id || item.firestore_id || '').trim()))
    const activityRef = doc(collection(db, 'activity_logs'))
    const operationId = buildOrderOperationId(orderId)
    let finalResult: OrderPriceSaveResult | null = null

    await runTransaction(db, async transaction => {
      const orderSnapshot = await transaction.get(orderRef)
      if (!orderSnapshot.exists()) throw new Error('Đơn hàng không còn tồn tại. Hãy tải lại danh sách.')

      const current = orderSnapshot.data() as Record<string, any>
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
          operation: 'orders.edit_price', record: orderId, status: current.warehouse_fulfillment_status || '',
        }))
      }

      if (toNumber(current.revision) !== toNumber(input.expectedRevision)) {
        throw new Error('Đơn hàng đã được cập nhật ở phiên khác. Hãy tải lại dữ liệu.')
      }
      if (toNumber(input.orderTotals.discount_amount) !== toNumber(current.discount_amount)) {
        throw new Error('Chỉ được sửa đơn giá; số tiền giảm giá phải giữ nguyên.')
      }

      // The caller resolves the active invoice before opening the transaction.
      // A concrete document reference avoids QuerySnapshot/ref differences here.
      const invoiceSnapshots = await Promise.all(invoiceRefs.map(invoiceRef => transaction.get(invoiceRef)))
      const itemSnapshots = await Promise.all(itemRefs.map(itemRef => transaction.get(itemRef)))
      const currentItems = itemSnapshots.map((snapshot, index) => {
        if (!snapshot.exists()) throw new Error(`Không tìm thấy dòng sản phẩm ${input.nextItems[index]?.id || ''}.`)
        const item = { ...snapshot.data(), id: snapshot.id }
        if (String(item.order_id || '') !== orderId) throw new Error('Dòng sản phẩm không thuộc đơn hàng đang sửa.')
        return item
      })

      const currentById = new Map(currentItems.map(item => [String(item.id), item]))
      if (currentById.size !== input.nextItems.length) {
        throw new Error('Không được thêm hoặc xóa dòng sản phẩm khi sửa giá.')
      }
      input.nextItems.forEach(next => {
        const currentItem = currentById.get(String(next.id || next.firestore_id || ''))
        if (!currentItem) throw new Error('Không tìm thấy dòng sản phẩm cần sửa.')
        assertPriceOnlyItemChange(currentItem, next)
      })

      const totals = input.orderTotals || {}
      const actualRevenue = financialNumber(totals.actual_revenue, 'Tổng tiền đơn')
      const payableAmount = financialNumber(totals.payable_amount, 'Giá trị sau giảm giá')
      const debtAmount = round2(payableAmount - toNumber(current.paid_amount))
      const revision = toNumber(current.revision) + 1
      const priceRevision = toNumber(current.price_revision) + 1
      const updatedAt = serverTimestamp()
      const invoiceStatus = String(current.invoice_status || 'Không xuất')
      const activeInvoices = invoiceSnapshots
        .map((snapshot, index) => ({ snapshot, ref: invoiceRefs[index] }))
        .filter(({ snapshot }) => snapshot.exists()
          && String(snapshot.data().order_id || '') === orderId
          && isActiveOrderRelation(snapshot.data()))

      input.nextItems.forEach(next => {
        const currentItem = currentById.get(String(next.id || next.firestore_id || ''))!
        transaction.update(doc(db, 'order_items', String(currentItem.id)), {
          ...pricePatchForItem(currentItem, next),
          order_revision: revision,
          price_revision: priceRevision,
          last_operation_id: operationId,
          updated_at: updatedAt,
        })
      })

      activeInvoices.forEach(({ snapshot, ref }) => {
        if (toNumber(snapshot.data().invoice_amount) === payableAmount) return
        transaction.update(ref, {
          invoice_amount: payableAmount,
          last_operation_id: operationId,
          updated_at: updatedAt,
        })
      })

      transaction.update(orderRef, {
        subtotal_no_vat: financialNumber(totals.subtotal_no_vat, 'Tạm tính'),
        vat_amount: financialNumber(totals.vat_amount, 'Tiền VAT'),
        total_vat: financialNumber(totals.total_vat, 'Tổng sau VAT'),
        actual_revenue: actualRevenue,
        payable_amount: payableAmount,
        debt_amount: debtAmount,
        payment_status: paymentStatus(current, debtAmount),
        computed_payment_status: paymentStatus(current, debtAmount),
        revision,
        price_revision: priceRevision,
        last_operation_id: operationId,
        updated_at: updatedAt,
      })

      transaction.set(activityRef, {
        module: 'orders',
        action: 'update_order_price',
        item_code: String(current.order_code || orderId),
        item_name: String(current.customer_name || current.order_code || orderId),
        changed_by: actor,
        before_json: JSON.stringify({
          items: currentItems.map(item => ({
            id: item.id,
            unit_price: item.unit_price,
            line_total: item.line_total,
            logo_json: item.logo_json || '',
          })),
          actual_revenue: current.actual_revenue || current.total_vat || 0,
          payable_amount: current.payable_amount || 0,
          debt_amount: current.debt_amount || 0,
        }),
        after_json: JSON.stringify({
          items: input.nextItems.map(item => ({
            id: item.id,
            unit_price: item.unit_price,
            line_total: item.line_total,
            logo_json: item.logo_json || '',
          })),
          actual_revenue: actualRevenue,
          payable_amount: payableAmount,
          debt_amount: debtAmount,
          synchronized_invoice_count: activeInvoices.length,
        }),
        operation_id: operationId,
        order_revision: revision,
        created_at: updatedAt,
        active: true,
        deleted: false,
      })

      finalResult = {
        revision,
        price_revision: priceRevision,
        last_operation_id: operationId,
        invoice_status: invoiceStatus,
        invoice_needs_adjustment: false,
      }
    })

    if (!finalResult) throw new Error('Giao dịch sửa giá không trả về kết quả.')
    return finalResult
  }

  return { saveOrderPrice }
}
