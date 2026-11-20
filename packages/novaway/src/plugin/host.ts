import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import semver from "semver"
import type { ContributesKey, Manifest, PluginStatus } from "@novaway/plugin-api"
import { contributesKeys } from "@novaway/plugin-api"
import { Global } from "@novaway/core/global"
import { InstallationVersion } from "@novaway/core/installation/version"
import { Npm } from "@novaway/core/npm"
import { ConfigPlugin } from "@/config/plugin"
import { ExtensionLoader } from "@/extension/loader"
import type { Loaded } from "@/extension/schema"
import { isRecord } from "@/util/record"
import { PluginManifest } from "./manifest"
import { PluginMeta } from "./meta"
import { parsePluginSpecifier, pluginSource, readPluginPackage } from "./shared"

/**
 * PluginHost 的只读半边（§14.3 第 4 步）：发现 → 校验 → 状态机，**不激活、不安装、不联网**。
 *
 * 三套旧机制在这里第一次汇成同一个列表：
 * - 目录型：旧 Extension / Claude 包 / 已带 v2 `plugin.json` 的包，分别走 §13.1 的 `legacy-extension` 与 v2 两条归一化；
 * - spec 型：`novaway.json` 的 `plugin`，走 `legacy-config-plugin`；
 * - TUI 型：`tui.json` 的 `plugin`，走 `legacy-tui`。
 *
 * 为什么停在 `installed`：`resolve` 要装 npm/git 包，那是网络和子进程；发现期做了它，
 * 冷启动就再也回不去（§14.3 第 11 步要求 `discover` < 30ms）。所以这里只**探测**目标是否已物化：
 * 已物化算 `installed`，npm/git 未物化留在 `discovered`，本地路径不存在算 `blocked`。
 *
 * 安全模式（§10.6）在这里只体现在状态上：非内置一律 `disabled`。「内置插件只保留
 * `builtin.providers`」要等 M2 真的有了内置插件包才能做。
 */

/** 哪个发现渠道产出的实例。与 `adapter`（归一化路径）不是一回事：目录型既可能是 legacy 也可能是 v2。 */
export type Origin = "extension" | "config-plugin" | "tui"
export type Adapter = "v2" | "legacy-extension" | "legacy-config-plugin" | "legacy-tui"
export type Scope = "builtin" | "global" | "project" | "session"

export type Location =
  | { kind: "directory"; root: string; file?: string; label: Loaded["source"] }
  | { kind: "spec"; spec: string; declaredBy: string; target?: string; tui?: boolean }

/** 解析期的问题来自 `PluginManifest`；这里的编码只覆盖 Host 自己的 validate/resolve 两段（§10.2）。 */
export type HostCode =
  | "api_version"
  | "engines_unsatisfied"
  | "engines_format"
  | "dependency_missing"
  | "dependency_disabled"
  | "dependency_version"
  | "dependency_cycle"
  | "conflict"
  | "path_escape"
  | "id_conflict"
  | "duplicate_spec"
  | "not_resolved"
  | "target_missing"
  | "manifest_json"
  | "no_manifest"
  | "disabled"
  | "safe_mode"
  | "overridden"
  | "override_unknown"
  | "override_ignored"
  | "override_partial"

export type HostIssue = { level: "error" | "warning"; code: HostCode; message: string; field?: string }

export type Instance = {
  id: string
  status: PluginStatus
  scope: Scope
  origin: Origin
  adapter: Adapter
  manifest: Manifest
  location: Location
  /** 解析期（§10.2 的 parse），由 `PluginManifest` 报出。 */
  issues: PluginManifest.Issue[]
  /** 校验与目标解析期（validate/resolve），由这里报出。 */
  diagnostics: HostIssue[]
  /** §4.9 排序键 2「安装顺序」。`plugin_state` 还没上线（第 7 步），先用 `plugin-meta.json` 的 first_time。 */
  installOrder?: number
  overriddenBy?: string
  /** manifest 索引期可见的贡献条目数，用来区分「装了但索引期看不见贡献」和「装了且有贡献」。 */
  contributions: number
}

