import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { planLocalCommand, prependPath, runtimePaths, unwrapShell } from "@/mcp/runtime"

const noBins = () => false
const runtime = {
  node: "/opt/novaway/node/node.exe",
  npmRoot: "/opt/novaway/node/node_modules/npm",
  uv: "/opt/novaway/bin/uv.exe",
}

describe("mcp.runtime", () => {
  test("unwraps cmd /c and sh -c wrappers", () => {
    expect(unwrapShell(["cmd", "/c", "npx", "-y", "pkg"])).toEqual(["npx", "-y", "pkg"])
    expect(unwrapShell(["cmd", "/d", "/c", "node", "server.js"])).toEqual(["node", "server.js"])
    expect(unwrapShell(["sh", "-c", "node server.js"])).toEqual(["node", "server.js"])
    // 不是包装形态就原样返回
    expect(unwrapShell(["node", "server.js"])).toEqual(["node", "server.js"])
    expect(unwrapShell(["cmd"])).toEqual(["cmd"])
  })

  test("keeps the user's own runtimes", () => {
    const has = (bin: string) => ["node", "npx", "uvx"].includes(bin)
    expect(planLocalCommand({ command: ["node", "x.js"], has, runtime })).toEqual({
      command: ["node", "x.js"],
      env: {},
    })
    expect(planLocalCommand({ command: ["cmd", "/c", "npx", "-y", "pkg"], has, runtime })).toEqual({
      command: ["cmd", "/c", "npx", "-y", "pkg"],
      env: {},
    })
    expect(planLocalCommand({ command: ["uvx", "mcp-server-fetch"], has, runtime })).toEqual({
      command: ["uvx", "mcp-server-fetch"],
      env: {},
    })
  })

  test("falls back to the bundled node", () => {
    const plan = planLocalCommand({ command: ["node", "server.js"], has: noBins, runtime, path: "/usr/bin" })
    if ("error" in plan) throw new Error(plan.error)
    expect(plan.command).toEqual(["/opt/novaway/node/node.exe", "server.js"])
    expect(plan.fallback).toBe("node")
    expect(plan.env.PATH?.startsWith(path.dirname("/opt/novaway/node/node.exe"))).toBe(true)
  })

  test("runs npx through the bundled npm cli", () => {
    const plan = planLocalCommand({
      command: ["cmd", "/c", "npx", "-y", "pkg"],
      has: noBins,
      runtime,
      path: "/usr/bin",
    })
    if ("error" in plan) throw new Error(plan.error)
    expect(plan.command).toEqual([
      "/opt/novaway/node/node.exe",
      path.join("/opt/novaway/node/node_modules/npm", "bin", "npx-cli.js"),
      "-y",
      "pkg",
    ])
    // 包自己的 bin 是 `#!/usr/bin/env node`，PATH 里要有内置 node
    expect(plan.env.PATH?.startsWith(path.dirname("/opt/novaway/node/node.exe"))).toBe(true)
    expect(plan.env.npm_config_update_notifier).toBe("false")
  })

  test("runs uvx through uv tool run", () => {
    const plan = planLocalCommand({ command: ["uvx", "mcp-server-fetch"], has: noBins, runtime })
    if ("error" in plan) throw new Error(plan.error)
    expect(plan.command).toEqual(["/opt/novaway/bin/uv.exe", "tool", "run", "mcp-server-fetch"])
    expect(plan.fallback).toBe("uvx")
  })

  test("explains what is missing instead of spawn ENOENT", () => {
    expect(planLocalCommand({ command: ["node", "x.js"], has: noBins, runtime: {} })).toEqual({
      error: expect.stringContaining("Node.js"),
    })
    const npx = planLocalCommand({ command: ["npx", "-y", "pkg"], has: noBins, runtime: { node: "/n/node" } })
    expect("error" in npx && npx.error).toContain("npm")
    const uv = planLocalCommand({ command: ["uvx", "x"], has: noBins, runtime: {} })
    expect("error" in uv && uv.error).toContain("uv")
  })

  test("prepends a directory once", () => {
    expect(prependPath("/a", "/b:/c", "linux")).toBe("/a:/b:/c")
    expect(prependPath("/a", "/a:/b", "linux")).toBe("/a:/b")
    expect(prependPath("C:\a", "C:\b;C:\c", "win32")).toBe("C:\a;C:\b;C:\c")
  })

  test("detects a portable node with npm next to it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-node-"))
    const node = path.join(dir, "node.exe")
    await fs.writeFile(node, "")
    await fs.mkdir(path.join(dir, "node_modules", "npm", "bin"), { recursive: true })
    await fs.writeFile(path.join(dir, "node_modules", "npm", "bin", "npx-cli.js"), "")

    const paths = runtimePaths({ NOVAWAY_NODE_PATH: node } as NodeJS.ProcessEnv)
    expect(paths.node).toBe(node)
    expect(paths.npmRoot).toBe(path.join(dir, "node_modules", "npm"))
    await fs.rm(dir, { recursive: true, force: true })
  })

  test("ignores a relative node path from the dev environment", () => {
    expect(runtimePaths({ NOVAWAY_NODE_PATH: "node" } as NodeJS.ProcessEnv).node).toBeUndefined()
  })
})
