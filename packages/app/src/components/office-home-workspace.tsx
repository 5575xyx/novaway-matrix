import { createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { getFilename } from "@novaway/core/util/path"
import { Dialog } from "@novaway/ui/dialog"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Icon } from "@novaway/ui/icon"
import { ProviderIcon } from "@novaway/ui/provider-icon"
import { useDialog } from "@novaway/ui/context/dialog"
import { DraftEmptyState } from "@/components/session/draft-empty-state"
import { OfficePptTemplatePreview } from "@/components/office-ppt-template-preview"
import { OfficePlatformPanel } from "@/components/office-platform-panel"
import { OfficePluginPicker, OfficeSuggestedPrompts } from "@/components/office-suggested-prompts"
import { OfficeSceneSwitcher } from "@/components/office-scene-switcher"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { usePermission } from "@/context/permission"
import { useSettings } from "@/context/settings"
import { useLayout } from "@/context/layout"
import { PERMISSION_MODES } from "@/context/permission-risk"
import { createOfficeHomeSubmission, defaultOfficeHomeDraft, type OfficeLaunchConfig } from "@/pages/home/office-home"
import { officeTemplateCards, type OfficeTemplateCard } from "@/pages/home/office-template-cards"
import type { HomeActionId } from "@/pages/home/zen-office"
import { configuredModel } from "@/utils/model"
import { modelIconId } from "@/utils/provider-icon"

