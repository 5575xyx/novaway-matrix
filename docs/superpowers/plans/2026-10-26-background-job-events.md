# Background Job Event-Driven Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert BackgroundJob from pull-only (frontend polls every 2s) to event-driven push, so status-panel updates happen in real time and mirror ZCode's BackgroundTaskTracker pattern.

**Architecture:** Emit Bus events (`background.started` / `background.updated` / `background.completed`) from `packages/novaway/src/background/job.ts` at every lifecycle transition. The existing Bus → GlobalBus → SSE → `/global/event` pipeline automatically carries them to the frontend because `BusEvent.effectPayloads()` is already wired into `EventSchema`. The status panel keeps its initial GET (for snapshot + history) but re-fetches on each event instead of a fixed 2s tick.

**Tech Stack:** Effect v4 (`Effect.fn`, `Layer.effect`, `BusEvent.define`, `Schema`), SolidJS (`createStore`, `createEffect`), SDK regeneration via `./script/generate.ts`.

**Spec:** ZCode's BackgroundTaskTracker pattern described by the user: publish Started / Updated / Completed events; each shell command gets a backgroundTaskId; status panel subscribes to those events for real-time refresh.

## Global Constraints

- Effect v4 style: `Effect.fn("Domain.method")` for named effects, `Effect.fnUntraced` for internal helpers, no `Effect.fork` / `Effect.forkDaemon` (use `Effect.forkIn(scope)`), `Effect.void` over `Effect.succeed(undefined)`.
- Module shape: `BackgroundJob` follows the flat self-reexport pattern — no `export namespace` blocks.
- Bus event schemas must be `Schema.Struct` and typed at the definition site.
- Frontend rules: prefer `createStore` over multiple `createSignal`, use parallel tools where independent, don't restart the dev server when changing UI.
- Testing: never run tests from repo root; use `testEffect(...)`, `it.instance(...)` for instance-scoped tests; never use `Effect.sleep` to wait for concurrent work (use `pollWithTimeout` / `Deferred` / Bus subscriptions).
- Do NOT add `BackgroundEvent` cases to `applyDirectoryEvent` — background events need custom routing, see Task 4.
- Do NOT commit or push at any step. Commit only when the user explicitly says "commit" / "push".

## Review Focus

- **Bus event fanout cost.** Shell output can stream continuously. `background.update` is called per stdout chunk. If we publish `background.updated` on every call, a chatty command could flood SSE. Task 1 must include a decision about throttling — the plan's answer is "one event per `update()` call, but callers already batch output". Callers who stream every byte (shell's `onOutput`) must coalesce on the calling side, not the bus. Verify by inspecting `tool/shell.ts:697` and `background/watchers.ts:149,272`.
- **`finish()` is called from 4 paths** (`onSuccess`, `onFailure`, `cancel`, `restart cleanup`). All terminal states must emit exactly one `background.completed` event, never two, never zero. Test in Task 2 covers this.
- **`update()` only succeeds when job.status === "running"**. Terminal-state updates must be dropped silently — no `background.updated` event should leak after completion. Test in Task 2 covers this.
- **Schema parity between Bus event payload and SDK `BackgroundJobInfo`**. The event carries the same shape the frontend already parses. If they drift, the panel silently ignores events. Task 1 uses one shared `InfoSchema` and imports it in `groups/session.ts`.
- **Restart path**: `job.ts:173-186` marks stale rows as cancelled but does NOT call `finish` — no event is emitted for pre-restart zombies. That's intentional (there's no client to notify); verify the code doesn't silently change.

---

### Task 1: Define Bus events and emit them from `background/job.ts`

**Files:**

- Modify: `packages/novaway/src/background/job.ts`
- Create: `packages/novaway/src/background/job.sql.ts` — no change (schema already exists)
- Modify: `packages/novaway/src/server/routes/instance/httpapi/groups/session.ts` — reuse `InfoSchema` instead of the duplicated `BackgroundJobInfo` schema (optional refactor; keeps schema single-sourced)
- Test: `packages/novaway/test/background/job-events.test.ts` (new)