export type Result = {
  instances: Instance[]
  /** §4.9：有环时环上全部 `blocked`，环路径要给出来。 */
  cycles: string[][]
  /** §10.6 紧急开关生效时写在这里——列表为空不等于「没有插件」。 */
  skipped?: string
}

export type Input = ExtensionLoader.Roots & {
  /** `novaway.json` 的 `plugin`（带 scope/source）。 */
  plugins?: ConfigPlugin.Origin[]
  /** `tui.json` 的 `plugin`。 */
  tuiPlugins?: ConfigPlugin.Origin[]
  /** `<config>/extensions.json` 的 `disabled`；第 7 步之后换成 `plugin_state.enabled`。 */
  disabled?: string[]
  /** Explicit per-scope user approval overrides persisted/config disable, never safe mode. */
  enabled?: string[]
  /** engines 比较用的宿主版本，默认当前构建版本。 */
  version?: string
  /** npm/git 物化目录的探测根，默认 `Global.Path.cache`；测试用临时目录覆盖。 */
  cache?: string
  /** 默认读 `plugin-meta.json`：它记着 spec → 模块导出 id 与首次安装时间。 */
  meta?: Record<string, PluginMeta.Entry>
  env?: Record<string, string | undefined>
}

/** 宿主实现的 API 版本（§7）。更高的版本直接 `blocked`，不做「尽力解析」。 */
const SUPPORTED_API_VERSION = 2
const INDEX_CACHE_LIMIT = 512
type IndexedManifest = PluginManifest.Decoded & { contributions: number }
const indexCache = new Map<string, IndexedManifest>()

const SCOPE_RANK: Record<Scope, number> = { builtin: 0, global: 1, project: 2, session: 3 }

/**
 * manifest 长名 ↔ 注册表短名的唯一一份映射（§3、§10.9）：
 * 作者写 `officeEngines` / `publishDrivers`，注册表与 API 用 `office` / `publish`。
 */
const REGISTRY_KEYS: Partial<Record<ContributesKey, string>> = { officeEngines: "office", publishDrivers: "publish" }

export function registryKey(key: ContributesKey) {
  return REGISTRY_KEYS[key] ?? key
}

/** 反查：注册表短名回 manifest 键。两种写法都接受；不是已知贡献点时返回 undefined。 */
export function manifestKey(key: string): ContributesKey | undefined {
  return contributesKeys.find((item) => item === key || registryKey(item) === key)
}

/** 只跑到 parse：给 §14.3 第 11 步的启动性能基线用。 */
export function clearIndexCache() {
  indexCache.clear()
}

export async function discover(input: Input): Promise<Instance[]> {
  const prepared = await prepare(input)
  if (!prepared) return []
  return order(await collect(prepared))
}

export async function inspect(input: Input): Promise<Result> {
  const prepared = await prepare(input)
  if (!prepared) {
    return {
      instances: [],
      cycles: [],
      skipped: "NOVAWAY_PLUGINS=off：只有内核工具与基础 UI（§10.6）",
    }
  }
  const list = await collect(prepared)
  const winners = indexById(list)
  const cycles = findCycles(winners)
  applyUserState(list, prepared)
  validate(list, winners, cycles, prepared)
  await resolveTargets(list, prepared)
  applyShadowing(list, winners)
  return { instances: order(list), cycles }
}

type Prepared = {
  roots: ExtensionLoader.Roots
  version: string
  cache: string
  env: Record<string, string | undefined>
  disabled: Set<string>
  enabled: Set<string>
  meta: Record<string, PluginMeta.Entry>
  bySpec: Map<string, { id: string; installOrder?: number }>
  server: ConfigPlugin.Origin[]
  tui: ConfigPlugin.Origin[]
}

