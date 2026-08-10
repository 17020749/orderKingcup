const EPSILON = 0.0001

function text(value) {
  return String(value || '').trim()
}

function number(value) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function productIdOf(line) {
  return text(
    line?.product?.id
    || line?.product?.firestore_id
    || line?.product?.product_id
    || line?.product_id,
  )
}

function warehouseIdOf(line) {
  const warehouse = line?.warehouse || null
  if (typeof warehouse === 'string') return warehouse.trim()
  return text(
    warehouse?.id
    || warehouse?.firestore_id
    || line?.warehouse_id,
  )
}

function activeItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter(item => item && item.deleted !== true && item.active !== false)
}

function positiveLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .filter(line => number(line?.quantity) > 0)
}

export function importUpdateTouchesInventory(input = {}) {
  const oldItems = activeItems(input.existingItems)
  const lines = positiveLines(input.lines)
  const oldImportDate = text(input?.order?.import_date).slice(0, 10)
  const nextImportDate = text(input?.import_date || oldImportDate).slice(0, 10)

  // Receipt date affects lot chronology/FIFO history, so changing it must stay
  // on the guarded inventory transaction path.
  if (oldImportDate && nextImportDate && oldImportDate !== nextImportDate) return true
  if (oldItems.length !== lines.length) return true

  return lines.some((line, index) => {
    const old = oldItems[index]
    if (!old) return true

    return (
      productIdOf(line) !== text(old.product_id)
      || warehouseIdOf(line) !== text(old.warehouse_id)
      || text(line.logo) !== text(old.logo)
      || Math.abs(number(line.quantity) - number(old.quantity)) > EPSILON
    )
  })
}

export function importUpdateMode(input = {}) {
  return importUpdateTouchesInventory(input) ? 'inventory' : 'metadata'
}
