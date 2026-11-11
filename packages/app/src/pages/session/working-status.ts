import type { Part, SessionStatus } from "@novaway/sdk/v2"

/**
 * 工作标签的实时状态。
 *
 * 输入框上方和聊天区轮首原来恒显「工作中 · X 秒」，用户看不出代理到底在做什么。
 * 这里按**本轮最后那个还在动的东西**给出一句具体描述：在跑命令就说执行命令，
 * 在流式输出推理就说深入思考，在等用户点批准就说等你放行。全部用现成的客户端
 * 数据（parts 的 pending/running、reasoning/text 的 time.end、待答的 question /
 * permission），不需要模型额外上报。
 */
export type WorkingActivity = {
  key: WorkingActivityKey
  params?: Record<string, string | number>
}

/**
 * 每个状态在 i18n 里有多套等价措辞（基础键 + altN）：常用状态 6 套，其余 3 套。
 * 进入状态时随机挑一套、期间不换词，避免同一动作反复执行时看起来永远一个样。
 */
export const WORKING_PHRASE_VARIANTS = 3
export const COMMON_WORKING_PHRASE_VARIANTS = 6

/** 高频状态：思考、读写检索、执行命令、等用户这几类最常被盯着看，措辞给得最多。 */
const COMMON_WORKING_KEYS = new Set<WorkingActivityKey>([
  "session.working.thinking",
  "session.working.parsing",
  "session.working.composing",
  "session.working.reading",
  "session.working.searching",
  "session.working.listing",
  "session.working.runningCommand",
  "session.working.editing",
  "session.working.drafting",
  "session.working.browsing",
  "session.working.webSearch",
  "session.working.planning",
  "session.working.todo",
  "session.working.verifying",
  "session.working.delegating",
  "session.working.usingTool",
  "session.working.waitingPermission",
  "session.working.waitingQuestion",
])

export function workingPhraseCount(key: WorkingActivityKey): number {
  return COMMON_WORKING_KEYS.has(key) ? COMMON_WORKING_PHRASE_VARIANTS : WORKING_PHRASE_VARIANTS
}

/** variant 是 0..count-1 的序号；0 用基础键，其余映射到 altN，越界钳回该状态自己的最后一套。 */
export function workingPhraseKey(key: WorkingActivityKey, variant: number): string {
  if (variant <= 0) return key
  return `${key}.alt${Math.min(variant, workingPhraseCount(key) - 1)}`
}

export type WorkingActivityKey =
  | "session.working.retry"
  | "session.working.waitingPermission"
  | "session.working.waitingQuestion"
  | "session.working.parsing"
  | "session.working.thinking"
  | "session.working.composing"
  | "session.working.compacting"
  | "session.working.delegating"
  | "session.working.coordinating"
  | "session.working.waitingBackground"
  | "session.working.reading"
  | "session.working.searching"
  | "session.working.listing"
  | "session.working.runningCommand"
  | "session.working.drafting"
  | "session.working.editing"
  | "session.working.browsing"
  | "session.working.webSearch"
  | "session.working.planning"
  | "session.working.todo"
  | "session.working.verifying"
  | "session.working.git"
  | "session.working.research"
  | "session.working.skill"
  | "session.working.image"
  | "session.working.video"
  | "session.working.voice"
  | "session.working.document"
  | "session.working.review"
  | "session.working.interface"
  | "session.working.data"
  | "session.working.schedule"
  | "session.working.repository"
  | "session.working.usingTool"

