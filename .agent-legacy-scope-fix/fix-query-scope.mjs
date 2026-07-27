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
  'composables/useScopedQueries.ts',
  block(
    '    const prefix = `${code}-`',
    '    const [byStoredCode, byOrderCode] = await Promise.all([',
    "      fetchCollection<OrderDoc>('orders', [where('user_code', '==', code)]).catch(() => [] as OrderDoc[]),",
    "      fetchCollection<OrderDoc>('orders', [",
    "        where('order_code', '>=', prefix),",
    "        where('order_code', '<=', `${prefix}\\uf8ff`),",
    '      ]).catch(() => [] as OrderDoc[]),',
    '    ])',
    "    return sortNewest(uniqueById([...rows, ...byStoredCode, ...byOrderCode]).filter(isActive) as OrderDoc[], 'order_date')",
  ),
  block(
    "    const byStoredCode = await fetchCollection<OrderDoc>('orders', [where('user_code', '==', code)])",
    '      .catch(() => [] as OrderDoc[])',
    "    return sortNewest(uniqueById([...rows, ...byStoredCode]).filter(isActive) as OrderDoc[], 'order_date')",
  ),
)

const testPath = 'tests/order-legacy-missing-identity.rules.test.mjs'
let source = await readFile(testPath, 'utf8')
source = source.replace('  collection,\n', '')
source = source.replace('  getDocs,\n', '')
source = source.replace('  query,\n', '')
source = source.replace('  where,\n', '')
const beforeTest = block(
  "test('Sale query được order legacy theo tiền tố order_code nhưng Sale khác không đọc được', async () => {",
  '  const saleDb = env.authenticatedContext(SALE, { email: SALE }).firestore()',
  '  const saleRows = await assertSucceeds(getDocs(query(',
  "    collection(saleDb, 'orders'),",
  "    where('order_code', '>=', 'SALE01-'),",
  "    where('order_code', '<=', 'SALE01-\\uf8ff'),",
  '  )))',
  '  assert.equal(saleRows.size, 1)',
  '',
  '  const otherDb = env.authenticatedContext(OTHER_SALE, { email: OTHER_SALE }).firestore()',
  '  await assertFails(getDocs(query(',
  "    collection(otherDb, 'orders'),",
  "    where('order_code', '>=', 'SALE01-'),",
  "    where('order_code', '<=', 'SALE01-\\uf8ff'),",
  '  )))',
  '})',
)
const afterTest = block(
  "test('Sale direct get được order legacy theo tiền tố order_code nhưng Sale khác bị chặn', async () => {",
  '  const saleDb = env.authenticatedContext(SALE, { email: SALE }).firestore()',
  "  await assertSucceeds(getDoc(doc(saleDb, 'orders', ORDER_ID)))",
  '',
  '  const otherDb = env.authenticatedContext(OTHER_SALE, { email: OTHER_SALE }).firestore()',
  "  await assertFails(getDoc(doc(otherDb, 'orders', ORDER_ID)))",
  '})',
)
const count = source.split(beforeTest).length - 1
if (count !== 1) throw new Error(`legacy scope query test: expected one match, found ${count}`)
await writeFile(testPath, source.replace(beforeTest, afterTest))

console.log('Unsupported legacy prefix list query removed.')
