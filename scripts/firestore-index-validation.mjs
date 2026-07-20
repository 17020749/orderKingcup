import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const VALID_QUERY_SCOPES = new Set(['COLLECTION', 'COLLECTION_GROUP'])
const VALID_ORDERS = new Set(['ASCENDING', 'DESCENDING'])
const VALID_ARRAY_CONFIGS = new Set(['CONTAINS'])
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.vue'])
const EXCLUDED_DIRECTORIES = new Set([
  '.agents', '.git', '.github', '.nuxt', '.output', 'dist', 'node_modules', 'public', 'tests',
])

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`Không đọc được JSON ${filePath}: ${error.message}`)
  }
}

function indexFieldToken(field) {
  if (field.order) return `${field.fieldPath}:${field.order}`
  if (field.arrayConfig) return `${field.fieldPath}:ARRAY_${field.arrayConfig}`
  return `${field.fieldPath}:UNKNOWN`
}

export function indexSignature(index) {
  return [
    index.collectionGroup,
    index.queryScope,
    ...index.fields.map(indexFieldToken),
  ].join('|')
}

export function validateIndexDocument(indexDocument) {
  const errors = []
  if (!indexDocument || typeof indexDocument !== 'object' || Array.isArray(indexDocument)) {
    return ['firestore.indexes.json phải là một object JSON.']
  }
  if (!Array.isArray(indexDocument.indexes)) errors.push('`indexes` phải là một mảng.')
  if (!Array.isArray(indexDocument.fieldOverrides)) errors.push('`fieldOverrides` phải là một mảng.')
  if (errors.length) return errors

  const signatures = new Map()
  indexDocument.indexes.forEach((index, indexPosition) => {
    const label = `indexes[${indexPosition}]`
    if (!index || typeof index !== 'object' || Array.isArray(index)) {
      errors.push(`${label} phải là object.`)
      return
    }
    if (typeof index.collectionGroup !== 'string' || !index.collectionGroup.trim()) {
      errors.push(`${label}.collectionGroup phải là chuỗi không rỗng.`)
    }
    if (!VALID_QUERY_SCOPES.has(index.queryScope)) {
      errors.push(`${label}.queryScope phải là COLLECTION hoặc COLLECTION_GROUP.`)
    }
    if (!Array.isArray(index.fields) || index.fields.length < 2) {
      errors.push(`${label}.fields phải có ít nhất 2 trường.`)
      return
    }

    const fieldPaths = new Set()
    index.fields.forEach((field, fieldPosition) => {
      const fieldLabel = `${label}.fields[${fieldPosition}]`
      if (!field || typeof field !== 'object' || Array.isArray(field)) {
        errors.push(`${fieldLabel} phải là object.`)
        return
      }
      if (typeof field.fieldPath !== 'string' || !field.fieldPath.trim()) {
        errors.push(`${fieldLabel}.fieldPath phải là chuỗi không rỗng.`)
      } else if (fieldPaths.has(field.fieldPath)) {
        errors.push(`${label} lặp fieldPath ${field.fieldPath}.`)
      } else {
        fieldPaths.add(field.fieldPath)
      }

      const hasOrder = Object.prototype.hasOwnProperty.call(field, 'order')
      const hasArrayConfig = Object.prototype.hasOwnProperty.call(field, 'arrayConfig')
      if (hasOrder === hasArrayConfig) {
        errors.push(`${fieldLabel} phải có đúng một trong order hoặc arrayConfig.`)
      } else if (hasOrder && !VALID_ORDERS.has(field.order)) {
        errors.push(`${fieldLabel}.order không hợp lệ: ${String(field.order)}.`)
      } else if (hasArrayConfig && !VALID_ARRAY_CONFIGS.has(field.arrayConfig)) {
        errors.push(`${fieldLabel}.arrayConfig không hợp lệ: ${String(field.arrayConfig)}.`)
      }
    })

    if (typeof index.collectionGroup === 'string' && VALID_QUERY_SCOPES.has(index.queryScope) && Array.isArray(index.fields)) {
      const signature = indexSignature(index)
      if (signatures.has(signature)) {
        errors.push(`${label} trùng với indexes[${signatures.get(signature)}]: ${signature}`)
      } else {
        signatures.set(signature, indexPosition)
      }
    }
  })

  return errors
}

