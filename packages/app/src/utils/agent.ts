const defaults: Record<string, string> = {
  ask: "var(--icon-agent-ask-base)",
  build: "var(--icon-agent-build-base)",
  docs: "var(--icon-agent-docs-base)",
  plan: "var(--icon-agent-plan-base)",
}

const palette = [
  "var(--icon-agent-ask-base)",
  "var(--icon-agent-build-base)",
  "var(--icon-agent-docs-base)",
  "var(--icon-agent-plan-base)",
  "var(--syntax-info)",
  "var(--syntax-success)",
  "var(--syntax-warning)",
  "var(--syntax-property)",
  "var(--syntax-constant)",
  "var(--text-diff-add-base)",
  "var(--text-diff-delete-base)",
  "var(--icon-warning-base)",
]

function tone(name: string) {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return palette[hash % palette.length]
}

export function agentColor(name: string, custom?: string) {
  if (custom) return custom
  return defaults[name] ?? defaults[name.toLowerCase()] ?? tone(name.toLowerCase())
}

export function messageAgentColor(
  list: readonly { role: string; agent?: string }[] | undefined,
  agents: readonly { name: string; color?: string }[],
) {
  if (!list) return undefined
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i]
    if (item.role !== "user" || !item.agent) continue
    return agentColor(item.agent, agents.find((agent) => agent.name === item.agent)?.color)
  }
}

const agentLabels: Record<string, string> = {
  build: "锻造工程",
  plan: "规划蓝图",
  general: "通用助手",
  explore: "代码探索",
  scout: "资料侦察",
  title: "标题生成",
  summary: "摘要生成",
  compaction: "上下文压缩",
  "office-document": "AI 文档",
  "office-ppt": "AI PPT",
  "office-meeting": "AI 会议",
  "office-knowledge": "AI 资料库",
  "office-task": "AI 任务",
  "office-communication": "AI 沟通",
}

const skillLabels: Record<string, string> = {
  "customize-novaway": "自定义 NovaWay",
  "office-document": "AI 文档技能",
  "office-ppt": "AI PPT 技能",
  "office-meeting": "AI 会议技能",
  "office-knowledge": "AI 资料库技能",
  "office-task": "AI 任务技能",
  "office-communication": "AI 沟通技能",
  "company-values": "公司价值观",
  "find-community": "寻找社群",
  "first-customers": "首批客户",
  "grow-sustainably": "可持续增长",
  "marketing-plan": "营销计划",
  "minimalist-review": "极简主义审查",
}

const wordLabels: Record<string, string> = {
  add: "添加",
  agent: "智能体",
  agents: "智能体",
  ai: "AI",
  analysis: "分析",
  analyst: "分析师",
  api: "API",
  architecture: "架构",
  architect: "架构师",
  blender: "Blender",
  build: "构建",
  business: "业务",
  code: "代码",
  community: "社群",
  company: "公司",
  customer: "客户",
  customers: "客户",
  data: "数据",
  debug: "调试",
  debugger: "调试专家",
  design: "设计",
  designer: "设计师",
  developer: "开发者",
  engineer: "工程师",
  engineering: "工程",
  evaluate: "评估",
  first: "首批",
  find: "寻找",
  gameplay: "游戏玩法",
  godot: "Godot",
  grow: "增长",
  growth: "增长",
  javascript: "JavaScript",
  marketing: "营销",
  mcp: "MCP",
  minimalist: "极简主义",
  multiplayer: "多人联机",
  plan: "计划",
  planner: "规划师",
  plugin: "插件",
  python: "Python",
  react: "React",
  remediation: "修复",
  review: "审查",
  reviewer: "审查员",
  shader: "着色器",
  skill: "技能",
  skills: "技能",
  specialist: "专家",
  scripter: "脚本专家",
  sustainably: "可持续",
  tester: "测试专家",
  testing: "测试",
  typescript: "TypeScript",
  values: "价值观",
  vue: "Vue",
  writer: "撰写专家",
}

const phraseLabels: Array<[RegExp, string]> = [
  [/\badd[- ]on\b/gi, "插件"],
  [/\bgameplay\b/gi, "游戏玩法"],
  [/\bmultiplayer\b/gi, "多人联机"],
  [/\bshader\b/gi, "着色器"],
  [/\bdata remediation\b/gi, "数据修复"],
  [/\bmachine learning\b/gi, "机器学习"],
  [/\bpython\b/gi, "Python"],
  [/\bjavascript\b/gi, "JavaScript"],
  [/\btypescript\b/gi, "TypeScript"],
  [/\breact\b/gi, "React"],
  [/\bvue\b/gi, "Vue"],
  [/\bgodot\b/gi, "Godot"],
  [/\bblender\b/gi, "Blender"],
  [/\bai\b/gi, "AI"],
  [/\bmcp\b/gi, "MCP"],
  [/\bengineer\b/gi, "工程师"],
  [/\bdeveloper\b/gi, "开发者"],
  [/\bscripter\b/gi, "脚本专家"],
  [/\bspecialist\b/gi, "专家"],
  [/\barchitect\b/gi, "架构师"],
  [/\bdesigner\b/gi, "设计师"],
  [/\bplanner\b/gi, "规划师"],
  [/\breviewer\b/gi, "审查员"],
  [/\banalyst\b/gi, "分析师"],
  [/\bwriter\b/gi, "撰写专家"],
  [/\btester\b/gi, "测试专家"],
  [/\bdebugger\b/gi, "调试专家"],
  [/\boptimizer\b/gi, "优化专家"],
]

function explicitDisplayName(value?: Record<string, unknown>) {
  for (const key of ["display_name", "displayName", "title", "label", "name"]) {
    if (typeof value?.[key] === "string" && value[key].trim()) return value[key].trim()
  }
}

function localizedName(name: string) {
  const normalized = name.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim()
  if (!normalized || /[\u4e00-\u9fff]/.test(normalized)) return normalized || name

  const translated = phraseLabels
    .reduce((text, [pattern, label]) => text.replace(pattern, label), normalized)
    .replace(/\s+/g, " ")
    .trim()
  if (translated && translated !== normalized) return translated
  const words = normalized.toLowerCase().split(" ")
  if (words.every((word) => wordLabels[word])) return words.map((word) => wordLabels[word]).join("")
  return name
}

export function agentDisplayName(name: string, options?: Record<string, unknown>) {
  const explicit = explicitDisplayName(options)
  if (explicit && explicit !== name) return localizedName(explicit)
  return agentLabels[name] ?? localizedName(name)
}

export function skillDisplayName(name: string, data?: Record<string, unknown>) {
  const explicit = explicitDisplayName(data)
  if (explicit && explicit !== name) return localizedName(explicit)
  return skillLabels[name] ?? localizedName(name)
}
