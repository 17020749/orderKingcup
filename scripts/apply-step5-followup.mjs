import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const path = 'tests/order-atomic-save.rules.test.mjs'
let source = readFileSync(path, 'utf8')
const before = `  await runTransaction(db, async transaction => {
    await transaction.get(orderRef)
    const sequenceSnapshot = await transaction.get(sequenceRef)
    assert.equal(sequenceSnapshot.exists(), false)
`
const after = `  await runTransaction(db, async transaction => {
    const sequenceSnapshot = await transaction.get(sequenceRef)
    assert.equal(sequenceSnapshot.exists(), false)
`
if (!source.includes(before)) throw new Error('Không tìm thấy đoạn transaction create cần sửa')
source = source.replace(before, after)
writeFileSync(path, source)

unlinkSync('scripts/apply-step5-followup.mjs')
unlinkSync('.github/workflows/apply-step5-followup.yml')
console.log('Đã sửa test atomic create và xóa workflow một lần.')
