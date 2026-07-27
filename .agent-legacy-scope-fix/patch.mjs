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
  'pages/orders.vue',
  block(
    '    record: row,',
    "    currentUserEmail: appUser.value?.email || '',",
    '    businessAllowed: !blocker,',
  ),
  block(
    '    record: row,',
    "    currentUserEmail: appUser.value?.email || '',",
    "    currentUserCode: appUser.value?.user_code || '',",
    '    allowLegacyOrderCodeOwnership: true,',
    '    businessAllowed: !blocker,',
  ),
)

await replaceOnce(
  'composables/useAtomicOrderSave.ts',
  block(
    '          record: { ...existingOrder, id: input.orderId },',
    '          currentUserEmail: actor,',
    '        })',
  ),
  block(
    '          record: { ...existingOrder, id: input.orderId },',
    '          currentUserEmail: actor,',
    "          currentUserCode: appUser.value?.user_code || '',",
    '          allowLegacyOrderCodeOwnership: true,',
    '        })',
  ),
)

await replaceOnce(
  'composables/useScopedQueries.ts',
  block(
    '  function email() {',
    "    return String(appUser.value?.email || '').trim().toLowerCase()",
    '  }',
  ),
  block(
    '  function email() {',
    "    return String(appUser.value?.email || '').trim().toLowerCase()",
    '  }',
    '',
    '  function userCode() {',
    "    const code = String(appUser.value?.user_code || '').trim().toUpperCase()",
    "    return /^[A-Z0-9]{1,12}$/.test(code) ? code : ''",
    '  }',
  ),
)