async function prepare(input: Input): Promise<Prepared | undefined> {
  const env = input.env ?? process.env
  if (env.NOVAWAY_PLUGINS === "off") return undefined
  const meta = input.meta ?? (await PluginMeta.list().catch(() => undefined)) ?? {}
  const bySpec = new Map<string, { id: string; installOrder?: number }>()
  for (const [id, entry] of Object.entries(meta)) bySpec.set(entry.spec, { id, installOrder: entry.first_time })
  return {
    roots: input,
    version: input.version ?? InstallationVersion,
    cache: input.cache ?? Global.Path.cache,
    env,
    disabled: new Set(input.disabled ?? []),
    enabled: new Set(input.enabled ?? []),
    meta,
    bySpec,
    server: input.plugins ?? [],
    tui: input.tuiPlugins ?? [],
  }
}

/** 发现 + 解析：状态只到 `discovered` / `invalid`（§10.2 的前两行）。 */
async function collect(p: Prepared): Promise<Instance[]> {
  const out: Instance[] = []
  const seen = new Set<string>()
  for (const { root, source } of ExtensionLoader.roots(p.roots)) {
    for (const dir of await ExtensionLoader.discover(root)) {
      const key = path.resolve(dir)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(await directoryInstance(dir, source, p))
    }
  }
  for (const [origin, items] of [["config-plugin", p.server] as const, ["tui", p.tui] as const]) {
    for (const item of items) out.push(await specInstance(origin, item, p))
  }
  return dedupe(out)
}

async function directoryInstance(dir: string, label: Loaded["source"], p: Prepared): Promise<Instance> {
  const fallbackName = path.basename(dir)
  const hit = await ExtensionLoader.readRawManifest(dir)
  // loader.implicit() 认约定目录型插件（只有 skills/commands/agents，没有 manifest）；
  // 旧加载器照样收它，这里补一份只有名字的清单，不能因为「没文件」判 invalid。
  const decoded: IndexedManifest =
    hit === undefined
      ? {
          ...PluginManifest.parseFile({ name: fallbackName }, { file: path.join(dir, "plugin.json"), fallbackName }),
          contributions: 0,
        }
      : await indexedManifest(hit.file, hit.raw, fallbackName, p.version, hit.fingerprint)
  const instance: Instance = {
    id: decoded.manifest.name,
    status: parseStatus(decoded.issues),
    scope: scopeOf(dir, label, p),
    origin: "extension",
    adapter: decoded.source === "v2" ? "v2" : "legacy-extension",
    manifest: decoded.manifest,
    location: { kind: "directory", root: dir, ...(hit === undefined ? {} : { file: hit.file }), label },
    issues: decoded.issues,
    diagnostics: [],
    installOrder: p.meta[decoded.manifest.name]?.first_time,
    contributions: hit === undefined ? contributionCount(decoded.manifest) : decoded.contributions,
  }
  if (hit === undefined) {
    push(instance, "warning", "no_manifest", `无 manifest 文件，按约定目录发现（§13.1）：${dir}`)
  }
  if (hit?.error !== undefined) {
    // 读坏文件属 discover/parse 失败：记 invalid，继续别的插件（§10.2）。
    push(instance, "error", "manifest_json", `manifest 读取失败：${hit.error}`, hit.file)
    instance.status = "invalid"
  }
  return instance
}

async function indexedManifest(
  file: string,
  raw: unknown,
  fallbackName: string,
  hostVersion: string,
  fingerprint?: { mtimeMs: number; ctimeMs: number; size: number },
) {
  const resolved = path.resolve(file)
  const key =
    fingerprint === undefined
      ? undefined
      : JSON.stringify([resolved, fingerprint.mtimeMs, fingerprint.size, SUPPORTED_API_VERSION, hostVersion])
  const cached = key === undefined ? undefined : indexCache.get(key)
  if (cached !== undefined) return cached
  const decoded = PluginManifest.parseFile(raw, { file, fallbackName })
  const value: IndexedManifest = { ...decoded, contributions: contributionCount(decoded.manifest) }
  const afterRead = await fs.stat(resolved).catch(() => undefined)
  if (
    key !== undefined &&
    afterRead !== undefined &&
    fingerprint?.mtimeMs === afterRead.mtimeMs &&
    fingerprint.ctimeMs === afterRead.ctimeMs &&
    fingerprint.size === afterRead.size
  ) {
    if (indexCache.size >= INDEX_CACHE_LIMIT) indexCache.delete(indexCache.keys().next().value!)
    indexCache.set(key, value)
  }
  return value
}

