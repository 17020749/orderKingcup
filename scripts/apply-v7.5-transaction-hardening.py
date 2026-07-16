from pathlib import Path
import re

rules_path = Path('firestore.rules')
text = rules_path.read_text(encoding='utf-8')

pattern = re.compile(
    r"    function canWriteInventoryCore\(\) \{\n"
    r"      return hasAnyPerm\(\[\n"
    r"(?:        '[^']+',\n)*"
    r"        '[^']+'\n"
    r"      \]\);\n"
    r"    \}\n"
)
matches = list(pattern.finditer(text))
if len(matches) != 1:
    raise SystemExit(f'canWriteInventoryCore: cần đúng 1 khối, tìm thấy {len(matches)}')

replacement = """    function canWriteInventoryCore() {
      let path = userPath();
      let user = get(path).data;
      let permissions = user.get('permissions_flat', []);
      return signedIn()
        && exists(path)
        && activeUserData(user)
        && (
          user.get('is_admin', false) == true
          || (
            permissions is list
            && (
              '*' in permissions
              || permissions.hasAny([
                'import.create',
                'import.edit',
                'import.delete',
                'export.create',
                'export.edit',
                'export.delete',
                'inventory.adjust',
                'export_requests.release',
                'export_requests.process'
              ])
            )
          )
        );
    }
"""
text = pattern.sub(replacement, text, count=1)
rules_path.write_text(text, encoding='utf-8')

Path('v7.5-rules-error.log').unlink(missing_ok=True)
print('Đã tối ưu canWriteInventoryCore cho transaction kho.')
