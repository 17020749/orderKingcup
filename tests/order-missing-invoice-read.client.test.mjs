import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { shouldReadExistingInvoiceSnapshot } from '../utils/orderAtomicSave.mjs'

// Untouched legacy orders have no invoice document to authorize as a read.
test('untouched legacy order does not read a missing deterministic invoice', () => {
  const mutation = { mode: 'legacy_create', invoiceId: 'inv_order-legacy' }
  assert.equal(shouldReadExistingInvoiceSnapshot({
    mode: 'edit',
    invoiceMutation: mutation,
    persistedOrder: {},
  }), false)
  assert.equal(shouldReadExistingInvoiceSnapshot({
    mode: 'edit',
    invoiceMutation: mutation,
    persistedOrder: {
      invoice_record_count: 1,
      invoice_relation_revision: 7,
      relation_last_module: 'invoices',
      relation_last_action: 'create',
      relation_last_document_id: 'inv_order-legacy',
    },
  }), false)
})

test('existing invoice is still read for status update and soft-delete restore', () => {
  assert.equal(shouldReadExistingInvoiceSnapshot({
    mode: 'edit',
    invoiceMutation: { mode: 'status_update', invoiceId: 'invoice-active' },
  }), true)
  assert.equal(shouldReadExistingInvoiceSnapshot({
    mode: 'edit',
    invoiceMutation: { mode: 'legacy_create', invoiceId: 'inv_order-legacy' },
    persistedOrder: {
      relation_last_module: 'invoices',
      relation_last_action: 'delete',
      relation_last_document_id: 'inv_order-legacy',
    },
  }), true)
})

test('runtime no longer reads every edit invoice before knowing whether it exists', () => {
  const source = readFileSync('composables/useAtomicOrderSave.ts', 'utf8')
  assert.match(source, /shouldReadExistingInvoiceSnapshot\(\{/)
  assert.doesNotMatch(
    source,
    /const invoiceSnapshot = input\.mode === 'edit' && invoiceRef[\s\S]{0,100}transaction\.get\(invoiceRef\)/,
  )
})
