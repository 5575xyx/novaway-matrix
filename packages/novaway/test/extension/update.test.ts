import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { updates, type UpdateProbe } from "@/extension/marketplace"

async function install(config: string, dir: string, record: Record<string, unknown>) {
  const target = path.join(config, "marketplace", dir)
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, ".novaway-install.json"), JSON.stringify(record, null, 2))
  await fs.writeFile(path.join(target, "SKILL.md"), "# demo")
  return target
}

const gitRecord = {
  name: "ppt-master",
  kind: "git",
  source: "https://github.com/hugohe3/ppt-master",
  ref: "main",
  subdir: "skills",
  installedAt: 1,
}

function probe(overrides: Partial<UpdateProbe> = {}): UpdateProbe {
  return {
    localRevision: async () => "aaaa",
    remoteRevision: async () => "aaaa",
    archive: async () => ({ state: "unknown" }),
    ...overrides,
  }
}

async function tempConfig() {
  return fs.mkdtemp(path.join(os.tmpdir(), "novaway-update-"))
}

describe("marketplace updates", () => {
  test("archive installs compare the recorded ETag", async () => {
    const config = await tempConfig()
    await install(config, "ppt-master@main", { ...gitRecord, etag: "v1" })

    const same = await updates(config, { probe: probe({ archive: async () => ({ state: "current", etag: "v1" }) }) })
    expect(same[0]?.state).toBe("current")

    const changed = await updates(config, {
      probe: probe({ archive: async () => ({ state: "outdated", etag: "v2" }) }),
    })
    expect(changed[0]?.state).toBe("outdated")
    expect(changed[0]?.revision).toBe("v1")
    expect(changed[0]?.available).toBe("v2")
    await fs.rm(config, { recursive: true, force: true })
  })

  test("clone installs compare commit hashes", async () => {
    const config = await tempConfig()
    await install(config, "demo@main", { ...gitRecord, name: "demo", revision: "aaaa" })

    const current = await updates(config, { probe: probe() })
    expect(current[0]?.state).toBe("current")

    const outdated = await updates(config, { probe: probe({ remoteRevision: async () => "bbbb" }) })
    expect(outdated[0]?.state).toBe("outdated")
    expect(outdated[0]?.available).toBe("bbbb")
    await fs.rm(config, { recursive: true, force: true })
  })

  test("falls back to reading the local revision when the record has none", async () => {
    const config = await tempConfig()
    await install(config, "demo@main", { ...gitRecord, name: "demo" })
    const status = await updates(config, {
      probe: probe({
        localRevision: async () => "cccc",
        remoteRevision: async () => "cccc",
      }),
    })
    expect(status[0]?.state).toBe("current")
    expect(status[0]?.revision).toBe("cccc")
    await fs.rm(config, { recursive: true, force: true })
  })

  test("reports unknown instead of guessing when the remote cannot be reached", async () => {
    const config = await tempConfig()
    await install(config, "demo@main", { ...gitRecord, name: "demo", revision: "aaaa" })
    const status = await updates(config, { probe: probe({ remoteRevision: async () => undefined }) })
    expect(status[0]?.state).toBe("unknown")
    // 探测抛错也不能让整个接口失败。
    const broken = await updates(config, {
      probe: probe({
        remoteRevision: async () => {
          throw new Error("offline")
        },
      }),
    })
    expect(broken[0]?.state).toBe("unknown")
    expect(broken[0]?.error).toContain("offline")
    await fs.rm(config, { recursive: true, force: true })
  })

  test("zip installs are unknown (no remote manifest link)", async () => {
    const config = await tempConfig()
    await install(config, "zip-demo@1.0.0", {
      name: "zip-demo",
      kind: "zip",
      source: "https://example.com/a.zip",
      installedAt: 1,
    })
    const status = await updates(config, { probe: probe() })
    expect(status[0]?.state).toBe("unknown")
    await fs.rm(config, { recursive: true, force: true })
  })
})
