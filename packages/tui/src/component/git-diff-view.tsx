// Git 页点文件名打开的"改动差异"标签页:git diff HEAD 的统一补丁直接喂给
// @opentui/core 的 <diff> 渲染器(和主差异查看器同一套配色/语法高亮)。
// 未跟踪文件没有 diff 输出,这里合成一份"全新文件"补丁,照样能看到内容。
import { createSignal, onMount, Show } from "solid-js"
import type { DiffRenderable } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useAutoRefresh } from "../util/auto-refresh"
import { gitExec } from "../util/git-exec"
import { Locale } from "../util/locale"
import { readFileSync, statSync } from "node:fs"

// 合成补丁最多带多少行正文:未跟踪的大文件(构建产物)不把标签页撑爆。
const SYNTH_DIFF_MAX_LINES = 400

function untrackedPatch(filePath: string, rootPath: string): string {
  try {
    if (statSync(filePath).size > 1024 * 1024) return ""
    const lines = readFileSync(filePath, "utf-8").split("\n")
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
    const shown = lines.slice(0, SYNTH_DIFF_MAX_LINES)
    return [
      `diff --git a/${filePath} b/${filePath}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${filePath}`,
      `@@ -0,0 +1,${shown.length} @@`,
      ...shown.map((line) => `+${line}`),
    ].join("\n")
  } catch {
    return ""
  }
}

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
      // HEAD 对比:已暂存 + 未暂存的改动一起看,和"这次提交会带上什么"一致。
      const out = await gitExec(cwd, ["diff", "HEAD", "--no-color", "--", props.filePath])
      const body = out.stdout.trimEnd()
      if (body) {
        setPatch(body)
      } else {
        // 空 diff 只有两种可能:未跟踪的新文件,或改动已全部提交(内容 == HEAD)。
        setPatch(untrackedPatch(props.filePath, cwd))
      }
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
