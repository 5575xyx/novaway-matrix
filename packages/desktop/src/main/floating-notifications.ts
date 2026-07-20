import type { FloatingNotification } from "../preload/types"

export const FLOATING_NOTIFICATION_LIMIT = 48

const isFloatingNotification = (value: unknown): value is FloatingNotification => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const notification = value as Record<string, unknown>
  return (
    typeof notification.id === "string" &&
    typeof notification.title === "string" &&
    (notification.body === undefined || typeof notification.body === "string") &&
    (notification.href === undefined || typeof notification.href === "string") &&
    (notification.sessionID === undefined || typeof notification.sessionID === "string") &&
    (notification.requestID === undefined || typeof notification.requestID === "string") &&
    (notification.status === undefined || notification.status === "replied" || notification.status === "dismissed") &&
    typeof notification.at === "number" &&
    Number.isFinite(notification.at) &&
    typeof notification.read === "boolean"
  )
}

export function normalizeFloatingNotifications(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter(isFloatingNotification).slice(0, FLOATING_NOTIFICATION_LIMIT)
}

export function prependFloatingNotification(notifications: FloatingNotification[], notification: FloatingNotification) {
  return [notification, ...notifications].slice(0, FLOATING_NOTIFICATION_LIMIT)
}

export function markFloatingNotificationsRead(notifications: FloatingNotification[], ids?: string[]) {
  const selected = ids ? new Set(ids) : undefined
  return notifications.map((notification) => {
    if (notification.read || (selected && !selected.has(notification.id))) return notification
    return { ...notification, read: true }
  })
}

export function clearReadFloatingNotifications(notifications: FloatingNotification[]) {
  return notifications.filter((notification) => !notification.read)
}

export function resolveFloatingNotification(
  notifications: FloatingNotification[],
  input: { sessionID: string; requestID: string; status: "replied" | "dismissed" },
) {
  return notifications.map((notification) => {
    if (notification.sessionID !== input.sessionID || notification.requestID !== input.requestID) return notification
    return { ...notification, read: true, status: input.status }
  })
}
