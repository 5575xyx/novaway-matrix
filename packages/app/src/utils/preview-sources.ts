// 会话里新出现的 HTML 文件 → 预览地址的判定。纯函数，便于单测。

const HTML_EXTENSIONS = new Set([".html", ".htm", ".xhtml"])

// 构建产物和第三方依赖里的 HTML 不是用户想看的页面，自动打开会反复抢预览
const EXCLUDED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  ".next",
  ".nuxt",
  ".output",
])

// Windows 上 .git 这类隐藏目录会被写成 .\git\...，按分隔符切分后 "." 和 "git" 变成两段
const DOTTED_DIR_BASENAMES = new Set(["git", "next", "nuxt", "output"])

// Windows 盘符、POSIX 根路径、UNC 共享
const ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]|^\/|^\\\\/

export function isHtmlPath(path: string): boolean {
  const name = path.replace(/[\\/]+$/, "")
  const dot = name.lastIndexOf(".")
  if (dot <= 0) return false
  return HTML_EXTENSIONS.has(name.slice(dot).toLowerCase())
}

export function isExcludedPath(path: string): boolean {
  const segments = path.split(/[\\/]+/)
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index].toLowerCase()
    if (EXCLUDED_SEGMENTS.has(segment)) return true
    // Windows 下 .git 目录常写成 .\git\...，切分后 "." 和 "git" 变成相邻两段
    if (segment === "." && DOTTED_DIR_BASENAMES.has(segments[index + 1]?.toLowerCase() ?? "")) return true
  }
  return false
}

/** diff 与文件树给的路径可能是相对工作区的，也可能是绝对路径；统一成绝对路径 */
export function resolveWorkspacePath(candidate: string, directory: string): string {
  const value = candidate.trim()
  if (!value || ABSOLUTE_PATH.test(value)) return value
  return `${directory.replace(/[\\/]+$/, "")}/${value}`
}

/** 绝对路径转工作区相对路径：composer 的文件上下文沿用 SDK 的相对路径约定 */
export function relativeToWorkspace(absolute: string, directory: string): string {
  const value = absolute.replace(/\\/g, "/")
  const base = directory.replace(/\\/g, "/").replace(/\/+$/, "")
  if (!base) return absolute

  // 前缀后面必须是分隔符，否则 E:/work 会误匹配 E:/work2
  const rest = value.toLowerCase().startsWith(base.toLowerCase()) ? value.slice(base.length) : ""
  if (!rest.startsWith("/")) return absolute

  return rest.slice(1) || absolute
}

/** 新出现的 HTML 文件是否应自动载入预览 */
export function shouldAutoOpenHtml(path: string): boolean {
  return isHtmlPath(path) && !isExcludedPath(path)
}
