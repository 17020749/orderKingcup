from pathlib import Path
import re

transaction_path = Path('composables/useWarehouseTransactions.ts')
transaction_text = transaction_path.read_text(encoding='utf-8')

old_signature = "function balancePayload(delta: BalanceDelta, nextQuantity: number, operationId = '') {"
new_signature = "function balancePayload(delta: BalanceDelta, nextQuantity: number, operationId = '', updatedBy = '') {"
if transaction_text.count(old_signature) != 1:
    raise SystemExit(f'balancePayload signature: cần đúng 1, tìm thấy {transaction_text.count(old_signature)}')
transaction_text = transaction_text.replace(old_signature, new_signature, 1)

old_fields = """    source: 'nuxt',
    last_operation_id: operationId
"""
new_fields = """    source: 'nuxt',
    last_operation_id: operationId,
    updated_by: updatedBy
"""
if transaction_text.count(old_fields) != 1:
    raise SystemExit(f'balancePayload fields: cần đúng 1, tìm thấy {transaction_text.count(old_fields)}')
transaction_text = transaction_text.replace(old_fields, new_fields, 1)

def patch_actor(source, start_token, end_token, actor):
    start = source.find(start_token)
    if start < 0:
        raise SystemExit(f'Không tìm thấy function start: {start_token}')
    end = source.find(end_token, start + len(start_token))
    if end < 0:
        raise SystemExit(f'Không tìm thấy function end: {end_token}')
    segment = source[start:end]
    replacements = 0
    for old in [
        'balancePayload(delta, next, operationId)',
        'balancePayload(delta, current + delta.delta, operationId)',
    ]:
        count = segment.count(old)
        if count:
            segment = segment.replace(old, old[:-1] + f', {actor})')
            replacements += count
    if replacements < 1:
        raise SystemExit(f'{start_token}: không tìm thấy balancePayload để gắn actor')
    return source[:start] + segment + source[end:]

segments = [
    ('  async function createImportOrder(', '\n  function itemProduct(', 'createdBy'),
    ('  async function updateImportOrder(', '\n  async function deleteImportOrder(', 'updatedBy'),
    ('  async function deleteImportOrder(', '\n  async function createExportOrder(', 'deletedBy'),
    ('  async function createExportOrder(', '\n  async function updateExportOrder(', 'createdBy'),
    ('  async function updateExportOrder(', '\n  async function deleteExportOrder(', 'updatedBy'),
    ('  async function deleteExportOrder(', '\n  async function createInventoryAdjustment(', 'deletedBy'),
    ('  async function createInventoryAdjustment(', '\n  async function processExportRequestToExportOrder(', 'createdBy'),
    ('  async function processExportRequestToExportOrder(', '\n  async function getInventoryBalanceId(', 'createdBy'),
]
for start_token, end_token, actor in segments:
    transaction_text = patch_actor(transaction_text, start_token, end_token, actor)

transaction_path.write_text(transaction_text, encoding='utf-8')

rules_path = Path('firestore.rules')
rules = rules_path.read_text(encoding='utf-8')

old_helper = """    function warehouseOperationAfterValid(operationId) {
      let path = /databases/$(database)/documents/warehouse_operations/$(operationId);
      let operation = getAfter(path).data;
      return operationId is string
        && operationId != ''
        && operation.get('operation_id', '') == operationId
        && operation.get('status', '') == 'completed'
        && ownEmailField(operation, 'created_by');
    }
"""
new_helper = """    function warehouseOperationExistsAfter(operationId) {
      let path = /databases/$(database)/documents/warehouse_operations/$(operationId);
      return operationId is string
        && operationId != ''
        && existsAfter(path);
    }
"""
if rules.count(old_helper) != 1:
    raise SystemExit(f'warehouse operation helper: cần đúng 1, tìm thấy {rules.count(old_helper)}')
rules = rules.replace(old_helper, new_helper, 1)

movement_pattern = re.compile(
    r"      allow create: if \(\n"
    r"          \(\n"
    r"            request\.resource\.data\.get\('operation_id', ''\) != ''\n"
    r"            && warehouseOperationAfterValid\(request\.resource\.data\.get\('operation_id', ''\)\)\n"
    r"          \)\n"
    r"          \|\| \(\n"
    r"            request\.resource\.data\.get\('operation_id', ''\) == ''\n"
    r"            && canWriteInventoryCore\(\)\n"
    r"            && ownEmailField\(request\.resource\.data, 'created_by'\)\n"
    r"          \)\n"
    r"        \)\n"
    r"        && quantityIsNumber\(request\.resource\.data\)\n"
    r"        && request\.resource\.data\.get\('quantity', 0\) != 0;"
)
if len(list(movement_pattern.finditer(rules))) != 1:
    raise SystemExit('Không tìm thấy đúng một rule stock_movements operation-backed hiện tại.')
movement_rule = """      allow create: if (
          request.resource.data.get('operation_id', '') != ''
          ? (
            warehouseOperationExistsAfter(request.resource.data.get('operation_id', ''))
            && ownEmailField(request.resource.data, 'created_by')
          )
          : (
            canWriteInventoryCore()
            && ownEmailField(request.resource.data, 'created_by')
          )
        )
        && quantityIsNumber(request.resource.data)
        && request.resource.data.get('quantity', 0) != 0;"""
rules = movement_pattern.sub(movement_rule, rules, count=1)

balance_pattern = re.compile(
    r"      allow create, update: if \(\n"
    r"          \(\n"
    r"            request\.resource\.data\.get\('last_operation_id', ''\) != ''\n"
    r"            && warehouseOperationAfterValid\(request\.resource\.data\.get\('last_operation_id', ''\)\)\n"
    r"          \)\n"
    r"          \|\| \(\n"
    r"            request\.resource\.data\.get\('last_operation_id', ''\) == ''\n"
    r"            && canWriteInventoryCore\(\)\n"
    r"          \)\n"
    r"        \)\n"
    r"        && balanceQuantityIsSafe\(\);"
)
if len(list(balance_pattern.finditer(rules))) != 1:
    raise SystemExit('Không tìm thấy đúng một rule inventory_balances operation-backed hiện tại.')
balance_rule = """      allow create, update: if (
          request.resource.data.get('last_operation_id', '') != ''
          ? (
            warehouseOperationExistsAfter(request.resource.data.get('last_operation_id', ''))
            && ownEmailField(request.resource.data, 'updated_by')
          )
          : canWriteInventoryCore()
        )
        && balanceQuantityIsSafe();"""
rules = balance_pattern.sub(balance_rule, rules, count=1)
rules_path.write_text(rules, encoding='utf-8')

test_path = Path('tests/warehouse.transactions.test.mjs')
test_text = test_path.read_text(encoding='utf-8')
old_test_balance = """        last_operation_id: operationId,
        updated_at: 'now'
"""
new_test_balance = """        last_operation_id: operationId,
        updated_by: STOCK,
        updated_at: 'now'
"""
if test_text.count(old_test_balance) != 1:
    raise SystemExit(f'Concurrency test balance payload: cần đúng 1, tìm thấy {test_text.count(old_test_balance)}')
test_path.write_text(test_text.replace(old_test_balance, new_test_balance, 1), encoding='utf-8')

Path('v7.5-rules-error.log').unlink(missing_ok=True)
print('Đã áp dụng Rules operation-backed chi phí thấp và gắn updated_by cho balance.')
