// IMPORTANT: Set env vars BEFORE any imports from src/ directory
// xdg-basedir reads env vars at import time, so we must set these first
import os from "os"
import path from "path"
import fs from "fs/promises"
import { setTimeout as sleep } from "node:timers/promises"
import { afterAll } from "bun:test"

// Set XDG env vars FIRST, before any src/ imports
const dir = path.join(os.tmpdir(), "opencode-test-data-" + process.pid)
await fs.mkdir(dir, { recursive: true })
afterAll(async () => {
  const { Database } = await import("../src/storage/db")
  Database.close()
  const busy = (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY"
  const rm = async (left: number): Promise<void> => {
    Bun.gc(true)
    await sleep(100)
    return fs.rm(dir, { recursive: true, force: true }).catch((error) => {
      if (!busy(error)) throw error
      if (left <= 1) throw error
      return rm(left - 1)
    })
  }

  // Windows can keep SQLite WAL handles alive until GC finalizers run, so we
  // force GC and retry teardown to avoid flaky EBUSY in test cleanup.
  await rm(30)
  // Bun's default hook budget is 5s; removing the data dir with retries is
  // routinely slower than that on Windows and showed up as a phantom
  // "(unnamed)" timeout at the end of every suite.
}, 60_000)

process.env["XDG_DATA_HOME"] = path.join(dir, "share")
process.env["XDG_CACHE_HOME"] = path.join(dir, "cache")
process.env["XDG_CONFIG_HOME"] = path.join(dir, "config")
process.env["XDG_STATE_HOME"] = path.join(dir, "state")
process.env["NOVAWAY_MODELS_PATH"] = path.join(import.meta.dir, "tool", "fixtures", "models-api.json")
process.env["NOVAWAY_EXPERIMENTAL_EVENT_SYSTEM"] = "true"
process.env["NOVAWAY_EXPERIMENTAL_WORKSPACES"] = "true"
// Tests must never reach the network for plugin installs (the default global
// plugin is a git dependency). Individual tests opt in by building their own layer.
process.env["NOVAWAY_DISABLE_DEFAULT_PLUGINS"] = "1"
// Same reason: the server provisions built-in extensions (ppt-master) in the
// background after `Server.listen()`. Tests must stay offline and hermetic.
process.env["NOVAWAY_DISABLE_AUTOPROVISION"] = "1"

// Set test home directory to isolate tests from user's actual home directory
// This prevents tests from picking up real user configs/skills from ~/.claude/skills
const testHome = path.join(dir, "home")
await fs.mkdir(testHome, { recursive: true })
process.env["NOVAWAY_TEST_HOME"] = testHome
process.env["OPENCODE_TEST_HOME"] = testHome

// Set test managed config directory to isolate tests from system managed settings
const testManagedConfigDir = path.join(dir, "managed")
process.env["NOVAWAY_TEST_MANAGED_CONFIG_DIR"] = testManagedConfigDir

// Write the cache version file to prevent global/index.ts from clearing the cache
const cacheDir = path.join(dir, "cache", "opencode")
await fs.mkdir(cacheDir, { recursive: true })
await fs.writeFile(path.join(cacheDir, "version"), "14")

// Seed the ripgrep binary from the desktop bundle when present. The ripgrep
// service otherwise downloads it from GitHub on first use, which makes every
// grep/glob test depend on network access (and hang behind a firewall).
if (process.platform === "win32") {
  const bundled = path.join(import.meta.dir, "..", "..", "desktop", "resources", "ripgrep", "rg.exe")
  const target = path.join(dir, "cache", "novaway", "bin", "rg.exe")
  const available = await fs
    .stat(bundled)
    .then(() => true)
    .catch(() => false)
  if (available) {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(bundled, target)
  }
}

// Clear provider and server auth env vars to ensure clean test state
delete process.env["ANTHROPIC_API_KEY"]
delete process.env["OPENAI_API_KEY"]
delete process.env["GOOGLE_API_KEY"]
delete process.env["GOOGLE_GENERATIVE_AI_API_KEY"]
delete process.env["AZURE_OPENAI_API_KEY"]
delete process.env["AWS_ACCESS_KEY_ID"]
delete process.env["AWS_PROFILE"]
delete process.env["AWS_REGION"]
delete process.env["AWS_BEARER_TOKEN_BEDROCK"]
delete process.env["OPENROUTER_API_KEY"]
delete process.env["LLM_GATEWAY_API_KEY"]
delete process.env["GROQ_API_KEY"]
delete process.env["MISTRAL_API_KEY"]
delete process.env["PERPLEXITY_API_KEY"]
delete process.env["TOGETHER_API_KEY"]
delete process.env["XAI_API_KEY"]
delete process.env["DEEPSEEK_API_KEY"]
delete process.env["FIREWORKS_API_KEY"]
delete process.env["CEREBRAS_API_KEY"]
delete process.env["SAMBANOVA_API_KEY"]
delete process.env["NOVAWAY_SERVER_PASSWORD"]
delete process.env["NOVAWAY_SERVER_USERNAME"]

// Use in-memory sqlite
process.env["NOVAWAY_DB"] = ":memory:"

// Now safe to import from src/
const { Log } = await import("@novaway/core/util/log")
const { initProjectors } = await import("../src/server/projectors")

void Log.init({
  print: false,
  dev: true,
  level: "DEBUG",
})

initProjectors()
