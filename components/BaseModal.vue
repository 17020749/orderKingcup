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
  <div class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal" :class="`modal-${size}`">
      <div class="modal-header">
        <h3 style="margin: 0">{{ title }}</h3>
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
