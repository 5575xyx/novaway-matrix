import { describe, expect, test } from "bun:test"
import { UnsupportedBackendError, resolveBackend, wrap, wrapShell } from "@/sandbox/sandbox"

describe("sandbox", () => {
  const input = { command: "git", args: ["status"], cwd: "/workspace/project" }
  const none = () => false

  test("returns the original invocation when disabled or on Windows", () => {
    expect(wrap(input, {}, "linux", none)).toBe(input)
    expect(wrap({ ...input }, { enabled: true, backend: "bwrap" }, "win32", none)).toEqual(input)
  })

  test("auto resolves to an installed backend and fails when none exists", () => {
    expect(resolveBackend({ backend: "auto" }, "linux", (command) => command === "bwrap")).toBe("bwrap")
    expect(resolveBackend({ backend: "auto" }, "darwin", (command) => command === "sandbox-exec")).toBe("seatbelt")
    expect(() => resolveBackend({ backend: "auto" }, "linux", none)).toThrow(UnsupportedBackendError)
    expect(() => resolveBackend({ backend: "auto" }, "win32", none)).toThrow(UnsupportedBackendError)
  })

  test("rejects unavailable backends instead of running unsandboxed", () => {
    expect(() => wrap(input, { enabled: true, backend: "landlock" }, "linux", none)).toThrow(UnsupportedBackendError)
    expect(() => wrap(input, { enabled: true, backend: "bwrap" }, "darwin", none)).toThrow(UnsupportedBackendError)
    expect(() => wrap(input, { enabled: true, backend: "docker" }, "linux", none)).toThrow(UnsupportedBackendError)
  })

  test("wraps bwrap using a read-only root, writable workspace and denied network by default", () => {
    expect(wrap(input, { enabled: true, backend: "bwrap" }, "linux", none)).toEqual({
      command: "bwrap",
      args: [
        "--die-with-parent",
        "--new-session",
        "--ro-bind",
        "/",
        "/",
        "--bind",
        input.cwd,
        input.cwd,
        "--unshare-net",
        "--chdir",
        input.cwd,
        "--",
        "git",
        "status",
      ],
      cwd: input.cwd,
    })
  })

  test("allows network and extra writable paths only when configured", () => {
    expect(
      wrap(input, { enabled: true, backend: "bwrap", network: true, allow_paths: ["/shared"] }, "linux", none).args,
    ).toEqual([
      "--die-with-parent",
      "--new-session",
      "--ro-bind",
      "/",
      "/",
      "--bind",
      "/shared",
      "/shared",
      "--bind",
      input.cwd,
      input.cwd,
      "--chdir",
      input.cwd,
      "--",
      "git",
      "status",
    ])
  })

  test("wraps seatbelt with a write and network profile", () => {
    const wrapped = wrap(input, { enabled: true, backend: "seatbelt", allow_paths: ["/shared"] }, "darwin", none)
    expect(wrapped.command).toBe("sandbox-exec")
    expect(wrapped.args[0]).toBe("-p")
    expect(wrapped.args[1]).toContain("(deny file-write*)")
    expect(wrapped.args[1]).toContain('(allow file-write* (subpath "/workspace/project"))')
    expect(wrapped.args[1]).toContain('(allow file-write* (subpath "/shared"))')
    expect(wrapped.args[1]).toContain("(deny network*)")
    expect(wrapped.args.slice(-3)).toEqual(["--", "git", "status"])
  })

  test("wraps container arguments using configured image and mount policy", () => {
    expect(
      wrap(
        input,
        { enabled: true, backend: "docker", docker_image: "node:lts", allow_paths: ["/shared"] },
        "linux",
        none,
      ),
    ).toEqual({
      command: "docker",
      args: [
        "run",
        "--rm",
        "--read-only",
        "--volume",
        `${input.cwd}:${input.cwd}:rw`,
        "--network=none",
        "--volume",
        "/shared:/shared:rw",
        "--workdir",
        input.cwd,
        "node:lts",
        "git",
        "status",
      ],
      cwd: input.cwd,
    })
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
