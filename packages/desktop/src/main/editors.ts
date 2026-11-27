import { execFile, spawn } from "node:child_process"
import { access, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join, win32 } from "node:path"
import type { InstalledEditor, OfficeApp } from "../preload/types"

export type EditorDefinition = {
  id: string
  name: string
  commands: Partial<Record<NodeJS.Platform, string[]>>
  applications?: string[]
  fallbackPaths?: Partial<Record<NodeJS.Platform, string[]>>
  /** Windows App Paths 中登记的可执行文件名。 */
  windowsExecutable?: string
  /** 带版本号的安装目录（JetBrains 系）：在 roots 下找 prefix 开头的目录，取最新一个里的 relative。 */
  versionedPaths?: { roots: WindowsRoot[]; prefix: string; relative: string }[]
}

/** Office 应用（Word/Excel/PPT/WPS）：按扩展名匹配能打开该文档的本机应用。 */
export type OfficeAppDefinition = {
  id: string
  name: string
  /** Windows 注册表 App Paths 里的可执行文件名。 */
  executable: string
  extensions: string[]
  applications?: string[]
  fallbackPaths?: string[]
  versionedPaths?: { roots: WindowsRoot[]; prefix: string; relative: string }[]
}

type WindowsRoot = "LOCALAPPDATA" | "ProgramFiles" | "ProgramFiles(x86)"

