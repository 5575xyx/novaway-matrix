import { createMemo, createSignal, For, Show, type Component } from "solid-js"
import { Dialog } from "@novaway/ui/dialog"
import { Icon } from "@novaway/ui/icon"
import { Popover } from "@novaway/ui/popover"
import { Switch } from "@novaway/ui/switch"
import { useDialog } from "@novaway/ui/context/dialog"
import { extensionConfigPatch, extensionEnabled } from "@/components/extension-config"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useSettings, type OfficeOccupation } from "@/context/settings"
import { AppIcon } from "@/components/app-icon"
import { OfficePluginMarket } from "@/components/office-plugin-market"
import {
  OFFICE_PLUGIN_CATEGORIES,
  officePluginEntries,
  officeSuggestedItems,
  type OfficePluginCategory,
  type OfficeSuggestedItem,
} from "@/pages/home/office-plugins"

/** 一次只摆这么多条：多于这个数量横向滚起来就没法扫，给「换一批」轮转。 */
const VISIBLE_COUNT = 6

/**
 * 插件动作的四态：确认 → 进行中 → 成功 / 失败。
 *
 * 对齐 ZCode 的 `useDraftSuggestedPluginActionPopover`：点一条推荐提示词时，
 * 如果插件没启用，不是弹个对话框了事，而是在**这颗 chip 下面**就地展开，
 * 做完自动收起并把提示词填进输入框。状态机由真实的动作结果驱动（写配置 / 装市场包），
 * 失败时给出可读原因，而不是静默什么都没发生。
 */
type PluginActionPhase = "confirmation" | "progress" | "success" | "error"

type PluginActionState = {
  itemID: string
  phase: PluginActionPhase
  message: string
  actionLabel?: string
  onAction?: () => void
}

/**
 * 草稿态的推荐提示词 —— 对齐 ZCode `ConversationDraftSuggestedPrompts`。
 *
 * 每一条都绑着一个插件；插件没启用时点一下就地启用（四态弹出），
 * 启用成功后自动填入提示词。顶部的「换一批 / 关闭」也和 ZCode 一致：
 * 关闭要二次确认并**记住**（settings.office.showSuggestions），否则下次新建又冒出来。
 */
