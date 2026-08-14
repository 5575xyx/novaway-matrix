import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useSDK } from "@/context/sdk"
import { Persist, persisted } from "@/utils/persist"
import {
  normalizeOfficeLaunchConfig,
  officeLaunchConfigFromSearch,
  type OfficeLaunchConfig,
} from "@/pages/home/office-home"
import { zenActions, type HomeActionId } from "@/pages/home/zen-office"
import {
  officePptTemplates,
  type OfficePptCustomTemplate,
  type OfficePptTemplateChoice,
  type OfficePptTemplateID,
} from "./office-export"

const defaultOfficeActionID: HomeActionId = "document"

function isOfficeActionID(value: string): value is HomeActionId {
  return zenActions.some((action) => action.id === value)
}

function initialOfficeActionID(): HomeActionId | undefined {
  if (typeof window === "undefined") return undefined
  const value = new URLSearchParams(window.location.search).get("office")
  return value && isOfficeActionID(value) ? value : undefined
}

function initialPptTemplate(): OfficePptTemplateID | "auto" | undefined {
  if (typeof window === "undefined") return undefined
  const value = new URLSearchParams(window.location.search).get("pptTemplate")
  if (!value) return undefined
  if (value === "auto") return "auto"
  if (isOfficePptTemplateID(value)) return value
  return undefined
}

function initialOfficeLaunchConfig(): OfficeLaunchConfig | undefined {
  if (typeof window === "undefined") return undefined
  return officeLaunchConfigFromSearch(new URLSearchParams(window.location.search))
}

function isOfficePptTemplateID(value: string): value is OfficePptTemplateID {
  return officePptTemplates.some((template) => template.id === value)
}

export function officeActionByID(id: HomeActionId) {
  return zenActions.find((action) => action.id === id) ?? zenActions[0]
}

export const { use: useOfficeAgent, provider: OfficeAgentProvider } = createSimpleContext({
  name: "OfficeAgent",
  gate: false,
  init: () => {
    const sdk = useSDK()
    const searchActionID = initialOfficeActionID()
    const searchPptTemplate = initialPptTemplate()
    const searchLaunchConfig = initialOfficeLaunchConfig()
    const [store, setStore, _, ready] = persisted(
      Persist.workspace(sdk.directory, "office-agent", ["zen-office-agent.v1"]),
      createStore({
        active: searchActionID ?? defaultOfficeActionID,
        quickMode: false,
        launchConfig: searchLaunchConfig,
        pptTemplate: (searchPptTemplate ?? "auto") as OfficePptTemplateID | "auto" | "custom",
        customPptTemplate: undefined as OfficePptCustomTemplate | undefined,
        pptAnimationEnabled: false,
        pptNarrationEnabled: false,
      }),
    )
    const activeID = createMemo(() => (isOfficeActionID(store.active) ? store.active : defaultOfficeActionID))
    const pptTemplate = createMemo<OfficePptTemplateChoice>(() =>
      store.pptTemplate === "custom" && store.customPptTemplate
        ? store.customPptTemplate
        : store.pptTemplate === "custom"
          ? "auto"
          : store.pptTemplate,
    )
    const launchConfig = createMemo(() =>
      activeID() === "ppt" ? normalizeOfficeLaunchConfig("ppt", store.launchConfig) : store.launchConfig,
    )
    const pptAnimationEnabled = () => store.pptAnimationEnabled
    const pptNarrationEnabled = () => store.pptNarrationEnabled

    // The persisted snapshot loads after init and would otherwise overwrite the
    // selections the user just made before entering the workspace.
    let restored = false
    let touched = false
    createEffect(() => {
      if (!ready() || restored) return
      restored = true
      if (touched) return
      if (searchActionID) setStore("active", searchActionID)
      if (searchPptTemplate) setStore("pptTemplate", searchPptTemplate)
      if (searchLaunchConfig) setStore("launchConfig", searchLaunchConfig)
    })

    return {
      ready,
      activeID,
      activeAction: () => officeActionByID(activeID()),
      quickMode: () => store.quickMode,
      pptTemplate,
      launchConfig,
      pptAnimationEnabled,
      pptNarrationEnabled,
      setLaunchConfig(config: OfficeLaunchConfig | undefined) {
        touched = true
        setStore("launchConfig", config)
      },
      select(id: HomeActionId) {
        touched = true
        setStore("active", id)
      },
      selectQuickMode(value: boolean) {
        setStore("quickMode", value)
      },
      selectPptTemplate(template: OfficePptTemplateChoice) {
        touched = true
        if (typeof template === "object") {
          setStore("customPptTemplate", template)
          setStore("pptTemplate", "custom")
          return
        }
        setStore("pptTemplate", template)
      },
      setPptAnimationEnabled(value: boolean) {
        touched = true
        setStore("pptAnimationEnabled", value)
      },
      setPptNarrationEnabled(value: boolean) {
        touched = true
        setStore("pptNarrationEnabled", value)
      },
    }
  },
})