const definitions: EditorDefinition[] = [
  {
    id: "vscode",
    name: "Visual Studio Code",
    commands: { win32: ["code.cmd", "Code.exe"], darwin: ["code"], linux: ["code"] },
    applications: ["Visual Studio Code", "VSCode"],
    fallbackPaths: { win32: ["Programs/Microsoft VS Code/Code.exe", "Microsoft VS Code/Code.exe"] },
  },
  {
    id: "vscode-insiders",
    name: "Visual Studio Code Insiders",
    commands: {
      win32: ["code-insiders.cmd", "Code - Insiders.exe"],
      darwin: ["code-insiders"],
      linux: ["code-insiders"],
    },
    applications: ["Visual Studio Code - Insiders"],
    fallbackPaths: { win32: ["Programs/Microsoft VS Code Insiders/Code - Insiders.exe"] },
  },
  {
    id: "cursor",
    name: "Cursor",
    commands: { win32: ["cursor.cmd", "Cursor.exe"], darwin: ["cursor"], linux: ["cursor"] },
    applications: ["Cursor"],
    windowsExecutable: "Cursor.exe",
    fallbackPaths: { win32: ["Programs/cursor/Cursor.exe", "Cursor/Cursor.exe"] },
  },
  {
    id: "windsurf",
    name: "Windsurf",
    commands: { win32: ["windsurf.cmd", "Windsurf.exe"], darwin: ["windsurf"], linux: ["windsurf"] },
    applications: ["Windsurf"],
    fallbackPaths: { win32: ["Programs/Windsurf/Windsurf.exe"] },
  },
  {
    id: "zed",
    name: "Zed",
    commands: { win32: ["zed.exe"], darwin: ["zed"], linux: ["zed"] },
    applications: ["Zed"],
    windowsExecutable: "zed.exe",
    fallbackPaths: { win32: ["Programs/Zed/Zed.exe", "Programs/Zed/zed.exe", "Zed/Zed.exe", "Zed/zed.exe"] },
  },
  {
    id: "openidea",
    name: "OpenIDEA",
    commands: { win32: ["openidea.exe", "OpenIDEA.exe", "openidea.cmd"], darwin: ["openidea"], linux: ["openidea"] },
    applications: ["OpenIDEA", "Open IDEA"],
    windowsExecutable: "openidea.exe",
    fallbackPaths: {
      win32: [
        "Programs/OpenIDEA/OpenIDEA.exe",
        "Programs/OpenIDEA/openidea.exe",
        "OpenIDEA/OpenIDEA.exe",
        "OpenIDEA/openidea.exe",
        "OpenIDEA/bin/idea64.exe",
        "OpenIDEA/bin/openidea.exe",
      ],
    },
    versionedPaths: [
      { roots: ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"], prefix: "Programs/OpenIDEA", relative: "bin/idea64.exe" },
      { roots: ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"], prefix: "OpenIDEA", relative: "bin/idea64.exe" },
      { roots: ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"], prefix: "JetBrains/OpenIDEA", relative: "bin/idea64.exe" },
      { roots: ["LOCALAPPDATA"], prefix: "JetBrains/Installations/OpenIDEA", relative: "bin/idea64.exe" },
    ],
  },
  {
    id: "idea",
    name: "IntelliJ IDEA",
    commands: { win32: ["idea64.exe", "idea.cmd"], darwin: ["idea"], linux: ["idea"] },
    applications: ["IntelliJ IDEA", "IntelliJ IDEA Ultimate", "IntelliJ IDEA Community Edition"],
    windowsExecutable: "idea64.exe",
    fallbackPaths: { win32: ["JetBrains/IntelliJ IDEA/bin/idea64.exe"] },
    versionedPaths: [
      { roots: ["ProgramFiles", "ProgramFiles(x86)"], prefix: "JetBrains/IntelliJ IDEA", relative: "bin/idea64.exe" },
      { roots: ["LOCALAPPDATA"], prefix: "Programs/IntelliJ IDEA", relative: "bin/idea64.exe" },
      { roots: ["LOCALAPPDATA"], prefix: "JetBrains/Installations/IntelliJ IDEA", relative: "bin/idea64.exe" },
    ],
  },
  {
    id: "webstorm",
    name: "WebStorm",
    commands: { win32: ["webstorm64.exe", "webstorm.cmd"], darwin: ["webstorm"], linux: ["webstorm"] },
    applications: ["WebStorm"],
    versionedPaths: [
      { roots: ["ProgramFiles", "ProgramFiles(x86)"], prefix: "JetBrains/WebStorm", relative: "bin/webstorm64.exe" },
      { roots: ["LOCALAPPDATA"], prefix: "Programs/WebStorm", relative: "bin/webstorm64.exe" },
    ],
  },
  {
    id: "pycharm",
    name: "PyCharm",
    commands: { win32: ["pycharm64.exe", "pycharm.cmd"], darwin: ["pycharm"], linux: ["pycharm"] },
    applications: ["PyCharm", "PyCharm Professional", "PyCharm Community Edition"],
    versionedPaths: [
      { roots: ["ProgramFiles", "ProgramFiles(x86)"], prefix: "JetBrains/PyCharm", relative: "bin/pycharm64.exe" },
      { roots: ["LOCALAPPDATA"], prefix: "Programs/PyCharm", relative: "bin/pycharm64.exe" },
    ],
  },
  {
    id: "sublime",
    name: "Sublime Text",
    commands: { win32: ["subl.exe", "sublime_text.exe"], darwin: ["subl"], linux: ["subl", "sublime_text"] },
    applications: ["Sublime Text"],
    fallbackPaths: { win32: ["Sublime Text/sublime_text.exe", "Sublime Text 3/sublime_text.exe"] },
  },
  {
    id: "notepadpp",
    name: "Notepad++",
    commands: { win32: ["notepad++.exe"] },
    fallbackPaths: { win32: ["Notepad++/notepad++.exe"] },
  },
]

const officeDefinitions: OfficeAppDefinition[] = [
  {
    id: "word",
    name: "Microsoft Word",
    executable: "WINWORD.EXE",
    extensions: ["doc", "docx", "docm", "dot", "dotx", "dotm", "rtf", "odt"],
    applications: ["Microsoft Word"],
    fallbackPaths: [
      "Microsoft Office/root/Office16/WINWORD.EXE",
      "Microsoft Office/Office16/WINWORD.EXE",
      "Microsoft Office/root/Office15/WINWORD.EXE",
      "Microsoft Office/Office15/WINWORD.EXE",
      "Microsoft Office/Office14/WINWORD.EXE",
    ],
  },
  {
    id: "excel",
    name: "Microsoft Excel",
    executable: "EXCEL.EXE",
    extensions: ["xls", "xlsx", "xlsm", "xlsb", "xlt", "xltx", "csv", "ods"],
    applications: ["Microsoft Excel"],
    fallbackPaths: [
      "Microsoft Office/root/Office16/EXCEL.EXE",
      "Microsoft Office/Office16/EXCEL.EXE",
      "Microsoft Office/root/Office15/EXCEL.EXE",
      "Microsoft Office/Office15/EXCEL.EXE",
      "Microsoft Office/Office14/EXCEL.EXE",
    ],
  },
  {
    id: "powerpoint",
    name: "Microsoft PowerPoint",
    executable: "POWERPNT.EXE",
    extensions: ["ppt", "pptx", "pptm", "pps", "ppsx", "pot", "potx", "odp"],
    applications: ["Microsoft PowerPoint"],
    fallbackPaths: [
      "Microsoft Office/root/Office16/POWERPNT.EXE",
      "Microsoft Office/Office16/POWERPNT.EXE",
      "Microsoft Office/root/Office15/POWERPNT.EXE",
      "Microsoft Office/Office15/POWERPNT.EXE",
      "Microsoft Office/Office14/POWERPNT.EXE",
    ],
  },
  {
    id: "wps-word",
    name: "WPS 文字",
    executable: "wps.exe",
    extensions: ["doc", "docx", "docm", "dot", "dotx", "wps", "wpt", "rtf", "odt"],
    versionedPaths: [
      {
        roots: ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"],
        prefix: "Kingsoft/WPS Office/",
        relative: "office6/wps.exe",
      },
    ],
  },
  {
    id: "wps-excel",
    name: "WPS 表格",
    executable: "et.exe",
    extensions: ["xls", "xlsx", "xlsm", "xlsb", "xlt", "xltx", "et", "ett", "csv", "ods"],
    versionedPaths: [
      {
        roots: ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"],
        prefix: "Kingsoft/WPS Office/",
        relative: "office6/et.exe",
      },
    ],
  },
  {
    id: "wps-ppt",
    name: "WPS 演示",
    executable: "wpp.exe",
    extensions: ["ppt", "pptx", "pptm", "pps", "ppsx", "pot", "potx", "dps", "dpt", "odp"],
    versionedPaths: [
      {
        roots: ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"],
        prefix: "Kingsoft/WPS Office/",
        relative: "office6/wpp.exe",
      },
    ],
  },
]

const exists = (path: string) =>
  access(path)
    .then(() => true)
    .catch(() => false)

const quoteCmdArg = (value: string) => `"${value.replaceAll('"', '""')}"`

const launchDetached = (command: string, commandArgs: string[]) =>
  new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (opened: boolean) => {
      if (settled) return
      settled = true
      resolve(opened)
    }
    const child = spawn(command, commandArgs, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    })
    child.once("error", () => {
      // Some Windows GUI launchers reject a direct detached spawn (notably
      // installations behind a per-user junction or a launcher stub). Retry
      // through `start` before reporting failure; this is still detached and
      // does not open a visible console window.
      if (process.platform !== "win32" || command.toLowerCase() === "cmd.exe") {
        finish(false)
        return
      }
      const line = ["start", '""', quoteCmdArg(command), ...commandArgs.map(quoteCmdArg)].join(" ")
      const fallback = spawn("cmd.exe", ["/d", "/s", "/c", line], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      })
      fallback.once("error", () => finish(false))
      fallback.once("spawn", () => {
        fallback.unref()
        finish(true)
      })
    })
    child.once("spawn", () => {
      child.unref()
      finish(true)
    })
  })

