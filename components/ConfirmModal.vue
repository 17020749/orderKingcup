<script setup lang="ts">
withDefaults(defineProps<{
  show?: boolean
  title?: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'primary'
}>(), {
  show: false,
  title: 'Xác nhận thao tác',
  message: '',
  confirmLabel: 'Xác nhận',
  cancelLabel: 'Hủy',
  variant: 'danger'
})

defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <div v-if="show" class="modal-backdrop confirm-backdrop">
    <div class="confirm-modal">
      <div class="confirm-icon" :class="variant">!</div>
      <h3>{{ title }}</h3>
      <p>{{ message }}</p>
      <div class="confirm-actions">
        <button class="btn ghost" @click="$emit('cancel')">{{ cancelLabel }}</button>
        <button class="btn" :class="variant === 'danger' ? 'danger' : 'primary'" @click="$emit('confirm')">
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
