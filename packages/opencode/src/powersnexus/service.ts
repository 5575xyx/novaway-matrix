import path from "node:path"
import { createHash } from "node:crypto"
import { AppProcess } from "@opencode-ai/core/process"
import { NodeFileSystem } from "@effect/platform-node"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { FileWatcher } from "@/file/watcher"
import { Session } from "@/session/session"
import { SessionRevert } from "@/session/revert"
import { Todo } from "@/session/todo"
import type { SessionID } from "@/session/schema"
import { Context, Duration, Effect, FileSystem, Layer, Schema, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { inspect as bridgeInspect, transition as bridgeTransition } from "./bridge-client"
import type { ActionRequest } from "./bridge-schema"
import { Event } from "./events"
import { make as makeRepository, type Binding, type Interface as Repository } from "./repository"
import { aggregateArtifact } from "./state"
import { PowersNexusVersion } from "./version-service"
import { ChangeName, WorkflowLevel, type WorkflowSnapshot } from "./workflow-schema"
import { reconcileTasks, taskTodos, todoRevision } from "./reconcile"
import { make as makeRunRepository } from "./run-repository"
import { powersnexusNodeExecutable } from "./node-exec"

export class WorkflowServiceError extends Schema.TaggedErrorClass<WorkflowServiceError>()(
  "PowersNexusWorkflowServiceError",
  { code: Schema.String, message: Schema.String },
) {}

type State = {
  repository: Repository
  snapshots: Map<string, WorkflowSnapshot>
}

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly list: () => Effect.Effect<Binding[], WorkflowServiceError>
  readonly create: (input: {
    changeName: string
    level: typeof WorkflowLevel.Type
  }) => Effect.Effect<Binding, WorkflowServiceError>
  readonly status: (changeName?: string) => Effect.Effect<WorkflowSnapshot | undefined, WorkflowServiceError>
  readonly inspect: (changeName: string) => Effect.Effect<WorkflowSnapshot, WorkflowServiceError>
  readonly bind: (input: {
    changeName: string
    sessionID: SessionID
    expectedRevision: number
    handoff: boolean
  }) => Effect.Effect<Binding, WorkflowServiceError>
  readonly action: (changeName: string, request: ActionRequest) => Effect.Effect<WorkflowSnapshot, WorkflowServiceError>
  readonly capsule: (sessionID: SessionID) => Effect.Effect<
    | {
        bindingID: string
        changeName: string
        phase: WorkflowSnapshot["phase"]
        taskID?: string
        revision: number
        artifactDigest: string
        nextAction?: WorkflowSnapshot["nextAction"]
        worktree: string
        powersnexusDigest: string
      }
    | undefined,
    WorkflowServiceError
  >
  readonly invalidateDelivery: (sessionID: SessionID) => Effect.Effect<WorkflowSnapshot | undefined, WorkflowServiceError>
  readonly archive: (input: {
    bindingID: string
    actionID: string
    expectedRevision: number
  }) => Effect.Effect<{ bindingID: string; archivePath: string; replayed: boolean }, WorkflowServiceError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PowersNexusWorkflow") {}

function serviceError(code: string, message: string) {
  return new WorkflowServiceError({ code, message })
}

function codeOf(cause: unknown) {
  return typeof cause === "object" && cause && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : "INTERNAL_WORKFLOW_ERROR"
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const appProcess = yield* AppProcess.Service
    const bus = yield* Bus.Service
    const versions = yield* PowersNexusVersion.Service
    const sessions = yield* Session.Service
    const todos = yield* Todo.Service
    const fs = yield* FileSystem.FileSystem

    const state = yield* InstanceState.make(
      Effect.fn("PowersNexus.Workflow.state")(function* () {
        const ctx = yield* InstanceState.context
        const repository = yield* makeRepository()
        const runRepository = yield* makeRunRepository()
        const snapshots = new Map<string, WorkflowSnapshot>()
        const changesRoot = path.join(ctx.worktree, ".novaway", "powersnexus", "changes")
        yield* Effect.forkScoped(
          bus
            .subscribe(FileWatcher.Event.Updated)
            .pipe(
              Stream.filter((event) => {
                const relative = path.relative(changesRoot, event.properties.file)
                return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
              }),
              Stream.debounce(Duration.millis(100)),
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  const relative = path.relative(changesRoot, event.properties.file)
                  const changeName = relative.split(path.sep)[0]
                  const binding = yield* repository.find({
                    projectID: ctx.project.id,
                    worktree: ctx.worktree,
                    changeName,
                  })
                  if (!binding) return
                  snapshots.delete(binding.id)
                  yield* inspectBinding(binding, ctx, snapshots, versions, appProcess, bus).pipe(
                    Effect.flatMap((snapshot) =>
                      reconcileBindingTodos(binding, snapshot, {
                        repository,
                        todos,
                        fs,
                        ctx,
                        snapshots,
                        versions,
                        appProcess,
                        bus,
                      }),
                    ),
                    Effect.catch((cause) =>
                      bus.publish(Event.Blocked, {
                        projectID: ctx.project.id,
                        worktree: ctx.worktree,
                        bindingID: binding.id,
                        revision: binding.revision,
                        timestamp: new Date().toISOString(),
                        errorCode: codeOf(cause),
                        message: cause instanceof Error ? cause.message : "重新读取 PowersNexus 工件失败",
                      }),
          ),
        )
        yield* Effect.forkScoped(
          bus.subscribe(SessionRevert.Event.Changed).pipe(
            Stream.runForEach((event) =>
              Effect.gen(function* () {
                yield* invalidateSessionDelivery(event.properties.sessionID, {
                  sessions,
                  repository,
                  runRepository,
                  fs,
                  ctx,
                  snapshots,
                  versions,
                  appProcess,
                  bus,
                })
              }).pipe(
                Effect.catch((cause) =>
                  Effect.logWarning("PowersNexus 撤销后证据失效处理失败", {
                    cause,
                    sessionID: event.properties.sessionID,
                  }),
                ),
              ),
            ),
          ),
        )
        yield* Effect.forkScoped(
          bus.subscribe(Todo.Event.Updated).pipe(
            Stream.runForEach((event) =>
              Effect.gen(function* () {
                const binding = (yield* repository.listActive(ctx.project.id, ctx.worktree)).find(
                  (item) => item.rootSessionID === event.properties.sessionID,
                )
                if (!binding) return
                const snapshot = yield* inspectBinding(binding, ctx, snapshots, versions, appProcess, bus)
                yield* reconcileBindingTodos(binding, snapshot, {
                  repository,
                  todos,
                  fs,
                  ctx,
                  snapshots,
                  versions,
                  appProcess,
                  bus,
                  currentTodos: [...event.properties.todos],
                })
              }).pipe(
                Effect.catch((cause) =>
                  Effect.logWarning("PowersNexus Todo 协调失败", {
                    cause,
                    sessionID: event.properties.sessionID,
                  }),
                ),
              ),
            ),
          ),
        )
                }),
              ),
            ),
        )
        return { repository, snapshots }
      }),
    )

    const getState = () => InstanceState.get(state)

    const list = Effect.fnUntraced(function* () {
      const ctx = yield* InstanceState.context
      const current = yield* getState()
      return yield* current.repository.listActive(ctx.project.id, ctx.worktree)
    })

    const create = Effect.fnUntraced(function* (input: { changeName: string; level: typeof WorkflowLevel.Type }) {
      const ctx = yield* InstanceState.context
      const current = yield* getState()
      const changeName = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(ChangeName)(input.changeName),
        catch: () => serviceError("CHANGE_NAME_INVALID", "changeName 格式无效"),
      })
      const version = yield* versions.select()
      const binding = yield* current.repository.create({
        projectID: ctx.project.id,
        worktree: ctx.worktree,
        changeName,
        level: input.level,
        version,
      })
      // 创建最小工件目录，使 bridge inspect 可聚合快照（否则 CHANGE_NOT_FOUND）
      const changeDir = path.join(ctx.worktree, ".novaway", "powersnexus", "changes", changeName)
      yield* fs.makeDirectory(changeDir, { recursive: true })
      const proposal = path.join(changeDir, "proposal.md")
      if (!(yield* fs.exists(proposal))) {
        yield* fs.writeFileString(
          proposal,
          [`# ${changeName}`, "", "## Intent", "", "(待补充用户需求与验收标准)", "", "## Notes", "", `- level: ${input.level}`, `- createdAt: ${new Date().toISOString()}`, ""].join("\n"),
        )
      }
      yield* bus.publish(Event.BindingChanged, {
        projectID: ctx.project.id,
        worktree: ctx.worktree,
        bindingID: binding.id,
        revision: binding.revision,
        timestamp: new Date().toISOString(),
        changeName,
      })
      return binding
    })

    const inspect = Effect.fnUntraced(function* (changeName: string) {
      const ctx = yield* InstanceState.context
      const current = yield* getState()
      const binding = yield* current.repository.find({ projectID: ctx.project.id, worktree: ctx.worktree, changeName })
      if (!binding?.active) return yield* serviceError("CHANGE_NOT_FOUND", `活动 Change 不存在：${changeName}`)
      const snapshot = yield* inspectBinding(binding, ctx, current.snapshots, versions, appProcess, bus)
      return yield* reconcileBindingTodos(binding, snapshot, {
        repository: current.repository,
        todos,
        fs,
        ctx,
        snapshots: current.snapshots,
        versions,
        appProcess,
        bus,
      })
    })

    const bind = Effect.fnUntraced(function* (input: {
      changeName: string
      sessionID: SessionID
      expectedRevision: number
      handoff: boolean
    }) {
      const ctx = yield* InstanceState.context
      const current = yield* getState()
      const binding = yield* current.repository.find({
        projectID: ctx.project.id,
        worktree: ctx.worktree,
        changeName: input.changeName,
      })
      if (!binding?.active) return yield* serviceError("CHANGE_NOT_FOUND", `活动 Change 不存在：${input.changeName}`)
      if (binding.rootSessionID && binding.rootSessionID !== input.sessionID && !input.handoff) {
        return yield* serviceError("BINDING_CONFLICT", "Change 已绑定根 Session，必须显式 handoff")
      }
      const session = yield* sessions.get(input.sessionID).pipe(
        Effect.mapError(() => serviceError("SESSION_NOT_FOUND", "目标 Session 不存在")),
      )
      if (session.projectID !== ctx.project.id || path.resolve(session.directory) !== path.resolve(ctx.worktree)) {
        return yield* serviceError("PATH_OUTSIDE_WORKTREE", "Session 与 Change 不属于同一 Project/Worktree")
      }
      if (session.parentID) return yield* serviceError("BINDING_CONFLICT", "根绑定不能指向子代理 Session")
      const updated = yield* current.repository.bindSession({
        id: binding.id,
        sessionID: input.sessionID,
        expectedRevision: input.expectedRevision,
      })
      current.snapshots.delete(binding.id)
      yield* bus.publish(Event.BindingChanged, {
        projectID: ctx.project.id,
        worktree: ctx.worktree,
        bindingID: binding.id,
        revision: updated.revision,
        timestamp: new Date().toISOString(),
        changeName: binding.changeName,
      })
      return updated
    })

    const status = Effect.fnUntraced(function* (changeName?: string) {
      if (changeName) return yield* inspect(changeName)
      const bindings = yield* list()
      const binding = bindings.sort((left, right) => right.time.updated - left.time.updated)[0]
      if (!binding) return undefined
      return yield* inspect(binding.changeName)
    })

    const action = Effect.fnUntraced(function* (changeName: string, request: ActionRequest) {
      if (request.action !== "configure_delivery" && request.action !== "verify") {
        return yield* serviceError(
          "ACTION_REQUIRES_COORDINATOR",
          `动作 ${request.action} 必须由 NovaWay Agent/Session 协调，不能直接转发给 Bridge`,
        )
      }
      const ctx = yield* InstanceState.context
      const current = yield* getState()
      const binding = yield* current.repository.find({ projectID: ctx.project.id, worktree: ctx.worktree, changeName })
      if (!binding?.active) return yield* serviceError("CHANGE_NOT_FOUND", `活动 Change 不存在：${changeName}`)
      const version = yield* resolveVersion(binding, versions)
      const result = yield* bridgeTransition({ version, worktree: ctx.worktree, changeName, request }).pipe(
        Effect.provideService(AppProcess.Service, appProcess),
      )
      current.snapshots.delete(binding.id)
      const snapshot = aggregateArtifact(result.snapshot, {
        id: binding.id,
        projectID: binding.projectID,
        projectRoot: ctx.project.worktree,
        worktree: binding.worktree,
        powersnexusDigest: binding.powersnexusDigest,
        level: binding.level,
      })
      current.snapshots.set(binding.id, snapshot)
      yield* bus.publish(Event.SnapshotChanged, snapshot)
      return snapshot
    })

    const capsule = Effect.fnUntraced(function* (sessionID: SessionID) {
      const ctx = yield* InstanceState.context
      const current = yield* getState()
      const rootSessionID = yield* findRootSessionID(sessions, yield* sessions.get(sessionID))
      const binding = (yield* current.repository.listActive(ctx.project.id, ctx.worktree)).find(
        (item) => item.rootSessionID === rootSessionID,
      )
      if (!binding) return undefined
      const snapshot = yield* inspect(binding.changeName)
      const task = snapshot.tasks.find((item) => item.status === "in_progress") ?? snapshot.tasks.find((item) => item.status === "pending")
      return {
        bindingID: binding.id,
        changeName: binding.changeName,
        phase: snapshot.phase,
        ...(task ? { taskID: task.id } : {}),
        revision: snapshot.revision,
        artifactDigest: snapshot.artifactDigest,
        ...(snapshot.nextAction ? { nextAction: snapshot.nextAction } : {}),
        worktree: binding.worktree,
        powersnexusDigest: binding.powersnexusDigest,
      }
    })

    const invalidateDelivery = Effect.fnUntraced(function* (sessionID: SessionID) {
      const ctx = yield* InstanceState.context
      const current = yield* getState()
      const runRepository = yield* makeRunRepository()
      return yield* invalidateSessionDelivery(sessionID, {
        sessions,
        repository: current.repository,
        runRepository,
        fs,
        ctx,
        snapshots: current.snapshots,
        versions,
        appProcess,
        bus,
      })
    })

    const archive = Effect.fnUntraced(function* (input: {
      bindingID: string
      actionID: string
      expectedRevision: number
    }) {
      const ctx = yield* InstanceState.context
      const current = yield* getState()
      const binding = yield* current.repository.get(input.bindingID)
      if (!binding) return yield* serviceError("CHANGE_NOT_FOUND", `binding 不存在：${input.bindingID}`)
      const requestDigest = createHash("sha256")
        .update(JSON.stringify({
          actionID: input.actionID,
          bindingID: input.bindingID,
          expectedRevision: input.expectedRevision,
        }))
        .digest("hex")
      if (binding.archive) {
        if (binding.archive.actionID !== input.actionID || binding.archive.requestDigest !== requestDigest) {
          return yield* serviceError("ARCHIVE_CONFLICT", "归档 actionID 已对应其他请求")
        }
        return { bindingID: binding.id, archivePath: binding.archive.path, replayed: true }
      }
      if (!binding.active) return yield* serviceError("ARCHIVE_CONFLICT", "binding 已停用且没有可重放的归档结果")
      const snapshot = yield* inspect(binding.changeName)
      if (snapshot.revision !== input.expectedRevision) {
        return yield* serviceError("REVISION_CONFLICT", "归档请求的工件 revision 已变化")
      }
      if (snapshot.phase !== "ready_to_archive" || !snapshot.delivery?.fingerprint) {
        return yield* serviceError("ARCHIVE_CONFLICT", "只有具备有效交付指纹的 ready_to_archive Change 可以归档")
      }
      const version = yield* resolveVersion(binding, versions)
      const result = yield* appProcess.run(
        ChildProcess.make(powersnexusNodeExecutable(), [version.cliPath, "archive", binding.changeName], {
          cwd: ctx.worktree,
          extendEnv: true,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        }),
        { timeout: Duration.minutes(5), maxOutputBytes: 8 * 1024 * 1024, maxErrorBytes: 1024 * 1024 },
      )
      if (result.exitCode !== 0 || result.stdoutTruncated || result.stderrTruncated) {
        return yield* serviceError("ARCHIVE_CONFLICT", "PowersNexus 本地归档未完成，请检查交付与合并门槛")
      }
      const archivePath = path.join(
        ctx.worktree,
        ".novaway",
        "powersnexus",
        "changes",
        "archive",
        `${new Date().toISOString().slice(0, 10)}-${binding.changeName}`,
      )
      if (!(yield* fs.exists(archivePath))) return yield* serviceError("ARCHIVE_CONFLICT", "归档命令成功但归档路径不存在")
      yield* current.repository.markArchived({
        id: binding.id,
        actionID: input.actionID,
        requestDigest,
        path: archivePath,
      })
      current.snapshots.delete(binding.id)
      yield* bus.publish(Event.Archived, {
        bindingID: binding.id,
        changeName: binding.changeName,
        archivePath,
        timestamp: new Date().toISOString(),
      })
      return { bindingID: binding.id, archivePath, replayed: false }
    })

    const wrap = <A, E, R>(effect: Effect.Effect<A, E, R>, message: string) =>
      effect.pipe(
        Effect.mapError((cause) =>
          cause instanceof WorkflowServiceError
            ? cause
            : serviceError(codeOf(cause), cause instanceof Error ? cause.message : message),
        ),
      )

    return Service.of({
      init: () => getState().pipe(Effect.asVoid, Effect.orDie),
      list: () => wrap(list(), "列出 PowersNexus Change 失败"),
      create: (input) => wrap(create(input), "创建 PowersNexus Change 绑定失败"),
      status: (changeName) => wrap(status(changeName), "读取 PowersNexus 工作流状态失败"),
      inspect: (changeName) => wrap(inspect(changeName), "读取 PowersNexus 工件失败"),
      bind: (input) => wrap(bind(input), "绑定 PowersNexus 根 Session 失败"),
      action: (changeName, request) => wrap(action(changeName, request), "执行 PowersNexus 动作失败"),
      capsule: (sessionID) => wrap(capsule(sessionID), "生成 PowersNexus Workflow Capsule 失败"),
      invalidateDelivery: (sessionID) => wrap(invalidateDelivery(sessionID), "使 PowersNexus 交付证据失效失败"),
      archive: (input) => wrap(archive(input), "归档 PowersNexus Change 失败"),
    })
  }),
)

