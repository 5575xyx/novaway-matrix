import { createMemo, createSignal, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useLocal } from "../context/local"
import { map, pipe, flatMap, filter, sortBy, take } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { DialogVariant } from "./dialog-variant"
import * as fuzzysort from "fuzzysort"
import { useConnected } from "./use-connected"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { isAutoModel } from "../util/model"

export { isAutoModel }

export function selectableModelEntries<T>(
  provider: { id: string; models: Record<string, T> },
): [string, T][] {
  return Object.entries(provider.models).filter(([model]) => !isAutoModel(provider.id, model))
}

export function withoutAuto<T extends { providerID: string; modelID: string }>(items: T[]) {
  return items.filter((item) => !isAutoModel(item.providerID, item.modelID))
}

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const theme = useTheme().theme
  const [query, setQuery] = createSignal("")
  const autoMode = createMemo(() => local.model.autoMode())

  const connected = useConnected()
  const providers = createDialogProviderOptions()

  const showExtra = createMemo(() => connected() && !props.providerID)

  const options = createMemo(() => {
    if (autoMode()) return []
    const needle = query().trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    // Auto 关闭后,仅 builtin/auto 不可选,别让它出现在收藏/最近使用里。
    const recents = withoutAuto(local.model.recent())

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const provider = sync.data.provider.find((provider) => provider.id === item.providerID)
        if (!provider) return []
        const model = provider.models[item.modelID]
        if (!model) return []
        return [
          {
            key: item,
            value: { providerID: provider.id, modelID: model.id },
            title: displayModelName(model.name ?? item.modelID, provider.id, model.cost?.input === 0),
            description: joinDescription(provider.name, model.cost?.input === 0),
            category,
            disabled: provider.id === "NovaWay" && model.id.includes("-nano"),
            free: model.cost?.input === 0,
            onSelect: () => {
              onSelect(provider.id, model.id)
            },
          },
        ]
      })
    }

    const favoriteOptions = toOptions(withoutAuto(favorites), "收藏")
    const recentOptions = toOptions(
      recents.filter(
        (item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
      ),
      "最近使用",
    )

    const providerOptions = pipe(
      sync.data.provider,
      sortBy(
        (provider) => provider.id !== "NovaWay",
        (provider) => provider.name,
      ),
      flatMap((provider) =>
        pipe(
          selectableModelEntries(provider),
          filter(([_, info]) => info.status !== "deprecated"),
          filter(([_, info]) => (props.providerID ? info.providerID === props.providerID : true)),
          map(([model, info]) => ({
            value: { providerID: provider.id, modelID: model },
            title: displayModelName(info.name ?? model, provider.id, info.cost?.input === 0),
            releaseDate: info.release_date,
            description: joinDescription(
              favorites.some((item) => item.providerID === provider.id && item.modelID === model)
                ? "(收藏)"
                : undefined,
              info.cost?.input === 0,
            ),
            category: connected() ? displayModelGroup(provider.id, provider.name) : undefined,
            disabled: provider.id === "NovaWay" && model.includes("-nano"),
            free: info.cost?.input === 0,
            onSelect() {
              onSelect(provider.id, model)
            },
          })),
          filter((option) => {
            if (!showSections) return true
            if (
              favorites.some(
                (item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID,
              )
            )
              return false
            if (
              recents.some(
                (item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID,
              )
            )
              return false
            return true
          }),
          (options) => sortModelOptions(options, props.providerID !== undefined),
        ),
      ),
    )

    const popularProviders = !connected()
      ? pipe(
          providers(),
          map((option) => ({
            ...option,
            category: "热门提供商",
          })),
          take(6),
        )
      : []

    if (needle) {
      return [
        ...sortModelOptions(
          fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj),
          false,
        ),
        ...fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj),
      ]
    }

    return [...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
  })

  const provider = createMemo(() =>
    props.providerID ? sync.data.provider.find((item) => item.id === props.providerID) : null,
  )

  const title = createMemo(() => {
    const value = provider()
    if (!value) return "选择模型"
    return value.name
  })

  function onSelect(providerID: string, modelID: string) {
    local.model.setAutoMode(false)
    local.model.set({ providerID, modelID }, { recent: true })
    const list = local.model.variant.list()
    const cur = local.model.variant.selected()
    if (cur === "default" || (cur && list.includes(cur))) {
      dialog.clear()
      return
    }
    if (list.length > 0) {
      dialog.replace(() => <DialogVariant />)
      return
    }
    dialog.clear()
  }

  return (
    <DialogSelect<ReturnType<typeof options>[number]["value"]>
      options={options()}
      titleView={
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {autoMode() ? "Auto Mode 开" : title()}
        </text>
      }
      emptyView={
        <Show when={autoMode()}>
          <text fg={theme.textMuted}>Auto 使用内置模型，由网关按任务选择。关闭 Auto 后可选具体模型。</text>
        </Show>
      }
      actions={[
        {
          command: "model.dialog.auto",
          title: autoMode() ? "关闭 Auto" : "开启 Auto",
          // Auto 开时模型列表为空、没有选中项,此动作必须标记为 global 才能触发。
          global: true,
          onTrigger() {
            local.model.setAutoMode(!autoMode())
          },
        },
        {
          command: "model.dialog.provider",
          title: connected() ? "添加模型" : "查看所有提供商",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          command: "model.dialog.favorite",
          title: "收藏",
          hidden: !connected(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
    />
  )
}

export function sortModelOptions<T extends { free?: boolean; releaseDate: string | number; title: string }>(
  options: T[],
  newestFirst: boolean,
) {
  if (newestFirst) return sortBy(options, [(option) => option.releaseDate, "desc"], (option) => option.title)
  return sortBy(
    options,
    (option) => option.free !== true,
    [(option) => option.releaseDate, "desc"],
    (option) => option.title,
  )
}

export function displayModelName(name: string, providerID: string, free: boolean) {
  if (!free) return name
  // 免费标识的写法各家不一：官方池 "X Free"、"X Free (Unlimited)"，
  // OpenRouter 一系 "X:free" / "X (free)"。只摘显示名，不影响真实 model id。
  return name
    .replace(/\s*[:：]\s*free$/i, "")
    .replace(/\s*[(（]\s*free\s*[)）]$/i, "")
    .replace(/\s+free(?=\s*[(（]|$)/i, "")
    .trim()
}

export function joinDescription(base: string | undefined, free: boolean) {
  if (!free) return base
  return [base, "免费"].filter(Boolean).join(" · ")
}

export function displayModelGroup(providerID: string, providerName: string) {
  if (providerID === "NovaWay") return "默认"
  return providerName
}
