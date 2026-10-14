import { getFilename } from "@novaway/core/util/path"
import { base64Encode } from "@novaway/core/util/encode"
import { Dialog } from "@novaway/ui/dialog"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Mark } from "@novaway/ui/logo"
import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { OfficeComposerCard, OfficeWorkspaceFrame, SelectedTemplateChip } from "@/components/office-home-workspace"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { usePlatform } from "@/context/platform"
import { useDialog } from "@novaway/ui/context/dialog"
import {
  defaultOfficeHomeDraft,
  normalizeOfficeLaunchConfig,
  officeLaunchConfigFromDraft,
  type OfficeHomeDraft,
  type OfficeLaunchConfig,
} from "@/pages/home/office-home"
import { officeTemplateCards, type OfficeTemplateCard } from "@/pages/home/office-template-cards"
import type { HomeActionId } from "@/pages/home/zen-office"
import { useOfficeAgent } from "@/pages/session/office-agent-context"
import { officeAssetKind, officeAssetKindLabel, officeAssetTarget } from "@/pages/session/office-asset-kind"

type OfficeDraftField = "role" | "useCase" | "audience" | "pageCount" | "material"

export function OfficeSessionWorkspace(props: { composer: JSX.Element }) {
  const workspace = createOfficeSessionWorkspace()

  return (
    <div class="flex h-full min-h-0 flex-col">
      <OfficeWindowBand />
      <div class="min-h-0 flex-1">
        <OfficeWorkspaceFrame
          activeID={workspace.activeID()}
          draft={workspace.draft()}
          onSelectScene={workspace.selectScene}
          onUpdateDraft={workspace.updateDraft}
          onSelectTemplate={workspace.selectTemplate}
          body={<OfficeSessionComposerBody composer={props.composer} draft={workspace.draft()} />}
        />
      </div>
    </div>
  )
}

/**
 * 办公模式的窗口顶带。
 *
 * 全局标题栏移除后，办公模式既没有侧栏（`showSidebar` 在 zen/pulse 下为 false）也没有会话帧 Header，
 * 于是窗口在该模式下既拖不动，也再没有设置入口 —— 这两样都必须补回来。
 * 这里只放「拖拽 + 回首页 + 主题 + 设置」，办公主区自身的排版不动。
 */
function OfficeWindowBand() {
  const language = useLanguage()
  const command = useCommand()
  const navigate = useNavigate()

  return (
    <div class="flex h-12 shrink-0 items-center gap-1 px-2" data-window-drag>
      <button
        type="button"
        class="flex size-8 shrink-0 items-center justify-center rounded-md text-foreground-subtle transition-colors hover:bg-hover"
        onClick={() => navigate("/")}
        aria-label={language.t("command.home.open")}
        title={language.t("command.home.open")}
      >
        <Mark class="size-5 shrink-0" />
      </button>
      <div class="flex-1" />
      <IconButton
        icon="settings-gear"
        variant="ghost"
        title={language.t("command.settings.open")}
        aria-label={language.t("command.settings.open")}
        onClick={() => command.trigger("settings.open")}
      />
    </div>
  )
}

export function OfficeSessionComposer(props: {
  composer: JSX.Element
  centered: boolean
  setPromptDockRef: (el: HTMLDivElement) => void
}) {
  const workspace = createOfficeSessionWorkspace()

  return (
    <div
      ref={props.setPromptDockRef}
      data-component="session-prompt-dock"
      class="shrink-0 w-full bg-panel/80 pb-4 backdrop-blur-sm"
    >
      <div
        classList={{
          "w-full px-4": true,
          "mx-auto md:w-[75%]": props.centered,
        }}
      >
        <OfficeComposerCard
          activeID={workspace.activeID()}
          draft={workspace.draft()}
          onSelectScene={workspace.selectScene}
          onUpdateDraft={workspace.updateDraft}
          body={<OfficeSessionComposerBody composer={props.composer} draft={workspace.draft()} />}
        />
      </div>
    </div>
  )
}