function commandPath(name: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("which", [name], { timeout: 2_000, windowsHide: true }, (error, stdout) => {
      const found = stdout.trim().split(/\r?\n/, 1)[0]
      resolve(error || !found ? undefined : found)
    })
  })
}

export function resolveWindowsCommand(
  name: string,
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  const pathValue = env.PATH ?? env.Path ?? ""
  const extensions = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
  for (const directory of pathValue.split(";")) {
    const hasExtension = extensions.some((extension) => name.toLowerCase().endsWith(extension.toLowerCase()))
    const candidates = hasExtension
      ? [win32.join(directory, name)]
      : extensions.map((extension) => win32.join(directory, `${name}${extension}`))
    for (const candidate of candidates) {
      if (exists(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * 解析 `reg query ... /ve` 的输出，取默认值（REG_SZ）。
 * 中文系统值名是「(默认)」，英文是「(Default)」——只认类型标记，不认值名。
 */
export function parseRegistryDefault(stdout: string): string | undefined {
  const match = stdout.match(/REG_SZ\s+(.+)/)
  const value = match?.[1]?.trim().replace(/^"(.*)"$/, "$1")
  return value || undefined
}

function queryRegistryAppPath(exeName: string): Promise<string | undefined> {
  if (process.platform !== "win32") return Promise.resolve(undefined)
  const keys = [
    `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`,
    `HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`,
    `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`,
  ]
  const query = (key: string) =>
    new Promise<string | undefined>((resolve) => {
      execFile("reg", ["query", key, "/ve"], { timeout: 3_000, windowsHide: true }, (error, stdout) => {
        resolve(error ? undefined : parseRegistryDefault(stdout))
      })
    })
  return keys.reduce<Promise<string | undefined>>(
    (chain, key) => chain.then((found) => found ?? query(key)),
    Promise.resolve(undefined),
  )
}

async function listDirectoryNames(path: string): Promise<string[]> {
  return readdir(path, { withFileTypes: true })
    .then((entries) => entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name))
    .catch(() => [])
}

async function listDirectoryFiles(path: string): Promise<string[]> {
  return readdir(path, { withFileTypes: true })
    .then((entries) => entries.filter((entry) => entry.isFile() || entry.isSymbolicLink()).map((entry) => entry.name))
    .catch(() => [])
}

export async function listWindowsShortcuts(): Promise<Array<{ name: string; target: string }>> {
  if (process.platform !== "win32") return []
  const script = [
    '$roots=@("$env:USERPROFILE\\Desktop","$env:PUBLIC\\Desktop","$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs","$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs")',
    '$shell=New-Object -ComObject WScript.Shell',
    '$items=@()',
    'foreach($root in $roots){ if(!(Test-Path -LiteralPath $root)){continue}; Get-ChildItem -LiteralPath $root -Filter "*.lnk" -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $s=$shell.CreateShortcut($_.FullName); if($s.TargetPath){ $items += [pscustomobject]@{name=$_.BaseName;target=$s.TargetPath} } } }',
    '$items | ConvertTo-Json -Compress',
  ].join(";")
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 8_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return resolve([])
        try {
          const parsed = JSON.parse(stdout.trim() || "[]") as { name?: unknown; target?: unknown } | Array<{ name?: unknown; target?: unknown }>
          const list = Array.isArray(parsed) ? parsed : [parsed]
          resolve(
            list.filter(
              (item): item is { name: string; target: string } =>
                typeof item?.name === "string" && typeof item?.target === "string" && item.target.length > 0,
            ),
          )
        } catch {
          resolve([])
        }
      },
    )
  })
}

