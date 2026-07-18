<script setup lang="ts">
import { firstAllowedAppRoute } from '~/constants/appRoutes'

const {
  loginWithGoogle,
  isLoggedIn,
  hasAccess,
  authLoading,
  authError,
  initAuth,
  permissions,
} = useAuth()
const route = useRoute()

async function goToFirstAllowedPage() {
  const target = firstAllowedAppRoute(permissions.value)
  await navigateTo(target?.path || '/forbidden')
}

onMounted(async () => {
  await initAuth()
  if (isLoggedIn.value && hasAccess.value) await goToFirstAllowedPage()
})

async function handleLogin() {
  try {
    await loginWithGoogle()
    if (hasAccess.value) await goToFirstAllowedPage()
  } catch (error: any) {
    console.error(error)
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="brand brand-wordmark-wrap" style="margin-bottom: 22px">
        <div class="brand-wordmark" aria-label="KINGCUP">
          <span class="brand-wordmark-king">KING</span><span class="brand-wordmark-cup">CUP</span>
        </div>
      </div>
      <h1 style="margin: 0 0 8px">Đăng nhập</h1>
      <p class="subtle">Sử dụng tài khoản Google đã được cấp quyền để đăng nhập.</p>
      <div v-if="route.query.denied || authError" class="card" style="background:#fff7ed; border-color:#fed7aa; margin: 16px 0; box-shadow:none">
        {{ authError || 'Tài khoản chưa có quyền truy cập hệ thống.' }}
      </div>
      <button class="btn primary" style="width: 100%; justify-content:center; margin-top: 12px" :disabled="authLoading" @click="handleLogin">
        {{ authLoading ? 'Đang đăng nhập...' : 'Đăng nhập bằng Google' }}
      </button>
    </div>
  </div>
</template>
