import {
  collection,
  limit as queryLimit,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from 'firebase/firestore'
import type { QueryCachePolicy } from '~/constants/cachePolicies'
import { invalidateScopedCache as invalidateBaseScopedCache } from '~/composables/useScopedQueries'
import {
  cachedQuery,
  invalidateQueryCacheTags,
} from '~/composables/useQueryCache'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import {
  REFERENCE_VERSION_QUERY_LIMIT,
  REFERENCE_VERSION_STORAGE_PREFIX,
  referenceSnapshotSignature,
  referenceVersionStorageKey,
} from '~/utils/referenceDataCache.mjs'

type ReferenceCollectionName = 'products' | 'warehouses' | 'suppliers' | 'units'

type ReferenceListOptions<T> = {
  collectionName: ReferenceCollectionName
  params?: Record<string, unknown>
  policy: QueryCachePolicy
  force?: boolean
  fetcher: () => Promise<T[]>
}

type ListenerEntry = {
  unsubscribe: Unsubscribe
  signature: string
}

const versionListeners = new Map<string, ListenerEntry>()

function readStoredSignature(key: string) {
  if (import.meta.server) return ''
  try {
    return sessionStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

function writeStoredSignature(key: string, signature: string) {
  if (import.meta.server) return
  try {
    sessionStorage.setItem(key, signature)
  } catch {
    // Version persistence is optional. The active listener remains authoritative.
  }
}

function clearStoredSignatures() {
  if (import.meta.server) return
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index)
      if (key?.startsWith(REFERENCE_VERSION_STORAGE_PREFIX)) sessionStorage.removeItem(key)
    }
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function resetReferenceDataCacheSync() {
  versionListeners.forEach(entry => entry.unsubscribe())
  versionListeners.clear()
  clearStoredSignatures()
}

export function useReferenceDataCache() {
  const { db } = useFirebaseServices()
  const { authorizationCacheKey } = useAuth()

  function currentAuthKey() {
    return String(authorizationCacheKey.value || 'anonymous')
  }

  function invalidateReferenceCollection(collectionName: ReferenceCollectionName) {
    invalidateBaseScopedCache(collectionName)
    invalidateQueryCacheTags([
      `collection:${collectionName}`,
      `collection:${collectionName}:list`,
    ])
  }

  function ensureVersionListener(collectionName: ReferenceCollectionName) {
    if (import.meta.server) return

    const authKey = currentAuthKey()
    const listenerKey = `${authKey}:${collectionName}`
    if (versionListeners.has(listenerKey)) return

    const storageKey = referenceVersionStorageKey(authKey, collectionName)
    const target = query(
      collection(db, collectionName),
      orderBy('updated_at', 'desc'),
      queryLimit(REFERENCE_VERSION_QUERY_LIMIT),
    )

    const entry: ListenerEntry = {
      signature: readStoredSignature(storageKey),
      unsubscribe: () => {},
    }

    entry.unsubscribe = onSnapshot(
      target,
      snapshot => {
        const nextSignature = referenceSnapshotSignature(snapshot.docs)
        const previousSignature = entry.signature
        entry.signature = nextSignature
        writeStoredSignature(storageKey, nextSignature)

        // The first snapshot establishes the current catalog version. A stored
        // signature lets reloads detect changes that happened while disconnected.
        if (previousSignature && previousSignature !== nextSignature) {
          invalidateReferenceCollection(collectionName)
        }
      },
      error => {
        versionListeners.delete(listenerKey)
        console.warn(
          `[KINGCUP_CACHE] Không thể theo dõi phiên bản ${collectionName}; cache TTL vẫn được áp dụng.`,
          error,
        )
      },
    )

    versionListeners.set(listenerKey, entry)
  }

  async function loadReferenceList<T>(options: ReferenceListOptions<T>) {
    ensureVersionListener(options.collectionName)
    return cachedQuery<T[]>({
      authKey: currentAuthKey(),
      namespace: `reference:${options.collectionName}:list`,
      params: options.params || { view: 'all' },
      tags: [
        `collection:${options.collectionName}`,
        `collection:${options.collectionName}:list`,
      ],
      policy: options.policy,
      force: options.force,
      fetcher: options.fetcher,
      onBackgroundError: error => {
        console.warn(
          `[KINGCUP_CACHE] Không thể làm mới danh mục ${options.collectionName} trong nền.`,
          error,
        )
      },
    })
  }

  return {
    loadReferenceList,
    ensureVersionListener,
    invalidateReferenceCollection,
  }
}
