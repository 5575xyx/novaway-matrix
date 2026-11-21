import { execFile } from "node:child_process"
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
    fallbackPaths: { win32: ["Zed/Zed.exe"] },
  },
  {
    id: "idea",
    name: "IntelliJ IDEA",
    commands: { win32: ["idea64.exe", "idea.cmd"], darwin: ["idea"], linux: ["idea"] },
    applications: ["IntelliJ IDEA", "IntelliJ IDEA Ultimate", "IntelliJ IDEA Community Edition"],
    fallbackPaths: { win32: ["JetBrains/IntelliJ IDEA/bin/idea64.exe"] },
    versionedPaths: [
      { roots: ["ProgramFiles", "ProgramFiles(x86)"], prefix: "JetBrains/IntelliJ IDEA", relative: "bin/idea64.exe" },
      { roots: ["LOCALAPPDATA"], prefix: "Programs/IntelliJ IDEA", relative: "bin/idea64.exe" },
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
      { roots: ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"], prefix: "Kingsoft/WPS Office/", relative: "office6/wps.exe" },
    ],
  },
  {
    id: "wps-excel",
    name: "WPS 表格",
    executable: "et.exe",
    extensions: ["xls", "xlsx", "xlsm", "xlsb", "xlt", "xltx", "et", "ett", "csv", "ods"],
    versionedPaths: [
      { roots: ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"], prefix: "Kingsoft/WPS Office/", relative: "office6/et.exe" },
    ],
  },
  {
    id: "wps-ppt",
    name: "WPS 演示",
    executable: "wpp.exe",
    extensions: ["ppt", "pptx", "pptm", "pps", "ppsx", "pot", "potx", "dps", "dpt", "odp"],
    versionedPaths: [
      { roots: ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"], prefix: "Kingsoft/WPS Office/", relative: "office6/wpp.exe" },
    ],
  },
]

const exists = (path: string) =>
  access(path)
    .then(() => true)
    .catch(() => false)

const quoteCmdArg = (value: string) => `"${value.replaceAll('"', '""')}"`

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

export type EditorSystem = {
  platform: NodeJS.Platform
  home: string
  env: NodeJS.ProcessEnv
  exists: (path: string) => Promise<boolean>
  findCommand: (name: string) => Promise<string | undefined>
  /** 列出目录下的子目录名；失败/不存在返回空数组。 */
  listDir?: (path: string) => Promise<string[]>
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

  if (current.platform === "win32") return resolveWindowsInstall(editor, current)

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

/** 真实应用图标（exe / .app / 任意文件的系统关联图标）→ dataURL，按路径缓存。 */
const iconCache = new Map<string, string | null>()
export async function getFileIconDataUrl(path: string): Promise<string | null> {
  if (!path) return null
  const cached = iconCache.get(path)
  if (cached !== undefined) return cached
  // 动态引入：本模块会被 bun:test 直接加载，electron 只能在主进程运行时取。
  const { app } = await import("electron")
  const icon = await app.getFileIcon(path, { size: "normal" }).catch(() => undefined)
  const url = icon && !icon.isEmpty() ? icon.toDataURL() : null
  iconCache.set(path, url)
  return url
}

const DETECTION_TTL = 60_000
let editorsCache: { at: number; value: InstalledEditor[] } | undefined
let officeCache: { at: number; value: OfficeApp[] } | undefined

export async function getInstalledEditors(): Promise<InstalledEditor[]> {
  if (editorsCache && Date.now() - editorsCache.at < DETECTION_TTL) return editorsCache.value
  const installed: InstalledEditor[] = []
  for (const editor of definitions) {
    const executable = await resolveEditorPath(editor, system)
    if (!executable) continue
    const icon = await getFileIconDataUrl(executable)
    installed.push({ id: editor.id, name: editor.name, ...(icon ? { icon } : {}) })
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
  if (!editor && !office) return false
  if (office && kind !== "file") return false
  const executable = editor ? await resolveEditorPath(editor, system) : await resolveOfficeAppPath(office!, system)
  if (!executable) return false

  if (system.platform === "darwin" && executable.endsWith(".app")) {
    const args = ["-a", executable, targetPath]
    return new Promise<boolean>((resolve) => {
      execFile("/usr/bin/open", args, { timeout: 5_000, windowsHide: true }, (error) => resolve(!error))
    })
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
  return new Promise<boolean>((resolve) => {
    execFile(command, commandArgs, { timeout: 5_000, windowsHide: true }, (error) => resolve(!error))
  })
}