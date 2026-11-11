import { officeFormatOf } from "@novaway/core/office/engine/registry"

export function officeExportTargets(path: string | undefined) {
  if (!path) return [] as string[]
  const format = officeFormatOf(path)
  if (!format) return [] as string[]
  if (format === "pdf") return ["png"]
  if (format === "xlsx") return ["csv", "tsv", "html", "png"]
  if (format === "csv") return ["csv", "tsv", "md", "html", "json", "png"]
  if (format === "docx" || format === "pptx") return ["md", "txt", "html", "png"]
  if (format === "html") return ["md", "txt", "html", "png"]
  if (format === "legacy") {
    const extension = path?.toLowerCase().split(".").pop()
    const native =
      extension === "ods" || extension === "xls" ? "xlsx" : extension === "odp" || extension === "ppt" ? "pptx" : "docx"
    return ["md", "txt", "html", native, "png"]
  }
  return ["txt", "png"]
}
