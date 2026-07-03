import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Server } from "../../src/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { Effect, Fiber } from "effect"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"
import { waitGlobalBusEvent } from "./global-bus"

void Log.init({ print: false })

function app() {
  return Server.Default().app
}

function waitDisposed(directory: string) {
  return waitGlobalBusEvent({
    message: "timed out waiting for instance disposal",
    predicate: (event) => event.payload.type === "server.instance.disposed" && event.directory === directory,
  })
}

const tmpdirEffect = (options: Parameters<typeof tmpdir>[0]) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("config HttpApi", () => {
  it.live(
    "serves config update through the default server app",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const disposed = yield* waitDisposed(tmp.path).pipe(Effect.forkScoped)

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              "x-opencode-directory": tmp.path,
            },
            body: JSON.stringify({ username: "patched-user", formatter: false, lsp: false }),
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        username: "patched-user",
        formatter: false,
        lsp: false,
      })
      yield* Fiber.join(disposed)
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "config.json")).json())).toMatchObject({
        username: "patched-user",
        formatter: false,
        lsp: false,
      })
    }),
  )

  it.live(
    "serves config with active provider model status",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({
        config: {
          formatter: false,
          lsp: false,
          provider: {
            omniroute: {
              models: {
                "gpt-4o": {
                  status: "active",
                },
              },
            },
          },
        },
      })

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        provider: {
          omniroute: {
            models: {
              "gpt-4o": {
                status: "active",
              },
            },
          },
        },
      })
    }),
  )

  it.live(
    "saves project markdown rules into novaway rules directory",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const disposed = yield* waitDisposed(tmp.path).pipe(Effect.forkScoped)

      const save = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/settings/rules/project/engineering", {
            method: "PUT",
            headers: {
              "content-type": "application/json",
              "x-opencode-directory": tmp.path,
            },
            body: JSON.stringify({
              description: "工程规则",
              trigger: "auto",
              content: "所有实现计划都必须写入 .novaway/plans。",
            }),
          }),
        ),
      )

      expect(save.status).toBe(200)
      yield* Fiber.join(disposed)
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, ".novaway", "rules", "engineering.md")).text())).toContain(
        "所有实现计划都必须写入 .novaway/plans。",
      )

      const list = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/settings/rules/project", {
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(list.status).toBe(200)
      const rules = (yield* Effect.promise(() => list.json())) as Array<{ content: string }>
      expect(rules).toMatchObject([
        {
          name: "engineering",
          data: {
            description: "工程规则",
            trigger: "auto",
          },
        },
      ])
      expect(rules[0].content.trim()).toBe("所有实现计划都必须写入 .novaway/plans。")
    }),
  )

  it.live(
    "saves project instruction into project root AGENTS.md",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const disposed = yield* waitDisposed(tmp.path).pipe(Effect.forkScoped)

      const save = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/settings/project-instruction", {
            method: "PUT",
            headers: {
              "content-type": "application/json",
              "x-opencode-directory": tmp.path,
            },
            body: JSON.stringify({
              content: "# AGENTS\n\nUse project-local instructions.",
            }),
          }),
        ),
      )

      expect(save.status).toBe(200)
      expect(yield* Effect.promise(() => save.json())).toMatchObject({
        name: "AGENTS.md",
        location: path.join(tmp.path, "AGENTS.md"),
        content: "# AGENTS\n\nUse project-local instructions.\n",
      })
      yield* Fiber.join(disposed)
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "AGENTS.md")).text())).toBe(
        "# AGENTS\n\nUse project-local instructions.\n",
      )
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, ".novaway", "AGENTS.md")).exists())).toBe(false)

      const get = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/settings/project-instruction", {
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(get.status).toBe(200)
      expect(yield* Effect.promise(() => get.json())).toMatchObject({
        name: "AGENTS.md",
        location: path.join(tmp.path, "AGENTS.md"),
        content: "# AGENTS\n\nUse project-local instructions.\n",
      })
    }),
  )

  it.live(
    "does not return deleted custom skills from stale runtime cache",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })

      yield* Effect.promise(() =>
        Bun.write(
          path.join(tmp.path, ".novaway", "skills", "custom-skill", "SKILL.md"),
          `---
name: custom-skill
description: Temporary skill
---

Temporary instructions.
`,
        ),
      )

      const beforeDelete = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/settings/skills", {
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(beforeDelete.status).toBe(200)
      const before = (yield* Effect.promise(() => beforeDelete.json())) as Array<{ name: string }>
      expect(before.some((item) => item.name === "custom-skill")).toBe(true)

      const deleteResponse = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/settings/skills/custom-skill", {
            method: "DELETE",
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(deleteResponse.status).toBe(200)

      const afterDelete = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/settings/skills", {
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(afterDelete.status).toBe(200)
      const after = (yield* Effect.promise(() => afterDelete.json())) as Array<{ name: string }>
      expect(after.some((item) => item.name === "custom-skill")).toBe(false)
    }),
  )

  it.live(
    "deletes editable agents with category paths",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const file = path.join(tmp.path, ".novaway", "agent", "godot", "godot-gameplay-scripter.md")

      yield* Effect.promise(() =>
        Bun.write(
          file,
          `---
description: Godot gameplay scripting specialist.
mode: subagent
---

Write Godot gameplay scripts.
`,
        ),
      )

      const beforeDelete = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/settings/agents", {
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(beforeDelete.status).toBe(200)
      const before = (yield* Effect.promise(() => beforeDelete.json())) as Array<{ name: string }>
      expect(before.some((item) => item.name === "godot/godot-gameplay-scripter")).toBe(true)

      const deleteResponse = yield* Effect.promise(() =>
        Promise.resolve(
          app().request(`/settings/agents/${encodeURIComponent("godot/godot-gameplay-scripter")}`, {
            method: "DELETE",
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(deleteResponse.status).toBe(200)
      expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
    }),
  )

  it.live(
    "finds project instruction using the same upward lookup as sessions",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      yield* Effect.promise(() => Bun.write(path.join(tmp.path, "AGENTS.md"), "# Root Instructions\n"))
      yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "src", "feature"), { recursive: true }))

      const get = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/settings/project-instruction", {
            headers: {
              "x-opencode-directory": path.join(tmp.path, "src", "feature"),
            },
          }),
        ),
      )

      expect(get.status).toBe(200)
      expect(yield* Effect.promise(() => get.json())).toMatchObject({
        name: "AGENTS.md",
        location: path.join(tmp.path, "AGENTS.md"),
        content: "# Root Instructions\n",
      })
    }),
  )
})
