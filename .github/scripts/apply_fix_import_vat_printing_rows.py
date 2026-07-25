from pathlib import Path
import re


def replace_once(path, old, new):
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}: {old[:140]!r}')
    file.write_text(text.replace(old, new, 1))


def regex_once(path, pattern, replacement):
    file = Path(path)
    text = file.read_text()
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{path}: regex expected one match, found {count}: {pattern[:140]!r}')
    file.write_text(updated)


# Imports page: use vat_rate as canonical form field and keep legacy fallback.
replace_once('pages/imports.vue', '    vat_percent: 0,', '    vat_rate: 0,')
replace_once(
    'pages/imports.vue',
    '''function vatPercent(item: any) {
  return Math.max(0, toNumber(item?.vat_percent))
}

function unitCostWithVat(item: any) {
  return roundMoney(toNumber(item?.unit_cost) * (1 + vatPercent(item) / 100))
}''',
    '''function vatRate(item: any) {
  const raw = item?.vat_rate ?? item?.vat_percent ?? 0
  return Math.max(0, Math.min(100, toNumber(raw)))
}

function unitCostWithVat(item: any) {
  return roundMoney(toNumber(item?.unit_cost) * (1 + vatRate(item) / 100))
}'''
)
replace_once(
    'pages/imports.vue',
    '          vat_percent: toNumber((item as any).vat_percent),',
    '          vat_rate: vatRate(item),'
)
replace_once(
    'pages/imports.vue',
    '        vat_percent: vatPercent(line),',
    '        vat_rate: vatRate(line),'
)
replace_once(
    'pages/imports.vue',
    '<td><input v-model.number="line.vat_percent" class="input" type="number" min="0" step="0.1" placeholder="0" /></td>',
    '<td><input v-model="line.vat_rate" class="input" type="number" min="0" max="100" step="0.1" inputmode="decimal" placeholder="0" /></td>'
)
replace_once(
    'pages/imports.vue',
    '{{ quantityText((item as any).vat_percent) }}%',
    '{{ quantityText(vatRate(item)) }}%'
)

# Warehouse transaction: accept both names, recompute, and persist both aliases.
replace_once(
    'composables/useWarehouseTransactions.ts',
    '  unit_cost?: number\n  vat_percent?: number',
    '  unit_cost?: number\n  vat_rate?: number\n  vat_percent?: number'
)
replace_once(
    'composables/useWarehouseTransactions.ts',
    '''function importCostFields(line: any, quantity: number) {
  const unitCost = Math.max(0, toNumber(line?.unit_cost))
  const vatPercent = Math.max(0, toNumber(line?.vat_percent))
  const unitCostWithVat = roundMoney(unitCost * (1 + vatPercent / 100))
  return { unit_cost: unitCost, vat_percent: vatPercent, unit_cost_with_vat: unitCostWithVat, line_cost: roundMoney(quantity * unitCostWithVat) }
}''',
    '''function importCostFields(line: any, quantity: number) {
  const unitCost = Math.max(0, toNumber(line?.unit_cost))
  const vatRate = Math.max(0, Math.min(100, toNumber(line?.vat_rate ?? line?.vat_percent)))
  const unitCostWithVat = roundMoney(unitCost * (1 + vatRate / 100))
  return {
    unit_cost: unitCost,
    vat_rate: vatRate,
    vat_percent: vatRate,
    unit_cost_with_vat: unitCostWithVat,
    line_cost: roundMoney(quantity * unitCostWithVat),
  }
}'''
)
transactions_path = Path('composables/useWarehouseTransactions.ts')
transactions_text = transactions_path.read_text()
item_cost_anchor = '          unit_cost: line.unit_cost,\n          vat_percent: line.vat_percent,'
item_cost_count = transactions_text.count(item_cost_anchor)
if item_cost_count != 2:
    raise SystemExit(f'useWarehouseTransactions.ts: expected two item payload matches, found {item_cost_count}')
