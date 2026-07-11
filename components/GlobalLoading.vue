<script setup lang="ts">
const { isLoading } = useUi()
</script>

<template>
  <div v-if="isLoading" class="loading-overlay">
    <div class="loading-card">
      <div class="spinner" />
      <span>Đang xử lý...</span>
    </div>
  </div>
</template>
