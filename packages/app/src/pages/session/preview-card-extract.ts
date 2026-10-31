// 产物卡提取(对齐 ZCode assistantFileReferences/assistantPreviewCards 的分层方案):
// 素材来源是 AI 的回答正文而不是文件变更列表 —— 模型说什么是交付物,什么才出卡;
// 本轮 diff 只作为 markdown/html 引用的写盘证明,存在性校验由调用方异步兜底。
// 提取按优先级分层:引用指令 > Markdown 链接 > file:// URL > 引号定界路径 > 裸路径,
// 每层命中后把区间记入保护区间,后续层跳过重叠,保证一个引用只被最高优先级的层吃掉。
import { getFilename } from "@novaway/core/util/path"
import { LOCAL_URL } from "@/utils/dev-server-detect"
import { normalizePreviewUrl } from "@/utils/preview-url"
import { relativeToWorkspace, resolveWorkspacePath } from "@/utils/preview-sources"

export type PreviewRefKind = "markdown" | "html" | "docx" | "xlsx" | "pptx" | "pdf" | "image"

export interface PreviewFileReference {
  /** 命中区间在正文里的位置,用于「最后提到的优先」排序 */
  start: number
  end: number
  kind: PreviewRefKind
  /** 解析后的绝对路径 */
  path: string
  /** 正文里的原始写法(清洗前后),叶子名匹配 diff 时用 raw */
  raw: string
  source: "citation" | "markdown" | "file-url" | "delimited" | "bare"
}

export interface PreviewCardCandidate {
  kind: "server" | "html" | "file"
  /** server: http(s) 地址;html/file: file:// 预览地址 */
  url: string
  path?: string
  title: string
  subtitle: string
}

// 只登记侧栏能真实预览的类型;.doc/.xls/.ppt 老格式不支持预览,刻意不进卡。
// 新增类型只需在这里登记扩展名,提取/组装/校验复用同一条路径。
const PREVIEW_FILE_EXTENSIONS: readonly { extensions: readonly string[]; kind: PreviewRefKind }[] = [
  { extensions: [".md"], kind: "markdown" },
  { extensions: [".html", ".htm"], kind: "html" },
  { extensions: [".docx"], kind: "docx" },
  { extensions: [".xlsx"], kind: "xlsx" },
  { extensions: [".pptx"], kind: "pptx" },
  { extensions: [".pdf"], kind: "pdf" },
  {
    extensions: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif", ".svg"],
    kind: "image",
  },
]

const EXTENSION_ALTERNATION = "md|html?|docx|xlsx|pptx|pdf|png|jpe?g|gif|webp|bmp|ico|avif|svg"

const FILE_URL_RE = /\bfile:\/\/[^\s<>()\]`"'*“”‘’，。！？；：、]+/gi
const MARKDOWN_LINK_RE = /\[([^\]\n]*)\]\(([^)\n]+)\)/g
// u 标志下字符类里不能有 \` 这类转义,反引号用变量拼进来源串
const QUOTE = "`"
const DELIMITED_FILE_PATH_RE = new RegExp(
  String.raw`([` +
    QUOTE +
    String.raw`"'“”‘’])([^` +
    QUOTE +
    String.raw`"'“”‘’\r\n]+?\.(?:${EXTENSION_ALTERNATION})(?::\d+(?::\d+)?)?)([` +
    QUOTE +
    String.raw`"'“”‘’])`,
  "giu",
)
// 边界字符必须含全角括号:中文回答里路径后紧跟「（35.6 KB）」这类全角括号,
// 缺了它们 lookahead 失败,整个裸路径匹配会静默作废。
const PATH_BOUNDARY_CHARS = String.raw`\s()"'` + QUOTE + String.raw`“”‘’,.;:!?，。！？；：、（）【】《》「」『』〈〉`
const FILE_PATH_RE = new RegExp(
  String.raw`(?:^|[` +
    PATH_BOUNDARY_CHARS +
    String.raw`])((?:(?:\.{1,2}[\\/]|[a-zA-Z]:[\\/]|\/|[\p{L}\p{N}\p{M}\p{S}_.@()-]+[\\/])[\p{L}\p{N}\p{M}\p{S}_.@() -]+?(?:[\\/][\p{L}\p{N}\p{M}\p{S}_.@() -]+?)*|[\p{L}\p{N}\p{M}\p{S}_.@()-]+)\.(?:${EXTENSION_ALTERNATION})(?::\d+(?::\d+)?)?)(?=$|[` +
    PATH_BOUNDARY_CHARS +
    String.raw`])`,
  "giu",
)
// 引用指令:行首(允许多个冒号变体)的 :nova-file-citation{path=...;artifact_kind=...}。
// 流式期间未闭合(没有 })不会命中,自然不会出半截卡。
const CITATION_RE = /(?:^|\n)[ \t]*:{1,3}[ \t]*nova-file-citation[ \t]*\{([^}\n]*)\}/gi