const GENERIC_EDITOR_IGNORED = /(?:server|helper|update|uninstall|crash|reporter|tunnel|cli|cmd|setup)/i
const GENERIC_EDITOR_EXACT = new Set([
  "code",
  "code-insiders",
  "cursor",
  "zed",
  "windsurf",
  "sublime",
  "sublime-text",
  "sublime_text",
  "notepad++",
  "idea",
  "idea64",
  "openidea",
  "androidstudio",
  "neovim",
  "nvim",
  "vim",
  "emacs",
  "kate",
  "gedit",
  "atom",
  "lapce",
  "helix",
  "textmate",
  "nova",
  "fleet",
  "clion",
  "webstorm",
  "pycharm",
  "rider",
  "goland",
  "phpstorm",
  "rubymine",
])

function isGenericEditorExecutable(name: string, platform: NodeJS.Platform) {
  if (platform === "win32" && !/\.(?:exe|cmd|bat)$/i.test(name)) return false
  if (platform !== "win32" && /\.(?:dll|so|dylib)$/i.test(name)) return false
  const fileName = win32.basename(name)
  const stem = fileName.replace(/\.(?:exe|cmd|bat|appimage|app)$/i, "")
  const normalized = stem.toLowerCase().replace(/[\s_]+/g, "-")
  if (GENERIC_EDITOR_IGNORED.test(stem)) return false
  return GENERIC_EDITOR_EXACT.has(normalized) || /(?:editor|ide)$/i.test(stem)
}

function dynamicEditorId(path: string) {
  return `detected:${Buffer.from(path).toString("base64url")}`
}

