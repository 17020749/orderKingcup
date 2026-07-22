const DEFAULT_OWNER_FIELDS = [
  'owner_email',
  'created_by',
  'sale_email',
  'requested_by',
  'order_owner_email',
  'order_created_by',
  'order_sale_email',
]

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function permissionSet(values) {
  return new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(Boolean))
}

function ownsDocument(document, currentUserEmail, ownerFields = DEFAULT_OWNER_FIELDS) {
  const email = normalizedEmail(currentUserEmail)
  if (!email || !document || typeof document !== 'object') return false
  return ownerFields.some(field => normalizedEmail(document[field]) === email)
}

function ownsRecordOrParent({ record, parent, currentUserEmail, ownerFields, parentOwnerFields }) {
  return ownsDocument(record, currentUserEmail, ownerFields)
    || ownsDocument(parent, currentUserEmail, parentOwnerFields)
}

function allowedDecision(ownsRecord, viaViewAll = false) {
  return {
    allowed: true,
    code: 'allowed',
    ownsRecord,
    viaViewAll,
    missingPermissions: [],
  }
}

function deniedDecision(code, ownsRecord, missingPermissions = []) {
  return {
    allowed: false,
    code,
    ownsRecord,
    viaViewAll: false,
    missingPermissions,
  }
}

export function moduleViewDecision({
  viewPermission,
  viewAllPermission,
  permissions,
  record,
  parent,
  currentUserEmail,
  ownerFields = DEFAULT_OWNER_FIELDS,
  parentOwnerFields = DEFAULT_OWNER_FIELDS,
}) {
  const grants = permissionSet(permissions)
  const admin = grants.has('*')
  const ownsRecord = ownsRecordOrParent({
    record,
    parent,
    currentUserEmail,
    ownerFields,
    parentOwnerFields,
  })
  const canViewAll = admin || Boolean(viewAllPermission && grants.has(viewAllPermission))
  if (canViewAll) return allowedDecision(ownsRecord, !admin)
  if (!viewPermission || !grants.has(viewPermission)) {
    return deniedDecision('missing_view', ownsRecord, viewPermission ? [viewPermission] : [])
  }
  if (!ownsRecord) {
    return deniedDecision('missing_scope', false, viewAllPermission ? [viewAllPermission] : [])
  }
  return allowedDecision(true)
}

export function moduleActionDecision({
  actionPermission,
  viewAllPermission,
  permissions,
  record,
  parent,
  currentUserEmail,
  ownerFields = DEFAULT_OWNER_FIELDS,
  parentOwnerFields = DEFAULT_OWNER_FIELDS,
  businessAllowed = true,
  businessCode = 'business_constraint',
}) {
  const grants = permissionSet(permissions)
  const admin = grants.has('*')
  const ownsRecord = ownsRecordOrParent({
    record,
    parent,
    currentUserEmail,
    ownerFields,
    parentOwnerFields,
  })
  if (!admin && (!actionPermission || !grants.has(actionPermission))) {
    return deniedDecision('missing_action', ownsRecord, actionPermission ? [actionPermission] : [])
  }
  const canViewAll = admin || Boolean(viewAllPermission && grants.has(viewAllPermission))
  if (!ownsRecord && !canViewAll) {
    return deniedDecision('missing_scope', false, viewAllPermission ? [viewAllPermission] : [])
  }
  if (!businessAllowed) return deniedDecision(businessCode, ownsRecord)
  return allowedDecision(ownsRecord, !ownsRecord && !admin)
}

const EXPORT_EDITABLE_STATUSES = new Set(['cho_xu_ly', 'dang_xu_ly', 'pending'])
const EXPORT_DELETABLE_STATUSES = new Set([
  'cho_xu_ly', 'dang_xu_ly', 'pending', 'processing', 'tu_choi', 'rejected',
])

function exportRequestBusinessDecision(action, request, order) {
  if (action === 'create') {
    if (!order?.id) return { allowed: false, code: 'missing_parent' }
    if (order.deleted === true || order.active === false) return { allowed: false, code: 'parent_inactive' }
    return { allowed: true, code: 'allowed' }
  }
  if (!request?.id) return { allowed: false, code: 'missing_record' }
  const status = String(request.status || '')
  if (action === 'edit' && !EXPORT_EDITABLE_STATUSES.has(status)) {
    return { allowed: false, code: 'export_request_not_editable' }
  }
  if (action === 'delete') {
    const hasExportLink = [
      request.warehouse_export_code,
      request.active_export_order_id,
      request.export_order_id,
      request.warehouse_export_order_id,
      request.warehouse_export_id,
    ].some(value => String(value || '').trim())
    if (!EXPORT_DELETABLE_STATUSES.has(status) || hasExportLink) {
      return { allowed: false, code: 'export_request_not_deletable' }
    }
  }
  return { allowed: true, code: 'allowed' }
}

export function exportRequestActionDecision({
  action,
  request,
  order,
  permissions,
  currentUserEmail,
  phase = 'commit',
}) {
  const actionPermission = action === 'delete'
    ? 'export_requests.delete'
    : 'orders.warehouse_export'
  if (phase === 'start' && action === 'create' && !order) {
    const grants = permissionSet(permissions)
    if (grants.has('*') || grants.has(actionPermission)) return allowedDecision(false)
    return deniedDecision('missing_action', false, [actionPermission])
  }
  const business = exportRequestBusinessDecision(action, request, order)
  if (!business.allowed && ['missing_parent', 'missing_record', 'parent_inactive'].includes(business.code)) {
    return deniedDecision(business.code, false)
  }
  return moduleActionDecision({
    actionPermission,
    viewAllPermission: 'export_requests.view_all',
    permissions,
    record: request,
    parent: order,
    currentUserEmail,
    businessAllowed: business.allowed,
    businessCode: business.code,
  })
}

export function permissionDecisionMessage(decision, context = {}) {
  const operation = String(context.operation || 'operation')
  const record = String(context.record || '(unknown)')
  const status = String(context.status || '(unknown)')
  const missing = (decision?.missingPermissions || []).map(value => `[${value}]`).join(', ')
  if (decision?.code === 'missing_action') return `Thiếu quyền ${missing} cho ${operation}.`
  if (decision?.code === 'missing_scope') return `Bản ghi không thuộc phạm vi của bạn; cần ${missing} cho ${operation}.`
  if (decision?.code === 'missing_parent') return `Không tìm thấy đơn hàng cha để thực hiện ${operation}.`
  if (decision?.code === 'missing_record') return `Không tìm thấy bản ghi để thực hiện ${operation}.`
  if (decision?.allowed === false) {
    return `${operation} bị chặn (record=${record}, code=${decision.code}, status=${status}).`
  }
  return ''
}

export { DEFAULT_OWNER_FIELDS, ownsDocument }
