import { createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@novaway/ui/icon"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { num, useGitSnapshot, type Snapshot } from "../git-panel"
import type { StatusPanelSection } from "./status-panel"

const messageInputClass =
  "h-7 flex-1 min-w-0 rounded-md border border-border-weak-base bg-input-base px-2 text-ui-sm " +
  "text-text-strong placeholder:text-text-weak outline-none focus:border-border-interactive-base"

// 没有行数变更就不产出区块：干净仓库、非 git 仓库（快照为空）都不占面板位置。
export function buildGitSectionModel(snapshot: Snapshot | undefined): {
  added: number
  removed: number
  branch: string | null
  dirty: number
} | null {
  if (!snapshot) return null

  const changes = snapshot.changes
  const added = changes.reduce((sum, change) => sum + num(change.additions), 0)
  const removed = changes.reduce((sum, change) => sum + num(change.deletions), 0)
  if (added + removed <= 0) return null

  const dirty = new Set(changes.map((change) => change.file)).size
  return { added, removed, branch: snapshot.branch.branch ?? null, dirty }
}

// 区块描述符由调用方的 memo 驱动：model 为 null 时该区块整体不进 sections，面板随之不挂载。
// 这里刻意不用 Kobalte 承载的 Button/TextField——它们的模块作用域会触碰客户端 API，
// 使 git-section.test.ts 无法以纯逻辑方式 import 本文件；设计系统样式本就由 data-* 属性驱动。
export function useGitSection(): () => StatusPanelSection | null {
  const language = useLanguage()
  const layout = useLayout()
  const git = useGitSnapshot()
  const [store, setStore] = createStore({ message: "" })

  const model = createMemo(() => buildGitSectionModel(git.snapshot()))
  const ahead = createMemo(() => num(git.snapshot()?.branch.ahead))
  const behind = createMemo(() => num(git.snapshot()?.branch.behind))
  const canCommit = () => !git.busy() && store.message.trim().length > 0

  const commit = () => {
    const message = store.message.trim()
    if (!message || git.busy()) return
    void git.commit(message).then(() => setStore("message", ""))
  }

  return () => {
    const current = model()
    if (!current) return null

    return {
      id: "git",
      title: language.t("git.title"),
      summary: (
        <span>
          <span class="text-success-base">+{current.added}</span>{" "}
          <span class="text-error-base">-{current.removed}</span>
        </span>
      ),
      children: (
        <div class="flex flex-col gap-0.5 px-3 pb-2">
          <button
            type="button"
            data-action="status-panel-git-review"
            class="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-surface-raised-base-hover"
            onClick={() => layout.sidePane.add("review")}
          >
            <span class="text-ui-sm text-text-weak shrink-0">{language.t("git.unstaged")}</span>
            <span class="ml-auto text-ui-sm tabular-nums">
              <span class="text-success-base">+{current.added}</span>{" "}
              <span class="text-error-base">-{current.removed}</span>
            </span>
          </button>

          <div class="flex items-center gap-1.5 px-1.5 py-1">
            <Icon name="branch" size="small" class="text-icon-base shrink-0" />
            <span class="text-ui-sm text-text-strong min-w-0 truncate">
              {current.branch ?? language.t("git.noBranch")}
            </span>
            <Show when={ahead() > 0 || behind() > 0}>
              <span class="text-ui-sm tabular-nums text-text-weak shrink-0">
                <Show when={ahead() > 0}>
                  <span class="text-success-base">↑{ahead()}</span>
                </Show>
                <Show when={behind() > 0}>
                  <span class="text-warning-base">↓{behind()}</span>
                </Show>
              </span>
            </Show>
          </div>

          <div class="flex items-center gap-1.5 px-1.5 py-1">
            <input
              type="text"
              value={store.message}
              onInput={(event) => setStore("message", event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                commit()
              }}
              disabled={git.busy()}
              placeholder={language.t("git.commitPlaceholder")}
              data-component="status-panel-git-message"
              class={messageInputClass}
            />
            <button
              type="button"
              data-component="button"
              data-variant="primary"
              data-size="small"
              data-action="status-panel-git-commit"
              disabled={!canCommit()}
              class="shrink-0"
              onClick={commit}
            >
              {language.t("git.commit")}
            </button>
          </div>
        </div>
      ),
    }
  }
}
