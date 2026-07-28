import type { QueryCachePolicy } from '~/constants/cachePolicies'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { buildQueryCacheKey, createQueryCache } from '~/utils/queryCache.mjs'

const sharedQueryCache = createQueryCache()

type CachedQueryOptions<T> = {
  authKey: string
  namespace: string
  params?: Record<string, unknown>
  tags?: string[]
  policy: QueryCachePolicy
  fetcher: () => Promise<T>
  force?: boolean
  onBackgroundError?: (error: unknown) => void
}

export function cachedQuery<T>(options: CachedQueryOptions<T>) {
  const key = buildQueryCacheKey({
    authKey: options.authKey,
    namespace: options.namespace,
    params: options.params || {},
  })

  return sharedQueryCache.getOrFetch({
    key,
    fetcher: options.fetcher,
    policy: options.policy,
    tags: options.tags || [],
    force: options.force === true,
    onBackgroundError: options.onBackgroundError,
  }) as Promise<T>
}

export function invalidateQueryCacheTags(tags: string[]) {
  return sharedQueryCache.invalidateTags(tags)
}

export function clearSharedQueryCache(authKey?: string) {
  return sharedQueryCache.clear(authKey ? { authKey } : {})
}

export function removeSharedQueryCacheKey(
  authKey: string,
  namespace: string,
  params: Record<string, unknown> = {},
) {
  const key = buildQueryCacheKey({ authKey, namespace, params })
  sharedQueryCache.removeKey(key)
}
