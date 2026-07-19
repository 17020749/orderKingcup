from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise SystemExit(f'Missing replacement target: {label}')
    return source.replace(old, new, 1)


source_path = Path('composables/useWarehouseCostTransactions.ts')
source = source_path.read_text(encoding='utf-8')

old_lines = """    const lines = summary.map((line: any, index: number) => {
      const product = ensureProduct({
        id: line.product_id,
        product_code: line.product_code,
        product_name: line.product_name,
        unit: line.unit,
      })
      const fromWarehouse = ensureWarehouse({
        id: line.warehouse_id,
        name: line.warehouse_name,
      }, `kho xuất dòng ${index + 1}`)
      const quantity = positiveQuantity(line.quantity)
      return {
        product,
        fromWarehouse,
        logo: normalizeLogo(line.logo),
        unit: line.unit || product.unit || '',
        quantity,
        itemId: safeDocId(`${exportOrderId}__${index + 1}`, 'export_item'),
        reverseMovementId: safeDocId(`export_request_cancel:${exportOrderId}:${index + 1}:${operationId}`, 'movement'),
        summaryAllocations: Array.isArray(line.lot_allocations) ? line.lot_allocations : [],
      }
    })
    const refs = await buildBalanceRefs(lines.map((line: any) => ({
      product: line.product,
      warehouse: line.fromWarehouse,
      logo: line.logo,
    })))
"""

new_lines = """    const lines = summary.map((line: any, index: number) => {
      const product = ensureProduct({
        id: line.product_id,
        product_code: line.product_code,
        product_name: line.product_name,
        unit: line.unit,
      })
      const quantity = positiveQuantity(line.quantity)
      return {
        product,
        fromWarehouse: null as any,
        summaryWarehouseId: normalizeId(
          line.from_warehouse_id
          || line.warehouse_id
          || line.source_warehouse_id,
        ),
        summaryWarehouseName: String(
          line.from_warehouse_name
          || line.warehouse_name
          || line.source_warehouse_name
          || '',
        ).trim(),
        logo: normalizeLogo(line.source_logo || line.logo),
        unit: line.unit || product.unit || '',
        quantity,
        itemId: safeDocId(
          line.export_order_item_id
          || line.export_item_id
          || line.item_id
          || `${exportOrderId}__${index + 1}`,
          'export_item',
        ),
        reverseMovementId: safeDocId(`export_request_cancel:${exportOrderId}:${index + 1}:${operationId}`, 'movement'),
        summaryAllocations: Array.isArray(line.lot_allocations) ? line.lot_allocations : [],
      }
    })
"""
source = replace_once(source, old_lines, new_lines, 'cancel summary preparation')

old_item_reads = """        const itemSnaps = new Map<string, any>()
        for (const line of lines) itemSnaps.set(line.itemId, await tx.get(doc(db, 'export_order_items', line.itemId)))
        const states = await readBalanceStates(tx, refs, request.export_date || todayKey())

        const restoredAllocations = new Map<string, LotAllocation[]>()
"""

new_item_reads = """        const itemSnaps = new Map<string, any>()
        for (const line of lines) itemSnaps.set(line.itemId, await tx.get(doc(db, 'export_order_items', line.itemId)))

        // The persisted export item is the source of truth for reversal. Older
        // request summaries may contain warehouse_name but omit warehouse_id.
        for (const [lineIndex, line] of lines.entries()) {
          const itemSnap = itemSnaps.get(line.itemId)
          if (!itemSnap?.exists()) throw new Error(`Thiếu chi tiết phiếu xuất ${line.itemId}, không thể hoàn tồn.`)
          const item = itemSnap.data() || {}
          if (String(item.export_order_id || '') !== exportOrderId || item.deleted === true || item.active === false) {
            throw new Error(`Chi tiết phiếu xuất ${line.itemId} không còn hợp lệ để hoàn tồn.`)
          }
          line.product = ensureProduct({
            id: item.product_id || line.product.id,
            product_code: item.product_code || productCode(line.product),
            product_name: item.product_name || productName(line.product),
            unit: item.unit || line.unit,
          })
          line.fromWarehouse = ensureWarehouse({
            id: item.from_warehouse_id
              || item.warehouse_id
              || item.source_warehouse_id
              || line.summaryWarehouseId,
            firestore_id: item.from_warehouse_id
              || item.warehouse_id
              || item.source_warehouse_id
              || line.summaryWarehouseId,
            name: item.from_warehouse_name
              || item.warehouse_name
              || item.source_warehouse_name
              || line.summaryWarehouseName,
          }, `kho xuất dòng ${lineIndex + 1}`)
          line.logo = exportItemSourceLogo(item)
          line.unit = item.unit || line.unit || line.product.unit || ''
          line.quantity = positiveQuantity(item.quantity ?? line.quantity, `Số lượng xuất dòng ${lineIndex + 1}`)
        }

        const refs = await buildBalanceRefs(lines.map((line: any) => ({
          product: line.product,
          warehouse: line.fromWarehouse,
          logo: line.logo,
        })))
        const states = await readBalanceStates(tx, refs, currentExport.export_date || request.export_date || todayKey())

        const restoredAllocations = new Map<string, LotAllocation[]>()
"""
source = replace_once(source, old_item_reads, new_item_reads, 'cancel export item source of truth')

old_summary = """            warehouse_id: line.fromWarehouse.id,
            warehouse_name: warehouseName(line.fromWarehouse),
            logo: normalizeLogo(line.targetLogo),
"""
new_summary = """            export_order_item_id: line.itemId,
            warehouse_id: line.fromWarehouse.id,
            warehouse_name: warehouseName(line.fromWarehouse),
            from_warehouse_id: line.fromWarehouse.id,
            from_warehouse_name: warehouseName(line.fromWarehouse),
            source_logo: normalizeLogo(line.sourceLogo),
            logo: normalizeLogo(line.targetLogo),
"""
source = replace_once(source, old_summary, new_summary, 'release summary warehouse source fields')
source_path.write_text(source, encoding='utf-8')

test_path = Path('tests/runtime-export-sync.client.test.mjs')
test_source = test_path.read_text(encoding='utf-8')
new_test = """

test('cancel release resolves the source warehouse from the persisted export item', () => {
  const source = readFileSync('composables/useWarehouseCostTransactions.ts', 'utf8')

  assert.match(source, /The persisted export item is the source of truth for reversal/)
  assert.match(source, /item\.from_warehouse_id\s*\n\s*\|\| item\.warehouse_id/)
  assert.match(source, /line\.fromWarehouse = ensureWarehouse\(/)
  assert.match(source, /line\.logo = exportItemSourceLogo\(item\)/)
  assert.match(source, /currentExport\.export_date \|\| request\.export_date/)
  assert.match(source, /export_order_item_id: line\.itemId/)
  assert.match(source, /from_warehouse_id: line\.fromWarehouse\.id/)
  assert.match(source, /source_logo: normalizeLogo\(line\.sourceLogo\)/)
})
"""
if "cancel release resolves the source warehouse from the persisted export item" not in test_source:
    test_source += new_test
    test_path.write_text(test_source, encoding='utf-8')

print('Patched cancel reversal to use persisted export item warehouse data')