function walkSourceFiles(rootDir) {
  const files = []
  const walk = currentDir => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue
      const absolutePath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        walk(absolutePath)
        continue
      }
      if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(absolutePath)
    }
  }
  walk(rootDir)
  return files
}

function extractBalancedCalls(source, functionName) {
  const calls = []
  const pattern = new RegExp(`\\b${functionName}\\s*\\(`, 'g')
  let match
  while ((match = pattern.exec(source))) {
    const openIndex = source.indexOf('(', match.index)
    let depth = 0
    let quote = ''
    let escaped = false
    let lineComment = false
    let blockComment = false
    for (let index = openIndex; index < source.length; index++) {
      const char = source[index]
      const next = source[index + 1]
      if (lineComment) {
        if (char === '\n') lineComment = false
        continue
      }
      if (blockComment) {
        if (char === '*' && next === '/') {
          blockComment = false
          index += 1
        }
        continue
      }
      if (quote) {
        if (escaped) {
          escaped = false
          continue
        }
        if (char === '\\') {
          escaped = true
          continue
        }
        if (char === quote) quote = ''
        continue
      }
      if (char === '/' && next === '/') {
        lineComment = true
        index += 1
        continue
      }
      if (char === '/' && next === '*') {
        blockComment = true
        index += 1
        continue
      }
      if (char === "'" || char === '"' || char === '`') {
        quote = char
        continue
      }
      if (char === '(') depth += 1
      if (char === ')') {
        depth -= 1
        if (depth === 0) {
          calls.push({ start: match.index, body: source.slice(openIndex + 1, index) })
          pattern.lastIndex = index + 1
          break
        }
      }
    }
  }
  return calls
}

