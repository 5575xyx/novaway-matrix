import type { Session } from "@novaway/sdk/v2/client"
import { pathKey } from "@/utils/path-key"

/** Index once per directory, preserving directory/row order and the first copy of each child. */
export function indexSidebarChildren(
  roots: readonly Session[],
  sessionsIn: (directory: string) => readonly Session[] | undefined,
) {
  const directories = new Set<string>()
  const children = new Map<string, Session[]>()
  const seenByParent = new Map<string, Set<string>>()
  for (const root of roots) {
    const directory = pathKey(root.directory)
    if (directories.has(directory)) continue
    directories.add(directory)
    for (const session of sessionsIn(directory) ?? []) {
      if (!session.parentID) continue
      const seen = seenByParent.get(session.parentID)
      if (!seen) {
        seenByParent.set(session.parentID, new Set([session.id]))
        children.set(session.parentID, [session])
        continue
      }
      if (seen.has(session.id)) continue
      seen.add(session.id)
      children.get(session.parentID)!.push(session)
    }
  }
  return children
}
