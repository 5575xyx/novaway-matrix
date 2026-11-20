import { Effect } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { InstanceRef } from "@/effect/instance-ref"
import { ensureSuperAgentHost } from "@/super-agent/host-service"
import { SuperAgentStore } from "@/super-agent"
import { bindExecutableSuperAgentContributions } from "@/super-agent/plugin-contributions"
import { createNativeToolExecutorEffect } from "@/super-agent/native-executor"
import { SuperAgentVerificationCoordinator } from "@/super-agent/verification-coordinator"
import { VerifierRegistry, builtinArtifactVerifier, builtinTestVerifier } from "@/super-agent/verification"
import { SuperAgentRecoveryCoordinator } from "@/super-agent/recovery"
import { RepairStrategyRegistry, SuperAgentRepairCoordinator, builtinRepairStrategy } from "@/super-agent/repair"
import { SuperAgentDelegationCoordinator } from "@/super-agent/delegation"
import { TaskScheduler } from "@/super-agent/scheduler"
import { Service as ToolRegistry } from "@/tool/registry"
import { Provider } from "@/provider/provider"
import * as Session from "@/session/session"
import { startSuperAgentRun } from "@/super-agent/launcher"
import { Permission } from "@/permission"
import { PluginRuntimeService } from "@/plugin/runtime/service"
import type { SessionID, MessageID } from "@/session/schema"
import type { Goal, StoredSuperAgentRun, SuperAgentRunStatus, TaskGraph, AgentInstruction } from "@/super-agent"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { notFound } from "../errors"

const view = (run: any) => ({
  ...run,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
})

