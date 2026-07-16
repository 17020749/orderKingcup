from pathlib import Path
import re

transaction_path = Path('composables/useWarehouseTransactions.ts')
text = transaction_path.read_text(encoding='utf-8')

text = text.replace("    status: 'pending',\n    created_at: serverTimestamp(),", "    status: 'processing',\n    processing_at: serverTimestamp(),\n    created_at: serverTimestamp(),", 1)

ensure_start = text.find('async function ensureWarehouseOperation(')
ensure_end = text.find('\nfunction readOperationResult', ensure_start)
if ensure_start < 0 or ensure_end < 0:
    raise SystemExit('Không tìm thấy ensureWarehouseOperation hiện tại.')

operation_helpers = """async function claimWarehouseOperation(db: any, input: {
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
    if (!snapshot.exists()) {
      transaction.set(operationRef, warehouseOperationPayload(input))
      return
    }

    const data = snapshot.data() || {}
    assertOperationOwner(data, input.action, input.createdBy)
    const status = String(data.status || '')
    if (status === 'completed') return

    if (status === 'processing') {
      const targetCollection = String(data.target_collection || '')
      const targetId = String(data.target_id || '')
      if (targetCollection && targetId) {
        const targetSnapshot = await transaction.get(doc(db, targetCollection, targetId))
        const target = targetSnapshot.exists() ? (targetSnapshot.data() || {}) : {}
        if (String(target.operation_id || target.last_operation_id || '') === input.operationId) {
          transaction.update(operationRef, warehouseOperationCompletionPayload({
            ...input,
            targetCollection,
            targetId,
            resultCode: data.result_code || input.resultCode,
            targetRevision: revisionOf(target) || data.target_revision || input.targetRevision
          }))
          return
        }
      }
      throw new Error('Nghiệp vụ kho này đang được xử lý ở một phiên hoặc tab khác. Hãy chờ và tải lại dữ liệu.')
    }

    if (!['failed', 'pending'].includes(status)) {
      throw new Error(`operation_id đang ở trạng thái không thể chạy lại: ${status || 'trống'}.`)
    }
    transaction.update(operationRef, {
      status: 'processing',
      processing_at: serverTimestamp(),
      failed_at: null,
      failure_message: ''
    })
  })
}

async function completeWarehouseOperation(db: any, input: {
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
    if (!snapshot.exists()) throw new Error('Không tìm thấy operation cần hoàn tất.')
    const data = snapshot.data() || {}
    assertOperationOwner(data, input.action, input.createdBy)
    if (String(data.status || '') === 'completed') return
    if (String(data.status || '') !== 'processing') {
      throw new Error(`Operation không ở trạng thái processing: ${String(data.status || '')}.`)
    }
    transaction.update(operationRef, warehouseOperationCompletionPayload(input))
  })
}

async function failWarehouseOperation(db: any, operationId: string, action: string, createdBy: string, error: any) {
  const operationRef = doc(db, 'warehouse_operations', operationId)
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(operationRef)
    if (!snapshot.exists()) return
    const data = snapshot.data() || {}
    assertOperationOwner(data, action, createdBy)
    if (String(data.status || '') !== 'processing') return
    transaction.update(operationRef, {
      status: 'failed',
      failed_at: serverTimestamp(),
      failure_message: String(error?.message || error || 'Nghiệp vụ kho thất bại').slice(0, 500)
    })
  })
}
"""
text = text[:ensure_start] + operation_helpers + text[ensure_end:]

specs = [
    ('  async function createImportOrder(', '\n  function itemProduct(', 'import_create', 'import_orders', 'orderId', 'code', '1', 'createdBy'),
    ('  async function updateImportOrder(', '\n  async function deleteImportOrder(', 'import_update', 'import_orders', 'orderId', 'code', 'resultRevision', 'updatedBy'),
    ('  async function deleteImportOrder(', '\n  async function createExportOrder(', 'import_delete', 'import_orders', 'orderId', 'code', 'resultRevision', 'deletedBy'),
    ('  async function createExportOrder(', '\n  async function updateExportOrder(', 'export_create', 'export_orders', 'orderId', 'code', '1', 'createdBy'),
    ('  async function updateExportOrder(', '\n  async function deleteExportOrder(', 'export_update', 'export_orders', 'orderId', 'code', 'resultRevision', 'updatedBy'),
    ('  async function deleteExportOrder(', '\n  async function createInventoryAdjustment(', 'export_cancel', 'export_orders', 'orderId', 'code', 'resultRevision', 'deletedBy'),
    ('  async function createInventoryAdjustment(', '\n  async function processExportRequestToExportOrder(', 'inventory_adjust', 'inventory_adjustments', 'adjustmentId', "''", '1', 'createdBy'),
    ('  async function processExportRequestToExportOrder(', '\n  async function getInventoryBalanceId(', 'export_request_release', 'export_orders', 'orderId', 'code', '1', 'createdBy'),
]

