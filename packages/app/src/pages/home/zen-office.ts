import type { ComponentProps } from "solid-js"

export type HomeActionId = "document" | "ppt" | "knowledge" | "data" | "design" | "web"

type HomeActionIcon = ComponentProps<typeof import("@novaway/ui/icon").Icon>["name"]

export type HomeAction = {
  id: HomeActionId
  title: string
  description: string
  icon: HomeActionIcon
  accent: string
  meta: string
  action: string
  placeholder: string
  detailLabel: string
  detailPlaceholder: string
  outputLabel: string
  outputs: string[]
  templates: string[]
  primary?: boolean
}

export type OfficeActionDraft = {
  subject: string
  output: string
  audience: string
  source: string
  requirements: string
}

export type OfficeOutputContract = {
  format: string
  sections: string[]
  rules: string[]
}

export function emptyOfficeDraft(action: HomeAction): OfficeActionDraft {
  return {
    subject: "",
    output: action.outputs[0] ?? "",
    audience: "",
    source: "",
    requirements: "",
  }
}

export function completeOfficeDraft(action: HomeAction, draft: OfficeActionDraft): OfficeActionDraft {
  return {
    subject: draft.subject.trim() || action.placeholder,
    output: action.outputs.includes(draft.output) ? draft.output : (action.outputs[0] ?? ""),
    audience: draft.audience.trim(),
    source: draft.source.trim(),
    requirements: draft.requirements.trim(),
  }
}

export const zenActions: HomeAction[] = [
  {
    id: "document",
    title: "文档整理",
    description: "生成方案、报告、周报、会议纪要，并围绕选中文本持续润色。",
    icon: "pencil-line",
    accent: "from-emerald-400/22 via-cyan-300/12 to-transparent",
    meta: "写作 / 改写 / 审阅",
    action: "开始创建",
    placeholder: "例如：为新产品发布会写一份项目方案，包含背景、目标、执行计划和风险。",
    detailLabel: "文档资料或草稿",
    detailPlaceholder: "可以粘贴已有草稿、资料摘要、业务背景、参考格式，或说明资料所在文件。",
    outputLabel: "文档类型",
    outputs: ["项目方案", "工作报告", "周报月报", "会议纪要", "PRD/需求文档", "商务说明"],
    templates: [
      "写一份项目方案，包含背景、目标、范围、里程碑、风险和资源需求。",
      "把当前资料整理成一份结构清晰的工作报告，先结论后过程。",
      "生成一份周报，包含本周进展、问题风险、下周计划和需要协同事项。",
    ],
    primary: true,
  },
  {
    id: "ppt",
    title: "PPT生成",
    description: "从主题或资料生成大纲、页面文案、图表建议和演讲备注。",
    icon: "layout-bottom",
    accent: "from-sky-400/22 via-indigo-300/12 to-transparent",
    meta: "大纲 / 页面 / 备注",
    action: "开始创建",
    placeholder: "例如：生成一份 8 页客户提案 PPT，面向企业管理层，突出价值和落地路径。",
    detailLabel: "PPT 资料或背景",
    detailPlaceholder: "可以粘贴主题背景、客户信息、产品资料、汇报重点，或说明参考文档。",
    outputLabel: "PPT 场景",
    outputs: ["客户提案", "项目汇报", "商业计划", "产品介绍", "培训课件", "复盘总结"],
    templates: [
      "生成一份 8 页客户提案 PPT，突出业务价值、落地路径和下一步行动。",
      "生成一份项目汇报 PPT，包含目标、进展、风险、资源诉求和决策点。",
      "把资料转成产品介绍 PPT，面向非技术管理层，语言简洁有说服力。",
    ],
    primary: true,
  },
  {
    id: "knowledge",
    title: "AI 资料库",
    description: "把资料、文档和多来源信息整理成可检索的知识资产和 FAQ。",
    icon: "database",
    accent: "from-cyan-400/22 via-teal-300/12 to-transparent",
    meta: "摘要 / 索引 / 对比",
    action: "开始整理",
    placeholder: "例如：总结这份行业报告，提炼关键结论、术语、数据和可追问问题。",
    detailLabel: "资料或来源",
    detailPlaceholder: "粘贴资料正文、上传文件说明、网页摘录，或说明资料所在文件。",
    outputLabel: "资料产物",
    outputs: ["资料摘要", "主题索引", "多文档对比", "FAQ"],
    templates: [
      "把这份资料整理成可检索的知识摘要，保留来源和关键结论。",
      "对比多份文档，列出共识、差异和证据线索。",
      "根据资料生成 FAQ，覆盖读者最可能提出的问题。",
    ],
  },
  {
    id: "data",
    title: "表格分析",
    description: "把 CSV、Excel 和业务数据整理成可核验的分析结论、图表建议和行动建议。",
    icon: "table",
    accent: "from-teal-400/22 via-emerald-300/12 to-transparent",
    meta: "清洗 / 透视 / 图表",
    action: "开始分析",
    placeholder: "例如：分析这份销售数据，找出增长最快的产品、下降原因和下一步行动。",
    detailLabel: "数据资料或字段说明",
    detailPlaceholder: "粘贴 CSV/Excel 内容、字段说明、业务目标，或说明数据文件所在路径。",
    outputLabel: "分析产物",
    outputs: ["数据摘要", "透视分析", "趋势洞察", "图表建议", "行动建议"],
    templates: [
      "分析这份销售数据，按产品、区域和月份输出增长与下降归因。",
      "把原始表格整理成透视分析，包含关键指标、口径说明和结论。",
      "根据这份 CSV 生成趋势洞察和图表建议，标注可核验的数据来源。",
    ],
    primary: true,
  },
  {
    id: "design",
    title: "视觉设计",
    description: "把品牌、活动或内容目标转成海报、封面、配图、色板和视觉规范。",
    icon: "photo",
    accent: "from-violet-400/22 via-fuchsia-300/12 to-transparent",
    meta: "海报 / 封面 / 配图",
    action: "开始设计",
    placeholder: "例如：为新品发布设计一张活动海报，包含主标题、副标题、关键信息和视觉基调。",
    detailLabel: "设计背景或素材",
    detailPlaceholder: "粘贴活动信息、品牌资料、目标人群、参考风格，或说明素材文件位置。",
    outputLabel: "设计产物",
    outputs: ["宣传海报", "社交封面", "演示配图", "品牌色板", "图标草稿"],
    templates: [
      "为新品发布会设计一张活动海报，给出标题、信息层级和视觉基调。",
      "生成一套品牌色板，包含主色、辅助色、文字色和应用规则。",
      "为这篇内容生成社交封面配图方案，说明构图、文案和视觉元素。",
    ],
    primary: true,
  },
  {
    id: "web",
    title: "网页看板",
    description: "把数据、进度或业务信息转成可交互的 HTML 看板、追踪页和工具页。",
    icon: "window-cursor",
    accent: "from-orange-400/22 via-amber-300/12 to-transparent",
    meta: "看板 / 工具 / 页面",
    action: "开始构建",
    placeholder: "例如：做一个销售周报看板，包含核心指标、趋势图、排名表和行动项。",
    detailLabel: "页面内容或数据",
    detailPlaceholder: "粘贴业务指标、数据表格、页面结构、目标用户，或说明数据文件位置。",
    outputLabel: "网页产物",
    outputs: ["数据看板", "项目追踪页", "客户工具页", "HTML 页面", "演示站点"],
    templates: [
      "生成一个销售周报 HTML 看板，包含核心指标、趋势图和排名表。",
      "做一个项目追踪页，包含里程碑、风险、负责人和状态。",
      "把这份资料转成一个单页演示站点，结构清晰、适合展示。",
    ],
    primary: true,
  },
]

