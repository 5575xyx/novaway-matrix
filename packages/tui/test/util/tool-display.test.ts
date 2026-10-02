import { describe, expect, test } from "bun:test"
import {
  toolDisplayMetadata,
  toolHeadLayout,
  toolStatusFailedText,
  toolStatusPassedText,
  toolStatusSummary,
  webSearchProviderLabel,
} from "../../src/util/tool-display"
import { Locale } from "../../src/util/locale"

describe("webSearchProviderLabel", () => {
  test("labels known providers", () => {
    expect(webSearchProviderLabel("parallel")).toBe("Parallel Web Search")
    expect(webSearchProviderLabel("exa")).toBe("Exa Web Search")
  })

  for (const [name, provider] of [
    ["undefined", undefined],
    ["null", null],
    ["an object", {}],
    ["an array", []],
    ["a number", 1],
    ["an unexpected string", "other"],
  ] as const) {
    test(`uses the generic label for ${name}`, () => {
      expect(webSearchProviderLabel(provider)).toBe("Web Search")
    })
  }
})

describe("toolDisplayMetadata", () => {
  test("returns structured metadata for non-pending states", () => {
    const structured = { provider: "parallel", numResults: 3 }

    expect(toolDisplayMetadata({ status: "running", structured })).toBe(structured)
    expect(toolDisplayMetadata({ status: "completed", structured })).toBe(structured)
    expect(toolDisplayMetadata({ status: "error", structured })).toBe(structured)
  })

  test("does not expose pending or malformed metadata", () => {
    expect(toolDisplayMetadata({ status: "pending", structured: { provider: "exa" } })).toEqual({})
    expect(toolDisplayMetadata({ status: "completed" })).toEqual({})
    expect(toolDisplayMetadata({ status: "completed", structured: null })).toEqual({})
    expect(toolDisplayMetadata({ status: "completed", structured: [] })).toEqual({})
    expect(toolDisplayMetadata(undefined)).toEqual({})
  })
})

// ── 工具卡 head 行的状态摘要(任务 C3)──────────────────────────────────────
//
// 解析规则只有一条意图:**输出里报了测试结果,才给摘要**。所以负向用例与正向一样重要 ——
// 任何不含 pass/fail 计数的输出都必须整项省略,而不是显示 `✓ 0 passed`。
describe("toolStatusSummary", () => {
  // bun 1.3 实测打印的是 ` 12 pass` / ` 1 fail`(不带 -ed),原型那句 `12 passed · 0 failed`
  // 是 jest 的写法。两种拼写都要认,否则本仓库自己的 bun test 命中不了。
  test("认 bun 的 pass/fail 汇总行", () => {
    const output = ["bun test v1.3.14", "(pass) card.test.ts (14ms)", " 12 pass", " 0 fail", "Ran 12 tests."].join("\n")
    expect(toolStatusSummary(output)).toEqual({ passed: 12, failed: 0 })
  })

  test("认 jest / vitest / pytest 的 passed/failed 写法", () => {
    expect(toolStatusSummary("Tests:       1 failed, 11 passed, 12 total")).toEqual({ passed: 11, failed: 1 })
    expect(toolStatusSummary("Tests  1 failed | 11 passed (12)")).toEqual({ passed: 11, failed: 1 })
    expect(toolStatusSummary("1 failed, 1 passed in 0.12s")).toEqual({ passed: 1, failed: 1 })
  })

  test("零通过全失败也要给摘要 —— 「全挂了」正是最该看见的一条", () => {
    expect(toolStatusSummary(" 0 pass\n 3 fail")).toEqual({ passed: 0, failed: 3 })
    expect(toolStatusPassedText({ passed: 0, failed: 3 })).toBe("✓ 0 passed")
    expect(toolStatusFailedText({ passed: 0, failed: 3 })).toBe("· 3 failed")
  })

  test("只报一半也算数:只有失败数时通过数补 0", () => {
    expect(toolStatusSummary("Tests: 2 failed")).toEqual({ passed: 0, failed: 2 })
    expect(toolStatusSummary("Tests: 7 passed")).toEqual({ passed: 7, failed: 0 })
  })

  test("error 数只用来把失败数顶高,自己不足以让摘要出现", () => {
    expect(toolStatusSummary("11 passed, 2 errors")).toEqual({ passed: 11, failed: 2 })
    // 编译日志 / LSP 诊断里满是 `3 errors`,那种输出不是测试结果
    expect(toolStatusSummary("tsc: 3 errors found")).toBeUndefined()
  })

  test("大小写不敏感,词尾边界挡住 password / passing 这类词", () => {
    expect(toolStatusSummary("12 PASSED")).toEqual({ passed: 12, failed: 0 })
    expect(toolStatusSummary("1 password, 2 passing")).toBeUndefined()
    expect(toolStatusSummary("3 failover")).toBeUndefined()
  })

  test("没有匹配 / 空输出 / 纯中文输出都整项省略", () => {
    expect(toolStatusSummary("ok")).toBeUndefined()
    expect(toolStatusSummary("")).toBeUndefined()
    expect(toolStatusSummary(undefined)).toBeUndefined()
    expect(toolStatusSummary("全部通过,没有失败")).toBeUndefined()
    expect(toolStatusSummary("退出码 0")).toBeUndefined()
  })
})

