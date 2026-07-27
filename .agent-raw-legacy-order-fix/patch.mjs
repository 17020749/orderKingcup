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
    '  assertAtomicOrderWriteLimit,',
    '  assertExpectedOrderRevision,',
    '  buildOrderOperationId,',
  ),
  block(
    '  assertAtomicOrderWriteLimit,',
    '  assertExpectedOrderRevision,',
    '  buildOrderItemLifecyclePatch,',
    '  buildOrderOperationId,',
  ),
)

await replaceOnce(
  'composables/useAtomicOrderSave.ts',
  block(
    "          status: 'active',",
    '          active: true,',
    '          deleted: false,',
    '          updated_at: serverTimestamp(),',
    '          ...(item.isNew ? { created_at: serverTimestamp() } : {}),',
  ),
  block(
    '          ...buildOrderItemLifecyclePatch(item.isNew),',
    '          updated_at: serverTimestamp(),',
    '          ...(item.isNew ? { created_at: serverTimestamp() } : {}),',
  ),
)

console.log('Raw legacy order item lifecycle patch applied.')
