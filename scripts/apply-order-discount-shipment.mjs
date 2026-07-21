import { readFileSync, writeFileSync } from 'node:fs'

function replaceOnce(path, before, after) {
  const source = readFileSync(path, 'utf8')
  const count = source.split(before).length - 1
  if (count !== 1) throw new Error(`${path}: expected one match, found ${count} for ${before.slice(0, 80)}`)
  writeFileSync(path, source.replace(before, after))
}

function appendBefore(path, marker, content) {
  const source = readFileSync(path, 'utf8')
  if (!source.includes(marker)) throw new Error(`${path}: marker not found`)
  if (source.includes(content.trim())) return
  writeFileSync(path, source.replace(marker, `${content}\n${marker}`))
}

replaceOnce(
  'types/models.ts',
  `  total_vat?: number
  shipping_fee?: number`,
  `  total_vat?: number
  discount_amount?: number
  payable_amount?: number
  shipping_fee?: number`,
)

replaceOnce(
  'types/models.ts',
  `  cod_amount?: number
  shipping_status?: string`,
  `  cod_amount?: number
  customer_pays_shipping?: boolean
  company_pays_shipping?: boolean
  company_shipping_revenue_mode?: 'Tính doanh thu' | 'Không tính doanh thu' | ''
  shipping_revenue_amount?: number
  shipping_status?: string`,
)

replaceOnce(
  'composables/useOrderLogic.ts',
  `    const total_vat = round2(subtotal_no_vat + vat_amount)
    return {
      items: normalized,
      subtotal_no_vat,
      vat_amount,
      total_vat,
      actual_revenue: total_vat,
      shipping_fee: 0,
      adjustment_amount: 0
    }`,
  `    const total_vat = round2(subtotal_no_vat + vat_amount)
    const discount_amount = round2(Math.max(0, toNumber(order.discount_amount)))
    const payable_amount = round2(Math.max(0, total_vat - discount_amount))
    return {
      items: normalized,
      subtotal_no_vat,
      vat_amount,
      total_vat,
      discount_amount,
      payable_amount,
      actual_revenue: total_vat,
      shipping_fee: 0,
      adjustment_amount: 0
    }`,
)

replaceOnce(
  'composables/useOrderLogic.ts',
  `  function getOrderDebtBase(order: Partial<OrderDoc> = {}) {
    const actual = toNumber(order.actual_revenue)
    if (actual > 0) return actual
    return toNumber(order.total_vat) || toNumber(order.subtotal_no_vat)
  }`,
  `  function getOrderDebtBase(order: Partial<OrderDoc> = {}) {
    const gross = toNumber(order.actual_revenue) > 0
      ? toNumber(order.actual_revenue)
      : toNumber(order.total_vat) || toNumber(order.subtotal_no_vat)
    return round2(Math.max(0, gross - Math.max(0, toNumber(order.discount_amount))))
  }`,
)

replaceOnce(
  'utils/orderRelationState.mjs',
  `  const debtBase = number(order.actual_revenue) > 0
    ? number(order.actual_revenue)
    : number(order.total_vat) || number(order.subtotal_no_vat)
  const debt = round2(debtBase - paid)`,
  `  const gross = number(order.actual_revenue) > 0
    ? number(order.actual_revenue)
    : number(order.total_vat) || number(order.subtotal_no_vat)
  const debtBase = round2(Math.max(0, gross - Math.max(0, number(order.discount_amount))))
  const debt = round2(debtBase - paid)`,
)

replaceOnce(
  'pages/orders.vue',
  `  total_vat: 'Tổng sau VAT', actual_revenue: 'Tổng tiền đơn', paid_amount: 'Đã thu',
  debt_amount: 'Công nợ', payment_status: 'Trạng thái thanh toán', invoice_status: 'Trạng thái hóa đơn',`,
  `  total_vat: 'Tổng sau VAT', discount_amount: 'Số tiền giảm giá', payable_amount: 'Giá trị sau giảm giá',
  actual_revenue: 'Tổng tiền đơn', paid_amount: 'Đã thu',
  debt_amount: 'Công nợ', payment_status: 'Trạng thái thanh toán', invoice_status: 'Trạng thái hóa đơn',`,
)

replaceOnce(
  'pages/orders.vue',
  `    invoice_status: 'Không xuất',
    vat_rate: 0,
    note: '',`,
  `    invoice_status: 'Không xuất',
    vat_rate: 0,
    discount_amount: 0,
    note: '',`,
)

