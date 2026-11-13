import { describe, expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { AppFileSystem } from "@novaway/core/filesystem"
import { EffectFlock } from "@novaway/core/util/effect-flock"
import path from "path"
import { pathToFileURL } from "url"
import { Auth } from "../../src/auth"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Env } from "../../src/env"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin/index"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { NpmTest } from "../fake/npm"

const emptyAuth = Layer.mock(Auth.Service)({
  all: () => Effect.succeed({}),
})
const configLayer = Config.layer.pipe(
  Layer.provide(EffectFlock.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(emptyAuth),
  Layer.provide(NpmTest.noop),
)
const it = testEffect(
  Layer.mergeAll(
    Plugin.layer.pipe(
      Layer.provide(Bus.layer),
      Layer.provide(configLayer),
      Layer.provide(RuntimeFlags.layer({ disableDefaultPlugins: true })),
    ),
    CrossSpawnSpawner.defaultLayer,
  ),
)
const systemHook = "experimental.chat.system.transform"

function withProject<A, E, R>(source: string, self: Effect.Effect<A, E, R>) {
  return provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      const file = path.join(dir, "plugin.ts")
      yield* Effect.all(
        [
          Effect.promise(() => Bun.write(file, source)),
          Effect.promise(() =>
            Bun.write(
              path.join(dir, "novaway.json"),
              JSON.stringify(
                {
                  $schema: "https://novaway.ai/config.json",
                  plugin: [pathToFileURL(file).href],
                },
                null,
                2,
              ),
            ),
          ),
        ],
        { discard: true, concurrency: 2 },
      )
      return yield* self
    }),
  )
}

const triggerSystemTransform = Effect.fn("PluginTriggerTest.triggerSystemTransform")(function* () {
  const plugin = yield* Plugin.Service
  const out = { system: [] as string[] }
  yield* plugin.trigger(
    systemHook,
    {
      model: {
        providerID: ProviderID.anthropic,
        modelID: ModelID.make("claude-sonnet-4-6"),
      },
    },
    out,
  )
  return out.system
})

const triggerChatParams = Effect.fn("PluginTriggerTest.triggerChatParams")(function* (excludePluginIDs: string[] = []) {
  const plugin = yield* Plugin.Service
  const out = { topP: 0.8, temperature: 0.3, topK: 0, maxOutputTokens: undefined, options: {} }
  yield* plugin.trigger("chat.params", {} as any, out, { excludePluginIDs })
  return out.topP
})

describe("plugin.trigger", () => {
  it.live("skips only the legacy hook whose explicit plugin id is already active in Runtime Host", () =>
    withProject(
      [
        "export default {",
        '  id: "shared-plugin",',
        "  server: async () => ({",
        '    "chat.params": async (_input, output) => { output.topP += 0.1 },',
        "  }),",
        "}",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        expect(yield* triggerChatParams()).toBeCloseTo(0.9)
        expect(yield* triggerChatParams(["SHARED-PLUGIN"])).toBeCloseTo(0.8)
      }),
    ),
  )

  it.live("runs synchronous hooks without crashing", () =>
    withProject(
      [
        "export default async () => ({",
        `  ${JSON.stringify(systemHook)}: (_input, output) => {`,
        '    output.system.unshift("sync")',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        expect(yield* triggerSystemTransform()).toEqual(["sync"])
      }),
    ),
  )

  it.live("awaits asynchronous hooks", () =>
    withProject(
      [
        "export default async () => ({",
        `  ${JSON.stringify(systemHook)}: async (_input, output) => {`,
        "    await Bun.sleep(1)",
        '    output.system.unshift("async")',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        expect(yield* triggerSystemTransform()).toEqual(["async"])
      }),
    ),
  )
})
