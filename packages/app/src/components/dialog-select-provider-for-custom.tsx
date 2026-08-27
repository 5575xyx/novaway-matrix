import { Component, Show } from "solid-js"
import { useDialog } from "@novaway/ui/context/dialog"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { Dialog } from "@novaway/ui/dialog"
import { List } from "@novaway/ui/list"
import { Tag } from "@novaway/ui/tag"
import { ProviderIcon } from "@novaway/ui/provider-icon"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"

type ProviderOption = {
  id: string
  name: string
  baseURL?: string
}

type Props = {
  onSelect: (provider: ProviderOption) => void
}

export const DialogSelectProviderForCustom: Component<Props> = (props) => {
  const dialog = useDialog()
  const providers = useProviders()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()

  const popularGroup = () => language.t("dialog.provider.group.popular")
  const otherGroup = () => language.t("dialog.provider.group.other")
  const customLabel = () => language.t("settings.providers.tag.custom")
  const note = (id: string) => {
    if (id === "anthropic") return language.t("dialog.provider.anthropic.note")
    if (id === "openai") return language.t("dialog.provider.openai.note")
    if (id.startsWith("github-copilot")) return language.t("dialog.provider.copilot.note")
    if (id === "NovaWay-go") return language.t("dialog.provider.NovaWayGo.tagline")
    if (id === "ollama") return language.t("dialog.provider.ollama.note")
  }

  const handleSelect = async (x: { id: string; name: string } | undefined) => {
    if (!x) return
    let baseURL: string | undefined
    try {
      const res = await globalSDK.client.v2.provider.get({ providerID: x.id })
      const info = res.data
      if (info?.endpoint && "url" in info.endpoint && info.endpoint.url) {
        baseURL = info.endpoint.url
      }
    } catch {}
    props.onSelect({ id: x.id, name: x.name, baseURL })
    dialog.close()
  }

  return (
    <Dialog title={language.t("provider.custom.field.provider.label")} transition>
      <List
        search={{ placeholder: language.t("dialog.provider.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.provider.empty")}
        activeIcon="check-small"
        key={(x) => x?.id}
        items={() => {
          language.locale()
          return providers.all()
        }}
        filterKeys={["id", "name"]}
        groupBy={(x) => (popularProviders.includes(x.id) ? popularGroup() : otherGroup())}
        sortBy={(a, b) => {
          if (popularProviders.includes(a.id) && popularProviders.includes(b.id))
            return popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id)
          return a.name.localeCompare(b.name)
        }}
        sortGroupsBy={(a, b) => {
          const popular = popularGroup()
          if (a.category === popular && b.category !== popular) return -1
          if (b.category === popular && a.category !== popular) return 1
          return 0
        }}
        onSelect={handleSelect}
      >
        {(i) => (
          <div class="px-1.25 w-full flex items-center gap-x-3">
            <ProviderIcon data-slot="list-item-extra-icon" id={i.id} />
            <span>{i.name}</span>
            <Show when={i.id === "opencode"}>
              <div class="text-14-regular text-text-weak">{language.t("dialog.provider.NovaWay.tagline")}</div>
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
