from pathlib import Path
import re

path = Path('firestore.rules')
text = path.read_text(encoding='utf-8')

anchor = """    function quantityIsNumber(data) {
"""
helper = """    function warehousePendingOperationOwned(operationId) {
      let path = /databases/$(database)/documents/warehouse_operations/$(operationId);
      let operation = get(path).data;
      return operationId is string
        && operationId != ''
        && exists(path)
        && operation.get('status', '') == 'pending'
        && operation.get('created_by', '').lower() == email();
    }

"""
if text.count(anchor) != 1:
    raise SystemExit(f'quantityIsNumber anchor: cần đúng 1, tìm thấy {text.count(anchor)}')
text = text.replace(anchor, helper + anchor, 1)

operation_pattern = re.compile(
    r"      allow update: if canWriteInventoryCore\(\)\n"
    r"        && resource\.data\.get\('status', ''\) == 'pending'\n"
    r"        && request\.resource\.data\.get\('status', ''\) == 'completed'\n"
    r"        && resource\.data\.get\('operation_id', ''\) == docId\n"
    r"        && request\.resource\.data\.get\('operation_id', ''\) == docId\n"
    r"        && resource\.data\.get\('created_by', ''\)\.lower\(\) == email\(\)\n"
    r"        && request\.resource\.data\.get\('created_by', ''\) == resource\.data\.get\('created_by', ''\)\n"
    r"        && request\.resource\.data\.get\('action', ''\) == resource\.data\.get\('action', ''\)\n"
    r"        && request\.resource\.data\.get\('target_collection', ''\) == resource\.data\.get\('target_collection', ''\)\n"
    r"        && request\.resource\.data\.get\('target_id', ''\) == resource\.data\.get\('target_id', ''\);"
)
if len(list(operation_pattern.finditer(text))) != 1:
    raise SystemExit('Không tìm thấy đúng một operation update rule hiện tại.')
operation_rule = """      allow update: if resource.data.get('status', '') == 'pending'
        && request.resource.data.get('status', '') == 'completed'
        && resource.data.get('operation_id', '') == docId
        && request.resource.data.get('operation_id', '') == docId
        && resource.data.get('created_by', '').lower() == email()
        && request.resource.data.get('created_by', '') == resource.data.get('created_by', '')
        && request.resource.data.get('action', '') == resource.data.get('action', '');"""
text = operation_pattern.sub(operation_rule, text, count=1)

movement_pattern = re.compile(
    r"      allow create: if canWriteInventoryCore\(\)\n"
    r"        && ownEmailField\(request\.resource\.data, 'created_by'\)\n"
    r"        && quantityIsNumber\(request\.resource\.data\)\n"
    r"        && request\.resource\.data\.get\('quantity', 0\) != 0;"
)
if len(list(movement_pattern.finditer(text))) != 1:
    raise SystemExit('Không tìm thấy đúng một stock_movements create rule hiện tại.')
movement_rule = """      allow create: if (
          request.resource.data.get('operation_id', '') != ''
          ? (
            warehousePendingOperationOwned(request.resource.data.get('operation_id', ''))
            && ownEmailField(request.resource.data, 'created_by')
          )
          : (
            canWriteInventoryCore()
            && ownEmailField(request.resource.data, 'created_by')
          )
        )
        && quantityIsNumber(request.resource.data)
        && request.resource.data.get('quantity', 0) != 0;"""
text = movement_pattern.sub(movement_rule, text, count=1)

balance_pattern = re.compile(
    r"      allow create, update: if canWriteInventoryCore\(\)\n"
    r"        && balanceQuantityIsSafe\(\)\n"
    r"        && \(\n"
    r"          request\.resource\.data\.get\('last_operation_id', ''\) == ''\n"
    r"          \|\| ownEmailField\(request\.resource\.data, 'updated_by'\)\n"
    r"        \);"
)
if len(list(balance_pattern.finditer(text))) != 1:
    raise SystemExit('Không tìm thấy đúng một inventory_balances rule hiện tại.')
balance_rule = """      allow create, update: if (
          request.resource.data.get('last_operation_id', '') != ''
          ? (
            warehousePendingOperationOwned(request.resource.data.get('last_operation_id', ''))
            && ownEmailField(request.resource.data, 'updated_by')
          )
          : canWriteInventoryCore()
        )
        && balanceQuantityIsSafe();"""
text = balance_pattern.sub(balance_rule, text, count=1)

path.write_text(text, encoding='utf-8')
Path('v7.5-rules-error.log').unlink(missing_ok=True)
print('Đã chuyển pha 2 sang xác thực operation pending thuộc người dùng hiện tại.')
