import { For, Show, createMemo, createSignal } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Button } from "@novaway/ui/button"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout, type LocalProject } from "@/context/layout"
import { usePermission } from "@/context/permission"
import { sortedRootSessionsFrom } from "./layout/helpers"
import { sessionPermissionRequest } from "./session/composer/session-request-tree"
import { TaskFilterBar, useArchivedSessions, type TaskFilter } from "./layout/sidebar-tasks"
import { base64Encode } from "@novaway/core/util/encode"
import type { Session } from "@novaway/sdk/v2/client"

export default function TaskCenterPage() {
  const language = useLanguage()
  const navigate = useNavigate()
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const permission = usePermission()
  const [filter, setFilter] = createSignal<TaskFilter>("all")
  const { archived, load: loadArchived } = useArchivedSessions(() => layout.projects.list())

  const statusOf = (session: Session): "running" | "waiting" | "idle" => {
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

  const rows = createMemo(() => {
    const list: Array<{ project: LocalProject; session: Session }> = []
    const now = Date.now()
    for (const project of layout.projects.list()) {
      const projectDirs: string[] = []
      const seen = new Set<string>()
      for (const dir of [project.worktree, ...(project.sandboxes ?? [])]) {
        if (seen.has(dir)) continue
        seen.add(dir)
        projectDirs.push(dir)
      }
      const projectStores = projectDirs.map((dir) => globalSync.child(dir)[0])
      const sessions =
        filter() === "archived"
          ? (archived()[project.worktree] ?? []).filter((s) => !!s.time?.archived)
          : (() => {
              const roots = sortedRootSessionsFrom(projectStores, now)
              const f = filter()
              if (f === "all") return roots
              return roots.filter((s) => statusOf(s) === f)
            })()
      for (const session of sessions) list.push({ project, session })
    }
    return list.sort((a, b) => (b.session.time?.updated ?? 0) - (a.session.time?.updated ?? 0)).slice(0, 40)
  })

  const firstProject = createMemo(() => layout.projects.list()[0]?.worktree)

  const openSession = (session: Session) => {
    navigate(`/${base64Encode(session.directory)}/session/${session.id}`)
  }

  return (
    <div class="size-full overflow-y-auto no-scrollbar">
      <div class="mx-auto max-w-3xl px-6 py-10 flex flex-col gap-6">
        <div class="flex flex-col gap-1">
          <h1 class="text-ui-xl font-semibold text-text-strong">{language.t("taskCenter.title")}</h1>
          <p class="text-ui-caption text-text-weak">{language.t("taskCenter.subtitle")}</p>
        </div>
        <div class="flex items-center gap-2">
          <Button
            variant="primary"
            size="normal"
            onClick={() => {
              if (firstProject()) navigate(`/${base64Encode(firstProject())}/session`)
              else layout.projectPicker.show()
            }}
          >
            {language.t("taskCenter.newTask")}
          </Button>
          <Button variant="secondary" size="normal" onClick={() => layout.projectPicker.show()}>
            {language.t("taskCenter.openProject")}
          </Button>
        </div>
        <TaskFilterBar filter={filter()} onChange={(f) => {
          setFilter(f)
          if (f === "archived") loadArchived()
        }} />
        <Show
          when={rows().length > 0}
          fallback={<div class="py-12 text-center text-ui-caption text-text-weak">{language.t("taskCenter.empty")}</div>}
        >
          <div class="flex flex-col rounded-lg border border-border-weak-base overflow-hidden">
            <For each={rows()}>
              {(row, i) => (
                <button
                  classList={{
                    "flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-base-hover": true,
                    "border-t border-border-weak-base": i() > 0,
                  }}
                  onClick={() => openSession(row.session)}
                >
                  <span
                    classList={{
                      "size-2 rounded-full shrink-0": true,
                      "bg-text-interactive-base": statusOf(row.session) === "running",
                      "bg-surface-warning-strong": statusOf(row.session) === "waiting",
                      "bg-border-strong-base": statusOf(row.session) === "idle",
                    }}
                  />
                  <span class="text-ui-caption text-text-strong truncate flex-1">{row.session.title}</span>
                  <span class="text-ui-xs text-text-weak truncate max-w-[160px] hidden md:block">
                    {row.project.worktree.split(/[\\/]/).filter(Boolean).pop()}
                  </span>
                  <Show when={row.session.summary && (row.session.summary.additions > 0 || row.session.summary.deletions > 0)}>
                    <span class="text-ui-xs tabular-nums shrink-0">
                      <span class="text-[var(--icon-diff-add-base)]">+{row.session.summary?.additions ?? 0}</span>
                      <span class="text-[var(--icon-diff-delete-base)]">-{row.session.summary?.deletions ?? 0}</span>
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}
