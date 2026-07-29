<script setup lang="ts">
import { collection, doc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore'
import type { BusTransportDoc, ExportRequestDoc, TransportCarrierDoc } from '~/types/models'
import { formatDateTime, isActive, makeCode, makeId, normalizeText, safeJsonParse, toNumber } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'
// @ts-ignore Shared lifecycle helper is executed directly by Node tests.
import { activeExportOrderId } from '~/utils/exportLifecycle.mjs'

const { db } = useFirebaseServices()
const { appUser, hasPermission } = useAuth()
const { showToast, withLoading } = useUi()
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()
const { invalidateScopedCache } = useRepo()
const { requestLineProgress } = useWarehouseLogic()
const {
  options: provinceOptions,
  loadProvinces,
  provinceNames,
  districtNames,
  districtOptionsForProvinceCodes,
  loadDistricts,
  districtsLoading,
} = useVietnamProvinces()

const rows = ref<BusTransportDoc[]>([])
const requests = ref<ExportRequestDoc[]>([])
const carriers = ref<TransportCarrierDoc[]>([])
const loading = ref(false)
const saving = ref(false)
const search = ref('')
const statusFilter = ref('')
const carrierProvinceFilter = ref<number[]>([])
const carrierDistrictFilter = ref<number[]>([])
const carrierKeyword = ref('')
const showModal = ref(false)
const showDetailModal = ref(false)
const editing = ref<BusTransportDoc | null>(null)
const selectedDetail = ref<BusTransportDoc | null>(null)
const selectedPrint = ref<BusTransportDoc | null>(null)
const selectedPrintRequest = ref<ExportRequestDoc | null>(null)
const selectedPrintItems = ref<Array<Record<string, any>>>([])
const form = reactive<any>({})

const canView = computed(() => hasPermission('*') || hasPermission('bus_transport.view'))
const canCreate = computed(() => hasPermission('*') || hasPermission('bus_transport.create'))
const canEdit = computed(() => hasPermission('*') || hasPermission('bus_transport.edit'))
const canDelete = computed(() => hasPermission('*') || hasPermission('bus_transport.delete'))

function normalizeProvinceCodes(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .map(code => Number(code))
    .filter(code => Number.isInteger(code) && code > 0)))
    .sort((left, right) => left - right)
}

function normalizeDistrictCodes(value: unknown) {
  return normalizeProvinceCodes(value)
}

function carrierServiceProvinceNames(row: Partial<TransportCarrierDoc> | null | undefined) {
  const namesByCode = provinceNames(normalizeProvinceCodes(row?.service_province_codes))
  if (namesByCode.length) return namesByCode
  return Array.isArray(row?.service_province_names)
    ? Array.from(new Set(row.service_province_names.map(name => String(name || '').trim()).filter(Boolean)))
    : []
}

function carrierServiceDistrictNames(row: Partial<TransportCarrierDoc> | null | undefined) {
  const namesByCode = districtNames(normalizeDistrictCodes(row?.service_district_codes))
  if (namesByCode.length) return namesByCode
  return Array.isArray(row?.service_district_names)
    ? Array.from(new Set(row.service_district_names.map(name => String(name || '').trim()).filter(Boolean)))
    : []
}

function transportCarrierProvinceNames(row: Partial<BusTransportDoc> | null | undefined) {
  const namesByCode = provinceNames(normalizeProvinceCodes(row?.carrier_province_codes))
  if (namesByCode.length) return namesByCode
  return Array.isArray(row?.carrier_province_names)
    ? Array.from(new Set(row.carrier_province_names.map(name => String(name || '').trim()).filter(Boolean)))
    : []
}

function transportCarrierDistrictNames(row: Partial<BusTransportDoc> | null | undefined) {
  const namesByCode = districtNames(normalizeDistrictCodes(row?.carrier_district_codes))
  if (namesByCode.length) return namesByCode
  return Array.isArray(row?.carrier_district_names)
    ? Array.from(new Set(row.carrier_district_names.map(name => String(name || '').trim()).filter(Boolean)))
    : []
}

function selectedTransportProvinceCodes(row: Partial<BusTransportDoc> | null | undefined) {
  const codes = normalizeProvinceCodes(row?.selected_province_codes)
  if (codes.length) return codes
  return row?.selected_province_code ? normalizeProvinceCodes([row.selected_province_code]) : []
}

function selectedTransportProvinceNames(row: Partial<BusTransportDoc> | null | undefined) {
  const namesByCode = provinceNames(selectedTransportProvinceCodes(row))
  if (namesByCode.length) return namesByCode
  return String(row?.selected_province_name || '').trim() ? [String(row?.selected_province_name).trim()] : []
}

function selectedTransportDistrictNames(row: Partial<BusTransportDoc> | null | undefined) {
  const namesByCode = districtNames(normalizeDistrictCodes(row?.selected_district_codes))
  if (namesByCode.length) return namesByCode
  return Array.isArray(row?.selected_district_names)
    ? Array.from(new Set(row.selected_district_names.map(name => String(name || '').trim()).filter(Boolean)))
    : []
}

function normalizedCarrier(id: string, data: Record<string, any>) {
  return {
    id,
    ...data,
    carrier_address: String(data.carrier_address || ''),
    service_province_codes: normalizeProvinceCodes(data.service_province_codes),
    service_province_names: Array.isArray(data.service_province_names)
      ? data.service_province_names.map((name: any) => String(name || '').trim()).filter(Boolean)
      : [],
    service_district_codes: normalizeDistrictCodes(data.service_district_codes),
    service_district_names: Array.isArray(data.service_district_names)
      ? data.service_district_names.map((name: any) => String(name || '').trim()).filter(Boolean)
      : [],
  } as TransportCarrierDoc
}

