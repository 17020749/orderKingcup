import { readFile, writeFile } from 'node:fs/promises'

function block(...lines) {
  return lines.join('\n')
}

async function replaceOnce(path, before, after) {
  const source = await readFile(path, 'utf8')
  const count = source.split(before).length - 1
  if (count !== 1) throw new Error(`${path}: expected one guarded match, found ${count}`)
  await writeFile(path, source.replace(before, after))
}

await replaceOnce(
  'composables/useAtomicOrderSave.ts',
  block(
    '  buildOrderOperationId,',
    '  nextOrderRevision,',
    '  planAtomicOrderItems,',
  ),
  block(
    '  buildOrderOperationId,',
    '  nextOrderRevision,',
    '  planAtomicOrderItems,',
    '  resolveOrderOwnershipForSave,',
  ),
)

await replaceOnce(
  'composables/useAtomicOrderSave.ts',
  block(
    '      const existingOrder = orderSnapshot?.exists() ? orderSnapshot.data() : {}',
    "      if (input.mode === 'edit') {",
  ),
  block(
    '      const existingOrder = orderSnapshot?.exists() ? orderSnapshot.data() : {}',
    '      const effectiveOwnership = resolveOrderOwnershipForSave({',
    '        mode: input.mode,',
    '        persistedOrder: existingOrder,',
    '        requestedOwnership: {',
    '          ownerEmail: input.ownerEmail,',
    '          createdBy: input.createdBy,',
    '          saleEmail: input.saleEmail,',
    '        },',
    '      })',
    "      if (input.mode === 'edit') {",
  ),
)

await replaceOnce(
  'composables/useAtomicOrderSave.ts',
  block(
    '        customer_code: input.customerCode,',
    '        revision,',
  ),
  block(
    '        customer_code: input.customerCode,',
    '        owner_email: effectiveOwnership.ownerEmail,',
    '        created_by: effectiveOwnership.createdBy,',
    '        sale_email: effectiveOwnership.saleEmail,',
    '        revision,',
  ),
)

await replaceOnce(
  'composables/useAtomicOrderSave.ts',
  block(
    '          order_owner_email: normalizeEmail(input.ownerEmail),',
    '          order_created_by: normalizeEmail(input.createdBy),',
    '          order_sale_email: normalizeEmail(input.saleEmail),',
  ),
  block(
    '          order_owner_email: effectiveOwnership.ownerEmail,',
    '          order_created_by: effectiveOwnership.createdBy,',
    '          order_sale_email: effectiveOwnership.saleEmail,',
  ),
)

await replaceOnce(
  'composables/useAtomicOrderSave.ts',
  block(
    '          owner_email: input.ownerEmail,',
    '          sale_email: input.saleEmail,',
    '          created_by: input.createdBy,',
  ),
  block(
    '          owner_email: effectiveOwnership.ownerEmail,',
    '          sale_email: effectiveOwnership.saleEmail,',
    '          created_by: effectiveOwnership.createdBy,',
  ),
)

const packagePath = 'package.json'
const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
const testFile = 'tests/order-permission-scope-regression.client.test.mjs'
if (!pkg.scripts['test:rules'].includes(testFile)) {
  pkg.scripts['test:rules'] = pkg.scripts['test:rules'].replace(
    'tests/order-invoice-legacy-backfill.rules.test.mjs',
    `tests/order-invoice-legacy-backfill.rules.test.mjs ${testFile}`,
  )
}
await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)

console.log('Guarded order edit ownership patch applied.')