describe("toolHeadLayout", () => {
  const summary = { passed: 12, failed: 0 }

  test("宽度够:标题与摘要原样并排,中间留 1 列", () => {
    const layout = toolHeadLayout({ title: "# Running in app", summary, width: 60 })
    expect(layout.title).toBe("# Running in app")
    expect(layout.passed).toBe("✓ 12 passed")
    expect(layout.failed).toBe("")
    // 17 列标题 + 1 列分隔 + 11 列摘要 = 29,没超预算
    expect(layout.title.length + 1 + layout.passed.length).toBeLessThanOrEqual(60)
  })

  test("零失败不画失败段 —— 原型的 `· 0 failed` 是假信息", () => {
    expect(toolStatusFailedText(summary)).toBe("")
    expect(toolHeadLayout({ title: "T", summary, width: 60 }).failed).toBe("")
  })

  test("宽度不够时先牺牲标题(摘要带结论,标题在正文里还会再出现一次)", () => {
    const long = "# Running in /home/user/novaway/packages/novaway"
    // 摘要 11 列 + 1 列分隔,剩下的全给标题
    const layout = toolHeadLayout({ title: long, summary, width: 20 })
    expect(layout.passed).toBe("✓ 12 passed")
    expect(layout.failed).toBe("")
    expect(layout.title).toBe("# Runni…")
    expect(Locale.displayWidth(layout.title) + 1 + Locale.displayWidth(layout.passed)).toBeLessThanOrEqual(20)
    // 再窄一档,标题整段让光 —— 只剩摘要,而不是半句标题 + 半句摘要
    expect(toolHeadLayout({ title: long, summary, width: 12 })).toEqual({
      title: "",
      passed: "✓ 12 passed",
      failed: "",
    })
  })

  test("有失败时两段摘要都在,总宽仍不超预算", () => {
    const layout = toolHeadLayout({ title: "T", summary: { passed: 12, failed: 3 }, width: 40 })
    expect(layout.passed).toBe("✓ 12 passed")
    expect(layout.failed).toBe("· 3 failed")
    expect(layout.title).toBe("T")
  })

  test("窄到摘要自己都放不下时按列截断并留省略号,不留半截", () => {
    const layout = toolHeadLayout({ title: "", summary, width: 6 })
    expect(layout.passed).toBe("✓ 12 …")
    expect(layout.title).toBe("")
  })

  test("没有摘要时标题按预算截断,不凭空多出分隔列", () => {
    expect(toolHeadLayout({ title: "abcdefghij", width: 5 })).toEqual({ title: "abcd…", passed: "", failed: "" })
  })

  test("没有标题时摘要独占整行,不预留分隔列", () => {
    expect(toolHeadLayout({ summary, width: 12 })).toEqual({ title: "", passed: "✓ 12 passed", failed: "" })
  })

  test("宽度 0 与负宽度都不会越界(负数来自极窄终端下的 Math.max 兜底)", () => {
    expect(toolHeadLayout({ title: "abc", summary, width: 0 })).toEqual({ title: "", passed: "", failed: "" })
    expect(toolHeadLayout({ title: "abc", summary, width: -5 })).toEqual({ title: "", passed: "", failed: "" })
  })
})
