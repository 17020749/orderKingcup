from pathlib import Path
import re

transaction_path = Path('composables/useWarehouseTransactions.ts')
text = transaction_path.read_text(encoding='utf-8')

old_helper_start = text.find("function warehouseOperationPayload(input: {")
old_helper_end = text.find("\nfunction readOperationResult", old_helper_start)
if old_helper_start < 0 or old_helper_end < 0:
    raise SystemExit('Không tìm thấy warehouseOperationPayload hiện tại.')

new_helpers = """function warehouseOperationPayload(input: {
  operationId: string
  action: string
  targetCollection: string
  targetId: string
  resultCode?: string
  targetRevision?: number
  createdBy: string
}) {
  return {
    id: input.operationId,
    operation_id: input.operationId,
    action: input.action,
    target_collection: input.targetCollection,
    target_id: input.targetId,
    result_code: input.resultCode || '',
    target_revision: input.targetRevision || 0,
    created_by: input.createdBy,
    status: 'pending',
    created_at: serverTimestamp(),
    active: true,
    deleted: false,
    source: 'nuxt_v7_5'
  }
}

function warehouseOperationCompletionPayload(input: {
  operationId: string
  action: string
  targetCollection: string
  targetId: string
  resultCode?: string
  targetRevision?: number
  createdBy: string
}) {
  return {
    status: 'completed',
    result_code: input.resultCode || '',
    target_revision: input.targetRevision || 0,
    completed_at: serverTimestamp()
  }
}

function assertOperationOwner(data: any, action: string, createdBy: string) {
  if (String(data?.action || '') !== action) {
    throw new Error('operation_id đã được dùng cho một nghiệp vụ khác. Hãy tải lại trang và thử lại.')
  }
  if (normalizeEmail(data?.created_by || '') !== normalizeEmail(createdBy)) {
    throw new Error('operation_id thuộc về tài khoản khác, không thể tiếp tục thao tác.')
  }
  const status = String(data?.status || '')
  if (!['pending', 'completed'].includes(status)) {
    throw new Error(`operation_id đang ở trạng thái không hợp lệ: ${status || 'trống'}.`)
  }
}

async function ensureWarehouseOperation(db: any, input: {
  operationId: string
  action: string
  targetCollection: string
  targetId: string
  resultCode?: string
  targetRevision?: number
  createdBy: string
}) {
  const operationRef = doc(db, 'warehouse_operations', input.operationId)
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(operationRef)
    if (snapshot.exists()) {
      assertOperationOwner(snapshot.data(), input.action, input.createdBy)
      return
    }
    transaction.set(operationRef, warehouseOperationPayload(input))
  })
}
"""
text = text[:old_helper_start] + new_helpers + text[old_helper_end:]

specs = [
    ('  async function createImportOrder(', '\n  function itemProduct(', 'import_create', 'import_orders', 'orderId', 'code', 'createdBy'),
    ('  async function updateImportOrder(', '\n  async function deleteImportOrder(', 'import_update', 'import_orders', 'orderId', 'code', 'updatedBy'),
    ('  async function deleteImportOrder(', '\n  async function createExportOrder(', 'import_delete', 'import_orders', 'orderId', 'code', 'deletedBy'),
    ('  async function createExportOrder(', '\n  async function updateExportOrder(', 'export_create', 'export_orders', 'orderId', 'code', 'createdBy'),
    ('  async function updateExportOrder(', '\n  async function deleteExportOrder(', 'export_update', 'export_orders', 'orderId', 'code', 'updatedBy'),
    ('  async function deleteExportOrder(', '\n  async function createInventoryAdjustment(', 'export_cancel', 'export_orders', 'orderId', 'code', 'deletedBy'),
    ('  async function createInventoryAdjustment(', '\n  async function processExportRequestToExportOrder(', 'inventory_adjust', 'inventory_adjustments', 'adjustmentId', "''", 'createdBy'),
    ('  async function processExportRequestToExportOrder(', '\n  async function getInventoryBalanceId(', 'export_request_release', 'export_orders', 'orderId', 'code', 'createdBy'),
]

