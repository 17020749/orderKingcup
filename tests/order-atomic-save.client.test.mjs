import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  FIRESTORE_WRITE_LIMIT,
  assertAtomicOrderWriteLimit,
  assertExpectedOrderRevision,
  assertOrderEditIdentityUnchanged,
  buildOrderItemLifecyclePatch,
  buildOrderPaymentSummaryForPayable,
  buildOrderOperationId,
  estimateAtomicOrderWrites,
  nextOrderRevision,
  planAtomicOrderItems,
} from '../utils/orderAtomicSave.mjs'

test('lập kế hoạch upsert và xóa mềm item trong cùng giao dịch', () => {
  const plan = planAtomicOrderItems(
    [
      { id: 'item-keep', product_code: 'SP-A' },
      { id: 'item-remove', product_code: 'SP-B' },
    ],
    [
      { id: 'item-keep', product_code: 'SP-A2' },
      { id: 'item-new', product_code: 'SP-C' },
    ],
  )

  assert.deepEqual(plan.upsertItems.map(item => [item.id, item.isNew]), [
    ['item-keep', false],
    ['item-new', true],
  ])
  assert.deepEqual(plan.unchangedItems, [])
  assert.deepEqual(plan.removedItems.map(item => item.id), ['item-remove'])
})

test('chỉ ghi item thực sự thay đổi khi sửa đơn nhiều sản phẩm', () => {
  const existingItems = Array.from({ length: 10 }, (_, index) => ({
    id: `item-${index}`,
    product_id: `product-${index}`,
    product_code: `SP-${index}`,
    product_name: `Sản phẩm ${index}`,
    unit: 'cái',
    quantity: index + 1,
    unit_price: 10,
    cost_price: 0,
    vat_rate: 0,
    line_total: (index + 1) * 10,
    line_cost: 0,
    line_profit: (index + 1) * 10,
    packing_standard: '',
    box_quantity: 0,
    odd_quantity: 0,
    logo_json: '',
    note: '',
    order_revision: 3,
    last_operation_id: 'old-operation',
  }))
  const nextItems = existingItems.map(item => ({
    ...item,
    ...(item.id === 'item-4' ? {
      quantity: 20,
      line_total: 200,
      line_profit: 200,
    } : {}),
  }))

  const plan = planAtomicOrderItems(existingItems, nextItems)
  assert.deepEqual(plan.upsertItems.map(item => item.id), ['item-4'])
  assert.equal(plan.unchangedItems.length, 9)
  assert.deepEqual(plan.removedItems, [])
  assert.equal(estimateAtomicOrderWrites({
    mode: 'edit',
    existingItems,
    nextItems,
  }), 3) // order + activity + 1 item thay đổi
})

test('so sánh item bỏ qua metadata transaction và chuẩn hóa logo JSON', () => {
  const plan = planAtomicOrderItems(
    [{
      id: 'item-a',
      product_code: 'SP-A',
      quantity: 1,
      logo_json: JSON.stringify([{ unit_price: 10, logo: 'A' }]),
      order_revision: 1,
      last_operation_id: 'operation-old',
    }],
    [{
      id: 'item-a',
      product_code: 'SP-A',
      quantity: '1',
      logo_json: JSON.stringify([{ logo: 'A', unit_price: 10 }]),
      order_revision: 2,
      last_operation_id: 'operation-new',
    }],
  )

  assert.equal(plan.upsertItems.length, 0)
  assert.deepEqual(plan.unchangedItems.map(item => item.id), ['item-a'])
})

test('item legacy không bị ghi lại chỉ vì calcItems sinh lại các field dẫn xuất', () => {
  const existingItems = Array.from({ length: 12 }, (_, index) => ({
    id: `legacy-${index}`,
    product_id: `product-${index}`,
    product_code: `LEG-${index}`,
    product_name: `Sản phẩm legacy ${index}`,
    unit: 'cái',
    quantity: index + 1,
    unit_price: 12.5,
    packing_standard: '',
    box_quantity: 0,
    odd_quantity: 0,
    note: '',
    logo_json: '',
    // Các field này không có trong form sửa đơn và có thể khác với calcItems().
    cost_price: 7.25,
    vat_rate: 8,
    line_total: 999 + index,
    line_cost: 123 + index,
    line_profit: 456 + index,
    order_revision: 1,
    last_operation_id: 'legacy-operation',
  }))
  const normalizedByForm = existingItems.map(item => ({
    id: item.id,
    product_id: item.product_id,
    product_code: item.product_code,
    product_name: item.product_name,
    unit: item.unit,
    quantity: item.quantity,
    unit_price: item.unit_price,
    packing_standard: item.packing_standard,
    box_quantity: item.box_quantity,
    odd_quantity: item.odd_quantity,
    note: item.note,
    logo_json: '',
    cost_price: 0,
    vat_rate: 10,
    line_total: item.quantity * item.unit_price,
    line_cost: 0,
    line_profit: item.quantity * item.unit_price,
  }))

  const unchangedPlan = planAtomicOrderItems(existingItems, normalizedByForm)
  assert.equal(unchangedPlan.upsertItems.length, 0)
  assert.equal(unchangedPlan.unchangedItems.length, 12)
  assert.equal(estimateAtomicOrderWrites({
    mode: 'edit',
    existingItems,
    nextItems: normalizedByForm,
  }), 2) // chỉ order + activity

  const editedItems = normalizedByForm.map(item => item.id === 'legacy-7'
    ? { ...item, unit_price: 20, line_total: item.quantity * 20, line_profit: item.quantity * 20 }
    : item)
  const editedPlan = planAtomicOrderItems(existingItems, editedItems)
  assert.deepEqual(editedPlan.upsertItems.map(item => item.id), ['legacy-7'])
  assert.equal(editedPlan.unchangedItems.length, 11)
})