const URL_TRAILING_RE = /(?:[*_`]+|[.,;:!?，。！？；：、]+)+$/g

export function normalizeTrailingUrlText(url: string): string {
  return url.trim().replace(URL_TRAILING_RE, "")
}

/**
 * 正文渲染用的 citation 投影:完整指令行整行移除(卡片已经是它的展示形态,正文不残留裸文本);
 * 流式期间再隐藏末尾未闭合的指令/指令前缀,避免半截 :nova-file-citation 在回答里闪现。
 * 流式结束(含中断)后未闭合的残句保留原文,不吞后续正文 —— 与 ZCode projectZCodeFileCitations 语义一致。
 * 只影响渲染,卡提取仍读原始 part.text。
 */
export function projectCitationText(text: string, options: { streaming: boolean }): string {
  if (!text.includes(":")) return text
  let result = text.replace(CITATION_RE, "")
  if (!options.streaming) return result

  const lastNewline = result.lastIndexOf("\n")
  const tail = result.slice(lastNewline + 1)
  const trimmed = tail.trimStart()
  // 末行是「以冒号开头 + nova 开头 + 还没等到 }」的形态,视为正在流出的指令,整行隐藏
  if (trimmed.startsWith(":") && !trimmed.includes("}") && /^[:：]{1,3}[ \t]*n/i.test(trimmed)) {
    result = result.slice(0, lastNewline + 1)
  }
  return result
}

/** 清洗路径候选:剥尾部标点和 :line:col 后缀 */
export function cleanPreviewPathCandidate(candidate: string): string {
  return candidate
    .trim()
    .replace(/[.,;!?，。！？；：、]+$/, "")
    .replace(/:\d+(?::\d+)?$/, "")
}

function previewKindForPath(path: string): PreviewRefKind | null {
  const normalized = cleanPreviewPathCandidate(path).toLowerCase()
  return (
    PREVIEW_FILE_EXTENSIONS.find((definition) =>
      definition.extensions.some((extension) => normalized.endsWith(extension)),
    )?.kind ?? null
  )
}

function parseFileUrlPath(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "file:") return null
    let pathname = parsed.pathname
    try {
      pathname = decodeURIComponent(pathname)
    } catch {
      // 保留未解码的 pathname:畸形转义不该让整个引用作废
    }
    // file:///E:/x → E:/x(Windows 盘符写法);file://host/x → //host/x(UNC)
    if (/^\/[a-zA-Z]:\//.test(pathname)) return pathname.slice(1)
    if (parsed.hostname && parsed.hostname !== "localhost") return `//${parsed.hostname}${pathname}`
    return pathname
  } catch {
    return null
  }
}

