<script setup lang="ts">
import { firstAllowedAppRoute } from '~/constants/appRoutes'

const { permissions, logout } = useAuth()
const firstAllowed = computed(() => firstAllowedAppRoute(permissions.value))
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="brand brand-wordmark-wrap" style="margin-bottom:22px">
        <div class="brand-wordmark" aria-label="KINGCUP">
          <span class="brand-wordmark-king">KING</span><span class="brand-wordmark-cup">CUP</span>
        </div>
      </div>
      <h1>Bạn không có quyền truy cập</h1>
      <p class="subtle">Tài khoản không được cấp quyền mở trang này.</p>
      <NuxtLink v-if="firstAllowed" class="btn primary" :to="firstAllowed.path">
        Về {{ firstAllowed.label }}
      </NuxtLink>
      <button v-else class="btn" @click="logout">Đăng xuất</button>
    </div>
  </div>
</template>
