import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useSDK } from "@/context/sdk"
import { Persist, persisted } from "@/utils/persist"
import { zenActions, type HomeActionId } from "@/pages/home/zen-office"
import type { OfficePptCustomTemplate, OfficePptTemplateChoice, OfficePptTemplateID } from "./office-export"

const defaultOfficeActionID: HomeActionId = "document"

function isOfficeActionID(value: string): value is HomeActionId {
  return zenActions.some((action) => action.id === value)
}

export function officeActionByID(id: HomeActionId) {
  return zenActions.find((action) => action.id === id) ?? zenActions[0]!
}

export const { use: useOfficeAgent, provider: OfficeAgentProvider } = createSimpleContext({
  name: "OfficeAgent",
  gate: false,
  init: () => {
    const sdk = useSDK()
    const [store, setStore, _, ready] = persisted(
      Persist.workspace(sdk.directory, "office-agent", ["zen-office-agent.v1"]),
      createStore({
        active: defaultOfficeActionID as HomeActionId,
        pptTemplate: "auto" as OfficePptTemplateID | "auto" | "custom",
        customPptTemplate: undefined as OfficePptCustomTemplate | undefined,
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

    return {
      ready,
      activeID,
      activeAction: () => officeActionByID(activeID()),
      pptTemplate,
      select(id: HomeActionId) {
        setStore("active", id)
      },
      selectPptTemplate(template: OfficePptTemplateChoice) {
        if (typeof template === "object") {
          setStore("customPptTemplate", template)
          setStore("pptTemplate", "custom")
          return
        }
        setStore("pptTemplate", template)
      },
    }
  },
})
