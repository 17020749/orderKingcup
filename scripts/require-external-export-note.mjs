import { readFileSync, writeFileSync, rmSync } from 'node:fs'

const path = 'firestore.rules'
let source = readFileSync(path, 'utf8')
const search = `        && exportDate is string
        && exportDate.size() == 10
        && externalExportOrderId is string`
const replacement = `        && exportDate is string
        && exportDate.size() == 10
        && request.resource.data.get('warehouse_note', '') is string
        && request.resource.data.get('warehouse_note', '').size() >= 1
        && request.resource.data.get('warehouse_note', '').size() <= 2000
        && externalExportOrderId is string`

const first = source.indexOf(search)
if (first < 0) throw new Error('Không tìm thấy external export note insertion point.')
if (source.indexOf(search, first + search.length) >= 0) throw new Error('External export note insertion point xuất hiện nhiều lần.')
source = source.slice(0, first) + replacement + source.slice(first + search.length)
writeFileSync(path, source, 'utf8')

for (const file of [
  '.github/workflows/diagnose-external-export-record.yml',
  '.github/workflows/require-external-export-note.yml',
  'scripts/require-external-export-note.mjs',
]) rmSync(file, { force: true })

console.log('External export note rule added and diagnostics removed.')
