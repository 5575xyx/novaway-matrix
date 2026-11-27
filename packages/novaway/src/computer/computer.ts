/**
 * 电脑控制（桌面自动化）。
 *
 * 不引入原生模块（robotjs / nut.js 都要按平台编译），改用系统自带能力：
 * - Windows：PowerShell + user32（鼠标/键盘/截图）+ SendKeys
 * - macOS：screencapture + System Events（osascript）
 * - Linux：AT-SPI 语义树 + xdotool；Wayland 控件优先通过 AT-SPI Action 执行，不依赖坐标注入
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
  capabilities: {
    screenshot: boolean
    mouse: boolean
    keyboard: boolean
    windows: boolean
    semanticSnapshot: boolean
    actionVerification: boolean
  }
  reason?: string
}

export type Screenshot = {
  path: string
  base64: string
  mime: string
  /** 截图方式：整屏 / 指定窗口（PrintWindow 可在后台截，不需要切前台）。 */
  mode?: "screen" | "print-window" | "screen-region" | "window"
  window?: { title: string; width?: number; height?: number }
  /**
   * 窗口截图时窗口左上角在屏幕上的坐标。窗口截图的像素是窗口内的相对坐标，
   * 点击需要加上这个原点才是绝对屏幕坐标。
   */
  origin?: { x: number; y: number }
}
export type WindowInfo = { title: string; id?: string; pid?: number }
export type MouseButton = "left" | "right" | "middle"

/**
 * 可操作桌面元素。坐标始终是屏幕绝对坐标，避免截图坐标和窗口坐标混用。
 * ref 只在本次快照有效；动作前若页面发生变化会重新快照并拒绝旧 ref。
 */
export type ComputerElement = {
  ref: string
  name: string
  role: string
  enabled: boolean
  x: number
  y: number
  width: number
  height: number
  automationId?: string
}

export type ComputerSnapshot = {
  window: WindowInfo
  elements: ComputerElement[]
  /** 便于消息流直接展示的窗口截图。 */
  screenshot?: Screenshot
}

const snapshotCache = new Map<string, { at: number; snapshot: ComputerSnapshot }>()
const SNAPSHOT_TTL = 5_000

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
      capabilities: {
        screenshot: true,
        mouse: true,
        keyboard: true,
        windows: true,
        semanticSnapshot: true,
        actionVerification: true,
      },
    }
  } else if (current === "macos") {
    const cliclick = await which("cliclick")
    value = {
      supported: true,
      platform: current,
      capabilities: {
        screenshot: true,
        mouse: true,
        keyboard: true,
        windows: true,
        semanticSnapshot: true,
        actionVerification: true,
      },
      ...(cliclick ? {} : { reason: "Scrolling needs cliclick (brew install cliclick); other actions work." }),
    }
  } else if (current === "linux") {
    const xdotool = await which("xdotool")
    const wtype = await which("wtype")
    const atspi = await linuxAccessibilityAvailable()
    const shot =
      (await which("gnome-screenshot")) || (await which("scrot")) || (await which("import")) || (await which("grim"))
    value = {
      supported: Boolean(xdotool || wtype || shot || atspi),
      platform: current,
      capabilities: {
        screenshot: Boolean(shot),
        mouse: xdotool,
        keyboard: Boolean(xdotool || wtype),
        windows: xdotool,
        semanticSnapshot: atspi,
        actionVerification: atspi,
      },
      ...(!xdotool && atspi
        ? { reason: "Wayland-safe semantic actions are available; coordinate mouse actions need xdotool or XWayland." }
        : !xdotool && !wtype
          ? { reason: "Coordinate input needs xdotool/XWayland; text input also supports wtype on Wayland." }
          : !atspi
            ? { reason: "Optional semantic snapshots require python3-gi and gir1.2-atspi-2.0" }
            : {}),
    }
  } else {
    value = {
      supported: false,
      platform: current,
      capabilities: {
        screenshot: false,
        mouse: false,
        keyboard: false,
        windows: false,
        semanticSnapshot: false,
        actionVerification: false,
      },
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
    'Write-Output ("NOVA_WINDOW_OK|" + $mode + "|" + $w + "|" + $ht + "|" + $r.Left + "|" + $r.Top)',
  ].join(nl)
  const output = await powershell(script)
  if (output.includes("NOVA_WINDOW_NOT_FOUND")) throw new Error('No window matching "' + title + '"')
  if (output.includes("NOVA_WINDOW_HANDLE_MISSING")) throw new Error('Window matching "' + title + '" has no handle')
  if (output.includes("NOVA_WINDOW_RECT_EMPTY"))
    throw new Error('Window matching "' + title + '" has no visible bounds')
  const match = output.match(/NOVA_WINDOW_OK\|([^|]+)\|(-?\d+)\|(-?\d+)\|(-?\d+)\|(-?\d+)/)
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
    ...(match ? { origin: { x: Number(match[4]), y: Number(match[5]) } } : {}),
  }
}

