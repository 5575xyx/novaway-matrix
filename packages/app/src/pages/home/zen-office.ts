import type { ComponentProps } from "solid-js"

export type HomeActionId = "document" | "ppt"

type HomeActionIcon = ComponentProps<typeof import("@opencode-ai/ui/icon").Icon>["name"]

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
    title: "AI 文档",
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
    title: "AI PPT",
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
]

export const zenSignals = [
  { label: "持久记忆", value: "写作偏好、汇报口径、常用模板" },
  { label: "自我进化", value: "从反复修改中优化文档与 PPT 策略" },
  { label: "办公上下文", value: "围绕资料、会议、任务形成长期项目空间" },
]

export const zenWorkflow = [
  "导入资料或打开办公项目",
  "选择 AI 文档、PPT、会议等办公入口",
  "预览 AI 产物并确认记忆与进化建议",
]

export function officeOutputContract(id: HomeActionId): OfficeOutputContract {
  return outputContracts[id]
}

export function createOfficePrompt(action: HomeAction, draft: OfficeActionDraft) {
  const taskNames: Record<HomeActionId, string> = {
    document: "AI 文档生成与审阅",
    ppt: "AI PPT 大纲与页面内容生成",
  }
  const outputGuides: Record<HomeActionId, string[]> = {
    document: ["先给出文档结构", "再生成正文草稿", "最后列出可继续补充的资料缺口"],
    ppt: [
      "先生成页级大纲",
      "每页包含标题、核心观点、页面文案、视觉建议、配图建议和演讲备注",
      "标出适合图表、流程图、架构图或主题配图的位置",
      "配图优先使用用户提供的图片附件；未提供图片时，仅在必要页面给出可用于图片生成模型的中文配图提示词，全稿最多 5 张",
    ],
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
}
