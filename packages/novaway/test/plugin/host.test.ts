import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import type { PathLike } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { PluginMeta } from "@/plugin/meta"
import { PluginHost } from "@/plugin/host"

/**
 * §14.3 第 4 步的验收：三套旧机制（旧 Extension 目录、`novaway.json` 的 plugin、`tui.json` 的 plugin）
 * 汇成同一个列表，且状态机只走到 `installed`——不激活、不安装、不联网。
 *
 * 每个用例一套临时 config/home/project/cache：`roots()` 是按目录扫的，共用目录会让上一个用例
 * 留下的插件出现在这一个的列表里。
 */

let base = ""
let config = ""
let home = ""
let directory = ""
let cache = ""

function input(extra: Partial<PluginHost.Input> = {}): PluginHost.Input {
  return { config, home, directory, worktree: directory, builtin: "", cache, env: {}, meta: {}, ...extra }
}

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

/** 落在 `<config>/extensions/<dir>` 的一个扩展包，返回它自己的目录。 */
function pack(name: string, body: unknown) {
  return write(path.join(config, "extensions", name, "plugin.json"), JSON.stringify(body)).then(
    () => `${config}/extensions/${name}`,
  )
}

function v2(name: string, body: Record<string, unknown>) {
  return pack(name, { name, apiVersion: 2, kind: "declarative", ...body })
}

function inProject(dir: string, name: string, body: unknown) {
  return write(path.join(dir, ".novaway", "extensions", name, "plugin.json"), JSON.stringify(body))
}

/** 与 host 的探测同一套目录规则：`<cache>/packages/<spec>/node_modules/<pkg>`。 */
async function materialize(spec: string, pkg: string) {
  const dir = path.join(cache, "packages", spec === pkg ? `${pkg}@latest` : spec, "node_modules", pkg)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

function npm(spec: string, scope: "global" | "local" = "global") {
  return { spec, source: path.join(config, "novaway.json"), scope } satisfies {
    spec: string
    source: string
    scope: "global" | "local"
  }
}

function entry(
  id: string,
  spec: string,
  first_time: number,
  options: { version?: string; source?: "file" | "npm" } = {},
): PluginMeta.Entry {
  return {
    id,
    source: options.source ?? "npm",
    spec,
    target: `${cache}/packages/${spec}`,
    first_time,
    last_time: first_time,
    time_changed: first_time,
    load_count: 1,
    fingerprint: `${spec}|${options.version ?? ""}`,
    ...(options.version === undefined ? {} : { version: options.version }),
  }
}

function one(list: PluginHost.Instance[], id: string) {
  return list.filter((item) => item.id === id)
}

function pick(list: PluginHost.Instance[], id: string) {
  return list.find((item) => item.id === id)
}

function codes(inst: PluginHost.Instance | undefined) {
  return (inst?.diagnostics ?? []).map((item) => item.code)
}

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-host-"))
  config = path.join(base, "config")
  home = path.join(base, "home")
  directory = path.join(base, "project")
  cache = path.join(base, "cache")
  await fs.mkdir(config, { recursive: true })
  await fs.mkdir(home, { recursive: true })
  await fs.mkdir(directory, { recursive: true })
  PluginHost.clearIndexCache()
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
  PluginHost.clearIndexCache()
})