for start_token, end_token, action, target_collection, target_id, result_code, target_revision, actor in specs:
    start = text.find(start_token)
    end = text.find(end_token, start + len(start_token))
    if start < 0 or end < 0:
        raise SystemExit(f'Không xác định được segment {action}.')
    segment = text[start:end]

    if segment.count('await ensureWarehouseOperation(db, {') != 1:
        raise SystemExit(f'{action}: cần đúng 1 ensureWarehouseOperation.')
    segment = segment.replace('await ensureWarehouseOperation(db, {', 'await claimWarehouseOperation(db, {', 1)

    run_anchor = '    await runTransaction(db, async tx => {\n'
    if segment.count(run_anchor) != 1:
        raise SystemExit(f'{action}: cần đúng 1 transaction nghiệp vụ.')
    segment = segment.replace(run_anchor, '    try {\n      await runTransaction(db, async tx => {\n', 1)

    completion_pattern = re.compile(
        r"\n      tx\.update\(operationRef, warehouseOperationCompletionPayload\(\{[\s\S]*?\n      \}\)\)"
    )
    completion_matches = list(completion_pattern.finditer(segment))
    if len(completion_matches) != 1:
        raise SystemExit(f'{action}: cần đúng 1 completion trong transaction, tìm thấy {len(completion_matches)}')
    segment = completion_pattern.sub('', segment, count=1)

    close_pos = segment.rfind('\n    })')
    if close_pos < 0:
        raise SystemExit(f'{action}: không tìm thấy cuối transaction.')
    completion_input = f"""{{
      operationId,
      action: '{action}',
      targetCollection: '{target_collection}',
      targetId: {target_id},
      resultCode: {result_code},
      targetRevision: {target_revision},
      createdBy: {actor}
    }}"""
    tail = f"""
      }})
    }} catch (error) {{
      await failWarehouseOperation(db, operationId, '{action}', {actor}, error).catch(() => undefined)
      throw error
    }}
    await completeWarehouseOperation(db, {completion_input})"""
    segment = segment[:close_pos] + '\n' + tail + segment[close_pos + len('\n    })'):]

    text = text[:start] + segment + text[end:]

transaction_path.write_text(text, encoding='utf-8')

rules_path = Path('firestore.rules')
rules = rules_path.read_text(encoding='utf-8')

rules = rules.replace("&& request.resource.data.get('status', '') == 'pending'", "&& request.resource.data.get('status', '') == 'processing'", 1)

operation_update_pattern = re.compile(
    r"      allow update: if resource\.data\.get\('status', ''\) == 'pending'\n"
    r"        && request\.resource\.data\.get\('status', ''\) == 'completed'\n"
    r"        && resource\.data\.get\('operation_id', ''\) == docId\n"
    r"        && request\.resource\.data\.get\('operation_id', ''\) == docId\n"
    r"        && resource\.data\.get\('created_by', ''\)\.lower\(\) == email\(\)\n"
    r"        && request\.resource\.data\.get\('created_by', ''\) == resource\.data\.get\('created_by', ''\)\n"
    r"        && request\.resource\.data\.get\('action', ''\) == resource\.data\.get\('action', ''\);"
)
if len(list(operation_update_pattern.finditer(rules))) != 1:
    raise SystemExit('Không tìm thấy operation update rule pending->completed hiện tại.')
operation_update_rule = """      allow update: if resource.data.get('operation_id', '') == docId
        && request.resource.data.get('operation_id', '') == docId
        && resource.data.get('created_by', '').lower() == email()
        && request.resource.data.get('created_by', '') == resource.data.get('created_by', '')
        && request.resource.data.get('action', '') == resource.data.get('action', '')
        && (
          (
            resource.data.get('status', '') == 'processing'
            && ['completed', 'failed'].hasAny([request.resource.data.get('status', '')])
          )
          || (
            ['failed', 'pending'].hasAny([resource.data.get('status', '')])
            && request.resource.data.get('status', '') == 'processing'
          )
        );"""
rules = operation_update_pattern.sub(operation_update_rule, rules, count=1)

helper_pattern = re.compile(
    r"    function warehousePendingOperationOwned\(operationId\) \{\n"
    r"      let path = /databases/\$\(database\)/documents/warehouse_operations/\$\(operationId\);\n"
    r"      let operation = get\(path\)\.data;\n"
    r"      return operationId is string\n"
    r"        && operationId != ''\n"
    r"        && exists\(path\)\n"
    r"        && operation\.get\('status', ''\) == 'pending'\n"
    r"        && operation\.get\('created_by', ''\)\.lower\(\) == email\(\);\n"
    r"    \}\n"
)
if len(list(helper_pattern.finditer(rules))) != 1:
    raise SystemExit('Không tìm thấy warehousePendingOperationOwned hiện tại.')
processing_helper = """    function warehouseProcessingOperationOwned(operationId) {
      let path = /databases/$(database)/documents/warehouse_operations/$(operationId);
      let operation = get(path).data;
      return operationId is string
        && operationId != ''
        && exists(path)
        && operation.get('status', '') == 'processing'
        && operation.get('created_by', '').lower() == email();
    }
"""
rules = helper_pattern.sub(processing_helper, rules, count=1)
rules = rules.replace('warehousePendingOperationOwned(', 'warehouseProcessingOperationOwned(')
rules_path.write_text(rules, encoding='utf-8')