transactions_path.write_text(
    transactions_text.replace(
        item_cost_anchor,
        '          unit_cost: line.unit_cost,\n          vat_rate: line.vat_rate,\n          vat_percent: line.vat_percent,'
    )
)

# Inventory: calculate VAT-inclusive cost even when only vat_rate/legacy vat_percent exists.
replace_once(
    'pages/inventory.vue',
    '''      const unitCost = hasCost
        ? toNumber((costItem as any).unit_cost_with_vat ?? (costItem as any).unit_cost)
        : null''',
    '''      const baseUnitCost = toNumber((costItem as any)?.unit_cost)
      const itemVatRate = Math.max(0, Math.min(100, toNumber((costItem as any)?.vat_rate ?? (costItem as any)?.vat_percent)))
      const unitCost = hasCost
        ? Object.prototype.hasOwnProperty.call(costItem || {}, 'unit_cost_with_vat')
          ? toNumber((costItem as any).unit_cost_with_vat)
          : Math.round(baseUnitCost * (1 + itemVatRate / 100) * 100) / 100
        : null'''
)

# Printing list: parent progress row followed by every product item row.
regex_once(
    'pages/printing.vue',
    r'''\n  const productMap = new Map<string, \{ key: string; product_code: string; product_name: string; line_count: number \}>\(\)\n  detailItems\.forEach\(item => \{[\s\S]*?\n  \}\)\n  return \{''',
    '\n  return {'
)
replace_once('pages/printing.vue', '    product_summary: Array.from(productMap.values()),\n', '')
regex_once(
    'pages/printing.vue',
    r'''        <table class="printing-table">[\s\S]*?        </table>''',
    '''        <table class="printing-table">
          <thead>
            <tr>
              <th>Mã đơn hàng</th>
              <th>Sản phẩm</th>
              <th>NCC theo dòng</th>
              <th>SL dự kiến</th>
              <th>SL thực tế</th>
              <th>Hạn gần nhất</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="row in filtered" :key="row.id">
              <tr class="printing-parent-row">
                <td><b>{{ row.order_code }}</b><div class="small subtle">{{ row.created_by || '-' }}</div></td>
                <td><b>{{ row.detailItems.length }}</b> dòng sản phẩm</td>
                <td>{{ row.supplier_summary || '-' }}</td>
                <td>{{ quantityText(row.total_print_quantity) }}</td>
                <td>{{ quantityText(row.total_actual_quantity) }}</td>
                <td>{{ row.next_due_at ? formatDateTime(row.next_due_at) : '-' }}</td>
                <td><span class="badge" :class="statusClass(row.print_status)">{{ row.print_status }}</span></td>
                <td>
                  <div class="action-buttons">
                    <button class="btn-sm btn-view" @click="openDetail(row)">Chi tiết</button>
                    <button v-if="canEditOrder(row)" class="btn-sm" @click="openEditModal(row)">Sửa</button>
                    <button v-if="canDeleteOrder(row)" class="btn-sm btn-delete" @click="removeOrder(row)">Xóa</button>
                  </div>
                </td>
              </tr>
              <tr
                v-for="(item, itemIndex) in row.detailItems"
                :key="`${row.id}:${item.id}`"
                class="printing-child-row"
              >
                <td><span class="printing-child-marker">↳ Dòng {{ itemIndex + 1 }}</span></td>
                <td class="printing-child-product">
                  <b>{{ item.product_code || '-' }}</b>
                  <div>{{ item.product_name || 'Sản phẩm' }}</div>
                  <div class="small subtle">
                    <span v-if="item.logo">Logo: {{ item.logo }}</span>
                    <span v-if="item.logo_color"> · Màu: {{ item.logo_color }}</span>
                    <span v-if="item.note"> · {{ item.note }}</span>
                  </div>
                </td>
                <td>{{ item.supplier_name || '-' }}</td>
                <td>{{ quantityText(item.print_quantity) }}</td>
                <td>{{ quantityText(item.actual_print_quantity) }}</td>
                <td>{{ item.expected_done_at ? formatDateTime(item.expected_done_at) : '-' }}</td>
                <td><span class="badge" :class="statusClass(itemStatus(item))">{{ itemStatus(item) }}</span></td>
                <td></td>
              </tr>
              <tr v-if="!row.detailItems.length" class="printing-child-row">
                <td></td>
                <td colspan="7" class="empty">Tiến độ này chưa có dòng sản phẩm.</td>
              </tr>
            </template>
            <tr v-if="!filtered.length"><td colspan="8" class="empty">Chưa có tiến độ in ấn phù hợp.</td></tr>
          </tbody>
        </table>'''
)
replace_once(
    'pages/printing.vue',
    '''.printing-table { min-width: 1580px; }
.printing-products-cell { min-width: 280px; }
.printing-product-line { display: flex; align-items: baseline; gap: 6px; padding: 3px 0; }
.printing-product-line span { color: var(--text); }
.printing-product-line small { color: var(--muted); white-space: nowrap; }''',
    '''.printing-table { min-width: 1380px; }
.printing-parent-row td { background: #f8fafc; border-top: 2px solid var(--line); font-weight: 600; }
.printing-child-row td { background: #fff; vertical-align: middle; }
.printing-child-marker { color: var(--muted); font-weight: 700; white-space: nowrap; }
.printing-child-product { min-width: 300px; padding-left: 18px; }
.printing-child-product > div:not(.small) { margin-top: 2px; }'''
)

