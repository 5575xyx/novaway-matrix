import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { Config } from "../../src/config/config"
import { Memory } from "../../src/memory/service"
import { ProjectID } from "../../src/project/schema"
import { ProjectTable } from "../../src/project/project.sql"
import { Dream } from "../../src/session/dream"
import * as DreamState from "../../src/session/dream-state"
import { Distill } from "../../src/session/distill"
import { planDrafts } from "../../src/session/distill"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Session } from "../../src/session/session"
import { SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

function seedProjectID(id: ProjectID) {
  Database.use((db) => db.insert(ProjectTable).values({ id, worktree: "", sandboxes: [] }).onConflictDoNothing().run())
}

function seedSession(id: string, projectID: ProjectID) {
  const sessionID = SessionID.make(id)
  Database.use((db) =>
    db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: projectID,
        slug: id,
        directory: "",
        title: id,
        version: "test",
      })
      .onConflictDoNothing()
      .run(),
  )
  return sessionID
}

const configWithMemory = Layer.mock(Config.Service, {
  get: () =>
    Effect.succeed({
      memory: { embedding_mode: "off", global_enabled: true, project_enabled: true },
    } as Config.Info),
})

const distillIt = testEffect(Layer.mergeAll(Distill.defaultLayer, Memory.defaultLayer, configWithMemory))

describe("distill planning", () => {
  test("dedupes identical content, updates by factKey and adds the rest", () => {
    const decisions = planDrafts({
      drafts: [
        { content: "  Prefer  tabs  ", tags: [] },
        { content: "Prefer tabs", tags: [] },
        { content: "Default to pnpm", tags: [], factKey: "package-manager" },
        { content: "默认使用 yarn", tags: [] },
      ],
      existing: [
        { id: "mem_a" as never, content: "prefer tabs", scope: "project", target: "memory" },
        {
          id: "mem_b" as never,
          content: "Default to npm",
          factKey: "package-manager",
          scope: "project",
          target: "memory",
        },
      ],
    })

    expect(decisions.map((item) => item.op)).toEqual(["dedupe", "update", "add"])
    expect(decisions[0].existingID).toBe("mem_a" as never)
    expect(decisions[1].existingID).toBe("mem_b" as never)
    expect(decisions[1].before).toBe("Default to npm")
  })
})

describe("dream state", () => {
  test("counts turns, gates on hours and only hands the lock to one owner", () => {
    const projectID = ProjectID.make("project-dream-state")
    seedProjectID(projectID)
    const now = 1_700_000_000_000

    expect(DreamState.due({ projectID, interval: 2, now })).toBe(false)
    expect(DreamState.due({ projectID, interval: 2, now })).toBe(true)
    expect(DreamState.ready({ projectID, minHours: 24, now })).toBe(true)

    const owner = DreamState.tryLock({ projectID, now })
    expect(owner).toBeString()
    expect(DreamState.tryLock({ projectID, now })).toBeUndefined()

    DreamState.finish({ projectID, owner: owner!, now, cursorAt: now })
    expect(DreamState.read(projectID)?.lastRunAt).toBe(now)
    expect(DreamState.read(projectID)?.lockOwner).toBeUndefined()
    expect(DreamState.ready({ projectID, minHours: 24, now: now + 3_600_000 })).toBe(false)
    expect(DreamState.ready({ projectID, minHours: 24, now: now + 25 * 3_600_000 })).toBe(true)
  })

  test("a failed run releases the lock without advancing last_run_at", () => {
    const projectID = ProjectID.make("project-dream-state-failure")
    seedProjectID(projectID)
    const now = 1_700_000_100_000

    const owner = DreamState.tryLock({ projectID, now })
    DreamState.release({ projectID, owner: owner!, now })
    expect(DreamState.read(projectID)?.lockOwner).toBeUndefined()
    expect(DreamState.read(projectID)?.lastRunAt).toBeUndefined()
  })
})

