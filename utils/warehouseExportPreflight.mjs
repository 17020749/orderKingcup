const EPSILON = 0.0001

export function normalizeWarehouseLogo(value) {
  return String(value || '').trim()
}

function hasOwnField(value, field) {
  return value != null && Object.prototype.hasOwnProperty.call(value, field)
}

function normalizeId(value) {
  return String(value || '').trim()
}

function roundQuantity(value) {
  const number = Number(value || 0)
  if (!Number.isFinite(number)) return 0
  return Math.round(number * 1000) / 1000
}

function safeDocId(value, prefix = 'doc') {
  const raw = String(value || '').trim()
  let id = raw || `${prefix}_${Date.now()}`
  id = id.replace(/[\\/?#\[\]]/g, '_').replace(/\s+/g, '_')
  if (!id || id === '.' || id === '..' || /^__.*__$/.test(id)) id = `${prefix}_${Date.now()}`
  if (id.length > 900) id = `${prefix}_${id.slice(0, 120)}_${Date.now()}`
  return id
}

async function sha256Hex24(value) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('Trình duyệt không hỗ trợ crypto.subtle để tạo khóa tồn kho theo logo.')
  const bytes = await subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24)
}

export async function inventoryBalanceId(productId, warehouseId, logo) {
  const logoText = normalizeWarehouseLogo(logo)
  const logoKey = logoText ? await sha256Hex24(logoText) : 'no_logo'
  return safeDocId(`${normalizeId(warehouseId)}__${normalizeId(productId)}__${logoKey}`, 'balance')
}

export function sourceLogoOf(line, destinationType) {
  if (destinationType === 'warehouse' && hasOwnField(line, 'source_logo')) {
    return normalizeWarehouseLogo(line.source_logo)
  }
  if (hasOwnField(line, 'target_logo')) return normalizeWarehouseLogo(line.target_logo)
  return normalizeWarehouseLogo(line.logo)
}

export function targetLogoOf(line) {
  if (hasOwnField(line, 'target_logo')) return normalizeWarehouseLogo(line.target_logo)
  return normalizeWarehouseLogo(line.logo)
}

function productIdOf(product) {
  return normalizeId(product?.id || product?.firestore_id || product?.product_id)
}

function productCodeOf(product) {
  return String(product?.product_code || product?.code || product?.product_id || productIdOf(product) || '').trim()
}

function productNameOf(product) {
  return String(product?.product_name || product?.name || '').trim()
}

function warehouseIdOf(warehouse) {
  if (typeof warehouse === 'string') return normalizeId(warehouse)
  return normalizeId(
    warehouse?.id
    || warehouse?.firestore_id
    || warehouse?.value
    || warehouse?.from_warehouse_id
    || warehouse?.warehouse_id,
  )
}

function warehouseNameOf(warehouse) {
  if (typeof warehouse === 'string') return warehouse.trim()
  return String(warehouse?.name || warehouse?.warehouse_name || warehouse?.warehouse_code || warehouseIdOf(warehouse) || '').trim()
}

function sourceWarehouseOf(line, fallbackWarehouse) {
  return line?.fromWarehouse
    || line?.warehouse
    || line?.from_warehouse_id
    || line?.warehouse_id
    || fallbackWarehouse
    || null
}

export function collectExportStockRequirements(input = {}) {
  const destinationType = String(input.destination_type || 'customer')
  const fallbackWarehouse = input.fallbackWarehouse || input.warehouse || null
  const requirements = new Map()

  for (const line of Array.isArray(input.lines) ? input.lines : []) {
    const quantity = roundQuantity(line?.quantity)
    if (quantity <= 0) continue

    const product = line?.product || line || {}
    const warehouse = sourceWarehouseOf(line, fallbackWarehouse)
    const productId = productIdOf(product)
    const warehouseId = warehouseIdOf(warehouse)
    if (!productId) throw new Error('Thiếu sản phẩm hoặc sản phẩm chưa có ID hệ thống.')
    if (!warehouseId) throw new Error(`Thiếu kho xuất cho ${productCodeOf(product) || productNameOf(product) || 'sản phẩm chưa xác định'}.`)

    const sourceLogo = sourceLogoOf(line, destinationType)
    const key = `${warehouseId}\u0000${productId}\u0000${sourceLogo}`
    const existing = requirements.get(key)
    if (existing) {
      existing.quantity = roundQuantity(existing.quantity + quantity)
      continue
    }

    requirements.set(key, {
      key,
      product,
      productId,
      productCode: productCodeOf(product),
      productName: productNameOf(product),
      warehouse,
      warehouseId,
      warehouseName: warehouseNameOf(warehouse),
      logo: sourceLogo,
      targetLogo: targetLogoOf(line),
      quantity,
    })
  }

  return Array.from(requirements.values())
}

export function buildStockShortageMessage(requirement, currentQuantity) {
  const current = roundQuantity(currentQuantity)
  const needed = roundQuantity(requirement.quantity)
  const missing = roundQuantity(Math.max(0, needed - current))
  const productLabel = [requirement.productCode, requirement.productName].filter(Boolean).join(' - ') || requirement.productId
  const warehouseLabel = requirement.warehouseName || requirement.warehouseId
  const logoLabel = requirement.logo ? `logo ${requirement.logo}` : 'hàng trơn (không logo)'
  const hasStock = current > EPSILON ? 'Có' : 'Không'

  return `Không đủ tồn: ${productLabel} / kho ${warehouseLabel} / ${logoLabel}. Tồn hiện tại ${current}, cần ${needed}, thiếu ${missing}. Sản phẩm có tồn ở kho này: ${hasStock}.`
}

export async function preflightExportStock(input = {}) {
  if (typeof input.loadBalance !== 'function') throw new Error('Thiếu hàm đọc tồn kho để kiểm tra trước khi xuất.')
  const requirements = collectExportStockRequirements(input)

  for (const requirement of requirements) {
    const balance = await input.loadBalance({
      productId: requirement.productId,
      warehouseId: requirement.warehouseId,
      logo: requirement.logo,
      requirement,
    })
    const current = roundQuantity(balance?.quantity)
    if (current + EPSILON < requirement.quantity) {
      throw new Error(buildStockShortageMessage(requirement, current))
    }
  }

  return requirements
}
