export type QueryCachePolicy = {
  freshMs: number
  staleMs: number
}

export const QUERY_CACHE_POLICIES = {
  repoList: {
    freshMs: 30_000,
    staleMs: 2 * 60_000,
  },
  repoDetail: {
    freshMs: 30_000,
    staleMs: 5 * 60_000,
  },
  referenceList: {
    freshMs: 15 * 60_000,
    staleMs: 24 * 60 * 60_000,
  },
} as const satisfies Record<string, QueryCachePolicy>
