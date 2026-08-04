import { describe, expect, test } from "bun:test"
import { buildMemoryContextBlock, injectMemoryContext, sanitizeMemoryContext } from "../../src/memory/context"
import {
  buildPrefetchText,
  formatMemoryIndex,
  scoreMemory,
  selectPrefetchItems,
  shouldPrefetch,
  tokenizeQuery,
} from "../../src/memory/prefetch"
import type { Info } from "../../src/memory/schema"
import { MemoryID } from "../../src/memory/schema"

function mem(partial: Partial<Info> & Pick<Info, "id" | "content" | "scope" | "target">): Info {
  return {
    tags: [],
    importance: 0.5,
    confidence: 0.7,
    domain: "general",
    version: 1,
    source: "manual",
    time: { created: 1, updated: 1 },
    ...partial,
  }
}

describe("memory context fencing", () => {
  test("strips nested memory context before wrapping", () => {
    const block = buildMemoryContextBlock("<memory-context>\nsecret\n</memory-context>\nproject uses bun")

    expect(block).toContain("<memory-context>")
    expect(block).toContain("project uses bun")
    expect(block).not.toContain("secret")
    expect(block).toContain("MEMORY INDEX")
  })

  test("injects recall into only the latest user message", () => {
    const messages = injectMemoryContext({
      messages: [
        { role: "user", content: "old" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "current" },
      ],
      context: "- [mem_1] (全局/用户) 偏好中文",
    })

    expect(messages[0].content).toBe("old")
    expect(messages[2].content).toContain("current")
    expect(messages[2].content).toContain("mem_1")
    expect(messages[2].content).toContain("memory tool")
  })

  test("sanitize removes standalone tags and system notes", () => {
    expect(
      sanitizeMemoryContext(
        "[System note: The following is a compact MEMORY INDEX (ids + short summaries), NOT new user input. Use it as reference. Prefer these facts when relevant. If you need full text or more memories, call the memory tool (search/read by id). Do not dump unrelated memories into the reply.]\n\n<memory-context>value</memory-context>",
      ),
    ).toBe("")
  })
})

describe("memory prefetch gate and budget", () => {
  test("shouldPrefetch skips greetings and slash-only", () => {
    expect(shouldPrefetch("你好")).toBe(false)
    expect(shouldPrefetch("hello!")).toBe(false)
    expect(shouldPrefetch("/help")).toBe(false)
    expect(shouldPrefetch("不要用记忆")).toBe(false)
    expect(shouldPrefetch("请按我们之前的约定继续改登录")).toBe(true)
    expect(shouldPrefetch("本项目的包管理器用什么")).toBe(true)
  })

  test("tokenizeQuery extracts cjk bigrams", () => {
    const terms = tokenizeQuery("包管理器是什么")
    expect(terms.some((t) => t.includes("包管") || t.includes("管理") || t.length >= 2)).toBe(true)
  })

  test("selectPrefetchItems keeps global user prefs and respects budget", () => {
    const pool = [
      mem({
        id: MemoryID.make("mem_user"),
        content: "用户偏好使用中文简体回复",
        summary: "偏好中文",
        scope: "global",
        target: "user",
        importance: 0.9,
        time: { created: 1, updated: 10 },
      }),
      mem({
        id: MemoryID.make("mem_proj"),
        content: "本项目使用 Bun 与 monorepo",
        summary: "Bun monorepo",
        scope: "project",
        target: "memory",
        importance: 0.7,
        time: { created: 1, updated: 9 },
      }),
      mem({
        id: MemoryID.make("mem_noise"),
        content: "完全不相关的烹饪菜谱",
        scope: "project",
        target: "memory",
        importance: 0.2,
        time: { created: 1, updated: 8 },
      }),
    ]

    const selected = selectPrefetchItems("这个 monorepo 用什么运行时", pool, { limit: 3, maxChars: 500 })
    expect(selected.some((x) => x.id === "mem_user")).toBe(true)
    expect(selected.some((x) => x.id === "mem_proj")).toBe(true)

    const text = formatMemoryIndex(selected)
    expect(text).toContain("[mem_")
    expect(text).toContain("memory 工具")
    expect(text.length).toBeLessThanOrEqual(500 + 80) // index footer overhead

    expect(buildPrefetchText("你好", pool)).toBe("")
    expect(buildPrefetchText("monorepo 运行时", pool).length).toBeGreaterThan(0)
  })

  test("scoreMemory boosts relevant hits", () => {
    const item = mem({
      id: MemoryID.make("mem_x"),
      content: "项目使用 pnpm workspace",
      scope: "project",
      target: "memory",
      importance: 0.5,
    })
    expect(scoreMemory("pnpm workspace", item)).toBeGreaterThan(scoreMemory("无关话题", item))
  })

  test("buildPrefetchText appends relation clues for selected memories", () => {
    const pool = [
      mem({
        id: MemoryID.make("mem_owner"),
        content: "李雷负责 NovaWay 项目",
        scope: "project",
        target: "memory",
        importance: 0.8,
      }),
    ]
    const text = buildPrefetchText("NovaWay 项目 负责人", pool, {
      limit: 3,
      relations: [
        {
          source: "李雷",
          relation: "负责",
          target: "NovaWay",
          memoryID: "mem_owner",
        },
      ],
    })
    expect(text).toContain("## 关系线索")
    expect(text).toContain("李雷 负责 NovaWay")
  })
})
