import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildQueryCacheKey,
  createQueryCache,
  stableSerialize,
} from '../utils/queryCache.mjs'

function fakeStorage() {
  const values = new Map()
  return {
    get length() {
      return values.size
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null
    },
    setItem(key, value) {
      values.set(key, String(value))
    },
    removeItem(key) {
      values.delete(key)
    },
    clear() {
      values.clear()
    },
  }
}

test('stableSerialize is deterministic for object keys', () => {
  assert.equal(
    stableSerialize({ b: 2, a: { d: 4, c: 3 } }),
    stableSerialize({ a: { c: 3, d: 4 }, b: 2 }),
  )
})

test('cache key isolates authorization scopes', () => {
  const adminKey = buildQueryCacheKey({ authKey: 'admin-token', namespace: 'repo:products:list' })
  const saleKey = buildQueryCacheKey({ authKey: 'sale-token', namespace: 'repo:products:list' })
  assert.notEqual(adminKey, saleKey)
})

test('fresh cache prevents repeated fetches', async () => {
  let clock = 1_000
  let calls = 0
  const cache = createQueryCache({ storage: fakeStorage(), now: () => clock })
  const options = {
    key: '3:user:products:{}',
    tags: ['collection:products'],
    policy: { freshMs: 1_000, staleMs: 5_000 },
    fetcher: async () => {
      calls += 1
      return [{ id: 'p1' }]
    },
  }

  assert.deepEqual(await cache.getOrFetch(options), [{ id: 'p1' }])
  clock += 500
  assert.deepEqual(await cache.getOrFetch(options), [{ id: 'p1' }])
  assert.equal(calls, 1)
})

test('stale cache returns immediately and refreshes once in background', async () => {
  let clock = 1_000
  let calls = 0
  let releaseRefresh
  const cache = createQueryCache({ storage: fakeStorage(), now: () => clock })
  const key = '3:user:warehouses:{}'

  await cache.getOrFetch({
    key,
    tags: ['collection:warehouses'],
    policy: { freshMs: 100, staleMs: 5_000 },
    fetcher: async () => {
      calls += 1
      return ['old']
    },
  })

  clock += 200
  const fetcher = () => {
    calls += 1
    return new Promise(resolve => {
      releaseRefresh = () => resolve(['new'])
    })
  }

  assert.deepEqual(await cache.getOrFetch({
    key,
    tags: ['collection:warehouses'],
    policy: { freshMs: 100, staleMs: 5_000 },
    fetcher,
  }), ['old'])

  assert.deepEqual(await cache.getOrFetch({
    key,
    tags: ['collection:warehouses'],
    policy: { freshMs: 100, staleMs: 5_000 },
    fetcher,
  }), ['old'])

  assert.equal(calls, 2)
  releaseRefresh()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(cache.read(key).data, ['new'])
})

test('concurrent misses share one in-flight request', async () => {
  let calls = 0
  let release
  const cache = createQueryCache({ storage: fakeStorage() })
  const request = {
    key: '3:user:suppliers:{}',
    tags: ['collection:suppliers'],
    policy: { freshMs: 1_000, staleMs: 5_000 },
    fetcher: () => {
      calls += 1
      return new Promise(resolve => {
        release = () => resolve([{ id: 's1' }])
      })
    },
  }

  const first = cache.getOrFetch(request)
  const second = cache.getOrFetch(request)
  assert.equal(calls, 0)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 1)
  release()
  assert.deepEqual(await first, [{ id: 's1' }])
  assert.deepEqual(await second, [{ id: 's1' }])
})

test('tag invalidation clears memory and persisted entries', async () => {
  const storage = fakeStorage()
  const cache = createQueryCache({ storage })
  const key = '3:user:products:{}'

  await cache.getOrFetch({
    key,
    tags: ['collection:products', 'collection:products:list'],
    policy: { freshMs: 1_000, staleMs: 5_000 },
    fetcher: async () => [{ id: 'p1' }],
  })

  assert.equal(cache.read(key).state, 'fresh')
  assert.equal(cache.invalidateTags(['collection:products']), 1)
  assert.equal(cache.read(key).state, 'miss')
  assert.equal(storage.length, 0)
})

test('clear can target one authorization scope', async () => {
  const cache = createQueryCache({ storage: fakeStorage() })
  const adminKey = buildQueryCacheKey({ authKey: 'admin', namespace: 'repo:products:list' })
  const saleKey = buildQueryCacheKey({ authKey: 'sale', namespace: 'repo:products:list' })
  const request = key => ({
    key,
    tags: ['collection:products'],
    policy: { freshMs: 1_000, staleMs: 5_000 },
    fetcher: async () => [key],
  })

  await cache.getOrFetch(request(adminKey))
  await cache.getOrFetch(request(saleKey))
  assert.equal(cache.clear({ authKey: 'admin' }), 1)
  assert.equal(cache.read(adminKey).state, 'miss')
  assert.equal(cache.read(saleKey).state, 'fresh')
})

test('invalidated in-flight request cannot repopulate cache', async () => {
  let release
  const storage = fakeStorage()
  const cache = createQueryCache({ storage })
  const key = '3:user:orders:{}'
  const pending = cache.getOrFetch({
    key,
    tags: ['collection:orders'],
    policy: { freshMs: 1_000, staleMs: 5_000 },
    fetcher: () => new Promise(resolve => {
      release = () => resolve([{ id: 'o1' }])
    }),
  })

  await new Promise(resolve => setImmediate(resolve))
  cache.removeKey(key)
  release()
  assert.deepEqual(await pending, [{ id: 'o1' }])
  assert.equal(cache.read(key).state, 'miss')
  assert.equal(storage.length, 0)
})
