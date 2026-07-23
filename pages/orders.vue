<script setup lang="ts">
import { collection, doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { INVOICE_STATUS_OPTIONS, ORDER_CLASSIFICATION_OPTIONS, ORDER_STATUS_OPTIONS, VAT_RATE_OPTIONS } from '~/constants/permissions'
import type { CustomerDoc, OrderDoc, OrderItemDoc, PaymentDoc, PrintOrderDoc, PrintOrderItemDoc, ProductDoc } from '~/types/models'
import { dateTimeLocal, formatDateTime, isActive, makeId, money, normalizeText, nowDateTimeLocal, round2, safeJsonParse, toNumber } from '~/utils/format'
import { customerCodeValidationError, normalizeCustomerCode, normalizeUserCode, userCodeValidationError } from '~/utils/orderCode'
import { generateCustomerCode } from '~/utils/customerCode'
import { reportFirebaseError, reportPermissionError } from '~/utils/firebaseErrors'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { moduleActionDecision, permissionDecisionMessage } from '~/utils/permissionDecisions.mjs'
import { toDateKey } from '~/utils/listFilters'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { appendUniqueRows } from '~/utils/cursorPagination.mjs'
// @ts-ignore Shared ESM helpers are executed directly by Node client tests.
import { printingDeleteBlocker } from '~/utils/orderPrintingDeleteLock.mjs'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { orderRelationDeleteBlocker } from '~/utils/orderRelationState.mjs'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import {
  warehouseOrderDeleteBlocker,
  warehouseRequestsForDeleteCascade,
} from '~/utils/orderWarehouseDeleteLock.mjs'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { validateOrderItemEdit } from '~/utils/orderItemDependencies.mjs'

const { db } = useFirebaseServices()
const { appUser, permissions, hasPermission, isAdmin } = useAuth()
const { calcItems, computePaymentStatus, parseLogoLines } = useOrderLogic()
const { invalidateScopedCache } = useRepo()
const { saveCustomer: saveManagedCustomer } = useCustomerManagement()
const {
  loadScopedOrdersPage,
  loadScopedOrderItems,
  loadPersistedOrder,
  loadScopedPaymentsForOrders,
  loadScopedExportRequestsForOrders,
  loadScopedExportRequests,
  loadScopedCustomers,
  loadProducts,
} = useScopedQueries()
const { saveOrderAtomic } = useAtomicOrderSave()
const { reconcileOrderRelationLocks } = useAtomicOrderRelations()
const { loadPrintingDependenciesForOrders, loadPrintingProgressForOrder } = useOrderPrintingDeleteGuard()
const { showToast, withLoading } = useUi()
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()
const { buildFulfillmentRows, orderSummary, requestLineProgress } = useWarehouseLogic()

const loading = ref(false)
const saving = ref(false)
const search = ref('')
const orderStatusFilter = ref('')
const paymentStatusFilter = ref('')
const invoiceStatusFilter = ref('')
const classificationFilter = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const ownerFilter = ref('')
const rows = ref<OrderDoc[]>([])
const PAGE_SIZE = 50
const pageCursor = shallowRef<any>(null)
const hasMoreRows = ref(false)
const pageMode = ref<'cursor' | 'full'>('cursor')
const loadingMore = ref(false)
const customers = ref<CustomerDoc[]>([])
const products = ref<ProductDoc[]>([])
const itemsByOrder = ref<Record<string, OrderItemDoc[]>>({})
const paymentsByOrder = ref<Record<string, PaymentDoc[]>>({})
const exportRequests = ref<any[]>([])
const printingProgress = ref<PrintOrderDoc[]>([])
const printingProgressItems = ref<PrintOrderItemDoc[]>([])
const showModal = ref(false)
const showDetailModal = ref(false)
const selectedDetail = ref<OrderDoc | null>(null)
const selectedPrintOrder = ref<OrderDoc | null>(null)
const showCustomerModal = ref(false)
const savingCustomer = ref(false)
const editing = ref<OrderDoc | null>(null)
const pendingSyncOrderIds = ref<string[]>([])
const form = reactive<any>({})
const formItems = ref<any[]>([])
const customerForm = reactive<any>({})
let relationReconciledForUser = ''

const ownerOptions = computed(() => Array.from(new Set(rows.value.flatMap(row => [row.owner_email, row.sale_email, row.created_by]).map(value => String(value || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'vi')))

const filtered = computed(() => {
  const keyword = normalizeText(search.value)
  return rows.value.filter(row => {
    const matchedText = !keyword || normalizeText(`${row.order_code} ${row.customer_name} ${row.phone} ${row.order_classification} ${row.order_status} ${row.payment_status} ${row.invoice_status} ${row.owner_email} ${row.sale_email} ${row.created_by}`).includes(keyword)
    const matchedOrderStatus = !orderStatusFilter.value || row.order_status === orderStatusFilter.value
    const matchedPaymentStatus = !paymentStatusFilter.value || row.payment_status === paymentStatusFilter.value
    const matchedInvoiceStatus = !invoiceStatusFilter.value || row.invoice_status === invoiceStatusFilter.value
    const matchedClassification = !classificationFilter.value || row.order_classification === classificationFilter.value
    const rowDate = toDateKey(row.order_date || row.created_at)
    const matchedDateFrom = !dateFrom.value || (!!rowDate && rowDate >= dateFrom.value)
    const matchedDateTo = !dateTo.value || (!!rowDate && rowDate <= dateTo.value)
    const matchedOwner = !ownerFilter.value || [row.owner_email, row.sale_email, row.created_by].includes(ownerFilter.value)
    return matchedText && matchedOrderStatus && matchedPaymentStatus && matchedInvoiceStatus && matchedClassification && matchedDateFrom && matchedDateTo && matchedOwner
  })
})

function resetFilters() {
  search.value = ''
  orderStatusFilter.value = ''
  paymentStatusFilter.value = ''
  invoiceStatusFilter.value = ''
  classificationFilter.value = ''
  dateFrom.value = ''
  dateTo.value = ''
  ownerFilter.value = ''
}

const itemCount = computed(() => `${formItems.value.length} dòng`)
const modalTotals = computed(() => calcItems(formItems.value, form))
const selectedDetailItems = computed(() => selectedDetail.value ? (itemsByOrder.value[selectedDetail.value.id] || []) : [])
const selectedDetailRequests = computed(() => selectedDetail.value
  ? exportRequests.value.filter(request => request.order_id === selectedDetail.value?.id && isActive(request))
  : [])
const selectedPrintItems = computed(() => selectedPrintOrder.value
  ? (itemsByOrder.value[selectedPrintOrder.value.id] || [])
  : [])
const selectedPrintRequests = computed(() => selectedPrintOrder.value
  ? exportRequests.value.filter(request => request.order_id === selectedPrintOrder.value?.id && isActive(request))
  : [])
const selectedDetailProgress = computed(() => buildFulfillmentRows(selectedDetailItems.value, selectedDetailRequests.value))
const selectedDetailOrderLines = computed(() => selectedDetailItems.value.flatMap((item: any) => {
  const logos = parseLogoLines(item.logo_json)
  if (logos.length) {
    return logos.map((line: any) => {
      const quantity = toNumber(line.quantity ?? line.qty)
      const unitPrice = toNumber(line.unit_price ?? item.unit_price)
      return {
        product_code: item.product_code || '',
        product_name: item.product_name || '',
        logo: line.logo || '',
        logo_color: line.logo_color || '',
        unit: item.unit || '',
        quantity,
        unit_price: unitPrice,
        line_total: toNumber(line.line_total) || round2(quantity * unitPrice)
      }
    })
  }
  const quantity = toNumber(item.quantity)
  const unitPrice = toNumber(item.unit_price)
  return [{
    product_code: item.product_code || '',
    product_name: item.product_name || '',
    logo: '',
    logo_color: '',
    unit: item.unit || '',
    quantity,
    unit_price: unitPrice,
    line_total: toNumber(item.line_total) || round2(quantity * unitPrice)
  }]
}))

const selectedDetailRequestRows = computed(() => selectedDetailRequests.value.map((request: any) => {
  const lines = requestLineProgress(request)
  return {
    ...request,
    total_requested_qty: lines.reduce((sum: number, line: any) => sum + toNumber(line.requested_qty), 0),
    total_processed_qty: lines.reduce((sum: number, line: any) => sum + toNumber(line.processed_qty), 0),
    total_exported_qty: lines.reduce((sum: number, line: any) => sum + toNumber(line.exported_qty), 0),
    line_count: lines.length
  }
}))

const selectedDetailExportLineRows = computed(() => selectedDetailRequests.value.flatMap((request: any) =>
  requestLineProgress(request).map((line: any) => ({
    ...line,
    request_id: request.request_id || request.id,
    request_status: request.status || '',
    request_time: request.requested_at || request.created_at,
    warehouse_export_code: request.warehouse_export_code || '',
    warehouse_note: request.warehouse_note || ''
  }))
))
const customerOptions = computed(() => customers.value.map(customer => ({
  value: customer.id,
  label: `${customer.customer_code ? `[${customer.customer_code}] ` : ''}${customer.customer_name || 'Khách chưa tên'}${customer.phone ? ` - ${customer.phone}` : ''}`,
  subLabel: [customer.company_name, customer.email].filter(Boolean).join(' · '),
  search: `${customer.customer_name || ''} ${customer.phone || ''} ${customer.email || ''} ${customer.company_name || ''}`
})))
const productOptions = computed(() => products.value.map(product => ({
  value: product.id,
  label: `${product.product_code || ''} - ${product.product_name || ''}`,
  subLabel: [product.unit, (product as any).category, (product as any).packing_standard].filter(Boolean).join(' · '),
  search: `${product.product_code || ''} ${product.product_name || ''} ${product.unit || ''} ${(product as any).category || ''}`
})))

const orderDetailLabels: Record<string, string> = {
  order_code: 'Mã đơn hàng', order_date: 'Ngày giờ đơn', customer_id: 'ID khách hàng',
  order_sequence: 'Số thứ tự theo khách hàng', user_code: 'Mã người dùng', customer_code: 'Mã khách hàng',
  order_classification: 'Phân loại đơn',
  customer_name: 'Khách hàng', phone: 'Số điện thoại', sale_name: 'Sale phụ trách',
  order_status: 'Trạng thái đơn', operation_status: 'Trạng thái vận hành',
  expected_delivery_date: 'Ngày giao dự kiến', completed_date: 'Ngày hoàn thành',
  subtotal_no_vat: 'Tạm tính chưa VAT', vat_rate: 'VAT (%)', vat_amount: 'Tiền VAT',
  total_vat: 'Tổng sau VAT', discount_amount: 'Số tiền giảm giá', payable_amount: 'Giá trị sau giảm giá',
  actual_revenue: 'Tổng tiền đơn', paid_amount: 'Đã thu',
  debt_amount: 'Công nợ', payment_status: 'Trạng thái thanh toán', invoice_status: 'Trạng thái hóa đơn',
  warehouse_fulfillment_status: 'Trạng thái xuất kho', warehouse_request_status: 'Trạng thái yêu cầu kho',
  items_count: 'Số dòng sản phẩm'
}

function warehouseStatusLabel(status: any) {
  return ({
    cho_xu_ly: 'Chờ xử lý',
    dang_xu_ly: 'Đang xử lý',
    da_tiep_nhan: 'Đã tiếp nhận',
    cho_xuat_kho: 'Chờ xuất kho',
    da_xuat: 'Đã xuất kho',
    tu_choi: 'Từ chối',
    loi: 'Lỗi xử lý'
  } as any)[status] || status || '-'
}

async function loadRows(force = false, append = false) {
  if (append && (!hasMoreRows.value || loadingMore.value)) return
  if (append) loadingMore.value = true
  else loading.value = true

  try {
    const pagePromise = loadScopedOrdersPage(append ? pageCursor.value : null, PAGE_SIZE, force)
    const referencePromise = append
      ? Promise.resolve([customers.value, products.value] as const)
      : Promise.all([loadScopedCustomers(force), loadProducts(force)])

    const [page, [loadedCustomers, loadedProducts]] = await Promise.all([pagePromise, referencePromise])
    if (!append) {
      customers.value = loadedCustomers.filter(isActive)
      products.value = loadedProducts.filter(isActive)
    }

    const pageOrders = page.rows
    const [loadedItems, loadedPayments, loadedRequests, loadedPrintingDependencies] = await Promise.all([
      loadScopedOrderItems(pageOrders, force),
      loadScopedPaymentsForOrders(pageOrders, force),
      loadScopedExportRequestsForOrders(pageOrders, force),
      loadPrintingDependenciesForOrders(pageOrders),
    ])

    const itemMap: Record<string, OrderItemDoc[]> = append ? { ...itemsByOrder.value } : {}
    loadedItems.forEach(item => {
      if (!itemMap[item.order_id]) itemMap[item.order_id] = []
      itemMap[item.order_id].push(item)
    })
    itemsByOrder.value = itemMap

    const payMap: Record<string, PaymentDoc[]> = append ? { ...paymentsByOrder.value } : {}
    loadedPayments.forEach(payment => {
      if (!payMap[payment.order_id]) payMap[payment.order_id] = []
      payMap[payment.order_id].push(payment)
    })
    paymentsByOrder.value = payMap
    exportRequests.value = appendUniqueRows(append ? exportRequests.value : [], loadedRequests)
    printingProgress.value = appendUniqueRows(append ? printingProgress.value : [], loadedPrintingDependencies.printOrders)
    printingProgressItems.value = appendUniqueRows(append ? printingProgressItems.value : [], loadedPrintingDependencies.printItems)

    const enrichedRows = pageOrders.map(order => {
      const orderRequests = loadedRequests.filter(request => request.order_id === order.id && isActive(request))
      const progress = buildFulfillmentRows(itemMap[order.id] || [], orderRequests)
      const paymentSummary = computePaymentStatus(order, payMap[order.id] || [])
      return { ...order, ...paymentSummary, ...orderSummary(progress, orderRequests) }
    })

    rows.value = append ? appendUniqueRows(rows.value, enrichedRows) : enrichedRows
    const loadedOrderIds = new Set(enrichedRows.map(order => order.id))
    pendingSyncOrderIds.value = pendingSyncOrderIds.value.filter(id => !loadedOrderIds.has(id))
    pageCursor.value = page.cursor
    hasMoreRows.value = page.hasMore
    pageMode.value = page.mode
    if (!append) setTimeout(() => { void reconcileRelationLocksInBackground() }, 0)
    return true
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được danh sách đơn hàng.', {
      module: 'orders',
      operation: 'list',
      stage: force ? 'forced_refresh' : 'initial_load',
      actionPermission: 'orders.view',
    }), 'error')
    return false
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function markOrderSyncPending(orderId: string, pending: boolean) {
  const ids = new Set(pendingSyncOrderIds.value)
  if (pending) ids.add(orderId)
  else ids.delete(orderId)
  pendingSyncOrderIds.value = Array.from(ids)
}

function isOrderSyncPending(rowOrId: OrderDoc | string) {
  const id = typeof rowOrId === 'string' ? rowOrId : rowOrId.id
  return pendingSyncOrderIds.value.includes(id)
}

async function synchronizePersistedOrder(orderId: string) {
  const { order, items } = await loadPersistedOrder(orderId)
  itemsByOrder.value = {
    ...itemsByOrder.value,
    [orderId]: items,
  }

  const orderRequests = exportRequests.value
    .filter(request => request.order_id === orderId && isActive(request))
  const canonicalOrder = {
    ...order,
    ...computePaymentStatus(order, paymentsByOrder.value[orderId] || []),
    ...orderSummary(buildFulfillmentRows(items, orderRequests), orderRequests),
  } as OrderDoc
  const rowIndex = rows.value.findIndex(row => row.id === orderId)
  if (rowIndex >= 0) rows.value[rowIndex] = canonicalOrder
  else rows.value.unshift(canonicalOrder)
  markOrderSyncPending(orderId, false)
  return canonicalOrder
}

async function loadMoreRows() {
  await loadRows(false, true)
}

function normalizeItemForForm(item: any = {}) {
  const logoLines = parseLogoLines(item.logo_json || item.logos_json || item.logos)
  return {
    id: item.id || makeId('itm'),
    product_id: item.product_id || '',
    product_code: item.product_code || '',
    product_name: item.product_name || '',
    unit: item.unit || '',
    quantity: toNumber(item.quantity) || 1,
    unit_price: toNumber(item.unit_price),
    packing_standard: item.packing_standard || '',
    box_quantity: toNumber(item.box_quantity),
    odd_quantity: toNumber(item.odd_quantity),
    note: item.note || '',
    has_logo: logoLines.length > 0,
    logo_lines: logoLines.length ? logoLines : []
  }
}

function chooseCustomer() {
  const c = customers.value.find(x => x.id === form.customer_id)
  if (!c) return
  form.customer_name = c.customer_name
  form.phone = c.phone
  form.customer_code = c.customer_code || ''
}

function openCustomerModal() {
  if (!hasPermission('customers.create')) {
    showToast(reportPermissionError({
      module: 'customers',
      operation: 'create',
      missingPermissions: ['customers.create'],
    }), 'error')
    return
  }
  Object.assign(customerForm, {
    id: makeId('cus'),
    customer_code: generateCustomerCode(),
    customer_name: '',
    company_name: '',
    phone: '',
    email: '',
    tax_code: '',
    billing_address: '',
    shipping_address: '',
    source: '',
    note: '',
    status: 'active'
  })
  showCustomerModal.value = true
}

async function saveCustomer() {
  if (!hasPermission('customers.create')) {
    showToast(reportPermissionError({
      module: 'customers',
      operation: 'create',
      missingPermissions: ['customers.create'],
    }), 'error')
    return
  }
  const customerName = String(customerForm.customer_name || '').trim()
  if (!customerName) return showToast('Thiếu tên khách hàng', 'error')

  savingCustomer.value = true
  try {
    const record = await saveManagedCustomer({
      ...customerForm,
      customer_name: customerName,
      phone: String(customerForm.phone || '').trim(),
      email: String(customerForm.email || '').trim(),
      customer_name_norm: normalizeText(customerName),
      phone_norm: normalizeText(customerForm.phone).replace(/\s/g, ''),
      status: 'active',
      active: true,
      deleted: false
    }) as CustomerDoc

    customers.value = [record, ...customers.value.filter(customer => customer.id !== record.id)]
    form.customer_id = record.id
    form.customer_name = record.customer_name
    form.phone = record.phone || ''
    form.customer_code = record.customer_code || ''
    showCustomerModal.value = false
    showToast('Đã thêm và chọn khách hàng mới', 'success')
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không lưu được khách hàng.'), 'error')
  } finally {
    savingCustomer.value = false
  }
}

function chooseProduct(item: any) {
  const p = products.value.find(x => x.id === item.product_id)
  if (!p) return
  item.product_code = p.product_code || ''
  item.product_name = p.product_name || ''
  item.unit = p.unit || ''
  item.packing_standard = p.packing_standard || ''
  if (!toNumber(item.unit_price)) item.unit_price = toNumber(p.selling_price)
  item.logo_lines.forEach((line: any) => {
    if (!toNumber(line.unit_price)) line.unit_price = toNumber(p.selling_price)
  })
}

function addItem(item?: any) {
  formItems.value.push(normalizeItemForForm(item))
}

function removeItem(index: number) {
  formItems.value.splice(index, 1)
}

function addLogoLine(item: any) {
  item.has_logo = true
  item.logo_lines.push({ logo: '', logo_color: '', quantity: '', unit_price: item.unit_price || 0, line_total: 0 })
}

function removeLogoLine(item: any, index: number) {
  item.logo_lines.splice(index, 1)
  if (!item.logo_lines.length) item.has_logo = false
}

function toggleLogoMode(item: any) {
  if (item.has_logo) {
    if (!item.logo_lines.length) addLogoLine(item)
    item.quantity = 0
    item.unit_price = 0
  } else {
    const qty = item.logo_lines.reduce((sum: number, line: any) => sum + toNumber(line.quantity), 0)
    const total = item.logo_lines.reduce((sum: number, line: any) => sum + logoLineTotal(line), 0)
    item.quantity = qty || 1
    item.unit_price = qty ? round2(total / qty) : 0
    item.logo_lines = []
  }
}

function logoLineTotal(line: any) {
  const total = round2(toNumber(line.quantity) * toNumber(line.unit_price))
  line.line_total = total
  return total
}

function itemLineTotal(item: any) {
  if (item.has_logo && item.logo_lines.length) {
    const total = round2(item.logo_lines.reduce((sum: number, line: any) => sum + logoLineTotal(line), 0))
    const qty = round2(item.logo_lines.reduce((sum: number, line: any) => sum + toNumber(line.quantity), 0))
    item.quantity = qty
    item.unit_price = qty ? round2(total / qty) : 0
    return total
  }
  return round2(toNumber(item.quantity) * toNumber(item.unit_price))
}

function canEditRow(row: OrderDoc) {
  return !isOrderSyncPending(row) && orderActionDecision('edit', row).allowed
}

function orderActionDecision(action: 'edit' | 'delete', row: OrderDoc) {
  const blocker = action === 'delete'
    ? orderDeleteBlocker(row)
    : String(row.warehouse_fulfillment_status || '') === 'da_xuat_du'
      ? 'order_fulfilled'
      : ''
  return moduleActionDecision({
    actionPermission: `orders.${action}`,
    viewAllPermission: 'orders.view_all',
    permissions: permissions.value,
    record: row,
    currentUserEmail: appUser.value?.email || '',
    businessAllowed: !blocker,
    businessCode: blocker || 'order_locked',
  })
}

function orderActionError(action: 'edit' | 'delete', row: OrderDoc) {
  return permissionDecisionMessage(orderActionDecision(action, row), {
    operation: `${action === 'edit' ? 'sửa' : 'xóa'} đơn hàng`,
    record: row.order_code || row.id,
    status: row.warehouse_fulfillment_status || row.order_status || '',
  })
}

function itemQuantityMap(items: any[]) {
  const map = new Map<string, number>()
  items.forEach(item => {
    const logos = item.logo_lines?.length ? item.logo_lines : safeJsonParse(item.logo_json, [])
    const lines = Array.isArray(logos) && logos.length ? logos : [{ logo: '', quantity: item.quantity }]
    lines.forEach((line: any) => {
      const key = `${String(item.product_code || '').trim().toUpperCase()}|${String(line.logo || '').trim().toUpperCase()}`
      map.set(key, (map.get(key) || 0) + toNumber(line.quantity))
    })
  })
  return map
}

function validateNotBelowExported(nextItems: any[]) {
  if (!editing.value) return ''
  const exported = new Map<string, number>()
  exportRequests.value.filter(request => request.order_id === editing.value?.id && request.status === 'da_xuat').forEach(request => {
    const payload = safeJsonParse(request.payload_json, {})
    ;(Array.isArray(payload.items) ? payload.items : []).forEach((item: any) => {
      const key = `${String(item.product_code || '').trim().toUpperCase()}|${String(item.logo || '').trim().toUpperCase()}`
      exported.set(key, (exported.get(key) || 0) + toNumber(item.export_quantity || item.quantity))
    })
  })
  const next = itemQuantityMap(nextItems)
  for (const [key, quantity] of exported) {
    if ((next.get(key) || 0) < quantity) return `${key.replace('|', ' / ')} đã xuất ${quantity}, không thể giảm xuống ${next.get(key) || 0}.`
  }
  return ''
}

function orderDeleteBlocker(
  row: OrderDoc,
  requests = exportRequests.value.filter(request => request.order_id === row.id && isActive(request)),
) {
  const warehouseBlocker = warehouseOrderDeleteBlocker(row, requests)
  if (warehouseBlocker) return warehouseBlocker
  const printingBlocker = printingDeleteBlocker(row, printingProgress.value)
  if (printingBlocker) return printingBlocker
  return orderRelationDeleteBlocker(row)
}

function canDeleteRow(row: OrderDoc) {
  return orderActionDecision('delete', row).allowed
}

function fulfillmentLabel(value: any) {
  const key = String(value || 'chua_xuat')
  const map: Record<string, string> = {
    chua_xuat: 'Chưa xuất',
    da_xuat_1_phan: 'Đã xuất 1 phần',
    da_xuat_du: 'Đã xuất đủ',
    partial_exported: 'Đã xuất 1 phần',
    exported: 'Đã xuất đủ'
  }
  return map[key] || key || 'Chưa xuất'
}

function requestStatusLabel(value: any) {
  const key = String(value || '')
  const map: Record<string, string> = {
    cho_xu_ly: 'Có yêu cầu chờ',
    da_tiep_nhan: 'Đã tiếp nhận/chờ kho xuất',
    co_tu_choi: 'Có yêu cầu từ chối',
    pending: 'Có yêu cầu chờ',
    accepted: 'Đã tiếp nhận/chờ kho xuất',
    rejected: 'Có yêu cầu từ chối'
  }
  return map[key] || ''
}

function openModal(row?: OrderDoc) {
  if (row && isOrderSyncPending(row)) {
    return showToast('Đơn đã được lưu. Vui lòng làm mới dữ liệu trước khi sửa.', 'warning')
  }
  if (row && !canEditRow(row)) return showToast(orderActionError('edit', row), 'error')
  editing.value = row || null
  Object.keys(form).forEach(key => delete form[key])
  Object.assign(form, row ? { ...row, order_date: dateTimeLocal(row.order_date) || row.order_date } : {
    id: makeId('ord'),
    order_code: '',
    order_sequence: '',
    user_code: '',
    customer_code: '',
    order_date: nowDateTimeLocal(),
    customer_id: '',
    customer_name: '',
    phone: '',
    sale_name: appUser.value?.display_name || appUser.value?.email || '',
    sale_email: appUser.value?.email || '',
    owner_email: appUser.value?.email || '',
    order_status: 'Mới tạo',
    order_classification: 'Chăm sóc',
    vat_rate: 0,
    discount_amount: 0,
    note: '',
    status: 'active'
  })
  formItems.value = row ? (itemsByOrder.value[row.id] || []).map(normalizeItemForForm) : []
  if (!formItems.value.length) addItem()
  showModal.value = true
}

function buildSaveItems() {
  return formItems.value.map(item => ({
    ...item,
    product_id: item.product_id || '',
    logo_json: item.has_logo ? JSON.stringify(parseLogoLines(item.logo_lines)) : ''
  }))
}

function validateOrderItems() {
  if (!formItems.value.length) return 'Vui lòng thêm ít nhất một sản phẩm.'
  for (let index = 0; index < formItems.value.length; index++) {
    const item = formItems.value[index]
    const lineName = `Sản phẩm #${index + 1}`
    if (!String(item.product_id || '').trim() || !String(item.product_code || '').trim() || !String(item.product_name || '').trim()) {
      return `${lineName}: chưa chọn sản phẩm.`
    }
    if (item.has_logo) {
      if (!Array.isArray(item.logo_lines) || !item.logo_lines.length) return `${lineName}: chưa có dòng logo.`
      for (let logoIndex = 0; logoIndex < item.logo_lines.length; logoIndex++) {
        const line = item.logo_lines[logoIndex]
        if (!String(line.logo || '').trim()) return `${lineName}, logo #${logoIndex + 1}: chưa nhập tên logo.`
        if (toNumber(line.quantity) <= 0) return `${lineName}, logo #${logoIndex + 1}: số lượng phải lớn hơn 0.`
        if (toNumber(line.unit_price) < 0) return `${lineName}, logo #${logoIndex + 1}: đơn giá không hợp lệ.`
      }
    } else {
      if (toNumber(item.quantity) <= 0) return `${lineName}: số lượng phải lớn hơn 0.`
      if (toNumber(item.unit_price) < 0) return `${lineName}: đơn giá không hợp lệ.`
    }
  }
  return ''
}

function openDetail(row: OrderDoc) {
  selectedDetail.value = row
  showDetailModal.value = true
}

function openPrint(row: OrderDoc) {
  if (!hasPermission('orders.print')) {
    showToast(reportPermissionError({
      module: 'orders',
      operation: 'print',
      record: row.id,
      missingPermissions: ['orders.print'],
    }), 'error')
    return
  }
  selectedPrintOrder.value = row
}

function closePrint() {
  selectedPrintOrder.value = null
}

async function saveOrder() {
  if (editing.value && isOrderSyncPending(editing.value)) {
    return showToast('Đơn đã được lưu. Vui lòng làm mới dữ liệu trước khi sửa.', 'warning')
  }
  if (editing.value && !canEditRow(editing.value)) return showToast(orderActionError('edit', editing.value), 'error')
  if (!editing.value && !hasPermission('orders.create')) return showToast(reportPermissionError({
    module: 'orders',
    operation: 'create',
    missingPermissions: ['orders.create'],
  }), 'error')
  if (!form.customer_name) return showToast('Thiếu khách hàng', 'error')
  const itemValidation = validateOrderItems()
  if (itemValidation) return showToast(itemValidation, 'error')

  saving.value = true
  let saveStage = 'prepare_payload'
  let commitSucceeded = false
  await withLoading(async () => {
    const ownerEmail = form.owner_email || appUser.value?.email || ''
    const saleEmail = form.sale_email || appUser.value?.email || ''
    const createdBy = editing.value ? (form.created_by || appUser.value?.email || '') : (appUser.value?.email || '')
    let selectedCustomer = customers.value.find(customer => customer.id === form.customer_id)
    if (!editing.value && selectedCustomer && !selectedCustomer.customer_code) {
      if (!hasPermission('customers.edit')) {
        throw new Error(reportPermissionError({
          module: 'customers',
          operation: 'assign_customer_code',
          record: selectedCustomer.id,
          missingPermissions: ['customers.edit'],
        }))
      }
      selectedCustomer = await saveManagedCustomer({ ...selectedCustomer, customer_code: generateCustomerCode() }, selectedCustomer)
      customers.value = customers.value.map(customer => customer.id === selectedCustomer?.id ? selectedCustomer as CustomerDoc : customer)
      form.customer_code = selectedCustomer.customer_code || ''
    }

    const customerCode = normalizeCustomerCode(form.customer_code || selectedCustomer?.customer_code)
    const customerCodeError = customerCodeValidationError(customerCode)
    if (customerCodeError) throw new Error(customerCodeError)
    const userCode = normalizeUserCode(
      editing.value
        ? (form.user_code || String(form.order_code || '').split('-')[0])
        : appUser.value?.user_code,
    )
    const userCodeError = userCodeValidationError(userCode)
    if (userCodeError) {
      throw new Error(`${userCodeError} Vui lòng nhờ quản trị viên cập nhật tài khoản.`)
    }

    const saveItems = buildSaveItems()
    if (editing.value) {
      saveStage = 'load_edit_dependencies'
      const [latestRequests, latestPrinting] = await Promise.all([
        loadScopedExportRequests([editing.value], true),
        loadPrintingDependenciesForOrders([editing.value]),
      ])
      exportRequests.value = [
        ...exportRequests.value.filter(request => request.order_id !== editing.value?.id),
        ...latestRequests.filter(request => request.order_id === editing.value?.id),
      ]
      printingProgress.value = [
        ...printingProgress.value.filter(progress => progress.order_id !== editing.value?.id),
        ...latestPrinting.printOrders,
      ]
      const latestPrintOrderIds = new Set(latestPrinting.printOrders.map(progress => progress.id))
      printingProgressItems.value = [
        ...printingProgressItems.value.filter(item => !latestPrintOrderIds.has(item.print_order_id)),
        ...latestPrinting.printItems,
      ]
      const dependencyError = validateOrderItemEdit({
        order: editing.value,
        previousItems: itemsByOrder.value[editing.value.id] || [],
        nextItems: saveItems,
        exportRequests: exportRequests.value.filter(request => request.order_id === editing.value?.id),
        printOrders: printingProgress.value.filter(progress => progress.order_id === editing.value?.id),
        printItems: printingProgressItems.value,
      })
      if (dependencyError) throw new Error(dependencyError)
    }
    const totals = calcItems(saveItems, form)
    if (!totals.items.length) throw new Error('Thiếu sản phẩm hợp lệ')
    const requestedDiscount = toNumber(form.discount_amount)
    if (requestedDiscount < 0) throw new Error('Số tiền giảm giá không được âm.')
    if (requestedDiscount > totals.actual_revenue) throw new Error('Số tiền giảm giá không được lớn hơn tổng tiền đơn.')

    const baseOrder: any = { ...form, ...totals }
    if (editing.value) {
      const protectedFields = [
        'paid_amount', 'debt_amount', 'computed_payment_status', 'payment_status',
        'payment_count', 'deposit_count', 'collect_count',
        'warehouse_fulfillment_status', 'warehouse_request_status',
        'invoice_status',
        'deleted', 'active', 'status', 'deleted_at', 'created_at'
      ]
      protectedFields.forEach(key => delete baseOrder[key])
    }

    const localPaymentSummary = computePaymentStatus(baseOrder, paymentsByOrder.value[form.id] || [])
    const paymentSummary = editing.value ? {} : localPaymentSummary
    const existingItems = itemsByOrder.value[form.id] || []
    const orderPayload = {
      ...baseOrder,
      ...paymentSummary,
      order_code: form.order_code || '',
      ...(form.order_sequence ? { order_sequence: toNumber(form.order_sequence) } : {}),
      user_code: userCode,
      customer_code: customerCode,
      vat_rate: toNumber(form.vat_rate),
      owner_email: ownerEmail,
      sale_email: saleEmail,
      created_by: createdBy,
      items_count: totals.items.length,
      search_text: normalizeText(`${form.order_code || ''} ${form.customer_name} ${form.phone}`),
      ...(editing.value ? {} : {
        invoice_status: 'Không xuất',
        warehouse_fulfillment_status: form.warehouse_fulfillment_status || 'chua_xuat',
        warehouse_request_status: form.warehouse_request_status || '',
        printing_progress_count: 0,
        printing_lock_version: 1,
        printing_last_action: 'reconcile',
        printing_last_print_order_id: '',
        printing_lock_updated_by: createdBy,
        printing_lock_updated_at: serverTimestamp(),
        relation_lock_version: 1,
        payment_record_count: 0,
        invoice_record_count: 0,
        shipment_record_count: 0,
        payment_relation_revision: 0,
        invoice_relation_revision: 0,
        shipment_relation_revision: 0,
        relation_last_module: 'all',
        relation_last_action: 'reconcile',
        relation_last_document_id: '',
        relation_updated_by: createdBy,
        relation_updated_at: serverTimestamp(),
        shipment_status: '',
        shipping_fee_total: 0,
        cod_amount_total: 0,
        created_at: serverTimestamp(),
        active: true,
        deleted: false,
        status: form.status || 'active'
      })
    }

    saveStage = 'atomic_transaction'
    await saveOrderAtomic({
      mode: editing.value ? 'edit' : 'create',
      orderId: form.id,
      customerId: form.customer_id,
      customerCode,
      userCode,
      expectedRevision: toNumber(editing.value?.revision),
      ownerEmail,
      saleEmail,
      createdBy,
      changedBy: appUser.value?.email || '',
      orderPayload,
      nextItems: totals.items,
      existingItems,
      activityAction: editing.value ? 'update' : 'create',
      activityItemName: form.customer_name || form.order_code,
      activityBefore: editing.value
        ? { ...editing.value, items: existingItems }
        : null,
    })
    commitSucceeded = true

    invalidateScopedCache('orders')
    invalidateScopedCache('order_items')
    invalidateScopedCache('activity_logs')

    saveStage = 'post_commit_sync'
    markOrderSyncPending(form.id, true)
    let synchronized = false
    try {
      await synchronizePersistedOrder(form.id)
      synchronized = true
    } catch (syncError) {
      markOrderSyncPending(form.id, true)
      reportFirebaseError(syncError, 'Không đồng bộ được đơn hàng vừa lưu.', {
        module: 'orders',
        operation: 'sync_after_save',
        stage: 'post_commit_sync',
        record: form.id,
        actionPermission: 'orders.view',
        scopePermission: 'orders.view_all',
        scopeSatisfied: true,
        context: {
          collections: ['orders', 'order_items'],
          commit_succeeded: true,
        },
      })
      synchronized = await loadRows(true)
        && rows.value.some(row => row.id === form.id)
      if (synchronized) markOrderSyncPending(form.id, false)
    }

    showModal.value = false
    showToast(editing.value ? 'Đã cập nhật đơn hàng' : 'Đã thêm đơn hàng', 'success')
    if (!synchronized) {
      showToast('Đơn đã được lưu. Vui lòng làm mới dữ liệu trước khi sửa.', 'warning')
    }
  }).catch(error => showToast(
    commitSucceeded
      ? 'Đơn đã được lưu. Vui lòng làm mới dữ liệu trước khi sửa.'
      : (error as any)?.code
      ? reportFirebaseError(error, 'Lưu đơn thất bại. Toàn bộ thay đổi đã được hoàn tác.', {
          module: 'orders',
          operation: editing.value ? 'orders.edit' : 'orders.create',
          stage: saveStage,
          record: form.id,
          status: editing.value?.status || form.status || 'new',
          actionPermission: editing.value ? 'orders.edit' : 'orders.create',
          scopePermission: editing.value ? 'orders.view_all' : undefined,
          scopeSatisfied: editing.value
            ? orderActionDecision('edit', editing.value).allowed
            : true,
          context: {
            collection: saveStage === 'load_edit_dependencies'
              ? 'order_export_requests/print_orders'
              : 'orders/order_items',
            commit_succeeded: false,
            permission_expression: editing.value
              ? 'orders.edit AND (owner OR orders.view_all)'
              : 'orders.create',
          },
        })
      : ((error as any)?.message || 'Lưu đơn thất bại. Toàn bộ thay đổi đã được hoàn tác.'),
    'error',
  )).finally(() => {
    saving.value = false
  })
}

async function reconcileRelationLocksInBackground() {
  const actor = String(appUser.value?.email || '').trim().toLowerCase()
  if (!isAdmin.value || !actor || relationReconciledForUser === actor) return
  relationReconciledForUser = actor
  try {
    const result = await reconcileOrderRelationLocks()
    if (result.updatedOrders > 0) await loadRows(true)
    if (result.orphanCount > 0) {
      showToast(`Hệ thống phát hiện ${result.orphanCount} chứng từ mồ côi cần quản trị viên kiểm tra.`, 'info')
    }
  } catch (error) {
    relationReconciledForUser = ''
    showToast(reportFirebaseError(error, 'Hệ thống chưa đồng bộ được khóa liên kết đơn.'), 'error')
  }
}

async function softDeleteOrder(row: OrderDoc) {
  if (!orderActionDecision('delete', row).allowed) return showToast(orderActionError('delete', row), 'error')
  const initialBlocker = orderDeleteBlocker(row)
  if (initialBlocker) return showToast(initialBlocker, 'error')

  let latestOrder = row
  let latestRequests: any[] = []
  try {
    const [latestOrderSnap, loadedRequests] = await Promise.all([
      getDoc(doc(db, 'orders', row.id)),
      loadScopedExportRequests([row], true),
    ])
    if (!latestOrderSnap.exists()) throw new Error('Không tìm thấy đơn hàng cần xóa.')
    latestOrder = { ...latestOrderSnap.data(), id: latestOrderSnap.id } as OrderDoc
    latestRequests = loadedRequests.filter(request => request.order_id === row.id && isActive(request))
  } catch (error) {
    return showToast(reportFirebaseError(error, 'Không kiểm tra được trạng thái yêu cầu xuất kho của đơn.'), 'error')
  }

  const latestBlocker = orderDeleteBlocker(latestOrder, latestRequests)
  if (latestBlocker) return showToast(latestBlocker, 'error')

  const confirmed = await askConfirm({
    title: 'Xóa đơn hàng',
    message: `Bạn chắc chắn muốn xóa đơn hàng ${row.order_code}?\nCác dòng sản phẩm và yêu cầu xuất kho đang chờ hoặc đã từ chối cũng sẽ được xóa mềm.`,
    confirmLabel: 'Xóa đơn'
  })
  if (!confirmed) return

  await withLoading(async () => {
    const orderItems = itemsByOrder.value[row.id] || []
    const orderRequests = warehouseRequestsForDeleteCascade(latestRequests)
    const warehouseBlocker = warehouseOrderDeleteBlocker(latestOrder, latestRequests)
    if (warehouseBlocker) throw new Error(warehouseBlocker)
    const latestPrintingProgress = await loadPrintingProgressForOrder(row.id)
    const latestPrintingBlocker = printingDeleteBlocker(latestOrder, latestPrintingProgress)
    if (latestPrintingBlocker) throw new Error(latestPrintingBlocker)
    const latestRelationBlocker = orderRelationDeleteBlocker(latestOrder)
    if (latestRelationBlocker) throw new Error(latestRelationBlocker)

    if (orderItems.length + orderRequests.length + 2 > 500) {
      throw new Error('Đơn hàng có quá nhiều dữ liệu liên quan để xóa an toàn trong một lần.')
    }

    const batch = writeBatch(db)
    const deletedAt = serverTimestamp()

    batch.update(doc(db, 'orders', row.id), {
      deleted: true,
      active: false,
      status: 'deleted',
      deleted_at: deletedAt,
      updated_at: deletedAt
    })

    orderItems.forEach(item => {
      batch.update(doc(db, 'order_items', item.id), {
        deleted: true,
        active: false,
        status: 'deleted',
        deleted_at: deletedAt,
        updated_at: deletedAt
      })
    })

    orderRequests.forEach(request => {
      batch.update(doc(db, 'order_export_requests', request.id), {
        deleted: true,
        active: false,
        status: 'deleted',
        deleted_at: deletedAt,
        updated_at: deletedAt
      })
    })

    batch.set(doc(collection(db, 'activity_logs')), {
      module: 'orders',
      action: 'delete',
      item_code: row.order_code,
      item_name: row.customer_name || row.order_code,
      changed_by: appUser.value?.email || '',
      after_json: JSON.stringify({ order_id: row.id, deleted: true, deleted_requests: orderRequests.length }),
      created_at: deletedAt,
      active: true,
      deleted: false
    })

    await batch.commit()
    rows.value = rows.value.filter(r => r.id !== row.id)
    exportRequests.value = exportRequests.value.filter(request => request.order_id !== row.id)
    printingProgress.value = printingProgress.value.filter(progress => progress.order_id !== row.id)
    delete itemsByOrder.value[row.id]
    invalidateScopedCache('orders')
    invalidateScopedCache('order_items')
    invalidateScopedCache('order_export_requests')
    invalidateScopedCache('activity_logs')
    showToast('Đã xóa đơn hàng', 'success')
  }).catch(error => {
    const message = (error as any)?.code
      ? reportFirebaseError(error, 'Không xóa được đơn hàng.', {
          operation: 'orders.delete', record: row.id, status: latestOrder.status,
          actionPermission: 'orders.delete', scopePermission: 'orders.view_all',
        })
      : ((error as any)?.message || 'Không xóa được đơn hàng.')
    showToast(message, 'error')
  })
}

onMounted(loadRows)
</script>

<template>
  <AppShell>
    <PageHeader title="Đơn hàng" subtitle="Đơn hàng và chi tiết sản phẩm">
      <button v-if="hasPermission('orders.create')" class="btn primary" @click="openModal()">+ Tạo đơn hàng</button>
    </PageHeader>

    <div class="card" style="margin: 24px;">
      <div class="toolbar">
  <div class="filter-field filter-field--search">
    <label class="filter-label" for="order-search">
      Tìm kiếm
    </label>

    <input
      id="order-search"
      v-model="search"
      class="input"
      type="search"
      placeholder="Tìm mã đơn, khách hàng, SĐT..."
    />
  </div>

  <div class="filter-field">
    <label class="filter-label" for="order-status-filter">
      Trạng thái đơn
    </label>

    <select
      id="order-status-filter"
      v-model="orderStatusFilter"
      class="select"
    >
      <option value="">Tất cả trạng thái đơn</option>

      <option
        v-for="value in ORDER_STATUS_OPTIONS"
        :key="value"
        :value="value"
      >
        {{ value }}
      </option>
    </select>
  </div>

  <div class="filter-field">
    <label class="filter-label" for="payment-status-filter">
      Thanh toán
    </label>

    <select
      id="payment-status-filter"
      v-model="paymentStatusFilter"
      class="select"
    >
      <option value="">Tất cả thanh toán</option>
      <option value="Chưa thanh toán">Chưa thanh toán</option>
      <option value="Thanh toán một phần">Thanh toán một phần</option>
      <option value="Đã thanh toán">Đã thanh toán</option>
    </select>
  </div>

  <div class="filter-field">
    <label class="filter-label" for="invoice-status-filter">
      Hóa đơn
    </label>

    <select
      id="invoice-status-filter"
      v-model="invoiceStatusFilter"
      class="select"
    >
      <option value="">Tất cả hóa đơn</option>

      <option
        v-for="value in INVOICE_STATUS_OPTIONS"
        :key="value"
        :value="value"
      >
        {{ value }}
      </option>
    </select>
  </div>

  <div class="filter-field">
    <label class="filter-label" for="classification-filter">
      Phân loại
    </label>

    <select
      id="classification-filter"
      v-model="classificationFilter"
      class="select"
    >
      <option value="">Tất cả phân loại</option>

      <option
        v-for="value in ORDER_CLASSIFICATION_OPTIONS"
        :key="value"
        :value="value"
      >
        {{ value }}
      </option>
    </select>
  </div>

  <div class="filter-field">
    <label class="filter-label" for="date-from">
      Từ ngày
    </label>

    <input
      id="date-from"
      v-model="dateFrom"
      class="input"
      type="date"
    />
  </div>

  <div class="filter-field">
    <label class="filter-label" for="date-to">
      Đến ngày
    </label>

    <input
      id="date-to"
      v-model="dateTo"
      class="input"
      type="date"
    />
  </div>

  <div class="filter-field">
    <label class="filter-label" for="owner-filter">
      Người phụ trách
    </label>

    <select
      id="owner-filter"
      v-model="ownerFilter"
      class="select"
    >
      <option value="">Tất cả phụ trách</option>

      <option
        v-for="value in ownerOptions"
        :key="value"
        :value="value"
      >
        {{ value }}
      </option>
    </select>
  </div>

  <div class="filter-actions">
    <button
      type="button"
      class="btn"
      @click="resetFilters"
    >
      Xóa lọc
    </button>

    <button
      type="button"
      class="btn btn-primary"
      @click="loadRows(true)"
    >
      Làm mới
    </button>
  </div>
</div>
      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table style="min-width:1510px">
          <thead>
            <tr>
              <th>Mã / Ngày</th><th>Khách / SĐT</th><th>Phân loại</th><th>Trạng thái</th><th>Thanh toán</th><th>Hóa đơn</th>
              <th>Tạm tính</th><th>VAT</th><th>Tổng tiền</th><th>Giảm giá</th><th>Đã thu</th><th>Công nợ</th><th>Xuất kho</th><th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td><b style="color:#384bdc">{{ row.order_code }}</b><div class="small subtle">{{ formatDateTime(row.order_date) }}</div></td>
              <td>{{ row.customer_name }}<div class="small subtle">{{ row.phone }}</div></td>
              <td><span class="badge">{{ row.order_classification || '-' }}</span></td>
              <td><span class="badge blue">{{ row.order_status || 'Mới tạo' }}</span></td>
              <td><span class="badge green">{{ row.payment_status || 'Chưa thanh toán' }}</span></td>
              <td><span class="badge">{{ row.invoice_status || 'Không xuất' }}</span></td>
              <td>{{ money(row.subtotal_no_vat) }}</td>
              <td>{{ money(row.vat_amount) }}</td>
              <td>{{ money(row.actual_revenue || row.total_vat) }}</td>
              <td>{{ money(row.discount_amount) }}</td>
              <td>{{ money(row.paid_amount) }}</td>
              <td>{{ money(row.debt_amount) }}</td>
              <td>
                <span class="badge yellow">{{ fulfillmentLabel(row.warehouse_fulfillment_status) }}</span>
                <div v-if="requestStatusLabel(row.warehouse_request_status)" class="small subtle">{{ requestStatusLabel(row.warehouse_request_status) }}</div>
              </td>
              <td>
                <div class="action-buttons">
                  <button class="btn-sm btn-view" @click="openDetail(row)">Xem</button>
                  <button v-if="hasPermission('orders.print')" class="btn-sm" @click="openPrint(row)">In</button>
                  <button v-if="canEditRow(row)" class="btn-sm" @click="openModal(row)">Sửa</button>
                  <button v-else class="btn-sm" disabled>Khóa</button>
                  <button v-if="canDeleteRow(row)" class="btn-sm btn-delete" @click="softDeleteOrder(row)">Xóa</button>
                  <button v-else-if="hasPermission('orders.delete')" class="btn-sm" disabled :title="orderDeleteBlocker(row)">Khóa</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <CursorLoadMore
        :loaded-count="rows.length"
        :has-more="hasMoreRows"
        :loading="loadingMore"
        :mode="pageMode"
        @load-more="loadMoreRows"
      />
    </div>

    <BaseModal
      v-if="showModal"
      :title="editing ? 'Sửa đơn hàng' : 'Tạo đơn hàng'"
      size="xl"
      save-label="Lưu đơn"
      :loading="saving"
      @close="showModal=false"
      @save="saveOrder"
    >
      <div class="form-row-3">
        <div class="form-group">
          <label>Mã đơn</label>
          <input
            v-model="form.order_code"
            class="input readonly-field"
            readonly
            :placeholder="editing ? '' : 'Tự động tạo khi lưu đơn'"
          />
          <div v-if="!editing" class="small subtle">Mã Người dùng - Mã khách - số thứ tự riêng của khách, bắt đầu từ 0001.</div>
        </div>
        <div class="form-group"><label>Ngày giờ đơn</label><input v-model="form.order_date" class="input" type="datetime-local" /></div>
        <div class="form-group"><label>Sale phụ trách</label><input v-model="form.sale_name" class="input" /></div>
        <div class="form-group">
          <label>Khách hàng</label>
          <SearchableSelect
            v-model="form.customer_id"
            :options="customerOptions"
            :action-label="hasPermission('customers.create') ? '+ Thêm khách hàng' : ''"
            placeholder="Tìm khách theo tên, SĐT, email..."
            @action="openCustomerModal"
            @change="chooseCustomer"
          />
        </div>
        <div class="form-group"><label>SĐT</label><input v-model="form.phone" class="input" /></div>
        <div class="form-group"><label>Phân loại đơn</label><select v-model="form.order_classification" class="select"><option v-for="s in ORDER_CLASSIFICATION_OPTIONS" :key="s" :value="s">{{ s }}</option></select></div>
        <div class="form-group"><label>Trạng thái đơn</label><select v-model="form.order_status" class="select"><option v-for="s in ORDER_STATUS_OPTIONS" :key="s" :value="s">{{ s }}</option></select></div>
        <div class="form-group"><label>VAT %</label><select v-model.number="form.vat_rate" class="select"><option v-for="s in VAT_RATE_OPTIONS" :key="s" :value="s">{{ s }}</option></select></div>
        <div class="form-group"><label>Số tiền giảm giá</label><input v-model.number="form.discount_amount" class="input" type="number" min="0" /></div>
      </div>
      <div class="form-group" style="margin-top:12px"><label>Ghi chú</label><textarea v-model="form.note" class="textarea" rows="3" /></div>

      <div class="form-section-label">
        <label>Sản phẩm trong đơn</label>
        <span class="product-row-count">{{ itemCount }}</span>
      </div>

      <div v-for="(item, index) in formItems" :key="item.id" class="product-row-card">
        <div class="product-row-header">
          <span class="product-row-title">Sản phẩm #{{ index + 1 }}</span>
          <button type="button" class="product-row-remove" @click="removeItem(index)">×</button>
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label>Sản phẩm</label>
            <SearchableSelect
              v-model="item.product_id"
              :options="productOptions"
              placeholder="Tìm sản phẩm theo mã hoặc tên..."
              @change="chooseProduct(item)"
            />
          </div>
          <div class="form-group"><label>Mã SP</label><input v-model="item.product_code" class="input" readonly /></div>
          <div class="form-group"><label>Tên sản phẩm</label><input v-model="item.product_name" class="input" readonly /></div>
          <div class="form-group"><label>Đơn vị</label><input v-model="item.unit" class="input" readonly /></div>
          <template v-if="!item.has_logo">
            <div class="form-group"><label>Số lượng</label><input v-model.number="item.quantity" class="input" type="number" min="0" /></div>
            <div class="form-group"><label>Đơn giá</label><input v-model.number="item.unit_price" class="input" type="number" min="0" /></div>
          </template>
          <div v-else class="logo-parent-hidden-note">Sản phẩm có logo: số lượng, đơn giá và thành tiền được tính từ các dòng logo bên dưới.</div>
        </div>
        <div class="form-group logo-toggle"><label><input v-model="item.has_logo" type="checkbox" @change="toggleLogoMode(item)" /> Có logo / tách sản phẩm chi tiết theo logo</label></div>
        <div v-if="item.has_logo" class="logo-items-box">
          <div class="logo-mode-note">Màu chỉ là thông tin mô tả; xuất nhập kho vẫn đối chiếu theo sản phẩm và logo.</div>
          <div v-for="(line, logoIndex) in item.logo_lines" :key="logoIndex" class="logo-row">
            <div class="form-group"><label>Logo</label><input v-model="line.logo" class="input" placeholder="VD: Logo A" /></div>
            <div class="form-group"><label>Màu</label><input v-model="line.logo_color" class="input" placeholder="VD: Đỏ, xanh navy..." /></div>
            <div class="form-group"><label>Số lượng</label><input v-model.number="line.quantity" class="input" type="number" min="0" /></div>
            <div class="form-group"><label>Đơn giá</label><input v-model.number="line.unit_price" class="input" type="number" min="0" /></div>
            <div class="form-group"><label>Thành tiền</label><input class="input" :value="money(logoLineTotal(line))" readonly /></div>
            <button type="button" class="product-row-remove" @click="removeLogoLine(item, logoIndex)">×</button>
          </div>
          <button type="button" class="btn" @click="addLogoLine(item)">+ Thêm logo</button>
        </div>
        <div class="line-total">Tổng dòng: <strong>{{ money(itemLineTotal(item)) }}</strong></div>
      </div>

      <button type="button" class="btn" @click="addItem()">+ Thêm sản phẩm</button>
      <div class="order-grand-total"><span>Tạm tính</span><span>{{ money(modalTotals.subtotal_no_vat) }}</span></div>
      <div class="order-grand-total"><span>Tổng sau VAT</span><span>{{ money(modalTotals.actual_revenue) }}</span></div>
      <div class="order-grand-total"><span>Giảm giá</span><span>-{{ money(modalTotals.discount_amount) }}</span></div>
      <div class="order-grand-total"><span>Giá trị sau giảm giá</span><span>{{ money(modalTotals.payable_amount) }}</span></div>
    </BaseModal>

    <BaseModal
      v-if="showCustomerModal"
      class="customer-create-modal-backdrop"
      title="Thêm khách hàng"
      save-label="Lưu khách hàng"
      :loading="savingCustomer"
      @close="showCustomerModal = false"
      @save="saveCustomer"
    >
      <div class="form-grid">
        <div class="form-group">
          <label>Mã khách (tự động)</label>
          <input v-model="customerForm.customer_code" class="input readonly-field" readonly />
          <div class="small subtle">Gồm 3 chữ cái in hoa và 3 chữ số; không thể nhập thủ công.</div>
        </div>
        <div class="form-group"><label>Tên khách *</label><input v-model="customerForm.customer_name" class="input" /></div>
        <div class="form-group"><label>Công ty</label><input v-model="customerForm.company_name" class="input" /></div>
        <div class="form-group"><label>SĐT</label><input v-model="customerForm.phone" class="input" /></div>
        <div class="form-group"><label>Email</label><input v-model="customerForm.email" class="input" /></div>
        <div class="form-group"><label>Mã số thuế</label><input v-model="customerForm.tax_code" class="input" /></div>
        <div class="form-group"><label>Địa chỉ hóa đơn</label><input v-model="customerForm.billing_address" class="input" /></div>
        <div class="form-group"><label>Địa chỉ giao hàng</label><input v-model="customerForm.shipping_address" class="input" /></div>
        <div class="form-group"><label>Nguồn</label><input v-model="customerForm.source" class="input" /></div>
      </div>
      <div class="form-group" style="margin-top:12px"><label>Ghi chú</label><textarea v-model="customerForm.note" class="textarea" rows="3" /></div>
    </BaseModal>

    <RecordDetailModal
      v-if="showDetailModal && selectedDetail"
      title="Chi tiết đơn hàng"
      :record="selectedDetail"
      :labels="orderDetailLabels"
      :field-order="[
        'id','order_code','order_sequence','user_code','customer_code','order_classification','order_date','customer_id','customer_name','phone','sale_name','sale_email',
        'owner_email','created_by','created_at','updated_at','order_status','operation_status',
        'expected_delivery_date','completed_date','items_count','subtotal_no_vat','vat_rate','vat_amount',
        'total_vat','discount_amount','payable_amount','actual_revenue','paid_amount','debt_amount','payment_status','invoice_status',
        'warehouse_fulfillment_status','warehouse_request_status','note','status','active','deleted'
      ]"
      :money-fields="['subtotal_no_vat','vat_amount','total_vat','discount_amount','payable_amount','actual_revenue','paid_amount','debt_amount']"
      @close="showDetailModal = false"
    >
      <h3 style="margin-top:20px">Chi tiết sản phẩm và tiến độ xuất</h3>
      <div class="table-wrap">
        <table style="min-width:980px">
          <thead>
            <tr><th>Sản phẩm</th><th>Logo</th><th>SL đơn</th><th>Đã yêu cầu</th><th>Đã xử lý</th><th>Đã xuất</th><th>Còn có thể yêu cầu</th><th>Còn phải xuất</th><th>Trạng thái</th></tr>
          </thead>
          <tbody>
            <tr v-for="line in selectedDetailProgress" :key="`${line.product_code}|${line.logo}`">
              <td><b>{{ line.product_name }}</b><div class="small subtle">{{ line.product_code }} · {{ line.unit }}</div></td>
              <td>{{ line.logo || '-' }}</td>
              <td>{{ line.ordered_qty }}</td>
              <td>{{ line.requested_qty }}</td>
              <td>{{ line.processed_qty }}</td>
              <td>{{ line.exported_qty }}</td>
              <td>{{ line.available_to_request_qty }}</td>
              <td>{{ line.remaining_qty }}</td>
              <td><span class="badge yellow">{{ line.status }}</span></td>
            </tr>
            <tr v-if="!selectedDetailProgress.length"><td colspan="9" class="empty">Đơn hàng chưa có sản phẩm hợp lệ.</td></tr>
          </tbody>
        </table>
      </div>

      <h3 style="margin-top:20px">Các lần yêu cầu/xuất kho</h3>
      <div class="table-wrap">
        <table style="min-width:980px">
          <thead><tr><th>Mã yêu cầu</th><th>Ngày yêu cầu</th><th>Trạng thái</th><th>Phiếu kho</th><th>Số dòng</th><th>SL yêu cầu</th><th>Đã xử lý</th><th>Đã xuất</th></tr></thead>
          <tbody>
            <tr v-for="request in selectedDetailRequestRows" :key="request.id">
              <td><b>{{ request.request_id || request.id }}</b></td>
              <td>{{ formatDateTime(request.requested_at || request.created_at) }}</td>
              <td>{{ warehouseStatusLabel(request.status) }}</td>
              <td>{{ request.warehouse_export_code || '-' }}</td>
              <td>{{ request.line_count }}</td>
              <td>{{ request.total_requested_qty }}</td>
              <td>{{ request.total_processed_qty }}</td>
              <td>{{ request.total_exported_qty }}</td>
            </tr>
            <tr v-if="!selectedDetailRequestRows.length"><td colspan="8" class="empty">Chưa có yêu cầu xuất kho nào.</td></tr>
          </tbody>
        </table>
      </div>

      <h3 style="margin-top:20px">Chi tiết từng lần xuất theo sản phẩm</h3>
      <div class="table-wrap">
        <table style="min-width:1080px">
          <thead><tr><th>Mã yêu cầu</th><th>Sản phẩm</th><th>Logo</th><th>Đơn vị</th><th>SL phiếu</th><th>Đã xử lý</th><th>Đã xuất</th><th>Phiếu kho</th><th>Ghi chú kho</th></tr></thead>
          <tbody>
            <tr v-for="(line, index) in selectedDetailExportLineRows" :key="`${line.request_id}|${line.product_code}|${line.logo}|${index}`">
              <td><b>{{ line.request_id }}</b><div class="small subtle">{{ warehouseStatusLabel(line.request_status) }}</div></td>
              <td><b>{{ line.product_name }}</b><div class="small subtle">{{ line.product_code }}</div></td>
              <td>{{ line.logo || '-' }}</td>
              <td>{{ line.unit || '-' }}</td>
              <td>{{ line.requested_qty }}</td>
              <td>{{ line.processed_qty }}</td>
              <td>{{ line.exported_qty }}</td>
              <td>{{ line.warehouse_export_code || '-' }}</td>
              <td>{{ line.warehouse_note || '-' }}</td>
            </tr>
            <tr v-if="!selectedDetailExportLineRows.length"><td colspan="9" class="empty">Chưa có dòng yêu cầu/xuất kho.</td></tr>
          </tbody>
        </table>
      </div>

      <h3 style="margin-top:20px">Sản phẩm trong đơn hàng</h3>
      <div class="table-wrap">
        <table style="min-width:940px">
          <thead><tr><th>Sản phẩm</th><th>Logo</th><th>Màu</th><th>Đơn vị</th><th>Số lượng đặt</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead>
          <tbody>
            <tr v-for="(line, index) in selectedDetailOrderLines" :key="`${line.product_code}|${line.logo}|${index}`">
              <td><b>{{ line.product_name }}</b><div class="small subtle">{{ line.product_code }}</div></td>
              <td>{{ line.logo || '-' }}</td>
              <td>{{ line.logo_color || '-' }}</td>
              <td>{{ line.unit || '-' }}</td>
              <td>{{ line.quantity }}</td>
              <td>{{ money(line.unit_price) }}</td>
              <td>{{ money(line.line_total) }}</td>
            </tr>
            <tr v-if="!selectedDetailOrderLines.length"><td colspan="7" class="empty">Chưa có sản phẩm trong đơn.</td></tr>
          </tbody>
        </table>
      </div>
    </RecordDetailModal>

    <OrderPrintModal
      v-if="selectedPrintOrder"
      :order="selectedPrintOrder"
      :items="selectedPrintItems"
      :requests="selectedPrintRequests"
      @close="closePrint"
    />

    <ConfirmModal
      v-bind="confirmState"
      @cancel="resolveConfirm(false)"
      @confirm="resolveConfirm(true)"
    />
  </AppShell>
</template>
