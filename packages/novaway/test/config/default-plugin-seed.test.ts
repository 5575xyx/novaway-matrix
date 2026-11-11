import { expect, test } from "bun:test"
import path from "node:path"
import { Effect, Layer, Option } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { EffectFlock } from "@novaway/core/util/effect-flock"
import { Auth } from "../../src/auth"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Env } from "../../src/env"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { Npm } from "@novaway/core/npm"

const { Config } = await import("../../src/config/config")
const { ConfigParse } = await import("../../src/config/parse")
const { Global } = await import("@novaway/core/global")
const { Filesystem } = await import("@/util/filesystem")
const { tmpdir, withTestInstance, disposeAllInstances, provideInstance } = await import("../fixture/fixture")
const infra = CrossSpawnSpawner.defaultLayer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
)
const layer = Config.layer.pipe(
  Layer.provide(EffectFlock.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(Layer.mock(Auth.Service)({ all: () => Effect.succeed({}) })),
  Layer.provideMerge(infra),
  Layer.provide(
    Layer.mock(Npm.Service)({
      install: () => Effect.void,
      add: () => Effect.die("not implemented"),
      which: () => Effect.succeed(Option.none()),
    }),
  ),
)

async function configAt(directory: string) {
  return Effect.runPromise(
    Config.Service.use((service) => service.get()).pipe(
      Effect.scoped,
      Effect.provide(layer),
      provideInstance(directory),
    ),
  )
}

async function withConfigDirectory(run: (directory: string) => Promise<void>) {
  await using tmp = await tmpdir()
  const previous = Global.Path.config
  const previousDisableDefaultPlugins = process.env.NOVAWAY_DISABLE_DEFAULT_PLUGINS
  ;(Global.Path as { config: string }).config = tmp.path
  process.env.NOVAWAY_DISABLE_DEFAULT_PLUGINS = "0"
  await disposeAllInstances()

  try {
    await run(tmp.path)
  } finally {
    ;(Global.Path as { config: string }).config = previous
    if (previousDisableDefaultPlugins === undefined) delete process.env.NOVAWAY_DISABLE_DEFAULT_PLUGINS
    else process.env.NOVAWAY_DISABLE_DEFAULT_PLUGINS = previousDisableDefaultPlugins
    await disposeAllInstances()
  }
}

async function loadAndRead(directory: string, filename = "novaway.json") {
  await withTestInstance({ directory, fn: () => configAt(directory) })
  const file = path.join(directory, filename)
  const content = await Filesystem.readText(file)
  return ConfigParse.schema(Config.Info, ConfigParse.jsonc(content, file), file)
}

test("seeds the default plugin without invoking network installation", async () => {
  await withConfigDirectory(async (directory) => {
    const parsed = await loadAndRead(directory)
    expect(parsed.plugin).toEqual(["PowersNexus@git+https://gitee.com/nova-way/powersnexus.git"])
  })
})

test("seeds the Gitee source regardless of the legacy first-party environment variable", async () => {
  const previous = process.env.POWERSNEXUS_FIRST_PARTY
  process.env.POWERSNEXUS_FIRST_PARTY = "1"

  try {
    await withConfigDirectory(async (directory) => {
      const parsed = await loadAndRead(directory)
      expect(parsed.plugin).toEqual(["PowersNexus@git+https://gitee.com/nova-way/powersnexus.git"])
    })
  } finally {
    if (previous === undefined) delete process.env.POWERSNEXUS_FIRST_PARTY
    else process.env.POWERSNEXUS_FIRST_PARTY = previous
  }
})

test("adds the default plugin after existing global plugin entries", async () => {
  await withConfigDirectory(async (directory) => {
    await Bun.write(path.join(directory, "novaway.json"), JSON.stringify({ plugin: ["other-plugin@1.0"] }))
    const parsed = await loadAndRead(directory)
    expect(parsed.plugin).toEqual(["other-plugin@1.0", "PowersNexus@git+https://gitee.com/nova-way/powersnexus.git"])
  })
})

test("writes a JSON config with the default plugin when only JSONC exists", async () => {
  await withConfigDirectory(async (directory) => {
    await Bun.write(path.join(directory, "novaway.jsonc"), JSON.stringify({ plugin: ["old-plugin@1.0"] }))
    const parsed = await loadAndRead(directory)
    expect(parsed.plugin).toEqual(["old-plugin@1.0", "PowersNexus@git+https://gitee.com/nova-way/powersnexus.git"])
  })
})
