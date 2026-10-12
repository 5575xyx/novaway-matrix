import { createMemo, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@novaway/ui/icon"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { num, useGitSnapshot, type Snapshot } from "../git-panel"
import type { StatusPanelSection } from "./status-panel"

const messageInputClass =
  "h-7 flex-1 min-w-0 rounded-md border border-border-weak-base bg-input-base px-2 text-ui-sm " +
  "text-text-strong placeholder:text-text-weak outline-none focus:border-border-interactive-base"

type GitSectionModel = {
  added: number
  removed: number
  branch: string | null
  dirty: number
}

type GitSectionStat =
  | { kind: "diff"; added: number; removed: number }
  | { kind: "files"; files: number }

// 用变更条数判定干净与否：二进制文件与纯重命名在快照里 additions/deletions 恒为 0，
// 按行数判定会让只改了图片或只做了 rename 的工作区整个面板不出现（连提交输入框都没有）。
export function buildGitSectionModel(snapshot: Snapshot | undefined): GitSectionModel | null {
  if (!snapshot) return null

  const changes = snapshot.changes
  if (changes.length === 0) return null

  const added = changes.reduce((sum, change) => sum + num(change.additions), 0)
  const removed = changes.reduce((sum, change) => sum + num(change.deletions), 0)
  const dirty = new Set(changes.map((change) => change.file)).size
  return { added, removed, branch: snapshot.branch.branch ?? null, dirty }
}

// 行数为 0 时改报文件数，避免摘要和 Changes 行显示成 "+0 -0" 这种空 diff。
export function gitSectionStat(model: Pick<GitSectionModel, "added" | "removed" | "dirty">): GitSectionStat {
  return model.added + model.removed > 0
    ? { kind: "diff", added: model.added, removed: model.removed }
    : { kind: "files", files: model.dirty }
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
    // act() 失败也 resolve（错误落在 git.error() 里），所以只在成功标志为真时清空输入框，
    // 否则一次失败的提交会把用户写好的提交信息一并抹掉。
    void git.commit(message).then((ok) => {
      if (ok) setStore("message", "")
    })
  }

  const diffStat = (current: GitSectionModel): JSX.Element => {
    const stat = gitSectionStat(current)
    if (stat.kind === "files") {
      return <span>{language.t("session.review.filesChanged", { count: stat.files })}</span>
    }
    return (
      <span>
        <span class="text-success-base">+{stat.added}</span>{" "}
        <span class="text-error-base">-{stat.removed}</span>
      </span>
    )
  }

  return () => {
    const current = model()
    if (!current) return null

    return {
      id: "git",
      title: language.t("git.title"),
      summary: diffStat(current),
      children: (
        <div class="flex flex-col gap-0.5 px-3 pb-2">
          <button
            type="button"
            data-action="status-panel-git-review"
            class="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-surface-raised-base-hover"
            onClick={() => layout.sidePane.add("review")}
          >
            <span class="text-ui-sm text-text-weak shrink-0">{language.t("git.unstaged")}</span>
            <span class="ml-auto text-ui-sm tabular-nums">{diffStat(current)}</span>
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
