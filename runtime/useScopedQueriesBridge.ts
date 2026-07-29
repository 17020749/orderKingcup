import {
  invalidateScopedCache as invalidateLegacyScopedCache,
} from '../composables/useScopedQueries'
import {
  clearSharedQueryCache,
  invalidateQueryCacheTags,
} from '../composables/useQueryCache'

export * from '../composables/useScopedQueries'

/**
 * Runtime bridge for callers importing ~/composables/useScopedQueries.
 * The original scoped-query implementation remains in place so static safety
 * tests still inspect the real query source. Only invalidation is extended.
 */
export function invalidateScopedCache(collectionName?: string) {
  invalidateLegacyScopedCache(collectionName)

  if (!collectionName) {
    return clearSharedQueryCache()
  }

  return invalidateQueryCacheTags([
    `collection:${collectionName}`,
    `collection:${collectionName}:list`,
  ])
}
