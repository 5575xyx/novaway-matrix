import { execFile, spawn } from "node:child_process"
import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

async function commandExists(cmd: string): Promise<boolean> {
  if (process.platform === "win32") return false
  return new Promise((resolve) => {
    execFile("which", [cmd], (err) => resolve(!err))
  })
}

function shellEscape(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`
}

export async function copyLocalFileToClipboard(filePath: string): Promise<boolean> {
  const platform = process.platform

  if (platform === "win32") {
    // 使用 WinForms Clipboard 将文件路径作为文件对象写入剪贴板，资源管理器可识别并粘贴
    const escapedPath = filePath.replace(/'/g, "''")
    const psCommand = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$files = New-Object System.Collections.Specialized.StringCollection",
      `$files.Add('${escapedPath}')`,
      "[System.Windows.Forms.Clipboard]::SetFileDropList($files)",
    ].join("\n")
    return new Promise((resolve) => {
      execFile("powershell.exe", ["-NoProfile", "-Command", psCommand], (err) => resolve(!err))
    })
  }

  if (platform === "darwin") {
    return new Promise((resolve) => {
      execFile("osascript", ["-e", `set the clipboard to (POSIX file ${shellEscape(filePath)})`], (err) =>
        resolve(!err),
      )
    })
  }

  // Linux：优先 Wayland 的 wl-copy，再回退到 xclip
  const uri = `file://${filePath}`
  if (process.env.WAYLAND_DISPLAY && (await commandExists("wl-copy"))) {
    return new Promise((resolve) => {
      execFile("wl-copy", ["--type", "text/uri-list", uri], (err) => resolve(!err))
    })
  }
  if (await commandExists("xclip")) {
    return new Promise((resolve) => {
      const child = spawn("xclip", ["-selection", "clipboard", "-target", "x-special/gnome-copied-files", "-i"])
      let error: Error | undefined
      child.on("error", (err) => {
        error = err
      })
      child.on("close", (code) => {
        resolve(code === 0 && !error)
      })
      child.stdin.write(`copy\n${uri}\n`)
      child.stdin.end()
    })
  }

  return false
}

export async function downloadUrlToTempFile(url: string, filename: string): Promise<string | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "opencode-clipboard-"))
    const ext = path.extname(filename) || ".mp4"
    const base = path.basename(filename, ext) || "video"
    const targetPath = path.join(tmpDir, `${base}${ext}`)
    await writeFile(targetPath, buffer)
    return targetPath
  } catch {
    return null
  }
}
