from pathlib import Path

page_path = Path('pages/orders.vue')
page = page_path.read_text(encoding='utf-8')
fieldset = '<fieldset :disabled="editingFulfilledOrder" style="border:0; padding:0; margin:0; min-width:0;">'
if page.count(fieldset) != 1:
    raise SystemExit('orders.vue: fulfilled fieldset marker mismatch')
before, after = page.split(fieldset, 1)
plain_invoice_field = '''        <div class="form-group">\n          <label>Hóa đơn</label>\n          <select v-model="form.invoice_status" class="select" :disabled="invoiceStatusLocked">'''
scoped_invoice_field = '''        <div v-if="!editingFulfilledOrder" class="form-group">\n          <label>Hóa đơn</label>\n          <select v-model="form.invoice_status" class="select" :disabled="invoiceStatusLocked">'''
if plain_invoice_field in after:
    after = after.replace(plain_invoice_field, scoped_invoice_field, 1)
elif scoped_invoice_field not in after:
    raise SystemExit('orders.vue: normal invoice field missing')
page_path.write_text(before + fieldset + after, encoding='utf-8')

rules_path = Path('firestore.rules')
rules = rules_path.read_text(encoding='utf-8')
fulfilled_guard = '''        && (\n          fulfillmentStatus() != 'da_xuat_du'\n          || fulfilledOrderInvoiceMutationFieldsAllowed()\n        )'''
plain_guard = "        && fulfillmentStatus() != 'da_xuat_du'"

delete_start = rules.index('    function orderCanBeDeleted() {')
delete_end = rules.index('    function exportRequestEditable()', delete_start)
delete_segment = rules[delete_start:delete_end]
if fulfilled_guard in delete_segment:
    delete_segment = delete_segment.replace(fulfilled_guard, plain_guard, 1)
elif plain_guard not in delete_segment:
    raise SystemExit('firestore.rules: delete fulfillment guard missing')
rules = rules[:delete_start] + delete_segment + rules[delete_end:]

legacy_start = rules.index('    function orderLegacyInvoiceCreateAllowed(orderId) {')
legacy_end = rules.index('    function invoiceOrderCascadeDeleteAllowed()', legacy_start)
legacy_segment = rules[legacy_start:legacy_end]
if fulfilled_guard not in legacy_segment:
    if plain_guard not in legacy_segment:
        raise SystemExit('firestore.rules: legacy invoice guard mismatch')
    legacy_segment = legacy_segment.replace(plain_guard, fulfilled_guard, 1)
rules = rules[:legacy_start] + legacy_segment + rules[legacy_end:]

sale_start = rules.index('    function orderSaleInvoiceStatusUpdateAllowed(orderId) {')
sale_end = rules.index('    function orderLegacyInvoiceCreateKeepsOtherSystemFields()', sale_start)
if fulfilled_guard not in rules[sale_start:sale_end]:
    raise SystemExit('firestore.rules: fulfilled Sale invoice update guard missing')
delete_start = rules.index('    function orderCanBeDeleted() {')
delete_end = rules.index('    function exportRequestEditable()', delete_start)
if fulfilled_guard in rules[delete_start:delete_end]:
    raise SystemExit('firestore.rules: fulfilled invoice exception leaked into delete guard')
rules_path.write_text(rules, encoding='utf-8')

