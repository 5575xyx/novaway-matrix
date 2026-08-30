// 侧栏/面板/文件树/标签栏图标。三套可切:nerdfont(默认,需 Nerd Font 终端字体)/ emoji(兜底,几乎不乱码)/ ascii(纯文本)。
// 由 tui config 的 `icons` 决定;app 启动时调用 setIconStyle() 落定,渲染时用 icon()/fileIcon()/treeArrow() 取值。
// 注意:终端不上报字形是否渲染成方块,故无法"检测到方块自动回退";没装 Nerd Font 请显式设 icons: "emoji"。
// nerdfont 一律写成 \uXXXX 转义 + 行内注释,因为私有区字形在编辑器里本来就看不出是什么。

import { createSignal } from "solid-js"

export type IconStyle = "nerdfont" | "emoji" | "ascii"
export type PanelIconKey = "info" | "files" | "git" | "hub" | "memory" | "evolution" | "checkpoint" | "goal" | "workflow" | "orchestrator" | "chat" | "doc"

const PANEL_SETS: Record<IconStyle, Record<PanelIconKey, string>> = {
  nerdfont: { git: "", info:"", files: "", hub: "", memory: "", evolution: "", checkpoint: "", goal: "", workflow: "", orchestrator: "", chat: "", doc: "" },
  emoji: { git: "🌿", info: "📋", files: "📁", hub: "🧩", memory: "🧠", evolution: "🧬", checkpoint: "📸", goal: "🎯", workflow: "🔄", orchestrator: "🕹️", chat: "💬", doc: "📄" },
  ascii: { git: "g", info: ">", files: "/", hub: "#", memory: "~", evolution: "^", checkpoint: "*", goal: "@", workflow: "&", orchestrator: "%", chat: ":", doc: "." },
}

// 文件树图标。键是"图标分组",不是扩展名本身:先按整个文件名查 FILE_NAME_GROUP,再按扩展名(经 EXT_GROUP 归并)查,最后回落 default。
// nerdfont 用 Nerd Font 里已配好的那套文件树字形(seti / devicons / FontAwesome 三个区);
// emoji / ascii 只给常见分组,其余自动回落到该风格的 default,不必逐条补齐。
const FILE_SETS: Record<IconStyle, Record<string, string>> = {
  nerdfont: {
    folder: "", // fa-folder
    folderOpen: "", // fa-folder-open
    ts: "", js: "", json: "", md: "", css: "", html: "",
    py: "", rs: "", go: "", yaml: "", sql: "", sh: "",
    vue: "", svelte: "", java: "", kt: "", c: "", cpp: "",
    cs: "", rb: "", php: "", swift: "", lua: "", dart: "",
    scala: "", zig: "", toml: "", xml: "", makefile: "",
    git: "", docker: "", npm: "",
    conf: "", // fa-cog
    lock: "", // fa-lock
    txt: "", // fa-file-text
    pdf: "", word: "", excel: "", ppt: "",
    image: "", archive: "", audio: "", video: "",
    book: "", // fa-book
    license: "", // fa-gavel
    default: "", // fa-file
  },
  emoji: {
    folder: "📁", folderOpen: "📂",
    ts: "📘", js: "📙", json: "📋", md: "📝", css: "🎨", html: "🌐", py: "🐍", rs: "🦀", go: "🔵",
    yaml: "⚙️", sql: "🗄️", sh: "💻", vue: "💚", java: "☕", rb: "💎", php: "🐘", swift: "🕊️",
    git: "🌿", docker: "🐳", npm: "📦", conf: "⚙️", lock: "🔒", txt: "📃", pdf: "📕",
    word: "📄", excel: "📊", ppt: "📊", image: "🖼️", archive: "🗜️", audio: "🎵", video: "🎬",
    book: "📖", license: "⚖️", default: "📄",
  },
  ascii: {
    folder: "/", folderOpen: "/",
    ts: "t", js: "j", json: "{", md: "m", css: "c", html: "<", py: "p", rs: "r", go: "g",
    yaml: "y", sql: "s", sh: "$", conf: "=", lock: "!", image: "i", archive: "z", default: ".",
  },
}

