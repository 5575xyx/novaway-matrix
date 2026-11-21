/**
 * 正文行内 code 里「哪个算文件、哪个算目录」的判定。
 *
 * 和 markdown-stream.ts 一样单独成模块：这两个判定决定聊天区哪些 token
 * 会被画成可点链接、哪些只配挂一个图标，一条正则就能改翻一大片，
 * 需要能脱离 DOM 和 marked 直接测。
 */

export const urlPattern = /^https?:\/\/[^\s<>()`"']+$/

const filePathPattern =
  /^(?:[A-Za-z]:[\\/]|~[\\/]|\/[\\/]?|\.{1,2}[\\/])?(?:[\w@.$-]+[\\/])*[\w@.$-]+(?:\.[A-Za-z0-9]{1,12})?$/

// 裸文件名没有目录信号时，只接受常见的真实文件扩展名。
// 否则 `example.com`、`v1.2`、`foo.bar` 这类普通文本会被误画成可点击文件。
const COMMON_FILE_EXTENSIONS = new Set([
  "7z",
  "avif",
  "bat",
  "bmp",
  "c",
  "cfg",
  "conf",
  "cpp",
  "css",
  "csv",
  "doc",
  "docx",
  "env",
  "gif",
  "go",
  "html",
  "ico",
  "ini",
  "java",
  "jpeg",
  "jpg",
  "js",
  "json",
  "jsx",
  "log",
  "md",
  "mjs",
  "mov",
  "mp3",
  "mp4",
  "pdf",
  "png",
  "ppt",
  "pptx",
  "py",
  "sh",
  "sql",
  "svg",
  "swift",
  "tar",
  "toml",
  "ts",
  "tsx",
  "txt",
  "wav",
  "webm",
  "webp",
  "woff",
  "woff2",
  "xls",
  "xlsx",
  "xml",
  "yaml",
  "yml",
  "zip",
])

/**
 * 只有**文件**才当作可点链接。
 *
 * 之前只要「像路径」或「有扩展名」就标记，于是 `/e/AImoney/PowersNexus`（目录）
 * 和 `gitee/main`（远程分支名）都被画成链接 —— 点了要么报错、要么打开空标签。
 * 判定分两层：带目录的路径只要有扩展名就可以；裸文件名还必须使用常见文件扩展名。
 * 这样 `package.json` / `AGENTS.md` / `a.ts` 通过，但 `example.com`、`v1.2`、
 * `foo.bar` 这类正文里的普通 token 不会被画成可点击文件。少数没有扩展名的真文件
 * （Makefile、LICENSE）仍保持纯文本，避免把普通词语误当路径。
 */
export function filePath(text: string) {
  const raw = text.trim().replace(/[),.;!?]+$/, "")
  if (!raw || raw.length > 300) return
  if (urlPattern.test(raw) || raw.includes("://") || raw.startsWith("data:")) return
  const extension = raw.match(/\.([A-Za-z0-9]{1,12})$/)?.[1]?.toLowerCase()
  if (!extension) return
  const hasDirectorySignal = /[\\/]/.test(raw) || raw.startsWith("~")
  if (!hasDirectorySignal && !COMMON_FILE_EXTENSIONS.has(extension)) return
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
