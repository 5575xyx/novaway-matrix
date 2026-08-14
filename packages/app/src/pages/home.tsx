import { createMemo, For, Match, Show, Switch } from "solid-js"
import { Mark } from "@opencode-ai/ui/logo"
import { appModeConfig, useLayout, type AppMode } from "@/context/layout"
import { Navigate, useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { Icon } from "@opencode-ai/ui/icon"
import { usePlatform } from "@/context/platform"
import { DateTime } from "luxon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogCreateProject } from "@/components/dialog-create-project"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { ModeHomePage } from "@/components/mode-home"
import { OfficeHomeWorkspace } from "@/components/office-home-workspace"
import { officeWorkspaceSearch, type OfficeLaunchConfig } from "./home/office-home"
import type { HomeActionId } from "./home/zen-office"

type HomeProject = {
  id?: string
  worktree: string
  time: {
    created: number
    updated?: number
  }
}

export default function Home() {
  const sync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const homedir = createMemo(() => sync.data.path.home)
  const currentMode = createMemo(() => appModeConfig(layout.mode.current()))
  const recent = createMemo(() => {
    const mode = layout.mode.current()
    return sync.data.project
      .filter((project) => !mode || (layout.mode.projectMode(project.worktree) ?? mode) === mode)
      .slice()
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
      .slice(0, 6)
  })

  function selectMode(mode: AppMode) {
    layout.mode.select(mode)
  }

  function registerProject(directory: string) {
    layout.projects.assign(directory)
    layout.projects.open(directory)
    server.projects.touch(directory)
    const project = sync.data.project.find((item) => item.worktree === directory)
    if (project && project.id && project.id !== "global") {
      void globalSDK.client.project.update({ projectID: project.id, directory: project.worktree })
    }
  }

  function openProject(
    directory: string,
    prompt?: unknown,
    officeID?: HomeActionId,
    pptTemplate?: string,
    launchConfig?: OfficeLaunchConfig,
  ) {
    registerProject(directory)
    const slug = base64Encode(directory)
    const promptText = typeof prompt === "string" ? prompt.trim() : ""
    const query = new URLSearchParams()
    if (promptText) {
      query.set("prompt", promptText)
      query.set("submit", "1")
    }
    if (officeID) query.set("office", officeID)
    if (pptTemplate) query.set("pptTemplate", pptTemplate)
    if (launchConfig) {
      query.set("officeRole", launchConfig.role)
      query.set("officeUseCase", launchConfig.useCase)
      query.set("officeAudience", launchConfig.audience)
      query.set("officePages", launchConfig.pageCount)
      query.set("officeMaterial", launchConfig.material)
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : ""
    navigate(`/${slug}/session${suffix}`)
  }

  function enterOfficeProject(
    directory: string,
    prompt: string,
    officeID: HomeActionId,
    pptTemplate?: string,
    launchConfig?: OfficeLaunchConfig,
    submit = false,
  ) {
    registerProject(directory)
    const query = officeWorkspaceSearch({ prompt, officeID, pptTemplate, launchConfig, submit })
    navigate(`/${base64Encode(directory)}/session?${query.toString()}`)
  }

  async function chooseProject(prompt?: unknown, officeID?: HomeActionId, pptTemplate?: string) {
    const promptText = typeof prompt === "string" ? prompt : undefined
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          openProject(directory, promptText, officeID, pptTemplate)
        }
        return
      }
      if (result) openProject(result, promptText, officeID, pptTemplate)
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: !promptText,
      })
      resolve(result)
      return
    }

    void dialog.show(
      () => <DialogSelectDirectory multiple={!promptText} onSelect={resolve} />,
      () => resolve(null),
    )
  }

  function createProject(officeID?: HomeActionId) {
    void dialog.show(
      () => <DialogCreateProject onCreate={(path) => openProject(path, undefined, officeID)} />,
      () => {},
    )
  }

  async function selectOfficeProject() {
    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog({
        title: language.t("command.project.open"),
        multiple: false,
      })
      return Array.isArray(result) ? result[0] : (result ?? undefined)
    }

    return new Promise<string | undefined>((resolve) => {
      void dialog.show(
        () => (
          <DialogSelectDirectory
            multiple={false}
            onSelect={(result) => resolve(Array.isArray(result) ? result[0] : (result ?? undefined))}
          />
        ),
        () => resolve(undefined),
      )
    })
  }

  return (
    <Show when={layout.mode.hasSelected()} fallback={<ModeHomePage onSelect={selectMode} />}>
      <Show
        when={currentMode()?.id === "zen"}
        fallback={
          <Show
            when={currentMode()?.id === "pulse"}
            fallback={
              <DefaultHome
                currentMode={currentMode()}
                recent={recent()}
                homedir={homedir()}
                loading={!sync.ready}
                onChooseProject={chooseProject}
                onCreateProject={() => createProject()}
                onOpenProject={openProject}
                language={language}
              />
            }
          >
            <Navigate href="/pulse" />
          </Show>
        }
      >
        <OfficeHomeWorkspace onEnterProject={enterOfficeProject} onSelectProject={selectOfficeProject} />
      </Show>
    </Show>
  )
}

