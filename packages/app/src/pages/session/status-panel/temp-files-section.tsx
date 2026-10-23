import { For, Show, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { showToast } from "@novaway/ui/toast"
import type { SessionTempFile } from "@novaway/sdk/v2"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { buildTempFilesModel, cleanSummary, formatBytes } from "./temp-files-section-model"
import type { StatusPanelSection } from "./status-panel"

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * 临时文件卡片。
 *
 * AI 在任务里常常写 `tmp-*.mjs`、`debug-*.ts` 这类一次性脚本；工具层会记录它们，
 * 任务结束时服务端也会自动清理（见 session/temp-files.ts）。这张卡是**兜底入口**：
 * 让用户能看到还有哪些残留、以及手动一键清掉。
 */
export function useTempFilesSection(sessionID: () => string): () => StatusPanelSection | null {
  const sdk = useSDK()
  const language = useLanguage()
  const [store, setStore] = createStore({ files: [] as SessionTempFile[], busy: false })

  let inflight = false
  const load = () => {
    const id = sessionID()
    if (!id || inflight) return
    inflight = true
    void sdk.client.session.tempFiles
      .list({ directory: sdk.directory, sessionID: id })
      .then((result) => setStore("files", result.data ?? []))
      .catch(() => undefined)
      .finally(() => {
        inflight = false
      })
  }

  load()
  const timer = setInterval(load, 15_000)
  onCleanup(() => clearInterval(timer))

  const model = createMemo(() => buildTempFilesModel(store.files))

  const clean = (paths?: string[]) => {
    const id = sessionID()
    if (!id) return
    setStore("busy", true)
    void sdk.client.session.tempFiles
      .clean({ directory: sdk.directory, sessionID: id, paths })
      .then((result) => {
        const summary = cleanSummary(result.data ?? { removed: [], skipped: [] })
        load()
        showToast({
          variant: summary.removed > 0 ? "success" : undefined,
          icon: summary.removed > 0 ? "circle-check" : undefined,
          title: language.t("statusPanel.tempFiles.cleaned", { count: summary.removed }),
          description:
            summary.skipped > 0 ? language.t("statusPanel.tempFiles.skipped", { count: summary.skipped }) : undefined,
        })
      })
      .catch((error: unknown) =>
        showToast({ title: language.t("common.requestFailed"), description: messageOf(error) }),
      )
      .finally(() => setStore("busy", false))
  }

  return () => {
    const current = model()
    if (!current) return null

    return {
      id: "temp-files",
      title: language.t("statusPanel.tempFiles.title"),
      summary: (
        <span class="tabular-nums">
          {current.count} · {formatBytes(current.size)}
        </span>
      ),
      defaultOpen: false,
      bodyHeight: "max-h-56",
      children: (
        <div class="flex flex-col gap-0.5 pb-1">
          <div class="flex items-center justify-between gap-2 px-2 pb-1">
            <span class="text-ui-xs text-foreground-subtle">{language.t("statusPanel.tempFiles.hint")}</span>
            <button
              type="button"
              class="shrink-0 rounded-md px-1.5 py-0.5 text-ui-xs text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
              disabled={store.busy}
              onClick={() => clean()}
            >
              {language.t("statusPanel.tempFiles.cleanAll")}
            </button>
          </div>
          <For each={current.files}>
            {(file) => (
              <div class="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 hover:bg-hover">
                <Icon name="code-lines" size="small" class="shrink-0 text-foreground-subtle" />
                <span class="min-w-0 flex-1 truncate font-mono text-ui-xs text-foreground" title={file.path}>
                  {file.relative}
                </span>
                <span class="shrink-0 text-ui-xs tabular-nums text-foreground-subtlest">{formatBytes(file.size)}</span>
                <IconButton
                  icon="trash"
                  variant="ghost"
                  size="small"
                  class="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100"
                  aria-label={language.t("statusPanel.tempFiles.remove")}
                  disabled={store.busy}
                  onClick={() => clean([file.path])}
                />
              </div>
            )}
          </For>
          <Show when={store.files.length > current.files.length}>
            <span class="px-2 text-ui-xs text-foreground-subtlest">
              {language.t("statusPanel.tempFiles.truncated", { count: store.files.length - current.files.length })}
            </span>
          </Show>
        </div>
      ),
    }
  }
}
