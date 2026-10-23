import { describe, expect, test } from "bun:test"
import { installRapidOcr, looksLikeNetworkError, summarizeFailure } from "@/knowledge/ocr-install"

const okRunner = (calls: string[]) => async (input: { command: string; args: string[] }) => {
  calls.push(input.command + " " + input.args.join(" "))
  if (input.args.includes("venv")) return ""
  if (input.args.includes("pip")) return "Successfully installed rapidocr_onnxruntime"
  return "ok"
}

describe("knowledge.ocr-install", () => {
  test("detects network errors", () => {
    expect(looksLikeNetworkError("pip: Read timed out.")).toBe(true)
    expect(looksLikeNetworkError("Connection refused")).toBe(true)
    expect(looksLikeNetworkError("ERROR: Could not find a version that satisfies the requirement")).toBe(true)
    expect(looksLikeNetworkError("No space left on device")).toBe(false)
  })

  test("summarizes the useful error lines", () => {
    const text = summarizeFailure(
      [
        "Collecting rapidocr",
        "ERROR: Could not find a version that satisfies the requirement rapidocr",
        "ERROR: No matching distribution found for rapidocr",
      ].join("\n"),
    )
    expect(text).toContain("No matching distribution")
  })

  test("creates a venv and installs the package", async () => {
    const calls: string[] = []
    const result = await installRapidOcr({
      runner: okRunner(calls),
      root: "/tmp/novaway-ocr-test",
    })
    expect(result.ok).toBe(true)
    expect(result.module).toBe("rapidocr_onnxruntime")
    expect(calls.some((call) => call.includes("venv"))).toBe(true)
    expect(calls.some((call) => call.includes("pip install"))).toBe(true)
  })

  test("falls back to the mirror when the first index times out", async () => {
    const calls: string[] = []
    const result = await installRapidOcr({
      root: "/tmp/novaway-ocr-test",
      runner: async (input) => {
        calls.push(input.command + " " + input.args.join(" "))
        if (input.args.includes("venv")) return ""
        if (input.args.includes("pip")) {
          if (!input.args.includes("-i")) throw new Error("Read timed out.")
          return "installed"
        }
        return "ok"
      },
    })
    expect(result.ok).toBe(true)
    expect(calls.filter((call) => call.includes("pip install")).length).toBe(2)
    expect(calls.some((call) => call.includes("pypi.tuna.tsinghua.edu.cn"))).toBe(true)
  })

  test("reports a friendly hint when no python exists", async () => {
    const result = await installRapidOcr({
      root: "/tmp/novaway-ocr-test",
      allowDownload: false,
      runner: async () => {
        throw new Error("ENOENT")
      },
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain("Python")
    expect(result.hint).toBeTruthy()
  })

  test("bootstraps a managed environment with uv when python is missing", async () => {
    const calls: string[] = []
    const result = await installRapidOcr({
      root: "/tmp/novaway-ocr-test",
      allowDownload: false,
      uv: "uv",
      runner: async (input) => {
        calls.push(input.command + " " + input.args.join(" "))
        // 没有系统 Python：所有 python 探测都失败；venv 里的解释器可用。
        if (/python|py$|py -3/.test(input.command) && !input.command.includes("novaway-ocr-test")) {
          throw new Error("ENOENT")
        }
        return "ok"
      },
    })
    expect(result.ok).toBe(true)
    expect(calls.some((call) => call.startsWith("uv venv --python"))).toBe(true)
    expect(calls.some((call) => call.includes("uv pip install --python"))).toBe(true)
  })
})
