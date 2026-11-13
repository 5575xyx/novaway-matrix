import { statSync } from "node:fs"

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
      backend === "auto"
        ? `Sandbox backend "auto" could not be resolved on ${platform}; install bwrap (Linux) or use sandbox-exec (macOS), or pick docker/podman explicitly`
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
  throw new UnsupportedBackendError("auto", platform)
}

/** Network is denied unless the config explicitly enables it. */
function networkDenied(config: Config) {
  return config.network !== true
}

function seatbeltProfile(input: Invocation, config: Config) {
  const writable = [input.cwd, ...(config.allow_paths ?? [])]
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
  if (!config.enabled || platform === "win32") return input

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
        ...(config.allow_paths ?? []).flatMap((directory) => ["--bind", directory, directory]),
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
      args: ["-p", seatbeltProfile(input, config), "--", input.command, ...input.args],
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
        ...(config.allow_paths ?? []).flatMap((directory) => ["--volume", `${directory}:${directory}:rw`]),
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
