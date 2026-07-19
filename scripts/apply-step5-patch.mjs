import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

function replaceExact(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Không tìm thấy đoạn cần thay: ${label}`)
  return source.replace(before, after)
}

function replaceBetween(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  if (start < 0 || end < 0 || end <= start) throw new Error(`Không tìm thấy vùng cần thay: ${label}`)
  return `${source.slice(0, start)}${replacement}\n\n${source.slice(end)}`
}

const ordersPath = 'pages/orders.vue'
let orders = readFileSync(ordersPath, 'utf8')
orders = replaceExact(
  orders,
  "import { collection, doc, runTransaction, serverTimestamp, writeBatch } from 'firebase/firestore'",
  "import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore'",
  'bỏ runTransaction trực tiếp khỏi page',
)
orders = replaceExact(
  orders,
  "import { buildOrderCode, customerCodeValidationError, normalizeCustomerCode, normalizeUserCode, ORDER_SEQUENCE_START, userCodeValidationError } from '~/utils/orderCode'",
  "import { customerCodeValidationError, normalizeCustomerCode, normalizeUserCode, userCodeValidationError } from '~/utils/orderCode'",
  'dọn import order code',
)
orders = replaceExact(
  orders,
  "const { loadScopedOrders, loadScopedOrderItems, loadScopedPayments, loadScopedExportRequests, loadScopedCustomers, loadProducts } = useScopedQueries()\nconst { showToast, withLoading } = useUi()",
  "const { loadScopedOrders, loadScopedOrderItems, loadScopedPayments, loadScopedExportRequests, loadScopedCustomers, loadProducts } = useScopedQueries()\nconst { saveOrderAtomic } = useAtomicOrderSave()\nconst { showToast, withLoading } = useUi()",
  'nối atomic composable',
)

const saveOrderReplacement = `async function saveOrder() {
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
    let selectedCustomer = customers.value.find(customer => customer.id === form.customer_id)
    if (!editing.value && selectedCustomer && !selectedCustomer.customer_code) {
      if (!hasPermission('customers.edit')) {
        throw new Error('Khách hàng chưa có Mã khách tự động. Vui lòng cấp quyền sửa khách hàng hoặc cập nhật khách tại trang Khách hàng trước khi tạo đơn.')
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
      throw new Error(\`\${userCodeError} Vui lòng nhờ quản trị viên cập nhật tài khoản.\`)
    }

    const saveItems = buildSaveItems()
    const exportError = validateNotBelowExported(saveItems)
    if (exportError) throw new Error(exportError)
    const totals = calcItems(saveItems, form)
    if (!totals.items.length) throw new Error('Thiếu sản phẩm hợp lệ')

    const baseOrder: any = { ...form, ...totals }
    if (editing.value) {
      const protectedFields = [
        'paid_amount', 'debt_amount', 'computed_payment_status', 'payment_status',
        'payment_count', 'deposit_count', 'collect_count',
        'warehouse_fulfillment_status', 'warehouse_request_status',
        'deleted', 'active', 'status', 'deleted_at', 'created_at'
      ]
      if (!canManageInvoiceStatus.value) protectedFields.push('invoice_status')
      protectedFields.forEach(key => delete baseOrder[key])
    }

    const paymentSummary = editing.value
      ? {}
      : computePaymentStatus(baseOrder, paymentsByOrder.value[form.id] || [])
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
      search_text: normalizeText(\`\${form.order_code || ''} \${form.customer_name} \${form.phone}\`),
      ...(editing.value ? {} : {
        invoice_status: form.invoice_status || 'Không xuất',
        warehouse_fulfillment_status: form.warehouse_fulfillment_status || 'chua_xuat',
        warehouse_request_status: form.warehouse_request_status || '',
        created_at: serverTimestamp(),
        active: true,
        deleted: false,
        status: form.status || 'active'
      })
    }

    const result = await saveOrderAtomic({
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

    form.order_code = result.orderCode
    form.order_sequence = result.orderSequence
    form.user_code = userCode
    form.customer_code = customerCode
    form.revision = result.revision
    form.last_operation_id = result.operationId

    const now = new Date().toISOString()
    const previousItems = new Map(existingItems.map(item => [item.id, item]))
    const localItems = totals.items.map((item: any) => ({
      ...item,
      order_id: form.id,
      order_code: result.orderCode,
      owner_email: ownerEmail,
      sale_email: saleEmail,
      created_by: createdBy,
      order_revision: result.revision,
      last_operation_id: result.operationId,
      status: 'active',
      active: true,
      deleted: false,
      created_at: previousItems.get(item.id)?.created_at || now,
      updated_at: now
    })) as OrderItemDoc[]
    itemsByOrder.value[form.id] = localItems

    const localOrder = {
      ...(editing.value || {}),
      ...baseOrder,
      ...paymentSummary,
      id: form.id,
      order_code: result.orderCode,
      order_sequence: result.orderSequence,
      user_code: userCode,
      customer_code: customerCode,
      owner_email: ownerEmail,
      sale_email: saleEmail,
      created_by: createdBy,
      revision: result.revision,
      last_operation_id: result.operationId,
      invoice_status: editing.value && !canManageInvoiceStatus.value
        ? (editing.value.invoice_status || 'Không xuất')
        : (form.invoice_status || 'Không xuất'),
      items_count: localItems.length,
      active: true,
      deleted: false,
      created_at: editing.value?.created_at || now,
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
  }).catch(error => showToast(
    (error as any)?.code
      ? reportFirebaseError(error, 'Lưu đơn thất bại. Toàn bộ thay đổi đã được hoàn tác.')
      : ((error as any)?.message || 'Lưu đơn thất bại. Toàn bộ thay đổi đã được hoàn tác.'),
    'error',
  )).finally(() => {
    saving.value = false
  })
}`

orders = replaceBetween(
  orders,
  'async function commitWriteChunks',
  'async function softDeleteOrder',
  saveOrderReplacement,
  'thay luồng lưu đơn nhiều batch bằng transaction nguyên tử',
)
writeFileSync(ordersPath, orders)

const rulesPath = 'firestore.rules'
let rules = readFileSync(rulesPath, 'utf8')
rules = replaceExact(
  rules,
`    function canMutateOrderById(orderId) {
      let path = orderPath(orderId);
      let order = get(path).data;
      return orderId is string
        && exists(path)
        && orderDataIsActive(order)
        && (
          isAdmin()
          || ownsOrderData(order)
        );
    }
`,
`    function canMutateOrderById(orderId) {
      let path = orderPath(orderId);
      let order = get(path).data;
      return orderId is string
        && exists(path)
        && orderDataIsActive(order)
        && (
          isAdmin()
          || ownsOrderData(order)
        );
    }

    function canMutateOrderAfterById(orderId) {
      let path = orderPath(orderId);
      let order = getAfter(path).data;
      return orderId is string
        && existsAfter(path)
        && orderDataIsActive(order)
        && (
          isAdmin()
          || ownsOrderData(order)
        );
    }
`,
  'thêm parent getAfter cho transaction tạo đơn',
)
rules = replaceExact(
  rules,
`    function requestMatchesOrderItem(orderId) {
      let path = orderPath(orderId);
      let order = get(path).data;
      return orderId is string
        && exists(path)
        && orderDataIsActive(order)
        && sameEmailField(request.resource.data, order, 'owner_email')
        && sameEmailField(request.resource.data, order, 'created_by')
        && sameEmailField(request.resource.data, order, 'sale_email');
    }
`,
`    function requestMatchesOrderItem(orderId) {
      let path = orderPath(orderId);
      let order = get(path).data;
      return orderId is string
        && exists(path)
        && orderDataIsActive(order)
        && sameEmailField(request.resource.data, order, 'owner_email')
        && sameEmailField(request.resource.data, order, 'created_by')
        && sameEmailField(request.resource.data, order, 'sale_email');
    }

    function requestMatchesOrderItemAfter(orderId) {
      let path = orderPath(orderId);
      let order = getAfter(path).data;
      return orderId is string
        && existsAfter(path)
        && orderDataIsActive(order)
        && sameEmailField(request.resource.data, order, 'owner_email')
        && sameEmailField(request.resource.data, order, 'created_by')
        && sameEmailField(request.resource.data, order, 'sale_email');
    }
`,
  'thêm ownership getAfter cho item',
)
rules = replaceExact(
  rules,
`    function childIdentityUnchanged() {
      return unchanged([
        'order_id',
        'created_by',
        'created_at'
      ]);
    }
`,
`    function childIdentityUnchanged() {
      return unchanged([
        'order_id',
        'created_by',
        'created_at'
      ]);
    }

    function orderItemIdentityUnchanged() {
      return unchanged([
        'order_id',
        'created_at'
      ]);
    }
`,
  'cho phép backfill ownership item legacy',
)

const itemStart = rules.indexOf('    match /order_items/{docId} {')
const itemEnd = rules.indexOf('    // ---------------------------------------------------------------------\n    // Payments', itemStart)
if (itemStart < 0 || itemEnd < 0) throw new Error('Không tìm thấy block order_items')
let itemRules = rules.slice(itemStart, itemEnd)
itemRules = replaceExact(
  itemRules,
`      allow create: if hasPerm('orders.create')
        && request.resource.data.order_id is string
        && canMutateOrderById(request.resource.data.order_id)
        && requestMatchesOrderItem(request.resource.data.order_id);`,
`      allow create: if hasAnyPerm(['orders.create', 'orders.edit'])
        && request.resource.data.order_id is string
        && canMutateOrderAfterById(request.resource.data.order_id)
        && requestMatchesOrderItemAfter(request.resource.data.order_id);`,
  'quyền tạo item trong atomic create/edit',
)
itemRules = replaceExact(
  itemRules,
  '          && childIdentityUnchanged()\n          && orderItemOwnershipSafe(resource.data.order_id)',
  '          && orderItemIdentityUnchanged()\n          && orderItemOwnershipSafe(resource.data.order_id)',
  'identity item update',
)
itemRules = replaceExact(
  itemRules,
`            || (
              hasPerm('orders.delete')
              && softDeleteOnly()
            )`,
`            || (
              hasAnyPerm(['orders.edit', 'orders.delete'])
              && softDeleteOnly()
            )`,
  'cho phép sửa đơn bỏ dòng sản phẩm',
)
rules = `${rules.slice(0, itemStart)}${itemRules}${rules.slice(itemEnd)}`
writeFileSync(rulesPath, rules)

const packagePath = 'package.json'
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
const oldFragment = 'tests/order-items-by-order.rules.test.mjs tests/firebase-error-message.static.test.mjs'
const newFragment = 'tests/order-items-by-order.rules.test.mjs tests/order-atomic-save.client.test.mjs tests/order-atomic-save.rules.test.mjs tests/firebase-error-message.static.test.mjs'
if (!pkg.scripts['test:rules'].includes(oldFragment)) throw new Error('Không tìm thấy vị trí thêm test Bước 5')
pkg.scripts['test:rules'] = pkg.scripts['test:rules'].replace(oldFragment, newFragment)
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)

unlinkSync('scripts/apply-step5-patch.mjs')
unlinkSync('.github/workflows/apply-step5-patch.yml')
console.log('Đã áp dụng patch Bước 5 và xóa workflow một lần.')
