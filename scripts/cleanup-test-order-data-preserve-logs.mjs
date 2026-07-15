#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

// Safety adapter for the one-time cleanup task.
// Operational documents and inventory rebuild stay in one atomic Firestore
// commit. Historical activity_logs are deliberately preserved because they
// are not part of stock consistency and can make the atomic write exceed the
// safe limit.

const sourcePath = fileURLToPath(new URL('./cleanup-test-order-data.mjs', import.meta.url))
const temporaryPath = join(tmpdir(), `cleanup-test-order-data-${process.pid}-${Date.now()}.mjs`)

const activityLogCollectionLine = '    activity_logs: plan.selectedActivityLogs,\n'
const summaryAnchor = '    inventory_balances_rebuild: plan.balanceRebuilds.length,\n'
const backupAnchor = '    selected_documents: selected,\n'

let source = readFileSync(sourcePath, 'utf8')

if (!source.includes(activityLogCollectionLine)) {
  throw new Error('Không tìm thấy điểm vá activity_logs trong cleanup-test-order-data.mjs. Dừng để tránh chạy sai phiên bản.')
}
if (!source.includes(summaryAnchor)) {
  throw new Error('Không tìm thấy điểm vá summary trong cleanup-test-order-data.mjs. Dừng để tránh chạy sai phiên bản.')
}
if (!source.includes(backupAnchor)) {
  throw new Error('Không tìm thấy điểm vá backup trong cleanup-test-order-data.mjs. Dừng để tránh chạy sai phiên bản.')
}

source = source.replace(activityLogCollectionLine, '')
source = source.replace(
  summaryAnchor,
  `    activity_logs_preserved: plan.selectedActivityLogs.length,\n${summaryAnchor}`,
)
source = source.replace(
  backupAnchor,
  `${backupAnchor}    preserved_activity_logs: plan.selectedActivityLogs.map(row => row.raw),\n`,
)

writeFileSync(temporaryPath, source, 'utf8')

try {
  const result = spawnSync(process.execPath, [temporaryPath, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })

  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  try {
    rmSync(temporaryPath, { force: true })
  } catch {
    // The operating system will eventually clear its temporary directory.
  }
}
