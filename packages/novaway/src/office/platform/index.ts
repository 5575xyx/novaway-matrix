import path from "node:path"
import { randomUUID } from "node:crypto"
import { copyFile, mkdir, readFile, writeFile } from "fs/promises"
import { GlobalBus } from "@/bus/global"
import { InstanceState } from "@/effect/instance-state"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { SessionPrompt } from "@/session/prompt"
import { Question } from "@/question"
import { FeishuReplyClient, type FeishuReplyRoute } from "@/office/feishu"
import type { NormalizedMessage } from "@larksuiteoapi/node-sdk"
import { Cause, Clock, Context, Effect, Exit, Fiber, Layer, Option, Scope } from "effect"

export type OfficeScheduleTrigger =
  | {
      type: "interval"
      minutes: number
    }
  | {
      type: "daily"
      time: string
    }
  | {
      type: "weekly"
      dayOfWeek: number
      time: string
    }
  | {
      type: "monthly"
      dayOfMonth: number
      time: string
    }
  | {
      type: "days"
      everyDays: number
      time: string
    }

export type OfficeSchedule = {
  id: string
  title: string
  scene: string
  prompt: string
  connectors: readonly string[]
  browser: {
    enabled: boolean
    url?: string
  }
  notificationUrl?: string
  trigger: OfficeScheduleTrigger
  inputValues?: Record<string, string>
  status: "active" | "paused"
  nextRunAt: number
  createdAt: number
  updatedAt: number
}

export type OfficeScheduleInput = {
  title: string
  scene: string
  prompt: string
  connectors?: readonly string[]
  browser?: {
    enabled?: boolean
    url?: string
  }
  notificationUrl?: string
  inputValues?: Record<string, string>
  trigger: OfficeScheduleTrigger
}

export type OfficeRunStatus = "running" | "completed" | "error"

export type OfficeRun = {
  id: string
  scheduleId?: string
  workflowId?: string
  inputValues?: Record<string, string>
  status: OfficeRunStatus
  startedAt: number
  completedAt?: number
  output?: string
  error?: string
  logs: string[]
}

export type OfficeWorkflow = {
  id: string
  title: string
  scene: string
  prompt: string
  connectors: readonly string[]
  browser: {
    enabled: boolean
    url?: string
  }
  notificationUrl?: string
  sourceSessionId?: string
  enabled: boolean
  version: number
  createdAt: number
  updatedAt: number
}

export type OfficeWorkflowInput = {
  title: string
  scene: string
  prompt: string
  connectors?: readonly string[]
  browser?: {
    enabled?: boolean
    url?: string
  }
  notificationUrl?: string
  sourceSessionId?: string
  enabled?: boolean
}

export type OfficeArtifactKind =
  | "document"
  | "ppt"
  | "data"
  | "design"
  | "web"
  | "knowledge"
  | "meeting"
  | "task"
  | "communication"

export type OfficeArtifact = {
  id: string
  kind: OfficeArtifactKind
  name: string
  filename: string
  path: string
  workflowId?: string
  runId?: string
  version: number
  createdAt: number
  updatedAt: number
}

export type OfficePlatformStatus = {
  schedulerEnabled: true
  scheduleCount: number
  activeScheduleCount: number
  browserConfigured: boolean
  diagnostics: {
    browser: "configured" | "connected" | "failed"
    tencentDocs: "configured" | "missing"
    feishu: "configured" | "missing"
  }
}

export type OfficeConnectorConfig = {
  feishuWebhookUrl?: string
  feishuKeyword?: string
  feishuAppId?: string
  feishuAppSecret?: string
  feishuUserId?: string
  tencentDocsToken?: string
}

type PlatformData = {
  schedules: OfficeSchedule[]
  runs: OfficeRun[]
  workflows: OfficeWorkflow[]
  artifacts: OfficeArtifact[]
  connectorConfig?: OfficeConnectorConfig
  feishuRoutes?: Record<string, FeishuReplyRoute>
}

type State = {
  file: string
  data: PlatformData
}

