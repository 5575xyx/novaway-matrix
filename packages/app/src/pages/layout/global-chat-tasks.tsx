import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { TaskRow } from "@/components/session/task-row"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { TaskBucketHeader } from "./sidebar-tasks"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import type { Session } from "@novaway/sdk/v2/client"
import { sortedRootSessionsFrom } from "./helpers"
import { displaySessionTitle } from "@/utils/session-title"

/** Workspace-free conversations use the normal task-row visual language, but
 * remain under their dedicated global-chat route instead of a project slug. */
export function GlobalChatTasks() {
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const language = useLanguage()
  const navigate = useNavigate()
  const params = useParams()
  const [store] = globalSync.child("global-chat", { bootstrap: false })

  onMount(() => void globalSync.bootstrapInstance("global-chat"))

  const sessions = createMemo(() =>
    sortedRootSessionsFrom([store], Date.now(), layout.pinned.sessions(), layout.taskList.sortBy()),
  )
  const [collapsed, setCollapsed] = createSignal(new Set<string>())
  const customGroups = createMemo(() => {
    if (layout.taskList.groupBy() !== "custom") return []
    const groups = layout.taskList.groups().map((group) => ({
      id: group.id,
      label: group.name,
      sessions: sessions().filter((session) => layout.taskList.groupOf(session.id) === group.id),
    }))
    const unassigned = sessions().filter((session) => !layout.taskList.groupOf(session.id))
    if (unassigned.length > 0 || groups.length === 0) {
      groups.push({
        id: "__unassigned__",
        label: language.t("sidebar.task.group.unassigned"),
        sessions: unassigned,
      })
    }
    return groups
  })

  const renderTask = (session: Session) => {
    const status = () => {
      const type = store.session_status[session.id]?.type ?? "idle"
      if (type === "busy") return "running"
      if (type === "retry") return "failed"
      return "idle"
    }
    return (
      <TaskRow
        title={() => displaySessionTitle(session.title, language.t("workspace.header.untitled"))}
        status={status}
        updated={() => session.time?.updated}
        selected={() => params.id === session.id}
        sessionID={session.id}
        directory={session.directory}
        pinned={layout.pinned.session(session.id)}
        onTogglePin={() => layout.pinned.toggleSession(session.id)}
        onRename={async (title) => {
          await globalSync.sdkForDirectory("global-chat").session.update({
            sessionID: session.id,
            title,
            directory: session.directory,
          })
        }}
        group={
          layout.taskList.groupBy() === "custom"
            ? {
                items: layout.taskList.groups(),
                current: layout.taskList.groupOf(session.id),
                onMove: (groupID) => layout.taskList.assignGroup(session.id, groupID),
              }
            : undefined
        }
        onClick={() => navigate(`/global-chat/session/${session.id}`)}
      />
    )
  }

  const [recentExpanded, setRecentExpanded] = createSignal(true)

  return (
    <section class="shrink-0" data-component="sidebar-recent-tasks" data-global-chat-section>
      <div class="group/recent flex h-8 items-center gap-1 rounded-md px-2">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          aria-expanded={recentExpanded()}
          aria-label={language.t("sidebar.globalChat.title")}
          onClick={() => setRecentExpanded((value) => !value)}
        >
          <Icon
            name={recentExpanded() ? "chevron-down" : "chevron-right"}
            size="small"
            class="shrink-0 text-foreground-subtlest"
          />
          <span class="min-w-0 truncate text-ui-caption font-medium text-foreground">
            {language.t("sidebar.globalChat.title")}
          </span>
        </button>
        <IconButton
          icon="plus-small"
          variant="ghost"
          size="small"
          class="shrink-0 opacity-0 group-hover/recent:opacity-100 focus-visible:opacity-100"
          aria-label={language.t("sidebar.newTask")}
          title={language.t("sidebar.newTask")}
          onClick={() => navigate("/global-chat/session")}
        />
      </div>
      <Show when={recentExpanded()}>
        <div class="relative flex flex-col gap-0.5 pl-3 pt-0.5" data-component="global-chat-task-list">
          <Show when={layout.taskList.groupBy() === "custom"} fallback={<For each={sessions()}>{renderTask}</For>}>
            <For each={customGroups()}>
              {(group) => {
                const isExpanded = () => !collapsed().has(group.id)
                return (
                  <div data-component="global-chat-task-group" data-group-id={group.id}>
                    <TaskBucketHeader
                      label={group.label}
                      count={() => group.sessions.length}
                      expanded={isExpanded}
                      onToggle={() =>
                        setCollapsed((current) => {
                          const next = new Set(current)
                          if (next.has(group.id)) next.delete(group.id)
                          else next.add(group.id)
                          return next
                        })
                      }
                    />
                    <Show when={isExpanded()}>
                      <div class="relative flex flex-col gap-0.5 pl-3">
                        <For each={group.sessions}>{renderTask}</For>
                      </div>
                    </Show>
                  </div>
                )
              }}
            </For>
          </Show>
        </div>
      </Show>
    </section>
  )
}
