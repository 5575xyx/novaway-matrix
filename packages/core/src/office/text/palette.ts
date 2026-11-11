/**
 * 命令面板（⇧⌘P）的模糊匹配与命令表。
 *
 * 输入几个字母就能找到命令，
 * 匹配是「按顺序出现的字符」，词首、连续、开头更靠前都会加分。
 *
 * 命令本身只是**数据和 id**，怎么执行由 UI 决定 —— 这样面板里能搜到的
 * 和 AI 能调的永远是同一批能力（op 的覆盖范围由 `scope` 表达）。
 */

export type PaletteScope = "all" | "markdown" | "text" | "json" | "rich"

/** UI 能做到的范围：能打开的文档类型和面板能力。 */
export type PaletteContext = {
  /** markdown / text / json；rich（HTML）不算 Markdown 作用域。 */
  kind: "markdown" | "text" | "json" | "rich"
}

export type PaletteCommand = {
  id: string
  /** 中文标签，也是主要匹配目标。 */
  label: string
  /** 英文/拼音别名；标签匹配不上时再试一次。 */
  alias?: string
  scope: PaletteScope
  shortcut?: string
}

const COMMANDS: readonly PaletteCommand[] = [
  { id: "save", label: "保存", alias: "Save baocun", scope: "all", shortcut: "⌘S" },
  { id: "find", label: "查找", alias: "Find chazhao", scope: "all", shortcut: "⌘F" },
  { id: "goToLine", label: "跳转到行", alias: "Go to line tiaozhuan", scope: "text", shortcut: "⌘G" },
  { id: "workspaceSearch", label: "在项目里搜索", alias: "Search in folder workspace quanjusousuo", scope: "text" },
  { id: "replace", label: "替换", alias: "Replace tihuan", scope: "all", shortcut: "⌘H" },
  { id: "undo", label: "撤销（宿主历史）", alias: "Undo chexiao", scope: "all" },
  { id: "redo", label: "重做（宿主历史）", alias: "Redo zhongzuo", scope: "all" },
  // 纯视图开关（`view.wrap`）：不改文件，所以放在 all 作用域。
  { id: "wrap", label: "自动换行", alias: "Word wrap huanhang", scope: "all" },
  { id: "focusMode", label: "专注模式", alias: "Focus mode zhuanzhu", scope: "all" },
  { id: "typewriter", label: "打字机滚动", alias: "Typewriter scrolling dazi", scope: "all" },
  { id: "indent", label: "增加缩进", alias: "Indent suojin", scope: "text", shortcut: "Tab" },
  { id: "outdent", label: "减少缩进", alias: "Outdent", scope: "text", shortcut: "⇧Tab" },
  { id: "moveUp", label: "上移行", alias: "Move line up", scope: "text", shortcut: "⌥↑" },
  { id: "moveDown", label: "下移行", alias: "Move line down", scope: "text", shortcut: "⌥↓" },
  { id: "duplicate", label: "复制行", alias: "Duplicate line", scope: "text", shortcut: "⇧⌥↓" },
  { id: "delete", label: "删除行", alias: "Delete line", scope: "text", shortcut: "⇧⌘K" },
  { id: "comment", label: "注释 / 取消注释", alias: "Toggle comment", scope: "text", shortcut: "⌘/" },
  { id: "upper", label: "转为大写", alias: "Uppercase daxie", scope: "text" },
  { id: "lower", label: "转为小写", alias: "Lowercase xiaoxie", scope: "text" },
  { id: "title", label: "首字母大写", alias: "Title case shouzimu", scope: "text" },
  { id: "tabs", label: "缩进转为 Tab", alias: "Indent to tabs", scope: "text" },
  { id: "spaces", label: "缩进转为空格", alias: "Indent to spaces", scope: "text" },
  { id: "sort", label: "升序排列行", alias: "Sort lines ascending paixu", scope: "text" },
  { id: "sortDesc", label: "降序排列行", alias: "Sort lines descending", scope: "text" },
  { id: "unique", label: "删除重复行", alias: "Unique lines quchong", scope: "text" },
  { id: "reverse", label: "反转行序", alias: "Reverse lines fanzhuan", scope: "text" },
  { id: "trim", label: "删除行尾空格", alias: "Trim trailing whitespace", scope: "text" },
  { id: "join", label: "合并行", alias: "Join lines hebing", scope: "text" },
  { id: "json", label: "格式化代码", alias: "Format document geshihua", scope: "text", shortcut: "⇧⌥F" },
  { id: "heading1", label: "一级标题", alias: "Heading 1 h1 biaoti", scope: "markdown" },
  { id: "heading2", label: "二级标题", alias: "Heading 2 h2 biaoti", scope: "markdown" },
  { id: "heading3", label: "三级标题", alias: "Heading 3 h3 biaoti", scope: "markdown" },
  { id: "bulletList", label: "无序列表", alias: "Bullet list wuxu liebiao", scope: "text" },
  { id: "orderedList", label: "有序列表", alias: "Numbered ordered list youxu liebiao", scope: "text" },
  { id: "taskList", label: "任务列表", alias: "Task list todo renwu", scope: "text" },
  { id: "quote", label: "引用", alias: "Block quote yinyong", scope: "text" },
  { id: "taskToggle", label: "勾选 / 取消任务", alias: "Toggle task checkbox renwu", scope: "text" },
  { id: "footnote", label: "插入脚注", alias: "Insert footnote jiaozhu", scope: "markdown" },
  { id: "callout", label: "插入标注块 Callout", alias: "Insert callout", scope: "markdown" },
  { id: "math", label: "插入公式块", alias: "Insert math block gongshi", scope: "markdown" },
  { id: "inlineMath", label: "插入行内公式", alias: "Insert inline math", scope: "markdown" },
  { id: "image", label: "插入图片", alias: "Insert image tupian", scope: "markdown" },
  { id: "table", label: "插入表格", alias: "Insert table biaoge", scope: "markdown" },
  { id: "codeBlock", label: "插入代码块", alias: "Insert code block daimakuai", scope: "markdown" },
  { id: "rule", label: "插入分隔线", alias: "Insert horizontal rule fengexian", scope: "markdown" },
  { id: "link", label: "插入链接", alias: "Insert link lianjie", scope: "markdown" },
  { id: "date", label: "插入日期", alias: "Insert date riqi", scope: "text" },
  { id: "time", label: "插入时间", alias: "Insert time shijian", scope: "text" },
  { id: "datetime", label: "插入日期和时间", alias: "Insert date and time", scope: "text" },
  { id: "properties", label: "编辑文档属性", alias: "Edit properties shuxing", scope: "markdown" },
  {
    id: "markdownPreview",
    label: "切换 Markdown 视图（实况 / 阅读 / 源码）",
    alias: "Preview source live shikuang",
    scope: "markdown",
  },
  { id: "outline", label: "切换大纲", alias: "Outline dagang", scope: "markdown" },
  { id: "notes", label: "笔记：标签 / 链接 / 反链", alias: "Notes tags backlinks biaoqian fanlian", scope: "markdown" },
  { id: "richSource", label: "切换设计 / 源码视图", alias: "Design source", scope: "rich" },
  { id: "richCanvas", label: "切换画布宽度（手机 / 桌面）", alias: "Canvas phone desktop", scope: "rich" },
]

