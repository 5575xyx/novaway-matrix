import { Icon, type IconProps } from "@novaway/ui/icon"
import { Show, type Component } from "solid-js"

/**
 * 「应用图标」：彩色圆角方块 + 白色字形，与市场页那一排插件图标同风格。
 *
 * 之前技能 / MCP / 扩展行统一是「14% 淡色底 + 单色线性图标」，一屏看下去全是灰的，
 * 分不出谁是谁。这里按名字稳定选择主题语义色，每个条目保持颜色一致，
 * 常见的类型（PPT / 表格 / 文档 / 浏览器 / 记忆 …）再用各自的字形。
 */
export type AppIconStyle = {
  /** 渐变起点（左上）。 */
  from: string
  /** 渐变终点（右下）。 */
  to: string
  /** 适配当前强调色的字形前景色。 */
  foreground: string
  glyph: IconProps["name"]
}

/** 内置类型的字形映射；颜色由主题语义色生成。 */
const PRESET_GLYPHS: Record<string, IconProps["name"]> = {
  pdf: "lu-file-text",
  presentations: "lu-presentation",
  spreadsheets: "lu-table",
  documents: "lu-file-text",
  visualize: "chart",
  design: "lu-image",
  knowledge: "database",
  meetings: "lu-users",
  tasks: "lu-list-checks",
  communication: "bubble-5",
  "browser-use": "lu-chrome",
  "computer-use": "autopilot",
  "skill-tools": "lu-wrench",
  "media-ops": "lu-megaphone",
  "topic-radar": "lu-globe",
  "humanize-writing": "lu-square-pen",
  "account-review": "lu-activity",
  "wxgzh-ops": "bubble-5",
  "xiaohongshu-ops": "lu-square-pen",
  "memory-service": "lu-brain",
  "ppt-master": "lu-presentation",
  "office-ppt": "lu-presentation",
  "office-data": "lu-table",
  "office-document": "lu-file-text",
  "office-web": "chart",
  "office-design": "lu-image",
  "office-knowledge": "database",
  "office-meeting": "lu-users",
  "office-task": "lu-list-checks",
  "office-communication": "bubble-5",
  github: "github",
  context7: "lu-globe",
  memory: "lu-brain",
  "sequential-thinking": "lu-list-checks",
  playwright: "lu-chrome",
  "playwright-mcp": "lu-chrome",
  chrome: "lu-chrome",
  "chrome-devtools": "lu-chrome",
  puppeteer: "lu-chrome",
  filesystem: "folder",
  fetch: "lu-globe",
  figma: "lu-image",
  notion: "lu-file-text",
  postgres: "database",
  postgresql: "database",
  mysql: "database",
  sqlite: "database",
}

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

const THEME_TONES = [
  ["--icon-interactive-base", "--text-on-interactive-base"],
  ["--icon-agent-plan-base", "--text-on-brand-base"],
  ["--icon-success-base", "--text-on-success-base"],
  ["--icon-warning-base", "--text-on-warning-base"],
  ["--icon-info-base", "--text-on-info-base"],
  ["--icon-critical-base", "--text-on-critical-base"],
  ["--icon-brand-base", "--text-on-brand-base"],
] as const

function themedTone(seed: string) {
  const [token, foreground] = THEME_TONES[hash(seed) % THEME_TONES.length]!
  return {
    from: `color-mix(in oklab, var(${token}) 78%, var(--surface))`,
    to: `var(${token})`,
    foreground: `var(${foreground})`,
  }
}

/**
 * 取一个条目应显示的图标样式。
 *
 * 优先显式字形（内置扩展自己声明了最合适的那个），其次是名字关键字，
 * 最后用调用方给的兜底字形（MCP 列表用 `mcp`、通用资源行用 `dot-grid`）。
 * 配色由条目名稳定选择主题语义色，因此同一条目始终一致并跟随当前主题。
 */
export function appIcon(
  seed: string,
  options: { glyph?: IconProps["name"]; fallback?: IconProps["name"] } = {},
): AppIconStyle {
  const key = seed.trim().toLowerCase()
  const preset = PRESET_GLYPHS[key]
  const glyph = options.glyph ?? preset ?? inferGlyph(key) ?? options.fallback ?? "mcp"
  return { ...themedTone(key), glyph }
}

const SIZES = {
  mini: { box: "size-6 rounded-md", glyph: "small" as const },
  xs: { box: "size-7 rounded-lg", glyph: "small" as const },
  sm: { box: "size-8 rounded-[9px]", glyph: "normal" as const },
  md: { box: "size-9 rounded-[10px]", glyph: "normal" as const },
  lg: { box: "size-10 rounded-xl", glyph: "medium" as const },
}

/**
 * 应用图标方块。
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
        "box-shadow": "inset 0 1px 0 color-mix(in srgb, var(--text-invert-strong) 30%, transparent), var(--shadow-xs)",
      }}
      aria-hidden={props.label ? undefined : "true"}
      aria-label={props.label}
      role={props.label ? "img" : undefined}
    >
      {/* 左上角一点柔光，纯色块就不会显得像色卡。 */}
      <span
        class="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(120% 90% at 22% 6%, color-mix(in srgb, ${style().foreground} 34%, transparent), transparent 60%)`,
        }}
      />
      <Show when={props.label}>
        <span class="sr-only">{props.label}</span>
      </Show>
      <Icon
        name={style().glyph}
        size={box().glyph}
        class="relative"
        style={{
          color: style().foreground,
          filter: "drop-shadow(0 1px 1px color-mix(in srgb, var(--text-strong) 18%, transparent))",
        }}
      />
    </span>
  )
}
