import { type Component, createMemo, createSignal, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { ProviderConfig } from "@novaway/sdk/v2/client"
import { Dialog } from "@novaway/ui/dialog"
import { Switch } from "@novaway/ui/switch"
import { Tooltip } from "@novaway/ui/tooltip"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { TextField } from "@novaway/ui/text-field"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLocal } from "@/context/local"
import { popularProviders } from "@/hooks/use-providers"
import { useLanguage } from "@/context/language"
import { useDialog } from "@novaway/ui/context/dialog"
import { DialogSelectProvider } from "./dialog-select-provider"
import { ModelCapabilitySummary } from "./model-capability-summary"

type AuthEntry = { type: string; key?: string }

type ModelModality = NonNullable<
  NonNullable<NonNullable<ProviderConfig["models"]>[string]["modalities"]>["input"]
>[number]

type ModelMarker = {
  providerID: string
  modelID: string
  modality: "image" | "video"
  name?: string
}

const maskKey = (key: string | undefined) => {
  if (!key) return "****"
  if (key.length <= 8) return "****"
  return key.slice(0, 4) + "..." + key.slice(-4)
}

export const DialogManageModels: Component = () => {
  const local = useLocal()
  const language = useLanguage()
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()

  const [state, setState] = createStore<{
    filter: string
    authEntries: Record<string, AuthEntry[]>
    expanded: Record<string, boolean>
  }>({
    filter: "",
    authEntries: {},
    expanded: {},
  })

  const [contextMenu, setContextMenu] = createSignal<{
    visible: boolean
    x: number
    y: number
    model: { providerID: string; modelID: string; name: string } | null
  }>({ visible: false, x: 0, y: 0, model: null })

  const handleConnectProvider = () => {
    dialog.show(() => <DialogSelectProvider />)
  }

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
      // 获取当前全局配置
      const configResponse = await globalSDK.client.global.config.get()
      const currentConfig = configResponse.data ?? {}

      // 确保 provider.agnes.models 存在
      const providerConfig = currentConfig.provider?.[marker.providerID] ?? {}
      const modelsConfig = providerConfig.models ?? {}
      const modelConfig = modelsConfig[marker.modelID] ?? {}

      // 更新 modalities
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

      // 调用API更新配置
      await globalSDK.client.global.config.update({ config: updatedConfig })

      // 显示成功提示
      console.log(`已标记 ${marker.name} 为${marker.modality === "image" ? "图片" : "视频"}生成模型`)
    } catch (error) {
      console.error("标记模型失败:", error)
    }
  }

  const providerRank = (id: string) => popularProviders.indexOf(id)

  const providerList = (providerID: string) => local.model.list().filter((x) => x.provider.id === providerID)

  const providerVisible = (providerID: string) =>
    providerList(providerID).every((x) => local.model.visible({ modelID: x.id, providerID: x.provider.id }))

  const setProviderVisibility = (providerID: string, checked: boolean) => {
    providerList(providerID).forEach((x) => {
      local.model.setVisibility({ modelID: x.id, providerID: x.provider.id }, checked)
    })
  }

  const loadAuthEntries = async () => {
    const connected = local.model.list()
    const ids = Array.from(new Set(connected.map((m) => m.provider.id)))
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
    setState("authEntries", result)
  }

  onMount(() => {
    void loadAuthEntries()
  })

  const matchesFilter = (text: string | undefined) => {
    const q = state.filter.toLowerCase().trim()
    if (!q) return true
    if (!text) return false
    return text.toLowerCase().includes(q)
  }

  const getProviderName = (providerID: string) =>
    local.model.list().find((m) => m.provider.id === providerID)?.provider.name ?? providerID

  const getProviderKeys = (providerID: string): AuthEntry[] => {
    const entries = state.authEntries[providerID] ?? []
    return entries.length > 0 ? entries : [{ type: "api" }]
  }

  const visibleModels = (providerID: string) =>
    providerList(providerID).filter(
      (m) => matchesFilter(m.name) || matchesFilter(m.id) || matchesFilter(m.provider.name),
    )

  const visibleProviders = createMemo(() => {
    const ids = Array.from(new Set(local.model.list().map((m) => m.provider.id)))
    const filtered = ids.filter((id) => {
      if (matchesFilter(getProviderName(id))) return true
      return visibleModels(id).length > 0
    })
    return filtered.sort((a, b) => {
      const aRank = providerRank(a)
      const bRank = providerRank(b)
      const aPopular = aRank >= 0
      const bPopular = bRank >= 0
      if (aPopular && !bPopular) return -1
      if (!aPopular && bPopular) return 1
      if (aPopular && bPopular) return aRank - bRank
      return getProviderName(a).localeCompare(getProviderName(b))
    })
  })

  const toggleKeyExpanded = (providerID: string, keyIndex: number) => {
    const k = `${providerID}:${keyIndex}`
    setState("expanded", k, (prev) => !prev)
  }

  const isKeyExpanded = (providerID: string, keyIndex: number) => {
    const keys = getProviderKeys(providerID)
    if (keys.length <= 1) return true
    const k = `${providerID}:${keyIndex}`
    return state.expanded[k] ?? keyIndex === 0
  }

  return (
    <>
      <Dialog
        title={language.t("dialog.model.manage")}
        description={language.t("dialog.model.manage.description")}
        action={
          <Button class="h-7 -my-1 text-14-medium" icon="plus-small" tabIndex={-1} onClick={handleConnectProvider}>
            {language.t("command.provider.connect")}
          </Button>
        }
      >
        <div class="flex flex-col gap-3 p-3 max-h-[60vh] overflow-y-auto">
          <div class="flex items-center gap-2 px-3 h-9 rounded-lg bg-surface-base">
            <Icon name="magnifying-glass" class="text-icon-weak-base flex-shrink-0" />
            <TextField
              variant="ghost"
              type="text"
              value={state.filter}
              onChange={(v) => setState("filter", v)}
              placeholder={language.t("dialog.model.search.placeholder")}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="flex-1"
            />
            <Show when={state.filter}>
              <Button
                size="small"
                variant="ghost"
                icon="circle-x"
                tabIndex={-1}
                onClick={() => setState("filter", "")}
                aria-label={language.t("common.clear")}
              />
            </Show>
          </div>

          <Show
            when={visibleProviders().length > 0}
            fallback={
              <div class="text-14-regular text-text-weak py-8 text-center">{language.t("dialog.model.empty")}</div>
            }
          >
            <For each={visibleProviders()}>
              {(providerID) => {
                const keys = createMemo(() => getProviderKeys(providerID))
                const models = createMemo(() => visibleModels(providerID))
                return (
                  <div class="flex flex-col gap-2">
                    <div class="flex items-center justify-between gap-2 pt-2 pb-1">
                      <span class="text-14-medium text-text-strong">
                        <Show when={keys().length > 1} fallback={getProviderName(providerID)}>
                          {language.t("model.provider.keyCount", {
                            provider: getProviderName(providerID),
                            count: keys().length,
                          })}
                        </Show>
                      </span>
                      <Tooltip
                        placement="top"
                        value={language.t("dialog.model.manage.provider.toggle", {
                          provider: getProviderName(providerID),
                        })}
                      >
                        <Switch
                          class="-mr-1"
                          checked={providerVisible(providerID)}
                          onChange={(checked) => setProviderVisibility(providerID, checked)}
                          hideLabel
                        >
                          {getProviderName(providerID)}
                        </Switch>
                      </Tooltip>
                    </div>

                    <For each={keys()}>
                      {(entry, keyIndex) => {
                        const isOpen = createMemo(() => isKeyExpanded(providerID, keyIndex()))
                        return (
                          <div class="rounded-md border border-border-weak-base overflow-hidden">
                            <Show when={keys().length > 1}>
                              <button
                                type="button"
                                class="flex w-full items-center gap-2 px-3 py-2 text-left text-13-medium text-text-strong bg-surface-raised-base hover:bg-surface-base transition-colors"
                                onClick={() => toggleKeyExpanded(providerID, keyIndex())}
                                aria-expanded={isOpen()}
                              >
                                <Icon
                                  name={isOpen() ? "chevron-down" : "chevron-right"}
                                  size="small"
                                  class="text-icon-weak-base"
                                />
                                <span class="flex items-center gap-1.5">
                                  <span>
                                    {language.t("model.key.label")} {keyIndex() + 1}
                                  </span>
                                  <span class="text-12-regular text-text-weak font-mono">{maskKey(entry.key)}</span>
                                </span>
                              </button>
                            </Show>
                            <Show when={isOpen()}>
                              <div class="flex flex-col">
                                <Show
                                  when={models().length > 0}
                                  fallback={
                                    <div class="px-3 py-2 text-12-regular text-text-weak text-center">
                                      {language.t("dialog.model.empty")}
                                    </div>
                                  }
                                >
                                  <For each={models()}>
                                    {(model) => {
                                      const key = { modelID: model.id, providerID: model.provider.id }
                                      return (
                                        <div
                                          class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-base transition-colors border-t border-border-weaker-base first:border-t-0 cursor-default"
                                          onContextMenu={(e) =>
                                            handleContextMenu(e, {
                                              providerID: model.provider.id,
                                              modelID: model.id,
                                              name: model.name,
                                            })
                                          }
                                        >
                                          <div
                                            class="min-w-0 flex-1 cursor-pointer"
                                            onClick={() => local.model.setVisibility(key, !local.model.visible(key))}
                                          >
                                            <div class="truncate text-14-regular text-text-strong">{model.name}</div>
                                            <ModelCapabilitySummary model={model} compact />
                                          </div>
                                          <div onClick={(e) => e.stopPropagation()}>
                                            <Switch
                                              checked={!!local.model.visible(key)}
                                              onChange={(checked) => local.model.setVisibility(key, checked)}
                                              hideLabel
                                            >
                                              {model.name}
                                            </Switch>
                                          </div>
                                        </div>
                                      )
                                    }}
                                  </For>
                                </Show>
                              </div>
                            </Show>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                )
              }}
            </For>
          </Show>
        </div>
      </Dialog>

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
    </>
  )
}