async function specInstance(
  origin: "config-plugin" | "tui",
  item: ConfigPlugin.Origin,
  p: Prepared,
): Promise<Instance> {
  const spec = ConfigPlugin.pluginSpecifier(item.spec)
  const remembered = p.bySpec.get(spec)
  const target = remembered === undefined && pluginSource(spec) === "file" ? await probeSpec(spec, p.cache) : undefined
  const pkg = target === undefined ? undefined : await readPluginPackage(target).catch(() => undefined)
  const staticName = typeof pkg?.json.name === "string" ? pkg.json.name : undefined
  const decoded = PluginManifest.parseConfigSpec(item.spec, {
    source: item.source,
    scope: item.scope,
    name: remembered?.id ?? staticName,
  })
  return {
    id: decoded.manifest.name,
    status: parseStatus(decoded.issues),
    scope: item.scope === "local" ? "project" : "global",
    origin,
    adapter: origin === "tui" ? "legacy-tui" : "legacy-config-plugin",
    manifest: decoded.manifest,
    location: { kind: "spec", spec, declaredBy: item.source, ...(origin === "tui" ? { tui: true } : {}) },
    issues: decoded.issues,
    diagnostics: [],
    installOrder: remembered?.installOrder,
    contributions: 0,
  }
}

/**
 * `apiVersion` 太高属 validate（§10.1 的 blocked），不当 parse 失败处理；其余 error 才是 `invalid`。
 */
function parseStatus(issues: PluginManifest.Issue[]): PluginStatus {
  const fatal = issues.some((item) => item.level === "error" && item.code !== "api_version")
  return fatal ? "invalid" : "discovered"
}

/**
 * 同一份 spec 同时出现在 `novaway.json` 与 `tui.json` 时是一个安装实例的两个 kind 入口，
 * 不是两个插件（§10.5 的「同名插件」讲的是 scope 冲突）。以 server 侧为代表。
 */
function dedupe(list: Instance[]): Instance[] {
  const out: Instance[] = []
  const seen = new Map<string, Instance>()
  for (const inst of list) {
    if (inst.location.kind !== "spec") {
      out.push(inst)
      continue
    }
    const key = `${inst.scope}\u0000${inst.location.spec.toLowerCase()}`
    const hit = seen.get(key)
    if (hit !== undefined) {
      if (inst.origin === "tui" && hit.location.kind === "spec") hit.location.tui = true
      push(
        hit,
        "warning",
        "duplicate_spec",
        `${inst.origin === "tui" ? "tui.json" : "novaway.json"} 一侧声明了同一 spec（${inst.location.spec}）：一个安装实例，server/tui 两种入口`,
      )
      continue
    }
    seen.set(key, inst)
    out.push(inst)
  }
  return out
}

function scopeOf(dir: string, label: Loaded["source"], p: Prepared): Scope {
  if (label === "builtin") return "builtin"
  if (label === "session") return "session"
  const bases = [p.roots.directory, p.roots.worktree].filter((item) => item !== "")
  if (bases.some((base) => isInside(base, dir))) return "project"
  if (label === "project") return "project"
  return "global"
}

/** 每个 id 只有一条实例能代表「装了这个插件」：依赖查找、覆盖目标查找都走这里。 */
function indexById(list: Instance[]): Map<string, Instance> {
  const out = new Map<string, Instance>()
  for (const inst of list) {
    const hit = out.get(inst.id)
    if (hit === undefined || better(inst, hit)) out.set(inst.id, inst)
  }
  return out
}

