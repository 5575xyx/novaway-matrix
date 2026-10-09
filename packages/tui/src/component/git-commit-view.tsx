// Git 页点提交行打开的"提交详情"标签页。原来是 DialogAlert 弹窗:大提交的 --stat 清单
// 被截到 40 行,弹窗宽度也只有侧栏那几列,读起来非常憋屈。改成和文件预览一样在主区占一个
// 标签页 —— 主区有整屏宽度,而且这个视图本来就是只读的,不需要弹窗那套确认/关闭语义
// (标签页自带 ✕)。
//
// 内容 = git show 的元信息(hash / 作者 / 日期 / 主题)+ --stat 文件清单。不带补丁正文:
// 那一档交给 GitDiffView(点提交里那个文件名走的是它,见 git-panel 的 FileRow)。
import { createSignal, For, onMount, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { gitExec } from "../util/git-exec"
import { Locale } from "../util/locale"

// 大提交(一次改上百个文件)的 --stat 清单封顶。主区有整屏可用,比弹窗那个 40 行宽裕得多。
const STAT_MAX = 200

export interface GitCommitViewProps {
  commitHash: string
  rootPath?: string
  onClose: () => void
}

/** git show 输出拆成「元信息」与「文件清单」两段(清单段以空行开头)。 */
export function splitCommitShow(output: string) {
  const lines = output.trimEnd().split("\n")
  const statStart = lines.findIndex((line) => line.trim() === "")
  if (statStart === -1) return { meta: lines, files: [] as string[] }
  return { meta: lines.slice(0, statStart), files: lines.slice(statStart + 1).filter((line) => line !== "") }
}

export function GitCommitView(props: GitCommitViewProps) {
  const { theme } = useTheme()
  const [meta, setMeta] = createSignal<string[]>([])
  const [files, setFiles] = createSignal<string[]>([])
  const [overflow, setOverflow] = createSignal(0)
  const [error, setError] = createSignal("")

  const load = async () => {
    if (!props.rootPath) return
    try {
      const out = await gitExec(props.rootPath, [
        "show",
        props.commitHash,
        "--stat",
        "--no-color",
        "--format=%h  %an  %ad%n%s%n",
      ])
      const parsed = splitCommitShow(out.stdout)
      setMeta(parsed.meta)
      setFiles(parsed.files.slice(0, STAT_MAX))
      setOverflow(Math.max(0, parsed.files.length - STAT_MAX))
      setError("")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  onMount(() => void load())

  // 元信息第 1 行是「hash  作者  日期」、第 2 行是主题 —— 这两行单独着色,其余按原文。
  const head = () => meta()[0] ?? ""
  const subject = () => meta()[1] ?? ""

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} paddingTop={1} paddingLeft={2} paddingRight={1}>
      <box flexDirection="row" justifyContent="space-between" paddingBottom={1} flexShrink={0}>
        <text fg={theme.primary} wrapMode="none">
          提交 {props.commitHash}
        </text>
        <text fg={theme.textMuted} onMouseUp={props.onClose}>
          [X] 关闭
        </text>
      </box>
      <Show when={error()} fallback={<text fg={theme.error}>{error()}</text>}>
        <text fg={theme.textMuted} wrapMode="none">
          {Locale.oneLine(head(), 120)}
        </text>
        <text fg={theme.text} wrapMode="none">
          {Locale.oneLine(subject(), 120)}
        </text>
        <text fg={theme.border} wrapMode="none">
          {"─".repeat(40)}
        </text>
        <scrollbox flexGrow={1} minHeight={0}>
          <box flexDirection="column" flexShrink={0}>
            <For each={files()}>{(line) => <text wrapMode="none">{line}</text>}</For>
            <Show when={overflow() > 0}>
              <text fg={theme.textMuted}>… 还有 {overflow()} 个文件</text>
            </Show>
          </box>
        </scrollbox>
      </Show>
    </box>
  )
}
