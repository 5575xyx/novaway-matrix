/** 知识库文件类型：决定用哪个图标、走文本还是二进制上传通道。 */
export type KnowledgeFileKind = "markdown" | "text" | "data" | "pdf" | "word" | "slide" | "sheet" | "code"

export const BINARY_EXTENSIONS = ["pdf", "docx", "pptx", "xlsx"] as const

export function extname(name: string) {
  const index = name.lastIndexOf(".")
  return index === -1 ? "" : name.slice(index + 1).toLowerCase()
}

export function isBinaryDocument(name: string) {
  return (BINARY_EXTENSIONS as readonly string[]).includes(extname(name))
}

export function knowledgeFileKind(name: string): KnowledgeFileKind {
  const ext = extname(name)
  if (ext === "md" || ext === "markdown") return "markdown"
  if (ext === "pdf") return "pdf"
  if (ext === "doc" || ext === "docx" || ext === "rtf") return "word"
  if (ext === "ppt" || ext === "pptx" || ext === "key") return "slide"
  if (ext === "xls" || ext === "xlsx" || ext === "csv" || ext === "tsv") return "sheet"
  if (ext === "json" || ext === "yaml" || ext === "yml" || ext === "xml") return "data"
  if (["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "sql", "sh"].includes(ext)) return "code"
  return "text"
}

/** 文件类型图标使用独立的文件分类主题色，不与 Agent 身份色耦合。 */
export const FILE_TONE: Record<
  KnowledgeFileKind,
  { icon: "code-lines" | "table" | "review" | "chart" | "terminal"; color: string; background: string }
> = {
  markdown: {
    icon: "code-lines",
    color: "var(--icon-file-category-0)",
    background: "var(--surface-file-category-0)",
  },
  text: {
    icon: "code-lines",
    color: "var(--text-subtle)",
    background: "color-mix(in srgb, var(--text-subtle) 12%, transparent)",
  },
  data: {
    icon: "table",
    color: "var(--icon-file-category-1)",
    background: "var(--surface-file-category-1)",
  },
  pdf: {
    icon: "review",
    color: "var(--icon-file-category-2)",
    background: "var(--surface-file-category-2)",
  },
  word: {
    icon: "review",
    color: "var(--icon-file-category-0)",
    background: "var(--surface-file-category-0)",
  },
  slide: {
    icon: "chart",
    color: "var(--icon-file-category-3)",
    background: "var(--surface-file-category-3)",
  },
  sheet: {
    icon: "table",
    color: "var(--icon-file-category-1)",
    background: "var(--surface-file-category-1)",
  },
  code: {
    icon: "terminal",
    color: "var(--icon-file-category-0)",
    background: "var(--surface-file-category-0)",
  },
}