/** 排序键：scope 高 → priority 高 → 安装早 → id 字典序 → 位置（§4.9 + §10.2 的确定性要求）。 */
function better(a: Instance, b: Instance) {
  const scope = SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope]
  if (scope !== 0) return scope > 0
  const priority = (a.manifest.priority ?? 0) - (b.manifest.priority ?? 0)
  if (priority !== 0) return priority > 0
  const installed = num(b.installOrder) - num(a.installOrder)
  if (installed !== 0) return installed > 0
  return a.id === b.id && locationKey(a) < locationKey(b)
}

function locationKey(inst: Instance) {
  return inst.location.kind === "directory" ? inst.location.root : inst.location.spec
}

/** §4.9：`dependencies` 是硬依赖，有环则环上全部 `blocked` 并给出环路径。 */
function findCycles(winners: Map<string, Instance>): string[][] {
  const stack: string[] = []
  const onStack = new Set<string>()
  const done = new Set<string>()
  const cycles: string[][] = []
  const visit = (id: string) => {
    if (done.has(id)) return
    if (onStack.has(id)) {
      cycles.push([...stack.slice(stack.indexOf(id)), id])
      return
    }
    onStack.add(id)
    stack.push(id)
    for (const dep of Object.keys(winners.get(id)?.manifest.dependencies ?? {})) {
      if (winners.has(dep)) visit(dep)
    }
    stack.pop()
    onStack.delete(id)
    done.add(id)
  }
  for (const id of [...winners.keys()].sort()) visit(id)
  return uniqueCycles(cycles)
}

/** A→B→A 与 B→A→B 是同一个环，只报一次。 */
function uniqueCycles(cycles: string[][]) {
  const out: string[][] = []
  const seen = new Set<string>()
  for (const cycle of cycles) {
    const key = [...new Set(cycle)].sort().join("\u0000")
    if (seen.has(key)) continue
    seen.add(key)
    out.push(cycle)
  }
  return out
}

function validate(list: Instance[], winners: Map<string, Instance>, cycles: string[][], p: Prepared) {
  const inCycle = new Map<string, string>()
  for (const cycle of cycles) {
    const trail = cycle.join(" → ")
    for (const id of new Set(cycle)) inCycle.set(id, trail)
  }
  for (const inst of list) {
    if (inst.status === "invalid") continue
    const cycle = inCycle.get(inst.id)
    if (cycle !== undefined) {
      push(inst, "error", "dependency_cycle", `依赖成环，环上全部 blocked（§4.9）：${cycle}`, "dependencies")
    } else {
      checkDependencies(inst, winners, p)
      checkConflicts(inst, winners)
    }
    checkApiVersion(inst)
    checkEngines(inst, p)
    checkPaths(inst)
    // 停用是用户意图，比「校验没过」更该显示出来；因此只改写还能用的实例。
    if (usable(inst) && inst.diagnostics.some((item) => item.level === "error")) inst.status = "blocked"
  }
}

function checkApiVersion(inst: Instance) {
  const declared = inst.manifest.apiVersion
  if (declared <= SUPPORTED_API_VERSION) return
  push(
    inst,
    "error",
    "api_version",
    `插件要求 apiVersion=${declared}，宿主只实现 v${SUPPORTED_API_VERSION}：拒绝加载，不做尽力解析（§7）`,
    "apiVersion",
  )
}

