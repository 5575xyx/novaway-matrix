import { Permission } from "@/permission"
import type { Info } from "./agent"
import { AGENCY_AGENT_SOURCES } from "./prompt/agency-agents.generated"

const PRIMARY_AGENCY_AGENT_IDS = new Set([
  "agents-orchestrator",
  "product-manager",
  "project-manager-senior",
  "project-management-project-shepherd",
  "project-management-studio-producer",
  "specialized-chief-of-staff",
])

const CATEGORY_LABELS: Record<string, string> = {
  academic: "学术研究",
  design: "设计",
  engineering: "工程开发",
  finance: "财务",
  "game-development": "游戏开发",
  marketing: "营销",
  "paid-media": "付费投放",
  primary: "核心",
  product: "产品",
  "project-management": "项目管理",
  sales: "销售",
  "spatial-computing": "空间计算",
  specialized: "专项能力",
  support: "支持运营",
  testing: "测试",
}

const AGENT_NAME_LABELS: Record<string, string> = {
  "academic-anthropologist": "人类学研究员",
  "academic-geographer": "地理学研究员",
  "academic-historian": "历史学研究员",
  "academic-narratologist": "叙事学研究员",
  "academic-psychologist": "心理学研究员",
  "agents-orchestrator": "Agent 编排总控",
  "product-manager": "产品经理",
  "project-manager-senior": "高级项目经理",
  "project-management-project-shepherd": "项目推进管家",
  "project-management-studio-producer": "工作室制片人",
  "specialized-chief-of-staff": "幕僚长",
}

const WORD_LABELS: Record<string, string> = {
  accessibility: "无障碍",
  account: "客户",
  accounts: "应付账款",
  addon: "插件",
  advocate: "布道师",
  agent: "Agent",
  agentic: "智能体",
  ai: "AI",
  analyst: "分析师",
  analytics: "分析",
  api: "API",
  app: "应用",
  architect: "架构师",
  architecture: "架构",
  audio: "音频",
  auditor: "审计员",
  automator: "自动化专家",
  autonomous: "自主",
  backend: "后端",
  baidu: "百度",
  behavioral: "行为",
  bilibili: "B站",
  billing: "计费",
  blockchain: "区块链",
  blender: "Blender",
  book: "图书",
  bookkeeper: "记账",
  brand: "品牌",
  builder: "构建专家",
  buyer: "买方",
  campaign: "活动",
  carousel: "轮播内容",
  chief: "首席",
  china: "中国",
  citation: "引用",
  civil: "土木",
  cms: "CMS",
  coach: "教练",
  co: "联合",
  code: "代码",
  codebase: "代码库",
  commerce: "电商",
  communication: "沟通",
  community: "社区",
  compliance: "合规",
  computing: "计算",
  consolidation: "整合",
  consultant: "顾问",
  content: "内容",
  controller: "控制专员",
  corporate: "企业",
  creator: "创作者",
  creative: "创意",
  cross: "跨境",
  cultural: "文化",
  customer: "客户",
  data: "数据",
  database: "数据库",
  deal: "交易",
  designer: "设计师",
  developer: "开发者",
  devops: "DevOps",
  digital: "数字化",
  discovery: "需求发现",
  distribution: "分发",
  document: "文档",
  douyin: "抖音",
  ecommerce: "电商",
  editor: "编辑器",
  email: "邮件",
  embedded: "嵌入式",
  engineer: "工程师",
  engineering: "工程",
  executive: "高管",
  experience: "体验",
  experiment: "实验",
  extraction: "提取",
  fpa: "FP&A",
  feedback: "反馈",
  feishu: "飞书",
  filament: "Filament",
  finance: "财务",
  financial: "财务",
  firmware: "固件",
  frontend: "前端",
  game: "游戏",
  gameplay: "玩法",
  git: "Git",
  godot: "Godot",
  governance: "治理",
  government: "政务",
  graph: "图谱",
  growth: "增长",
  guardian: "守护者",
  guest: "宾客",
  hacker: "增长黑客",
  healthcare: "医疗",
  hospitality: "酒店服务",
  hr: "人力资源",
  identity: "身份",
  image: "图像",
  immersive: "沉浸式",
  incident: "故障响应",
  inclusive: "包容性",
  infrastructure: "基础设施",
  instagram: "Instagram",
  intake: "接待",
  intelligence: "智能",
  interface: "界面",
  integration: "集成",
  investment: "投资",
  jira: "Jira",
  korean: "韩国",
  kuaishou: "快手",
  language: "语言",
  launch: "发布",
  legal: "法务",
  level: "关卡",
  linkedin: "领英",
  livestream: "直播",
  loan: "贷款",
  localization: "本地化",
  lsp: "LSP",
  macos: "macOS",
  maintainer: "维护员",
  manager: "经理",
  market: "市场",
  marketing: "营销",
  mcp: "MCP",
  media: "媒体",
  metal: "Metal",
  minimal: "最小改动",
  mobile: "移动端",
  model: "模型",
  multiplayer: "多人联机",
  narrative: "叙事",
  nudge: "助推",
  officer: "专员",
  official: "公众号",
  onboarding: "入门",
  operator: "运营员",
  optimization: "优化",
  optimizer: "优化专家",
  outbound: "外呼",
  payable: "应付",
  paid: "付费",
  ppc: "PPC",
  pipeline: "管道",
  podcast: "播客",
  presales: "售前",
  prioritizer: "优先级规划师",
  private: "私域",
  product: "产品",
  programmatic: "程序化",
  project: "项目",
  prompt: "提示词",
  proposal: "方案",
  qa: "QA",
  query: "查询",
  rapid: "快速",
  real: "房地产",
  reality: "真实验收",
  reddit: "Reddit",
  remediation: "修复",
  report: "报告",
  research: "研究",
  researcher: "研究员",
  responder: "响应员",
  response: "响应",
  results: "结果",
  retail: "零售",
  returns: "退货",
  review: "审查",
  reviewer: "审查员",
  roblox: "Roblox",
  sales: "销售",
  salesforce: "Salesforce",
  script: "脚本",
  scripter: "脚本工程师",
  search: "搜索",
  security: "安全",
  seller: "卖方",
  senior: "高级",
  seo: "SEO",
  service: "服务",
  services: "服务",
  shader: "着色器",
  short: "短视频",
  smart: "智能",
  social: "社交",
  software: "软件",
  solidity: "Solidity",
  spatial: "空间",
  specialist: "专家",
  sprint: "冲刺",
  sre: "SRE",
  staff: "幕僚",
  steward: "管家",
  strategist: "策略师",
  strategy: "策略",
  studio: "工作室",
  study: "留学",
  supply: "供应链",
  support: "支持",
  systems: "系统",
  tax: "税务",
  technical: "技术",
  tester: "测试员",
  testing: "测试",
  threat: "威胁",
  tiktok: "TikTok",
  time: "工时",
  tool: "工具",
  tracking: "追踪",
  training: "培训",
  translator: "翻译",
  trend: "趋势",
  twitter: "Twitter",
  ui: "UI",
  unity: "Unity",
  unreal: "Unreal",
  ux: "UX",
  video: "视频",
  visionos: "visionOS",
  visual: "视觉",
  visuals: "视觉",
  voice: "语音",
  wechat: "微信",
  weibo: "微博",
  whimsy: "趣味设计",
  workflow: "工作流",
  world: "世界",
  writer: "撰写专家",
  xiaohongshu: "小红书",
  xr: "XR",
  zhihu: "知乎",
  zk: "知识库",
}

