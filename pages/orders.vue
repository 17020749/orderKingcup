<script setup lang="ts">
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { INVOICE_STATUS_OPTIONS, ORDER_STATUS_OPTIONS, VAT_RATE_OPTIONS } from '~/constants/permissions'
import type { CustomerDoc, OrderDoc, OrderItemDoc, PaymentDoc, ProductDoc } from '~/types/models'
import { dateTimeLocal, formatDateTime, isActive, makeCode, makeId, money, normalizeText, nowDateTimeLocal, round2, safeJsonParse, toNumber } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'

const { db } = useFirebaseServices()
const { appUser, hasPermission } = useAuth()
const { calcItems, computePaymentStatus, parseLogoLines } = useOrderLogic()
const { invalidateScopedCache } = useRepo()
const { loadScopedOrders, loadScopedOrderItems, loadScopedPayments, loadScopedExportRequests, loadScopedCustomers, loadProducts } = useScopedQueries()
const { showToast, withLoading } = useUi()
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()
const { buildFulfillmentRows, orderSummary } = useWarehouseLogic()

const loading = ref(false)
const saving = ref(false)
const search = ref('')
const rows = ref<OrderDoc[]>([])
const customers = ref<CustomerDoc[]>([])
const products = ref<ProductDoc[]>([])
const itemsByOrder = ref<Record<string, OrderItemDoc[]>>({})
const paymentsByOrder = ref<Record<string, PaymentDoc[]>>({})
const exportRequests = ref<any[]>([])
const showModal = ref(false)
const showDetailModal = ref(false)
const selectedDetail = ref<OrderDoc | null>(null)
const editing = ref<OrderDoc | null>(null)
const form = reactive<any>({})
const formItems = ref<any[]>([])

const filtered = computed(() => rows.value.filter(row =>
  normalizeText(`${row.order_code} ${row.customer_name} ${row.phone} ${row.order_status} ${row.payment_status} ${row.invoice_status}`).includes(normalizeText(search.value))
))
const canEditOrders = computed(() => hasPermission('orders.edit'))
const itemCount = computed(() => `${formItems.value.length} dòng`)
const modalTotals = computed(() => calcItems(formItems.value, form))
const selectedDetailItems = computed(() => selectedDetail.value ? (itemsByOrder.value[selectedDetail.value.id] || []) : [])
const selectedDetailRequests = computed(() => selectedDetail.value
  ? exportRequests.value.filter(request => request.order_id === selectedDetail.value?.id && isActive(request))
  : [])