function checkDependencies(inst: Instance, winners: Map<string, Instance>, p: Prepared) {
  for (const [dep, range] of Object.entries(inst.manifest.dependencies ?? {})) {
    const hit = winners.get(dep)
    if (hit === undefined) {
      push(inst, "error", "dependency_missing", `硬依赖 "${dep}" 没有发现实例（§4.9）`, "dependencies")
      continue
    }
    if (hit.status === "disabled") {
      push(
        inst,
        "error",
        "dependency_disabled",
        `硬依赖 "${dep}" 已被停用；Host 不自动启用别人的插件（§4.9）`,
        "dependencies",
      )
      continue
    }
    if (range === "") continue
    const actual = hit.manifest.version ?? p.meta[hit.id]?.version
    if (actual === undefined) {
      push(inst, "warning", "dependency_version", `拿不到 "${dep}" 的版本，range "${range}" 无法校验`, "dependencies")
      continue
    }
    if (!semver.validRange(range)) {
      push(inst, "warning", "dependency_version", `"${dep}" 的版本范围 "${range}" 不是合法 semver`, "dependencies")
      continue
    }
    if (!semver.valid(actual) || !semver.satisfies(actual, range)) {
      push(inst, "error", "dependency_version", `硬依赖 "${dep}" 需要 ${range}，实际 ${actual}`, "dependencies")
    }
  }
}

function checkConflicts(inst: Instance, winners: Map<string, Instance>) {
  for (const conflict of inst.manifest.conflicts ?? []) {
    const hit = winners.get(conflict)
    if (hit === undefined || hit === inst || !usable(hit)) continue
    push(
      inst,
      "error",
      "conflict",
      `插件 "${inst.id}" 与已发现的插件 "${conflict}" 冲突；两者不能同时 active`,
      "conflicts",
    )
  }
}

function checkEngines(inst: Instance, p: Prepared) {
  const range = inst.manifest.engines?.novaway
  if (range === undefined || range === "") return
  if (!semver.validRange(range)) {
    push(inst, "warning", "engines_format", `engines.novaway "${range}" 不是合法 semver range`, "engines")
    return
  }
  // 与 shared.ts 的 checkPluginCompatibility 同一套豁免：0.x 开发构建不当兼容闸门。
  if (!semver.valid(p.version) || semver.major(p.version) === 0) return
  if (!semver.satisfies(p.version, range)) {
    push(
      inst,
      "error",
      "engines_unsatisfied",
      `插件要求 NovaWay ${range}，当前 ${p.version}（§10.2 validate）`,
      "engines",
    )
  }
}

/**
 * 贡献路径必须落在插件自己的目录里：一个 `../` 就能把 skills 指到工作区或别人的包目录，
 * §11 的隔离前提就没了。spec 型实例此刻还没有根目录，等 resolve 之后才能查。
 */
function checkPaths(inst: Instance) {
  if (inst.location.kind !== "directory") return
  const root = inst.location.root
  for (const item of declaredPaths(inst.manifest)) {
    if (isInside(root, path.resolve(root, item.value))) continue
    push(inst, "error", "path_escape", `贡献路径 "${item.value}" 落在插件目录之外（${root}）`, item.field)
  }
}

function declaredPaths(manifest: Manifest): Array<{ field: string; value: string }> {
  const result: Array<{ field: string; value: string }> = []
  const add = (field: string, value: unknown) => {
    if (typeof value === "string") {
      if (value !== "") result.push({ field, value })
      return
    }
    if (!Array.isArray(value)) return
    for (const [index, item] of value.entries()) {
      if (typeof item === "string") {
        result.push({ field: `${field}[${index}]`, value: item })
        continue
      }
      if (isRecord(item) && typeof item.entry === "string" && item.entry !== "") {
        result.push({ field: `${field}[${index}].entry`, value: item.entry })
      }
    }
  }
  add("main", manifest.main)
  for (const key of contributesKeys) {
    const value = manifest.contributes[key]
    add(`contributes.${key}`, value)
    if (key === "storage" && isRecord(value)) add("contributes.storage.migrations", value.migrations)
  }
  return result
}

