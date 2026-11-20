import { realpathSync, statSync } from "node:fs"
import path from "node:path"

export type Backend = "auto" | "bwrap" | "landlock" | "seatbelt" | "docker" | "podman"

export type Config = {
  enabled?: boolean
  backend?: Backend
  docker_image?: string
  network?: boolean
  allow_paths?: readonly string[]
}

export type Invocation = { command: string; args: string[]; cwd: string }

export class UnsupportedBackendError extends Error {
  constructor(backend: Backend, platform: string) {
    super(
      platform === "win32"
        ? `Sandbox backend windows is not available on ${platform}; no verified Windows helper is bundled`
        : backend === "auto"
          ? `Sandbox backend "auto" could not be resolved on ${platform}; install bwrap (Linux) or use sandbox-exec (macOS)`
          : `Sandbox backend ${backend} is not available on ${platform}`,
    )
    this.name = "UnsupportedBackendError"
  }
}

/** Probe is injectable so the pure argv tests can describe a platform instead of the host. */
export type Probe = (command: string) => boolean

export const probeOnPath: Probe = (command) => {
  const path = process.env.PATH ?? process.env.Path ?? ""
  const separator = process.platform === "win32" ? ";" : ":"
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""]
  return path
    .split(separator)
    .filter(Boolean)
    .some((directory) =>
      extensions.some((extension) => {
        const file = `${directory.replace(/[\\/]+$/, "")}/${command}${extension}`
        try {
          return statSync(file).isFile()
        } catch {
          return false
        }
      }),
    )
}

/**
 * `auto` means "use the first backend that is actually installed". It never means
 * "run without isolation": resolving to nothing is an error, because a sandbox
 * silently turning itself off is worse than a command that refuses to run.
 */
export function resolveBackend(config: Config, platform = process.platform, probe: Probe = probeOnPath): Backend {
  const backend = config.backend ?? "auto"
  if (backend !== "auto") return backend
  if (platform === "linux" && probe("bwrap")) return "bwrap"
  if (platform === "darwin" && probe("sandbox-exec")) return "seatbelt"
  if (platform === "win32") throw new UnsupportedBackendError("auto", platform)
  throw new UnsupportedBackendError("auto", platform)
}

/** Network is denied unless the config explicitly enables it. */
function networkDenied(config: Config) {
  return config.network !== true
}

function allowedPaths(input: Invocation, config: Config, platform: string) {
  const pathApi = platform === "win32" ? path.win32 : path.posix
  const cwd = platform === process.platform ? path.resolve(input.cwd) : pathApi.resolve(input.cwd)
  const resolve = (value: string) => (platform === process.platform ? realpathSync(value) : pathApi.resolve(value))
  const workspace = resolve(cwd)
  const paths = (config.allow_paths ?? []).map((value) => {
    if (!isAbsoluteFilesystemPath(value, platform)) {
      throw new Error(`Sandbox allow_paths entry must be an absolute filesystem path: ${value}`)
    }
    const resolved = resolve(value)
    if (platform !== process.platform) {
      if (process.platform === "win32" && platform === "linux") {
        const hostPath = value.replaceAll("/", path.sep)
        if (!statSync(hostPath).isDirectory()) throw new Error(`Sandbox allow_paths entry must be a directory: ${value}`)
      }
      if (pathApi.parse(resolved).root === resolved) throw new Error(`Sandbox allow_paths entry cannot be a filesystem root: ${value}`)
      if (pathContains(resolved, workspace, platform) || pathContains(workspace, resolved, platform)) {
        throw new Error(`Sandbox allow_paths entry overlaps the workspace: ${value}`)
      }
      return resolved
    }
    if (!statSync(resolved).isDirectory()) {
      throw new Error(`Sandbox allow_paths entry must be a directory: ${value}`)
    }
    if (pathApi.parse(resolved).root === resolved) throw new Error(`Sandbox allow_paths entry cannot be a filesystem root: ${value}`)
    if (pathContains(resolved, workspace, platform) || pathContains(workspace, resolved, platform)) {
      throw new Error(`Sandbox allow_paths entry overlaps the workspace: ${value}`)
    }
    return resolved
  })
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      if (pathContains(paths[i], paths[j], platform) || pathContains(paths[j], paths[i], platform)) {
        throw new Error(`Sandbox allow_paths entries overlap: ${paths[i]} and ${paths[j]}`)
      }
    }
  }
  return paths
}