// 展开/折叠箭头也跟着图标风格走,免得 nerdfont 下混进两个几何符号。
const ARROW_SETS: Record<IconStyle, { open: string; closed: string }> = {
  nerdfont: { open: "", closed: "" }, // fa-chevron-down / fa-chevron-right
  emoji: { open: "▼", closed: "▶" },
  ascii: { open: "-", closed: "+" },
}

export const ICON_STYLES: readonly IconStyle[] = ["nerdfont", "emoji", "ascii"]

// 响应式:用 Solid signal 存当前风格,渲染期读 style() 会被追踪,/icon 切换后 UI 立即重绘。
const [style, setStyle] = createSignal<IconStyle>("nerdfont")
export function setIconStyle(next: IconStyle) {
  setStyle(next)
}
export function currentIconStyle(): IconStyle {
  return style()
}
// 循环取下一套风格,供 /icon 命令使用。
export function nextIconStyle(): IconStyle {
  const i = ICON_STYLES.indexOf(style())
  return ICON_STYLES[(i + 1) % ICON_STYLES.length]
}

export function icon(key: PanelIconKey): string {
  return PANEL_SETS[style()][key]
}

// 扩展名 -> 图标分组。没列出的扩展名直接当分组名查(所以 ts/py/go 这些同名的不用写在这里)。
const EXT_GROUP: Record<string, string> = {
  tsx: "ts", mts: "ts", cts: "ts",
  jsx: "js", mjs: "js", cjs: "js",
  scss: "css", sass: "css", less: "css", styl: "css",
  yml: "yaml",
  bash: "sh", zsh: "sh", fish: "sh", ps1: "sh", bat: "sh", cmd: "sh",
  h: "c", hpp: "cpp", cc: "cpp", cxx: "cpp", hh: "cpp",
  kts: "kt", htm: "html", mdx: "md", rst: "book",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", ico: "image", bmp: "image", svg: "image",
  zip: "archive", tar: "archive", gz: "archive", tgz: "archive", rar: "archive", "7z": "archive", xz: "archive", bz2: "archive",
  mp3: "audio", wav: "audio", flac: "audio", ogg: "audio", m4a: "audio",
  mp4: "video", mkv: "video", mov: "video", avi: "video", webm: "video",
  csv: "excel", xls: "excel", xlsx: "excel",
  doc: "word", docx: "word", pptx: "ppt",
  log: "txt", text: "txt",
  ini: "conf", cfg: "conf", env: "conf", properties: "conf", editorconfig: "conf",
  lockb: "lock",
}

// 整个文件名 -> 图标分组。比扩展名优先,用来认 package.json / Dockerfile / LICENSE 这类特殊文件。
const FILE_NAME_GROUP: Record<string, string> = {
  "package.json": "npm",
  "package-lock.json": "npm",
  "bun.lock": "lock",
  "bun.lockb": "lock",
  "yarn.lock": "lock",
  "pnpm-lock.yaml": "lock",
  "cargo.lock": "lock",
  dockerfile: "docker",
  "docker-compose.yml": "docker",
  "docker-compose.yaml": "docker",
  ".dockerignore": "docker",
  ".gitignore": "git",
  ".gitattributes": "git",
  ".gitmodules": "git",
  makefile: "makefile",
  readme: "book",
  "readme.md": "book",
  license: "license",
  "license.md": "license",
  "tsconfig.json": "ts",
}

export function fileIcon(name: string, isDirectory: boolean, expanded = false): string {
  const set = FILE_SETS[style()]
  if (isDirectory) return (expanded ? set.folderOpen : set.folder) ?? set.folder
  const lower = name.toLowerCase()
  const byName = FILE_NAME_GROUP[lower]
  if (byName && set[byName]) return set[byName]
  // 无扩展名时 pop() 返回整个文件名,正好能命中 makefile 这类分组。
  const raw = lower.split(".").pop() ?? ""
  return set[EXT_GROUP[raw] ?? raw] ?? set.default
}

export function treeArrow(expanded: boolean): string {
  const set = ARROW_SETS[style()]
  return expanded ? set.open : set.closed
}
