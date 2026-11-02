/**
 * 电脑控制（桌面自动化）。
 *
 * 不引入原生模块（robotjs / nut.js 都要按平台编译），改用系统自带能力：
 * - Windows：PowerShell + user32（鼠标/键盘/截图）+ SendKeys
 * - macOS：screencapture + System Events（osascript）
 * - Linux：xdotool + 常见截图工具（gnome-screenshot / scrot / imagemagick / grim）
 */
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)
const TIMEOUT = 20_000

export type ComputerPlatform = "windows" | "macos" | "linux" | "unsupported"

export type ComputerStatus = {
  supported: boolean
  platform: ComputerPlatform
  capabilities: { screenshot: boolean; mouse: boolean; keyboard: boolean; windows: boolean }
  reason?: string
}

export type Screenshot = {
  path: string
  base64: string
  mime: string
  /** 截图方式：整屏 / 指定窗口（PrintWindow 可在后台截，不需要切前台）。 */
  mode?: "screen" | "print-window" | "screen-region" | "window"
  window?: { title: string; width?: number; height?: number }
}
export type WindowInfo = { title: string; id?: string; pid?: number }
export type MouseButton = "left" | "right" | "middle"

export function platform(): ComputerPlatform {
  if (process.platform === "win32") return "windows"
  if (process.platform === "darwin") return "macos"
  if (process.platform === "linux") return "linux"
  return "unsupported"
}

async function which(command: string) {
  try {
    await exec(process.platform === "win32" ? "where" : "which", [command], { timeout: 5_000 })
    return true
  } catch {
    return false
  }
}

let statusCache: { at: number; value: ComputerStatus } | undefined

