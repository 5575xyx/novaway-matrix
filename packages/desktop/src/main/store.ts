import Store from "electron-store"
import { app } from "electron"

import { SETTINGS_STORE } from "./constants"

const cache = new Map<string, Store>()

// We cannot instantiate the electron-store at module load time because
// module import hoisting causes this to run before app.setPath("userData", ...)
// in index.ts has executed, which would result in files being written to the default directory
// (e.g. bad: %APPDATA%\@NovaWay-ai\desktop\novaway.settings vs good: %APPDATA%\ai.novaway.desktop.dev\novaway.settings).
export function getStore(name = SETTINGS_STORE) {
  const cached = cache.get(name)
  if (cached) return cached
  const next = new Store({
    name,
    cwd: app.getPath("userData"),
    fileExtension: "",
    accessPropertiesByDotNotation: false,
  })
  cache.set(name, next)
  return next
}

export function getSetting(key: string) {
  return getStore().get(key)
}
