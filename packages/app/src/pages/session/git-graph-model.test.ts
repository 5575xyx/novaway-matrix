import { describe, expect, test } from "bun:test"
import { buildGitGraph, classifyRef } from "./git-graph-model"

const commit = (hash: string, parents: string[] = [], subject = hash) => ({
  hash,
  subject,
  author: "me",
  date: "2026-01-01",
  parents,
})

describe("buildGitGraph", () => {
  test("linear history stays in one lane", () => {
    const rows = buildGitGraph([commit("c", ["b"]), commit("b", ["a"]), commit("a")])
    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0])
    expect(rows[0].down).toEqual([{ from: 0, to: 0, color: 0 }])
    expect(rows[2].down).toEqual([])
  })

  test("a merge opens a second lane", () => {
    // m 合并 b 和 x，x 是另一条线的头
    const rows = buildGitGraph([commit("m", ["b", "x"]), commit("x", ["b"]), commit("b", ["a"]), commit("a")])
    expect(rows[0].lane).toBe(0)
    expect(rows[0].down.length).toBe(2)
    expect(rows[0].down[1].to).toBe(1)
    // 第二行（x）落在新开的列上
    expect(rows[1].lane).toBe(1)
    // 两条线在 b 汇合
    expect(rows[2].lane).toBe(0)
    expect(rows[2].through.length).toBe(0)
  })

  test("rows carry the lane count needed to draw verticals", () => {
    const rows = buildGitGraph([commit("a", ["b", "c"]), commit("c", ["b"]), commit("b")])
    expect(rows[0].laneCount).toBeGreaterThanOrEqual(2)
    expect(rows[0].fromTop).toBe(false)
    expect(rows[1].fromTop).toBe(true)
    for (const row of rows) expect(row.rowCount).toBe(3)
  })
})

describe("classifyRef", () => {
  test("distinguishes head, tags, remotes and local branches", () => {
    expect(classifyRef("HEAD -> main").kind).toBe("head")
    expect(classifyRef("tag: v1.0.0")).toEqual({ kind: "tag", label: "v1.0.0" })
    expect(classifyRef("origin/main").kind).toBe("remote")
    expect(classifyRef("main").kind).toBe("local")
  })
})
