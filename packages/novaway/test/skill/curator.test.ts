import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as Curator from "../../src/skill/curator"
import * as Usage from "../../src/skill/usage"

const DAY = 24 * 60 * 60 * 1000

const skill = (name: string, lastActivity: number, extra?: Partial<Curator.SkillEntry>): Curator.SkillEntry => ({
  name,
  location: path.join(".novaway", "skills", name, "SKILL.md"),
  lastActivity,
  ...extra,
})

describe("skill curator", () => {
  test("marks long-unused skills stale and archives older ones", () => {
    const now = Date.now()
    const decisions = Curator.plan({
      now,
      staleDays: 30,
      archiveDays: 90,
      skills: [
        skill("fresh", now - DAY),
        skill("stale", now - 40 * DAY),
        skill("archive", now - 120 * DAY),
        skill("already-stale", now - 40 * DAY, { staleMarked: true }),
        skill("builtin", now - 200 * DAY, { builtIn: true }),
      ],
    })

    expect(decisions).toEqual([
      { name: "stale", location: path.join(".novaway", "skills", "stale", "SKILL.md"), action: "stale", days: 40 },
      {
        name: "archive",
        location: path.join(".novaway", "skills", "archive", "SKILL.md"),
        action: "archive",
        days: 120,
      },
    ])
  })

  test("disables a phase when its day threshold is zero", () => {
    const now = Date.now()
    expect(Curator.plan({ now, staleDays: 0, archiveDays: 0, skills: [skill("old", now - 400 * DAY)] })).toEqual([])
  })

  test("archives skills out of the scan path and records the run", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "novaway-curator-"))
    const file = path.join(directory, ".novaway", "skills", "old-skill", "SKILL.md")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, "---\nname: old-skill\ndescription: old\n---\n\nbody\n")
    const now = Date.now()

    expect(await Curator.due(directory, now)).toBe(true)
    const decisions = await Curator.run({
      directory,
      now,
      staleDays: 30,
      archiveDays: 90,
      ledger: { "old-skill": { count: 1, lastUsed: now - 100 * DAY } },
      skills: [{ name: "old-skill", location: file, lastActivity: 0 }],
    })

    expect(decisions.map((item) => item.action)).toEqual(["archive"])
    const state = JSON.parse(await readFile(path.join(directory, Curator.STATE_FILE), "utf-8"))
    expect(state.lastRunAt).toBe(now)
    // A second run inside the weekly window is skipped.
    expect(await Curator.due(directory, now + DAY)).toBe(false)
    expect(await Curator.due(directory, now + 8 * DAY)).toBe(true)
  })
})

describe("skill usage ledger", () => {
  test("accumulates counts and last use per skill", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "novaway-usage-"))
    await Usage.record({ directory, name: "alpha", now: 1000 })
    await Usage.record({ directory, name: "alpha", now: 2000 })
    await Usage.record({ directory, name: "beta", now: 1500 })

    const ledger = await Usage.read(directory)
    expect(ledger).toEqual({
      alpha: { count: 2, lastUsed: 2000 },
      beta: { count: 1, lastUsed: 1500 },
    })
  })

  test("ignores malformed ledger entries", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "novaway-usage-bad-"))
    await mkdir(path.join(directory, ".novaway"), { recursive: true })
    await writeFile(path.join(directory, Usage.USAGE_FILE), JSON.stringify({ ok: { count: 1, lastUsed: 5 }, bad: {} }))
    expect(await Usage.read(directory)).toEqual({ ok: { count: 1, lastUsed: 5 } })
  })
})
