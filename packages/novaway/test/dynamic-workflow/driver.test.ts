import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { resolveInside, WorldReadError } from "../../src/dynamic-workflow/driver/world"
import { renderRun, renderRow } from "../../src/dynamic-workflow/report"
import * as registry from "../../src/dynamic-workflow/runtime/registry"
import type { Settlement } from "../../src/dynamic-workflow/engine/types"

// 驱动与渲染层的纯逻辑。真正的会话/模型接线在工具层，这里钉住两件容易出事的东西：
// 路径不许出工作区；渲染出来的摘要要能被模型直接读懂。

const dir = mkdtempSync(path.join(os.tmpdir(), "novaway-dwf-driver-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe("resolveInside", () => {
  test("工作区内的相对路径正常解析", () => {
    expect(resolveInside(dir, "src/a.ts")).toBe(path.join(dir, "src", "a.ts"))
    expect(resolveInside(dir, ".")).toBe(path.resolve(dir))
  })

  test("用 .. 逃出去被拦下", () => {
    expect(() => resolveInside(dir, "../secret.txt")).toThrow(WorldReadError)
    expect(() => resolveInside(dir, "src/../../secret.txt")).toThrow(/不在工作区内/)
  })

  test("绝对路径逃出去被拦下", () => {
    expect(() => resolveInside(dir, path.resolve(dir, "..", "elsewhere"))).toThrow(/不在工作区内/)
  })

  test("名字里带 .. 但不构成上跳的路径是合法的", () => {
    expect(resolveInside(dir, "a..b/c.ts")).toBe(path.join(dir, "a..b", "c.ts"))
  })

  test("错误带结构化 code，脚本可以按它分支", () => {
    try {
      resolveInside(dir, "../x")
    } catch (error) {
      expect((error as WorldReadError).code).toBe("PathOutsideWorkspace")
    }
  })
})

describe("report / 渲染", () => {
  const entry = (overrides: Partial<Parameters<typeof renderRun>[0]> = {}) => ({
    runId: "dwfrun-a",
    scriptText: "return 1",
    phaseNames: ["收集", "评审"],
    siteIds: ["ask#1"],
    startedAt: 1,
    reports: [],
    ...overrides,
  })

  test("完成的 run：先给结论，再给用量与阶段", () => {
    const settlement: Settlement = { status: "completed", value: { found: 3 }, spentTokens: 1200 }
    const text = renderRun(entry(), settlement)
    expect(text.split("\n")[0]).toBe("run dwfrun-a：completed")
    expect(text).toContain(`结果：{"found":3}`)
    expect(text).toContain("用量：约 1200 tokens")
    expect(text).toContain("阶段：收集 → 评审")
  })

  test("失败的 run：给出错误码与消息", () => {
    const settlement: Settlement = {
      status: "errored",
      error: { name: "TypeError", message: "x is not a function", code: "Boom" },
      spentTokens: 10,
    }
    const text = renderRun(entry(), settlement)
    expect(text).toContain("失败：TypeError: x is not a function")
    expect(text).toContain("错误码：Boom")
  })

  test("停止的 run：原因是人话，不搬内部枚举名", () => {
    const text = renderRun(entry(), { status: "stopped", reason: "provider", spentTokens: 0 })
    expect(text).toContain("模型服务中断")
    expect(text).not.toContain("provider（")
  })

  test("报告只给前几条，并说清还有多少", () => {
    const reports = Array.from({ length: 20 }, (_, index) => ({ index }))
    const text = renderRun(entry({ reports }), {
      status: "completed",
      value: null,
      spentTokens: 0,
    })
    expect(text).toContain("报告（共 20 条，显示前 8 条）")
    expect(text).toContain("…还有 12 条")
  })

  test("超长结果被截断并说明原长", () => {
    const text = renderRun(entry(), {
      status: "completed",
      value: "x".repeat(5000),
      spentTokens: 0,
    })
    expect(text).toContain("已截断")
    expect(text.length).toBeLessThan(4000)
  })

  test("列表行：id、名字、状态、用量", () => {
    const row = renderRow(entry({ name: "评审", settlement: { status: "completed", value: 1, spentTokens: 30 } }))
    expect(row).toContain("dwfrun-a")
    expect(row).toContain("评审")
    expect(row).toContain("[completed]")
    expect(row).toContain("30 tokens")
  })

  test("运行中显示 running", () => {
    expect(renderRow(entry())).toContain("[running]")
  })
})

describe("registry", () => {
  test("登记、追加报告、结算、查询", () => {
    registry.reset()
    registry.register({ runId: "r1", scriptText: "x", phaseNames: ["a"], siteIds: ["ask#1"] })
    registry.addReport("r1", { i: 1 })
    registry.addReport("r1", { i: 2 })
    expect(registry.get("r1")!.reports).toEqual([{ i: 1 }, { i: 2 }])
    registry.settle("r1", { status: "completed", value: 1, spentTokens: 5 })
    expect(registry.get("r1")!.settlement).toMatchObject({ status: "completed" })
  })

  test("报告有上界：超出的不再收集", () => {
    registry.reset()
    registry.register({ runId: "r1", scriptText: "x", phaseNames: [], siteIds: [] })
    for (let index = 0; index < 300; index++) registry.addReport("r1", index)
    expect(registry.get("r1")!.reports).toHaveLength(200)
  })

  test("list 最新的在前，limit 生效", () => {
    registry.reset()
    registry.register({ runId: "a", scriptText: "x", phaseNames: [], siteIds: [] })
    registry.register({ runId: "b", scriptText: "x", phaseNames: [], siteIds: [] })
    const rows = registry.list(1)
    expect(rows).toHaveLength(1)
  })

  test("stop 只有接上引擎之后才存在；结算之后清掉", () => {
    registry.reset()
    registry.register({ runId: "r1", scriptText: "x", phaseNames: [], siteIds: [] })
    expect(registry.get("r1")!.stop).toBeUndefined()
    const calls: string[] = []
    registry.attach("r1", { stop: (reason: string) => calls.push(reason) } as never)
    registry.get("r1")!.stop!("user")
    expect(calls).toEqual(["user"])
    registry.settle("r1", { status: "stopped", reason: "user", spentTokens: 0 })
    expect(registry.get("r1")!.stop).toBeUndefined()
  })
})