replaceOnce(
  'pages/orders.vue',
  `    const totals = calcItems(saveItems, form)
    if (!totals.items.length) throw new Error('Thiếu sản phẩm hợp lệ')

    const baseOrder: any = { ...form, ...totals }`,
  `    const totals = calcItems(saveItems, form)
    if (!totals.items.length) throw new Error('Thiếu sản phẩm hợp lệ')
    const requestedDiscount = toNumber(form.discount_amount)
    if (requestedDiscount < 0) throw new Error('Số tiền giảm giá không được âm.')
    if (requestedDiscount > totals.actual_revenue) throw new Error('Số tiền giảm giá không được lớn hơn tổng tiền đơn.')

    const baseOrder: any = { ...form, ...totals }`,
)

replaceOnce(
  'pages/orders.vue',
  `    const paymentSummary = editing.value
      ? {}
      : computePaymentStatus(baseOrder, paymentsByOrder.value[form.id] || [])`,
  `    const localPaymentSummary = computePaymentStatus(baseOrder, paymentsByOrder.value[form.id] || [])
    const paymentSummary = editing.value ? {} : localPaymentSummary`,
)

replaceOnce(
  'pages/orders.vue',
  `    const localOrder = {
      ...(editing.value || {}),
      ...baseOrder,
      ...paymentSummary,`,
  `    const localOrder = {
      ...(editing.value || {}),
      ...baseOrder,
      ...localPaymentSummary,`,
)

replaceOnce(
  'pages/orders.vue',
  `<table style="min-width:1420px">`,
  `<table style="min-width:1510px">`,
)

replaceOnce(
  'pages/orders.vue',
  `<th>Tạm tính</th><th>VAT</th><th>Tổng tiền</th><th>Đã thu</th><th>Công nợ</th><th>Xuất kho</th><th>Thao tác</th>`,
  `<th>Tạm tính</th><th>VAT</th><th>Tổng tiền</th><th>Giảm giá</th><th>Đã thu</th><th>Công nợ</th><th>Xuất kho</th><th>Thao tác</th>`,
)

replaceOnce(
  'pages/orders.vue',
  `              <td>{{ money(row.actual_revenue || row.total_vat) }}</td>
              <td>{{ money(row.paid_amount) }}</td>`,
  `              <td>{{ money(row.actual_revenue || row.total_vat) }}</td>
              <td>{{ money(row.discount_amount) }}</td>
              <td>{{ money(row.paid_amount) }}</td>`,
)

replaceOnce(
  'pages/orders.vue',
  `        <div class="form-group"><label>VAT %</label><select v-model.number="form.vat_rate" class="select"><option v-for="s in VAT_RATE_OPTIONS" :key="s" :value="s">{{ s }}</option></select></div>
      </div>`,
  `        <div class="form-group"><label>VAT %</label><select v-model.number="form.vat_rate" class="select"><option v-for="s in VAT_RATE_OPTIONS" :key="s" :value="s">{{ s }}</option></select></div>
        <div class="form-group"><label>Số tiền giảm giá</label><input v-model.number="form.discount_amount" class="input" type="number" min="0" /></div>
      </div>`,
)

replaceOnce(
  'pages/orders.vue',
  `      <div class="order-grand-total"><span>Tạm tính</span><span>{{ money(modalTotals.subtotal_no_vat) }}</span></div>
      <div class="order-grand-total"><span>Tổng sau VAT</span><span>{{ money(modalTotals.actual_revenue) }}</span></div>`,
  `      <div class="order-grand-total"><span>Tạm tính</span><span>{{ money(modalTotals.subtotal_no_vat) }}</span></div>
      <div class="order-grand-total"><span>Tổng sau VAT</span><span>{{ money(modalTotals.actual_revenue) }}</span></div>
      <div class="order-grand-total"><span>Giảm giá</span><span>-{{ money(modalTotals.discount_amount) }}</span></div>
      <div class="order-grand-total"><span>Giá trị sau giảm giá</span><span>{{ money(modalTotals.payable_amount) }}</span></div>`,
)

replaceOnce(
  'pages/orders.vue',
  `        'total_vat','actual_revenue','paid_amount','debt_amount','payment_status','invoice_status',`,
  `        'total_vat','discount_amount','payable_amount','actual_revenue','paid_amount','debt_amount','payment_status','invoice_status',`,
)

replaceOnce(
  'pages/orders.vue',
  `      :money-fields="['subtotal_no_vat','vat_amount','total_vat','actual_revenue','paid_amount','debt_amount']"`,
  `      :money-fields="['subtotal_no_vat','vat_amount','total_vat','discount_amount','payable_amount','actual_revenue','paid_amount','debt_amount']"`,
)

