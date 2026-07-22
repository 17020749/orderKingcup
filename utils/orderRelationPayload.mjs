function text(value) {
  return String(value || '').trim()
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key)
}

export function buildActiveRelationPayload({
  record = {},
  existingRecord = {},
  order = {},
  actor = '',
  mode = 'create',
} = {}) {
  const mutable = { ...record }
  delete mutable.order_id
  delete mutable.order_code
  delete mutable.order_owner_email
  delete mutable.order_created_by
  delete mutable.order_sale_email
  delete mutable.created_by
  delete mutable.created_at

  const payload = {
    ...mutable,
    order_id: order.id,
    order_code: order.order_code,
    order_owner_email: order.owner_email || '',
    order_created_by: order.created_by || '',
    order_sale_email: order.sale_email || '',
    active: true,
    deleted: false,
    status: record.status === 'deleted' ? 'active' : (record.status || 'active'),
  }

  if (mode === 'create') {
    payload.created_by = text(record.created_by || actor).toLowerCase()
  } else if (hasOwn(existingRecord, 'created_by')) {
    // created_by is immutable in Firestore Rules. Legacy documents can lack it;
    // omitting the field on a merge update preserves that absence instead of
    // silently changing identity to the current editor.
    payload.created_by = existingRecord.created_by
  }

  return payload
}