/** 内置工具 id → 状态。id 见 packages/novaway/src/tool/registry.ts。 */
const TOOL_ACTIVITY: Record<string, WorkingActivityKey> = {
  read: "session.working.reading",
  view: "session.working.reading",
  glob: "session.working.listing",
  list: "session.working.listing",
  grep: "session.working.searching",
  shell: "session.working.runningCommand",
  bash: "session.working.runningCommand",
  powershell: "session.working.runningCommand",
  write: "session.working.drafting",
  edit: "session.working.editing",
  multiedit: "session.working.editing",
  multi_edit: "session.working.editing",
  patch: "session.working.editing",
  apply_patch: "session.working.editing",
  notebook_edit: "session.working.editing",
  task: "session.working.delegating",
  task_status: "session.working.waitingBackground",
  subtask: "session.working.delegating",
  orchestrator: "session.working.coordinating",
  team_run: "session.working.coordinating",
  team_run_status: "session.working.coordinating",
  workflow: "session.working.coordinating",
  workflow_run: "session.working.coordinating",
  resume_workflow_run: "session.working.coordinating",
  fetch: "session.working.browsing",
  webfetch: "session.working.browsing",
  search: "session.working.webSearch",
  websearch: "session.working.webSearch",
  todo: "session.working.todo",
  todowrite: "session.working.todo",
  todoedit: "session.working.todo",
  plan: "session.working.planning",
  plan_enter: "session.working.planning",
  lsp: "session.working.verifying",
  run_verification: "session.working.verifying",
  verify: "session.working.verifying",
  git: "session.working.git",
  memory: "session.working.research",
  knowledge_search: "session.working.research",
  knowledge_ocr: "session.working.research",
  knowledge_manage: "session.working.research",
  rules_manage: "session.working.research",
  skill: "session.working.skill",
  skill_install: "session.working.skill",
  skill_python: "session.working.skill",
  plugin_install: "session.working.skill",
  tool_search: "session.working.skill",
  generate_image: "session.working.image",
  generate_video: "session.working.video",
  generate_narration: "session.working.voice",
  office_pptx_read: "session.working.document",
  office_pptx_edit: "session.working.document",
  office_document_read: "session.working.document",
  office_document_edit: "session.working.document",
  office_document_export: "session.working.document",
  pdf_create: "session.working.document",
  review_document: "session.working.review",
  question: "session.working.waitingQuestion",
  repo_clone: "session.working.repository",
  repo_overview: "session.working.repository",
  sleep: "session.working.waitingBackground",
  database_list: "session.working.data",
  database_query: "session.working.data",
  database_tables: "session.working.data",
  database_describe: "session.working.data",
  cron_create: "session.working.schedule",
  cron_delete: "session.working.schedule",
  cron_list: "session.working.schedule",
}

/**
 * MCP / 插件工具是 `client_tool` 这种动态 id，逐条枚举不现实，
 * 所以按名字里的动词兜一层；再匹配不上就统一说「调用工具中」。
 */
const TOOL_ACTIVITY_BY_WORD: Array<[RegExp, WorkingActivityKey]> = [
  [/(search|grep|lookup|discover|query)/, "session.working.searching"],
  [/(read|view|inspect|snapshot|describe|schema|open|list)/, "session.working.reading"],
  [/(edit|write|create|update|patch|replace|insert)/, "session.working.editing"],
  [/(run|exec|shell|bash|command|build|test)/, "session.working.runningCommand"],
  [/(fetch|download|http|url|navigate)/, "session.working.browsing"],
  [/(image|video|render)/, "session.working.image"],
]

function activityOfTool(tool: string): WorkingActivity {
  const name = tool.toLowerCase()
  const exact = TOOL_ACTIVITY[name]
  if (exact) return { key: exact }
  const byWord = TOOL_ACTIVITY_BY_WORD.find(([pattern]) => pattern.test(name))
  return { key: byWord?.[1] ?? "session.working.usingTool" }
}

/** 这个 part 现在还在动吗？ */
function isLive(part: Part | undefined): boolean {
  if (!part) return false
  if (part.type === "tool") return part.state.status === "pending" || part.state.status === "running"
  if (part.type === "compaction") return true
  if (part.type === "subtask") return true
  // reasoning / text 只有流完才会写 time.end；time 缺失按「还在流」处理。
  if (part.type === "reasoning" || part.type === "text") return part.time?.end === undefined
  return false
}

function activityOfLive(part: Part): WorkingActivity {
  if (part.type === "tool") return activityOfTool(part.tool)
  if (part.type === "compaction") return { key: "session.working.compacting" }
  if (part.type === "subtask") return { key: "session.working.delegating" }
  if (part.type === "text" && !part.synthetic) return { key: "session.working.composing" }
  return { key: "session.working.thinking" }
}

export function workingActivity(input: {
  status: SessionStatus | undefined
  /** 有真正在等用户的提问 / 授权时为 "question" / "permission"。 */
  waiting?: "question" | "permission"
  /** 本轮助手消息的 parts，按 id 排序（与聊天区同一份数据）。 */
  parts: Part[]
}): WorkingActivity {
  if (input.status?.type === "retry") {
    return { key: "session.working.retry", params: { attempt: input.status.attempt } }
  }
  if (input.waiting === "permission") return { key: "session.working.waitingPermission" }
  if (input.waiting === "question") return { key: "session.working.waitingQuestion" }

  for (let index = input.parts.length - 1; index >= 0; index--) {
    const part = input.parts[index]
    if (!isLive(part)) continue
    return activityOfLive(part)
  }

  // 没有正在动的 part：本轮已有内容说明模型正在酝酿下一步，什么都没有说明刚收到需求。
  return { key: input.parts.length === 0 ? "session.working.parsing" : "session.working.thinking" }
}