describe("PluginHost.discover", () => {
  test("三套旧机制汇成同一列表，各自的 adapter/origin/scope 正确", async () => {
    await pack("acme", {
      name: "acme",
      contributes: { skills: "./skills", mcpServers: { echo: { command: ["echo"] } } },
    })
    await write(
      path.join(home, ".claude", "plugins", "ppt-master", "plugin.json"),
      '{"name":"ppt-master","version":"1.0.0"}',
    )
    await inProject(directory, "local-pack", {
      name: "local-pack",
      apiVersion: 2,
      kind: "declarative",
      contributes: { tools: [{ id: "ping", description: "ping", parameters: { type: "object" } }] },
    })
    await materialize("demo@1.2.3", "demo")

    const list = await PluginHost.discover(
      input({
        plugins: [npm("demo@1.2.3")],
        tuiPlugins: [{ spec: "theme-pack", source: path.join(config, "tui.json"), scope: "global" }],
      }),
    )

    // global 排在 project 前，同 scope 同 priority 按 id 字典序（§10.2 的确定性）
    expect(list.map((item) => item.id)).toEqual(["acme", "demo", "ppt-master", "theme-pack", "local-pack"])

    const acme = pick(list, "acme")
    expect(acme?.origin).toBe("extension")
    expect(acme?.adapter).toBe("legacy-extension")
    expect(acme?.scope).toBe("global")
    expect(acme?.status).toBe("discovered")
    expect(acme?.contributions).toBe(2)

    const claude = pick(list, "ppt-master")
    if (claude?.location.kind !== "directory") throw new Error("旧 Claude 包应按目录发现")
    expect(claude.location.label).toBe("claude")
    expect(claude.location.file).toContain(path.join("ppt-master", "plugin.json"))

    // 项目目录下的扩展是 project scope；带 apiVersion=2 的包直接走 v2 归一化
    const local = pick(list, "local-pack")
    expect(local?.scope).toBe("project")
    expect(local?.adapter).toBe("v2")
    expect(local?.contributions).toBe(1)

    expect(pick(list, "demo")?.adapter).toBe("legacy-config-plugin")
    expect(pick(list, "demo")?.origin).toBe("config-plugin")
    expect(pick(list, "theme-pack")?.adapter).toBe("legacy-tui")
  })

  test("trusted package root discovers the shipped builtin bundle", async () => {
    const list = await PluginHost.inspect({ ...input(), builtin: undefined }).then((result) => result.instances)
    const builtin = pick(list, "novaway-ui")

    expect(builtin?.scope).toBe("builtin")
    expect(builtin?.status).toBe("installed")
    expect(builtin?.adapter).toBe("v2")
    expect(builtin?.location.kind).toBe("directory")
    if (builtin?.location.kind === "directory") expect(builtin.location.label).toBe("builtin")
  })

  test("约定目录型扩展（无 manifest）按 legacy-extension 收，贡献数为 0 而不是 invalid", async () => {
    await fs.mkdir(path.join(config, "extensions", "conventional", "skills"), { recursive: true })

    const list = await PluginHost.discover(input())
    const inst = pick(list, "conventional")
    expect(inst?.status).toBe("discovered")
    expect(codes(inst)).toContain("no_manifest")
    // 约定目录是加载期的事，索引期看不见（§6.5）
    expect(inst?.contributions).toBe(0)
  })

  test("does not cache declarations when the manifest changes during the read", async () => {
    const dir = await v2("changing", {
      contributes: { tools: [{ id: "before", description: "before", parameters: { type: "object" } }] },
    })
    const manifest = path.join(dir, "plugin.json")
    const originalRead = fs.readFile
    let changed = false
    fs.readFile = (async (file: PathLike, options?: unknown) => {
      const result = await originalRead(file, options as BufferEncoding)
      if (!changed && path.resolve(String(file)) === path.resolve(manifest)) {
        changed = true
        await write(
          manifest,
          JSON.stringify({
            name: "changing",
            apiVersion: 2,
            contributes: { tools: [{ id: "after", description: "after", parameters: { type: "object" } }] },
          }),
        )
      }
      return result
    }) as typeof fs.readFile
    try {
      const first = await PluginHost.discover(input())
      expect(pick(first, "changing")?.manifest.contributes.tools).toEqual([
        { id: "before", description: "before", parameters: { type: "object" } },
      ])
      const second = await PluginHost.discover(input())
      expect(pick(second, "changing")?.manifest.contributes.tools).toEqual([
        { id: "after", description: "after", parameters: { type: "object" } },
      ])
    } finally {
      fs.readFile = originalRead
    }
  })

  test("caches parsed declarations and invalidates when manifest metadata changes", async () => {
    const dir = await v2("cached", {
      contributes: { tools: [{ id: "first", description: "first", parameters: { type: "object" } }] },
    })
    const first = await PluginHost.discover(input())
    const firstManifest = first.find((item) => item.id === "cached")?.manifest
    const warm = await PluginHost.discover(input())
    expect(warm.find((item) => item.id === "cached")?.manifest).toBe(firstManifest)

    await write(
      path.join(dir, "plugin.json"),
      JSON.stringify({
        name: "cached",
        apiVersion: 2,
        contributes: { tools: [{ id: "second", description: "second", parameters: { type: "object" } }] },
      }),
    )
    const changed = await PluginHost.discover(input())
    expect(changed.find((item) => item.id === "cached")?.manifest.contributes.tools).toEqual([
      { id: "second", description: "second", parameters: { type: "object" } },
    ])
  })

  test("manifest 坏了 → invalid，且不牵连别人", async () => {
    await write(path.join(config, "extensions", "broken", "plugin.json"), "{ oops")
    await pack("fine", { name: "fine" })

    const list = await PluginHost.discover(input())
    expect(pick(list, "broken")?.status).toBe("invalid")
    expect(codes(pick(list, "broken"))).toContain("manifest_json")
    expect(pick(list, "fine")?.status).toBe("discovered")
  })

  test("NOVAWAY_PLUGINS=off 时 discover 什么都不给（§10.6）", async () => {
    expect(await PluginHost.discover(input({ env: { NOVAWAY_PLUGINS: "off" } }))).toEqual([])
  })
})

