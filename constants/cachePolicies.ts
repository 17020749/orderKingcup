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
    freshMs: 15_000,
    staleMs: 60_000,
  },
  referenceList: {
    freshMs: 15 * 60_000,
    staleMs: 24 * 60 * 60_000,
  },
  referenceCatalog: {
    freshMs: 30 * 60_000,
    staleMs: 24 * 60 * 60_000,
  },
  dashboardSnapshot: {
    // Dashboard là dữ liệu tổng hợp nhiều collection. Giữ snapshot tươi 5 phút
    // giúp các lần đổi route/mở lại tab không đọc lại toàn bộ Firestore.
    // Mutation trong cùng client vẫn xóa cache theo collection tag; nút Làm mới
    // tiếp tục bỏ qua cache khi người dùng cần số liệu tức thời.
    freshMs: 5 * 60_000,
    staleMs: 30 * 60_000,
  },
} as const satisfies Record<string, QueryCachePolicy>
