export type ModeGroup = "all" | "forge" | "zen" | "spark" | "pulse" | "future"

export const modeGroups: Array<{ value: ModeGroup; label: string; aliases: string[] }> = [
  { value: "all", label: "全部", aliases: [] },
  {
    value: "forge",
    label: "工程师",
    aliases: [
      "forge",
      "engineer",
      "engineering",
      "frontend",
      "backend",
      "code",
      "coding",
      "dev",
      "开发",
      "工程",
      "代码",
    ],
  },
  {
    value: "zen",
    label: "办公",
    aliases: ["zen", "office", "document", "docs", "ppt", "meeting", "task", "办公", "文档", "会议", "任务", "沟通"],
  },
  {
    value: "spark",
    label: "创意",
    aliases: ["spark", "creative", "writing", "video", "image", "创意", "写作", "视频", "海报"],
  },
  {
    value: "pulse",
    label: "运营",
    aliases: ["pulse", "operation", "ops", "marketing", "social", "运营", "营销", "小红书", "抖音", "公众号"],
  },
  {
    value: "future",
    label: "探索",
    aliases: ["future", "explore", "custom", "research", "探索", "未来", "自定义", "研究"],
  },
]

export function modeGroupLabel(group: ModeGroup) {
  return modeGroups.find((item) => item.value === group)?.label ?? "全部"
}

export function modeGroupFromText(input: unknown): Exclude<ModeGroup, "all"> | undefined {
  const text = textOf(input).toLowerCase()
  if (!text) return

  for (const group of modeGroups) {
    if (group.value === "all") continue
    if (group.aliases.some((alias) => text.includes(alias.toLowerCase()))) return group.value
  }
}

export function matchesModeGroup(input: unknown, group: ModeGroup) {
  if (group === "all") return true
  return modeGroupFromText(input) === group
}

function textOf(input: unknown): string {
  if (input === undefined || input === null) return ""
  if (typeof input === "string") return input
  if (typeof input === "number" || typeof input === "boolean") return String(input)
  if (Array.isArray(input)) return input.map(textOf).filter(Boolean).join(" ")
  if (typeof input !== "object") return String(input)
  return Object.entries(input)
    .map(([key, value]) => `${key} ${textOf(value)}`)
    .join(" ")
}
