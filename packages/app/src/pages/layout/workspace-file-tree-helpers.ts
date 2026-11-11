/** Prefer the routed workspace (including sandboxes), then fall back to its project root. */
export function resolveWorkspaceTreeDirectory(routeDirectory: string, projectDirectory?: string): string {
  return routeDirectory || projectDirectory || ""
}

/** 文件树里目标路径的所有父目录（相对工作区，不含自身）。 */
export function workspaceDirectoryAncestors(path: string): string[] {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean)
  const dirs: string[] = []
  let current = ""
  for (const part of parts.slice(0, -1)) {
    current = current ? `${current}/${part}` : part
    dirs.push(current)
  }
  return dirs
}

/** 目标路径所在的可见行下标；压缩目录用 compactedPaths 承担深层路径。 */
export function findRevealRowIndex(
  rows: ReadonlyArray<{ entry: { path: string }; compactedPaths?: string[] }>,
  target: string,
): number {
  const normalized = target.replaceAll("\\", "/")
  return rows.findIndex((row) => row.entry.path === normalized || (row.compactedPaths?.includes(normalized) ?? false))
}

export type WorkspaceTreeArrowAction = "expand" | "collapse" | "focus-parent" | "focus-child" | "none"

export function workspaceTreeArrowAction(input: {
  key: "ArrowLeft" | "ArrowRight"
  isDirectory: boolean
  expanded: boolean
}): WorkspaceTreeArrowAction {
  if (input.key === "ArrowRight") {
    if (!input.isDirectory) return "none"
    return input.expanded ? "focus-child" : "expand"
  }
  if (!input.isDirectory) return "focus-parent"
  return input.expanded ? "collapse" : "focus-parent"
}

/** 树标题优先显示工作区目录名，取不到时回落到调用方给的默认文案。 */
export function workspaceTreeName(directory: string, fallback: string): string {
  return directory.split(/[\\/]/).filter(Boolean).at(-1) || fallback
}
