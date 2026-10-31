import type { IconProps } from "@novaway/ui/icon"

/**
 * 内置扩展（= 随应用提供的"插件"）的目录数据。
 *
 * 单独放在数据模块里，是因为这份清单不止扩展设置页在用：
 * 办公模式的推荐提示词、输入卡的插件选择器都要按同一份 id / 开关落点判断
 * 「这个插件在不在、开没开」。把它留在 `.tsx` 里会让纯数据依赖整棵 React/Solid
 * 组件树，也让纯函数没法单测。
 */
export type BuiltinExtension = {
  id: string
  name: string
  description: string
  /** 内置扩展卡片的图标；直接沿用 Icon 的合法名字，避免每加一个能力就改类型。 */
  icon: IconProps["name"]
  components: string[]
  /**
   * 开关落点：
   * - browser → `config.browser.enabled`（内置浏览器 + PDF 打印一起）
   * - memory → `config.memory.enabled`
   * - skills → `config.skills.disabled`
   * - computer → `config.experimental.computer_control`
   * - tools → `config.tools.<id>`（单个工具粒度的开关）
   */
  toggle?: "browser" | "memory" | "skills" | "computer" | "tools"
  /** toggle=skills 时，这个扩展包含哪些内置技能。 */
  skills?: string[]
  /** toggle=tools 时，这个扩展包含哪些工具 id。 */
  tools?: string[]
  /** 本产品是否真的具备该能力；false 时条目仍展示并说明原因。 */
  available?: boolean
  unavailableReason?: string
}

export const BUILTIN_EXTENSIONS: BuiltinExtension[] = [
  // 目录口径对齐 ZCode 的官方内置插件（official-plugin-definitions）。
  // 每一行都有开关：技能型扩展写 config.skills.disabled（关掉只是隐藏，不删文件）；
  // 浏览器 / 记忆写各自的配置项。暂未内置执行引擎的条目保留开关但禁用，详情说明原因。
  {
    id: "pdf",
    name: "PDF",
    description: "把网页 / HTML 导出为 PDF；也能读取 PDF 内容做审阅。",
    icon: "lu-file-text",
    components: ["skill"],
    toggle: "tools",
    tools: ["pdf_create"],
  },
  {
    id: "presentations",
    name: "演示文档",
    description: "创建、编辑与审阅演示文档（PPTX）。",
    icon: "lu-presentation",
    components: ["skill"],
    toggle: "skills",
    skills: ["office-ppt"],
  },
  {
    id: "spreadsheets",
    name: "电子表格",
    description: "创建、编辑与审阅电子表格（XLSX）。",
    icon: "lu-table",
    components: ["skill"],
    toggle: "skills",
    skills: ["office-data"],
  },
  {
    id: "documents",
    name: "Word 文档",
    description: "创建、编辑与审阅 Word 文档（DOCX）。",
    icon: "lu-file-text",
    components: ["skill"],
    toggle: "skills",
    skills: ["office-document"],
  },
  {
    id: "visualize",
    name: "交互视图",
    description: "在对话中创建交互图表、数据看板与单页演示页面。",
    icon: "chart",
    components: ["skill"],
    toggle: "skills",
    skills: ["office-web"],
  },
  // 以下五个是禅意模式（办公模式）本来就内置、但此前没出现在扩展页里的技能。
  // 推荐提示词要按插件判断"能不能用"，清单缺一条，对应那排提示词就永远点不动。
  {
    id: "design",
    name: "视觉设计",
    description: "把品牌、活动或内容目标转成海报、封面、配图与视觉规范。",
    icon: "lu-image",
    components: ["skill"],
    toggle: "skills",
    skills: ["office-design"],
  },
  {
    id: "knowledge",
    name: "AI 资料库",
    description: "把资料、文档与多来源信息整理成可检索的知识资产与 FAQ。",
    icon: "database",
    components: ["skill"],
    toggle: "skills",
    skills: ["office-knowledge"],
  },
  {
    id: "meetings",
    name: "会议纪要",
    description: "把会议转写整理成决议、行动项、负责人与截止时间。",
    icon: "lu-users",
    components: ["skill"],
    toggle: "skills",
    skills: ["office-meeting"],
  },
  {
    id: "tasks",
    name: "任务规划",
    description: "拆解任务、排优先级、跟踪风险与阻塞。",
    icon: "lu-list-checks",
    components: ["skill"],
    toggle: "skills",
    skills: ["office-task"],
  },
  {
    id: "communication",
    name: "商务沟通",
    description: "邮件、通知、协作说明与商务表达的起草与改写。",
    icon: "bubble-5",
    components: ["skill"],
    toggle: "skills",
    skills: ["office-communication"],
  },
  {
    id: "browser-use",
    name: "浏览器操作",
    description: "操作真实浏览器：打开网页、点击、输入、截图并校验页面结果。",
    icon: "lu-chrome",
    components: ["tool"],
    toggle: "browser",
  },
  {
    id: "computer-use",
    name: "电脑控制",
    description: "读取本机应用界面并执行点击、键入、滚动等桌面操作（设置 → 电脑控制 里可调权限）。",
    icon: "autopilot",
    components: ["tool"],
    toggle: "computer",
  },
  {
    id: "skill-tools",
    name: "技能与插件创建",
    description: "帮助发现、安装并编写 Agent 技能与插件，把重复流程沉淀下来。",
    icon: "lu-wrench",
    components: ["skill"],
    toggle: "skills",
    skills: ["find-skills", "skill-creator"],
  },
  {
    id: "wxgzh-ops",
    name: "公众号运营",
    description: "公众号选题、写作、排版与发布流程的内置技能。",
    icon: "bubble-5",
    components: ["skill"],
    toggle: "skills",
    skills: ["wxgzh-ops"],
  },
  {
    id: "xiaohongshu-ops",
    name: "小红书运营",
    description: "小红书认证登录、内容发布、搜索发现、社交互动与数据分析的内置技能。",
    icon: "lu-square-pen",
    components: ["skill"],
    toggle: "skills",
    skills: ["xiaohongshu-ops"],
  },
  {
    id: "memory-service",
    name: "持久记忆",
    description: "跨会话记住偏好、项目约定与决策，并在后续对话里按需召回。",
    icon: "lu-brain",
    components: ["memory"],
    toggle: "memory",
  },
]

export function findBuiltinExtension(id: string) {
  return BUILTIN_EXTENSIONS.find((item) => item.id === id)
}