**Interfaces:**

- Consumes: `Bus.Service` (from `@/bus`), `BusEvent.define` (from `@/bus/bus-event`), `InstanceState` (from `@/effect/instance-state`).
- Produces:
  - `BackgroundJob.Event.Started: BusEvent.Definition<"background.started">` — properties `{ info: InfoSchema }`
  - `BackgroundJob.Event.Updated: BusEvent.Definition<"background.updated">` — properties `{ info: InfoSchema }`
  - `BackgroundJob.Event.Completed: BusEvent.Definition<"background.completed">` — properties `{ info: InfoSchema }`
  - `BackgroundJob.InfoSchema: Schema.Top` — Schema.Struct mirroring `Info` (id, type, title?, status, started_at, completed_at?, output?, error?, metadata?)

**Note on routing:** Events are directory-scoped (via Bus.Service → GlobalBus with `directory` tag). The frontend reducer routes by looking up the session that owns a job (`metadata.sessionId ?? metadata.parentSessionId`). See Task 4.

- [ ] **Step 1: Write the failing event-emission test**

Create `packages/novaway/test/background/job-events.test.ts`:

```ts
import { describe, expect } from "bun:test"
import { Deferred, Effect } from "effect"
import { BackgroundJob } from "@/background/job"
import { Bus } from "@/bus"
import { testEffect } from "../lib/effect"

const it = testEffect(BackgroundJob.defaultLayer)

describe("background.job events", () => {
  it.instance("emits background.started when a job is created", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const bus = yield* Bus.Service
      const seen = yield* Deferred.make<Bus.Payload<typeof BackgroundJob.Event.Started>>()

      const unsub = yield* bus.subscribeCallback(BackgroundJob.Event.Started, (e) => Deferred.succeedUnsafe(seen, e))
      yield* Effect.addFinalizer(() => unsub.pipe(Effect.ignore))

      const job = yield* jobs.start({ type: "test", run: Effect.never })

      const event = yield* Deferred.await(seen)
      expect(event.properties.info.id).toBe(job.id)
      expect(event.properties.info.status).toBe("running")

      yield* jobs.cancel(job.id)
    }),
  )

  it.instance("emits background.updated when the run pushes progress", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const bus = yield* Bus.Service
      const seen = yield* Deferred.make<{ output: string }>()

      const unsub = yield* bus.subscribeCallback(BackgroundJob.Event.Updated, (e) =>
        Deferred.succeedUnsafe(seen, { output: e.properties.info.output ?? "" }),
      )
      yield* Effect.addFinalizer(() => unsub.pipe(Effect.ignore))

      const job = yield* jobs.start({ type: "test", run: Effect.never })
      yield* jobs.update(job.id, { output: "hello" })

      expect((yield* Deferred.await(seen)).output).toBe("hello")

      yield* jobs.cancel(job.id)
    }),
  )

  it.instance("emits background.updated only while the job is still running", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const bus = yield* Bus.Service
      let updatedCount = 0

      const unsub = yield* bus.subscribeCallback(BackgroundJob.Event.Updated, () => {
        updatedCount += 1
      })
      yield* Effect.addFinalizer(() => unsub.pipe(Effect.ignore))

      const job = yield* jobs.start({ type: "test", run: Effect.succeed("done") })
      yield* jobs.wait({ id: job.id })
      yield* jobs.update(job.id, { output: "after-the-fact" })

      // Only the pre-completion update (if any) counts; nothing after finish.
      expect(updatedCount).toBe(0)
    }),
  )

  it.instance("emits background.completed exactly once for each terminal state", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const bus = yield* Bus.Service
      const scenarios: Array<{ name: string; run: Effect.Effect<string, unknown>; expect: string }> = [
        { name: "completed", run: Effect.succeed("ok"), expect: "completed" },
        { name: "error", run: Effect.fail(new Error("boom")), expect: "error" },
      ]
      for (const scenario of scenarios) {
        const latch = yield* Deferred.make<{ info: { id: string; status: string } }>()
        const unsub = yield* bus.subscribeCallback(BackgroundJob.Event.Completed, (e) => {
          Deferred.succeedUnsafe(latch, { info: e.properties.info })
        })

        const job = yield* jobs.start({ type: "test", run: scenario.run })
        const done = yield* Deferred.await(latch)

        expect(done.info.status).toBe(scenario.expect)
        expect(done.info.id).toBe(job.id)

        yield* unsub.pipe(Effect.ignore)
      }

      // Cancel path
      const latch = yield* Deferred.make<{ info: { status: string } }>()
      const unsub = yield* bus.subscribeCallback(BackgroundJob.Event.Completed, (e) => {
        Deferred.succeedUnsafe(latch, { info: e.properties.info })
      })
      const job = yield* jobs.start({ type: "test", run: Effect.never })
      yield* jobs.cancel(job.id)
      const done = yield* Deferred.await(latch)
      expect(done.info.status).toBe("cancelled")
      yield* unsub.pipe(Effect.ignore)
    }),
  )
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run from `packages/novaway`:

```
bun test --timeout 30000 test/background/job-events.test.ts
```

Expected: FAIL — `BackgroundJob.Event` is undefined, so typecheck fails first. Do `bun typecheck` too.

- [ ] **Step 3: Implement events in `job.ts`**

Edit `packages/novaway/src/background/job.ts`:

1. Add imports near the top:

   ```ts
   import { Bus } from "@/bus"
   import { BusEvent } from "@/bus/bus-event"
   import { Schema } from "effect" // already imported via Effect
   ```

   (`Schema` is already imported — check first.)

2. Add a shared `InfoSchema` right after the `Info` type definition (around line 24):

   ```ts
   export const InfoSchema = Schema.Struct({
     id: Schema.String,
     type: Schema.String,
     title: Schema.optional(Schema.String),
     status: Schema.Literals<Status>(["running", "completed", "error", "cancelled"]),
     started_at: Schema.Number,
     completed_at: Schema.optional(Schema.Number),
     output: Schema.optional(Schema.String),
     error: Schema.optional(Schema.String),
     metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
   }).annotate({ identifier: "BackgroundJobInfo" })
   ```

   (This is the same shape as the current `BackgroundJobInfo` in `groups/session.ts:64-74` — Task 1b reuses it there.)

3. Define the event group below `InfoSchema`:

   ```ts
   export const Event = {
     Started: BusEvent.define("background.started", Schema.Struct({ info: InfoSchema })),
     Updated: BusEvent.define("background.updated", Schema.Struct({ info: InfoSchema })),
     Completed: BusEvent.define("background.completed", Schema.Struct({ info: InfoSchema })),
   }
   ```

4. Inside the `layer` `Effect.gen`, right at the top (after `const state = yield* InstanceState.make(...)`), add:

   ```ts
   const bus = yield * Bus.Service
   ```

5. Change the `layer` type signature so Effect knows about the dependency. The current code has `Layer.effect(Service, Effect.gen(...))` with no explicit type — Effect infers. Verify with typecheck; if inference gets stuck, add:

   ```ts
   export const layer: Layer.Layer<Service, never, Bus.Service> = Layer.effect(...)
   ```

6. Update `defaultLayer` at line 374 to provide Bus:

   ```ts
   export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))
   ```

7. Inside `finish()` (around line 220-222), after persist and Deferred resolution, publish the terminal event:

   ```ts
   if (result.info) {
     yield * Effect.sync(() => persist(result.info!))
     yield * bus.publish(Event.Completed, { info: result.info })
   }
   if (result.info && result.done) yield * Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
   ```

8. Inside `update()` (around line 280-281), publish `background.updated` after the running-status guard succeeds:

   ```ts
   if (result) {
     yield * Effect.sync(() => persist(result))
     yield * bus.publish(Event.Updated, { info: result })
   }
   return result
   ```

   (Because `update()` returns `undefined` when the job is not running, `if (result)` naturally drops terminal updates.)

9. Inside `start()` (around line 329), after persist, publish `background.started`:
   ```ts
   yield * Effect.sync(() => persist(result))
   yield * bus.publish(Event.Started, { info: result })
   return result
   ```

- [ ] **Step 4: Update `groups/session.ts` to reuse the shared schema (optional but recommended)**

Edit `packages/novaway/src/server/routes/instance/httpapi/groups/session.ts:64-74` so `BackgroundJobInfo` becomes a re-export from job.ts:

```ts
import { InfoSchema as BackgroundJobInfoSchema } from "@/background/job"
export const BackgroundJobInfo = BackgroundJobInfoSchema
```

Verify no circular imports: `job.ts` does not import from `groups/session.ts`.

- [ ] **Step 5: Run the event-emission tests**

```
cd packages/novaway && bun test --timeout 30000 test/background/job-events.test.ts
```

Expected: PASS (all four tests).

- [ ] **Step 6: Run the existing background job tests to catch regressions**

```
cd packages/novaway && bun test --timeout 30000 test/background/
```

Expected: PASS. If `test/background/job.test.ts` fails because it uses `testEffect(BackgroundJob.defaultLayer)` and now needs Bus — verify `BackgroundJob.defaultLayer` already includes `Layer.provide(Bus.layer)` from step 6 above. It should be fine because `defaultLayer` includes Bus.

- [ ] **Step 7: Typecheck the package**

```
cd packages/novaway && bun typecheck
```

Expected: PASS. If there's an inference issue with `layer`, add the explicit `Layer.Layer<Service, never, Bus.Service>` type annotation from step 5.

- [ ] **Step 8: Regenerate SDK**

```
./script/generate.ts
```

Expected: succeeds. The generated `packages/sdk/openapi.json` now contains `background.started`, `background.updated`, `background.completed` inside the `Event` union schema. Verify:

```
grep -c "background.started" packages/sdk/openapi.json
```

Should be ≥ 1.

- [ ] **Step 9: DO NOT COMMIT** — user did not ask for commits.

---

### Task 2: Frontend event-reducer case for background job events

**Files:**

- Modify: `packages/app/src/context/global-sync/types.ts` — add `backgroundJob` to `State`
- Modify: `packages/app/src/context/global-sync/event-reducer.ts` — add `background.started` / `updated` / `completed` cases
- Modify: `packages/app/src/context/global-sync/session-cache.ts` — include `backgroundJob` in `SessionCache` and drop on cleanup
- Modify: `packages/app/src/context/global-sync.tsx` — wire `backgroundJob` cache to child-store (only if needed; see step 2)
- Test: `packages/app/src/context/global-sync/event-reducer.test.ts` — extend tests

**Interfaces:**

- Consumes: SDK-generated `BackgroundJobInfo` type (already exists in `packages/sdk/js/src/v2/client`).
- Produces: `State.backgroundJob: { [sessionID: string]: BackgroundJobInfo[] }` — keyed by the session that owns the job (from `info.metadata.sessionId ?? info.metadata.parentSessionId`).

**Routing design decision:** The store is per-directory (child-store), keyed by session. To avoid re-fetching on every event and to keep the "team member job hidden" logic consistent, we index by sessionID. The event-reducer extracts the sessionID from `info.metadata`. If neither `sessionId` nor `parentSessionId` is present, skip the event (rare edge case; will be caught by the next poll).

- [ ] **Step 1: Add the state field**

Edit `packages/app/src/context/global-sync/types.ts`. Import `BackgroundJobInfo` from SDK client and add to `State`:

```ts
import type { ..., BackgroundJobInfo } from "@novaway/sdk/v2/client"

