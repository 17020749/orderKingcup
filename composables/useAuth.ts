import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import type { AppUser, RoleDoc } from '~/types/models'
import { normalizeEmail, isActive } from '~/utils/format'
import { permissionDebug } from '~/utils/permissionDebug'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import {
  authorizationCacheToken,
  authorizationFingerprint,
  effectivePermissionsFromUser,
  isAdminFromPermissions,
} from '~/utils/authorizationState.mjs'

let profileUnsubscribe: Unsubscribe | null = null
let profileListenerEmail = ''
let profileInitialPromise: Promise<void> | null = null
let resolveProfileInitial: (() => void) | null = null

function finishProfileInitial() {
  const resolve = resolveProfileInitial
  resolveProfileInitial = null
  resolve?.()
}

function stopProfileListener() {
  profileUnsubscribe?.()
  profileUnsubscribe = null
  profileListenerEmail = ''
  finishProfileInitial()
  profileInitialPromise = null
}

export function useAuth() {
  const firebaseUser = useState<User | null>('auth.firebaseUser', () => null)
  const appUser = useState<AppUser | null>('auth.appUser', () => null)
  // Giữ state roles để không phá vỡ API composable cũ. Quyền thực thi không
  // còn được cộng trực tiếp từ collection roles ở phía client.
  const roles = useState<RoleDoc[]>('auth.roles', () => [])
  const permissions = useState<string[]>('auth.permissions', () => [])
  const authReady = useState<boolean>('auth.ready', () => false)
  const authLoading = useState<boolean>('auth.loading', () => false)
  const authError = useState<string>('auth.error', () => '')
  const authorizationFingerprintState = useState<string>('auth.authorizationFingerprint', () => '')
  const authorizationCacheKey = useState<string>('auth.authorizationCacheKey', () => 'anonymous')
  const authorizationRevision = useState<number>('auth.authorizationRevision', () => 0)

  const { auth, db, googleProvider } = useFirebaseServices()

  const isLoggedIn = computed(() => !!firebaseUser.value)
  const hasAccess = computed(() => !!appUser.value && isActive(appUser.value))
  const isAdmin = computed(() => isAdminFromPermissions(permissions.value))

  function hasPermission(key: string) {
    return permissions.value.includes('*') || permissions.value.includes(key)
  }

  function hasAnyPermission(keys: string[]) {
    return keys.some(key => hasPermission(key))
  }

  async function clearAuthorizationCaches() {
    if (import.meta.server) return
    const cleanups = [
      import('~/composables/useScopedQueries')
        .then(({ invalidateScopedCache }) => invalidateScopedCache()),
      import('~/composables/useQueryCache')
        .then(({ clearSharedQueryCache }) => clearSharedQueryCache()),
      import('~/composables/useReferenceDataCache')
        .then(({ resetReferenceDataCacheSync }) => resetReferenceDataCacheSync()),
    ]
    await Promise.allSettled(cleanups)
  }

  async function applyProfileData(email: string, rawData: any | null, source: string) {
    const normalizedEmail = normalizeEmail(email)
    const profile = rawData
      ? ({ ...rawData, id: normalizedEmail, email: normalizedEmail } as AppUser)
      : null
    const fingerprintSource = profile || {
      email: normalizedEmail,
      active: false,
      status: rawData === null ? 'missing' : 'inactive',
      permissions_flat: [],
      permission_schema_version: 0,
    }
    const nextFingerprint = authorizationFingerprint(fingerprintSource)
    const previousFingerprint = authorizationFingerprintState.value
    const changed = previousFingerprint !== nextFingerprint

    authorizationFingerprintState.value = nextFingerprint
    authorizationCacheKey.value = authorizationCacheToken(fingerprintSource)
    if (changed) authorizationRevision.value += 1

    roles.value = []
    permissions.value = []
    authError.value = ''

    if (!profile) {
      appUser.value = null
      authError.value = normalizedEmail
        ? `Tài khoản ${normalizedEmail} chưa được cấp quyền trong hệ thống.`
        : ''
    } else if (!isActive(profile)) {
      appUser.value = null
      authError.value = `Tài khoản ${normalizedEmail} đã bị khóa hoặc chưa hoạt động.`
    } else {
      const effectivePermissions = effectivePermissionsFromUser(profile)
      const canonicalAdmin = isAdminFromPermissions(effectivePermissions)
      permissions.value = effectivePermissions
      // Một số module cũ vẫn đọc appUser.is_admin. Chuẩn hóa field này từ
      // permissions_flat để chúng không thể cấp quyền qua cờ legacy bị lệch.
      appUser.value = {
        ...profile,
        is_admin: canonicalAdmin,
      }
    }

    permissionDebug({
      module: 'auth',
      action: 'load_profile',
      stage: appUser.value ? 'ready' : 'denied',
      userEmail: normalizedEmail,
      checks: permissions.value.map(permission => ({
        name: permission,
        actual: 'granted_from_permissions_flat',
        passed: true,
      })),
      payload: {
        source,
        roles_in_user: Array.isArray((profile as any)?.roles)
          ? (profile as any).roles
          : (profile as any)?.role || [],
        stored_is_admin: (profile as any)?.is_admin === true,
        effective_is_admin: isAdminFromPermissions(permissions.value),
        permissions_flat_in_user: (profile as any)?.permissions_flat || [],
        effective_client_permissions: permissions.value,
        permission_schema_version: (profile as any)?.permission_schema_version || 0,
        authorization_cache_key: authorizationCacheKey.value,
      },
      note: 'Client dùng users.permissions_flat; role và is_admin lưu cũ chỉ là dữ liệu quản trị, không trực tiếp cấp quyền.',
    })

    if (changed && previousFingerprint) await clearAuthorizationCaches()
  }

  function reportProfileListenerError(email: string, error: any) {
    authError.value = `Không theo dõi được thay đổi quyền của ${email}: ${String(error?.message || error)}`
    permissionDebug({
      module: 'auth',
      action: 'profile_listener',
      stage: 'listener_error',
      userEmail: email,
      error,
      note: 'Giữ quyền hiện tại khi listener tạm thời mất kết nối; Firestore Rules vẫn là lớp bảo vệ cuối cùng.',
    })
  }

  function startProfileListener(user: User | null): Promise<void> {
    const email = normalizeEmail(user?.email || '')
    if (!email) {
      stopProfileListener()
      return applyProfileData('', null, 'auth_state')
    }
    if (profileUnsubscribe && profileListenerEmail === email) {
      return profileInitialPromise || Promise.resolve()
    }

    stopProfileListener()
    profileListenerEmail = email
    profileInitialPromise = new Promise<void>((resolve) => {
      resolveProfileInitial = resolve
    })
    const initialPromise = profileInitialPromise

    try {
      profileUnsubscribe = onSnapshot(
        doc(db, 'users', email),
        snapshot => {
          if (profileListenerEmail !== email) return
          void applyProfileData(email, snapshot.exists() ? snapshot.data() : null, 'onSnapshot')
            .catch(error => reportProfileListenerError(email, error))
            .finally(() => {
              if (profileListenerEmail === email) finishProfileInitial()
            })
        },
        error => {
          if (profileListenerEmail !== email) return
          reportProfileListenerError(email, error)
          finishProfileInitial()
        },
      )
    } catch (error) {
      profileUnsubscribe = null
      reportProfileListenerError(email, error)
      finishProfileInitial()
    }

    return initialPromise
  }

  async function loadProfile(user: User | null) {
    await startProfileListener(user)
  }

  async function initAuth() {
    if (authReady.value) {
      await loadProfile(firebaseUser.value)
      return
    }
    if (authLoading.value) return

    authLoading.value = true
    await new Promise<void>((resolve) => {
      const unsub = onAuthStateChanged(auth, async (user) => {
        firebaseUser.value = user
        try {
          await loadProfile(user)
        } finally {
          authReady.value = true
          authLoading.value = false
          unsub()
          resolve()
        }
      })
    })
  }

  async function loginWithGoogle() {
    authLoading.value = true
    authError.value = ''
    try {
      const result = await signInWithPopup(auth, googleProvider)
      firebaseUser.value = result.user
      await loadProfile(result.user)
      return result.user
    } finally {
      authReady.value = true
      authLoading.value = false
    }
  }

  async function logout() {
    stopProfileListener()
    await signOut(auth)
    firebaseUser.value = null
    appUser.value = null
    roles.value = []
    permissions.value = []
    authError.value = ''
    authorizationFingerprintState.value = ''
    authorizationCacheKey.value = 'anonymous'
    authorizationRevision.value += 1
    await clearAuthorizationCaches()
    await navigateTo('/login')
  }

  return {
    firebaseUser,
    appUser,
    roles,
    permissions,
    authReady,
    authLoading,
    authError,
    authorizationCacheKey,
    authorizationRevision,
    isLoggedIn,
    hasAccess,
    isAdmin,
    hasPermission,
    hasAnyPermission,
    initAuth,
    loginWithGoogle,
    logout,
    loadProfile,
  }
}
