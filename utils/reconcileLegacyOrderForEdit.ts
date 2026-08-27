import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore'
import type { OrderDoc } from '~/types/models'
import { normalizeEmail } from '~/utils/format'
// @ts-ignore Shared ESM helpers are executed directly by Node client tests.
import {
  buildReconciledOrderRelationPatch,
  relationReconcileNeeded,
} from '~/utils/orderRelationState.mjs'

type ReconcileLegacyOrderForEditInput = {
  db: Firestore
  orderId: string
  actor: string
}

export type ReconcileLegacyOrderForEditResult = {
  updated: boolean
  order: OrderDoc
}

function rows(snapshot: any) {
  return snapshot.docs.map((item: any) => ({ ...item.data(), id: item.id }))
}

/**
 * Canonicalize relation/payment summary fields for exactly one legacy order.
 *
 * Firestore Rules validate numeric types as well as values. Older orders can
 * contain fields such as paid_amount, relation_lock_version or relation counts
 * as numeric strings ("0", "1", ...). A normal order edit then fails the
 * business invariant with permission-denied even for an absolute admin.
 *
 * This helper is intentionally targeted to one order so save does not depend on
 * the slower background reconciliation that scans every order in the database.
 * The caller must only invoke it for an absolute admin (`permissions_flat: ['*']`),
 * because the reconciliation marker is admin-only in Firestore Rules.
 */
export async function reconcileLegacyOrderForEdit({
  db,
  orderId,
  actor,
}: ReconcileLegacyOrderForEditInput): Promise<ReconcileLegacyOrderForEditResult> {
  const normalizedOrderId = String(orderId || '').trim()
  const normalizedActor = normalizeEmail(actor)
  if (!normalizedOrderId) throw new Error('Thiếu ID đơn hàng cần đồng bộ trước khi sửa.')
  if (!normalizedActor) throw new Error('Không xác định được quản trị viên đồng bộ đơn hàng.')

  const orderRef = doc(db, 'orders', normalizedOrderId)
  const [orderSnapshot, paymentSnapshot, invoiceSnapshot, shipmentSnapshot] = await Promise.all([
    getDoc(orderRef),
    getDocs(query(collection(db, 'payments'), where('order_id', '==', normalizedOrderId))),
    getDocs(query(collection(db, 'invoices'), where('order_id', '==', normalizedOrderId))),
    getDocs(query(collection(db, 'shipments'), where('order_id', '==', normalizedOrderId))),
  ])

  if (!orderSnapshot.exists()) {
    throw new Error('Đơn hàng không còn tồn tại. Hãy tải lại danh sách.')
  }

  const order = { ...orderSnapshot.data(), id: orderSnapshot.id } as OrderDoc
  if (order.deleted === true || order.active === false) {
    throw new Error('Đơn hàng đã bị xóa hoặc ngừng hoạt động.')
  }

  const patch = buildReconciledOrderRelationPatch({
    order,
    payments: rows(paymentSnapshot),
    invoices: rows(invoiceSnapshot),
    shipments: rows(shipmentSnapshot),
    actor: normalizedActor,
    updatedAt: serverTimestamp(),
  })

  if (!relationReconcileNeeded(order, patch)) {
    return { updated: false, order }
  }

  await updateDoc(orderRef, patch)
  return {
    updated: true,
    order: { ...order, ...patch } as OrderDoc,
  }
}
