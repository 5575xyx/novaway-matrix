// Git 页点文件名打开的"改动差异"标签页:git diff HEAD 的统一补丁直接喂给
// @opentui/core 的 <diff> 渲染器(和主差异查看器同一套配色/语法高亮)。
// 加载逻辑(含未跟踪文件的合成补丁)在 util/git-diff,与 GitWorkspace 的差异面板共用。
import { createSignal, onMount, Show } from "solid-js"
import type { DiffRenderable } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useAutoRefresh } from "../util/auto-refresh"
import { loadFilePatch } from "../util/git-diff"
import { Locale } from "../util/locale"

export interface GitDiffViewProps {
  filePath: string
  rootPath?: string
  onClose: () => void
}

export function GitDiffView(props: GitDiffViewProps) {
  const { theme, syntax } = useTheme()
  const [patch, setPatch] = createSignal<string | null>(null)
  const [error, setError] = createSignal("")

  const load = async () => {
    const cwd = props.rootPath
    if (!cwd) return
    try {
      setPatch(await loadFilePatch(cwd, props.filePath))
      setError("")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  onMount(() => void load())
  // 文件在工作区被继续编辑时跟着刷新;切走标签页组件卸载,轮询自动停。
  useAutoRefresh(load)

  let diffRef: DiffRenderable | undefined
  void diffRef

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} paddingTop={1} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" justifyContent="space-between" paddingBottom={1} flexShrink={0}>
        <text fg={theme.primary} wrapMode="none">
          {Locale.oneLine(props.filePath.split(/[\\/]/).pop() ?? props.filePath, 40)} 的改动
        </text>
        <text fg={theme.textMuted} onMouseUp={props.onClose}>
          [X] 关闭
        </text>
      </box>
      <Show when={!error()} fallback={<text fg={theme.error}>{error()}</text>}>
        <Show when={patch()} fallback={<text fg={theme.textMuted}>没有未提交的改动</text>}>
          <box flexGrow={1} minHeight={0} backgroundColor={theme.backgroundPanel}>
            <diff
              ref={(el: DiffRenderable) => (diffRef = el)}
              diff={patch()!}
              view="unified"
              filetype="none"
              syntaxStyle={syntax()}
              showLineNumbers={true}
              width="100%"
              height="100%"
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
          </box>
        </Show>
      </Show>
    </box>
  )
}
