import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Dialog } from "@opencode-ai/ui/dialog"
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
import { showToast } from "@opencode-ai/ui/toast"
import {
  completeOfficeDraft,
  createOfficePrompt,
  emptyOfficeDraft,
  officeOutputContract,
  zenActions,
  zenSignals,
  zenWorkflow,
  type HomeAction,
} from "./home/zen-office"
import { Persist, persisted } from "@/utils/persist"

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

  function openProject(directory: string, prompt?: unknown) {
    layout.projects.assign(directory)
    layout.projects.open(directory)
    server.projects.touch(directory)
    const project = sync.data.project.find((item) => item.worktree === directory)
    if (project && project.id && project.id !== "global") {
      void globalSDK.client.project.update({ projectID: project.id, directory: project.worktree })
    }
    const slug = base64Encode(directory)
    const promptText = layout.mode.current() === "zen" || typeof prompt !== "string" ? "" : prompt.trim()
    navigate(promptText ? `/${slug}/session?prompt=${encodeURIComponent(promptText)}&submit=1` : `/${slug}`)
  }

  async function chooseProject(prompt?: unknown) {
    const promptText = typeof prompt === "string" ? prompt : undefined
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          openProject(directory, promptText)
        }
        return
      }
      if (result) openProject(result, promptText)
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: !promptText,
      })
      resolve(result)
      return
    }

    dialog.show(
      () => <DialogSelectDirectory multiple={!promptText} onSelect={resolve} />,
      () => resolve(null),
    )
  }

  function createProject() {
    dialog.show(
      () => <DialogCreateProject onCreate={(path) => openProject(path)} />,
      () => {},
    )
  }

  function startOfficeAction(action: HomeAction) {
    dialog.show(() => (
      <DialogZenOfficeAction
        action={action}
        onStart={() => {
          dialog.close()
          void chooseProject()
        }}
      />
    ))
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
                onCreateProject={createProject}
                onOpenProject={openProject}
                language={language}
              />
            }
          >
            <Navigate href="/pulse" />
          </Show>
        }
      >
        <ZenHome onChooseProject={chooseProject} onStartAction={startOfficeAction} />
      </Show>
    </Show>
  )
}

