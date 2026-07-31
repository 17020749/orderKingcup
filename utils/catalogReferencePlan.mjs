function clean(value) {
  return String(value || '').trim()
}

function unique(values = []) {
  return Array.from(new Set(values.map(clean).filter(Boolean)))
}

function probes(collection, fields, values, group) {
  return fields.flatMap(field => unique(values).map(value => ({ collection, field, value, group })))
}

export function catalogReferencePlan(tab, row = {}) {
  if (tab === 'warehouses') {
    const values = unique([row.id, row.legacy_id, row.warehouse_code])
    return [
      ...probes('import_order_items', ['warehouse_id', 'warehouse_legacy_id', 'warehouse_code'], values, 'import'),
      ...probes('export_order_items', [
        'from_warehouse_id', 'from_warehouse_legacy_id', 'from_warehouse_code',
        'to_warehouse_id', 'to_warehouse_legacy_id', 'to_warehouse_code',
      ], values, 'export'),
      ...probes('inventory_balances', ['warehouse_id', 'warehouse_legacy_id', 'warehouse_code'], values, 'balance'),
      ...probes('inventory_adjustments', ['warehouse_id', 'warehouse_legacy_id', 'warehouse_code'], values, 'adjustment'),
    ]
  }

  if (tab === 'suppliers') {
    const values = unique([row.id, row.legacy_id, row.supplier_code])
    return probes('import_orders', ['supplier_id', 'supplier_legacy_id', 'supplier_code'], values, 'import')
  }

  if (tab === 'units') {
    const values = unique([row.unit_code, row.name])
    return [
      ...probes('products', ['unit'], values, 'product'),
      ...probes('import_order_items', ['unit'], values, 'import'),
      ...probes('export_order_items', ['unit'], values, 'export'),
    ]
  }

  throw new Error(`Danh mục không hợp lệ: ${tab}`)
}

export function summarizeCatalogReferenceUsage(tab, counts = {}) {
  if (tab === 'warehouses') {
    const detail = `nhập ${counts.import || 0}, xuất ${counts.export || 0}, tồn ${counts.balance || 0}, điều chỉnh ${counts.adjustment || 0}`
    return { total: (counts.import || 0) + (counts.export || 0) + (counts.balance || 0) + (counts.adjustment || 0), detail }
  }
  if (tab === 'suppliers') {
    return { total: counts.import || 0, detail: `${counts.import || 0} phiếu nhập` }
  }
  const detail = `sản phẩm ${counts.product || 0}, dòng nhập ${counts.import || 0}, dòng xuất ${counts.export || 0}`
  return { total: (counts.product || 0) + (counts.import || 0) + (counts.export || 0), detail }
}
