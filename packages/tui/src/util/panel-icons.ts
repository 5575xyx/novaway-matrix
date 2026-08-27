// 侧栏/面板/文件树/标签栏图标。三套可切:nerdfont(默认,需 Nerd Font 终端字体)/ emoji(兜底,几乎不乱码)/ ascii(纯文本)。
// 由 tui config 的 `icons` 决定;app 启动时调用 setIconStyle() 落定,渲染时用 icon()/fileIcon() 取值。
// 注意:终端不上报字形是否渲染成方块,故无法"检测到方块自动回退";没装 Nerd Font 请显式设 icons: "emoji"。

import { createSignal } from "solid-js"

export type IconStyle = "nerdfont" | "emoji" | "ascii"
export type PanelIconKey = "info" | "files" | "hub" | "memory" | "evolution" | "checkpoint" | "goal" | "workflow" | "orchestrator" | "chat" | "doc"

const PANEL_SETS: Record<IconStyle, Record<PanelIconKey, string>> = {
  nerdfont: { info: "", files: "", hub: "", memory: "", evolution: "", checkpoint: "", goal: "", workflow: "", orchestrator: "", chat: "", doc: "" },
  emoji: { info: "📋", files: "📁", hub: "🧩", memory: "🧠", evolution: "🧬", checkpoint: "📸", goal: "🎯", workflow: "🔄", orchestrator: "🕹️", chat: "💬", doc: "📄" },
  ascii: { info: ">", files: "/", hub: "#", memory: "~", evolution: "^", checkpoint: "*", goal: "@", workflow: "&", orchestrator: "%", chat: ":", doc: "." },
}

const FILE_SETS: Record<IconStyle, Record<string, string>> = {
  nerdfont: { folder: "", ts: "", js: "", json: "", md: "", css: "", html: "", py: "", rs: "", go: "", yaml: "", sql: "", sh: "", default: "" },
  emoji: { folder: "📁", ts: "📘", js: "📙", json: "📋", md: "📝", css: "🎨", html: "🌐", py: "🐍", rs: "🦀", go: "🔵", yaml: "⚙️", sql: "🗄️", sh: "💻", default: "📄" },
  ascii: { folder: "/", ts: "t", js: "j", json: "{", md: "m", css: "c", html: "<", py: "p", rs: "r", go: "g", yaml: "y", sql: "s", sh: "$", default: "." },
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

const EXT_ALIAS: Record<string, string> = { tsx: "ts", jsx: "js", scss: "css", yml: "yaml", bash: "sh" }

export function fileIcon(name: string, isDirectory: boolean): string {
  const set = FILE_SETS[style()]
  if (isDirectory) return set.folder
  const raw = name.split(".").pop()?.toLowerCase() ?? ""
  const ext = EXT_ALIAS[raw] ?? raw
  return set[ext] ?? set.default
}