function ZenHome(props: { onChooseProject: () => void; onStartAction: (action: HomeAction) => void }) {
  return (
    <div class="relative h-full w-full overflow-hidden bg-background-base">
      <div class="home-deco home-deco-1" />
      <div class="home-deco home-deco-2" />
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(52,211,153,0.10),transparent_30%),radial-gradient(circle_at_86%_18%,rgba(56,189,248,0.08),transparent_28%)]" />

      <div class="relative z-10 h-full overflow-y-auto px-6 py-10">
        <div class="mx-auto flex min-h-full w-full max-w-6xl flex-col justify-center gap-7">
          <section class="grid gap-6 lg:grid-cols-[1.25fr_0.75fr] lg:items-stretch">
            <div class="flex min-h-72 flex-col justify-between rounded-[8px] border border-border-weak-base bg-background-panel/70 p-7 shadow-[0_24px_80px_rgba(0,0,0,0.18)] backdrop-blur-xl">
              <div class="flex flex-col gap-5">
                <div class="flex items-center gap-3">
                  <div class="grid size-12 place-items-center rounded-[8px] border border-emerald-300/30 bg-emerald-300/10 text-emerald-200">
                    <Icon name="brain" size="medium" />
                  </div>
                  <div class="flex flex-col gap-1">
                    <span class="text-12-medium text-text-weak">禅意模式（办公模式）</span>
                    <h1 class="text-30-medium text-text-strong">AI 办公工作台</h1>
                  </div>
                </div>
                <p class="max-w-2xl text-15-regular leading-relaxed text-text-weak">
                  围绕文档、PPT、会议、资料、任务和沟通建立长期办公上下文，让 AI
                  从一次性问答变成可沉淀、可进化的办公搭档。
                </p>
              </div>

              <div class="mt-7 flex flex-wrap gap-3">
                <button class="btn-gradient-cta flex items-center gap-2" onClick={() => props.onChooseProject()}>
                  <Icon name="folder-add-left" size="small" />
                  <span>打开办公项目</span>
                </button>
                <button
                  class="flex items-center gap-2 rounded-[8px] border border-border-weak-base bg-surface-raised-base px-4 py-2.5 text-14-medium text-text-strong transition-colors hover:border-emerald-300/40 hover:text-emerald-200"
                  onClick={() => props.onChooseProject()}
                >
                  <Icon name="cloud-upload" size="small" />
                  <span>导入资料空间</span>
                </button>
              </div>
            </div>

            <div class="rounded-[8px] border border-border-weak-base bg-background-panel/60 p-5 backdrop-blur-xl">
              <div class="mb-4 flex items-center justify-between">
                <h2 class="text-15-medium text-text-strong">今日办公流</h2>
                <span class="rounded-full border border-emerald-300/20 px-2.5 py-1 text-11-medium text-emerald-200">
                  AI 协同
                </span>
              </div>
              <div class="flex flex-col gap-3">
                <For each={zenWorkflow}>
                  {(item, index) => (
                    <div class="flex gap-3 rounded-[8px] border border-border-weaker-base bg-surface-raised-base/60 p-3">
                      <div class="grid size-7 shrink-0 place-items-center rounded-full bg-emerald-300/10 text-12-medium text-emerald-200">
                        {index() + 1}
                      </div>
                      <div class="text-13-regular leading-relaxed text-text-weak">{item}</div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </section>

          <section class="hidden">
            <For each={zenActions}>
              {(action) => (
                <button
                  type="button"
                  class="group relative min-h-36 overflow-hidden rounded-[8px] border border-border-weak-base bg-background-panel/68 p-5 text-left backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:border-emerald-300/35 hover:shadow-[0_18px_54px_rgba(16,185,129,0.10)]"
                  onClick={() => props.onStartAction(action)}
                >
                  <div class={`absolute inset-0 bg-gradient-to-br ${action.accent}`} />
                  <div class="relative z-10 flex h-full flex-col justify-between gap-5">
                    <div class="flex items-start justify-between gap-4">
                      <div class="grid size-10 place-items-center rounded-[8px] border border-white/10 bg-white/[0.04] text-emerald-200">
                        <Icon name={action.icon} size="small" />
                      </div>
                      <span class="rounded-full border border-border-weaker-base px-2 py-1 text-11-regular text-text-weak">
                        {action.meta}
                      </span>
                    </div>
                    <div class="space-y-2">
                      <h3 class="text-17-medium text-text-strong">{action.title}</h3>
                      <p class="text-13-regular leading-relaxed text-text-weak">{action.description}</p>
                    </div>
                    <div class="flex items-center gap-1.5 text-12-medium text-emerald-200/90">
                      <span>{action.action}</span>
                      <Icon name="arrow-right" size="small" class="transition-transform group-hover:translate-x-1" />
                    </div>
                  </div>
                </button>
              )}
            </For>
          </section>

          <section class="hidden">
            <div class="rounded-[8px] border border-border-weak-base bg-background-panel/58 p-5 backdrop-blur-xl">
              <h2 class="mb-4 text-15-medium text-text-strong">记忆与进化会参与办公产物</h2>
              <div class="grid gap-3 md:grid-cols-3">
                <For each={zenSignals}>
                  {(signal) => (
                    <div class="rounded-[8px] border border-border-weaker-base bg-surface-raised-base/55 p-4">
                      <div class="mb-1 text-13-medium text-text-strong">{signal.label}</div>
                      <div class="text-12-regular leading-relaxed text-text-weak">{signal.value}</div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function DialogZenOfficeAction(props: { action: HomeAction; onStart: () => void }) {
  const [draft, setDraft] = persisted(
    Persist.global(`zen-office-draft.${props.action.id}`),
    createStore(emptyOfficeDraft(props.action)),
  )
  const [copied, setCopied] = createSignal(false)
  const completedDraft = createMemo(() => completeOfficeDraft(props.action, draft))
  const contract = createMemo(() => officeOutputContract(props.action.id))
  const preview = createMemo(() => createOfficePrompt(props.action, completedDraft()))

  function submit(event: SubmitEvent) {
    event.preventDefault()
    props.onStart()
  }

  function resetDraft() {
    setDraft(emptyOfficeDraft(props.action))
  }

  function copyPreview() {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
    if (!clipboard?.writeText) {
      showToast({ title: "复制失败", description: "当前环境无法写入剪贴板。" })
      return
    }

    void clipboard.writeText(preview()).then(
      () => {
        setCopied(true)
        showToast({ title: "提示词已复制", description: "可以直接粘贴到任务或其他办公工具中复用。" })
        window.setTimeout(() => setCopied(false), 1400)
      },
      () => showToast({ title: "复制失败", description: "当前环境无法写入剪贴板。" }),
    )
  }

  return (
    <Dialog title={`${props.action.title}任务配置`} class="w-full max-w-[720px] mx-auto">
      <form class="flex flex-col gap-5 p-6 pt-0" onSubmit={submit}>
        <div class="rounded-[8px] border border-border-weak-base bg-surface-raised-base/70 p-4">
          <div class="mb-2 flex items-center gap-2 text-14-medium text-text-strong">
            <Icon name={props.action.icon} size="small" />
            <span>{props.action.meta}</span>
          </div>
          <p class="text-13-regular leading-relaxed text-text-weak">{props.action.description}</p>
        </div>

        <div class="flex flex-col gap-2">
          <span class="text-12-medium text-text-weak">快捷模板</span>
          <button
            type="button"
            class="self-start rounded-[8px] border border-border-weak-base bg-background-base px-2.5 py-1 text-11-medium text-text-weak transition-colors hover:border-emerald-300/40 hover:text-emerald-200"
            onClick={resetDraft}
          >
            清空草稿
          </button>
          <div class="grid gap-2 md:grid-cols-3">
            <For each={props.action.templates}>
              {(template) => (
                <button
                  type="button"
                  class="rounded-[8px] border border-border-weak-base bg-background-base px-3 py-2 text-left text-12-regular leading-relaxed text-text-weak transition-colors hover:border-emerald-300/40 hover:text-text-strong"
                  onClick={() => setDraft("subject", template)}
                >
                  {template}
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <span class="text-12-medium text-text-weak">{props.action.outputLabel}</span>
          <div class="flex flex-wrap gap-2">
            <For each={props.action.outputs}>
              {(item) => (
                <button
                  type="button"
                  class="rounded-full border px-3 py-1.5 text-12-medium transition-colors"
                  classList={{
                    "border-emerald-300/50 bg-emerald-300/12 text-emerald-100": completedDraft().output === item,
                    "border-border-weak-base bg-background-base text-text-weak hover:border-emerald-300/35 hover:text-text-strong":
                      completedDraft().output !== item,
                  }}
                  onClick={() => setDraft("output", item)}
                >
                  {item}
                </button>
              )}
            </For>
          </div>
        </div>

        <label class="flex flex-col gap-2">
          <span class="text-12-medium text-text-weak">任务主题</span>
          <textarea
            autofocus
            class="min-h-24 resize-y rounded-[8px] border border-border-weak-base bg-background-base px-3 py-2 text-14-regular text-text-strong outline-none transition-colors placeholder:text-text-muted focus:border-emerald-300/45"
            placeholder={props.action.placeholder}
            value={draft.subject}
            onInput={(event) => setDraft("subject", event.currentTarget.value)}
          />
        </label>

        <div class="grid gap-4 md:grid-cols-2">
          <label class="flex flex-col gap-2">
            <span class="text-12-medium text-text-weak">目标受众</span>
            <input
              class="rounded-[8px] border border-border-weak-base bg-background-base px-3 py-2 text-14-regular text-text-strong outline-none transition-colors placeholder:text-text-muted focus:border-emerald-300/45"
              placeholder="例如：老板、客户、团队成员、候选人"
              value={draft.audience}
              onInput={(event) => setDraft("audience", event.currentTarget.value)}
            />
          </label>
          <label class="flex flex-col gap-2">
            <span class="text-12-medium text-text-weak">输出要求</span>
            <input
              class="rounded-[8px] border border-border-weak-base bg-background-base px-3 py-2 text-14-regular text-text-strong outline-none transition-colors placeholder:text-text-muted focus:border-emerald-300/45"
              placeholder="例如：正式、简洁、带表格、先给结论"
              value={draft.requirements}
              onInput={(event) => setDraft("requirements", event.currentTarget.value)}
            />
          </label>
        </div>

        <label class="flex flex-col gap-2">
          <span class="text-12-medium text-text-weak">{props.action.detailLabel}</span>
          <textarea
            class="min-h-32 resize-y rounded-[8px] border border-border-weak-base bg-background-base px-3 py-2 text-14-regular text-text-strong outline-none transition-colors placeholder:text-text-muted focus:border-emerald-300/45"
            placeholder={props.action.detailPlaceholder}
            value={draft.source}
            onInput={(event) => setDraft("source", event.currentTarget.value)}
          />
        </label>

        <div class="rounded-[8px] border border-border-weak-base bg-background-base/70 p-4">
          <div class="mb-3 flex items-center gap-2 text-13-medium text-text-strong">
            <Icon name="checklist" size="small" />
            <span>结构化产物格式</span>
          </div>
          <div class="mb-3 text-12-regular text-text-weak">{contract().format}</div>
          <div class="flex flex-wrap gap-2">
            <For each={contract().sections}>
              {(section) => (
                <span class="rounded-full border border-border-weaker-base bg-surface-raised-base px-2.5 py-1 text-11-medium text-text-weak">
                  {section}
                </span>
              )}
            </For>
          </div>
        </div>

        <details class="group rounded-[8px] border border-border-weak-base bg-background-base/70">
          <summary class="flex cursor-default list-none items-center justify-between gap-3 px-4 py-3 text-13-medium text-text-strong marker:hidden">
            <span>预览将进入任务的提示词</span>
            <Icon name="chevron-down" size="small" class="transition-transform group-open:rotate-180" />
          </summary>
          <div class="border-t border-border-weaker-base p-4">
            <div class="mb-3 flex justify-end">
              <button
                type="button"
                class="flex items-center gap-1.5 rounded-[8px] border border-border-weak-base bg-surface-raised-base px-3 py-1.5 text-12-medium text-text-weak transition-colors hover:border-emerald-300/40 hover:text-emerald-200"
                onClick={copyPreview}
              >
                <Icon name={copied() ? "check" : "copy"} size="small" />
                <span>{copied() ? "已复制" : "复制提示词"}</span>
              </button>
            </div>
            <pre class="max-h-64 overflow-auto whitespace-pre-wrap rounded-[8px] bg-surface-raised-base/70 p-4 text-12-regular leading-relaxed text-text-weak">
              {preview()}
            </pre>
          </div>
        </details>

        <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border-weaker-base pt-4">
          <div class="text-12-regular text-text-weak">
            将打开办公空间；当前配置可复制为提示词，也可以进入项目后按左侧办公场景继续操作。
          </div>
          <button type="submit" class="btn-gradient-cta flex items-center gap-2">
            <Icon name="arrow-right" size="small" />
            <span>确认并打开空间</span>
          </button>
        </div>
      </form>
    </Dialog>
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
