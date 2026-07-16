from pathlib import Path
import re

path = Path('firestore.rules')
text = path.read_text(encoding='utf-8')

helper_pattern = re.compile(
    r"\n    function warehouseOperationAfterValid\(operationId\) \{\n"
    r"      let path = /databases/\$\(database\)/documents/warehouse_operations/\$\(operationId\);\n"
    r"      let operation = getAfter\(path\)\.data;\n"
    r"      return operationId is string\n"
    r"        && operationId != ''\n"
    r"        && operation\.get\('status', ''\) == 'completed'\n"
    r"        && ownEmailField\(operation, 'created_by'\);\n"
    r"    \}\n"
)
helper_matches = list(helper_pattern.finditer(text))
if len(helper_matches) != 1:
    raise SystemExit(f'warehouseOperationAfterValid: cần đúng 1 khối, tìm thấy {len(helper_matches)}')
text = helper_pattern.sub('\n', text, count=1)

operation_pattern = re.compile(
    r"      allow update: if resource\.data\.get\('status', ''\) == 'pending'\n"
    r"        && request\.resource\.data\.get\('status', ''\) == 'completed'\n"
    r"        && sameEmailField\(resource\.data, request\.resource\.data, 'created_by'\)\n"
    r"        && ownEmailField\(resource\.data, 'created_by'\)\n"
    r"        && unchanged\(\[\n"
    r"(?:          '[^']+',?\n)+"
    r"        \]\)\n"
    r"        && request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasOnly\(\[\n"
    r"(?:          '[^']+',?\n)+"
    r"        \]\);"
)
operation_matches = list(operation_pattern.finditer(text))
if len(operation_matches) != 1:
    raise SystemExit(f'warehouse operation update rule: cần đúng 1 khối, tìm thấy {len(operation_matches)}')
operation_rule = """      allow update: if canWriteInventoryCore()
        && resource.data.get('status', '') == 'pending'
        && request.resource.data.get('status', '') == 'completed'
        && resource.data.get('operation_id', '') == docId
        && request.resource.data.get('operation_id', '') == docId
        && resource.data.get('created_by', '').lower() == email()
        && request.resource.data.get('created_by', '') == resource.data.get('created_by', '')
        && request.resource.data.get('action', '') == resource.data.get('action', '')
        && request.resource.data.get('target_collection', '') == resource.data.get('target_collection', '')
        && request.resource.data.get('target_id', '') == resource.data.get('target_id', '');"""
text = operation_pattern.sub(operation_rule, text, count=1)

movement_pattern = re.compile(
    r"      allow create: if \(\n"
    r"          request\.resource\.data\.get\('operation_id', ''\) != ''\n"
    r"          \? \(\n"
    r"            warehouseOperationAfterValid\(request\.resource\.data\.get\('operation_id', ''\)\)\n"
    r"            && ownEmailField\(request\.resource\.data, 'created_by'\)\n"
    r"          \)\n"
    r"          : \(\n"
    r"            canWriteInventoryCore\(\)\n"
    r"            && ownEmailField\(request\.resource\.data, 'created_by'\)\n"
    r"          \)\n"
    r"        \)\n"
    r"        && quantityIsNumber\(request\.resource\.data\)\n"
    r"        && request\.resource\.data\.get\('quantity', 0\) != 0;"
)
movement_matches = list(movement_pattern.finditer(text))
if len(movement_matches) != 1:
    raise SystemExit(f'stock_movements create rule: cần đúng 1 khối, tìm thấy {len(movement_matches)}')
movement_rule = """      allow create: if canWriteInventoryCore()
        && ownEmailField(request.resource.data, 'created_by')
        && quantityIsNumber(request.resource.data)
        && request.resource.data.get('quantity', 0) != 0;"""
text = movement_pattern.sub(movement_rule, text, count=1)

balance_pattern = re.compile(
    r"      allow create, update: if \(\n"
    r"          request\.resource\.data\.get\('last_operation_id', ''\) != ''\n"
    r"          \? \(\n"
    r"            warehouseOperationAfterValid\(request\.resource\.data\.get\('last_operation_id', ''\)\)\n"
    r"            && ownEmailField\(request\.resource\.data, 'updated_by'\)\n"
    r"          \)\n"
    r"          : canWriteInventoryCore\(\)\n"
    r"        \)\n"
    r"        && balanceQuantityIsSafe\(\);"
)
balance_matches = list(balance_pattern.finditer(text))
if len(balance_matches) != 1:
    raise SystemExit(f'inventory_balances rule: cần đúng 1 khối, tìm thấy {len(balance_matches)}')
balance_rule = """      allow create, update: if canWriteInventoryCore()
        && balanceQuantityIsSafe()
        && (
          request.resource.data.get('last_operation_id', '') == ''
          || ownEmailField(request.resource.data, 'updated_by')
        );"""
text = balance_pattern.sub(balance_rule, text, count=1)

path.write_text(text, encoding='utf-8')
Path('v7.5-rules-error.log').unlink(missing_ok=True)
print('Đã áp dụng Rules kho chi phí thấp, giữ quyền kho và actor validation.')
