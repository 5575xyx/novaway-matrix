import { For, Show, createMemo, createSignal } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout, appModeConfig, type LocalProject } from "@/context/layout"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { useCommand } from "@/context/command"
import { sortedRootSessionsFrom, sessionStatusOf, displayName } from "./layout/helpers"
import { TaskFilterBar, useArchivedSessions, type TaskFilterBarId } from "./layout/sidebar-tasks"
import { TaskRow } from "@/components/session/task-row"
import { formatRelativeTime } from "@/utils/relative-time"
import { displaySessionTitle } from "@/utils/session-title"
import { base64Encode } from "@novaway/core/util/encode"
import type { Session } from "@novaway/sdk/v2/client"

export default function TaskCenterPage() {
  const language = useLanguage()
  const navigate = useNavigate()
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const permission = usePermission()
  const notification = useNotification()
  const command = useCommand()
  const [activeTab, setActiveTab] = createSignal<TaskFilterBarId>("all")
  const { archived, load: loadArchived } = useArchivedSessions(() => layout.projects.list())

  const tabs = [
    { id: "all", labelKey: "taskCenter.recent" },
    { id: "running", labelKey: "taskCenter.running" },
    { id: "waiting", labelKey: "taskCenter.waiting" },
    { id: "archived", labelKey: "taskCenter.archived" },
    { id: "projects", labelKey: "taskCenter.projects" },
  ] as const

  const rows = createMemo(() => {
    const tab = activeTab()
    if (tab === "projects") return [] as Array<{ project: LocalProject; session: Session }>
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
        tab === "archived"
          ? (archived()[project.worktree] ?? []).filter((s) => !!s.time?.archived)
          : (() => {
              const roots = sortedRootSessionsFrom(projectStores, now)
              if (tab === "all") return roots
              return roots.filter((s) => sessionStatusOf(globalSync, permission, notification, s) === tab)
            })()
      for (const session of sessions) list.push({ project, session })
    }
    return list.sort((a, b) => (b.session.time?.updated ?? 0) - (a.session.time?.updated ?? 0)).slice(0, 40)
  })

  const projectCards = createMemo(() => {
    return layout.projects.list().map((project) => {
      const [store] = globalSync.child(project.worktree, { bootstrap: false })
      const sessions = store.session ?? []
      const rootSessions = sessions.filter((s) => s.directory === project.worktree && !s.parentID && !s.time?.archived)
      const sorted = rootSessions.slice().sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
      return {
        project,
        count: rootSessions.length,
        branch: store.vcs?.branch,
        latestAt: sorted[0]?.time?.updated,
      }
    })
  })

  const firstProject = createMemo(() => layout.projects.list()[0]?.worktree)

  const openSession = (session: Session) => {
    navigate(`/${base64Encode(session.directory)}/session/${session.id}`)
  }

  const openNewTask = () => {
    if (firstProject()) navigate(`/${base64Encode(firstProject())}/session`)
    else layout.projectPicker.show()
  }

  const handleTabChange = (id: TaskFilterBarId) => {
    setActiveTab(id)
    if (id === "archived") loadArchived()
  }

  return (
    <div class="size-full overflow-y-auto no-scrollbar">
      <div class="max-w-[860px] px-10 py-7 flex flex-col gap-4">
        <div class="flex items-center gap-3">
          <h1 class="text-ui-xl font-semibold text-foreground">{language.t("taskCenter.title")}</h1>
          <button
            type="button"
            aria-label={language.t("taskCenter.search")}
            class="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 min-w-[220px] text-left text-ui-caption text-foreground-subtle hover:text-foreground hover:border-primary transition-colors"
            onClick={() => command.trigger("file.open")}
          >
            <Icon name="magnifying-glass" size="small" class="shrink-0" />
            <span class="truncate">{language.t("taskCenter.search")}</span>
          </button>
          <div class="flex-1" />
          <Button variant="primary" size="normal" onClick={openNewTask}>
            {language.t("taskCenter.newTask")}
          </Button>
          <Button variant="secondary" size="normal" onClick={() => layout.projectPicker.show()}>
            {language.t("taskCenter.openProject")}
          </Button>
        </div>
        <TaskFilterBar filter={activeTab()} variant="underline" tabs={[...tabs]} onChange={handleTabChange} />
        <Show when={activeTab() === "projects"}>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            <For each={projectCards()}>
              {(card) => (
                <button
                  type="button"
                  class="rounded-lg border border-border bg-panel p-3 text-left hover:border-primary transition-colors flex flex-col gap-1"
                  onClick={() => navigate(`/${base64Encode(card.project.worktree)}/session`)}
                >
                  <div class="flex items-center gap-1.5 min-w-0">
                    <Icon name="folder" size="small" class="shrink-0 text-foreground-subtlest" />
                    <span class="text-ui-caption text-foreground truncate">{displayName(card.project)}</span>
                  </div>
                  <div class="flex items-center gap-2 text-ui-xs text-foreground-subtle">
                    <span>{language.t("sidebar.project.count", { count: card.count })}</span>
                    <Show when={card.branch}>
                      <span class="flex items-center gap-1 truncate max-w-[120px]">
                        <Icon name="branch" size="small" />
                        <span class="truncate">{card.branch}</span>
                      </span>
                    </Show>
                  </div>
                  <Show when={card.latestAt}>
                    <div class="text-ui-xs text-foreground-subtle">
                      {formatRelativeTime(card.latestAt, Date.now(), language.t)}
                    </div>
                  </Show>
                </button>
              )}
            </For>
            <button
              type="button"
              class="rounded-lg border border-dashed border-border-hover px-4 py-3 text-ui-caption text-foreground-subtle hover:text-foreground hover:border-primary cursor-pointer flex items-center gap-2 justify-center transition-colors"
              onClick={() => command.trigger("project.open")}
            >
              <Icon name="folder" size="small" class="shrink-0" />
              <span>{language.t("taskCenter.fromProject")}</span>
            </button>
          </div>
        </Show>
        <Show when={activeTab() !== "projects"}>
          <Show when={rows().length > 0}>
            <div class="flex flex-col gap-2.5">
              <For each={rows()}>
                {(row) => {
                  const child = globalSync.child(row.session.directory, { bootstrap: false })[0]
                  const status = () => sessionStatusOf(globalSync, permission, notification, row.session)
                  return (
                    <div class="rounded-lg border border-border bg-panel p-2">
                      <TaskRow
                        title={() => displaySessionTitle(row.session.title, language.t("workspace.header.untitled"))}
                        status={status}
                        branch={() => child.vcs?.branch}
                        updated={() => row.session.time?.updated}
                        additions={() => row.session.summary?.additions ?? 0}
                        deletions={() => row.session.summary?.deletions ?? 0}
                        waitingBadge={() => status() === "waiting"}
                        modeColor={() => appModeConfig(layout.mode.projectMode(row.session.directory))?.color}
                        onClick={() => openSession(row.session)}
                      />
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>
          <Show when={rows().length === 0}>
            <div class="py-12 text-center text-ui-caption text-foreground-subtle">{language.t("taskCenter.empty")}</div>
          </Show>
          <button
            type="button"
            class="rounded-lg border border-dashed border-border-hover px-4 py-3 text-ui-caption text-foreground-subtle hover:text-foreground hover:border-primary cursor-pointer flex items-center gap-2 transition-colors"
            onClick={() => layout.projectPicker.show()}
          >
            <Icon name="plus" size="small" class="shrink-0" />
            <span>{language.t("taskCenter.fromProject")}</span>
          </button>
        </Show>
      </div>
    </div>
  )
}