function normalizedTransport(id: string, data: Record<string, any>) {
  return {
    id,
    ...data,
    carrier_address: String(data.carrier_address || ''),
    carrier_province_codes: normalizeProvinceCodes(data.carrier_province_codes),
    carrier_province_names: Array.isArray(data.carrier_province_names)
      ? data.carrier_province_names.map((name: any) => String(name || '').trim()).filter(Boolean)
      : [],
    carrier_district_codes: normalizeDistrictCodes(data.carrier_district_codes),
    carrier_district_names: Array.isArray(data.carrier_district_names)
      ? data.carrier_district_names.map((name: any) => String(name || '').trim()).filter(Boolean)
      : [],
    selected_province_codes: normalizeProvinceCodes(data.selected_province_codes),
    selected_province_names: Array.isArray(data.selected_province_names)
      ? data.selected_province_names.map((name: any) => String(name || '').trim()).filter(Boolean)
      : [],
    selected_district_codes: normalizeDistrictCodes(data.selected_district_codes),
    selected_district_names: Array.isArray(data.selected_district_names)
      ? data.selected_district_names.map((name: any) => String(name || '').trim()).filter(Boolean)
      : [],
    selected_province_code: data.selected_province_code ? Number(data.selected_province_code) : null,
    selected_province_name: String(data.selected_province_name || ''),
  } as BusTransportDoc
}

