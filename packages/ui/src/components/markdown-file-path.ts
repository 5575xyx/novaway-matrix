/**
 * 正文行内 code 里「哪个算文件、哪个算目录」的判定。
 *
 * 和 markdown-stream.ts 一样单独成模块：这两个判定决定聊天区哪些 token
 * 会被画成可点链接、哪些只配挂一个图标，一条正则就能改翻一大片，
 * 需要能脱离 DOM 和 marked 直接测。
 */

export const urlPattern = /^https?:\/\/[^\s<>()`"']+$/

const filePathPattern =
  /^(?:[A-Za-z]:[\\/]|~[\\/]|\/|\.{1,2}[\\/])?(?:[\w@.$-]+[\\/])*[\w@.$-]+(?:\.[A-Za-z0-9]{1,12})?$/

/**
 * 只有**文件**才当作可点链接。
 *
 * 之前只要「像路径」或「有扩展名」就标记，于是 `/e/AImoney/PowersNexus`（目录）
 * 和 `gitee/main`（远程分支名）都被画成链接 —— 点了要么报错、要么打开空标签。
 * 现在要求**必须有扩展名**：`package.json` / `AGENTS.md` / `a.ts` 通过，
 * 目录与分支名不会被误标。少数没有扩展名的真文件（Makefile、LICENSE）
 * 会失去这个便利，换来的是"看起来是链接的都能打开"。
 */
export function filePath(text: string) {
  const raw = text.trim().replace(/[),.;!?]+$/, "")
  if (!raw || raw.length > 300) return
  if (urlPattern.test(raw) || raw.includes("://") || raw.startsWith("data:")) return
  const hasExtension = /\.[A-Za-z0-9]{1,12}$/.test(raw)
  if (!hasExtension) return
  if (!filePathPattern.test(raw)) return
  return raw
}

/** 每段都以分隔符结尾，所以必须以 `/` 或 `\` 收尾 —— 和 filePath 天然互斥。 */
const dirPathPattern = /^(?:[A-Za-z]:[\\/]|~[\\/]|\/|\.{1,2}[\\/])?(?:[\w@.$-]+[\\/])+$/

/**
 * 目录 token（`notes/`、`svg_output/`、`backup/20261101_134706/`）。
 *
 * 只用来挂图标，**不给可点**：点开目录会开出一个内容为空的假标签，
 * 而且会把真正的预览挤掉，所以目录一直保持只读。
 */
export function dirPath(text: string) {
  const raw = text.trim().replace(/[),.;!?]+$/, "")
  if (!raw || raw.length > 300) return
  if (urlPattern.test(raw) || raw.includes("://") || raw.startsWith("data:")) return
  if (!dirPathPattern.test(raw)) return
  return raw
}
