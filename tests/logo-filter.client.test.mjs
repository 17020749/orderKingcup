import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  hasMeaningfulLogo,
  matchesLogoPresenceFilter,
  rowsHaveLogo,
} from '../utils/logoFilter.mjs'

test('nhận diện logo thực và loại trừ giá trị rỗng', () => {
  assert.equal(hasMeaningfulLogo('Logo Kingcup'), true)
  assert.equal(hasMeaningfulLogo('   '), false)
  assert.equal(hasMeaningfulLogo('-'), false)
  assert.equal(hasMeaningfulLogo('Không logo'), false)
  assert.equal(hasMeaningfulLogo(['', { logo: 'Bazan' }]), true)
})

test('lọc có logo và không có logo theo toàn bộ dòng chứng từ', () => {
  const noLogoRows = [{ logo: '' }, { logo: 'Không logo' }]
  const mixedRows = [{ logo: '' }, { logo: 'KC' }]
  assert.equal(rowsHaveLogo(noLogoRows), false)
  assert.equal(rowsHaveLogo(mixedRows), true)
  assert.equal(matchesLogoPresenceFilter(true, 'with_logo'), true)
  assert.equal(matchesLogoPresenceFilter(false, 'with_logo'), false)
  assert.equal(matchesLogoPresenceFilter(false, 'without_logo'), true)
  assert.equal(matchesLogoPresenceFilter(true, 'without_logo'), false)
})

test('orders chỉ xét order_items và hỗ trợ logo_json', () => {
  const source = readFileSync('pages/orders.vue', 'utf8')
  assert.match(source, /function orderHasLogo\(orderId: string\)/)
  assert.match(source, /itemsByOrder\.value\[orderId\]/)
  assert.match(source, /parseLogoLines\(\(item as any\)\.logo_json\)/)
  assert.match(source, /orderHasLogo\(row\.id\)/)
})

test('hai page yêu cầu xuất chỉ xét dòng trong chính phiếu', () => {
  for (const path of ['pages/export-requests.vue', 'pages/warehouse-export-requests.vue']) {
    const source = readFileSync(path, 'utf8')
    assert.match(source, /function requestHasLogo\(row: any\)/)
    assert.match(source, /rowsHaveLogo\(requestLineProgress\(row\)/)
    assert.match(source, /matchesLogoPresenceFilter\(requestHasLogo\(row\), logoFilter\.value\)/)
  }
})

test('imports và exports xét logo từ các dòng chứng từ', () => {
  const imports = readFileSync('pages/imports.vue', 'utf8')
  const exportsPage = readFileSync('pages/exports.vue', 'utf8')
  assert.match(imports, /has_logo: rowsHaveLogo\(orderItems/)
  assert.match(imports, /matchesLogoPresenceFilter\(row\.has_logo, logoFilter\.value\)/)
  assert.match(exportsPage, /has_logo: rowsHaveLogo\(orderItems/)
  assert.match(exportsPage, /Object\.prototype\.hasOwnProperty\.call\(item, "source_logo"\)/)
  assert.match(exportsPage, /matchesLogoPresenceFilter\(row\.has_logo, logoFilter\.value\)/)
})