export const zenSignals = [
  { label: "持久记忆", value: "写作偏好、汇报口径、常用模板" },
  { label: "自我进化", value: "从反复修改中优化文档与 PPT 策略" },
  { label: "办公上下文", value: "围绕文档、PPT、资料和数据形成长期项目空间" },
]

export const zenWorkflow = [
  "选择 文档整理、PPT生成、资料库、表格分析、视觉设计或网页看板场景",
  "输入任务或导入资料，立即开始办公",
  "预览 AI 产物，继续修改、保存或导出",
]

export function officeOutputContract(id: HomeActionId): OfficeOutputContract {
  return outputContracts[id]
}

export function createOfficePrompt(action: HomeAction, draft: OfficeActionDraft) {
  const taskNames: Record<HomeActionId, string> = {
    document: "文档整理与审阅",
    ppt: "PPT生成：大纲与页面内容生成",
    knowledge: "AI 资料摘要、索引与 FAQ 生成",
    data: "表格分析与数据洞察",
    design: "视觉设计与品牌方案生成",
    web: "网页看板与 HTML 工具生成",
  }
  const outputGuides: Record<HomeActionId, string[]> = {
    document: ["先给出文档结构", "再生成正文草稿", "最后列出可继续补充的资料缺口"],
    ppt: [
      "先生成页级大纲",
      "每页包含标题、核心观点、页面文案、视觉建议、配图建议和演讲备注",
      "标出适合图表、流程图、架构图或主题配图的位置",
      "配图优先使用用户提供的图片附件；未提供图片时，仅在必要页面给出可用于图片生成模型的中文配图提示词，全稿最多 5 张",
    ],
    knowledge: ["先明确资料范围和核心问题", "再生成主题索引和关键观点", "最后补充来源线索、FAQ 和可追问问题"],
    data: ["先确认数据范围和关键指标", "再完成清洗、透视和趋势分析", "最后生成图表建议和可执行结论"],
    design: ["先确认设计目标、受众和品牌约束", "再给出信息层级、构图和视觉基调", "最后生成可执行的视觉规范"],
    web: ["先确认页面目标、数据来源和用户", "再设计信息架构和页面区块", "最后生成可直接使用的 HTML 与说明"],
  }
  const contract = officeOutputContract(action.id)

  return [
    `你现在处于 NovaWay 禅意模式（办公模式），请处理「${taskNames[action.id]}」任务。`,
    "",
    "## 任务主题",
    draft.subject,
    "",
    "## 选择的办公产物类型",
    draft.output || action.outputs[0] || action.title,
    "",
    "## 目标受众",
    draft.audience || "未指定，请根据任务内容自行判断。",
    "",
    "## 资料、背景或原文",
    draft.source || "暂无补充资料。请先基于任务主题产出初稿，并明确说明还需要哪些资料可以提升质量。",
    "",
    "## 输出要求",
    draft.requirements || "保持专业、清晰、可执行；先给结论，再展开细节。",
    "",
    "## 结构化产物契约",
    `输出格式：${contract.format}`,
    "必须包含：",
    ...contract.sections.map((item, index) => `${index + 1}. ${item}`),
    "格式规则：",
    ...contract.rules.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## 请按以下方式输出",
    ...outputGuides[action.id].map((item, index) => `${index + 1}. ${item}`),
    "",
    "## 记忆与进化",
    "请把正文和长期沉淀建议分开输出。正文使用「# 办公产物」作为一级标题；末尾使用「# 可沉淀记忆/可进化建议」作为一级标题，并分别列出「可沉淀记忆」「可进化建议」「需要用户确认」三类内容。不要把未确认的偏好写成确定事实。",
  ].join("\n")
}

