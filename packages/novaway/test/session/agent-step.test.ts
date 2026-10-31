import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { makeRunAgent, type RunAgentPromptOps } from "../../src/session/agent-step"
import { SessionID } from "../../src/session/schema"

// makeRunAgent 只依赖少量方法,这里用最小 fake 验证「派生子会话 → 登记团队成员」这条链路,
// 不必拉起完整数据库层。
function harness(opts: {
  team?: boolean
  service?: boolean
  existingName?: string
  prompt?: (sessionID: string) => Effect.Effect<unknown, unknown>
  /** 注入「读用量」的实现：验证派发方能把整棵子树的消耗算进来。 */
  usage?: { cost: number; tokens: number }
}) {
  const parentID = SessionID.make("ses_parent")
  const childID = SessionID.make("ses_child_1234")

  const created: any[] = []
  const added: any[] = []
  const statuses: { sessionID: string; status: string }[] = []

  const sessions = {
    get: (id: unknown) =>
      id === parentID
        ? Effect.succeed({ id: parentID, agent: "build", permission: [], permissionMode: "acceptEdits" })
        : Effect.fail(new Error("not found")),
    create: (input: any) => {
      created.push(input)
      return Effect.succeed({ id: childID, parentID, directory: "/tmp" })
    },
  } as any

  const agents = {
    get: (name: string) => Effect.succeed({ name, permission: [], model: undefined }),
  } as any

  const teams = {
    ofSession: () => Effect.succeed(opts.team === false ? undefined : { id: "team_1", rootSessionID: parentID }),
    ensure: () => Effect.succeed({ id: "team_1", rootSessionID: parentID }),
    member: (_teamID: string, name: string) =>
      Effect.succeed(opts.existingName === name ? { sessionID: "ses_old", name } : undefined),
    addMember: (input: any) => {
      added.push(input)
      return Effect.succeed({ ...input, status: "idle" })
    },
    updateMember: (input: any) => {
      statuses.push({ sessionID: input.sessionID, status: input.status })
      return Effect.succeed(undefined)
    },
  } as any

  const ops: RunAgentPromptOps = {
    resolvePromptParts: () => Effect.succeed([]),
    prompt: (input: any) =>
      (opts.prompt ? opts.prompt(input.sessionID) : Effect.void).pipe(
        Effect.as({ info: {}, parts: [{ type: "text", text: "done" }] }),
      ) as any,
  }

  const runAgent = makeRunAgent({
    ops,
    sessions,
    agents,
    parentSessionID: parentID,
    defaultModel: { providerID: "test", modelID: "test-model" },
    defaultAgent: "build",
    ...(opts.service === false ? {} : { teams }),
    ...(opts.usage ? { readUsage: () => Effect.succeed(opts.usage!) } : {}),
  })

  return { runAgent, created, added, statuses, childID, parentID }
}

describe("session.agent-step.makeRunAgent", () => {
  test("registers spawned sessions as team workers and toggles their status", async () => {
    const h = harness({})
    const output = await Effect.runPromise(h.runAgent({ agent: "explore", prompt: "hello", title: "Research" }))

    expect(output.text).toBe("done")
    expect(h.created).toHaveLength(1)
    expect(h.created[0].parentID).toBe(h.parentID)
    expect(h.created[0].permissionMode).toBe("acceptEdits")

    expect(h.added).toHaveLength(1)
    expect(h.added[0]).toMatchObject({
      teamID: "team_1",
      sessionID: h.childID,
      name: "Research",
      agent: "explore",
      role: "worker",
    })

    expect(h.statuses).toEqual([
      { sessionID: h.childID, status: "active" },
      { sessionID: h.childID, status: "idle" },
    ])
  })

  test("reports what this run cost so the caller can settle instead of guessing", async () => {
    // 只返回文本时，账本只能把每笔预占记成「用量不明」—— 「花了多少」永远没人回答。
    const h = harness({ usage: { cost: 0.02, tokens: 1234 } })
    const output = await Effect.runPromise(h.runAgent({ agent: "build", prompt: "hi", title: "Work" }))
    expect(output.usage).toEqual({ cost: 0.02, tokens: 1234 })
    expect(output.sessionID).toBe(h.childID)
  })

  test("a session that cannot be read reports zero instead of failing the dispatch", async () => {
    // 读用量失败不该让整次派发失败：文本已经产出，用量记 0 比丢掉这轮更可解释。
    const h = harness({})
    const output = await Effect.runPromise(h.runAgent({ agent: "build", prompt: "hi", title: "Work" }))
    expect(output.usage).toEqual({ cost: 0, tokens: 0 })
  })

  test("marks the worker idle even when the prompt fails", async () => {
    const h = harness({ prompt: () => Effect.fail(new Error("boom")) })

    await expect(
      Effect.runPromise(h.runAgent({ agent: "explore", prompt: "hello", title: "Research" })),
    ).rejects.toThrow("boom")

    expect(h.statuses).toEqual([
      { sessionID: h.childID, status: "active" },
      { sessionID: h.childID, status: "idle" },
    ])
  })

  test("suffixes duplicate roster names so messages cannot hit stale sessions", async () => {
    const h = harness({ existingName: "Research" })
    await Effect.runPromise(h.runAgent({ agent: "explore", prompt: "hello", title: "Research" }))

    expect(h.added[0].name).toBe("Research #1234")
  })

  test("does not touch the roster when no team service is wired", async () => {
    const h = harness({ service: false })
    await Effect.runPromise(h.runAgent({ agent: "explore", prompt: "hello" }))

    expect(h.added).toHaveLength(0)
    expect(h.statuses).toHaveLength(0)
  })

  test("creates a team automatically when the root session has none", async () => {
    const h = harness({ team: false })
    await Effect.runPromise(h.runAgent({ agent: "explore", prompt: "hello" }))

    expect(h.added).toHaveLength(1)
    expect(h.added[0]).toMatchObject({ teamID: "team_1", role: "worker", agent: "explore" })
  })
})
