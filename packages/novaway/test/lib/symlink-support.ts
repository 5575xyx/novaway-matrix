import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * Probe the symlink capability the behavior tests require.
 * On Windows, an explicit EPERM/EACCES means the current account/policy cannot
 * create symlinks; other errors are unexpected and must remain test failures.
 */
export async function canCreateSymlinks() {
  if (process.platform !== "win32") return true

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-symlink-probe-"))
  try {
    const target = path.join(directory, "target")
    const link = path.join(directory, "link")
    await fs.writeFile(target, "probe")
    await fs.symlink(target, link, "file")
    return true
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined
    if (code === "EPERM" || code === "EACCES") return false
    throw error
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}
