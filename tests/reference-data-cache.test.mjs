import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  REFERENCE_DATA_COLLECTIONS,
  REFERENCE_VERSION_QUERY_LIMIT,
  referenceSnapshotSignature,
  referenceVersionStorageKey,
} from '../utils/referenceDataCache.mjs'

test('reference collection registry is bounded and explicit', () => {
  assert.deepEqual(REFERENCE_DATA_COLLECTIONS, [
    'products',
    'warehouses',
    'suppliers',
    'units',
  ])
  assert.equal(REFERENCE_VERSION_QUERY_LIMIT, 5)
})

test('reference snapshot signature is deterministic and reacts to updated_at', () => {
  const first = referenceSnapshotSignature([
    { id: 'b', updated_at: { seconds: 20, nanoseconds: 2 } },
    { id: 'a', updated_at: { seconds: 10, nanoseconds: 1 } },
  ])
  const reordered = referenceSnapshotSignature([
    { id: 'a', updated_at: { seconds: 10, nanoseconds: 1 } },
    { id: 'b', updated_at: { seconds: 20, nanoseconds: 2 } },
  ])
  const changed = referenceSnapshotSignature([
    { id: 'a', updated_at: { seconds: 10, nanoseconds: 1 } },
    { id: 'b', updated_at: { seconds: 21, nanoseconds: 0 } },
  ])

  assert.equal(first, reordered)
  assert.notEqual(first, changed)
})

test('reference version storage is isolated by authorization cache key', () => {
  assert.notEqual(
    referenceVersionStorageKey('admin-v1', 'products'),
    referenceVersionStorageKey('sale-v1', 'products'),
  )
})

test('reference cache listener is bounded and invalidates both cache generations', () => {
  const source = readFileSync(new URL('../composables/useReferenceDataCache.ts', import.meta.url), 'utf8')
  assert.match(source, /orderBy\('updated_at', 'desc'\)/)
  assert.match(source, /queryLimit\(REFERENCE_VERSION_QUERY_LIMIT\)/)
  assert.match(source, /invalidateBaseScopedCache\(collectionName\)/)
  assert.match(source, /invalidateQueryCacheTags/)
  assert.match(source, /resetReferenceDataCacheSync/)
  assert.doesNotMatch(source, /cache_versions/)
})

test('scoped query wrapper overrides all shared reference loaders with long-lived policies', () => {
  const source = readFileSync(new URL('../composables/useScopedQueriesClient.ts', import.meta.url), 'utf8')
  for (const loader of ['loadProducts', 'loadWarehouses', 'loadSuppliers', 'loadUnits']) {
    assert.match(source, new RegExp(`async function ${loader}\\(`))
    assert.match(source, new RegExp(`\\n    ${loader},`))
  }
  assert.match(source, /QUERY_CACHE_POLICIES\.referenceList/)
  assert.match(source, /QUERY_CACHE_POLICIES\.referenceCatalog/)
  assert.match(source, /loadReferenceList/)
})

test('authorization cleanup stops reference listeners and removes version signatures', () => {
  const source = readFileSync(new URL('../composables/useAuth.ts', import.meta.url), 'utf8')
  assert.match(source, /useReferenceDataCache/)
  assert.match(source, /resetReferenceDataCacheSync/)
  assert.match(source, /Promise\.allSettled/)
})
