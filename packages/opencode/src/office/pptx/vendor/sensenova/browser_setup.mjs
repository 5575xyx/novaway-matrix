import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
let hiddenHooksInstalled = false
const patchedModules = new WeakSet()

export function installHiddenProcessHooks() {
  if (hiddenHooksInstalled || process.platform !== "win32") return
  hiddenHooksInstalled = true
  patchChildProcessModule(require("node:child_process"))
  patchChildProcessModule(require("child_process"))
}

function patchChildProcessModule(childProcess) {
  if (patchedModules.has(childProcess)) return
  patchedModules.add(childProcess)
  const originalSpawn = childProcess.spawn.bind(childProcess)
  childProcess.spawn = (command, argsOrOptions, options) => {
    if (Array.isArray(argsOrOptions)) return originalSpawn(command, argsOrOptions, { ...options, windowsHide: true })
    if (argsOrOptions && typeof argsOrOptions === "object")
      return originalSpawn(command, { ...argsOrOptions, windowsHide: true })
    return originalSpawn(command, { windowsHide: true })
  }
}

export function hiddenChromiumLaunchOptions(options = {}) {
  return {
    headless: true,
    channel: process.env.NOVAWAY_PPT_BROWSER_CHANNEL || "chrome",
    ...options,
    args: [...(options.args || []), "--disable-breakpad", "--disable-crash-reporter"],
  }
}

export function ensureDependencies() {
  installHiddenProcessHooks()
}
