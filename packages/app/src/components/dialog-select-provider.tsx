import { Component, Show } from "solid-js"
import { useDialog } from "@novaway/ui/context/dialog"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { Dialog } from "@novaway/ui/dialog"
import { List } from "@novaway/ui/list"
import { Tag } from "@novaway/ui/tag"
import { ProviderIcon } from "@novaway/ui/provider-icon"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { useLanguage } from "@/context/language"
import { DialogCustomProvider } from "./dialog-custom-provider"
import { providerGroup, providerGroupOrder } from "@/utils/provider-groups"

const CUSTOM_ID = "_custom"

export const DialogSelectProvider: Component = () => {
  const dialog = useDialog()
  const providers = useProviders()
  const language = useLanguage()

  const freeGroup = () => language.t("dialog.provider.group.free")
  const popularGroup = () => language.t("dialog.provider.group.popular")
  const otherGroup = () => language.t("dialog.provider.group.other")
  const groupLabel = (id: string) => {
    const group = providerGroup(id, CUSTOM_ID)
    if (group === "free") return freeGroup()
    if (group === "popular") return popularGroup()
    if (group === "custom") return customLabel()
    return otherGroup()
  }
  const customLabel = () => language.t("settings.providers.tag.custom")
  const note = (id: string) => {
    if (id === "anthropic") return language.t("dialog.provider.anthropic.note")
    if (id === "openai") return language.t("dialog.provider.openai.note")
    if (id.startsWith("github-copilot")) return language.t("dialog.provider.copilot.note")
    if (id === "NovaWay-go") return language.t("dialog.provider.NovaWayGo.tagline")
    if (id === "ollama") return language.t("dialog.provider.ollama.note")
  }

  return (
    <Dialog title={language.t("command.provider.connect")} transition>
      <List
        search={{ placeholder: language.t("dialog.provider.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.provider.empty")}
        activeIcon="plus-small"
        key={(x) => x?.id}
        items={() => {
          language.locale()
          return [{ id: CUSTOM_ID, name: customLabel() }, ...providers.all()]
        }}
        filterKeys={["id", "name"]}
        groupBy={(x) => groupLabel(x.id)}
        sortBy={(a, b) => {
          const groupA = providerGroup(a.id, CUSTOM_ID)
          const groupB = providerGroup(b.id, CUSTOM_ID)
          const order = providerGroupOrder(groupA) - providerGroupOrder(groupB)
          if (order !== 0) return order
          if (a.id === CUSTOM_ID) return -1
          if (b.id === CUSTOM_ID) return 1
          if (popularProviders.includes(a.id) && popularProviders.includes(b.id))
            return popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id)
          return a.name.localeCompare(b.name)
        }}
        sortGroupsBy={(a, b) => providerGroupOrder(
          a.category === freeGroup() ? "free" : a.category === popularGroup() ? "popular" : a.category === otherGroup() ? "other" : "custom",
        ) - providerGroupOrder(
          b.category === freeGroup() ? "free" : b.category === popularGroup() ? "popular" : b.category === otherGroup() ? "other" : "custom",
        )}
        onSelect={(x) => {
          if (!x) return
          if (x.id === CUSTOM_ID) {
            dialog.show(() => <DialogCustomProvider back="providers" />)
            return
          }
          dialog.show(() => <DialogConnectProvider provider={x.id} />)
        }}
      >
        {(i) => (
          <div class="px-1.25 w-full flex items-center gap-x-3">
            <ProviderIcon data-slot="list-item-extra-icon" id={i.id} />
            <span>{i.name}</span>
            <Show when={i.id === "opencode"}>
              <div class="text-14-regular text-text-weak">{language.t("dialog.provider.NovaWay.tagline")}</div>
            </Show>
            <Show when={i.id === CUSTOM_ID}>
              <Tag>{language.t("settings.providers.tag.custom")}</Tag>
            </Show>
            <Show when={i.id === "opencode"}>
              <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
            </Show>
            <Show when={note(i.id)}>{(value) => <div class="text-14-regular text-text-weak">{value()}</div>}</Show>
            <Show when={i.id === "NovaWay-go"}>
              <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
            </Show>
          </div>
        )}
      </List>
    </Dialog>
  )
}