/**
 * 办公模式首页 —— 一比一复刻 ZCode 的办公模式草稿态。
 *
 * 结构只有三样：巨大的品牌水印 → 一句问候 → 一张输入卡。
 * 之前的「场景大标题 + 场景切换器 + PPT 选项表单 + 模板画廊」整块撤掉了：
 * ZCode 的办公模式没有第二套版式，它把首页当作一次普通对话的草稿态，
 * 场景、模板、平台这些能力收进输入卡本身（图标条 / 「+」菜单），
 * 页面不再被装饰挤占，第一眼看到的就是「可以开始干活了」。
 */
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
  const language = useLanguage()
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const models = useModels()
  const permission = usePermission()
  const settings = useSettings()
  const layout = useLayout()

  const [state, setState] = createStore({
    activeID: "document" as HomeActionId,
    draft: defaultOfficeHomeDraft("document"),
  })
  // 首页没有项目上下文，选完目录才真正进入会话，所以由本组件自己记。
  const [directory, setDirectory] = createSignal<string | undefined>()
  const [submitting, setSubmitting] = createSignal(false)

  const projectName = createMemo(() => {
    const target = directory()
    return target ? getFilename(target) : undefined
  })

  const currentModel = createMemo(() => {
    const valid = (key: { providerID: string; modelID: string }) => !!models.find(key)
    const configured = configuredModel(globalSync.data.config?.model, valid)
    if (configured) return models.find(configured)
    for (const key of models.recent.list()) {
      const hit = models.find(key)
      if (hit) return hit
    }
    return models.list()[0]
  })

  const permissionMode = createMemo(
    () => PERMISSION_MODES.find((item) => item.value === permission.defaultMode()) ?? PERMISSION_MODES[0],
  )

  function selectScene(id: HomeActionId) {
    // 切场景只重置"场景自带的默认值"，已经写了一半的话不能丢。
    setState({
      activeID: id,
      draft: {
        ...defaultOfficeHomeDraft(id),
        prompt: state.draft.prompt,
        template: id === "ppt" ? state.draft.template : undefined,
      },
    })
  }

  async function pickProject() {
    const picked = await props.onSelectProject()
    if (picked) setDirectory(picked)
    return picked
  }

  async function submit() {
    if (submitting()) return
    setSubmitting(true)
    try {
      const target = directory() ?? (await pickProject())
      if (!target) return
      const submission = createOfficeHomeSubmission(state.activeID, state.draft)
      props.onEnterProject(
        target,
        submission.prompt,
        state.activeID,
        state.draft.template?.pptTemplate,
        submission.launchConfig,
        true,
      )
    } finally {
      setSubmitting(false)
    }
  }

  function openTemplates() {
    void dialog.show(() => (
      <TemplatePickerDialog
        activeID={state.activeID}
        selectedID={state.draft.template?.id}
        onUse={(card) => {
          // 选模板同时把模板自带的提示词填进输入框：模板本来就是一条预置指令，
          // 选完还要用户再抄一遍开场白，等于这一步白做。
          setState("draft", (draft) => ({
            ...draft,
            template: card,
            prompt: draft.prompt.trim() ? draft.prompt : card.prompt,
          }))
          dialog.close()
        }}
      />
    ))
  }

  function openPlugins() {
    // 首页还没有会话，市场安装按「当前选中的目录 → 最近打开的项目」登记；
    // 两个都没有时市场段只提示「打开项目后可用」，不会硬装到无主的工作区。
    const target = directory() ?? layout.projects.list()[0]?.worktree
    void dialog.show(() => <OfficePluginPicker directory={target} onClose={() => dialog.close()} />)
  }

  function openPlatforms() {
    void dialog.show(() => (
      <Dialog title={language.t("office.home.platform")} size="large">
        <div class="max-h-[70vh] overflow-y-auto pr-1">
          <OfficePlatformPanel />
        </div>
      </Dialog>
    ))
  }

  function chooseModel(key: { providerID: string; modelID: string }) {
    models.setVisibility(key, true)
    models.recent.push(key)
    void globalSync.updateConfig({ model: `${key.providerID}/${key.modelID}` } as never)
  }

  return (
    <div class="relative flex size-full flex-col overflow-y-auto">
      <main class="relative mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center px-6 pb-24 pt-10">
        <DraftEmptyState class="mb-8" />

        <form
          class="relative z-10 w-full rounded-2xl border border-input-border bg-panel shadow-[0_8px_30px_rgba(15,23,42,0.06)] transition-colors focus-within:border-input-border-focused"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {/* 顶行：项目 + 办公场景（ZCode 这里是「项目 chip + 插件头像 + 加号」）。 */}
          <div class="flex min-w-0 items-center gap-1 px-2.5 pt-2.5">
            <button
              type="button"
              class="flex h-7 min-w-0 shrink items-center gap-1.5 rounded-[8px] px-1.5 text-13-regular text-foreground transition-colors hover:bg-hover"
              title={directory() ?? language.t("office.home.project.pick")}
              onClick={() => void pickProject()}
            >
              <Icon
                name={projectName() ? "folder" : "folder-add-left"}
                size="small"
                class="shrink-0 text-foreground-subtle"
              />
              <span class="truncate">{projectName() ?? language.t("office.home.project.pick")}</span>
              <Icon name="chevron-down" size="small" class="shrink-0 text-foreground-subtle" />
            </button>
            <div class="h-4 w-px shrink-0 bg-border" />
            <OfficeSceneSwitcher active={state.activeID} onSelect={selectScene} class="min-w-0 flex-1" />
            <DropdownMenu gutter={4} placement="bottom-end">
              <DropdownMenu.Trigger
                as="button"
                type="button"
                class="grid size-7 shrink-0 place-items-center rounded-[8px] text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                aria-label={language.t("office.home.more")}
              >
                <Icon name="plus" size="small" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content style={{ "min-width": "208px" }}>
                  <DropdownMenu.Item onSelect={openTemplates}>
                    <div class="flex items-center gap-2 text-13-medium text-foreground">
                      <Icon name="layout-bottom" size="small" class="text-foreground-subtle" />
                      {language.t("office.home.templates")}
                    </div>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={openPlatforms}>
                    <div class="flex items-center gap-2 text-13-medium text-foreground">
                      <Icon name="window-cursor" size="small" class="text-foreground-subtle" />
                      {language.t("office.home.platform")}
                    </div>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>
          </div>

          <Show when={state.draft.template}>
            {(template) => (
              <div class="flex items-center gap-1.5 px-3 pt-1.5">
                <span class="flex h-6 max-w-[280px] items-center gap-1.5 rounded-[7px] bg-surface px-2 text-11-medium text-foreground-subtle">
                  <Icon name="layout-bottom" size="small" class="shrink-0" />
                  <span class="truncate">{template().title}</span>
                  <button
                    type="button"
                    class="grid size-3.5 place-items-center rounded-full transition-colors hover:bg-hover hover:text-foreground"
                    title={language.t("common.close")}
                    onClick={() => setState("draft", "template", undefined)}
                  >
                    <Icon name="close-small" size="small" />
                  </button>
                </span>
              </div>
            )}
          </Show>

          <textarea
            autofocus
            value={state.draft.prompt}
            onInput={(event) => setState("draft", "prompt", event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
              event.preventDefault()
              void submit()
            }}
            placeholder={language.t("office.home.placeholder")}
            class="min-h-[96px] w-full resize-none bg-transparent px-3.5 pb-2 pt-3 text-14-regular leading-6 text-foreground outline-none placeholder:text-foreground-subtlest"
          />

          {/* 底行：权限 · 模型 · 发送，和 ZCode 的输入卡一致。 */}
          <div class="flex items-center gap-0.5 px-2 pb-2">
            {/* ZCode 输入卡左下角的 `+` 是「添加插件」。这里同样打开插件选择器：
                开关写回配置，和扩展设置页共用一份状态。 */}
            <button
              type="button"
              class="grid size-7 place-items-center rounded-[8px] text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
              title={language.t("office.plugin.picker.title")}
              aria-label={language.t("office.plugin.picker.title")}
              onClick={openPlugins}
            >
              <Icon name="plus" size="small" />
            </button>

            <DropdownMenu gutter={4} placement="top-start">
              <DropdownMenu.Trigger
                as="button"
                type="button"
                class="flex h-7 items-center gap-1.5 rounded-[8px] px-2 text-12-medium transition-colors hover:bg-hover"
                aria-label={language.t("permission.mode.label")}
              >
                <Icon name={permissionMode().icon} size="small" class="shrink-0 text-foreground-subtle" />
                <span class="shrink-0 text-foreground">{language.t(permissionMode().titleKey as never)}</span>
                <Icon name="chevron-down" size="small" class="shrink-0 text-foreground-subtle" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content style={{ "min-width": "264px" }}>
                  <For each={PERMISSION_MODES}>
                    {(item) => (
                      <DropdownMenu.Item onSelect={() => permission.setDefaultMode(undefined, item.value)}>
                        <div class="flex w-full items-start gap-2.5">
                          <Icon name={item.icon} size="small" class="mt-0.5 shrink-0 text-foreground-subtle" />
                          <div class="flex min-w-0 flex-1 flex-col">
                            <span class="text-13-medium text-foreground">{language.t(item.titleKey as never)}</span>
                            <span class="text-11-regular leading-4 text-foreground-subtle">
                              {language.t(item.descriptionKey as never)}
                            </span>
                          </div>
                          <Show when={item.value === permissionMode().value}>
                            <Icon name="check" size="small" class="mt-0.5 shrink-0 text-foreground" />
                          </Show>
                        </div>
                      </DropdownMenu.Item>
                    )}
                  </For>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>

            <div class="flex-1" />

            <DropdownMenu gutter={4} placement="top-end">
              <DropdownMenu.Trigger
                as="button"
                type="button"
                class="flex h-7 max-w-[240px] items-center gap-1.5 rounded-[8px] px-2 text-13-regular text-foreground transition-colors hover:bg-hover"
                aria-label={language.t("office.home.model")}
              >
                <Show when={currentModel()}>
                  {(model) => (
                    <ProviderIcon
                      id={modelIconId(model().provider.id, model().provider.name, model().id, model().name)}
                      colorId={modelIconId(model().provider.id, model().provider.name, model().id, model().name)}
                      brand
                      class="size-4 shrink-0"
                    />
                  )}
                </Show>
                <span class="min-w-0 truncate">{currentModel()?.name ?? language.t("dialog.model.select.title")}</span>
                <Icon name="chevron-down" size="small" class="shrink-0 text-foreground-subtle" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content style={{ "min-width": "240px", "max-height": "320px", overflow: "auto" }}>
                  <For
                    each={models
                      .list()
                      .filter((model) => models.visible({ providerID: model.provider.id, modelID: model.id }))}
                  >
                    {(model) => (
                      <DropdownMenu.Item
                        onSelect={() => chooseModel({ providerID: model.provider.id, modelID: model.id })}
                      >
                        <div class="flex items-center gap-2 text-13-regular text-foreground">
                          <ProviderIcon
                            id={modelIconId(model.provider.id, model.provider.name, model.id, model.name)}
                            colorId={modelIconId(model.provider.id, model.provider.name, model.id, model.name)}
                            brand
                            class="size-4 shrink-0"
                          />
                          <span class="min-w-0 flex-1 truncate">{model.name}</span>
                          <span class="shrink-0 text-11-regular text-foreground-subtlest">{model.provider.name}</span>
                        </div>
                      </DropdownMenu.Item>
                    )}
                  </For>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>

            <button
              type="submit"
              disabled={submitting()}
              class="grid size-8 shrink-0 place-items-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-40"
              title={language.t("prompt.action.send")}
              aria-label={language.t("prompt.action.send")}
            >
              <Icon name="paper-plane" size="small" />
            </button>
          </div>
        </form>

        {/* 推荐提示词挂在输入框正下方，和 ZCode 的草稿态一致：
            点一条就等于「选好插件 + 写好开场白」，不用用户自己从零描述。 */}
        <Show when={settings.office.showSuggestions()}>
          <OfficeSuggestedPrompts
            class="relative z-10 mt-4"
            onSelect={(item) => {
              // 提示词自带场景时先把场景切过去：场景决定这一轮的办公上下文，
              // 不切的话「做一份客户提案」会挂在「文档整理」的上下文上被处理。
              if (item.scene && item.scene !== state.activeID) selectScene(item.scene)
              setState("draft", "prompt", item.prompt)
            }}
          />
        </Show>
        <p class="relative z-10 mt-3 text-11-regular text-foreground-subtlest">{language.t("office.home.hint.send")}</p>
      </main>
    </div>
  )
}