const outputContracts: Record<HomeActionId, OfficeOutputContract> = {
  document: {
    format: "Markdown 文档，可直接复制保存为 .md",
    sections: ["标题", "一句话结论", "背景与目标", "正文方案", "行动项", "资料缺口"],
    rules: ["使用清晰的 Markdown 标题层级", "表格使用 Markdown 表格", "不要把记忆与进化建议混入正文"],
  },
  ppt: {
    format: "Markdown 页级大纲，每页使用「### 第 N 页｜标题」",
    sections: ["封面页", "目录或故事线", "逐页内容", "图表建议", "配图建议", "演讲备注", "下一步行动"],
    rules: [
      "每页必须包含页面目标、主文案、视觉建议、配图建议和备注",
      "页数按用户要求执行，未指定时默认 8 页",
      "避免整段长文堆叠",
      "配图建议必须说明使用附件图片、无需图片或需要生成图片；需要生成图片时写出清晰中文提示词，整份 PPT 最多 5 张",
    ],
  },
  knowledge: {
    format: "Markdown 知识摘要，可直接复制保存为 .md",
    sections: ["资料摘要", "主题索引", "关键观点", "来源与证据", "FAQ 与追问线索"],
    rules: ["保留来源线索", "区分确定信息和推断", "按主题组织，便于检索", "正文和记忆建议分开"],
  },
  data: {
    format: "Markdown 数据分析报告，可直接复制保存为 .md",
    sections: ["数据摘要", "口径与来源", "透视与关键指标", "趋势与归因", "图表建议", "行动建议"],
    rules: [
      "数字必须来自用户资料或明确标注估算",
      "区分事实、推断和待确认项",
      "图表建议必须说明图表类型和维度",
      "正文和记忆建议分开",
    ],
  },
  design: {
    format: "Markdown 视觉设计方案，可直接复制保存为 .md",
    sections: ["设计目标", "受众与场景", "信息层级", "构图与视觉基调", "色彩与字体", "生成图片提示词"],
    rules: [
      "颜色和字体必须给出具体值",
      "图片提示词必须说明主体、风格、构图和光线",
      "避免描述页面内部功能或快捷键",
      "正文和记忆建议分开",
    ],
  },
  web: {
    format: "Markdown 网页看板方案，包含可直接使用的 HTML 结构",
    sections: ["页面目标", "数据与指标", "页面区块", "交互说明", "HTML 结构", "下一步"],
    rules: ["HTML 必须使用语义化标签", "数据需要来源说明", "交互说明要具体可执行", "正文和记忆建议分开"],
  },
}