export async function status(): Promise<ComputerStatus> {
  if (statusCache && Date.now() - statusCache.at < 15_000) return statusCache.value
  const current = platform()
  let value: ComputerStatus
  if (current === "windows") {
    value = {
      supported: true,
      platform: current,
      capabilities: { screenshot: true, mouse: true, keyboard: true, windows: true },
    }
  } else if (current === "macos") {
    const cliclick = await which("cliclick")
    value = {
      supported: true,
      platform: current,
      capabilities: { screenshot: true, mouse: true, keyboard: true, windows: true },
      ...(cliclick ? {} : { reason: "Scrolling needs cliclick (brew install cliclick); other actions work." }),
    }
  } else if (current === "linux") {
    const xdotool = await which("xdotool")
    const shot =
      (await which("gnome-screenshot")) || (await which("scrot")) || (await which("import")) || (await which("grim"))
    value = {
      supported: Boolean(xdotool || shot),
      platform: current,
      capabilities: { screenshot: Boolean(shot), mouse: xdotool, keyboard: xdotool, windows: xdotool },
      ...(xdotool ? {} : { reason: "xdotool is required: sudo apt install xdotool" }),
    }
  } else {
    value = {
      supported: false,
      platform: current,
      capabilities: { screenshot: false, mouse: false, keyboard: false, windows: false },
      reason: "Unsupported platform",
    }
  }
  statusCache = { at: Date.now(), value }
  return value
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

const WIN_USER32 = [
  "using System;",
  "using System.Runtime.InteropServices;",
  "public class NovaWin {",
  '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);',
  '  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);',
  '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
  '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);',
  "}",
].join(String.fromCharCode(10))

const WIN_BRIDGE = ['Add-Type -TypeDefinition @"', WIN_USER32, '"@'].join(String.fromCharCode(10))

async function powershell(script: string, timeout = TIMEOUT) {
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  const result = await exec(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    { timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
  )
  return result.stdout ?? ""
}

const MOUSE_FLAGS: Record<MouseButton, { down: number; up: number }> = {
  left: { down: 2, up: 4 },
  right: { down: 8, up: 16 },
  middle: { down: 32, up: 64 },
}

async function windowsClick(x: number, y: number, button: MouseButton) {
  const flags = MOUSE_FLAGS[button]
  const nl = String.fromCharCode(10)
  await powershell(
    [
      WIN_BRIDGE,
      "[NovaWin]::SetCursorPos(" + Math.round(x) + ", " + Math.round(y) + ") | Out-Null",
      "Start-Sleep -Milliseconds 40",
      "[NovaWin]::mouse_event(" + flags.down + ", 0, 0, 0, [UIntPtr]::Zero)",
      "Start-Sleep -Milliseconds 30",
      "[NovaWin]::mouse_event(" + flags.up + ", 0, 0, 0, [UIntPtr]::Zero)",
    ].join(nl),
  )
}

async function windowsMove(x: number, y: number) {
  await powershell(
    WIN_BRIDGE +
      String.fromCharCode(10) +
      "[NovaWin]::SetCursorPos(" +
      Math.round(x) +
      ", " +
      Math.round(y) +
      ") | Out-Null",
  )
}

async function windowsScroll(amount: number) {
  const delta = Math.round(amount) * 120
  const nl = String.fromCharCode(10)
  await powershell([WIN_BRIDGE, "[NovaWin]::mouse_event(0x0800, 0, 0, " + delta + ", [UIntPtr]::Zero)"].join(nl))
}

async function windowsType(text: string) {
  // 用剪贴板粘贴：SendKeys 无法输入中文；粘贴后恢复原剪贴板。
  const encoded = Buffer.from(text, "utf8").toString("base64")
  const nl = String.fromCharCode(10)
  await powershell(
    [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$prev = Get-Clipboard -Raw",
      '$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("' + encoded + '"))',
      "Set-Clipboard -Value $text",
      "Start-Sleep -Milliseconds 60",
      '[System.Windows.Forms.SendKeys]::SendWait("^v")',
      "Start-Sleep -Milliseconds 150",
      'if ($null -ne $prev) { Set-Clipboard -Value $prev } else { Set-Clipboard -Value "" }',
    ].join(nl),
  )
}

const SENDKEYS_SPECIAL: Record<string, string> = {
  enter: "{ENTER}",
  return: "{ENTER}",
  tab: "{TAB}",
  escape: "{ESC}",
  esc: "{ESC}",
  backspace: "{BACKSPACE}",
  delete: "{DELETE}",
  insert: "{INSERT}",
  home: "{HOME}",
  end: "{END}",
  pageup: "{PGUP}",
  pagedown: "{PGDN}",
  up: "{UP}",
  down: "{DOWN}",
  left: "{LEFT}",
  right: "{RIGHT}",
  space: " ",
}

/** 把 Ctrl+Shift+A 转成 SendKeys 的 ^+a。 */
export function toSendKeys(combo: string) {
  const parts = combo
    .split("+")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  if (parts.length === 0) return ""
  const key = parts.pop()!
  let prefix = ""
  for (const modifier of parts) {
    if (modifier === "ctrl" || modifier === "control") prefix += "^"
    else if (modifier === "shift") prefix += "+"
    else if (modifier === "alt" || modifier === "option") prefix += "%"
  }
  const special = SENDKEYS_SPECIAL[key]
  if (special) return prefix + special
  if (/^f\d{1,2}$/.test(key)) return prefix + "{" + key.toUpperCase() + "}"
  return prefix + key
}

async function windowsKey(combo: string) {
  const keys = toSendKeys(combo)
  if (!keys) throw new Error("Empty key combination")
  const nl = String.fromCharCode(10)
  await powershell(
    [
      "Add-Type -AssemblyName System.Windows.Forms",
      '[System.Windows.Forms.SendKeys]::SendWait("' + keys.replace(/"/g, '""') + '")',
    ].join(nl),
  )
}

async function windowsScreenshot(): Promise<Screenshot> {
  const file = path.join(os.tmpdir(), "novaway-screen-" + process.pid + "-" + Date.now() + ".png")
  const nl = String.fromCharCode(10)
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen",
    "$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height",
    "$g = [System.Drawing.Graphics]::FromImage($bmp)",
    "$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)",
    '$bmp.Save("' +
      file.split(String.fromCharCode(92)).join(String.fromCharCode(92, 92)) +
      '", [System.Drawing.Imaging.ImageFormat]::Png)',
    "$g.Dispose()",
    "$bmp.Dispose()",
  ].join(nl)
  await powershell(script)
  const buffer = await fs.readFile(file)
  await fs.rm(file, { force: true })
  return { path: file, base64: buffer.toString("base64"), mime: "image/png", mode: "screen" }
}

/**
 * 只截指定窗口（按标题模糊匹配）。
 *
 * Windows 用 PrintWindow(PW_RENDERFULLCONTENT)：不需要把窗口切到前台，也不会把
 * 盖在它上面的其它窗口一起截进来；Electron/Chromium 等自绘窗口也能拿到内容。
 * 如果 PrintWindow 失败（少数老式/受保护的窗口），退回按窗口矩形做区域截图。
 * macOS / Linux 分别用 screencapture -R 与 ImageMagick import -window 的窗口级能力。
 */
async function windowsScreenshotWindow(title: string): Promise<Screenshot> {
  const file = path.join(os.tmpdir(), "novaway-window-" + process.pid + "-" + Date.now() + ".png")
  const nl = String.fromCharCode(10)
  const escapedTitle = title.replace(/'/g, "''")
  const escapedFile = file.split(String.fromCharCode(92)).join(String.fromCharCode(92, 92))
  const script = [
    "Add-Type -AssemblyName System.Drawing",
    'Add-Type -TypeDefinition @"',
    "using System;",
    "using System.Runtime.InteropServices;",
    "public class NovaShot {",
    "  [StructLayout(LayoutKind.Sequential)]",
    "  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }",
    '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);',
    '  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);',
    '  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);',
    '  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();',
    "}",
    '"@',
    "[NovaShot]::SetProcessDPIAware() | Out-Null",
    "$needle = '" + escapedTitle + "'",
    '$p = Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -like ("*" + $needle + "*") } | Select-Object -First 1',
    'if (-not $p) { Write-Output "NOVA_WINDOW_NOT_FOUND"; return }',
    "$h = $p.MainWindowHandle",
    'if ($h -eq 0) { Write-Output "NOVA_WINDOW_HANDLE_MISSING"; return }',
    // 最小化的窗口先无激活地还原（SW_SHOWNOACTIVATE=4），不抢用户焦点。
    "if ([NovaShot]::IsIconic($h)) { [NovaShot]::ShowWindow($h, 4) | Out-Null; Start-Sleep -Milliseconds 250 }",
    "$r = New-Object NovaShot+RECT",
    "[NovaShot]::GetWindowRect($h, [ref]$r) | Out-Null",
    "$w = $r.Right - $r.Left",
    "$ht = $r.Bottom - $r.Top",
    'if ($w -le 0 -or $ht -le 0) { Write-Output "NOVA_WINDOW_RECT_EMPTY"; return }',
    "$bmp = New-Object System.Drawing.Bitmap $w, $ht",
    "$g = [System.Drawing.Graphics]::FromImage($bmp)",
    "$hdc = $g.GetHdc()",
    "$ok = [NovaShot]::PrintWindow($h, $hdc, 2)",
    "$g.ReleaseHdc($hdc)",
    '$mode = "print-window"',
    'if (-not $ok) { $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size $w, $ht)); $mode = "screen-region" }',
    '$bmp.Save("' + escapedFile + '", [System.Drawing.Imaging.ImageFormat]::Png)',
    "$g.Dispose()",
    "$bmp.Dispose()",
    'Write-Output ("NOVA_WINDOW_OK|" + $mode + "|" + $w + "|" + $ht)',
  ].join(nl)
  const output = await powershell(script)
  if (output.includes("NOVA_WINDOW_NOT_FOUND")) throw new Error('No window matching "' + title + '"')
  if (output.includes("NOVA_WINDOW_HANDLE_MISSING")) throw new Error('Window matching "' + title + '" has no handle')
  if (output.includes("NOVA_WINDOW_RECT_EMPTY"))
    throw new Error('Window matching "' + title + '" has no visible bounds')
  const match = output.match(/NOVA_WINDOW_OK\|([^|]+)\|(\d+)\|(\d+)/)
  const buffer = await fs.readFile(file)
  await fs.rm(file, { force: true })
  return {
    path: file,
    base64: buffer.toString("base64"),
    mime: "image/png",
    mode: match?.[1] === "screen-region" ? "screen-region" : "print-window",
    window: {
      title,
      width: match ? Number(match[2]) : undefined,
      height: match ? Number(match[3]) : undefined,
    },
  }
}

async function windowsWindows(): Promise<WindowInfo[]> {
  const raw = await powershell(
    "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object Id, MainWindowTitle | ConvertTo-Json -Compress",
  )
  try {
    const parsed = JSON.parse(raw || "[]")
    const list = Array.isArray(parsed) ? parsed : [parsed]
    return list
      .filter((item: any) => item?.MainWindowTitle)
      .map((item: any) => ({ title: String(item.MainWindowTitle), pid: Number(item.Id) }))
  } catch {
    return []
  }
}

async function windowsFocus(title: string) {
  const escaped = title.replace(/"/g, '""')
  const nl = String.fromCharCode(10)
  await powershell(
    [
      WIN_BRIDGE,
      '$title = "' + escaped + '"',
      '$p = Get-Process | Where-Object { $_.MainWindowTitle -like ("*" + $title + "*") } | Select-Object -First 1',
      "if (-not $p) { exit 2 }",
      "[NovaWin]::ShowWindow($p.MainWindowHandle, 9) | Out-Null",
      "[NovaWin]::SetForegroundWindow($p.MainWindowHandle) | Out-Null",
    ].join(nl),
  )
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

async function osascript(lines: string[], args: string[] = []) {
  const params = lines.flatMap((line) => ["-e", line])
  const result = await exec("osascript", [...params, ...(args.length ? ["--", ...args] : [])], { timeout: TIMEOUT })
  return result.stdout ?? ""
}

const MAC_KEY_CODES: Record<string, number> = {
  enter: 36,
  return: 36,
  tab: 48,
  escape: 53,
  esc: 53,
  backspace: 51,
  delete: 117,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  up: 126,
  down: 125,
  left: 123,
  right: 124,
}

async function macScreenshot(): Promise<Screenshot> {
  const file = path.join(os.tmpdir(), "novaway-screen-" + process.pid + "-" + Date.now() + ".png")
  await exec("screencapture", ["-x", "-t", "png", file], { timeout: TIMEOUT })
  const buffer = await fs.readFile(file)
  await fs.rm(file, { force: true })
  return { path: file, base64: buffer.toString("base64"), mime: "image/png", mode: "screen" }
}

async function macScreenshotWindow(title: string): Promise<Screenshot> {
  const file = path.join(os.tmpdir(), "novaway-window-" + process.pid + "-" + Date.now() + ".png")
  const bounds = (
    await osascript(
      [
        "on run argv",
        "set needle to item 1 of argv",
        'tell application "System Events"',
        "repeat with p in (every process whose background only is false)",
        "try",
        "repeat with w in windows of p",
        "try",
        "if (name of w as text) contains needle then",
        "set pos to position of w",
        "set sz to size of w",
        'return ((item 1 of pos) as text) & "," & ((item 2 of pos) as text) & "," & ((item 1 of sz) as text) & "," & ((item 2 of sz) as text)',
        "end if",
        "end try",
        "end repeat",
        "end try",
        "end repeat",
        "end tell",
        'return ""',
        "end run",
      ],
      [title],
    )
  ).trim()
  if (!bounds) throw new Error('No window matching "' + title + '"')
  await exec("screencapture", ["-x", "-o", "-R" + bounds, file], { timeout: TIMEOUT })
  const buffer = await fs.readFile(file)
  await fs.rm(file, { force: true })
  return { path: file, base64: buffer.toString("base64"), mime: "image/png", mode: "screen-region", window: { title } }
}

async function macWindows(): Promise<WindowInfo[]> {
  const raw = await osascript([
    'tell application "System Events" to get name of every process whose background only is false',
  ])
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((title) => ({ title }))
}

// ---------------------------------------------------------------------------
// Linux
// ---------------------------------------------------------------------------

async function xdotool(args: string[]) {
  const result = await exec("xdotool", args, { timeout: TIMEOUT })
  return result.stdout ?? ""
}

async function linuxScreenshot(): Promise<Screenshot> {
  const file = path.join(os.tmpdir(), "novaway-screen-" + process.pid + "-" + Date.now() + ".png")
  if (await which("gnome-screenshot")) await exec("gnome-screenshot", ["-f", file], { timeout: TIMEOUT })
  else if (await which("scrot")) await exec("scrot", ["-o", file], { timeout: TIMEOUT })
  else if (await which("grim")) await exec("grim", [file], { timeout: TIMEOUT })
  else await exec("import", ["-window", "root", file], { timeout: TIMEOUT })
  const buffer = await fs.readFile(file)
  await fs.rm(file, { force: true })
  return { path: file, base64: buffer.toString("base64"), mime: "image/png", mode: "screen" }
}

async function linuxScreenshotWindow(title: string): Promise<Screenshot> {
  const file = path.join(os.tmpdir(), "novaway-window-" + process.pid + "-" + Date.now() + ".png")
  const ids = (await xdotool(["search", "--name", title]).catch(() => "")).split(/\s+/).filter(Boolean)
  if (ids.length === 0) throw new Error('No window matching "' + title + '"')
  if (!(await which("import"))) throw new Error("Window screenshots on Linux require ImageMagick (import)")
  await exec("import", ["-window", ids[ids.length - 1], file], { timeout: TIMEOUT })
  const buffer = await fs.readFile(file)
  await fs.rm(file, { force: true })
  return { path: file, base64: buffer.toString("base64"), mime: "image/png", mode: "window", window: { title } }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function screenshot(): Promise<Screenshot> {
  const current = platform()
  if (current === "windows") return windowsScreenshot()
  if (current === "macos") return macScreenshot()
  if (current === "linux") return linuxScreenshot()
  throw new Error("Screenshot is not supported on this platform")
}

/**
 * 按窗口标题截取单个窗口，不把窗口切到前台。
 * 验证桌面应用时优先用它：只截目标界面，也不会把整个桌面/其它窗口带进来。
 */
export async function screenshotWindow(title: string): Promise<Screenshot> {
  if (!title.trim()) throw new Error("Window title is required")
  const current = platform()
  if (current === "windows") return windowsScreenshotWindow(title.trim())
  if (current === "macos") return macScreenshotWindow(title.trim())
  if (current === "linux") return linuxScreenshotWindow(title.trim())
  throw new Error("Window screenshots are not supported on this platform")
}

export async function click(input: { x: number; y: number; button?: MouseButton }) {
  const current = platform()
  const button = input.button ?? "left"
  if (current === "windows") return windowsClick(input.x, input.y, button)
  if (current === "macos") {
    if (button !== "left") throw new Error("Only left click is supported on macOS")
    return osascript([
      'tell application "System Events" to click at {' + Math.round(input.x) + ", " + Math.round(input.y) + "}",
    ])
  }
  if (current === "linux") {
    await xdotool(["mousemove", String(Math.round(input.x)), String(Math.round(input.y))])
    return xdotool(["click", button === "right" ? "3" : button === "middle" ? "2" : "1"])
  }
  throw new Error("Click is not supported on this platform")
}

export async function move(x: number, y: number) {
  const current = platform()
  if (current === "windows") return windowsMove(x, y)
  if (current === "linux") return xdotool(["mousemove", String(Math.round(x)), String(Math.round(y))])
  throw new Error("Mouse move is not supported on this platform")
}

export async function scroll(amount: number) {
  const current = platform()
  if (current === "windows") return windowsScroll(amount)
  if (current === "linux") {
    const button = amount > 0 ? "5" : "4"
    for (let index = 0; index < Math.abs(Math.round(amount)); index++) await xdotool(["click", button])
    return
  }
  if (current === "macos") {
    if (!(await which("cliclick"))) throw new Error("Scrolling on macOS requires cliclick (brew install cliclick)")
    return exec("cliclick", ["w:" + (amount > 0 ? "-" : "+") + Math.abs(Math.round(amount))], { timeout: TIMEOUT })
  }
  throw new Error("Scroll is not supported on this platform")
}

export async function type(text: string) {
  const current = platform()
  if (current === "windows") return windowsType(text)
  if (current === "macos") {
    return osascript(
      ["on run argv", 'tell application "System Events" to keystroke (item 1 of argv)', "end run"],
      [text],
    )
  }
  if (current === "linux") return xdotool(["type", "--clearmodifiers", "--", text])
  throw new Error("Typing is not supported on this platform")
}

export async function key(combo: string) {
  const current = platform()
  if (current === "windows") return windowsKey(combo)
  if (current === "macos") {
    const parts = combo
      .split("+")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
    const last = parts.pop() ?? ""
    const modifiers = parts
      .map((item) => {
        if (item === "ctrl" || item === "control") return "control down"
        if (item === "alt" || item === "option") return "option down"
        if (item === "shift") return "shift down"
        if (item === "meta" || item === "cmd" || item === "command") return "command down"
        return ""
      })
      .filter(Boolean)
    const using = modifiers.length ? " using {" + modifiers.join(", ") + "}" : ""
    const code = MAC_KEY_CODES[last]
    if (code !== undefined) return osascript(['tell application "System Events" to key code ' + code + using])
    return osascript(['tell application "System Events" to keystroke "' + last + '"' + using])
  }
  if (current === "linux") {
    const value = combo
      .split("+")
      .map((item) => {
        const part = item.trim().toLowerCase()
        if (part === "ctrl" || part === "control") return "ctrl"
        if (part === "meta" || part === "cmd" || part === "command") return "super"
        return part
      })
      .join("+")
    return xdotool(["key", "--clearmodifiers", value])
  }
  throw new Error("Key press is not supported on this platform")
}

export async function windows(): Promise<WindowInfo[]> {
  const current = platform()
  if (current === "windows") return windowsWindows()
  if (current === "macos") return macWindows()
  if (current === "linux") {
    const raw = await xdotool(["search", "--onlyvisible", "--name", ""])
    const ids = raw
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean)
    const result: WindowInfo[] = []
    for (const id of ids.slice(0, 50)) {
      const title = await xdotool(["getwindowname", id]).catch(() => "")
      if (title.trim()) result.push({ title: title.trim(), id })
    }
    return result
  }
  return []
}

/**
 * 等一个窗口出现（按标题模糊匹配）。
 *
 * 启动桌面应用后，"后台任务还在跑"不等于应用起来了：Electron/Java 进程常常先活着，
 * 几秒后才因为资源构建失败而退出。这个等待入口让模型有一个明确的成功信号 ——
 * 窗口真的出现在窗口列表里 —— 再去截图和汇报。
 */
export async function waitForWindow(
  title: string,
  timeoutMs = 30_000,
  intervalMs = 750,
): Promise<{ found: boolean; waitedMs: number; window?: WindowInfo }> {
  const startedAt = Date.now()
  const needle = title.trim().toLowerCase()
  if (!needle) throw new Error("Window title is required")
  while (Date.now() - startedAt <= timeoutMs) {
    const match = (await windows()).find((item) => item.title.toLowerCase().includes(needle))
    if (match) return { found: true, waitedMs: Date.now() - startedAt, window: match }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return { found: false, waitedMs: Date.now() - startedAt }
}

export async function focus(title: string) {
  const current = platform()
  if (current === "windows") return windowsFocus(title)
  if (current === "macos") {
    return osascript(
      [
        'tell application "System Events"',
        "set frontmost of (first process whose name contains item 1 of argv) to true",
        "end tell",
      ],
      [title],
    )
  }
  if (current === "linux") {
    const ids = (await xdotool(["search", "--name", title]).catch(() => "")).split(/\s+/).filter(Boolean)
    if (ids.length === 0) throw new Error('No window matching "' + title + '"')
    return xdotool(["windowactivate", "--sync", ids[ids.length - 1]])
  }
  throw new Error("Window focus is not supported on this platform")
}

export * as Computer from "./computer"
