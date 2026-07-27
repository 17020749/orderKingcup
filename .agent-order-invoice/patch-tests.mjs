import { readFile, writeFile } from 'node:fs/promises'

const block = (...lines) => lines.join('\n')

async function replaceOnce(path, before, after) {
  const source = await readFile(path, 'utf8')
  const count = source.split(before).length - 1
  if (count !== 1) throw new Error(`${path}: expected exactly one guarded match, found ${count}`)
  await writeFile(path, source.replace(before, after))
}

await replaceOnce(
  'package.json',
  'tests/order-atomic-save.rules.test.mjs tests/order-item-dependencies.client.test.mjs',
  'tests/order-atomic-save.rules.test.mjs tests/order-invoice-flow.client.test.mjs tests/order-invoice-flow.rules.test.mjs tests/order-item-dependencies.client.test.mjs',
)

await replaceOnce(
  'tests/order-atomic-save.client.test.mjs',
  block(
    '    nextItems: [{ id: \'a\' }, { id: \'b\' }],',
    '  }), 5) // sequence + order + activity + 2 items',
  ),
  block(
    '    nextItems: [{ id: \'a\' }, { id: \'b\' }],',
    '  }), 6) // sequence + order + invoice + activity + 2 items',
  ),
)

await replaceOnce(
  'tests/order-relations.client.test.mjs',
  block(
    '  assert.match(orderRelationDeleteBlocker({',
    '    ...readyOrder,',
    '    payment_record_count: 2,',
    '    invoice_record_count: 1,',
    '    shipment_record_count: 1,',
    '  }), /2 phiếu thanh toán, 1 hóa đơn, 1 bản ghi vận chuyển/)',
  ),
  block(
    '  assert.match(orderRelationDeleteBlocker({',
    '    ...readyOrder,',
    '    payment_record_count: 2,',
    '    invoice_record_count: 1,',
    '    shipment_record_count: 1,',
    '  }), /2 phiếu thanh toán, 1 bản ghi vận chuyển/)',
    '  assert.equal(orderRelationDeleteBlocker({',
    '    ...readyOrder,',
    '    invoice_record_count: 1,',
    '  }), \'\')',
  ),
)

await replaceOnce(
  'tests/order-relations.client.test.mjs',
  block(
    '  assert.doesNotMatch(orders, /v-model="form\\.invoice_status"/)',
    "  assert.match(orders, /invoice_status: 'Không xuất'/)",
    '  assert.match(invoices, /availableOrders/)',
    '  assert.match(invoices, /invoice_record_count/)',
  ),
  block(
    '  assert.match(orders, /v-model="form\\.invoice_status"/)',
    '  assert.match(orders, /invoiceStatusLocked/)',
    '  assert.doesNotMatch(invoices, /availableOrders/)',
    '  assert.doesNotMatch(invoices, /\\+ Thêm hóa đơn/)',
  ),
)

await replaceOnce(
  'tests/order-relations.rules.test.mjs',
  block(
    "  updateBatch.update(doc(db, 'invoices', 'inv-a'), {",
    "    invoice_status: 'HĐ nháp',",
    "    updated_at: 'now-2',",
    '  })',
    "  updateBatch.update(doc(db, 'orders', 'order-a'), {",
    "    ...relationMeta('invoices', 'update', 'inv-a'),",
    '    invoice_record_count: 1,',
    '    invoice_relation_revision: 2,',
    "    invoice_status: 'HĐ nháp',",
    '  })',
  ),
  block(
    "  updateBatch.update(doc(db, 'invoices', 'inv-a'), {",
    "    invoice_status: 'Yêu cầu xuất',",
    '    relation_revision: 2,',
    "    updated_at: 'now-2',",
    '  })',
    "  updateBatch.update(doc(db, 'orders', 'order-a'), {",
    "    ...relationMeta('invoices', 'update', 'inv-a'),",
    '    invoice_record_count: 1,',
    '    invoice_relation_revision: 2,',
    "    invoice_status: 'Yêu cầu xuất',",
    '  })',
  ),
)

console.log('Guarded regression test patch applied.')
