import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import type { AppUser, RoleDoc } from '~/types/models'
import { normalizeEmail, isActive } from '~/utils/format'
import { permissionDebug } from '~/utils/permissionDebug'

function roleNamesFromUser(userDoc: any): string[] {
  const raw = userDoc?.roles || userDoc?.role_names || userDoc?.role || []
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
  return String(raw || '').split(',').map(s => s.trim()).filter(Boolean)
}

function roleMatches(role: any, name: string) {
  return String(role.id || '').toLowerCase() === name.toLowerCase()
    || String(role.name || '').toLowerCase() === name.toLowerCase()
    || String(role.role || '').toLowerCase() === name.toLowerCase()
}

export function useAuth() {
  const firebaseUser = useState<User | null>('auth.firebaseUser', () => null)
  const appUser = useState<AppUser | null>('auth.appUser', () => null)
  const roles = useState<RoleDoc[]>('auth.roles', () => [])
  const permissions = useState<string[]>('auth.permissions', () => [])
  const authReady = useState<boolean>('auth.ready', () => false)
  const authLoading = useState<boolean>('auth.loading', () => false)
  const authError = useState<string>('auth.error', () => '')

  const { auth, db, googleProvider } = useFirebaseServices()

  const isLoggedIn = computed(() => !!firebaseUser.value)
  const hasAccess = computed(() => !!appUser.value && isActive(appUser.value))
  const isAdmin = computed(() => appUser.value?.is_admin === true || permissions.value.includes('*'))

  function hasPermission(key: string) {
    return permissions.value.includes('*') || permissions.value.includes(key)
  }

  function hasAnyPermission(keys: string[]) {
    return keys.some(key => hasPermission(key))
  }

  async function loadProfile(user: User | null) {
    appUser.value = null
    roles.value = []
    permissions.value = []
    authError.value = ''
    if (!user?.email) return

    const email = normalizeEmail(user.email)
    const userSnap = await getDoc(doc(db, 'users', email))
    if (!userSnap.exists()) {
      authError.value = `Tài khoản ${email} chưa được cấp quyền trong hệ thống.`
      return
    }

    const data = { id: userSnap.id, email, ...userSnap.data() } as AppUser
    if (!isActive(data)) {
      authError.value = `Tài khoản ${email} đã bị khóa hoặc chưa hoạt động.`
      return
    }

    appUser.value = data

    const wantedNames = roleNamesFromUser(data)
    const roleListSnap = await getDocs(collection(db, 'roles'))
    const allRoles = roleListSnap.docs.map(d => ({ ...d.data(), id: d.id })) as RoleDoc[]
    const matchedRoles = wantedNames.length
      ? allRoles.filter(role => wantedNames.some(name => roleMatches(role, name)))
      : []

    roles.value = matchedRoles
    const rolePerms = matchedRoles.flatMap((r: any) => Array.isArray(r.permissions) ? r.permissions : [])
    const flattened = Array.from(new Set([...(data.permissions_flat || []), ...rolePerms]))
    permissions.value = flattened
    permissionDebug({
      module: 'auth', action: 'load_profile', stage: 'ready', userEmail: email,
      checks: flattened.map(permission => ({ name: permission, actual: 'granted', passed: true })),
      payload: {
        roles_in_user: wantedNames,
        matched_roles: matchedRoles.map(role => role.id || role.name),
        permissions_flat_in_user: data.permissions_flat || [],
        permissions_from_roles: rolePerms,
        effective_client_permissions: flattened
      },
      note: 'Firestore Rules chỉ đọc permissions_flat_in_user; effective_client_permissions là quyền phía client.'
    })
  }

  async function initAuth() {
    if (authReady.value || authLoading.value) return
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
    await signOut(auth)
    firebaseUser.value = null
    appUser.value = null
    roles.value = []
    permissions.value = []
    authError.value = ''
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
    isLoggedIn,
    hasAccess,
    isAdmin,
    hasPermission,
    hasAnyPermission,
    initAuth,
    loginWithGoogle,
    logout,
    loadProfile
  }
}
