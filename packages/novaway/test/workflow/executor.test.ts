import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { executeRun } from "../../src/workflow/executor"
import type { Workflow, WorkflowRun } from "../../src/workflow/workflow"
import type { WorkflowStep } from "../../src/workflow/workflow.sql"
import type { RunAgent } from "../../src/session/agent-step"

// 执行引擎是纯函数(runAgent + service 均为注入),无需 DB / LLM。
// 用假 runAgent(回显 prompt)与假 service(内存记录状态)验证图遍历、插值、
// 条件分支、并行、错误落 failed。

function makeWorkflow(steps: WorkflowStep[]): Workflow {
  const now = new Date()
  return {
    id: "wf_test",
    sessionId: "ses_test",
    name: "test",
    description: null,
    steps,
    status: "draft",
    state: null,
    createdAt: now,
    updatedAt: now,
  }
}

function makeRun(): WorkflowRun {
  const now = new Date()
  return {
    id: "run_test",
    workflowId: "wf_test",
    sessionId: "ses_test",
    status: "pending",
    state: null,
    error: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
  }
}

// 内存 service:记录最后一次 updateRunState,回显为 WorkflowRun。
function makeFakeService(run: WorkflowRun) {
  const calls: Array<{ status?: string; error?: string; currentStep: string }> = []
  const service = {
    update: (_: { workflowId: string; status?: Workflow["status"] }) =>
      Effect.succeed({} as Workflow),
    updateRunState: (input: {
      runId: string
      state: WorkflowRun["state"]
      status?: WorkflowRun["status"]
      error?: string
    }) => {
      calls.push({ status: input.status, error: input.error, currentStep: input.state?.currentStep ?? "" })
      return Effect.succeed({
        ...run,
        state: input.state,
        status: input.status ?? run.status,
        error: input.error ?? null,
      } as WorkflowRun)
    },
  }
  return { service, calls }
}

// 回显 prompt 的假 runAgent,记录调用顺序。
function makeEchoAgent() {
  const prompts: string[] = []
  const runAgent: RunAgent = (input) =>
    Effect.sync(() => {
      prompts.push(input.prompt)
      return `out:${input.prompt}`
    })
  return { runAgent, prompts }
}

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)

describe("workflow executor", () => {
  test("traverses a linear agent graph and interpolates prior outputs", async () => {
    const steps: WorkflowStep[] = [
      { id: "s1", name: "one", type: "agent", config: { prompt: "step one" }, next: "s2" },
      { id: "s2", name: "two", type: "agent", config: { prompt: "got: {{s1}}" } },
    ]
    const workflow = makeWorkflow(steps)
    const runRow = makeRun()
    const { service, calls } = makeFakeService(runRow)
    const { runAgent, prompts } = makeEchoAgent()

    const final = await run(executeRun({ workflow, run: runRow, runAgent, defaultAgent: "build", service }))

    expect(prompts).toEqual(["step one", "got: out:step one"])
    expect(final.status).toBe("completed")
    expect(final.state?.outputs.s1).toBe("out:step one")
    expect(final.state?.outputs.s2).toBe("out:got: out:step one")
    expect(final.state?.completedSteps).toEqual(expect.arrayContaining(["s1", "s2"]))
    // 最后一次状态写回应为 completed
    expect(calls.at(-1)?.status).toBe("completed")
  })

  test("condition step routes to nextTrue when predicate matches", async () => {
    const steps: WorkflowStep[] = [
      { id: "s1", name: "ask", type: "agent", config: { prompt: "yes please" }, next: "c" },
      { id: "c", name: "check", type: "condition", config: { input: "s1", contains: "yes" }, nextTrue: "tYes", nextFalse: "tNo" },
      { id: "tYes", name: "yesbranch", type: "agent", config: { prompt: "took yes branch" } },
      { id: "tNo", name: "nobranch", type: "agent", config: { prompt: "took no branch" } },
    ]
    const workflow = makeWorkflow(steps)
    const runRow = makeRun()
    const { service } = makeFakeService(runRow)
    const { runAgent, prompts } = makeEchoAgent()

    const final = await run(executeRun({ workflow, run: runRow, runAgent, defaultAgent: "build", service }))

    expect(prompts).toContain("took yes branch")
    expect(prompts).not.toContain("took no branch")
    expect(final.state?.outputs.c).toBe(true)
    expect(final.status).toBe("completed")
  })

  test("parallel step fans out children then continues", async () => {
    const steps: WorkflowStep[] = [
      { id: "p", name: "fan", type: "parallel", config: {}, steps: ["a", "b"], next: "join" },
      { id: "a", name: "a", type: "agent", config: { prompt: "branch a" } },
      { id: "b", name: "b", type: "agent", config: { prompt: "branch b" } },
      { id: "join", name: "join", type: "agent", config: { prompt: "joined: {{a}} + {{b}}" } },
    ]
    const workflow = makeWorkflow(steps)
    const runRow = makeRun()
    const { service } = makeFakeService(runRow)
    const { runAgent, prompts } = makeEchoAgent()

    const final = await run(executeRun({ workflow, run: runRow, runAgent, defaultAgent: "build", service }))

    expect(prompts).toEqual(expect.arrayContaining(["branch a", "branch b"]))
    expect(final.state?.outputs.a).toBe("out:branch a")
    expect(final.state?.outputs.b).toBe("out:branch b")
    expect(final.state?.outputs.join).toBe("out:joined: out:branch a + out:branch b")
    expect(final.status).toBe("completed")
  })

  test("marks the run failed when an agent step throws", async () => {
    const steps: WorkflowStep[] = [
      { id: "s1", name: "boom", type: "agent", config: { prompt: "explode" } },
    ]
    const workflow = makeWorkflow(steps)
    const runRow = makeRun()
    const { service, calls } = makeFakeService(runRow)
    const runAgent: RunAgent = () => Effect.fail(new Error("agent blew up"))

    const final = await run(executeRun({ workflow, run: runRow, runAgent, defaultAgent: "build", service }))

    expect(final.status).toBe("failed")
    expect(final.error).toContain("agent blew up")
    expect(calls.at(-1)?.status).toBe("failed")
  })
})
