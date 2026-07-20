import { repositoryRootFromModule, validateRepository } from './firestore-index-validation.mjs'

try {
  const result = validateRepository(repositoryRootFromModule())
  console.log('Firestore index validation passed.')
  console.log(`Declared composite indexes: ${result.declaredIndexCount}`)
  console.log(`Literal source queries inventoried: ${result.sourceQueryCount}`)
  console.log(`Composite indexes required by current literal queries: ${result.requiredCompositeCount}`)
  console.log(`Dynamic/unresolved query calls reviewed separately: ${result.unresolvedQueryCount}`)
  for (const item of result.inventory.unresolved) {
    console.log(`  - ${item.file}:${item.line} (${item.reason})`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