function resolveVersion(binding: Binding, versions: PowersNexusVersion.Interface) {
  return Effect.gen(function* () {
    const status = yield* versions.status()
    const version = status.installed.find((item) => item.digest === binding.powersnexusDigest)
    if (!version?.verified || !version.compatible) {
      return yield* serviceError("POWERSNEXUS_NOT_AVAILABLE", "binding 固定的 PowersNexus 版本已丢失或不兼容")
    }
    return version
  })
}

function inspectBinding(
  binding: Binding,
  ctx: { project: { id: string; worktree: string }; worktree: string },
  snapshots: Map<string, WorkflowSnapshot>,
  versions: PowersNexusVersion.Interface,
  appProcess: AppProcess.Interface,
  bus: Bus.Interface,
) {
  return Effect.gen(function* () {
    const cached = snapshots.get(binding.id)
    if (cached) return cached
    const version = yield* resolveVersion(binding, versions)
    const artifact = yield* bridgeInspect({
      version,
      worktree: ctx.worktree,
      changeName: binding.changeName,
    }).pipe(Effect.provideService(AppProcess.Service, appProcess))
    const snapshot = aggregateArtifact(artifact, {
      id: binding.id,
      projectID: binding.projectID,
      projectRoot: ctx.project.worktree,
      worktree: binding.worktree,
      powersnexusDigest: binding.powersnexusDigest,
      level: binding.level,
    })
    snapshots.set(binding.id, snapshot)
    yield* bus.publish(Event.SnapshotChanged, snapshot)
    return snapshot
  })
}

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide(Bus.layer),
  Layer.provide(AppProcess.defaultLayer),
  Layer.provide(PowersNexusVersion.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(Todo.defaultLayer),
  Layer.provide(NodeFileSystem.layer),
)

