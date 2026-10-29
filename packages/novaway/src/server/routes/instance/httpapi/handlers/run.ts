import { Effect, Scope } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { Service as RunService, isTerminal, type TeamRun } from "@/team/run"
import { Service as VerificationService, type Acceptance } from "@/team/verification"
import {
  Service as OrchestratorService,
  type DispatchInput,
  type Report,
  type VerificationResult,
  type VerifyInput,
} from "@/team/orchestrator"
import { TeamVerifier } from "@/team/verifier"
import { makeRunAgent, type RunAgentPromptOps } from "@/session/agent-step"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { SessionID } from "@/session/schema"
import { Service as TeamService } from "@/team/team"
import { Service as TeamOpLogService } from "@/team/op-log"
import { Snapshot } from "@/snapshot"

const toRun = (run: TeamRun) => ({
  id: run.id,
  sessionID: run.sessionID,
  directory: run.directory,
  mode: run.mode,
  goal: run.goal,
  state: run.state,
  phase: run.phase,
  planVersion: run.planVersion,
  roundMain: run.roundMain,
  budget: run.budget,
  attempts: run.attempts,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
  error: run.error,
  terminalReason: run.terminalReason,
})

/** 从模型输出里取出第一个 JSON 对象；取不到就当作「未验证」，绝不默认通过。 */
const parseJSON = TeamVerifier.parseJSON

