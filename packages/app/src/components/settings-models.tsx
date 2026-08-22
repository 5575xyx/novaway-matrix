import { useFilteredList } from "@novaway/ui/hooks"
import type { ProviderConfig } from "@novaway/sdk/v2/client"
import { ProviderIcon } from "@novaway/ui/provider-icon"
import { Switch } from "@novaway/ui/switch"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { TextField } from "@novaway/ui/text-field"
import { type Component, createMemo, createSignal, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { popularProviders } from "@/hooks/use-providers"
import { ModelCapabilitySummary } from "./model-capability-summary"
import { SettingsList } from "./settings-list"

type ModelItem = ReturnType<ReturnType<typeof useModels>["list"]>[number]

type KeyedModel = ModelItem & { keyIndex: number }

type AuthEntry = { type: string; key?: string }

type ModelModality = NonNullable<
  NonNullable<NonNullable<ProviderConfig["models"]>[string]["modalities"]>["input"]
>[number]

const maskKey = (key: string | undefined) => {
  if (!key) return "****"
  if (key.length <= 8) return "****"
  return key.slice(0, 4) + "..." + key.slice(-4)
}

const ListLoadingState: Component<{ label: string }> = (props) => {
  return (
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <span class="text-14-regular text-text-weak">{props.label}</span>
    </div>
  )
}

const ListEmptyState: Component<{ message: string; filter: string }> = (props) => {
  return (
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <span class="text-14-regular text-text-weak">{props.message}</span>
      <Show when={props.filter}>
        <span class="text-14-regular text-text-strong mt-1">&quot;{props.filter}&quot;</span>
      </Show>
    </div>
  )
}

type ModelMarker = {
  providerID: string
  modelID: string
  modality: "image" | "video"
  name?: string
}

export const SettingsModels: Component = () => {
  const language = useLanguage()
  const models = useModels()
  const globalSDK = useGlobalSDK()

  const [authEntries, setAuthEntries] = createStore<Record<string, AuthEntry[]>>({})

  const [contextMenu, setContextMenu] = createSignal<{
    visible: boolean
    x: number
    y: number
    model: { providerID: string; modelID: string; name: string } | null
  }>({ visible: false, x: 0, y: 0, model: null })

  const handleContextMenu = (e: MouseEvent, model: { providerID: string; modelID: string; name: string }) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      model,
    })
  }

  const closeContextMenu = () => {
    setContextMenu((prev) => ({ ...prev, visible: false }))
  }

  const markModelModality = async (marker: ModelMarker) => {
    try {
      const configResponse = await globalSDK.client.global.config.get()
      const currentConfig = configResponse.data ?? {}

      const providerConfig = currentConfig.provider?.[marker.providerID] ?? {}
      const modelsConfig = providerConfig.models ?? {}
      const modelConfig = modelsConfig[marker.modelID] ?? {}

      const currentModalities = modelConfig.modalities ?? { input: ["text"], output: [] }
      const inputModalities = new Set<ModelModality>(currentModalities.input ?? ["text"])
      const outputModalities = new Set<ModelModality>(currentModalities.output ?? [])

      if (marker.modality === "image") {
        inputModalities.add("image")
        outputModalities.add("image")
      } else if (marker.modality === "video") {
        inputModalities.add("image")
        outputModalities.add("video")
      }

      const updatedModelConfig = {
        ...modelConfig,
        modalities: {
          input: Array.from(inputModalities),
          output: Array.from(outputModalities),
        },
      }

      const updatedConfig = {
        ...currentConfig,
        provider: {
          ...currentConfig.provider,
          [marker.providerID]: {
            ...providerConfig,
            models: {
              ...modelsConfig,
              [marker.modelID]: updatedModelConfig,
            },
          },
        },
      }

      await globalSDK.client.global.config.update({ config: updatedConfig })
      console.log(`已标记 ${marker.name} 为${marker.modality === "image" ? "图片" : "视频"}生成模型`)
    } catch (error) {
      console.error("标记模型失败:", error)
    }
  }

  const loadAuthEntries = async () => {
    const all = models.list()
    const ids = Array.from(new Set(all.map((m) => m.provider.id)))
    const result: Record<string, AuthEntry[]> = {}
    await Promise.all(
      ids.map(async (id) => {
        try {
          const res = await globalSDK.client.auth.list({ providerID: id })
          result[id] = res.data ?? []
        } catch {
          result[id] = []
        }
      }),
    )
    setAuthEntries(result)
  }

  onMount(() => {
    void loadAuthEntries()
  })

  const getProviderKeys = (providerID: string): AuthEntry[] => {
    const entries = authEntries[providerID] ?? []
    return entries.length > 0 ? entries : [{ type: "api" }]
  }

  const keyedItems = createMemo<KeyedModel[]>(() => {
    const all = models.list()
    const result: KeyedModel[] = []
    for (const model of all) {
      // 隐藏 NovaWay Zen 模型（Auto Mode 专用）
      if (model.provider.id === "NovaWay") continue

      const keys = getProviderKeys(model.provider.id)
      keys.forEach((_, keyIndex) => {
        result.push({ ...model, keyIndex })
      })
    }
    return result
  })

  const list = useFilteredList<KeyedModel>({
    items: (_filter) => keyedItems(),
    key: (x) => `${x.provider.id}:${x.keyIndex}:${x.id}`,
    filterKeys: ["provider.name", "name", "id"],
    sortBy: (a, b) => a.name.localeCompare(b.name),
    groupBy: (x) => `${x.provider.id}:${x.keyIndex}`,
    sortGroupsBy: (a, b) => {
      const [aProvider, aKeyStr] = a.category.split(":")
      const [bProvider, bKeyStr] = b.category.split(":")
      const aProviderName = a.items[0].provider.name
      const bProviderName = b.items[0].provider.name
      const aIndex = popularProviders.indexOf(aProvider)
      const bIndex = popularProviders.indexOf(bProvider)
      const aPopular = aIndex >= 0
      const bPopular = bIndex >= 0
      if (aPopular && !bPopular) return -1
      if (!aPopular && bPopular) return 1
      if (aPopular && bPopular) return aIndex - bIndex
      const providerCompare = aProviderName.localeCompare(bProviderName)
      if (providerCompare !== 0) return providerCompare
      return Number(aKeyStr) - Number(bKeyStr)
    },
  })

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-4 pt-6 pb-6 w-full">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.models.title")}</h2>
          <div class="flex items-center gap-2 px-3 h-9 rounded-lg bg-surface-base">
            <Icon name="magnifying-glass" class="text-icon-weak-base flex-shrink-0" />
            <TextField
              variant="ghost"
              type="text"
              value={list.filter()}
              onChange={list.onInput}
              placeholder={language.t("dialog.model.search.placeholder")}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="flex-1"
            />
            <Show when={list.filter()}>
              <IconButton icon="circle-x" variant="ghost" onClick={list.clear} />
            </Show>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <Show
          when={!list.grouped.loading}
          fallback={
            <ListLoadingState label={`${language.t("common.loading")}${language.t("common.loading.ellipsis")}`} />
          }
        >
          <Show
            when={list.flat().length > 0}
            fallback={<ListEmptyState message={language.t("dialog.model.empty")} filter={list.filter()} />}
          >
            <For each={list.grouped.latest}>
              {(group) => {
                const [providerID, keyStr] = group.category.split(":")
                const keyIndex = Number(keyStr)
                const keys = getProviderKeys(providerID)
                const isMultiKey = keys.length > 1
                const entry = keys[keyIndex]
                return (
                  <div class="flex flex-col gap-1">
                    <div class="flex items-center gap-2 pb-2">
                      <ProviderIcon id={providerID} class="size-5 shrink-0 icon-strong-base" />
                      <span class="text-14-medium text-text-strong">{group.items[0].provider.name}</span>
                      <Show when={isMultiKey}>
                        <span class="text-12-regular text-text-weak font-mono">
                          {language.t("model.key.label")} {keyIndex + 1} · {maskKey(entry?.key)}
                        </span>
                      </Show>
                    </div>
                    <SettingsList>
                      <For each={group.items}>
                        {(item) => {
                          const key = { providerID: item.provider.id, modelID: item.id }
                          return (
                            <div
                              class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none cursor-default"
                              onContextMenu={(e) =>
                                handleContextMenu(e, {
                                  providerID: item.provider.id,
                                  modelID: item.id,
                                  name: item.name,
                                })
                              }
                            >
                              <div class="min-w-0">
                                <span class="min-w-0 truncate text-14-regular text-text-strong">{item.name}</span>
                                <ModelCapabilitySummary model={item} compact />
                              </div>
                              <div class="flex-shrink-0">
                                <Switch
                                  checked={models.visible(key)}
                                  onChange={(checked) => {
                                    models.setVisibility(key, checked)
                                  }}
                                  hideLabel
                                >
                                  {item.name}
                                </Switch>
                              </div>
                            </div>
                          )
                        }}
                      </For>
                    </SettingsList>
                  </div>
                )
              }}
            </For>
          </Show>
        </Show>
      </div>

      {/* 自定义右键菜单 */}
      <Show when={contextMenu().visible && contextMenu().model}>
        <div class="fixed inset-0 z-50">
          <div
            class="absolute inset-0"
            onClick={closeContextMenu}
            onContextMenu={(e) => {
              e.preventDefault()
              closeContextMenu()
            }}
          />
          <div
            class="absolute min-w-[180px] p-1 bg-surface-raised-base border border-border-base rounded-lg shadow-lg"
            style={{ left: `${contextMenu().x}px`, top: `${contextMenu().y}px` }}
          >
            <button
              type="button"
              class="flex w-full items-center gap-2 px-2 py-1.5 text-13-regular text-text-strong rounded cursor-pointer hover:bg-surface-base"
              onClick={() => {
                if (contextMenu().model) {
                  markModelModality({
                    providerID: contextMenu().model!.providerID,
                    modelID: contextMenu().model!.modelID,
                    modality: "image",
                    name: contextMenu().model!.name,
                  })
                }
                closeContextMenu()
              }}
            >
              <Icon name="photo" size="small" class="text-icon-weak-base" />
              标记为图片生成
            </button>
            <button
              type="button"
              class="flex w-full items-center gap-2 px-2 py-1.5 text-13-regular text-text-strong rounded cursor-pointer hover:bg-surface-base"
              onClick={() => {
                if (contextMenu().model) {
                  markModelModality({
                    providerID: contextMenu().model!.providerID,
                    modelID: contextMenu().model!.modelID,
                    modality: "video",
                    name: contextMenu().model!.name,
                  })
                }
                closeContextMenu()
              }}
            >
              <Icon name="photo" size="small" class="text-icon-weak-base" />
              标记为视频生成
            </button>
          </div>
        </div>
      </Show>
    </div>
  )
}
