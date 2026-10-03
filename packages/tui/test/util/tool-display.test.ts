import { describe, expect, test } from "bun:test"
import {
  toolCommandParts,
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
    expect(toolStatusFailedText({ passed: 0, failed: 3 })).toBe(" · 3 failed")
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

// ── 两段摘要之间的那 1 列分隔 ────────────────────────────────────────────
//
// 原型 card-design-v7.html:932 是 `✓ 12 passed · 0 failed`:`·` **两侧各有一格空白**。
// 之前失败段的前缀是 `· `(点在前、空格在后),于是渲染出来是 `✓ 0 passed· 3 failed` ——
// 那 1 列分隔被 `·` 顶掉了。修法是把分隔挪到失败段的**左端**(` · 3 failed`),
// 于是「失败段自带它左边那一列」这条性质回到从前,列宽账也就仍然只由这两个串的显示列决定。
describe("状态摘要的分隔列", () => {
  // 渲染层就是 `passed` 紧接 `failed`(同一个 <text> 里两个 span,中间没有盒子的 gap),
  // 所以这一行拼起来必须与原型一字不差。
  const row = (summary: { passed: number; failed: number }) =>
    toolStatusPassedText(summary) + toolStatusFailedText(summary)

  test("三种组合拼起来都是 `N passed · M failed`(`·` 两侧各一格)", () => {
    expect(row({ passed: 12, failed: 0 })).toBe("✓ 12 passed")
    expect(row({ passed: 0, failed: 3 })).toBe("✓ 0 passed · 3 failed")
    expect(row({ passed: 12, failed: 3 })).toBe("✓ 12 passed · 3 failed")
  })

  test("零失败不留下一个悬空分隔符(也不在通过段尾部留空格)", () => {
    expect(toolStatusFailedText({ passed: 12, failed: 0 })).toBe("")
    expect(toolStatusPassedText({ passed: 12, failed: 0 })).toBe("✓ 12 passed")
    // 整行里不允许出现「通过段 + 一格空白 + 行尾」这种半个分隔符
    expect(row({ passed: 12, failed: 0 })).not.toMatch(/passed\s/)
  })

  test("失败段截断时左端那一列分隔仍在,整段仍然不超预算", () => {
    // 预算 9 列:` · 3 failed` 共 10 列,截到 9 → ` · 3 fai…`,左端空格保住。
    const failed = Locale.truncateToWidth(toolStatusFailedText({ passed: 12, failed: 3 }), 9)
    expect(failed).toBe(" · 3 fai…")
    expect(Locale.displayWidth(failed)).toBe(9)
    expect(failed.startsWith(" ·")).toBe(true)
  })

  test("失败段连左端那一列都放不下时整段省略,不留半截分隔符", () => {
    expect(Locale.truncateToWidth(toolStatusFailedText({ passed: 12, failed: 3 }), 0)).toBe("")
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

  test("通过段被截没时失败段整段不画(不留一个悬空的分隔符)", () => {
    // 预算 4 列:`✓ 12 passed` 截成 `✓ 12…`,剩下的 1 列留给失败段也只是 `…`。
    // 通过段整段为空时失败段必须整段省略 —— 否则渲染出来是行首一个孤零零的分隔。
    const layout = toolHeadLayout({ title: "", summary: { passed: 12, failed: 3 }, width: 0 })
    expect(layout).toEqual({ title: "", passed: "", failed: "" })
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
    // 失败段自带左端那一列分隔,所以它是 ` · 3 failed` 而不是 `· 3 failed`
    expect(layout.failed).toBe(" · 3 failed")
    expect(layout.title).toBe("T")
    // 列宽账:失败段左端那一列就是两段之间的分隔,不再额外扣一次 HEAD_GAP。
    // 标题 1 + 分隔 1 + 通过 `✓ 12 passed` 11 + 失败 ` · 3 failed` 11 = 24 ≤ 40。
    const columns =
      Locale.displayWidth(layout.title) + 1 + Locale.displayWidth(layout.passed) + Locale.displayWidth(layout.failed)
    expect(Locale.displayWidth(layout.passed)).toBe(11)
    expect(Locale.displayWidth(layout.failed)).toBe(11)
    expect(columns).toBe(24)
    expect(columns).toBeLessThanOrEqual(40)
  })

  test("两段摘要之间不再额外扣一列:预算正好卡在整行宽度上时标题仍然放得下", () => {
    // 整行 = 标题 1 + 分隔 1 + 通过 11 + 失败 11 = 24 列。给 24 列必须全放下,
    // 给 23 列时标题整段让光(摘要带结论,标题在正文里还会再出现一次)。
    const exact = toolHeadLayout({ title: "T", summary: { passed: 12, failed: 3 }, width: 24 })
    expect(exact.title).toBe("T")
    expect(exact.failed).toBe(" · 3 failed")
    const narrow = toolHeadLayout({ title: "T", summary: { passed: 12, failed: 3 }, width: 23 })
    expect(narrow.title).toBe("")
    expect(narrow.passed).toBe("✓ 12 passed")
    expect(narrow.failed).toBe(" · 3 failed")
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

// ── head 行里命令首词的切分(原型的 `.tool-head .cmd b { color: var(--cyan) }`)──
//
// 判据是「first + rest === 原文」:首词单独染色,余下部分原样,渲染层只管把两段拼回去。
// 不满足这一条时,染色要么吃掉一个空格、要么把命令改短 —— 两者都会让 head 行与工具输出对不上。
describe("toolCommandParts", () => {
  test("切出首词,余下部分保留分隔空格", () => {
    expect(toolCommandParts("bun test --timeout 30000")).toEqual({ first: "bun", rest: " test --timeout 30000" })
    // 拼回去必须一字不差
    const parts = toolCommandParts("bun test --timeout 30000")
    expect(parts.first + parts.rest).toBe("bun test --timeout 30000")
  })

  test("剥掉开头的路标符号,首词才是命令本身", () => {
    // 本仓库给标题加的 `#` / `←` / `◂` 不是命令的一部分;不剥的话首词永远是那个符号
    expect(toolCommandParts("# Running in app")).toEqual({ first: "Running", rest: " in app" })
    expect(toolCommandParts("← Edit src/index.ts")).toEqual({ first: "Edit", rest: " src/index.ts" })
    expect(toolCommandParts("◂ 补丁 src/a.ts")).toEqual({ first: "补丁", rest: " src/a.ts" })
  })

  test("只有一个词时余下部分为空串(而不是 undefined)", () => {
    expect(toolCommandParts("bun")).toEqual({ first: "bun", rest: "" })
  })

  test("空串与纯空白都不给出首词", () => {
    expect(toolCommandParts("").first).toBe("")
    // 纯空白没有首词可染,但仍要满足「拼回去是原文」——余下部分原样留着
    expect(toolCommandParts("   ").first).toBe("")
    expect(toolCommandParts("   ").first + toolCommandParts("   ").rest).toBe("   ")
  })
})
