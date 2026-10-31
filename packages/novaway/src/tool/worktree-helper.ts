import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@novaway/core/global"

function git(cwd: string, args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()))
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()))
    child.on("error", (error) => resolve({ code: 1, stdout: "", stderr: String(error) }))
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
}

/**
 * Create an isolated git worktree for a subagent. Uses plain git so the tool
 * does not need the Worktree service (which is instance scoped).
 */
export async function create(base: string, name: string) {
  const root = path.join(Global.Path.data, "worktree", "agents")
  await fs.mkdir(root, { recursive: true })
  const candidate = `${slug(name) || "agent"}-${Date.now().toString(36)}`
  const directory = path.join(root, candidate)
  const branch = `NovaWay/agent/${candidate}`
  const created = await git(base, ["worktree", "add", "-b", branch, directory, "HEAD"])
  if (created.code !== 0) return undefined
  return { directory, branch }
}

export type WorktreeState = {
  /** Uncommitted or untracked paths, as `git status --porcelain` reports them. */
  files: string[]
  /** Commits on the worktree branch that the main checkout's HEAD does not have. */
  ahead: number
  /** Branch checked out in the worktree, when it is not detached. */
  branch?: string
}

/**
 * Inspect a worktree before removing it, mirroring CC's ExitWorktree guard:
 * a worktree with uncommitted changes or unmerged commits is refused unless the
 * caller explicitly passes `discard_changes`.
 */
export async function state(directory: string, base: string): Promise<WorktreeState> {
  const status = await git(directory, ["status", "--porcelain"])
  const files = status.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  const head = await git(base, ["rev-parse", "HEAD"])
  const headSha = head.code === 0 ? head.stdout.trim() : ""
  const ahead = headSha ? await git(directory, ["rev-list", "--count", `${headSha}..HEAD`]) : undefined
  const count = ahead && ahead.code === 0 ? Number.parseInt(ahead.stdout.trim(), 10) : 0

  const listing = await git(base, ["worktree", "list", "--porcelain"])
  const normalized = path.resolve(directory)
  let current = ""
  let branch: string | undefined
  for (const line of listing.stdout.split("\n")) {
    if (line.startsWith("worktree ")) current = path.resolve(line.slice("worktree ".length).trim())
    if (line.startsWith("branch ") && current === normalized) {
      branch = line
        .slice("branch ".length)
        .trim()
        .replace(/^refs\/heads\//, "")
    }
  }

  return { files, ahead: Number.isFinite(count) ? count : 0, branch }
}

/** Remove a worktree directory and, when known, its branch. */
export async function remove(base: string, directory: string, branch?: string) {
  const removed = await git(base, ["worktree", "remove", "--force", directory])
  if (removed.code !== 0) return { ok: false as const, error: removed.stderr.trim() || removed.stdout.trim() }
  if (branch) await git(base, ["branch", "-D", branch])
  await git(base, ["worktree", "prune"])
  return { ok: true as const }
}