export interface Interface {
  readonly listSchedules: () => Effect.Effect<OfficeSchedule[]>
  readonly createSchedule: (input: OfficeScheduleInput) => Effect.Effect<OfficeSchedule>
  readonly updateSchedule: (
    id: string,
    input: Partial<OfficeScheduleInput> & { status?: "active" | "paused" },
  ) => Effect.Effect<OfficeSchedule | undefined>
  readonly deleteSchedule: (id: string) => Effect.Effect<boolean>
  readonly listRuns: () => Effect.Effect<OfficeRun[]>
  readonly runNow: (id: string) => Effect.Effect<OfficeRun | undefined, never, Session.Service | SessionPrompt.Service>
  readonly listWorkflows: () => Effect.Effect<OfficeWorkflow[]>
  readonly createWorkflow: (input: OfficeWorkflowInput) => Effect.Effect<OfficeWorkflow>
  readonly updateWorkflow: (
    id: string,
    input: Partial<OfficeWorkflowInput>,
  ) => Effect.Effect<OfficeWorkflow | undefined>
  readonly deleteWorkflow: (id: string) => Effect.Effect<boolean>
  readonly runWorkflow: (
    id: string,
    inputValues?: Record<string, string>,
  ) => Effect.Effect<OfficeRun | undefined, never, Session.Service | SessionPrompt.Service>
  readonly scheduleWorkflow: (
    id: string,
    trigger: OfficeScheduleTrigger,
    notificationUrl?: string,
    browser?: OfficeSchedule["browser"],
    inputValues?: Record<string, string>,
  ) => Effect.Effect<OfficeSchedule | undefined>
  readonly listArtifacts: () => Effect.Effect<OfficeArtifact[]>
  readonly registerArtifact: (input: {
    kind: OfficeArtifactKind
    name: string
    filename: string
    path: string
    workflowId?: string
    runId?: string
  }) => Effect.Effect<OfficeArtifact | undefined>
  readonly restoreArtifact: (id: string, version?: number) => Effect.Effect<OfficeArtifact | undefined>
  readonly getConnectorConfig: () => Effect.Effect<OfficeConnectorConfig>
  readonly saveConnectorConfig: (input: OfficeConnectorConfig) => Effect.Effect<OfficeConnectorConfig>
  readonly sendFeishuMessage: (input: {
    text: string
    directory?: string
    sessionID?: string
    questionRequestID?: string
    questions?: FeishuReplyRoute["questions"]
  }) => Effect.Effect<boolean>
  readonly status: () => Effect.Effect<OfficePlatformStatus>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/OfficePlatform") {}

function deepCopy<A>(value: A): A {
  return JSON.parse(JSON.stringify(value)) as A
}

function normalizeTencentDocsToken(token?: string) {
  const value = token?.trim() ?? ""
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : value
}

function substituteOfficeInputs(prompt: string, values: Record<string, string>) {
  return prompt.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => values[key]?.trim() || match)
}

function normalizeFeishuText(content: string) {
  const trimmed = content.trim()
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed === "string") return parsed.trim()
    if (parsed && typeof parsed === "object") {
      const text = (parsed as Record<string, unknown>).text
      if (typeof text === "string") return text.trim()
    }
  } catch {
    // 飞书长连接里的文本有时已经是纯文本，直接使用
  }
  return trimmed
}

function resolveFeishuOption(token: string, options: NonNullable<FeishuReplyRoute["questions"]>[number]["options"]) {
  const value = token.trim().toLowerCase()
  const exact = options.findIndex(
    (option) => option.label.trim().toLowerCase() === value || option.description.trim().toLowerCase() === value,
  )
  if (exact >= 0) return exact
  if (/^[a-z]$/.test(value)) return value.charCodeAt(0) - 97
  if (/^\d+$/.test(value)) return Number(value) - 1
  return -1
}

function resolveFeishuAnswer(
  raw: string,
  options: NonNullable<FeishuReplyRoute["questions"]>[number]["options"],
  multiple?: boolean,
  custom?: boolean,
) {
  const answer: string[] = []
  const tokens = raw
    .split(/[,，、;；]+/)
    .map((token) => token.trim())
    .filter(Boolean)
  for (const token of tokens) {
    const index = resolveFeishuOption(token, options)
    if (index < 0 || index >= options.length) {
      if (custom === false) continue
      const value = token.trim()
      if (value && !answer.includes(value)) answer.push(value)
      if (!multiple) break
      continue
    }
    const label = options[index].label.trim()
    if (!answer.includes(label)) answer.push(label)
    if (!multiple) break
  }
  return answer
}

function parseFeishuQuestionAnswers(text: string, questions: NonNullable<FeishuReplyRoute["questions"]>) {
  const normalized = text.trim()
  const answers = questions.map(() => [] as string[])
  const assignments = Array.from(normalized.matchAll(/([1-9]\d*)\s*[:=：]\s*(.*?)(?=\s*(?:[1-9]\d*\s*[:=：])|$)/g))
  let matched = false
  for (const assignment of assignments) {
    const questionIndex = Number(assignment[1]) - 1
    if (questionIndex < 0 || questionIndex >= questions.length) continue
    const question = questions[questionIndex]
    const selected = resolveFeishuAnswer(assignment[2].trim(), question.options, question.multiple, question.custom)
    if (selected.length === 0) continue
    answers[questionIndex] = selected
    matched = true
  }
  if (matched) return answers
  if (questions.length === 1) {
    const selected = resolveFeishuAnswer(normalized, questions[0].options, questions[0].multiple, questions[0].custom)
    if (selected.length > 0) answers[0] = selected
  }
  return answers.some((answer) => answer.length > 0) ? answers : undefined
}

function feishuTextFromParts(parts: readonly unknown[]) {
  return parts
    .filter((part): part is { type: string; text?: string } => typeof part === "object" && part !== null)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .filter(Boolean)
    .join("\n\n")
}

