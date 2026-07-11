<script setup lang="ts">
const { loginWithGoogle, isLoggedIn, hasAccess, authLoading, authError, initAuth } = useAuth()
const route = useRoute()
const config = useRuntimeConfig().public

onMounted(async () => {
  await initAuth()
  if (isLoggedIn.value && hasAccess.value) await navigateTo('/dashboard')
})

async function handleLogin() {
  try {
    await loginWithGoogle()
    if (hasAccess.value) await navigateTo('/dashboard')
  } catch (error: any) {
    console.error(error)
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="brand" style="color:#172033; margin-bottom: 22px">
        <div class="brand-badge">K</div>
        <div>
          <div>{{ config.appName }}</div>
          <div class="subtle small">Firebase Auth + Firestore</div>
        </div>
      </div>
      <h1 style="margin: 0 0 8px">Đăng nhập</h1>
      <p class="subtle">Dùng tài khoản Google đã được cấp quyền trong collection <b>users</b>.</p>
      <div v-if="route.query.denied || authError" class="card" style="background:#fff7ed; border-color:#fed7aa; margin: 16px 0; box-shadow:none">
        {{ authError || 'Tài khoản chưa có quyền truy cập hệ thống.' }}
      </div>
      <button class="btn primary" style="width: 100%; justify-content:center; margin-top: 12px" :disabled="authLoading" @click="handleLogin">
        {{ authLoading ? 'Đang đăng nhập...' : 'Đăng nhập bằng Google' }}
      </button>
      <p class="subtle small" style="margin-top: 16px">
        Login mới không dùng session Apps Script, nên không bị lỗi lẫn tài khoản giữa các máy/tab như bản cũ.
      </p>
    </div>
  </div>
</template>
