export const QUERY_CACHE_SCHEMA_VERSION = 3
export const QUERY_CACHE_STORAGE_PREFIX = 'kingcup.query-cache.v3.'

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

export function stableSerialize(value) {
  if (value == null) return String(value)
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(',')}}`
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return JSON.stringify(String(value))
  if (typeof value === 'bigint') return JSON.stringify(value.toString())
  if (typeof value === 'undefined') return '"__undefined__"'
  return JSON.stringify(value)
}

export function buildQueryCacheKey({ authKey = 'anonymous', namespace, params = {} }) {
  const safeNamespace = String(namespace || '').trim()
  if (!safeNamespace) throw new Error('Query cache namespace is required.')
  const safeAuthKey = String(authKey || 'anonymous').trim() || 'anonymous'
  return `${QUERY_CACHE_SCHEMA_VERSION}:${safeAuthKey}:${safeNamespace}:${stableSerialize(params)}`
}

function toStorageValue(value) {
  if (value == null || typeof value !== 'object') return value
  if (typeof value.toDate === 'function') {
    const date = value.toDate()
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : String(value)
  }
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(toStorageValue)
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, toStorageValue(item)]),
  )
}

function normalizeTags(tags) {
  return Array.from(new Set((tags || []).map(tag => String(tag || '').trim()).filter(Boolean))).sort()
}

function resolveStorage(storage) {
  if (storage) return storage
  try {
    return globalThis?.sessionStorage || null
  } catch {
    return null
  }
}

export function createQueryCache(options = {}) {
  const memory = new Map()
  const inFlight = new Map()
  const storage = resolveStorage(options.storage)
  const storagePrefix = String(options.storagePrefix || QUERY_CACHE_STORAGE_PREFIX)
  const now = typeof options.now === 'function' ? options.now : Date.now

  function storageKey(key) {
    return `${storagePrefix}${key}`
  }

  function removePersisted(key) {
    if (!storage) return
    try {
      storage.removeItem(storageKey(key))
    } catch {
      // Cache persistence is optional.
    }
  }

  function persist(key, entry) {
    if (!storage) return
    try {
      storage.setItem(storageKey(key), JSON.stringify({
        ...entry,
        data: toStorageValue(entry.data),
      }))
    } catch {
      // sessionStorage can be full or disabled. Memory cache remains available.
    }
  }

  function validEntry(entry) {
    return entry
      && entry.schemaVersion === QUERY_CACHE_SCHEMA_VERSION
      && typeof entry.freshUntil === 'number'
      && typeof entry.staleUntil === 'number'
      && entry.staleUntil >= entry.freshUntil
      && Array.isArray(entry.tags)
      && Object.prototype.hasOwnProperty.call(entry, 'data')
  }

  function readPersisted(key) {
    if (!storage) return null
    try {
      const raw = storage.getItem(storageKey(key))
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!validEntry(parsed)) {
        removePersisted(key)
        return null
      }
      memory.set(key, parsed)
      return parsed
    } catch {
      removePersisted(key)
      return null
    }
  }

  function entryFor(key) {
    const entry = memory.get(key) || readPersisted(key)
    if (!entry) return null
    if (!validEntry(entry)) {
      memory.delete(key)
      removePersisted(key)
      return null
    }
    if (entry.staleUntil <= now()) {
      memory.delete(key)
      removePersisted(key)
      return null
    }
    return entry
  }

  function read(key) {
    const entry = entryFor(key)
    if (!entry) return { state: 'miss', data: undefined }
    return {
      state: entry.freshUntil > now() ? 'fresh' : 'stale',
      data: entry.data,
      entry,
    }
  }

  function write(key, data, policy = {}, tags = []) {
    const currentTime = now()
    const freshMs = Math.max(0, Number(policy.freshMs) || 0)
    const staleMs = Math.max(freshMs, Number(policy.staleMs) || freshMs)
    const entry = {
      schemaVersion: QUERY_CACHE_SCHEMA_VERSION,
      createdAt: currentTime,
      freshUntil: currentTime + freshMs,
      staleUntil: currentTime + staleMs,
      tags: normalizeTags(tags),
      data,
    }
    memory.set(key, entry)
    persist(key, entry)
    return data
  }

  function refresh({ key, fetcher, policy, tags }) {
    const pending = inFlight.get(key)
    if (pending) return pending

    const task = Promise.resolve()
      .then(fetcher)
      .then(data => write(key, data, policy, tags))
      .finally(() => {
        if (inFlight.get(key) === task) inFlight.delete(key)
      })

    inFlight.set(key, task)
    return task
  }

  async function getOrFetch({
    key,
    fetcher,
    policy,
    tags = [],
    force = false,
    onBackgroundError,
  }) {
    if (!force) {
      const cached = read(key)
      if (cached.state === 'fresh') return cached.data
      if (cached.state === 'stale') {
        void refresh({ key, fetcher, policy, tags }).catch(error => {
          if (typeof onBackgroundError === 'function') onBackgroundError(error)
        })
        return cached.data
      }
    }
    return refresh({ key, fetcher, policy, tags })
  }

  function removeKey(key) {
    memory.delete(key)
    inFlight.delete(key)
    removePersisted(key)
  }

  function persistedKeys() {
    if (!storage) return []
    const keys = []
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const rawKey = storage.key(index)
        if (rawKey?.startsWith(storagePrefix)) keys.push(rawKey.slice(storagePrefix.length))
      }
    } catch {
      return []
    }
    return keys
  }

  function allKeys() {
    return Array.from(new Set([...memory.keys(), ...persistedKeys()]))
  }

  function invalidateTags(tags) {
    const wanted = new Set(normalizeTags(tags))
    if (!wanted.size) return 0
    let removed = 0
    for (const key of allKeys()) {
      const entry = memory.get(key) || readPersisted(key)
      if (!entry || !entry.tags.some(tag => wanted.has(tag))) continue
      removeKey(key)
      removed += 1
    }
    return removed
  }

  function clear(filter = {}) {
    const authKey = String(filter.authKey || '').trim()
    let removed = 0
    for (const key of allKeys()) {
      if (authKey && !key.startsWith(`${QUERY_CACHE_SCHEMA_VERSION}:${authKey}:`)) continue
      removeKey(key)
      removed += 1
    }
    return removed
  }

  return {
    read,
    write,
    getOrFetch,
    invalidateTags,
    clear,
    removeKey,
    keys: allKeys,
    pendingCount: () => inFlight.size,
  }
}
