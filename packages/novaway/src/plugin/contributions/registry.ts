import type { ContributionKind, Disposable, PluginScope } from "@novaway/plugin-api"
import { pluginError } from "@novaway/plugin-api"

/**
 * 贡献注册表（§4.1、§4.8、§4.9）。
 *
 * 四个 M0 注册表（tool / agent / skill / command）共享这里的三件事，别在调用点各写一份：
 *
 * 1. **命名**（§4.8）：外部插件一律 `plugin_local`；内置插件声明 `global` 才保留原名，
 *    且撞内核保留名时照样命名空间化——旧提示词里的工具名不能坏。
 * 2. **同名怎么办**：累加型（tool / skill）追加 `_2` 后缀并写诊断，谁都不许静默消失；
 *    可覆盖型（agent / command）只留 rank 最优的一条。
 * 3. **显式覆盖**（§4.9）：`overrides` 里 `id` 覆盖整包、`id:name` 只覆盖一项；覆盖者一旦被
 *    停用或卸载，被覆盖的贡献自动恢复。恢复不是靠事件回调，而是因为可见集每次从
 *    「当前在册的记录」整体重算——没有增量状态就没有漏更新的机会。
 *
 * 名称分配顺序也必须确定（§4.2.1「工具块逐字节稳定」）：先按 rank 排好再发名，
 * 否则同一份配置两次启动可能给同一条贡献发出不同的 `_2` / `_3` 后缀。
 */

/** 贡献的来源信息，由 Host 在注册时绑定（§10.4：每个贡献绑 pluginID，停用时批量释放）。 */
export type Source = {
  pluginID: string
  /** Host 内部的实例所有权键；缺省时等于 pluginID。 */
  ownerID?: string
  /** Host-bound plugin root, never taken from a contribution's payload. */
  root?: string
  scope: PluginScope
  /** manifest 级排序键，默认 0（§4.9）。 */
  priority?: number
  /** `plugin_state.installed_at`；内置插件按 manifest 顺序。第 7 步之前由 `plugin-meta.json` 补。 */
  installOrder?: number
  /** manifest 的 `overrides` 原样传进来：`builtin.x` 覆盖整包，`builtin.x:contrib` 只覆盖一项。 */
  overrides?: string[]
}

/** 注册表里一条已发出最终名的贡献。 */
export type Entry<T> = {
  /** 最终名。模型、提示词、Agent 的 `tools` 白名单只认这个（§4.2.1）。 */
  name: string
  /** 作者写的本地名；`overrides` 的 `id:name` 两种写法都接受，用它区分。 */
  localName: string
  pluginID: string
  root?: string
  scope: PluginScope
  priority: number
  installOrder?: number
  item: T
}

export type Spec = { raw: string; target: string; contribution?: string }

export type DiagnosticCode = "collision" | "overridden" | "override_unknown" | "override_ignored"

export type Diagnostic = {
  level: "warning"
  code: DiagnosticCode
  kind: ContributionKind
  pluginID: string
  name: string
  message: string
}

/** 同名处理：可覆盖 / 累加（§4.8 末尾的清单）。 */
export type Policy = "override" | "accumulate"

/** 所有贡献项至少要带这两样；`global` 只有内置插件会写。 */
export type Item = { id: string; global?: boolean }

export type ContributionRegistry<T extends Item> = {
  readonly kind: ContributionKind
  readonly policy: Policy
  register(source: Source, item: T): Disposable
  /** 停用 / 卸载 / 激活失败：按 pluginID 批量释放（§10.4）。 */
  release(pluginID: string): void
  resolve(name: string): Entry<T> | undefined
  /** 已按 §4.9 排序的可见集；不可见的条目不在这里。 */
  list(): readonly Entry<T>[]
  diagnostics(): readonly Diagnostic[]
  onDidChange(fn: () => void): Disposable
}

export type OrderKey = { priority: number; installOrder?: number; name: string }

const SCOPE_RANK: Record<PluginScope, number> = { builtin: 0, global: 1, project: 2, session: 3 }

/**
 * §4.9 排序键：priority 降 → 安装顺序升 → 最终名字典序。所有注册表共用，调用点不许自己 sort。
 *
 * 字符串比较用码位序而不是 `localeCompare`：工具块进的是系统提示，比较结果跟着运行环境的
 * locale / ICU 变就会击穿 provider 的 prompt 缓存（§4.2.1 第 1 条）。
 */
export function orderContributions<T extends OrderKey>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) => b.priority - a.priority || num(a.installOrder) - num(b.installOrder) || compare(a.name, b.name),
  )
}