function dynamicEditorName(path: string) {
  const name = win32.basename(path).replace(/\.(?:exe|cmd|bat|appimage|app)$/i, "")
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export async function discoverGenericEditors(current: EditorSystem): Promise<Array<{ id: string; name: string; path: string }>> {
  const candidates = new Set<string>()
  const candidateNames = new Map<string, string>()
  const addFiles = async (directory: string | undefined) => {
    if (!directory || !current.listFiles) return
    for (const name of await current.listFiles(directory)) {
      if (!isGenericEditorExecutable(name, current.platform)) continue
      const candidate = current.platform === "win32" ? win32.join(directory, name) : join(directory, name)
      if (await current.exists(candidate)) candidates.add(candidate)
    }
  }

  const pathValue = current.env.PATH ?? current.env.Path ?? ""
  for (const directory of pathValue.split(current.platform === "win32" ? ";" : ":")) {
    await addFiles(directory)
  }

  if (current.platform === "win32" && current.listDir) {
    const roots = windowsRoots(current, ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"])
    for (const root of roots) {
      await addFiles(root)
      for (const directory of await current.listDir(root)) {
        await addFiles(win32.join(root, directory))
      }
    }
  }

  if (current.platform === "win32" && current.listShortcuts) {
    for (const shortcut of await current.listShortcuts()) {
      if (!isGenericEditorExecutable(shortcut.target, current.platform)) continue
      if (!(await current.exists(shortcut.target))) continue
      candidates.add(shortcut.target)
      candidateNames.set(shortcut.target, shortcut.name)
    }
  }

  if (current.platform === "darwin" && current.listDir) {
    for (const root of ["/Applications", join(current.home, "Applications")]) {
      for (const name of await current.listDir(root)) {
        if (!/\.app$/i.test(name) || !isGenericEditorExecutable(name, current.platform)) continue
        const candidate = join(root, name)
        if (await current.exists(candidate)) candidates.add(candidate)
      }
    }
  }

  const unique = new Map<string, { id: string; name: string; path: string }>()
  for (const path of [...candidates].sort((left, right) => left.localeCompare(right))) {
    const editor = {
      id: dynamicEditorId(path),
      name: candidateNames.get(path) ?? dynamicEditorName(path),
      path,
    }
    const key = editor.name.toLowerCase()
    if (!unique.has(key)) unique.set(key, editor)
  }
  return [...unique.values()]
}

export type EditorSystem = {
  platform: NodeJS.Platform
  home: string
  env: NodeJS.ProcessEnv
  exists: (path: string) => Promise<boolean>
  findCommand: (name: string) => Promise<string | undefined>
  /** 列出目录下的子目录名；失败/不存在返回空数组。 */
  listDir?: (path: string) => Promise<string[]>
  /** 列出目录下的文件名；失败/不存在返回空数组。 */
  listFiles?: (path: string) => Promise<string[]>
  /** 列出 Windows 快捷方式的显示名和真实目标路径。 */
  listShortcuts?: () => Promise<Array<{ name: string; target: string }>>
  /** 查 Windows App Paths 注册表里某个可执行文件的安装路径。 */
  queryAppPath?: (exeName: string) => Promise<string | undefined>
}

const system: EditorSystem = {
  platform: process.platform,
  home: homedir(),
  env: process.env,
  exists: (path) => exists(path),
  findCommand: async (name) => {
    if (process.platform === "win32") return resolveWindowsCommand(name, process.env)
    return commandPath(name)
  },
  listDir: listDirectoryNames,
  listFiles: listDirectoryFiles,
  listShortcuts: listWindowsShortcuts,
  queryAppPath: queryRegistryAppPath,
}

const windowsRoots = (current: EditorSystem, roots: WindowsRoot[]) =>
  roots.map((root) => current.env[root]).filter((root): root is string => !!root)

/**
 * 带版本号的安装目录：prefix 本身可能含斜杠（JetBrains/IntelliJ IDEA），
 * 拆成「父目录 + 目录名前缀」两段，在父目录里挑版本号最大的匹配目录。
 * prefix 以 / 结尾表示直接扫该目录里的版本子目录（WPS Office/<版本>/office6）。
 */
async function resolveVersionedPath(
  spec: { roots: WindowsRoot[]; prefix: string; relative: string },
  current: EditorSystem,
): Promise<string | undefined> {
  if (!current.listDir) return undefined
  const joinPath = (...parts: string[]) => (current.platform === "win32" ? win32.join(...parts) : join(...parts))
  const segments = spec.prefix.split("/")
  const namePrefix = segments.pop()!.toLowerCase()
  for (const root of windowsRoots(current, spec.roots)) {
    const parent = joinPath(root, ...segments)
    const names = await current.listDir(parent)
    const candidates = names
      .filter((name) => name.toLowerCase().startsWith(namePrefix))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    for (const name of candidates) {
      const candidate = joinPath(parent, name, ...spec.relative.split("/"))
      if (await current.exists(candidate)) return candidate
    }
  }
  return undefined
}

async function resolveWindowsInstall(
  editor: Pick<EditorDefinition, "fallbackPaths" | "versionedPaths">,
  current: EditorSystem,
): Promise<string | undefined> {
  const roots = windowsRoots(current, ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"])
  for (const root of roots) {
    for (const relativePath of editor.fallbackPaths?.win32 ?? []) {
      const candidate = win32.join(root, ...relativePath.split("/"))
      if (await current.exists(candidate)) return candidate
    }
  }
  for (const spec of editor.versionedPaths ?? []) {
    const found = await resolveVersionedPath(spec, current)
    if (found) return found
  }
  return undefined
}

export async function resolveEditorPath(editor: EditorDefinition, current: EditorSystem): Promise<string | undefined> {
  for (const command of editor.commands[current.platform] ?? []) {
    const found =
      current.platform === "win32" ? resolveWindowsCommand(command, current.env) : await current.findCommand(command)
    if (found) return found
  }

  if (current.platform === "darwin") {
    for (const app of editor.applications ?? []) {
      const locations = [`/Applications/${app}.app`, `${current.home}/Applications/${app}.app`]
      for (const location of locations) {
        if (await current.exists(location)) return location
      }
    }
  }

  if (current.platform === "win32") {
    const registered = editor.windowsExecutable ? await current.queryAppPath?.(editor.windowsExecutable) : undefined
    if (registered && (await current.exists(registered))) return registered
    return resolveWindowsInstall(editor, current)
  }

  return undefined
}

export async function resolveOfficeAppPath(
  app: OfficeAppDefinition,
  current: EditorSystem,
): Promise<string | undefined> {
  if (current.platform === "win32") {
    const registered = await current.queryAppPath?.(app.executable)
    if (registered && (await current.exists(registered))) return registered
    return resolveWindowsInstall(
      { fallbackPaths: { win32: app.fallbackPaths }, versionedPaths: app.versionedPaths },
      current,
    )
  }
  if (current.platform === "darwin") {
    for (const name of app.applications ?? []) {
      const locations = [`/Applications/${name}.app`, `${current.home}/Applications/${name}.app`]
      for (const location of locations) {
        if (await current.exists(location)) return location
      }
    }
  }
  return undefined
}

const iconCache = new Map<string, string | null>()

function windowsIconDataUrl(path: string): Promise<string | null> {
  if (process.platform !== "win32") return Promise.resolve(null)
  // `-Command` does not bind trailing native-process arguments to a top-level
  // `param(...)` declaration. Wrap the script in a script block so the exe
  // path is passed reliably on Windows (this is important for OpenIDEA and
  // the system terminal executables alike).
  const script = `& {
param([string]$target)
Add-Type -AssemblyName System.Drawing
try {
  $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($target)
  if ($null -eq $icon) { exit 0 }
  $bitmap = $icon.ToBitmap()
  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  [Convert]::ToBase64String($stream.ToArray())
  $bitmap.Dispose()
  $icon.Dispose()
} catch { exit 0 }
} `
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script, path],
      { timeout: 5_000, windowsHide: true, maxBuffer: 256 * 1024 },
      (error, stdout) => resolve(error || !stdout.trim() ? null : `data:image/png;base64,${stdout.trim()}`),
    )
  })
}

