import { Popover as Kobalte } from "@kobalte/core/popover"
import { Component, ComponentProps, createMemo, JSX, Show, ValidComponent } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocal } from "@/context/local"
import { useModels } from "@/context/models"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { popularProviders } from "@/hooks/use-providers"
import { Button } from "@opencode-ai/ui/button"
import { Switch } from "@opencode-ai/ui/switch"
import { Tag } from "@opencode-ai/ui/tag"
import { Icon } from "@opencode-ai/ui/icon"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { ModelTooltip } from "./model-tooltip"
import { useLanguage } from "@/context/language"

const isFree = (provider: string, cost: { input: number } | undefined) =>
  provider === "opencode" && (!cost || cost.input === 0)

type ModelState = ReturnType<typeof useLocal>["model"]

const ModelList: Component<{
  provider?: string
  class?: string
  onSelect: () => void
  action?: JSX.Element
  model?: ModelState
}> = (props) => {
  const model = props.model ?? useLocal().model
  const modelsCtx = useModels()
  const language = useLanguage()

  const models = createMemo(() => {
    // Auto Mode ON 时，返回空列表（隐藏模型列表）
    if (modelsCtx.autoMode()) return []

    return model
      .list()
      .filter((m) => model.visible({ modelID: m.id, providerID: m.provider.id }))
      .filter((m) => (props.provider ? m.provider.id === props.provider : true))
      .filter((m) => m.provider.id !== "opencode")
  })

  return (
    <List
      class={`flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0 ${props.class ?? ""}`}
      search={{ placeholder: language.t("dialog.model.search.placeholder"), autofocus: true, action: props.action }}
      emptyMessage={language.t("dialog.model.empty")}
      key={(x) => `${x.provider.id}:${x.id}`}
      items={models}
      current={model.current()}
      filterKeys={["provider.name", "name", "id"]}
      sortBy={(a, b) => a.name.localeCompare(b.name)}
      groupBy={(x) => x.provider.name}
      sortGroupsBy={(a, b) => {
        const aProvider = a.items[0].provider.id
        const bProvider = b.items[0].provider.id
        if (popularProviders.includes(aProvider) && !popularProviders.includes(bProvider)) return -1
        if (!popularProviders.includes(aProvider) && popularProviders.includes(bProvider)) return 1
        return popularProviders.indexOf(aProvider) - popularProviders.indexOf(bProvider)
      }}
      itemWrapper={(item, node) => (
        <Tooltip
          class="w-full"
          placement="right-start"
          gutter={12}
          value={<ModelTooltip model={item} latest={item.latest} free={isFree(item.provider.id, item.cost)} />}
        >
          {node}
        </Tooltip>
      )}
      onSelect={(x) => {
        model.set(x ? { modelID: x.id, providerID: x.provider.id } : undefined, {
          recent: true,
        })
        props.onSelect()
      }}
    >
      {(i) => (
        <div class="w-full flex items-center gap-x-2 text-13-regular">
          <span class="truncate">{i.name}</span>
          <Show when={isFree(i.provider.id, i.cost)}>
            <Tag>{language.t("model.tag.free")}</Tag>
          </Show>
          <Show when={i.latest}>
            <Tag>{language.t("model.tag.latest")}</Tag>
          </Show>
        </div>
      )}
    </List>
  )
}

type ModelSelectorTriggerProps = Omit<ComponentProps<typeof Kobalte.Trigger>, "as" | "ref">
type Dismiss = "escape" | "outside" | "select" | "manage" | "provider"

