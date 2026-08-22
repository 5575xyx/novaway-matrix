import { createMemo, For, type JSX, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@novaway/ui/icon"
import { OfficePlatformPanel } from "@/components/office-platform-panel"
import { OfficeSceneSwitcher } from "@/components/office-scene-switcher"
import { OfficeTemplateGallery } from "@/components/office-template-gallery"
import {
  createOfficeHomeSubmission,
  defaultOfficeHomeDraft,
  officeAudienceOptions,
  type OfficeHomeDraft,
  type OfficeLaunchConfig,
  officeMaterialOptions,
  officePageCountOptions,
  officeRoleOptions,
} from "@/pages/home/office-home"
import type { OfficeTemplateCard } from "@/pages/home/office-template-cards"
import { zenActions, type HomeActionId } from "@/pages/home/zen-office"

type OfficeDraftField = "role" | "useCase" | "audience" | "pageCount" | "material"

export function OfficeHomeWorkspace(props: {
  onEnterProject: (
    directory: string,
    prompt: string,
    id: HomeActionId,
    pptTemplate: string | undefined,
    launchConfig: OfficeLaunchConfig | undefined,
    submit: boolean,
  ) => void
  onSelectProject: () => Promise<string | undefined>
}) {
  const [state, setState] = createStore({
    activeID: "document" as HomeActionId,
    draft: defaultOfficeHomeDraft("document"),
  })

  function selectScene(id: HomeActionId) {
    setState({
      activeID: id,
      draft: defaultOfficeHomeDraft(id),
    })
  }

  function selectTemplate(card: OfficeTemplateCard) {
    setState("draft", "template", card)
  }

  function toggleTaskTracking() {
    setState("draft", "taskTracking", !state.draft.taskTracking)
  }

  async function enterProject(submit: boolean) {
    const directory = await props.onSelectProject()
    if (!directory) return
    const submission = createOfficeHomeSubmission(state.activeID, state.draft)
    props.onEnterProject(
      directory,
      submission.prompt,
      state.activeID,
      state.draft.template?.pptTemplate,
      submission.launchConfig,
      submit,
    )
  }

  return (
    <OfficeWorkspaceFrame
      activeID={state.activeID}
      draft={state.draft}
      onSelectScene={selectScene}
      onUpdateDraft={(field, value) => setState("draft", field, value)}
      onToggleTaskTracking={toggleTaskTracking}
      onSelectTemplate={selectTemplate}
      body={
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void enterProject(true)
          }}
        >
          <textarea
            autofocus
            value={state.draft.prompt}
            onInput={(event) => setState("draft", "prompt", event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }}
            placeholder={officeAction(state.activeID).placeholder}
            class="min-h-[132px] w-full resize-none bg-transparent px-5 py-4 text-15-regular leading-7 text-text-strong outline-none placeholder:text-text-muted"
          />

          <div class="flex min-h-14 flex-wrap items-center gap-2 border-t border-border-weaker-base px-3 py-2.5">
            <SelectedTemplateChip
              template={state.draft.template}
              onClear={() => setState("draft", "template", undefined)}
            />
            <button
              type="button"
              class="flex h-8 min-w-0 max-w-[360px] items-center gap-1.5 rounded-[7px] border border-border-weak-base px-2.5 text-12-medium text-text-weak transition-colors hover:bg-surface-raised-base hover:text-text-strong"
              title="选择项目目录"
              onClick={() => void enterProject(false)}
            >
              <Icon name="folder-add-left" size="small" />
              <span class="truncate">选择项目目录</span>
            </button>

            <div class="flex-1" />
            <span class="hidden items-center gap-1.5 text-11-medium text-amber-600 sm:flex">
              <Icon name="warning" size="small" />
              选择项目后将继续停留在当前工作台
            </span>
            <span class="hidden text-11-regular text-text-muted sm:block">Enter 发送，Shift + Enter 换行</span>
            <button
              type="submit"
              class="grid size-9 place-items-center rounded-[9px] border border-emerald-300/50 bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-[0_8px_22px_rgba(16,185,129,0.30)] transition-all hover:-translate-y-px hover:brightness-105 active:translate-y-0"
              title="选择项目并开始生成"
            >
              <Icon name="arrow-up" size="small" />
            </button>
          </div>
        </form>
      }
    />
  )
}

export function OfficeWorkspaceFrame(props: {
  activeID: HomeActionId
  draft: OfficeHomeDraft
  body: JSX.Element
  onSelectScene: (id: HomeActionId) => void
  onUpdateDraft: (field: OfficeDraftField, value: string) => void
  onToggleTaskTracking?: () => void
  onSelectTemplate: (card: OfficeTemplateCard) => void
}) {
  const action = createMemo(() => officeAction(props.activeID))

  return (
    <div class="relative h-full w-full overflow-y-auto bg-background-base">
      <main class="relative mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 pb-14 pt-8 md:px-8 md:pt-10">
        <OfficePlatformPanel />

        <section class="grid min-h-[210px] grid-cols-1 items-center gap-5 md:grid-cols-[minmax(0,1fr)_220px]">
          <div class="flex min-w-0 flex-col items-center text-center md:items-start md:text-left">
            <div class="mb-3 flex items-center gap-2 text-12-medium text-text-weak">
              <span class="grid size-7 place-items-center rounded-[8px] border border-emerald-300/30 bg-emerald-300/12 text-emerald-300 shadow-[0_0_16px_rgba(16,185,129,0.18)]">
                <Icon name={action().icon} size="small" />
              </span>
              <span>NovaWay 办公助手</span>
            </div>
            <h1 class="text-30-medium font-semibold text-text-strong md:text-[36px]">{action().title}</h1>
            <p class="mt-3 max-w-2xl text-15-regular leading-7 text-text-weak">{action().description}</p>
          </div>
        </section>

        <OfficeComposerCard
          activeID={props.activeID}
          draft={props.draft}
          onSelectScene={props.onSelectScene}
          onUpdateDraft={props.onUpdateDraft}
          onToggleTaskTracking={props.onToggleTaskTracking}
          body={props.body}
        />

        <section class="mt-10">
          <OfficeTemplateGallery
            activeID={props.activeID}
            selectedID={props.draft.template?.id}
            showSceneSwitcher={false}
            onSelect={props.onSelectScene}
            onUseTemplate={props.onSelectTemplate}
          />
        </section>
      </main>
    </div>
  )
}

