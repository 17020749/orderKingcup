import {
  exportRequestSortValue,
  exportRequestWindowState,
} from './exportRequestWindow.mjs'

function clean(value) {
  return String(value || '').trim()
}

export function buildExportRequestBackfillPatch(request, order = {}) {
  const patch = {}
  const expectedWindow = exportRequestWindowState(request)
  if (clean(request?.window_state) !== expectedWindow) {
    patch.window_state = expectedWindow
  }

  const sortAt = exportRequestSortValue(request) || request?.__create_time
  if (!request?.sort_at && sortAt) patch.sort_at = sortAt

  const ownership = {
    requested_by: clean(order?.sale_email)
      || clean(order?.owner_email)
      || clean(order?.created_by),
    order_owner_email: clean(order?.owner_email),
    order_created_by: clean(order?.created_by),
    order_sale_email: clean(order?.sale_email),
  }
  for (const [field, fallback] of Object.entries(ownership)) {
    if (!clean(request?.[field]) && fallback) patch[field] = fallback
  }

  return patch
}
