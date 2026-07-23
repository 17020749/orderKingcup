export const PERMISSION_DENIED_USER_MESSAGE = 'Bạn không có quyền thực hiện thao tác này.'

const listeners = new Set()

function clean(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function cleanList(values) {
  const source = Array.isArray(values) ? values : [values]
  return Array.from(new Set(source.map(value => clean(value)).filter(Boolean)))
}

export function normalizePermissionErrorEvent(input = {}) {
  const scopeSatisfied = input.scopeSatisfied === true
  return {
    occurredAt: input.occurredAt instanceof Date ? input.occurredAt : new Date(),
    module: clean(input.module, 'unknown'),
    operation: clean(input.operation, 'unknown'),
    stage: clean(input.stage, 'denied'),
    source: clean(input.source, 'client'),
    route: clean(input.route),
    recordId: clean(input.recordId ?? input.record, '(unknown)'),
    recordStatus: clean(input.recordStatus ?? input.status, '(unknown)'),
    firebaseCode: clean(input.firebaseCode ?? input.diagnosticCode),
    firebaseMessage: clean(input.firebaseMessage),
    errorType: clean(input.errorType),
    requiredPermissions: cleanList([
      ...(input.requiredPermissions || []),
      ...(input.actionPermissions || []),
      input.actionPermission,
      ...(scopeSatisfied ? [] : (input.scopePermissions || [])),
      scopeSatisfied ? '' : input.scopePermission,
    ]),
    missingPermissions: cleanList(input.missingPermissions || []),
    context: {
      ...(input.context && typeof input.context === 'object' ? input.context : {}),
      scope_satisfied: scopeSatisfied,
    },
    stack: clean(input.stack),
  }
}

export function subscribePermissionErrors(listener) {
  if (typeof listener !== 'function') return () => {}
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emitPermissionError(input = {}) {
  const event = normalizePermissionErrorEvent(input)
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      // Permission diagnostics must never interrupt the user's original action.
    }
  }
  return event
}

export function permissionDeniedUserMessage(input = {}) {
  emitPermissionError(input)
  return PERMISSION_DENIED_USER_MESSAGE
}