writeFileSync('pages/shipments.vue', "<script setup lang=\"ts\">\nimport type { CustomerDoc, OrderDoc, OrderItemDoc, ShipmentDoc } from '~/types/models'\nimport { formatDateTime, isActive, makeId, money, normalizeText, todayKey, toNumber } from '~/utils/format'\nimport { reportFirebaseError } from '~/utils/firebaseErrors'\n// @ts-ignore Shared ESM helper is executed directly by Node client tests.\nimport { appendUniqueRows } from '~/utils/cursorPagination.mjs'\nimport { toDateKey } from '~/utils/listFilters'\n\nconst { mutateOrderRelation } = useAtomicOrderRelations()\nconst {\n  loadScopedOrders,\n  loadScopedOrderItems,\n  loadScopedPaymentsForOrders,\n  loadScopedCustomers,\n  loadScopedShipmentsPage,\n} = useScopedQueries()\nconst { computePaymentStatus, parseLogoLines } = useOrderLogic()\nconst { appUser, hasPermission } = useAuth()\nconst { showToast, withLoading } = useUi()\nconst { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()\n\nconst rows = ref<ShipmentDoc[]>([])\nconst PAGE_SIZE = 50\nconst pageCursor = shallowRef<any>(null)\nconst hasMoreRows = ref(false)\nconst pageMode = ref<'cursor' | 'full'>('cursor')\nconst loadingMore = ref(false)\nconst orders = ref<OrderDoc[]>([])\nconst customers = ref<CustomerDoc[]>([])\nconst itemsByOrder = ref<Record<string, OrderItemDoc[]>>({})\nconst loading = ref(false)\nconst saving = ref(false)\nconst search = ref('')\nconst shippingStatusFilter = ref('')\nconst carrierFilter = ref('')\nconst dateFrom = ref('')\nconst dateTo = ref('')\nconst showModal = ref(false)\nconst showDetailModal = ref(false)\nconst selectedDetail = ref<ShipmentDoc | null>(null)\nconst editing = ref<ShipmentDoc | null>(null)\nconst form = reactive<any>({})\n\nconst filterValues = computed(() => ({ status: shippingStatusFilter.value, carrier: carrierFilter.value, from: dateFrom.value, to: dateTo.value }))\nconst toolbarFilters = computed(() => [\n  { key: 'status', label: 'Trạng thái giao', allLabel: 'Tất cả trạng thái', options: ['Chờ giao', 'Đang giao', 'Đã giao', 'Giao thất bại', 'Hoàn hàng'].map(value => ({ label: value, value })) },\n  { key: 'carrier', label: 'Nhà vận chuyển', allLabel: 'Tất cả nhà vận chuyển', options: carrierOptions.value.map(value => ({ label: value, value })) },\n  { key: 'from', label: 'Từ ngày', type: 'date' as const },\n  { key: 'to', label: 'Đến ngày', type: 'date' as const },\n])\n\nfunction updateFilter(key: string, value: string) {\n  if (key === 'status') shippingStatusFilter.value = value\n  if (key === 'carrier') carrierFilter.value = value\n  if (key === 'from') dateFrom.value = value\n  if (key === 'to') dateTo.value = value\n}\n\nconst carrierOptions = computed(() => Array.from(new Set(rows.value.map(row => String(row.carrier || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'vi')))\n\nconst filtered = computed(() => {\n  const keyword = normalizeText(search.value)\n  return rows.value.filter(row => {\n    const matchedText = !keyword || normalizeText(`${row.order_code} ${row.carrier} ${row.shipping_status} ${payerLabel(row)}`).includes(keyword)\n    const rowDate = toDateKey(row.shipped_date || row.delivered_date || row.created_at)\n    return matchedText\n      && (!shippingStatusFilter.value || row.shipping_status === shippingStatusFilter.value)\n      && (!carrierFilter.value || row.carrier === carrierFilter.value)\n      && (!dateFrom.value || (!!rowDate && rowDate >= dateFrom.value))\n      && (!dateTo.value || (!!rowDate && rowDate <= dateTo.value))\n  })\n})\n\nfunction resetFilters() {\n  search.value = ''\n  shippingStatusFilter.value = ''\n  carrierFilter.value = ''\n  dateFrom.value = ''\n  dateTo.value = ''\n}\n\nconst selectedOrder = computed(() => orders.value.find(order => order.id === form.order_id))\nconst selectedCustomer = computed(() => customers.value.find(customer => customer.id === selectedOrder.value?.customer_id))\nconst selectedOrderItems = computed(() => selectedOrder.value ? (itemsByOrder.value[selectedOrder.value.id] || []) : [])\nconst detailOrder = computed(() => orders.value.find(order => order.id === selectedDetail.value?.order_id))\nconst detailOrderItems = computed(() => detailOrder.value ? (itemsByOrder.value[detailOrder.value.id] || []) : [])\n\nfunction orderLines(items: OrderItemDoc[]) {\n  return items.flatMap(item => {\n    const logos = parseLogoLines(item.logo_json)\n    if (logos.length) {\n      return logos.map(line => ({\n        product_code: item.product_code || '',\n        product_name: item.product_name || '',\n        logo: line.logo || '',\n        unit: item.unit || '',\n        quantity: toNumber(line.quantity),\n      }))\n    }\n    return [{\n      product_code: item.product_code || '',\n      product_name: item.product_name || '',\n      logo: '',\n      unit: item.unit || '',\n      quantity: toNumber(item.quantity),\n    }]\n  })\n}\n\nconst selectedOrderLines = computed(() => orderLines(selectedOrderItems.value))\nconst detailOrderLines = computed(() => orderLines(detailOrderItems.value))\nconst orderOptions = computed(() => orders.value.map(order => ({\n  value: order.id,\n  label: `${order.order_code} - ${order.customer_name || 'Khách chưa tên'}`,\n  subLabel: `${order.order_status || 'Mới tạo'} · ${order.payment_status || 'Chưa thanh toán'} · Công nợ: ${money(order.debt_amount)}`,\n  search: `${order.order_code} ${order.customer_name || ''} ${order.phone || ''} ${order.order_status || ''} ${order.payment_status || ''}`,\n})))\n\nconst shipmentDetailLabels: Record<string, string> = {\n  order_id: 'ID đơn hàng',\n  order_code: 'Mã đơn',\n  carrier: 'Nhà vận chuyển',\n  tracking_code: 'Mã đơn (tương thích dữ liệu cũ)',\n  shipping_fee: 'Phí giao hàng',\n  cod_amount: 'Tiền COD',\n  shipping_status: 'Trạng thái giao',\n  shipped_date: 'Ngày giao',\n  delivered_date: 'Ngày hoàn thành',\n  customer_pays_shipping: 'Khách trả phí',\n  company_pays_shipping: 'Công ty trả phí',\n  company_shipping_revenue_mode: 'Cách tính doanh thu phí công ty trả',\n  shipping_revenue_amount: 'Doanh thu vận chuyển',\n  receiver_name: 'Người nhận',\n  receiver_phone: 'SĐT người nhận',\n  receiver_address: 'Địa chỉ nhận',\n  note: 'Ghi chú',\n}\n\nasync function loadRows(force = false, append = false) {\n  if (append && (!hasMoreRows.value || loadingMore.value)) return\n  if (append) loadingMore.value = true\n  else loading.value = true\n  try {\n    if (!append) {\n      const [loadedOrders, loadedCustomers] = await Promise.all([\n        loadScopedOrders(force),\n        loadScopedCustomers(force),\n      ])\n      const activeOrders = loadedOrders.filter(isActive)\n      const [loadedItems, loadedPayments] = await Promise.all([\n        loadScopedOrderItems(activeOrders, force),\n        loadScopedPaymentsForOrders(activeOrders, force),\n      ])\n      const itemMap: Record<string, OrderItemDoc[]> = {}\n      loadedItems.filter(isActive).forEach(item => {\n        if (!itemMap[item.order_id]) itemMap[item.order_id] = []\n        itemMap[item.order_id].push(item)\n      })\n      const paymentMap: Record<string, any[]> = {}\n      loadedPayments.filter(isActive).forEach(payment => {\n        if (!paymentMap[payment.order_id]) paymentMap[payment.order_id] = []\n        paymentMap[payment.order_id].push(payment)\n      })\n      itemsByOrder.value = itemMap\n      customers.value = loadedCustomers.filter(isActive)\n      orders.value = activeOrders.map(order => ({\n        ...order,\n        ...computePaymentStatus(order, paymentMap[order.id] || []),\n      }))\n    }\n    const page = await loadScopedShipmentsPage(append ? pageCursor.value : null, PAGE_SIZE, force)\n    const loadedRows = page.rows.filter(isActive)\n    rows.value = append ? appendUniqueRows(rows.value, loadedRows) : loadedRows\n    pageCursor.value = page.cursor\n    hasMoreRows.value = page.hasMore\n    pageMode.value = page.mode\n  } catch (error) {\n    showToast(reportFirebaseError(error, 'Không tải được dữ liệu vận chuyển.'), 'error')\n  } finally {\n    loading.value = false\n    loadingMore.value = false\n  }\n}\n\nasync function loadMoreRows() {\n  await loadRows(false, true)\n}\n\nfunction chooseOrder() {\n  const order = selectedOrder.value\n  if (!order) return\n  const customer = selectedCustomer.value\n  form.order_code = order.order_code\n  // Keep the legacy field synchronized so old reports/integrations do not break.\n  form.tracking_code = order.order_code\n  form.receiver_name = customer?.customer_name || order.customer_name || ''\n  form.receiver_phone = customer?.phone || order.phone || ''\n  form.receiver_address = customer?.shipping_address || customer?.billing_address || ''\n}\n\nfunction onCompanyPayerChange() {\n  if (!form.company_pays_shipping) form.company_shipping_revenue_mode = ''\n}\n\nfunction payerLabel(row: Partial<ShipmentDoc>) {\n  const labels: string[] = []\n  const legacyCustomerPays = row.customer_pays_shipping == null && row.company_pays_shipping == null\n  if (row.customer_pays_shipping === true || legacyCustomerPays) labels.push('Khách trả')\n  if (row.company_pays_shipping === true) labels.push('Công ty trả')\n  return labels.join(' + ') || '-'\n}\n\nfunction openDetail(row: ShipmentDoc) {\n  selectedDetail.value = row\n  showDetailModal.value = true\n}\n\nfunction openModal(row?: ShipmentDoc) {\n  if (row && !hasPermission('shipments.edit') && !hasPermission('*')) return showToast('Bạn không có quyền sửa vận chuyển.', 'error')\n  editing.value = row || null\n  Object.keys(form).forEach(key => delete form[key])\n  Object.assign(form, row ? {\n    ...row,\n    customer_pays_shipping: row.customer_pays_shipping == null && row.company_pays_shipping == null\n      ? true\n      : row.customer_pays_shipping === true,\n    company_pays_shipping: row.company_pays_shipping === true,\n    company_shipping_revenue_mode: row.company_shipping_revenue_mode || '',\n  } : {\n    id: makeId('shp'),\n    order_id: '',\n    order_code: '',\n    carrier: '',\n    tracking_code: '',\n    shipping_fee: 0,\n    cod_amount: 0,\n    shipping_status: 'Chờ giao',\n    shipped_date: todayKey(),\n    delivered_date: '',\n    customer_pays_shipping: true,\n    company_pays_shipping: false,\n    company_shipping_revenue_mode: '',\n    shipping_revenue_amount: 0,\n    receiver_name: '',\n    receiver_phone: '',\n    receiver_address: '',\n    note: '',\n    status: 'active'\n  })\n  showModal.value = true\n}\n\nasync function save() {\n  if (editing.value && !hasPermission('shipments.edit') && !hasPermission('*')) return showToast('Bạn không có quyền sửa vận chuyển.', 'error')\n  if (!editing.value && !hasPermission('shipments.create') && !hasPermission('*')) return showToast('Bạn không có quyền tạo vận chuyển.', 'error')\n  if (!form.order_id) return showToast('Vui lòng chọn đơn hàng.', 'error')\n  if (!form.customer_pays_shipping && !form.company_pays_shipping) return showToast('Vui lòng chọn ít nhất một bên trả phí vận chuyển.', 'error')\n  if (form.company_pays_shipping && !form.company_shipping_revenue_mode) return showToast('Vui lòng chọn tính hoặc không tính doanh thu cho phần công ty trả.', 'error')\n  const order = selectedOrder.value\n  if (!order) return showToast('Không tìm thấy đơn hàng.', 'error')\n\n  saving.value = true\n  await withLoading(async () => {\n    chooseOrder()\n    const shippingFee = toNumber(form.shipping_fee)\n    const shippingRevenueAmount = form.company_pays_shipping && form.company_shipping_revenue_mode === 'Tính doanh thu'\n      ? shippingFee\n      : 0\n    const result = await mutateOrderRelation({\n      module: 'shipments',\n      mode: editing.value ? 'update' : 'create',\n      order,\n      record: {\n        ...form,\n        tracking_code: order.order_code,\n        shipping_fee: shippingFee,\n        cod_amount: toNumber(form.cod_amount),\n        customer_pays_shipping: form.customer_pays_shipping === true,\n        company_pays_shipping: form.company_pays_shipping === true,\n        company_shipping_revenue_mode: form.company_pays_shipping ? form.company_shipping_revenue_mode : '',\n        shipping_revenue_amount: shippingRevenueAmount,\n        created_by: editing.value?.created_by || appUser.value?.email || '',\n      },\n      existingRecords: rows.value.filter(row => row.order_id === order.id),\n      actor: appUser.value?.email || '',\n    })\n\n    const record = result.record as ShipmentDoc\n    const index = rows.value.findIndex(row => row.id === record.id)\n    if (index >= 0) rows.value[index] = { ...rows.value[index], ...record }\n    else rows.value.unshift(record)\n    Object.assign(order, result.orderPatch)\n    showModal.value = false\n    showToast(editing.value ? 'Đã cập nhật vận chuyển và tổng hợp đơn hàng.' : 'Đã thêm vận chuyển và cập nhật đơn hàng.', 'success')\n  }).catch(error => showToast(reportFirebaseError(error, 'Không lưu được vận chuyển. Toàn bộ thay đổi đã hoàn tác.'), 'error'))\n    .finally(() => { saving.value = false })\n}\n\nasync function remove(row: ShipmentDoc) {\n  if (!hasPermission('shipments.delete') && !hasPermission('*')) return showToast('Bạn không có quyền xóa vận chuyển.', 'error')\n  const order = orders.value.find(item => item.id === row.order_id)\n  if (!order) return showToast('Không tìm thấy đơn hàng cha của vận chuyển.', 'error')\n  const confirmed = await askConfirm({\n    title: 'Xóa vận chuyển',\n    message: `Bạn chắc chắn muốn xóa vận chuyển của đơn ${row.order_code}?`,\n    confirmLabel: 'Xóa vận chuyển'\n  })\n  if (!confirmed) return\n  await withLoading(async () => {\n    const result = await mutateOrderRelation({\n      module: 'shipments',\n      mode: 'delete',\n      order,\n      record: row,\n      existingRecords: rows.value.filter(item => item.order_id === order.id),\n      actor: appUser.value?.email || '',\n    })\n    rows.value = rows.value.filter(item => item.id !== row.id)\n    Object.assign(order, result.orderPatch)\n    showToast('Đã xóa vận chuyển và cập nhật lại tổng hợp đơn hàng.', 'success')\n  }).catch(error => showToast(reportFirebaseError(error, 'Không xóa được vận chuyển. Toàn bộ thay đổi đã hoàn tác.'), 'error'))\n}\n\nonMounted(() => loadRows())\n</script>\n\n<template>\n  <AppShell>\n    <PageHeader title=\"Vận chuyển\" subtitle=\"Theo dõi giao hàng, vận chuyển và COD\">\n      <button v-if=\"hasPermission('shipments.create') || hasPermission('*')\" class=\"btn primary\" @click=\"openModal()\">+ Thêm vận chuyển</button>\n    </PageHeader>\n\n    <div class=\"card\" style=\"margin: 24px;\">\n      <FilterToolbar\n        v-model:search=\"search\"\n        search-placeholder=\"Tìm mã đơn, nhà vận chuyển, bên trả phí...\"\n        :filters=\"toolbarFilters\"\n        :values=\"filterValues\"\n        :result-count=\"filtered.length\"\n        :loading=\"loading\"\n        show-refresh\n        @update:filter=\"updateFilter\"\n        @reset=\"resetFilters\"\n        @refresh=\"loadRows(true)\"\n      />\n\n      <LoadingState v-if=\"loading\" />\n      <div v-else class=\"table-wrap\">\n        <table style=\"min-width:1180px\">\n          <thead>\n            <tr><th>Đơn hàng</th><th>Nhà vận chuyển</th><th>Mã đơn</th><th>Bên trả phí</th><th>Ngày giao</th><th>Phí giao</th><th>Doanh thu VC</th><th>COD</th><th>Trạng thái</th><th>Thao tác</th></tr>\n          </thead>\n          <tbody>\n            <tr v-for=\"row in filtered\" :key=\"row.id\">\n              <td>{{ row.order_code }}</td>\n              <td>{{ row.carrier }}</td>\n              <td>{{ row.order_code }}</td>\n              <td>{{ payerLabel(row) }}</td>\n              <td>{{ formatDateTime(row.shipped_date) }}</td>\n              <td>{{ money(row.shipping_fee) }}</td>\n              <td>{{ money(row.shipping_revenue_amount) }}</td>\n              <td>{{ money(row.cod_amount) }}</td>\n              <td><span class=\"badge\">{{ row.shipping_status }}</span></td>\n              <td>\n                <div class=\"action-buttons\">\n                  <button class=\"btn-sm btn-view\" @click=\"openDetail(row)\">Xem</button>\n                  <button v-if=\"hasPermission('shipments.edit') || hasPermission('*')\" class=\"btn-sm\" @click=\"openModal(row)\">Sửa</button>\n                  <button v-if=\"hasPermission('shipments.delete') || hasPermission('*')\" class=\"btn-sm btn-delete\" @click=\"remove(row)\">Xóa</button>\n                </div>\n              </td>\n            </tr>\n            <tr v-if=\"!filtered.length\"><td colspan=\"10\" class=\"empty\">Không có dữ liệu vận chuyển.</td></tr>\n          </tbody>\n        </table>\n      </div>\n      <CursorLoadMore :loaded-count=\"rows.length\" :has-more=\"hasMoreRows\" :loading=\"loadingMore\" :mode=\"pageMode\" @load-more=\"loadMoreRows\" />\n    </div>\n\n    <BaseModal v-if=\"showModal\" :title=\"editing ? 'Sửa vận chuyển' : 'Thêm vận chuyển'\" size=\"xl\" :loading=\"saving\" @close=\"showModal=false\" @save=\"save\">\n      <div class=\"form-grid\">\n        <div class=\"form-group\">\n          <label>Đơn hàng</label>\n          <SearchableSelect\n            v-model=\"form.order_id\"\n            :options=\"orderOptions\"\n            :disabled=\"!!editing\"\n            placeholder=\"Tìm theo mã đơn, khách hàng, SĐT...\"\n            @change=\"chooseOrder\"\n          />\n        </div>\n        <div class=\"form-group\"><label>Mã đơn</label><input v-model=\"form.order_code\" class=\"input readonly-field\" readonly /></div>\n        <div class=\"form-group\"><label>Nhà vận chuyển</label><input v-model=\"form.carrier\" class=\"input\" /></div>\n        <div class=\"form-group\"><label>Ngày giao</label><input v-model=\"form.shipped_date\" class=\"input\" type=\"date\" /></div>\n        <div class=\"form-group\"><label>Phí giao hàng</label><input v-model.number=\"form.shipping_fee\" class=\"input\" type=\"number\" min=\"0\" /></div>\n        <div class=\"form-group\"><label>Tiền COD</label><input v-model.number=\"form.cod_amount\" class=\"input\" type=\"number\" min=\"0\" /></div>\n        <div class=\"form-group\"><label>Trạng thái</label><select v-model=\"form.shipping_status\" class=\"select\"><option>Chờ giao</option><option>Đang giao</option><option>Đã giao</option><option>Giao thất bại</option><option>Hoàn hàng</option></select></div>\n      </div>\n\n      <template v-if=\"selectedOrder\">\n        <div class=\"detail-grid\" style=\"margin-top:16px\">\n          <div class=\"detail-item\"><label>Trạng thái đơn hàng</label><strong>{{ selectedOrder.order_status || 'Mới tạo' }}</strong></div>\n          <div class=\"detail-item\"><label>Thanh toán</label><strong>{{ selectedOrder.payment_status || 'Chưa thanh toán' }}</strong></div>\n          <div class=\"detail-item\"><label>Tổng tiền đơn</label><strong>{{ money(selectedOrder.actual_revenue || selectedOrder.total_vat) }}</strong></div>\n          <div class=\"detail-item\"><label>Giảm giá</label><strong>{{ money(selectedOrder.discount_amount) }}</strong></div>\n          <div class=\"detail-item\"><label>Đã thu</label><strong>{{ money(selectedOrder.paid_amount) }}</strong></div>\n          <div class=\"detail-item\"><label>Công nợ</label><strong>{{ money(selectedOrder.debt_amount) }}</strong></div>\n        </div>\n\n        <h3 style=\"margin-top:18px\">Sản phẩm trong đơn</h3>\n        <div class=\"table-wrap\">\n          <table style=\"min-width:760px\">\n            <thead><tr><th>Sản phẩm</th><th>Mã SP</th><th>Logo</th><th>Đơn vị</th><th>Số lượng</th></tr></thead>\n            <tbody>\n              <tr v-for=\"(line, index) in selectedOrderLines\" :key=\"`${line.product_code}|${line.logo}|${index}`\">\n                <td><b>{{ line.product_name || '-' }}</b></td>\n                <td>{{ line.product_code || '-' }}</td>\n                <td>{{ line.logo || '-' }}</td>\n                <td>{{ line.unit || '-' }}</td>\n                <td>{{ line.quantity }}</td>\n              </tr>\n              <tr v-if=\"!selectedOrderLines.length\"><td colspan=\"5\" class=\"empty\">Đơn hàng chưa có sản phẩm.</td></tr>\n            </tbody>\n          </table>\n        </div>\n      </template>\n\n      <div class=\"form-group\" style=\"margin-top:16px\">\n        <label>Bên trả phí vận chuyển</label>\n        <div style=\"display:flex;gap:20px;flex-wrap:wrap\">\n          <label><input v-model=\"form.customer_pays_shipping\" type=\"checkbox\" /> Khách trả</label>\n          <label><input v-model=\"form.company_pays_shipping\" type=\"checkbox\" @change=\"onCompanyPayerChange\" /> Công ty trả</label>\n        </div>\n        <div class=\"small subtle\">Có thể chọn đồng thời cả khách và công ty.</div>\n      </div>\n\n      <div v-if=\"form.company_pays_shipping\" class=\"form-group\">\n        <label>Phần công ty trả có tính doanh thu?</label>\n        <div style=\"display:flex;gap:20px;flex-wrap:wrap\">\n          <label><input v-model=\"form.company_shipping_revenue_mode\" type=\"radio\" value=\"Tính doanh thu\" /> Tính doanh thu</label>\n          <label><input v-model=\"form.company_shipping_revenue_mode\" type=\"radio\" value=\"Không tính doanh thu\" /> Không tính doanh thu</label>\n        </div>\n      </div>\n\n      <div class=\"form-grid\">\n        <div class=\"form-group\"><label>Người nhận</label><input v-model=\"form.receiver_name\" class=\"input\" /></div>\n        <div class=\"form-group\"><label>SĐT người nhận</label><input v-model=\"form.receiver_phone\" class=\"input\" /></div>\n      </div>\n      <div class=\"form-group\"><label>Địa chỉ nhận</label><textarea v-model=\"form.receiver_address\" class=\"textarea\" rows=\"2\" /></div>\n      <div class=\"form-group\"><label>Ghi chú</label><textarea v-model=\"form.note\" class=\"textarea\" rows=\"2\" /></div>\n    </BaseModal>\n\n    <RecordDetailModal\n      v-if=\"showDetailModal && selectedDetail\"\n      title=\"Chi tiết vận chuyển\"\n      :record=\"selectedDetail\"\n      :labels=\"shipmentDetailLabels\"\n      :field-order=\"['id','order_id','order_code','carrier','tracking_code','shipping_status','shipped_date','delivered_date','shipping_fee','cod_amount','customer_pays_shipping','company_pays_shipping','company_shipping_revenue_mode','shipping_revenue_amount','receiver_name','receiver_phone','receiver_address','note','created_by','created_at','updated_at','order_owner_email','order_created_by','order_sale_email','relation_revision','last_operation_id','status','active','deleted']\"\n      :money-fields=\"['shipping_fee','cod_amount','shipping_revenue_amount']\"\n      @close=\"showDetailModal = false\"\n    >\n      <template v-if=\"detailOrder\">\n        <h3 style=\"margin-top:20px\">Đơn hàng liên kết</h3>\n        <div class=\"detail-grid\">\n          <div class=\"detail-item\"><label>Trạng thái đơn hàng</label><strong>{{ detailOrder.order_status || 'Mới tạo' }}</strong></div>\n          <div class=\"detail-item\"><label>Thanh toán</label><strong>{{ detailOrder.payment_status || 'Chưa thanh toán' }}</strong></div>\n          <div class=\"detail-item\"><label>Công nợ</label><strong>{{ money(detailOrder.debt_amount) }}</strong></div>\n        </div>\n        <h3 style=\"margin-top:20px\">Sản phẩm trong đơn</h3>\n        <div class=\"table-wrap\">\n          <table style=\"min-width:760px\">\n            <thead><tr><th>Sản phẩm</th><th>Mã SP</th><th>Logo</th><th>Đơn vị</th><th>Số lượng</th></tr></thead>\n            <tbody>\n              <tr v-for=\"(line, index) in detailOrderLines\" :key=\"`${line.product_code}|${line.logo}|${index}`\">\n                <td><b>{{ line.product_name || '-' }}</b></td>\n                <td>{{ line.product_code || '-' }}</td>\n                <td>{{ line.logo || '-' }}</td>\n                <td>{{ line.unit || '-' }}</td>\n                <td>{{ line.quantity }}</td>\n              </tr>\n            </tbody>\n          </table>\n        </div>\n      </template>\n    </RecordDetailModal>\n\n    <ConfirmModal v-bind=\"confirmState\" @cancel=\"resolveConfirm(false)\" @confirm=\"resolveConfirm(true)\" />\n  </AppShell>\n</template>\n")

appendBefore(
  'tests/order-relations.client.test.mjs',
  `test('sửa trạng thái thanh toán tính lại tổng hợp từ toàn bộ phiếu hoạt động', () => {`,
  `test('công nợ trừ số tiền giảm giá trước khi trừ thanh toán', () => {
  const summary = computePaymentRelationSummary({ ...readyOrder, discount_amount: 150 }, [
    { id: 'pay-a', payment_status: 'Đã nhận', amount: 300 },
  ])
  assert.equal(summary.paid_amount, 300)
  assert.equal(summary.debt_amount, 550)
})\n`,
)

replaceOnce(
  'tests/order-relations.client.test.mjs',
  `  assert.match(orders, /relation_lock_version: 1/)
})`,
  `  assert.match(orders, /relation_lock_version: 1/)
  assert.match(orders, /discount_amount/)
  assert.match(shipments, /SearchableSelect/)
  assert.match(shipments, /customer_pays_shipping/)
  assert.match(shipments, /company_shipping_revenue_mode/)
  assert.match(shipments, /receiver_address/)
})`,
)

console.log('Applied order discount and shipment workflow changes.')
