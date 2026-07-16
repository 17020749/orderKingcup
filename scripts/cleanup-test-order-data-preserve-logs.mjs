#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

// Safety adapter for the one-time cleanup task.
// By default, historical activity_logs are preserved. They are included in
// the same atomic cleanup only when the caller explicitly passes
// --delete-activity-logs.

const sourcePath = fileURLToPath(new URL('./cleanup-test-order-data.mjs', import.meta.url))
const temporaryPath = join(tmpdir(), `cleanup-test-order-data-${process.pid}-${Date.now()}.mjs`)
const inputArgs = process.argv.slice(2)
const deleteActivityLogs = inputArgs.includes('--delete-activity-logs')
const forwardedArgs = inputArgs.filter(arg => arg !== '--delete-activity-logs')

const activityLogCollectionPattern = /^\s{4}activity_logs:\s*plan\.selectedActivityLogs,\s*$/m
const summaryPattern = /^(\s{4}inventory_balances_rebuild:\s*plan\.balanceRebuilds\.length,\s*)$/m
const backupPattern = /^(\s{4}selected_documents:\s*selected,\s*)$/m

function runCleanup(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })

  if (result.error) throw result.error
  return result.status ?? 1
}

if (deleteActivityLogs) {
  console.warn('CẢNH BÁO: activity_logs liên quan cũng sẽ được đưa vào kế hoạch xóa và file backup.')
  process.exitCode = runCleanup(sourcePath, forwardedArgs)
} else {
  let source = readFileSync(sourcePath, 'utf8')

  if (!activityLogCollectionPattern.test(source)) {
    throw new Error('Không tìm thấy điểm vá activity_logs trong cleanup-test-order-data.mjs. Dừng để tránh chạy sai phiên bản.')
  }
  if (!summaryPattern.test(source)) {
    throw new Error('Không tìm thấy điểm vá summary trong cleanup-test-order-data.mjs. Dừng để tránh chạy sai phiên bản.')
  }
  if (!backupPattern.test(source)) {
    throw new Error('Không tìm thấy điểm vá backup trong cleanup-test-order-data.mjs. Dừng để tránh chạy sai phiên bản.')
  }

  source = source.replace(activityLogCollectionPattern, '')
  source = source.replace(
    summaryPattern,
    '    activity_logs_preserved: plan.selectedActivityLogs.length,\n$1',
  )
  source = source.replace(
    backupPattern,
    '$1\n    preserved_activity_logs: plan.selectedActivityLogs.map(row => row.raw),',
  )

  writeFileSync(temporaryPath, source, 'utf8')

  try {
    process.exitCode = runCleanup(temporaryPath, forwardedArgs)
  } finally {
    try {
      rmSync(temporaryPath, { force: true })
    } catch {
      // The operating system will eventually clear its temporary directory.
    }
  }
}
