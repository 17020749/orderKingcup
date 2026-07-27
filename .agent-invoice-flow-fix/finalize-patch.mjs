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
  'firestore.rules',
  block(
    "        && resource.data.get('invoice_record_count', 0) is int",
    "        && resource.data.get('invoice_record_count', 0) >= 0",
  ),
  "        && resource.data.get('invoice_record_count', 0) in [0, 1]",
)

await replaceOnce(
  'tests/order-relations.rules.test.mjs',
  block(
    "  updateBatch.update(doc(db, 'invoices', 'inv-a'), {",
    "    invoice_status: 'Yêu cầu xuất',",
    '    relation_revision: 2,',
    "    updated_at: 'now-2',",
  ),
  block(
    "  updateBatch.update(doc(db, 'invoices', 'inv-a'), {",
    "    invoice_status: 'Yêu cầu xuất',",
    '    relation_revision: 1,',
    "    updated_at: 'now-2',",
  ),
)

console.log('Invoice repair safeguards finalized.')
