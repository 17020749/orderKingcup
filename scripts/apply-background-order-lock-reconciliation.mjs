import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

function write(path, content) {
  writeFileSync(path, content, 'utf8')
}

function replaceExact(source, before, after, expectedCount, label) {
  const count = source.split(before).length - 1
  if (count !== expectedCount) {
    throw new Error(`${label}: expected ${expectedCount} matches, found ${count}`)
  }
  return source.split(before).join(after)
}

// Firestore Rules: add a dedicated admin-only reconciliation branch that also
// works for legacy and fully-fulfilled orders.
let rules = read('firestore.rules')
rules = replaceExact(
  rules,
  `        );\n    }\n\n    function printCreateHasParentLock(printOrderId, data) {`,
  `        );\n    }\n\n    function orderPrintingReconcileAllowed() {\n      return isAdmin()\n        && onlyPrintingLockChanged()\n        && request.resource.data.get('printing_last_action', '') == 'reconcile'\n        && request.resource.data.get('printing_last_print_order_id', '') == ''\n        && request.resource.data.get('printing_lock_version', 0) == 1\n        && request.resource.data.get('printing_progress_count', -1) is int\n        && request.resource.data.get('printing_progress_count', -1) >= 0\n        && ownEmailField(request.resource.data, 'printing_lock_updated_by');\n    }\n\n    function printCreateHasParentLock(printOrderId, data) {`,
  1,
  'printing reconcile rule helper',
)
rules = replaceExact(
  rules,
  `        || orderPrintingSummaryUpdateAllowed(docId)`,
  `        || (\n          request.resource.data.get('printing_last_action', '') == 'reconcile'\n          && orderPrintingReconcileAllowed()\n        )\n        || orderPrintingSummaryUpdateAllowed(docId)`,
  1,
  'printing reconcile rule dispatch',
)
write('firestore.rules', rules)

// Relation state: determine whether reconciliation actually needs a write.
let relationState = read('utils/orderRelationState.mjs')
relationState = replaceExact(
  relationState,
  `export function buildReconciledOrderRelationPatch({ order, payments = [], invoices = [], shipments = [], actor, updatedAt }) {`,
  `const RELATION_RECONCILE_FIELDS = [\n  'relation_lock_version',\n  'payment_record_count', 'invoice_record_count', 'shipment_record_count',\n  'paid_amount', 'debt_amount', 'computed_payment_status', 'payment_status',\n  'payment_count', 'deposit_count', 'collect_count',\n  'invoice_status', 'shipment_status', 'shipping_fee_total', 'cod_amount_total',\n  'payment_relation_revision', 'invoice_relation_revision', 'shipment_relation_revision',\n]\n\nexport function relationReconcileNeeded(order = {}, patch = {}) {\n  return RELATION_RECONCILE_FIELDS.some(field => {\n    if (!Object.prototype.hasOwnProperty.call(order, field)) return true\n    const current = order[field]\n    const next = patch[field]\n    if (typeof next === 'number') return Number(current) !== next\n    return text(current) !== text(next)\n  })\n}\n\nexport function buildReconciledOrderRelationPatch({ order, payments = [], invoices = [], shipments = [], actor, updatedAt }) {`,
  1,
  'relation reconcile comparison helper',
)
relationState = replaceExact(
  relationState,
  `Đơn hàng cũ chưa được đồng bộ khóa thanh toán, hóa đơn và vận chuyển. Quản trị viên cần chạy “Đồng bộ khóa liên kết đơn”.`,
  `Đơn hàng cũ chưa hoàn tất đồng bộ khóa thanh toán, hóa đơn và vận chuyển. Vui lòng tải lại sau khi hệ thống xử lý.`,
  1,
  'relation blocker message',
)
write('utils/orderRelationState.mjs', relationState)

