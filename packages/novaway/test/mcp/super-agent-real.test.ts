import path from "node:path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Config } from "@/config/config"
import { MCP } from "@/mcp"
import { McpAuth } from "@/mcp/auth"
import { Bus } from "@/bus"
import { createNativeToolExecutorEffect } from "@/super-agent/native-executor"
import { TestConfig } from "../fixture/config"
import { TestElicitation } from "../fixture/elicitation"
import { testEffect } from "../lib/effect"
import type { AgentInstruction, Goal, SuperAgentRun } from "@/super-agent/types"

const testConfigLayer = TestConfig.layer({
  get: () => Effect.succeed({ mcp: {} } as Config.Info),
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
