/**
 * 路径 → 语法高亮的语言标识（Shiki 的语言 id）。
 *
 * 按扩展名认语言，不做内容嗅探：
 * 编辑器只负责「给这块文字上色」，认不出来就退回纯文本，不猜。
 *
 * 这里只返回字符串，不依赖 Shiki —— 语言表的唯一真相留在 core，
 * 渲染层（app）拿 id 去加载对应的语法。
 */

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "jsonc",
  json5: "json5",
  md: "markdown",
  markdown: "markdown",
  mdown: "markdown",
  mkd: "markdown",
  mdx: "markdown",
  html: "html",
  htm: "html",
  xhtml: "html",
  css: "css",
  scss: "scss",
  less: "less",
  py: "python",
  pyi: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  php: "php",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  xml: "xml",
  svg: "xml",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  lua: "lua",
  dart: "dart",
  scala: "scala",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  csv: "csv",
  diff: "diff",
  patch: "diff",
  graphql: "graphql",
  gql: "graphql",
  prisma: "prisma",
  zig: "zig",
}

/** 没有扩展名但语言固定的文件名。 */
const LANGUAGE_BY_FILENAME: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
}

/** 返回 Shiki 语言 id；纯文本 / 未知扩展名返回 undefined（按纯文本渲染）。 */
export function syntaxLanguageOf(path: string | undefined): string | undefined {
  if (!path) return undefined
  const name = path.split(/[\\/]/).pop() ?? path
  const fromName = LANGUAGE_BY_FILENAME[name.toLowerCase()]
  if (fromName) return fromName
  const dot = name.lastIndexOf(".")
  if (dot <= 0) return undefined
  return LANGUAGE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()]
}

/** 文件是否值得开语法高亮：纯文本（.txt / 无扩展名）不开。 */
export function hasSyntaxLanguage(path: string | undefined): boolean {
  return syntaxLanguageOf(path) !== undefined
}
