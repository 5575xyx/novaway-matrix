import { createMemo, createSignal, For, Show, type Accessor, type JSX } from "solid-js"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { getFilename } from "@opencode-ai/core/util/path"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { createSortable } from "@thisbeyond/solid-dnd"
import { useLayout, type AppMode, type LocalProject } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import { ProjectIcon } from "./sidebar-items"

export type ProjectSidebarContext = {
  currentDir: Accessor<string>
  currentProject: Accessor<LocalProject | undefined>
  sidebarOpened: Accessor<boolean>
  navigateToProject: (directory: string) => void
  navigateToNewSession: (directory: string) => void
  closeProject: (directory: string) => void
  moveProjectToMode: (directory: string, mode: AppMode) => void
  showEditProjectDialog: (project: LocalProject) => void
  toggleProjectWorkspaces: (project: LocalProject) => void
  workspacesEnabled: (project: LocalProject) => boolean
  workspaceIds: (project: LocalProject) => string[]
  workspaceLabel: (directory: string, branch?: string, projectId?: string) => string
  workspaceExpanded: (directory: string, local: boolean) => boolean
  setWorkspaceExpanded: (directory: string, value: boolean) => void
}

export const ProjectDragOverlay = (props: {
  projects: Accessor<LocalProject[]>
  activeProject: Accessor<string | undefined>
}): JSX.Element => {
  const project = createMemo(() => props.projects().find((p) => p.worktree === props.activeProject()))
  return (
    <Show when={project()}>
      {(p) => (
        <div class="bg-background-base rounded-xl p-1">
          <ProjectIcon project={p()} />
        </div>
      )}
    </Show>
  )
}

const ProjectCard = (props: {
  project: LocalProject
  mobile?: boolean
  selected: Accessor<boolean>
  isWorking: Accessor<boolean>
  expanded: Accessor<boolean>
  onToggleExpand: () => void
  onCreateTask: () => void
  navigateToProject: (directory: string) => void
  showEditProjectDialog: (project: LocalProject) => void
  closeProject: (directory: string) => void
  moveProjectToMode: (directory: string, mode: AppMode) => void
  workspacesEnabled: (project: LocalProject) => boolean
  toggleProjectWorkspaces: (project: LocalProject) => void
  language: ReturnType<typeof useLanguage>
  index?: number
  sessionCount?: number
  anyWorking?: boolean
}): JSX.Element => {
  const name = createMemo(() => props.project.name || getFilename(props.project.worktree))
  const path = createMemo(() => props.project.worktree)

  return (
    <div
      classList={{
        "flex flex-col p-2 rounded-lg border-solid cursor-pointer transition-colors bg-transparent hover:bg-surface-raised-base-hover": true,
        "border-2 border-border-interactive-base": props.selected(),
        "border border-border-weak-base": !props.selected(),
      }}
      onClick={() => props.navigateToProject(props.project.worktree)}
    >
      <div class="flex items-center gap-2">
        <Show when={props.index !== undefined}>
          <span class="shrink-0 text-12-regular text-text-weak w-4 text-right">{(props.index ?? 0) + 1}.</span>
        </Show>
        <div class="shrink-0 size-6 flex items-center justify-center relative">
          <Icon name="folder" size="small" class="text-icon-base" />
          <Show when={props.anyWorking}>
            <div class="absolute -top-0.5 -right-0.5 size-2 flex items-center justify-center">
              <div class="absolute inset-0 rounded-full border-[1px] border-text-interactive-base animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite] opacity-75" />
              <div class="size-1 rounded-full bg-text-interactive-base" />
            </div>
          </Show>
        </div>
        <span class="text-14-medium text-text-strong min-w-0 flex-1 truncate">{name()}</span>
        <button
          type="button"
          class="shrink-0 size-6 flex items-center justify-center rounded-md hover:bg-surface-base-active transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            props.onCreateTask()
          }}
          aria-label="新建任务"
        >
          <Icon name="plus" size="small" class="text-icon-base" />
        </button>
        <button
          type="button"
          class="shrink-0 size-6 flex items-center justify-center rounded-md hover:bg-surface-base-active transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            props.onToggleExpand()
          }}
          aria-label={props.expanded() ? "折叠" : "展开"}
        >
          <Icon name={props.expanded() ? "chevron-down" : "chevron-right"} size="small" class="text-icon-base" />
        </button>
      </div>
      <span class="text-12-regular text-text-weak pl-8 truncate">{path()}</span>
      <Show when={props.sessionCount !== undefined && (props.sessionCount ?? 0) > 0}>
        <span class="text-11-regular text-text-weak pl-8">任务数：{props.sessionCount}</span>
      </Show>
    </div>
  )
}