/**
 * 模板选择弹窗。
 *
 * 模板原本是占据首页整整一段版面的画廊，但模板本质是「预置指令」，属于输入的附属物 ——
 * ZCode 也把这类东西收进 `+` 菜单，而不是常驻首页。
 */
function TemplatePickerDialog(props: {
  activeID: HomeActionId
  selectedID?: string
  onUse: (card: OfficeTemplateCard) => void
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const cards = createMemo(() => officeTemplateCards[props.activeID] ?? [])

  return (
    <Dialog title={language.t("office.home.templates")} size="large">
      <div class="grid max-h-[60vh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        <For each={cards()}>
          {(card) => (
            <div
              class="group flex flex-col gap-1.5 rounded-xl border p-3 text-left transition-colors hover:bg-hover"
              classList={{
                "border-border": props.selectedID !== card.id,
                "border-foreground/40 bg-hover": props.selectedID === card.id,
              }}
            >
              <div class="flex items-start justify-between gap-2">
                <button type="button" class="min-w-0 text-left" onClick={() => props.onUse(card)}>
                  <div class="truncate text-13-semibold text-foreground">{card.title}</div>
                  <div class="mt-1 text-11-regular leading-4 text-foreground-subtle">{card.description}</div>
                </button>
                <Show when={card.pptTemplate && card.pptTemplate !== "auto"}>
                  <button
                    type="button"
                    class="grid size-6 shrink-0 place-items-center rounded-md text-foreground-subtle opacity-0 transition-opacity hover:bg-surface hover:text-foreground group-hover:opacity-100"
                    title={card.title}
                    onClick={() =>
                      void dialog.show(() => <OfficePptTemplatePreview template={card.pptTemplate as never} />)
                    }
                  >
                    <Icon name="eye" size="small" />
                  </button>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
    </Dialog>
  )
}