export function ModelSelectorPopover(props: {
  provider?: string
  model?: ModelState
  children?: JSX.Element
  triggerAs?: ValidComponent
  triggerProps?: ModelSelectorTriggerProps
  onClose?: (cause: "escape" | "select") => void
}) {
  const [store, setStore] = createStore<{
    open: boolean
    dismiss: Dismiss | null
  }>({
    open: false,
    dismiss: null,
  })
  const dialog = useDialog()
  const modelsCtx = useModels()

  const close = (dismiss: Dismiss) => {
    setStore("dismiss", dismiss)
    setStore("open", false)
  }

  const handleConnectProvider = () => {
    close("provider")
    void import("./dialog-select-provider").then((x) => {
      dialog.show(() => <x.DialogSelectProvider />)
    })
  }
  const language = useLanguage()

  return (
    <Kobalte
      open={store.open}
      onOpenChange={(next) => {
        if (next) setStore("dismiss", null)
        setStore("open", next)
      }}
      modal={false}
      placement="top-start"
      gutter={4}
    >
      <Kobalte.Trigger as={props.triggerAs ?? "div"} {...props.triggerProps}>
        {props.children}
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content
          class={`w-72 flex flex-col p-2 rounded-md border border-border-base bg-surface-raised-stronger-non-alpha shadow-md z-50 outline-none overflow-hidden transition-all duration-200 ${modelsCtx.autoMode() ? "h-28" : "h-80"}`}
          onEscapeKeyDown={(event) => {
            close("escape")
            event.preventDefault()
            event.stopPropagation()
          }}
          onPointerDownOutside={() => close("outside")}
          onFocusOutside={() => close("outside")}
          onCloseAutoFocus={(event) => {
            const dismiss = store.dismiss
            if (dismiss === "outside") event.preventDefault()
            if (dismiss === "escape" || dismiss === "select") {
              event.preventDefault()
              props.onClose?.(dismiss)
            }
            setStore("dismiss", null)
          }}
        >
          <Kobalte.Title class="sr-only">{language.t("dialog.model.select.title")}</Kobalte.Title>
          <div class="px-1 pb-1 border-b border-border-weak-base mb-1">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5 text-13-regular text-text-base">
                <Icon name="autopilot" class="size-4" />
                <span>Auto Mode</span>
              </div>
              <Switch checked={modelsCtx.autoMode()} onChange={(checked) => modelsCtx.setAutoMode(checked)} />
            </div>
          </div>
          <Show when={!modelsCtx.autoMode()}>
            <ModelList provider={props.provider} model={props.model} onSelect={() => close("select")} class="p-1" />
            <div class="px-1 pb-1">
              <Button
                variant="ghost"
                class="w-full justify-start gap-1.5 text-13-regular h-7"
                icon="plus-small"
                onClick={handleConnectProvider}
              >
                添加模型
              </Button>
            </div>
          </Show>
          <Show when={modelsCtx.autoMode()}>
            <div class="flex flex-col items-center justify-center py-2 px-2 text-center">
              <Icon name="autopilot" class="size-4 mb-1 opacity-60" />
              <p class="text-11-regular text-text-secondary leading-snug">Auto 基于效果与速度帮助您选择最优模型</p>
            </div>
          </Show>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}

export const DialogSelectModel: Component<{ provider?: string; model?: ModelState }> = (props) => {
  const dialog = useDialog()
  const modelsCtx = useModels()
  const language = useLanguage()

  const provider = () => {
    void import("./dialog-select-provider").then((x) => {
      dialog.show(() => <x.DialogSelectProvider />)
    })
  }

  return (
    <Dialog title={language.t("dialog.model.select.title")}>
      <div class="px-3 py-2 border-b border-border-weak-base mb-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 text-13-regular text-text-base">
            <Icon name="autopilot" class="size-4" />
            <span>Auto Mode</span>
          </div>
          <Switch checked={modelsCtx.autoMode()} onChange={(checked) => modelsCtx.setAutoMode(checked)} />
        </div>
      </div>
      <Show when={!modelsCtx.autoMode()}>
        <ModelList provider={props.provider} model={props.model} onSelect={() => dialog.close()} />
        <Button
          variant="ghost"
          class="ml-3 mt-3 mb-4 text-text-base self-start gap-1.5"
          icon="plus-small"
          onClick={provider}
        >
          添加模型
        </Button>
      </Show>
      <Show when={modelsCtx.autoMode()}>
        <div class="flex flex-col items-center justify-center py-6 px-4 text-center">
          <Icon name="autopilot" class="size-6 mb-3 opacity-60" />
          <p class="text-13-regular text-text-secondary leading-snug">Auto 基于效果与速度帮助您选择最优模型</p>
        </div>
      </Show>
    </Dialog>
  )
}
