import { Icon, type IconProps } from "@novaway/ui/icon"
import { Show, type Component } from "solid-js"

/**
 * 「应用图标」：彩色圆角方块 + 白色字形，对齐 ZCode 市场页那一排插件图标。
 *
 * 之前技能 / MCP / 扩展行统一是「14% 淡色底 + 单色线性图标」，一屏看下去全是灰的，
 * 分不出谁是谁。这里改成饱和渐变底 + 白字，每个条目按名字取一个稳定色，
 * 常见的类型（PPT / 表格 / 文档 / 浏览器 / 记忆 …）再用各自的字形。
 */
export type AppIconStyle = {
  /** 渐变起点（左上）。 */
  from: string
  /** 渐变终点（右下）。 */
  to: string
  /** 方块里的白色字形。 */
  glyph: IconProps["name"]
}

/** 类型专用配色：一眼能认出这是 PPT 还是表格。 */
const PRESETS: Record<string, AppIconStyle> = {
  // 内置扩展（builtin-extensions-data 的 id）
  pdf: { from: "#ff8d7a", to: "#d92d20", glyph: "lu-file-text" },
  presentations: { from: "#ffb74d", to: "#e8590c", glyph: "lu-presentation" },
  spreadsheets: { from: "#5fd68c", to: "#0f8a45", glyph: "lu-table" },
  documents: { from: "#74a9ff", to: "#1f5ac8", glyph: "lu-file-text" },
  visualize: { from: "#b388ff", to: "#6d28d9", glyph: "chart" },
  design: { from: "#ff8fc4", to: "#c0266e", glyph: "lu-image" },
  knowledge: { from: "#43d4d4", to: "#0e8c8c", glyph: "database" },
  meetings: { from: "#58c7f3", to: "#0369a1", glyph: "lu-users" },
  tasks: { from: "#f5b83d", to: "#b45309", glyph: "lu-list-checks" },
  communication: { from: "#7dd3fc", to: "#0284c7", glyph: "bubble-5" },
  "browser-use": { from: "#5b9dff", to: "#1d4ed8", glyph: "lu-chrome" },
  "computer-use": { from: "#a3b1c6", to: "#475569", glyph: "autopilot" },
  "skill-tools": { from: "#c084fc", to: "#7c3aed", glyph: "lu-wrench" },
  "wxgzh-ops": { from: "#5ad87a", to: "#15803d", glyph: "bubble-5" },
  "xiaohongshu-ops": { from: "#ff7a90", to: "#d81e42", glyph: "lu-square-pen" },
  "memory-service": { from: "#8fa8ff", to: "#4338ca", glyph: "lu-brain" },

  // 市场里最常见的几个条目
  "ppt-master": { from: "#ffb74d", to: "#e8590c", glyph: "lu-presentation" },
  "office-ppt": { from: "#ffb74d", to: "#e8590c", glyph: "lu-presentation" },
  "office-data": { from: "#5fd68c", to: "#0f8a45", glyph: "lu-table" },
  "office-document": { from: "#74a9ff", to: "#1f5ac8", glyph: "lu-file-text" },
  "office-web": { from: "#b388ff", to: "#6d28d9", glyph: "chart" },
  "office-design": { from: "#ff8fc4", to: "#c0266e", glyph: "lu-image" },
  "office-knowledge": { from: "#43d4d4", to: "#0e8c8c", glyph: "database" },
  "office-meeting": { from: "#58c7f3", to: "#0369a1", glyph: "lu-users" },
  "office-task": { from: "#f5b83d", to: "#b45309", glyph: "lu-list-checks" },
  "office-communication": { from: "#7dd3fc", to: "#0284c7", glyph: "bubble-5" },
  github: { from: "#5a5a66", to: "#17171f", glyph: "github" },
  context7: { from: "#43d4d4", to: "#0e8c8c", glyph: "lu-globe" },
  memory: { from: "#8fa8ff", to: "#4338ca", glyph: "lu-brain" },
  "sequential-thinking": { from: "#c084fc", to: "#7c3aed", glyph: "lu-list-checks" },
  playwright: { from: "#5b9dff", to: "#1d4ed8", glyph: "lu-chrome" },
  "playwright-mcp": { from: "#5b9dff", to: "#1d4ed8", glyph: "lu-chrome" },
  chrome: { from: "#5b9dff", to: "#1d4ed8", glyph: "lu-chrome" },
  "chrome-devtools": { from: "#5b9dff", to: "#1d4ed8", glyph: "lu-chrome" },
  puppeteer: { from: "#5b9dff", to: "#1d4ed8", glyph: "lu-chrome" },
  filesystem: { from: "#f5b83d", to: "#b45309", glyph: "folder" },
  fetch: { from: "#43d4d4", to: "#0e8c8c", glyph: "lu-globe" },
  figma: { from: "#ff8fc4", to: "#c0266e", glyph: "lu-image" },
  notion: { from: "#8d95a3", to: "#2f343d", glyph: "lu-file-text" },
  postgres: { from: "#6fa8ff", to: "#1f5ac8", glyph: "database" },
  postgresql: { from: "#6fa8ff", to: "#1f5ac8", glyph: "database" },
  mysql: { from: "#58c7f3", to: "#0369a1", glyph: "database" },
  sqlite: { from: "#58c7f3", to: "#0369a1", glyph: "database" },
}

/** 没有专用配色的条目从这里按名字哈希取一个稳定渐变，同一名字永远同色。 */
const TONES: Array<{ from: string; to: string }> = [
  { from: "#7cb4ff", to: "#2563eb" },
  { from: "#b59cff", to: "#7c3aed" },
  { from: "#5fd68c", to: "#059669" },
  { from: "#f8c74e", to: "#d97706" },
  { from: "#ff9cc8", to: "#db2777" },
  { from: "#4cd8ef", to: "#0891b2" },
  { from: "#ffa76b", to: "#ea580c" },
  { from: "#9aa8ff", to: "#4f46e5" },
  { from: "#52dcc8", to: "#0f766e" },
  { from: "#ff8f8f", to: "#dc2626" },
]