function nextOfficeTriggerTime(trigger: OfficeScheduleTrigger, after: number) {
  const [hours = 9, minutes = 0] = trigger.type === "interval" ? [0, 0] : trigger.time.split(":").map(Number)
  const candidate = (base: number) => {
    const date = new Date(base)
    date.setHours(hours, minutes, 0, 0)
    return date.getTime()
  }

  switch (trigger.type) {
    case "interval":
      return after + trigger.minutes * 60_000
    case "daily": {
      let next = candidate(after)
      if (next <= after) next += 24 * 60 * 60_000
      return next
    }
    case "weekly": {
      const current = ((new Date(after).getDay() + 6) % 7) + 1
      let next = candidate(after) + ((trigger.dayOfWeek - current + 7) % 7) * 24 * 60 * 60_000
      if (next <= after) next += 7 * 24 * 60 * 60_000
      return next
    }
    case "monthly": {
      const current = new Date(after)
      let next = new Date(current.getFullYear(), current.getMonth(), trigger.dayOfMonth, hours, minutes, 0, 0).getTime()
      if (next <= after) {
        next = new Date(
          current.getFullYear(),
          current.getMonth() + 1,
          trigger.dayOfMonth,
          hours,
          minutes,
          0,
          0,
        ).getTime()
      }
      return next
    }
    case "days": {
      let next = candidate(after)
      if (next <= after) next = candidate(after + trigger.everyDays * 24 * 60 * 60_000)
      return next
    }
  }
}

