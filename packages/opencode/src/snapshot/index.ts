import { Cause, Duration, Effect, Layer, Schedule, Schema, Semaphore, Context } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { formatPatch, structuredPatch } from "diff"
import path from "path"
import { AppProcess } from "@opencode-ai/core/process"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Hash } from "@opencode-ai/core/util/hash"
import { Config } from "@/config/config"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"

export const ID = Schema.String.pipe(Schema.brand("Snapshot.ID"))
export type ID = typeof ID.Type

export class Error extends Schema.TaggedErrorClass<Error>()("Snapshot.Error", {
  operation: Schema.Literals(["capture", "files", "diff", "preview", "restore"]),
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export interface CompareInput {
  readonly from: ID
  readonly to: ID
}

export interface DiffInput extends CompareInput {
  readonly context?: number
  readonly paths?: readonly string[]
}

export interface RestoreInput {
  readonly files: ReadonlyMap<string, ID>
}

export interface PreviewInput extends RestoreInput {
  readonly context?: number
}

export const Patch = Schema.Struct({
  hash: Schema.String,
  files: Schema.mutable(Schema.Array(Schema.String)),
})
export type Patch = typeof Patch.Type

export const FileDiff = Schema.Struct({
  file: Schema.optional(Schema.String),
  patch: Schema.optional(Schema.String),
  additions: Schema.Finite,
  deletions: Schema.Finite,
  status: Schema.optional(Schema.Literals(["added", "deleted", "modified"])),
}).annotate({ identifier: "SnapshotFileDiff" })
export type FileDiff = typeof FileDiff.Type

const log = Log.create({ service: "snapshot" })
const prune = "7.days"
const limit = 2 * 1024 * 1024
const core = ["-c", "core.longpaths=true", "-c", "core.symlinks=true"]
const cfg = ["-c", "core.autocrlf=false", ...core]
const quote = [...cfg, "-c", "core.quotepath=false"]
interface GitResult {
  readonly code: ChildProcessSpawner.ExitCode
  readonly text: string
  readonly stderr: string
}

type State = Omit<Interface, "init">

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly cleanup: () => Effect.Effect<void>
  readonly capture: () => Effect.Effect<ID | undefined>
  readonly files: (input: CompareInput) => Effect.Effect<readonly string[], Error>
  readonly diff: (input: DiffInput) => Effect.Effect<readonly FileDiff[], Error>
  readonly preview: (input: PreviewInput) => Effect.Effect<readonly FileDiff[], Error>
  readonly restore: (input: RestoreInput) => Effect.Effect<void, Error>
  readonly checkout: (snapshot: string) => Effect.Effect<void, Error>
  readonly track: () => Effect.Effect<string | undefined>
  readonly patch: (hash: string) => Effect.Effect<Patch>
  readonly revert: (patches: Patch[]) => Effect.Effect<void>
  readonly diffText: (hash: string) => Effect.Effect<string>
  readonly diffFull: (from: string, to: string) => Effect.Effect<FileDiff[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Snapshot") {}

export const layer: Layer.Layer<Service, never, AppFileSystem.Service | AppProcess.Service | Config.Service> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const appProcess = yield* AppProcess.Service
      const config = yield* Config.Service
      const locks = new Map<string, Semaphore.Semaphore>()

      const lock = (key: string) => {
        const hit = locks.get(key)
        if (hit) return hit

        const next = Semaphore.makeUnsafe(1)
        locks.set(key, next)
        return next
      }

      const state = yield* InstanceState.make<State>(
        Effect.fn("Snapshot.state")(function* (ctx) {
          const state = {
            directory: ctx.directory,
            worktree: ctx.worktree,
            gitdir: path.join(Global.Path.data, "snapshot", ctx.project.id, Hash.fast(ctx.worktree)),
            vcs: ctx.project.vcs,
          }

          const args = (cmd: string[]) => ["--git-dir", state.gitdir, "--work-tree", state.worktree, ...cmd]

          const normalizeRelative = (file: string) =>
            path.isAbsolute(file)
              ? path.relative(state.worktree, file).replaceAll("\\", "/")
              : file.replaceAll("\\", "/")

          const feed = (list: string[]) => list.join("\0") + "\0"

          const git = Effect.fnUntraced(
            function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string>; stdin?: string }) {
              const result = yield* appProcess.run(
                ChildProcess.make("git", cmd, { cwd: opts?.cwd, env: opts?.env, extendEnv: true }),
                { stdin: opts?.stdin },
              )
              return {
                code: ChildProcessSpawner.ExitCode(result.exitCode),
                text: result.stdout.toString("utf8"),
                stderr: result.stderr.toString("utf8"),
              } satisfies GitResult
            },
            Effect.catch((err) =>
              Effect.succeed({
                code: ChildProcessSpawner.ExitCode(1),
                text: "",
                stderr: err instanceof globalThis.Error ? err.message : String(err),
              }),
            ),
          )

          const ignore = Effect.fnUntraced(function* (files: string[]) {
            if (!files.length) return new Set<string>()
            const check = yield* git(
              [
                ...quote,
                "--git-dir",
                path.join(state.worktree, ".git"),
                "--work-tree",
                state.worktree,
                "check-ignore",
                "--no-index",
                "--stdin",
                "-z",
              ],
              {
                cwd: state.directory,
                stdin: feed(files),
              },
            )
            if (check.code !== 0 && check.code !== 1) return new Set<string>()
            return new Set(check.text.split("\0").filter(Boolean))
          })

          const drop = Effect.fnUntraced(function* (files: string[]) {
            if (!files.length) return
            yield* git(
              [
                ...cfg,
                ...args(["rm", "--cached", "-f", "--ignore-unmatch", "--pathspec-from-file=-", "--pathspec-file-nul"]),
              ],
              {
                cwd: state.directory,
                stdin: feed(files),
              },
            )
          })

          const stage = Effect.fnUntraced(function* (files: string[]) {
            if (!files.length) return
            const result = yield* git(
              [...cfg, ...args(["add", "--all", "--sparse", "--pathspec-from-file=-", "--pathspec-file-nul"])],
              {
                cwd: state.directory,
                stdin: feed(files),
              },
            )
            if (result.code === 0) return
            log.warn("failed to add snapshot files", {
              exitCode: result.code,
              stderr: result.stderr,
            })
          })

          const exists = (file: string) => fs.exists(file).pipe(Effect.orDie)
          const read = (file: string) => fs.readFileString(file).pipe(Effect.catch(() => Effect.succeed("")))
          const remove = (file: string) => fs.remove(file).pipe(Effect.catch(() => Effect.void))
          const locked = <A, E, R>(fx: Effect.Effect<A, E, R>) => lock(state.gitdir).withPermits(1)(fx)

          const enabled = Effect.fnUntraced(function* () {
            if (state.vcs !== "git") return false
            return (yield* config.get()).snapshot !== false
          })

          const excludes = Effect.fnUntraced(function* () {
            const result = yield* git(["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"], {
              cwd: state.worktree,
            })
            const file = result.text.trim()
            if (!file) return
            if (!(yield* exists(file))) return
            return file
          })

          const sync = Effect.fnUntraced(function* (list: string[] = []) {
            const file = yield* excludes()
            const target = path.join(state.gitdir, "info", "exclude")
            const text = [
              file ? (yield* read(file)).trimEnd() : "",
              ...list.map((item) => `/${item.replaceAll("\\", "/")}`),
            ]
              .filter(Boolean)
              .join("\n")
            yield* fs.ensureDir(path.join(state.gitdir, "info")).pipe(Effect.orDie)
            yield* fs.writeFileString(target, text ? `${text}\n` : "").pipe(Effect.orDie)
          })

          const add = Effect.fnUntraced(function* () {
            yield* sync()
            const [diff, other] = yield* Effect.all(
              [
                git([...quote, ...args(["diff-files", "--name-only", "-z", "--", "."])], {
                  cwd: state.directory,
                }),
                git([...quote, ...args(["ls-files", "--others", "--exclude-standard", "-z", "--", "."])], {
                  cwd: state.directory,
                }),
              ],
              { concurrency: 2 },
            )
            if (diff.code !== 0 || other.code !== 0) {
              log.warn("failed to list snapshot files", {
                diffCode: diff.code,
                diffStderr: diff.stderr,
                otherCode: other.code,
                otherStderr: other.stderr,
              })
              return
            }

            const tracked = diff.text.split("\0").filter(Boolean)
            const untracked = other.text.split("\0").filter(Boolean)
            const all = Array.from(new Set([...tracked, ...untracked]))
            if (!all.length) return

            const ignored = yield* ignore(all)

            if (ignored.size > 0) {
              const ignoredFiles = Array.from(ignored)
              log.info("removing gitignored files from snapshot", { count: ignoredFiles.length })
              yield* drop(ignoredFiles)
            }

            const allow = all.filter((item) => !ignored.has(item))
            if (!allow.length) return

            const large = new Set(
              (yield* Effect.all(
                allow.map((item) =>
                  fs
                    .stat(path.join(state.directory, item))
                    .pipe(Effect.catch(() => Effect.void))
                    .pipe(
                      Effect.map((stat) => {
                        if (!stat || stat.type !== "File") return
                        const size = typeof stat.size === "bigint" ? Number(stat.size) : stat.size
                        return size > limit ? item : undefined
                      }),
                    ),
                ),
                { concurrency: 8 },
              )).filter((item): item is string => Boolean(item)),
            )
            const block = new Set(untracked.filter((item) => large.has(item)))
            yield* sync(Array.from(block))
            yield* stage(allow.filter((item) => !block.has(item)))
          })

          const cleanup = Effect.fnUntraced(function* () {
            return yield* locked(
              Effect.gen(function* () {
                if (!(yield* enabled())) return
                if (!(yield* exists(state.gitdir))) return
                const result = yield* git(args(["gc", `--prune=${prune}`]), { cwd: state.directory })
                if (result.code !== 0) {
                  log.warn("cleanup failed", {
                    exitCode: result.code,
                    stderr: result.stderr,
                  })
                  return
                }
                log.info("cleanup", { prune })
              }),
            )
          })

          const track = Effect.fnUntraced(function* () {
            return yield* locked(
              Effect.gen(function* () {
                if (!(yield* enabled())) return
                const existed = yield* exists(state.gitdir)
                yield* fs.ensureDir(state.gitdir).pipe(Effect.orDie)
                if (!existed) {
                  yield* git(["init"], {
                    env: { GIT_DIR: state.gitdir, GIT_WORK_TREE: state.worktree },
                  })
                  yield* git(["--git-dir", state.gitdir, "config", "core.autocrlf", "false"])
                  yield* git(["--git-dir", state.gitdir, "config", "core.longpaths", "true"])
                  yield* git(["--git-dir", state.gitdir, "config", "core.symlinks", "true"])
                  yield* git(["--git-dir", state.gitdir, "config", "core.fsmonitor", "false"])
                  log.info("initialized")
                }
                yield* add()
                const result = yield* git(args(["write-tree"]), { cwd: state.directory })
                const hash = result.text.trim()
                log.info("tracking", { hash, cwd: state.directory, git: state.gitdir })
                return hash
              }),
            )
          })

          const patch = Effect.fnUntraced(function* (hash: string) {
            return yield* locked(
              Effect.gen(function* () {
                yield* add()
                const result = yield* git(
                  [...quote, ...args(["diff", "--cached", "--no-ext-diff", "--name-only", hash, "--", "."])],
                  {
                    cwd: state.directory,
                  },
                )
                if (result.code !== 0) {
                  log.warn("failed to get diff", { hash, exitCode: result.code })
                  return { hash, files: [] }
                }
                const files = result.text
                  .trim()
                  .split("\n")
                  .map((x) => x.trim())
                  .filter(Boolean)

                const ignored = yield* ignore(files)

                return {
                  hash,
                  files: files
                    .filter((item) => !ignored.has(item))
                    .map((x) => path.join(state.worktree, x).replaceAll("\\", "/")),
                }
              }),
            )
          })

          const restoreOld = Effect.fnUntraced(function* (snapshot: string) {
            return yield* locked(
              Effect.gen(function* () {
                log.info("restore", { commit: snapshot })
                const result = yield* git([...core, ...args(["read-tree", snapshot])], { cwd: state.worktree })
                if (result.code === 0) {
                  const checkout = yield* git([...core, ...args(["checkout-index", "-a", "-f"])], {
                    cwd: state.worktree,
                  })
                  if (checkout.code === 0) return
                  log.error("failed to restore snapshot", {
                    snapshot,
                    exitCode: checkout.code,
                    stderr: checkout.stderr,
                  })
                  return
                }
                log.error("failed to restore snapshot", {
                  snapshot,
                  exitCode: result.code,
                  stderr: result.stderr,
                })
              }),
            )
          })

          const revert = Effect.fnUntraced(function* (patches: Patch[]) {
            return yield* locked(
              Effect.gen(function* () {
                const ops: { hash: string; file: string; rel: string }[] = []
                const seen = new Set<string>()
                for (const item of patches) {
                  for (const file of item.files) {
                    const rel = normalizeRelative(file)
                    if (seen.has(rel)) continue
                    seen.add(rel)
                    ops.push({
                      hash: item.hash,
                      file: path.isAbsolute(file) ? file : path.join(state.worktree, file),
                      rel,
                    })
                  }
                }

                const single = Effect.fnUntraced(function* (op: (typeof ops)[number]) {
                  log.info("reverting", { file: op.file, hash: op.hash })
                  const result = yield* git([...core, ...args(["checkout", op.hash, "--", op.file])], {
                    cwd: state.worktree,
                  })
                  if (result.code === 0) return
                  const tree = yield* git([...core, ...args(["ls-tree", op.hash, "--", op.rel])], {
                    cwd: state.worktree,
                  })
                  if (tree.code === 0 && tree.text.trim()) {
                    log.info("file existed in snapshot but checkout failed, keeping", { file: op.file, hash: op.hash })
                    return
                  }
                  log.info("file did not exist in snapshot, deleting", { file: op.file, hash: op.hash })
                  yield* remove(op.file)
                })

                const clash = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)

                for (let i = 0; i < ops.length; ) {
                  const first = ops[i]!
                  const run = [first]
                  let j = i + 1
                  while (j < ops.length && run.length < 100) {
                    const next = ops[j]!
                    if (next.hash !== first.hash) break
                    if (run.some((item) => clash(item.rel, next.rel))) break
                    run.push(next)
                    j += 1
                  }

                  if (run.length === 1) {
                    yield* single(first)
                    i = j
                    continue
                  }

                  const tree = yield* git(
                    [...core, ...args(["ls-tree", "--name-only", first.hash, "--", ...run.map((item) => item.rel)])],
                    {
                      cwd: state.worktree,
                    },
                  )

                  if (tree.code !== 0) {
                    log.info("batched ls-tree failed, falling back to single-file revert", {
                      hash: first.hash,
                      files: run.length,
                    })
                    for (const op of run) {
                      yield* single(op)
                    }
                    i = j
                    continue
                  }

                  const have = new Set(
                    tree.text
                      .trim()
                      .split("\n")
                      .map((item) => item.trim())
                      .filter(Boolean),
                  )
                  const list = run.filter((item) => have.has(item.rel))
                  if (list.length) {
                    log.info("reverting", { hash: first.hash, files: list.length })
                    const result = yield* git(
                      [...core, ...args(["checkout", first.hash, "--", ...list.map((item) => item.file)])],
                      {
                        cwd: state.worktree,
                      },
                    )
                    if (result.code !== 0) {
                      log.info("batched checkout failed, falling back to single-file revert", {
                        hash: first.hash,
                        files: list.length,
                      })
                      for (const op of run) {
                        yield* single(op)
                      }
                      i = j
                      continue
                    }
                  }

                  for (const op of run) {
                    if (have.has(op.rel)) continue
                    log.info("file did not exist in snapshot, deleting", { file: op.file, hash: op.hash })
                    yield* remove(op.file)
                  }

                  i = j
                }
              }),
            )
          })

          const diffText = Effect.fnUntraced(function* (hash: string) {
            return yield* locked(
              Effect.gen(function* () {
                yield* add()
                const result = yield* git([...quote, ...args(["diff", "--cached", "--no-ext-diff", hash, "--", "."])], {
                  cwd: state.worktree,
                })
                if (result.code !== 0) {
                  log.warn("failed to get diff", {
                    hash,
                    exitCode: result.code,
                    stderr: result.stderr,
                  })
                  return ""
                }
                return result.text.trim()
              }),
            )
          })

          const diffFull = Effect.fnUntraced(function* (from: string, to: string) {
            return yield* locked(
              Effect.gen(function* () {
                type Row = {
                  file: string
                  status: "added" | "deleted" | "modified"
                  binary: boolean
                  additions: number
                  deletions: number
                }

                type Ref = {
                  file: string
                  side: "before" | "after"
                  ref: string
                }

                const show = Effect.fnUntraced(function* (row: Row) {
                  if (row.binary) return ["", ""]
                  if (row.status === "added") {
                    return [
                      "",
                      yield* git([...cfg, ...args(["show", `${to}:${row.file}`])]).pipe(
                        Effect.map((item) => item.text),
                      ),
                    ]
                  }
                  if (row.status === "deleted") {
                    return [
                      yield* git([...cfg, ...args(["show", `${from}:${row.file}`])]).pipe(
                        Effect.map((item) => item.text),
                      ),
                      "",
                    ]
                  }
                  return yield* Effect.all(
                    [
                      git([...cfg, ...args(["show", `${from}:${row.file}`])]).pipe(Effect.map((item) => item.text)),
                      git([...cfg, ...args(["show", `${to}:${row.file}`])]).pipe(Effect.map((item) => item.text)),
                    ],
                    { concurrency: 2 },
                  )
                })

                const load = Effect.fnUntraced(
                  function* (rows: Row[]) {
                    const refs = rows.flatMap((row) => {
                      if (row.binary) return []
                      if (row.status === "added")
                        return [{ file: row.file, side: "after", ref: `${to}:${row.file}` } satisfies Ref]
                      if (row.status === "deleted") {
                        return [{ file: row.file, side: "before", ref: `${from}:${row.file}` } satisfies Ref]
                      }
                      return [
                        { file: row.file, side: "before", ref: `${from}:${row.file}` } satisfies Ref,
                        { file: row.file, side: "after", ref: `${to}:${row.file}` } satisfies Ref,
                      ]
                    })
                    if (!refs.length) return new Map<string, { before: string; after: string }>()

                    const batch = yield* appProcess.run(
                      ChildProcess.make("git", [...cfg, ...args(["cat-file", "--batch"])], {
                        cwd: state.directory,
                        extendEnv: true,
                      }),
                      { stdin: refs.map((item) => item.ref).join("\n") + "\n" },
                    )
                    if (batch.exitCode !== 0) {
                      log.info("git cat-file --batch failed during snapshot diff, falling back to per-file git show", {
                        stderr: batch.stderr.toString("utf8"),
                        refs: refs.length,
                      })
                      return
                    }
                    const out = batch.stdout

                    const fail = (msg: string, extra?: Record<string, string>) => {
                      log.info(msg, { ...extra, refs: refs.length })
                      return undefined
                    }

                    const map = new Map<string, { before: string; after: string }>()
                    const dec = new TextDecoder()
                    let i = 0
                    for (const ref of refs) {
                      let end = i
                      while (end < out.length && out[end] !== 10) end += 1
                      if (end >= out.length) {
                        return fail(
                          "git cat-file --batch returned a truncated header during snapshot diff, falling back to per-file git show",
                        )
                      }

                      const head = dec.decode(out.slice(i, end))
                      i = end + 1
                      const hit = map.get(ref.file) ?? { before: "", after: "" }
                      if (head.endsWith(" missing")) {
                        map.set(ref.file, hit)
                        continue
                      }

                      const match = head.match(/^[0-9a-f]+ blob (\d+)$/)
                      if (!match) {
                        return fail(
                          "git cat-file --batch returned an unexpected header during snapshot diff, falling back to per-file git show",
                          { head },
                        )
                      }

                      const size = Number(match[1])
                      if (!Number.isInteger(size) || size < 0 || i + size >= out.length || out[i + size] !== 10) {
                        return fail(
                          "git cat-file --batch returned truncated content during snapshot diff, falling back to per-file git show",
                          { head },
                        )
                      }

                      const text = dec.decode(out.slice(i, i + size))
                      if (ref.side === "before") hit.before = text
                      if (ref.side === "after") hit.after = text
                      map.set(ref.file, hit)
                      i += size + 1
                    }

                    if (i !== out.length) {
                      return fail(
                        "git cat-file --batch returned trailing data during snapshot diff, falling back to per-file git show",
                      )
                    }

                    return map
                  },
                  Effect.scoped,
                  Effect.catch(() =>
                    Effect.succeed<Map<string, { before: string; after: string }> | undefined>(undefined),
                  ),
                )

                const result: FileDiff[] = []
                const status = new Map<string, "added" | "deleted" | "modified">()

                const statuses = yield* git(
                  [...quote, ...args(["diff", "--no-ext-diff", "--name-status", "--no-renames", from, to, "--", "."])],
                  { cwd: state.directory },
                )

                for (const line of statuses.text.trim().split("\n")) {
                  if (!line) continue
                  const [code, file] = line.split("\t")
                  if (!code || !file) continue
                  status.set(file, code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified")
                }

                const numstat = yield* git(
                  [...quote, ...args(["diff", "--no-ext-diff", "--no-renames", "--numstat", from, to, "--", "."])],
                  {
                    cwd: state.directory,
                  },
                )

                const rows = numstat.text
                  .trim()
                  .split("\n")
                  .filter(Boolean)
                  .flatMap((line) => {
                    const [adds, dels, file] = line.split("\t")
                    if (!file) return []
                    const binary = adds === "-" && dels === "-"
                    const additions = binary ? 0 : parseInt(adds)
                    const deletions = binary ? 0 : parseInt(dels)
                    return [
                      {
                        file,
                        status: status.get(file) ?? "modified",
                        binary,
                        additions: Number.isFinite(additions) ? additions : 0,
                        deletions: Number.isFinite(deletions) ? deletions : 0,
                      } satisfies Row,
                    ]
                  })

                const ignored = yield* ignore(rows.map((r) => r.file))
                if (ignored.size > 0) {
                  const filtered = rows.filter((r) => !ignored.has(r.file))
                  rows.length = 0
                  rows.push(...filtered)
                }

                const step = 100
                const patchFunc = (file: string, before: string, after: string) =>
                  formatPatch(structuredPatch(file, file, before, after, "", "", { context: Number.MAX_SAFE_INTEGER }))

                for (let i = 0; i < rows.length; i += step) {
                  const run = rows.slice(i, i + step)
                  const text = yield* load(run)

                  for (const row of run) {
                    const hit = text?.get(row.file) ?? { before: "", after: "" }
                    const [before, after] = row.binary ? ["", ""] : text ? [hit.before, hit.after] : yield* show(row)
                    result.push({
                      file: row.file,
                      patch: row.binary ? "" : patchFunc(row.file, before, after),
                      additions: row.additions,
                      deletions: row.deletions,
                      status: row.status,
                    })
                  }
                }

                return result
              }),
            )
          })

          const capture = Effect.fn("Snapshot.capture")(function* () {
            if (!(yield* enabled())) return undefined
            return yield* Effect.gen(function* () {
              const existed = yield* exists(state.gitdir)
              yield* fs.ensureDir(state.gitdir).pipe(Effect.orDie)
              if (!existed) {
                yield* git(["init"], {
                  env: { GIT_DIR: state.gitdir, GIT_WORK_TREE: state.worktree },
                })
                yield* git(["--git-dir", state.gitdir, "config", "core.autocrlf", "false"])
                yield* git(["--git-dir", state.gitdir, "config", "core.longpaths", "true"])
                yield* git(["--git-dir", state.gitdir, "config", "core.symlinks", "true"])
                yield* git(["--git-dir", state.gitdir, "config", "core.fsmonitor", "false"])
                log.info("initialized")
              }
              yield* add()
              const result = yield* git(args(["write-tree"]), { cwd: state.directory })
              const hash = result.text.trim()
              log.info("captured", { hash })
              return ID.make(hash)
            }).pipe(
              Effect.catch((cause) =>
                Effect.logWarning("failed to capture snapshot", { cause }).pipe(Effect.as(undefined)),
              ),
            )
          })

          const compare = Effect.fnUntraced(function* (operation: "files" | "diff", input: CompareInput) {
            if (!(yield* enabled())) return yield* new Error({ operation, message: "Snapshots are disabled" })
            if (!(yield* exists(state.gitdir)))
              return yield* new Error({ operation, message: "Snapshot repository not initialized" })
            return { from: input.from, to: input.to }
          })

          const files = Effect.fn("Snapshot.files")(function* (input: CompareInput) {
            const comparison = yield* compare("files", input)
            const result = yield* git(
              [...quote, ...args(["diff", "--name-only", "-z", comparison.from, comparison.to])],
              { cwd: state.directory },
            )
            if (result.code !== 0) return yield* new Error({ operation: "files", message: "Failed to get file list" })
            return result.text.split("\0").filter(Boolean)
          })

          const diff = Effect.fn("Snapshot.diff")(function* (input: DiffInput) {
            const comparison = yield* compare("diff", input)
            const result = yield* git(
              [...quote, ...args(["diff", "--name-only", "-z", comparison.from, comparison.to])],
              { cwd: state.directory },
            )
            if (result.code !== 0) return []
            const allFiles = result.text.split("\0").filter(Boolean)
            const ignored = yield* ignore(allFiles)
            const paths = input.paths?.map(normalizeRelative) ?? allFiles.filter((f) => !ignored.has(f))
            return yield* diffFull(comparison.from, comparison.to).pipe(
              Effect.map((diffs) => diffs.filter((d) => paths.includes(d.file ?? ""))),
            )
          })

          const preview = Effect.fn("Snapshot.preview")(function* (input: PreviewInput) {
            if (!(yield* enabled()))
              return yield* new Error({ operation: "preview", message: "Snapshots are disabled" })
            const current = yield* capture()
            if (!current) return yield* new Error({ operation: "preview", message: "Failed to capture current state" })
            return yield* diff({ from: current, to: ID.make(""), paths: Array.from(input.files.keys()) })
          })

          const restore = Effect.fn("Snapshot.restore")(function* (input: RestoreInput) {
            if (!(yield* enabled()))
              return yield* new Error({ operation: "restore", message: "Snapshots are disabled" })
            for (const [file, snapshot] of input.files) {
              yield* git([...core, ...args(["checkout", snapshot, "--", file])], {
                cwd: state.worktree,
              })
            }
          })

          const checkout = Effect.fn("Snapshot.checkout")(function* (snapshot: string) {
            if (!(yield* enabled()))
              return yield* new Error({ operation: "restore", message: "Snapshots are disabled" })
            const result = yield* git([...core, ...args(["read-tree", snapshot])], { cwd: state.worktree })
            if (result.code !== 0) return yield* new Error({ operation: "restore", message: "Failed to read tree" })
            yield* git([...core, ...args(["checkout-index", "--all", "--force"])], { cwd: state.worktree })
          })

          yield* cleanup().pipe(
            Effect.catchCause((cause) => {
              log.error("cleanup loop failed", { cause: Cause.pretty(cause) })
              return Effect.void
            }),
            Effect.repeat(Schedule.spaced(Duration.hours(1))),
            Effect.delay(Duration.minutes(1)),
            Effect.forkScoped,
          )

          return { cleanup, capture, files, diff, preview, restore, checkout, track, patch, revert, diffText, diffFull }
        }),
      )

      return Service.of({
        init: Effect.fn("Snapshot.init")(function* () {
          yield* InstanceState.get(state)
        }),
        cleanup: Effect.fn("Snapshot.cleanup")(function* () {
          return yield* InstanceState.useEffect(state, (s) => s.cleanup())
        }),
        capture: Effect.fn("Snapshot.capture")(function* () {
          return yield* InstanceState.useEffect(state, (s) => s.capture())
        }),
        files: Effect.fn("Snapshot.files")(function* (input: CompareInput) {
          return yield* InstanceState.useEffect(state, (s) => s.files(input))
        }),
        diff: Effect.fn("Snapshot.diff")(function* (input: DiffInput) {
          return yield* InstanceState.useEffect(state, (s) => s.diff(input))
        }),
        preview: Effect.fn("Snapshot.preview")(function* (input: PreviewInput) {
          return yield* InstanceState.useEffect(state, (s) => s.preview(input))
        }),
        restore: Effect.fn("Snapshot.restore")(function* (input: RestoreInput) {
          return yield* InstanceState.useEffect(state, (s) => s.restore(input))
        }),
        checkout: Effect.fn("Snapshot.checkout")(function* (snapshot: string) {
          return yield* InstanceState.useEffect(state, (s) => s.checkout(snapshot))
        }),
        track: Effect.fn("Snapshot.track")(function* () {
          return yield* InstanceState.useEffect(state, (s) => s.track())
        }),
        patch: Effect.fn("Snapshot.patch")(function* (hash: string) {
          return yield* InstanceState.useEffect(state, (s) => s.patch(hash))
        }),
        revert: Effect.fn("Snapshot.revert")(function* (patches: Patch[]) {
          return yield* InstanceState.useEffect(state, (s) => s.revert(patches))
        }),
        diffText: Effect.fn("Snapshot.diffText")(function* (hash: string) {
          return yield* InstanceState.useEffect(state, (s) => s.diffText(hash))
        }),
        diffFull: Effect.fn("Snapshot.diffFull")(function* (from: string, to: string) {
          return yield* InstanceState.useEffect(state, (s) => s.diffFull(from, to))
        }),
      })
    }),
  )

export const defaultLayer = layer.pipe(
  Layer.provide(AppProcess.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Config.defaultLayer),
)

export * as Snapshot from "."