// Relation mutations: skip unchanged orders and remove instructions to run a button.
let atomicRelations = read('composables/useAtomicOrderRelations.ts')
atomicRelations = replaceExact(
  atomicRelations,
  `  relationRecordsByOrder,\n  relationRevisionField,`,
  `  relationRecordsByOrder,\n  relationReconcileNeeded,\n  relationRevisionField,`,
  1,
  'relation reconcile import',
)
atomicRelations = replaceExact(
  atomicRelations,
  `Đơn hàng cũ chưa được đồng bộ khóa thanh toán, hóa đơn và vận chuyển. Quản trị viên cần chạy “Đồng bộ khóa liên kết đơn”.`,
  `Đơn hàng cũ chưa hoàn tất đồng bộ khóa thanh toán, hóa đơn và vận chuyển. Vui lòng tải lại sau khi hệ thống xử lý.`,
  1,
  'atomic relation initial message',
)
atomicRelations = replaceExact(
  atomicRelations,
  `Đơn hàng cũ chưa được đồng bộ khóa thanh toán, hóa đơn và vận chuyển.`,
  `Đơn hàng cũ chưa hoàn tất đồng bộ khóa thanh toán, hóa đơn và vận chuyển.`,
  1,
  'atomic relation transaction message',
)
atomicRelations = replaceExact(
  atomicRelations,
  `        updatedAt: serverTimestamp(),\n      })\n      batch.update(doc(db, 'orders', order.id), patch)`,
  `        updatedAt: serverTimestamp(),\n      })\n      if (!relationReconcileNeeded(order, patch)) continue\n      batch.update(doc(db, 'orders', order.id), patch)`,
  1,
  'skip unchanged relation locks',
)
write('composables/useAtomicOrderRelations.ts', atomicRelations)

// Orders page: remove the manual button and run reconciliation silently once per admin session.
let ordersPage = read('pages/orders.vue')
ordersPage = replaceExact(
  ordersPage,
  `const customerForm = reactive<any>({})\n`,
  `const customerForm = reactive<any>({})\nlet relationReconciledForUser = ''\n`,
  1,
  'orders background guard state',
)
ordersPage = replaceExact(
  ordersPage,
  `    pageMode.value = page.mode\n  } catch (error) {`,
  `    pageMode.value = page.mode\n    if (!append) setTimeout(() => { void reconcileRelationLocksInBackground() }, 0)\n  } catch (error) {`,
  1,
  'orders background scheduling',
)
ordersPage = replaceExact(
  ordersPage,
  `async function reconcileRelationLocks() {\n  if (!isAdmin.value) return showToast('Chỉ quản trị viên được đồng bộ khóa liên kết đơn.', 'error')\n  const confirmed = await askConfirm({\n    title: 'Đồng bộ khóa liên kết đơn',\n    message: 'Hệ thống sẽ đếm lại thanh toán, hóa đơn và vận chuyển đang hoạt động của tất cả đơn hàng. Dữ liệu mồ côi sẽ được báo riêng và không tự động xóa.',\n    confirmLabel: 'Đồng bộ'\n  })\n  if (!confirmed) return\n  await withLoading(async () => {\n    const result = await reconcileOrderRelationLocks()\n    await loadRows(true)\n    const orphanNote = result.orphanCount\n      ? \` Phát hiện \${result.orphanCount} chứng từ mồ côi cần quản trị viên xử lý riêng.\`\n      : ''\n    showToast(\`Đã đồng bộ \${result.updatedOrders} đơn hàng.\${orphanNote}\`, result.orphanCount ? 'info' : 'success')\n  }).catch(error => showToast(reportFirebaseError(error, 'Không đồng bộ được khóa liên kết đơn.'), 'error'))\n}\n`,
  `async function reconcileRelationLocksInBackground() {\n  const actor = String(appUser.value?.email || '').trim().toLowerCase()\n  if (!isAdmin.value || !actor || relationReconciledForUser === actor) return\n  relationReconciledForUser = actor\n  try {\n    const result = await reconcileOrderRelationLocks()\n    if (result.updatedOrders > 0) await loadRows(true)\n    if (result.orphanCount > 0) {\n      showToast(\`Hệ thống phát hiện \${result.orphanCount} chứng từ mồ côi cần quản trị viên kiểm tra.\`, 'info')\n    }\n  } catch (error) {\n    relationReconciledForUser = ''\n    showToast(reportFirebaseError(error, 'Hệ thống chưa đồng bộ được khóa liên kết đơn.'), 'error')\n  }\n}\n`,
  1,
  'orders background reconcile function',
)
ordersPage = replaceExact(
  ordersPage,
  `      <button v-if="isAdmin" class="btn" @click="reconcileRelationLocks">Đồng bộ khóa liên kết đơn</button>\n`,
  ``,
  1,
  'remove orders manual sync button',
)
write('pages/orders.vue', ordersPage)

