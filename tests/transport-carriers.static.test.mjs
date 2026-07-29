import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Scope guard: the carrier catalog is used only by bus transport. The legacy
// shipments page is moved in navigation only and keeps its original form/data flow.
const carrierPage = readFileSync('pages/transport-carriers.vue', 'utf8')
const shipmentsPage = readFileSync('pages/shipments.vue', 'utf8')
const busTransportPage = readFileSync('pages/bus-transport.vue', 'utf8')
const labelModal = readFileSync('components/ParcelLabelPrintModal.vue', 'utf8')
const multiSelect = readFileSync('components/SearchableMultiSelect.vue', 'utf8')
const provinceData = readFileSync('data/vietnamProvincesV1.ts', 'utf8')
const districtData = readFileSync('data/vietnamDistrictsV1.ts', 'utf8')
const provinceComposable = readFileSync('composables/useVietnamProvinces.ts', 'utf8')
const accessMatrix = readFileSync('constants/accessMatrix.mjs', 'utf8')
const permissions = readFileSync('constants/permissions.ts', 'utf8')

 test('danh sách nhà xe có page riêng và bốn quyền CRUD độc lập', () => {
  assert.match(accessMatrix, /path: '\/transport-carriers'/)
  assert.match(accessMatrix, /label: 'Danh sách nhà xe'/)
  for (const permission of [
    'transport_carriers.view',
    'transport_carriers.create',
    'transport_carriers.edit',
    'transport_carriers.delete',
  ]) {
    assert.match(permissions, new RegExp(`key: '${permission.replace('.', '\\.')}'`))
    assert.match(carrierPage, new RegExp(`hasPermission\\('${permission.replace('.', '\\.')}'\\)`))
  }
})

test('ba page chỉ được gom trong nhóm Thông tin vận chuyển', () => {
  assert.match(accessMatrix, /key: 'transport', label: 'Thông tin vận chuyển'/)
  for (const key of ['shipments', 'bus_transport', 'transport_carriers']) {
    assert.match(accessMatrix, new RegExp(`key: '${key}'[\\s\\S]{0,180}navSection: 'transport'`))
  }
})

test('dữ liệu tỉnh thành, huyện v1 có fallback nội bộ và multi select tìm kiếm', () => {
  assert.match(provinceData, /provinces\.open-api\.vn\/api\/v1\/\?depth=1/)
  assert.ok((provinceData.match(/\{ code:/g) || []).length >= 63)
  assert.match(provinceComposable, /VIETNAM_PROVINCES_V1/)
  assert.match(provinceComposable, /\$fetch<unknown>\(VIETNAM_PROVINCES_V1_API_URL\)/)
  assert.match(districtData, /VIETNAM_DISTRICTS_V1_GZIP_BASE64/)
  assert.match(provinceComposable, /VIETNAM_PROVINCES_V1_DISTRICTS_API_URL/)
  assert.match(provinceComposable, /fallbackDistricts/)
  assert.match(provinceComposable, /districtOptionsForProvinceCodes/)
  assert.match(multiSelect, /defineEmits/)
  assert.match(multiSelect, /selectedOptions/)
  assert.match(multiSelect, /Gõ để tìm/)
  assert.match(carrierPage, /SearchableMultiSelect v-model="form\.service_province_codes"/)
  assert.match(carrierPage, /SearchableMultiSelect v-model="form\.service_district_codes"/)
})

test('chỉ vận chuyển nhà xe dùng danh mục và lưu ID cùng snapshot địa chỉ, tỉnh thành', () => {
  assert.match(busTransportPage, /collection\(db, 'transport_carriers'\)/)
  assert.match(busTransportPage, /filteredCarrierCards/)
  assert.match(busTransportPage, /@click="selectCarrier\(carrier\)"/)
  assert.match(busTransportPage, /transport_carrier_id: carrier\.id/)
  assert.match(busTransportPage, /carrier_name: carrier\.carrier_name/)
  assert.match(busTransportPage, /carrier_phone: carrier\.carrier_phone/)
  assert.match(busTransportPage, /carrier_address: carrier\.carrier_address/)
  assert.match(busTransportPage, /carrier_province_codes:/)
  assert.match(busTransportPage, /carrier_district_codes:/)
  assert.match(busTransportPage, /selected_province_codes:/)
  assert.match(busTransportPage, /selected_district_codes:/)
  assert.match(busTransportPage, /driver_name: carrier\.driver_name/)
})

test('page bus transport lọc nhà xe theo tỉnh, huyện và hiển thị card để chọn', () => {
  assert.match(busTransportPage, /carrierProvinceFilter/)
  assert.match(busTransportPage, /carrierDistrictFilter/)
  assert.match(busTransportPage, /provinceFilterOptions/)
  assert.match(busTransportPage, /districtFilterOptions/)
  assert.match(busTransportPage, /carrierMatchesLocationFilters/)
  assert.match(busTransportPage, /service_province_codes/)
  assert.match(busTransportPage, /service_district_codes/)
  assert.match(busTransportPage, /class="carrier-card"/)
  assert.match(busTransportPage, /Không có nhà xe phục vụ tỉnh thành hoặc từ khóa này/)
})

test('page shipments giữ nguyên nghiệp vụ cũ và không phụ thuộc danh mục nhà xe', () => {
  assert.doesNotMatch(shipmentsPage, /transport_carriers/)
  assert.doesNotMatch(shipmentsPage, /transport_carrier_id/)
  assert.doesNotMatch(shipmentsPage, /TransportCarrierDoc/)
  assert.match(shipmentsPage, /<label>Nhà vận chuyển<\/label><input v-model="form\.carrier" class="input"/)
})

test('thông tin snapshot trên form vận chuyển nhà xe là chỉ đọc', () => {
  for (const field of ['carrier_phone', 'driver_name', 'carrier_name', 'carrier_address']) {
    assert.match(busTransportPage, new RegExp(`v-model="form\\.${field}"[^>]*readonly`))
  }
})

test('biển số được bỏ khỏi danh mục, vận chuyển nhà xe và mẫu in', () => {
  for (const source of [carrierPage, busTransportPage, labelModal]) {
    assert.doesNotMatch(source, /vehicle_plate|Biển số xe|Biển số/)
  }
})

test('page danh mục chỉ ghi collection transport_carriers', () => {
  assert.match(carrierPage, /doc\(db, 'transport_carriers'/)
  assert.match(carrierPage, /collection\(db, 'transport_carriers'\)/)
  assert.doesNotMatch(carrierPage, /doc\(db, '(orders|customers|shipments|bus_transport_orders)'/)
})
