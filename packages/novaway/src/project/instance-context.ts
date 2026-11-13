import { LocalContext } from "@/util/local-context"
import { AppFileSystem } from "@novaway/core/filesystem"
import type * as Project from "./project"

export interface InstanceContext {
  directory: string
  worktree: string
  project: Project.Info
  scope?: "project" | "global"
}

export const context = LocalContext.create<InstanceContext>("instance")

/**
 * Check if a path is within the project boundary.
 * Returns true if path is inside ctx.directory OR ctx.worktree.
 * Paths within the worktree but outside the working directory should not trigger external_directory permission.
 */
export function containsPath(filepath: string, ctx: InstanceContext): boolean {
  if (AppFileSystem.contains(ctx.directory, filepath)) return true
  // Non-git projects set worktree to "/" which would match ANY absolute path.
  // Skip worktree check in this case to preserve external_directory permissions.
  if (ctx.worktree === "/") return false
  return AppFileSystem.contains(ctx.worktree, filepath)
}

/**
 * Workspace boundary for a session.
 *
 * A session may run in its own directory (team or arena worktree) while the
 * loaded instance points at the root checkout. In that case only the session
 * directory is in scope — otherwise the root checkout would silently count as
 * "inside the workspace" and worktree isolation would be nominal.
 */
export function containsSessionPath(filepath: string, ctx: InstanceContext, sessionDirectory?: string): boolean {
  if (sessionDirectory && AppFileSystem.normalizePath(sessionDirectory) !== AppFileSystem.normalizePath(ctx.directory))
    return AppFileSystem.contains(sessionDirectory, filepath)
  return containsPath(filepath, ctx)
}