for start_token, end_token, action, collection_name, target_id, result_code, actor in specs:
    start = text.find(start_token)
    end = text.find(end_token, start + len(start_token))
    if start < 0 or end < 0:
        raise SystemExit(f'Không xác định được segment {start_token}.')
    segment = text[start:end]

    transaction_anchor = "    await runTransaction(db, async tx => {\n"
    if segment.count(transaction_anchor) != 1:
        raise SystemExit(f'{action}: cần đúng 1 transaction chính, tìm thấy {segment.count(transaction_anchor)}')
    ensure_block = f"""    await ensureWarehouseOperation(db, {{
      operationId,
      action: '{action}',
      targetCollection: '{collection_name}',
      targetId: {target_id},
      resultCode: {result_code},
      createdBy: {actor}
    }})

"""
    segment = segment.replace(transaction_anchor, ensure_block + transaction_anchor, 1)

    check_start_token = "      if (operationSnap.exists()) {\n"
    check_start = segment.find(check_start_token)
    if check_start < 0:
        raise SystemExit(f'{action}: không tìm thấy block replay hiện tại.')
    check_end = segment.find("      }\n\n", check_start + len(check_start_token))
    if check_end < 0:
        raise SystemExit(f'{action}: không tìm thấy cuối block replay.')
    inner = segment[check_start + len(check_start_token):check_end]
    replacement = f"""      if (!operationSnap.exists()) throw new Error('Không tìm thấy operation pending cho nghiệp vụ kho.')
      const operationData = operationSnap.data() || {{}}
      assertOperationOwner(operationData, '{action}', {actor})
      if (String(operationData.status || '') === 'completed') {{
{inner}
      }}
"""
    segment = segment[:check_start] + replacement + segment[check_end + len("      }\n\n"):]

    old_commit = "      tx.set(operationRef, warehouseOperationPayload({\n"
    new_commit = "      tx.update(operationRef, warehouseOperationCompletionPayload({\n"
    if segment.count(old_commit) != 1:
        raise SystemExit(f'{action}: cần đúng 1 operation completion, tìm thấy {segment.count(old_commit)}')
    segment = segment.replace(old_commit, new_commit, 1)

    text = text[:start] + segment + text[end:]

transaction_path.write_text(text, encoding='utf-8')

rules_path = Path('firestore.rules')
rules = rules_path.read_text(encoding='utf-8')

old_operation_rules = """    match /warehouse_operations/{docId} {
      allow read: if canReadInventoryCore();
      allow create: if canWriteInventoryCore()
        && request.resource.data.get('operation_id', '') == docId
        && request.resource.data.get('status', '') == 'completed'
        && ownEmailField(request.resource.data, 'created_by');
      // Operation records are immutable idempotency keys. A completed key must
      // never be rewritten or removed by a client.
      allow update, delete: if false;
    }
"""
new_operation_rules = """    match /warehouse_operations/{docId} {
      allow read: if canReadInventoryCore();
      allow create: if canWriteInventoryCore()
        && request.resource.data.get('operation_id', '') == docId
        && request.resource.data.get('status', '') == 'pending'
        && ownEmailField(request.resource.data, 'created_by');
      allow update: if resource.data.get('status', '') == 'pending'
        && request.resource.data.get('status', '') == 'completed'
        && sameEmailField(resource.data, request.resource.data, 'created_by')
        && ownEmailField(resource.data, 'created_by')
        && unchanged([
          'id',
          'operation_id',
          'action',
          'target_collection',
          'target_id',
          'created_by',
          'created_at',
          'active',
          'deleted',
          'source'
        ])
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
          'status',
          'result_code',
          'target_revision',
          'completed_at'
        ]);
      allow delete: if false;
    }
"""
if rules.count(old_operation_rules) != 1:
    raise SystemExit(f'warehouse_operations rules: cần đúng 1, tìm thấy {rules.count(old_operation_rules)}')
