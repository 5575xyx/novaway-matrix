import { zenActions, type HomeActionId } from "./zen-office"
import type { OfficeTemplateCard } from "./office-template-cards"

export type OfficeHomeDraft = {
  prompt: string
  role: string
  useCase: string
  audience: string
  pageCount: string
  material: string
  taskTracking: boolean
  template?: OfficeTemplateCard
}

export type OfficeLaunchConfig = {
  role: string
  useCase: string
  audience: string
  pageCount: string
  material: string
  taskTracking: boolean
  assets?: string[]
}

export const officeRoleOptions = ["市场", "产品", "销售", "项目经理", "运营", "行政"]
export const officeAudienceOptions = ["公司内部", "管理层", "客户", "合作伙伴", "公众", "学生"]
export const officePageCountOptions = ["5-10 页", "10-15 页", "15-20 页", "自适应"]
export const officeMaterialOptions = ["未选择", "使用当前项目文件", "稍后上传附件", "仅基于描述"]

export function defaultOfficeHomeDraft(id: HomeActionId): OfficeHomeDraft {
  const action = zenActions.find((item) => item.id === id) ?? zenActions[0]
  return {
    prompt: "",
    role: officeRoleOptions[0],
    useCase: action.outputs[0] ?? action.title,
    audience: officeAudienceOptions[0],
    pageCount: officePageCountOptions[0],
    material: officeMaterialOptions[0],
    taskTracking: false,
  }
}

export function createOfficeHomeSubmission(id: HomeActionId, draft: OfficeHomeDraft) {
  const action = zenActions.find((item) => item.id === id) ?? zenActions[0]
  return {
    prompt: draft.prompt.trim() || action.placeholder,
    launchConfig: id === "ppt" ? officeLaunchConfigFromDraft(draft) : undefined,
  }
}

export function officeLaunchConfigFromDraft(draft: OfficeHomeDraft): OfficeLaunchConfig {
  return {
    role: draft.role,
    useCase: draft.useCase,
    audience: draft.audience,
    pageCount: draft.pageCount,
    material: draft.material,
    taskTracking: draft.taskTracking,
  }
}

export function defaultOfficeLaunchConfig(id: HomeActionId): OfficeLaunchConfig {
  return officeLaunchConfigFromDraft(defaultOfficeHomeDraft(id))
}

/**
 * The selections are user-visible defaults even before anything is picked, so an
 * absent or stale stored value still has to resolve to the values on screen.
 */
export function normalizeOfficeLaunchConfig(
  id: HomeActionId,
  config: OfficeLaunchConfig | undefined,
): OfficeLaunchConfig {
  const base = defaultOfficeLaunchConfig(id)
  if (!config) return base
  const action = zenActions.find((item) => item.id === id) ?? zenActions[0]
  return {
    role: config.role || base.role,
    useCase: action.outputs.includes(config.useCase) ? config.useCase : base.useCase,
    audience: config.audience || base.audience,
    pageCount: config.pageCount || base.pageCount,
    material: config.material || base.material,
    taskTracking: config.taskTracking ?? base.taskTracking,
    assets: config.assets?.length ? [...config.assets] : base.assets,
  }
}

