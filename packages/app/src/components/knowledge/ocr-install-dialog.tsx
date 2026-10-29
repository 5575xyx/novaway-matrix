import type { KnowledgeOcrInstallJob, KnowledgeOcrStatus } from "@novaway/sdk/v2"
import { Button } from "@novaway/ui/button"
import { useDialog } from "@novaway/ui/context/dialog"
import { Dialog } from "@novaway/ui/dialog"
import { Icon } from "@novaway/ui/icon"
import { showToast } from "@novaway/ui/toast"
import { For, Show, createSignal, onCleanup, type Component } from "solid-js"
import { AiFixButton } from "@/components/ai-fix-button"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"

const STEPS: Array<{ phase: string; label: string }> = [
  { phase: "detect", label: "knowledge.ocr.install.step.detect" },
  { phase: "venv", label: "knowledge.ocr.install.step.venv" },
  { phase: "pip", label: "knowledge.ocr.install.step.pip" },
  { phase: "verify", label: "knowledge.ocr.install.step.verify" },
  { phase: "done", label: "knowledge.ocr.install.step.done" },
]

const ORDER = ["detect", "venv", "pip", "verify", "done"]
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * OCR 一键安装。
 *
 * 用户只需要点一次「安装」：后端在 NovaWay 数据目录下的 `ocr/venv` 里建独立环境并安装依赖，
 * 不污染系统 Python，也不需要用户自己执行任何命令。
 *
 * 另外提供「让 AI 帮我装」：把当前状态、错误与日志交给新会话，
 * 由 Agent 用自己的终端工具在真实机器上排查（适合代理、自建 Python、权限受限等特殊情况）。
 */
