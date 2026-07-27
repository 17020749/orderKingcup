import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  buildBackfillInvoice,
  buildBackfillOrderPatch,
  normalizeBackfillInvoiceStatus,
  planOrderInvoiceBackfill,
} from '../utils/orderInvoiceBackfill.mjs'
import { validateAccountingInvoice } from '../utils/orderInvoiceFlow.mjs'

function order(overrides = {}) {
  return {
    id: 'order-legacy',
    order_code: 'SALE1-ABC001-0001',
    owner_email: 'sale@example.com',
    created_by: 'sale@example.com',
    sale_email: 'sale@example.com',
    payable_amount: 125000,
    invoice_status: 'HĐ nháp',
    active: true,
    deleted: false,
    status: 'active',
    ...overrides,
  }
}

function invoice(overrides = {}) {
  return {
    id: 'inv_order-covered',
    order_id: 'order-covered',
    invoice_status: 'Không xuất',
    active: true,
    deleted: false,
    status: 'active',
    ...overrides,
  }
}

test('trang kế toán chỉ còn kiểm tra trạng thái hóa đơn hợp lệ', () => {
  assert.equal(validateAccountingInvoice({ invoice_status: 'Đã xuất' }), '')
  assert.equal(validateAccountingInvoice({ invoice_status: 'Đã xuất', invoice_amount: -1 }), '')
  assert.equal(validateAccountingInvoice({ invoice_status: 'Yêu cầu xuất', invoice_number: '', invoice_date: '' }), '')
  assert.match(validateAccountingInvoice({ invoice_status: 'Sai trạng thái' }), /không hợp lệ/)
})

test('lập kế hoạch chỉ chọn order đang hoạt động và chưa có invoice', () => {
  const orders = [
    order(),
    order({ id: 'order-covered' }),
    order({ id: 'order-duplicate' }),
    order({ id: 'order-conflict' }),
    order({ id: 'order-deleted', deleted: true, active: false }),
  ]
  const invoices = [
    invoice(),
    invoice({ id: 'inv-dup-a', order_id: 'order-duplicate' }),
    invoice({ id: 'inv-dup-b', order_id: 'order-duplicate' }),
    invoice({ id: 'inv_order-conflict', order_id: 'other-order', active: false, deleted: true, status: 'deleted' }),
  ]

  const plan = planOrderInvoiceBackfill({ orders, invoices })
  assert.deepEqual(plan.candidates.map(item => item.orderId), ['order-legacy'])
  assert.deepEqual(plan.alreadyCovered, [{ orderId: 'order-covered', invoiceId: 'inv_order-covered' }])
  assert.equal(plan.duplicateOrders.length, 1)
  assert.equal(plan.idConflicts.length, 1)
})

test('invoice backfill chuẩn hóa legacy và order patch khởi tạo relation lock đầy đủ', () => {
  const now = new Date('2026-07-27T10:00:00.000Z')
  const legacyOrder = order({
    payment_relation_revision: undefined,
    shipment_relation_revision: undefined,
  })
  const createdInvoice = buildBackfillInvoice({
    order: legacyOrder,
    actor: 'MIGRATION@EXAMPLE.COM',
    now,
  })
  assert.equal(createdInvoice.id, 'inv_order-legacy')
  assert.equal(createdInvoice.invoice_status, 'Yêu cầu xuất')
  assert.equal(createdInvoice.invoice_amount, 125000)
  assert.equal(createdInvoice.created_by, 'migration@example.com')
  assert.equal(createdInvoice.relation_revision, 1)

  const patch = buildBackfillOrderPatch({
    order: legacyOrder,
    invoice: createdInvoice,
    payments: [{ id: 'pay-1', active: true, deleted: false }],
    shipments: [{ id: 'ship-deleted', active: false, deleted: true }],
    actor: 'MIGRATION@EXAMPLE.COM',
    now,
  })
  assert.equal(patch.relation_lock_version, 1)
  assert.equal(patch.payment_record_count, 1)
  assert.equal(patch.invoice_record_count, 1)
  assert.equal(patch.shipment_record_count, 0)
  assert.equal(patch.payment_relation_revision, 0)
  assert.equal(patch.invoice_relation_revision, 1)
  assert.equal(patch.shipment_relation_revision, 0)
  assert.equal(patch.relation_last_action, 'create')
})

test('trạng thái không nhận diện được mặc định về Không xuất', () => {
  assert.equal(normalizeBackfillInvoiceStatus('Khách lẻ'), 'Không xuất')
  assert.equal(normalizeBackfillInvoiceStatus('HĐ nháp'), 'Yêu cầu xuất')
  assert.equal(normalizeBackfillInvoiceStatus('Đã xuất'), 'Đã xuất')
  assert.equal(normalizeBackfillInvoiceStatus('trạng thái cũ lạ'), 'Không xuất')
})

test('source hỗ trợ lazy create qua runtime planner và migration chạy dry-run mặc định', () => {
  const orders = readFileSync('pages/orders.vue', 'utf8')
  const flow = readFileSync('utils/orderInvoiceFlow.mjs', 'utf8')
  const atomic = readFileSync('composables/useAtomicOrderSave.ts', 'utf8')
  const rules = readFileSync('firestore.rules', 'utf8')
  const migration = readFileSync('scripts/backfill-order-invoices.mjs', 'utf8')

  assert.match(orders, /planOrderEditInvoiceMutation/)
  assert.match(flow, /mode: 'legacy_create'/)
  assert.match(atomic, /'legacy_create'/)
  assert.match(rules, /legacyInvoiceCreateFromExistingOrderAllowed/)
  assert.match(rules, /orderLegacyInvoiceCreateAllowed/)
  assert.match(migration, /Dry-run only/)
  assert.match(migration, /--confirm-project=/)

  const syntax = spawnSync(process.execPath, ['--check', 'scripts/backfill-order-invoices.mjs'], { encoding: 'utf8' })
  assert.equal(syntax.status, 0, syntax.stderr)
})
