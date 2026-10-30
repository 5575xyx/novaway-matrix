import { createHash } from "node:crypto"

/**
 * 产物版本与下游失效（§8.6）。
 *
 * DAG 的依赖关系只说「谁在谁之后」，不够：上游返工改了接口，下游基于旧接口的
 * 结论就必须作废。所以每个团队交付时产出**带版本**的产物，下游记录自己依赖的
 * 具体版本；版本对不上，下游的「通过」就不再成立。
 *
 * 版本由内容决定（`hash` 前 8 位），不用自增计数器：
 * - 内容一样 → 版本一样 → 下游不必重做（避免无意义的返工）；
 * - 内容变了 → 版本变了 → 下游必须重验；
 * - 同一个输入永远得到同一个版本，方便回放与对账。
 */

export type Artifact = { name: string; version: string; hash: string }

export type Dep = { teamID: number; name: string; version: string }

const digest = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex")

/** 稳定序列化：键排序，避免同一份内容因字段顺序不同得到两个版本。 */
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]"
  const keys: string[] = []
  for (const key of Object.keys(value)) keys.push(key)
  keys.sort()
  return "{" + keys.map((key) => JSON.stringify(key) + ":" + stable(Reflect.get(value, key))).join(",") + "}"
}

/**
 * 把成员报告里的产物规范化。
 *
 * 规则：必须有名字；名字重复只留第一个（后面的不覆盖，避免「同名产物悄悄换内容」）。
 * 没有名字的条目直接丢掉 —— 无法指认的产物不能参与依赖判断。
 */
export function normalize(value: unknown): Artifact[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: Artifact[] = []
  for (const item of value) {
    const name = nameOf(item)
    if (!name || seen.has(name)) continue
    seen.add(name)
    const hash = digest(item)
    out.push({ name, version: hash.slice(0, 8), hash })
  }
  return out
}

function nameOf(item: unknown): string | undefined {
  if (item === null || typeof item !== "object") return undefined
  const name: unknown = Reflect.get(item, "name")
  return typeof name === "string" && name.trim() ? name.trim() : undefined
}

/** 上游当前版本表：teamID → 产物名 → 版本。 */
export function versions(teams: ReadonlyArray<{ index: number; artifacts: unknown }>) {
  const table = new Map<number, Map<string, string>>()
  for (const team of teams) {
    const byName = new Map<string, string>()
    for (const artifact of normalize(team.artifacts)) byName.set(artifact.name, artifact.version)
    table.set(team.index, byName)
  }
  return table
}

/**
 * 下游这一版结论是否还成立。
 *
 * `deps` 是下游交付时记下的上游版本。任何一条对不上就算失效 —— 包括上游产物被删掉：
 * 「我依赖的东西没了」与「它变了」一样严重，都意味着旧结论不再有依据。
 */
export function stillValid(
  deps: readonly Dep[],
  upstream: ReadonlyMap<number, ReadonlyMap<string, string>>,
): { valid: boolean; broken: Dep[] } {
  const broken = deps.filter((dep) => upstream.get(dep.teamID)?.get(dep.name) !== dep.version)
  return { valid: broken.length === 0, broken }
}

/** 从下游依赖的上游产物生成 deps 记录；产物还不存在时返回空列表（此时不能声称依赖了它）。 */
export function depsOf(input: {
  deps: readonly number[]
  upstream: ReadonlyMap<number, ReadonlyMap<string, string>>
}): Dep[] {
  const out: Dep[] = []
  for (const teamID of input.deps) {
    const byName = input.upstream.get(teamID)
    if (!byName) continue
    for (const [name, version] of byName) out.push({ teamID, name, version })
  }
  return out
}