// Printing page: remove the manual button and reconcile once after dependencies load.
let printingPage = read('pages/printing.vue')
printingPage = replaceExact(
  printingPage,
  `const reconciling = ref(false)\n`,
  ``,
  1,
  'remove printing reconciling state',
)
printingPage = replaceExact(
  printingPage,
  `let statusTimer: ReturnType<typeof setInterval> | null = null\n`,
  `let statusTimer: ReturnType<typeof setInterval> | null = null\nlet printingReconciledForUser = ''\n`,
  1,
  'printing background guard state',
)
printingPage = replaceExact(
  printingPage,
  `async function syncOrderPrintingLocks() {\n  if (!isAdmin.value) return showToast('Chỉ quản trị viên được đồng bộ khóa xóa đơn.', 'error')\n  const confirmed = await askConfirm({\n    title: 'Đồng bộ khóa xóa đơn',\n    message: 'Hệ thống sẽ đếm lại toàn bộ tiến độ in còn hiệu lực và cập nhật khóa xóa trên từng đơn hàng. Tiếp tục?',\n    confirmLabel: 'Đồng bộ khóa',\n  })\n  if (!confirmed) return\n\n  reconciling.value = true\n  try {\n    const result = await reconcilePrintingLocks(sourceOrders.value, rows.value)\n    showToast('Đã kiểm tra ' + result.checked + ' đơn và cập nhật ' + result.changed + ' khóa in.', 'success')\n    await loadRows(true)\n  } catch (error) {\n    showToast(reportFirebaseError(error, 'Không đồng bộ được khóa tiến độ in.'), 'error')\n  } finally {\n    reconciling.value = false\n  }\n}\n`,
  `async function reconcilePrintingLocksInBackground() {\n  const actor = currentEmail.value\n  if (!isAdmin.value || !actor || printingReconciledForUser === actor) return\n  printingReconciledForUser = actor\n  try {\n    const result = await reconcilePrintingLocks(sourceOrders.value, rows.value)\n    if (result.changed > 0) sourceOrders.value = await loadPrintingSourceOrders(true)\n  } catch (error) {\n    printingReconciledForUser = ''\n    showToast(reportFirebaseError(error, 'Hệ thống chưa đồng bộ được khóa tiến độ in.'), 'error')\n  }\n}\n`,
  1,
  'printing background reconcile function',
)
printingPage = replaceExact(
  printingPage,
  `    suppliers.value = supplierRows\n  } catch (error) {`,
  `    suppliers.value = supplierRows\n    setTimeout(() => { void reconcilePrintingLocksInBackground() }, 0)\n  } catch (error) {`,
  1,
  'printing background scheduling',
)
printingPage = replaceExact(
  printingPage,
  `      <button v-if="isAdmin" class="btn" :disabled="reconciling" @click="syncOrderPrintingLocks">{{ reconciling ? 'Đang đồng bộ...' : 'Đồng bộ khóa xóa đơn' }}</button>\n`,
  ``,
  1,
  'remove printing manual sync button',
)
write('pages/printing.vue', printingPage)

