export function showOfficeNewSessionWorkspace(mode: string | undefined, sessionID: string | undefined) {
  return mode === "zen" && !sessionID
}

export function showOfficeSessionComposer(mode: string | undefined, sessionID: string | undefined) {
  return mode === "zen" && !!sessionID
}
