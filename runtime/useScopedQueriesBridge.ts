import {
  invalidateScopedCache as invalidateLegacyScopedCache,
  useScopedQueries as useLegacyScopedQueries,
} from '../composables/useScopedQueries'
import {
  clearExportRequestOrderCache,
  useExportRequestQueries,
} from '../composables/useExportRequestQueries'
import {
  clearSharedQueryCache,
  invalidateQueryCacheTags,
} from '../composables/useQueryCache'

export * from '../composables/useScopedQueries'

/**
 * Runtime bridge for callers importing ~/composables/useScopedQueries.
 * The original scoped-query implementation remains in place so static safety
 * tests still inspect the real query source. Export request list pages override
 * only their realtime/history window through a bounded query implementation.
 */
export function useScopedQueries() {
  return {
    ...useLegacyScopedQueries(),
    ...useExportRequestQueries(),
    invalidateScopedCache,
  }
}

export function invalidateScopedCache(collectionName?: string) {
  invalidateLegacyScopedCache(collectionName)
  if (!collectionName || collectionName === 'order_export_requests') {
    clearExportRequestOrderCache()
  }

  if (!collectionName) {
    return clearSharedQueryCache()
  }

  return invalidateQueryCacheTags([
    `collection:${collectionName}`,
    `collection:${collectionName}:list`,
  ])
}