async function resolveTargets(list: Instance[], p: Prepared) {
  for (const inst of list) {
    if (inst.status !== "discovered") continue
    if (inst.location.kind === "directory") {
      inst.status = "installed"
      continue
    }
    const target = await probeSpec(inst.location.spec, p.cache)
    if (target !== undefined) {
      inst.location = { ...inst.location, target }
      inst.status = "installed"
      continue
    }
    // 本地路径插件没有「装」这一步：目标不存在就是配置写错了，旧加载器同样报错。
    if (pluginSource(inst.location.spec) === "file") {
      push(inst, "error", "target_missing", `本地插件目标不存在：${inst.location.spec}（§10.2 resolve）`, "spec")
      inst.status = "blocked"
      continue
    }
    push(
      inst,
      "warning",
      "not_resolved",
      `目标未物化（${inst.location.spec}）：发现期不装包，等 plugin_install / 调用点接上 Host 再 resolve（§14.3 第 4 步不激活）`,
      "spec",
    )
  }
}

/**
 * 只探测不安装：npm/git 包落在 `<cache>/packages/<sanitize(spec)>/node_modules/<pkg>`，
 * 与 `Npm.add` 用的是同一个目录，所以这里能对上就等于真能加载。
 * 没有 git 时 git spec 走 `file:<cache>/git-archives/<hash>` 那条兜底路径，目录名要重算哈希，
 * 这里不猜——顶多把一个已装插件显示成 `discovered`。
 */
async function probeSpec(spec: string, cache: string) {
  if (pluginSource(spec) === "file") {
    const target = spec.startsWith("file://") ? fileURLToPath(spec) : path.resolve(spec)
    return (await exists(target)) ? target : undefined
  }
  const { pkg } = parsePluginSpecifier(spec)
  const addSpec = spec === pkg ? `${pkg}@latest` : spec
  const target = path.join(cache, "packages", Npm.sanitize(addSpec), "node_modules", pkg)
  return (await exists(target)) ? target : undefined
}

function applyUserState(list: Instance[], p: Prepared) {
  const safe = p.env.NOVAWAY_SAFE_MODE === "1"
  for (const inst of list) {
    if (!usable(inst)) continue
    if (
      !p.enabled.has(`${inst.scope}:${inst.id}`) &&
      (p.disabled.has(inst.id) || p.disabled.has(`${inst.scope}:${inst.id}`))
    ) {
      push(inst, "warning", "disabled", "用户停用（§10.1 disabled）")
      inst.status = "disabled"
      continue
    }
    if (safe && inst.scope !== "builtin") {
      push(inst, "warning", "safe_mode", "NOVAWAY_SAFE_MODE=1：跳过所有非内置插件（§10.6）")
      inst.status = "disabled"
    }
  }
}

/**
 * 两条覆盖路径：
 * - 同 id 多 scope：高 scope 整体替换，低的标 `overridden`（§10.5）；同 scope 撞同一个 id 是命名空间没分开，输的一方 `blocked`。
 * - 显式 `overrides`：声明者排名不低于目标才生效；全量覆盖把目标标 `overridden`，单项覆盖留给注册表（第 5 步）。
 */
function applyShadowing(list: Instance[], winners: Map<string, Instance>) {
  const groups = new Map<string, Instance[]>()
  for (const inst of list) groups.set(inst.id, [...(groups.get(inst.id) ?? []), inst])
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const winner = group.reduce((best, item) => (better(item, best) ? item : best))
    for (const inst of group) {
      if (inst === winner || !usable(inst)) continue
      if (inst.scope === winner.scope) {
        push(
          inst,
          "error",
          "id_conflict",
          `插件 id "${inst.id}" 在 ${inst.scope} 由两个来源声明（${locationKey(inst)} 与 ${locationKey(winner)}）：§4.8 的命名空间没分开它们，低顺序的一方不加载`,
          "name",
        )
        inst.status = "blocked"
        continue
      }
      inst.status = "overridden"
      inst.overriddenBy = locationKey(winner)
      push(
        inst,
        "warning",
        "overridden",
        `同 id 由 ${winner.scope} 的 ${locationKey(winner)} 胜出：scope 优先级 session > project > global > builtin，整体替换不合并字段（§10.5）`,
      )
    }
  }
  applyOverrides(list, winners)
}

