import {
  invalidateScopedCache as invalidateLegacyScopedCache,
} from '~/runtime/useScopedQueriesLegacy'
import {
  clearSharedQueryCache,
  invalidateQueryCacheTags,
} from '~/composables/useQueryCache'

export * from '~/runtime/useScopedQueriesLegacy'

/**
 * Invalidate both cache generations through the public scoped-cache API.
 *
 * Atomic transactions historically called only invalidateScopedCache(), which
 * cleared the legacy v2 cache but left shared v3 snapshots (such as Dashboard)
 * alive until their TTL expired. Keeping the bridge here means every existing
 * and future transaction gets the same collection-tag invalidation semantics.
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
