import path from "node:path"
import { randomUUID } from "node:crypto"
import { copyFile, mkdir, readFile, writeFile } from "fs/promises"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { Cause, Clock, Context, Effect, Exit, Fiber, Layer, Scope } from "effect"

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
  tencentDocsToken?: string
}

type PlatformData = {
  schedules: OfficeSchedule[]
  runs: OfficeRun[]
  workflows: OfficeWorkflow[]
  artifacts: OfficeArtifact[]
  connectorConfig?: OfficeConnectorConfig
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
  readonly status: () => Effect.Effect<OfficePlatformStatus>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OfficePlatform") {}

function deepCopy<A>(value: A): A {
  return JSON.parse(JSON.stringify(value)) as A
}

function substituteOfficeInputs(prompt: string, values: Record<string, string>) {
  return prompt.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => values[key]?.trim() || match)
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
            if (parsed.connectorConfig.feishuWebhookUrl) {
              process.env.FEISHU_WEBHOOK_URL = parsed.connectorConfig.feishuWebhookUrl
            }
            if (parsed.connectorConfig.tencentDocsToken) {
              process.env.TENCENT_DOCS_TOKEN = parsed.connectorConfig.tencentDocsToken
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
            } as PlatformData
          }
        })
        return { file, data }
      }),
    )

    const persist = Effect.fn("OfficePlatform.persist")(function* () {
      const current = yield* InstanceState.get(state)
      yield* Effect.promise(async () => {
        await mkdir(path.dirname(current.file), { recursive: true })
        await writeFile(current.file, JSON.stringify(current.data, null, 2), "utf8")
      }).pipe(Effect.ignore)
    })

    const runJob = Effect.fn("OfficePlatform.runJob")(function* (
      job:
        | { kind: "schedule"; id: string }
        | { kind: "workflow"; id: string; inputValues?: Record<string, string> },
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
      const sessions = yield* Session.Service
      const prompts = yield* SessionPrompt.Service
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
            const body = isFeishu
              ? JSON.stringify({
                  msg_type: "text",
                  content: { text: `NovaWay 办公任务失败：${source.title}\n${currentRun.error ?? "未知错误"}` },
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

    const scope = yield* Scope.Scope
    const ticker = yield* tick().pipe(Effect.forever, Effect.forkIn(scope, { startImmediately: true }))
    yield* Effect.addFinalizer(() => Fiber.interrupt(ticker))

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
      const current = yield* InstanceState.get(state)
      return deepCopy(current.data.connectorConfig ?? {})
    })

    const saveConnectorConfig = Effect.fn("OfficePlatform.saveConnectorConfig")(function* (
      input: OfficeConnectorConfig,
    ) {
      const current = yield* InstanceState.get(state)
      const next = {
        feishuWebhookUrl: input.feishuWebhookUrl?.trim() || undefined,
        tencentDocsToken: input.tencentDocsToken?.trim() || undefined,
      }
      current.data.connectorConfig = next
      if (next.feishuWebhookUrl) process.env.FEISHU_WEBHOOK_URL = next.feishuWebhookUrl
      else delete process.env.FEISHU_WEBHOOK_URL
      if (next.tencentDocsToken) process.env.TENCENT_DOCS_TOKEN = next.tencentDocsToken
      else delete process.env.TENCENT_DOCS_TOKEN
      yield* persist()
      return deepCopy(next)
    })

    const status = Effect.fn("OfficePlatform.status")(function* () {
      const current = yield* InstanceState.get(state)
      const diagnostics: OfficePlatformStatus["diagnostics"] = {
        browser: "configured",
        tencentDocs: process.env.TENCENT_DOCS_TOKEN ? "configured" : "missing",
        feishu: process.env.FEISHU_WEBHOOK_URL ? "configured" : "missing",
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
      status,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Session.defaultLayer), Layer.provide(SessionPrompt.defaultLayer))

export * as OfficePlatform from "./index"
