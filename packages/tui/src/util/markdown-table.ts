// MCP 工具返回的 markdown 表格解析(dbx 数据库工具的全部输出都是这个格式)。
// 从桌面端 packages/app/src/pages/database.tsx 原样搬来,放 util 以便单测。
export function extractResultText(data: unknown): string {
  if (typeof data === "string") return data
  if (data && typeof data === "object" && "content" in data && Array.isArray(data.content)) {
    const first = data.content[0]
    if (first && typeof first === "object" && "text" in first && typeof first.text === "string") {
      return first.text
    }
  }
  return ""
}

export function parseMarkdownTable(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split("\n").filter((line) => line.trim() !== "")
  if (lines.length === 0) return { headers: [], rows: [] }

  const headerLine = lines.find((line) => line.includes("|"))
  if (!headerLine) return { headers: [], rows: [] }

  const headers = headerLine
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim())

  const separatorIndex = lines.findIndex((line) => /^\s*\|(\s*[-:]+\s*\|)+$/.test(line))
  const rowLines = separatorIndex === -1 ? lines.slice(1) : lines.slice(separatorIndex + 1)

  const rows = rowLines
    .filter((line) => line.includes("|"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )

  return { headers, rows }
}
