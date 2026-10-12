import { describe, expect, test } from "bun:test"
import type { GitSnapshotResponses } from "@novaway/sdk/v2"
import { buildGitSectionModel } from "./git-section"

type Snapshot = GitSnapshotResponses[200]
type Change = Snapshot["changes"][number]

const change = (over: Partial<Change> = {}): Change => ({
  file: "src/a.ts",
  code: "M",
  status: "modified",
  staged: false,
  unstaged: true,
  additions: 0,
  deletions: 0,
  binary: false,
  ...over,
})

const makeSnapshot = (branch?: string, changes: Change[] = []): Snapshot =>
  ({
    branch: { branch, ahead: 0, behind: 0 },
    changes,
    branches: [],
    remotes: [],
    stash: [],
    log: [],
  }) as Snapshot

describe("buildGitSectionModel", () => {
  test("null when the snapshot is missing", () => {
    expect(buildGitSectionModel(undefined)).toBeNull()
  })

  test("null on a clean working tree", () => {
    expect(buildGitSectionModel(makeSnapshot("main"))).toBeNull()
  })

  test("counts additions, deletions, dirty files and branch", () => {
    expect(
      buildGitSectionModel(
        makeSnapshot("feat/x", [
          change({ file: "src/a.ts", additions: 700, deletions: 7 }),
          change({ file: "src/b.ts", additions: 34 }),
        ]),
      ),
    ).toEqual({ added: 734, removed: 7, branch: "feat/x", dirty: 2 })
  })

  test("counts a file present in both index and worktree once", () => {
    expect(
      buildGitSectionModel(
        makeSnapshot("main", [
          change({ file: "src/a.ts", additions: 1, deletions: 1, staged: true }),
          change({ file: "src/a.ts", additions: 1, deletions: 1, staged: false }),
        ]),
      ),
    ).toMatchObject({ added: 2, removed: 2, dirty: 1 })
  })

  test("branch is null when the snapshot carries no branch name", () => {
    expect(buildGitSectionModel(makeSnapshot(undefined, [change({ additions: 1 })]))).toMatchObject({
      branch: null,
    })
  })

  test("normalizes non-finite diff counts to zero", () => {
    const model = buildGitSectionModel(
      makeSnapshot("main", [change({ additions: "NaN", deletions: 3 })]),
    )
    expect(model).toMatchObject({ added: 0, removed: 3 })
  })
})
