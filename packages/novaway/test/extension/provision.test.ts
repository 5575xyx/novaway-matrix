import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@novaway/core/global"
import type { BuiltinExtension } from "@novaway/core/builtin-extensions"
import type { Installed } from "@/extension/marketplace"
import { dismiss, provisionBuiltins, readState, undismiss, type ProvisionDeps } from "@/extension/provision"
import * as Generation from "@/extension/generation"

const entry: BuiltinExtension = {
  name: "demo-extension",
  version: "1.0.0",
  description: "demo",
  kind: "git",
  url: "https://github.com/example/demo",
  ref: "main",
  subdir: "skills",
  autoInstall: true,
}

const stateFile = path.join(Global.Path.data, "extension-provision.json")

afterEach(async () => {
  await fs.rm(stateFile, { force: true })
})

function installed(root: string): Installed {
  return { name: entry.name, kind: "git", source: entry.url, installedAt: Date.now(), root, files: 1, bytes: 1 }
}

type FakeDeps = ProvisionDeps & {
  counter: { installs: string[]; python: string[]; bumps: number }
}

function deps(overrides: Partial<ProvisionDeps> = {}): FakeDeps {
  const counter = { installs: [] as string[], python: [] as string[], bumps: 0 }
  const base: ProvisionDeps = {
    entries: [entry],
    list: async () => [],
    install: async (item: BuiltinExtension) => {
      counter.installs.push(item.name)
      return { root: "C:/fake/" + item.name }
    },
    preparePython: async (root: string) => {
      counter.python.push(root)
      return "prepared" as const
    },
    bump: () => {
      counter.bumps += 1
    },
    ...overrides,
  }
  return { ...base, counter }
}

describe("extension.provision", () => {
  test("installs a missing builtin, bumps the generation and prepares python", async () => {
    const fake = deps()
    const report = await provisionBuiltins({ deps: fake })
    expect(report.entries).toEqual([{ name: entry.name, status: "installed", installedNow: true, python: "prepared" }])
    expect(fake.counter.installs).toEqual([entry.name])
    expect(fake.counter.python).toEqual(["C:/fake/" + entry.name])
    expect(fake.counter.bumps).toBe(1)
    expect((await readState())[entry.name]?.status).toBe("installed")
  })

  test("is idempotent: an already installed entry is not downloaded again", async () => {
    const fake = deps({ list: async () => [installed("C:/installed/demo")] })
    const report = await provisionBuiltins({ deps: fake })
    expect(report.entries[0]?.installedNow).toBe(false)
    expect(fake.counter.installs).toEqual([])
    expect(fake.counter.python).toEqual(["C:/installed/demo"])
  })

  test("remembers a manual uninstall and skips the entry next boot", async () => {
    await dismiss(entry.name)
    const fake = deps()
    const report = await provisionBuiltins({ deps: fake })
    expect(report.entries[0]?.status).toBe("skipped")
    expect(fake.counter.installs).toEqual([])

    await undismiss(entry.name)
    await provisionBuiltins({ deps: deps() })
    expect((await readState())[entry.name]?.dismissed).toBeFalsy()
  })

  test("records failures with an attempt count instead of throwing", async () => {
    const fake = deps({
      install: async () => {
        throw new Error("network unreachable")
      },
    })
    const report = await provisionBuiltins({ deps: fake })
    expect(report.entries[0]?.status).toBe("failed")
    expect(report.entries[0]?.error).toContain("network unreachable")
    const saved = (await readState())[entry.name]
    expect(saved?.status).toBe("failed")
    expect(saved?.attempts).toBe(1)
  })

  test("a failing python environment does not fail the install", async () => {
    const fake = deps({
      preparePython: async () => {
        throw new Error("pip exploded")
      },
    })
    const report = await provisionBuiltins({ deps: fake })
    expect(report.entries[0]?.status).toBe("installed")
    expect(report.entries[0]?.python).toBe("failed")
  })

  test("generation bumps let cached extension lists notice the new install", async () => {
    const before = Generation.current()
    await provisionBuiltins({ deps: deps({ bump: Generation.bump }) })
    expect(Generation.current()).toBeGreaterThan(before)
  })

  test("only the requested entries are provisioned", async () => {
    const other: BuiltinExtension = { ...entry, name: "other-extension" }
    const fake = deps({ entries: [entry, other] })
    const report = await provisionBuiltins({ names: ["other-extension"], deps: fake })
    expect(report.entries.map((item) => item.name)).toEqual(["other-extension"])
  })
})