function DefaultHome(props: {
  currentMode: ReturnType<typeof appModeConfig>
  recent: HomeProject[]
  homedir: string
  loading: boolean
  onChooseProject: () => void
  onCreateProject: () => void
  onOpenProject: (directory: string) => void
  language: ReturnType<typeof useLanguage>
}) {
  return (
    <div class="relative h-full w-full overflow-hidden bg-background-base">
      <div class="home-deco home-deco-1" />
      <div class="home-deco home-deco-2" />
      <div class="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_45%,rgba(37,99,235,0.08),transparent)]" />

      <div class="relative z-10 flex h-full w-full flex-col items-center justify-center gap-8 overflow-y-auto px-6 py-12">
        <div class="flex flex-col items-center gap-4 text-center">
          <div class="relative flex h-16 w-16 items-center justify-center md:h-20 md:w-20">
            <div class="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(37,99,235,0.15),transparent_70%)] blur-2xl" />
            <Mark class="relative h-full w-full drop-shadow-[0_0_16px_rgba(37,99,235,0.3)]" />
          </div>
          <h1 class="text-24-medium font-semibold text-[#2563eb]">{props.language.t("home.welcome.title")}</h1>
          <p class="max-w-md text-16-regular leading-relaxed text-text-weak">
            {props.currentMode?.name ?? "NovaWay AI Workspace"}：
            {props.currentMode?.description ?? "使用 AI 辅助工作，让创意快速变成现实。"}
          </p>

          <div class="mt-2 flex items-center gap-3">
            <button class="btn-gradient-cta flex items-center gap-2" onClick={() => props.onChooseProject()}>
              <Icon name="folder-add-left" size="small" />
              <span>{props.language.t("command.project.open")}</span>
            </button>
            <button class="btn-secondary-cta flex items-center gap-2" onClick={() => props.onCreateProject()}>
              <Icon name="plus" size="small" />
              <span>{props.language.t("command.project.create")}</span>
            </button>
          </div>
        </div>

        <RecentProjects
          title={`${props.currentMode?.shortName ?? ""}模式的${props.language.t("home.recentProjects")}`}
          projects={props.recent}
          homedir={props.homedir}
          loading={props.loading}
          emptyTitle={`${props.currentMode?.shortName ?? "当前"}模式暂无项目`}
          emptyDescription="打开一个本地项目后，它会归属到当前模式；你也可以在项目菜单中移动到其他模式。"
          onChooseProject={props.onChooseProject}
          onCreateProject={props.onCreateProject}
          onOpenProject={props.onOpenProject}
        />
      </div>
    </div>
  )
}

function RecentProjects(props: {
  title: string
  projects: HomeProject[]
  homedir: string
  loading: boolean
  emptyTitle: string
  emptyDescription: string
  onChooseProject: () => void
  onCreateProject: () => void
  onOpenProject: (directory: string) => void
}) {
  return (
    <Switch>
      <Match when={props.projects.length > 0}>
        <div class="w-full">
          <h2 class="mb-5 text-center text-18-medium text-text-strong">{props.title}</h2>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <For each={props.projects}>
              {(project) => (
                <button class="project-grid-card group text-left" onClick={() => props.onOpenProject(project.worktree)}>
                  <div class="flex items-start gap-3">
                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-border-weak-base bg-surface-raised-base">
                      <Icon name="folder" size="small" class="text-icon-interactive-base" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-14-mono font-medium text-text-strong">
                        {project.worktree.replace(props.homedir, "~")}
                      </div>
                      <div class="mt-1 text-12-regular text-text-weak">
                        {DateTime.fromMillis(project.time.updated ?? project.time.created).toRelative()}
                      </div>
                    </div>
                  </div>
                  <div class="mt-3 flex items-center gap-1.5 border-t border-border-weaker-base pt-3 text-12-regular text-text-weak transition-colors group-hover:text-icon-interactive-base">
                    <Icon name="arrow-right" size="small" class="transition-transform group-hover:translate-x-1" />
                    <span>打开项目</span>
                  </div>
                </button>
              )}
            </For>
          </div>
        </div>
      </Match>
      <Match when={props.loading}>
        <div class="flex flex-col items-center justify-center gap-4">
          <div class="text-14-regular text-text-weak">正在加载</div>
          <div class="h-8 w-8 animate-spin rounded-full border-2 border-border-weak-base border-t-icon-interactive-base" />
        </div>
      </Match>
      <Match when={true}>
        <div class="flex w-full flex-col items-center justify-center gap-5 rounded-[8px] border border-border-weak-base bg-background-panel/52 p-8 text-center backdrop-blur-xl">
          <div class="flex h-16 w-16 items-center justify-center rounded-[8px] border border-border-weak-base bg-surface-raised-base">
            <Icon name="folder-add-left" size="large" class="text-icon-interactive-base opacity-60" />
          </div>
          <div class="flex max-w-md flex-col items-center gap-2">
            <div class="text-18-medium text-text-strong">{props.emptyTitle}</div>
            <div class="text-14-regular leading-relaxed text-text-weak">{props.emptyDescription}</div>
          </div>
          <div class="flex items-center gap-3">
            <button class="btn-gradient-cta flex items-center gap-2" onClick={() => props.onChooseProject()}>
              <Icon name="folder-add-left" size="small" />
              <span>打开项目</span>
            </button>
            <button class="btn-secondary-cta flex items-center gap-2" onClick={() => props.onCreateProject()}>
              <Icon name="plus" size="small" />
              <span>新建项目</span>
            </button>
          </div>
        </div>
      </Match>
    </Switch>
  )
}
