import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { isAbsoluteFilesystemPath, UnsupportedBackendError, pathContains, resolveBackend, wrap, wrapShell } from "@/sandbox/sandbox"

describe("sandbox", () => {
  const input = { command: "git", args: ["status"], cwd: "/workspace/project" }
  const none = () => false

  test("returns the original invocation when disabled", () => {
    expect(wrap(input, {}, "linux", none)).toBe(input)
    expect(wrap({ ...input }, {}, "win32", none)).toEqual({ ...input })
  })

  test("auto resolves to an installed backend and fails when none exists", () => {
    expect(resolveBackend({ backend: "auto" }, "linux", (command) => command === "bwrap")).toBe("bwrap")
    expect(resolveBackend({ backend: "auto" }, "darwin", (command) => command === "sandbox-exec")).toBe("seatbelt")
    expect(() => resolveBackend({ backend: "auto" }, "linux", none)).toThrow(UnsupportedBackendError)
    expect(() => resolveBackend({ backend: "auto" }, "win32", none)).toThrow(
      'Sandbox backend windows is not available on win32; no verified Windows helper is bundled',
    )
  })

  test("rejects unavailable backends instead of running unsandboxed", () => {
    expect(() => wrap(input, { enabled: true, backend: "landlock" }, "linux", none)).toThrow(UnsupportedBackendError)
    expect(() => wrap(input, { enabled: true, backend: "bwrap" }, "darwin", none)).toThrow(UnsupportedBackendError)
    expect(() => wrap(input, { enabled: true, backend: "docker" }, "linux", none)).toThrow(UnsupportedBackendError)
    expect(() => wrap(input, { enabled: true, backend: "auto" }, "win32", none)).toThrow(UnsupportedBackendError)
    for (const backend of ["bwrap", "landlock", "seatbelt", "docker", "podman"] as const) {
      expect(() => wrap(input, { enabled: true, backend }, "win32", none)).toThrow(UnsupportedBackendError)
    }
  })

  test("rejects allow_paths that are relative, missing, roots, or overlapping the workspace", async () => {
    if (process.platform === "win32") return
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-sandbox-paths-"))
    const workspace = path.join(root, "workspace")
    const child = path.join(workspace, "allowed")
    const parent = path.join(root, "parent")
    await fs.mkdir(child, { recursive: true })
    const nested = path.join(parent, "nested")
    await fs.mkdir(parent)
    await fs.mkdir(nested)
    const sandboxInput = {
      command: "true",
      args: [],
      cwd: root,
    }
    const run = (cwd: string, allow_paths: string[]) =>
      wrap({ ...sandboxInput, cwd }, { enabled: true, backend: "bwrap", allow_paths }, "linux", none)

    try {
      expect(() => run(workspace, ["relative"])).toThrow("must be absolute")
      expect(() => run(workspace, [path.join(root, "missing")])).toThrow("ENOENT")
      expect(() => run(workspace, [workspace])).toThrow("overlaps the workspace")
      expect(() => run(workspace, [child])).toThrow("overlaps the workspace")
      expect(() => run(workspace, ["/"])).toThrow("filesystem root")
      expect(() => run(workspace, [parent, nested])).toThrow("entries overlap")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("compares POSIX paths without treating prefix collisions as containment", () => {
    expect(pathContains("/work/project", "/work/project/src", "linux")).toBe(true)
    expect(pathContains("/work/project", "/work/project", "linux")).toBe(true)
    expect(pathContains("/work/project", "/work/project-other", "linux")).toBe(false)
    expect(pathContains("/work/project", "/other/project", "linux")).toBe(false)
    expect(pathContains("/work/project", "/work/project/../secrets", "linux")).toBe(false)
    expect(pathContains("/", "/work/project", "linux")).toBe(true)
  })

  test("accepts only absolute Windows filesystem paths", () => {
    expect(isAbsoluteFilesystemPath("C:\\Work\\Project", "win32")).toBe(true)
    expect(isAbsoluteFilesystemPath("\\\\server\\share\\work", "win32")).toBe(true)
    expect(isAbsoluteFilesystemPath("\\\\server\\share", "win32")).toBe(true)
    expect(isAbsoluteFilesystemPath("\\\\server", "win32")).toBe(false)
    expect(isAbsoluteFilesystemPath("//server/share/work", "win32")).toBe(false)
    expect(isAbsoluteFilesystemPath("C:/Work/Project", "win32")).toBe(true)
    expect(isAbsoluteFilesystemPath("/rooted-on-current-drive", "win32")).toBe(false)
    expect(isAbsoluteFilesystemPath("\\\\?\\C:\\Work", "win32")).toBe(false)
    expect(isAbsoluteFilesystemPath("\\\\.\\PhysicalDrive0", "win32")).toBe(false)
    expect(isAbsoluteFilesystemPath("\\rooted-on-current-drive", "win32")).toBe(false)
    expect(isAbsoluteFilesystemPath("C:relative", "win32")).toBe(false)
    expect(isAbsoluteFilesystemPath("/var/cache", "linux")).toBe(true)
    expect(isAbsoluteFilesystemPath("C:\\Work", "linux")).toBe(false)
  })

  test("compares Windows paths case-insensitively and rejects cross-drive paths", () => {
    expect(pathContains("C:\\Work\\Project", "c:\\work\\project\\src", "win32")).toBe(true)
    expect(pathContains("C:\\Work\\Project", "C:\\Work\\Project", "win32")).toBe(true)
    expect(pathContains("C:\\Work\\Project", "C:\\Work\\Project-other", "win32")).toBe(false)
    expect(pathContains("C:\\Work\\Project", "D:\\Work\\Project\\src", "win32")).toBe(false)
    expect(pathContains("C:\\Work\\Project", "C:\\Work\\Project\\..\\secrets", "win32")).toBe(false)
    expect(pathContains("C:\\", "C:\\Work\\Project", "win32")).toBe(true)
    expect(pathContains("\\\\server\\share\\work", "\\\\SERVER\\SHARE\\work\\src", "win32")).toBe(true)
    expect(pathContains("\\\\server\\share\\work", "\\\\server\\other\\work\\src", "win32")).toBe(false)
    expect(pathContains("C:\\Work\\Project", "\\\\?\\C:\\Work\\Project\\src", "win32")).toBe(false)
    expect(pathContains("C:\\Work\\Project", "C:relative", "win32")).toBe(false)
  })

  test("wraps bwrap using a read-only root, writable workspace and denied network by default", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-sandbox-bwrap-"))
    const invocation = { ...input, cwd: path.join(root, "workspace") }
    await fs.mkdir(invocation.cwd)
    try {
      expect(wrap(invocation, { enabled: true, backend: "bwrap" }, "linux", none)).toEqual({
        command: "bwrap",
        args: [
          "--die-with-parent",
          "--new-session",
          "--ro-bind",
          "/",
          "/",
          "--bind",
          invocation.cwd,
          invocation.cwd,
          "--unshare-net",
          "--chdir",
          invocation.cwd,
          "--",
          "git",
          "status",
        ],
        cwd: invocation.cwd,
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("allows network and extra writable paths only when configured", async () => {
    if (process.platform !== "linux") return
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-sandbox-network-"))
    const invocation = { ...input, cwd: path.join(root, "workspace") }
    const shared = path.join(root, "shared")
    await fs.mkdir(invocation.cwd)
    await fs.mkdir(shared)
    try {
      expect(
        wrap(
          invocation,
          { enabled: true, backend: "bwrap", network: true, allow_paths: [shared] },
          process.platform,
          none,
        ).args,
      ).toEqual([
        "--die-with-parent",
        "--new-session",
        "--ro-bind",
        "/",
        "/",
        "--bind",
        shared,
        shared,
        "--bind",
        invocation.cwd,
        invocation.cwd,
        "--chdir",
        invocation.cwd,
        "--",
        "git",
        "status",
      ])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("wraps seatbelt with a write and network profile", async () => {
    if (process.platform !== "darwin") return
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-sandbox-seatbelt-"))
    const invocation = { ...input, cwd: path.join(root, "workspace") }
    const shared = path.join(root, "shared")
    await fs.mkdir(invocation.cwd)
    await fs.mkdir(shared)
    try {
      const wrapped = wrap(invocation, { enabled: true, backend: "seatbelt", allow_paths: [shared] }, process.platform, none)
      expect(wrapped.command).toBe("sandbox-exec")
      expect(wrapped.args[0]).toBe("-p")
      expect(wrapped.args[1]).toContain("(deny file-write*)")
      expect(wrapped.args[1]).toContain(`(allow file-write* (subpath ${JSON.stringify(invocation.cwd)}))`)
      expect(wrapped.args[1]).toContain(`(allow file-write* (subpath ${JSON.stringify(shared)}))`)
      expect(wrapped.args[1]).toContain("(deny network*)")
      expect(wrapped.args.slice(-3)).toEqual(["--", "git", "status"])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("wraps container arguments using configured image and mount policy", async () => {
    if (process.platform !== "linux") return
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-sandbox-container-"))
    const invocation = { ...input, cwd: path.join(root, "workspace") }
    const shared = path.join(root, "shared")
    await fs.mkdir(invocation.cwd)
    await fs.mkdir(shared)
    try {
      expect(
        wrap(
          invocation,
          { enabled: true, backend: "docker", docker_image: "node:lts", allow_paths: [shared] },
          process.platform,
          none,
        ),
      ).toEqual({
        command: "docker",
        args: [
          "run",
          "--rm",
          "--read-only",
          "--volume",
          `${invocation.cwd}:${invocation.cwd}:rw`,
          "--network=none",
          "--volume",
          `${shared}:${shared}:rw`,
          "--workdir",
          invocation.cwd,
          "node:lts",
          "git",
          "status",
        ],
        cwd: invocation.cwd,
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("wrapShell fails closed on Windows until an isolated backend exists", () => {
    expect(() =>
      wrapShell(
        { shell: "powershell.exe", command: "Write-Output unsafe", cwd: "C:\\work" },
        { enabled: true },
        "win32",
        none,
      ),
    ).toThrow(UnsupportedBackendError)
  })

  test("wrapShell turns a shell string into an argv invocation", () => {
    const wrapped = wrapShell(
      { shell: "/bin/bash", command: "echo hi", cwd: "/w" },
      {
        enabled: true,
        backend: "bwrap",
      },
      "linux",
      none,
    )
    expect(wrapped.args.slice(-6)).toEqual(["--chdir", "/w", "--", "/bin/bash", "-c", "echo hi"])
  })
})
