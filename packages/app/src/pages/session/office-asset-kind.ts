export type OfficeAssetKind = "image" | "data" | "audio" | "document" | "other"

export function officeAssetKind(path: string): OfficeAssetKind {
  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(path)) return "image"
  if (/\.(csv|tsv|json|md|xlsx?|xls)$/i.test(path)) return "data"
  if (/\.(mp3|wav|m4a|aac|flac)$/i.test(path)) return "audio"
  if (/\.(pptx|ppt|pdf|docx?|txt)$/i.test(path)) return "document"
  return "other"
}

export function officeAssetKindLabel(kind: OfficeAssetKind) {
  if (kind === "image") return "图片"
  if (kind === "data") return "数据"
  if (kind === "audio") return "音频"
  if (kind === "document") return "文档"
  return "文件"
}

export function officeAssetTarget(path: string) {
  const kind = officeAssetKind(path)
  if (kind === "image") return "图片槽位"
  if (kind === "data" && /\.md$/i.test(path)) return "正文/表格"
  if (kind === "data") return "图表/表格"
  if (kind === "audio") return "旁白"
  if (kind === "document") return "正文"
  return "文件"
}
