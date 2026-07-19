import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

function read(path) { return readFileSync(path, 'utf8') }
function write(path, value) { writeFileSync(path, value) }
function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Không tìm thấy đoạn cần sửa: ${label}`)
  return source.replace(before, after)
}

let rules = read('firestore.rules')

const summaryStart = rules.indexOf('    function orderPrintingCreateSummaryAllowed(orderId) {')
const summaryEnd = rules.indexOf('    function printCreateHasParentLock(printOrderId, data) {', summaryStart)
if (summaryStart < 0 || summaryEnd < 0) throw new Error('Không tìm thấy nhóm helper summary khóa in')
const summaryReplacement = `    function orderPrintingSummaryUpdateAllowed(orderId) {
      let action = request.resource.data.get('printing_last_action', '');
      let printOrderId = request.resource.data.get('printing_last_print_order_id', '');
      let path = printOrderPath(printOrderId);
      let currentCount = resource.data.get('printing_progress_count', -1);
      let nextCount = request.resource.data.get('printing_progress_count', -1);
      return onlyPrintingLockChanged()
        && printingLockReadyData(resource.data)
        && request.resource.data.get('printing_lock_version', 0) == 1
        && printOrderId is string
        && printOrderId != ''
        && ownEmailField(request.resource.data, 'printing_lock_updated_by')
        && (
          (
            action == 'create'
            && hasPerm('printing.create')
            && nextCount == currentCount + 1
            && !exists(path)
            && existsAfter(path)
            && getAfter(path).data.get('order_id', '') == orderId
            && getAfter(path).data.get('deleted', false) != true
            && getAfter(path).data.get('active', true) != false
          )
          || (
            action == 'delete'
            && hasPerm('printing.delete')
            && currentCount > 0
            && nextCount == currentCount - 1
            && exists(path)
            && get(path).data.get('order_id', '') == orderId
            && get(path).data.get('deleted', false) != true
            && existsAfter(path)
            && getAfter(path).data.get('order_id', '') == orderId
            && getAfter(path).data.get('deleted', false) == true
            && getAfter(path).data.get('active', true) == false
          )
        );
    }

