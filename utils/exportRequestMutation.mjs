export const EXPORT_REQUEST_ACTIONS = Object.freeze([
  'create',
  'update',
  'delete',
  'accept',
  'reject',
  'warehouse_export',
  'warehouse_export_cancel',
])

export function exportRequestRevisionOf(order) {
  const revision = Math.trunc(Number(order?.export_request_revision || 0))
  return Number.isFinite(revision) && revision >= 0 ? revision : 0
}

export function buildExportRequestOrderMarker(order, input) {
  const action = String(input?.action || '').trim()
  const requestId = String(input?.requestId || '').trim()
  const actor = String(input?.actor || '').trim().toLowerCase()
  if (!EXPORT_REQUEST_ACTIONS.includes(action)) {
    throw new Error(`Unsupported export request action: ${action || '(empty)'}`)
  }
  if (!requestId) throw new Error('Export request marker requires requestId.')
  if (!actor) throw new Error('Export request marker requires actor.')

  return {
    export_request_revision: exportRequestRevisionOf(order) + 1,
    export_request_last_action: action,
    export_request_last_request_id: requestId,
    export_request_updated_by: actor,
    export_request_updated_at: input.updatedAt,
  }
}
