import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { Locale } from "../util/locale"

export interface DiffStatFile {
  file: string
  additions: number
  deletions: number
}

// 一次最多列几个文件。上限是必须的:一轮里改上百个文件的情况真实存在,
// 全列出来这一块能把整屏顶掉 —— 那就变成一边修变形、一边造变形。
export const DIFF_STAT_MAX_FILES = 10

// 文件名的显示上限。真实路径基本都短于这个数,超了从左边截,保住更有信息量的尾部。
const FILE_NAME_MAX = 64

/**
 * 同一个文件在一轮里会出现多条(每个 step 各记一条),这里保留最后一条(最终状态),
 * 顺序按它最后一次出现的位置排 —— 和 web 端 uniqueSummaryDiffs 的行为保持一致。
 * 没有 file 字段的条目(比如二进制文件)直接丢掉。
 */
export function uniqueDiffStats(
  files: readonly ({ file?: string; additions?: number; deletions?: number } | undefined)[] | undefined,
): DiffStatFile[] {
  const seen = new Set<string>()
  const result: DiffStatFile[] = []
  for (let index = (files?.length ?? 0) - 1; index >= 0; index--) {
    const item = files![index]
    if (!item || typeof item.file !== "string" || item.file === "") continue
    if (seen.has(item.file)) continue
    seen.add(item.file)
    result.push({ file: item.file, additions: item.additions ?? 0, deletions: item.deletions ?? 0 })
  }
  return result.reverse()
}

/** 文件名 + 增删行数的列表。行数固定有上限,文件名固定单行,不会把外层撑高。 */
export function DiffStatList(props: { files: readonly DiffStatFile[]; max?: number }) {
  const { theme } = useTheme()
  const max = createMemo(() => props.max ?? DIFF_STAT_MAX_FILES)
  const visible = createMemo(() => props.files.slice(0, max()))
  const overflow = createMemo(() => Math.max(0, props.files.length - max()))

  return (
    <box flexShrink={0}>
      <For each={visible()}>
        {(item) => (
          <box flexDirection="row" gap={1} justifyContent="space-between">
            {/* 文件名可压缩且强制单行;右侧数字不压缩,永远看得见。 */}
            <box minWidth={0} flexShrink={1}>
              <text fg={theme.textMuted} wrapMode="none">
                {Locale.truncateLeft(item.file, FILE_NAME_MAX)}
              </text>
            </box>
            <box flexDirection="row" gap={1} flexShrink={0}>
              <Show when={item.additions > 0}>
                <text fg={theme.diffAdded}>+{item.additions}</text>
              </Show>
              <Show when={item.deletions > 0}>
                <text fg={theme.diffRemoved}>-{item.deletions}</text>
              </Show>
            </box>
          </box>
        )}
      </For>
      <Show when={overflow() > 0}>
        <text fg={theme.textMuted}>还有 {overflow()} 个文件</text>
      </Show>
    </box>
  )
}
