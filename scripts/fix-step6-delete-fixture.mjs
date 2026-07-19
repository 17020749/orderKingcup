import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const path = 'tests/firestore.rules.test.mjs'
let source = readFileSync(path, 'utf8')
function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw new Error(`Không tìm thấy đoạn cần sửa: ${label}`)
  source = source.replace(before, after)
}

replaceOnce(
`function order(email, code) {
  return {
    id: code,
    order_code: code,
    owner_email: email,
    created_by: email,
    sale_email: email,
    active: true,
    deleted: false,
    warehouse_fulfillment_status: 'chua_xuat'
  }
}`,
`function order(email, code) {
  return {
    id: code,
    order_code: code,
    owner_email: email,
    created_by: email,
    sale_email: email,
    printing_progress_count: 0,
    printing_lock_version: 1,
    printing_last_action: 'reconcile',
    printing_last_print_order_id: '',
    printing_lock_updated_by: email,
    printing_lock_updated_at: 'now',
    active: true,
    deleted: false,
    warehouse_fulfillment_status: 'chua_xuat'
  }
}`,
'order fixture có khóa in',
)

replaceOnce(
`      setDoc(doc(db, 'orders', 'order-a'), order(A, 'order-a')),
      setDoc(doc(db, 'orders', 'order-a-exported'), { ...order(A, 'order-a-exported'), warehouse_fulfillment_status: 'da_xuat_1_phan', warehouse_request_status: 'da_xuat' }),`,
`      setDoc(doc(db, 'orders', 'order-a'), {
        ...order(A, 'order-a'),
        printing_progress_count: 1,
        printing_last_action: 'create',
        printing_last_print_order_id: 'print-a'
      }),
      setDoc(doc(db, 'orders', 'order-delete'), order(A, 'order-delete')),
      setDoc(doc(db, 'orders', 'order-a-exported'), { ...order(A, 'order-a-exported'), warehouse_fulfillment_status: 'da_xuat_1_phan', warehouse_request_status: 'da_xuat' }),`,
'order-a có tiến độ và order-delete riêng',
)

replaceOnce(
`      setDoc(doc(db, 'order_items', 'item-a'), { order_id: 'order-a', created_by: A, owner_email: A, sale_email: A, active: true, deleted: false, status: 'active' }),
      setDoc(doc(db, 'order_items', 'item-b'),`,
`      setDoc(doc(db, 'order_items', 'item-a'), { order_id: 'order-a', created_by: A, owner_email: A, sale_email: A, active: true, deleted: false, status: 'active' }),
      setDoc(doc(db, 'order_items', 'item-delete'), { order_id: 'order-delete', created_by: A, owner_email: A, sale_email: A, active: true, deleted: false, status: 'active' }),
      setDoc(doc(db, 'order_items', 'item-b'),`,
'item riêng cho test xóa',
)

replaceOnce(
`      setDoc(doc(db, 'order_export_requests', 'export-a'), { order_id: 'order-a', requested_by: A, ...ownership(A), status: 'cho_xu_ly', payload_json: '{}', active: true, deleted: false }),
      setDoc(doc(db, 'order_export_requests', 'export-a-accepted'),`,
`      setDoc(doc(db, 'order_export_requests', 'export-a'), { order_id: 'order-a', requested_by: A, ...ownership(A), status: 'cho_xu_ly', payload_json: '{}', active: true, deleted: false }),
      setDoc(doc(db, 'order_export_requests', 'export-delete'), { order_id: 'order-delete', requested_by: A, ...ownership(A), status: 'cho_xu_ly', payload_json: '{}', active: true, deleted: false }),
      setDoc(doc(db, 'order_export_requests', 'export-a-accepted'),`,
'export request riêng cho test xóa',
)

replaceOnce(
`  batch.update(doc(db, 'orders', 'order-a'), {
    deleted: true, active: false, status: 'deleted', deleted_at: 'now', updated_at: 'now'
  })
  batch.update(doc(db, 'order_items', 'item-a'), {
    deleted: true, active: false, status: 'deleted', deleted_at: 'now', updated_at: 'now'
  })
  batch.update(doc(db, 'order_export_requests', 'export-a'), {`,
`  batch.update(doc(db, 'orders', 'order-delete'), {
    deleted: true, active: false, status: 'deleted', deleted_at: 'now', updated_at: 'now'
  })
  batch.update(doc(db, 'order_items', 'item-delete'), {
    deleted: true, active: false, status: 'deleted', deleted_at: 'now', updated_at: 'now'
  })
  batch.update(doc(db, 'order_export_requests', 'export-delete'), {`,
'test xóa dùng fixture không có tiến độ in',
)

replaceOnce(
`      getDoc(doc(adminDb, 'orders', 'order-a')),
      getDoc(doc(adminDb, 'order_items', 'item-a'))`,
`      getDoc(doc(adminDb, 'orders', 'order-delete')),
      getDoc(doc(adminDb, 'order_items', 'item-delete'))`,
'assert fixture xóa riêng',
)

writeFileSync(path, source)
for (const file of [
  'scripts/fix-step6-delete-fixture.mjs',
  '.github/workflows/fix-step6-delete-fixture.yml',
  '.github/workflows/diagnose-step6-full-failures.yml',
]) {
  try { unlinkSync(file) } catch {}
}
console.log('Đã tách fixture xóa đơn khỏi đơn đang có tiến độ in.')