test('item legacy đang tồn tại không bị tự thêm lifecycle khi Sale sửa đơn', () => {
  assert.deepEqual(buildOrderItemLifecyclePatch(false), {})
  assert.deepEqual(buildOrderItemLifecyclePatch(true), {
    status: 'active',
    active: true,
    deleted: false,
  })
})

test('chặn dòng sản phẩm thiếu ID hoặc trùng ID trước khi gọi Firestore', () => {
  assert.throws(
    () => planAtomicOrderItems([], [{ id: 'item-a' }, { id: 'item-a' }]),
    /thiếu ID hoặc bị trùng ID/,
  )
  assert.throws(
    () => planAtomicOrderItems([], [{ id: '' }]),
    /thiếu ID hoặc bị trùng ID/,
  )
})

test('tính đúng số write cho tạo và sửa đơn', () => {
  assert.equal(estimateAtomicOrderWrites({
    mode: 'create',
    existingItems: [],
    nextItems: [{ id: 'a' }, { id: 'b' }],
  }), 6) // sequence + order + invoice + activity + 2 items

  assert.equal(estimateAtomicOrderWrites({
    mode: 'edit',
    existingItems: [{ id: 'a' }, { id: 'remove' }],
    nextItems: [{ id: 'a' }, { id: 'new' }],
  }), 4) // order + activity + 1 item mới + 1 soft delete

  assert.equal(estimateAtomicOrderWrites({
    mode: 'edit',
    existingItems: [{ id: 'a' }, { id: 'remove' }],
    nextItems: [{ id: 'a' }, { id: 'new' }],
    invoiceSyncIds: ['invoice-a', 'invoice-b', 'invoice-a'],
  }), 6) // 4 write cơ bản + 2 hóa đơn active duy nhất

  assert.equal(estimateAtomicOrderWrites({
    mode: 'edit',
    existingItems: [{ id: 'a' }, { id: 'remove' }],
    nextItems: [{ id: 'a' }, { id: 'new' }],
    updateInvoiceStatus: true,
    invoiceMutationId: 'invoice-a',
    invoiceSyncIds: ['invoice-a', 'invoice-b'],
  }), 6) // hóa đơn đổi trạng thái không bị đếm hai lần
})

test('đồng bộ công nợ theo payable nhưng không thay đổi số tiền đã thu', () => {
  assert.deepEqual(buildOrderPaymentSummaryForPayable({ paid_amount: 0 }, 100.126), {
    debt_amount: 100.13,
    payment_status: 'Chưa thanh toán',
    computed_payment_status: 'Chưa thanh toán',
  })
  assert.equal(buildOrderPaymentSummaryForPayable({ paid_amount: 100 }, 100).payment_status, 'Đã thanh toán')
  assert.equal(buildOrderPaymentSummaryForPayable({ paid_amount: 120 }, 100).payment_status, 'Thanh toán thừa')
  assert.equal(buildOrderPaymentSummaryForPayable({ paid_amount: 20, deposit_count: 1 }, 100).payment_status, 'Đã cọc')
  assert.equal(buildOrderPaymentSummaryForPayable({ paid_amount: 20, collect_count: 1 }, 100).payment_status, 'Thanh toán một phần')
  assert.equal(buildOrderPaymentSummaryForPayable({ paid_amount: 20, deposit_count: 1, collect_count: 1 }, 100).payment_status, 'Đã cọc + thanh toán 1 phần')
})

test('chặn đổi khách hàng hoặc Sale phụ trách khi sửa đơn', () => {
  const persisted = { customer_id: 'customer-a', customer_code: 'A', sale_name: 'Sale A' }
  assert.doesNotThrow(() => assertOrderEditIdentityUnchanged({ ...persisted }, persisted))
  assert.throws(
    () => assertOrderEditIdentityUnchanged({ ...persisted, customer_id: 'customer-b' }, persisted),
    /customer_id/,
  )
  assert.throws(
    () => assertOrderEditIdentityUnchanged({ ...persisted, sale_name: 'Sale B' }, persisted),
    /sale_name/,
  )
})