export const OfficeSuggestedPrompts: Component<{
  class?: string
  category?: OfficePluginCategory | "all"
  /** 只显示已启用插件的提示词；默认 false —— 未启用的也要露出来并标「未启用」。 */
  onlyEnabled?: boolean
  /** 关掉顶部那行（职业 / 换一批 / 关闭）：嵌在会话里时那行会和会话头部打架。 */
  hideHeader?: boolean
  onSelect: (item: OfficeSuggestedItem) => void
}> = (props) => {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const settings = useSettings()
  const dialog = useDialog()

  const [offset, setOffset] = createSignal(0)
  const [action, setAction] = createSignal<PluginActionState>()

  const pool = createMemo(() =>
    officeSuggestedItems(language.locale(), {
      category: props.category ?? "all",
      occupation: settings.office.occupation(),
    }).filter((item) => {
      // 默认把「未启用插件」的推荐也放出来（置灰 + 标「未启用」）：
      // 直接藏起来的话，用户永远不知道该插件存在，也就永远走不到「启用」这一步。
      if (!props.onlyEnabled) return true
      return extensionEnabled(globalSync.data.config, item.plugin)
    }),
  )

  /** 轮转窗口：条目少于窗口时直接全显示，不做无意义的位移。 */
  const items = createMemo(() => {
    const all = pool()
    if (all.length <= VISIBLE_COUNT) return all
    const start = offset() % all.length
    return Array.from({ length: VISIBLE_COUNT }, (_, index) => all[(start + index) % all.length])
  })

  const refresh = () => setOffset((value) => (value + VISIBLE_COUNT) % Math.max(1, pool().length))

  const occupations: Array<{ id: OfficeOccupation; labelKey: string }> = [
    { id: "general", labelKey: "office.suggestions.occupation.general" },
    { id: "finance", labelKey: "office.suggestions.occupation.finance" },
  ]

  const runPluginAction = async (item: OfficeSuggestedItem) => {
    setAction({
      itemID: item.id,
      phase: "progress",
      message: language.t("office.plugin.action.running", { name: item.plugin.name }),
    })
    // 内置插件 = 写配置项；这一步是真正的异步请求，成功/失败都要如实回到界面。
    const patch = extensionConfigPatch(globalSync.data.config, item.plugin, true)
    if (!patch) {
      setAction({ itemID: item.id, phase: "error", message: language.t("office.plugin.action.unsupported") })
      return
    }

    try {
      await globalSync.updateConfig(patch as never)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setAction({
        itemID: item.id,
        phase: "error",
        message: language.t("office.plugin.action.failed", { name: item.plugin.name, message }),
        actionLabel: language.t("office.plugin.action.retry"),
        onAction: () => void runPluginAction(item),
      })
      return
    }

    setAction({
      itemID: item.id,
      phase: "success",
      message: language.t("office.plugin.action.enabled", { name: item.plugin.name }),
    })
    props.onSelect(item)
    // 成功态留一会儿再收：一闪而过等于没给反馈。
    window.setTimeout(() => setAction((current) => (current?.itemID === item.id ? undefined : current)), 1400)
  }

  const insert = (item: OfficeSuggestedItem) => {
    if (extensionEnabled(globalSync.data.config, item.plugin)) {
      props.onSelect(item)
      return
    }
    setAction({
      itemID: item.id,
      phase: "confirmation",
      message: language.t("office.plugin.action.confirm", { name: item.plugin.name }),
      actionLabel: language.t("office.plugin.enable.action"),
      onAction: () => void runPluginAction(item),
    })
  }

  const confirmClose = () => {
    // 二次确认：这排提示词是入口级的东西，误点一下就永久消失很难受。
    void dialog.show(() => (
      <Dialog
        title={language.t("office.suggestions.closeTitle")}
        footer={
          <>
            <span class="flex-1" />
            <button
              type="button"
              class="h-8 rounded-lg px-3 text-13-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
              onClick={() => dialog.close()}
            >
              {language.t("common.cancel")}
            </button>
            <button
              type="button"
              class="h-8 rounded-lg bg-foreground px-3 text-13-medium text-background transition-opacity hover:opacity-90"
              onClick={() => {
                settings.office.setShowSuggestions(false)
                dialog.close()
              }}
            >
              {language.t("office.suggestions.closeAction")}
            </button>
          </>
        }
      >
        <p class="text-13-regular leading-6 text-foreground-subtle">
          {language.t("office.suggestions.closeDescription")}
        </p>
      </Dialog>
    ))
  }

  return (
    <Show when={pool().length > 0}>
      <div data-v4-draft-suggested-prompts="true" class={`flex w-full min-w-0 flex-col gap-2 ${props.class ?? ""}`}>
        <Show when={!props.hideHeader}>
          <div class="flex items-center gap-2 px-1 text-11-regular text-foreground-subtle">
            <span class="shrink-0">{language.t("office.suggestions.heading")}</span>
            <div class="flex shrink-0 items-center rounded-full bg-surface p-0.5">
              <For each={occupations}>
                {(entry) => (
                  <button
                    type="button"
                    class="h-5 rounded-full px-2 text-11-medium transition-colors"
                    classList={{
                      "bg-background text-foreground": settings.office.occupation() === entry.id,
                      "text-foreground-subtlest hover:text-foreground": settings.office.occupation() !== entry.id,
                    }}
                    onClick={() => {
                      settings.office.setOccupation(entry.id)
                      setOffset(0)
                    }}
                  >
                    {language.t(entry.labelKey as never)}
                  </button>
                )}
              </For>
            </div>
            <div class="flex-1" />
            <button
              type="button"
              class="shrink-0 rounded-md px-1.5 py-0.5 transition-colors hover:bg-hover hover:text-foreground"
              onClick={refresh}
            >
              {language.t("office.suggestions.refresh")}
            </button>
            <button
              type="button"
              class="grid size-5 shrink-0 place-items-center rounded-md transition-colors hover:bg-hover hover:text-foreground"
              aria-label={language.t("office.suggestions.closeTitle")}
              title={language.t("office.suggestions.closeTitle")}
              onClick={confirmClose}
            >
              <Icon name="close-small" size="small" />
            </button>
          </div>
        </Show>

        <div class="w-full min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div class="mx-auto flex w-max items-center gap-2">
            <For each={items()}>
              {(item) => {
                const enabled = () => extensionEnabled(globalSync.data.config, item.plugin)
                const state = () => (action()?.itemID === item.id ? action() : undefined)
                return (
                  <Popover
                    open={!!state()}
                    modal={false}
                    onOpenChange={(next) => {
                      // 点外面可以收起确认态；进行中不行，否则用户看不到结果。
                      if (next || action()?.phase === "progress") return
                      setAction(undefined)
                    }}
                    class="w-60 p-3"
                    trigger={
                      <button
                        type="button"
                        data-draft-suggested-prompt={item.id}
                        title={item.label}
                        aria-label={item.label}
                        class="flex h-8 min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border border-border bg-panel px-3 text-left text-ui-caption text-foreground transition-colors hover:border-border-hover hover:bg-hover"
                        classList={{ "opacity-60": !enabled() }}
                        onClick={() => insert(item)}
                      >
                        <AppIcon seed={item.plugin.id} glyph={item.plugin.icon} size="mini" />
                        <span class="min-w-0 max-w-64 truncate">{item.label}</span>
                        <Show when={!enabled()}>
                          <span class="shrink-0 text-11-regular text-foreground-subtlest">
                            · {language.t("office.plugin.disabledTag")}
                          </span>
                        </Show>
                      </button>
                    }
                  >
                    <PluginActionBody state={state()} />
                  </Popover>
                )
              }}
            </For>
          </div>
        </div>
      </div>
    </Show>
  )
}