function reconcileBindingTodos(
  binding: Binding,
  snapshot: WorkflowSnapshot,
  input: {
    repository: Repository
    todos: Todo.Interface
    fs: FileSystem.FileSystem
    ctx: { project: { id: Binding["projectID"]; worktree: string }; worktree: string }
    snapshots: Map<string, WorkflowSnapshot>
    versions: PowersNexusVersion.Interface
    appProcess: AppProcess.Interface
    bus: Bus.Interface
    currentTodos?: Todo.Info[]
  },
) {
  return Effect.gen(function* () {
    if (!binding.rootSessionID) return snapshot
    const currentBinding = (yield* input.repository.get(binding.id)) ?? binding
    const sessionTodos = input.currentTodos ?? (yield* input.todos.get(binding.rootSessionID))
    const sessionRevision = todoRevision(sessionTodos)
    const result = reconcileTasks({
      tasks: snapshot.tasks,
      todos: sessionTodos,
      state: currentBinding.todoState,
      artifactRevision: snapshot.revision,
      sessionRevision,
    })
    if (result.type === "conflict") {
      return yield* serviceError("TASK_STATE_CONFLICT", `Todo 与工件同时修改：${result.taskIDs.join(", ")}`)
    }
    if (result.type === "unchanged") {
      yield* input.repository.updateTodoState({ id: binding.id, ...result.state })
      return snapshot
    }
    if (result.type === "update-session") {
      const nextSessionRevision = todoRevision(result.todos)
      yield* input.repository.updateTodoState({
        id: binding.id,
        artifactRevision: snapshot.revision,
        sessionRevision: nextSessionRevision,
        origin: "artifact",
      })
      yield* input.todos.update({ sessionID: binding.rootSessionID, todos: result.todos })
      return snapshot
    }
    if (result.tasks.some((task) => task.status !== "pending" && task.status !== "completed")) {
      return yield* serviceError("TASK_STATE_CONFLICT", "tasks.md 仅支持 pending/completed，无法无损写回当前 Todo 状态")
    }
    const tasksFile = path.join(input.ctx.worktree, ".novaway", "powersnexus", "changes", binding.changeName, "tasks.md")
    const content = yield* input.fs.readFileString(tasksFile)
    const statuses = new Map(result.tasks.map((task) => [task.id, task.status]))
    const next = content
      .split(/(\r?\n)/)
      .map((line) => {
        const match = /^([ \t]*- \[)[ xX](\]\s+\[([A-Za-z0-9._-]+)\])/.exec(line)
        const status = match ? statuses.get(match[3]) : undefined
        if (!match || !status) return line
        return `${match[1]}${status === "completed" ? "x" : " "}${line.slice(match[1].length + 1)}`
      })
      .join("")
    yield* input.fs.writeFileString(tasksFile, next)
    input.snapshots.delete(binding.id)
    const refreshed = yield* inspectBinding(
      currentBinding,
      input.ctx,
      input.snapshots,
      input.versions,
      input.appProcess,
      input.bus,
    )
    yield* input.repository.updateTodoState({
      id: binding.id,
      artifactRevision: refreshed.revision,
      sessionRevision,
      origin: "session",
    })
    return refreshed
  })
}

