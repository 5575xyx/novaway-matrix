import type { HomeActionId } from "@/pages/home/zen-office"

export type OfficeAgentScenario = {
  agentName: string
  intent: string
  skillName: string
  workflow: string[]
  inputFocus: string[]
  attachmentHints: string[]
  deliverables: string[]
  outputFocus: string[]
  qualityChecks: string[]
  reviewQuestions: string[]
  memoryFocus: string[]
  quickPrompts: string[]
}

export const officeAgentScenarios: Record<HomeActionId, OfficeAgentScenario> = {
  document: {
    agentName: "office-document",
    intent: "把零散想法、资料和业务背景整理成可直接交付的文档。",
    skillName: "office-document",
    workflow: ["厘清目标和读者", "搭建结构和结论", "生成正文草稿", "标出缺口和下一步"],
    inputFocus: ["主题目标", "参考资料", "目标读者", "格式要求"],
    attachmentHints: ["DOCX 草稿", "PDF 资料", "Markdown/文本", "截图或表格"],
    deliverables: ["项目方案", "工作报告", "周报月报", "会议纪要"],
    outputFocus: ["结论先行", "标题层级清晰", "表格和清单可复制", "保留待确认事项"],
    qualityChecks: ["结论是否明确", "结构是否可扫描", "资料缺口是否标出"],
    reviewQuestions: ["这份文档给谁看？", "最终要推动什么决策？", "是否有固定模板或禁用表达？"],
    memoryFocus: ["常用文档结构", "写作语气偏好", "汇报对象习惯", "反复修改点"],
    quickPrompts: ["整理成项目方案", "改写成正式报告", "生成周报/月报"],
  },
  ppt: {
    agentName: "office-ppt",
    intent: "把主题或资料转成页级故事线、页面文案和演讲备注。",
    skillName: "office-ppt",
    workflow: ["确定受众和汇报目标", "设计故事线", "拆分页级内容", "补充图表和备注"],
    inputFocus: ["汇报目标", "页数范围", "受众角色", "素材来源"],
    attachmentHints: ["PPTX 参考稿", "DOCX/PDF 资料", "数据表格", "产品截图"],
    deliverables: ["页级大纲", "页面文案", "图表建议", "演讲备注"],
    outputFocus: ["逐页标题", "每页核心观点", "视觉建议", "演讲备注"],
    qualityChecks: ["故事线是否连贯", "每页是否只承载一个观点", "图表位置是否明确"],
    reviewQuestions: ["听众最关心什么？", "希望控制在几页？", "这次汇报要争取资源、同步进展还是促成决策？"],
    memoryFocus: ["常用汇报页数", "偏好的叙事结构", "行业话术", "客户关注点"],
    quickPrompts: ["生成 8 页客户提案", "生成项目汇报 PPT", "把资料转成培训课件"],
  },
}

export function officeAgentScenario(id: HomeActionId) {
  return officeAgentScenarios[id]
}

export function officeAgentPromptDraft(id: HomeActionId, quickPrompt: string) {
  return quickPrompt
}