export function createRegistry<T extends Item>(input: {
  kind: ContributionKind
  policy: Policy
  /** 内核保留名（§4.8）：命中时即使 `global: true` 也要命名空间化。 */
  reserved?: ReadonlySet<string>
}): ContributionRegistry<T> {
  const held: Array<Held> = []
  const listeners = new Set<() => void>()
  let seq = 0
  let cache: Built | undefined

  type Held = { source: Source; item: T; seq: number }
  type Built = { entries: Entry<T>[]; diagnostics: Diagnostic[] }

  function build(): Built {
    const diagnostics: Diagnostic[] = []
    const named = nameAll(diagnostics)
    return { entries: orderContributions(applyOverrides(named, diagnostics)), diagnostics }
  }

  function nameAll(diagnostics: Diagnostic[]) {
    const taken = new Set<string>()
    const grouped = new Map<string, Entry<T>>()
    const out: Entry<T>[] = []
    for (const record of [...held].sort(byRank)) {
      const local = sanitize(record.item.id)
      // `global` 只对内置开放（§4.8「外部插件默认命名空间化」）：第三方声明了也当没写，
      // 否则 §4.9 想区分的「明确声明的第三方增强」和「劫持」就没有边界了。
      const keep =
        record.item.global === true && record.source.scope === "builtin" && !(input.reserved?.has(local) ?? false)
      const base = keep ? local : `${sanitize(record.source.pluginID)}_${local}`
      const entry = entryOf(record, local)
      if (input.policy === "override") {
        const hit = grouped.get(base)
        if (hit !== undefined) {
          diagnostics.push({
            level: "warning",
            code: "overridden",
            kind: input.kind,
            pluginID: record.source.pluginID,
            name: base,
            message: `${input.kind} "${base}" 已由 ${rankText(hit)} 提供，后来者不注册`,
          })
          continue
        }
        grouped.set(base, entry)
        entry.name = base
        out.push(entry)
        continue
      }
      entry.name = uniqueName(base, taken)
      if (entry.name !== base) {
        diagnostics.push({
          level: "warning",
          code: "collision",
          kind: input.kind,
          pluginID: record.source.pluginID,
          name: entry.name,
          message: `${input.kind} "${base}" 撞名，改用 "${entry.name}"（§4.8：不抛错、不静默丢弃）`,
        })
      }
      taken.add(entry.name)
      out.push(entry)
    }
    return out
  }

  function uniqueName(base: string, taken: Set<string>) {
    if (!taken.has(base)) return base
    let index = 2
    while (taken.has(`${base}_${index}`)) index += 1
    return `${base}_${index}`
  }

  /**
   * 反复收窄直到稳定：A 覆盖 B、C 又覆盖 A 时，A 自己都不见了就不该再把 B 拉下去（§4.9）。
   * 每轮只可能变短，所以轮数不超过条目数；`seen` 保证同一条诊断不会被多轮 pass 重复写。
   */
  function applyOverrides(entries: Entry<T>[], diagnostics: Diagnostic[]) {
    const seen = new Set<string>()
    let current = entries
    for (let pass = 0; pass <= entries.length; pass++) {
      const owners = groupByPlugin(current)
      const drop = new Set<Entry<T>>()
      for (const [pluginID, specs] of declarations(owners)) {
        const overrider = owners.get(pluginID)?.[0]
        if (overrider === undefined) continue
        for (const spec of specs) {
          if (spec.target === pluginID) continue
          const victims = owners.get(spec.target)
          if (victims === undefined) {
            pushOnce(seen, diagnostics, `unknown:${pluginID}:${spec.raw}`, () => ({
              level: "warning",
              code: "override_unknown",
              kind: input.kind,
              pluginID,
              name: spec.raw,
              message: `${pluginID} 声明覆盖 "${spec.raw}"，但本注册表（${input.kind}）里没有这个插件的贡献`,
            }))
            continue
          }
          const hits = victims.filter((victim) => spec.contribution === undefined || matches(victim, spec.contribution))
          if (hits.length === 0 && spec.contribution !== undefined) {
            pushOnce(seen, diagnostics, `unknown:${pluginID}:${spec.raw}`, () => ({
              level: "warning",
              code: "override_unknown",
              kind: input.kind,
              pluginID,
              name: spec.raw,
              message: `${pluginID} 声明覆盖 "${spec.raw}"，但本注册表（${input.kind}）里没有这一项`,
            }))
          }
          for (const victim of hits) {
            if (rankCompare(overrider, victim) < 0) {
              pushOnce(seen, diagnostics, `ignored:${pluginID}:${spec.raw}`, () => ({
                level: "warning",
                code: "override_ignored",
                kind: input.kind,
                pluginID,
                name: spec.raw,
                message: `${pluginID} 的 rank 低于 ${rankText(victim)}，覆盖 "${spec.raw}" 不生效（§4.9）`,
              }))
              continue
            }
            drop.add(victim)
          }
        }
      }
      if (drop.size === 0) break
      current = current.filter((item) => !drop.has(item))
    }
    return current
  }

  function declarations(owners: Map<string, Entry<T>[]>) {
    const out = new Map<string, Spec[]>()
    for (const record of held) {
      if (!owners.has(record.source.pluginID)) continue
      if (record.source.overrides === undefined) continue
      const specs = out.get(record.source.pluginID) ?? []
      out.set(record.source.pluginID, specs)
      for (const raw of record.source.overrides) {
        if (specs.some((item) => item.raw === raw)) continue
        const colon = raw.indexOf(":")
        specs.push({
          raw,
          target: colon === -1 ? raw : raw.slice(0, colon),
          contribution: colon === -1 ? undefined : raw.slice(colon + 1),
        })
      }
    }
    return out
  }

  function pushOnce(seen: Set<string>, diagnostics: Diagnostic[], key: string, make: () => Diagnostic) {
    if (seen.has(key)) return
    seen.add(key)
    diagnostics.push(make())
  }

  function entryOf(record: Held, localName: string): Entry<T> {
    return {
      name: localName,
      localName,
      pluginID: record.source.pluginID,
      ...(record.source.root === undefined ? {} : { root: record.source.root }),
      scope: record.source.scope,
      priority: record.source.priority ?? 0,
      installOrder: record.source.installOrder,
      item: record.item,
    }
  }

  function byRank(a: Held, b: Held) {
    return rankCompare(b.source, a.source) || a.seq - b.seq
  }

  function groupByPlugin(entries: Entry<T>[]) {
    const out = new Map<string, Entry<T>[]>()
    for (const entry of entries) {
      const list = out.get(entry.pluginID)
      if (list === undefined) out.set(entry.pluginID, [entry])
      else list.push(entry)
    }
    return out
  }

  function matches(entry: Entry<T>, target: string) {
    return entry.localName === target || entry.name === target || sanitize(target) === entry.name
  }

  function rankText(entry: Entry<T>) {
    const extra = [
      entry.priority === 0 ? undefined : `priority ${entry.priority}`,
      entry.installOrder === undefined ? undefined : `安装序号 ${entry.installOrder}`,
    ].filter((item) => item !== undefined)
    return `${entry.pluginID}（${entry.scope}${extra.length === 0 ? "" : `，${extra.join("，")}`}）`
  }

  function mutate() {
    cache = undefined
    // 快照一份：监听器可能在回调里 dispose 自己，直接迭代 Set 会在遍历中途改集合。
    const current = [...listeners]
    for (const fn of current) fn()
  }

  function visible() {
    cache ??= build()
    return cache
  }

  return {
    kind: input.kind,
    policy: input.policy,
    register(source, item) {
      // 在注册点就拒，不留到读取时：让报错发生在插件的 activate() 调用栈里，作者能看到自己那条贡献。
      if (sanitize(item.id) === "") {
        throw pluginError("contribution_invalid", `${input.kind} 贡献的 id "${item.id}" 归一化后为空`, {
          pluginID: source.pluginID,
          contributionID: item.id,
        })
      }
      const record: Held = { source, item, seq: seq++ }
      held.push(record)
      mutate()
      let disposed = false
      return {
        dispose() {
          if (disposed) return
          disposed = true
          const index = held.indexOf(record)
          if (index !== -1) held.splice(index, 1)
          mutate()
        },
      }
    },
    release(pluginID) {
      const before = held.length
      for (let index = held.length - 1; index >= 0; index -= 1) {
        if ((held[index].source.ownerID ?? held[index].source.pluginID) === pluginID) held.splice(index, 1)
      }
      if (held.length !== before) mutate()
    },
    resolve(name) {
      return visible().entries.find((item) => item.name === name)
    },
    list() {
      return visible().entries
    },
    diagnostics() {
      return visible().diagnostics
    },
    onDidChange(fn) {
      listeners.add(fn)
      return { dispose: () => void listeners.delete(fn) }
    },
  }
}

/** rank 比较：>0 表示 a 更该生效。scope 高 → priority 高 → 安装早 → pluginID 字典序小者优先（§4.8）。 */
function rankCompare(
  a: { scope: PluginScope; priority?: number; installOrder?: number; pluginID?: string },
  b: { scope: PluginScope; priority?: number; installOrder?: number; pluginID?: string },
) {
  const scope = SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope]
  if (scope !== 0) return scope
  const priority = (a.priority ?? 0) - (b.priority ?? 0)
  if (priority !== 0) return priority
  const install = num(b.installOrder) - num(a.installOrder)
  if (install !== 0) return install
  return compare(b.pluginID ?? "", a.pluginID ?? "")
}

/** §4.8：小写，非 `[a-z0-9_-]` 转 `_`，首尾去 `_`，截断 48。 */
export function sanitize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
}

/** 没有安装时间（内置插件）排在最后：同 priority 时先让真实安装顺序说话。 */
export function num(value: number | undefined) {
  return value ?? Number.MAX_SAFE_INTEGER
}

function compare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0
}