// Update stale messages that instructed admins to run removed buttons.
let printingProgress = read('composables/usePrintingProgress.ts')
printingProgress = replaceExact(
  printingProgress,
  `Đơn hàng cũ chưa được đồng bộ khóa tiến độ in. Quản trị viên cần chạy “Đồng bộ khóa xóa đơn”.`,
  `Đơn hàng cũ chưa hoàn tất đồng bộ khóa tiến độ in. Vui lòng tải lại sau khi hệ thống xử lý.`,
  1,
  'printing progress legacy message',
)
printingProgress = replaceExact(
  printingProgress,
  `Khóa tiến độ in đang sai lệch. Hãy chạy đồng bộ trước khi xóa tiến độ.`,
  `Khóa tiến độ in đang sai lệch. Vui lòng tải lại sau khi hệ thống xử lý.`,
  1,
  'printing progress mismatch message',
)
write('composables/usePrintingProgress.ts', printingProgress)

let printingLockUtil = read('utils/orderPrintingDeleteLock.mjs')
printingLockUtil = replaceExact(
  printingLockUtil,
  `Đơn hàng cũ chưa được đồng bộ khóa tiến độ in. Quản trị viên cần mở trang Tiến độ in ấn và chạy “Đồng bộ khóa xóa đơn”.`,
  `Đơn hàng cũ chưa hoàn tất đồng bộ khóa tiến độ in. Vui lòng tải lại sau khi hệ thống xử lý.`,
  1,
  'printing blocker message',
)
write('utils/orderPrintingDeleteLock.mjs', printingLockUtil)

// Rules tests: admin reconcile is allowed even for fulfilled legacy orders; non-admin is denied.
let printingRulesTest = read('tests/order-printing-delete-lock.rules.test.mjs')
printingRulesTest = replaceExact(
  printingRulesTest,
  `const PRINTER = 'printer@example.com'\nlet env`,
  `const PRINTER = 'printer@example.com'\nconst ADMIN = 'admin@example.com'\nlet env`,
  1,
  'printing admin identity',
)
printingRulesTest = replaceExact(
  printingRulesTest,
  `function sourceOrder(id, { legacy = false } = {}) {`,
  `function sourceOrder(id, { legacy = false, fulfillment = 'chua_xuat' } = {}) {`,
  1,
  'source order fulfillment option',
)
printingRulesTest = replaceExact(
  printingRulesTest,
  `    warehouse_fulfillment_status: 'chua_xuat',`,
  `    warehouse_fulfillment_status: fulfillment,`,
  1,
  'source order fulfillment field',
)
printingRulesTest = replaceExact(
  printingRulesTest,
  `function printingPatch(count, action, printOrderId) {`,
  `function printingPatch(count, action, printOrderId, actor = PRINTER) {`,
  1,
  'printing patch actor option',
)
printingRulesTest = replaceExact(
  printingRulesTest,
  `    printing_lock_updated_by: PRINTER,`,
  `    printing_lock_updated_by: actor,`,
  1,
  'printing patch actor field',
)
printingRulesTest = replaceExact(
  printingRulesTest,
  `      setDoc(doc(db, 'customers', 'customer-a'), {`,
  `      setDoc(doc(db, 'users', ADMIN), user(ADMIN, ['*'])),\n      setDoc(doc(db, 'customers', 'customer-a'), {`,
  1,
  'printing admin seed',
)
printingRulesTest = replaceExact(
  printingRulesTest,
  `      setDoc(doc(db, 'orders', 'order-legacy'), sourceOrder('order-legacy', { legacy: true })),`,
  `      setDoc(doc(db, 'orders', 'order-legacy'), sourceOrder('order-legacy', { legacy: true })),\n      setDoc(doc(db, 'orders', 'order-fulfilled'), sourceOrder('order-fulfilled', { legacy: true, fulfillment: 'da_xuat_du' })),`,
  1,
  'fulfilled legacy order seed',
)
printingRulesTest = replaceExact(
  printingRulesTest,
  `test('đơn legacy thiếu lock version bị fail closed', async () => {`,
  `test('admin đối soát khóa in ngầm được cả đơn legacy đã xuất đủ', async () => {\n  const db = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()\n  await assertSucceeds(updateDoc(\n    doc(db, 'orders', 'order-fulfilled'),\n    printingPatch(0, 'reconcile', '', ADMIN),\n  ))\n})\n\ntest('người dùng in không được tự giả mạo thao tác đối soát admin', async () => {\n  const db = env.authenticatedContext(PRINTER, { email: PRINTER }).firestore()\n  await assertFails(updateDoc(\n    doc(db, 'orders', 'order-legacy'),\n    printingPatch(0, 'reconcile', '', PRINTER),\n  ))\n})\n\ntest('đơn legacy thiếu lock version bị fail closed', async () => {`,
  1,
  'printing reconcile rules tests',
)
write('tests/order-printing-delete-lock.rules.test.mjs', printingRulesTest)

