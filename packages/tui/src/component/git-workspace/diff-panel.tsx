// 工作区右侧的差异视图。内容跟着左列焦点行变:文件 → 文件 diff,提交 → 提交 diff。
//
// 与 component/git-diff-view.tsx 的分工:那个是**独立标签页**(带关闭按钮、自己轮询),
// 这个是工作区里的一个**面板**(占右半边、由工作区统一刷新),所以这里不轮询。
import { type ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createSignal, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { loadBranchPatch, loadCommitPatch, loadFilePatch } from "../../util/git-diff"
import { Locale } from "../../util/locale"

export type DiffTarget =
  | { kind: "none" }
  | { kind: "file"; path: string }
  | { kind: "commit"; hash: string }
  | { kind: "branch"; name: string }

export interface GitDiffPanelProps {
  target: DiffTarget
  rootPath?: string
  /** 当前分支名。分支差异用它做基准(`cur...name` 三点差异,见 loadBranchPatch)。 */
  currentBranch?: string
  /** 滚动容器。外壳在差异激活模式下按 j/k/pgup/pgdn 调它,面板自己不动键位。 */
  scrollRef?: (element: ScrollBoxRenderable | null) => void
}

export function GitDiffPanel(props: GitDiffPanelProps) {
  const { theme, syntax } = useTheme()
  const [patch, setPatch] = createSignal("")
  const [error, setError] = createSignal("")

  // createEffect 而不是 onMount:rootPath 来自 session()?.directory,mount 那一刻可能还没就绪。
  // 这正是提交详情标签页踩过的坑(见 component/git-commit-view.tsx),别再踩一次。
  //
  // loadSeq 是世代计数器:target 变快时(比如连按 enter 换文件)会有多个 git 子进程在飞,
  // 先发的可能后回来。没有它,旧文件的 diff 会盖掉新文件的 —— 最糟的一种是 target 已经
  // 回到 none、引导文案都出来了,却被早先那个大 diff 顶掉。取 ui/dialog-select.tsx 的同款写法。
  let loadSeq = 0
  createEffect(() => {
    const seq = ++loadSeq
    const cwd = props.rootPath
    const target = props.target
    if (!cwd || target.kind === "none") {
      setPatch("")
      setError("")
      return
    }
    // 旧的错误不能挂在新标题下面;patch 保留当占位,新结果到了再换(lazygit 同款行为)。
    setError("")
    const load =
      target.kind === "file"
        ? loadFilePatch(cwd, target.path)
        : target.kind === "commit"
          ? loadCommitPatch(cwd, target.hash)
          : loadBranchPatch(cwd, target.name, props.currentBranch)
    load
      .then((body) => {
        if (seq !== loadSeq) return
        setPatch(body)
        setError("")
      })
      .catch((e: unknown) => {
        if (seq !== loadSeq) return
        setError(e instanceof Error ? e.message : String(e))
      })
  })

  const title = () => {
    const target = props.target
    if (target.kind === "file") {
      const base = target.path.split(/[\\/]/).pop() ?? target.path
      return `${Locale.oneLine(base, 40)} 的改动`
    }
    if (target.kind === "commit") return `提交 ${target.hash}`
    if (target.kind === "branch") return `分支 ${Locale.truncateToWidth(target.name, 32)}`
    return "差异"
  }

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <box flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1} paddingTop={1}>
        <text fg={theme.primary} wrapMode="none">
          {title()}
        </text>
      </box>
      <Show
        when={!error()}
        fallback={
          // ⚠️ paddingLeft 必须写在 <box> 上 —— 写在 <text> 上在 opentui 里无效(见 status-panel.tsx 头注释)。
          <box paddingLeft={1}>
            <text fg={theme.error}>{error()}</text>
          </box>
        }
      >
        <Show
          when={patch()}
          fallback={
            <box paddingLeft={1}>
              <text fg={theme.textMuted}>
                {props.target.kind === "none" ? "选中文件或提交后在这里看改动" : "没有改动"}
              </text>
            </box>
          }
        >
          {/* 包一层滚动容器:差异一大就装不下,没它只能看到第一屏。
              容器本身不画滚动条(默认只在「内容超出」时自动显示),也不接焦点 ——
              键位由外壳在差异激活模式下统一处理(见 git-workspace.tsx 的 scrollDiffBy)。 */}
          <scrollbox
            ref={(element: ScrollBoxRenderable | null) => props.scrollRef?.(element)}
            flexGrow={1}
            minHeight={0}
            backgroundColor={theme.backgroundPanel}
          >
            {/* 配色属性必须照抄 component/git-diff-view.tsx 那份 —— 少传任何一个,那一项就退回
                @opentui 默认色,和同一个主题下的其它 diff 视图对不上。
                刻意**没有** height="100%":在滚动容器里那是「等于视口高度」,内容永远撑不满,
                大 diff 只能看到第一屏且滚不动。 */}
            <diff
              diff={patch()}
              view="unified"
              filetype="none"
              syntaxStyle={syntax()}
              showLineNumbers={true}
              width="100%"
              wrapMode="none"
              fg={theme.text}
              addedBg={theme.diffAddedBg}
              removedBg={theme.diffRemovedBg}
              addedSignColor={theme.diffHighlightAdded}
              removedSignColor={theme.diffHighlightRemoved}
              lineNumberFg={theme.diffLineNumber}
              addedLineNumberBg={theme.diffAddedLineNumberBg}
              removedLineNumberBg={theme.diffRemovedLineNumberBg}
            />
          </scrollbox>
        </Show>
      </Show>
    </box>
  )
}