export const runHandlers = HttpApiBuilder.group(InstanceHttpApi, "run", (handlers) =>
  Effect.gen(function* () {
    const runs = yield* RunService
    const verification = yield* VerificationService
    const orchestrator = yield* OrchestratorService
    const promptSvc = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const teams = yield* TeamService
    const snapshot = yield* Snapshot.Service
    const scope = yield* Scope.Scope

    const detail = (runID: string) =>
      Effect.gen(function* () {
        const run = yield* runs.get(runID)
        if (!run) return undefined
        const [teams, acceptances, verifications] = yield* Effect.all([
          runs.teams(runID),
          verification.list(runID),
          verification.verifications(runID),
        ])
        const summary = yield* verification.summary({ runID })
        return {
          run: toRun(run),
          teams: teams.map((team) => ({
            id: team.id,
            profileID: team.profileID,
            phase: team.phase,
            roundCaptain: team.roundCaptain,
            verdict: team.verdict,
            dependsOn: team.dependsOn ?? [],
          })),
          acceptances: acceptances.map((acceptance) => ({
            id: acceptance.id,
            taskID: acceptance.taskID,
            specID: acceptance.specID,
            version: acceptance.version,
            text: acceptance.text,
            kind: acceptance.kind,
            expected: acceptance.expected,
            owner: acceptance.owner,
          })),
          verifications: verifications.map((item) => ({
            id: item.id,
            acceptanceID: item.acceptanceID,
            attempt: item.attempt,
            snapshotID: item.snapshotID,
            verifierVersion: item.verifierVersion,
            outcome: item.outcome,
            measured: item.measured,
            evidenceRef: item.evidenceRef,
            at: item.at,
          })),
          summary: {
            pass: summary.pass,
            fail: summary.fail,
            unverified: summary.unverified,
            stale: summary.stale,
            unresolved: summary.unresolved,
            ratio: summary.ratio,
            deliverable: summary.deliverable,
            verdict: summary.verdict,
            lines: summary.lines.map((line) => ({
              acceptanceID: line.acceptance.id,
              text: line.acceptance.text,
              outcome: line.outcome,
              measured: line.verification?.measured,
              snapshotID: line.verification?.snapshotID,
            })),
          },
        }
      })

    const requireRun = (runID: string) =>
      Effect.gen(function* () {
        const run = yield* runs.get(runID)
        if (!run) return yield* Effect.fail(new HttpApiError.NotFound({}))
        return run
      })

    return handlers
      .handle("listRuns", () =>
        Effect.gen(function* () {
          const all = yield* runs.list()
          return all.map(toRun)
        }),
      )
      .handle("createRun", (ctx) =>
        Effect.gen(function* () {
          const run = yield* runs.create({
            sessionID: SessionID.make(ctx.payload.sessionID),
            directory: ctx.payload.directory,
            mode: ctx.payload.mode,
            goal: ctx.payload.goal,
            brief: ctx.payload.brief as Record<string, unknown> | undefined,
            acceptance: ctx.payload.acceptance as unknown[] | undefined,
            budget: ctx.payload.budget,
          })
          for (const line of (ctx.payload.acceptance ?? []) as Array<Record<string, unknown>>) {
            if (typeof line?.text !== "string") continue
            yield* verification.register({
              runID: run.id,
              specID: typeof line.specID === "string" ? line.specID : run.id,
              text: line.text,
              kind: (typeof line.kind === "string" ? line.kind : "rubric") as Acceptance["kind"],
              expected: typeof line.expected === "string" ? line.expected : undefined,
              owner: typeof line.owner === "string" ? line.owner : undefined,
            })
          }
          return (yield* detail(run.id))!
        }),
      )
      .handle("runDetail", (ctx) =>
        Effect.gen(function* () {
          const found = yield* detail(ctx.params.runID)
          if (!found) return yield* Effect.fail(new HttpApiError.NotFound({}))
          return found
        }),
      )
      .handle("setRunPlan", (ctx) =>
        Effect.gen(function* () {
          const run = yield* requireRun(ctx.params.runID)
          // 计划变了，版本号必须变：旧批准自动失效。
          const nextVersion = run.planVersion + 1
          yield* runs.update({
            runID: run.id,
            plan: { teams: ctx.payload.teams, notes: ctx.payload.notes },
            planVersion: nextVersion,
            state: run.state === "planning" ? "awaiting_approval" : run.state,
          })
          // 计划里的团队逐个落库，依赖用下标表达。
          const existing = yield* runs.teams(run.id)
          if (existing.length === 0) {
            for (const team of ctx.payload.teams) {
              yield* runs.addTeam({
                runID: run.id,
                profileID: team.profileID,
                profileVersion: team.profileVersion,
                dependsOn: team.dependsOn ? [...team.dependsOn] : [],
              })
            }
          }
          yield* runs.appendEvent({
            runID: run.id,
            kind: "plan.updated",
            payload: { planVersion: nextVersion, teams: ctx.payload.teams.length },
          })
          return (yield* detail(run.id))!
        }),
      )
      .handle("addRunAcceptance", (ctx) =>
        Effect.gen(function* () {
          yield* requireRun(ctx.params.runID)
          const acceptance = yield* verification.register({
            runID: ctx.params.runID,
            taskID: ctx.payload.taskID,
            specID: ctx.payload.specID,
            text: ctx.payload.text,
            kind: ctx.payload.kind,
            expected: ctx.payload.expected,
            owner: ctx.payload.owner,
          })
          return {
            id: acceptance.id,
            taskID: acceptance.taskID,
            specID: acceptance.specID,
            version: acceptance.version,
            text: acceptance.text,
            kind: acceptance.kind,
            expected: acceptance.expected,
            owner: acceptance.owner,
          }
        }),
      )
      .handle("approveRun", (ctx) =>
        Effect.gen(function* () {
          yield* requireRun(ctx.params.runID)
          const approved = yield* runs.approve({
            runID: ctx.params.runID,
            planVersion: ctx.payload.planVersion,
            budget: ctx.payload.budget,
            by: ctx.payload.by ?? "user",
          })
          if (approved === "stale-plan") return yield* Effect.fail(new HttpApiError.Conflict({}))
          if (!approved) return yield* Effect.fail(new HttpApiError.NotFound({}))
          return (yield* detail(ctx.params.runID))!
        }),
      )
      .handle("executeRun", (ctx) =>
        Effect.gen(function* () {
          const run = yield* requireRun(ctx.params.runID)
          if (run.state === "awaiting_approval") return yield* Effect.fail(new HttpApiError.BadRequest({}))

          // 默认模型与会话里的 assistant 一致，避免团队用另一个模型产出无法解释的结果。
          const msgs = yield* sessions
            .messages({ sessionID: run.sessionID })
            .pipe(Effect.catchCause(() => Effect.succeed([])))
          const lastAssistant = [...msgs].reverse().find((item) => item.info.role === "assistant")
          const defaultModel =
            lastAssistant && lastAssistant.info.role === "assistant"
              ? { providerID: lastAssistant.info.providerID, modelID: lastAssistant.info.modelID }
              : yield* provider.defaultModel()
          const defaultAgent = yield* agents.defaultAgent()

          const ops: RunAgentPromptOps = {
            resolvePromptParts: (template) => promptSvc.resolvePromptParts(template),
            prompt: (input) => promptSvc.prompt(input).pipe(Effect.orDie),
          }
          const opLog = yield* TeamOpLogService
          const runAgent = makeRunAgent({
            ops,
            sessions,
            agents,
            parentSessionID: run.sessionID,
            defaultModel,
            defaultAgent,
            teams,
            // 子会话一创建就登记编排坐标；之后它跑的任何有副作用工具都会带幂等键。
            onSession: ({ sessionID, scope }) => (scope ? opLog.scope({ sessionID, ...scope }) : Effect.void),
          })

          const captain = ctx.payload.captain ?? defaultAgent
          const verifier = ctx.payload.verifier ?? captain
          const snapshotOf = snapshot.track().pipe(Effect.catch(() => Effect.succeed(undefined)))

          // 队长派发：任务 + 验收 + 上一轮打回意见，要求结构化回报。
          const dispatch = (input: DispatchInput) =>
            Effect.gen(function* () {
              const lines = input.acceptance.map(
                (acceptance) =>
                  "- [" +
                  acceptance.id +
                  "] " +
                  acceptance.text +
                  (acceptance.expected ? "（预期：" + acceptance.expected + "）" : ""),
              )
              const feedback = input.feedback?.length
                ? ["\n上一轮未达标的部分：", ...input.feedback.map((item) => "- " + item)]
                : []
              const text = yield* runAgent({
                agent: captain,
                title: "队长 · 第 " + input.round + " 轮",
                scope: { runID: run.id, taskID: input.team.id, attempt: input.round },
                prompt: [
                  "你是一个团队的队长，负责把下面的任务分派给成员、自己判定是否可以交付。",
                  "",
                  "【总目标】" + run.goal,
                  "【本次验收】",
                  ...(lines.length ? lines : ["- （未声明验收，按目标自检）"]),
                  ...feedback,
                  "",
                  "不要修改验收标准。完成后只输出一个 JSON 对象：",
                  '{"summary":"一句话交付说明","claims":[{"acceptanceID":"...","text":"...","evidence":"可复核的证据（命令/路径/输出片段）"}],"artifacts":[{"name":"...","version":1}],"done":true}',
                ].join("\n"),
              })
              const parsed = parseJSON(text)
              const claims = Array.isArray(parsed?.claims)
                ? (parsed!.claims as Array<Record<string, unknown>>).map((claim) => ({
                    acceptanceID: typeof claim.acceptanceID === "string" ? claim.acceptanceID : undefined,
                    text: typeof claim.text === "string" ? claim.text : "",
                    evidence: typeof claim.evidence === "string" ? claim.evidence : undefined,
                  }))
                : []
              return {
                teamID: input.team.id,
                summary: typeof parsed?.summary === "string" ? parsed.summary : text.slice(0, 500),
                claims,
                artifacts: Array.isArray(parsed?.artifacts)
                  ? (parsed!.artifacts as Array<Record<string, unknown>>).map((artifact, index) => ({
                      name: typeof artifact.name === "string" ? artifact.name : "artifact-" + index,
                      version: typeof artifact.version === "number" ? artifact.version : 1,
                      hash: typeof artifact.hash === "string" ? artifact.hash : undefined,
                    }))
                  : [],
                done: parsed?.done === true,
              } satisfies Report
            })

          // 验证：必须是**另一个会话**的独立判断，且允许回答「未验证」。
          const verify = (input: VerifyInput) =>
            Effect.gen(function* () {
              const snapshotID = (yield* snapshotOf) ?? "unknown"
              const text = yield* runAgent({
                agent: verifier,
                title: "验证 · " + input.acceptance.id,
                scope: { runID: run.id, taskID: input.acceptance.id, attempt: input.round },
                prompt: TeamVerifier.prompt(input.acceptance, input.report),
              })
              // 没有证据的 pass 在这里被降级为 unverified（见 TeamVerifier.interpret）。
              return {
                ...TeamVerifier.interpret(text),
                snapshotID,
              } satisfies VerificationResult
            })

          // 后台执行：UI 轮询 run detail；取消走 cancel 接口。
          yield* orchestrator
            .execute({
              runID: run.id,
              dispatch,
              verify,
              snapshot: () =>
                snapshot.track().pipe(
                  Effect.catch(() => Effect.succeed("unknown")),
                  Effect.map((id) => id ?? "unknown"),
                ),
              maxRounds: ctx.payload.maxRounds,
              maxBusinessAttempts: ctx.payload.maxBusinessAttempts,
              reserveTokens: ctx.payload.reserveTokens,
              concurrency: ctx.payload.concurrency,
            })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logError("team run failed").pipe(Effect.annotateLogs({ runID: run.id, cause })),
              ),
              Effect.forkIn(scope, { startImmediately: true }),
            )

          const current = yield* runs.get(run.id)
          return toRun(current ?? run)
        }),
      )
      .handle("cancelRun", (ctx) =>
        Effect.gen(function* () {
          const run = yield* requireRun(ctx.params.runID)
          if (!isTerminal(run.state)) {
            // 三段式：先请求停止，再把已发生的影响写进事件，最后才置 cancelled。
            yield* runs.appendEvent({ runID: run.id, kind: "cancel.requested" })
            const usage = yield* runs.get(run.id)
            yield* runs.appendEvent({
              runID: run.id,
              kind: "cancel.settled",
              payload: { usage: usage?.usage ?? {}, round: run.roundMain },
            })
            yield* runs.update({
              runID: run.id,
              state: "cancelled",
              phase: null,
              endedAt: Date.now(),
              terminalReason: "user-cancelled",
            })
          }
          return (yield* detail(run.id))!
        }),
      )
      .handle("runEvents", (ctx) =>
        Effect.gen(function* () {
          const events = yield* runs.events({ runID: ctx.params.runID })
          return events.map((event) => ({
            seq: event.seq,
            at: event.at,
            kind: event.kind,
            payload: event.payload,
          }))
        }),
      )
  }),
)