test('chặn đơn vượt giới hạn write thay vì chia batch gây lưu dở dang', () => {
  const tooManyItems = Array.from({ length: FIRESTORE_WRITE_LIMIT }, (_, index) => ({ id: `item-${index}` }))
  assert.throws(
    () => assertAtomicOrderWriteLimit({ mode: 'create', existingItems: [], nextItems: tooManyItems }),
    /vượt giới hạn 500/,
  )
})

test('revision tăng đúng một lần và phát hiện form đã cũ', () => {
  assert.equal(nextOrderRevision(undefined), 1)
  assert.equal(nextOrderRevision(4), 5)
  assert.equal(assertExpectedOrderRevision(3, 3), 3)
  assert.throws(
    () => assertExpectedOrderRevision(3, 4),
    /đã được cập nhật ở một thiết bị hoặc phiên khác/,
  )
})

test('operation id ổn định theo tham số và không chứa ký tự không an toàn', () => {
  assert.equal(
    buildOrderOperationId('ord/ABC', 1_000, 0.25),
    'order_ordABC_rs_5cwg',
  )
})

test('client thực tế dùng một transaction cho order, items, sequence và activity', () => {
  const composable = readFileSync('composables/useAtomicOrderSave.ts', 'utf8')
  const page = readFileSync('pages/orders.vue', 'utf8')

  assert.match(composable, /await runTransaction\(db, async transaction =>/)
  assert.match(composable, /transaction\.set\(sequenceRef/)
  assert.match(composable, /transaction\.set\(orderRef/)
  assert.match(composable, /transaction\.set\(doc\(db, 'order_items'/)
  assert.match(composable, /transaction\.update\(doc\(db, 'order_items'/)
  assert.match(composable, /transaction\.set\(activityRef/)
  assert.match(composable, /assertExpectedOrderRevision/)
  assert.match(composable, /buildOrderItemLifecyclePatch\(item\.isNew\)/)
  assert.match(composable, /buildOrderPaymentSummaryForPayable\(existingOrder/)
  assert.match(composable, /const editableOrderPayload = withoutLegacyEmbeddedItems\([\s\S]*stripOrderEditSystemFields\(input\.orderPayload \|\| \{\}\)/)
  assert.match(composable, /delete clean\.items/)
  assert.match(composable, /before_json: JSON\.stringify\(withoutLegacyEmbeddedItems\(input\.activityBefore \|\| \{\}\)\)/)
  assert.match(composable, /after_json: JSON\.stringify\(\{\s*\.\.\.withoutLegacyEmbeddedItems\(finalOrderPayload\)/)
  assert.match(page, /saveOrderAtomic\(/)
  assert.doesNotMatch(page, /commitWriteChunks/)
  assert.doesNotMatch(page, /await orderBatch\.commit\(\)/)
})

test('sau commit client đọc lại order và order_items chuẩn trước khi cho sửa tiếp', () => {
  const page = readFileSync('pages/orders.vue', 'utf8')
  const scopedQueries = readFileSync('composables/useScopedQueries.ts', 'utf8')

  assert.match(scopedQueries, /async function loadPersistedOrder\(orderId: string\)/)
  assert.match(scopedQueries, /getDocFromServer\(doc\(db, 'orders', id\)\)/)
  assert.match(scopedQueries, /getDocsFromServer\(query\(/)
  assert.match(scopedQueries, /where\('order_id', '==', id\)/)

  const commitIndex = page.indexOf('await saveOrderAtomic({')
  const syncIndex = page.indexOf('await synchronizePersistedOrder(form.id)')
  const successIndex = page.indexOf("showToast(editing.value ? 'Đã cập nhật đơn hàng' : 'Đã thêm đơn hàng'")
  assert.ok(commitIndex >= 0)
  assert.ok(syncIndex > commitIndex)
  assert.ok(successIndex > syncIndex)
  assert.match(page, /commitSucceeded = true/)
  assert.match(page, /const paymentRows = toNumber\(\(order as any\)\.relation_lock_version\) === 1/)
  assert.match(page, /:disabled="Boolean\(editing\)"/)
  assert.match(page, /:readonly="Boolean\(editing\)"/)
  assert.doesNotMatch(page, /itemsByOrder\.value\[form\.id\]\s*=/)
  assert.doesNotMatch(page, /const localOrder\s*=/)
})

test('lỗi đồng bộ sau commit không bị báo thành lưu thất bại hoặc cho sửa row tạm', () => {
  const page = readFileSync('pages/orders.vue', 'utf8')

  assert.match(page, /markOrderSyncPending\(form\.id, true\)/)
  assert.match(page, /synchronized = await loadRows\(true\)/)
  assert.match(page, /commitSucceeded\s*\?\s*'Đơn đã được lưu\. Vui lòng làm mới dữ liệu trước khi sửa\.'/)
  assert.match(page, /return !isOrderSyncPending\(row\) && orderActionDecision\('edit', row\)\.allowed/)
  assert.match(page, /scopeSatisfied: editing\.value[\s\S]*orderActionDecision\('edit', editing\.value\)\.allowed/)
})
