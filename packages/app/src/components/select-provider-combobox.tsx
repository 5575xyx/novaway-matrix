import { createMemo, createSignal, Show, splitProps, type ComponentProps } from "solid-js"
import { pipe, groupBy, entries, map } from "remeda"
import { Icon } from "@novaway/ui/icon"
import { Tag } from "@novaway/ui/tag"
import { ProviderIcon } from "@novaway/ui/provider-icon"
import { useLanguage } from "@/context/language"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { useGlobalSDK } from "@/context/global-sdk"

type ProviderOption = {
  id: string
  name: string
  baseURL?: string
}

type Props = {
  current?: ProviderOption
  onSelect: (provider: ProviderOption) => void
  class?: ComponentProps<"div">["class"]
  placeholder?: string
}

export function SelectProviderCombobox(props: Props) {
  const [local, _others] = splitProps(props, ["class", "current", "onSelect", "placeholder"])
  const language = useLanguage()
  const providers = useProviders()
  const globalSDK = useGlobalSDK()

  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")

  const popularGroup = () => language.t("dialog.provider.group.popular")
  const otherGroup = () => language.t("dialog.provider.group.other")

  const note = (id: string) => {
    if (id === "anthropic") return language.t("dialog.provider.anthropic.note")
    if (id === "openai") return language.t("dialog.provider.openai.note")
    if (id.startsWith("github-copilot")) return language.t("dialog.provider.copilot.note")
    if (id === "NovaWay-go") return language.t("dialog.provider.NovaWayGo.tagline")
    if (id === "ollama") return language.t("dialog.provider.ollama.note")
  }

  const CUSTOM_PROVIDER_ID = "custom"

  const handleSelect = async (x: { id: string; name: string }) => {
    if (x.id === CUSTOM_PROVIDER_ID) {
      local.onSelect({ id: "", name: x.name, baseURL: "" })
      setOpen(false)
      setQuery("")
      return
    }
    let baseURL: string | undefined
    try {
      const res = await globalSDK.client.v2.provider.get({ providerID: x.id })
      const info = res.data
      if (info?.endpoint && "url" in info.endpoint && info.endpoint.url) {
        baseURL = info.endpoint.url
      }
    } catch {}
    local.onSelect({ id: x.id, name: x.name, baseURL })
    setOpen(false)
    setQuery("")
  }

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase()
    return providers.all().filter((p) => p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
  })

  const grouped = createMemo(() => {
    const groups = pipe(
      filtered(),
      groupBy((x) => (popularProviders.includes(x.id) ? popularGroup() : otherGroup())),
      entries(),
      map(([k, v]) => ({ category: k, options: v })),
    )
    return groups.sort((a, b) => {
      if (a.category === popularGroup()) return -1
      if (b.category === popularGroup()) return 1
      return 0
    })
  })

  const customOption = () => ({
    id: CUSTOM_PROVIDER_ID,
    name: language.t("provider.custom.field.provider.customOption"),
  })

  const currentDisplay = () => local.current ?? customOption()

  const placeholder = () => local.placeholder ?? language.t("provider.custom.field.provider.label")

  return (
    <div class={`relative ${local.class ?? ""}`}>
      <button
        type="button"
        class="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-input-base border border-border-weak-base text-text-strong focus-within:border-border-strong-base focus-within:ring-1 focus-within:ring-border-strong-base text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="magnifying-glass" class="text-text-weak shrink-0" size="small" />
        <span class="flex-1">{currentDisplay().name}</span>
        <Icon name="chevron-down" class="text-text-weak shrink-0" size="small" />
      </button>

      <Show when={open()}>
        <div class="absolute z-[150] top-full left-0 right-0 mt-1 rounded-lg border border-border-weak-base bg-surface-base shadow-lg overflow-hidden">
          <div class="p-2 border-b border-border-weak-base">
            <div class="flex items-center gap-2 px-2 py-1.5 rounded-md bg-input-base">
              <Icon name="magnifying-glass" class="text-text-weak shrink-0" size="small" />
              <input
                type="text"
                class="flex-1 bg-transparent outline-none min-w-0 text-14-regular"
                placeholder={language.t("dialog.provider.search.placeholder")}
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                autofocus
              />
            </div>
          </div>
          <div class="max-h-72 overflow-y-auto p-1">
            <button
              type="button"
              class="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-surface-hover text-left"
              onClick={() => void handleSelect(customOption())}
            >
              <Icon name="plus-small" size="small" class="text-text-weak" />
              <span class="flex-1 text-14-regular text-text-strong">
                {language.t("provider.custom.field.provider.customOption")}
              </span>
              {currentDisplay().id === CUSTOM_PROVIDER_ID && (
                <Icon name="check-small" size="small" class="text-text-weak" />
              )}
            </button>
            <div class="my-1 border-t border-border-weak-base" />
            {grouped().length === 0 && (
              <div class="px-3 py-4 text-14-regular text-text-weak text-center">
                {language.t("dialog.provider.search.empty")}
              </div>
            )}
            {grouped().map((group) => (
              <div>
                <div class="px-3 py-1.5 text-12-medium text-text-weak uppercase tracking-wider">{group.category}</div>
                {group.options.map((option) => (
                  <button
                    type="button"
                    class="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-surface-hover text-left"
                    onClick={() => void handleSelect(option)}
                  >
                    <ProviderIcon id={option.id} />
                    <span class="flex-1 text-14-regular text-text-strong">{option.name}</span>
                    {option.id === "NovaWay" && (
                      <>
                        <div class="text-14-regular text-text-weak">
                          {language.t("dialog.provider.NovaWay.tagline")}
                        </div>
                        <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                      </>
                    )}
                    {note(option.id) && <div class="text-14-regular text-text-weak">{note(option.id)}</div>}
                    {option.id === "NovaWay-go" && <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>}
                    {local.current?.id === option.id && <Icon name="check-small" size="small" class="text-text-weak" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </Show>
    </div>
  )
}
