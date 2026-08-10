import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { normalizeEmail, toNumber } from '~/utils/format'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import {
  buildOrderOperationId,
  shouldReadExistingInvoiceSnapshot,
} from '~/utils/orderAtomicSave.mjs'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import {
  buildFulfilledOrderMetadataPatch,
  isFulfilledOrder,
  normalizeFulfilledOrderMetadata,
  validateFulfilledInvoiceStatusTransition,
} from '~/utils/orderFulfilledMetadataEdit.mjs'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import {
  buildOrderInvoiceId,
  canSaleTransitionInvoiceStatus,
  normalizeInvoiceStatus,
} from '~/utils/orderInvoiceFlow.mjs'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { isActiveOrderRelation } from '~/utils/orderRelationState.mjs'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { moduleActionDecision, permissionDecisionMessage } from '~/utils/permissionDecisions.mjs'

type FulfilledInvoiceMutation = {
  mode: 'status_update' | 'legacy_create'
  invoiceId: string
  requestedStatus: string
  expectedStatus?: string
  expectedRelationRevision?: number
  payload?: Record<string, any>
}

type FulfilledOrderMetadataSaveInput = {
  orderId: string
  expectedRevision: number
  orderDate: string
  orderStatus: string
  invoiceStatus: string
  invoiceMutation?: FulfilledInvoiceMutation
}

