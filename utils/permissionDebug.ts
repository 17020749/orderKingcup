type PermissionCheck = {
  name: string
  required?: string
  actual?: unknown
  passed: boolean
}

type PermissionDebugInput = {
  module: string
  action: string
  stage: string
  userEmail?: string
  documentId?: string
  checks?: PermissionCheck[]
  ownership?: Record<string, unknown>
  payload?: Record<string, unknown>
  error?: any
  note?: string
}

function safeValue(value: unknown): unknown {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(safeValue)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      if (/token|password|secret|api.?key|credential/i.test(key)) out[key] = '[REDACTED]'
      else if (key === 'payload_json' || key === 'request_timeline_json') out[key] = `[${String(item || '').length} ký tự]`
      else out[key] = safeValue(item)
    })
    return out
  }
  return String(value)
}

export function permissionDebug(input: PermissionDebugInput) {
  if (import.meta.server) return
  if (localStorage.getItem('kingcup.permission.debug') !== '1') return
  const time = new Date().toISOString()
  const title = `[KINGCUP_PERMISSION] ${input.module}.${input.action} / ${input.stage}`
  const method = input.error || input.stage === 'before_write' || input.stage === 'parent_check' ? 'group' : 'groupCollapsed'
  console[method](`${title} @ ${time}`)
  console.log('Tóm tắt', {
    module: input.module,
    action: input.action,
    stage: input.stage,
    user_email: input.userEmail || '(trống)',
    document_id: input.documentId || '(chưa có)',
    note: input.note || ''
  })
  if (input.checks?.length) console.table(input.checks)
  if (input.ownership) console.table([safeValue(input.ownership)])
  if (input.payload) console.log('Payload đã lọc', safeValue(input.payload))
  if (input.error) {
    console.error('Firebase error', {
      code: input.error?.code || '',
      name: input.error?.name || '',
      message: input.error?.message || String(input.error),
      stack: input.error?.stack || ''
    })
  }
  console.groupEnd()
}
