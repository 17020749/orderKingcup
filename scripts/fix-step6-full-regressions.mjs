import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

function patchFile(path, changes) {
  let source = readFileSync(path, 'utf8')
  for (const [before, after, label] of changes) {
    if (!source.includes(before)) throw new Error(`Không tìm thấy đoạn cần sửa: ${label}`)
    source = source.replace(before, after)
  }
  writeFileSync(path, source)
}

patchFile('firestore.rules', [
  [
`      allow update: if orderPrintingSummaryUpdateAllowed(docId)
        || orderWarehouseSummaryUpdateAllowed()
        || isAdmin()
        || (
          // Normal business edit by an owner.
          hasPerm('orders.edit')
          && ownsOrderData(resource.data)
          && orderIdentityUnchanged()
          && normalOrderEditKeepsSystemFields()
          && (
            fulfillmentStatus() != 'da_xuat_du'
            || hasPerm('orders.edit_fulfilled')
          )
        )
        || (
          // Payment module updates only computed payment fields.
          hasAnyPerm(['payments.create', 'payments.edit', 'payments.delete'])
          && ownsOrderData(resource.data)
          && orderIdentityUnchanged()
          && onlyPaymentSummaryChanged()
        )
        || (
          // Owner soft-delete before any warehouse fulfillment.
          hasPerm('orders.delete')
          && ownsOrderData(resource.data)
          && orderIdentityUnchanged()
          && orderCanBeDeleted()
          && softDeleteOnly()
        )
        || (
          // Invoice module updates only invoice status.
          hasAnyPerm(['invoices.create', 'invoices.edit', 'invoices.delete'])
          && ownsOrderData(resource.data)
          && orderIdentityUnchanged()
          && onlyInvoiceStatusChanged()
        );`,
`      // Soft-delete is evaluated first so the order cascade stays below the
      // Firestore Rules expression budget.
      allow update: if (
          softDeleteOnly()
          && hasPerm('orders.delete')
          && ownsOrderData(resource.data)
          && orderIdentityUnchanged()
          && orderCanBeDeleted()
        )
        || orderPrintingSummaryUpdateAllowed(docId)
        || orderWarehouseSummaryUpdateAllowed()
        || isAdmin()
        || (
          // Normal business edit by an owner.
          hasPerm('orders.edit')
          && ownsOrderData(resource.data)
          && orderIdentityUnchanged()
          && normalOrderEditKeepsSystemFields()
          && (
            fulfillmentStatus() != 'da_xuat_du'
            || hasPerm('orders.edit_fulfilled')
          )
        )
        || (
          // Payment module updates only computed payment fields.
          hasAnyPerm(['payments.create', 'payments.edit', 'payments.delete'])
          && ownsOrderData(resource.data)
          && orderIdentityUnchanged()
          && onlyPaymentSummaryChanged()
        )
        || (
          // Invoice module updates only invoice status.
          hasAnyPerm(['invoices.create', 'invoices.edit', 'invoices.delete'])
          && ownsOrderData(resource.data)
          && orderIdentityUnchanged()
          && onlyInvoiceStatusChanged()
        );`,
    'ưu tiên soft-delete order',
  ],
  [
`      allow update: if isAdmin()
        || (
          resource.data.order_id is string
          && canMutateOrderById(resource.data.order_id)
          && request.resource.data.order_id == resource.data.order_id
          && orderItemIdentityUnchanged()
          && orderItemOwnershipSafe(resource.data.order_id)
          && (
            (
              hasPerm('orders.edit')
              && unchanged(['deleted', 'active', 'status', 'deleted_at'])
            )
            || (
              hasAnyPerm(['orders.edit', 'orders.delete'])
              && softDeleteOnly()
            )
          )
        );`,
`      allow update: if (
          softDeleteOnly()
          && hasAnyPerm(['orders.edit', 'orders.delete'])
          && resource.data.order_id is string
          && canMutateOrderById(resource.data.order_id)
          && request.resource.data.order_id == resource.data.order_id
          && orderItemIdentityUnchanged()
          && orderItemOwnershipSafe(resource.data.order_id)
        )
        || isAdmin()
        || (
          hasPerm('orders.edit')
          && unchanged(['deleted', 'active', 'status', 'deleted_at'])
          && resource.data.order_id is string
          && canMutateOrderById(resource.data.order_id)
          && request.resource.data.order_id == resource.data.order_id
          && orderItemIdentityUnchanged()
          && orderItemOwnershipSafe(resource.data.order_id)
        );`,
    'ưu tiên soft-delete order item',
  ],
  [
`      allow update: if exportOwnerEditAllowed()
        || exportSoftDeleteAllowed()
        || exportWarehouseProcessAllowed()
        || isAdmin();`,
`      allow update: if exportSoftDeleteAllowed()
        || exportOwnerEditAllowed()
        || exportWarehouseProcessAllowed()
        || isAdmin();`,
    'ưu tiên soft-delete export request',
  ],
  [
`    function exportSoftDeleteAllowed() {
      return exportRequestCanBeDeleted()
        && softDeleteOnly()
        && hasAnyPerm(['export_requests.delete', 'orders.delete'])
        && ownsOrderChildData(resource.data);
    }`,
`    function exportSoftDeleteAllowed() {
      return softDeleteOnly()
        && exportRequestCanBeDeleted()
        && hasAnyPerm(['export_requests.delete', 'orders.delete'])
        && ownsOrderChildData(resource.data);
    }`,
    'shape check export soft-delete',
  ],
])

