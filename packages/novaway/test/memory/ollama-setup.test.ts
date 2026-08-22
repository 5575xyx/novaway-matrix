import { describe, expect, test } from "bun:test"
import {
  DEFAULT_EMBED_MODEL,
  findOllamaCli,
  inspectOllama,
  ollamaCliCandidates,
  tryInstallOllama,
} from "../../src/memory/ollama-setup"

describe("ollama setup inspect", () => {
  test("finds the Windows per-user install even when PATH has not refreshed", async () => {
    const env = { LOCALAPPDATA: String.raw`C:\Users\tester\AppData\Local` }
    const expected = String.raw`C:\Users\tester\AppData\Local\Programs\Ollama\ollama.exe`
    expect(ollamaCliCandidates("win32", env)).toContain(expected)
    const found = await findOllamaCli({
      osName: "win32",
      env,
      run: async () => ({ ok: false, code: 1, stdout: "", stderr: "not on PATH" }),
      exists: (file) => file === expected,
    })
    expect(found).toBe(expected)
  })

  test("falls back to the official Windows installer when winget cannot run", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = []
    const step = await tryInstallOllama({
      osName: "win32",
      env: { SystemRoot: String.raw`C:\Windows` },
      run: async (cmd, args) => {
        calls.push({ cmd, args })
        if (cmd === "winget") {
          return { ok: false, code: -1, stdout: "", stderr: "The file cannot be accessed by the system" }
        }
        return { ok: true, code: 0, stdout: "installed", stderr: "" }
      },
    })
    expect(step.status).toBe("ok")
    expect(step.detail).toContain("官方安装脚本")
    expect(calls).toHaveLength(2)
    expect(calls[1]?.args.join(" ")).toContain("https://ollama.com/install.ps1")
  })

  test("returns both automatic installer failures instead of a generic manual message", async () => {
    const step = await tryInstallOllama({
      osName: "win32",
      env: { SystemRoot: String.raw`C:\Windows` },
      run: async (cmd) => ({
        ok: false,
        code: 1,
        stdout: "",
        stderr: cmd === "winget" ? "winget unavailable" : "network blocked",
      }),
    })
    expect(step.status).toBe("manual")
    expect(step.detail).toContain("winget unavailable")
    expect(step.detail).toContain("network blocked")
  })

  test("passes a custom Windows install directory to the official installer", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = []
    const step = await tryInstallOllama({
      osName: "win32",
      env: { SystemRoot: String.raw`C:\Windows` },
      installDir: String.raw`E:\Apps\Ollama`,
      run: async (cmd, args) => {
        calls.push({ cmd, args })
        return { ok: true, code: 0, stdout: "installed", stderr: "" }
      },
    })
    expect(step.status).toBe("ok")
    expect(calls).toHaveLength(1)
    expect(calls[0]?.args.join(" ")).toContain("/DIR=")
    expect(calls[0]?.args.join(" ")).toContain(String.raw`E:\Apps\Ollama`)
  })

  test("returns a structured status even when daemon is offline", async () => {
    const status = await inspectOllama({
      baseURL: "http://127.0.0.1:9",
      preferredModel: DEFAULT_EMBED_MODEL,
    })
    expect(status.preferredModel).toBe(DEFAULT_EMBED_MODEL)
    expect(typeof status.cliInstalled).toBe("boolean")
    expect(status.daemonRunning).toBe(false)
    expect(status.ready).toBe(false)
    expect(status.modelsDir.length).toBeGreaterThan(0)
    expect(status.message.length).toBeGreaterThan(0)
    expect(status.downloadURL).toContain("ollama.com")
    // When CLI missing, should suggest install; when CLI present, should suggest start/pull.
    expect(["installing", "starting", "pulling", "idle", "needs_manual", "error", "ready"]).toContain(status.phase)
  })

  test("checks a configured Windows install directory before default locations", async () => {
    const installDir = String.raw`E:\Apps\Ollama`
    const expected = String.raw`E:\Apps\Ollama\ollama.exe`
    const found = await findOllamaCli({
      osName: "win32",
      env: {},
      installDir,
      run: async () => ({ ok: false, code: 1, stdout: "", stderr: "not on PATH" }),
      exists: (file) => file === expected,
    })
    expect(found).toBe(expected)
  })
})