export async function getFileIconDataUrl(path: string): Promise<string | null> {
  if (!path) return null
  const cached = iconCache.get(path)
  if (cached !== undefined) return cached
  // Windows 的 Electron getFileIcon 在部分便携版/快捷方式安装的程序上会返回
  // 空图标或通用占位图。先走系统原生提取，确保 OpenIDEA、Terminal、Explorer
  // 等显示的是真实 exe 图标；其他平台仍使用 Electron 的 NativeImage。
  const nativeUrl = await windowsIconDataUrl(path)
  if (nativeUrl) {
    iconCache.set(path, nativeUrl)
    return nativeUrl
  }

  // 动态引入：本模块会被 bun:test 直接加载，electron 只能在主进程运行时取。
  const { app } = await import("electron")
  const icon = app && typeof app.getFileIcon === "function"
    ? await app.getFileIcon(path, { size: "normal" }).catch(() => undefined)
    : undefined
  const url = icon && !icon.isEmpty() ? icon.toDataURL() : null
  iconCache.set(path, url)
  return url
}

const DETECTION_TTL = 60_000
let editorsCache: { at: number; value: InstalledEditor[] } | undefined
let officeCache: { at: number; value: OfficeApp[] } | undefined
const detectedEditorPaths = new Map<string, string>()