describe("distill apply", () => {
  distillIt.live("writes through the review pipeline and records an audit trail", () =>
    Effect.gen(function* () {
      const projectID = ProjectID.make("project-distill-apply")
      seedProjectID(projectID)
      const sessionID = seedSession("ses-distill-apply", projectID)
      const distill = yield* Distill.Service

      const audits = yield* distill.applyDrafts({
        projectID,
        sessionID,
        includeGlobal: false,
        decisions: [
          {
            draft: { content: "Always run focused tests after edits", tags: ["procedure"], confidence: 0.95 },
            op: "add",
          },
          {
            draft: { content: "Always run focused tests after edits", tags: ["procedure"], confidence: 0.95 },
            op: "dedupe",
            existingID: "mem_none" as never,
          },
        ],
      })

      expect(audits).toHaveLength(2)
      expect(audits[0].op).toBe("add")
      expect(audits[0].state).toBe("applied")
      expect(audits[0].memoryID).toBeDefined()
      expect(audits[1].op).toBe("dedupe")

      const memory = yield* Memory.Service
      const list = yield* memory.list({ projectID })
      expect(list.some((item) => item.content === "Always run focused tests after edits")).toBe(true)
    }),
  )

  distillIt.live("rolls back applied additions and restores the superseded memory", () =>
    Effect.gen(function* () {
      const projectID = ProjectID.make("project-distill-rollback")
      seedProjectID(projectID)
      const sessionID = seedSession("ses-distill-rollback", projectID)
      const memory = yield* Memory.Service
      const distill = yield* Distill.Service

      const old = yield* memory.add({
        projectID,
        sessionID,
        content: "Use spaces for indentation",
        factKey: "indentation",
        scope: "project",
      })
      const audits = yield* distill.applyDrafts({
        projectID,
        sessionID,
        includeGlobal: false,
        decisions: [
          {
            draft: { content: "Use tabs for indentation", tags: ["procedure"], confidence: 0.95 },
            op: "update",
            existingID: old.id,
            before: old.content,
            factKey: "indentation",
          },
          {
            draft: { content: "Never commit secrets", tags: ["lesson"], confidence: 0.95 },
            op: "add",
          },
        ],
      })
      expect(audits.map((item) => item.state)).toEqual(["applied", "applied"])

      const added = (yield* memory.list({ projectID })).find((item) => item.content === "Never commit secrets")
      expect(added).toBeDefined()

      const rolled = yield* distill.rollback({ audits })
      expect(rolled).toHaveLength(2)

      const after = yield* memory.list({ projectID })
      expect(after.some((item) => item.content === "Never commit secrets")).toBe(false)
      expect(after.some((item) => item.content === "Use spaces for indentation")).toBe(true)
    }),
  )
})

const dreamCfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: { apiKey: "test-key", baseURL: "http://localhost:1/v1" },
    },
  },
}

function configFor(url: string) {
  return {
    ...dreamCfg,
    memory: { embedding_mode: "off", global_enabled: true, project_enabled: true },
    provider: {
      ...dreamCfg.provider,
      test: { ...dreamCfg.provider.test, options: { ...dreamCfg.provider.test.options, baseURL: url } },
    },
  }
}

function chatResponse(object: unknown) {
  return {
    id: "chatcmpl-dream",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: JSON.stringify(object) },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 30, total_tokens: 40 },
  }
}

const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)
const dreamDeps = Layer.mergeAll(
  Session.defaultLayer,
  Provider.defaultLayer,
  Memory.defaultLayer,
  Dream.defaultLayer,
).pipe(Layer.provideMerge(infra))
const dreamIt = testEffect(Layer.mergeAll(TestLLMServer.layer, dreamDeps))

dreamIt.instance(
  "consolidates recent sessions through the audited memory pipeline",
  () =>
    Effect.gen(function* () {
      const llm = yield* TestLLMServer
      const { directory: dir } = yield* TestInstance
      yield* Effect.promise(() =>
        Bun.write(
          path.join(dir, "novaway.json"),
          JSON.stringify({ $schema: "https://novaway.ai/config.json", ...configFor(llm.url) }),
        ),
      )

      const sessions = yield* Session.Service
      const provider = yield* Provider.Service
      const dream = yield* Dream.Service
      const model = yield* provider.getModel(ProviderID.make("test"), ModelID.make("test-model"))

      const seed = (title: string, text: string) =>
        Effect.gen(function* () {
          const chat = yield* sessions.create({ title })
          const message = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: chat.id,
            agent: "build",
            model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
            time: { created: Date.now() },
          })
          yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: message.id,
            sessionID: chat.id,
            type: "text",
            text,
          })
          return chat
        })

      const first = yield* seed("dream-a", "We fixed the flaky test by awaiting the deferred.")
      const second = yield* seed("dream-b", "Use explicit timeouts in integration tests.")

      for (const observation of ["Prefer awaiting deferreds instead of sleeping.", "Prefer explicit test timeouts."]) {
        yield* llm.jsonMatch(
          (hit) => hit.body.response_format !== undefined,
          chatResponse({
            patterns: [],
            insights: [{ category: "code_style", observation, confidence: 0.95 }],
            suggestions: [],
          }),
        )
      }

      const report = yield* dream.consolidate({
        model,
        projectID: first.projectID,
        sessionID: second.id,
        minSessions: 1,
      })

      expect(report.skipped).toBeUndefined()
      expect(report.sessions).toBe(2)
      expect(report.drafts).toBe(2)
      expect(report.audits).toHaveLength(2)
      expect(report.audits.every((item) => item.state === "applied")).toBe(true)

      const memory = yield* Memory.Service
      const list = yield* memory.list({ projectID: first.projectID })
      expect(list.some((item) => item.content.includes("Prefer awaiting deferreds"))).toBe(true)
    }),
  { git: true },
  30_000,
)
