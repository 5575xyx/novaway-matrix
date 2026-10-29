// 本轮"真的写过哪些文件"的第二证据源。
//
// 产物卡（html/md）的原始闸门是 `userMessage.summary.diffs` —— 只有本轮 diff 里出现的文件
// 才允许出卡，用来防模型"嘴上说写了其实没写"。但 diff 依赖 git 快照：工作区不是 git 仓库、
// 快照被禁用、或文件写在快照范围外时，`summary.diffs` 永远是空数组，闸门就变成"永远不放行"，
// 于是同一个原型这次出卡、下次不出卡（用户反馈的不稳定现象）。
//
// 这里从工具调用本身取证：write/edit 的入参 `filePath`、写入结果里的 `metadata.filediff.file`、
// apply_patch 补丁头里的目标文件。这些证据和 git 无关，用来补上 diff 的空白。

import type { Part as PartType } from "@novaway/sdk/v2"
import { resolveWorkspacePath } from "@/utils/preview-sources"

/** 会产生文件写入的工具。名字取本地实现与常见 MCP 写盘工具的交集。 */
const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "write",
  "edit",
  "multiedit",
  "multi_edit",
  "apply_patch",
  "notebook_edit",
  "write_file",
  "create_file",
  "str_replace_editor",
])

/** write/edit 类工具入参里可能承载路径的字段名。 */
const PATH_FIELDS = ["filePath", "file_path", "path", "file", "filename", "notebook_path"] as const

/** apply_patch 补丁头：`*** Add File: a.html` / `*** Update File: b.md`。 */
const PATCH_TARGET_RE = /^\*\*\* (?:Add|Update|Delete) File: *(.+)$/gm

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}

/**
 * 从本轮工具调用里收集写盘目标（绝对路径、去重、保持出现顺序）。
 * 只做证据收集，不做存在性校验 —— 那是调用方的 stat 校验负责的事。
 */
export function collectTurnWrittenPaths(parts: readonly PartType[], workspacePath: string): string[] {
  const paths: string[] = []
  const add = (value: unknown) => {
    if (typeof value !== "string") return
    const trimmed = value.trim().replace(/^['"`]|['"`]$/g, "")
    if (!trimmed) return
    const resolved = resolveWorkspacePath(trimmed, workspacePath)
    if (!resolved || paths.includes(resolved)) return
    paths.push(resolved)
  }

  for (const part of parts) {
    if (part.type !== "tool") continue
    const state = part.state as unknown
    const input = asRecord(asRecord(state)?.input)
    const metadata = asRecord(asRecord(state)?.metadata)

    // 1) 写入结果自带的 file diff 目标（edit/write 都会写 metadata.filediff）
    add(asRecord(metadata?.filediff)?.file)

    if (!WRITE_TOOL_NAMES.has(part.tool.toLowerCase())) continue

    // 2) 入参里的路径字段
    for (const field of PATH_FIELDS) add(input?.[field])

    // 3) apply_patch 的补丁头（一次性改多个文件，入参里只有整段 patchText）
    const patchText = input?.patchText
    if (typeof patchText === "string") {
      for (const match of patchText.matchAll(PATCH_TARGET_RE)) add(match[1])
    }
  }

  return paths
}