// Client tests: background reconciliation exists and manual controls are gone.
let printingClientTest = read('tests/order-printing-delete-lock.client.test.mjs')
printingClientTest = replaceExact(
  printingClientTest,
  `  assert.match(progress, /reconcilePrintingLocks/)\n  assert.match(printingPage, /Đồng bộ khóa xóa đơn/)`,
  `  assert.match(progress, /reconcilePrintingLocks/)\n  assert.match(printingPage, /reconcilePrintingLocksInBackground/)\n  assert.doesNotMatch(printingPage, /syncOrderPrintingLocks/)\n  assert.doesNotMatch(printingPage, />Đồng bộ khóa xóa đơn</)`,
  1,
  'printing background client assertions',
)
printingClientTest = replaceExact(
  printingClientTest,
  `  assert.match(rules, /allow update: if \\(\\s*softDeleteOnly\\(\\)[\\s\\S]*?\\|\\| orderPrintingSummaryUpdateAllowed\\(docId\\)/)`,
  `  assert.match(rules, /allow update: if \\(\\s*softDeleteOnly\\(\\)[\\s\\S]*?orderPrintingReconcileAllowed\\(\\)[\\s\\S]*?\\|\\| orderPrintingSummaryUpdateAllowed\\(docId\\)/)`,
  1,
  'printing rules dispatch client assertion',
)
write('tests/order-printing-delete-lock.client.test.mjs', printingClientTest)

let relationClientTest = read('tests/order-relations.client.test.mjs')
relationClientTest = replaceExact(
  relationClientTest,
  `  relationLockReady,\n  removeRelationRecord,`,
  `  relationLockReady,\n  relationReconcileNeeded,\n  removeRelationRecord,`,
  1,
  'relation reconcile helper test import',
)
relationClientTest = replaceExact(
  relationClientTest,
  `test('thay chứng từ theo ID không làm trùng dữ liệu client', () => {`,
  `test('đối soát chạy ngầm chỉ ghi khi dữ liệu khóa thực sự lệch', () => {\n  const patch = buildReconciledOrderRelationPatch({\n    order: readyOrder,\n    actor: 'admin@example.com',\n    updatedAt: 'now',\n  })\n  assert.equal(relationReconcileNeeded(readyOrder, patch), true)\n  assert.equal(relationReconcileNeeded({ ...readyOrder, ...patch }, patch), false)\n})\n\ntest('thay chứng từ theo ID không làm trùng dữ liệu client', () => {`,
  1,
  'relation reconcile write minimization test',
)
relationClientTest = replaceExact(
  relationClientTest,
  `  assert.match(orders, /Đồng bộ khóa liên kết đơn/)`,
  `  assert.match(orders, /reconcileRelationLocksInBackground/)\n  assert.doesNotMatch(orders, /@click="reconcileRelationLocks"/)\n  assert.doesNotMatch(orders, />Đồng bộ khóa liên kết đơn</)\n  assert.match(composable, /relationReconcileNeeded/)`,
  1,
  'relation background client assertions',
)
write('tests/order-relations.client.test.mjs', relationClientTest)

unlinkSync('scripts/apply-background-order-lock-reconciliation.mjs')
unlinkSync('.github/workflows/apply-background-order-lock-reconciliation.yml')