function resolveRawPreviewPath(workspacePath: string, raw: string): string | null {
  if (/^file:\/\//i.test(raw)) return parseFileUrlPath(raw)
  const cleaned = cleanPreviewPathCandidate(raw)
  if (!cleaned || /^https?:\/\//i.test(cleaned)) return null
  // `~` 是用户家目录语义,渲染端拿不到可靠 home,失败关闭(不出卡),也不让内部路径再走相对兜底
  if (/^~(?:[\\/]|[^\\/]+[\\/])/.test(cleaned) || cleaned === "~") return null
  return resolveWorkspacePath(cleaned, workspacePath)
}

function overlapsRanges(start: number, end: number, ranges: readonly (readonly [number, number])[]): boolean {
  return ranges.some(([rangeStart, rangeEnd]) => start < rangeEnd && end > rangeStart)
}

interface CitationDirective {
  start: number
  end: number
  path?: string
  artifactKind?: string
}

function parseCitationParams(body: string): { path?: string; artifactKind?: string } {
  let path: string | undefined
  let artifactKind: string | undefined
  for (const pair of body.split(/[;\n]/)) {
    const eq = pair.indexOf("=")
    if (eq <= 0) continue
    const key = pair.slice(0, eq).trim().toLowerCase()
    const value = pair
      .slice(eq + 1)
      .trim()
      .replace(/^['"'“”‘’]|['"'“”‘’]$/g, "")
      .trim()
    if (!value) continue
    if (key === "path") path = value
    if (key === "artifact_kind" || key === "artifactkind") artifactKind = value.toLowerCase()
  }
  return { ...(path ? { path } : {}), ...(artifactKind ? { artifactKind } : {}) }
}

function extractCitationDirectives(content: string): CitationDirective[] {
  return [...content.matchAll(CITATION_RE)].map((match) => {
    const body = match[1] ?? ""
    const matchStart = match.index ?? 0
    // 保护区间从指令冒号开始(match[0] 前导的换行/空白不算),到 } 结束
    const start = matchStart + match[0].indexOf(":")
    const end = matchStart + match[0].length
    return { start, end, ...parseCitationParams(body) }
  })
}

// 引用指令只允许 Office/PDF/图片产出卡(与 ZCode 的产品边界一致):
// md/html 有自己的 markdown 链接与变更校验通道,不走指令。
const CITATION_KINDS: ReadonlySet<PreviewRefKind> = new Set(["docx", "xlsx", "pptx", "pdf", "image"])
const ARTIFACT_KIND_TO_PREVIEW: Readonly<Record<string, PreviewRefKind>> = {
  document: "docx",
  workbook: "xlsx",
  presentation: "pptx",
  pdf: "pdf",
  image: "image",
}

function resolveCitationKind(path: string, artifactKind: string | undefined): PreviewRefKind | null {
  const inferred = previewKindForPath(path)
  if (!inferred || !CITATION_KINDS.has(inferred)) return null
  if (artifactKind === undefined) return inferred
  return ARTIFACT_KIND_TO_PREVIEW[artifactKind] === inferred ? inferred : null
}

export function extractAnswerFileReferences(content: string, workspacePath: string): PreviewFileReference[] {
  if (!content.trim()) return []

  const references: PreviewFileReference[] = []
  const protectedRanges: Array<readonly [number, number]> = []

  // 1. 显式引用指令(最高优先级)
  for (const citation of extractCitationDirectives(content)) {
    // 指令占完整保护区间,内部 path 不能再被普通路径正则捞出绕过产品边界
    protectedRanges.push([citation.start, citation.end])
    if (!citation.path) continue
    const path = resolveRawPreviewPath(workspacePath, citation.path)
    const kind = path ? resolveCitationKind(path, citation.artifactKind) : null
    if (path && kind) {
      references.push({ start: citation.start, end: citation.end, kind, path, raw: citation.path, source: "citation" })
    }
  }

  // 2. Markdown 链接
  for (const match of content.matchAll(MARKDOWN_LINK_RE)) {
    const href = (match[2] ?? "").trim().replace(/^<|>$/g, "")
    const start = match.index ?? 0
    const end = start + (match[0]?.length ?? 0)
    if (overlapsRanges(start, end, protectedRanges)) continue
    protectedRanges.push([start, end])
    const path = resolveRawPreviewPath(workspacePath, href)
    const kind = path ? previewKindForPath(path) : null
    if (path && kind) {
      references.push({ start, end, kind, path, raw: href, source: "markdown" })
    }
  }

  // 3. file:// URL
  for (const match of content.matchAll(FILE_URL_RE)) {
    const raw = normalizeTrailingUrlText(match[0] ?? "")
    const start = match.index ?? 0
    const end = start + raw.length
    if (overlapsRanges(start, end, protectedRanges)) continue
    protectedRanges.push([start, end])
    const path = parseFileUrlPath(raw)
    const kind = path ? previewKindForPath(path) : null
    if (path && kind) {
      references.push({ start, end, kind, path, raw, source: "file-url" })
    }
  }

  // 4. 引号/反引号定界路径(引号必须配对,错配的保护起来不出卡)
  for (const match of content.matchAll(DELIMITED_FILE_PATH_RE)) {
    const raw = (match[2] ?? "").trim()
    const fullStart = match.index ?? 0
    const fullEnd = fullStart + (match[0]?.length ?? 0)
    if (!raw || overlapsRanges(fullStart, fullEnd, protectedRanges)) continue
    if (match[1] !== match[3] && !isSmartQuotePair(match[1] ?? "", match[3] ?? "")) {
      protectedRanges.push([fullStart, fullEnd])
      continue
    }
    protectedRanges.push([fullStart, fullEnd])
    const path = resolveRawPreviewPath(workspacePath, raw)
    const kind = path ? previewKindForPath(path) : null
    if (path && kind) {
      references.push({ start: fullStart, end: fullEnd, kind, path, raw, source: "delimited" })
    }
  }

  // 5. 裸路径(前后必须是边界字符;`~/` 是展示给用户的 shell 路径,保护不出卡)
  for (const match of content.matchAll(FILE_PATH_RE)) {
    const raw = match[1] ?? ""
    const fullMatch = match[0] ?? raw
    const start = (match.index ?? 0) + fullMatch.lastIndexOf(raw)
    const end = start + raw.length
    if (overlapsRanges(start, end, protectedRanges)) continue
    if (/^~[\\/]/.test(raw)) {
      protectedRanges.push([start, end])
      continue
    }
    const preceding = content[start - 1]
    const following = content[end]
    const quoteBoundary = isQuoteChar(preceding) || isQuoteChar(following)
    if (quoteBoundary && preceding !== following && !isSmartQuotePair(preceding ?? "", following ?? "")) {
      // 单侧/错配引号包住的路径不提取,防止畸形输出出卡
      protectedRanges.push([start, end])
      continue
    }
    protectedRanges.push([start, end])
    const path = resolveRawPreviewPath(workspacePath, raw)
    const kind = path ? previewKindForPath(path) : null
    if (path && kind) {
      references.push({ start, end, kind, path, raw, source: "bare" })
    }
  }

  return references.sort((left, right) => left.start - right.start || left.end - right.end)
}

function isQuoteChar(char: string | undefined): boolean {
  return !!char && [`"`, "'", "`", "“", "”", "‘", "’"].includes(char)
}

function isSmartQuotePair(left: string, right: string): boolean {
  return (
    (left === "“" && right === "”") ||
    (left === "‘" && right === "’") ||
    (left === "”" && right === "“") ||
    (left === "’" && right === "‘")
  )
}

function cleanMarkdownLinkTitle(title: string): string | null {
  const normalized = title.replace(/\s+/g, " ").trim()
  if (
    !normalized ||
    normalized.length > 80 ||
    /^https?:\/\//i.test(normalized) ||
    /[*_`[\]<>]/.test(normalized) ||
    /^[)"'`,.;:!?，。！？；：、）】》]+/.test(normalized) ||
    !/[a-zA-Z0-9\u4e00-\u9fff]/.test(normalized)
  ) {
    return null
  }
  return normalized
}

/** 正文里的本地服务地址(localhost/内网),标题优先取 markdown 链接文字。
 * 注意不能用 normalizeLocalUrl —— 那是 dev server 探测的 origin 归一化,会把路径剥掉。 */
export function extractAnswerWebsites(content: string): { url: string; title: string; start: number }[] {
  if (!content.trim()) return []
  const linkTitles = new Map<string, string>()
  for (const match of content.matchAll(MARKDOWN_LINK_RE)) {
    const label = cleanMarkdownLinkTitle(match[1] ?? "")
    const href = normalizeTrailingUrlText((match[2] ?? "").trim().replace(/^<|>$/g, ""))
    if (label && href && !/^https?:\/\//i.test(label)) linkTitles.set(href, label)
  }

  const isValidWebsiteUrl = (url: URL) =>
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.username.length === 0 &&
    url.password.length === 0 &&
    Boolean(url.hostname)

  const result: { url: string; title: string; start: number }[] = []
  for (const match of content.matchAll(LOCAL_URL)) {
    const url = trimUnbalancedTrailingParens(normalizeTrailingUrlText((match[0] ?? "").split(URL_JUNK_CUT_RE)[0] ?? ""))
    if (!url) continue
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      continue
    }
    if (!isValidWebsiteUrl(parsed)) continue
    if (result.some((item) => item.url === url)) continue
    const fallbackTitle = getWebsiteFallbackTitle(url)
    result.push({ url, title: linkTitles.get(url) ?? fallbackTitle, start: match.index ?? 0 })
  }
  return result
}

function getWebsiteFallbackTitle(url: string): string {
  try {
    const parsed = new URL(url)
    const leaf = decodeURIComponent(parsed.pathname).split("/").filter(Boolean).at(-1)
    return leaf ?? parsed.host
  } catch {
    return url
  }
}

/** LOCAL_URL 的路径段不排除括号和反引号,markdown 链接 [x](url) 的右括号、
 * 正文里反引号包 URL 后跟的全角标点都会被吞进来;先截断垃圾字符,再平衡括号。 */
const URL_JUNK_CUT_RE = /[`‘’“”「」『』（）〈《【〕》』]/u

function trimUnbalancedTrailingParens(url: string): string {
  let candidate = url
  const count = (text: string, char: string) => text.split(char).length - 1
  while (candidate.endsWith(")") && count(candidate, ")") > count(candidate, "(")) {
    candidate = candidate.slice(0, -1)
  }
  return candidate
}

export function normalizePathForCompare(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "")
    .toLowerCase()
}

/** 正文里写全的绝对路径 / file:// 地址（写盘证明缺失时只认这种写法）。 */
const ABSOLUTE_REFERENCE_RE = /^(?:[a-zA-Z]:[\\/]|[\\/]|file:\/\/)/i

/**
 * markdown/html 引用必须能对上本轮写盘证明(精确路径或唯一叶子名),对不上不出卡 ——
 * 这是防幻觉闸门:模型提到的文档必须真的在本轮写好了。
 *
 * 兜底:正文里写**完整绝对路径**(`E:\x\y.html` / `file://…`)时直接放行 —— 模型把完整路径
 * 写进回答本身就是"这是产物"的显式声明,文件是否存在由调用方的 stat 校验兜底。
 * 只靠 diff 时,非 git 工作区(快照不可用)会永远拿不到证明,产物卡就时有时无。
 * 相对路径仍然必须命中证明,避免把正文里随口提到的文档变成卡片。
 */
function matchChangedFilePath(reference: PreviewFileReference, changedFilePaths: readonly string[]): string | null {
  const cleanedRaw = cleanPreviewPathCandidate(reference.raw)
  const normalizedReference = normalizePathForCompare(reference.path)
  const normalizedChanged = changedFilePaths.map((path) => ({
    path,
    normalized: normalizePathForCompare(path),
  }))
  const exact = normalizedChanged.find((candidate) => candidate.normalized === normalizedReference)
  if (exact) return exact.path

  if (ABSOLUTE_REFERENCE_RE.test(cleanedRaw)) return reference.path
  if (cleanedRaw.includes("/") || cleanedRaw.includes("\\")) return null
  const leafMatches = normalizedChanged.filter(
    (candidate) => candidate.normalized.split("/").at(-1) === cleanedRaw.toLowerCase(),
  )
  return leafMatches.length === 1 ? leafMatches[0].path : null
}

export const PREVIEW_CARD_CANDIDATE_LIMIT = 15
export const PREVIEW_CARD_VISIBLE_LIMIT = 10

export interface BuildPreviewCardsInput {
  /** 本轮全部 assistant 正文(text 段按顺序拼接) */
  turnText: string
  workspacePath: string
  /** 本轮 diff 的绝对路径,markdown/html 引用的写盘证明 */
  changedFilePaths?: readonly string[]
  /** bash 输出里扫到的本地服务地址(兜底来源,排序垫底) */
  bashUrls?: readonly string[]
}

/** 提取 + 组装 + 去重 + 排序(最后提到的优先)+ 候选限额;存在性校验由调用方异步做 */
export function buildPreviewCardCandidates(input: BuildPreviewCardsInput): PreviewCardCandidate[] {
  const turnText = input.turnText ?? ""
  const workspacePath = input.workspacePath
  if (!turnText.trim() && !(input.bashUrls ?? []).length) return []

  const changedFilePaths = input.changedFilePaths ?? []
  const websites = extractAnswerWebsites(turnText)
  const positioned: Array<{ position: number; candidate: PreviewCardCandidate }> = []

  // 正文里的本地服务地址:server 卡
  for (const website of websites) {
    positioned.push({
      position: website.start,
      candidate: { kind: "server", url: website.url, title: website.title, subtitle: website.url },
    })
  }
  const hasLocalHttpPreview = websites.length > 0

  // 正文文件引用:html/md 需过 diff 闸门;有本地服务时抑制 html 文件卡(同一产物不重复出卡)
  let hasHtmlCard = false
  for (const reference of extractAnswerFileReferences(turnText, workspacePath)) {
    if (reference.kind === "html" && hasLocalHttpPreview) continue
    let path = reference.path
    if (reference.kind === "markdown" || reference.kind === "html") {
      const changedPath = matchChangedFilePath(reference, changedFilePaths)
      if (!changedPath) continue
      path = changedPath
    }
    if (reference.kind === "html") hasHtmlCard = true
    const url = normalizePreviewUrl(path) ?? ""
    positioned.push({
      position: reference.start,
      candidate: {
        kind: reference.kind === "html" ? "html" : "file",
        url,
        path,
        title: getFilename(path) || path,
        subtitle: relativeToWorkspace(path, workspacePath) ?? path,
      },
    })
  }

  // bash 输出兜底来源垫底(排序按位置降级,负数让它排在正文引用之后)
  for (const [index, url] of (input.bashUrls ?? []).entries()) {
    if (websites.some((website) => website.url === url)) continue
    // 本轮已经有 html 原型卡时不再补服务卡:服务只是同一个原型的另一种打开方式
    // (常见于 `python -m http.server` 启了个目录服务),两张卡指向同一份产物,看着重复。
    // 正文里明确写出的服务地址不受影响 —— 那是模型指定的访问方式。
    if (hasHtmlCard) continue
    positioned.push({
      position: -1 - index,
      candidate: {
        kind: "server",
        url,
        title: url.replace(/^https?:\/\//, ""),
        subtitle: url,
      },
    })
  }

  positioned.sort((left, right) => right.position - left.position)
  const seen = new Set<string>()
  const candidates: PreviewCardCandidate[] = []
  for (const item of positioned) {
    const key = item.candidate.path
      ? `file:${normalizePathForCompare(item.candidate.path)}`
      : `url:${item.candidate.url.replace(/\/$/, "")}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push(item.candidate)
    if (candidates.length >= PREVIEW_CARD_CANDIDATE_LIMIT) break
  }
  return candidates
}
