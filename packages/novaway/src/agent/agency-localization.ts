/**
 * NovaWay 对 Agency 员工的中文展示层。
 *
 * 不改 Agency 的稳定 id 和英文 prompt：id 被配置、历史运行和插件升级共同引用，
 * prompt 也包含工具约束。这里仅提供元数据本地化，让 API、设置页和聊天选择器都能
 * 使用同一份中文 displayName / category / description。
 */

const CATEGORIES: Record<string, string> = {
  academic: "学术研究",
  design: "设计创意",
  engineering: "工程开发",
  finance: "财务金融",
  marketing: "营销增长",
  "paid-media": "付费投放",
  primary: "核心能力",
  product: "产品管理",
  "project-management": "项目管理",
  sales: "销售增长",
  specialized: "专项能力",
  support: "支持运营",
  testing: "测试质量",
  "game-development": "游戏开发",
}

const EXACT: Record<string, string> = {
  "academic-anthropologist": "人类学研究员",
  "academic-geographer": "地理学研究员",
  "academic-historian": "历史学研究员",
  "academic-narratologist": "叙事学研究员",
  "academic-psychologist": "心理学研究员",
  "agents-orchestrator": "智能体编排总控",
  "product-manager": "产品经理",
  "project-manager-senior": "高级项目经理",
  "project-management-project-shepherd": "项目推进管家",
  "project-management-studio-producer": "工作室制片人",
  "specialized-chief-of-staff": "幕僚长",
}

const WORDS: Record<string, string> = {
  analyst: "分析师",
  architect: "架构师",
  auditor: "审计员",
  automator: "自动化专家",
  backend: "后端",
  bookkeeper: "记账员",
  brand: "品牌",
  builder: "构建专家",
  code: "代码",
  consultant: "顾问",
  content: "内容",
  creator: "创作者",
  data: "数据",
  database: "数据库",
  designer: "设计师",
  developer: "开发者",
  devops: "DevOps",
  engineer: "工程师",
  frontend: "前端",
  growth: "增长",
  historian: "历史学家",
  investment: "投资",
  legal: "法务",
  manager: "经理",
  marketing: "营销",
  mobile: "移动端",
  optimizer: "优化专家",
  planner: "规划师",
  product: "产品",
  researcher: "研究员",
  reviewer: "审查员",
  security: "安全",
  senior: "高级",
  specialist: "专家",
  strategist: "策略师",
  tester: "测试专家",
  technical: "技术",
  writer: "撰写专家",
}

const agencyCategory = (name: string) => {
  const first = name.replace(/^.*?agency-agents[_/]/, "").split(/[\/_-]/)[0]
  return CATEGORIES[first]
}

const normalizedID = (name: string) =>
  name
    .replace(/^.*?agency-agents[_/]/, "")
    .split("/")
    .at(-1) ?? name

function displayName(name: string) {
  const id = normalizedID(name)
  if (EXACT[id]) return EXACT[id]
  const parts = id
    .split(/[-_]+/)
    .filter(Boolean)
    .filter((part, index, all) => index === 0 || part !== all[index - 1])
  const translated = parts.map((part) => WORDS[part]).filter(Boolean)
  if (translated.length === parts.length && translated.length > 0) return translated.join("")
  const category = agencyCategory(name)
  return category ? `${category}专家` : undefined
}

export function localizeAgencyAgent(name: string, options?: Record<string, unknown>) {
  const category = agencyCategory(name)
  if (!category) return options
  const current = options ?? {}
  const currentName = typeof current.displayName === "string" ? current.displayName.trim() : ""
  const localized = currentName || displayName(name) || `${category}专家`
  return {
    ...current,
    displayName: localized,
    category: typeof current.category === "string" && current.category.trim() ? current.category : category,
    agencyCategory: typeof current.agencyCategory === "string" ? current.agencyCategory : name.split(/[\/_]/)[0],
  }
}

export function agencyDescription(name: string, options?: Record<string, unknown>) {
  const localized = localizeAgencyAgent(name, options)
  if (!localized) return undefined
  const display = String(localized.displayName)
  const category = String(localized.category)
  return `内置${category} AI 员工，适合处理${display}相关任务。`
}
