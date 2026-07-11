<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>()
</script>
<template>
  <div class="topbar">
    <div>
      <h1 class="page-title">{{ title }}</h1>
      <div v-if="subtitle" class="subtle">{{ subtitle }}</div>
    </div>
    <slot />
  </div>
</template>
