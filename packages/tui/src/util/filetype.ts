import path from "node:path"
import type { Theme } from "../theme"

export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  ".abap": "abap",
  ".bat": "bat",
  ".bib": "bibtex",
  ".bibtex": "bibtex",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".cljc": "clojure",
  ".edn": "clojure",
  ".coffee": "coffeescript",
  ".c": "c",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".cc": "cpp",
  ".c++": "cpp",
  ".cs": "csharp",
  ".csx": "csharp",
  ".css": "css",
  ".d": "d",
  ".pas": "pascal",
  ".pascal": "pascal",
  ".diff": "diff",
  ".patch": "diff",
  ".dart": "dart",
  ".dockerfile": "dockerfile",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".ets": "typescript",
  ".hrl": "erlang",
  ".fs": "fsharp",
  ".fsi": "fsharp",
  ".fsx": "fsharp",
  ".fsscript": "fsharp",
  ".gitcommit": "git-commit",
  ".gitrebase": "git-rebase",
  ".go": "go",
  ".groovy": "groovy",
  ".gleam": "gleam",
  ".hbs": "handlebars",
  ".handlebars": "handlebars",
  ".hs": "haskell",
  ".lhs": "haskell",
  ".html": "html",
  ".htm": "html",
  ".ini": "ini",
  ".java": "java",
  ".jl": "julia",
  ".js": "javascript",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".jsx": "javascriptreact",
  ".json": "json",
  ".tex": "latex",
  ".latex": "latex",
  ".less": "less",
  ".lua": "lua",
  ".makefile": "makefile",
  makefile: "makefile",
  ".md": "markdown",
  ".markdown": "markdown",
  ".m": "objective-c",
  ".mm": "objective-cpp",
  ".pl": "perl",
  ".pm": "perl",
  ".pm6": "perl6",
  ".php": "php",
  ".ps1": "powershell",
  ".psm1": "powershell",
  ".pug": "jade",
  ".jade": "jade",
  ".py": "python",
  ".r": "r",
  ".cshtml": "razor",
  ".razor": "razor",
  ".rb": "ruby",
  ".rake": "ruby",
  ".gemspec": "ruby",
  ".ru": "ruby",
  ".erb": "erb",
  ".html.erb": "erb",
  ".js.erb": "erb",
  ".css.erb": "erb",
  ".json.erb": "erb",
  ".rs": "rust",
  ".scss": "scss",
  ".sass": "sass",
  ".scala": "scala",
  ".shader": "shaderlab",
  ".sh": "shellscript",
  ".bash": "shellscript",
  ".zsh": "shellscript",
  ".ksh": "shellscript",
  ".sql": "sql",
  ".svelte": "svelte",
  ".swift": "swift",
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".mts": "typescript",
  ".cts": "typescript",
  ".mtsx": "typescriptreact",
  ".ctsx": "typescriptreact",
  ".xml": "xml",
  ".xsl": "xsl",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".vue": "vue",
  ".zig": "zig",
  ".zon": "zig",
  ".astro": "astro",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".tf": "terraform",
  ".tfvars": "terraform-vars",
  ".hcl": "hcl",
  ".nix": "nix",
  ".typ": "typst",
  ".typc": "typst",
}

export function filetype(input?: string) {
  if (!input) return "none"
  const language = LANGUAGE_EXTENSIONS[path.extname(input)]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}

/**
 * 文件树那一列的**语言标签**:扩展名 → 两三个字的小标记(原型 card-design-v7.html:800-806 的
 * `TS` / `JS` / `{}` / `Ⓜ`)。
 *
 * 为什么不用上面那张 LANGUAGE_EXTENSIONS:那一张给的是编辑器用的语言 id,而且
 * `filetype()` 会把 javascript / javascriptreact / typescriptreact 一律并成 `typescript`
 * (见上面的实现) —— 文件树要的是「这一行是 TS 还是 JS」,并掉之后就分不出来了。
 * 所以这里是一张独立的小表,键是**不带点的扩展名**。
 *
 * 为什么不读配置:这四五个标记是版式的一部分(每个 2 列,见 file-tree 的渲染处),
 * 交给用户配只会得到一堆宽度不一的标签,把整列名字的起点顶乱。
 *
 * 键必须覆盖到 FILE_TREE_NAME_MAX 那条预算:每个标签都印在**固定 2 列**的槽里,
 * `Ⓜ`(U+24C2,East-Asian Ambiguous)按标准口径记 1 列,那一列的空白由槽补上 ——
 * 于是同一屏里 TS 行与 Ⓜ 行的文件名起点逐列对齐(理由见 file-tree 的渲染处)。
 */
