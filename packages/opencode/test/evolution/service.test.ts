import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Exit } from "effect"
import { mkdir, mkdtemp, readFile, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { Evolution } from "../../src/evolution/service"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { MessageID, SessionID } from "../../src/session/schema"
import { SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"

const runEvolution = <A>(effect: Effect.Effect<A, unknown, Evolution.Service>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Evolution.defaultLayer)))

async function tempWorktree() {
  return mkdtemp(path.join(os.tmpdir(), "novaway-evolution-"))
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

describe("evolution candidate service", () => {
  test("keeps project-specific evolution candidates project-scoped even when scope is global", async () => {
    const projectID = ProjectID.make("evolution-scope-project")
    seedProjectID(projectID)
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          projectID,
          proposals: [
            {
              kind: "project",
              scope: "global",
              target: "local-plan-rule",
              title: "document local plan rule",
              content: "This project writes plans into its local .novaway/plans directory.",
              reason: "This is tied to one project configuration.",
            },
          ],
        }),
      ),
    )

    expect(candidates[0].projectID).toBe(projectID)
  })

  test("allows reusable skill candidates to become global evolution candidates", async () => {
    const projectID = ProjectID.make("evolution-global-skill-project")
    seedProjectID(projectID)
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          projectID,
          proposals: [
            {
              kind: "skill",
              scope: "global",
              target: "implementation-retrospective",
              title: "reusable implementation retrospective skill",
              content:
                "Reusable cross-project skill: after implementation, summarize decisions, verification, and reusable workflow lessons.",
              reason: "The workflow is reusable across projects and should be reviewed as a global skill candidate.",
              tags: ["reusable", "skill"],
            },
          ],
        }),
      ),
    )

    expect(candidates[0].projectID).toBeUndefined()
    expect(candidates[0].kind).toBe("skill")
    expect(candidates[0].tags).toContain("reusable")
  })

  test("writes global skill candidates to the global config skill directory", async () => {
    const worktree = await tempWorktree()
    const globalConfig = await tempWorktree()
    const projectID = ProjectID.make("evolution-global-apply-project")
    seedProjectID(projectID)
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          projectID,
          proposals: [
            {
              kind: "skill",
              scope: "global",
              target: "implementation-retrospective",
              title: "reusable implementation retrospective skill",
              content: "Reusable cross-project skill body.",
              reason: "Reusable across projects as a global skill.",
              tags: ["reusable"],
            },
          ],
        }),
      ),
    )

    const applied = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.applyToDisk(candidates[0].id, { directory: worktree, worktree, globalConfig }),
      ),
    )

    expect(applied?.candidate.projectID).toBeUndefined()
    expect(applied?.dryRun.files[0].path.replace(/\\/g, "/")).toBe("skills/implementation-retrospective/SKILL.md")
    expect(await readFile(path.join(globalConfig, "skills", "implementation-retrospective", "SKILL.md"), "utf-8")).toBe(
      "Reusable cross-project skill body.\n",
    )
    expect(
      await Bun.file(path.join(worktree, ".novaway", "skills", "implementation-retrospective", "SKILL.md")).exists(),
    ).toBe(false)
  })

  test("creates pending self-evolution candidates", async () => {
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          proposals: [
            {
              kind: "skill",
              target: "customize-novaway",
              title: "improve config recovery docs",
              content: "when novaway.json config parse fails, skill should read schema first and suggest fixes.",
              reason: "multiple config fix tasks exposed same recovery path.",
              tags: ["skill", "recovery"],
            },
          ],
        }),
      ),
    )

    expect(candidates).toHaveLength(1)
    expect(candidates[0].status).toBe("pending")
    expect(candidates[0].kind).toBe("skill")
    expect(candidates[0].tags).toContain("evolution")
  })

  test("applies and dismisses candidates without editing target files", async () => {
    const appliedCandidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          proposals: [
            {
              kind: "workflow",
              target: "memory-review",
              title: "edit candidate before apply",
              content: "allow users to modify content and tags before applying memory candidates.",
              reason: "reduce chance of wrong summaries being persisted.",
            },
          ],
        }),
      ),
    )
    const applied = await runEvolution(Evolution.Service.use((evolution) => evolution.apply(appliedCandidates[0].id)))
    expect(applied?.status).toBe("applied")

    const dismissedCandidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          proposals: [
            {
              kind: "agent",
              target: "build",
              title: "ignore low value changes",
              content: "do not auto-change build agent behavior for one-off tasks.",
              reason: "one-off task not enough to support long-term evolution.",
            },
          ],
        }),
      ),
    )
    const dismissed = await runEvolution(
      Evolution.Service.use((evolution) => evolution.dismiss(dismissedCandidates[0].id)),
    )
    expect(dismissed?.status).toBe("dismissed")
    expect(
      await runEvolution(Evolution.Service.use((evolution) => evolution.apply(dismissedCandidates[0].id))),
    ).toBeUndefined()
  })

  test("updates pending candidates and returns a preview diff", async () => {
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          proposals: [
            {
              kind: "prompt",
              target: "review-summary",
              title: "old title",
              content: "old content",
              reason: "old reason",
              tags: ["draft"],
            },
          ],
        }),
      ),
    )

    const updated = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.update(candidates[0].id, {
          title: "improve review summary format",
          content: "review summary should include goal, scope, verification command and residual risk.",
          reason: "multi-stage integration needs stable delivery records.",
          tags: ["review", "summary"],
        }),
      ),
    )
    const preview = await runEvolution(Evolution.Service.use((evolution) => evolution.preview(candidates[0].id)))

    expect(updated?.title).toBe("improve review summary format")
    expect(updated?.tags).toContain("evolution")
    expect(preview?.diff).toContain("+++ proposed/prompt/review-summary")
    expect(preview?.diff).toContain("+title: improve review summary format")
  })

  test("returns a file-level dry-run for a new target without writing files", async () => {
    const worktree = await tempWorktree()
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          proposals: [
            {
              kind: "skill",
              target: `dry-run-skill-${Date.now()}`,
              title: "new skill dry run preview",
              content: "skill description should go in SKILL.md.",
              reason: "verify new file dry-run.",
            },
          ],
        }),
      ),
    )
    const dryRun = await runEvolution(
      Evolution.Service.use((evolution) => evolution.dryRun(candidates[0].id, { directory: worktree, worktree })),
    )

    expect(dryRun?.files).toHaveLength(1)
    expect(dryRun?.files[0].exists).toBe(false)
    expect(dryRun?.files[0].path.replace(/\\/g, "/")).toContain(".novaway/skills/")
    expect(dryRun?.files[0].path.replace(/\\/g, "/")).toContain("/SKILL.md")
    expect(dryRun?.files[0].diff).toContain("+skill description should go in SKILL.md.")
    expect(await Bun.file(path.join(worktree, dryRun!.files[0].path)).exists()).toBe(false)
  })

  test("previews and writes project evolution candidates to .novaway evolution files", async () => {
    const worktree = await tempWorktree()
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          proposals: [
            {
              kind: "project",
              target: "session-end-review",
              title: "会话结束复盘规则",
              content: "会话结束时应归纳可长期复用的项目经验，并等待用户确认后再写入进化文件。",
              reason: "验证项目级进化候选的真实预览和落盘路径。",
              tags: ["session-end"],
            },
          ],
        }),
      ),
    )
    const dryRun = await runEvolution(
      Evolution.Service.use((evolution) => evolution.dryRun(candidates[0].id, { directory: worktree, worktree })),
    )

    expect(dryRun?.files).toHaveLength(1)
    expect(dryRun?.files[0].path.replace(/\\/g, "/")).toBe(".novaway/evolution/session-end-review.md")
    expect(dryRun?.files[0].exists).toBe(false)
    expect(dryRun?.files[0].diff).toContain("+会话结束时应归纳可长期复用的项目经验")
    expect(await Bun.file(path.join(worktree, ".novaway", "evolution", "session-end-review.md")).exists()).toBe(false)

    const applied = await runEvolution(
      Evolution.Service.use((evolution) => evolution.applyToDisk(candidates[0].id, { directory: worktree, worktree })),
    )

    expect(applied?.candidate.status).toBe("applied")
    expect(applied?.dryRun.files[0].path.replace(/\\/g, "/")).toBe(".novaway/evolution/session-end-review.md")
    expect(await readFile(path.join(worktree, ".novaway", "evolution", "session-end-review.md"), "utf-8")).toBe(
      "会话结束时应归纳可长期复用的项目经验，并等待用户确认后再写入进化文件。\n",
    )
  })

  test("returns a file-level dry-run for an existing target without changing the file", async () => {
    const worktree = await tempWorktree()
    const target = `dry-run-agent-${Date.now()}`
    const file = path.join(worktree, ".novaway", "agents", `${target}.md`)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, "old Agent instructions.\n")
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          proposals: [
            {
              kind: "agent",
              target,
              title: "update Agent preview",
              content: "new Agent instructions.",
              reason: "verify existing file dry-run.",
            },
          ],
        }),
      ),
    )
    const dryRun = await runEvolution(
      Evolution.Service.use((evolution) => evolution.dryRun(candidates[0].id, { directory: worktree, worktree })),
    )

    expect(dryRun?.files[0].exists).toBe(true)
    expect(dryRun?.files[0].before).toBe("old Agent instructions.\n")
    expect(dryRun?.files[0].after).toBe("new Agent instructions.\n")
    expect(dryRun?.files[0].diff).toContain("-old Agent instructions.")
    expect(dryRun?.files[0].diff).toContain("+new Agent instructions.")
    expect(await readFile(file, "utf-8")).toBe("old Agent instructions.\n")
  })

  test("applies a pending candidate to a new target file", async () => {
    const worktree = await tempWorktree()
    const target = `apply-skill-${Date.now()}`
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          proposals: [
            {
              kind: "skill",
              target,
              title: "write new skill",
              content: "new skill description.",
              reason: "verify real writer writes new file.",
            },
          ],
        }),
      ),
    )
    const applied = await runEvolution(
      Evolution.Service.use((evolution) => evolution.applyToDisk(candidates[0].id, { directory: worktree, worktree })),
    )

    expect(applied?.candidate.status).toBe("applied")
    expect(applied?.dryRun.files[0].exists).toBe(false)
    expect(await readFile(path.join(worktree, ".novaway", "skills", target, "SKILL.md"), "utf-8")).toBe(
      "new skill description.\n",
    )
  })

  test("applies a pending candidate by replacing an existing target file", async () => {
    const worktree = await tempWorktree()
    const target = `apply-agent-${Date.now()}`
    const file = path.join(worktree, ".novaway", "agents", `${target}.md`)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, "old content.\n")
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          proposals: [
            {
              kind: "agent",
              target,
              title: "overwrite Agent",
              content: "new content.",
              reason: "verify real writer overwrites file.",
            },
          ],
        }),
      ),
    )
    const applied = await runEvolution(
      Evolution.Service.use((evolution) => evolution.applyToDisk(candidates[0].id, { directory: worktree, worktree })),
    )

    expect(applied?.candidate.status).toBe("applied")
    expect(applied?.dryRun.files[0].exists).toBe(true)
    expect(await readFile(file, "utf-8")).toBe("new content.\n")
  })

  test("does not write dismissed candidates to disk", async () => {
    const worktree = await tempWorktree()
    const target = `dismissed-apply-${Date.now()}`
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          proposals: [
            {
              kind: "prompt",
              target,
              title: "ignored candidate",
              content: "should not write.",
              reason: "verify non-pending candidates cannot be written.",
            },
          ],
        }),
      ),
    )
    await runEvolution(Evolution.Service.use((evolution) => evolution.dismiss(candidates[0].id)))

    expect(
      await runEvolution(
        Evolution.Service.use((evolution) =>
          evolution.applyToDisk(candidates[0].id, { directory: worktree, worktree }),
        ),
      ),
    ).toBeUndefined()
    expect(await Bun.file(path.join(worktree, ".novaway", "prompts", `${target}.md`)).exists()).toBe(false)
  })

  test("applies unified diff candidates without replacing unrelated file content", async () => {
    const worktree = await tempWorktree()
    const target = `patch-agent-${Date.now()}`
    const file = path.join(worktree, ".novaway", "agents", `${target}.md`)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, "first line\nold rule\nthird line\n")
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          proposals: [
            {
              kind: "agent",
              target,
              title: "Patch Agent",
              contentFormat: "unified_diff",
              content: [
                `--- a/.novaway/agents/${target}.md`,
                `+++ b/.novaway/agents/${target}.md`,
                "@@ -1,3 +1,3 @@",
                " first line",
                "-old rule",
                "+new rule",
                " third line",
              ].join("\n"),
              reason: "verify patch protocol only modifies target fragment.",
            },
          ],
        }),
      ),
    )
    const dryRun = await runEvolution(
      Evolution.Service.use((evolution) => evolution.dryRun(candidates[0].id, { directory: worktree, worktree })),
    )
    const applied = await runEvolution(
      Evolution.Service.use((evolution) => evolution.applyToDisk(candidates[0].id, { directory: worktree, worktree })),
    )

    expect(dryRun?.files[0].after).toBe("first line\nnew rule\nthird line\n")
    expect(applied?.candidate.status).toBe("applied")
    expect(await readFile(file, "utf-8")).toBe("first line\nnew rule\nthird line\n")
  })

  test("keeps patch candidates pending when unified diff context does not match", async () => {
    const worktree = await tempWorktree()
    const target = `patch-mismatch-${Date.now()}`
    const file = path.join(worktree, ".novaway", "agents", `${target}.md`)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, "real content\n")
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          proposals: [
            {
              kind: "agent",
              target,
              title: "Patch mismatch",
              contentFormat: "unified_diff",
              content: [
                `--- a/.novaway/agents/${target}.md`,
                `+++ b/.novaway/agents/${target}.md`,
                "@@ -1,1 +1,1 @@",
                "-non-existent old content",
                "+new content",
              ].join("\n"),
              reason: "verify patch context mismatch does not write.",
            },
          ],
        }),
      ),
    )
    const exit = await Effect.runPromiseExit(
      Evolution.Service.use((evolution) =>
        evolution.applyToDisk(candidates[0].id, { directory: worktree, worktree }),
      ).pipe(Effect.provide(Evolution.defaultLayer)),
    )
    const items = await runEvolution(
      Evolution.Service.use((evolution) => evolution.list({ status: "pending", limit: 1000 })),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(items.some((item) => item.id === candidates[0].id)).toBe(true)
    expect(await readFile(file, "utf-8")).toBe("real content\n")
  })

  test("respects explicit content format for diff-looking content", async () => {
    const worktree = await tempWorktree()
    const target = `content-format-${Date.now()}`
    const file = path.join(worktree, ".novaway", "agents", `${target}.md`)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, "original\n")
    const content = [
      `--- a/.novaway/agents/${target}.md`,
      `+++ b/.novaway/agents/${target}.md`,
      "@@ -1,1 +1,1 @@",
      "-original",
      "+patched",
    ].join("\n")
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          proposals: [
            {
              kind: "agent",
              target,
              title: "Store patch text as content",
              content,
              contentFormat: "content",
              reason: "Verify explicit content format overrides automatic diff detection.",
            },
          ],
        }),
      ),
    )
    const applied = await runEvolution(
      Evolution.Service.use((evolution) => evolution.applyToDisk(candidates[0].id, { directory: worktree, worktree })),
    )

    expect(candidates[0].contentFormat).toBe("content")
    expect(applied?.candidate.contentFormat).toBe("content")
    expect(await readFile(file, "utf-8")).toBe(`${content}\n`)
  })

  test("reports candidate status counts", async () => {
    const status = await runEvolution(Evolution.Service.use((evolution) => evolution.status()))
    expect(status.total).toBeGreaterThanOrEqual(status.pending + status.applied + status.dismissed)
  })

  test("reports evolution candidate source counts by status", async () => {
    const sessionID = seedSession(`ses_evolution_source_counts_${Date.now()}`)
    const background = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          projectID: ProjectID.global,
          sessionID,
          proposals: [{ kind: "prompt", target: "bg", title: "bg", content: "background", reason: "bg" }],
        }),
      ),
    )
    await runEvolution(Evolution.Service.use((evolution) => evolution.apply(background[0].id)))
    const status = await runEvolution(Evolution.Service.use((evolution) => evolution.status({ sessionID })))

    expect(status.source.all).toBe(1)
    expect(status.source.background).toBe(1)
    expect(status.source["session-end"]).toBe(0)
    expect(status.sourceByStatus.applied.all).toBe(1)
    expect(status.sourceByStatus.applied.background).toBe(1)
    expect(status.sourceByStatus.pending.all).toBe(0)
  })

  test("respects self-evolution review interval", async () => {
    const sessionID = seedSession(`ses_evolution_review_interval_${Date.now()}`)
    const first = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.reviewDue({
          sessionID,
          sourceMessageID: MessageID.ascending(`msg_evolution_review_interval_first_${Date.now()}`),
          reviewInterval: 2,
        }),
      ),
    )
    const second = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.reviewDue({
          sessionID,
          sourceMessageID: MessageID.ascending(`msg_evolution_review_interval_second_${Date.now()}`),
          reviewInterval: 2,
        }),
      ),
    )

    expect(first).toBe(false)
    expect(second).toBe(true)
  })

  test("session-end review creates pending candidates without advancing interval state", async () => {
    const sessionID = seedSession(`ses_evolution_session_end_${Date.now()}`)
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.reviewSessionEnd({
          messagesText: "please improve that future reviews should capture verification commands",
          projectID: ProjectID.global,
          sessionID,
          sourceMessageID: MessageID.ascending(`msg_evolution_session_end_${Date.now()}`),
        }),
      ),
    )
    const due = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.reviewDue({
          sessionID,
          reviewInterval: 2,
        }),
      ),
    )

    expect(candidates).toHaveLength(1)
    expect(candidates[0].content).toBe("future reviews should capture verification commands")
    expect(candidates[0].tags).toContain("session-end")
    expect(due).toBe(false)
  })

  test("applyToDisk marks validation status on skill candidates", async () => {
    const worktree = await tempWorktree()
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          proposals: [
            {
              kind: "skill",
              domain: "coding",
              target: "validated-skill",
              title: "Validated skill",
              content: "# Validated\n\nHot reload path.\n",
              reason: "verify validation status fields.",
              tags: ["test"],
            },
          ],
        }),
      ),
    )
    const applied = await runEvolution(
      Evolution.Service.use((evolution) => evolution.applyToDisk(candidates[0].id, { directory: worktree, worktree })),
    )
    expect(applied?.candidate.status).toBe("applied")
    expect(applied?.candidate.validationStatus).toBe("validated")
    expect(applied?.candidate.validationNote).toBeTruthy()
    expect(applied?.candidate.domain).toBe("coding")
  })

  test("applyToDisk marks validation status on agent candidates", async () => {
    const worktree = await tempWorktree()
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          proposals: [
            {
              kind: "agent",
              domain: "office",
              target: "hot-reload-agent",
              title: "Hot reload agent",
              content: "---\ndescription: Hot reload agent\nmode: primary\n---\n\n# Hot Reload Agent\n",
              reason: "verify agent validation/hot-reload path.",
              tags: ["test"],
            },
          ],
        }),
      ),
    )
    const applied = await runEvolution(
      Evolution.Service.use((evolution) => evolution.applyToDisk(candidates[0].id, { directory: worktree, worktree })),
    )
    expect(applied?.candidate.status).toBe("applied")
    expect(applied?.candidate.validationStatus).toBe("validated")
    expect(applied?.candidate.domain).toBe("office")
    expect(applied?.candidate.validationNote).toBeTruthy()
  })

  test("applyToDisk activates workflow as command artifact", async () => {
    const worktree = await tempWorktree()
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          proposals: [
            {
              kind: "workflow",
              domain: "ops",
              target: "incident-response",
              title: "Incident response workflow",
              content: "# Incident Response\n\n1. Triage\n2. Mitigate\n3. Postmortem\n",
              reason: "verify workflow activation path.",
              tags: ["test"],
            },
          ],
        }),
      ),
    )
    const applied = await runEvolution(
      Evolution.Service.use((evolution) => evolution.applyToDisk(candidates[0].id, { directory: worktree, worktree })),
    )
    expect(applied?.candidate.status).toBe("applied")
    expect(applied?.candidate.validationStatus).toBe("validated")
    expect(applied?.candidate.domain).toBe("ops")
    const file = path.join(worktree, ".novaway", "workflows", "incident-response.md")
    expect(await Bun.file(file).exists()).toBe(true)
    expect(await Bun.file(file).text()).toContain("Postmortem")
  })

  test("applyToDisk materializes executable tool modules", async () => {
    const worktree = await tempWorktree()
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          proposals: [
            {
              kind: "tool",
              domain: "coding",
              target: "repo-health-check",
              title: "Repo health check tool",
              content: "Check repository health: list dirty files, summarize git status, and suggest next actions.",
              reason: "verify tool codegen and activation path.",
              tags: ["test"],
            },
          ],
        }),
      ),
    )
    const applied = await runEvolution(
      Evolution.Service.use((evolution) => evolution.applyToDisk(candidates[0].id, { directory: worktree, worktree })),
    )
    expect(applied?.candidate.status).toBe("applied")
    expect(applied?.candidate.validationStatus).toBe("validated")
    const file = path.join(worktree, ".novaway", "tools", "repo-health-check.ts")
    expect(await Bun.file(file).exists()).toBe(true)
    const source = await Bun.file(file).text()
    expect(source).toContain("export default tool({")
    expect(source).toContain("execute")
    expect(source).toContain("@opencode-ai/plugin")
    expect(source).toContain("Repo health check tool")
  })

  test("applyToDisk keeps executable tool typescript content intact", async () => {
    const worktree = await tempWorktree()
    const toolSource = [
      'import { tool } from "@opencode-ai/plugin"',
      "",
      "export default tool({",
      "  description: 'echo tool',",
      "  args: { text: tool.schema.string() },",
      "  async execute({ text }) {",
      "    return text",
      "  },",
      "})",
      "",
    ].join("\n")
    const candidates = await runEvolution(
      Evolution.Service.use((evolution) =>
        evolution.review({
          proposals: [
            {
              kind: "tool",
              domain: "coding",
              target: "echo-tool",
              title: "Echo tool",
              content: toolSource,
              reason: "verify raw tool source passthrough.",
              tags: ["test"],
            },
          ],
        }),
      ),
    )
    await runEvolution(
      Evolution.Service.use((evolution) => evolution.applyToDisk(candidates[0].id, { directory: worktree, worktree })),
    )
    const file = path.join(worktree, ".novaway", "tools", "echo-tool.ts")
    const source = await Bun.file(file).text()
    expect(source).toContain("description: 'echo tool'")
    expect(source).toContain("return text")
  })
})
