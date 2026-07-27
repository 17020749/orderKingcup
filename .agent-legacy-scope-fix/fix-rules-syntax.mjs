import { readFile, writeFile } from 'node:fs/promises'

function block(...lines) {
  return lines.join('\n')
}

const path = 'firestore.rules'
const source = await readFile(path, 'utf8')
const startMarker = '    function currentUserCode() {'
const endMarker = '    function ownsOrderData(data) {'
const start = source.indexOf(startMarker)
const end = source.indexOf(endMarker, start)
if (start < 0 || end <= start) {
  throw new Error(`firestore.rules: invalid helper boundaries start=${start} end=${end}`)
}
const helper = block(
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
  '',
)
await writeFile(path, `${source.slice(0, start)}${helper}${source.slice(end)}`)
console.log('Firestore-compatible legacy ownership helper applied.')
await import('./fix-query-scope.mjs')