export const OcrInstallDialog: Component<{
  directory: () => string
  status: () => KnowledgeOcrStatus | undefined
  onInstalled: () => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useGlobalSDK()
  const [job, setJob] = createSignal<KnowledgeOcrInstallJob>()
  const [starting, setStarting] = createSignal(false)
  const [showLog, setShowLog] = createSignal(false)
  let timer: number | undefined

  const stop = () => {
    if (timer !== undefined) window.clearInterval(timer)
    timer = undefined
  }
  onCleanup(stop)

  const install = () => {
    setStarting(true)
    void sdk.client.knowledge.ocr2
      .install({ directory: props.directory(), reinstall: props.status()?.kind === "rapid" })
      .then((result) => {
        const id = result.data?.jobID
        if (!id) return
        const track = () => {
          void sdk.client.knowledge
            .ocrInstallJob({ directory: props.directory(), jobID: id })
            .then((current) => {
              const value = current.data ?? undefined
              setJob(value)
              if (!value) return stop()
              if (value.status === "running") return
              stop()
              setStarting(false)
              if (value.status === "completed") {
                props.onInstalled()
                showToast({
                  variant: "success",
                  icon: "circle-check",
                  title: language.t("knowledge.ocr.install.success"),
                })
                dialog.close()
                return
              }
              if (value.status === "cancelled") return
              showToast({
                title: language.t("knowledge.ocr.install.failed"),
                description: value.error ?? value.hint ?? undefined,
              })
            })
            .catch(() => stop())
        }
        track()
        timer = window.setInterval(track, 1200)
      })
      .catch((error) => showToast({ title: language.t("common.requestFailed"), description: messageOf(error) }))
      .finally(() => setStarting(false))
  }

  const cancel = () => {
    const current = job()
    if (!current) return
    void sdk.client.knowledge
      .cancelOcrInstall({ directory: props.directory(), jobID: current.id })
      .catch(() => undefined)
  }

  const running = () => starting() || job()?.status === "running"
  const currentPhase = () => job()?.phase ?? (starting() ? "detect" : "")
  const indexOfPhase = (phase: string) => ORDER.indexOf(phase)

  return (
    <Dialog title={language.t("knowledge.ocr.install.title")} transition class="w-[min(calc(100vw-40px),560px)]">
      <div class="flex flex-col gap-4 px-2.5 pb-3">
        <div class="flex items-start gap-3 rounded-lg border border-border bg-surface/40 p-3">
          <span
            class="grid size-9 shrink-0 place-items-center rounded-lg"
            style={{ color: "#10b981", background: "color-mix(in srgb, #10b981 16%, transparent)" }}
          >
            <Icon name="eye" size="normal" />
          </span>
          <div class="flex min-w-0 flex-col gap-1">
            <span class="text-13-medium text-foreground">
              {props.status()?.kind === "rapid"
                ? language.t("knowledge.ocr.install.current", {
                    label: props.status()?.label ?? "RapidOCR",
                  })
                : language.t("knowledge.ocr.install.intro")}
            </span>
            <span class="text-12-regular leading-5 text-foreground-subtle">
              {language.t("knowledge.ocr.install.detail")}
            </span>
          </div>
        </div>

        <Show when={running() || job()}>
          <ol class="flex flex-col gap-1.5">
            <For each={STEPS}>
              {(step) => {
                const active = () => currentPhase() === step.phase
                const done = () =>
                  indexOfPhase(currentPhase()) > indexOfPhase(step.phase) ||
                  (job()?.status === "completed" && step.phase === "done")
                return (
                  <li class="flex items-center gap-2 text-12-regular">
                    <Show
                      when={done()}
                      fallback={
                        <span
                          class="grid size-4 shrink-0 place-items-center rounded-full border"
                          classList={{
                            "border-[var(--icon-blue)]": active(),
                            "border-border": !active(),
                          }}
                        >
                          <Show when={active()}>
                            <span class="size-1.5 novaway-breathe-dot rounded-full bg-[var(--icon-blue)]" />
                          </Show>
                        </span>
                      }
                    >
                      <Icon name="circle-check" size="small" class="shrink-0 text-success" />
                    </Show>
                    <span
                      classList={{
                        "text-foreground": active() || done(),
                        "text-foreground-subtle": !active() && !done(),
                      }}
                    >
                      {language.t(step.label as never)}
                    </span>
                  </li>
                )
              }}
            </For>
          </ol>
        </Show>

        <Show when={job()?.message || job()?.error || job()?.hint}>
          <div class="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
            <Show when={job()?.message}>
              {(value) => <span class="text-12-regular text-foreground">{value()}</span>}
            </Show>
            <Show when={job()?.error}>
              {(value) => <span class="text-12-regular text-destructive">{value()}</span>}
            </Show>
            <Show when={job()?.hint}>
              {(value) => <span class="text-11-regular leading-5 text-foreground-subtle">{value()}</span>}
            </Show>
          </div>
        </Show>

        <Show when={job()?.log}>
          {(value) => (
            <div class="flex flex-col gap-1">
              <button
                type="button"
                class="self-start text-11-regular text-foreground-subtle transition-colors hover:text-foreground"
                onClick={() => setShowLog((current) => !current)}
              >
                {language.t(showLog() ? "knowledge.ocr.install.hideLog" : "knowledge.ocr.install.showLog")}
              </button>
              <Show when={showLog()}>
                <pre class="max-h-40 overflow-auto rounded-lg bg-surface p-2 font-mono text-11-regular leading-4 text-foreground-subtle">
                  {value()}
                </pre>
              </Show>
            </div>
          )}
        </Show>

        <Show when={!running()}>
          <span class="text-11-regular leading-5 text-foreground-subtle">
            {language.t("knowledge.ocr.install.askAiHint")}
          </span>
        </Show>

        <div class="flex flex-wrap items-center justify-between gap-2">
          <AiFixButton
            promptKey="knowledge.ocr.install.askAiPrompt"
            label={language.t("knowledge.ocr.install.askAi")}
            disabled={running()}
            params={{ label: props.status()?.label ?? language.t("knowledge.ocr.install.intro") }}
            context={() => ({ error: job()?.error, hint: job()?.hint, log: job()?.log })}
            onBeforeAsk={() => dialog.close()}
          />
          <div class="flex items-center gap-2">
            <Show
              when={running()}
              fallback={
                <Button variant="secondary" onClick={() => dialog.close()}>
                  {language.t("common.close")}
                </Button>
              }
            >
              <Button variant="secondary" onClick={cancel} disabled={!job()}>
                {language.t("knowledge.ocr.install.cancel")}
              </Button>
            </Show>
            <Button onClick={install} disabled={running()}>
              {running()
                ? language.t("knowledge.ocr.install.running")
                : props.status()?.kind === "rapid"
                  ? language.t("knowledge.ocr.install.reinstall")
                  : language.t("knowledge.ocr.install.action")}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
