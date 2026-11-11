import { execFile } from "node:child_process"
import { access } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { win32 } from "node:path"
import type { InstalledEditor } from "../preload/types"

export type EditorDefinition = {
  id: string
  name: string
  commands: Partial<Record<NodeJS.Platform, string[]>>
  applications?: string[]
  fallbackPaths?: Partial<Record<NodeJS.Platform, string[]>>
}

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

export type EditorSystem = {
  platform: NodeJS.Platform
  home: string
  env: NodeJS.ProcessEnv
  exists: (path: string) => Promise<boolean>
  findCommand: (name: string) => Promise<string | undefined>
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
    const roots = [current.env.LOCALAPPDATA, current.env.ProgramFiles, current.env["ProgramFiles(x86)"]].filter(
      (root): root is string => !!root,
    )
    for (const root of roots) {
      for (const relativePath of editor.fallbackPaths?.win32 ?? []) {
        const candidate = win32.join(root, ...relativePath.split("/"))
        if (await current.exists(candidate)) return candidate
      }
    }
  }

  return undefined
}

export async function getInstalledEditors(): Promise<InstalledEditor[]> {
  const installed: InstalledEditor[] = []
  for (const editor of definitions) {
    if (await resolveEditorPath(editor, system)) installed.push({ id: editor.id, name: editor.name })
  }
  return installed
}

export async function openInEditor(editorId: string, targetPath: string, kind: "file" | "directory") {
  if (!targetPath || !["file", "directory"].includes(kind)) return false
  const editor = definitions.find((candidate) => candidate.id === editorId)
  if (!editor) return false
  const executable = await resolveEditorPath(editor, system)
  if (!executable) return false

  if (system.platform === "darwin" && executable.endsWith(".app")) {
    const args = ["-a", executable, targetPath]
    return new Promise<boolean>((resolve) => {
      execFile("/usr/bin/open", args, { timeout: 5_000, windowsHide: true }, (error) => resolve(!error))
    })
  }

  const args = [targetPath]
  if (editor.id === "vscode" || editor.id === "vscode-insiders" || editor.id === "cursor" || editor.id === "windsurf") {
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
