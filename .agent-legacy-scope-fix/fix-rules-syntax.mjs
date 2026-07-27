import { readFile, writeFile } from 'node:fs/promises'

function block(...lines) {
  return lines.join('\n')
}

const path = 'firestore.rules'
const source = await readFile(path, 'utf8')
const before = block(
  '    function currentUserCode() {',
  "      let code = get(userPath()).data.get('user_code', '');",
  '      return code is string && code.matches(\'^[A-Z0-9]{1,12}$\') ? code : "";',
  '    }',
  '',
  '    function ownsLegacyOrderByUserCode(data) {',
  '      let code = currentUserCode();',
  "      let storedCode = data.get('user_code', '');",
  "      let orderCode = data.get('order_code', '');",
  '      return code != ""',
  '        && storedCode is string',
  '        && orderCode is string',
  '        && (',
  '          storedCode.lower() == code.lower()',
  '          || (',
  '            storedCode == ""',
  "            && orderCode.matches('^' + code + '-.*')",
  '          )',
  '        );',
  '    }',
)
const after = block(
  '    function ownsLegacyOrderByUserCode(data) {',
  "      let code = get(userPath()).data.get('user_code', '');",
  "      let storedCode = data.get('user_code', '');",
  "      let orderCode = data.get('order_code', '');",
  '      return code is string',
  "        && code.matches('^[A-Z0-9]{1,12}$')",
  '        && storedCode is string',
  '        && orderCode is string',
  '        && (',
  '          storedCode.lower() == code.lower()',
  '          || (',
  "            storedCode == ''",
  "            && orderCode.matches('^' + code + '-.*')",
  '          )',
  '        );',
  '    }',
)
const count = source.split(before).length - 1
if (count !== 1) throw new Error(`firestore.rules: expected one invalid helper, found ${count}`)
await writeFile(path, source.replace(before, after))
console.log('Firestore-compatible legacy ownership helper applied.')
