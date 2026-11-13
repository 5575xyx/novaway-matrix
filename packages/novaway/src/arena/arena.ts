import { Cause, Effect } from "effect"
import type { RunAgent } from "../session/agent-step"
import type { Committed, Created, CumulativeDiff } from "../team/worktree"

/**
 * Arena: run one task with N contenders, each in its own worktree, then show the
 * diffs side by side.
 *
 * Two boundaries are deliberate:
 * 1. A contender never falls back to the user workspace. If a worktree cannot be
 *    created the contender is `skipped` with the reason; comparing a worktree
 *    against the live checkout would make the diffs meaningless.
 * 2. There is no "winner" unless a verifier actually judged the results. Counting
 *    changed lines is not quality; a run without a verifier reports `winner`
 *    undefined and says why.
 */

export type ContenderSpec = {
  id: string
  agent?: string
  model?: { providerID: string; modelID: string }
}

export type ContenderResult = {
  id: string
  status: "completed" | "failed" | "skipped"
  sessionID?: string
  /** Worktree the contender ran in; kept when `keepWorktrees` is set. */
  directory?: string
  text?: string
  diff?: CumulativeDiff
  usage?: { cost: number; tokens: number }
  error?: string
  durationMs?: number
  verdict?: "pass" | "fail"
  score?: number
}

export type Verdict = { pass: boolean; score?: number }

export type ArenaDeps = {
  createWorktree(input: { runID: string; name: string }): Effect.Effect<Created | { kind: "skipped"; reason: string }>
  runAgent: RunAgent
  commit(input: { directory: string }): Effect.Effect<Committed>
  diff(input: { directory: string; baseSHA: string }): Effect.Effect<CumulativeDiff | undefined>
  removeWorktree(input: { base: string; directory: string; branch?: string }): Effect.Effect<unknown>
  verify?(input: { contender: ContenderSpec; result: ContenderResult }): Effect.Effect<Verdict>
}

export type RunInput = {
  runID: string
  task: string
  contenders: readonly ContenderSpec[]
  concurrency?: number
  keepWorktrees?: boolean
}

export type RunResult = {
  runID: string
  task: string
  contenders: ContenderResult[]
  /** Only set when a verifier produced exactly one best passing contender. */
  winner?: string
  /** True when verification ran; false means winner is intentionally unknown. */
  verified: boolean
  note?: string
}

function validate(contenders: readonly ContenderSpec[]) {
  if (contenders.length === 0) throw new Error("arena needs at least one contender")
  const seen = new Set<string>()
  for (const contender of contenders) {
    if (!contender.id.trim()) throw new Error("arena contender id must not be empty")
    if (seen.has(contender.id)) throw new Error(`arena contender id duplicated: ${contender.id}`)
    seen.add(contender.id)
  }
}

function message(cause: Cause.Cause<unknown>) {
  const failure = Cause.findErrorOption(cause)
  if (failure._tag === "Some") return String(failure.value)
  return Cause.pretty(cause)
}

function pickWinner(results: readonly ContenderResult[]) {
  const passing = results.filter((result) => result.verdict === "pass")
  if (passing.length === 0) return undefined
  const best = Math.max(...passing.map((result) => result.score ?? 0))
  const top = passing.filter((result) => (result.score ?? 0) === best)
  // A tie is not a win: picking by id order would invent a ranking.
  return top.length === 1 ? top[0].id : undefined
}

export const run = (input: RunInput, deps: ArenaDeps) =>
  Effect.gen(function* () {
    if (!input.runID.trim()) return yield* Effect.fail(new Error("arena runID must not be empty"))
    validate(input.contenders)

    // 有验收命令时，worktree 必须活到验收跑完 —— 提前删掉等于让命令在空目录里
    // 执行，所有 contender 一律 fail。这类清理统一放到验收之后。
    const deferred: Array<{ base: string; directory: string; branch?: string }> = []

    const results = yield* Effect.forEach(
      input.contenders,
      (contender) =>
        Effect.gen(function* () {
          const started = Date.now()
          const created = yield* deps.createWorktree({ runID: input.runID, name: contender.id })
          if (created.kind === "skipped") {
            return {
              id: contender.id,
              status: "skipped" as const,
              error: created.reason,
              durationMs: Date.now() - started,
            }
          }

          const worktree = created.worktree
          const cleanup = { base: worktree.base, directory: worktree.directory, branch: worktree.branch }
          const keep = input.keepWorktrees
          const verifyLater = deps.verify !== undefined && !keep
          const attempt = Effect.gen(function* () {
            const agent = yield* deps.runAgent({
              agent: contender.agent ?? "general",
              prompt: input.task,
              ...(contender.model ? { model: contender.model } : {}),
              title: `Arena: ${contender.id}`,
              name: contender.id,
              directory: worktree.directory,
            })
            const committed = yield* deps.commit({ directory: worktree.directory })
            if (committed.kind === "failed") return yield* Effect.fail(new Error(committed.message))
            const diff = yield* deps.diff({ directory: worktree.directory, baseSHA: worktree.baseSHA })
            return {
              id: contender.id,
              status: "completed" as const,
              sessionID: agent.sessionID,
              directory: worktree.directory,
              text: agent.text,
              diff,
              usage: agent.usage,
              durationMs: Date.now() - started,
            }
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.succeed({
                id: contender.id,
                status: "failed" as const,
                error: message(cause),
                durationMs: Date.now() - started,
              }),
            ),
            Effect.ensuring(
              keep || verifyLater
                ? Effect.sync(() => {
                    if (verifyLater) deferred.push(cleanup)
                  })
                : deps.removeWorktree(cleanup).pipe(Effect.ignore),
            ),
          )
          return yield* attempt
        }),
      { concurrency: Math.max(1, input.concurrency ?? 2) },
    )

    const verified = Boolean(deps.verify)
    const judged: ContenderResult[] = verified
      ? yield* Effect.forEach(results, (result) =>
          Effect.gen(function* () {
            const contender = input.contenders.find((item) => item.id === result.id)!
            if (result.status !== "completed") return result
            const verdict = yield* deps.verify!({ contender, result }).pipe(
              Effect.catchCause(() => Effect.succeed({ pass: false, score: undefined } satisfies Verdict)),
            )
            return {
              ...result,
              verdict: verdict.pass ? ("pass" as const) : ("fail" as const),
              ...(verdict.score !== undefined ? { score: verdict.score } : {}),
            }
          }),
        )
      : results

    // 验收跑完再丢弃 worktree。
    yield* Effect.forEach(deferred, (item) => deps.removeWorktree(item).pipe(Effect.ignore), { discard: true })

    const winner = pickWinner(judged)
    return {
      runID: input.runID,
      task: input.task,
      contenders: judged,
      ...(winner ? { winner } : {}),
      verified,
      ...(verified
        ? winner
          ? {}
          : { note: "Verification produced no unique winner (none passed or the top scores tied)." }
        : { note: "No verifier configured: results are shown without ranking a winner." }),
    } satisfies RunResult
  })

export * as Arena from "./arena"
