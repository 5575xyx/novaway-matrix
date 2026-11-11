/** Runtime bridge from the file panel to mounted binary Office editors. */
const officeSaves = new Map<string, { save: () => Promise<void>; snapshot?: () => Promise<Uint8Array | undefined> }>()
const officeCloseGuards = new Map<string, () => Promise<boolean>>()

export function registerOfficeEditorSave(
  path: string,
  save: () => Promise<void>,
  snapshot?: () => Promise<Uint8Array | undefined>,
) {
  const entry = { save, snapshot }
  officeSaves.set(path, entry)
  return () => {
    if (officeSaves.get(path) === entry) officeSaves.delete(path)
  }
}

/** Serialize the current editor without overwriting the source or clearing dirty state. */
export async function snapshotOfficeEditor(path: string | undefined) {
  if (!path) return undefined
  return officeSaves.get(path)?.snapshot?.()
}

export function registerOfficeEditorCloseGuard(path: string, guard: () => Promise<boolean>) {
  officeCloseGuards.set(path, guard)
  return () => {
    if (officeCloseGuards.get(path) === guard) officeCloseGuards.delete(path)
  }
}

export async function saveOfficeEditor(path: string | undefined) {
  if (!path) return false
  const entry = officeSaves.get(path)
  if (!entry) return false
  await entry.save()
  return true
}

export async function confirmOfficeEditorClose(path: string | undefined) {
  if (!path) return true
  return (await officeCloseGuards.get(path)?.()) ?? true
}
