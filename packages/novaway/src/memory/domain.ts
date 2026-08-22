/** 全能 Agent 领域分类：不绑定“仅写代码”场景 */
export type MemoryDomain = "general" | "coding" | "office" | "personal" | "research" | "ops"

const CODING =
  /代码|仓库|项目|接口|数据库|部署|测试|框架|技术栈|monorepo|bun|pnpm|npm|vite|react|typescript|lint|prettier|\bci\b|\bapi\b|\brepo\b|codebase|\bgit\b|branch|commit|\bbug\b|refactor/i
const OFFICE =
  /办公|会议|纪要|周报|汇报|邮件|公文|ppt|幻灯|表格|合同|方案|材料|文档|office|meeting|minutes|report|email|document|slide/i
const PERSONAL = /偏好|习惯|喜欢|我是|我的名字|称呼|语气|风格|作息|家庭|健康|prefer|preference|i am|my name|style|tone/i
const RESEARCH = /调研|研究|论文|文献|竞品|分析|市场|数据|统计|research|paper|survey|benchmark|analysis/i
const OPS = /运维|监控|告警|发布|回滚|服务器|容器|k8s|docker|日志|事故|oncall|incident|deploy|rollback|ops/i

export function classifyMemoryDomain(text: string, tags: readonly string[] = []): MemoryDomain {
  const blob = `${text} ${tags.join(" ")}`.trim()
  if (!blob) return "general"
  const personal = PERSONAL.test(blob)
  const coding = CODING.test(blob)
  const office = OFFICE.test(blob)
  const research = RESEARCH.test(blob)
  const ops = OPS.test(blob)
  // personal preference without strong work-domain signal
  if (personal && !coding && !office && !research && !ops) return "personal"
  // office / research / ops before generic coding keyword collisions
  if (office && !coding) return "office"
  if (research && !coding) return "research"
  if (ops && !coding) return "ops"
  if (coding) return "coding"
  if (office) return "office"
  if (research) return "research"
  if (ops) return "ops"
  if (personal) return "personal"
  return "general"
}

export function domainLabel(domain: MemoryDomain) {
  if (domain === "coding") return "编程"
  if (domain === "office") return "办公"
  if (domain === "personal") return "个人"
  if (domain === "research") return "研究"
  if (domain === "ops") return "运维"
  return "通用"
}

export function resolveMemoryDomain(input: {
  domain?: MemoryDomain
  content?: string
  userContent?: string
  tags?: readonly string[]
}): MemoryDomain {
  if (input.domain) return input.domain
  return classifyMemoryDomain(`${input.userContent ?? ""} ${input.content ?? ""}`, input.tags ?? [])
}
