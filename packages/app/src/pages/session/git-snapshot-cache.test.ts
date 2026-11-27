import { beforeEach, describe, expect, test } from "bun:test"
import {
  clearGitSnapshotCache,
  gitActivityRecent,
  gitSnapshotKey,
  noteGitActivity,
  readGitSnapshot,
  subscribeGitSnapshot,
} from "./git-snapshot-cache"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => clearGitSnapshotCache())

describe("readGitSnapshot", () => {
  test("collapses concurrent reads into a single request", async () => {
    let calls = 0
    const load = async () => {
      calls++
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { data: { branch: { branch: "main" } } }
    }

    const key = gitSnapshotKey("http://127.0.0.1:4096", "C:/demo")
    const [a, b, c] = await Promise.all([
      readGitSnapshot({ key, load }),
      readGitSnapshot({ key, load }),
      readGitSnapshot({ key, load }),
    ])

    expect(calls).toBe(1)
    expect(a.data).toEqual(b.data)
    expect(b.data).toEqual(c.data)
  })

  test("reuses a fresh result inside the TTL window", async () => {
    let calls = 0
    const load = async () => {
      calls++
      return { data: { calls } }
    }
    const key = gitSnapshotKey("http://127.0.0.1:4096", "C:/demo")

    await readGitSnapshot({ key, load, maxAgeMs: 5_000 })
    const second = await readGitSnapshot({ key, load, maxAgeMs: 5_000 })

    expect(calls).toBe(1)
    expect(second.data).toEqual({ calls: 1 })
  })

  test("refetches once the cached entry is older than the TTL", async () => {
    let calls = 0
    const load = async () => {
      calls++
      return { data: { calls } }
    }
    const key = gitSnapshotKey("http://127.0.0.1:4096", "C:/demo")

    await readGitSnapshot({ key, load, maxAgeMs: 0 })
    const second = await readGitSnapshot({ key, load, maxAgeMs: 0 })

    expect(calls).toBe(2)
    expect(second.data).toEqual({ calls: 2 })
  })

  test("keeps failures for the TTL window instead of hammering the server", async () => {
    let calls = 0
    const load = async () => {
      calls++
      throw new Error("not a git repository")
    }
    const key = gitSnapshotKey("http://127.0.0.1:4096", "C:/demo")

    await expect(readGitSnapshot({ key, load, maxAgeMs: 5_000 })).rejects.toThrow("not a git repository")
    await expect(readGitSnapshot({ key, load, maxAgeMs: 5_000 })).rejects.toThrow("not a git repository")

    expect(calls).toBe(1)
  })

  test("keys are isolated per directory", async () => {
    let calls = 0
    const load = async () => {
      calls++
      return { data: { calls } }
    }

    await readGitSnapshot({ key: gitSnapshotKey("http://127.0.0.1:4096", "C:/a"), load, maxAgeMs: 5_000 })
    await readGitSnapshot({ key: gitSnapshotKey("http://127.0.0.1:4096", "C:/b"), load, maxAgeMs: 5_000 })

    expect(calls).toBe(2)
  })
})

describe("subscribeGitSnapshot", () => {
  test("多个订阅方共用一次请求并各自收到广播", async () => {
    let calls = 0
    const load = async () => {
      calls++
      return { data: { calls } }
    }
    const key = gitSnapshotKey("http://127.0.0.1:4096", "C:/shared")
    const got: number[] = []

    const a = subscribeGitSnapshot<{ calls: number }>({
      key,
      load,
      fast: 1000,
      idle: 1000,
      onResult: (data) => got.push(data!.calls),
      onError: () => undefined,
    })
    const b = subscribeGitSnapshot<{ calls: number }>({
      key,
      load,
      fast: 1000,
      idle: 1000,
      onResult: (data) => got.push(data!.calls),
      onError: () => undefined,
    })

    try {
      await sleep(10)
      expect(calls).toBe(1)
      expect(got.length).toBe(2)
    } finally {
      a.stop()
      b.stop()
    }
  })

  test("退订最后一个订阅者后彻底停表", async () => {
    let calls = 0
    const load = async () => {
      calls++
      return { data: { calls } }
    }
    const key = gitSnapshotKey("http://127.0.0.1:4096", "C:/teardown")
    const sub = subscribeGitSnapshot<{ calls: number }>({
      key,
      load,
      fast: 10,
      idle: 10,
      maxAgeMs: 0,
      onResult: () => undefined,
      onError: () => undefined,
    })
    try {
      await sleep(60)
      expect(calls).toBeGreaterThan(1)
      sub.stop()
      const settled = calls
      await sleep(60)
      expect(calls).toBe(settled)
    } finally {
      sub.stop()
    }
  })

  test("有写入打点时走 fast 档，空闲走 idle 档", async () => {
    let calls = 0
    const load = async () => {
      calls++
      return { data: { calls } }
    }
    const activeKey = gitSnapshotKey("http://127.0.0.1:4096", "C:/active")
    const idleKey = gitSnapshotKey("http://127.0.0.1:4096", "C:/idle")
    let activeHits = 0
    let idleHits = 0

    const active = subscribeGitSnapshot<{ calls: number }>({
      key: activeKey,
      load,
      fast: 10,
      idle: 10_000,
      maxAgeMs: 0,
      onResult: () => activeHits++,
      onError: () => undefined,
    })
    const idle = subscribeGitSnapshot<{ calls: number }>({
      key: idleKey,
      load,
      fast: 10,
      idle: 10_000,
      onResult: () => idleHits++,
      onError: () => undefined,
    })

    try {
      noteGitActivity(activeKey)
      expect(gitActivityRecent(activeKey)).toBe(true)
      await sleep(60)
      expect(activeHits).toBeGreaterThan(1)
      // 空闲目录只有订阅时那一次，不会跟到 fast 节拍上
      expect(idleHits).toBe(1)
    } finally {
      active.stop()
      idle.stop()
    }
  })
})
