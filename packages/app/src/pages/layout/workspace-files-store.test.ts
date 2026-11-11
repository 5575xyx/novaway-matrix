import { expect, test } from "bun:test"
import { aggregateDirectoryStatuses, changedSearchEntries, searchEntries } from "./workspace-files-store"

test("directory status aggregation retains each status and counts changed files", () => {
  expect(
    aggregateDirectoryStatuses([
      { file: "src/one.ts", status: "modified" },
      { file: "src/two.ts", status: "untracked" },
      { file: "src/nested/three.ts", status: "modified" },
    ]),
  ).toEqual(
    new Map([
      ["src", { modified: 2, untracked: 1 }],
      ["src/nested", { modified: 1 }],
    ]),
  )
})

test("workspace search results preserve file and directory types", () => {
  expect(searchEntries(["src/index.ts"], ["src/components"])).toEqual([
    { path: "src/index.ts", name: "index.ts", type: "file" },
    { path: "src/components", name: "components", type: "dir" },
  ])
})

test("workspace search results normalize Windows separators", () => {
  expect(searchEntries(["src\\index.ts"], ["src\\components"])).toEqual([
    { path: "src/index.ts", name: "index.ts", type: "file" },
    { path: "src/components", name: "components", type: "dir" },
  ])
})

test("workspace search results preserve mixed fuzzy ranking", () => {
  expect(
    searchEntries(["src/UserProfile.ts"], ["src/user", "src/users"], ["src/users", "src/UserProfile.ts", "src/user"]),
  ).toEqual([
    { path: "src/users", name: "users", type: "dir" },
    { path: "src/UserProfile.ts", name: "UserProfile.ts", type: "file" },
    { path: "src/user", name: "user", type: "dir" },
  ])
})

test("workspace search results append candidates missing from the mixed ranking", () => {
  expect(searchEntries(["src/index.ts"], ["src/components"], ["src/components"])).toEqual([
    { path: "src/components", name: "components", type: "dir" },
    { path: "src/index.ts", name: "index.ts", type: "file" },
  ])
})

test("changed-only search retains changed files and their parent directories", () => {
  const entries = searchEntries(["src/index.ts", "src/other.ts", "docs/readme.md"], ["src", "docs"])
  expect(changedSearchEntries(entries, ["src/index.ts"])).toEqual([
    { path: "src/index.ts", name: "index.ts", type: "file" },
    { path: "src", name: "src", type: "dir" },
  ])
})
