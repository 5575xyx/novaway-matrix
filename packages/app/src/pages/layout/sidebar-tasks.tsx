import { type Session } from "@novaway/sdk/v2/client"
import { Icon } from "@novaway/ui/icon"
import { getFilename } from "@novaway/core/util/path"
import { createMemo, createSignal, For, Show, type Accessor } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { type LocalProject } from "@/context/layout"
import { usePermission } from "@/context/permission"
import { sessionPermissionRequest } from "../session/composer/session-request-tree"
import { sortedRootSessions } from "./helpers"
import { SessionItem } from "./sidebar-items"

export type TaskFilter = "all" | "running" | "waiting" | "archived"

export function ProjectTaskList(props: {
  project: LocalProject
  slug: string
  sidebarExpanded: () => boolean
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  archiveSession: (session: Session) => Promise<void>
  filter: () => TaskFilter
  archived: () => Session[] | undefined
  sortNow: Accessor<number>
}) {
  const globalSync = useGlobalSync()
  const permission = usePermission()
  const [sessionStore] = globalSync.child(props.project.worktree)

  const statusOf = (session: Session): "running" | "waiting" | "idle" => {
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

  const sessions = createMemo(() => {
    const filter = props.filter()
    if (filter === "archived") return (props.archived() ?? []).filter((s) => !!s.time?.archived)
    const roots = sortedRootSessions(sessionStore, props.sortNow())
    if (filter === "all") return roots
    return roots.filter((session) => statusOf(session) === filter)
  })

  return (
    <Show when={sessions().length > 0}>
      <div class="px-2 pt-2">
        <div class="flex items-center gap-1.5 px-1.5 pb-1 text-ui-xs text-text-weak">
          <Icon name="folder" size="small" class="shrink-0" />
          <span class="truncate flex-1">{getFilename(props.project.worktree)}</span>
          <span class="tabular-nums">{sessions().length}</span>
        </div>
        <For each={sessions()}>
          {(session) => (
            <SessionItem
              session={session}
              list={sessions()}
              slug={props.slug}
              sidebarExpanded={props.sidebarExpanded}
              clearHoverProjectSoon={() => {}}
              prefetchSession={props.prefetchSession}
              archiveSession={props.archiveSession}
            />
          )}
        </For>
      </div>
    </Show>
  )
}

export function TaskFilterBar(props: { filter: TaskFilter; onChange: (filter: TaskFilter) => void }) {
  const language = useLanguage()
  const labels: Record<TaskFilter, string> = {
    all: "sidebar.filter.all",
    running: "sidebar.filter.running",
    waiting: "sidebar.filter.waiting",
    archived: "sidebar.filter.archived",
  }
  const order: TaskFilter[] = ["all", "running", "waiting", "archived"]

  return (
    <div class="flex items-center gap-1 px-2 pb-1">
      <For each={order}>
        {(id) => (
          <button
            classList={{
              "px-2 py-0.5 text-ui-xs rounded-md border transition-colors": true,
              "bg-surface-raised-base text-text-strong border-border-weak-base": props.filter === id,
              "text-text-weak hover:text-text-base border-transparent": props.filter !== id,
            }}
            onClick={() => props.onChange(id)}
          >
            {language.t(labels[id])}
          </button>
        )}
      </For>
    </div>
  )
}

export function useArchivedSessions(projects: () => LocalProject[]) {
  const globalSDK = useGlobalSDK()
  const [archived, setArchived] = createSignal<Record<string, Session[]>>({})

  const load = () => {
    void Promise.all(
      projects().map(async (project) => {
        const sessions = await globalSDK.client.experimental.session
          .list({ directory: project.worktree, archived: true, roots: true })
          .then((result) => result.data ?? [])
          .catch(() => [] as Session[])
        return [project.worktree, sessions] as const
      }),
    ).then((entries) => setArchived(Object.fromEntries(entries)))
  }

  return { archived, load }
}
