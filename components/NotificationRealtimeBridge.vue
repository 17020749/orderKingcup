<script setup lang="ts">
import { useNotifications } from '~/runtime/useNotificationsSingleton'

const { appUser } = useAuth()
const { rulePermissions, start, stop } = useNotifications()

const subscriptionKey = computed(() => [
  String(appUser.value?.email || '').trim().toLowerCase(),
  rulePermissions.value.slice().sort().join(','),
].join('|'))

watch(
  subscriptionKey,
  () => start(),
  { immediate: true },
)

onBeforeUnmount(stop)
</script>

<template>
  <span hidden aria-hidden="true" />
</template>