function literalCollectionName(queryBody) {
  const match = queryBody.match(/\bcollection\s*\(\s*[^,]+,\s*(['"`])([^'"`]+)\1\s*\)/)
  return match?.[2] || ''
}

function parseWhereClauses(queryBody) {
  const clauses = []
  const pattern = /\bwhere\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*(['"`])([^'"`]+)\3/g
  let match
  while ((match = pattern.exec(queryBody))) clauses.push({ fieldPath: match[2], operator: match[4] })
  return clauses
}

function parseOrderByClauses(queryBody) {
  const clauses = []
  const pattern = /\borderBy\s*\(\s*(['"`])([^'"`]+)\1(?:\s*,\s*(['"`])(asc|desc)\3)?\s*\)/g
  let match
  while ((match = pattern.exec(queryBody))) {
    clauses.push({ fieldPath: match[2], direction: (match[4] || 'asc').toUpperCase() === 'DESC' ? 'DESCENDING' : 'ASCENDING' })
  }
  return clauses
}

function requiredCompositeIndex(collectionGroup, whereClauses, orderByClauses) {
  const arrayWhere = whereClauses.filter(clause => ['array-contains', 'array-contains-any'].includes(clause.operator))
  const inequalityWhere = whereClauses.filter(clause => ['<', '<=', '>', '>=', '!=', 'not-in'].includes(clause.operator))
  const equalityWhere = whereClauses.filter(clause => ['==', 'in'].includes(clause.operator))

  const fieldMap = new Map()
  for (const clause of arrayWhere) fieldMap.set(clause.fieldPath, { fieldPath: clause.fieldPath, arrayConfig: 'CONTAINS' })
  for (const clause of equalityWhere) {
    if (!fieldMap.has(clause.fieldPath)) fieldMap.set(clause.fieldPath, { fieldPath: clause.fieldPath, order: 'ASCENDING' })
  }
  for (const clause of inequalityWhere) {
    if (!fieldMap.has(clause.fieldPath)) fieldMap.set(clause.fieldPath, { fieldPath: clause.fieldPath, order: 'ASCENDING' })
  }
  for (const clause of orderByClauses) fieldMap.set(clause.fieldPath, { fieldPath: clause.fieldPath, order: clause.direction })

  const distinctConstraintFields = new Set([
    ...whereClauses.map(clause => clause.fieldPath),
    ...orderByClauses.map(clause => clause.fieldPath),
  ])
  const needsComposite = distinctConstraintFields.size > 1 && (
    orderByClauses.length > 0 || inequalityWhere.length > 1 || arrayWhere.length > 0
  )
  if (!needsComposite) return null

  return {
    collectionGroup,
    queryScope: 'COLLECTION',
    fields: Array.from(fieldMap.values()),
  }
}

export function inventorySourceQueries(rootDir) {
  const queries = []
  const unresolved = []
  for (const filePath of walkSourceFiles(rootDir)) {
    const source = fs.readFileSync(filePath, 'utf8')
    for (const call of extractBalancedCalls(source, 'query')) {
      const collectionGroup = literalCollectionName(call.body)
      const relativePath = path.relative(rootDir, filePath).replaceAll(path.sep, '/')
      const line = source.slice(0, call.start).split('\n').length
      if (!collectionGroup) {
        unresolved.push({ file: relativePath, line, reason: 'collection động hoặc không phải collection() literal' })
        continue
      }
      const whereClauses = parseWhereClauses(call.body)
      const orderByClauses = parseOrderByClauses(call.body)
      const requiredIndex = requiredCompositeIndex(collectionGroup, whereClauses, orderByClauses)
      queries.push({ file: relativePath, line, collectionGroup, whereClauses, orderByClauses, requiredIndex })
    }
  }
  return { queries, unresolved }
}

function indexCoversRequired(declared, required) {
  if (declared.collectionGroup !== required.collectionGroup || declared.queryScope !== required.queryScope) return false
  const declaredTokens = new Set(declared.fields.map(indexFieldToken))
  return required.fields.every(field => {
    if (field.arrayConfig) return declaredTokens.has(indexFieldToken(field))
    if (declaredTokens.has(indexFieldToken(field))) return true
    if (field.order === 'ASCENDING') return declaredTokens.has(`${field.fieldPath}:DESCENDING`)
    return false
  })
}

export function validateRepository(rootDir) {
  const firebasePath = path.join(rootDir, 'firebase.json')
  const indexesPath = path.join(rootDir, 'firestore.indexes.json')
  const firebaseConfig = readJson(firebasePath)
  if (firebaseConfig?.firestore?.indexes !== 'firestore.indexes.json') {
    throw new Error('firebase.json phải khai báo firestore.indexes = "firestore.indexes.json".')
  }

  const indexDocument = readJson(indexesPath)
  const schemaErrors = validateIndexDocument(indexDocument)
  if (schemaErrors.length) throw new Error(schemaErrors.join('\n'))

  const inventory = inventorySourceQueries(rootDir)
  const requiredIndexes = inventory.queries.map(query => query.requiredIndex).filter(Boolean)
  const missing = requiredIndexes.filter(required => !indexDocument.indexes.some(declared => indexCoversRequired(declared, required)))
  if (missing.length) {
    throw new Error([
      'Thiếu composite index cho query hiện tại:',
      ...missing.map(index => `- ${indexSignature(index)}`),
    ].join('\n'))
  }

  return {
    declaredIndexCount: indexDocument.indexes.length,
    sourceQueryCount: inventory.queries.length,
    unresolvedQueryCount: inventory.unresolved.length,
    requiredCompositeCount: requiredIndexes.length,
    missingCompositeCount: missing.length,
    inventory,
  }
}

export function repositoryRootFromModule(metaUrl = import.meta.url) {
  return path.resolve(path.dirname(fileURLToPath(metaUrl)), '..')
}
