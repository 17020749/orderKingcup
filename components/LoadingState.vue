<script setup lang="ts">
defineProps<{ text?: string }>()
</script>

<template>
  <div class="empty">{{ text || 'Đang tải dữ liệu...' }}</div>
</template>
