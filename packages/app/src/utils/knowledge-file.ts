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

/** 文件类型对应的图标底色（浅色底 + 同色前景），避免一片灰。 */
export const FILE_TONE: Record<
  KnowledgeFileKind,
  { icon: "code-lines" | "table" | "review" | "chart" | "terminal"; color: string; background: string }
> = {
  markdown: { icon: "code-lines", color: "#2563eb", background: "color-mix(in srgb, #3b82f6 14%, transparent)" },
  text: { icon: "code-lines", color: "#64748b", background: "color-mix(in srgb, #64748b 12%, transparent)" },
  data: { icon: "table", color: "#0d9488", background: "color-mix(in srgb, #0d9488 14%, transparent)" },
  pdf: { icon: "review", color: "#dc2626", background: "color-mix(in srgb, #ef4444 14%, transparent)" },
  word: { icon: "review", color: "#2563eb", background: "color-mix(in srgb, #3b82f6 14%, transparent)" },
  slide: { icon: "chart", color: "#ea580c", background: "color-mix(in srgb, #f97316 14%, transparent)" },
  sheet: { icon: "table", color: "#16a34a", background: "color-mix(in srgb, #22c55e 14%, transparent)" },
  code: { icon: "terminal", color: "#7c3aed", background: "color-mix(in srgb, #8b5cf6 14%, transparent)" },
}