rules = rules.replace(old_operation_rules, new_operation_rules, 1)

old_exists_helper = """    function warehouseOperationExistsAfter(operationId) {
      let path = /databases/$(database)/documents/warehouse_operations/$(operationId);
      return operationId is string
        && operationId != ''
        && existsAfter(path);
    }
"""
new_after_helper = """    function warehouseOperationAfterValid(operationId) {
      let path = /databases/$(database)/documents/warehouse_operations/$(operationId);
      let operation = getAfter(path).data;
      return operationId is string
        && operationId != ''
        && operation.get('status', '') == 'completed'
        && ownEmailField(operation, 'created_by');
    }
"""
if rules.count(old_exists_helper) != 1:
    raise SystemExit(f'warehouse operation exists helper: cần đúng 1, tìm thấy {rules.count(old_exists_helper)}')
rules = rules.replace(old_exists_helper, new_after_helper, 1)
rules = rules.replace('warehouseOperationExistsAfter(request.resource.data.get(\'operation_id\', \'\'))', 'warehouseOperationAfterValid(request.resource.data.get(\'operation_id\', \'\'))')
rules = rules.replace('warehouseOperationExistsAfter(request.resource.data.get(\'last_operation_id\', \'\'))\n            && ownEmailField(request.resource.data, \'updated_by\')', 'warehouseOperationAfterValid(request.resource.data.get(\'last_operation_id\', \'\'))\n            && ownEmailField(request.resource.data, \'updated_by\')')
rules_path.write_text(rules, encoding='utf-8')

rules_test_path = Path('tests/firestore.rules.test.mjs')
rules_test = rules_test_path.read_text(encoding='utf-8')
old_immutable_test = """  await assertSucceeds(setDoc(ref, {
    id: 'op-v75-stock',
    operation_id: 'op-v75-stock',
    action: 'import_create',
    target_collection: 'import_orders',
    target_id: 'import-v75',
    result_code: 'PNK-V75',
    target_revision: 1,
    created_by: STOCK,
    status: 'completed',
    active: true,
    deleted: false
  }))
  await assertFails(updateDoc(ref, { result_code: 'KHONG-DUOC-SUA' }))
  await assertFails(deleteDoc(ref))
"""
new_immutable_test = """  await assertSucceeds(setDoc(ref, {
    id: 'op-v75-stock',
    operation_id: 'op-v75-stock',
    action: 'import_create',
    target_collection: 'import_orders',
    target_id: 'import-v75',
    result_code: '',
    target_revision: 0,
    created_by: STOCK,
    status: 'pending',
    active: true,
    deleted: false
  }))
  await assertSucceeds(updateDoc(ref, {
    status: 'completed',
    result_code: 'PNK-V75',
    target_revision: 1,
    completed_at: 'now'
  }))
  await assertFails(updateDoc(ref, { result_code: 'KHONG-DUOC-SUA' }))
  await assertFails(deleteDoc(ref))
"""
if rules_test.count(old_immutable_test) != 1:
    raise SystemExit('Không tìm thấy test operation immutable cần chuyển sang pending/completed.')
rules_test = rules_test.replace(old_immutable_test, new_immutable_test, 1)
rules_test = rules_test.replace("    status: 'completed',\n    active: true,\n    deleted: false\n  }))\n})\n\ntest('V7.5 quyền release", "    status: 'pending',\n    active: true,\n    deleted: false\n  }))\n})\n\ntest('V7.5 quyền release", 1)
rules_test_path.write_text(rules_test, encoding='utf-8')

concurrency_path = Path('tests/warehouse.transactions.test.mjs')
concurrency = concurrency_path.read_text(encoding='utf-8')