export function isAbsoluteFilesystemPath(value: string, platform: string) {
  if (platform !== "win32") return path.posix.isAbsolute(value)
  if (/^[\\\\/]{2}[?.][\\\\/]/.test(value)) return false
  if (/^[A-Za-z]:[\\\\/]/.test(value)) return true
  const root = path.win32.parse(value).root
  return root.slice(0, 2) === "\\\\" && root.split(/[\\\\/]/).filter(Boolean).length === 2
}

export function pathContains(parent: string, child: string, platform: string) {
  const paths = platform === "win32" ? path.win32 : path.posix
  const normalizedParent = paths.normalize(parent)
  const normalizedChild = paths.normalize(child)
  const relative = paths.relative(
    platform === "win32" ? normalizedParent.toLowerCase() : normalizedParent,
    platform === "win32" ? normalizedChild.toLowerCase() : normalizedChild,
  )
  return relative === "" || (!relative.startsWith(`..${paths.sep}`) && relative !== ".." && !paths.isAbsolute(relative))
}

function seatbeltProfile(input: Invocation, config: Config, platform: string) {
  const writable = [path.resolve(input.cwd), ...allowedPaths(input, config, platform)]
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    ...writable.map((directory) => `(allow file-write* (subpath ${JSON.stringify(directory)}))`),
    ...(networkDenied(config) ? ["(deny network*)"] : []),
  ].join(" ")
}

export function wrap(
  input: Invocation,
  config: Config,
  platform = process.platform,
  probe: Probe = probeOnPath,
): Invocation {
  if (!config.enabled) return input

  const backend = resolveBackend(config, platform, probe)


  if (backend === "bwrap") {
    if (platform !== "linux") throw new UnsupportedBackendError(backend, platform)
    return {
      command: "bwrap",
      args: [
        "--die-with-parent",
        "--new-session",
        "--ro-bind",
        "/",
        "/",
        ...allowedPaths(input, config, platform).flatMap((directory) => ["--bind", directory, directory]),
        "--bind",
        input.cwd,
        input.cwd,
        ...(networkDenied(config) ? ["--unshare-net"] : []),
        "--chdir",
        input.cwd,
        "--",
        input.command,
        ...input.args,
      ],
      cwd: input.cwd,
    }
  }

  if (backend === "seatbelt") {
    if (platform !== "darwin") throw new UnsupportedBackendError(backend, platform)
    return {
      command: "sandbox-exec",
      args: ["-p", seatbeltProfile(input, config, platform), "--", input.command, ...input.args],
      cwd: input.cwd,
    }
  }

  if (backend === "docker" || backend === "podman") {
    if (platform !== "linux") throw new UnsupportedBackendError(backend, platform)
    const image = config.docker_image
    if (!image) throw new UnsupportedBackendError(backend, platform)
    return {
      command: backend,
      args: [
        "run",
        "--rm",
        "--read-only",
        "--volume",
        `${input.cwd}:${input.cwd}:rw`,
        ...(networkDenied(config) ? ["--network=none"] : []),
        ...allowedPaths(input, config, platform).flatMap((directory) => ["--volume", `${directory}:${directory}:rw`]),
        "--workdir",
        input.cwd,
        image,
        input.command,
        ...input.args,
      ],
      cwd: input.cwd,
    }
  }

  // landlock needs an external helper binary that is not a portable wrapper; refusing
  // is the only safe answer until a real helper is wired in.
  throw new UnsupportedBackendError(backend, platform)
}

/**
 * The shell tool's spawn point runs a shell string, not argv. Convert it into an
 * argv invocation first so the same policy applies to model-authored commands.
 */
export function wrapShell(
  input: { shell: string; command: string; cwd: string },
  config: Config,
  platform = process.platform,
  probe: Probe = probeOnPath,
) {
  return wrap({ command: input.shell, args: ["-c", input.command], cwd: input.cwd }, config, platform, probe)
}

export * as Sandbox from "./sandbox"
