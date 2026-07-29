import {
  useNotifications as createNotificationsRuntime,
} from '../composables/useNotifications'

export * from '../composables/useNotifications'

let notificationRuntime: ReturnType<typeof createNotificationsRuntime> | null = null

/**
 * Return one notification runtime for the lifetime of the client application.
 *
 * AppShell is mounted by individual pages, so component-scoped notification
 * state would otherwise be recreated during every route transition. The
 * global bridge owns start/stop while all visual consumers share this object.
 */
export function useNotifications() {
  if (!notificationRuntime) {
    notificationRuntime = createNotificationsRuntime()
  }
  return notificationRuntime
}
