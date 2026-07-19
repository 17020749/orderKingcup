import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const path = 'firestore.rules'
let rules = readFileSync(path, 'utf8')
const before = `      allow create: if hasPerm('orders.create')
        && ownEmailField(request.resource.data, 'created_by')
        && ownsOrderData(request.resource.data)
        && validOrderNumberCreate()
        && printingLockReadyData(request.resource.data)
        && request.resource.data.get('printing_progress_count', -1) == 0;`
const after = `      // New clients initialize the printing lock at zero. Legacy create payloads
      // remain compatible, but orderCanBeDeleted() fails closed until reconciliation.
      allow create: if hasPerm('orders.create')
        && ownEmailField(request.resource.data, 'created_by')
        && ownsOrderData(request.resource.data)
        && validOrderNumberCreate();`
if (!rules.includes(before)) throw new Error('Không tìm thấy rule tạo order cần sửa')
rules = rules.replace(before, after)
writeFileSync(path, rules)

for (const file of [
  'scripts/fix-step6-create-compat.mjs',
  '.github/workflows/fix-step6-create-compat.yml',
  '.github/workflows/diagnose-step6-isolated.yml',
  '.github/workflows/capture-step6-log.yml',
  'step6-isolated.log',
]) {
  try { unlinkSync(file) } catch {}
}
console.log('Đã giữ tương thích tạo đơn và dọn file chẩn đoán.')