function timestampValue(value: any) {
  if (value?.toMillis) return value.toMillis()
  const date = new Date(value || 0)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function requestCode(row: ExportRequestDoc | null | undefined) {
  return String(row?.request_id || row?.id || '').trim()
}

function statusKey(value: any) {
  return normalizeText(value).replace(/\s+/g, '_')
}

function isRejectedRequest(row: ExportRequestDoc | null | undefined) {
  return ['tu_choi', 'rejected'].includes(statusKey(row?.status))
}

function requestStatusLabel(value: any) {
  const key = statusKey(value)
  return ({
    cho_xu_ly: 'Chờ xử lý',
    dang_xu_ly: 'Đang xử lý',
    da_tiep_nhan: 'Đã tiếp nhận/chờ xuất kho',
    cho_xuat_kho: 'Đã tiếp nhận/chờ xuất kho',
    da_xuat: 'Đã xuất kho',
    loi: 'Lỗi xử lý',
  } as Record<string, string>)[key] || String(value || '-')
}

const activeRequests = computed(() => requests.value.filter(row => isActive(row) && !isRejectedRequest(row)))
const usedRequestIds = computed(() => new Set(
  rows.value.filter(isActive).map(row => String(row.source_request_id || '')).filter(Boolean),
))

const requestOptions = computed(() => activeRequests.value
  .filter(row => !usedRequestIds.value.has(row.id) || editing.value?.source_request_id === row.id)
  .map(row => ({
    value: row.id,
    label: `${requestCode(row)} - ${row.customer_name || 'Chưa có khách hàng'}`,
    subLabel: `${row.order_code || 'Không có mã đơn'} · ${requestStatusLabel(row.status)}`,
    search: `${requestCode(row)} ${row.order_code || ''} ${row.customer_name || ''} ${requestStatusLabel(row.status)}`,
  })))

const provinceFilterOptions = computed(() => provinceOptions.value)
const districtFilterOptions = computed(() => districtOptionsForProvinceCodes(carrierProvinceFilter.value))

const selectedCarrier = computed(() => carriers.value.find(row => row.id === form.transport_carrier_id) || null)
const selectedRequest = computed(() => requests.value.find(row => row.id === form.source_request_id) || null)
const selectedRequestItems = computed(() => selectedRequest.value
  ? requestLineProgress(selectedRequest.value).map((line: any) => ({
      id: line.order_item_id || `${line.product_code || ''}|${line.logo || ''}`,
      source_request_id: selectedRequest.value?.id || '',
      product_id: line.product_id || '',
      product_code: line.product_code || '',
      product_name: line.product_name || '',
      logo: line.logo || '',
      unit: line.unit || '',
      quantity: toNumber(line.exported_qty) > 0 ? toNumber(line.exported_qty) : toNumber(line.requested_qty),
      active: true,
      deleted: false,
    })).filter((item: any) => item.quantity > 0)
  : [])

function carrierMatchesLocationFilters(row: Partial<TransportCarrierDoc> | null | undefined) {
  if (!row) return false
  const provinceCodes = normalizeProvinceCodes(carrierProvinceFilter.value)
  const districtCodes = normalizeDistrictCodes(carrierDistrictFilter.value)
  const carrierProvinceCodes = normalizeProvinceCodes(row.service_province_codes)
  const carrierDistrictCodes = normalizeDistrictCodes(row.service_district_codes)
  if (provinceCodes.length && !provinceCodes.some(code => carrierProvinceCodes.includes(code))) return false
  if (districtCodes.length && !districtCodes.some(code => carrierDistrictCodes.includes(code))) return false
  return true
}

const filteredCarrierCards = computed(() => {
  const keyword = normalizeText(carrierKeyword.value)
  return carriers.value.filter(row => {
    if (!carrierMatchesLocationFilters(row)) return false
    if (!keyword) return true
    return normalizeText([
      row.carrier_code,
      row.carrier_name,
      row.carrier_phone,
      row.carrier_address,
      row.driver_name,
      carrierServiceProvinceNames(row).join(' '),
      carrierServiceDistrictNames(row).join(' '),
    ].join(' ')).includes(keyword)
  })
})

const selectedCarrierProvinceText = computed(() => {
  const names = Array.isArray(form.carrier_province_names)
    ? form.carrier_province_names.map((name: any) => String(name || '').trim()).filter(Boolean)
    : provinceNames(normalizeProvinceCodes(form.carrier_province_codes))
  return names.join(', ')
})

const selectedCarrierDistrictText = computed(() => {
  const names = Array.isArray(form.carrier_district_names)
    ? form.carrier_district_names.map((name: any) => String(name || '').trim()).filter(Boolean)
    : districtNames(normalizeDistrictCodes(form.carrier_district_codes))
  return names.join(', ')
})

const filtered = computed(() => {
  const keyword = normalizeText(search.value)
  return rows.value.filter(row => {
    const text = normalizeText([
      row.transport_code,
      row.request_code,
      row.export_order_code,
      row.order_code,
      row.customer_name,
      row.receiver_name,
      row.receiver_phone,
      row.receiver_address,
      row.carrier_name,
      row.carrier_phone,
      row.carrier_address,
      row.driver_name,
      selectedTransportProvinceNames(row).join(' '),
      selectedTransportDistrictNames(row).join(' '),
      transportCarrierProvinceNames(row).join(' '),
      transportCarrierDistrictNames(row).join(' '),
      row.transport_status,
    ].join(' '))
    return (!keyword || text.includes(keyword))
      && (!statusFilter.value || row.transport_status === statusFilter.value)
  })
})

const summary = computed(() => rows.value.reduce((out, row) => {
  out.total++
  if (row.transport_status === 'Chờ xuất phát') out.pending++
  if (row.transport_status === 'Đã xuất phát') out.departed++
  if (row.transport_status === 'Đã hoàn thành') out.completed++
  return out
}, { total: 0, pending: 0, departed: 0, completed: 0 }))

function resetForm() {
  Object.keys(form).forEach(key => delete form[key])
}

function requestRecipient(row: any) {
  const payload = safeJsonParse(row?.payload_json, {})
  return {
    customer_id: row?.customer_id || payload?.customer_id || '',
    receiver_name: row?.receiver_name || payload?.receiver_name || row?.customer_name || payload?.customer_name || '',
    receiver_phone: row?.receiver_phone || payload?.receiver_phone || '',
    receiver_address: row?.receiver_address || payload?.receiver_address || '',
  }
}

function findCarrierSnapshot(row: Partial<BusTransportDoc>) {
  if (row.transport_carrier_id) return carriers.value.find(item => item.id === row.transport_carrier_id) || null
  const name = normalizeText(row.carrier_name || '')
  const phone = normalizeText(row.carrier_phone || '')
  return carriers.value.find(item => (
    name && normalizeText(item.carrier_name) === name
    && (!phone || normalizeText(item.carrier_phone || '') === phone)
  )) || null
}

function clearCarrierSelection() {
  Object.assign(form, {
    transport_carrier_id: '',
    carrier_name: '',
    carrier_phone: '',
    carrier_address: '',
    carrier_province_codes: [],
    carrier_province_names: [],
    carrier_district_codes: [],
    carrier_district_names: [],
    driver_name: '',
  })
}

function selectCarrier(carrier: TransportCarrierDoc) {
  const codes = normalizeProvinceCodes(carrier.service_province_codes)
  const names = carrierServiceProvinceNames(carrier)
  const districtCodes = normalizeDistrictCodes(carrier.service_district_codes)
  const districtNames = carrierServiceDistrictNames(carrier)
  Object.assign(form, {
    transport_carrier_id: carrier.id,
    carrier_name: carrier.carrier_name || '',
    carrier_phone: carrier.carrier_phone || '',
    carrier_address: carrier.carrier_address || '',
    carrier_province_codes: codes,
    carrier_province_names: names,
    carrier_district_codes: districtCodes,
    carrier_district_names: districtNames,
    driver_name: carrier.driver_name || '',
  })
}

async function onCarrierProvinceFilterChange() {
  const provinceCodes = normalizeProvinceCodes(carrierProvinceFilter.value)
  if (!provinceCodes.length) {
    carrierDistrictFilter.value = []
  } else {
    await loadDistricts()
    const allowedDistrictCodes = new Set(districtOptionsForProvinceCodes(carrierProvinceFilter.value).map(option => Number(option.value)))
    carrierDistrictFilter.value = normalizeDistrictCodes(carrierDistrictFilter.value).filter(code => allowedDistrictCodes.has(code))
  }
  const current = selectedCarrier.value
  if (current && !carrierMatchesLocationFilters(current)) {
    clearCarrierSelection()
    showToast('Nhà xe đã chọn không phù hợp khu vực đang lọc.', 'info')
  }
}

function onCarrierDistrictFilterChange() {
  const current = selectedCarrier.value
  if (current && !carrierMatchesLocationFilters(current)) {
    clearCarrierSelection()
    showToast('Nhà xe đã chọn không phục vụ huyện đang lọc.', 'info')
  }
}

async function chooseRequest() {
  const request = selectedRequest.value
  if (!request) return
  const receiver = requestRecipient(request)
  Object.assign(form, {
    source_request_id: request.id,
    request_code: requestCode(request),
    request_status: request.status || '',
    export_order_id: String(activeExportOrderId(request) || ''),
    export_order_code: request.warehouse_export_code || '',
    order_id: request.order_id || '',
    order_code: request.order_code || '',
    customer_id: receiver.customer_id,
    customer_name: receiver.receiver_name,
    receiver_name: receiver.receiver_name,
    receiver_phone: receiver.receiver_phone,
    receiver_address: receiver.receiver_address,
  })
}

async function openModal(row?: BusTransportDoc) {
  if (row && !canEdit.value) return showToast('Bạn không có quyền sửa đơn vận chuyển nhà xe.', 'error')
  if (!row && !canCreate.value) return showToast('Bạn không có quyền tạo đơn vận chuyển nhà xe.', 'error')
  editing.value = row || null
  carrierKeyword.value = ''
  resetForm()
  if (row) {
    const matchedCarrier = findCarrierSnapshot(row)
    carrierProvinceFilter.value = selectedTransportProvinceCodes(row)
    carrierDistrictFilter.value = normalizeDistrictCodes(row.selected_district_codes)
    if (carrierProvinceFilter.value.length) await loadDistricts()
    Object.assign(form, {
      ...row,
      source_request_id: row.source_request_id || '',
      request_code: row.request_code || row.export_order_code || '',
      request_status: row.request_status || '',
      transport_carrier_id: matchedCarrier?.id || row.transport_carrier_id || '',
      carrier_name: row.carrier_name || '',
      carrier_phone: row.carrier_phone || '',
      carrier_address: row.carrier_address || '',
      carrier_province_codes: normalizeProvinceCodes(row.carrier_province_codes),
      carrier_province_names: transportCarrierProvinceNames(row),
      carrier_district_codes: normalizeDistrictCodes(row.carrier_district_codes),
      carrier_district_names: transportCarrierDistrictNames(row),
      driver_name: row.driver_name || '',
      departure_at: row.departure_at || '',
      transport_status: row.transport_status || 'Chờ xuất phát',
      note: row.note || '',
    })
    if (row.source_request_id) await chooseRequest()
  } else {
    carrierProvinceFilter.value = []
    carrierDistrictFilter.value = []
    Object.assign(form, {
      source_request_id: '', request_code: '', request_status: '',
      export_order_id: '', export_order_code: '', order_id: '', order_code: '',
      customer_id: '', customer_name: '', receiver_name: '', receiver_phone: '', receiver_address: '',
      transport_carrier_id: '', carrier_name: '', carrier_phone: '', carrier_address: '',
      carrier_province_codes: [], carrier_province_names: [], carrier_district_codes: [], carrier_district_names: [], driver_name: '', departure_at: '',
      transport_status: 'Chờ xuất phát', note: '',
    })
  }
  showModal.value = true
}

function activityPayload(action: string, code: string, before: any, after: any) {
  return {
    module: 'bus_transport_orders',
    action,
    item_code: code,
    item_name: `${after?.request_code || before?.request_code || ''} - ${after?.carrier_name || before?.carrier_name || ''}`,
    changed_by: appUser.value?.email || '',
    before_json: JSON.stringify(before || {}),
    after_json: JSON.stringify(after || {}),
    created_at: serverTimestamp(),
    active: true,
    deleted: false,
  }
}

async function save() {
  if (!form.source_request_id) return showToast('Vui lòng chọn yêu cầu xuất kho.', 'error')
  if (!form.transport_carrier_id) return showToast('Vui lòng chọn nhà xe.', 'error')
  if (editing.value && !canEdit.value) return showToast('Bạn không có quyền sửa đơn vận chuyển.', 'error')
  if (!editing.value && !canCreate.value) return showToast('Bạn không có quyền tạo đơn vận chuyển.', 'error')

  const source = selectedRequest.value
  if (!source || isRejectedRequest(source)) return showToast('Yêu cầu xuất kho không còn hợp lệ để tạo vận chuyển.', 'error')
  if (!editing.value && usedRequestIds.value.has(source.id)) {
    return showToast('Yêu cầu xuất kho này đã có đơn vận chuyển nhà xe đang hoạt động.', 'error')
  }

  const currentCarrier = selectedCarrier.value
  if (currentCarrier) selectCarrier(currentCarrier)
  const selectedProvinceCodes = normalizeProvinceCodes(carrierProvinceFilter.value)
  const selectedProvinceNames = provinceNames(selectedProvinceCodes)
  const selectedDistrictCodes = normalizeDistrictCodes(carrierDistrictFilter.value)
  if (selectedDistrictCodes.length) await loadDistricts()
  const allowedDistrictCodes = new Set(districtOptionsForProvinceCodes(selectedProvinceCodes).map(option => Number(option.value)))
  const selectedDistrictNames = districtNames(selectedDistrictCodes)
  const carrierProvinceCodes = normalizeProvinceCodes(form.carrier_province_codes)
  const carrierProvinceNames = provinceNames(carrierProvinceCodes)
  const carrierDistrictCodes = normalizeDistrictCodes(form.carrier_district_codes)
  const carrierDistrictNames = districtNames(carrierDistrictCodes)
  if (selectedDistrictCodes.some(code => !allowedDistrictCodes.has(code)) || selectedDistrictNames.length !== selectedDistrictCodes.length) {
    return showToast('Danh sách huyện chưa sẵn sàng hoặc không thuộc tỉnh thành đang lọc.', 'error')
  }
  if (currentCarrier && !carrierMatchesLocationFilters(currentCarrier)) {
    return showToast('Nhà xe đã chọn không phục vụ khu vực đang lọc.', 'error')
  }

  saving.value = true
  await withLoading(async () => {
    await chooseRequest()
    const nowEmail = appUser.value?.email || ''
    const batch = writeBatch(db)
    const carrierSnapshot = {
      transport_carrier_id: String(form.transport_carrier_id || '').trim(),
      carrier_name: String(form.carrier_name || '').trim(),
      carrier_phone: String(form.carrier_phone || '').trim(),
      carrier_address: String(form.carrier_address || '').trim(),
        carrier_province_codes: carrierProvinceCodes,
        carrier_province_names: carrierProvinceNames,
        carrier_district_codes: carrierDistrictCodes,
        carrier_district_names: carrierDistrictNames,
        selected_province_codes: selectedProvinceCodes,
        selected_province_names: selectedProvinceNames,
        selected_district_codes: selectedDistrictCodes,
        selected_district_names: selectedDistrictNames,
      driver_name: String(form.driver_name || '').trim(),
    }

    if (editing.value) {
      const patch = {
        receiver_name: String(form.receiver_name || '').trim(),
        receiver_phone: String(form.receiver_phone || '').trim(),
        receiver_address: String(form.receiver_address || '').trim(),
        ...carrierSnapshot,
        departure_at: String(form.departure_at || '').trim(),
        transport_status: form.transport_status || 'Chờ xuất phát',
        note: String(form.note || '').trim(),
        updated_by: nowEmail,
        updated_at: serverTimestamp(),
      }
      batch.update(doc(db, 'bus_transport_orders', editing.value.id), patch)
      batch.set(doc(collection(db, 'activity_logs')), activityPayload('update', editing.value.transport_code || editing.value.id, editing.value, patch))
    } else {
      const id = makeId('bus_transport')
      const transportCode = makeCode('VCNX')
      const payload = {
        id,
        transport_code: transportCode,
        source_request_id: source.id,
        request_code: requestCode(source),
        request_status: source.status || '',
        export_order_id: String(activeExportOrderId(source) || ''),
        export_order_code: source.warehouse_export_code || '',
        order_id: form.order_id || '',
        order_code: form.order_code || '',
        customer_id: form.customer_id || '',
        customer_name: form.customer_name || '',
        receiver_name: form.receiver_name || '',
        receiver_phone: form.receiver_phone || '',
        receiver_address: form.receiver_address || '',
        ...carrierSnapshot,
        departure_at: String(form.departure_at || '').trim(),
        transport_status: form.transport_status || 'Chờ xuất phát',
        note: String(form.note || '').trim(),
        items_json: JSON.stringify(selectedRequestItems.value),
        status: 'active', active: true, deleted: false,
        created_by: nowEmail, created_at: serverTimestamp(), updated_by: nowEmail, updated_at: serverTimestamp(),
        source: 'bus_transport',
      }
      batch.set(doc(db, 'bus_transport_orders', id), payload)
      batch.set(doc(collection(db, 'activity_logs')), activityPayload('create', transportCode, null, payload))
    }
    await batch.commit()
    invalidateScopedCache('bus_transport_orders')
    invalidateScopedCache('activity_logs')
    showModal.value = false
    await loadRows(true)
    showToast(editing.value ? 'Đã cập nhật đơn vận chuyển nhà xe.' : 'Đã tạo đơn vận chuyển nhà xe.', 'success')
  }).catch(error => showToast(reportFirebaseError(error, 'Không lưu được đơn vận chuyển nhà xe.'), 'error'))
    .finally(() => { saving.value = false })
}

async function remove(row: BusTransportDoc) {
  if (!canDelete.value) return showToast('Bạn không có quyền xóa đơn vận chuyển nhà xe.', 'error')
  const confirmed = await askConfirm({ title: 'Xóa đơn vận chuyển nhà xe', message: `Bạn chắc chắn muốn xóa ${row.transport_code || row.id}?`, confirmLabel: 'Xóa đơn vận chuyển' })
  if (!confirmed) return
  await withLoading(async () => {
    const batch = writeBatch(db)
    const patch = {
      deleted: true, active: false, status: 'deleted',
      deleted_by: appUser.value?.email || '', deleted_at: serverTimestamp(),
      updated_by: appUser.value?.email || '', updated_at: serverTimestamp(),
    }
    batch.update(doc(db, 'bus_transport_orders', row.id), patch)
    batch.set(doc(collection(db, 'activity_logs')), activityPayload('delete', row.transport_code || row.id, row, patch))
    await batch.commit()
    rows.value = rows.value.filter(item => item.id !== row.id)
    invalidateScopedCache('bus_transport_orders')
    invalidateScopedCache('activity_logs')
    showToast('Đã xóa đơn vận chuyển nhà xe.', 'success')
  }).catch(error => showToast(reportFirebaseError(error, 'Không xóa được đơn vận chuyển nhà xe.'), 'error'))
}

function openDetail(row: BusTransportDoc) {
  selectedDetail.value = row
  showDetailModal.value = true
}

function itemSnapshot(row: BusTransportDoc) {
  const value = safeJsonParse(row.items_json, [])
  return Array.isArray(value) ? value as Array<Record<string, any>> : []
}

async function openPrint(row: BusTransportDoc) {
  const request = requests.value.find(item => item.id === row.source_request_id) || null
  selectedPrint.value = row
  selectedPrintRequest.value = request
  selectedPrintItems.value = request
    ? requestLineProgress(request).map((line: any) => ({
        product_code: line.product_code || '', product_name: line.product_name || '', logo: line.logo || '',
        quantity: toNumber(line.exported_qty) > 0 ? toNumber(line.exported_qty) : toNumber(line.requested_qty),
        active: true, deleted: false,
      })).filter((item: any) => item.quantity > 0)
    : itemSnapshot(row)
}

async function loadRows(force = false) {
  if (!canView.value) return
  loading.value = true
  try {
    const [transportSnapshot, requestSnapshot, carrierSnapshot] = await Promise.all([
      getDocs(collection(db, 'bus_transport_orders')),
      getDocs(collection(db, 'order_export_requests')),
      getDocs(collection(db, 'transport_carriers')),
    ])
    rows.value = transportSnapshot.docs
      .map(item => normalizedTransport(item.id, item.data() || {}))
      .filter(isActive)
      .sort((left, right) => timestampValue(right.updated_at || right.created_at) - timestampValue(left.updated_at || left.created_at))
    requests.value = requestSnapshot.docs.map(item => ({ id: item.id, ...(item.data() || {}) } as ExportRequestDoc)).filter(isActive)
    carriers.value = carrierSnapshot.docs
      .map(item => normalizedCarrier(item.id, item.data() || {}))
      .filter(isActive)
      .sort((left, right) => String(left.carrier_name || '').localeCompare(String(right.carrier_name || ''), 'vi'))
    if (force) showToast('Đã làm mới dữ liệu vận chuyển nhà xe.', 'success')
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được dữ liệu vận chuyển nhà xe.'), 'error')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadProvinces()
  void loadRows()
})
</script>

<template>
  <AppShell>
    <PageHeader title="Vận chuyển nhà xe" subtitle="Lọc nhà xe theo tỉnh thành, huyện và tạo đơn từ yêu cầu xuất kho">
      <button class="btn" @click="loadRows(true)">Làm mới</button>
      <button v-if="canCreate" class="btn primary" @click="openModal()">+ Tạo đơn vận chuyển</button>
    </PageHeader>

    <div class="summary-grid">
      <div class="summary-card"><label>Tổng đơn</label><strong>{{ summary.total.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Chờ xuất phát</label><strong>{{ summary.pending.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Đã xuất phát</label><strong>{{ summary.departed.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Hoàn thành</label><strong>{{ summary.completed.toLocaleString('vi-VN') }}</strong></div>
    </div>

    <div class="card" style="margin:24px">
      <div class="filter-bar">
        <input v-model="search" class="input" placeholder="Tìm mã vận chuyển, yêu cầu xuất, khách hàng, nhà xe, tỉnh thành..." />
        <select v-model="statusFilter" class="select"><option value="">Tất cả trạng thái</option><option>Chờ xuất phát</option><option>Đã xuất phát</option><option>Đã hoàn thành</option></select>
      </div>

      <LoadingState v-if="loading" />
      <div v-else-if="!canView" class="empty">Bạn không có quyền xem vận chuyển nhà xe.</div>
      <div v-else class="table-wrap">
        <table style="min-width:1320px">
          <thead><tr><th>Mã vận chuyển</th><th>Yêu cầu xuất</th><th>Trạng thái YC</th><th>Đơn hàng</th><th>Khách hàng</th><th>Nhà xe</th><th>Tỉnh vận chuyển</th><th>Giờ xuất phát</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td><b>{{ row.transport_code || row.id }}</b></td>
              <td>{{ row.request_code || row.export_order_code || '-' }}</td>
              <td>{{ requestStatusLabel(row.request_status) }}</td>
              <td>{{ row.order_code || '-' }}</td>
              <td>{{ row.customer_name || row.receiver_name || '-' }}<div class="small subtle">{{ row.receiver_phone || '' }}</div></td>
              <td><b>{{ row.carrier_name || '-' }}</b><div class="small subtle">{{ row.carrier_phone || '' }}</div><div v-if="row.carrier_address" class="small subtle">{{ row.carrier_address }}</div></td>
              <td><b>{{ selectedTransportProvinceNames(row).join(', ') || transportCarrierProvinceNames(row).join(', ') || '-' }}</b><div v-if="selectedTransportDistrictNames(row).length" class="small subtle">{{ selectedTransportDistrictNames(row).join(', ') }}</div></td>
              <td>{{ row.departure_at ? formatDateTime(row.departure_at) : '-' }}</td>
              <td><span class="badge">{{ row.transport_status || 'Chờ xuất phát' }}</span></td>
              <td><div class="action-buttons"><button class="btn-sm btn-view" @click="openDetail(row)">Xem</button><button class="btn-sm btn-view" @click="openPrint(row)">In tem</button><button v-if="canEdit" class="btn-sm" @click="openModal(row)">Sửa</button><button v-if="canDelete" class="btn-sm btn-delete" @click="remove(row)">Xóa</button></div></td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="10" class="empty">Không có đơn vận chuyển nhà xe phù hợp.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <BaseModal v-if="showModal" :title="editing ? 'Sửa đơn vận chuyển nhà xe' : 'Tạo đơn vận chuyển nhà xe'" size="xl" :loading="saving" :save-label="editing ? 'Lưu thay đổi' : 'Tạo đơn vận chuyển'" @close="showModal=false" @save="save">
      <div class="form-grid">
        <div class="form-group full"><label>Yêu cầu xuất kho <span class="required">*</span></label><SearchableSelect v-model="form.source_request_id" :options="requestOptions" :disabled="Boolean(editing)" placeholder="Tìm mã yêu cầu, mã đơn hoặc khách hàng..." @change="chooseRequest" /></div>
        <div class="form-group"><label>Mã yêu cầu</label><input v-model="form.request_code" class="input readonly-field" readonly /></div>
        <div class="form-group"><label>Trạng thái yêu cầu</label><input :value="requestStatusLabel(form.request_status)" class="input readonly-field" readonly /></div>
        <div class="form-group"><label>Mã đơn hàng</label><input v-model="form.order_code" class="input readonly-field" readonly /></div>
        <div class="form-group"><label>Họ tên người nhận</label><input v-model="form.receiver_name" class="input readonly-field" readonly /></div>
        <div class="form-group"><label>Số điện thoại người nhận</label><input v-model="form.receiver_phone" class="input readonly-field" readonly /></div>
        <div class="form-group full"><label>Địa chỉ nhận</label><input v-model="form.receiver_address" class="input readonly-field" readonly /></div>

        <div class="form-group full carrier-picker">
          <div class="carrier-picker-heading"><div><label>Chọn nhà xe <span class="required">*</span></label><p class="small subtle">Chọn tỉnh thành để chỉ hiển thị các nhà xe có phục vụ khu vực đó.</p></div><span class="small subtle">{{ filteredCarrierCards.length.toLocaleString('vi-VN') }} nhà xe phù hợp</span></div>
          <div class="carrier-picker-filters">
            <SearchableMultiSelect v-model="carrierProvinceFilter" :options="provinceFilterOptions" placeholder="Tất cả tỉnh thành" search-placeholder="Tìm tỉnh thành không dấu..." @change="onCarrierProvinceFilterChange" />
            <SearchableMultiSelect v-model="carrierDistrictFilter" :options="districtFilterOptions" :disabled="!carrierProvinceFilter.length || districtsLoading" placeholder="Tất cả huyện" search-placeholder="Tìm huyện không dấu..." @change="onCarrierDistrictFilterChange" />
            <input v-model="carrierKeyword" class="input" placeholder="Tìm tên, số điện thoại, địa chỉ hoặc tài xế..." />
          </div>
          <div v-if="filteredCarrierCards.length" class="carrier-card-grid">
            <button
              v-for="carrier in filteredCarrierCards"
              :key="carrier.id"
              type="button"
              class="carrier-card"
              :class="{ selected: form.transport_carrier_id === carrier.id }"
              @click="selectCarrier(carrier)"
            >
              <div class="carrier-card-title"><strong>{{ carrier.carrier_name || '-' }}</strong><span v-if="form.transport_carrier_id === carrier.id">✓ Đã chọn</span></div>
              <div class="carrier-meta">{{ [carrier.carrier_phone, carrier.driver_name].filter(Boolean).join(' · ') || 'Chưa có số điện thoại hoặc tài xế' }}</div>
              <div class="carrier-address">{{ carrier.carrier_address || 'Chưa thiết lập địa chỉ' }}</div>
              <div v-if="carrierServiceProvinceNames(carrier).length" class="province-chips"><span v-for="name in carrierServiceProvinceNames(carrier).slice(0, 4)" :key="name" class="province-chip">{{ name }}</span><span v-if="carrierServiceProvinceNames(carrier).length > 4" class="province-chip more">+{{ carrierServiceProvinceNames(carrier).length - 4 }}</span></div>
              <div v-else class="small warning-text">Chưa thiết lập tỉnh thành phục vụ</div>
              <div v-if="carrierServiceDistrictNames(carrier).length" class="province-chips"><span v-for="name in carrierServiceDistrictNames(carrier).slice(0, 4)" :key="name" class="province-chip district-chip">{{ name }}</span><span v-if="carrierServiceDistrictNames(carrier).length > 4" class="province-chip more">+{{ carrierServiceDistrictNames(carrier).length - 4 }}</span></div>
            </button>
          </div>
          <div v-else class="empty carrier-empty">Không có nhà xe phục vụ tỉnh thành hoặc từ khóa này.</div>
          <div v-if="form.transport_carrier_id && !selectedCarrier" class="legacy-carrier"><strong>Nhà xe hiện tại của đơn:</strong> {{ form.carrier_name || form.transport_carrier_id }}. Nhà xe này có thể đã ngừng hoạt động hoặc không còn trong danh mục.</div>
        </div>

        <div class="form-group"><label>Tên nhà xe</label><input v-model="form.carrier_name" class="input readonly-field" readonly /></div>
        <div class="form-group"><label>Số điện thoại nhà xe</label><input v-model="form.carrier_phone" class="input readonly-field" readonly /></div>
        <div class="form-group"><label>Tên chủ xe/Tài xế</label><input v-model="form.driver_name" class="input readonly-field" readonly /></div>
        <div class="form-group"><label>Tỉnh thành phục vụ</label><input :value="selectedCarrierProvinceText" class="input readonly-field" readonly /></div>
        <div class="form-group full"><label>Huyện phục vụ</label><input :value="selectedCarrierDistrictText || 'Phục vụ toàn bộ tỉnh thành đã chọn'" class="input readonly-field" readonly /></div>
        <div class="form-group full"><label>Địa chỉ nhà xe</label><input v-model="form.carrier_address" class="input readonly-field" readonly /></div>
        <div class="form-group"><label>Giờ bắt đầu xuất phát</label><input v-model="form.departure_at" class="input" type="datetime-local" /></div>
        <div class="form-group"><label>Trạng thái vận chuyển</label><select v-model="form.transport_status" class="select"><option>Chờ xuất phát</option><option>Đã xuất phát</option><option>Đã hoàn thành</option></select></div>
        <div class="form-group full"><label>Ghi chú</label><textarea v-model="form.note" class="textarea" rows="3" /></div>
      </div>

      <template v-if="selectedRequest">
        <h3 style="margin-top:18px">Sản phẩm trong yêu cầu xuất kho</h3>
        <div class="table-wrap"><table style="min-width:760px"><thead><tr><th>Sản phẩm</th><th>Mã SP</th><th>Logo</th><th>Đơn vị</th><th>Số lượng</th></tr></thead><tbody><tr v-for="item in selectedRequestItems" :key="item.id"><td><b>{{ item.product_name || '-' }}</b></td><td>{{ item.product_code || '-' }}</td><td>{{ item.logo || '-' }}</td><td>{{ item.unit || '-' }}</td><td>{{ item.quantity }}</td></tr><tr v-if="!selectedRequestItems.length"><td colspan="5" class="empty">Yêu cầu chưa có sản phẩm.</td></tr></tbody></table></div>
      </template>
      <p class="small subtle" style="margin-top:12px">Họ tên, số điện thoại và địa chỉ lấy từ snapshot của yêu cầu xuất kho. Thông tin nhà xe, địa chỉ và tỉnh thành được lưu snapshot tại thời điểm tạo vận chuyển.</p>
    </BaseModal>

    <BaseModal v-if="showDetailModal && selectedDetail" title="Chi tiết vận chuyển nhà xe" size="lg" :show-footer="false" @close="showDetailModal=false">
      <div class="detail-grid">
        <div class="detail-item"><label>Mã vận chuyển</label><strong>{{ selectedDetail.transport_code || selectedDetail.id }}</strong></div>
        <div class="detail-item"><label>Yêu cầu xuất</label><strong>{{ selectedDetail.request_code || selectedDetail.export_order_code || '-' }}</strong></div>
        <div class="detail-item"><label>Đơn hàng</label><strong>{{ selectedDetail.order_code || '-' }}</strong></div>
        <div class="detail-item"><label>Người nhận</label><strong>{{ selectedDetail.receiver_name || '-' }}</strong></div>
        <div class="detail-item"><label>SĐT người nhận</label><strong>{{ selectedDetail.receiver_phone || '-' }}</strong></div>
        <div class="detail-item"><label>Địa chỉ nhận</label><strong>{{ selectedDetail.receiver_address || '-' }}</strong></div>
        <div class="detail-item"><label>Nhà xe</label><strong>{{ selectedDetail.carrier_name || '-' }}</strong></div>
        <div class="detail-item"><label>SĐT nhà xe</label><strong>{{ selectedDetail.carrier_phone || '-' }}</strong></div>
        <div class="detail-item"><label>Chủ xe/Tài xế</label><strong>{{ selectedDetail.driver_name || '-' }}</strong></div>
        <div class="detail-item detail-full"><label>Tỉnh vận chuyển</label><strong>{{ selectedTransportProvinceNames(selectedDetail).join(', ') || '-' }}</strong></div>
        <div class="detail-item detail-full"><label>Huyện vận chuyển</label><strong>{{ selectedTransportDistrictNames(selectedDetail).join(', ') || '-' }}</strong></div>
        <div class="detail-item detail-full"><label>Địa chỉ nhà xe</label><strong>{{ selectedDetail.carrier_address || '-' }}</strong></div>
        <div class="detail-item detail-full"><label>Tỉnh thành nhà xe phục vụ</label><strong>{{ transportCarrierProvinceNames(selectedDetail).join(', ') || '-' }}</strong></div>
        <div class="detail-item detail-full"><label>Huyện nhà xe phục vụ</label><strong>{{ transportCarrierDistrictNames(selectedDetail).join(', ') || 'Phục vụ toàn bộ tỉnh thành đã chọn' }}</strong></div>
        <div class="detail-item"><label>Giờ xuất phát</label><strong>{{ selectedDetail.departure_at ? formatDateTime(selectedDetail.departure_at) : '-' }}</strong></div>
        <div class="detail-item"><label>Trạng thái</label><strong>{{ selectedDetail.transport_status || '-' }}</strong></div>
      </div>
    </BaseModal>

    <ParcelLabelPrintModal v-if="selectedPrint" type="bus_carrier" :source-code="selectedPrint.request_code || selectedPrint.export_order_code || selectedPrint.id" :items="selectedPrintItems" :bus-transport="selectedPrint" :request="selectedPrintRequest" @close="selectedPrint=null; selectedPrintRequest=null; selectedPrintItems=[]" />
    <ConfirmModal v-bind="confirmState" @cancel="resolveConfirm(false)" @confirm="resolveConfirm(true)" />
  </AppShell>
</template>

<style scoped>
.filter-bar { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 12px; margin-bottom: 16px; }
.form-group.full { grid-column: 1 / -1; }
.required { color: #dc2626; }
.carrier-picker { padding: 16px; border: 1px solid #dbeafe; border-radius: 12px; background: #f8fbff; }
.carrier-picker-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:12px; }
.carrier-picker-heading label { display:block; margin-bottom:3px; }
.carrier-picker-heading p { margin:0; }
.carrier-picker-filters { display:grid; grid-template-columns:minmax(220px, .8fr) minmax(220px, .8fr) minmax(280px, 1.2fr); gap:10px; margin-bottom:12px; }
.carrier-card-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; max-height:430px; overflow-y:auto; padding:2px; }
.carrier-card { width:100%; display:flex; flex-direction:column; gap:7px; padding:13px; border:1px solid #cbd5e1; border-radius:11px; background:#fff; color:#0f172a; text-align:left; cursor:pointer; transition:border-color .18s ease, box-shadow .18s ease, background .18s ease; }
.carrier-card:hover { border-color:#60a5fa; box-shadow:0 5px 16px rgba(37, 99, 235, .1); }
.carrier-card.selected { border-color:#2563eb; background:#eff6ff; box-shadow:0 0 0 2px rgba(37, 99, 235, .13); }
.carrier-card-title { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
.carrier-card-title span { flex:0 0 auto; color:#1d4ed8; font-size:12px; font-weight:700; }
.carrier-meta { color:#475569; font-size:13px; }
.carrier-address { color:#334155; font-size:13px; line-height:1.4; }
.province-chips { display:flex; flex-wrap:wrap; gap:5px; }
.province-chip { display:inline-flex; padding:3px 7px; border:1px solid #bfdbfe; border-radius:999px; background:#eff6ff; color:#1d4ed8; font-size:11px; line-height:1.2; }
.province-chip.more { border-color:#cbd5e1; background:#f8fafc; color:#475569; }
.district-chip { border-color:#bbf7d0; background:#f0fdf4; color:#15803d; }
.warning-text { color:#b45309; }
.carrier-empty { padding:24px 12px; border:1px dashed #cbd5e1; border-radius:10px; background:#fff; }
.legacy-carrier { margin-top:10px; padding:10px 12px; border:1px solid #fcd34d; border-radius:9px; background:#fffbeb; color:#92400e; font-size:13px; }
.detail-full { grid-column:1 / -1; }
@media (max-width: 800px) { .carrier-picker-filters, .carrier-card-grid { grid-template-columns:1fr; } }
@media (max-width: 700px) { .filter-bar { grid-template-columns: 1fr; } .carrier-picker-heading { flex-direction:column; } }
</style>
