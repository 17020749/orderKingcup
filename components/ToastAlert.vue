<script setup lang="ts">
const { toast, closeToast } = useUi()
</script>

<template>
  <div v-if="toast.visible" class="toast-alert" :class="`toast-${toast.type}`">
    <span>{{ toast.message }}</span>
    <button type="button" @click="closeToast">×</button>
  </div>
</template>
