import { describe, expect, test } from "bun:test"
import {
  FLOATING_NOTIFICATION_LIMIT,
  clearReadFloatingNotifications,
  markFloatingNotificationsRead,
  normalizeFloatingNotifications,
  prependFloatingNotification,
  resolveFloatingNotification,
} from "./floating-notifications"

describe("floating notifications", () => {
  test("restores only valid persisted notifications and limits the history", () => {
    const items = Array.from({ length: FLOATING_NOTIFICATION_LIMIT + 2 }, (_, index) => ({
      id: `${index}`,
      title: `Notification ${index}`,
      at: index,
      read: false,
    }))
    const restored = normalizeFloatingNotifications([...items, { title: "missing id" }])

    expect(restored).toHaveLength(FLOATING_NOTIFICATION_LIMIT)
    expect(restored[0]?.id).toBe("0")
  })

  test("preserves optional notification navigation and resolution details", () => {
    const restored = normalizeFloatingNotifications([
      {
        id: "question",
        title: "Question",
        body: "Please choose",
        href: "/project/session/session-1",
        sessionID: "session-1",
        requestID: "request-1",
        status: "replied",
        at: 1,
        read: true,
      },
      { id: "legacy", title: "Legacy", at: 2, read: false },
    ])

    expect(restored).toEqual([
      {
        id: "question",
        title: "Question",
        body: "Please choose",
        href: "/project/session/session-1",
        sessionID: "session-1",
        requestID: "request-1",
        status: "replied",
        at: 1,
        read: true,
      },
      { id: "legacy", title: "Legacy", at: 2, read: false },
    ])
  })

  test("adds new notifications at the front and preserves the configured history limit", () => {
    const previous = Array.from({ length: FLOATING_NOTIFICATION_LIMIT }, (_, index) => ({
      id: `${index}`,
      title: `Notification ${index}`,
      at: index,
      read: false,
    }))
    const next = prependFloatingNotification(previous, { id: "new", title: "New", at: 99, read: false })

    expect(next).toHaveLength(FLOATING_NOTIFICATION_LIMIT)
    expect(next[0]?.id).toBe("new")
    expect(next.at(-1)?.id).toBe("46")
  })

  test("marks either selected notifications or the full history as read", () => {
    const notifications = [
      { id: "one", title: "One", at: 1, read: false },
      { id: "two", title: "Two", at: 2, read: false },
    ]

    expect(markFloatingNotificationsRead(notifications, ["one"])).toEqual([
      { id: "one", title: "One", at: 1, read: true },
      { id: "two", title: "Two", at: 2, read: false },
    ])
    expect(markFloatingNotificationsRead(notifications).every((notification) => notification.read)).toBe(true)
  })

  test("clears read notifications and resolves matching question notifications", () => {
    const notifications = [
      { id: "one", title: "Question", sessionID: "session-1", requestID: "request-1", at: 1, read: false },
      { id: "two", title: "Question", sessionID: "session-1", requestID: "request-2", at: 2, read: false },
      { id: "three", title: "Info", at: 3, read: true },
    ]

    const resolved = resolveFloatingNotification(notifications, {
      sessionID: "session-1",
      requestID: "request-1",
      status: "replied",
    })

    expect(resolved).toEqual([
      {
        id: "one",
        title: "Question",
        sessionID: "session-1",
        requestID: "request-1",
        at: 1,
        read: true,
        status: "replied",
      },
      { id: "two", title: "Question", sessionID: "session-1", requestID: "request-2", at: 2, read: false },
      { id: "three", title: "Info", at: 3, read: true },
    ])
    expect(clearReadFloatingNotifications(resolved)).toEqual([
      { id: "two", title: "Question", sessionID: "session-1", requestID: "request-2", at: 2, read: false },
    ])
  })
})
