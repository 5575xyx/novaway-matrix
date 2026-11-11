import { Flag } from "@novaway/core/flag/flag"
import { Effect } from "effect"
import path from "path"

const preserveExerciseGlobalRoot = !!process.env.NOVAWAY_HTTPAPI_EXERCISE_GLOBAL
export const exerciseGlobalRoot =
  process.env.NOVAWAY_HTTPAPI_EXERCISE_GLOBAL ??
  path.join(process.env.TMPDIR ?? "/tmp", `novaway-httpapi-global-${process.pid}`)
process.env.XDG_DATA_HOME = path.join(exerciseGlobalRoot, "data")
process.env.XDG_CONFIG_HOME = path.join(exerciseGlobalRoot, "config")
process.env.XDG_STATE_HOME = path.join(exerciseGlobalRoot, "state")
process.env.XDG_CACHE_HOME = path.join(exerciseGlobalRoot, "cache")
const originalDisableShare = process.env.NOVAWAY_DISABLE_SHARE
const originalDisableDefaultPlugins = process.env.NOVAWAY_DISABLE_DEFAULT_PLUGINS
const originalRipgrepPath = process.env.NOVAWAY_RG_PATH
if (process.platform === "win32" && originalRipgrepPath === undefined) {
  const bundledRipgrep = path.join(import.meta.dir, "../../../../desktop/resources/ripgrep/rg.exe")
  if (await Bun.file(bundledRipgrep).exists()) process.env.NOVAWAY_RG_PATH = bundledRipgrep
}
process.env.NOVAWAY_DISABLE_SHARE = "true"
// The exerciser tests route behavior, not globally installed auth plugins. In a plain
// `bun run` process the unit-test preload is absent, and loading internal plugins while
// bootstrapping each HTTP instance can block route execution; keep this harness isolated.
process.env.NOVAWAY_DISABLE_DEFAULT_PLUGINS = "1"
export const exerciseConfigDirectory = path.join(exerciseGlobalRoot, "config", "novaway")
export const exerciseDataDirectory = path.join(exerciseGlobalRoot, "data", "novaway")

const preserveExerciseDatabase = !!process.env.NOVAWAY_HTTPAPI_EXERCISE_DB
export const exerciseDatabasePath =
  process.env.NOVAWAY_HTTPAPI_EXERCISE_DB ??
  path.join(process.env.TMPDIR ?? "/tmp", `novaway-httpapi-exercise-${process.pid}.db`)
process.env.NOVAWAY_DB = exerciseDatabasePath
Flag.NOVAWAY_DB = exerciseDatabasePath

export const original = {
  NOVAWAY_SERVER_PASSWORD: Flag.NOVAWAY_SERVER_PASSWORD,
  NOVAWAY_SERVER_USERNAME: Flag.NOVAWAY_SERVER_USERNAME,
}

export const cleanupExercisePaths = Effect.promise(async () => {
  const fs = await import("fs/promises")
  if (!preserveExerciseDatabase) {
    await Promise.all(
      [exerciseDatabasePath, `${exerciseDatabasePath}-wal`, `${exerciseDatabasePath}-shm`].map((file) =>
        fs.rm(file, { force: true }).catch(() => undefined),
      ),
    )
  }
  if (!preserveExerciseGlobalRoot)
    await fs.rm(exerciseGlobalRoot, { recursive: true, force: true }).catch(() => undefined)
  if (originalDisableShare === undefined) delete process.env.NOVAWAY_DISABLE_SHARE
  else process.env.NOVAWAY_DISABLE_SHARE = originalDisableShare
  if (originalDisableDefaultPlugins === undefined) delete process.env.NOVAWAY_DISABLE_DEFAULT_PLUGINS
  else process.env.NOVAWAY_DISABLE_DEFAULT_PLUGINS = originalDisableDefaultPlugins
  if (originalRipgrepPath === undefined) delete process.env.NOVAWAY_RG_PATH
  else process.env.NOVAWAY_RG_PATH = originalRipgrepPath
})
