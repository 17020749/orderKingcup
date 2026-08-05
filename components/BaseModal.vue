<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    loading?: boolean;
    size?: "md" | "lg" | "xl" | "full";
    cancelLabel?: string;
    saveLabel?: string;
    showFooter?: boolean;
  }>(),
  {
    size: "md",
    cancelLabel: "Hủy",
    saveLabel: "Lưu",
    showFooter: true,
  },
);

defineEmits<{ close: []; save: [] }>();
</script>

<template>
  <div class="modal-backdrop">
    <div class="modal" :class="`modal-${size}`">
      <div class="modal-header">
        <h3 style="margin: 0">{{ title }}</h3>
        <div v-if="$slots['header-actions']" class="modal-header-actions">
          <slot name="header-actions" />
        </div>
        <button class="modal-close" type="button" @click="$emit('close')">
          ×
        </button>
      </div>
      <div class="modal-body"><slot /></div>
      <div v-if="showFooter" class="modal-footer">
        <button class="btn ghost" type="button" @click="$emit('close')">
          {{ cancelLabel }}
        </button>
        <button
          class="btn primary"
          type="button"
          :disabled="loading"
          @click="$emit('save')"
        >
          {{ loading ? "Đang lưu..." : saveLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.modal-header h3 {
  flex: 1 1 220px;
  min-width: 0;
}
.modal-header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}
.modal-close {
  flex: 0 0 auto;
}
</style>
