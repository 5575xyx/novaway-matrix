/**
 * 新建文件的可选格式与路径规范化（纯数据 + 纯函数，方便单测）。
 *
 * 文本类格式直接写字符串；Office 二进制（docx / xlsx / pptx）走
 * `office.document.create`，由 core 的写入器生成真正的 OOXML 包 ——
 * 拿空文本冒充只会得到一个打不开的文件，所以分成两条创建路径。
 */

export type NewFileFormat = {
  id: string
  label: string
  group: "office" | "text" | "code"
  extension: string
  template: string
  /** 二进制格式：创建时交给服务端写入器，而不是直接写 template。 */
  binary?: boolean
  hint: string
}

const HTML_TEMPLATE = [
  "<!doctype html>",
  '<html lang="zh-CN">',
  "<head>",
  '  <meta charset="utf-8" />',
  "  <title>新文档</title>",
  "</head>",
  "<body>",
  "  <h1>新文档</h1>",
  "  <p>从这里开始写。</p>",
  "</body>",
  "</html>",
  "",
].join("\n")

export const NEW_FILE_FORMATS: readonly NewFileFormat[] = [
  {
    id: "docx",
    label: "Word 文档",
    group: "office",
    extension: "docx",
    template: "",
    binary: true,
    hint: "段落、表格、页眉页脚",
  },
  {
    id: "xlsx",
    label: "Excel 表格",
    group: "office",
    extension: "xlsx",
    template: "",
    binary: true,
    hint: "工作表、公式、样式",
  },
  {
    id: "pptx",
    label: "PPT 演示",
    group: "office",
    extension: "pptx",
    template: "",
    binary: true,
    hint: "幻灯片与文本框",
  },
  {
    id: "pdf",
    label: "PDF 文档",
    group: "office",
    extension: "pdf",
    template: "",
    binary: true,
    hint: "空白 A4，可批注与叠字",
  },
  {
    id: "markdown",
    label: "Markdown",
    group: "text",
    extension: "md",
    template: "# 新笔记\n\n",
    hint: "标题、列表、表格、公式",
  },
  { id: "text", label: "纯文本", group: "text", extension: "txt", template: "", hint: "任意文字，不带格式" },
  {
    id: "richtext",
    label: "富文本",
    group: "text",
    extension: "html",
    template: HTML_TEMPLATE,
    hint: "设计视图 + 源码",
  },
  { id: "csv", label: "表格 CSV", group: "text", extension: "csv", template: "", hint: "格子视图和文本视图" },
  { id: "json", label: "JSON", group: "code", extension: "json", template: "{\n}\n", hint: "可格式化" },
  { id: "javascript", label: "JavaScript", group: "code", extension: "js", template: "", hint: "" },
  { id: "typescript", label: "TypeScript", group: "code", extension: "ts", template: "", hint: "" },
  { id: "python", label: "Python", group: "code", extension: "py", template: "", hint: "" },
  { id: "go", label: "Go", group: "code", extension: "go", template: "", hint: "" },
  { id: "rust", label: "Rust", group: "code", extension: "rs", template: "", hint: "" },
  { id: "yaml", label: "YAML", group: "code", extension: "yaml", template: "", hint: "" },
  { id: "toml", label: "TOML", group: "code", extension: "toml", template: "", hint: "" },
  {
    id: "xml",
    label: "XML",
    group: "code",
    extension: "xml",
    template: '<?xml version="1.0" encoding="UTF-8"?>\n',
    hint: "",
  },
  { id: "sql", label: "SQL", group: "code", extension: "sql", template: "", hint: "" },
  { id: "shell", label: "Shell", group: "code", extension: "sh", template: "", hint: "" },
  { id: "css", label: "CSS", group: "code", extension: "css", template: "", hint: "" },
]

/** 已经有扩展名就尊重用户输入，否则补上所选格式的扩展名。 */
export function withExtension(name: string, extension: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  return base.includes(".") ? name : name + "." + extension
}

/** 按分组给 UI 用。 */
export function formatGroups(): Array<{ id: "office" | "text" | "code"; label: string; items: NewFileFormat[] }> {
  return [
    { id: "office", label: "Office 文档", items: NEW_FILE_FORMATS.filter((item) => item.group === "office") },
    { id: "text", label: "文本与网页", items: NEW_FILE_FORMATS.filter((item) => item.group === "text") },
    { id: "code", label: "代码与数据", items: NEW_FILE_FORMATS.filter((item) => item.group === "code") },
  ]
}
