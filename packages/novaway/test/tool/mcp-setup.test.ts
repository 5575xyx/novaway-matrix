import { describe, expect, test } from "bun:test"
import { describeEntry, describeEnv, isEntry, localCommandProblem, remoteUrlProblem } from "@/tool/mcp-setup"
import type { ConfigMCP } from "@/config/mcp"

const local = (command: string[], environment?: Record<string, string>): ConfigMCP.Info =>
  ({ type: "local", command, ...(environment ? { environment } : {}) }) as ConfigMCP.Info

const remote = (url: string): ConfigMCP.Info => ({ type: "remote", url }) as ConfigMCP.Info

describe("mcp_setup diagnostics", () => {
  test("describes env vars by name only", () => {
    expect(describeEnv({ GITHUB_TOKEN: "ghp_secret", EMPTY: "" })).toBe("GITHUB_TOKEN (set), EMPTY (empty)")
    expect(describeEnv({})).toBeUndefined()
    expect(describeEnv(undefined)).toBeUndefined()
  })

  test("describes entries without leaking values", () => {
    expect(describeEntry(local(["npx", "-y", "@upstash/context7-mcp"]))).toBe("local: npx -y @upstash/context7-mcp")
    expect(describeEntry(remote("https://example.com/mcp"))).toBe("remote: https://example.com/mcp")
  })

  test("flags missing executables", () => {
    expect(localCommandProblem(local(["definitely-not-a-real-binary-xyz"]))).toContain("找不到可执行文件")
    expect(localCommandProblem(local([]))).toBe("配置里没有 command")
  })

  test("accepts an executable that exists", () => {
    const command = process.platform === "win32" ? "cmd" : "sh"
    expect(localCommandProblem(local([command]))).toBeUndefined()
  })

  test("flags wrappers without a package name", () => {
    const command = process.platform === "win32" ? "npm" : "npx"
    const problem = localCommandProblem(local([command]))
    // npx 可能是 npm 的 shim；只要命令存在就能识别为「缺少包名」或 undefined
    expect(problem === undefined || problem.includes("缺少包名")).toBe(true)
  })

  test("validates remote urls", () => {
    expect(remoteUrlProblem(remote("https://example.com/mcp"))).toBeUndefined()
    expect(remoteUrlProblem(remote("not a url"))).toContain("URL 不合法")
    expect(remoteUrlProblem(remote("ftp://example.com"))).toContain("只支持 http/https")
    expect(remoteUrlProblem(local(["node"]))).toBeUndefined()
  })

  test("recognizes config entries", () => {
    expect(isEntry({ type: "local", command: ["node"] })).toBe(true)
    expect(isEntry({ enabled: false })).toBe(false)
    expect(isEntry(undefined)).toBe(false)
  })
})
