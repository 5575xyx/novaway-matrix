import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, readFile } from "fs/promises"
import os from "os"
import path from "path"
import { Memory } from "../../src/memory/service"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { SessionID } from "../../src/session/schema"
import { SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"

const runMemory = <A>(effect: Effect.Effect<A, unknown, Memory.Service>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Memory.defaultLayer)))

async function tempWorktree() {
  return mkdtemp(path.join(os.tmpdir(), "novaway-memory-"))
}

function seedProject() {
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: ProjectID.global,
        worktree: "",
        sandboxes: [],
      })
      .onConflictDoNothing()
      .run(),
  )
}

function seedProjectID(id: ProjectID) {
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id,
        worktree: "",
        sandboxes: [],
      })
      .onConflictDoNothing()
      .run(),
  )
}

function seedSession(id: string) {
  const sessionID = SessionID.make(id)
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: ProjectID.global,
        worktree: "",
        sandboxes: [],
      })
      .onConflictDoNothing()
      .run()
    db.insert(SessionTable)
      .values({
        id: sessionID,
        project_id: ProjectID.global,
        slug: id,
        directory: "",
        title: id,
        version: "test",
      })
      .onConflictDoNothing()
      .run()
  })
  return sessionID
}

describe("memory review", () => {
  test("keeps review candidates project-scoped unless the user explicitly asks for global memory", async () => {
    const projectID = ProjectID.make("memory-scope-project")
    seedProjectID(projectID)
    const candidates = await runMemory(
      Memory.Service.use((memory) =>
        memory.review({
          userContent: "remember that this repository uses NovaWay planning",
          projectID,
          candidates: [
            {
              content: "NovaWay planning is the repository default.",
              scope: "global",
              reason: "The model tried to promote this to global memory.",
            },
          ],
        }),
      ),
    )

    expect(candidates[0].scope).toBe("project")
    expect(candidates[0].projectID).toBe(projectID)
  })

  test("allows explicit global memory to remain global", async () => {
    const projectID = ProjectID.make("memory-global-intent-project")
    seedProjectID(projectID)
    const candidates = await runMemory(
      Memory.Service.use((memory) =>
        memory.review({
          userContent: "remember this globally across projects: reply in Simplified Chinese",
          projectID,
          candidates: [
            {
              content: "Reply in Simplified Chinese.",
              scope: "global",
              reason: "The user explicitly requested global memory.",
            },
          ],
        }),
      ),
    )

    const global = candidates.find((candidate) => candidate.content === "Reply in Simplified Chinese.")
    expect(global?.scope).toBe("global")
    expect(global?.projectID).toBeUndefined()
  })

  test("prefetch includes project memory and explicit global memory", async () => {
    const projectID = ProjectID.make("memory-prefetch-project")
    seedProjectID(projectID)
    const sessionID = seedSession("ses_memory_prefetch_session")
    await runMemory(
      Memory.Service.use((memory) =>
        memory.add({
          projectID,
          content: "Project memory prefers .novaway plans.",
          summary: "Project memory prefers .novaway plans.",
        }),
      ),
    )
    await runMemory(
      Memory.Service.use((memory) =>
        memory.add({
          content: "Global memory prefers Simplified Chinese.",
          summary: "Global memory prefers Simplified Chinese.",
          scope: "global",
        }),
      ),
    )

    const context = await runMemory(
      Memory.Service.use((memory) =>
        memory.prefetch({
          query: "memory prefers",
          projectID,
          sessionID,
          limit: 10,
        }),
      ),
    )

    expect(context).toContain("Project memory prefers .novaway plans.")
    expect(context).toContain("Global memory prefers Simplified Chinese.")
  })

  test("dry-run returns candidates without persisting them", async () => {
    const candidates = await runMemory(
      Memory.Service.use((memory) =>
        memory.review({
          userContent: "请记住：项目默认使用 Bun 运行 TypeScript",
          dryRun: true,
        }),
      ),
    )

    expect(candidates).toHaveLength(1)
    expect(candidates[0].content).toBe("项目默认使用 Bun 运行 TypeScript")

    const pending = await runMemory(
      Memory.Service.use((memory) => memory.listReviewCandidates({ status: "pending", limit: 10 })),
    )
    expect(pending.find((item) => item.id === candidates[0].id)).toBeUndefined()
  })

  test("applies a pending review candidate into long-term memory", async () => {
    const candidates = await runMemory(
      Memory.Service.use((memory) =>
        memory.review({
          userContent: "remember that desktop memory review should stay user-approved",
        }),
      ),
    )

    const applied = await runMemory(Memory.Service.use((memory) => memory.applyReviewCandidate(candidates[0].id)))
    expect(applied?.source).toBe("review")
    expect(applied?.content).toBe("desktop memory review should stay user-approved")

    const status = await runMemory(Memory.Service.use((memory) => memory.reviewStatus()))
    expect(status.applied).toBeGreaterThanOrEqual(1)
  })

  test("writes applied review candidates to project memory files", async () => {
    const worktree = await tempWorktree()
    seedProject()
    const candidates = await runMemory(
      Memory.Service.use((memory) =>
        memory.review({
          userContent: "请记住：记忆确认后需要写入项目记忆文件",
          projectID: ProjectID.global,
        }),
      ),
    )

    const applied = await runMemory(
      Memory.Service.use((memory) => memory.applyReviewCandidate(candidates[0].id, { directory: worktree, worktree })),
    )

    expect(applied?.source).toBe("review")
    expect(applied?.content).toBe("记忆确认后需要写入项目记忆文件")
    expect(
      await readFile(path.join(worktree, ".novaway", "memory", "project", "memory", `${applied!.id}.md`), "utf-8"),
    ).toContain("记忆确认后需要写入项目记忆文件")
  })

  test("persists LLM-generated review candidate drafts as pending candidates", async () => {
    const candidates = await runMemory(
      Memory.Service.use((memory) =>
        memory.review({
          userContent: "本轮对话没有显式记忆指令",
          candidates: [
            {
              content: "项目偏好：记忆归纳候选必须先经过用户审查",
              summary: "记忆候选需要用户审查",
              tags: ["project", "llm"],
              importance: 0.9,
              reason: "LLM 从对话中归纳出稳定项目约定",
            },
          ],
        }),
      ),
    )

    expect(candidates).toHaveLength(1)
    expect(candidates[0].status).toBe("pending")
    expect(candidates[0].content).toBe("项目偏好：记忆归纳候选必须先经过用户审查")
    expect(candidates[0].tags).toContain("review")
  })

  test("dismisses a pending review candidate", async () => {
    const candidates = await runMemory(
      Memory.Service.use((memory) =>
        memory.review({
          userContent: "帮我记住：被拒绝的候选不能写入长期记忆",
        }),
      ),
    )

    const dismissed = await runMemory(Memory.Service.use((memory) => memory.dismissReviewCandidate(candidates[0].id)))
    expect(dismissed?.status).toBe("dismissed")

    const applied = await runMemory(Memory.Service.use((memory) => memory.applyReviewCandidate(candidates[0].id)))
    expect(applied).toBeUndefined()
  })

  test("respects review interval before creating candidates", async () => {
    const sessionID = seedSession(`ses_memory_review_interval_${Date.now()}`)

    const first = await runMemory(
      Memory.Service.use((memory) =>
        memory.review({
          userContent: "请记住：第一轮不会生成候选",
          projectID: ProjectID.global,
          sessionID,
          reviewInterval: 2,
        }),
      ),
    )
    expect(first).toHaveLength(0)

    const second = await runMemory(
      Memory.Service.use((memory) =>
        memory.review({
          userContent: "请记住：第二轮会生成候选",
          projectID: ProjectID.global,
          sessionID,
          reviewInterval: 2,
        }),
      ),
    )
    expect(second).toHaveLength(1)
    expect(second[0].content).toBe("第二轮会生成候选")
  })

  test("supports preflight review due checks without double-counting saved candidates", async () => {
    const sessionID = seedSession(`ses_memory_review_due_${Date.now()}`)

    const firstDue = await runMemory(
      Memory.Service.use((memory) =>
        memory.reviewDue({
          userContent: "请记住：第一轮只推进审查计数",
          projectID: ProjectID.global,
          sessionID,
          reviewInterval: 2,
        }),
      ),
    )
    expect(firstDue).toBe(false)

    const secondDue = await runMemory(
      Memory.Service.use((memory) =>
        memory.reviewDue({
          userContent: "请记住：第二轮可以生成候选",
          projectID: ProjectID.global,
          sessionID,
          reviewInterval: 2,
        }),
      ),
    )
    expect(secondDue).toBe(true)

    const candidates = await runMemory(
      Memory.Service.use((memory) =>
        memory.review({
          userContent: "请记住：第二轮可以生成候选",
          projectID: ProjectID.global,
          sessionID,
          skipReviewState: true,
        }),
      ),
    )
    expect(candidates).toHaveLength(1)

    const thirdDue = await runMemory(
      Memory.Service.use((memory) =>
        memory.reviewDue({
          userContent: "请记住：第三轮还没有到下次审查",
          projectID: ProjectID.global,
          sessionID,
          reviewInterval: 2,
        }),
      ),
    )
    expect(thirdDue).toBe(false)
  })

  test("compaction review creates pending candidates without advancing interval state", async () => {
    const sessionID = seedSession(`ses_memory_compaction_review_${Date.now()}`)

    const candidates = await runMemory(
      Memory.Service.use((memory) =>
        memory.reviewCompaction({
          messagesText: "remember that compaction review candidates stay pending",
          projectID: ProjectID.global,
          sessionID,
        }),
      ),
    )
    expect(candidates).toHaveLength(1)
    expect(candidates[0].content).toBe("compaction review candidates stay pending")
    expect(candidates[0].tags).toContain("compaction")

    const due = await runMemory(
      Memory.Service.use((memory) =>
        memory.reviewDue({
          userContent: "remember that first normal turn is not due yet",
          projectID: ProjectID.global,
          sessionID,
          reviewInterval: 2,
        }),
      ),
    )
    expect(due).toBe(false)
  })

  test("session-end review creates pending candidates without advancing interval state", async () => {
    const sessionID = seedSession(`ses_memory_session_end_review_${Date.now()}`)

    const candidates = await runMemory(
      Memory.Service.use((memory) =>
        memory.reviewSessionEnd({
          messagesText: "remember that session end review preserves explicit durable facts",
          projectID: ProjectID.global,
          sessionID,
        }),
      ),
    )
    expect(candidates).toHaveLength(1)
    expect(candidates[0].content).toBe("session end review preserves explicit durable facts")
    expect(candidates[0].tags).toContain("session-end")

    const due = await runMemory(
      Memory.Service.use((memory) =>
        memory.reviewDue({
          userContent: "remember that first normal turn is still not due",
          projectID: ProjectID.global,
          sessionID,
          reviewInterval: 2,
        }),
      ),
    )
    expect(due).toBe(false)
  })

  test("reports review candidate source counts by status", async () => {
    const sessionID = seedSession(`ses_memory_source_counts_${Date.now()}`)
    const explicit = await runMemory(
      Memory.Service.use((memory) =>
        memory.review({
          userContent: "remember that source counts include explicit memory requests",
          projectID: ProjectID.global,
          sessionID,
        }),
      ),
    )
    await runMemory(
      Memory.Service.use((memory) =>
        memory.review({
          userContent: "no explicit memory command",
          projectID: ProjectID.global,
          sessionID,
          candidates: [
            {
              content: "source counts include background review proposals",
              reason: "background proposal",
            },
          ],
        }),
      ),
    )
    await runMemory(
      Memory.Service.use((memory) =>
        memory.reviewCompaction({
          messagesText: "remember that source counts include compaction hooks",
          projectID: ProjectID.global,
          sessionID,
        }),
      ),
    )
    await runMemory(
      Memory.Service.use((memory) =>
        memory.reviewSessionEnd({
          messagesText: "remember that source counts include session end hooks",
          projectID: ProjectID.global,
          sessionID,
        }),
      ),
    )
    await runMemory(Memory.Service.use((memory) => memory.applyReviewCandidate(explicit[0].id)))

    const status = await runMemory(Memory.Service.use((memory) => memory.reviewStatus({ sessionID })))

    expect(status.source.all).toBe(4)
    expect(status.source.explicit).toBe(1)
    expect(status.source.background).toBe(1)
    expect(status.source.compaction).toBe(1)
    expect(status.source["session-end"]).toBe(1)
    expect(status.sourceByStatus.pending.all).toBe(3)
    expect(status.sourceByStatus.pending.background).toBe(1)
    expect(status.sourceByStatus.pending.compaction).toBe(1)
    expect(status.sourceByStatus.pending["session-end"]).toBe(1)
    expect(status.sourceByStatus.applied.all).toBe(1)
    expect(status.sourceByStatus.applied.explicit).toBe(1)
  })
})