function PluginActionBody(props: { state?: PluginActionState }) {
  const language = useLanguage()

  return (
    <div class="flex flex-col gap-3">
      <div class="flex min-w-0 items-center gap-1.5" role={props.state?.phase === "error" ? "alert" : "status"}>
        <Show when={props.state?.phase === "progress"}>
          <span class="size-4 shrink-0 animate-spin rounded-full border-2 border-border border-t-foreground" />
        </Show>
        <Show when={props.state?.phase === "success"}>
          <Icon name="check" size="small" class="size-4 shrink-0 text-foreground" />
        </Show>
        <Show when={props.state?.phase === "error"}>
          <Icon name="warning" size="small" class="size-4 shrink-0 text-warning" />
        </Show>
        <Show when={props.state?.phase === "confirmation"}>
          <Icon name="help" size="small" class="size-4 shrink-0 text-foreground-subtle" />
        </Show>
        <span class="min-w-0 flex-1 text-12-regular leading-4 text-foreground">{props.state?.message}</span>
      </div>
      <Show when={props.state?.phase === "confirmation" && props.state.actionLabel && props.state.onAction}>
        <button
          type="button"
          class="h-7 self-end rounded-lg bg-foreground px-2.5 text-12-medium text-background transition-opacity hover:opacity-90"
          onClick={() => props.state?.onAction?.()}
        >
          {props.state?.actionLabel}
        </button>
      </Show>
      <Show when={props.state?.phase === "error" && props.state.actionLabel && props.state.onAction}>
        <button
          type="button"
          class="h-7 self-end rounded-lg border border-border px-2.5 text-12-medium text-foreground transition-colors hover:bg-hover"
          onClick={() => props.state?.onAction?.()}
        >
          {language.t("office.plugin.action.retry")}
        </button>
      </Show>
    </div>
  )
}

/**
 * 插件选择器 —— 对齐 ZCode 输入卡顶部的「插件头像 + 加号」。
 *
 * 开关直接写回配置（和扩展设置页是同一份），所以在这里关掉某个插件，
 * 会话里那条技能就真的不参与；首页的推荐提示词也会同步置灰。
 * 底部另外放了「显示推荐提示词」的开关：那是用户关掉推荐之后**唯一**的找回入口，
 * 藏在设置深处等于找不回来。
 */
export const OfficePluginPicker: Component<{
  /** 市场安装需要工作区目录（安装记录按工作区登记）；首页可能还没有。 */
  directory?: string
  onClose: () => void
}> = (props) => {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const settings = useSettings()
  const [category, setCategory] = createSignal<OfficePluginCategory | "all">("all")
  const entries = createMemo(() => officePluginEntries(category()))

  return (
    <Dialog title={language.t("office.plugin.picker.title")} size="large">
      <div class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-1">
          <For each={OFFICE_PLUGIN_CATEGORIES}>
            {(entry) => (
              <button
                type="button"
                class="h-7 rounded-full px-3 text-12-medium transition-colors"
                classList={{
                  "bg-surface text-foreground": category() === entry.id,
                  "text-foreground-subtle hover:text-foreground": category() !== entry.id,
                }}
                onClick={() => setCategory(entry.id)}
              >
                {language.t(entry.labelKey as never)}
              </button>
            )}
          </For>
        </div>

        <div class="max-h-[60vh] overflow-y-auto pr-1">
          <div class="flex flex-col gap-1">
            <For each={entries()}>
              {(entry) => (
                <div
                  data-component="office-plugin-row"
                  class="flex min-w-0 items-start gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-hover/60"
                >
                  <AppIcon seed={entry.extension.id} glyph={entry.extension.icon} size="sm" class="mt-0.5" />
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-13-medium text-foreground">{entry.extension.name}</div>
                    <div class="mt-0.5 line-clamp-2 text-11-regular leading-4 text-foreground-subtle">
                      {entry.extension.description}
                    </div>
                  </div>
                  <Switch
                    checked={extensionEnabled(globalSync.data.config, entry.extension)}
                    disabled={entry.extension.available === false}
                    hideLabel
                    onChange={(value) => {
                      const patch = extensionConfigPatch(globalSync.data.config, entry.extension, value)
                      if (patch) void globalSync.updateConfig(patch as never)
                    }}
                  >
                    {entry.extension.name}
                  </Switch>
                </div>
              )}
            </For>
          </div>
        </div>

        <OfficePluginMarket directory={props.directory} />

        <div class="flex items-center gap-3 border-t border-border pt-3">
          <div class="min-w-0 flex-1">
            <div class="text-13-medium text-foreground">{language.t("office.plugin.picker.suggestions")}</div>
            <div class="mt-0.5 text-11-regular leading-4 text-foreground-subtle">
              {language.t("office.plugin.picker.hint")}
            </div>
          </div>
          <Switch
            checked={settings.office.showSuggestions()}
            hideLabel
            onChange={(value) => settings.office.setShowSuggestions(value)}
          >
            {language.t("office.plugin.picker.suggestions")}
          </Switch>
          <button
            type="button"
            class="h-8 rounded-lg bg-foreground px-3 text-13-medium text-background transition-opacity hover:opacity-90"
            onClick={props.onClose}
          >
            {language.t("common.done")}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