rules_test_path = Path('tests/firestore.rules.test.mjs')
rules_test = rules_test_path.read_text(encoding='utf-8')
rules_test = rules_test.replace("    status: 'pending',", "    status: 'processing',", 2)
rules_test = rules_test.replace("  await assertSucceeds(updateDoc(ref, {\n    status: 'completed',", "  await assertSucceeds(updateDoc(ref, {\n    status: 'completed',", 1)
rules_test_path.write_text(rules_test, encoding='utf-8')

concurrency_path = Path('tests/warehouse.transactions.test.mjs')
concurrency = concurrency_path.read_text(encoding='utf-8')

start = concurrency.find("test('V7.5 cùng operation id chỉ áp tồn một lần")
end = concurrency.find("\ntest('V7.5 revision", start)
if start < 0 or end < 0:
    raise SystemExit('Không tìm thấy concurrency test đầu tiên.')
new_test = r'''test('V7.5 cùng operation id chỉ áp tồn một lần khi hai transaction chạy đồng thời', async () => {
  const db = env.authenticatedContext(STOCK, { email: STOCK }).firestore()
  const operationId = 'op-v75-concurrent-import'
  const operationRef = doc(db, 'warehouse_operations', operationId)
  const movementRef = doc(db, 'stock_movements', 'move-v75-concurrent-import')
  const balanceRef = doc(db, 'inventory_balances', 'wh-a__product-existing__no_logo')

  async function claim() {
    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(operationRef)
      if (snapshot.exists()) return String(snapshot.data()?.status || '') === 'processing' ? 'busy' : 'replayed'
      transaction.set(operationRef, {
        id: operationId,
        operation_id: operationId,
        action: 'import_create',
        target_collection: 'import_orders',
        target_id: 'import-v75-concurrent',
        result_code: 'PNK-V75-CONCURRENT',
        target_revision: 1,
        created_by: STOCK,
        status: 'processing',
        active: true,
        deleted: false
      })
      return 'claimed'
    })
  }

  const claims = await Promise.all([claim(), claim()])
  assert.equal(claims.filter(result => result === 'claimed').length, 1)
  assert.equal(claims.filter(result => result === 'busy').length, 1)

  await runTransaction(db, async transaction => {
    const movementSnapshot = await transaction.get(movementRef)
    if (movementSnapshot.exists()) return
    const balanceSnapshot = await transaction.get(balanceRef)
    const currentQuantity = Number(balanceSnapshot.data()?.quantity || 0)
    transaction.set(movementRef, {
      id: 'move-v75-concurrent-import',
      movement_type: 'import',
      direction: 'in',
      movement_date: '2026-07-16',
      product_id: 'product-existing',
      product_code: 'SP001',
      product_name: 'Sản phẩm test V7.5',
      warehouse_id: 'wh-a',
      warehouse_name: 'Kho A',
      logo: '',
      unit: 'Cái',
      quantity: 5,
      source_collection: 'import_orders',
      source_doc_id: 'import-v75-concurrent',
      source_item_id: 'import-item-v75-concurrent',
      source_code: 'PNK-V75-CONCURRENT',
      reason: 'Kiểm thử idempotency V7.5',
      created_by: STOCK,
      operation_id: operationId,
      active: true,
      deleted: false,
      source: 'test'
    })
    transaction.set(balanceRef, {
      quantity: currentQuantity + 5,
      last_operation_id: operationId,
      updated_by: STOCK,
      updated_at: 'now'
    }, { merge: true })
  })

  await updateDoc(operationRef, {
    status: 'completed',
    result_code: 'PNK-V75-CONCURRENT',
    target_revision: 1,
    completed_at: 'now'
  })

  const balanceSnapshot = await getDoc(balanceRef)
  const movementSnapshot = await getDoc(movementRef)
  const operationSnapshot = await getDoc(operationRef)
  assert.equal(Number(balanceSnapshot.data()?.quantity || 0), 15)
  assert.equal(movementSnapshot.exists(), true)
  assert.equal(operationSnapshot.data()?.status, 'completed')
})
'''
concurrency = concurrency[:start] + new_test + concurrency[end:]

# Revision concurrency test uses separate operation documents only as locks; keep
# them processing and finish the winner after the order transaction.
concurrency = concurrency.replace("      status: 'pending',", "      status: 'processing',")
concurrency = concurrency.replace("      transaction.update(operationRef, {\n        status: 'completed',\n        result_code: 'PX-V75-REVISION',\n        target_revision: 1,\n        completed_at: 'now'\n      })\n", "")
concurrency_path.write_text(concurrency, encoding='utf-8')

Path('v7.5-rules-error.log').unlink(missing_ok=True)
print('Đã chuyển operation sang claim processing riêng và hoàn tất sau transaction kho.')
