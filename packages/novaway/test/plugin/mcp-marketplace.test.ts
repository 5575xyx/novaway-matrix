import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import {
  createAgentRegistry,
  createCommandRegistry,
  createSkillRegistry,
  createToolRegistry,
} from "@/plugin/contributions"
import { createInterceptorRuntime } from "@/plugin/runtime/hooks"
import { createDeclarativeRegistries } from "@/plugin/runtime/declarative"
import { createHost } from "@/plugin/runtime/host"
import { PluginRuntimeService } from "@/plugin/runtime/service"
import { MCP } from "@/mcp"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Bus } from "@/bus"
import { McpAuth } from "@/mcp/auth"
import { TestConfig } from "../fixture/config"
import { TestElicitation } from "../fixture/elicitation"
import { testEffect } from "../lib/effect"

const host = createHost({
  tools: createToolRegistry(),
  agents: createAgentRegistry(),
  skills: createSkillRegistry(),
  commands: createCommandRegistry(),
  interceptors: createInterceptorRuntime(),
  declarative: createDeclarativeRegistries(),
})

host.registries.declarative!.mcpServers.register(
  { pluginID: "mcp-suite", scope: "global" },
  { id: "browser", type: "local", command: ["echo", "browser"], enabled: false },
)

const layer = MCP.layer.pipe(
  Layer.provide(TestElicitation.layer()),
  Layer.provide(McpAuth.layer),
  Layer.provide(Bus.layer),
  Layer.provide(TestConfig.layer({ get: () => Effect.succeed({ mcp: {} }) })),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(
    Layer.succeed(PluginRuntimeService.Service, {
      get: Effect.succeed(host),
      invalidate: Effect.void,
      setEnabled: () => Effect.void,
      activateBuiltin: () => Effect.void,
      activateOnDemand: () => Effect.void,
    }),
  ),
)

const it = testEffect(layer)

it.instance("exposes declarative MCP contributions and removes them after plugin deactivation", () =>
  MCP.Service.use((mcp) =>
    Effect.gen(function* () {
      const active = yield* mcp.status()
      expect(active["mcp-suite_browser"]).toEqual({ status: "disabled" })
      expect(active.browser).toBeUndefined()

      host.registries.declarative!.mcpServers!.release("mcp-suite")
      const afterDeactivate = yield* mcp.status()
      expect(afterDeactivate["mcp-suite_browser"]).toBeUndefined()
      host.registries.declarative!.mcpServers.register(
        { pluginID: "mcp-suite", scope: "global" },
        { id: "context7", type: "local", command: ["echo", "context7"], enabled: false },
      )
      const afterActivate = yield* mcp.status()
      expect(afterActivate["mcp-suite_context7"]).toEqual({ status: "disabled" })
    }),
  ),
)

test("MCP plugin integration layer is defined", () => {
  expect(layer).toBeDefined()
})