/**
 * 模糊匹配：`query` 里的字符按顺序出现在 `text` 里就算命中。
 *
 * 加分项：词首（空格/斜线/下划线/短横/点/冒号之后）最值钱，
 * 连续匹配次之；越晚才出现、文本越长都会扣分。大小写不敏感。
 */
export function fuzzyMatch(query: string, text: string): { score: number; positions: number[] } | undefined {
  const wanted = [...query].filter((char) => !/\s/.test(char)).map((char) => char.toLowerCase())
  if (wanted.length === 0) return { score: 0, positions: [] }

  const chars = [...text]
  const lower = chars.map((char) => char.toLowerCase())
  const positions: number[] = []
  let score = 0
  let at = 0

  for (const target of wanted) {
    const found = lower.indexOf(target, at)
    if (found === -1) return undefined
    const previous = found > 0 ? chars[found - 1]! : undefined
    const boundary =
      found === 0 ||
      (previous !== undefined && /[ /\_\-.：:]/.test(previous)) ||
      (chars[found]! !== chars[found]!.toLowerCase() && previous !== undefined && previous === previous.toLowerCase())
    score += 10
    if (boundary) score += 15
    const last = positions.at(-1)
    if (last !== undefined && last + 1 === found) score += 12
    else if (last !== undefined) score -= Math.min(found - last - 1, 10)
    else score -= Math.min(found, 10)
    positions.push(found)
    at = found + 1
  }
  score -= Math.floor(chars.length / 8)
  return { score, positions }
}

function scopeOf(kind: PaletteContext["kind"]): PaletteScope[] {
  if (kind === "markdown") return ["all", "markdown", "text", "json"]
  if (kind === "json") return ["all", "text", "json"]
  if (kind === "rich") return ["all", "rich"]
  return ["all", "text"]
}

/**
 * 当前文档能用的命令，按匹配度排序。
 *
 * 标签命中优先（+5），标签没命中才退回别名；
 * 分数相同时保持命令表顺序，结果稳定。
 */
export function filterCommands(
  context: PaletteContext,
  query: string,
): Array<PaletteCommand & { positions: number[] }> {
  const scopes = scopeOf(context.kind)
  const ranked: Array<{ score: number; order: number; command: PaletteCommand; positions: number[] }> = []
  COMMANDS.forEach((command, order) => {
    if (!scopes.includes(command.scope)) return
    const label = fuzzyMatch(query, command.label)
    if (label) {
      ranked.push({ score: label.score + 5, order, command, positions: label.positions })
      return
    }
    const alias = command.alias ? fuzzyMatch(query, command.alias) : undefined
    if (alias) ranked.push({ score: alias.score, order, command, positions: [] })
  })
  ranked.sort((a, b) => b.score - a.score || a.order - b.order)
  return ranked.map((item) => ({ ...item.command, positions: item.positions }))
}

/** 供 UI 按 id 反查（例如显示快捷键）。 */
export function findCommand(id: string): PaletteCommand | undefined {
  return COMMANDS.find((command) => command.id === id)
}