`
rules = rules.slice(0, summaryStart) + summaryReplacement + rules.slice(summaryEnd)

rules = replaceOnce(
  rules,
  `    function printCreateHasParentLock(printOrderId, data) {
      let orderId = data.get('order_id', '');
      let path = orderPath(orderId);
      return orderId is string
        && orderId != ''
        && exists(path)
        && existsAfter(path)
        && printingLockReadyData(get(path).data)
        && printingLockReadyData(getAfter(path).data)
        && getAfter(path).data.get('printing_progress_count', -1) == get(path).data.get('printing_progress_count', -1) + 1
        && getAfter(path).data.get('printing_last_action', '') == 'create'
        && getAfter(path).data.get('printing_last_print_order_id', '') == printOrderId
        && emailFieldEquals(getAfter(path).data, 'printing_lock_updated_by', email());
    }`,
  `    function printCreateHasParentLock(printOrderId, data) {
      let orderId = data.get('order_id', '');
      let path = orderPath(orderId);
      let before = get(path).data;
      let after = getAfter(path).data;
      return orderId is string
        && orderId != ''
        && exists(path)
        && existsAfter(path)
        && orderDataIsActive(before)
        && data.get('order_code', '') == before.get('order_code', '')
        && printingLockReadyData(before)
        && printingLockReadyData(after)
        && after.get('printing_progress_count', -1) == before.get('printing_progress_count', -1) + 1
        && after.get('printing_last_action', '') == 'create'
        && after.get('printing_last_print_order_id', '') == printOrderId
        && emailFieldEquals(after, 'printing_lock_updated_by', email());
    }`,
  'tối ưu helper tạo tiến độ',
)

rules = replaceOnce(
  rules,
  `      allow update: if orderWarehouseSummaryUpdateAllowed()
        || orderPrintingSummaryUpdateAllowed(docId)
        || isAdmin()`,
  `      allow update: if orderPrintingSummaryUpdateAllowed(docId)
        || orderWarehouseSummaryUpdateAllowed()
        || isAdmin()`,
  'ưu tiên summary khóa in trên order',
)

rules = replaceOnce(
  rules,
  `      allow create: if hasPerm('printing.create')
        && request.resource.data.get('order_code', '') is string
        && request.resource.data.get('order_code', '') != ''
        && printOrderSourceMatches(request.resource.data)
        && printCreateHasParentLock(docId, request.resource.data)
        && ownEmailField(request.resource.data, 'created_by');`,
  `      allow create: if hasPerm('printing.create')
        && request.resource.data.get('order_code', '') is string
        && request.resource.data.get('order_code', '') != ''
        && printCreateHasParentLock(docId, request.resource.data)
        && ownEmailField(request.resource.data, 'created_by');`,
  'bỏ đọc parent trùng khi tạo print order',
)

const oldPrintUpdate = `      // Check the soft-delete shape first so users with both edit and delete
      // permissions do not exhaust the Rules expression budget on the edit path.
      allow update: if isAdmin()
        || (
          warehouseSoftDeleteOnly()
          && hasPerm('printing.delete')
          && unchanged(['order_id', 'order_code'])
          && printDeleteHasParentLock(docId, resource.data.get('order_id', ''))
          && (
            hasPerm('printing.view_all')
            || ownsPrintOrderData(resource.data)
          )
          && warehouseDocIdentitySafe()
        )
        || (
          unchanged(['deleted', 'active', 'status', 'deleted_at', 'deleted_by'])
          && unchanged(['order_id', 'order_code'])
          && hasPerm('printing.edit')
          && (
            hasPerm('printing.view_all')
            || ownsPrintOrderData(resource.data)
          )
          && warehouseDocIdentitySafe()
          && request.resource.data.get('order_code', '') is string
          && request.resource.data.get('order_code', '') != ''
          && printOrderSourceMatches(request.resource.data)
        );`
const newPrintUpdate = `      // Normal edits are evaluated before the more expensive atomic delete path.
      allow update: if isAdmin()
        || (
          unchanged(['deleted', 'active', 'status', 'deleted_at', 'deleted_by'])
          && unchanged(['order_id', 'order_code'])
          && hasPerm('printing.edit')
          && (
            hasPerm('printing.view_all')
            || ownsPrintOrderData(resource.data)
          )
          && warehouseDocIdentitySafe()
          && request.resource.data.get('order_code', '') is string
          && request.resource.data.get('order_code', '') != ''
          && printOrderSourceMatches(request.resource.data)
        )
        || (
          warehouseSoftDeleteOnly()
          && hasPerm('printing.delete')
          && unchanged(['order_id', 'order_code'])
          && (
            hasPerm('printing.view_all')
            || ownsPrintOrderData(resource.data)
          )
          && warehouseDocIdentitySafe()
          && printDeleteHasParentLock(docId, resource.data.get('order_id', ''))
        );`
rules = replaceOnce(rules, oldPrintUpdate, newPrintUpdate, 'đổi thứ tự update print_orders')

const oldItemUpdate = `      // As with print_orders, evaluate the delete shape before the edit path.
      allow update: if isAdmin()
        || (
          warehouseSoftDeleteOnly()
          && hasPerm('printing.delete')
          && resource.data.print_order_id is string
          && printingCanDeleteProgressAfterById(resource.data.print_order_id)
          && unchanged(['id', 'print_order_id', 'created_at', 'created_by', 'source'])
        )
        || (
          unchanged(['deleted', 'active', 'status', 'deleted_at', 'deleted_by'])
          && hasPerm('printing.edit')
          && resource.data.print_order_id is string
          && printingCanOperateProgressAfterById(resource.data.print_order_id)
          && unchanged(['id', 'print_order_id', 'created_at', 'created_by', 'source'])
          && printQuantitiesAreValid(request.resource.data)
        );`
const newItemUpdate = `      // Normal item edits are evaluated before the atomic soft-delete path.
      allow update: if isAdmin()
        || (
          unchanged(['deleted', 'active', 'status', 'deleted_at', 'deleted_by'])
          && hasPerm('printing.edit')
          && resource.data.print_order_id is string
          && printingCanOperateProgressAfterById(resource.data.print_order_id)
          && unchanged(['id', 'print_order_id', 'created_at', 'created_by', 'source'])
          && printQuantitiesAreValid(request.resource.data)
        )
        || (
          warehouseSoftDeleteOnly()
          && hasPerm('printing.delete')
          && resource.data.print_order_id is string
          && unchanged(['id', 'print_order_id', 'created_at', 'created_by', 'source'])
          && printingCanDeleteProgressAfterById(resource.data.print_order_id)
        );`
rules = replaceOnce(rules, oldItemUpdate, newItemUpdate, 'đổi thứ tự update print_order_items')
write('firestore.rules', rules)

let printingTest = read('tests/printing-owner.rules.test.mjs')
printingTest = replaceOnce(
  printingTest,
  `function sourceOrder(id, code, owner) {
  return {
    id,
    order_code: code,
    owner_email: owner,
    created_by: owner,
    sale_email: owner,
    active: true,
    deleted: false,
  }
}`,
  `function sourceOrder(id, code, owner, printingCount = 0) {
  return {
    id,
    order_code: code,
    owner_email: owner,
    created_by: owner,
    sale_email: owner,
    printing_progress_count: printingCount,
    printing_lock_version: 1,
    printing_last_action: 'reconcile',
    printing_last_print_order_id: '',
    printing_lock_updated_by: owner,
    printing_lock_updated_at: 'now',
    active: true,
    deleted: false,
  }
}`,
  'thêm lock fields vào test source order',
)
printingTest = replaceOnce(
  printingTest,
  `      setDoc(doc(db, 'orders', 'source-order-a'), sourceOrder('source-order-a', 'DH-A', SALE_OWNER)),
      setDoc(doc(db, 'orders', 'source-order-b'), sourceOrder('source-order-b', 'DH-B', OTHER_SALE)),`,
  `      setDoc(doc(db, 'orders', 'source-order-a'), sourceOrder('source-order-a', 'DH-A', SALE_OWNER, 1)),
      setDoc(doc(db, 'orders', 'source-order-b'), sourceOrder('source-order-b', 'DH-B', OTHER_SALE, 2)),`,
  'đếm seed tiến độ in',
)
printingTest = replaceOnce(
  printingTest,
  `  await assertSucceeds(updateDoc(doc(db, 'print_orders', 'print-order-a'), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: 'later',
    deleted_by: OPERATOR_A,
    updated_by: OPERATOR_A,
    updated_at: 'later',
  }))`,
  `  const deleteBatch = writeBatch(db)
  deleteBatch.update(doc(db, 'orders', 'source-order-a'), {
    printing_progress_count: 0,
    printing_lock_version: 1,
    printing_last_action: 'delete',
    printing_last_print_order_id: 'print-order-a',
    printing_lock_updated_by: OPERATOR_A,
    printing_lock_updated_at: 'later',
  })
  deleteBatch.update(doc(db, 'print_orders', 'print-order-a'), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: 'later',
    deleted_by: OPERATOR_A,
    updated_by: OPERATOR_A,
    updated_at: 'later',
  })
  deleteBatch.update(doc(db, 'print_order_items', 'item-order-a'), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: 'later',
    deleted_by: OPERATOR_A,
    updated_by: OPERATOR_A,
    updated_at: 'later',
  })
  await assertSucceeds(deleteBatch.commit())`,
  'xóa tiến độ test theo transaction khóa parent',
)
printingTest = replaceOnce(
  printingTest,
  `  const batch = writeBatch(db)
  batch.set(
    doc(db, 'print_orders', 'print-new'),`,
  `  const batch = writeBatch(db)
  batch.update(doc(db, 'orders', 'source-order-a'), {
    printing_progress_count: 2,
    printing_lock_version: 1,
    printing_last_action: 'create',
    printing_last_print_order_id: 'print-new',
    printing_lock_updated_by: OPERATOR_A,
    printing_lock_updated_at: 'later',
  })
  batch.set(
    doc(db, 'print_orders', 'print-new'),`,
  'tạo tiến độ test tăng khóa parent',
)
write('tests/printing-owner.rules.test.mjs', printingTest)

for (const path of [
  'scripts/fix-step6-rules-budget.mjs',
  '.github/workflows/fix-step6-rules-budget.yml',
  '.github/workflows/diagnose-step6.yml',
]) {
  try { unlinkSync(path) } catch {}
}
console.log('Đã tối ưu Rules và nâng test in ấn cũ sang transaction khóa parent.')