function applyOverrides(list: Instance[], winners: Map<string, Instance>) {
  for (const source of list) {
    if (!usable(source)) continue
    for (const entry of source.manifest.overrides ?? []) {
      const split = entry.indexOf(":")
      const id = split < 0 ? entry : entry.slice(0, split)
      const item = split < 0 ? undefined : entry.slice(split + 1)
      const target = winners.get(id)
      if (target === undefined || target === source) {
        push(
          source,
          "warning",
          "override_unknown",
          `overrides 指向 "${entry}"，但没有发现的插件 "${id}"：覆盖不生效（§4.9）`,
          "overrides",
        )
        continue
      }
      if (!usable(target)) continue
      const ranked =
        SCOPE_RANK[source.scope] > SCOPE_RANK[target.scope] ||
        (SCOPE_RANK[source.scope] === SCOPE_RANK[target.scope] &&
          (source.manifest.priority ?? 0) >= (target.manifest.priority ?? 0))
      if (!ranked) {
        push(
          source,
          "warning",
          "override_ignored",
          `"${entry}"：${source.id} 的 scope 低于 ${target.id}，覆盖不生效（§4.9 按 scope 优先级定胜负）`,
          "overrides",
        )
        continue
      }
      if (item !== undefined) {
        push(
          target,
          "warning",
          "override_partial",
          `贡献 "${entry}" 被 ${source.id} 声明覆盖：只移除该项，其余照常生效；生效顺序由注册表裁定（§4.9、§14.3 第 5 步）`,
        )
        continue
      }
      if (target.overriddenBy !== undefined) continue
      target.status = "overridden"
      target.overriddenBy = locationKey(source)
      push(target, "warning", "overridden", `全部贡献被 ${source.id} 声明覆盖；覆盖者停用后自动恢复（§4.9）`)
    }
  }
}

function usable(inst: Instance) {
  return inst.status === "installed" || inst.status === "discovered"
}

function order(list: Instance[]) {
  return [...list].sort(
    (a, b) =>
      SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope] ||
      (b.manifest.priority ?? 0) - (a.manifest.priority ?? 0) ||
      num(a.installOrder) - num(b.installOrder) ||
      a.id.localeCompare(b.id) ||
      locationKey(a).localeCompare(locationKey(b)),
  )
}

function num(value: number | undefined) {
  return value ?? Number.MAX_SAFE_INTEGER
}

/**
 * 索引期可见的**声明**贡献数。`legacy.fallback` 里的键是 §13.1 用约定目录补出来的
 * （`skills/`、`commands/`、`agents/` 是否存在要等加载），不算插件自己的声明——
 * 否则每个旧包都显示「有 3 个贡献」，`/plugin` 里「装了但索引期看不见贡献」就看不出来了。
 */
function contributionCount(manifest: Manifest) {
  const fallback = new Set(conventionFallback(manifest))
  return contributesKeys.reduce((total, key) => {
    if (fallback.has(key)) return total
    const value = manifest.contributes[key]
    if (value === undefined) return total
    if (key === "storage") return total + (isRecord(value) ? 1 : 0)
    if (typeof value === "string") return total + 1
    if (Array.isArray(value)) return total + value.length
    if (isRecord(value)) return total + Object.keys(value).length
    return total
  }, 0)
}

function conventionFallback(manifest: Manifest): string[] {
  const legacy = manifest.legacy
  if (!isRecord(legacy) || !Array.isArray(legacy.fallback)) return []
  return legacy.fallback.filter((item): item is string => typeof item === "string")
}

async function exists(target: string) {
  return (await fs.stat(target).catch(() => undefined)) !== undefined
}

function isInside(parent: string, child: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  if (relative === "") return true
  return !relative.startsWith("..") && !path.isAbsolute(relative)
}

function push(inst: Instance, level: HostIssue["level"], code: HostCode, message: string, field?: string) {
  inst.diagnostics.push({ level, code, message, field })
}

export * as PluginHost from "./host"