export const SortableProject = (props: {
  project: LocalProject
  mobile?: boolean
  ctx: ProjectSidebarContext
  sortNow: Accessor<number>
  index?: number
  expanded: Accessor<boolean>
  onToggleExpand: () => void
}): JSX.Element => {
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const layout = useLayout()
  const notification = useNotification()
  const sortable = createSortable(props.project.worktree)
  const selected = createMemo(() => props.ctx.currentProject()?.worktree === props.project.worktree)
  const dirs = createMemo(() => props.ctx.workspaceIds(props.project))
  const [menuOpen, setMenuOpen] = createSignal(false)

  const sessionCount = createMemo(() =>
    dirs().reduce((total, directory) => {
      const [store] = globalSync.child(directory, { bootstrap: false })
      return total + (store.session?.length ?? 0)
    }, 0),
  )

  const isWorking = createMemo(() =>
    dirs().some((directory) => {
      const [store] = globalSync.child(directory, { bootstrap: false })
      return Object.keys(store.session_status).some((id) => store.session_working(id))
    }),
  )

  const unseenCount = createMemo(() =>
    dirs().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
  )

  const clear = () =>
    dirs()
      .filter((directory) => notification.project.unseenCount(directory) > 0)
      .forEach((directory) => notification.project.markViewed(directory))

  return (
    // @ts-ignore
    <div use:sortable classList={{ "opacity-30": sortable.isActiveDraggable }}>
      <ContextMenu
        modal
        onOpenChange={setMenuOpen}
      >
        <ContextMenu.Trigger
          as="div"
          aria-label={props.project.name || getFilename(props.project.worktree)}
          data-action="project-switch"
          data-project={base64Encode(props.project.worktree)}
        >
          <ProjectCard
            project={props.project}
            mobile={props.mobile}
            selected={selected}
            isWorking={isWorking}
            expanded={props.expanded}
            onToggleExpand={props.onToggleExpand}
            onCreateTask={() => props.ctx.navigateToNewSession(props.project.worktree)}
            navigateToProject={props.ctx.navigateToProject}
            showEditProjectDialog={props.ctx.showEditProjectDialog}
            closeProject={props.ctx.closeProject}
            moveProjectToMode={props.ctx.moveProjectToMode}
            workspacesEnabled={props.ctx.workspacesEnabled}
            toggleProjectWorkspaces={props.ctx.toggleProjectWorkspaces}
            language={language}
            index={props.index}
            sessionCount={sessionCount()}
            anyWorking={isWorking()}
          />
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content>
            <ContextMenu.Item onSelect={() => props.ctx.showEditProjectDialog(props.project)}>
              <ContextMenu.ItemLabel>{language.t("common.edit")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger>
                <span>移动到模式</span>
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent>
                  <For each={layout.mode.all}>
                    {(mode) => (
                      <ContextMenu.Item onSelect={() => props.ctx.moveProjectToMode(props.project.worktree, mode.id)}>
                        <ContextMenu.ItemLabel>
                          {mode.name}
                          <Show when={layout.mode.projectMode(props.project.worktree) === mode.id}> · 当前</Show>
                        </ContextMenu.ItemLabel>
                      </ContextMenu.Item>
                    )}
                  </For>
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
            <ContextMenu.Item
              data-action="project-workspaces-toggle"
              data-project={base64Encode(props.project.worktree)}
              disabled={props.project.vcs !== "git" && !props.ctx.workspacesEnabled(props.project)}
              onSelect={() => props.ctx.toggleProjectWorkspaces(props.project)}
            >
              <ContextMenu.ItemLabel>
                {props.ctx.workspacesEnabled(props.project)
                  ? language.t("sidebar.workspaces.disable")
                  : language.t("sidebar.workspaces.enable")}
              </ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Item
              data-action="project-clear-notifications"
              data-project={base64Encode(props.project.worktree)}
              disabled={unseenCount() === 0}
              onSelect={clear}
            >
              <ContextMenu.ItemLabel>{language.t("sidebar.project.clearNotifications")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item
              data-action="project-close-menu"
              data-project={base64Encode(props.project.worktree)}
              onSelect={() => props.ctx.closeProject(props.project.worktree)}
            >
              <ContextMenu.ItemLabel>{language.t("common.close")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>
    </div>
  )
}
