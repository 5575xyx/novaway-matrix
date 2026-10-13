import { type Session } from "@novaway/sdk/v2/client"
import { createMemo, createSignal, For, Show, type Accessor } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { useLayout, type LocalProject, appModeConfig } from "@/context/layout"
import { usePermission } from "@/context/permission"
import { useNotification } from "@/context/notification"
import { base64Encode } from "@novaway/core/util/encode"
import { displaySessionTitle } from "@/utils/session-title"
import { pathKey } from "@/utils/path-key"
import { decode64 } from "@/utils/base64"
import { sessionStatusOf, sortedRootSessionsFrom } from "./helpers"
import { TaskRow } from "@/components/session/task-row"

export type TaskFilter = "all" | "running" | "waiting" | "archived"

export type TaskFilterBarId = TaskFilter | "projects"

export function useProjectSessions(project: LocalProject) {
  const globalSync = useGlobalSync()

  const dirs = createMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const dir of [project.worktree, ...(project.sandboxes ?? [])]) {
      const key = pathKey(dir)
      if (seen.has(key)) continue
      seen.add(key)
      result.push(dir)
    }
    return result
  })
  const stores = createMemo(() => dirs().map((dir) => globalSync.child(dir)[0]))
  const sessions = createMemo(() => sortedRootSessionsFrom(stores(), 0))

  return { dirs, stores, sessions }
}

export function useProjectTaskList(props: {
  project: LocalProject
  filter: () => TaskFilter
  archived: () => Session[] | undefined
  sortNow: Accessor<number>
}) {
  const globalSync = useGlobalSync()
  const permission = usePermission()
  const notification = useNotification()
  const { stores } = useProjectSessions(props.project)

  return createMemo(() => {
    const filter = props.filter()
    if (filter === "archived") return (props.archived() ?? []).filter((s) => !!s.time?.archived)
    const roots = sortedRootSessionsFrom(stores(), props.sortNow())
    if (filter === "all") return roots
    return roots.filter((session) => sessionStatusOf(globalSync, permission, notification, session) === filter)
  })
}

export function ProjectTaskList(props: {
  project: LocalProject
  sidebarExpanded: () => boolean
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  archiveSession: (session: Session) => Promise<void>
  filter: () => TaskFilter
  archived: () => Session[] | undefined
  sortNow: Accessor<number>
}) {
  const globalSync = useGlobalSync()
  const permission = usePermission()
  const notification = useNotification()
  const language = useLanguage()
  const layout = useLayout()
  const params = useParams()
  const navigate = useNavigate()

  const sessions = useProjectTaskList(props)

  return (
    <>
      <Show when={props.filter() !== "all" && sessions().length === 0}>
        <div class="px-2 py-1.5 text-ui-caption text-text-weak">{language.t("sidebar.filter.empty")}</div>
      </Show>
      <Show when={sessions().length > 0}>
        <For each={sessions()}>
          {(session) => {
            const status = () => sessionStatusOf(globalSync, permission, notification, session)
            const [child] = globalSync.child(session.directory, { bootstrap: false })
            return (
              <TaskRow
                title={() => displaySessionTitle(session.title, language.t("workspace.header.untitled"))}
                status={status}
                branch={() => child.vcs?.branch}
                updated={() => session.time?.updated}
                additions={() => session.summary?.additions ?? 0}
                deletions={() => session.summary?.deletions ?? 0}
                waitingBadge={() => status() === "waiting"}
                selected={() => {
                  if (!params.id || params.id !== session.id) return false
                  const directory = decode64(params.dir)
                  if (!directory) return false
                  return pathKey(directory) === pathKey(session.directory)
                }}
                modeColor={() => appModeConfig(layout.mode.projectMode(session.directory))?.color}
                onClick={() => navigate(`/${base64Encode(session.directory)}/session/${session.id}`)}
              />
            )
          }}
        </For>
      </Show>
    </>
  )
}

export function TaskFilterBar(props: {
  filter: TaskFilterBarId
  onChange: (id: TaskFilterBarId) => void
  variant?: "text" | "underline"
  tabs?: Array<{ id: TaskFilterBarId; labelKey: string }>
}) {
  const language = useLanguage()
  const variant = props.variant ?? "text"
  const defaults: Array<{ id: TaskFilter; labelKey: string }> = [
    { id: "all", labelKey: "sidebar.filter.all" },
    { id: "running", labelKey: "sidebar.filter.running" },
    { id: "waiting", labelKey: "sidebar.filter.waiting" },
    { id: "archived", labelKey: "sidebar.filter.archived" },
  ]
  const tabs = props.tabs ?? defaults

  return (
    <div
      role="tablist"
      classList={{
        "flex items-center px-3 gap-3 pb-1 text-ui-sm": variant === "text",
        "flex items-center px-3 gap-4 border-b border-border-weak-base text-ui-caption": variant === "underline",
      }}
    >
      <For each={tabs}>
        {(tab) => (
          <button
            role="tab"
            aria-selected={props.filter === tab.id}
            classList={{
              "transition-colors": true,
              "border-b-2 -mb-px pb-1.5": variant === "underline",
              "border-text-interactive-base text-text-strong font-medium":
                variant === "underline" && props.filter === tab.id,
              "border-transparent text-text-weak hover:text-text-base":
                variant === "underline" && props.filter !== tab.id,
              "text-text-strong font-medium": variant === "text" && props.filter === tab.id,
              "text-text-weak hover:text-text-base": variant === "text" && props.filter !== tab.id,
            }}
            onClick={() => props.onChange(tab.id)}
          >
            {language.t(tab.labelKey)}
          </button>
        )}
      </For>
    </div>
  )
}

export function useArchivedSessions(projects: () => LocalProject[]) {
  const globalSDK = useGlobalSDK()
  const [archived, setArchived] = createSignal<Record<string, Session[]>>({})
  let version = 0

  const load = () => {
    version += 1
    const current = version
    void Promise.all(
      projects().flatMap((project) =>
        [project.worktree, ...(project.sandboxes ?? [])].map(async (directory) => {
          const sessions = await globalSDK.client.experimental.session
            .list({ directory, archived: true, roots: true, limit: 500 })
            .then((result) => result.data ?? [])
            .catch(() => [] as Session[])
          return [directory, sessions] as const
        }),
      ),
    ).then((entries) => {
      if (current !== version) return
      setArchived(Object.fromEntries(entries))
    })
  }

  return { archived, load }
}