function createOfficeSessionWorkspace() {
  const office = useOfficeAgent()
  const [state, setState] = createStore({
    draft: initialDraft(office.activeID(), office.launchConfig(), selectedTemplateCard(office.pptTemplate())),
  })

  const activeID = createMemo(() => office.activeID())

  createEffect(() => {
    if (!office.ready()) return
    setState(
      "draft",
      initialDraft(office.activeID(), office.launchConfig(), selectedTemplateCard(office.pptTemplate())),
    )
  })

  function selectScene(id: HomeActionId) {
    office.select(id)
    const draft = initialDraft(id, undefined, id === "ppt" ? selectedTemplateCard(office.pptTemplate()) : undefined)
    setState("draft", draft)
    office.setLaunchConfig(id === "ppt" ? officeLaunchConfigFromDraft(draft) : undefined)
  }

  function updateDraft(field: OfficeDraftField, value: string) {
    setState("draft", field, value)
    if (activeID() === "ppt") office.setLaunchConfig(officeLaunchConfigFromDraft(state.draft))
  }

  function selectTemplate(card: OfficeTemplateCard) {
    setState("draft", "template", card)
    office.selectPptTemplate(card.pptTemplate ?? "auto")
  }

  return {
    activeID,
    draft: () => state.draft,
    selectScene,
    updateDraft,
    selectTemplate,
  }
}