patchFile('tests/firestore.rules.test.mjs', [
  [
`  await assertSucceeds(getDocs(query(collection(viewerDb, 'order_items'))))
  await assertFails(getDoc(doc(normalDb, 'print_orders', 'print-a')))`,
`  await assertSucceeds(getDocs(query(collection(viewerDb, 'order_items'))))
  // Chủ đơn có orders.delete được đọc tiến độ liên quan để hiển thị lý do khóa xóa.
  await assertSucceeds(getDoc(doc(normalDb, 'print_orders', 'print-a')))` ,
    'owner đọc print order cho delete guard',
  ],
  [
`  const db = env.authenticatedContext(PRINTING, { email: PRINTING }).firestore()
  const batch = writeBatch(db)
  batch.set(doc(db, 'print_orders', 'print-new'), {`,
`  const db = env.authenticatedContext(PRINTING, { email: PRINTING }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'orders', 'order-a'), {
    printing_progress_count: 2,
    printing_lock_version: 1,
    printing_last_action: 'create',
    printing_last_print_order_id: 'print-new',
    printing_lock_updated_by: PRINTING,
    printing_lock_updated_at: 'now'
  })
  batch.set(doc(db, 'print_orders', 'print-new'), {`,
    'test create tăng parent lock',
  ],
  [
`  const deleteBatch = writeBatch(db)
  const deletedPatch = {
    deleted: true, active: false, status: 'deleted', deleted_at: 'now',
    deleted_by: PRINTING, updated_by: PRINTING, updated_at: 'now'
  }
  deleteBatch.update(doc(db, 'print_orders', 'print-a'), deletedPatch)`,
`  const deleteBatch = writeBatch(db)
  const deletedPatch = {
    deleted: true, active: false, status: 'deleted', deleted_at: 'now',
    deleted_by: PRINTING, updated_by: PRINTING, updated_at: 'now'
  }
  deleteBatch.update(doc(db, 'orders', 'order-a'), {
    printing_progress_count: 0,
    printing_lock_version: 1,
    printing_last_action: 'delete',
    printing_last_print_order_id: 'print-a',
    printing_lock_updated_by: PRINTING,
    printing_lock_updated_at: 'now'
  })
  deleteBatch.update(doc(db, 'print_orders', 'print-a'), deletedPatch)`,
    'test delete giảm parent lock',
  ],
])

for (const path of [
  'scripts/fix-step6-full-regressions.mjs',
  '.github/workflows/fix-step6-full-regressions.yml',
  '.github/workflows/diagnose-step6-full-failures.yml',
]) {
  try { unlinkSync(path) } catch {}
}
console.log('Đã sửa bốn regression cuối của full suite.')
