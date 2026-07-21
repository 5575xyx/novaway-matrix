import path from "node:path"

/**
 * PowersNexus CLI 必须用真正的 Node/Bun 运行。
 * 桌面 sidecar 运行在 Electron utilityProcess 中时，process.execPath 是 Electron，
 * 用它执行 powersnexus-cli.js 会导致进程崩溃（Windows 上常见 0xC0000409）。
 */
export function powersnexusNodeExecutable() {
  const fromEnv = process.env.POWERSNEXUS_NODE_PATH || process.env.DBX_NODE_PATH
  if (fromEnv && fromEnv !== "node" && fromEnv !== "node.exe") return fromEnv

  const base = path.basename(process.execPath).toLowerCase()
  if (base.includes("electron") || base.includes("novaway") || base === "nova way.exe") {
    return process.platform === "win32" ? "node.exe" : "node"
  }
  // bun / node 可直接作为 JS 运行器
  return process.execPath
}

export * as PowersNexusNode from "./node-exec"