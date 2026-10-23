import { createMemo, For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@novaway/ui/button"
import { useDialog } from "@novaway/ui/context/dialog"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Icon } from "@novaway/ui/icon"
import { Popover } from "@novaway/ui/popover"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { GitGraphDialog } from "../git-graph"
import { useGitSnapshot } from "../git-panel"
import { buildGitSectionModel, gitSectionStat, type GitSectionModel } from "./git-section-model"
import type { StatusPanelSection } from "./status-panel"

// 纯逻辑在 git-section-model.ts（见那里的注释）；这里 re-export，保持既有 import 路径可用。
export { buildGitSectionModel, gitSectionStat, type GitSectionModel, type GitSectionStat } from "./git-section-model"

const messageInputClass =
  "h-7 flex-1 min-w-0 rounded-md border border-border bg-input px-2 text-ui-sm " +
  "text-foreground placeholder:text-foreground-subtle outline-none focus:border-primary"

// 区块描述符由调用方的 memo 驱动：model 为 null 时该区块整体不进 sections，面板随之不挂载。
// 这里刻意不用 Kobalte 承载的 Button/TextField——它们的模块作用域会触碰客户端 API，
// 使 git-section.test.ts 无法以纯逻辑方式 import 本文件；设计系统样式本就由 data-* 属性驱动。
export function useGitSection(): () => StatusPanelSection | null {
  const language = useLanguage()
  const layout = useLayout()
  const dialog = useDialog()
  const git = useGitSnapshot()
  const [store, setStore] = createStore({ message: "", newBranch: "" })

  const model = createMemo(() => buildGitSectionModel(git.snapshot()))
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
        <span class="text-success-base">+{stat.added}</span> <span class="text-error-base">-{stat.removed}</span>
      </span>
    )
  }

  return () => {
    const current = model()
    if (!current) return null

    return {
      id: "git",
      // 对齐 ZCode 的 `chat.statusPanel.environment`：标题是「Git 工具」。
      title: language.t("git.toolsTitle"),
      summary: current.clean ? <span>{language.t("git.noChanges")}</span> : diffStat(current),
      children: (
        <div class="flex flex-col gap-0.5 pb-1">
          {/* 「更改」行：整行可点，打开审查面板 —— 对齐 ZCode 的 Changes 行
              （同一个文件 diff 图标 + 右侧 +N -M）。
              「全部暂存 / 取消暂存」是我们多出的能力，压成右侧的小文字按钮，
              不额外占一行。原来这里是「已暂存 / 未暂存」两行、各带一组按钮，
              和 ZCode 的一行 Changes 差得比较远。 */}
          <div class="flex items-center gap-1">
            <button
              type="button"
              data-action="status-panel-git-changes"
              class="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-ui-base text-foreground transition-colors hover:bg-hover"
              onClick={() => layout.sidePane.add("review")}
            >
              <Icon name="code-lines" size="small" class="shrink-0 text-foreground" />
              <span class="min-w-0 flex-1 truncate">{language.t("git.changes")}</span>
              <span class="shrink-0 font-mono tabular-nums">
                <span class="text-[var(--diff-added)]">+{current.added}</span>{" "}
                <span class="text-[var(--diff-removed)]">-{current.removed}</span>
              </span>
            </button>
            <Show when={current.unstaged.length > 0}>
              <button
                type="button"
                class="shrink-0 rounded-md px-1.5 py-1 text-ui-xs text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                title={language.t("git.stageAll")}
                onClick={() => void git.stage(current.unstaged)}
              >
                {language.t("git.stageAll")}
              </button>
            </Show>
            <Show when={current.unstaged.length === 0 && current.staged.length > 0}>
              <button
                type="button"
                class="shrink-0 rounded-md px-1.5 py-1 text-ui-xs text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                title={language.t("git.unstageAll")}
                onClick={() => void git.unstage(current.staged)}
              >
                {language.t("git.unstageAll")}
              </button>
            </Show>
          </div>

          {/* 分支行整行是切换菜单（对齐 ZCode 的 GitBranchSwitcher）：列出全部分支、
              当前分支打勾、底部可直接新建分支并切过去。旧版这行只是个只读文本。 */}
          <DropdownMenu>
            <DropdownMenu.Trigger
              as="button"
              type="button"
              data-action="status-panel-git-branch"
              class="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-ui-base text-foreground transition-colors hover:bg-hover"
            >
              <Icon name="branch" size="small" class="shrink-0 text-foreground" />
              <span class="min-w-0 flex-1 truncate">{current.branch ?? language.t("git.noBranch")}</span>
              <Show when={current.ahead > 0 || current.behind > 0}>
                <span class="shrink-0 text-ui-sm tabular-nums text-foreground-subtle">
                  <Show when={current.ahead > 0}>
                    <span class="text-success">↑{current.ahead}</span>
                  </Show>
                  <Show when={current.behind > 0}>
                    <span class="text-warning">↓{current.behind}</span>
                  </Show>
                </span>
              </Show>
              <Icon name="chevron-down" size="small" class="text-foreground-subtlest shrink-0" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="w-60 max-h-72 no-scrollbar">
                <DropdownMenu.Group>
                  <DropdownMenu.GroupLabel>{language.t("git.branch.switch")}</DropdownMenu.GroupLabel>
                  <For each={current.branches}>
                    {(name) => (
                      <DropdownMenu.Item
                        disabled={name === current.branch || git.busy()}
                        onSelect={() => {
                          if (name === current.branch) return
                          void git.checkout(name)
                        }}
                      >
                        <DropdownMenu.ItemLabel>{name}</DropdownMenu.ItemLabel>
                        <Show when={name === current.branch}>
                          <DropdownMenu.ItemIndicator>
                            <Icon name="check-small" size="small" class="text-foreground-subtle" />
                          </DropdownMenu.ItemIndicator>
                        </Show>
                      </DropdownMenu.Item>
                    )}
                  </For>
                </DropdownMenu.Group>
                <DropdownMenu.Separator />
                <div class="flex items-center gap-1 p-1">
                  <input
                    type="text"
                    value={store.newBranch}
                    onInput={(event) => setStore("newBranch", event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return
                      event.preventDefault()
                      const name = store.newBranch.trim()
                      if (!name) return
                      void git.createBranch(name).then((ok) => {
                        if (ok) setStore("newBranch", "")
                      })
                    }}
                    placeholder={language.t("git.branch.newPlaceholder")}
                    class="h-7 min-w-0 flex-1 rounded-md border border-input-border bg-input px-2 text-ui-sm text-foreground placeholder:text-foreground-subtlest outline-none"
                  />
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={!store.newBranch.trim() || git.busy()}
                    onClick={() => {
                      const name = store.newBranch.trim()
                      if (!name) return
                      void git.createBranch(name).then((ok) => {
                        if (ok) setStore("newBranch", "")
                      })
                    }}
                  >
                    {language.t("git.branch.create")}
                  </Button>
                </div>
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  data-action="status-panel-git-graph"
                  onSelect={() =>
                    dialog.show(() => (
                      <GitGraphDialog commits={git.snapshot()?.log ?? []} title={language.t("git.graph.title")} />
                    ))
                  }
                >
                  <Icon name="branch" size="small" class="text-foreground-subtle" />
                  <DropdownMenu.ItemLabel>{language.t("git.graph")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>

          {/* 「同步」行：拉取 / 获取 / 合并这三个高频操作不该藏在分支菜单里。 */}
          <div class="flex items-center gap-1 px-2 py-1">
            <Icon name="refresh" size="small" class="mr-1 shrink-0 text-foreground" />
            <span class="mr-auto text-ui-base text-foreground">{language.t("git.sync")}</span>
            <button
              type="button"
              class="rounded-md px-1.5 py-1 text-ui-xs text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
              disabled={git.busy()}
              onClick={() => void git.fetch()}
            >
              {language.t("git.fetch")}
            </button>
            <button
              type="button"
              class="rounded-md px-1.5 py-1 text-ui-xs text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
              disabled={git.busy()}
              onClick={() => void git.pull()}
            >
              {language.t("git.pull")}
            </button>
            <DropdownMenu>
              <DropdownMenu.Trigger
                as="button"
                type="button"
                class="rounded-md px-1.5 py-1 text-ui-xs text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
                disabled={git.busy() || current.branches.length === 0}
              >
                {language.t("git.merge")}
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content class="max-h-72 no-scrollbar">
                  <DropdownMenu.Group>
                    <DropdownMenu.GroupLabel>
                      {language.t("git.merge.into", { branch: current.branch ?? "" })}
                    </DropdownMenu.GroupLabel>
                    <For each={current.branches.filter((name) => name !== current.branch)}>
                      {(name) => (
                        <DropdownMenu.Item onSelect={() => void git.merge(name)}>
                          <DropdownMenu.ItemLabel>{name}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                      )}
                    </For>
                  </DropdownMenu.Group>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>
          </div>
          {/* 「提交或推送」行（对齐 ZCode 的 GitActionMenu status-row 形态）：
              整行是主操作入口，提交信息在点开后的浮层里填，不再常驻占一行。 */}
          <Popover
            gutter={6}
            triggerAs="button"
            triggerProps={
              {
                type: "button",
                // data-* 不在 ButtonHTMLAttributes 的类型里，但 popover 会原样透传到元素上
                // （e2e 用这个钩子定位主操作入口）。
                "data-action": "status-panel-git-commit-or-push",
                class:
                  "flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-ui-base text-foreground transition-colors hover:bg-hover",
              } as Record<string, unknown>
            }
            trigger={
              <>
                <Icon name="arrow-up" size="small" class="shrink-0 text-foreground" />
                <span class="min-w-0 flex-1 truncate">{language.t("git.commitOrPush")}</span>
              </>
            }
            class="w-72"
          >
            <div class="flex flex-col gap-2">
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
              <div class="flex items-center gap-1.5">
                {/* 主操作按仓库状态切换，对齐 ZCode 的 GitActionMenu：有未推送就先给推送，
                    否则给提交；提交信息为空时提交按钮保持禁用。 */}
                <Show
                  when={store.message.trim().length > 0 || current.ahead === 0}
                  fallback={
                    <Button
                      variant="primary"
                      size="small"
                      data-action="status-panel-git-push"
                      disabled={git.busy()}
                      class="shrink-0"
                      onClick={() => void git.push()}
                    >
                      {language.t("git.push")}
                    </Button>
                  }
                >
                  <Button
                    variant="primary"
                    size="small"
                    data-action="status-panel-git-commit"
                    disabled={!canCommit()}
                    class="shrink-0"
                    onClick={commit}
                  >
                    {language.t("git.commit")}
                  </Button>
                </Show>
              </div>
              <Show when={git.error()}>
                <div class="text-ui-xs text-destructive break-words">{git.error()}</div>
              </Show>
            </div>
          </Popover>
        </div>
      ),
    }
  }
}
