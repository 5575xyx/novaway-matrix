import { Effect } from "effect"
import type { Interface as WorkflowInterface, Workflow, WorkflowRun } from "./workflow"
import type { WorkflowStep, WorkflowState } from "./workflow.sql"
import type { RunAgent } from "@/session/agent-step"

// 组合工作流执行引擎。
// 从 run.state.currentStep 起按图遍历 workflow.steps,按 step.type 分派:
//   agent  —— 派生子代理跑一轮,输出存入 outputs[step.id]
//   tool   —— 作为 agent 轮次,提示子代理调用指定工具
//   skill  —— 同上,调用指定技能
//   condition —— 对 outputs 求值,走 nextTrue / nextFalse
//   parallel  —— 并发执行 step.steps 引用的子步骤,再走 next
// 每步后写回 run 状态(激活原先的死代码 updateRunState),终态 completed;抛错 failed+error。
//
// 引擎不依赖 SessionPrompt —— 通过注入的 runAgent 回调执行,避免层循环。

/** 把 {{stepId}} 占位符替换为对应步骤的输出文本。 */
function interpolate(template: string, outputs: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => {
    const value = outputs[key]
    if (value == null) return ""
    return typeof value === "string" ? value : JSON.stringify(value)
  })
}

/** 求值 condition 步骤:支持 contains / equals / matches / truthy,缺省判非空。 */
function evalCondition(step: WorkflowStep, outputs: Record<string, unknown>): boolean {
  const c = step.config ?? {}
  const inputVal =
    typeof c.input === "string" ? String(outputs[c.input] ?? "") : Object.values(outputs).map(String).join("\n")
  if (typeof c.contains === "string") return inputVal.includes(c.contains)
  if (typeof c.equals === "string") return inputVal.trim() === c.equals
  if (typeof c.matches === "string") {
    try {
      return new RegExp(c.matches).test(inputVal)
    } catch {
      return false
    }
  }
  if (typeof c.truthy === "string") return Boolean(outputs[c.truthy])
  return inputVal.trim().length > 0
}

export interface ExecuteRunDeps {
  readonly workflow: Workflow
  readonly run: WorkflowRun
  readonly runAgent: RunAgent
  /** step/task 未指定 agent 时的回退 agent 名。 */
  readonly defaultAgent: string
  readonly service: Pick<WorkflowInterface, "updateRunState" | "update">
}

export const executeRun = (deps: ExecuteRunDeps): Effect.Effect<WorkflowRun> =>
  Effect.gen(function* () {
    const { workflow, run, runAgent, service } = deps
    const stepMap = new Map(workflow.steps.map((s) => [s.id, s]))
    const startedAt = run.state?.startedAt ?? new Date()
    const outputs: Record<string, unknown> = { ...(run.state?.outputs ?? {}) }
    const completedSteps: string[] = [...(run.state?.completedSteps ?? [])]

    // 执行单个 agent/tool/skill 步骤,返回其文本输出。
    const runSingle = (step: WorkflowStep): Effect.Effect<string> =>
      Effect.gen(function* () {
        const c = step.config ?? {}
        const agentName = typeof c.agent === "string" ? c.agent : deps.defaultAgent
        switch (step.type) {
          case "agent": {
            const promptText = interpolate(String(c.prompt ?? step.name), outputs)
            return yield* runAgent({ agent: agentName, prompt: promptText, title: step.name })
          }
          case "tool":
          case "skill": {
            const target = step.type === "tool" ? c.tool : c.skill
            const kind = step.type === "tool" ? "工具" : "技能"
            const instruction = interpolate(String(c.prompt ?? ""), outputs)
            const promptText = [`请使用${kind} \`${String(target ?? "")}\` 完成以下任务：`, instruction]
              .filter(Boolean)
              .join("\n")
            return yield* runAgent({ agent: agentName, prompt: promptText, title: step.name })
          }
          default:
            return ""
        }
      })

    yield* service.update({ workflowId: workflow.id, status: "running" }).pipe(Effect.ignore)

    let cursor: string | undefined = run.state?.currentStep || workflow.steps[0]?.id
    // 防环:最多执行步骤总数的若干倍
    const guard = { budget: workflow.steps.length * 4 + 8 }

    while (cursor && guard.budget-- > 0) {
      const step = stepMap.get(cursor)
      if (!step) break

      let next: string | undefined
      if (step.type === "condition") {
        const truthy = evalCondition(step, outputs)
        outputs[step.id] = truthy
        next = truthy ? step.nextTrue : step.nextFalse
      } else if (step.type === "parallel") {
        const children = (step.steps ?? [])
          .map((id) => stepMap.get(id))
          .filter((s): s is WorkflowStep => Boolean(s))
        const results = yield* Effect.forEach(
          children,
          (child) => runSingle(child).pipe(Effect.map((out) => [child.id, out] as const)),
          { concurrency: Math.max(1, children.length) },
        )
        for (const [id, out] of results) {
          outputs[id] = out
          completedSteps.push(id)
        }
        outputs[step.id] = results.map(([, out]) => out).join("\n\n")
        next = step.next
      } else {
        outputs[step.id] = yield* runSingle(step)
        next = step.next
      }

      completedSteps.push(step.id)
      const isDone = !next
      const nextState: WorkflowState = {
        currentStep: next ?? "",
        completedSteps: [...completedSteps],
        outputs: { ...outputs },
        startedAt,
        ...(isDone ? { completedAt: new Date() } : {}),
      }
      yield* service.updateRunState({
        runId: run.id,
        state: nextState,
        status: isDone ? "completed" : "running",
      })
      cursor = next
    }

    yield* service.update({ workflowId: workflow.id, status: "completed" }).pipe(Effect.ignore)

    const finalRun = yield* service.updateRunState({
      runId: run.id,
      state: {
        currentStep: "",
        completedSteps: [...completedSteps],
        outputs: { ...outputs },
        startedAt,
        completedAt: new Date(),
      },
      status: "completed",
    })
    return finalRun
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        const message = error instanceof Error ? error.message : String(error)
        yield* deps.service.update({ workflowId: deps.workflow.id, status: "failed" }).pipe(Effect.ignore)
        return yield* deps.service.updateRunState({
          runId: deps.run.id,
          state: deps.run.state ?? {
            currentStep: "",
            completedSteps: [],
            outputs: {},
            startedAt: new Date(),
          },
          status: "failed",
          error: message,
        })
      }),
    ),
  )