export type FileTagKind = "ts" | "js" | "json" | "md" | "py" | "rs"

const FILE_TAGS: Record<string, FileTagKind> = {
  ts: "ts",
  tsx: "ts",
  mts: "ts",
  cts: "ts",
  js: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  json: "json",
  jsonc: "json",
  md: "md",
  mdx: "md",
  py: "py",
  rs: "rs",
}

/** 标签字面。宽度按标准口径:TS/JS/{}/PY/RS 各 2 列,Ⓜ 1 列。 */
const FILE_TAG_TEXT: Record<FileTagKind, string> = {
  ts: "TS",
  js: "JS",
  json: "{}",
  md: "Ⓜ",
  py: "PY",
  rs: "RS",
}

/**
 * 这个文件名有没有语言标签。**认不出来的返回 undefined** —— 调用方据此落回文件图标,
 * 而不是画一个空标签:空标签会占掉一列,同一屏里认得出的行与认不出的行名字起点就差了 2 列。
 * 无扩展名的文件(Makefile、LICENSE)同样没有标签。
 */
export function fileTag(name: string): { kind: FileTagKind; text: string } | undefined {
  // 与 panel-icons 的 fileIcon 同一套取扩展名的口径(整名小写、按最后一个点切)。
  const raw = name.toLowerCase().split(".").pop() ?? ""
  const kind = FILE_TAGS[raw]
  if (!kind) return undefined
  return { kind, text: FILE_TAG_TEXT[kind] }
}

/**
 * 标签的颜色(原型 card-design-v7.html:212-213 的 `.tag-ts` / `.tag-js` / `.tag-json` / `.tag-md`,
 * 四色分别取自它的 `--blue` / 黄 / `--amber` / `--pink`)。
 *
 * 取的是**语法高亮那一族**的 token,理由两条:
 *   · 语义对得上 —— 一个文件用什么颜色标,就是高亮器会用什么颜色标它。
 *   · 明暗两种主题下都读得出,因为这些 token 本来就是画在同一块面板底上的正文色:
 *     每个主题 JSON 都为 dark / light 各配一个值(见 theme/assets/novaway.json:208-243),
 *     浅色那组是压深的(TS:深色 #00e5ff → 浅色 #0066cc)。也就是说「标签能不能看清」这件事
 *     主题作者已经替它答过了。换成 primary / secondary 之类装饰色反而没有这个保证 ——
 *     同一个 token 在不同主题里未必都配了值(未声明时回落 primary/secondary/accent),
 *     而这一族是每个主题都必须给全的。
 *
 * 六档在 novaway 默认主题上的实测对比度(相对 backgroundPanel,WCAG 相对亮度):
 *              深色(#0d1320)   浅色(#edf0f5)
 *   TS         12.79           4.41
 *   JS         14.18           3.10
 *   {}         10.57           2.72
 *   Ⓜ           5.33           4.68
 *   PY         14.08           3.28
 *   RS          5.80           4.56
 * 浅色下最低的是 {} 那档 2.72 —— 原型自己的四个颜色落在同一块底上是 **1.29 ~ 2.53**
 * (JS 的 #f5d76e 只有 1.29),这一档已经比原型好一倍以上;而标签是装饰信息,
 * 真正承载信息的是它右边那一列文件名。
 */
export function fileTagColor(kind: FileTagKind, theme: Theme) {
  switch (kind) {
    case "ts":
      return theme.syntaxFunction
    case "js":
      return theme.syntaxType
    case "json":
      return theme.syntaxNumber
    case "md":
      return theme.syntaxKeyword
    case "py":
      return theme.syntaxString
    default:
      return theme.syntaxVariable
  }
}