old_apply_setup = """  async function applyOnce() {
    return runTransaction(db, async transaction => {
      const operationSnap = await transaction.get(operationRef)
      if (operationSnap.exists()) return 'replayed'

      const balanceSnap = await transaction.get(balanceRef)
"""
new_apply_setup = """  await setDoc(operationRef, {
    id: operationId,
    operation_id: operationId,
    action: 'import_create',
    target_collection: 'import_orders',
    target_id: 'import-v75-concurrent',
    result_code: '',
    target_revision: 0,
    created_by: STOCK,
    status: 'pending',
    active: true,
    deleted: false
  })

  async function applyOnce() {
    return runTransaction(db, async transaction => {
      const operationSnap = await transaction.get(operationRef)
      if (operationSnap.data()?.status === 'completed') return 'replayed'

      const balanceSnap = await transaction.get(balanceRef)
"""
if concurrency.count(old_apply_setup) != 1:
    raise SystemExit('Không tìm thấy concurrency applyOnce setup.')
concurrency = concurrency.replace(old_apply_setup, new_apply_setup, 1)

old_operation_set = """      transaction.set(operationRef, {
        id: operationId,
        operation_id: operationId,
        action: 'import_create',
        target_collection: 'import_orders',
        target_id: 'import-v75-concurrent',
        result_code: 'PNK-V75-CONCURRENT',
        target_revision: 1,
        created_by: STOCK,
        status: 'completed',
        active: true,
        deleted: false
      })
"""
new_operation_update = """      transaction.update(operationRef, {
        status: 'completed',
        result_code: 'PNK-V75-CONCURRENT',
        target_revision: 1,
        completed_at: 'now'
      })
"""
if concurrency.count(old_operation_set) != 1:
    raise SystemExit('Không tìm thấy operation set trong concurrency test.')
concurrency = concurrency.replace(old_operation_set, new_operation_update, 1)

old_revision_function = """  async function updateAtRevision(operationId) {
    return runTransaction(db, async transaction => {
      const operationRef = doc(db, 'warehouse_operations', operationId)
      const operationSnap = await transaction.get(operationRef)
      if (operationSnap.exists()) return 'replayed'

      const orderSnap = await transaction.get(orderRef)
"""
new_revision_function = """  async function updateAtRevision(operationId) {
    const operationRef = doc(db, 'warehouse_operations', operationId)
    await setDoc(operationRef, {
      id: operationId,
      operation_id: operationId,
      action: 'export_update',
      target_collection: 'export_orders',
      target_id: 'export-v75-revision',
      result_code: '',
      target_revision: 0,
      created_by: STOCK,
      status: 'pending',
      active: true,
      deleted: false
    })

    return runTransaction(db, async transaction => {
      const operationSnap = await transaction.get(operationRef)
      if (operationSnap.data()?.status === 'completed') return 'replayed'

      const orderSnap = await transaction.get(orderRef)
"""
if concurrency.count(old_revision_function) != 1:
    raise SystemExit('Không tìm thấy updateAtRevision setup.')
concurrency = concurrency.replace(old_revision_function, new_revision_function, 1)

old_revision_set = """      transaction.set(operationRef, {
        id: operationId,
        operation_id: operationId,
        action: 'export_update',
        target_collection: 'export_orders',
        target_id: 'export-v75-revision',
        result_code: 'PX-V75-REVISION',
        target_revision: 1,
        created_by: STOCK,
        status: 'completed',
        active: true,
        deleted: false
      })
"""
new_revision_update = """      transaction.update(operationRef, {
        status: 'completed',
        result_code: 'PX-V75-REVISION',
        target_revision: 1,
        completed_at: 'now'
      })
"""
if concurrency.count(old_revision_set) != 1:
    raise SystemExit('Không tìm thấy operation set trong revision test.')
concurrency = concurrency.replace(old_revision_set, new_revision_update, 1)
concurrency_path.write_text(concurrency, encoding='utf-8')

Path('v7.5-rules-error.log').unlink(missing_ok=True)
print('Đã chuyển V7.5 sang operation pending/completed hai pha.')
