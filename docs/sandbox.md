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
rejected with an error instead of silently running unsandboxed.

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

Windows has no equivalent OS sandbox wired here. Enabling `sandbox` on Windows
logs a warning and commands run with only permission rules — the config is not
silently ignored, but it also provides no isolation.

## Verification status

The argv construction is covered by unit tests with an injected platform/probe
(`packages/novaway/test/sandbox/sandbox.test.ts`). **Real isolation is not
verified on this Windows machine** — it needs a Linux or macOS host:

```bash
# Linux
bwrap --version
cd packages/novaway && bun test test/sandbox

# macOS
sandbox-exec -p '(version 1)(allow default)' -- true
```
