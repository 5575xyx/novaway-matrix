import { createMemo, For, Show, type Accessor, type JSX } from "solid-js"
import { base64Encode } from "@novaway/core/util/encode"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { IconButton } from "@novaway/ui/icon-button"
import { useLayout, type AppMode, type LocalProject } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"

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
  isBusy: (directory: string) => boolean
  createWorkspace: (project: LocalProject) => void
  openWorkspace: (directory: string) => void
  showRenameWorkspaceDialog: (directory: string, projectId?: string) => void
  showResetWorkspaceDialog: (root: string, directory: string) => void
  showDeleteWorkspaceDialog: (root: string, directory: string) => void
}

export function ProjectMenu(props: { project: LocalProject; ctx: ProjectSidebarContext }): JSX.Element {
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const language = useLanguage()
  const notification = useNotification()
  const project = props.project
  const ctx = props.ctx

  const dirs = () => ctx.workspaceIds(project)

  const unseenCount = createMemo(() =>
    dirs().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
  )

  const clear = () =>
    dirs()
      .filter((directory) => notification.project.unseenCount(directory) > 0)
      .forEach((directory) => notification.project.markViewed(directory))

  const isLocalWorkspace = (directory: string) => directory === project.worktree

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger
        as={IconButton}
        icon="dot-grid"
        variant="ghost"
        size="small"
        aria-label={language.t("sidebar.projectMenu")}
        class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      />
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <DropdownMenu.Item onSelect={() => ctx.showEditProjectDialog(project)}>
            <DropdownMenu.ItemLabel>{language.t("common.edit")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger>
              <span>{language.t("sidebar.project.moveToMode")}</span>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent>
                <For each={layout.mode.all}>
                  {(mode) => (
                    <DropdownMenu.Item onSelect={() => ctx.moveProjectToMode(project.worktree, mode.id)}>
                      <DropdownMenu.ItemLabel>
                        {mode.name}
                        <Show when={layout.mode.projectMode(project.worktree) === mode.id}>
                          · {language.t("sidebar.project.currentMode")}
                        </Show>
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  )}
                </For>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          <DropdownMenu.Item
            data-action="project-workspaces-toggle"
            data-project={base64Encode(project.worktree)}
            disabled={project.vcs !== "git" && !ctx.workspacesEnabled(project)}
            onSelect={() => ctx.toggleProjectWorkspaces(project)}
          >
            <DropdownMenu.ItemLabel>
              {ctx.workspacesEnabled(project)
                ? language.t("sidebar.workspaces.disable")
                : language.t("sidebar.workspaces.enable")}
            </DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <Show when={ctx.workspacesEnabled(project)}>
            <DropdownMenu.Item onSelect={() => ctx.createWorkspace(project)}>
              <DropdownMenu.ItemLabel>{language.t("workspace.new")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <For each={ctx.workspaceIds(project)}>
              {(directory) => {
                const [child] = globalSync.child(directory, { bootstrap: false })
                const local = () => isLocalWorkspace(directory)
                const busy = () => ctx.isBusy(directory)
                return (
                  <DropdownMenu.Sub>
                    <DropdownMenu.SubTrigger>
                      <span>
                        {local() ? language.t("workspace.type.local") : language.t("workspace.type.sandbox")} :
                        {ctx.workspaceLabel(directory, child.vcs?.branch, project.id)}
                      </span>
                    </DropdownMenu.SubTrigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.SubContent>
                        <DropdownMenu.Item onSelect={() => ctx.openWorkspace(directory)}>
                          <DropdownMenu.ItemLabel>{language.t("common.open")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onSelect={() => ctx.navigateToNewSession(directory)}>
                          <DropdownMenu.ItemLabel>{language.t("command.session.new")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          disabled={local()}
                          onSelect={() => ctx.showRenameWorkspaceDialog(directory, project.id)}
                        >
                          <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          disabled={local() || busy()}
                          onSelect={() => ctx.showResetWorkspaceDialog(project.worktree, directory)}
                        >
                          <DropdownMenu.ItemLabel>{language.t("common.reset")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          disabled={local() || busy()}
                          onSelect={() => ctx.showDeleteWorkspaceDialog(project.worktree, directory)}
                        >
                          <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                      </DropdownMenu.SubContent>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Sub>
                )
              }}
            </For>
          </Show>
          <DropdownMenu.Item
            data-action="project-clear-notifications"
            data-project={base64Encode(project.worktree)}
            disabled={unseenCount() === 0}
            onSelect={clear}
          >
            <DropdownMenu.ItemLabel>{language.t("sidebar.project.clearNotifications")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            data-action="project-close-menu"
            data-project={base64Encode(project.worktree)}
            onSelect={() => ctx.closeProject(project.worktree)}
          >
            <DropdownMenu.ItemLabel>{language.t("common.close")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
