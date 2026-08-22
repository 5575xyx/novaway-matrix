import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtemp } from "fs/promises"
import os from "os"
import path from "path"
import { Evolution } from "../../src/evolution/service"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { Database } from "../../src/storage/db"

const runEvolution = <A>(effect: Effect.Effect<A, unknown, Evolution.Service>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Evolution.defaultLayer)))

async function tempWorktree() {
  return mkdtemp(path.join(os.tmpdir(), "novaway-generic-evolution-"))
}

function seedProjectID(id: ProjectID) {
  Database.use((db) => db.insert(ProjectTable).values({ id, worktree: "", sandboxes: [] }).onConflictDoNothing().run())
}

describe("generic evolution kinds", () => {
  test("keeps global strategy/habit/knowledge candidates reusable across projects", async () => {
    const projectID = ProjectID.make("generic-evolution-project")
    seedProjectID(projectID)
    for (const kind of ["strategy", "habit", "knowledge"] as const) {
      const candidates = await runEvolution(
        Evolution.Service.use((evolution) =>
          evolution.review({
            projectID,
            proposals: [
              {
                kind,
                scope: "global",
                target: `generic-${kind}`,
                title: `Generic ${kind}`,
                content: `Reusable ${kind} guidance for everyday work.`,
                reason: `General-purpose ${kind} should apply across projects.`,
              },
            ],
          }),
        ),
      )
      expect(candidates[0].kind).toBe(kind)
      expect(candidates[0].projectID).toBeUndefined()
    }
  })

  test("writes project habit candidates into generic evolution artifacts", async () => {
    const worktree = await tempWorktree()
    const projectID = ProjectID.make("habit-apply-project")
    seedProjectID(projectID)
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          projectID,
          proposals: [
            {
              kind: "habit",
              scope: "project",
              target: "weekly-review",
              title: "Weekly review habit",
              content: "每周复盘：目标、决策、经验与下一步计划。",
              reason: "固化可复用的个人工作节奏。",
            },
          ],
        }),
      ),
    )
    const applied = await runEvolution(
      Evolution.Service.use((evolution) => evolution.applyToDisk(candidates[0].id, { directory: worktree, worktree })),
    )
    const relative = applied?.dryRun.files[0].path.replace(/\\/g, "/")
    expect(relative).toContain(".novaway/evolution/weekly-review.md")
    expect(await Bun.file(path.join(worktree, ".novaway", "evolution", "weekly-review.md")).exists()).toBe(true)
  })

  test("rejects incomplete evolution candidates before writing files", async () => {
    const worktree = await tempWorktree()
    const projectID = ProjectID.make("invalid-evolution-project")
    seedProjectID(projectID)
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          projectID,
          proposals: [
            {
              kind: "strategy",
              scope: "project",
              target: "short",
              title: "Invalid strategy",
              content: "短",
              reason: "测试无效候选",
            },
          ],
        }),
      ),
    )
    const applied = await runEvolution(
      Evolution.Service.use((evolution) => evolution.applyToDisk(candidates[0].id, { directory: worktree, worktree })),
    )
    const status = await runEvolution(Evolution.Service.use((evolution) => evolution.status({ projectID })))
    expect(applied).toBeUndefined()
    expect(status.pending).toBe(1)
    const candidate = await runEvolution(
      Evolution.Service.use((evolution) => evolution.list({ projectID, status: "pending" })),
    )
    expect(candidate[0]?.validationStatus).toBe("failed")
  })

  test("applies candidates whose expected outcomes appear in the written file", async () => {
    const worktree = await tempWorktree()
    const projectID = ProjectID.make("regression-ok-project")
    seedProjectID(projectID)
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          projectID,
          proposals: [
            {
              kind: "knowledge",
              scope: "project",
              target: "meeting-notes",
              title: "Meeting notes template",
              content: "会议纪要包含结论、待办、负责人和截止时间。",
              reason: "沉淀可复用知识模板。",
              expectedOutcomes: ["结论", "待办", "负责人"],
            },
          ],
        }),
      ),
    )
    const applied = await runEvolution(
      Evolution.Service.use((evolution) => evolution.applyToDisk(candidates[0].id, { directory: worktree, worktree })),
    )
    expect(applied?.candidate.validationStatus).toBe("validated")
    expect(applied?.candidate.validationNote).toContain("written")
    expect(await Bun.file(path.join(worktree, ".novaway", "evolution", "meeting-notes.md")).exists()).toBe(true)
  })

  test("rolls back candidates whose expected outcomes are missing", async () => {
    const worktree = await tempWorktree()
    const projectID = ProjectID.make("regression-fail-project")
    seedProjectID(projectID)
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          projectID,
          proposals: [
            {
              kind: "knowledge",
              scope: "project",
              target: "meeting-notes",
              title: "Broken meeting notes template",
              content: "只有一句话，没有完整结构。",
              reason: "测试回归回滚。",
              expectedOutcomes: ["结论", "待办", "负责人", "截止时间"],
            },
          ],
        }),
      ),
    )
    const applied = await runEvolution(
      Evolution.Service.use((evolution) => evolution.applyToDisk(candidates[0].id, { directory: worktree, worktree })),
    )
    const candidate = await runEvolution(
      Evolution.Service.use((evolution) => evolution.list({ projectID, status: "pending" })),
    )
    expect(applied).toBeUndefined()
    expect(candidate[0]?.validationStatus).toBe("failed")
    expect(candidate[0]?.validationNote).toContain("回归校验失败")
    expect(await Bun.file(path.join(worktree, ".novaway", "evolution", "meeting-notes.md")).exists()).toBe(false)
  })
})
