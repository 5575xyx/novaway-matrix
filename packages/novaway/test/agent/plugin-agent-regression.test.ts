import { expect } from "bun:test"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Effect, Layer } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Env } from "../../src/env"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { ProviderTest } from "../fake/provider"
import { Skill } from "../../src/skill"
import type { Info as SkillInfo } from "../../src/skill"
import { SkillTest } from "../fake/skill"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"
import { testEffect } from "../lib/effect"
import { PLUGIN_AGENT } from "../fixture/agent-plugin.constants"

// `it.instance` skips InstanceBootstrap so FileWatcher / LSP / MCP don't spin
// up — those services hang during scope teardown on Windows and aren't needed
// to verify plugin → config hook → Agent.list.
const pluginUrl = pathToFileURL(path.join(import.meta.dir, "..", "fixture", "agent-plugin.ts")).href

const provider = ProviderTest.fake()
const configLayer = Config.layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(AuthTest.empty),
  Layer.provide(NpmTest.noop),
)
const pluginLayer = Plugin.layer.pipe(
  Layer.provide(Bus.layer),
  Layer.provide(configLayer),
  Layer.provide(RuntimeFlags.layer({ disableDefaultPlugins: true })),
)
const agentLayer = Agent.layer.pipe(
  Layer.provide(configLayer),
  Layer.provide(AuthTest.empty),
  Layer.provide(SkillTest.empty),
  Layer.provide(provider.layer),
  Layer.provide(pluginLayer),
  Layer.provide(RuntimeFlags.layer({ disableDefaultPlugins: true })),
)

const dynamicSkills: SkillInfo[] = []
const dynamicSkillLayer = Layer.mock(Skill.Service)({
  all: () => Effect.succeed(dynamicSkills),
  dirs: () => Effect.succeed([]),
})
const dynamicAgentLayer = Agent.layer.pipe(
  Layer.provide(configLayer),
  Layer.provide(AuthTest.empty),
  Layer.provide(dynamicSkillLayer),
  Layer.provide(provider.layer),
  Layer.provide(pluginLayer),
  Layer.provide(RuntimeFlags.layer({ disableDefaultPlugins: true })),
)

const it = testEffect(Layer.mergeAll(agentLayer, pluginLayer))
const dynamicIt = testEffect(Layer.mergeAll(dynamicAgentLayer, pluginLayer))

it.instance(
  "plugin-registered agents appear in Agent.list",
  () =>
    Effect.gen(function* () {
      yield* Plugin.Service.use((p) => p.init())
      const agents = yield* Agent.Service.use((svc) => svc.list())
      const added = agents.find((agent) => agent.name === PLUGIN_AGENT.name)
      expect(added?.description).toBe(PLUGIN_AGENT.description)
      expect(added?.mode).toBe(PLUGIN_AGENT.mode)
    }),
  { config: { plugin: [pluginUrl] } },
)

dynamicIt.instance("newly activated plugin skills are allowed by the current agent", () =>
  Effect.gen(function* () {
    const before = yield* Agent.Service.use((svc) => svc.get("creova"))
    expect(Permission.evaluate("skill", "powersnexus_using-powersnexus", before?.permission ?? []).action).toBe("deny")

    dynamicSkills.push({
      name: "powersnexus_using-powersnexus",
      description: "Use PowersNexus workflows.",
      location: "C:/plugins/powersnexus/skills/using-powersnexus",
      content: "# PowersNexus",
      paths: [],
    })

    const after = yield* Agent.Service.use((svc) => svc.get("creova"))
    expect(Permission.evaluate("skill", "powersnexus_using-powersnexus", after?.permission ?? []).action).toBe("allow")
    dynamicSkills.length = 0
  }),
)