type FulfilledOrderMetadataSaveResult = {
  order_date: string
  order_status: string
  invoice_status: string
  revision: number
  invoice_relation_revision: number
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
    const invoiceMutation = input.invoiceMutation

    if (!orderId) throw new Error('Thiếu ID đơn hàng.')
    if (!actor) throw new Error('Không xác định được người thao tác.')
    if (invoiceMutation && !String(invoiceMutation.invoiceId || '').trim()) {
      throw new Error('Thiếu ID hóa đơn cần đồng bộ.')
    }

    const orderRef = doc(db, 'orders', orderId)
    const invoiceRef = invoiceMutation
      ? doc(db, 'invoices', String(invoiceMutation.invoiceId).trim())
      : null
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

      const currentInvoiceStatus = normalizeInvoiceStatus(current.invoice_status)
      const requestedInvoiceStatus = validateFulfilledInvoiceStatusTransition(
        currentInvoiceStatus,
        normalized.invoice_status,
      )
      const invoiceStatusChanged = currentInvoiceStatus !== requestedInvoiceStatus
      if (invoiceStatusChanged && !invoiceMutation) {
        throw new Error('Thiếu giao dịch hóa đơn đi kèm thay đổi trạng thái.')
      }
      if (!invoiceStatusChanged && invoiceMutation) {
        throw new Error('Trạng thái hóa đơn đã thay đổi ở phiên khác. Hãy tải lại dữ liệu.')
      }

      let invoiceSnapshot: any = null
      if (invoiceRef && shouldReadExistingInvoiceSnapshot({
        mode: 'edit',
        invoiceMutation,
        persistedOrder: current,
      })) {
        invoiceSnapshot = await transaction.get(invoiceRef)
      }

      const operationId = buildOrderOperationId(orderId)
      const updatedAt = serverTimestamp()
      const patch = buildFulfilledOrderMetadataPatch({
        ...normalized,
        currentRevision,
        operationId,
        updatedAt,
      })
      const orderPatch: Record<string, any> = { ...patch }
      let nextInvoiceRelationRevision = toNumber(current.invoice_relation_revision)

      if (invoiceStatusChanged && invoiceMutation && invoiceRef) {
        const currentRelationRevision = toNumber(current.invoice_relation_revision)
        nextInvoiceRelationRevision = currentRelationRevision + 1

        if (invoiceMutation.mode === 'status_update') {
          if (!invoiceSnapshot?.exists()) {
            throw new Error('Không tìm thấy hóa đơn đang hoạt động của đơn. Hãy tải lại dữ liệu.')
          }
          const existingInvoice = invoiceSnapshot.data()
          if (!isActiveOrderRelation(existingInvoice)) {
            throw new Error('Hóa đơn của đơn không còn hoạt động. Hãy tải lại dữ liệu.')
          }
          if (String(existingInvoice.order_id || '') !== orderId) {
            throw new Error('Hóa đơn không thuộc đơn hàng đang sửa.')
          }
          const existingInvoiceStatus = normalizeInvoiceStatus(existingInvoice.invoice_status)
          if (existingInvoiceStatus !== normalizeInvoiceStatus(invoiceMutation.expectedStatus)) {
            throw new Error('Trạng thái hóa đơn đã được cập nhật ở phiên khác. Hãy tải lại dữ liệu.')
          }
          if (toNumber(existingInvoice.relation_revision) !== toNumber(invoiceMutation.expectedRelationRevision)) {
            throw new Error('Phiên bản hóa đơn đã thay đổi. Hãy tải lại dữ liệu trước khi lưu.')
          }
          if (currentInvoiceStatus !== existingInvoiceStatus) {
            throw new Error('Trạng thái hóa đơn và đơn hàng đang lệch nhau. Vui lòng tải lại dữ liệu.')
          }
          if (toNumber(current.invoice_record_count) !== 1) {
            throw new Error('Đơn hàng phải có đúng một hóa đơn hoạt động để Sale cập nhật trạng thái.')
          }
          if (currentRelationRevision !== toNumber(existingInvoice.relation_revision)) {
            throw new Error('Phiên bản quan hệ hóa đơn và đơn hàng đang lệch nhau. Hãy tải lại dữ liệu.')
          }
          if (!canSaleTransitionInvoiceStatus(existingInvoiceStatus, requestedInvoiceStatus)) {
            throw new Error('Hóa đơn đã xuất hoặc trạng thái chuyển đổi không hợp lệ.')
          }

          transaction.update(invoiceRef, {
            invoice_status: requestedInvoiceStatus,
            relation_revision: nextInvoiceRelationRevision,
            last_operation_id: operationId,
            updated_at: updatedAt,
          })
        } else {
          if (invoiceMutation.invoiceId !== buildOrderInvoiceId(orderId)) {
            throw new Error('ID hóa đơn legacy không khớp đơn hàng.')
          }
          const existingInvoice = invoiceSnapshot?.exists() ? invoiceSnapshot.data() : null
          if (existingInvoice && isActiveOrderRelation(existingInvoice)) {
            throw new Error('Đơn hàng đã có document hóa đơn đang hoạt động. Hãy tải lại dữ liệu.')
          }
          if (existingInvoice && String(existingInvoice.order_id || '') !== orderId) {
            throw new Error('Document hóa đơn tự động đang thuộc đơn hàng khác. Hãy xử lý xung đột trước khi lưu.')
          }

          const invoicePayload = {
            ...(invoiceMutation.payload || {}),
            id: invoiceMutation.invoiceId,
            order_id: orderId,
            order_code: String(current.order_code || ''),
            invoice_number: '',
            invoice_date: '',
            invoice_amount: Math.max(0, toNumber(current.payable_amount)),
            invoice_status: requestedInvoiceStatus,
            created_by: actor,
            order_owner_email: current.owner_email || '',
            order_created_by: current.created_by || '',
            order_sale_email: current.sale_email || '',
            relation_revision: nextInvoiceRelationRevision,
            last_operation_id: operationId,
            status: 'active',
            active: true,
            deleted: false,
            created_at: existingInvoice?.created_at || updatedAt,
            updated_at: updatedAt,
          }
          if (existingInvoice) transaction.set(invoiceRef, invoicePayload, { merge: true })
          else transaction.set(invoiceRef, invoicePayload)
        }

        Object.assign(orderPatch, {
          invoice_status: requestedInvoiceStatus,
          invoice_record_count: 1,
          invoice_relation_revision: nextInvoiceRelationRevision,
          relation_lock_version: 1,
          relation_last_module: 'invoices',
          relation_last_action: invoiceMutation.mode === 'legacy_create' ? 'create' : 'update',
          relation_last_document_id: invoiceMutation.invoiceId,
          relation_updated_by: actor,
          relation_updated_at: updatedAt,
        })
      }

      transaction.update(orderRef, orderPatch)
      transaction.set(activityRef, {
        module: 'orders',
        action: 'update_fulfilled_metadata',
        item_code: String(current.order_code || ''),
        item_name: String(current.customer_name || current.order_code || orderId),
        changed_by: actor,
        before_json: JSON.stringify({
          order_date: current.order_date || '',
          order_status: current.order_status || '',
          invoice_status: currentInvoiceStatus,
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
        invoice_relation_revision: nextInvoiceRelationRevision,
        last_operation_id: operationId,
      }
    })

    if (!finalResult) throw new Error('Giao dịch cập nhật đơn không trả về kết quả.')
    return finalResult
  }

  return { saveFulfilledOrderMetadata }
}
