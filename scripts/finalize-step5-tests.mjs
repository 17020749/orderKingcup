import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const testPath = 'tests/order-atomic-save.rules.test.mjs'
let testSource = readFileSync(testPath, 'utf8')
const before = `  assert.equal((await getDoc(doc(db, 'order_sequences', 'customer-create'))).data().last_number, 1)
  assert.equal((await getDoc(doc(db, 'activity_logs', 'activity-create'))).data().operation_id, 'operation-create')
})`
const after = `  assert.equal((await getDoc(doc(db, 'order_sequences', 'customer-create'))).data().last_number, 1)
  await env.withSecurityRulesDisabled(async context => {
    const adminDb = context.firestore()
    assert.equal((await getDoc(doc(adminDb, 'activity_logs', 'activity-create'))).data().operation_id, 'operation-create')
  })
})`
if (!testSource.includes(before)) throw new Error('Không tìm thấy assertion activity log cần sửa')
testSource = testSource.replace(before, after)
writeFileSync(testPath, testSource)

const packagePath = 'package.json'
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
pkg.scripts['test:rules'] = 'firebase emulators:exec --only firestore "node --test --test-concurrency=1 tests/order-code.test.mjs tests/firestore.rules.test.mjs tests/warehouse.transactions.test.mjs tests/warehouse-cost.rules.test.mjs tests/warehouse-lot-allocation.static.test.mjs tests/warehouse-client-payload.static.test.mjs tests/warehouse-export-client.runtime.test.mjs tests/permission-audit.client.test.mjs tests/authorization-source.client.test.mjs tests/permission-matrix.client.test.mjs tests/order-items-by-order.client.test.mjs tests/order-items-by-order.rules.test.mjs tests/order-atomic-save.client.test.mjs tests/order-atomic-save.rules.test.mjs tests/firebase-error-message.static.test.mjs tests/printing-owner.rules.test.mjs tests/printing-permission.static.test.mjs tests/customer-create-flow.test.mjs tests/export-print-permission.test.mjs"'
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)

for (const path of [
  '.github/workflows/diagnose-step5-pr.yml',
  'scripts/finalize-step5-tests.mjs',
  '.github/workflows/finalize-step5-tests.yml',
]) {
  try { unlinkSync(path) } catch {}
}
console.log('Đã sửa assertion, khôi phục full suite và dọn file chẩn đoán.')
