import type { PowersnexusVersionResponse } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { For, Show, createMemo, createResource, type Component, type JSX } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"

const SettingsPage: Component<{ title: string; description: string; children: JSX.Element }> = (props) => (
  <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
    <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
      <div class="flex flex-col gap-1 pt-6 pb-8 w-full">
        <h2 class="text-16-medium text-text-strong">{props.title}</h2>
        <p class="text-13-regular text-text-weak">{props.description}</p>
      </div>
    </div>
    <div class="flex flex-col gap-8 w-full">{props.children}</div>
  </div>
)

const Section: Component<{ title: string; description?: string; children: JSX.Element }> = (props) => (
  <section class="flex flex-col gap-3 rounded-xl border border-border-weak-base bg-surface-base p-4">
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong">{props.title}</h3>
      <Show when={props.description}>
        <p class="text-12-regular text-text-weak">{props.description}</p>
      </Show>
    </div>
    {props.children}
  </section>
)

const Row: Component<{ label: string; value?: string | number | boolean | null }> = (props) => (
  <div class="flex items-start justify-between gap-4 py-1.5 border-b border-border-weak-base last:border-b-0">
    <div class="text-13-regular text-text-weak shrink-0">{props.label}</div>
    <div class="text-13-medium text-text-strong text-right break-all">{props.value ?? "—"}</div>
  </div>
)

function shortDigest(value?: string) {
  if (!value) return "—"
  return value.length > 16 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value
}

export function SettingsPowersNexus(props: { directory?: string }) {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const client = createMemo(() =>
    globalSDK.createClient({
      directory: props.directory,
      throwOnError: true,
    }),
  )

  const [version, { refetch }] = createResource(
    () => props.directory ?? "default",
    async () => client().powersnexus.version().then((x) => x.data as PowersnexusVersionResponse),
  )

  const active = createMemo(() => version()?.active)
  const bundled = createMemo(() => version()?.bundled)

  const toastError = (err: unknown) =>
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: err instanceof Error ? err.message : String(err),
    })

  const onCheck = async () => {
    try {
      await client().powersnexus.check({ requestID: `ui-check-${Date.now()}`, channel: "stable" })
      await refetch()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("powersnexus.toast.checkOk" as never),
        description: language.t("powersnexus.toast.checkOkDesc" as never),
      })
    } catch (err) {
      toastError(err)
    }
  }

  const onRollback = async () => {
    const expected = version()?.active.digest
    if (!expected) {
      toastError(new Error(language.t("powersnexus.error.noActive" as never)))
      return
    }
    try {
      await client().powersnexus.rollback({
        requestID: `ui-rollback-${Date.now()}`,
        expectedActiveDigest: expected,
      })
      await refetch()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("powersnexus.toast.rollbackOk" as never),
        description: language.t("powersnexus.toast.rollbackOkDesc" as never),
      })
    } catch (err) {
      toastError(err)
    }
  }

  return (
    <SettingsPage
      title={language.t("settings.powersnexus.title" as never)}
      description={language.t("settings.powersnexus.description" as never)}
    >
      <Show when={version.error}>
        <div class="rounded-lg border border-border-weak-base bg-surface-base px-3 py-2 text-13-regular text-text-weak">
          {version.error instanceof Error ? version.error.message : String(version.error)}
        </div>
      </Show>

      <Section
        title={language.t("settings.powersnexus.active.title" as never)}
        description={language.t("settings.powersnexus.active.description" as never)}
      >
        <Row label={language.t("settings.powersnexus.field.policy" as never)} value={version()?.policy} />
        <Row label={language.t("settings.powersnexus.field.version" as never)} value={active()?.version} />
        <Row label={language.t("settings.powersnexus.field.protocol" as never)} value={active()?.protocolVersion} />
        <Row label={language.t("settings.powersnexus.field.source" as never)} value={active()?.source} />
        <Row label={language.t("settings.powersnexus.field.digest" as never)} value={shortDigest(active()?.digest)} />
        <Row
          label={language.t("settings.powersnexus.field.verified" as never)}
          value={active()?.verified ? language.t("common.yes" as never) : language.t("common.no" as never)}
        />
        <Row
          label={language.t("settings.powersnexus.field.compatible" as never)}
          value={active()?.compatible ? language.t("common.yes" as never) : language.t("common.no" as never)}
        />
        <Row
          label={language.t("settings.powersnexus.field.keyID" as never)}
          value={language.t("settings.powersnexus.field.keyIDValue" as never)}
        />
        <Row label={language.t("settings.powersnexus.field.lastChecked" as never)} value={version()?.lastCheckedAt} />
        <Row label={language.t("settings.powersnexus.field.lastError" as never)} value={version()?.lastErrorCode} />
        <div class="flex flex-wrap gap-2 pt-2">
          <Button size="small" variant="secondary" disabled={version.loading} onClick={() => void refetch()}>
            {language.t("common.refresh" as never)}
          </Button>
          <Button size="small" variant="secondary" disabled={version.loading} onClick={() => void onCheck()}>
            {language.t("settings.powersnexus.action.check" as never)}
          </Button>
          <Button
            size="small"
            variant="ghost"
            disabled={version.loading || !version()?.previous}
            onClick={() => void onRollback()}
          >
            {language.t("settings.powersnexus.action.rollback" as never)}
          </Button>
        </div>
      </Section>

      <Section
        title={language.t("settings.powersnexus.isolation.title" as never)}
        description={language.t("settings.powersnexus.isolation.description" as never)}
      >
        <Row
          label={language.t("settings.powersnexus.isolation.mode" as never)}
          value={language.t("settings.powersnexus.isolation.logical" as never)}
        />
        <Row label={language.t("settings.powersnexus.isolation.network" as never)} value="ask" />
      </Section>

      <Section title={language.t("settings.powersnexus.bundled.title" as never)}>
        <Row label={language.t("settings.powersnexus.field.version" as never)} value={bundled()?.version} />
        <Row label={language.t("settings.powersnexus.field.digest" as never)} value={shortDigest(bundled()?.digest)} />
        <Row
          label={language.t("settings.powersnexus.field.deferred" as never)}
          value={version()?.activationDeferred ? language.t("common.yes" as never) : language.t("common.no" as never)}
        />
      </Section>

      <Show when={version()?.previous}>
        {(prev) => (
          <Section title={language.t("settings.powersnexus.previous.title" as never)}>
            <Row label={language.t("settings.powersnexus.field.version" as never)} value={prev().version} />
            <Row label={language.t("settings.powersnexus.field.source" as never)} value={prev().source} />
            <Row label={language.t("settings.powersnexus.field.digest" as never)} value={shortDigest(prev().digest)} />
          </Section>
        )}
      </Show>

      <Section title={language.t("settings.powersnexus.installed.title" as never)}>
        <Show
          when={(version()?.installed.length ?? 0) > 0}
          fallback={
            <div class="text-13-regular text-text-weak">
              {language.t("settings.powersnexus.installed.empty" as never)}
            </div>
          }
        >
          <div class="flex flex-col gap-2">
            <For each={version()?.installed ?? []}>
              {(item) => (
                <div class="rounded-lg border border-border-weak-base px-3 py-2">
                  <div class="text-13-medium text-text-strong">
                    {item.version} · {item.source}
                  </div>
                  <div class="text-12-regular text-text-weak break-all">{shortDigest(item.digest)}</div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Section>
    </SettingsPage>
  )
}
