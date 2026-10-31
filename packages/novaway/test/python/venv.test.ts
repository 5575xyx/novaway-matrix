import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ensureVenv, looksLikeNetworkError, venvPythonAt } from "@/python/venv"

const candidates = [{ command: "python", args: [], label: "python" }]

const okRunner = (calls: string[]) => async (input: { command: string; args: string[] }) => {
  calls.push(input.command + " " + input.args.join(" "))
  return "ok"
}

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "novaway-venv-"))
}

describe("python.venv", () => {
  test("installs from a requirements file", async () => {
    const root = await tempDir()
    const requirements = path.join(root, "requirements.txt")
    await fs.writeFile(requirements, "python-pptx\n")
    const calls: string[] = []
    const result = await ensureVenv({
      root: path.join(root, "env"),
      candidates,
      requirements,
      label: "demo",
      indexes: [""],
      runner: okRunner(calls),
    })
    expect(result.ok).toBe(true)
    expect(result.python).toBe(venvPythonAt(path.join(root, "env")))
    expect(calls.some((call) => call.includes("-r " + requirements))).toBe(true)
  })

  test("verifies every module in all mode", async () => {
    const root = await tempDir()
    const calls: string[] = []
    const result = await ensureVenv({
      root,
      candidates,
      packages: ["python-pptx"],
      modules: ["yaml", "pptx"],
      label: "demo",
      indexes: [""],
      runner: async (input) => {
        calls.push(input.command + " " + input.args.join(" "))
        if (input.args.join(" ").includes("import yaml")) throw new Error("ModuleNotFoundError: yaml")
        return "ok"
      },
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain("demo")
    // all 模式在第一个失败处停下，不会假装后面的模块验证过。
    expect(calls.some((call) => call.includes("import yaml"))).toBe(true)
    expect(calls.some((call) => call.includes("import pptx"))).toBe(false)
  })

  test("any mode is satisfied by a single module", async () => {
    const root = await tempDir()
    const result = await ensureVenv({
      root,
      candidates,
      packages: ["demo"],
      modules: ["first", "second"],
      moduleMode: "any",
      label: "demo",
      indexes: [""],
      runner: async (input) => {
        if (input.args.join(" ").includes("import first")) throw new Error("missing")
        return "ok"
      },
    })
    expect(result.ok).toBe(true)
  })

  test("reports a hint when no python is available", async () => {
    const root = await tempDir()
    const result = await ensureVenv({
      root,
      candidates,
      packages: ["demo"],
      label: "demo",
      indexes: [""],
      allowDownload: false,
      runner: async () => {
        throw new Error("ENOENT")
      },
    })
    expect(result.ok).toBe(false)
    expect(result.hint).toBeTruthy()
  })

  test("falls back to uv-managed python when the system one is too old", async () => {
    const root = await tempDir()
    const calls: string[] = []
    const result = await ensureVenv({
      root,
      candidates,
      packages: ["python-pptx"],
      label: "demo",
      indexes: [""],
      uv: "uv-test",
      runner: async (input) => {
        calls.push(input.command + " " + input.args.join(" "))
        if (input.args.join(" ").includes("version_info")) return "(3, 8)"
        if (input.args[0] === "venv") {
          // uv 只会接管建环境；真解释器由它下载，这里模拟成功。
          await fs.mkdir(path.join(root, "venv"), { recursive: true })
        }
        return "ok"
      },
    })
    expect(result.ok).toBe(true)
    // 3.8 的解释器不该被用来建环境。
    expect(calls.some((call) => call.startsWith("python -m venv"))).toBe(false)
    expect(calls.some((call) => call.includes("uv-test venv --python 3.12"))).toBe(true)
  })

  test("uses uv-managed python when nothing is installed at all", async () => {
    const root = await tempDir()
    const calls: string[] = []
    const result = await ensureVenv({
      root,
      candidates,
      packages: ["python-pptx"],
      label: "ppt-master",
      indexes: [""],
      uv: "uv-test",
      runner: async (input) => {
        calls.push(input.command + " " + input.args.join(" "))
        if (input.command === "python" || input.command === "python3" || input.command === "py") {
          throw new Error("ENOENT: no such file")
        }
        if (input.args[0] === "venv") await fs.mkdir(path.join(root, "venv"), { recursive: true })
        return "ok"
      },
    })
    expect(result.ok).toBe(true)
    expect(calls.some((call) => call.includes("uv-test venv --python 3.12"))).toBe(true)
    expect(calls.some((call) => call.includes("pip install"))).toBe(true)
  })

  test("recognises real-world uv/pip network errors", () => {
    const network = [
      [
        "error: Request failed after 3 retries in 30.8s",
        "  cause: Failed to fetch: https://files.pythonhosted.org/x.whl",
      ].join(String.fromCharCode(10)),
      "cause: client error (Connect)",
      "cause: tls handshake eof",
      "Read timed out.",
      "Could not find a version that satisfies the requirement foo (from versions: none)",
      "Temporary failure in name resolution",
    ]
    for (const log of network) expect(looksLikeNetworkError(log)).toBe(true)
    // 依赖冲突换镜像没用，不该被当成网络问题重试。
    expect(looksLikeNetworkError("ResolutionImpossible: conflicting dependencies foo==1 and bar==2")).toBe(false)
  })
})
