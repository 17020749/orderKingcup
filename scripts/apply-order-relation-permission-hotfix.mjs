import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

// Trigger the guarded patch after the workflow exists on the hotfix branch.
function read(path) {
  return readFileSync(path, 'utf8')
}

function write(path, content) {
  writeFileSync(path, content, 'utf8')
}

function replaceExact(source, before, after, expectedCount, label) {
  const count = source.split(before).length - 1
  if (count !== expectedCount) {
    throw new Error(`${label}: expected ${expectedCount} matches, found ${count}`)
  }
  return source.split(before).join(after)
}

let rules = read('firestore.rules')
rules = replaceExact(
  rules,
  '(ownsOrderData(order) || isAdmin())',
  "(ownsOrderData(order) || hasPerm('orders.view_all') || isAdmin())",
  2,
  'relation child scope',
)
rules = replaceExact(
  rules,
  'return ownsOrderData(resource.data)\n        && orderIdentityUnchanged()',
  "return (ownsOrderData(resource.data) || hasPerm('orders.view_all'))\n        && orderIdentityUnchanged()",
  3,
  'relation parent summary scope',
)
write('firestore.rules', rules)

let ordersPage = read('pages/orders.vue')
ordersPage = replaceExact(
  ordersPage,
  `    const localOrder = {\n      ...(editing.value || {}),\n      ...baseOrder,\n      ...localPaymentSummary,`,
  `    const localOrder = {\n      ...(editing.value || {}),\n      ...baseOrder,\n      ...localPaymentSummary,\n      ...(!editing.value ? {\n        printing_progress_count: 0,\n        printing_lock_version: 1,\n        printing_last_action: 'reconcile',\n        printing_last_print_order_id: '',\n        printing_lock_updated_by: createdBy,\n        printing_lock_updated_at: now,\n        relation_lock_version: 1,\n        payment_record_count: 0,\n        invoice_record_count: 0,\n        shipment_record_count: 0,\n        payment_relation_revision: 0,\n        invoice_relation_revision: 0,\n        shipment_relation_revision: 0,\n        relation_last_module: 'all',\n        relation_last_action: 'reconcile',\n        relation_last_document_id: '',\n        relation_updated_by: createdBy,\n        relation_updated_at: now,\n        shipment_status: '',\n        shipping_fee_total: 0,\n        cod_amount_total: 0,\n      } : {}),`,
  1,
  'new order local state',
)
write('pages/orders.vue', ordersPage)

let relationTests = read('tests/order-relations.rules.test.mjs')
relationTests = replaceExact(
  relationTests,
  "const SALE = 'sale@example.com'\nlet env",
  "const SALE = 'sale@example.com'\nconst MANAGER = 'manager@example.com'\nlet env",
  1,
  'manager test identity',
)
relationTests = replaceExact(
  relationTests,
  'function relationMeta(module, action, documentId) {',
  'function relationMeta(module, action, documentId, actor = SALE) {',
  1,
  'relation metadata actor',
)
relationTests = replaceExact(
  relationTests,
  '    relation_updated_by: SALE,',
  '    relation_updated_by: actor,',
  1,
  'relation metadata actor field',
)
relationTests = replaceExact(
  relationTests,
  `      setDoc(doc(db, 'orders', 'order-a'), baseOrder('order-a')),`,
  `      setDoc(doc(db, 'users', MANAGER), {\n        email: MANAGER,\n        active: true,\n        deleted: false,\n        permissions_flat: [\n          'orders.view_all',\n          'payments.view_all', 'payments.create', 'payments.edit', 'payments.delete',\n          'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete',\n          'shipments.view', 'shipments.create', 'shipments.edit', 'shipments.delete',\n        ],\n      }),\n      setDoc(doc(db, 'orders', 'order-a'), baseOrder('order-a')),`,
  1,
  'manager seed',
)
relationTests = replaceExact(
  relationTests,
  `test('payment create phải ghi child và summary parent trong cùng batch', async () => {`,
  `test('non-admin có orders.view_all được thêm thanh toán cho đơn của sale khác', async () => {\n  const db = env.authenticatedContext(MANAGER, { email: MANAGER }).firestore()\n  const batch = writeBatch(db)\n  batch.set(doc(db, 'payments', 'pay-manager'), {\n    id: 'pay-manager', order_id: 'order-a', order_code: 'order-a',\n    payment_type: 'Cọc', payment_status: 'Đã nhận', amount: 200,\n    created_by: MANAGER, ...ownership(), active: true, deleted: false, status: 'active',\n  })\n  batch.update(doc(db, 'orders', 'order-a'), {\n    ...relationMeta('payments', 'create', 'pay-manager', MANAGER),\n    payment_record_count: 1,\n    payment_relation_revision: 1,\n    paid_amount: 200,\n    debt_amount: 800,\n    payment_status: 'Đã cọc',\n    computed_payment_status: 'Đã cọc',\n    payment_count: 1,\n    deposit_count: 1,\n    collect_count: 0,\n  })\n  await assertSucceeds(batch.commit())\n})\n\ntest('payment create phải ghi child và summary parent trong cùng batch', async () => {`,
  1,
  'non-owner payment regression test',
)
write('tests/order-relations.rules.test.mjs', relationTests)

let clientTests = read('tests/order-printing-delete-lock.client.test.mjs')
clientTests = replaceExact(
  clientTests,
  `  assert.match(page, /printing_lock_version: 1/)`,
  `  assert.match(page, /printing_lock_version: 1/)\n  assert.match(page, /const localOrder = \\{[\\s\\S]*printing_progress_count: 0[\\s\\S]*relation_lock_version: 1/)`,
  1,
  'new order local lock regression test',
)
write('tests/order-printing-delete-lock.client.test.mjs', clientTests)

unlinkSync('scripts/apply-order-relation-permission-hotfix.mjs')
unlinkSync('.github/workflows/apply-order-relation-permission-hotfix.yml')