client_path = Path('tests/order-fulfilled-metadata-edit.client.test.mjs')
client = client_path.read_text(encoding='utf-8')
client_append = r'''

test('fulfilled invoice exception is scoped away from delete lock and duplicate UI', () => {
  const fieldsetIndex = ordersPageSource.indexOf('<fieldset :disabled="editingFulfilledOrder"')
  assert.ok(fieldsetIndex > 0)
  const normalFields = ordersPageSource.slice(fieldsetIndex)
  assert.match(normalFields, /<div v-if="!editingFulfilledOrder" class="form-group">\s*<label>Hóa đơn<\/label>/)

  const deleteStart = firestoreRulesSource.indexOf('function orderCanBeDeleted()')
  const deleteEnd = firestoreRulesSource.indexOf('function exportRequestEditable()', deleteStart)
  const deleteRule = firestoreRulesSource.slice(deleteStart, deleteEnd)
  assert.match(deleteRule, /fulfillmentStatus\(\) != 'da_xuat_du'/)
  assert.doesNotMatch(deleteRule, /fulfilledOrderInvoiceMutationFieldsAllowed/)

  const legacyStart = firestoreRulesSource.indexOf('function orderLegacyInvoiceCreateAllowed(orderId)')
  const legacyEnd = firestoreRulesSource.indexOf('function invoiceOrderCascadeDeleteAllowed()', legacyStart)
  const legacyRule = firestoreRulesSource.slice(legacyStart, legacyEnd)
  assert.match(legacyRule, /fulfilledOrderInvoiceMutationFieldsAllowed\(\)/)
})
'''
if 'fulfilled invoice exception is scoped away from delete lock and duplicate UI' not in client:
    client_path.write_text(client.rstrip() + client_append + '\n', encoding='utf-8')

rules_test_path = Path('tests/order-export-delete-lock.rules.test.mjs')
rules_test = rules_test_path.read_text(encoding='utf-8')
helper = r'''

function fulfilledLegacyInvoiceCreateBatch(db) {
  const batch = writeBatch(db)
  const timestamp = serverTimestamp()
  const operationId = 'fulfilled-legacy-invoice:test'
  batch.set(doc(db, 'invoices', 'inv_order-delete'), {
    id: 'inv_order-delete',
    order_id: 'order-delete',
    order_code: 'SALE-ABC-0001',
    invoice_number: '',
    invoice_date: '',
    invoice_amount: 1000,
    invoice_status: 'Yêu cầu xuất',
    tax_code: '',
    company_name: '',
    billing_address: '',
    note: '',
    created_by: OWNER,
    order_owner_email: OWNER,
    order_created_by: OWNER,
    order_sale_email: OWNER,
    relation_revision: 1,
    last_operation_id: operationId,
    active: true,
    deleted: false,
    status: 'active',
    created_at: timestamp,
    updated_at: timestamp,
  })
  batch.update(doc(db, 'orders', 'order-delete'), {
    invoice_status: 'Yêu cầu xuất',
    invoice_record_count: 1,
    invoice_relation_revision: 1,
    relation_lock_version: 1,
    relation_last_module: 'invoices',
    relation_last_action: 'create',
    relation_last_document_id: 'inv_order-delete',
    relation_updated_by: OWNER,
    relation_updated_at: timestamp,
    revision: 5,
    last_operation_id: operationId,
    updated_at: timestamp,
  })
  return batch
}
'''
marker = "\nbefore(async () => {"
if 'function fulfilledLegacyInvoiceCreateBatch' not in rules_test:
    if marker not in rules_test:
        raise SystemExit('rules test: before marker missing')
    rules_test = rules_test.replace(marker, helper + marker, 1)
legacy_test = r'''

test('đơn legacy đã xuất đủ vẫn tạo invoice child khi Sale đổi trạng thái hóa đơn', async () => {
  await seed({
    order_status: 'Hoàn thành',
    warehouse_fulfillment_status: 'da_xuat_du',
    payable_amount: 1000,
    invoice_status: 'Không xuất',
    invoice_record_count: 0,
    invoice_relation_revision: 0,
    revision: 4,
  })
  const db = env.authenticatedContext(OWNER, { email: OWNER }).firestore()
  await assertSucceeds(fulfilledLegacyInvoiceCreateBatch(db).commit())
})
'''
insert_before = "\ntest('đơn đã xuất đủ vẫn bị khóa xóa'"
if 'đơn legacy đã xuất đủ vẫn tạo invoice child' not in rules_test:
    if insert_before not in rules_test:
        raise SystemExit('rules test: fulfilled delete test marker missing')
    rules_test = rules_test.replace(insert_before, legacy_test + insert_before, 1)
rules_test_path.write_text(rules_test, encoding='utf-8')
