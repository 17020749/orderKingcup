function text(value) {
  return String(value ?? '')
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseLogoLines(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function logoShape(value) {
  return parseLogoLines(value).map(line => ({
    logo: text(line?.logo),
    logo_color: text(line?.logo_color ?? line?.color),
    quantity: number(line?.quantity ?? line?.qty ?? line?.export_quantity),
  }))
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameNumber(left, right) {
  return number(left) === number(right)
}

const PRICE_IMMUTABLE_FIELDS = Object.freeze([
  'order_id',
  'product_id',
  'product_code',
  'product_name',
  'unit',
  'quantity',
  'packing_standard',
  'box_quantity',
  'odd_quantity',
  'note',
])

export function priceEditChanged(previousItems = [], nextItems = []) {
  const previous = new Map((Array.isArray(previousItems) ? previousItems : [])
    .map(item => [text(item?.id || item?.firestore_id), item]))
  return (Array.isArray(nextItems) ? nextItems : []).some(next => {
    const id = text(next?.id || next?.firestore_id)
    const current = previous.get(id)
    if (!current) return true
    return !sameNumber(current.unit_price, next.unit_price)
      || !sameNumber(current.line_total, next.line_total)
      || text(current.logo_json) !== text(next.logo_json)
  })
}

export function assertPriceOnlyItemChange(current = {}, next = {}) {
  const currentId = text(current.id || current.firestore_id)
  const nextId = text(next.id || next.firestore_id)
  if (!currentId || currentId !== nextId) {
    throw new Error('Không được thêm, xóa hoặc thay dòng sản phẩm khi sửa giá.')
  }

  for (const field of PRICE_IMMUTABLE_FIELDS) {
    if (field === 'quantity' || field === 'box_quantity' || field === 'odd_quantity') {
      if (!sameNumber(current[field], next[field])) {
        throw new Error('Chỉ được sửa đơn giá; sản phẩm và số lượng phải giữ nguyên.')
      }
    } else if (text(current[field]) !== text(next[field])) {
      throw new Error('Chỉ được sửa đơn giá; thông tin sản phẩm phải giữ nguyên.')
    }
  }

  if (!sameJson(logoShape(current.logo_json), logoShape(next.logo_json))) {
    throw new Error('Chỉ được sửa đơn giá; logo và số lượng logo phải giữ nguyên.')
  }
}

export function pricePatchForItem(current = {}, next = {}) {
  const patch = {
    unit_price: number(next.unit_price),
    line_total: number(next.line_total),
    line_profit: number(next.line_profit),
  }
  if (text(current.logo_json) !== text(next.logo_json)) patch.logo_json = text(next.logo_json)
  return patch
}

export function priceOnlyItemsChanged(previousItems = [], nextItems = []) {
  const previous = new Map((Array.isArray(previousItems) ? previousItems : [])
    .map(item => [text(item?.id || item?.firestore_id), item]))
  const next = Array.isArray(nextItems) ? nextItems : []
  if (previous.size !== next.length) return true
  for (const item of next) {
    const id = text(item?.id || item?.firestore_id)
    const current = previous.get(id)
    if (!current) return true
    if (priceEditChanged([current], [item])) return true
  }
  return false
}
