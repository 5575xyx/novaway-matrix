import { expect, test } from "bun:test"
import path from "node:path"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import * as Database from "../../src/storage/db"
import { Effect } from "effect"
import { make } from "../../src/powersnexus/repository"

test("持久化 binding、固定 PowersNexus digest 并执行 revision 乐观锁", async () => {
  const suffix = `${process.pid}-${Date.now()}`
  const projectID = ProjectID.make(`project-powersnexus-${suffix}`)
  const worktree = path.resolve(import.meta.dir, `fixture-${suffix}`)
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: projectID,
        worktree,
        sandboxes: [],
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  const repository = await Effect.runPromise(make())
  const version = {
    version: "6.1.0",
    protocolVersion: "1.0",
    digest: "a".repeat(64),
    source: "bundled",
    compatible: true,
    verified: true,
    cliPath: path.join(worktree, "powersnexus-cli.js"),
  } as const
  const created = await Effect.runPromise(
    repository.create({ projectID, worktree, changeName: "react-todo", level: "L2", version }),
  )

  expect(created.worktree).toBe(worktree)
  expect(created.powersnexusDigest).toBe(version.digest)
  expect(created.revision).toBe(0)
  expect(
    (
      await Effect.runPromise(
        repository.create({ projectID, worktree, changeName: "react-todo", level: "L2", version }),
      )
    ).id,
  ).toBe(created.id)
  expect((await Effect.runPromise(repository.listActive(projectID, worktree))).map((item) => item.id)).toEqual([
    created.id,
  ])

  const deactivated = await Effect.runPromise(repository.deactivate({ id: created.id, expectedRevision: 0 }))
  expect(deactivated.active).toBe(false)
  expect(deactivated.revision).toBe(1)
  expect((await Effect.runPromiseExit(repository.deactivate({ id: created.id, expectedRevision: 0 })))._tag).toBe(
    "Failure",
  )
  expect(await Effect.runPromise(repository.listActive(projectID, worktree))).toEqual([])
})

test("拒绝相对 worktree 和未验证版本", async () => {
  const repository = await Effect.runPromise(make())
  const projectID = ProjectID.make(`project-powersnexus-invalid-${Date.now()}`)
  const version = {
    version: "6.1.0",
    protocolVersion: "1.0",
    digest: "a".repeat(64),
    source: "bundled",
    compatible: true,
    verified: false,
    cliPath: "powersnexus-cli.js",
  } as const

  expect(
    (
      await Effect.runPromiseExit(
        repository.create({ projectID, worktree: "relative", changeName: "react-todo", level: "L2", version }),
      )
    )._tag,
  ).toBe("Failure")
})