export function OfficeComposerCard(props: {
  activeID: HomeActionId
  draft: OfficeHomeDraft
  body: JSX.Element
  onSelectScene: (id: HomeActionId) => void
  onUpdateDraft: (field: OfficeDraftField, value: string) => void
  onToggleTaskTracking?: () => void
}) {
  const action = createMemo(() => officeAction(props.activeID))

  return (
    <section class="relative z-10 overflow-hidden rounded-[8px] border border-border-strong-base bg-background-panel/92 shadow-[0_20px_60px_rgba(0,0,0,0.12)] backdrop-blur-xl">
      <div class="border-b border-border-weaker-base bg-background-base/40 px-3 py-2.5">
        <OfficeSceneSwitcher active={props.activeID} onSelect={props.onSelectScene} />
      </div>

      <Show when={props.activeID === "ppt"}>
        <div class="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-border-weaker-base px-4 py-3">
          <OfficeOption
            label="角色"
            value={props.draft.role}
            options={officeRoleOptions}
            onChange={(value) => props.onUpdateDraft("role", value)}
          />
          <OfficeOption
            label="使用场景"
            value={props.draft.useCase}
            options={action().outputs}
            onChange={(value) => props.onUpdateDraft("useCase", value)}
          />
          <OfficeOption
            label="目标受众"
            value={props.draft.audience}
            options={officeAudienceOptions}
            onChange={(value) => props.onUpdateDraft("audience", value)}
          />
          <OfficeOption
            label="页数"
            value={props.draft.pageCount}
            options={officePageCountOptions}
            onChange={(value) => props.onUpdateDraft("pageCount", value)}
          />
          <OfficeOption
            label="素材"
            value={props.draft.material}
            options={officeMaterialOptions}
            onChange={(value) => props.onUpdateDraft("material", value)}
          />
          <label class="flex h-8 items-center gap-1.5 rounded-[8px] border border-border-weak-base bg-surface-weak px-2 transition-colors hover:border-emerald-300/60 hover:bg-surface-raised-base">
            <input
              type="checkbox"
              checked={props.draft.taskTracking}
              onChange={() => props.onToggleTaskTracking?.()}
              class="size-3.5 accent-emerald-400"
            />
            <span class="text-12-medium text-text-weak">任务追踪</span>
          </label>
        </div>
      </Show>

      {props.body}
    </section>
  )
}

export function SelectedTemplateChip(props: { template?: OfficeTemplateCard; onClear?: () => void }) {
  return (
    <Show when={props.template}>
      {(template) => (
        <button
          type="button"
          class="flex h-8 max-w-[260px] items-center gap-1.5 rounded-[8px] border border-emerald-300/30 bg-emerald-300/12 px-2.5 text-12-medium text-emerald-300 transition-all hover:border-emerald-300/50 hover:bg-emerald-300/18"
          title={props.onClear ? "取消已选模板" : template().title}
          onClick={props.onClear}
        >
          <Icon name="layout-bottom" size="small" />
          <span class="truncate">{template().title}</span>
          <Show when={props.onClear}>
            <Icon name="close-small" size="small" />
          </Show>
        </button>
      )}
    </Show>
  )
}

function officeAction(id: HomeActionId) {
  return zenActions.find((item) => item.id === id) ?? zenActions[0]
}

function OfficeOption(props: {
  label: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
}) {
  return (
    <label class="group flex h-8 items-center gap-1.5 rounded-[8px] border border-border-weak-base bg-surface-weak px-2 transition-all duration-150 hover:border-emerald-300/60 hover:bg-surface-raised-base focus-within:border-emerald-400/70 focus-within:ring-2 focus-within:ring-emerald-400/20">
      <span class="shrink-0 text-12-regular text-text-muted">{props.label}</span>
      <span class="relative flex items-center">
        <select
          aria-label={props.label}
          value={props.value}
          onChange={(event) => props.onChange(event.currentTarget.value)}
          class="max-w-[120px] cursor-pointer appearance-none bg-transparent py-1 pl-1 pr-5 text-12-medium text-text-strong outline-none transition-colors hover:text-emerald-300"
          style={{ appearance: "none", "-webkit-appearance": "none" }}
        >
          <For each={props.options}>{(option) => <option value={option}>{option}</option>}</For>
        </select>
        <span class="pointer-events-none absolute right-0 grid size-4 place-items-center text-text-muted transition-colors group-hover:text-emerald-400">
          <Icon name="chevron-down" size="small" class="size-3.5" />
        </span>
      </span>
    </label>
  )
}
