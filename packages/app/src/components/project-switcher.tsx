import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Component } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { getFilename } from "@opencode-ai/core/util/path"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { Icon } from "@opencode-ai/ui/icon"
import { Popover } from "@opencode-ai/ui/popover"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout, type LocalProject } from "@/context/layout"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogCreateProject } from "@/components/dialog-create-project"
import { decode64 } from "@/utils/base64"

const SWITCH_KEYBIND = "mod+shift+alt+o"

function projectLabel(project: LocalProject): string {
  return project.name || getFilename(project.worktree)
}

export const ProjectSwitcherChip: Component = () => {
  const layout = useLayout()
  const language = useLanguage()
  const command = useCommand()
  const params = useParams()
  const navigate = useNavigate()
  const dialog = useDialog()

  const currentDir = createMemo(() => (params.dir ? decode64(params.dir) : ""))
  const currentProject = createMemo(() => {
    const dir = currentDir()
    if (!dir) return undefined
    return layout.projects.all().find((project) => project.worktree === dir)
  })
  const chipLabel = createMemo(() =>
    currentProject() ? projectLabel(currentProject()!) : language.t("project.switch.none"),
  )

  const [search, setSearch] = createSignal("")
  let searchInputRef: HTMLInputElement | undefined

  const projects = createMemo(() => layout.projects.list())
  const filtered = createMemo(() => {
    const query = search().trim().toLowerCase()
    const list = projects()
    if (!query) return list
    return list.filter((project) => {
      const label = projectLabel(project).toLowerCase()
      return label.includes(query) || project.worktree.toLowerCase().includes(query)
    })
  })

  const isCurrent = (project: LocalProject) => {
    const dir = currentDir()
    if (!dir) return false
    return pathMatch(dir, project.worktree)
  }

  function pathMatch(a: string, b: string) {
    if (!a || !b) return false
    return a.replace(/[\\/]+$/, "") === b.replace(/[\\/]+$/, "")
  }

  function selectProject(project: LocalProject) {
    layout.projects.open(project.worktree)
    layout.projectPicker.hide()
    navigate(`/${base64Encode(project.worktree)}`)
  }

  function openCreateDialog() {
    layout.projectPicker.hide()
    void dialog.show(() => <DialogCreateProject onCreate={(path) => navigate(`/${base64Encode(path)}`)} />)
  }

  function leaveProject() {
    layout.projectPicker.hide()
    navigate("/")
  }

  // Auto-focus search input when popover opens
  createEffect(() => {
    if (layout.projectPicker.open()) {
      queueMicrotask(() => {
        searchInputRef?.focus()
        searchInputRef?.select()
      })
    }
  })

  onCleanup(() => {
    if (layout.projectPicker.open()) layout.projectPicker.hide()
  })

  return (
    <Popover
      open={layout.projectPicker.open()}
      onOpenChange={(open) => (open ? layout.projectPicker.show() : layout.projectPicker.hide())}
      placement="bottom-start"
      gutter={8}
      class="w-[340px] rounded-[14px] border border-border-weak-base bg-surface-raised-stronger-non-alpha p-0 shadow-[var(--shadow-lg-border-base)] backdrop-blur-xl"
    >
      <TooltipKeybind
        placement="top"
        gutter={4}
        title={language.t("project.switch.tooltip")}
        keybind={command.keybind("project.switch") || SWITCH_KEYBIND}
        inactive={layout.projectPicker.open()}
      >
        <button
          type="button"
          data-component="project-switcher-chip"
          data-action="project-switcher-chip"
          data-state={layout.projectPicker.open() ? "open" : "closed"}
          aria-label={language.t("project.switch.tooltip")}
          aria-expanded={layout.projectPicker.open()}
          onClick={() => layout.projectPicker.toggle()}
          class="group flex h-7 min-w-0 max-w-[200px] items-center gap-1.5 rounded-[8px] px-2 text-13-regular text-text-base transition-colors hover:bg-surface-base-hover data-[state=open]:bg-surface-base-hover"
          style={{
            background: "var(--surface-raised-base)",
            border: "1px solid var(--border-weak-base)",
          }}
        >
          <Icon name={currentProject() ? "folder" : "folder-add-left"} size="small" class="shrink-0 text-icon-base" />
          <span class="truncate text-13-medium text-text-strong">{chipLabel()}</span>
          <Icon name="chevron-down" size="small" class="shrink-0 text-icon-weak-base" />
        </button>
      </TooltipKeybind>
      <div data-slot="popover-body" class="flex flex-col gap-1 p-2">
        <div class="flex items-center gap-2 rounded-[10px] bg-surface-base px-2 py-1.5">
          <Icon name="magnifying-glass" size="small" class="shrink-0 text-icon-weak-base" />
          <input
            ref={(el) => {
              searchInputRef = el
            }}
            type="text"
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
            placeholder={language.t("project.switch.search")}
            class="flex-1 bg-transparent text-13-regular text-text-strong placeholder:text-text-weak outline-none"
            aria-label={language.t("project.switch.search")}
            data-action="project-switcher-search"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                if (search()) {
                  event.preventDefault()
                  setSearch("")
                } else {
                  event.preventDefault()
                  layout.projectPicker.hide()
                }
              } else if (event.key === "Enter") {
                const list = filtered()
                const first = list[0]
                if (first) {
                  event.preventDefault()
                  selectProject(first)
                }
              }
            }}
          />
        </div>

        <div class="flex max-h-[280px] flex-col gap-0.5 overflow-y-auto no-scrollbar" data-slot="project-switcher-list">
          <For
            each={filtered()}
            fallback={
              <div class="px-3 py-6 text-center text-12-regular text-text-weak">
                {projects().length === 0 ? language.t("project.switch.empty") : language.t("project.switch.noMatch")}
              </div>
            }
          >
            {(project) => (
              <button
                type="button"
                data-action="project-switcher-item"
                data-project={base64Encode(project.worktree)}
                onClick={() => selectProject(project)}
                class="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-surface-base-hover"
              >
                <Icon name={isCurrent(project) ? "folder" : "folder"} size="small" class="shrink-0 text-icon-base" />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-13-medium text-text-strong">{projectLabel(project)}</div>
                  <div class="truncate text-11-regular text-text-weak">{project.worktree}</div>
                </div>
                <Show when={isCurrent(project)}>
                  <Icon name="check" size="small" class="shrink-0 text-icon-interactive-base" />
                </Show>
              </button>
            )}
          </For>
        </div>

        <div class="my-1 h-px bg-border-weaker-base" />

        <button
          type="button"
          data-action="project-switcher-create"
          onClick={openCreateDialog}
          class="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-surface-base-hover"
        >
          <Icon name="plus" size="small" class="shrink-0 text-icon-base" />
          <span class="text-13-medium text-text-strong">{language.t("project.switch.create")}</span>
        </button>

        <button
          type="button"
          data-action="project-switcher-leave"
          onClick={leaveProject}
          class="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-surface-base-hover"
        >
          <Icon name="close" size="small" class="shrink-0 text-icon-base" />
          <span class="text-13-medium text-text-strong">{language.t("project.switch.leave")}</span>
        </button>
      </div>
    </Popover>
  )
}
