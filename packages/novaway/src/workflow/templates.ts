import type { WorkflowStep } from "./workflow.sql"

// 组合工作流模板(MiMoCode 语义)。每个模板是一张 WorkflowStep 图,
// 由执行引擎 (workflow/executor) 按 next / nextTrue / nextFalse / parallel 遍历。
// config.agent 指定专用子代理;若该 agent 未定义,引擎回退到默认 agent。
// prompt 中的 {{stepId}} 会被替换为对应前置步骤的输出。

export type WorkflowTemplateId = "compose" | "deep-research" | "fact-check" | "research-experiment"

export interface WorkflowTemplate {
  readonly id: WorkflowTemplateId
  readonly name: string
  readonly description: string
  readonly steps: WorkflowStep[]
}

const compose: WorkflowTemplate = {
  id: "compose",
  name: "组合流水线",
  description: "规划 → 执行 → 审查 → 综合,通用多步组合工作流",
  steps: [
    {
      id: "plan",
      name: "规划",
      type: "agent",
      config: { agent: "plan", prompt: "为以下目标制定分步执行计划：\n{{input}}" },
      next: "execute",
    },
    {
      id: "execute",
      name: "执行",
      type: "agent",
      config: { agent: "build", prompt: "按此计划执行并给出结果：\n{{plan}}" },
      next: "review",
    },
    {
      id: "review",
      name: "审查",
      type: "agent",
      config: { agent: "general", prompt: "审查以下执行结果,指出问题与改进点：\n{{execute}}" },
      next: "synthesize",
    },
    {
      id: "synthesize",
      name: "综合",
      type: "agent",
      config: {
        agent: "general",
        prompt: "综合计划、执行结果与审查意见,输出最终交付：\n计划：{{plan}}\n结果：{{execute}}\n审查：{{review}}",
      },
    },
  ],
}

const deepResearch: WorkflowTemplate = {
  id: "deep-research",
  name: "深度研究",
  description: "并行多角度检索 → 深读分析 → 综合成文",
  steps: [
    {
      id: "gather",
      name: "并行检索",
      type: "parallel",
      config: {},
      steps: ["gather-web", "gather-code"],
      next: "analyze",
    },
    {
      id: "gather-web",
      name: "网络检索",
      type: "agent",
      config: { agent: "general", prompt: "围绕以下主题做网络检索,汇总关键事实与来源：\n{{input}}" },
    },
    {
      id: "gather-code",
      name: "本地检索",
      type: "agent",
      config: { agent: "general", prompt: "围绕以下主题检索本地代码库/文档,汇总相关证据：\n{{input}}" },
    },
    {
      id: "analyze",
      name: "深读分析",
      type: "agent",
      config: {
        agent: "general",
        prompt: "对检索结果做深读分析,提炼洞见与矛盾：\n网络：{{gather-web}}\n本地：{{gather-code}}",
      },
      next: "synthesize",
    },
    {
      id: "synthesize",
      name: "综合成文",
      type: "agent",
      config: { agent: "general", prompt: "基于分析结论撰写结构化研究报告：\n{{analyze}}" },
    },
  ],
}

const factCheck: WorkflowTemplate = {
  id: "fact-check",
  name: "事实核查",
  description: "抽取论断 → 逐条核验 → 给出结论",
  steps: [
    {
      id: "extract",
      name: "抽取论断",
      type: "agent",
      config: { agent: "general", prompt: "从以下内容中抽取可核查的事实性论断,逐条列出：\n{{input}}" },
      next: "verify",
    },
    {
      id: "verify",
      name: "逐条核验",
      type: "agent",
      config: { agent: "general", prompt: "对每条论断查证并标注 支持/反对/存疑 及依据：\n{{extract}}" },
      next: "verdict",
    },
    {
      id: "verdict",
      name: "综合结论",
      type: "agent",
      config: { agent: "general", prompt: "综合核验结果给出总体可信度判断与说明：\n{{verify}}" },
    },
  ],
}

const researchExperiment: WorkflowTemplate = {
  id: "research-experiment",
  name: "研究实验",
  description: "提出假设 → 设计实验 → 执行 → 归纳结论",
  steps: [
    {
      id: "hypothesis",
      name: "提出假设",
      type: "agent",
      config: { agent: "general", prompt: "针对以下问题提出可检验的假设：\n{{input}}" },
      next: "design",
    },
    {
      id: "design",
      name: "设计实验",
      type: "agent",
      config: { agent: "plan", prompt: "为验证该假设设计可执行的实验方案：\n{{hypothesis}}" },
      next: "run",
    },
    {
      id: "run",
      name: "执行实验",
      type: "agent",
      config: { agent: "build", prompt: "按方案执行实验并记录观测结果：\n{{design}}" },
      next: "conclude",
    },
    {
      id: "conclude",
      name: "归纳结论",
      type: "agent",
      config: {
        agent: "general",
        prompt: "根据观测结果判断假设是否成立并归纳结论：\n假设：{{hypothesis}}\n结果：{{run}}",
      },
    },
  ],
}

export const WORKFLOW_TEMPLATES: Record<WorkflowTemplateId, WorkflowTemplate> = {
  compose,
  "deep-research": deepResearch,
  "fact-check": factCheck,
  "research-experiment": researchExperiment,
}

export function listTemplates(): WorkflowTemplate[] {
  return Object.values(WORKFLOW_TEMPLATES)
}

export function getTemplate(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES[id as WorkflowTemplateId]
}
