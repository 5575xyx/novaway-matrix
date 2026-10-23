import { getFilename } from "@novaway/core/util/path"
import { type Session } from "@novaway/sdk/v2/client"
import type { TaskStatus } from "@/components/session/task-row"
import { sessionPermissionRequest } from "../session/composer/session-request-tree"
import { pathKey } from "@/utils/path-key"
import type { useGlobalSync } from "@/context/global-sync"
import type { usePermission } from "@/context/permission"
import type { useNotification } from "@/context/notification"

type SessionStore = {
  session?: Session[]
  path: { directory: string }
}

export const sessionStatusOf = (
  globalSync: ReturnType<typeof useGlobalSync>,
  permission: ReturnType<typeof usePermission>,
  notification: ReturnType<typeof useNotification>,
  session: Session,
): TaskStatus => {
  if (notification.session.unseenHasError(session.id)) return "failed"
  const [sessionStore] = globalSync.child(session.directory)
  const waiting = !!sessionPermissionRequest(
    sessionStore.session,
    sessionStore.permission,
    session.id,
    (item) => !permission.autoResponds(item, session.directory),
  )
  if (waiting) return "waiting"
  if (sessionStore.session_working(session.id)) return "running"
  return "idle"
}

function sortSessions(now: number) {
  const oneMinuteAgo = now - 60 * 1000
  return (a: Session, b: Session) => {
    const aUpdated = a.time.updated ?? a.time.created
    const bUpdated = b.time.updated ?? b.time.created
    const aRecent = aUpdated > oneMinuteAgo
    const bRecent = bUpdated > oneMinuteAgo
    if (aRecent && bRecent) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    if (aRecent && !bRecent) return -1
    if (!aRecent && bRecent) return 1
    return bUpdated - aUpdated
  }
}

const isRootVisibleSession = (session: Session, directory: string) =>
  pathKey(session.directory) === pathKey(directory) && !session.parentID && !session.time?.archived

export const roots = (store: SessionStore) =>
  (store.session ?? []).filter((session) => isRootVisibleSession(session, store.path.directory))

export const sortedRootSessions = (store: SessionStore, now: number) => roots(store).sort(sortSessions(now))

/**
 * 合并多个 store 的根会话并排序。
 *
 * `pins`（sessionID → 置顶时间）里的会话排在最前、同级按置顶时间倒序；
 * 其余沿用原本的"最近活动优先"。置顶项不参与 `sortSessions` ——
 * 否则一个刚被 AI 更新过的置顶会话会被"最近活动"重新洗牌，置顶就失去意义。
 */
export const sortedRootSessionsFrom = (stores: SessionStore[], now: number, pins?: Record<string, number>) => {
  const seen = new Set<string>()
  const merged: Session[] = []
  for (const session of stores.flatMap(roots)) {
    if (seen.has(session.id)) continue
    seen.add(session.id)
    merged.push(session)
  }
  const pinned = pins ?? {}
  return merged.sort((a, b) => {
    const pa = pinned[a.id]
    const pb = pinned[b.id]
    if (pa !== undefined && pb !== undefined) return pb - pa
    if (pa !== undefined) return -1
    if (pb !== undefined) return 1
    return sortSessions(now)(a, b)
  })
}

export const latestRootSession = (stores: SessionStore[], now: number) =>
  stores.flatMap(roots).sort(sortSessions(now))[0]

export function hasProjectPermissions<T>(
  request: Record<string, T[] | undefined> | undefined,
  include: (item: T) => boolean = () => true,
) {
  return Object.values(request ?? {}).some((list) => list?.some(include))
}

export const childSessionOnPath = (sessions: Session[] | undefined, rootID: string, activeID?: string) => {
  if (!activeID || activeID === rootID) return
  const map = new Map((sessions ?? []).map((session) => [session.id, session]))
  let id = activeID

  while (id) {
    const session = map.get(id)
    if (!session?.parentID) return
    if (session.parentID === rootID) return session
    id = session.parentID
  }
}

export const displayName = (project: { name?: string; worktree: string }) =>
  project.name || getFilename(project.worktree)

export const errorMessage = (err: unknown, fallback: string) => {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  if (err instanceof Error) return err.message
  return fallback
}

export const effectiveWorkspaceOrder = (local: string, dirs: string[], persisted?: string[]) => {
  const root = pathKey(local)
  const live = new Map<string, string>()

  for (const dir of dirs) {
    const key = pathKey(dir)
    if (key === root) continue
    if (!live.has(key)) live.set(key, dir)
  }

  if (!persisted?.length) return [local, ...live.values()]

  const result = [local]
  for (const dir of persisted) {
    const key = pathKey(dir)
    if (key === root) continue
    const match = live.get(key)
    if (!match) continue
    result.push(match)
    live.delete(key)
  }

  return [...result, ...live.values()]
}

/**
 * 侧栏点击会话时通知整帧覆盖页面（数据库 / 设置 / 自动化…）关闭。
 *
 * 只靠路由变化不够：点当前正在看的会话时 pathname 不变，
 * 覆盖层就会一直压在会话上面。
 */
export const CLOSE_FRAME_PAGES_EVENT = "novaway:close-frame-pages"

export const requestCloseFramePages = () => {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(CLOSE_FRAME_PAGES_EVENT))
}
