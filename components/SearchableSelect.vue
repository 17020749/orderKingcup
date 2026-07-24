<script setup lang="ts">
type OptionItem = {
  value: string;
  label: string;
  subLabel?: string;
  search?: string;
  disabled?: boolean;
};

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    options: OptionItem[];
    placeholder?: string;
    disabled?: boolean;
    noResultText?: string;
    actionLabel?: string;
  }>(),
  {
    modelValue: "",
    placeholder: "Chọn dữ liệu",
    disabled: false,
    noResultText: "Không tìm thấy dữ liệu phù hợp",
    actionLabel: "",
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  change: [value: string];
  action: [];
}>();

const open = ref(false);
const keyword = ref("");
const rootRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const panelStyle = ref<Record<string, string>>({});

const selected = computed(() =>
  props.options.find((option) => option.value === props.modelValue),
);
const filtered = computed(() => {
  const q = normalize(keyword.value);
  if (!q) return props.options.slice(0, 80);
  return props.options
    .filter((option) =>
      normalize(
        `${option.label} ${option.subLabel || ""} ${option.search || ""}`,
      ).includes(q),
    )
    .slice(0, 80);
});

function normalize(value: any) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function updatePanelPosition() {
  if (!process.client || !rootRef.value) return;

  const rect = rootRef.value.getBoundingClientRect();
  const gap = 8;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(
    Math.max(rect.width, 220),
    Math.max(220, viewportWidth - gap * 2),
  );
  const left = Math.min(
    Math.max(gap, rect.left),
    Math.max(gap, viewportWidth - width - gap),
  );
  const bottomSpace = Math.max(0, viewportHeight - rect.bottom - gap);
  const topSpace = Math.max(0, rect.top - gap);
  const openAbove = bottomSpace < 280 && topSpace > bottomSpace;
  const availableSpace = Math.max(
    80,
    (openAbove ? topSpace : bottomSpace) - 6,
  );
  const maxHeight = Math.min(360, availableSpace);

  panelStyle.value = {
    position: "fixed",
    left: `${left}px`,
    right: "auto",
    width: `${width}px`,
    zIndex: "140",
    maxHeight: `${maxHeight}px`,
    top: openAbove ? "auto" : `${rect.bottom + 6}px`,
    bottom: openAbove ? `${viewportHeight - rect.top + 6}px` : "auto",
  };
}

async function toggleOpen() {
  if (props.disabled) return;
  open.value = !open.value;
  if (open.value) {
    await nextTick();
    updatePanelPosition();
    inputRef.value?.focus();
  }
}

function choose(option: OptionItem) {
  if (option.disabled) return;
  emit("update:modelValue", option.value);
  emit("change", option.value);
  open.value = false;
  keyword.value = "";
}

function triggerAction() {
  open.value = false;
  keyword.value = "";
  emit("action");
}

function onOutside(event: MouseEvent) {
  const target = event.target as Node;
  if (rootRef.value?.contains(target) || panelRef.value?.contains(target))
    return;
  open.value = false;
}

function onWindowMove() {
  if (open.value) updatePanelPosition();
}

watch(open, (value) => {
  if (value) nextTick(updatePanelPosition);
});

onMounted(() => {
  document.addEventListener("click", onOutside);
  window.addEventListener("resize", onWindowMove);
  window.addEventListener("scroll", onWindowMove, true);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onOutside);
  window.removeEventListener("resize", onWindowMove);
  window.removeEventListener("scroll", onWindowMove, true);
});
</script>

<template>
  <div ref="rootRef" class="searchable-select" :class="{ disabled }">
    <button
      type="button"
      class="searchable-select-trigger"
      :disabled="disabled"
      :aria-expanded="open"
      @click.stop="toggleOpen"
    >
      <span v-if="selected">
        <b>{{ selected.label }}</b>
        <small v-if="selected.subLabel">{{ selected.subLabel }}</small>
      </span>
      <span v-else class="placeholder">{{ placeholder }}</span>
      <span class="chevron">⌄</span>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="panelRef"
        class="searchable-select-panel searchable-select-panel-teleport"
        :class="{ 'has-action': actionLabel }"
        :style="panelStyle"
        @click.stop
      >
        <input
          ref="inputRef"
          v-model="keyword"
          class="input searchable-select-input"
          placeholder="Gõ để tìm..."
          @keydown.esc="open = false"
        />
        <button
          v-if="actionLabel"
          type="button"
          class="searchable-select-action"
          @click="triggerAction"
        >
          {{ actionLabel }}
        </button>
        <div class="searchable-select-options">
          <button
            v-for="option in filtered"
            :key="option.value"
            type="button"
            class="searchable-select-option"
            :class="{
              active: option.value === modelValue,
              disabled: option.disabled,
            }"
            @click="choose(option)"
          >
            <b>{{ option.label }}</b>
            <small v-if="option.subLabel">{{ option.subLabel }}</small>
          </button>
          <div v-if="!filtered.length" class="searchable-select-empty">
            {{ noResultText }}
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.searchable-select-panel-teleport {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.searchable-select-panel-teleport .searchable-select-input,
.searchable-select-panel-teleport .searchable-select-action {
  flex: 0 0 auto;
}

.searchable-select-panel-teleport .searchable-select-options {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
}

.searchable-select-panel-teleport .searchable-select-options::-webkit-scrollbar {
  width: 8px;
}

.searchable-select-panel-teleport .searchable-select-options::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 999px;
}

.searchable-select-panel-teleport .searchable-select-options::-webkit-scrollbar-track {
  background: transparent;
}
</style>
