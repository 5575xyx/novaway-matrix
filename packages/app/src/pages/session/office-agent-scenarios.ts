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
    workflow: [
      "判断生成、原生模板填充、模板创建或原生增强路由",
      "核验资料与事实充分性",
      "锁定故事线、页面角色和视觉系统",
      "准备图片、图标、公式和图表数据",
      "逐页生成并完成质量检查",
      "导出原生可编辑 PPTX",
    ],
    inputFocus: ["汇报目标", "页数范围", "受众角色", "素材来源"],
    attachmentHints: ["PPTX 参考稿", "DOCX/PDF 资料", "数据表格", "产品截图"],
    deliverables: ["页级大纲", "页面文案", "图表建议", "演讲备注"],
    outputFocus: ["逐页标题", "每页核心观点", "视觉建议", "演讲备注"],
    qualityChecks: [
      "故事线是否连贯",
      "每页是否只承载一个观点",
      "图表数据是否可核验",
      "页面是否存在溢出、遮挡或重复版式",
      "导出对象是否保持可编辑",
    ],
    reviewQuestions: ["听众最关心什么？", "希望控制在几页？", "这次汇报要争取资源、同步进展还是促成决策？"],
    memoryFocus: ["常用汇报页数", "偏好的叙事结构", "行业话术", "客户关注点"],
    quickPrompts: ["生成 8 页客户提案", "生成项目汇报 PPT", "把资料转成培训课件"],
  },
  knowledge: {
    agentName: "office-knowledge",
    intent: "把资料、文档和多来源信息整理成可检索、可复用的知识资产。",
    skillName: "office-knowledge",
    workflow: ["确认资料范围和核心问题", "提炼主题索引和关键观点", "对比差异、来源和证据", "生成 FAQ 和追问线索"],
    inputFocus: ["资料范围", "核心问题", "来源文件", "需要复用的知识"],
    attachmentHints: ["PDF 报告", "DOCX 资料", "网页摘录", "表格数据"],
    deliverables: ["资料摘要", "主题索引", "来源线索", "FAQ"],
    outputFocus: ["保留来源", "区分确定与推断", "结构可检索", "给出可追问问题"],
    qualityChecks: ["是否保留来源", "确定信息与推断是否分开", "索引是否便于后续检索"],
    reviewQuestions: ["这套资料解决什么问题？", "哪些来源可信度更高？", "后续会按什么主题反复查找？"],
    memoryFocus: ["资料领域", "常用术语", "来源可信度", "知识索引结构"],
    quickPrompts: ["总结这份资料", "对比多份文档", "生成 FAQ"],
  },
  data: {
    agentName: "office-data",
    intent: "把 CSV、Excel 和业务数据整理成可核验的分析结论、图表建议和行动建议。",
    skillName: "office-data",
    workflow: [
      "确认数据范围、字段口径和业务问题",
      "识别缺失、重复、异常和类型问题",
      "完成透视、趋势和对比分析",
      "生成图表建议和可执行结论",
    ],
    inputFocus: ["业务问题", "数据文件或字段说明", "关键指标", "时间范围"],
    attachmentHints: ["CSV 数据", "Excel 表格", "字段说明", "历史报告"],
    deliverables: ["数据摘要", "透视分析", "趋势洞察", "图表建议", "行动建议"],
    outputFocus: ["结论先行", "数字可核验", "口径明确", "图表建议可执行"],
    qualityChecks: ["数据口径是否明确", "数字是否来自资料", "结论是否区分事实和推断", "图表建议是否说明类型和维度"],
    reviewQuestions: ["这次分析要回答什么问题？", "哪些字段代表关键指标？", "数据来源和统计口径是什么？"],
    memoryFocus: ["常用指标口径", "业务术语", "数据文件格式", "图表偏好"],
    quickPrompts: ["分析销售数据", "整理透视表", "生成趋势洞察"],
  },
  design: {
    agentName: "office-design",
    intent: "把品牌、活动或内容目标转成可执行的海报、封面、配图和视觉规范。",
    skillName: "office-design",
    workflow: [
      "确认设计目标、受众和品牌约束",
      "建立信息层级和页面构图",
      "确定色彩、字体和视觉基调",
      "生成可执行视觉规范和配图提示词",
    ],
    inputFocus: ["设计目标", "受众", "品牌资料", "参考风格"],
    attachmentHints: ["品牌手册", "活动资料", "参考图", "LOGO 或素材"],
    deliverables: ["宣传海报", "社交封面", "演示配图", "品牌色板", "图标草稿"],
    outputFocus: ["信息层级清晰", "色彩字体具体", "构图可执行", "配图提示词可生成"],
    qualityChecks: ["是否回应设计目标", "色彩和字体是否给出具体值", "信息层级是否清晰", "配图提示词是否可执行"],
    reviewQuestions: ["给谁看？", "用在什么渠道？", "品牌约束和禁用表达是什么？"],
    memoryFocus: ["品牌色板", "视觉风格", "常用字体", "目标用户审美"],
    quickPrompts: ["设计活动海报", "生成品牌色板", "做社交封面"],
  },
  web: {
    agentName: "office-web",
    intent: "把数据、进度或业务信息转成可交互的 HTML 看板、追踪页和工具页。",
    skillName: "office-web",
    workflow: [
      "确认页面目标、数据来源和用户",
      "设计信息架构和页面区块",
      "生成 HTML 结构与交互说明",
      "给出使用和迭代建议",
    ],
    inputFocus: ["页面目标", "数据来源", "目标用户", "页面区块"],
    attachmentHints: ["数据表格", "业务资料", "页面结构", "参考站点"],
    deliverables: ["数据看板", "项目追踪页", "客户工具页", "HTML 页面", "演示站点"],
    outputFocus: ["语义化 HTML", "数据来源清晰", "交互可执行", "页面可直接使用"],
    qualityChecks: ["页面是否回答业务问题", "数据是否有来源", "HTML 是否语义化", "交互说明是否具体"],
    reviewQuestions: ["看板给谁看？", "需要哪些核心指标？", "数据多久更新一次？"],
    memoryFocus: ["常用指标", "页面结构", "业务口径", "可视化偏好"],
    quickPrompts: ["做销售数据看板", "生成项目追踪页", "转成单页演示站"],
  },
}

export function officeAgentScenario(id: HomeActionId) {
  return officeAgentScenarios[id]
}

export function officeAgentPromptDraft(id: HomeActionId, quickPrompt: string) {
  return quickPrompt
}