export const superAgentHandlers = HttpApiBuilder.group(InstanceHttpApi, "super-agent", (handlers) =>
  Effect.gen(function* () {
    const store = yield* SuperAgentStore
    const toolRegistry = yield* ToolRegistry
    const provider = yield* Provider.Service
    const sessions = yield* Session.Service
    const permission = yield* Permission.Service
    const ensureHost = Effect.gen(function* () {
      const instance = yield* InstanceRef
      if (instance)
        ensureSuperAgentHost(instance, store, {
          execution: {
            registry: toolRegistry,
            permission,
            recover: (runID) => Effect.runPromise(startSuperAgentRun({ store, sessions, provider, toolRegistry }, runID)),
          },
        })
    })
    const find = (runID: string) =>
      Effect.gen(function* () {
        yield* ensureHost
        return yield* store.get(runID)
      })
    const executableContributions = Effect.gen(function* () {
      const pluginRuntime = yield* PluginRuntimeService.Service
      const pluginHost = yield* pluginRuntime.get
      return bindExecutableSuperAgentContributions(pluginHost.registries.superAgent)
    })
    const move = (run: StoredSuperAgentRun, status: SuperAgentRunStatus) =>
      Effect.gen(function* () {
        const persisted = yield* store.transitionWithEvent(run.id, status, {
          type: "run_status_changed",
          at: Date.now(),
          payload: { from: run.status, to: status },
        })
        if (!persisted) return yield* notFound(`没有 Super-Agent run ${run.id}`)
        return persisted.run
      })

    return handlers
      .handle("createSuperAgentRun", (ctx) =>
        Effect.gen(function* () {
          yield* ensureHost
          const directory = yield* InstanceState.directory
          const raw = ctx.payload.goal
          const goal: Goal = {
            text: raw.text,
            constraints: raw.constraints ?? [],
            acceptanceCriteria: (raw.acceptanceCriteria ?? []).map((criterion) => ({
              id: criterion.id,
              text: criterion.text,
              required: criterion.required ?? true,
            })),
            ...(raw.plan
              ? {
                  plan: raw.plan.map((task) => ({
                    id: task.id,
                    kind: task.kind,
                    title: task.title,
                    objective: task.objective,
                    ...(task.dependencies ? { dependencies: [...task.dependencies] } : {}),
                    ...(task.input === undefined ? {} : { input: task.input }),
                    ...(task.acceptanceCriteria
                      ? {
                          acceptanceCriteria: task.acceptanceCriteria.map((criterion) => ({
                            id: criterion.id,
                            text: criterion.text,
                            required: criterion.required ?? true,
                          })),
                        }
                      : {}),
                    ...(task.retryPolicy ? { retryPolicy: task.retryPolicy } : {}),
                  })),
                }
              : {}),
            ...(raw.planningMode ? { planningMode: raw.planningMode } : {}),
            requestedBy: raw.requestedBy ?? "user",
            source: raw.source ?? "user",
            ...(raw.goalId ? { goalId: raw.goalId } : {}),
            ...(raw.sessionId ? { sessionId: raw.sessionId } : {}),
          }
          const run = yield* store.create({
            id: `sa_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            directory,
            goal,
            budget: ctx.payload.budget,
          })
          yield* store.appendEvent({
            runID: run.id,
            type: "run_created",
            at: Date.now(),
            payload: { status: run.status },
          })
          return view(run)
        }),
      )
      .handle("listSuperAgentRuns", () =>
        Effect.gen(function* () {
          yield* ensureHost
          const directory = yield* InstanceState.directory
          return yield* store.list(directory).pipe(Effect.map((runs) => runs.map(view)))
        }),
      )
      .handle("startSuperAgentRun", (ctx) =>
        Effect.gen(function* () {
          const started = yield* startSuperAgentRun(
            { store, sessions, provider, toolRegistry },
            ctx.params.runID,
          )
          if (!started) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          return view(started)
        }),
      )
      .handle("pauseSuperAgentRun", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          const checkpoint = yield* store.checkpoint(run.id, ctx.payload.reason ?? "user pause")
          if (!checkpoint) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          yield* store.appendEvent({
            runID: run.id,
            type: "checkpoint_created",
            at: checkpoint.createdAt,
            payload: { checkpointID: checkpoint.id, reason: checkpoint.reason },
          })
          return view(yield* move({ ...run, checkpointID: checkpoint.id }, "paused"))
        }),
      )
      .handle("resumeSuperAgentRun", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          return view(yield* move(run, "running"))
        }),
      )
      .handle("cancelSuperAgentRun", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          let next = run
          if (next.status === "running") next = yield* move(next, "cancelling")
          if (next.status === "cancelling") next = yield* move(next, "cancelled")
          else if (next.status !== "cancelled") next = yield* move(next, "cancelled")
          return view(next)
        }),
      )
      .handle("getSuperAgentGraph", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          return run.graph
        }),
      )
      .handle("updateSuperAgentGraph", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          const updated = yield* store.updateGraph(
            ctx.params.runID,
            ctx.payload.graph as TaskGraph,
            ctx.payload.expectedVersion,
          )
          if (!updated) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          yield* store.appendEvent({
            runID: updated.id,
            type: "plan_created",
            at: updated.updatedAt,
            payload: { graphID: updated.graph.id, version: updated.graph.version },
          })
          return view(updated.graph)
        }),
      )
      .handle("approveSuperAgentRequest", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          const request = (yield* store.approvals(run.id)).find((item) => item.id === ctx.payload.requestID)
          if (!request) return yield* notFound(`没有 approval request ${ctx.payload.requestID}`)
          const decided = yield* store.decideApproval(
            request.id,
            ctx.payload.status,
            ctx.payload.decidedBy,
            ctx.payload.reason,
          )
          if (ctx.payload.status === "approved" && run.status === "waiting_approval") yield* move(run, "running")
          yield* store.appendEvent({
            runID: run.id,
            type: "approval_resolved",
            at: Date.now(),
            payload: { requestID: request.id, status: ctx.payload.status },
          })
          return decided
        }),
      )
      .handle("answerSuperAgentInput", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          const request = (yield* store.inputs(run.id)).find((item) => item.id === ctx.payload.requestID)
          if (!request) return yield* notFound(`没有 input request ${ctx.payload.requestID}`)
          const answered = yield* store.answerInput(request.id, ctx.payload.answer)
          if (run.status === "waiting_input") yield* move(run, "running")
          yield* store.appendEvent({
            runID: run.id,
            type: "input_received",
            at: Date.now(),
            payload: { requestID: request.id },
          })
          return answered
        }),
      )
      .handle("listSuperAgentApprovals", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          return yield* store.approvals(run.id)
        }),
      )
      .handle("createSuperAgentApproval", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          const task = run.graph.nodes.find((item) => item.id === ctx.payload.taskID)
          if (!task) return yield* notFound(`没有 Super-Agent task ${ctx.payload.taskID}`)
          const approval = yield* store.createApproval({
            ...ctx.payload,
            runID: run.id,
            status: "pending",
          })
          yield* store.appendEvent({
            runID: run.id,
            type: "approval_requested",
            at: approval.createdAt,
            payload: { requestID: approval.id, taskID: approval.taskID, scope: approval.scope },
          })
          return approval
        }),
      )
      .handle("listSuperAgentInputs", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          return yield* store.inputs(run.id)
        }),
      )
      .handle("recordSuperAgentEvidence", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          const evidence = yield* store.evidence({ ...ctx.payload, runID: run.id, capturedAt: Date.now() })
          yield* store.appendEvent({
            runID: run.id,
            type: "evidence_recorded",
            at: evidence.capturedAt,
            payload: { evidenceID: evidence.id, kind: evidence.kind },
          })
          return evidence
        }),
      )
      .handle("listSuperAgentEvidence", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          return yield* store.evidences(run.id)
        }),
      )
      .handle("listSuperAgentVerifications", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          return yield* store.verifications(run.id)
        }),
      )
      .handle("getSuperAgentRun", (ctx) =>
        find(ctx.params.runID).pipe(
          Effect.flatMap((run) =>
            run ? Effect.succeed(view(run)) : Effect.fail(notFound(`没有 Super-Agent run ${ctx.params.runID}`)),
          ),
        ),
      )
      .handle("listSuperAgentEvents", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          return yield* store.events(run.id, ctx.query.after ?? 0, ctx.query.limit ?? 1000)
        }),
      )
      .handle("executeSuperAgentTool", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          const task = run.graph.nodes.find((item) => item.id === ctx.payload.taskID)
          if (!task) return yield* notFound(`没有 Super-Agent task ${ctx.payload.taskID}`)
          const permission = yield* Permission.Service
          const registry = yield* ToolRegistry
          const instructionID = ctx.payload.instructionID ?? `${run.id}:http-tool:${Date.now()}`
          const idempotencyKey = ctx.payload.idempotencyKey ?? `${run.id}:http-tool:${instructionID}`
          const sessionID = ctx.payload.sessionID as SessionID
          const messageID = ctx.payload.messageID as MessageID
          const executor = createNativeToolExecutorEffect({
            registry,
            directory: run.directory,
            sessionID,
            messageID,
            agent: ctx.payload.agent ?? "super-agent",
            store,
            evidenceKind: ctx.payload.evidenceKind,
            timeoutMs: ctx.payload.timeoutMs,
            leaseMs: ctx.payload.leaseMs,
            ask: (request) =>
              permission
                .ask({
                  ...request,
                  sessionID,
                  tool: { messageID, callID: instructionID },
                  ruleset: [],
                })
                .pipe(Effect.orDie),
          })
          const instruction = {
            type: "run_tool" as const,
            taskID: task.id,
            tool: ctx.payload.tool,
            input: ctx.payload.input,
            runID: run.id,
            instructionID,
            issuedAt: Date.now(),
            policyContextHash: "http.native-tool:v1",
            capability: "tool",
            idempotencyKey,
          }
          const result = yield* executor(instruction, run)
          const scheduler = new TaskScheduler(run)
          if (task.status === "pending" || task.status === "ready") scheduler.start(task.id)
          const status =
            result.type === "tool_completed"
              ? "succeeded"
              : result.type === "approval_required" || result.type === "input_required"
                ? "waiting"
                : result.type === "unknown"
                  ? "needs_review"
                  : "failed"
          scheduler.settle(task.id, status, "output" in result ? result.output : undefined)
          const updated = yield* store.updateGraph(run.id, scheduler.snapshot().graph, run.graph.version)
          if (!updated) return yield* notFound(`没有 Super-Agent run ${run.id}`)
          yield* store.appendEvent({
            runID: run.id,
            type: result.type === "tool_completed" ? "tool_completed" : "executor_completed",
            at: Date.now(),
            payload: { taskID: task.id, tool: ctx.payload.tool, resultType: result.type },
          })
          return { result, run: view(updated) }
        }),
      )
      .handle("delegateSuperAgentAgents", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          const task = run.graph.nodes.find((item) => item.id === ctx.payload.taskID)
          if (!task) return yield* notFound(`没有 Super-Agent task ${ctx.payload.taskID}`)
          const pluginContributions = yield* executableContributions
          const instruction: AgentInstruction =
            ctx.payload.calls && ctx.payload.calls.length > 0
              ? {
                  type: "parallel_call_agents",
                  taskID: task.id,
                  runID: run.id,
                  instructionID: `${run.id}:parallel-agent:${Date.now()}`,
                  issuedAt: Date.now(),
                  policyContextHash: "http.agent-delegation:v1",
                  capability: "agent" as const,
                  idempotencyKey: `${run.id}:parallel-agent:${Date.now()}`,
                  calls: ctx.payload.calls.map((call) => ({ ...call })),
                }
              : {
                  type: "call_agent",
                  taskID: task.id,
                  runID: run.id,
                  instructionID: `${run.id}:agent:${Date.now()}`,
                  issuedAt: Date.now(),
                  policyContextHash: "http.agent-delegation:v1",
                  capability: "agent" as const,
                  idempotencyKey: `${run.id}:agent:${Date.now()}`,
                  agentID: ctx.payload.agentID ?? "plugin-agent",
                  instruction: ctx.payload.instruction ?? "",
                }
          const result = yield* Effect.tryPromise({
            try: () =>
              new SuperAgentDelegationCoordinator({
                runtimes: pluginContributions.runtimes,
                runtimeType: ctx.payload.runtimeType,
                store,
                timeoutMs: ctx.payload.timeoutMs,
                childBudget: ctx.payload.childBudget,
                securityPolicy: {
                  allowedRuntimeTypes: pluginContributions.runtimes.list().map((runtime) => runtime.type),
                },
                maxParallelism: ctx.payload.childBudget?.parallelism ?? run.budget.parallelism ?? 8,
              }).executor()(instruction, run),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          }).pipe(Effect.orDie)
          const current = yield* store.get(run.id)
          if (!current) return yield* notFound(`没有 Super-Agent run ${run.id}`)
          const scheduler = new TaskScheduler(current)
          if (task.status === "pending" || task.status === "ready") scheduler.start(task.id)
          const taskStatus =
            result.type === "agent_completed"
              ? "succeeded"
              : result.type === "unknown"
                ? "needs_review"
                : result.type === "agent_failed" && result.code === "child_agent_conflict"
                  ? "needs_review"
                  : "failed"
          scheduler.settle(
            task.id,
            taskStatus,
            "output" in result ? result.output : "outcomes" in result ? result.outcomes : undefined,
          )
          const updated = yield* store.updateGraph(run.id, scheduler.snapshot().graph, current.graph.version)
          if (!updated) return yield* notFound(`没有 Super-Agent run ${run.id}`)
          yield* store.appendEvent({
            runID: run.id,
            type: "agent_delegation_completed",
            at: Date.now(),
            payload: { taskID: task.id, resultType: result.type },
          })
          return { result, run: view(updated) }
        }),
      )
      .handle("recoverSuperAgentRun", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          const result = yield* new SuperAgentRecoveryCoordinator(store).recover(run.id, ctx.payload.at ?? Date.now())
          return {
            run: result.run ? view(result.run) : undefined,
            operations: result.operations,
            reviewRequired: result.reviewRequired,
          }
        }),
      )
      .handle("createSuperAgentRepairTask", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          const pluginContributions = yield* executableContributions
          const strategies = new RepairStrategyRegistry()
          strategies.register(builtinRepairStrategy)
          for (const strategy of pluginContributions.repairStrategies.list()) strategies.register(strategy)
          const coordinator = new SuperAgentRepairCoordinator(store, strategies)
          const result = yield* coordinator
            .create({
              runID: run.id,
              sourceTaskID: ctx.payload.sourceTaskID,
              failedVerificationIDs: ctx.payload.failedVerificationIDs,
              strategyID: ctx.payload.strategyID,
              ...(ctx.payload.input !== undefined ? { input: ctx.payload.input } : {}),
            })
            .pipe(Effect.orDie)
          return { run: view(result.run), task: result.task }
        }),
      )
      .handle("listSuperAgentTaskMutations", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          return yield* store.taskMutations(ctx.params.runID, ctx.query.taskID, ctx.query.limit)
        }),
      )
      .handle("executeSuperAgentRepairTask", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          const permission = yield* Permission.Service
          const registry = yield* ToolRegistry
          const executor = createNativeToolExecutorEffect({
            registry,
            directory: run.directory,
            sessionID: ctx.payload.sessionID as SessionID,
            messageID: ctx.payload.messageID as MessageID,
            agent: ctx.payload.agent ?? "super-agent-repair",
            store,
            evidenceKind: ctx.payload.evidenceKind,
            timeoutMs: ctx.payload.timeoutMs,
            leaseMs: ctx.payload.leaseMs,
            ask: (request) =>
              permission
                .ask({
                  ...request,
                  sessionID: ctx.payload.sessionID as SessionID,
                  tool: { messageID: ctx.payload.messageID as MessageID, callID: `${run.id}:repair` },
                  ruleset: [],
                })
                .pipe(Effect.orDie),
          })
          const pluginContributions = yield* executableContributions
          const strategies = new RepairStrategyRegistry()
          strategies.register(builtinRepairStrategy)
          for (const strategy of pluginContributions.repairStrategies.list()) strategies.register(strategy)
          const result = yield* new SuperAgentRepairCoordinator(store, strategies)
            .executeEffect({ runID: run.id, taskID: ctx.payload.taskID, executor })
            .pipe(Effect.orDie)
          if (!ctx.payload.verifyAfter) return { run: view(result.run), taskID: result.taskID, result: result.result }
          const verifiers = new VerifierRegistry()
          verifiers.register(builtinTestVerifier)
          verifiers.register(builtinArtifactVerifier)
          for (const verifier of pluginContributions.verifiers.list()) verifiers.register(verifier)
          const verified = yield* new SuperAgentVerificationCoordinator(store, verifiers)
            .verifyAndFinish({
              runID: run.id,
              verifierID: ctx.payload.verifierID ?? "builtin.artifact",
              summary: ctx.payload.summary ?? "repair verified",
            })
            .pipe(Effect.orDie)
          return {
            run: view(verified.run),
            taskID: result.taskID,
            result: result.result,
            verifications: verified.verifications,
            completed: verified.completed,
          }
        }),
      )
      .handle("verifyAndFinishSuperAgentRun", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          const pluginContributions = yield* executableContributions
          const verifiers = new VerifierRegistry()
          verifiers.register(builtinTestVerifier)
          verifiers.register(builtinArtifactVerifier)
          for (const verifier of pluginContributions.verifiers.list()) verifiers.register(verifier)
          const coordinator = new SuperAgentVerificationCoordinator(store, verifiers)
          const result = yield* coordinator
            .verifyAndFinish({
              runID: run.id,
              verifierID: ctx.payload.verifierID,
              summary: ctx.payload.summary,
            })
            .pipe(Effect.orDie)
          return { run: view(result.run), verifications: result.verifications, completed: result.completed }
        }),
      )
      .handle("transitionSuperAgentRun", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          const persisted = yield* store.transitionWithEvent(run.id, ctx.payload.status, {
            type: "run_status_changed",
            at: Date.now(),
            payload: { from: run.status, to: ctx.payload.status },
          })
          if (!persisted) return yield* notFound(`没有 Super-Agent run ${run.id}`)
          return view(persisted.run)
        }),
      )
      .handle("recordSuperAgentVerification", (ctx) =>
        Effect.gen(function* () {
          const run = yield* find(ctx.params.runID)
          if (!run) return yield* notFound(`没有 Super-Agent run ${ctx.params.runID}`)
          const verification = yield* store.verification({
            ...ctx.payload,
            runID: run.id,
            createdAt: Date.now(),
          })
          yield* store.appendEvent({
            runID: run.id,
            type: "verification_recorded",
            at: Date.now(),
            payload: { verificationID: verification.id, outcome: verification.outcome },
          })
          return verification
        }),
      )
  }),
)
