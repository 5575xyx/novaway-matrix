import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SuperAgentStore, SuperAgentStoreLayer } from "../../src/super-agent"
import type { Goal } from "../../src/super-agent"

const goal: Goal = {
  text: "human gate",
  constraints: [],
  source: "user",
  requestedBy: "test",
  acceptanceCriteria: [],
}
const run = <A>(effect: Effect.Effect<A, unknown, SuperAgentStore>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SuperAgentStoreLayer)))

describe("Super-Agent human gates", () => {
  test("scopes approval and input records to a durable run", async () => {
    const created = await run(
      SuperAgentStore.use((store) => store.create({ id: `sa_gate_${Date.now()}`, directory: "/tmp/gate", goal })),
    )
    const taskID = created.graph.rootTaskID
    const approval = await run(
      SuperAgentStore.use((store) =>
        store.createApproval({
          id: `${created.id}:approval`,
          runID: created.id,
          taskID,
          reason: "write file",
          scope: "workspace",
          status: "pending",
        }),
      ),
    )
    expect(
      (await run(SuperAgentStore.use((store) => store.decideApproval(approval.id, "approved", "user"))))?.status,
    ).toBe("approved")
    const input = await run(
      SuperAgentStore.use((store) =>
        store.createInput({
          id: `${created.id}:input`,
          runID: created.id,
          taskID,
          prompt: "Which branch?",
          status: "pending",
        }),
      ),
    )
    expect((await run(SuperAgentStore.use((store) => store.answerInput(input.id, "main"))))?.answer).toBe("main")
  })
})
