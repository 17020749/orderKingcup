import { readFile, writeFile } from 'node:fs/promises'

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

async function write(path, content) {
  await writeFile(new URL(`../${path}`, import.meta.url), content, 'utf8')
}

function replaceOnce(content, search, replacement, label) {
  const count = content.split(search).length - 1
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`)
  return content.replace(search, replacement)
}

async function patchHelper() {
  const path = 'utils/warehouseExportHistory.mjs'
  let content = await read(path)
  content = replaceOnce(
    content,
    'const orderByCode = orderCodeMap(orderMap.values())',
    'const orderByCode = orderCodeMap(Array.from(orderMap.values()))',
    'warehouse history order map',
  )
  await write(path, content)
}

async function patchWarehouseRequestPage() {
  const path = 'pages/warehouse-export-requests.vue'
  let content = await read(path)

  content = replaceOnce(
    content,
    "import { LOGO_FILTER_OPTIONS, matchesLogoPresenceFilter, rowsHaveLogo } from '~/utils/logoFilter.mjs'\n// @ts-ignore Shared lifecycle helper is also executed by Node client tests.",
    "import { LOGO_FILTER_OPTIONS, matchesLogoPresenceFilter, rowsHaveLogo } from '~/utils/logoFilter.mjs'\n// @ts-ignore Shared ESM helper is executed directly by Node client tests.\nimport { isDateTimeInRange } from '~/utils/warehouseExportHistory.mjs'\n// @ts-ignore Shared lifecycle helper is also executed by Node client tests.",
    'warehouse request datetime import',
  )

  content = replaceOnce(
    content,
    "const statusFilter = ref('')\nconst logoFilter = ref('')\nconst rows = ref<any[]>([])",
    "const statusFilter = ref('')\nconst logoFilter = ref('')\nconst dateTimeFrom = ref('')\nconst dateTimeTo = ref('')\nconst rows = ref<any[]>([])",
    'warehouse request datetime refs',
  )

  content = replaceOnce(
    content,
    "    const logoOk = matchesLogoPresenceFilter(requestHasLogo(row), logoFilter.value)\n    const textOk = !keyword || normalizeText([",
    "    const logoOk = matchesLogoPresenceFilter(requestHasLogo(row), logoFilter.value)\n    const dateTimeOk = isDateTimeInRange(\n      row.requested_at || row.created_at,\n      dateTimeFrom.value,\n      dateTimeTo.value,\n    )\n    const textOk = !keyword || normalizeText([",
    'warehouse request datetime predicate',
  )

  content = replaceOnce(
    content,
    '    return statusOk && logoOk && textOk\n  })\n})\n\nconst summary',
    "    return statusOk && logoOk && dateTimeOk && textOk\n  })\n})\n\nfunction resetFilters() {\n  search.value = ''\n  statusFilter.value = ''\n  logoFilter.value = ''\n  dateTimeFrom.value = ''\n  dateTimeTo.value = ''\n}\n\nconst summary",
    'warehouse request datetime return and reset',
  )

  content = replaceOnce(
    content,
    `        <select v-model="logoFilter" class="input" style="max-width:200px">
          <option value="">Tất cả logo</option>
          <option v-for="option in LOGO_FILTER_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </div>`,
    `        <select v-model="logoFilter" class="input" style="max-width:200px">
          <option value="">Tất cả logo</option>
          <option v-for="option in LOGO_FILTER_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
        <div class="filter-field" style="min-width:220px">
          <label class="filter-label" for="warehouse-request-from">Từ ngày giờ</label>
          <input id="warehouse-request-from" v-model="dateTimeFrom" class="input" type="datetime-local" />
        </div>
        <div class="filter-field" style="min-width:220px">
          <label class="filter-label" for="warehouse-request-to">Đến ngày giờ</label>
          <input id="warehouse-request-to" v-model="dateTimeTo" class="input" type="datetime-local" />
        </div>
        <button class="btn ghost" type="button" @click="resetFilters">Xóa lọc</button>
      </div>`,
    'warehouse request datetime toolbar',
  )

  await write(path, content)
}

async function patchAccessMatrix() {
  const path = 'constants/accessMatrix.mjs'
  let content = await read(path)
  content = replaceOnce(
    content,
    "  { key: 'exports', path: '/exports', label: 'Phiếu xuất kho', permission: 'page.exports', navSection: 'warehouse', navOrder: 30 },\n  { key: 'inventory_adjustments'",
    "  { key: 'exports', path: '/exports', label: 'Phiếu xuất kho', permission: 'page.exports', navSection: 'warehouse', navOrder: 30 },\n  { key: 'warehouse_export_history', path: '/warehouse-export-history', label: 'Lịch sử xuất kho', permission: 'page.exports', navSection: 'warehouse', navOrder: 35 },\n  { key: 'inventory_adjustments'",
    'warehouse history navigation entry',
  )
  if (/page\.warehouse_export_history|warehouse_export_history\.view/.test(content)) {
    throw new Error('New warehouse history permissions must not be introduced')
  }
  await write(path, content)
}

async function patchAppShell() {
  const path = 'components/AppShell.vue'
  let content = await read(path)
  content = replaceOnce(
    content,
    "    imports: '↓', warehouse_export_requests: '⇥', exports: '↑', inventory_adjustments: '±', inventory: '▥',",
    "    imports: '↓', warehouse_export_requests: '⇥', exports: '↑', warehouse_export_history: '◷', inventory_adjustments: '±', inventory: '▥',",
    'warehouse history navigation icon',
  )
  await write(path, content)
}

async function patchPackage() {
  const path = 'package.json'
  const pkg = JSON.parse(await read(path))
  pkg.scripts['test:warehouse-export-history'] = 'node --test tests/warehouse-export-history.client.test.mjs'
  if (!pkg.scripts['test:rules'].includes('npm run test:warehouse-export-history')) {
    pkg.scripts['test:rules'] = pkg.scripts['test:rules'].replace(
      'npm run test:cache',
      'npm run test:warehouse-export-history && npm run test:cache',
    )
  }
  await write(path, `${JSON.stringify(pkg, null, 2)}\n`)
}

async function patchTests() {
  const path = 'tests/warehouse-export-history.client.test.mjs'
  let content = await read(path)
  content = content
    .replace("isDateTimeInRange('2026-08-06T08:35:00+07:00', '2026-08-06T08:35', '2026-08-06T08:35')", "isDateTimeInRange('2026-08-06T08:35:00+07:00', '2026-08-06T08:35:00+07:00', '2026-08-06T08:35:00+07:00')")
    .replace("isDateTimeInRange('2026-08-06T08:34:59+07:00', '2026-08-06T08:35', '')", "isDateTimeInRange('2026-08-06T08:34:59+07:00', '2026-08-06T08:35:00+07:00', '')")
    .replace("isDateTimeInRange('2026-08-06T08:36:00+07:00', '', '2026-08-06T08:35')", "isDateTimeInRange('2026-08-06T08:36:00+07:00', '', '2026-08-06T08:35:00+07:00')")
    .replace("from: '2026-08-06T08:30',\n    to: '2026-08-06T08:40',", "from: '2026-08-06T08:30:00+07:00',\n    to: '2026-08-06T08:40:00+07:00',")
  await write(path, content)
}

await patchHelper()
await patchWarehouseRequestPage()
await patchAccessMatrix()
await patchAppShell()
await patchPackage()
await patchTests()
console.log('Applied warehouse export history feature patch.')