export async function getInstalledEditors(): Promise<InstalledEditor[]> {
  if (editorsCache && Date.now() - editorsCache.at < DETECTION_TTL) return editorsCache.value
  const installed: InstalledEditor[] = []
  const knownPaths = new Set<string>()
  const knownExecutableNames = new Set<string>()
  for (const editor of definitions) {
    const executable = await resolveEditorPath(editor, system)
    if (!executable) continue
    knownPaths.add(executable.toLowerCase())
    for (const name of editor.commands[system.platform] ?? []) {
      knownExecutableNames.add(win32.basename(name).replace(/\.(?:exe|cmd|bat)$/i, "").toLowerCase())
    }
    const icon = await getFileIconDataUrl(executable)
    installed.push({ id: editor.id, name: editor.name, ...(icon ? { icon } : {}) })
  }

  // Keep the curated definitions for stable labels/icons, then add any other
  // editor-like executable that the OS can actually see. This covers new IDEs,
  // portable editors, vendor forks, and user-installed tools without requiring
  // a release for every new application name.
  for (const detected of await discoverGenericEditors(system)) {
    if (knownPaths.has(detected.path.toLowerCase())) continue
    if (knownExecutableNames.has(detected.name.toLowerCase())) continue
    detectedEditorPaths.set(detected.id, detected.path)
    const icon = await getFileIconDataUrl(detected.path)
    installed.push({ id: detected.id, name: detected.name, ...(icon ? { icon } : {}) })
  }

  editorsCache = { at: Date.now(), value: installed }
  return installed
}

export async function getOfficeApps(): Promise<OfficeApp[]> {
  if (officeCache && Date.now() - officeCache.at < DETECTION_TTL) return officeCache.value
  const installed: OfficeApp[] = []
  for (const app of officeDefinitions) {
    const executable = await resolveOfficeAppPath(app, system)
    if (!executable) continue
    const icon = await getFileIconDataUrl(executable)
    installed.push({ id: app.id, name: app.name, extensions: app.extensions, ...(icon ? { icon } : {}) })
  }
  officeCache = { at: Date.now(), value: installed }
  return installed
}

export async function openInEditor(editorId: string, targetPath: string, kind: "file" | "directory") {
  if (!targetPath || !["file", "directory"].includes(kind)) return false
  const editor = definitions.find((candidate) => candidate.id === editorId)
  const office = editor ? undefined : officeDefinitions.find((candidate) => candidate.id === editorId)
  const detected = editor || office ? undefined : detectedEditorPaths.get(editorId)
  if (!editor && !office && !detected) return false
  if (office && kind !== "file") return false
  const executable = editor
    ? await resolveEditorPath(editor, system)
    : office
      ? await resolveOfficeAppPath(office, system)
      : detected
  if (!executable) return false

  if (system.platform === "darwin" && executable.endsWith(".app")) {
    const args = ["-a", executable, targetPath]
    return launchDetached("/usr/bin/open", args)
  }

  const args = [targetPath]
  if (editor && ["vscode", "vscode-insiders", "cursor", "windsurf"].includes(editor.id)) {
    args.unshift("--reuse-window")
  }
  const isBatchFile = system.platform === "win32" && /\.(cmd|bat)$/i.test(executable)
  const command = isBatchFile ? "cmd.exe" : executable
  const commandArgs = isBatchFile
    ? ["/d", "/s", "/c", `${quoteCmdArg(executable)} ${args.map(quoteCmdArg).join(" ")}`]
    : args
  // GUI applications should be launched detached. `execFile` waits for the
  // application process and its five-second timeout reports a false failure
  // for Word/WPS/IDE processes that remain alive after opening the document.
  return launchDetached(command, commandArgs)
}
