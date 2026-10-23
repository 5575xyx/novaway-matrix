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
