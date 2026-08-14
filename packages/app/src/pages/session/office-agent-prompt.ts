import type { Prompt } from "@/context/prompt"
import { normalizeOfficeLaunchConfig, officeLaunchContextText, type OfficeLaunchConfig } from "@/pages/home/office-home"
import { zenActions, type HomeActionId } from "@/pages/home/zen-office"
import { officeAgentScenario } from "@/pages/session/office-agent-scenarios"
import {
  officePptTemplateDescription,
  officePptTemplateFile,
  officePptTemplateName,
  type OfficePptTemplateChoice,
} from "@/pages/session/office-export"

export function officeAgentSyntheticText(input: {
  actionID: HomeActionId
  quickMode: boolean
  pptTemplate: OfficePptTemplateChoice
  launchConfig?: OfficeLaunchConfig
}) {
  const action = zenActions.find((item) => item.id === input.actionID) ?? zenActions[0]
  const scenario = officeAgentScenario(action.id)
  const sections = [
    `场景目标：${scenario.intent}`,
    "",
    "场景工作流：",
    ...scenario.workflow.map((item, index) => `${index + 1}. ${item}`),
    "",
    "需要资料：",
    ...scenario.inputFocus.map((item, index) => `${index + 1}. ${item}`),
    "",
    "适合附件：",
    ...scenario.attachmentHints.map((item, index) => `${index + 1}. ${item}`),
    "",
    "交付产物：",
    ...scenario.deliverables.map((item, index) => `${index + 1}. ${item}`),
    "",
    "输出重点：",
    ...scenario.outputFocus.map((item, index) => `${index + 1}. ${item}`),
    "",
    "质量检查：",
    ...scenario.qualityChecks.map((item, index) => `${index + 1}. ${item}`),
    "",
    "发送前确认：",
    ...scenario.reviewQuestions.map((item, index) => `${index + 1}. ${item}`),
    "",
    "记忆与进化重点：",
    ...scenario.memoryFocus.map((item, index) => `${index + 1}. ${item}`),
    "",
    `你现在处于 NovaWay 禅意模式（办公模式），当前办公场景是「${action.title}」。`,
    `请按「${action.meta}」场景处理用户输入，优先输出可直接复制使用的办公产物。`,
    `开始处理前请优先调用 skill 工具加载「${scenario.skillName}」Skill，并按该 Skill 的流程组织结果。`,
    "输出中必须把正文和长期沉淀建议分开：正文使用「# 办公产物」作为一级标题；末尾使用「# 可沉淀记忆/可进化建议」作为一级标题，并分别列出「可沉淀记忆」「可进化建议」「需要用户确认」。",
    "不要把未确认的偏好写成确定事实。",
  ]

  if (input.quickMode) {
    sections.push(
      "",
      "快速模式：不要使用 question 工具追问，不要输出需求确认，基于已有信息直接生成完整办公产物；资料不足时在正文中明确标注待确认项。",
    )
  }

  if (action.id !== "ppt") return sections.join("\n")

  sections.push("", officeLaunchContextText(normalizeOfficeLaunchConfig(action.id, input.launchConfig)))
  sections.push(
    "",
    `当前锁定的 PPT 模板：${officePptTemplateName(input.pptTemplate)}`,
    `模板说明：${officePptTemplateDescription(input.pptTemplate)}`,
    ...(officePptTemplateFile(input.pptTemplate) ? [`真实模板文件：${officePptTemplateFile(input.pptTemplate)}`] : []),
    "本轮以及后续生成、补充、润色和重新生成都必须继续使用当前模板。只有用户明确切换模板时，才允许改变配色、版式和页面气质。",
    "第一次生成的 PPT 必须直接套用当前模板，不得先使用自动匹配或其他模板生成后再替换。",
  )
  return sections.join("\n")
}

export function transformOfficePrompt(input: {
  prompt: Prompt
  actionID: HomeActionId
  quickMode: boolean
  pptTemplate: OfficePptTemplateChoice
  launchConfig?: OfficeLaunchConfig
}) {
  const text = input.prompt.map((part) => ("content" in part ? part.content : "")).join("")
  if (text.trim().startsWith("/")) return input.prompt
  return {
    prompt: input.prompt,
    syntheticText: officeAgentSyntheticText(input),
  }
}