function OfficeSessionComposerBody(props: { composer: JSX.Element; draft: OfficeHomeDraft }) {
  const sdk = useSDK()
  const office = useOfficeAgent()
  const navigate = useNavigate()
  const dialog = useDialog()
  const platform = usePlatform()
  const server = useServer()

  const [directory, setDirectory] = createSignal(sdk.directory)
  const [assetState, setAssetState] = createStore({
    open: false,
    loading: false,
    error: "",
    nodes: [] as OfficeAssetNode[],
  })
  const [dragAssetIndex, setDragAssetIndex] = createSignal<number | undefined>()
  const selectedAssets = createMemo(() => office.launchConfig()?.assets ?? [])

  createEffect(() => {
    setDirectory(sdk.directory)
  })

  async function handleChangeProject() {
    async function resolve(result: string | string[] | null) {
      if (!result) return
      const directory = Array.isArray(result) ? result[0] : result
      if (!directory || directory === sdk.directory) return
      navigate(`/${base64Encode(directory)}/session`)
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog({
        title: "切换项目目录",
        multiple: false,
      })
      await resolve(result ?? null)
      return
    }

    void dialog.show(
      () => (
        <DialogSelectDirectory
          multiple={false}
          onSelect={(result) => resolve(Array.isArray(result) ? result[0] : (result ?? null))}
        />
      ),
      () => resolve(null),
    )
  }

  function handleClearProject() {
    setDirectory("")
    navigate(`/`)
  }

  async function loadAssets() {
    const dir = directory()
    if (!dir) return
    setAssetState("loading", true)
    setAssetState("error", "")
    try {
      const result = await sdk.client.file.list({ path: dir })
      setAssetState("nodes", (result.data ?? []).filter(isOfficeAssetNode))
    } catch (error) {
      setAssetState("error", error instanceof Error ? error.message : String(error))
    } finally {
      setAssetState("loading", false)
    }
  }

  function toggleAsset(path: string) {
    const current = office.launchConfig()?.assets ?? []
    const next = current.includes(path) ? current.filter((item) => item !== path) : [...current, path]
    const currentConfig = office.launchConfig() ?? officeLaunchConfigFromDraft(props.draft)
    office.setLaunchConfig({ ...currentConfig, assets: next })
  }

  function moveAsset(index: number, direction: -1 | 1) {
    const current = [...(office.launchConfig()?.assets ?? [])]
    const target = index + direction
    if (index < 0 || index >= current.length || target < 0 || target >= current.length) return
    moveAssetTo(index, target)
  }

  function moveAssetTo(from: number, to: number) {
    const current = [...(office.launchConfig()?.assets ?? [])]
    if (from < 0 || from >= current.length || to < 0 || to >= current.length || from === to) return
    const next = [...current]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved ?? "")
    const currentConfig = office.launchConfig() ?? officeLaunchConfigFromDraft(props.draft)
    office.setLaunchConfig({ ...currentConfig, assets: next })
  }

  return (
    <>
      <div class="px-3 pb-2 pt-3">{props.composer}</div>
      <div class="flex min-h-12 flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        <SelectedTemplateChip template={props.draft.template} />
        <Show
          when={directory()}
          fallback={
            <button
              type="button"
              class="flex h-8 cursor-pointer items-center gap-1.5 rounded-[7px] border border-dashed border-border bg-surface px-3 text-13-medium text-foreground-subtle transition-all hover:border-border hover:bg-surface hover:text-foreground"
              onClick={handleChangeProject}
            >
              <Icon name="folder-add-left" size="small" />
              <span>选择目录</span>
            </button>
          }
        >
          <div class="flex h-11 min-w-0 max-w-full items-center gap-2 rounded-[8px] border border-border bg-background px-2 shadow-[0_6px_18px_rgba(15,23,42,0.06)] sm:max-w-[460px]">
            <span class="grid size-7 shrink-0 place-items-center rounded-[6px] bg-emerald-400/10 text-emerald-500">
              <Icon name="folder" size="small" />
            </span>
            <button
              type="button"
              class="flex min-w-0 flex-1 flex-col items-start justify-center text-left"
              title={directory()}
              onClick={handleChangeProject}
            >
              <span class="text-10-medium leading-4 text-foreground-subtle">当前项目目录</span>
              <span class="max-w-full truncate text-13-medium leading-5 text-foreground">
                {getFilename(directory())}
              </span>
            </button>
            <button
              type="button"
              class="grid size-7 shrink-0 place-items-center rounded-[6px] text-foreground-subtle transition-colors hover:bg-surface hover:text-foreground"
              title="切换项目目录"
              onClick={handleChangeProject}
            >
              <Icon name="chevron-down" size="small" />
            </button>
            <button
              type="button"
              class="group/clear grid size-7 shrink-0 place-items-center rounded-[6px] text-foreground-subtle transition-colors hover:bg-red-500/10 hover:text-red-500"
              title="退出当前项目"
              onClick={handleClearProject}
            >
              <Icon
                name="close-small"
                size="small"
                class="text-current transition-transform duration-150 group-hover/clear:scale-110"
              />
            </button>
          </div>
        </Show>
        <button
          type="button"
          class="flex h-9 items-center gap-1.5 rounded-[7px] border border-border bg-background px-2.5 text-12-medium text-foreground-subtle transition-colors hover:bg-surface hover:text-foreground"
          title="打开项目素材库"
          onClick={() => {
            setAssetState("open", true)
            void loadAssets()
          }}
        >
          <Icon name="folder" size="small" />
          <span>项目素材库</span>
          <Show when={selectedAssets().length}>
            <span class="grid size-5 place-items-center rounded-[5px] bg-emerald-300/12 text-10-medium text-emerald-300">
              {selectedAssets().length}
            </span>
          </Show>
        </button>
      </div>
      <Show when={assetState.open}>
        <Dialog title="项目素材库" class="w-full max-w-[760px] mx-auto">
          <div class="flex flex-col gap-3 px-5 pb-5">
            <div class="flex items-center justify-between gap-3">
              <span class="truncate text-12-regular text-foreground-subtle">{directory()}</span>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-background px-2.5 py-1.5 text-12-medium text-foreground-subtle transition-colors hover:bg-surface hover:text-foreground"
                onClick={() => void loadAssets()}
              >
                <Icon name="refresh" size="small" />
                <span>刷新</span>
              </button>
            </div>
            <Show when={assetState.loading}>
              <div class="rounded-[8px] border border-border bg-surface/60 p-3 text-12-regular text-foreground-subtle">
                正在扫描素材...
              </div>
            </Show>
            <Show when={assetState.error}>
              <div class="rounded-[8px] border border-red-400/25 bg-red-400/10 p-3 text-12-regular text-red-300">
                {assetState.error}
              </div>
            </Show>
            <div class="grid max-h-[52vh] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              <For each={assetState.nodes}>
                {(node) => {
                  const selected = selectedAssets().includes(node.path)
                  const kind = officeAssetKind(node.path)
                  const kindLabel = officeAssetKindLabel(kind)
                  return (
                    <button
                      type="button"
                      class="flex items-center gap-2 rounded-[8px] border border-border bg-surface/60 px-3 py-2 text-left transition-colors hover:bg-surface"
                      classList={{
                        "border-emerald-300/45 bg-emerald-300/8": selected,
                      }}
                      onClick={() => toggleAsset(node.path)}
                    >
                      <Icon
                        name={node.type === "directory" ? "folder" : "copy"}
                        size="small"
                        class="shrink-0 text-foreground-subtlest"
                      />
                      <span class="min-w-0 flex-1 truncate text-12-medium text-foreground-subtle">
                        {getFilename(node.path)}
                      </span>
                      <span
                        class="shrink-0 rounded-[5px] border border-border px-1.5 py-0.5 text-10-medium text-foreground-subtle"
                        classList={{
                          "border-emerald-300/30 bg-emerald-300/10 text-emerald-200": kind === "data",
                          "border-cyan-300/25 bg-cyan-300/10 text-cyan-200": kind === "image",
                        }}
                      >
                        {kindLabel}
                      </span>
                      <Show when={selected}>
                        <Icon name="check" size="small" class="shrink-0 text-emerald-300" />
                      </Show>
                    </button>
                  )
                }}
              </For>
              <Show when={!assetState.loading && assetState.nodes.length === 0 && !assetState.error}>
                <div class="col-span-full rounded-[8px] border border-border bg-surface/50 p-3 text-12-regular text-foreground-subtle">
                  当前目录没有可识别的办公素材。
                </div>
              </Show>
            </div>
            <Show when={selectedAssets().length}>
              <div class="border-t border-border pt-3">
                <div class="mb-2 text-12-medium text-foreground-subtle">已选素材</div>
                <div class="flex flex-col gap-1">
                  <For each={selectedAssets()}>
                    {(asset, index) => (
                      <div
                        class="flex cursor-grab items-center gap-2 rounded-[7px] border border-border bg-surface/50 px-2 py-1.5 active:cursor-grabbing"
                        draggable
                        onDragStart={() => setDragAssetIndex(index())}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          const from = dragAssetIndex()
                          if (from !== undefined) moveAssetTo(from, index())
                          setDragAssetIndex(undefined)
                        }}
                      >
                        <span class="grid size-5 place-items-center text-11-medium text-foreground-subtle">{index() + 1}</span>
                        <Icon name="bullet-list" size="small" class="shrink-0 text-foreground-subtlest" />
                        <span class="min-w-0 flex-1 truncate text-12-regular text-foreground-subtle">{asset}</span>
                        <span class="shrink-0 rounded-[5px] border border-border px-1.5 py-0.5 text-10-medium text-foreground-subtle">
                          {officeAssetTarget(asset)}
                        </span>
                        <button
                          type="button"
                          class="grid size-6 place-items-center rounded-[5px] text-foreground-subtle transition-colors hover:bg-background hover:text-foreground disabled:opacity-30"
                          title="上移"
                          disabled={index() === 0}
                          onClick={() => moveAsset(index(), -1)}
                        >
                          <Icon name="arrow-up" size="small" />
                        </button>
                        <button
                          type="button"
                          class="grid size-6 place-items-center rounded-[5px] text-foreground-subtle transition-colors hover:bg-background hover:text-foreground disabled:opacity-30"
                          title="下移"
                          disabled={index() === selectedAssets().length - 1}
                          onClick={() => moveAsset(index(), 1)}
                        >
                          <Icon name="chevron-down" size="small" />
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </Dialog>
      </Show>
    </>
  )
}

type OfficeAssetNode = {
  path: string
  type?: string
}

function isOfficeAssetNode(value: unknown): value is OfficeAssetNode {
  return typeof value === "object" && value !== null && typeof (value as { path?: unknown }).path === "string"
}

function initialDraft(
  id: HomeActionId,
  config: OfficeLaunchConfig | undefined,
  template: OfficeTemplateCard | undefined,
): OfficeHomeDraft {
  const draft = defaultOfficeHomeDraft(id)
  if (id !== "ppt") return { ...draft, template }
  const resolved = normalizeOfficeLaunchConfig(id, config)
  return {
    ...draft,
    role: resolved.role,
    useCase: resolved.useCase,
    audience: resolved.audience,
    pageCount: resolved.pageCount,
    material: resolved.material,
    template,
  }
}

function selectedTemplateCard(
  template: ReturnType<ReturnType<typeof useOfficeAgent>["pptTemplate"]>,
): OfficeTemplateCard | undefined {
  if (typeof template === "object") return undefined
  return officeTemplateCards.ppt.find((card) => card.pptTemplate === template)
}
