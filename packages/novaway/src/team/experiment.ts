/**
 * 对照实验的分层与比较（§17）。
 *
 * 三组：A 单 Agent 直接做、B 单 Agent + 同等验证器、C 团队编排。
 * 这段代码只做两件事：把每个任务判进一个分层，以及在**允许比较**的分层里算差值。
 *
 * 三条硬规则，宁可少说也不多说：
 * 1. **结果不同就不比成本。** 只有 `both_pass` 才比耗时与用量；`only_*` 与 `both_fail`
 *    只报结果差异 —— 否则「更快地失败」会被算成效率（§17）。
 * 2. **未知就是未知。** 任一组 `unknown`，整条任务进 `indeterminate`；用量没有提供方
 *    权威回报就是缺失，不允许估算或补零。
 * 3. **每个数字都带覆盖率。** 比较值只在「两边都有回报」的任务上算，同时给出覆盖数与
 *    可比较总数；部分覆盖不得展示成完整账单。
 *
 * 它**不**输出「谁更好」：分层与差值只是事实，结论等级（L1–L4）与措辞由人负责。
 */

export type Group = "A" | "B" | "C"
export type Verdict = "pass" | "fail" | "unknown"

export type Observation = {
  taskID: string
  group: Group
  verdict: Verdict
  /** 提供方权威回报的 token 总量；缺失 = 未知。 */
  tokens?: number
  /** 同上，成本。 */
  cost?: number
  /** 同一单调时钟的 派发→终态 区间；墙上时间戳的差不能冒充它。 */
  wallMs?: number
}

export type Layer = "both_pass" | "only_team_pass" | "only_single_pass" | "both_fail" | "indeterminate"

export type Delta = {
  team: number
  baseline: number
  /** 团队 − 基线；负值表示更少。 */
  delta: number
  /** 基线大于 0 时才给比值，否则不编一个数出来。 */
  ratio?: number
}

export type Metric = "cost" | "tokens" | "wallMs"

export type Comparison = {
  cost?: Delta
  tokens?: Delta
  wallMs?: Delta
  /** 因任一边没有回报而没算的指标。 */
  missing: Metric[]
}

export type Task = {
  taskID: string
  layer: Layer
  /** 只有 `both_pass` 才有：结果可比时才算成本与耗时。 */
  comparison?: Comparison
}

export type Coverage = { covered: number; total: number }

export type Report = {
  tasks: Task[]
  layers: Record<Layer, string[]>
  /** 可比较样本数（`both_pass`）。 */
  comparable: number
  /** 每个指标在 `both_pass` 里的覆盖：两边都有回报才算覆盖。 */
  coverage: Record<Metric, Coverage>
  /** 没有可比较样本时必须明说：空表不能被读成「没有差异」。 */
  note?: string
}

const METRICS: Metric[] = ["cost", "tokens", "wallMs"]

/** 负的用量或耗时只可能是记录写错，静默当 0 会让报表说谎。 */
function value(taskID: string, observation: Observation, metric: Metric): number | undefined {
  const raw = observation[metric]
  if (raw === undefined) return undefined
  if (!Number.isFinite(raw) || raw < 0) throw new Error("实验记录不合法：" + taskID + " 的 " + metric + " = " + raw)
  return raw
}

function classify(taskID: string, groups: Map<Group, Observation>): Task {
  const a = groups.get("A")
  const b = groups.get("B")
  const c = groups.get("C")
  const base = { taskID, layer: "indeterminate" as Layer }

  // 缺组或任一组 `unknown`：证据不足，既不当作通过，也不当作失败。
  if (!a || !b || !c) return base
  if (a.verdict === "unknown" || b.verdict === "unknown" || c.verdict === "unknown") return base

  const layer: Layer =
    a.verdict === "pass" && b.verdict === "pass" && c.verdict === "pass"
      ? "both_pass"
      : c.verdict === "pass" && a.verdict !== "pass" && b.verdict !== "pass"
        ? "only_team_pass"
        : (a.verdict === "pass" || b.verdict === "pass") && c.verdict !== "pass"
          ? "only_single_pass"
          : "both_fail"

  // 只有结果可比时才比成本：基线固定取 B（同等验证器的关键对照）。
  if (layer !== "both_pass") return { taskID, layer }

  const comparison: Comparison = { missing: [] }
  for (const metric of METRICS) {
    const team = value(taskID, c, metric)
    const baseline = value(taskID, b, metric)
    if (team === undefined || baseline === undefined) {
      comparison.missing.push(metric)
      continue
    }
    comparison[metric] = {
      team,
      baseline,
      delta: team - baseline,
      ...(baseline > 0 ? { ratio: team / baseline } : {}),
    }
  }
  return { taskID, layer, comparison }
}

/**
 * 汇总一批观测。
 *
 * 同一任务同一组出现两次是记录错误，直接抛错 —— 挑一个「算数」的写进报表，
 * 等于把数据问题变成结论问题。
 */
export function report(observations: readonly Observation[]): Report {
  const tasks = new Map<string, Map<Group, Observation>>()
  for (const observation of observations) {
    const groups = tasks.get(observation.taskID) ?? new Map<Group, Observation>()
    if (groups.has(observation.group))
      throw new Error("实验记录重复：" + observation.taskID + " 的 " + observation.group + " 组出现了两次")
    groups.set(observation.group, observation)
    tasks.set(observation.taskID, groups)
  }

  const rows = [...tasks.entries()].map(([taskID, groups]) => classify(taskID, groups))
  const layers: Record<Layer, string[]> = {
    both_pass: [],
    only_team_pass: [],
    only_single_pass: [],
    both_fail: [],
    indeterminate: [],
  }
  for (const row of rows) layers[row.layer].push(row.taskID)

  const coverage: Record<Metric, Coverage> = {
    cost: { covered: 0, total: rows.length },
    tokens: { covered: 0, total: rows.length },
    wallMs: { covered: 0, total: rows.length },
  }
  const comparable = rows.filter((row) => row.layer === "both_pass")
  coverage.cost.total = comparable.length
  coverage.tokens.total = comparable.length
  coverage.wallMs.total = comparable.length
  for (const row of comparable) {
    for (const metric of METRICS) if (row.comparison?.[metric]) coverage[metric].covered += 1
  }

  return {
    tasks: rows,
    layers,
    comparable: comparable.length,
    coverage,
    ...(comparable.length === 0 ? { note: "没有 both_pass 的样本：结果不可比，不发布耗时与成本。" } : {}),
  }
}
