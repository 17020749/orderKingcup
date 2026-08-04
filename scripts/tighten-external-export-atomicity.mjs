import { readFileSync, writeFileSync, rmSync } from 'node:fs'

function replaceOnce(path, before, after, label) {
  const source = readFileSync(path, 'utf8')
  const count = source.split(before).length - 1
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`)
  writeFileSync(path, source.replace(before, after))
}

const rulesPath = 'firestore.rules'
const testPath = 'tests/external-export-release.rules.test.mjs'

const externalRuleMarker = `    function exportRequestExternalReleaseAllowed() {
      let operationId = request.resource.data.get('operation_id', '');`

const externalRuleReplacement = `    function exportRequestExternalOrderSummaryValid() {
      let orderId = resource.data.get('order_id', '');
      let path = orderPath(orderId);
      return orderId is string
        && orderId != ''
        && exists(path)
        && existsAfter(path)
        && getAfter(path).data.get('warehouse_request_status', '') == 'da_xuat'
        && getAfter(path).data.get('warehouse_fulfillment_status', '') in ['da_xuat_1_phan', 'da_xuat_du']
        && getAfter(path).data.get('updated_at', null) is timestamp
        && getAfter(path).data.get('updated_at', null) == request.time;
    }

    function exportRequestExternalReleaseAllowed() {
      let operationId = request.resource.data.get('operation_id', '');`

replaceOnce(rulesPath, externalRuleMarker, externalRuleReplacement, 'insert atomic order helper')

replaceOnce(
  rulesPath,
  `        && request.resource.data.get('external_exported', false) == true
        && exportDate is string`,
  `        && request.resource.data.get('external_exported', false) == true
        && request.resource.data.get('warehouse_note', '') is string
        && request.resource.data.get('warehouse_note', '').size() > 0
        && request.resource.data.get('warehouse_note', '').size() <= 2000
        && request.resource.data.get('actual_export_summary_json', '') is string
        && request.resource.data.get('request_timeline_json', '') is string
        && exportRequestExternalOrderSummaryValid()
        && exportDate is string`,
  'require reason and atomic order summary',
)

const appendTests = `

test('external release chỉ cập nhật request bị chặn để tránh lệch trạng thái đơn hàng', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'request-a'), externalPatch()))
})

test('external release cập nhật order sai trạng thái bị chặn', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch())
  batch.update(doc(db, 'orders', 'order-a'), {
    warehouse_fulfillment_status: 'cho_xu_ly',
    warehouse_request_status: 'da_tiep_nhan',
    updated_at: serverTimestamp(),
  })
  await assertFails(batch.commit())
})

test('external release bắt buộc có lý do xác nhận', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch({ warehouse_note: '' }))
  batch.update(doc(db, 'orders', 'order-a'), {
    warehouse_fulfillment_status: 'da_xuat_1_phan',
    warehouse_request_status: 'da_xuat',
    updated_at: serverTimestamp(),
  })
  await assertFails(batch.commit())
})`

const testSource = readFileSync(testPath, 'utf8')
if (!testSource.includes('external release chỉ cập nhật request bị chặn')) {
  writeFileSync(testPath, `${testSource.trimEnd()}${appendTests}\n`)
}

rmSync('scripts/tighten-external-export-atomicity.mjs')
rmSync('.github/workflows/tighten-external-export-atomicity.yml')
console.log('External export atomicity rules tightened.')