export * as PowersNexusWorkflow from "./service"

function findRootSessionID(sessions: Session.Interface, session: Session.Info): Effect.Effect<SessionID> {
  if (!session.parentID) return Effect.succeed(session.id)
  return sessions
    .get(session.parentID)
    .pipe(Effect.orDie, Effect.flatMap((parent) => findRootSessionID(sessions, parent)))
}

function invalidateDeliveryEvidence(fs: FileSystem.FileSystem, worktree: string, changeName: string) {
  return Effect.gen(function* () {
    const file = path.join(worktree, ".novaway", "powersnexus", "changes", changeName, "delivery.json")
    if (!(yield* fs.exists(file))) return
    const content = yield* fs.readFileString(file)
    const delivery = yield* Effect.try({
      try: () => JSON.parse(content) as Record<string, unknown>,
      catch: () => serviceError("ARTIFACT_INVALID", "delivery.json 无法解析，不能使旧交付证据失效"),
    })
    delete delivery.verifiedAt
    delete delivery.deliveryFingerprint
    if (Array.isArray(delivery.steps)) {
      delivery.steps = delivery.steps.map((value) => {
        if (!value || typeof value !== "object") return value
        const step: Record<string, unknown> = { ...(value as Record<string, unknown>), status: "pending" }
        delete step.exitCode
        delete step.executedAt
        delete step.evidence
        return step
      })
    }
    yield* fs.writeFileString(file, `${JSON.stringify(delivery, null, 2)}\n`)
  })
}

function invalidateSessionDelivery(
  sessionID: SessionID,
  input: {
    sessions: Session.Interface
    repository: Repository
    runRepository: Effect.Success<ReturnType<typeof makeRunRepository>>
    fs: FileSystem.FileSystem
    ctx: { project: { id: Binding["projectID"]; worktree: string }; worktree: string }
    snapshots: Map<string, WorkflowSnapshot>
    versions: PowersNexusVersion.Interface
    appProcess: AppProcess.Interface
    bus: Bus.Interface
  },
) {
  return Effect.gen(function* () {
    const rootSessionID = yield* findRootSessionID(input.sessions, yield* input.sessions.get(sessionID))
    const binding = (yield* input.repository.listActive(input.ctx.project.id, input.ctx.worktree)).find(
      (item) => item.rootSessionID === rootSessionID,
    )
    if (!binding) return undefined
    yield* input.runRepository.invalidateFingerprints(binding.id)
    yield* invalidateDeliveryEvidence(input.fs, input.ctx.worktree, binding.changeName)
    input.snapshots.delete(binding.id)
    return yield* inspectBinding(
      binding,
      input.ctx,
      input.snapshots,
      input.versions,
      input.appProcess,
      input.bus,
    )
  })
}