export function agencyAgents(input: { defaults: Permission.Ruleset; user: Permission.Ruleset }) {
  return Object.fromEntries(
    AGENCY_AGENT_SOURCES.map((source) => {
      const md = parseAgencyMarkdown(source.body)
      const categoryLabel = CATEGORY_LABELS[source.category] ?? source.categoryLabel
      const displayName = agencyDisplayName(source.id, md.data.name)
      const mode = PRIMARY_AGENCY_AGENT_IDS.has(source.id) ? "primary" : "subagent"
      const agent: Info = {
        name: source.id,
        description: agencyDescription(categoryLabel, displayName),
        prompt: md.content.trimStart(),
        permission: Permission.merge(
          input.defaults,
          Permission.fromConfig({
            question: "allow",
          }),
          input.user,
        ),
        options: {
          displayName,
          category: categoryLabel,
          agencyCategory: source.category,
          agencyPath: source.path,
          ...(md.data.description ? { originalDescription: md.data.description } : {}),
          ...(md.data.vibe ? { vibe: md.data.vibe } : {}),
          ...(md.data.emoji ? { emoji: md.data.emoji } : {}),
          ...(md.data.tools ? { agencyTools: md.data.tools } : {}),
        },
        mode,
        native: true,
        ...(md.data.color ? { color: md.data.color } : {}),
      }
      return [source.id, agent] as const
    }),
  )
}

function agencyDescription(category: string, displayName: string) {
  return `内置${category} AI 员工，适合处理${displayName}相关任务。`
}

function agencyDisplayName(id: string, fallback?: string) {
  if (AGENT_NAME_LABELS[id]) return AGENT_NAME_LABELS[id]
  const category = id.split("-")[0]
  const words = id
    .split("-")
    .filter((word, index) => index !== 0 || !CATEGORY_LABELS[category])
  const translated = words.map((word) => WORD_LABELS[word] ?? fallbackWord(word)).join("")
  if (translated) return translated
  return fallback ?? id
}

function fallbackWord(word: string) {
  if (!word) return ""
  if (word.length <= 3) return word.toUpperCase()
  return word.slice(0, 1).toUpperCase() + word.slice(1)
}

function parseAgencyMarkdown(input: string) {
  const match = input.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/)
  if (!match) return { data: {}, content: input }
  return {
    data: Object.fromEntries(
      match[1]
        .split(/\r?\n/)
        .map((line) => {
          const index = line.indexOf(":")
          if (index === -1) return
          const key = line.slice(0, index).trim()
          const value = line
            .slice(index + 1)
            .trim()
            .replace(/^"(.*)"$/, "$1")
          if (!key || !value) return
          return [key, value] as const
        })
        .filter((entry): entry is readonly [string, string] => entry !== undefined),
    ),
    content: input.slice(match[0].length),
  }
}
