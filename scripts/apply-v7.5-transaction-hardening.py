from pathlib import Path
import re

rules_path = Path('firestore.rules')
text = rules_path.read_text(encoding='utf-8')

helper_pattern = re.compile(
    r"(    function canWriteInventoryCore\(\) \{\n"
    r"      return hasAnyPerm\(\[\n"
    r"(?:        '[^']+',\n)*"
    r"        '[^']+'\n"
    r"      \]\);\n"
    r"    \}\n)"
)
helper_matches = list(helper_pattern.finditer(text))
if len(helper_matches) != 1:
    raise SystemExit(f'canWriteInventoryCore: cần đúng 1 khối, tìm thấy {len(helper_matches)}')

helper = """
    function warehouseOperationAfterValid(operationId) {
      let path = /databases/$(database)/documents/warehouse_operations/$(operationId);
      let operation = getAfter(path).data;
      return operationId is string
        && operationId != ''
        && operation.get('operation_id', '') == operationId
        && operation.get('status', '') == 'completed'
        && ownEmailField(operation, 'created_by');
    }
"""
text = helper_pattern.sub(lambda match: match.group(1) + helper, text, count=1)

movement_pattern = re.compile(
    r"      allow create: if canWriteInventoryCore\(\)\n"
    r"        && quantityIsNumber\(request\.resource\.data\)\n"
    r"        && request\.resource\.data\.get\('quantity', 0\) != 0\n"
    r"        && ownEmailField\(request\.resource\.data, 'created_by'\);"
)
movement_matches = list(movement_pattern.finditer(text))
if len(movement_matches) != 1:
    raise SystemExit(f'stock_movements create: cần đúng 1 khối, tìm thấy {len(movement_matches)}')

movement_rule = """      allow create: if (
          (
            request.resource.data.get('operation_id', '') != ''
            && warehouseOperationAfterValid(request.resource.data.get('operation_id', ''))
          )
          || (
            request.resource.data.get('operation_id', '') == ''
            && canWriteInventoryCore()
            && ownEmailField(request.resource.data, 'created_by')
          )
        )
        && quantityIsNumber(request.resource.data)
        && request.resource.data.get('quantity', 0) != 0;"""
text = movement_pattern.sub(movement_rule, text, count=1)

balance_pattern = re.compile(
    r"      allow create, update: if canWriteInventoryCore\(\)\n"
    r"        && balanceQuantityIsSafe\(\);"
)
balance_matches = list(balance_pattern.finditer(text))
if len(balance_matches) != 1:
    raise SystemExit(f'inventory_balances write: cần đúng 1 khối, tìm thấy {len(balance_matches)}')

balance_rule = """      allow create, update: if (
          (
            request.resource.data.get('last_operation_id', '') != ''
            && warehouseOperationAfterValid(request.resource.data.get('last_operation_id', ''))
          )
          || (
            request.resource.data.get('last_operation_id', '') == ''
            && canWriteInventoryCore()
          )
        )
        && balanceQuantityIsSafe();"""
text = balance_pattern.sub(balance_rule, text, count=1)

rules_path.write_text(text, encoding='utf-8')

for temporary_path in [
    Path('.github/workflows/verify-v7.5.yml'),
    Path('.github/v7.5-final-rules-trigger'),
    Path('v7.5-final-tests-error.log'),
]:
    temporary_path.unlink(missing_ok=True)

print('Đã áp dụng operation-backed stock rules và dọn file kiểm tra tạm.')