await replaceOnce(
  'composables/useScopedQueries.ts',
  block(
    "    const rows = await listByEmailFields<OrderDoc>('orders', ['owner_email', 'created_by', 'sale_email'], force, 20_000)",
    "    return sortNewest(rows, 'order_date')",
  ),
  block(
    "    const rows = await listByEmailFields<OrderDoc>('orders', ['owner_email', 'created_by', 'sale_email'], force, 20_000)",
    '    const code = userCode()',
    '    if (!code) return sortNewest(rows, \'order_date\')',
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
)

await replaceOnce(
  'firestore.rules',
  block(
    '    function ownsOrderData(data) {',
    "      return ownEmailField(data, 'owner_email')",
    "        || ownEmailField(data, 'created_by')",
    "        || ownEmailField(data, 'sale_email');",
    '    }',
  ),
  block(
    '    function currentUserCode() {',
    "      let code = get(userPath()).data.get('user_code', '');",
    '      return code is string && code.matches(\'^[A-Z0-9]{1,12}$\') ? code : \"\";',
    '    }',
    '',
    '    function ownsLegacyOrderByUserCode(data) {',
    '      let code = currentUserCode();',
    "      let storedCode = data.get('user_code', '');",
    "      let orderCode = data.get('order_code', '');",
    '      return code != \"\"',
    '        && storedCode is string',
    '        && orderCode is string',
    '        && (',
    '          storedCode.lower() == code.lower()',
    '          || (',
    '            storedCode == \"\"',
    "            && orderCode.matches('^' + code + '-.*')",
    '          )',
    '        );',
    '    }',
    '',
    '    function ownsOrderData(data) {',
    "      return ownEmailField(data, 'owner_email')",
    "        || ownEmailField(data, 'created_by')",
    "        || ownEmailField(data, 'sale_email')",
    '        || ownsLegacyOrderByUserCode(data);',
    '    }',
  ),
)

const rulesTestPath = 'tests/order-legacy-missing-identity.rules.test.mjs'
let rulesTest = await readFile(rulesTestPath, 'utf8')
rulesTest = rulesTest.replace(
  block(
    '  doc,',
    '  getDoc,',
    '  serverTimestamp,',
    '  setDoc,',
    '  writeBatch,',
  ),
  block(
    '  collection,',
    '  doc,',
    '  getDoc,',
    '  getDocs,',
    '  query,',
    '  serverTimestamp,',
    '  setDoc,',
    '  where,',
    '  writeBatch,',
  ),
)
rulesTest = rulesTest.replace(
  block(
    '    owner_email: SALE,',
    '    created_by: SALE,',
    '    sale_email: SALE,',
  ),
  block(
    "    owner_email: '',",
    "    created_by: '',",
    "    sale_email: '',",
  ),
)
rulesTest = rulesTest.replace(
  "    order_owner_email: SALE,\n    order_created_by: SALE,\n    order_sale_email: SALE,",
  "    order_owner_email: '',\n    order_created_by: '',\n    order_sale_email: '',",
)
rulesTest = rulesTest.replace(
  "test('Sale sở hữu order cũ thiếu invoice và thiếu identity field vẫn sửa + tạo invoice nguyên tử', async () => {",
  "test('Sale được nhận scope legacy bằng tiền tố order_code dù ownership email trống', async () => {",
)
rulesTest = rulesTest.replace(
  block(
    "  assert.equal(invoice.created_by, SALE)",
    "  for (const field of ['order_sequence', 'user_code', 'customer_code', 'created_at']) {",
  ),
  block(
    "  assert.equal(invoice.created_by, SALE)",
    "  assert.equal(order.owner_email, '')",
    "  assert.equal(order.created_by, '')",
    "  assert.equal(order.sale_email, '')",
    "  for (const field of ['order_sequence', 'user_code', 'customer_code', 'created_at']) {",
  ),
)
rulesTest += block(
  '',
  '',
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
  '',
)
await writeFile(rulesTestPath, rulesTest)

const clientTestPath = 'tests/invoice-order-repair-permissions.client.test.mjs'
let clientTest = await readFile(clientTestPath, 'utf8')
clientTest = clientTest.replace(
  "import { preservePersistedOrderIdentityForEdit } from '../utils/orderAtomicSave.mjs'",
  "import { preservePersistedOrderIdentityForEdit } from '../utils/orderAtomicSave.mjs'\nimport { moduleActionDecision } from '../utils/permissionDecisions.mjs'",
)
clientTest = clientTest.replace(
  block(
    "    owner_email: 'hieunt051999@gmail.com',",
    "    created_by: 'hieunt051999@gmail.com',",
    "    sale_email: 'hieunt051999@gmail.com',",
  ),
  block(
    "    owner_email: '',",
    "    created_by: '',",
    "    sale_email: '',",
  ),
)
clientTest = clientTest.replace(
  block(
    '  assert.equal(payload.owner_email, persistedOrder.owner_email)',
    '  assert.equal(payload.created_by, persistedOrder.created_by)',
    '  assert.equal(payload.sale_email, persistedOrder.sale_email)',
  ),
  block(
    '  assert.equal(payload.owner_email, persistedOrder.owner_email)',
    '  assert.equal(payload.created_by, persistedOrder.created_by)',
    '  assert.equal(payload.sale_email, persistedOrder.sale_email)',
  ),
)
const insertionPoint = "test('orders.vue dùng runtime planner thay vì tự dựng nhánh legacy bằng source rời rạc', () => {"
clientTest = clientTest.replace(
  insertionPoint,
  block(
    "test('client nhận ownership legacy bằng user_code hoặc tiền tố order_code, không nhận order Sale khác', () => {",
    '  const permissions = [\'orders.edit\']',
    '  const owned = moduleActionDecision({',
    "    actionPermission: 'orders.edit',",
    "    viewAllPermission: 'orders.view_all',",
    '    permissions,',
    "    record: { order_code: 'SALE01-ABC001-0001', owner_email: '', created_by: '', sale_email: '' },",
    "    currentUserEmail: 'hieunt051999@gmail.com',",
    "    currentUserCode: 'SALE01',",
    '    allowLegacyOrderCodeOwnership: true,',
    '  })',
    '  assert.equal(owned.allowed, true)',
    '  assert.equal(owned.ownsRecord, true)',
    '',
    '  const foreign = moduleActionDecision({',
    "    actionPermission: 'orders.edit',",
    "    viewAllPermission: 'orders.view_all',",
    '    permissions,',
    "    record: { order_code: 'SALE01-ABC001-0001', owner_email: '', created_by: '', sale_email: '' },",
    "    currentUserEmail: 'other-sale@example.com',",
    "    currentUserCode: 'SALE02',",
    '    allowLegacyOrderCodeOwnership: true,',
    '  })',
    '  assert.equal(foreign.allowed, false)',
    "  assert.equal(foreign.code, 'missing_scope')",
    '})',
    '',
    insertionPoint,
  ),
)
await writeFile(clientTestPath, clientTest)

console.log('Legacy ownership scope patch applied.')
