import type { HomeActionId } from "./zen-office"
import { officePptTemplates, type OfficePptTemplateID } from "@/pages/session/office-export"

export type OfficeTemplateCard = {
  id: string
  title: string
  description: string
  prompt: string
  pptTemplate?: OfficePptTemplateID | "auto"
  tags: string[]
}

export const officeTemplateCards: Record<HomeActionId, OfficeTemplateCard[]> = {
  document: [
    {
      id: "project-plan",
      title: "项目方案",
      description: "背景、目标、范围、里程碑、风险和资源需求。",
      prompt: "写一份项目方案，包含背景、目标、范围、里程碑、风险和资源需求。",
      tags: ["方案", "里程碑"],
    },
    {
      id: "work-report",
      title: "工作报告",
      description: "结论先行、过程清楚、数据和下一步行动完整。",
      prompt: "把当前资料整理成一份结构清晰的工作报告，先结论后过程。",
      tags: ["报告", "数据"],
    },
    {
      id: "weekly-report",
      title: "周报月报",
      description: "本周进展、问题风险、下周计划和需要协同事项。",
      prompt: "生成一份周报，包含本周进展、问题风险、下周计划和需要协同事项。",
      tags: ["周报", "计划"],
    },
    {
      id: "meeting-notes",
      title: "会议纪要",
      description: "结论、决议、行动项、负责人和截止时间。",
      prompt: "把会议内容整理成会议纪要，包含结论、决议、行动项、负责人和截止时间。",
      tags: ["纪要", "行动项"],
    },
    {
      id: "prd",
      title: "PRD 需求文档",
      description: "用户故事、功能范围、验收标准和边界条件。",
      prompt: "生成一份 PRD，包含用户故事、功能范围、验收标准和边界条件。",
      tags: ["PRD", "需求"],
    },
    {
      id: "business-note",
      title: "商务说明",
      description: "面向客户或合作伙伴的清晰商务表达。",
      prompt: "写一份商务说明，逻辑清晰、重点突出、适合对外交付。",
      tags: ["商务", "对外"],
    },
  ],
  ppt: officePptTemplates
    .filter((template) => template.source === "Pptx" || template.source === "Presenton")
    .sort((a, b) => {
      const aPriority = a.source === "Presenton" ? 0 : 1
      const bPriority = b.source === "Presenton" ? 0 : 1
      return aPriority - bPriority
    })
    .map((template) => ({
      id: `ppt-${template.id}`,
      title: template.name,
      description: template.description,
      prompt: `使用「${template.name}」PPT 模板生成一份完整汇报，保持该模板的配色、版式和页面气质。`,
      pptTemplate: template.id,
      tags: ["PPT", "真实模板"],
    })),
  knowledge: [
    {
      id: "source-summary",
      title: "资料摘要",
      description: "保留来源和关键结论的可检索摘要。",
      prompt: "把资料整理成可检索的知识摘要，保留来源和关键结论。",
      tags: ["摘要", "来源"],
    },
    {
      id: "document-compare",
      title: "多文档对比",
      description: "共识、差异和证据线索。",
      prompt: "对比多份文档，列出共识、差异和证据线索。",
      tags: ["对比", "证据"],
    },
    {
      id: "topic-index",
      title: "主题索引",
      description: "按主题组织，便于后续查找。",
      prompt: "生成主题索引，按主题组织资料，便于后续查找。",
      tags: ["索引", "检索"],
    },
    {
      id: "faq",
      title: "FAQ",
      description: "覆盖读者最可能提出的问题。",
      prompt: "根据资料生成 FAQ，覆盖读者最可能提出的问题。",
      tags: ["FAQ", "问答"],
    },
  ],
  data: [
    {
      id: "data-cleanup",
      title: "数据清洗",
      description: "字段口径、空值、重复值和异常值整理。",
      prompt: "对这份表格做数据清洗，明确字段口径、空值、重复值和异常值处理方式。",
      tags: ["清洗", "口径"],
    },
    {
      id: "pivot-analysis",
      title: "透视分析",
      description: "按产品、区域、时间等维度输出关键指标。",
      prompt: "把原始表格整理成透视分析，按关键维度输出汇总指标、对比和异常。",
      tags: ["透视", "指标"],
    },
    {
      id: "trend-insight",
      title: "趋势洞察",
      description: "时间序列、增长下滑和归因分析。",
      prompt: "分析这份数据的时间趋势，列出增长、下滑、季节性和归因。",
      tags: ["趋势", "归因"],
    },
    {
      id: "chart-suggestions",
      title: "图表建议",
      description: "图表类型、维度、指标和可视化要点。",
      prompt: "根据数据生成图表建议，说明图表类型、展示维度、关键指标和结论。",
      tags: ["图表", "可视化"],
    },
  ],
  design: [
    {
      id: "campaign-poster",
      title: "活动海报",
      description: "主标题、副标题、关键信息和视觉基调。",
      prompt: "设计一张活动海报，给出主标题、副标题、关键信息、构图和视觉基调。",
      tags: ["海报", "活动"],
    },
    {
      id: "social-cover",
      title: "社交封面",
      description: "适合公众号、视频封面或社媒配图。",
      prompt: "生成社交封面设计方案，说明文案层级、视觉元素和适合尺寸。",
      tags: ["封面", "社媒"],
    },
    {
      id: "brand-palette",
      title: "品牌色板",
      description: "主色、辅助色、文字色和应用规则。",
      prompt: "生成一套品牌色板，包含主色、辅助色、文字色、使用比例和应用规则。",
      tags: ["色板", "品牌"],
    },
    {
      id: "icon-draft",
      title: "图标草稿",
      description: "线条风格、视觉语言和常见场景。",
      prompt: "生成一套图标草稿，说明线条风格、视觉语言和常见应用场景。",
      tags: ["图标", "视觉"],
    },
  ],
  web: [
    {
      id: "data-dashboard",
      title: "数据看板",
      description: "核心指标、趋势图、排名表和行动项。",
      prompt: "生成一个数据看板 HTML 页面，包含核心指标、趋势图、排名表和行动项。",
      tags: ["看板", "数据"],
    },
    {
      id: "project-tracker",
      title: "项目追踪页",
      description: "里程碑、风险、负责人和状态。",
      prompt: "生成一个项目追踪 HTML 页面，包含里程碑、风险、负责人和状态。",
      tags: ["追踪", "项目"],
    },
    {
      id: "customer-tool",
      title: "客户工具页",
      description: "自助查询、进度查看或资料下载。",
      prompt: "生成一个客户工具 HTML 页面，包含自助查询、进度查看或资料下载功能说明。",
      tags: ["客户", "工具"],
    },
    {
      id: "single-page-site",
      title: "单页演示站",
      description: "结构清晰、适合展示的 HTML 页面。",
      prompt: "把资料转成一个单页演示站点，结构清晰、适合展示。",
      tags: ["单页", "展示"],
    },
  ],
}