async function windowsWindows(): Promise<WindowInfo[]> {
  const raw = await powershell(
    "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object Id, MainWindowHandle, MainWindowTitle | ConvertTo-Json -Compress",
  )
  try {
    const parsed = JSON.parse(raw || "[]")
    const list = Array.isArray(parsed) ? parsed : [parsed]
    return list
      .filter((item: any) => item?.MainWindowTitle)
      .map((item: any) => ({
        title: String(item.MainWindowTitle),
        id: item.MainWindowHandle ? String(item.MainWindowHandle) : undefined,
        pid: Number(item.Id),
      }))
  } catch {
    return []
  }
}

async function windowsSnapshot(title?: string): Promise<ComputerSnapshot> {
  const needle = (title ?? "").replace(/'/g, "''")
  const nl = String.fromCharCode(10)
  const script = [
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -AssemblyName UIAutomationTypes",
    "Add-Type -AssemblyName System.Windows.Forms",
    'Add-Type -TypeDefinition @"',
    "using System; using System.Runtime.InteropServices;",
    'public static class NovaForeground { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }',
    '"@',
    "$target = $null",
    "$needle = '" + needle + "'",
    "if ($needle) { $target = Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -like ('*' + $needle + '*') } | Select-Object -First 1 }",
    "if (-not $target) { $h = [NovaForeground]::GetForegroundWindow(); $pid = 0; [NovaForeground]::GetWindowThreadProcessId($h, [ref]$pid) | Out-Null; $target = Get-Process -Id $pid -ErrorAction SilentlyContinue }",
    "if (-not $target -or $target.MainWindowHandle -eq 0) { Write-Output 'NOVA_UIA_WINDOW_NOT_FOUND'; return }",
    "$root = [Windows.Automation.AutomationElement]::FromHandle($target.MainWindowHandle)",
    "if (-not $root) { Write-Output 'NOVA_UIA_ROOT_NOT_FOUND'; return }",
    "$walker = [Windows.Automation.TreeWalker]::new([Windows.Automation.AutomationElement]::ControlViewCondition)",
    "$items = New-Object System.Collections.Generic.List[object]; $next = 0",
    "function Visit([Windows.Automation.AutomationElement]$element, [int]$depth) {",
    "  if (-not $element -or $depth -gt 10 -or $items.Count -ge 300) { return }",
    "  try { $c = $element.Current; $r = $c.BoundingRectangle; $name = [string]$c.Name; $role = [string]$c.ControlType.ProgrammaticName; $visible = $r.Width -gt 1 -and $r.Height -gt 1; if ($visible -and ($name -or $role)) { $script:next++; $items.Add([PSCustomObject]@{ ref=('e' + $script:next); name=$name; role=$role; enabled=[bool]$c.IsEnabled; x=[math]::Round($r.X); y=[math]::Round($r.Y); width=[math]::Round($r.Width); height=[math]::Round($r.Height); automationId=[string]$c.AutomationId }) | Out-Null } } catch {}",
    "  try { $child = $walker.GetFirstChild($element); while ($child) { Visit $child ($depth + 1); $child = $walker.GetNextSibling($child) } } catch {}",
    "}",
    "Visit $root 0",
    "[PSCustomObject]@{ title=$target.MainWindowTitle; id=[string]$target.MainWindowHandle; pid=[int]$target.Id; elements=@($items) } | ConvertTo-Json -Compress -Depth 4",
  ].join(nl)
  const raw = await powershell(script, 30_000)
  if (raw.includes("NOVA_UIA_WINDOW_NOT_FOUND")) throw new Error("No desktop window matched the requested title")
  if (raw.includes("NOVA_UIA_ROOT_NOT_FOUND")) throw new Error("The desktop window has no accessibility tree")
  let value: any
  try {
    value = JSON.parse(raw.trim())
  } catch {
    throw new Error("Windows UI Automation returned invalid JSON")
  }
  const window: WindowInfo = {
    title: String(value?.title ?? title ?? ""),
    id: value?.id ? String(value.id) : undefined,
    pid: Number(value?.pid) || undefined,
  }
  const elements = Array.isArray(value?.elements)
    ? value.elements
        .map((item: any) => ({
          ref: String(item.ref),
          name: String(item.name ?? ""),
          role: String(item.role ?? "").replace(/^.*\./, ""),
          enabled: item.enabled !== false,
          x: Number(item.x) || 0,
          y: Number(item.y) || 0,
          width: Number(item.width) || 0,
          height: Number(item.height) || 0,
          ...(item.automationId ? { automationId: String(item.automationId) } : {}),
        }))
        .filter((item: ComputerElement) => item.width > 0 && item.height > 0)
    : []
  const snapshot: ComputerSnapshot = { window, elements }
  snapshotCache.set(window.title.toLowerCase(), { at: Date.now(), snapshot })
  return snapshot
}

export async function snapshotWindow(title?: string, includeScreenshot = true): Promise<ComputerSnapshot> {
  const current = platform()
  if (current !== "windows" && current !== "macos" && current !== "linux") {
    throw new Error(
      "Semantic desktop snapshots currently require Windows UI Automation, macOS Accessibility, or Linux AT-SPI",
    )
  }
  const snapshot =
    current === "windows"
      ? await windowsSnapshot(title)
      : current === "macos"
        ? await macSnapshot(title)
        : await linuxSnapshot(title)
  if (includeScreenshot) {
    try {
      snapshot.screenshot = await screenshotWindow(snapshot.window.title)
    } catch {
      try {
        snapshot.screenshot = await screenshot()
      } catch {
        // AT-SPI snapshots remain useful on minimal Wayland sessions without a screenshot portal.
      }
    }
  }
  return snapshot
}

function elementFromSnapshot(window: string, ref: string) {
  const entry = [...snapshotCache.values()].find((value) =>
    value.snapshot.window.title.toLowerCase().includes(window.toLowerCase()),
  )
  if (!entry || Date.now() - entry.at > SNAPSHOT_TTL) return undefined
  return entry.snapshot.elements.find((element) => element.ref === ref)
}

export async function clickElement(window: string, ref: string, button: MouseButton = "left") {
  const element = elementFromSnapshot(window, ref)
  if (!element) throw new Error(`Element ${ref} is stale; take computer_snapshot again`)
  // Re-read the accessibility tree immediately before acting. This catches dialogs,
  // rerenders and window changes that happened inside the 5s snapshot TTL.
  const liveSnapshot = await (
    platform() === "macos"
      ? macSnapshot(window)
      : platform() === "linux"
        ? linuxSnapshot(window)
        : windowsSnapshot(window)
  ).catch(() => undefined)
  const live = liveSnapshot?.elements.find((candidate) =>
    element.automationId && candidate.automationId
      ? candidate.automationId === element.automationId && candidate.role === element.role
      : candidate.role === element.role &&
        candidate.name === element.name &&
        Math.abs(candidate.x - element.x) < 8 &&
        Math.abs(candidate.y - element.y) < 8,
  )
  if (!live) throw new Error(`Element ${ref} changed; take computer_snapshot again`)
  if (!live.enabled) throw new Error(`Element ${ref} is disabled`)
  if (platform() === "linux" && button === "left") {
    try {
      await linuxAccessibilityAction(window, live)
    } catch {
      await click({ x: live.x + live.width / 2, y: live.y + live.height / 2, button })
    }
  } else {
    await click({ x: live.x + live.width / 2, y: live.y + live.height / 2, button })
  }
  // Orca returns post-action visual evidence when the target window still exists. A
  // dialog may close the old window, so verification is best-effort and never hides
  // a successful click behind a screenshot error.
  try {
    return await screenshotWindow(window)
  } catch {
    return undefined
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
  const [x, y, width, height] = bounds.split(",").map(Number)
  return {
    path: file,
    base64: buffer.toString("base64"),
    mime: "image/png",
    mode: "screen-region",
    window: { title, ...(Number.isFinite(width) ? { width } : {}), ...(Number.isFinite(height) ? { height } : {}) },
    ...(Number.isFinite(x) && Number.isFinite(y) ? { origin: { x, y } } : {}),
  }
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

async function macSnapshot(title?: string): Promise<ComputerSnapshot> {
  const raw = await osascript(
    [
      "on clean(value)",
      "set AppleScript's text item delimiters to {tab, return, linefeed}",
      "set value to every text item of (value as text)",
      'set AppleScript\'s text item delimiters to " "',
      "set value to value as text",
      'set AppleScript\'s text item delimiters to ""',
      "return value",
      "end clean",
      "on run argv",
      "set needle to item 1 of argv",
      'tell application "System Events"',
      "set targetProcess to missing value",
      'if needle is "" then',
      "set targetProcess to first process whose frontmost is true",
      "else",
      "repeat with candidate in (every process whose background only is false)",
      "try",
      "if (name of candidate as text) contains needle then",
      "set targetProcess to contents of candidate",
      "exit repeat",
      "end if",
      "end try",
      "end repeat",
      "end if",
      'if targetProcess is missing value then return "NOVA_MAC_WINDOW_NOT_FOUND"',
      'if (count of windows of targetProcess) is 0 then return "NOVA_MAC_WINDOW_NOT_FOUND"',
      "set targetWindow to first window of targetProcess",
      'set rows to {"NOVA_MAC_WINDOW|" & (name of targetWindow as text)}',
      "repeat with elementRef in (entire contents of targetWindow)",
      "if (count of rows) is greater than or equal to 301 then exit repeat",
      "try",
      "set elementItem to contents of elementRef",
      "set elementRole to my clean(role of elementItem as text)",
      "set elementName to my clean(name of elementItem as text)",
      "set elementPosition to position of elementItem",
      "set elementSize to size of elementItem",
      'set elementEnabled to "true"',
      "try",
      'if (enabled of elementItem) is false then set elementEnabled to "false"',
      "end try",
      "set end of rows to elementRole & tab & elementName & tab & (item 1 of elementPosition as text) & tab & (item 2 of elementPosition as text) & tab & (item 1 of elementSize as text) & tab & (item 2 of elementSize as text) & tab & elementEnabled",
      "end try",
      "end repeat",
      "set AppleScript's text item delimiters to linefeed",
      "set resultText to rows as text",
      'set AppleScript\'s text item delimiters to ""',
      "return resultText",
      "end tell",
      "end run",
    ],
    [title ?? ""],
  )
  if (raw.includes("NOVA_MAC_WINDOW_NOT_FOUND")) throw new Error("No macOS window matched the requested title")
  const rows = raw.trim().split(/\r?\n/).filter(Boolean)
  const header = rows.shift()?.split("|")
  const window: WindowInfo = { title: header?.slice(1).join("|") || title || "" }
  const elements = rows
    .map((row, index) => {
      const [role, name, x, y, width, height, enabled] = row.split("\t")
      return {
        ref: "e" + (index + 1),
        name: name ?? "",
        role: role ?? "",
        enabled: enabled !== "false",
        x: Number(x) || 0,
        y: Number(y) || 0,
        width: Number(width) || 0,
        height: Number(height) || 0,
      }
    })
    .filter((item) => item.width > 0 && item.height > 0)
  const snapshot: ComputerSnapshot = { window, elements }
  snapshotCache.set(window.title.toLowerCase(), { at: Date.now(), snapshot })
  return snapshot
}

export const LINUX_ATSPI_SCRIPT = String.raw`
import json, sys
try:
    import gi
    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi
except Exception as exc:
    print("NOVA_ATSPI_UNAVAILABLE:" + str(exc))
    sys.exit(2)
needle = (sys.argv[1] if len(sys.argv) > 1 else "").lower()
desktop = Atspi.get_desktop(0)

def children(node):
    try:
        return [node.get_child_at_index(i) for i in range(node.get_child_count())]
    except Exception:
        return []

def label(node):
    try:
        return (node.get_name() or "").replace("\\t", " ").replace("\\n", " ")[:160]
    except Exception:
        return ""

def role(node):
    try:
        return (node.get_role_name() or "").replace("\\t", " ")
    except Exception:
        return ""

def find_window(node):
    current_role = role(node).lower()
    current_name = label(node)
    if current_role == "window" and (not needle or needle in current_name.lower()):
        return node
    for child in children(node):
        found = find_window(child)
        if found is not None:
            return found
    return None

window = None
for app in children(desktop):
    window = find_window(app)
    if window is not None:
        break
if window is None:
    print("NOVA_ATSPI_WINDOW_NOT_FOUND")
    sys.exit(3)

items = []
def visit(node, depth=0):
    if len(items) >= 300 or depth > 10:
        return
    try:
        ext = node.get_extents(Atspi.CoordType.SCREEN)
        x, y, width, height = int(ext.x), int(ext.y), int(ext.width), int(ext.height)
        if width > 1 and height > 1:
            enabled = True
            try:
                enabled = not node.get_state_set().contains(Atspi.StateType.DISABLED)
            except Exception:
                pass
            items.append({"name": label(node), "role": role(node), "enabled": enabled, "x": x, "y": y, "width": width, "height": height})
    except Exception:
        pass
    for child in children(node):
        visit(child, depth + 1)

visit(window)
print(json.dumps({"title": label(window), "elements": items}, ensure_ascii=False))
`

const LINUX_ATSPI_ACTION_SCRIPT = String.raw`
import sys
try:
    import gi
    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi
except Exception as exc:
    print("NOVA_ATSPI_UNAVAILABLE:" + str(exc))
    sys.exit(2)
needle = (sys.argv[1] if len(sys.argv) > 1 else "").lower()
target_name = sys.argv[2] if len(sys.argv) > 2 else ""
target_role = sys.argv[3] if len(sys.argv) > 3 else ""
target_x = int(sys.argv[4]) if len(sys.argv) > 4 else 0
target_y = int(sys.argv[5]) if len(sys.argv) > 5 else 0

def children(node):
    try:
        return [node.get_child_at_index(i) for i in range(node.get_child_count())]
    except Exception:
        return []

def label(node):
    try:
        return (node.get_name() or "").replace("\\t", " ").replace("\\n", " ")[:160]
    except Exception:
        return ""

def role(node):
    try:
        return (node.get_role_name() or "").replace("\\t", " ")
    except Exception:
        return ""

def find_window(node):
    if role(node).lower() == "window" and (not needle or needle in label(node).lower()):
        return node
    for child in children(node):
        found = find_window(child)
        if found is not None:
            return found
    return None

def find_target(node):
    current_name = label(node)
    current_role = role(node)
    try:
        ext = node.get_extents(Atspi.CoordType.SCREEN)
        close_enough = abs(int(ext.x) - target_x) < 8 and abs(int(ext.y) - target_y) < 8
    except Exception:
        close_enough = False
    if current_name == target_name and current_role == target_role and close_enough:
        return node
    for child in children(node):
        found = find_target(child)
        if found is not None:
            return found
    return None

desktop = Atspi.get_desktop(0)
window = None
for app in children(desktop):
    window = find_window(app)
    if window is not None:
        break
if window is None:
    print("NOVA_ATSPI_WINDOW_NOT_FOUND")
    sys.exit(3)
target = find_target(window)
if target is None:
    print("NOVA_ATSPI_TARGET_NOT_FOUND")
    sys.exit(4)
try:
    action = target.get_action()
    name_reader = getattr(action, "get_action_name", None) or getattr(action, "get_name", None)
    for index in range(action.get_n_actions()):
        name = (name_reader(index) if name_reader else "").lower()
        if name in ("click", "press", "activate", "toggle"):
            action.do_action(index)
            print("NOVA_ATSPI_ACTION_OK")
            sys.exit(0)
except Exception:
    pass
print("NOVA_ATSPI_ACTION_UNAVAILABLE")
sys.exit(5)
`

const LINUX_ATSPI_WINDOWS_SCRIPT = String.raw`
import json
try:
    import gi
    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi
except Exception as exc:
    print("NOVA_ATSPI_UNAVAILABLE:" + str(exc))
    raise SystemExit(2)

def children(node):
    try:
        return [node.get_child_at_index(i) for i in range(node.get_child_count())]
    except Exception:
        return []

def title(node):
    try:
        return (node.get_name() or "").replace("\\t", " ").replace("\\n", " ")[:240]
    except Exception:
        return ""

def role(node):
    try:
        return (node.get_role_name() or "").lower()
    except Exception:
        return ""

items = []
def visit(node):
    if len(items) >= 100:
        return
    if role(node) == "window" and title(node):
        items.append({"title": title(node)})
    for child in children(node):
        visit(child)

visit(Atspi.get_desktop(0))
print(json.dumps(items, ensure_ascii=False))
`

async function linuxWindows(): Promise<WindowInfo[]> {
  const raw = await exec("python3", ["-c", LINUX_ATSPI_WINDOWS_SCRIPT], {
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  }).then((result) => result.stdout ?? "")
  if (raw.includes("NOVA_ATSPI_UNAVAILABLE")) return []
  try {
    const value = JSON.parse(raw.trim())
    return Array.isArray(value)
      ? value
          .filter((item): item is { title: string } => typeof item?.title === "string")
          .map((item) => ({ title: item.title }))
      : []
  } catch {
    return []
  }
}

async function linuxAccessibilityAction(window: string, element: ComputerElement) {
  const raw = await exec(
    "python3",
    [
      "-c",
      LINUX_ATSPI_ACTION_SCRIPT,
      window,
      element.name,
      element.role,
      String(Math.round(element.x)),
      String(Math.round(element.y)),
    ],
    { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
  ).then((result) => result.stdout ?? "")
  if (!raw.includes("NOVA_ATSPI_ACTION_OK")) throw new Error("Linux AT-SPI action was unavailable")
}

async function linuxAccessibilityAvailable() {
  if (!(await which("python3"))) return false
  try {
    await exec("python3", ["-c", 'import gi; gi.require_version("Atspi", "2.0"); from gi.repository import Atspi'], {
      timeout: 5_000,
    })
    return true
  } catch {
    return false
  }
}

export async function linuxSnapshot(title?: string): Promise<ComputerSnapshot> {
  const raw = await exec("python3", ["-c", LINUX_ATSPI_SCRIPT, title ?? ""], {
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
  }).then((result) => result.stdout ?? "")
  if (raw.includes("NOVA_ATSPI_UNAVAILABLE")) {
    throw new Error("Linux AT-SPI is unavailable; install python3-gi and gir1.2-atspi-2.0")
  }
  if (raw.includes("NOVA_ATSPI_WINDOW_NOT_FOUND"))
    throw new Error("No Linux accessibility window matched the requested title")
  let value: any
  try {
    value = JSON.parse(raw.trim())
  } catch {
    throw new Error("Linux AT-SPI returned invalid JSON")
  }
  const window: WindowInfo = { title: String(value?.title ?? title ?? "") }
  const elements = Array.isArray(value?.elements)
    ? value.elements
        .map((item: any, index: number) => ({
          ref: "e" + (index + 1),
          name: String(item.name ?? ""),
          role: String(item.role ?? ""),
          enabled: item.enabled !== false,
          x: Number(item.x) || 0,
          y: Number(item.y) || 0,
          width: Number(item.width) || 0,
          height: Number(item.height) || 0,
        }))
        .filter((item: ComputerElement) => item.width > 0 && item.height > 0)
    : []
  const snapshot: ComputerSnapshot = { window, elements }
  snapshotCache.set(window.title.toLowerCase(), { at: Date.now(), snapshot })
  return snapshot
}

async function linuxWtypeKey(combo: string) {
  const parts = combo
    .split("+")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  const key = parts.pop() ?? ""
  const modifiers = parts.filter((item) => ["ctrl", "control", "alt", "shift", "meta", "cmd", "super"].includes(item))
  const modifierName = (item: string) =>
    item === "ctrl" || item === "control" ? "ctrl" : item === "cmd" || item === "super" ? "super" : item
  const keyName: Record<string, string> = {
    enter: "Return",
    return: "Return",
    tab: "Tab",
    escape: "Escape",
    esc: "Escape",
    backspace: "BackSpace",
    delete: "Delete",
    space: "space",
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right",
    home: "Home",
    end: "End",
    pageup: "Page_Up",
    pagedown: "Page_Down",
  }
  const args: string[] = []
  for (const modifier of modifiers) args.push("-M", modifierName(modifier))
  args.push("-k", keyName[key] ?? key)
  for (const modifier of modifiers) args.push("-m", modifierName(modifier))
  await exec("wtype", args, { timeout: TIMEOUT })
}

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
  const id = ids[ids.length - 1]!
  await exec("import", ["-window", id, file], { timeout: TIMEOUT })
  const geometry = await xdotool(["getwindowgeometry", "--shell", id]).catch(() => "")
  const buffer = await fs.readFile(file)
  await fs.rm(file, { force: true })
  const x = Number(/^X=(-?\d+)$/m.exec(geometry)?.[1])
  const y = Number(/^Y=(-?\d+)$/m.exec(geometry)?.[1])
  const width = Number(/^WIDTH=(\d+)$/m.exec(geometry)?.[1])
  const height = Number(/^HEIGHT=(\d+)$/m.exec(geometry)?.[1])
  return {
    path: file,
    base64: buffer.toString("base64"),
    mime: "image/png",
    mode: "window",
    window: { title, ...(Number.isFinite(width) ? { width } : {}), ...(Number.isFinite(height) ? { height } : {}) },
    ...(Number.isFinite(x) && Number.isFinite(y) ? { origin: { x, y } } : {}),
  }
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
  if (current === "linux") {
    if (await which("xdotool")) return xdotool(["type", "--clearmodifiers", "--", text])
    if (await which("wtype")) return exec("wtype", ["--", text], { timeout: TIMEOUT })
    throw new Error("Typing on Linux requires xdotool or wtype")
  }
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
    if (await which("xdotool")) {
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
    if (await which("wtype")) return linuxWtypeKey(combo)
    throw new Error("Key press on Linux requires xdotool or wtype")
  }
  throw new Error("Key press is not supported on this platform")
}

export async function windows(): Promise<WindowInfo[]> {
  const current = platform()
  if (current === "windows") return windowsWindows()
  if (current === "macos") return macWindows()
  if (current === "linux") {
    if (process.env.WAYLAND_DISPLAY || !(await which("xdotool"))) return linuxWindows()
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