export function officeSeedWorkflows(now: number): OfficeWorkflow[] {
  return [
    {
      id: "sales-weekly-report",
      title: "销售周报自动化",
      scene: "office-data",
      prompt:
        "读取 {source_path} 的销售明细数据，完成清洗和汇总，生成 Excel 报表、PPT 汇报和网页看板到 {output_dir}，最后列出下周行动建议。",
      connectors: ["tencent-docs"],
      browser: { enabled: false },
      enabled: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "competitor-watch",
      title: "竞品情报巡检",
      scene: "office-knowledge",
      prompt:
        "访问 {target_urls} 中的竞品官网和公开页面，记录产品、价格、活动和内容变化，整理成资料库条目，并生成每周竞品情报报告到 {output_dir}。",
      connectors: [],
      browser: { enabled: true },
      enabled: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "batch-file-cleanup",
      title: "复杂文件批处理",
      scene: "office-data",
      prompt:
        "批量整理 {source_dir} 中的 PDF、Word、Excel 文件，抽取关键字段并生成结构化 Excel 到 {output_dir}。标准能力无法处理时，生成脚本完成兜底处理。",
      connectors: ["tencent-docs"],
      browser: { enabled: false },
      enabled: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
  ]
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<State>(
      Effect.fn("OfficePlatform.state")(function* () {
        const ctx = yield* InstanceState.context
        const file = path.join(
          ctx.worktree === "/" ? ctx.directory : ctx.worktree,
          ".novaway",
          "office",
          "platform.json",
        )
        const data = yield* Effect.promise(async () => {
          try {
            const parsed = JSON.parse(await readFile(file, "utf8")) as PlatformData
            parsed.schedules ??= []
            parsed.runs ??= []
            parsed.workflows ??= []
            parsed.artifacts ??= []
            parsed.connectorConfig ??= {}
            parsed.feishuRoutes ??= {}
            if (parsed.connectorConfig.feishuWebhookUrl) {
              process.env.FEISHU_WEBHOOK_URL = parsed.connectorConfig.feishuWebhookUrl
            }
            const feishuKeyword = parsed.connectorConfig.feishuKeyword?.trim() || "NovaWay"
            process.env.FEISHU_KEYWORD = feishuKeyword
            if (parsed.connectorConfig.feishuAppId?.trim()) {
              process.env.FEISHU_APP_ID = parsed.connectorConfig.feishuAppId.trim()
            }
            if (parsed.connectorConfig.feishuAppSecret?.trim()) {
              process.env.FEISHU_APP_SECRET = parsed.connectorConfig.feishuAppSecret.trim()
            }
            if (parsed.connectorConfig.feishuUserId?.trim()) {
              process.env.FEISHU_USER_ID = parsed.connectorConfig.feishuUserId.trim()
            }
            const tencentDocsToken = normalizeTencentDocsToken(parsed.connectorConfig.tencentDocsToken)
            if (tencentDocsToken) {
              process.env.TENCENT_DOCS_TOKEN = tencentDocsToken
            }
            for (const workflow of parsed.workflows) workflow.enabled ??= true
            if (parsed.workflows.length === 0) {
              parsed.workflows = officeSeedWorkflows(Date.now())
              await writeFile(file, JSON.stringify(parsed, null, 2), "utf8")
            }
            return parsed
          } catch {
            return {
              schedules: [],
              runs: [],
              workflows: officeSeedWorkflows(Date.now()),
              artifacts: [],
              connectorConfig: {},
              feishuRoutes: {},
            } as PlatformData
          }
        })
        return { file, data }
      }),
    )

    const sessions = yield* Session.Service
    const prompts = yield* SessionPrompt.Service
    const feishu = new FeishuReplyClient()
    const scope = yield* Scope.Scope
    let feishuRouteLoaded = false

    const persist = Effect.fn("OfficePlatform.persist")(function* () {
      const current = yield* InstanceState.get(state)
      yield* Effect.promise(async () => {
        await mkdir(path.dirname(current.file), { recursive: true })
        await writeFile(current.file, JSON.stringify(current.data, null, 2), "utf8")
      }).pipe(Effect.ignore)
    })

    const findFeishuRoute = Effect.fn("OfficePlatform.findFeishuRoute")(function* (message: NormalizedMessage) {
      const candidates = [message.replyToMessageId, message.rootId, message.messageId].filter((id): id is string =>
        Boolean(id),
      )
      for (const id of candidates) {
        const route = feishu.routes.get(id)
        if (route) return route
      }
      return undefined
    })

    const sendFeishuReply = Effect.fn("OfficePlatform.sendFeishuReply")(function* (
      message: NormalizedMessage,
      text: string,
      route?: FeishuReplyRoute,
    ) {
      const current = yield* InstanceState.get(state)
      const config = current.data.connectorConfig ?? {}
      const userId = feishu.userId ?? config.feishuUserId?.trim()
      if (!userId) return
      const replyTo = message.replyToMessageId ?? message.rootId ?? message.messageId
      const sent = yield* Effect.tryPromise(() =>
        feishu.send(userId, text, route, {
          replyTo,
          replyInThread: true,
        }),
      ).pipe(Effect.option)
      if (Option.isSome(sent) && sent.value && route) {
        current.data.feishuRoutes ??= {}
        current.data.feishuRoutes[sent.value] = route
        yield* persist()
      }
    })

    const handleFeishuMessage = Effect.fn("OfficePlatform.handleFeishuMessage")(function* (message: NormalizedMessage) {
      if (message.chatType !== "p2p") return
      console.log("[feishu] incoming", {
        messageId: message.messageId,
        replyToMessageId: message.replyToMessageId,
        rootId: message.rootId,
        senderId: message.senderId,
        content: message.content,
      })
      const current = yield* InstanceState.get(state)
      const config = current.data.connectorConfig ?? {}
      const userId = feishu.userId ?? config.feishuUserId?.trim()

      if (!userId) {
        if (!message.senderId) return
        current.data.connectorConfig = { ...config, feishuUserId: message.senderId }
        process.env.FEISHU_USER_ID = message.senderId
        feishu.setUserId(message.senderId)
        yield* persist()
        yield* sendFeishuReply(message, "已绑定 NovaWay 飞书回复。请回复我发送的 NovaWay 通知继续对应会话。")
        return
      }

      if (message.senderId !== userId) return
      const route = yield* findFeishuRoute(message)
      if (!route) {
        console.log("[feishu] no route", {
          replyToMessageId: message.replyToMessageId,
          rootId: message.rootId,
          messageId: message.messageId,
        })
        return
      }
      console.log("[feishu] matched route", route)

      const text = normalizeFeishuText(message.content)
      if (!text) {
        yield* sendFeishuReply(message, "没有读取到回复内容，请直接输入文字。", route)
        return
      }

      if (route.questionRequestID && route.questions?.length) {
        const answers = parseFeishuQuestionAnswers(text, route.questions)
        console.log("[feishu] parsed answers", answers)
        if (!answers) {
          yield* sendFeishuReply(message, "没有识别到选项，请回复例如：1=A 2=B,C。", route)
          return
        }
        GlobalBus.emit("event", {
          directory: route.directory,
          payload: {
            type: "question.feishu.replied",
            properties: {
              requestID: route.questionRequestID,
              answers,
            },
          },
        })
        console.log("[feishu] published question reply", route.questionRequestID)
        yield* sendFeishuReply(message, "已收到你的选择。", route)
        return
      }

      const sessionID = SessionID.make(route.sessionID)
      const session = yield* sessions.get(sessionID).pipe(Effect.option)
      if (Option.isNone(session)) {
        yield* sendFeishuReply(message, "对应的 NovaWay 会话不存在或已被删除。", route)
        return
      }

      const result = yield* prompts
        .prompt({
          sessionID,
          agent: session.value.agent,
          parts: [{ type: "text", text: `通过飞书回复：${text}` }],
        })
        .pipe(Effect.exit)
      if (Exit.isSuccess(result)) {
        const answer = feishuTextFromParts(result.value.parts) || "已完成，请到 NovaWay 中查看完整结果。"
        yield* sendFeishuReply(message, answer, route)
        return
      }
      const error = Cause.pretty(result.cause)
      yield* sendFeishuReply(message, `NovaWay 处理失败：${error}`, route)
    })

    const startFeishuReplyChannel = Effect.fn("OfficePlatform.startFeishuReplyChannel")(function* (
      config: OfficeConnectorConfig,
    ) {
      const appId = config.feishuAppId?.trim()
      const appSecret = config.feishuAppSecret?.trim()
      const instance = yield* InstanceRef
      const workspace = yield* WorkspaceRef
      if (!appId || !appSecret) {
        yield* Effect.tryPromise(() => feishu.stop()).pipe(Effect.ignore)
        return
      }
      yield* Effect.tryPromise(() =>
        feishu.start({
          appId,
          appSecret,
          userId: config.feishuUserId?.trim(),
          onMessage: (message) => {
            void Effect.runPromise(
              handleFeishuMessage(message).pipe(
                Effect.provideService(InstanceRef, instance),
                Effect.provideService(WorkspaceRef, workspace),
                Effect.provideService(Session.Service, sessions),
                Effect.provideService(SessionPrompt.Service, prompts),
              ),
            ).catch((error) => {
              console.error("[feishu] message handler failed", error)
            })
          },
        }),
      ).pipe(Effect.ignore)
    })

    const ensureFeishuReplyChannel = Effect.fn("OfficePlatform.ensureFeishuReplyChannel")(function* () {
      const current = yield* InstanceState.get(state)
      if (!feishuRouteLoaded) {
        for (const [messageId, route] of Object.entries(current.data.feishuRoutes ?? {})) {
          feishu.routes.set(messageId, route)
        }
        feishuRouteLoaded = true
      }
      const config = current.data.connectorConfig ?? {}
      const userId = config.feishuUserId?.trim()
      if (userId && feishu.userId !== userId) feishu.setUserId(userId)
      yield* startFeishuReplyChannel(config)
    })

    const sendFeishuMessage = Effect.fn("OfficePlatform.sendFeishuMessage")(function* (input: {
      text: string
      directory?: string
      sessionID?: string
      questionRequestID?: string
      questions?: FeishuReplyRoute["questions"]
    }) {
      yield* ensureFeishuReplyChannel()
      const current = yield* InstanceState.get(state)
      const config = current.data.connectorConfig ?? {}
      const text = input.text.trim()
      if (!text) return false
      const keyword = config.feishuKeyword?.trim() || "NovaWay"
      const bodyText = text.includes(keyword) ? text : `${keyword}：${text}`
      const userId = feishu.userId ?? config.feishuUserId?.trim()
      const route =
        input.directory && input.sessionID
          ? {
              directory: input.directory,
              sessionID: input.sessionID,
              questionRequestID: input.questionRequestID,
              questions: input.questions,
            }
          : undefined

      console.log("[feishu] send branch", {
        userId,
        started: feishu.isStarted,
        hasWebhook: Boolean(config.feishuWebhookUrl?.trim()),
        textLength: bodyText.length,
      })

      if (userId && feishu.isStarted) {
        const sent = yield* Effect.tryPromise(() => feishu.send(userId, bodyText, route)).pipe(Effect.option)
        const sentMessageId = Option.isSome(sent) ? sent.value : undefined
        console.log("[feishu] app send result", sentMessageId)
        if (sentMessageId && route) {
          current.data.feishuRoutes ??= {}
          current.data.feishuRoutes[sentMessageId] = route
          yield* persist()
        }
        return Boolean(sentMessageId)
      }

      const webhook = config.feishuWebhookUrl?.trim()
      if (!webhook) return false
      return yield* Effect.tryPromise(async () => {
        const response = await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ msg_type: "text", content: { text: bodyText } }),
        })
        console.log("[feishu] webhook send status", response.status)
        if (!response.ok) throw new Error(`Feishu webhook failed: ${response.status}`)
      }).pipe(
        Effect.match({
          onFailure: () => false,
          onSuccess: () => true,
        }),
      )
    })

    const runJob = Effect.fn("OfficePlatform.runJob")(function* (
      job: { kind: "schedule"; id: string } | { kind: "workflow"; id: string; inputValues?: Record<string, string> },
    ) {
      const current = yield* InstanceState.get(state)
      const schedule = job.kind === "schedule" ? current.data.schedules.find((item) => item.id === job.id) : undefined
      const workflow = job.kind === "workflow" ? current.data.workflows.find((item) => item.id === job.id) : undefined
      const source = schedule ?? workflow
      if (!source) return yield* Effect.succeed(undefined)
      if (job.kind === "workflow" && workflow && !workflow.enabled) return yield* Effect.succeed(undefined)
      const inputValues = schedule?.inputValues ?? (job.kind === "workflow" ? job.inputValues : undefined) ?? {}
      const prompt = substituteOfficeInputs(source.prompt, inputValues)

      const startedAt = yield* Clock.currentTimeMillis
      const run: OfficeRun = {
        id: randomUUID(),
        scheduleId: schedule?.id,
        workflowId: workflow?.id,
        inputValues,
        status: "running",
        startedAt,
        logs: ["任务已启动"],
      }
      current.data.runs.push(run)
      yield* persist()

      const currentRun = current.data.runs.find((item) => item.id === run.id)
      const agent = source.scene.startsWith("office-") ? source.scene : `office-${source.scene}`
      currentRun?.logs.push(`正在创建 ${agent} 会话`)
      const promptEffect = Effect.gen(function* () {
        const created = yield* sessions.create({ title: source.title, agent })
        currentRun?.logs.push(`会话已创建：${created.id}`)
        const message = yield* prompts.prompt({
          sessionID: created.id,
          agent,
          parts: [{ type: "text", text: prompt }],
        })
        return message.parts
          .filter((part) => part.type === "text")
          .map((part) => ("text" in part ? part.text : ""))
          .filter(Boolean)
          .join("\n")
      })
      const result = yield* promptEffect.pipe(Effect.exit)
      if (currentRun) {
        currentRun.completedAt = yield* Clock.currentTimeMillis
        if (Exit.isSuccess(result)) {
          currentRun.status = "completed"
          currentRun.output = result.value || `已触发：${source.title}`
          currentRun.logs.push("任务执行完成")
        } else {
          currentRun.status = "error"
          currentRun.error = Cause.pretty(result.cause)
          currentRun.logs.push(`任务失败：${currentRun.error}`)
          if (source.notificationUrl) {
            const isFeishu = source.notificationUrl.includes("open.feishu.cn/open-apis/bot/v2/hook/")
            const keyword = current.data.connectorConfig?.feishuKeyword?.trim() || "NovaWay"
            const body = isFeishu
              ? JSON.stringify({
                  msg_type: "text",
                  content: { text: `${keyword} 办公任务失败：${source.title}\n${currentRun.error ?? "未知错误"}` },
                })
              : JSON.stringify({
                  title: source.title,
                  status: "failed",
                  error: currentRun.error,
                })
            yield* Effect.tryPromise(async () => {
              await fetch(source.notificationUrl!, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body,
              })
            }).pipe(Effect.ignore)
          }
        }
      }
      yield* persist()
      return deepCopy(run)
    })

    const runNow = Effect.fn("OfficePlatform.runNow")(function* (id: string) {
      return yield* runJob({ kind: "schedule", id })
    })

    const runWorkflow = Effect.fn("OfficePlatform.runWorkflow")(function* (
      id: string,
      inputValues?: Record<string, string>,
    ) {
      return yield* runJob({ kind: "workflow", id, inputValues })
    })

    const tick = Effect.fn("OfficePlatform.tick")(function* () {
      const current = yield* InstanceState.get(state)
      const now = yield* Clock.currentTimeMillis
      const due = current.data.schedules.filter((item) => item.status === "active" && item.nextRunAt <= now)
      for (const schedule of due) {
        yield* runJob({ kind: "schedule", id: schedule.id }).pipe(Effect.ignore)
        schedule.nextRunAt = nextOfficeTriggerTime(schedule.trigger, now)
      }
      if (due.length > 0) yield* persist()
      yield* Effect.sleep("1 minute")
    })

    const ticker = yield* tick().pipe(Effect.forever, Effect.forkIn(scope, { startImmediately: true }))
    yield* Effect.addFinalizer(() => Fiber.interrupt(ticker))
    yield* Effect.addFinalizer(() => Effect.tryPromise(() => feishu.stop()).pipe(Effect.ignore))

    const createSchedule = Effect.fn("OfficePlatform.createSchedule")(function* (input: OfficeScheduleInput) {
      const current = yield* InstanceState.get(state)
      const now = yield* Clock.currentTimeMillis
      const schedule: OfficeSchedule = {
        id: randomUUID(),
        title: input.title,
        scene: input.scene,
        prompt: input.prompt,
        connectors: input.connectors ?? [],
        browser: {
          enabled: input.browser?.enabled ?? false,
          url: input.browser?.url,
        },
        notificationUrl: input.notificationUrl,
        trigger: input.trigger,
        inputValues: input.inputValues ?? {},
        status: "active",
        nextRunAt: nextOfficeTriggerTime(input.trigger, now),
        createdAt: now,
        updatedAt: now,
      }
      current.data.schedules.push(schedule)
      yield* persist()
      return deepCopy(schedule)
    })

    const updateSchedule = Effect.fn("OfficePlatform.updateSchedule")(function* (
      id: string,
      input: Partial<OfficeScheduleInput> & { status?: "active" | "paused" },
    ) {
      const current = yield* InstanceState.get(state)
      const schedule = current.data.schedules.find((item) => item.id === id)
      if (!schedule) return yield* Effect.succeed(undefined)
      const now = yield* Clock.currentTimeMillis
      if (input.title !== undefined) schedule.title = input.title
      if (input.scene !== undefined) schedule.scene = input.scene
      if (input.prompt !== undefined) schedule.prompt = input.prompt
      if (input.connectors !== undefined) schedule.connectors = [...input.connectors]
      if (input.browser !== undefined) {
        schedule.browser = {
          enabled: input.browser.enabled ?? schedule.browser.enabled,
          url: input.browser.url ?? schedule.browser.url,
        }
      }
      if (input.notificationUrl !== undefined) schedule.notificationUrl = input.notificationUrl
      if (input.inputValues !== undefined) schedule.inputValues = { ...input.inputValues }
      if (input.trigger !== undefined) {
        schedule.trigger = input.trigger
        schedule.nextRunAt = nextOfficeTriggerTime(schedule.trigger, now)
      }
      if (input.status !== undefined) schedule.status = input.status
      schedule.updatedAt = now
      yield* persist()
      return deepCopy(schedule)
    })

    const deleteSchedule = Effect.fn("OfficePlatform.deleteSchedule")(function* (id: string) {
      const current = yield* InstanceState.get(state)
      const before = current.data.schedules.length
      current.data.schedules = current.data.schedules.filter((item) => item.id !== id)
      const removed = current.data.schedules.length < before
      if (removed) yield* persist()
      return removed
    })

    const listSchedules = Effect.fn("OfficePlatform.listSchedules")(function* () {
      const current = yield* InstanceState.get(state)
      return deepCopy(current.data.schedules.toSorted((a, b) => a.createdAt - b.createdAt))
    })

    const listRuns = Effect.fn("OfficePlatform.listRuns")(function* () {
      const current = yield* InstanceState.get(state)
      return deepCopy(current.data.runs.toSorted((a, b) => b.startedAt - a.startedAt))
    })

    const listWorkflows = Effect.fn("OfficePlatform.listWorkflows")(function* () {
      const current = yield* InstanceState.get(state)
      return deepCopy(current.data.workflows.toSorted((a, b) => a.createdAt - b.createdAt))
    })

    const createWorkflow = Effect.fn("OfficePlatform.createWorkflow")(function* (input: OfficeWorkflowInput) {
      const current = yield* InstanceState.get(state)
      const now = yield* Clock.currentTimeMillis
      const workflow: OfficeWorkflow = {
        id: randomUUID(),
        title: input.title,
        scene: input.scene,
        prompt: input.prompt,
        connectors: input.connectors ?? [],
        browser: {
          enabled: input.browser?.enabled ?? false,
          url: input.browser?.url,
        },
        notificationUrl: input.notificationUrl,
        sourceSessionId: input.sourceSessionId,
        enabled: input.enabled ?? true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      }
      current.data.workflows.push(workflow)
      yield* persist()
      return deepCopy(workflow)
    })

    const updateWorkflow = Effect.fn("OfficePlatform.updateWorkflow")(function* (
      id: string,
      input: Partial<OfficeWorkflowInput>,
    ) {
      const current = yield* InstanceState.get(state)
      const workflow = current.data.workflows.find((item) => item.id === id)
      if (!workflow) return yield* Effect.succeed(undefined)
      const now = yield* Clock.currentTimeMillis
      if (input.title !== undefined) workflow.title = input.title
      if (input.scene !== undefined) workflow.scene = input.scene
      if (input.prompt !== undefined) workflow.prompt = input.prompt
      if (input.connectors !== undefined) workflow.connectors = [...input.connectors]
      if (input.browser !== undefined) {
        workflow.browser = {
          enabled: input.browser.enabled ?? workflow.browser.enabled,
          url: input.browser.url ?? workflow.browser.url,
        }
      }
      if (input.notificationUrl !== undefined) workflow.notificationUrl = input.notificationUrl
      if (input.sourceSessionId !== undefined) workflow.sourceSessionId = input.sourceSessionId
      if (input.enabled !== undefined) workflow.enabled = input.enabled
      workflow.version += 1
      workflow.updatedAt = now
      yield* persist()
      return deepCopy(workflow)
    })

    const deleteWorkflow = Effect.fn("OfficePlatform.deleteWorkflow")(function* (id: string) {
      const current = yield* InstanceState.get(state)
      const before = current.data.workflows.length
      current.data.workflows = current.data.workflows.filter((item) => item.id !== id)
      const removed = current.data.workflows.length < before
      if (removed) yield* persist()
      return removed
    })

    const scheduleWorkflow = Effect.fn("OfficePlatform.scheduleWorkflow")(function* (
      id: string,
      trigger: OfficeScheduleTrigger,
      notificationUrl?: string,
      browser?: OfficeSchedule["browser"],
      inputValues?: Record<string, string>,
    ) {
      const current = yield* InstanceState.get(state)
      const workflow = current.data.workflows.find((item) => item.id === id)
      if (!workflow) return yield* Effect.succeed(undefined)
      if (!workflow.enabled) return yield* Effect.succeed(undefined)
      const now = yield* Clock.currentTimeMillis
      const schedule: OfficeSchedule = {
        id: randomUUID(),
        title: workflow.title,
        scene: workflow.scene,
        prompt: workflow.prompt,
        connectors: [...workflow.connectors],
        browser: browser ?? {
          enabled: workflow.browser.enabled,
          url: workflow.browser.url,
        },
        notificationUrl: notificationUrl ?? workflow.notificationUrl,
        trigger,
        inputValues: inputValues ?? {},
        status: "active",
        nextRunAt: nextOfficeTriggerTime(trigger, now),
        createdAt: now,
        updatedAt: now,
      }
      current.data.schedules.push(schedule)
      yield* persist()
      return deepCopy(schedule)
    })

    const listArtifacts = Effect.fn("OfficePlatform.listArtifacts")(function* () {
      const current = yield* InstanceState.get(state)
      return deepCopy(current.data.artifacts.toSorted((a, b) => b.updatedAt - a.updatedAt))
    })

    const registerArtifact = Effect.fn("OfficePlatform.registerArtifact")(function* (input: {
      kind: OfficeArtifactKind
      name: string
      filename: string
      path: string
      workflowId?: string
      runId?: string
    }) {
      const current = yield* InstanceState.get(state)
      const ctx = yield* InstanceState.context
      const workspace = ctx.worktree === "/" ? ctx.directory : ctx.worktree
      const source = path.resolve(workspace, input.path)
      if (!source.startsWith(workspace)) return yield* Effect.succeed(undefined)

      const existing = current.data.artifacts
        .filter((item) => item.path === input.path)
        .sort((a, b) => a.version - b.version)
      const version = (existing.at(-1)?.version ?? 0) + 1
      const id = existing[0]?.id ?? randomUUID()
      const now = yield* Clock.currentTimeMillis
      const targetDir = path.join(workspace, ".novaway", "office", "artifacts", id, `v${version}`)
      yield* Effect.promise(async () => {
        await mkdir(targetDir, { recursive: true })
        await copyFile(source, path.join(targetDir, input.filename))
      }).pipe(Effect.ignore)

      if (existing.length > 0) {
        const artifact = existing[0]
        artifact.version = version
        artifact.updatedAt = now
        yield* persist()
        return deepCopy(artifact)
      }

      const artifact: OfficeArtifact = {
        id,
        kind: input.kind,
        name: input.name,
        filename: input.filename,
        path: input.path,
        workflowId: input.workflowId,
        runId: input.runId,
        version,
        createdAt: now,
        updatedAt: now,
      }
      current.data.artifacts.push(artifact)
      yield* persist()
      return deepCopy(artifact)
    })

    const restoreArtifact = Effect.fn("OfficePlatform.restoreArtifact")(function* (id: string, version?: number) {
      const current = yield* InstanceState.get(state)
      const artifact = current.data.artifacts.find((item) => item.id === id)
      if (!artifact) return yield* Effect.succeed(undefined)
      const ctx = yield* InstanceState.context
      const workspace = ctx.worktree === "/" ? ctx.directory : ctx.worktree
      const targetVersion = version ?? artifact.version
      const source = path.join(
        workspace,
        ".novaway",
        "office",
        "artifacts",
        artifact.id,
        `v${targetVersion}`,
        artifact.filename,
      )
      const target = path.resolve(workspace, artifact.path)
      if (!target.startsWith(workspace)) return yield* Effect.succeed(undefined)
      yield* Effect.promise(async () => {
        await mkdir(path.dirname(target), { recursive: true })
        await copyFile(source, target)
      }).pipe(Effect.ignore)
      artifact.updatedAt = yield* Clock.currentTimeMillis
      yield* persist()
      return deepCopy(artifact)
    })

    const getConnectorConfig = Effect.fn("OfficePlatform.getConnectorConfig")(function* () {
      yield* ensureFeishuReplyChannel()
      const current = yield* InstanceState.get(state)
      return deepCopy(current.data.connectorConfig ?? {})
    })

    const saveConnectorConfig = Effect.fn("OfficePlatform.saveConnectorConfig")(function* (
      input: OfficeConnectorConfig,
    ) {
      const current = yield* InstanceState.get(state)
      const existing = current.data.connectorConfig ?? {}
      const next = {
        feishuWebhookUrl:
          input.feishuWebhookUrl === undefined ? existing.feishuWebhookUrl : input.feishuWebhookUrl.trim() || undefined,
        feishuKeyword:
          input.feishuKeyword === undefined
            ? existing.feishuKeyword?.trim() || "NovaWay"
            : input.feishuKeyword.trim() || "NovaWay",
        feishuAppId: input.feishuAppId === undefined ? existing.feishuAppId : input.feishuAppId.trim() || undefined,
        feishuAppSecret:
          input.feishuAppSecret === undefined ? existing.feishuAppSecret : input.feishuAppSecret.trim() || undefined,
        feishuUserId: input.feishuUserId === undefined ? existing.feishuUserId : input.feishuUserId.trim() || undefined,
        tencentDocsToken:
          input.tencentDocsToken === undefined
            ? existing.tencentDocsToken
            : normalizeTencentDocsToken(input.tencentDocsToken) || undefined,
      }
      current.data.connectorConfig = next
      if (next.feishuWebhookUrl) process.env.FEISHU_WEBHOOK_URL = next.feishuWebhookUrl
      else delete process.env.FEISHU_WEBHOOK_URL
      process.env.FEISHU_KEYWORD = next.feishuKeyword
      if (next.feishuAppId) process.env.FEISHU_APP_ID = next.feishuAppId
      else delete process.env.FEISHU_APP_ID
      if (next.feishuAppSecret) process.env.FEISHU_APP_SECRET = next.feishuAppSecret
      else delete process.env.FEISHU_APP_SECRET
      if (next.feishuUserId) process.env.FEISHU_USER_ID = next.feishuUserId
      else delete process.env.FEISHU_USER_ID
      if (next.tencentDocsToken) process.env.TENCENT_DOCS_TOKEN = next.tencentDocsToken
      else delete process.env.TENCENT_DOCS_TOKEN
      yield* ensureFeishuReplyChannel()
      yield* persist()
      return deepCopy(next)
    })

    const status = Effect.fn("OfficePlatform.status")(function* () {
      const current = yield* InstanceState.get(state)
      const diagnostics: OfficePlatformStatus["diagnostics"] = {
        browser: "configured",
        tencentDocs: process.env.TENCENT_DOCS_TOKEN ? "configured" : "missing",
        feishu:
          process.env.FEISHU_WEBHOOK_URL || (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET)
            ? "configured"
            : "missing",
      }
      return {
        schedulerEnabled: true as const,
        scheduleCount: current.data.schedules.length,
        activeScheduleCount: current.data.schedules.filter((item) => item.status === "active").length,
        browserConfigured: true,
        diagnostics,
      }
    })

    return Service.of({
      listSchedules,
      createSchedule,
      updateSchedule,
      deleteSchedule,
      listRuns,
      runNow,
      listWorkflows,
      createWorkflow,
      updateWorkflow,
      deleteWorkflow,
      runWorkflow,
      scheduleWorkflow,
      listArtifacts,
      registerArtifact,
      restoreArtifact,
      getConnectorConfig,
      saveConnectorConfig,
      sendFeishuMessage,
      status,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Session.defaultLayer), Layer.provide(SessionPrompt.defaultLayer))

export * as OfficePlatform from "./index"