/**
 * 名字里带这些词就用对应字形：技能 / MCP 是动态加载的，没有清单可查，
 * 只能按名字猜。顺序即优先级，具体词放在泛词前面。
 */
const KEYWORDS: Array<[RegExp, IconProps["name"]]> = [
  [/(ppt|slide|presentation|deck|演示)/i, "lu-presentation"],
  [/(xls|excel|sheet|spreadsheet|表格)/i, "lu-table"],
  [/(pdf)/i, "lu-file-text"],
  [/(docx?|word|文档|report)/i, "lu-file-text"],
  [/(image|photo|design|figma|设计|图片|封面|海报)/i, "lu-image"],
  [/(chart|visual|dashboard|图表|视图)/i, "chart"],
  [/(meeting|会议)/i, "lu-users"],
  [/(task|todo|plan|planning|任务|规划)/i, "lu-list-checks"],
  [/(mail|email|chat|message|沟通|邮件|公众号|wechat)/i, "bubble-5"],
  [/(browser|playwright|puppeteer|chrome|浏览器)/i, "lu-chrome"],
  [/(computer|desktop|control|电脑)/i, "autopilot"],
  [/(memory|brain|记忆)/i, "lu-brain"],
  [/(database|sql|mysql|postgres|sqlite|数据库)/i, "database"],
  [/(github|gitlab|git)/i, "github"],
  [/(skill|plugin|wrench|技能|插件)/i, "lu-wrench"],
  [/(search|fetch|web|knowledge|知识)/i, "lu-globe"],
  [/(xiaohongshu|小红书|note)/i, "lu-square-pen"],
]

function hash(seed: string) {
  let value = 0
  for (let index = 0; index < seed.length; index += 1) {
    value = (value * 31 + seed.charCodeAt(index)) | 0
  }
  return Math.abs(value)
}

function inferGlyph(seed: string) {
  const name = seed.toLowerCase()
  for (const [pattern, glyph] of KEYWORDS) {
    if (pattern.test(name)) return glyph
  }
  return undefined
}

/**
 * 取一个条目应显示的图标样式。
 *
 * 优先显式字形（内置扩展自己声明了最合适的那个），其次是名字关键字，
 * 最后用调用方给的兜底字形（MCP 列表用 `mcp`、通用资源行用 `dot-grid`）。
 * 颜色始终由名字决定，所以同一个插件在「市场 / 已安装 / 办公模式」里颜色一致。
 */
export function appIcon(
  seed: string,
  options: { glyph?: IconProps["name"]; fallback?: IconProps["name"] } = {},
): AppIconStyle {
  const key = seed.trim().toLowerCase()
  const preset = PRESETS[key]
  const glyph = options.glyph ?? preset?.glyph ?? inferGlyph(key) ?? options.fallback ?? "mcp"
  if (preset) return { ...preset, glyph }
  const tone = TONES[hash(key) % TONES.length]!
  return { ...tone, glyph }
}

const SIZES = {
  mini: { box: "size-6 rounded-md", glyph: "small" as const },
  xs: { box: "size-7 rounded-lg", glyph: "small" as const },
  sm: { box: "size-8 rounded-[9px]", glyph: "normal" as const },
  md: { box: "size-9 rounded-[10px]", glyph: "normal" as const },
  lg: { box: "size-10 rounded-xl", glyph: "medium" as const },
}

/**
 * ZCode 风格的应用图标方块。
 *
 * 用 CSS 渐变而不是 SVG 渐变：暗色主题下不需要第二套定义，也不会出现
 * `<symbol>` 里 gradient id 冲突的问题。字形颜色必须写成 svg 的 inline style ——
 * `Icon` 组件在 `[data-component="icon"]` 上写死了 `color: var(--foreground-subtle)`。
 */
export const AppIcon: Component<{
  /** 名字：决定配色（也决定没给 glyph 时的字形）。 */
  seed: string
  /** 显式字形；不传就按名字推断。 */
  glyph?: IconProps["name"]
  /** 推断不出来时用的字形。 */
  fallback?: IconProps["name"]
  size?: keyof typeof SIZES
  class?: string
  /** 无障碍：一般图标旁边就有名字，默认隐藏。 */
  label?: string
}> = (props) => {
  const style = () => appIcon(props.seed, { glyph: props.glyph, fallback: props.fallback })
  const box = () => SIZES[props.size ?? "md"]
  return (
    <span
      data-component="app-icon"
      class={`relative grid shrink-0 place-items-center overflow-hidden ${box().box} ${props.class ?? ""}`}
      style={{
        background: `linear-gradient(135deg, ${style().from} 0%, ${style().to} 100%)`,
        "box-shadow": "inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 1px 2px rgba(0, 0, 0, 0.16)",
      }}
      aria-hidden={props.label ? undefined : "true"}
      aria-label={props.label}
      role={props.label ? "img" : undefined}
    >
      {/* 左上角一点柔光，纯色块就不会显得像色卡。 */}
      <span
        class="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(120% 90% at 22% 6%, rgba(255,255,255,0.34), rgba(255,255,255,0) 60%)",
        }}
      />
      <Show when={props.label}>
        <span class="sr-only">{props.label}</span>
      </Show>
      <Icon
        name={style().glyph}
        size={box().glyph}
        class="relative"
        style={{ color: "#fff", filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.18))" }}
      />
    </span>
  )
}