describe("PluginHost.inspect", () => {
  test("目录型走到 installed，npm 未物化停在 discovered 并说明原因", async () => {
    await pack("ready", { name: "ready" })
    await materialize("demo@1.2.3", "demo")

    const result = await PluginHost.inspect(input({ plugins: [npm("demo@1.2.3"), npm("not-here@1.0.0")] }))

    expect(pick(result.instances, "ready")?.status).toBe("installed")
    const demo = pick(result.instances, "demo")
    expect(demo?.status).toBe("installed")
    if (demo?.location.kind !== "spec") throw new Error("spec 实例的 location 形态不对")
    expect(demo.location.target).toContain(path.join("node_modules", "demo"))
    expect(demo.location.declaredBy).toBe(path.join(config, "novaway.json"))
    const absent = pick(result.instances, "not-here")
    expect(absent?.status).toBe("discovered")
    expect(codes(absent)).toContain("not_resolved")
  })

  test("本地路径插件：id 没记着算 invalid，记着了但目标没了算 blocked", async () => {
    const missing = path.join(base, "nope", "index.ts")

    const bare = await PluginHost.inspect(input({ plugins: [npm(missing)] }))
    expect(bare.instances[0]?.status).toBe("invalid")
    expect(bare.instances[0]?.issues.map((item) => item.code)).toContain("name_missing")

    const gone = await PluginHost.inspect(
      input({ plugins: [npm(missing)], meta: { "local-dev": entry("local-dev", missing, 1, { source: "file" }) } }),
    )
    expect(gone.instances[0]?.status).toBe("blocked")
    expect(codes(gone.instances[0])).toContain("target_missing")
  })

  test("本地路径插件目标存在 → installed", async () => {
    const file = path.join(base, "dev", "index.ts")
    await write(file, 'export default { id: "dev-tools" }\n')

    const result = await PluginHost.inspect(
      input({ plugins: [npm(file)], meta: { "dev-tools": entry("dev-tools", file, 1, { source: "file" }) } }),
    )
    const inst = pick(result.instances, "dev-tools")
    expect(inst?.status).toBe("installed")
    if (inst?.location.kind !== "spec") throw new Error("spec 实例的 location 形态不对")
    expect(inst.location.target).toBe(file)
  })

  test("plugin-meta 记着的 id 取代从 spec 猜出的 id，并带来安装顺序", async () => {
    await materialize("acme-tools@2.0.0", "acme-tools")
    const result = await PluginHost.inspect(
      input({
        plugins: [npm("acme-tools@2.0.0")],
        meta: { "the-real-id": entry("the-real-id", "acme-tools@2.0.0", 10, { version: "2.0.0" }) },
      }),
    )
    const inst = pick(result.instances, "the-real-id")
    expect(inst?.status).toBe("installed")
    expect(inst?.installOrder).toBe(10)
    expect(inst?.issues.filter((item) => item.code === "name_normalized")).toEqual([])
  })

  test("apiVersion 太高是 blocked，不是 invalid（§10.1）", async () => {
    await pack("future", { name: "future", apiVersion: 3, kind: "declarative", contributes: {} })

    const result = await PluginHost.inspect(input())
    const inst = pick(result.instances, "future")
    expect(inst?.status).toBe("blocked")
    expect(codes(inst)).toContain("api_version")
  })

  test("engines 不满足 → blocked；0.x 宿主豁免", async () => {
    await pack("needs-new-host", { name: "needs-new-host", engines: { novaway: ">=99.0.0" } })

    const strict = await PluginHost.inspect(input({ version: "2.1.0" }))
    expect(pick(strict.instances, "needs-new-host")?.status).toBe("blocked")
    expect(codes(pick(strict.instances, "needs-new-host"))).toContain("engines_unsatisfied")

    const dev = await PluginHost.inspect(input({ version: "0.0.1" }))
    expect(pick(dev.instances, "needs-new-host")?.status).toBe("installed")
  })

  test("依赖缺失/版本不符/被停用分别 blocked，且不自动启用依赖", async () => {
    await pack("needs-absent", { name: "needs-absent", dependencies: { ghost: ">=1.0.0" } })
    await pack("base", { name: "base", version: "1.0.0" })
    await pack("needs-base", { name: "needs-base", dependencies: { base: ">=2.0.0" } })

    const result = await PluginHost.inspect(input())
    expect(codes(pick(result.instances, "needs-absent"))).toContain("dependency_missing")
    expect(pick(result.instances, "needs-base")?.status).toBe("blocked")
    expect(codes(pick(result.instances, "needs-base"))).toContain("dependency_version")

    const stopped = await PluginHost.inspect(input({ disabled: ["base"] }))
    expect(pick(stopped.instances, "base")?.status).toBe("disabled")
    expect(codes(pick(stopped.instances, "needs-base"))).toContain("dependency_disabled")
  })

  test("持久化禁用键可只禁用指定 scope，同时兼容裸 id 全局禁用", async () => {
    await pack("copy-global", { name: "shared" })
    await inProject(directory, "copy-project", { name: "shared" })

    const scoped = await PluginHost.inspect(input({ disabled: ["global:shared"] }))
    expect(one(scoped.instances, "shared").map((item) => item.status)).toEqual(["disabled", "installed"])

    const legacy = await PluginHost.inspect(input({ disabled: ["shared"] }))
    expect(one(legacy.instances, "shared").map((item) => item.status)).toEqual(["disabled", "disabled"])
  })

  test("explicit scope enable is revalidated and cannot bypass safe mode", async () => {
    await pack("copy-global", { name: "shared" })
    await inProject(directory, "copy-project", { name: "shared" })
    const enabled = await PluginHost.inspect(input({ disabled: ["shared"], enabled: ["project:shared"] }))
    expect(one(enabled.instances, "shared").map((item) => item.status)).toEqual(["disabled", "installed"])

    const safe = await PluginHost.inspect(
      input({ disabled: ["shared"], enabled: ["project:shared"], env: { NOVAWAY_SAFE_MODE: "1" } }),
    )
    expect(one(safe.instances, "shared").map((item) => item.status)).toEqual(["disabled", "disabled"])
    expect(codes(one(safe.instances, "shared").find((item) => item.scope === "project"))).toContain("safe_mode")
  })

  test("依赖成环：环上全部 blocked 且给出环路径", async () => {
    await pack("left", { name: "left", dependencies: { right: "" } })
    await pack("right", { name: "right", dependencies: { left: "" } })

    const result = await PluginHost.inspect(input())
    expect(result.cycles).toEqual([["left", "right", "left"]])
    expect(pick(result.instances, "left")?.status).toBe("blocked")
    expect(pick(result.instances, "right")?.status).toBe("blocked")
    expect(codes(pick(result.instances, "left"))).toContain("dependency_cycle")
  })

  test("贡献路径逃出插件目录 → blocked", async () => {
    await pack("escaper", { name: "escaper", contributes: { skills: ["../outside"] } })

    const result = await PluginHost.inspect(input())
    const inst = pick(result.instances, "escaper")
    expect(inst?.status).toBe("blocked")
    expect(codes(inst)).toContain("path_escape")
  })

  test("同 id 跨 scope：高 scope 整体替换，低的标 overridden（§10.5）", async () => {
    await pack("copy-global", { name: "shared", version: "1.0.0" })
    await inProject(directory, "copy-project", { name: "shared", version: "2.0.0" })

    const result = await PluginHost.inspect(input())
    const group = one(result.instances, "shared")
    expect(group.length).toBe(2)
    // 列表按 scope 顺序输出，global 在前；被覆盖的是它
    expect(group.map((item) => item.status)).toEqual(["overridden", "installed"])
    expect(group[0]?.overriddenBy).toContain("copy-project")
    expect(group[1]?.scope).toBe("project")
  })

  test("同 id 同 scope 是两个来源 → 低顺序的一方 blocked（§4.8 没分开它们）", async () => {
    await pack("aaa-twin", { name: "twin", description: "first" })
    await pack("bbb-twin", { name: "twin", description: "second" })

    const result = await PluginHost.inspect(input())
    expect(one(result.instances, "twin").map((item) => item.status)).toEqual(["installed", "blocked"])
    expect(codes(one(result.instances, "twin")[1])).toContain("id_conflict")
  })

  test("显式 overrides：全量覆盖标 overridden，指错目标给诊断", async () => {
    await v2("vanilla", { contributes: { tools: [{ id: "search", description: "s", parameters: {} }] } })
    await v2("replacer", { overrides: ["vanilla", "ghost:tool"] })

    const result = await PluginHost.inspect(input())
    expect(pick(result.instances, "vanilla")?.status).toBe("overridden")
    expect(pick(result.instances, "vanilla")?.overriddenBy).toContain("replacer")
    expect(codes(pick(result.instances, "replacer"))).toContain("override_unknown")
  })

  test("单项覆盖只登记被覆盖的贡献，原插件状态不变", async () => {
    await v2("partial-target", {
      contributes: {
        tools: [
          { id: "one", description: "1", parameters: {} },
          { id: "two", description: "2", parameters: {} },
        ],
      },
    })
    await v2("partial-source", { priority: 10, overrides: ["partial-target:one"] })

    const result = await PluginHost.inspect(input())
    const target = pick(result.instances, "partial-target")
    expect(target?.status).toBe("installed")
    expect(target?.diagnostics.find((item) => item.code === "override_partial")?.message).toContain(
      "partial-target:one",
    )
  })

  test("scope 低于目标时 overrides 不生效", async () => {
    await inProject(directory, "higher", { name: "higher", apiVersion: 2, kind: "declarative" })
    await v2("lower", { priority: 100, overrides: ["higher"] })

    const result = await PluginHost.inspect(input())
    expect(pick(result.instances, "higher")?.status).toBe("installed")
    expect(codes(pick(result.instances, "lower"))).toContain("override_ignored")
  })

  test("同一 spec 被 novaway.json 与 tui.json 声明 → 一个实例，两种入口", async () => {
    await materialize("both-ways", "both-ways")
    const result = await PluginHost.inspect(
      input({
        plugins: [npm("both-ways")],
        tuiPlugins: [{ spec: "both-ways", source: path.join(config, "tui.json"), scope: "global" }],
      }),
    )
    const group = one(result.instances, "both-ways")
    expect(group.length).toBe(1)
    expect(group[0]?.origin).toBe("config-plugin")
    expect(codes(group[0])).toContain("duplicate_spec")
  })

  test("安全模式跳过非内置插件；紧急开关给出原因", async () => {
    await pack("safe-target", { name: "safe-target" })

    const safe = await PluginHost.inspect(input({ env: { NOVAWAY_SAFE_MODE: "1" } }))
    expect(pick(safe.instances, "safe-target")?.status).toBe("disabled")
    expect(codes(pick(safe.instances, "safe-target"))).toContain("safe_mode")

    const off = await PluginHost.inspect(input({ env: { NOVAWAY_PLUGINS: "off" } }))
    expect(off.instances).toEqual([])
    expect(off.skipped).toContain("NOVAWAY_PLUGINS=off")
  })

  test("输出顺序确定：scope → priority → 安装顺序 → id（§4.9、§10.2）", async () => {
    await inProject(directory, "in-project", { name: "in-project" })
    await pack("late", { name: "late" })
    await pack("high", { name: "high", priority: 5 })
    await pack("mid", { name: "mid", priority: 5 })
    await pack("low", { name: "low" })

    const result = await PluginHost.inspect(
      input({
        meta: {
          high: entry("high", "high@1.0.0", 1),
          mid: entry("mid", "mid@1.0.0", 2),
        },
      }),
    )
    expect(result.instances.map((item) => item.id)).toEqual(["high", "mid", "late", "low", "in-project"])
  })

  test("注册表短名 ↔ manifest 长名映射只在 host 一处（§3、§10.9）", () => {
    expect(PluginHost.registryKey("officeEngines")).toBe("office")
    expect(PluginHost.registryKey("publishDrivers")).toBe("publish")
    expect(PluginHost.registryKey("surfaces")).toBe("surfaces")
    expect(PluginHost.manifestKey("office")).toBe("officeEngines")
    expect(PluginHost.manifestKey("surfaces")).toBe("surfaces")
    expect(PluginHost.manifestKey("nope")).toBeUndefined()
  })
})
