# OS command sandbox

Opt-in, disabled by default. When enabled, model-issued shell commands run inside
an OS-level sandbox instead of the bare user shell.

```jsonc
// novaway.json
{
  "sandbox": {
    "enabled": true,
    "backend": "auto", // auto | bwrap | landlock | seatbelt | docker | podman
    "network": false, // network is denied unless true
    "allow_paths": ["/home/me/.cache"], // extra writable paths
    "docker_image": "node:22", // required for docker/podman
  },
}
```

## Backends

| Backend    | Platform | Writes                                    | Network                              |
| ---------- | -------- | ----------------------------------------- | ------------------------------------ |
| `bwrap`    | Linux    | project cwd + `allow_paths`               | denied by default                    |
| `seatbelt` | macOS    | project cwd + `allow_paths`               | denied by default                    |
| `docker`   | Linux    | project cwd mounted rw, root fs read-only | denied by default (`--network=none`) |
| `podman`   | Linux    | same as docker                            | same as docker                       |
| `landlock` | Linux    | not wired (needs a helper binary)         | —                                    |
| `auto`     | any      | picks bwrap (Linux) / seatbelt (macOS)    | same as the picked backend           |

`auto` never means "run unconfined": if no backend is installed, the command is
rejected with an error instead of silently running unsandboxed. On bwrap, the root
filesystem is exposed read-only and the workspace plus `allow_paths` are writable;
Seatbelt denies writes outside those paths but starts from its default read policy;
Docker/Podman expose a read-only container root and explicitly mounted writable paths.
`allow_paths` grants read/write access, not a narrow write-only capability. These
backends do not currently promise that all host files are unreadable.

## What is wrapped

- `shell` tool commands (the main spawn point).
- `run_verification` commands.
- Team command verifier, including arena `verify_command`.

## What is intentionally not wrapped

- Hook commands (`hook/exec.ts`). Hooks are user-authored config that frequently
  shells out to formatters/linters with their own environment assumptions; they
  already run under the user's shell and are not model-authored.
- Python venv bootstrap (`python/venv.ts`). It downloads `uv` and installs
  packages into NovaWay's own data directory; wrapping it would break the
  installer's need to write outside the project.
- Non-shell tools that never spawn a process.

If you need these covered, mirror the `Sandbox.wrapShell` call in `src/verify/runner.ts`.

## Windows

Windows has no verified OS-level sandbox backend wired here. If sandboxing is enabled,
commands are rejected instead of running unconfined; use a supported Linux/macOS host
or disable the setting explicitly in Settings → Automation → Command OS Sandbox, or set
`"sandbox": { "enabled": false }` in the applicable `novaway.json` / `novaway.jsonc`.
A native AppContainer probe on Windows 10 Home confirmed
an AppContainer token and Job Object process management, but the process could still read
`C:\Windows\win.ini`; this does not meet NovaWay's host-file isolation requirement.
Windows Sandbox is not a general fallback: Microsoft documents that it is unavailable on Windows Home,
starts with networking enabled by default, and offers mapped-folder configuration rather than a verified
per-command contract for this runner. Docker Sandboxes are also not a fallback for the supported Windows
10 environment: Docker's local sandbox requirements specify Windows 11 and Windows Hypervisor Platform.
Their direct workspace mount is read-write, while clone mode exposes the Git root read-only (including
untracked and ignored files), so neither mode satisfies this runner's explicit path visibility contract.
AppContainer access also depends on both capability SIDs and each resource's DACL; regular AppContainers
retain access to some system resources. See the [Windows Sandbox requirements](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/),
[AppContainer security model](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer),
and [Docker Sandboxes installation requirements](https://docs.docker.com/ai/sandboxes/install/).
No helper is shipped. Real Windows support requires a backend with validated file, network,
allow-path, and process-tree boundaries plus Windows integration tests before it can be enabled.

## Verification status

The argv construction is covered by unit tests with an injected platform/probe
(`packages/novaway/test/sandbox/sandbox.test.ts`). Windows shell and PowerShell tests verify
that enabling the sandbox rejects commands without invoking the host shell when no verified
backend is available (`packages/novaway/test/tool/shell.test.ts` and
`packages/novaway/test/tool/powershell.test.ts`). The team command verifier timeout test also
checks that a child process is terminated on Windows; this tests process cleanup only, not a
sandbox boundary. The general unit-test workflow runs these tests on its Windows runner, but that
runner is not configured as a Windows Sandbox or Hyper-V isolation environment. **Real Windows
isolation is not verified and no helper is shipped.** Windows argv routing, fail-closed behavior,
and ordinary process-tree cleanup do not constitute evidence of sandboxed file, network,
allow-path, or process-tree isolation. Linux/macOS real isolation still needs the relevant host:

```bash
# Linux (from packages/novaway)
bwrap --version
bun test test/sandbox

# macOS
sandbox-exec -p '(version 1)(allow default)' -- true
```
