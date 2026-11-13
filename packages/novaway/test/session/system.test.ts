import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "node:path"
import fs from "node:fs/promises"
import type { Agent } from "../../src/agent/agent"
import { InstanceRef } from "../../src/effect/instance-ref"
import { NamedError } from "@novaway/core/util/error"
import { Git } from "../../src/git"
import { Skill } from "../../src/skill"
import { Permission } from "../../src/permission"
import { SystemPrompt } from "../../src/session/system"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"

const skills: Skill.Info[] = [
  {
    name: "zeta-skill",
    description: "Zeta skill.",
    location: "/tmp/zeta-skill/SKILL.md",
    content: "# zeta-skill",
  },
  {
    name: "alpha-skill",
    description: "Alpha skill.",
    location: "/tmp/alpha-skill/SKILL.md",
    content: "# alpha-skill",
  },
  {
    name: "middle-skill",
    description: "Middle skill.",
    location: "/tmp/middle-skill/SKILL.md",
    content: "# middle-skill",
  },
  {
    name: "manual-skill",
    location: "/tmp/manual-skill/SKILL.md",
    content: "# manual-skill",
  },
]

const build: Agent.Info = {
  name: "build",
  mode: "primary",
  permission: Permission.fromConfig({ "*": "allow" }),
  options: {},
}

const it = testEffect(
  SystemPrompt.layer.pipe(
    Layer.provide(
      Layer.succeed(
        Skill.Service,
        Skill.Service.of({
          get: (name) => Effect.succeed(skills.find((skill) => skill.name === name)),
          all: () => Effect.succeed(skills),
          dirs: () => Effect.succeed([]),
          // 生产路径里 available() 已按使用频率排序（同分按名字），fmt 不再自行排序。
          available: () => Effect.succeed(Skill.rankByUsage(skills, {})),
          reload: () => Effect.succeed(skills),
          createComposition: () => Effect.succeed({} as any),
          listCompositions: () => Effect.succeed([]),
          getComposition: () => Effect.succeed(null),
          executeComposition: () => Effect.succeed(undefined),
        }),
      ),
    ),
  ),
)

const model = {
  providerID: "anthropic",
  api: { id: "claude-opus-4-8" },
} as any

// The git snapshot needs a real repository, so this suite provides the git
// service and runs inside a temporary git instance.
const gitIt = testEffect(
  SystemPrompt.layer.pipe(
    Layer.provide(
      Layer.succeed(
        Skill.Service,
        Skill.Service.of({
          get: () => Effect.succeed(undefined),
          all: () => Effect.succeed([]),
          dirs: () => Effect.succeed([]),
          available: () => Effect.succeed([]),
          reload: () => Effect.succeed([]),
          createComposition: () => Effect.succeed({} as any),
          listCompositions: () => Effect.succeed([]),
          getComposition: () => Effect.succeed(null),
          executeComposition: () => Effect.succeed(undefined),
        }),
      ),
    ),
    Layer.provide(Git.defaultLayer),
  ),
)

describe("session.system", () => {
  it.instance("skills output is sorted by name and stable across calls", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const first = yield* prompt.skills(build)
      const second = yield* prompt.skills(build)
      const output = first ?? (yield* Effect.fail(new NamedError.Unknown({ message: "missing skills output" })))

      expect(first).toBe(second)

      const alpha = output.indexOf("<name>alpha-skill</name>")
      const middle = output.indexOf("<name>middle-skill</name>")
      const zeta = output.indexOf("<name>zeta-skill</name>")

      expect(alpha).toBeGreaterThan(-1)
      expect(middle).toBeGreaterThan(alpha)
      expect(zeta).toBeGreaterThan(middle)
      expect(output).not.toContain("manual-skill")
    }),
  )

  it.effect("environment uses the resolved model and is stable across calls", () =>
    Effect.provideService(
      Effect.gen(function* () {
        const prompt = yield* SystemPrompt.Service
        const model = {
          providerID: "anthropic",
          api: { id: "claude-opus-4-8" },
        } as any

        const first = yield* prompt.environment(model)
        const second = yield* prompt.environment(model)

        expect(first).toEqual(second)
        expect(first.join("\n")).toContain("You are powered by the model named claude-opus-4-8")
        expect(first.join("\n")).toContain("The exact model ID is anthropic/claude-opus-4-8")
      }),
      InstanceRef,
      {
        directory: "/tmp/project",
        worktree: "/tmp/project",
        project: { vcs: "git", id: "project-id" },
      } as any,
    ),
  )

  it.effect("environment reports the session directory instead of the instance root", () =>
    Effect.provideService(
      Effect.gen(function* () {
        const prompt = yield* SystemPrompt.Service
        const text = (yield* prompt.environment(model, {
          directory: "/worktrees/arena-alpha",
          worktree: "/worktrees/arena-alpha",
          project: { vcs: "git", id: "project-id" },
        } as any)).join("\n")

        // 团队/竞技场会话跑在 worktree 里：模型被告知的 cwd 必须跟着会话走，
        // 否则它会把绝对主检出路径写进产物，隔离只是名义上的。
        expect(text).toContain("Working directory: /worktrees/arena-alpha")
        expect(text).toContain("Workspace root folder: /worktrees/arena-alpha")
        expect(text).not.toContain("Working directory: /tmp/project")
      }),
      InstanceRef,
      {
        directory: "/tmp/project",
        worktree: "/tmp/project",
        project: { vcs: "git", id: "project-id" },
      } as any,
    ),
  )

  gitIt.instance(
    "environment carries a frozen git snapshot of the repository",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "tracked.txt"), "one\n"))

        const prompt = yield* SystemPrompt.Service
        const first = (yield* prompt.environment(model)).join("\n\n")
        expect(first).toContain("This is the git status at the start of the conversation")
        expect(first).toContain("Current branch:")
        expect(first).toContain("Git user: Test")
        expect(first).toContain("Recent commits:")
        expect(first).toContain("root commit")
        // The untracked file is part of the snapshot taken above.
        expect(first).toContain("tracked.txt")

        // A later change must not rewrite the snapshot: the model is told it is
        // a point-in-time view, and recomputing it would burn five git calls
        // on every request.
        yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "later.txt"), "two\n"))
        const second = (yield* prompt.environment(model)).join("\n\n")
        expect(second).toBe(first)
        expect(second).not.toContain("later.txt")
      }),
    { git: true },
    30_000,
  )
})