export function officeLaunchContextText(config: OfficeLaunchConfig) {
  return [
    "当前已选择的 PPT 生成配置（来自工作台选项，用户界面不重复展示）：",
    `- 角色：${config.role}`,
    `- 使用场景：${config.useCase}`,
    `- 目标受众：${config.audience}`,
    `- 页数：${config.pageCount}`,
    `- 素材：${config.material}`,
    `- 任务追踪：${config.taskTracking ? "包含" : "不包含"}`,
    `- 已选素材：${config.assets?.length ? config.assets.join("、") : "未选择"}`,
    "",
    "以上配置以本条为准，覆盖历史轮次中出现过的同类配置。",
    "",
    "PPT 生成硬约束：",
    `1. 以「${config.role}」岗位视角组织判断、案例和行动建议。`,
    `2. 按「${config.useCase}」场景安排故事线、页面类型和结论强度。`,
    `3. 面向「${config.audience}」控制术语密度、解释深度和表达语气。`,
    `4. 页数必须符合「${config.pageCount}」；先规划总页数，再逐页生成，不得无故超出范围。`,
    `5. ${officeMaterialRule(config.material)}`,
    `6. ${officeTaskTrackingRule(config.taskTracking)}`,
    `7. ${officeAssetsRule(config.assets)}`,
    "",
    "PPT Master 对齐流程：",
    "1. 当前请求属于 Generate PPTX 路由；如果后续收到原始 PPTX 模板并要求填充，应切换为 Fill Native PPTX。",
    "2. 先核验资料和事实充分性，再锁定故事线、页面角色、视觉系统和模板应用方式。",
    "3. 按 Strategist → 资源准备 → Executor → 质量检查 → 原生 PPTX 导出的顺序执行。",
    "4. 生成结果必须保持文字、形状、图表、表格和演讲备注可继续编辑。",
    "5. 已确认的配置不要重复追问；只有资料事实存在关键缺口时才请求补充。",
  ].join("\n")
}

function officeMaterialRule(material: string) {
  if (material === "使用当前项目文件")
    return "主动检索当前项目目录中的相关文档、数据和图片，优先使用可核验内容，并区分事实、推断和待确认项。"
  if (material === "稍后上传附件") return "优先使用本轮及后续上传的附件；附件尚未提供时保留明确占位，不得虚构附件内容。"
  if (material === "仅基于描述") return "只使用用户描述和当前对话中的信息，不主动引入项目目录内容；缺失事实要明确标注。"
  return "当前未指定素材来源；先使用用户描述，只有关键事实不足时才提示补充资料。"
}

function officeTaskTrackingRule(enabled: boolean) {
  if (enabled)
    return "生成任务追踪内容时至少安排一页甘特图或排期表，任务、负责人、状态和时间必须完整，并与正文行动项保持一致。"
  return "不强制加入任务追踪页；正文出现任务或排期需求时仍可使用排期表或甘特页。"
}

function officeAssetsRule(assets?: string[]) {
  if (!assets?.length) return "未指定额外项目素材；继续按素材来源策略处理。"
  return `生成时必须优先核验并使用以下项目素材：${assets.join("、")}；素材不可读、与主题无关或缺少上下文时，在正文中明确标注待确认项。`
}

export function officeLaunchConfigFromSearch(params: URLSearchParams): OfficeLaunchConfig | undefined {
  const role = params.get("officeRole")
  const useCase = params.get("officeUseCase")
  const audience = params.get("officeAudience")
  const pageCount = params.get("officePages")
  const material = params.get("officeMaterial")
  const taskTracking = params.get("officeTaskTracking")
  const assets = params.get("officeAssets")
  if (!role || !useCase || !audience || !pageCount || !material) return undefined
  return {
    role,
    useCase,
    audience,
    pageCount,
    material,
    taskTracking: taskTracking === "1",
    ...(assets ? { assets: assets.split(",").filter(Boolean) } : {}),
  }
}

export function officeWorkspaceSearch(input: {
  prompt: string
  officeID: HomeActionId
  pptTemplate?: string
  launchConfig?: OfficeLaunchConfig
  submit?: boolean
}) {
  const query = new URLSearchParams({ office: input.officeID })
  if (input.prompt.trim()) query.set("prompt", input.prompt.trim())
  if (input.submit) query.set("submit", "1")
  if (input.pptTemplate) query.set("pptTemplate", input.pptTemplate)
  if (input.launchConfig) {
    query.set("officeRole", input.launchConfig.role)
    query.set("officeUseCase", input.launchConfig.useCase)
    query.set("officeAudience", input.launchConfig.audience)
    query.set("officePages", input.launchConfig.pageCount)
    query.set("officeMaterial", input.launchConfig.material)
    if (input.launchConfig.taskTracking) query.set("officeTaskTracking", "1")
    if (input.launchConfig.assets?.length) query.set("officeAssets", input.launchConfig.assets.join(","))
  }
  return query
}
