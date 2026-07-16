# OpenCode monorepo

Default branch is `dev` (local `main` may not exist). Use `origin/dev` for diffs.
Bun 1.3+ monorepo with Turborepo v2.8. Package manager: `bun` (exact versions via catalog in root `package.json`).

## Commands

All from repo root unless noted.

| Command                                        | What                                       |
| ---------------------------------------------- | ------------------------------------------ |
| `bun dev`                                      | Start TUI (blocking; use `tmux`/`screen`)  |
| `bun lint`                                     | oxlint (w/ `typeAware: true`)              |
| `bun typecheck`                                | `bun turbo typecheck` across packages      |
| `bun dev serve`                                | Headless API server on :4096               |
| `bun dev web`                                  | Server + open web UI                       |
| `bun dev .`                                    | Run against opencode repo itself           |
| `./script/generate.ts`                         | Regenerate SDK + OpenAPI after API changes |
| `bun run --cwd packages/opencode test:httpapi` | HttpApi exerciser gates                    |

Tests cannot run from root (`bunfig.toml` guard `do-not-run-tests-from-root`). Run from package dir:

```
cd packages/opencode && bun test --timeout 30000
```

Fastest verification loop: `lint -> typecheck -> test`.

## Monorepo structure

21 packages under `packages/`. Key ones and their entrypoint:

| Package                | npm name              | What                                            |
| ---------------------- | --------------------- | ----------------------------------------------- |
| `packages/opencode`    | — (private)           | Core CLI/TUI/server (`src/index.ts`, yargs CLI) |
| `packages/core`        | `@opencode-ai/core`   | Shared utilities                                |
| `packages/llm`         | `@opencode-ai/llm`    | Effect Schema-first LLM core                    |
| `packages/app`         | `@opencode-ai/app`    | Web UI (SolidJS + Vite)                         |
| `packages/ui`          | `@opencode-ai/ui`     | Shared UI components (SolidJS)                  |
| `packages/desktop`     | `@novaway/desktop`    | Electron app wrapping web UI                    |
| `packages/sdk/js`      | `@opencode-ai/sdk`    | JS SDK (generated from OpenAPI)                 |
| `packages/plugin`      | `@opencode-ai/plugin` | Plugin system                                   |
| `packages/web`         | — (private)           | Landing site (Astro)                            |
| `packages/console/app` | — (private)           | Console web app                                 |

Infra: SST (Cloudflare home) in `infra/` + `sst.config.ts`.
Entrypoint paths: `packages/opencode/src/index.ts` is the main CLI.

## Per-package guidance

Read these before working in that area. Each has deep, package-specific context:

- `packages/opencode/AGENTS.md` — Drizzle SQLite/DB, Effect v4 patterns, module shape (no `export namespace`), InstanceState lifecycle, Effect services
- `packages/opencode/test/AGENTS.md` — test fixtures (`tmpdir`), Effect test patterns (`testEffect`, `it.live` vs `it.effect`), concurrency synchronization (avoid fixed `sleep`)
- `packages/opencode/test/server/AGENTS.md` — server/E2E test patterns
- `packages/opencode/src/server/routes/instance/httpapi/AGENTS.md` — HttpApiBuilder vs raw HttpRouter
- `packages/llm/AGENTS.md` — routes/protocols/providers architecture, cassette-based recorded tests
- `packages/app/AGENTS.md` — local web dev servers, SolidJS conventions, browser automation
- `packages/desktop/AGENTS.md` — Electron IPC (renderer calls `window.api`, main registers handlers in `ipc.ts`)

## Style guide

- Keep things in one function unless composable or reusable. Do not extract single-use helpers preemptively.
- Avoid `try`/`catch`. Avoid `any`. Use Bun APIs (e.g. `Bun.file()`).
- Rely on type inference; explicit annotations only for exports or clarity.
- Prefer functional array methods (`flatMap`, `filter`, `map`) with type guards on filter.
- In `packages/opencode/src/config`, follow self-export: `export * as ConfigAgent from "./agent"`.
- Use dot notation, not destructuring. Prefer `obj.a` over `const { a } = obj`.
- Prefer `const` over `let`; ternaries or early returns over reassignment.
- Avoid `else`; use early returns.
- Complex functions: happy path first, extract validation/edge cases into helpers below.

```ts
// Drizzle schema — snake_case so columns don't need redefinition
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})
```

## Effect v4 specifics

See `packages/opencode/AGENTS.md` for full reference. Non-obvious:

- `Effect.fork` / `Effect.forkDaemon` do **not** exist; use `Effect.forkIn(scope)`
- Use `Effect.void` not `Effect.succeed(undefined)`
- `Effect.fn("Domain.method")` for named/traced effects; `Effect.fnUntraced` for internal helpers
- `makeRuntime` from `src/effect/run-service.ts` for all services
- `InstanceState` (from `src/effect/instance-state.ts`) for per-directory state with auto-cleanup

## Testing

- Tests cannot run from repo root. Run from package dirs.
- Use `testEffect(...)` from `test/lib/effect.ts` for Effect service tests.
- `it.live(...)` for tests needing real time/fs/child-processes; `it.effect(...)` for `TestClock`/`TestConsole`.
- Never `Effect.sleep(N)` to wait for concurrent work. Use `pollWithTimeout`, `awaitWithTimeout`, `BackgroundJob.wait`, or `Deferred`.
- Prefer `Layer.mock` over hand-rolled stubs for partial service overrides.
- In `packages/llm`: `recordedTests(...)` with cassette replay for LLM integration tests (`RECORD=true` to refresh).
- In `packages/app`: Playwright e2e tests (`bun test:e2e:local`).

## Type checking

- Always `bun typecheck` from package dirs (uses `tsgo --noEmit` or `tsgo -b`), never `tsc`.
- oxlint config in `.oxlintrc.json` has `typeAware: true`.

## Build & generation

- Standalone binary: `bun run script/build.ts --single` from `packages/opencode`
- SDK build: `bun ./script/build.ts` from `packages/sdk/js`
- Desktop production: `bun run build && bun run package` from `packages/desktop`
- Generate SDK + OpenAPI after API changes: `./script/generate.ts` from root
- Generated sources: `packages/sdk/js/src/v2/gen/client/` (OpenAPI), `sdk.gen.ts` files, `packages/sdk/openapi.json`

## Misc

- Debug breakpoints: use `bun dev spawn` (not regular `bun dev`) — server runs in worker thread otherwise.
- `bun install` runs `postinstall` hook (`fix-node-pty` in `packages/opencode`) and `husky` (`prepare`).
- `packages/opencode/src/index.ts` has `#db` and `#pty` as conditional subpath imports (bun vs node).
- Oxlint ignore: `**/node_modules`, `**/dist`, `**/.build`, `**/.sst`, `**/*.d.ts`, `**/sdk.gen.ts`.
- Prettier: `semi: false`, `printWidth: 120`.
- Formatting command: `./script/format.ts`.