const selectedDetailProgress = computed(() => buildFulfillmentRows(selectedDetailItems.value, selectedDetailRequests.value))
const customerOptions = computed(() => customers.value.map(customer => ({
  value: customer.id,
  label: `${customer.customer_name || 'Khách chưa tên'}${customer.phone ? ` - ${customer.phone}` : ''}`,
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
  customer_name: 'Khách hàng', phone: 'Số điện thoại', sale_name: 'Sale phụ trách',
  order_status: 'Trạng thái đơn', operation_status: 'Trạng thái vận hành',
  expected_delivery_date: 'Ngày giao dự kiến', completed_date: 'Ngày hoàn thành',
  subtotal_no_vat: 'Tạm tính chưa VAT', vat_rate: 'VAT (%)', vat_amount: 'Tiền VAT',
  total_vat: 'Tổng sau VAT', actual_revenue: 'Tổng tiền đơn', paid_amount: 'Đã thu',
  debt_amount: 'Công nợ', payment_status: 'Trạng thái thanh toán', invoice_status: 'Trạng thái hóa đơn',
  warehouse_fulfillment_status: 'Trạng thái xuất kho', warehouse_request_status: 'Trạng thái yêu cầu kho',
  items_count: 'Số dòng sản phẩm'
}

async function loadRows(force = false) {
  loading.value = true
  try {
    const [loadedCustomers, loadedProducts, allOrders] = await Promise.all([
      loadScopedCustomers(force),
      loadProducts(force),
      loadScopedOrders(force)
    ])
    customers.value = loadedCustomers.filter(isActive)
    products.value = loadedProducts.filter(isActive)

    const [loadedItems, loadedPayments, loadedRequests] = await Promise.all([
      loadScopedOrderItems(allOrders, force),
      loadScopedPayments(allOrders, force),
      loadScopedExportRequests(allOrders, force)
    ])

    const itemMap: Record<string, OrderItemDoc[]> = {}
    loadedItems.forEach(item => {
      if (!itemMap[item.order_id]) itemMap[item.order_id] = []
      itemMap[item.order_id].push(item)
    })
    itemsByOrder.value = itemMap

    const payMap: Record<string, PaymentDoc[]> = {}
    loadedPayments.forEach(payment => {
      if (!payMap[payment.order_id]) payMap[payment.order_id] = []
      payMap[payment.order_id].push(payment)
    })
    paymentsByOrder.value = payMap
    exportRequests.value = loadedRequests

    rows.value = allOrders.map(order => {
      const orderRequests = loadedRequests.filter(request => request.order_id === order.id && isActive(request))
      const progress = buildFulfillmentRows(itemMap[order.id] || [], orderRequests)
      const paymentSummary = computePaymentStatus(order, payMap[order.id] || [])
      return { ...order, ...paymentSummary, ...orderSummary(progress, orderRequests) }
    })
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được danh sách đơn hàng.'), 'error')
  } finally {
    loading.value = false
  }
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
  item.logo_lines.push({ logo: '', quantity: '', unit_price: item.unit_price || 0, line_total: 0 })
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
  return canEditOrders.value && (String(row.warehouse_fulfillment_status || '') !== 'da_xuat_du' || hasPermission('orders.edit_fulfilled'))
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

function orderHasWarehouseExport(row: OrderDoc) {
  const requests = exportRequests.value.filter(request => request.order_id === row.id && isActive(request))
  const progress = buildFulfillmentRows(itemsByOrder.value[row.id] || [], requests)
  const exportedByQuantity = progress.some(line => toNumber(line.exported_qty) > 0)
  const exportedByRequest = requests.some(request => {
    const status = normalizeText(request.status).replace(/\s+/g, '_')
    return ['da_xuat', 'da_xuat_kho', 'da_xuat_du', 'exported', 'completed', 'hoan_thanh'].includes(status)
      || !!String(request.warehouse_export_code || '').trim()
  })
  return exportedByQuantity || exportedByRequest
}

function canDeleteRow(row: OrderDoc) {
  return hasPermission('orders.delete') && !orderHasWarehouseExport(row)
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
  if (row && !canEditRow(row)) return showToast('Đơn hàng đã xuất đủ trên Warehouse, không thể sửa.', 'error')
  editing.value = row || null
  Object.assign(form, row ? { ...row, order_date: dateTimeLocal(row.order_date) || row.order_date } : {
    id: makeId('ord'),
    order_code: makeCode('DH'),
    order_date: nowDateTimeLocal(),
    customer_id: '',
    customer_name: '',
    phone: '',
    sale_name: appUser.value?.display_name || appUser.value?.email || '',
    sale_email: appUser.value?.email || '',
    owner_email: appUser.value?.email || '',
    order_status: 'Mới tạo',
    invoice_status: 'Không xuất',
    vat_rate: 0,
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

async function commitWriteChunks(writes: Array<(batch: ReturnType<typeof writeBatch>) => void>, size = 8) {
  for (let index = 0; index < writes.length; index += size) {
    const batch = writeBatch(db)
    writes.slice(index, index + size).forEach(write => write(batch))
    await batch.commit()
  }
}

async function saveOrder() {
  if (editing.value && !canEditRow(editing.value)) return showToast('Bạn không có quyền sửa đơn hàng này', 'error')
  if (!editing.value && !hasPermission('orders.create')) return showToast('Bạn không có quyền tạo đơn hàng', 'error')
  if (!form.customer_name) return showToast('Thiếu khách hàng', 'error')
  const itemValidation = validateOrderItems()
  if (itemValidation) return showToast(itemValidation, 'error')

  saving.value = true
  await withLoading(async () => {
    const ownerEmail = form.owner_email || appUser.value?.email || ''
    const saleEmail = form.sale_email || appUser.value?.email || ''
    const createdBy = editing.value ? (form.created_by || appUser.value?.email || '') : (appUser.value?.email || '')
    const saveItems = buildSaveItems()
    const exportError = validateNotBelowExported(saveItems)
    if (exportError) throw new Error(exportError)
    const totals = calcItems(saveItems, form)
    if (!totals.items.length) throw new Error('Thiếu sản phẩm hợp lệ')

    const baseOrder: any = { ...form, ...totals }
    if (editing.value) {
      // These fields are maintained by their dedicated modules. Omitting them
      // prevents a normal order edit from overwriting payment/warehouse/invoice
      // state or reviving a soft-deleted document.
      ;[
        'paid_amount', 'debt_amount', 'computed_payment_status', 'payment_status',
        'payment_count', 'deposit_count', 'collect_count',
        'warehouse_fulfillment_status', 'warehouse_request_status',
        'invoice_status', 'deleted', 'active', 'status', 'deleted_at', 'created_at'
      ].forEach(key => delete baseOrder[key])
    }

    const paymentSummary = editing.value
      ? {}
      : computePaymentStatus(baseOrder, paymentsByOrder.value[form.id] || [])

    const orderBatch = writeBatch(db)
    const orderPayload = {
      ...baseOrder,
      ...paymentSummary,
      vat_rate: toNumber(form.vat_rate),
      owner_email: ownerEmail,
      sale_email: saleEmail,
      created_by: createdBy,
      items_count: totals.items.length,
      search_text: normalizeText(`${form.order_code} ${form.customer_name} ${form.phone}`),
      updated_at: serverTimestamp(),
      ...(editing.value ? {} : {
        invoice_status: form.invoice_status || 'Không xuất',
        warehouse_fulfillment_status: form.warehouse_fulfillment_status || 'chua_xuat',
        warehouse_request_status: form.warehouse_request_status || '',
        created_at: serverTimestamp(),
        active: true,
        deleted: false
      })
    }
    orderBatch.set(doc(db, 'orders', form.id), orderPayload, { merge: true })
    orderBatch.set(doc(collection(db, 'activity_logs')), {
      module: 'orders',
      action: editing.value ? 'update' : 'create',
      item_code: form.order_code,
      item_name: form.customer_name || form.order_code,
      changed_by: appUser.value?.email || '',
      after_json: JSON.stringify({ ...baseOrder, ...paymentSummary, owner_email: ownerEmail, sale_email: saleEmail, created_by: createdBy }),
      created_at: serverTimestamp(),
      active: true,
      deleted: false
    })
    await orderBatch.commit()

    const existingItemIds = new Set((itemsByOrder.value[form.id] || []).map(item => item.id))
    const nextIds = new Set(totals.items.map((item: any) => item.id))
    const itemWrites: Array<(batch: ReturnType<typeof writeBatch>) => void> = []
    ;(itemsByOrder.value[form.id] || []).forEach(item => {
      if (!nextIds.has(item.id)) {
        itemWrites.push(batch => batch.update(doc(db, 'order_items', item.id), {
          deleted: true,
          active: false,
          status: 'deleted',
          updated_at: serverTimestamp()
        }))
      }
    })

    totals.items.forEach((item: any) => {
      const isNewItem = !existingItemIds.has(item.id)
      itemWrites.push(batch => batch.set(doc(db, 'order_items', item.id), {
        ...item,
        order_id: form.id,
        order_code: form.order_code,
        owner_email: ownerEmail,
        sale_email: saleEmail,
        created_by: createdBy,
        updated_at: serverTimestamp(),
        ...(isNewItem ? {
          status: 'active',
          active: true,
          deleted: false,
          created_at: serverTimestamp()
        } : {})
      }, { merge: true }))
    })

    await commitWriteChunks(itemWrites)

    const now = new Date().toISOString()
    const localItems = totals.items.map((item: any) => ({
      ...item,
      order_id: form.id,
      order_code: form.order_code,
      owner_email: ownerEmail,
      sale_email: saleEmail,
      created_by: createdBy,
      status: 'active',
      active: true,
      deleted: false,
      updated_at: now
    })) as OrderItemDoc[]
    itemsByOrder.value[form.id] = localItems

    const localOrder = {
      ...(editing.value || {}),
      ...baseOrder,
      ...paymentSummary,
      id: form.id,
      owner_email: ownerEmail,
      sale_email: saleEmail,
      created_by: createdBy,
      items_count: localItems.length,
      active: true,
      deleted: false,
      updated_at: now
    } as OrderDoc
    const orderRequests = exportRequests.value.filter(request => request.order_id === form.id && isActive(request))
    Object.assign(localOrder, orderSummary(buildFulfillmentRows(localItems, orderRequests), orderRequests))
    const rowIndex = rows.value.findIndex(row => row.id === form.id)
    if (rowIndex >= 0) rows.value[rowIndex] = localOrder
    else rows.value.unshift(localOrder)

    invalidateScopedCache('orders')
    invalidateScopedCache('order_items')
    invalidateScopedCache('activity_logs')
    showModal.value = false
    showToast(editing.value ? 'Đã cập nhật đơn hàng' : 'Đã thêm đơn hàng', 'success')
  }).catch(error => showToast((error as any)?.code ? reportFirebaseError(error, 'Lưu đơn thất bại.') : ((error as any)?.message || 'Lưu đơn thất bại.'), 'error')).finally(() => {
    saving.value = false
  })
}

async function softDeleteOrder(row: OrderDoc) {
  if (!canDeleteRow(row)) return showToast('Đơn đã có lịch sử xuất kho, không thể xóa', 'error')
  const confirmed = await askConfirm({
    title: 'Xóa đơn hàng',
    message: `Bạn chắc chắn muốn xóa đơn hàng ${row.order_code}?\nCác dòng sản phẩm và phiếu xuất chưa thực hiện của đơn này cũng sẽ được xóa mềm.`,
    confirmLabel: 'Xóa đơn'
  })
  if (!confirmed) return

  await withLoading(async () => {
    const orderItems = itemsByOrder.value[row.id] || []
    const orderRequests = exportRequests.value.filter(request => request.order_id === row.id && isActive(request))
    if (orderHasWarehouseExport(row)) {
      throw new Error('Đơn hàng đã có số lượng xuất kho hoặc mã phiếu Warehouse nên không thể xóa.')
    }

    // Xóa mềm order, order_items và các yêu cầu xuất chưa thực hiện trong cùng
    // một batch để không để lại phiếu mồ côi. Chừa một write cho activity log.
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
    delete itemsByOrder.value[row.id]
    invalidateScopedCache('orders')
    invalidateScopedCache('order_items')
    invalidateScopedCache('order_export_requests')
    invalidateScopedCache('activity_logs')
    showToast('Đã xóa đơn hàng', 'success')
  }).catch(error => {
    const message = (error as any)?.code
      ? reportFirebaseError(error, 'Không xóa được đơn hàng.')
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

    <div class="card">
      <div class="toolbar">
        <input v-model="search" class="input" style="max-width:480px" placeholder="Tìm mã đơn, khách hàng, SĐT..." />
        <button class="btn" @click="loadRows(true)">Làm mới</button>
      </div>
      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table style="min-width:1320px">
          <thead>
            <tr>
              <th>Mã / Ngày</th><th>Khách / SĐT</th><th>Trạng thái</th><th>Thanh toán</th><th>Hóa đơn</th>
              <th>Tạm tính</th><th>VAT</th><th>Tổng tiền</th><th>Đã thu</th><th>Công nợ</th><th>Xuất kho</th><th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td><b style="color:#384bdc">{{ row.order_code }}</b><div class="small subtle">{{ formatDateTime(row.order_date) }}</div></td>
              <td>{{ row.customer_name }}<div class="small subtle">{{ row.phone }}</div></td>
              <td><span class="badge blue">{{ row.order_status || 'Mới tạo' }}</span></td>
              <td><span class="badge green">{{ row.payment_status || 'Chưa thanh toán' }}</span></td>
              <td><span class="badge">{{ row.invoice_status || 'Không xuất' }}</span></td>
              <td>{{ money(row.subtotal_no_vat) }}</td>
              <td>{{ money(row.vat_amount) }}</td>
              <td>{{ money(row.actual_revenue || row.total_vat) }}</td>
              <td>{{ money(row.paid_amount) }}</td>
              <td>{{ money(row.debt_amount) }}</td>
              <td>
                <span class="badge yellow">{{ fulfillmentLabel(row.warehouse_fulfillment_status) }}</span>
                <div v-if="requestStatusLabel(row.warehouse_request_status)" class="small subtle">{{ requestStatusLabel(row.warehouse_request_status) }}</div>
              </td>
              <td>
                <div class="action-buttons">
                  <button class="btn-sm btn-view" @click="openDetail(row)">Xem</button>
                  <button v-if="canEditRow(row)" class="btn-sm" @click="openModal(row)">Sửa</button>
                  <button v-else class="btn-sm" disabled>Khóa</button>
                  <button v-if="canDeleteRow(row)" class="btn-sm btn-delete" @click="softDeleteOrder(row)">Xóa</button>
                  <button v-else-if="hasPermission('orders.delete')" class="btn-sm" disabled>Khóa</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
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
        <div class="form-group"><label>Mã đơn</label><input v-model="form.order_code" class="input" /></div>
        <div class="form-group"><label>Ngày giờ đơn</label><input v-model="form.order_date" class="input" type="datetime-local" /></div>
        <div class="form-group"><label>Sale phụ trách</label><input v-model="form.sale_name" class="input" /></div>
        <div class="form-group">
          <label>Khách hàng</label>
          <SearchableSelect
            v-model="form.customer_id"
            :options="customerOptions"
            placeholder="Tìm khách theo tên, SĐT, email..."
            @change="chooseCustomer"
          />
        </div>
        <div class="form-group"><label>SĐT</label><input v-model="form.phone" class="input" /></div>
        <div class="form-group"><label>Trạng thái đơn</label><select v-model="form.order_status" class="select"><option v-for="s in ORDER_STATUS_OPTIONS" :key="s" :value="s">{{ s }}</option></select></div>
        <div class="form-group"><label>Hóa đơn</label><select v-model="form.invoice_status" class="select"><option v-for="s in INVOICE_STATUS_OPTIONS" :key="s" :value="s">{{ s }}</option></select></div>
        <div class="form-group"><label>VAT %</label><select v-model.number="form.vat_rate" class="select"><option v-for="s in VAT_RATE_OPTIONS" :key="s" :value="s">{{ s }}</option></select></div>
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
          <div class="logo-mode-note">Khi tick mục này, số lượng, đơn giá và thành tiền sẽ lấy theo từng dòng logo bên dưới.</div>
          <div v-for="(line, logoIndex) in item.logo_lines" :key="logoIndex" class="logo-row">
            <div class="form-group"><label>Logo</label><input v-model="line.logo" class="input" placeholder="VD: Logo A" /></div>
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
    </BaseModal>

    <RecordDetailModal
      v-if="showDetailModal && selectedDetail"
      title="Chi tiết đơn hàng"
      :record="selectedDetail"
      :labels="orderDetailLabels"
      :field-order="[
        'id','order_code','order_date','customer_id','customer_name','phone','sale_name','sale_email',
        'owner_email','created_by','created_at','updated_at','order_status','operation_status',
        'expected_delivery_date','completed_date','items_count','subtotal_no_vat','vat_rate','vat_amount',
        'total_vat','actual_revenue','paid_amount','debt_amount','payment_status','invoice_status',
        'warehouse_fulfillment_status','warehouse_request_status','note','status','active','deleted'
      ]"
      :money-fields="['subtotal_no_vat','vat_amount','total_vat','actual_revenue','paid_amount','debt_amount']"
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
    </RecordDetailModal>

    <ConfirmModal
      v-bind="confirmState"
      @cancel="resolveConfirm(false)"
      @confirm="resolveConfirm(true)"
    />
  </AppShell>
</template>
