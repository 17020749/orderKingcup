import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

function write(path, content) {
  writeFileSync(path, content, 'utf8')
}

function replaceOnce(source, from, to, label) {
  const count = source.split(from).length - 1
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`)
  return source.replace(from, to)
}

let orders = read('pages/orders.vue')
orders = replaceOnce(
  orders,
  "  loadScopedExportRequestsForOrders,\n  loadScopedCustomers,",
  "  loadScopedExportRequestsForOrders,\n  loadScopedExportRequests,\n  loadScopedCustomers,",
  'orders scoped query destructuring',
)
write('pages/orders.vue', orders)

let scoped = read('composables/useScopedQueries.ts')
scoped = replaceOnce(
  scoped,
  `  async function loadScopedPaymentsForOrders(orders: OrderDoc[], force = false) {\n    const orderIds = cleanIds(orders)\n    if (!orderIds.length) return [] as PaymentDoc[]\n    if (!canAll('payments.view_all')) {\n      const visible = await loadScopedPayments(orders, force)\n      const allowedOrderIds = new Set(orderIds)\n      return visible.filter(payment => allowedOrderIds.has(payment.order_id))\n    }\n    return sortNewest(\n      (await fetchByFieldValues<PaymentDoc>('payments', 'order_id', orderIds)).filter(isActive) as PaymentDoc[],\n      'payment_date',\n    )\n  }`,
  `  async function loadScopedPaymentsForOrders(orders: OrderDoc[], force = false) {\n    const orderIds = cleanIds(orders)\n    if (!orderIds.length) return [] as PaymentDoc[]\n    const canReadForRelation = canAll('payments.view_all')\n      || ['payments.view', 'payments.create', 'payments.edit', 'payments.delete'].some(key => hasPermission(key))\n    if (!canReadForRelation) return [] as PaymentDoc[]\n    return sortNewest(\n      (await fetchByFieldValues<PaymentDoc>('payments', 'order_id', orderIds)).filter(isActive) as PaymentDoc[],\n      'payment_date',\n    )\n  }`,
  'scoped payment relation loader',
)
write('composables/useScopedQueries.ts', scoped)

let rules = read('firestore.rules')
rules = replaceOnce(
  rules,
  `      allow read: if hasPerm('payments.view_all')\n        || (\n          hasPerm('payments.view')\n          && (\n            ownsOrderChildData(resource.data)\n            || (\n              resource.data.order_id is string\n              && ownsOrderById(resource.data.order_id)\n            )\n          )\n        );`,
  `      allow read: if hasPerm('payments.view_all')\n        || (\n          hasAnyPerm([\n            'payments.view',\n            'payments.create',\n            'payments.edit',\n            'payments.delete'\n          ])\n          && (\n            hasPerm('orders.view_all')\n            || ownsOrderChildData(resource.data)\n            || (\n              resource.data.order_id is string\n              && ownsOrderById(resource.data.order_id)\n            )\n          )\n        );`,
  'payment read scope',
)
write('firestore.rules', rules)

let ruleTests = read('tests/order-relations.rules.test.mjs')
ruleTests = replaceOnce(
  ruleTests,
  "const MANAGER = 'manager@example.com'\nlet env",
  "const MANAGER = 'manager@example.com'\nconst CASHIER = 'cashier@example.com'\nlet env",
  'cashier fixture constant',
)
ruleTests = replaceOnce(
  ruleTests,
  `      setDoc(doc(db, 'users', MANAGER), {\n        email: MANAGER,\n        active: true,\n        deleted: false,\n        permissions_flat: [\n          'orders.view_all',\n          'payments.view_all', 'payments.create', 'payments.edit', 'payments.delete',\n          'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete',\n          'shipments.view', 'shipments.create', 'shipments.edit', 'shipments.delete',\n        ],\n      }),`,
  `      setDoc(doc(db, 'users', MANAGER), {\n        email: MANAGER,\n        active: true,\n        deleted: false,\n        permissions_flat: [\n          'orders.view_all',\n          'payments.view_all', 'payments.create', 'payments.edit', 'payments.delete',\n          'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete',\n          'shipments.view', 'shipments.create', 'shipments.edit', 'shipments.delete',\n        ],\n      }),\n      setDoc(doc(db, 'users', CASHIER), {\n        email: CASHIER,\n        active: true,\n        deleted: false,\n        permissions_flat: [\n          'orders.view_all',\n          'payments.create',\n        ],\n      }),`,
  'cashier user fixture',
)
ruleTests = replaceOnce(
  ruleTests,
  `test('payment create phải ghi child và summary parent trong cùng batch', async () => {`,
  `test('non-admin chỉ có payments.create vẫn đọc đủ payment của đơn được xem và thêm payment thứ hai', async () => {\n  await env.withSecurityRulesDisabled(async context => {\n    const db = context.firestore()\n    await setDoc(doc(db, 'payments', 'pay-existing'), {\n      id: 'pay-existing', order_id: 'order-a', order_code: 'order-a',\n      payment_type: 'Cọc', payment_status: 'Đã nhận', amount: 200,\n      created_by: SALE, ...ownership(), active: true, deleted: false, status: 'active',\n    })\n    await updateDoc(doc(db, 'orders', 'order-a'), {\n      payment_record_count: 1, payment_relation_revision: 1, paid_amount: 200, debt_amount: 800,\n      payment_status: 'Đã cọc', computed_payment_status: 'Đã cọc', payment_count: 1, deposit_count: 1, collect_count: 0,\n    })\n  })\n\n  const db = env.authenticatedContext(CASHIER, { email: CASHIER }).firestore()\n  await assertSucceeds(getDoc(doc(db, 'payments', 'pay-existing')))\n\n  const batch = writeBatch(db)\n  batch.set(doc(db, 'payments', 'pay-cashier'), {\n    id: 'pay-cashier', order_id: 'order-a', order_code: 'order-a',\n    payment_type: 'Thu 1', payment_status: 'Đã nhận', amount: 300,\n    created_by: CASHIER, ...ownership(), active: true, deleted: false, status: 'active',\n  })\n  batch.update(doc(db, 'orders', 'order-a'), {\n    ...relationMeta('payments', 'create', 'pay-cashier', CASHIER),\n    payment_record_count: 2,\n    payment_relation_revision: 2,\n    paid_amount: 500,\n    debt_amount: 500,\n    payment_status: 'Đã cọc + thanh toán 1 phần',\n    computed_payment_status: 'Đã cọc + thanh toán 1 phần',\n    payment_count: 2,\n    deposit_count: 1,\n    collect_count: 1,\n  })\n  await assertSucceeds(batch.commit())\n})\n\ntest('payment create phải ghi child và summary parent trong cùng batch', async () => {`,
  'cashier second payment regression',
)
write('tests/order-relations.rules.test.mjs', ruleTests)

let clientTests = read('tests/order-relations.client.test.mjs')
clientTests = replaceOnce(
  clientTests,
  `  const orders = readFileSync('pages/orders.vue', 'utf8')\n`,
  `  const orders = readFileSync('pages/orders.vue', 'utf8')\n  const scopedQueries = readFileSync('composables/useScopedQueries.ts', 'utf8')\n`,
  'client test scoped source',
)
clientTests = replaceOnce(
  clientTests,
  `  assert.match(orders, /discount_amount/)\n`,
  `  assert.match(orders, /discount_amount/)\n  assert.match(orders, /loadScopedExportRequestsForOrders,\\s*loadScopedExportRequests,/)\n  assert.match(scopedQueries, /payments\\.create[\\s\\S]*fetchByFieldValues<PaymentDoc>\\('payments', 'order_id', orderIds\\)/)\n`,
  'client regression assertions',
)
write('tests/order-relations.client.test.mjs', clientTests)

unlinkSync('scripts/apply-dev-payment-order-edit-fix.mjs')
unlinkSync('.github/workflows/apply-dev-payment-order-edit-fix.yml')