export type State = {
  // ... existing fields ...
  backgroundJob: {
    [sessionID: string]: BackgroundJobInfo[]
  }
  // ...
}
```

- [ ] **Step 2: Update session-cache drop**

Edit `packages/app/src/context/global-sync/session-cache.ts`:

```ts
import type { BackgroundJobInfo, ... } from "@novaway/sdk/v2/client"

type SessionCache = {
  // ... existing ...
  backgroundJob: Record<string, BackgroundJobInfo[] | undefined>
}

export function dropSessionCaches(store: SessionCache, sessionIDs: Iterable<string>) {
  // ... existing ...
  for (const sessionID of stale) {
    // ... existing deletes ...
    delete store.backgroundJob[sessionID]
  }
}
```

- [ ] **Step 3: Write the failing event-reducer test**

Append to `packages/app/src/context/global-sync/event-reducer.test.ts`:

```ts
describe("applyDirectoryEvent background job", () => {
  const job = (input: { id: string; status: "running" | "completed" | "error" | "cancelled"; output?: string }) =>
    ({
      id: input.id,
      type: "shell",
      status: input.status,
      started_at: 1,
      output: input.output,
      metadata: { sessionId: "sess-a" },
    }) as BackgroundJobInfo

  test("routes background.started to the session that owns the job", () => {
    const [store, setStore] = createStore(baseState())
    applyDirectoryEvent({
      event: { type: "background.started", properties: { info: job({ id: "job_1", status: "running" }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.backgroundJob["sess-a"]?.map((j) => j.id)).toEqual(["job_1"])
  })

  test("background.completed updates an existing entry in place", () => {
    const [store, setStore] = createStore(baseState())
    applyDirectoryEvent({
      event: { type: "background.started", properties: { info: job({ id: "job_1", status: "running" }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: {
        type: "background.completed",
        properties: { info: job({ id: "job_1", status: "completed", output: "done" }) },
      },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.backgroundJob["sess-a"]?.[0]?.status).toBe("completed")
    expect(store.backgroundJob["sess-a"]?.[0]?.output).toBe("done")
  })

  test("background.updated refreshes output without duplicating", () => {
    const [store, setStore] = createStore(baseState())
    applyDirectoryEvent({
      event: { type: "background.started", properties: { info: job({ id: "job_1", status: "running" }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: {
        type: "background.updated",
        properties: { info: job({ id: "job_1", status: "running", output: "line 1" }) },
      },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: {
        type: "background.updated",
        properties: { info: job({ id: "job_1", status: "running", output: "line 2" }) },
      },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.backgroundJob["sess-a"]).toHaveLength(1)
    expect(store.backgroundJob["sess-a"]?.[0]?.output).toBe("line 2")
  })

  test("drops background job cache when the owning session is dropped", () => {
    const [store, setStore] = createStore(baseState())
    applyDirectoryEvent({
      event: { type: "background.started", properties: { info: job({ id: "job_1", status: "running" }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    cleanupDroppedSessionCaches(store, setStore, [])
    expect(store.backgroundJob["sess-a"]).toBeUndefined()
  })
})
```

- [ ] **Step 4: Run the new test and confirm it fails**

```
cd packages/app && bun test --timeout 30000 src/context/global-sync/event-reducer.test.ts
```

Expected: FAIL (unknown event types; backgroundJob undefined).

- [ ] **Step 5: Add reducer cases**

Edit `packages/app/src/context/global-sync/event-reducer.ts`. Import `BackgroundJobInfo` and `Binary` is already imported.

Extract a helper right above `applyDirectoryEvent`:

```ts
const jobSessionKey = (info: BackgroundJobInfo): string | undefined => {
  const meta = info.metadata ?? {}
  const value = meta.sessionId ?? meta.parentSessionId
  return typeof value === "string" && value ? value : undefined
}

const upsertBackgroundJob = (store: Store<State>, setStore: SetStoreFunction<State>, info: BackgroundJobInfo) => {
  const key = jobSessionKey(info)
  if (!key) return
  const list = store.backgroundJob[key]
  if (!list) {
    setStore("backgroundJob", key, [info])
    return
  }
  const result = Binary.search(list, info.id, (j) => j.id)
  if (result.found) {
    setStore("backgroundJob", key, result.index, reconcile(info))
    return
  }
  setStore(
    "backgroundJob",
    key,
    produce((draft) => {
      draft.splice(result.index, 0, info)
    }),
  )
}
```

Add cases inside the `switch (event.type)` in `applyDirectoryEvent`:

```ts
case "background.started":
case "background.updated":
case "background.completed": {
  const info = (event.properties as { info: BackgroundJobInfo }).info
  upsertBackgroundJob(input.store, input.setStore, info)
  break
}
```

- [ ] **Step 6: Add a `setSessionBackgroundJob` cleanup hook (optional but clean)**

Similar to `setSessionTodo`, we want session delete to also drop the todo cache AND background job cache. Currently `dropSessionCaches` is called by `cleanupDroppedSessionCaches` and handles backgroundJob (from step 2). This is enough. Skip this step unless tests still fail.

- [ ] **Step 7: Run the tests**

```
cd packages/app && bun test --timeout 30000 src/context/global-sync/
```

Expected: PASS for `event-reducer.test.ts`. Existing tests should be unaffected.

- [ ] **Step 8: Typecheck app**

```
cd packages/app && bun typecheck
```

Expected: PASS.

---

### Task 3: Rewire the background status panel to consume events

**Files:**

- Modify: `packages/app/src/pages/session/status-panel/background-section.tsx` — swap 2s polling for event-driven updates; keep initial GET for bootstrap and for catching jobs started before the panel mounted.

**Interfaces:**

- Consumes: `useGlobalSync().data` / `useGlobalSync().child(directory)` for the `backgroundJob` cache; the existing `sdk.client.session.background` API for initial snapshot + fallback; `useSDK()` unchanged.
- Produces: Same `useBackgroundSection(sessionID, hiddenSessionIDs?)` signature. No public API change.

- [ ] **Step 1: Read the current implementation and note the two data paths**

The panel has:

- **Path A — data:** `load()` fetches `sdk.client.session.background(...)` every 2000ms and every time `sessionID()` changes.
- **Path B — clock:** 1s tick only while a job is `running` (updates `store.now`).

After this task, Path A becomes event-driven with a fallback poll; Path B is unchanged.

- [ ] **Step 2: Fetch once on mount/session-change, then subscribe to events**

Edit `packages/app/src/pages/session/status-panel/background-section.tsx`. Key changes:

1. Import `useGlobalSync`:

   ```ts
   import { useGlobalSync } from "@/context/global-sync"
   ```

2. Replace the fixed `setInterval(..., 2000)` block with an event subscription. The panel already knows `directory` via `useSDK().directory` (used in `load()`), so we can look up the child store:

   ```ts
   const sync = useGlobalSync()
   const directory = sdk.directory

   // Access the child store for this directory.
   const [childStore] = createMemo(() => {
     const key = directoryKey(directory) // from utils
     return children.peek(key) ?? children.child(directory)
   })
   ```

   Wait — `children` is not exposed via `useGlobalSync()`. Check: `useGlobalSync()` returns `{ data, set, child, peek, ... }`. So we can call `sync.peek(key)` or `sync.child(directory)`.

   Actually, checking `global-sync.tsx:461-488`, the returned object has `child` and `peek` methods. Good.

3. Replace the polling `load()` timer with:

   ```ts
   // On session change, do a full refresh once to pick up jobs started
   // before the panel mounted.
   createEffect(
     on(sessionID, (id) => {
       setStore("jobs", [])
       if (id) load()
     }),
   )

   // Then let events drive updates for the lifetime of the session.
   // The child store keeps a session-scoped list of background jobs
   // (backgroundJob[sessionId]), but the HTTP panel filters by
   // parentSessionId OR sessionId. To avoid duplicating that filter,
   // on any background event we just re-fetch. This is the pragmatic
   // middle ground: events push us to the server, server returns
   // the session-filtered list, no re-parsing.
   const unsub = globalSDK.event.on(directory, (event) => {
     if (
       event.type === "background.started" ||
       event.type === "background.updated" ||
       event.type === "background.completed"
     ) {
       // Only re-fetch when the event's job belongs to the current session.
       const props = event.properties as { info?: { metadata?: Record<string, unknown> } }
       const info = props.info
       const meta = info?.metadata ?? {}
       const owns = meta.sessionId === sessionID() || meta.parentSessionId === sessionID()
       if (owns) load()
     }
   })
   onCleanup(unsub)
   ```

   Where `globalSDK` comes from: `const globalSDK = useGlobalSDK()`.

4. Remove the `setInterval(load, 2000)` timer. Keep the `clock` (1s `now` update) since it's cheap and only runs when a job is running.

- [ ] **Step 3: Keep the clock logic intact**

The `clock` `setInterval` at lines 104-119 updates `store.now` every second while any job is running. That stays. The outer 2s poll is what we remove.

- [ ] **Step 4: Manual UI verification (dev servers)**

Per `packages/app/AGENTS.md`, do not restart dev servers. The user will start them and verify. Add a note in the PR/commit message:

> Verify: open a session, run a shell command with `background: true` (or run `sleep 5` in foreground — now also creates a job), and confirm the panel updates within 100ms instead of ~2s.

- [ ] **Step 5: Typecheck and lint**

```
cd packages/app && bun typecheck && bun lint
```

Expected: PASS.

- [ ] **Step 6: Regression check — kill the panel and reopen while a job is running**

The bootstrap path:

- Panel mounts → `sessionID()` set → `load()` fires → GET returns running job → panel shows it.
- Then events keep it fresh.

Verify by reading through the code that both `createEffect(on(sessionID, ...))` and the event subscription fire on initial mount.

- [ ] **Step 7: Verify no orphan subscriptions**

`onCleanup(unsub)` runs when the component unmounts. `useGlobalSDK()` returns a stable emitter binding, so we're only adding/removing a single listener. If `directory` changes between mounts, the previous listener is removed (it was registered with the old directory).

---

### Task 4: Regression tests and end-to-end verification

**Files:**

- No source changes. Only run existing test suites and verify.

**Verification checklist:**

- [ ] **Step 1: Full backend test suite**

```
cd packages/novaway && bun test --timeout 30000
```

Expected: PASS. If any failure mentions background events not being published, or a service now needing `Bus.Service` where it didn't before, fix the layer wiring.

- [ ] **Step 2: Full frontend test suite**

```
cd packages/app && bun test --timeout 30000
```

Expected: PASS. The event-reducer tests and any snapshot tests that include `State` should still pass.

- [ ] **Step 3: Lint + typecheck across monorepo**

```
bun lint
bun typecheck
```

Expected: PASS.

- [ ] **Step 4: Manual SSE smoke test**

Have the user run:

```
# Terminal 1 — start the API server
cd packages/novaway && NOVAWAY_SERVER_PASSWORD=x bun dev serve --port 4096

# Terminal 2 — watch events
curl -N http://localhost:4096/global/event
```

Then in another terminal, drive a session that runs a shell command. Observe `background.started`, `background.updated`, `background.completed` events flow through with the correct `directory` tag.

- [ ] **Step 5: Report results to user; do not commit**

---

## Post-plan notes

- **ZCode fidelity:** This plan achieves the event-driven push (the core ZCode trait). It does NOT replicate ZCode's dedicated `BackgroundTaskTracker` class or its 1s polling for terminal states, because NovaWay already has `BackgroundJob.wait()` for internal callers and SSE for external ones. If the user asks for the tracker class later, that's a separate refactor.
- **Backwards compatibility:** All existing callers of `BackgroundJob.start/update/cancel/wait/list/get` continue to work — the events are additive. Existing 2s polling path is replaced but the HTTP API remains unchanged.
- **Testing gaps not covered:** (a) restart-during-job path (existing behavior; no event is emitted by design because there's no active client); (b) multi-directory fanout (only the owning directory gets the event — that's what Bus.Service does today); (c) permission/UI state interaction (out of scope).
