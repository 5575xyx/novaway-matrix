import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as Tasks from "../../src/cron/tasks"

const dirs: string[] = []

afterEach(async () => {
  Tasks.reset()
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})

async function tmp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-cron-"))
  dirs.push(dir)
  return dir
}

const task = (overrides: Partial<Tasks.Task> = {}): Tasks.Task => ({
  id: Tasks.id(),
  cron: "*/5 * * * *",
  prompt: "check the build",
  createdAt: Date.now(),
  recurring: true,
  durable: false,
  sessionID: "ses_test",
  directory: "/tmp/project",
  ...overrides,
})

describe("cron.tasks", () => {
  test("ids are short hex strings", () => {
    const id = Tasks.id()
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })

  test("add / get / remove / list by session", () => {
    const first = Tasks.add(task({ sessionID: "ses_a" }))
    const second = Tasks.add(task({ sessionID: "ses_b" }))
    expect(Tasks.get(first.id)?.id).toBe(first.id)
    expect(Tasks.forSession("ses_a").map((item) => item.id)).toEqual([first.id])
    expect(Tasks.remove(second.id)).toBe(true)
    expect(Tasks.get(second.id)).toBeUndefined()
    expect(Tasks.remove("missing")).toBe(false)
  })

  test("due() reports the scheduled time once it has passed", () => {
    const created = new Date("2026-03-10T09:01:00").getTime()
    const item = Tasks.add(task({ createdAt: created, cron: "*/5 * * * *" }))
    expect(Tasks.due(item, new Date("2026-03-10T09:04:00").getTime())).toBeUndefined()
    expect(Tasks.due(item, new Date("2026-03-10T09:05:30").getTime())).toBe(new Date("2026-03-10T09:05:00").getTime())
  })

  test("due() anchors on the last fire so a task does not fire twice", () => {
    const created = new Date("2026-03-10T09:01:00").getTime()
    const item = Tasks.add(task({ createdAt: created }))
    Tasks.markFired(item.id, new Date("2026-03-10T09:05:00").getTime())
    expect(Tasks.due(item, new Date("2026-03-10T09:06:00").getTime())).toBeUndefined()
    expect(Tasks.due(item, new Date("2026-03-10T09:10:30").getTime())).toBe(new Date("2026-03-10T09:10:00").getTime())
  })

  test("expired() only applies to tasks with an expiry", () => {
    const now = Date.now()
    expect(Tasks.expired(task({ expiresAt: now - 1 }), now)).toBe(true)
    expect(Tasks.expired(task({ expiresAt: now + 60_000 }), now)).toBe(false)
    expect(Tasks.expired(task(), now)).toBe(false)
  })

  test("persist writes and load restores durable tasks", async () => {
    const dir = await tmp()
    const durable = Tasks.add(task({ durable: true, directory: dir }))
    const sessionOnly = Tasks.add(task({ durable: false, directory: dir }))
    await Tasks.persist(dir)

    const file = path.join(dir, Tasks.STORE_FILE)
    const raw = JSON.parse(await fs.readFile(file, "utf8"))
    expect(raw.tasks.map((item: { id: string }) => item.id)).toEqual([durable.id])
    expect(raw.tasks[0]).not.toHaveProperty("durable")

    Tasks.reset()
    const restored = await Tasks.load(dir)
    expect(restored.map((item) => item.id)).toEqual([durable.id])
    expect(restored[0]!.durable).toBe(true)
    expect(restored[0]!.recurring).toBe(true)
    expect(Tasks.get(sessionOnly.id)).toBeUndefined()
  })

  test("load ignores malformed files and invalid cron entries", async () => {
    const dir = await tmp()
    await fs.mkdir(path.dirname(path.join(dir, Tasks.STORE_FILE)), { recursive: true })
    await fs.writeFile(path.join(dir, Tasks.STORE_FILE), "{not json", "utf8")
    expect(await Tasks.load(dir)).toEqual([])

    Tasks.reset()
    await fs.writeFile(
      path.join(dir, Tasks.STORE_FILE),
      JSON.stringify({ tasks: [{ id: "x", cron: "bad", prompt: "p" }] }),
      "utf8",
    )
    expect(await Tasks.load(dir)).toEqual([])
  })

  test("persist removes the file when the last durable task is gone", async () => {
    const dir = await tmp()
    const item = Tasks.add(task({ durable: true, directory: dir }))
    await Tasks.persist(dir)
    Tasks.remove(item.id)
    await Tasks.persist(dir)
    await expect(fs.stat(path.join(dir, Tasks.STORE_FILE))).rejects.toThrow()
  })
})