# Regression assertions in existing static test files.
replace_once(
    'tests/warehouse-client-payload.static.test.mjs',
    "const exportsPage = readFileSync('pages/exports.vue', 'utf8')\nconst transactions",
    "const exportsPage = readFileSync('pages/exports.vue', 'utf8')\nconst importsPage = readFileSync('pages/imports.vue', 'utf8')\nconst transactions"
)
with Path('tests/warehouse-client-payload.static.test.mjs').open('a') as file:
    file.write('''\n\ntest('import VAT keeps the entered rate and persists VAT-inclusive costs', () => {\n  assert.match(importsPage, /v-model="line\\.vat_rate"/)\n  assert.match(importsPage, /item\\?\\.vat_rate \\?\\? item\\?\\.vat_percent/)\n  assert.match(transactions, /line\\?\\.vat_rate \\?\\? line\\?\\.vat_percent/)\n  assert.match(transactions, /vat_rate: vatRate/)\n  assert.match(transactions, /vat_percent: vatRate/)\n  assert.match(transactions, /line_cost: roundMoney\\(quantity \\* unitCostWithVat\\)/)\n})\n''')

with Path('tests/printing-permission.static.test.mjs').open('a') as file:
    file.write('''\n\ntest('printing list renders every product as a child row under its parent progress', () => {\n  const listSection = printingPage.slice(\n    printingPage.indexOf('<table class="printing-table">'),\n    printingPage.indexOf('<BaseModal', printingPage.indexOf('<table class="printing-table">')),\n  )\n  assert.match(listSection, /<template v-for="row in filtered"/)\n  assert.match(listSection, /v-for="\\(item, itemIndex\\) in row\\.detailItems"/)\n  assert.match(listSection, /class="printing-child-row"/)\n  assert.doesNotMatch(listSection, /<th>Mã AM<\\/th>/)\n  assert.doesNotMatch(listSection, /Tiến độ dòng/)\n})\n''')

for temporary in [
    '.github/workflows/apply-fix-import-vat-printing-rows.yml',
    '.github/workflows/run-fix-import-vat-printing-rows.yml',
    '.github/apply-fix-import-vat-printing-rows.trigger',
    '.github/scripts/apply_fix_import_vat_printing_rows.py',
]:
    Path(temporary).unlink(missing_ok=True)
