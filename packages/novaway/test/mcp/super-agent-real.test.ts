import path from "node:path"
import { describe, expect, test } from "bun:test"
import type { Config as ConfigNamespace } from "@/config/config"

/**
 * The other MCP tests install SDK-wide mocks. Bun shares that mock registry
 * between files in one invocation, so this real stdio contract runs in a
 * clean child process rather than silently testing a mocked transport.
 */
if (process.env.NOVAWAY_REAL_MCP_CHILD !== "1") {
  describe("real MCP Super-Agent execution", () => {
    test(
      "connects to a real stdio MCP server and executes it through the durable executor",
      async () => {
        const child = Bun.spawn(
          [
            process.execPath,
            "test",
            "--max-concurrency=1",
            "--timeout",
            "120000",
            "test/mcp/super-agent-real.test.ts",
          ],
          {
            cwd: path.resolve(import.meta.dir, "../.."),
            env: { ...process.env, NOVAWAY_REAL_MCP_CHILD: "1" },
            stdout: "pipe",
            stderr: "pipe",
          },
        )
        const [exitCode, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])
        expect(exitCode, `${stdout}\n${stderr}`).toBe(0)
      },
      180_000,
    )
  })
} else {
  const { Effect, Layer } = await import("effect")
  const { CrossSpawnSpawner } = await import("@novaway/core/cross-spawn-spawner")
  const { AppFileSystem } = await import("@novaway/core/filesystem")
  const { Config } = await import("@/config/config")
  const { MCP } = await import("@/mcp")
  const { McpAuth } = await import("@/mcp/auth")
  const { Bus } = await import("@/bus")
  const { createNativeToolExecutorEffect } = await import("@/super-agent/native-executor")
  const { TestConfig } = await import("../fixture/config")
  const { TestElicitation } = await import("../fixture/elicitation")
  const { testEffect } = await import("../lib/effect")
  type AgentInstruction = import("@/super-agent/types").AgentInstruction
  type Goal = import("@/super-agent/types").Goal
  type SuperAgentRun = import("@/super-agent/types").SuperAgentRun

  const testConfigLayer = TestConfig.layer({
    get: () => Effect.succeed({ mcp: {} } as ConfigNamespace.Info),
  })
  const testLayer = MCP.layer.pipe(
    Layer.provide(TestElicitation.layer()),
    Layer.provide(McpAuth.layer),
    Layer.provide(Bus.layer),
    Layer.provide(testConfigLayer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
  )
  const it = testEffect(testLayer)
  const goal: Goal = {
    text: "execute a real MCP task",
    constraints: [],
    source: "user",
    requestedBy: "test",
    acceptanceCriteria: [],
  }
  const run: SuperAgentRun = {
    id: "real-mcp-run",
    goal,
    status: "running",
    graph: { id: "real-mcp-graph", version: 1, nodes: [], edges: [], rootTaskID: "root", planHash: "fixture" },
    budget: {},
    usage: { tokens: 0, usd: 0, wallTimeMs: 0, steps: 0, toolCalls: 0, childAgents: 0 },
    createdAt: 0,
    updatedAt: 0,
  }

  describe("real MCP Super-Agent execution", () => {
    it.instance(
      "connects to a real stdio MCP server and executes it through the durable executor",
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        const serverPath = path.resolve(import.meta.dir, "../fixtures/mcp-real-server.ts")
        const added = yield* mcp.add("real-e2e", {
          type: "local",
          command: [process.execPath, serverPath],
          timeout: 10_000,
        })
        expect(String(JSON.stringify(added.status))).toContain("connected")
        const tools = yield* mcp.tools()
        const toolID = Object.keys(tools).find((id) => id.includes("echo_durable"))
        expect(toolID).toBeDefined()

        let operationStatus = "started"
        const operation = {
          id: "real-mcp-run:tool:real-mcp-instruction",
          runID: run.id,
          instructionID: "real-mcp-instruction",
          idempotencyKey: "real-mcp-idempotency",
          status: "started" as const,
          leaseUntil: Date.now() + 60_000,
          startedAt: Date.now(),
          updatedAt: Date.now(),
          acquired: true,
        }
        const store = {
          beginOperation: () => Effect.succeed(operation),
          heartbeatOperation: () => Effect.succeed(operation),
          appendEvent: (event: unknown) => Effect.succeed(event),
          reserveBudget: () => Effect.succeed({} as never),
          settleBudget: () => Effect.succeed({} as never),
          releaseBudget: () => Effect.succeed({} as never),
          evidence: (item: unknown) => Effect.succeed(item),
          resolveOperation: (_id: string, status: string) => {
            operationStatus = status
            return Effect.succeed(operation)
          },
        } as never
        const executor = createNativeToolExecutorEffect({
          registry: { all: () => Effect.succeed([]) } as never,
          mcp,
          directory: ".",
          sessionID: "real-mcp-session" as never,
          messageID: "real-mcp-message" as never,
          agent: "super-agent",
          ask: () => Effect.void,
          store,
        })
        const instruction: AgentInstruction = {
          type: "run_tool",
          taskID: "real-mcp-task",
          tool: toolID!,
          input: { value: "real-server" },
          runID: run.id,
          instructionID: "real-mcp-instruction",
          issuedAt: Date.now(),
          policyContextHash: "test",
          capability: "tool",
          idempotencyKey: "real-mcp-idempotency",
        }
        const result = yield* executor(instruction, run)
        expect(result).toMatchObject({ type: "tool_completed", tool: toolID })
        expect(JSON.stringify(result)).toContain("real-mcp-server")
        expect(operationStatus).toBe("succeeded")
        yield* mcp.disconnect("real-e2e")
      }),
      { git: false },
      120_000,
    )
  })
}
