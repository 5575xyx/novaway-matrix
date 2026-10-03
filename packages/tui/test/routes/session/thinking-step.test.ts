import { describe, expect, test } from "bun:test"
import { displayWidth } from "../../../src/util/locale"
import { messageColumns } from "../../../src/routes/session/message-anchor"
import { workingStepTitle, workingTitleColumns, type WorkingPart } from "../../../src/routes/session/thinking-step"

// 目标之外那些定长段的合计(与 thinking-step 的 FIXED_COLUMNS 同一份拆解):
// `✦ 分析 `(7)+ 目标与动词之间的 1 + 动词(4)+ 与计时之间的 1 + 计时(8)= 21。
const FIXED_COLUMNS = 21
// 目标的下限:预算不足这个列数就整段不画。
const MIN_TARGET_COLUMNS = 8

const reasoning = (text: string): WorkingPart => ({ type: "reasoning", text })
const tool = (status: string, input?: Record<string, unknown>): WorkingPart => ({
  type: "tool",
  state: { status, input },
})
const text = (value: string): WorkingPart => ({ type: "text", text: value })

// 48 列终端:消息列 37,再扣这一行自己的 2 列缩进 → 标题行 35 列 → 目标预算 14 列。
const COLUMNS = workingTitleColumns(48)
const BUDGET = COLUMNS - FIXED_COLUMNS

describe("workingTitleColumns:列预算跟着消息列走", () => {
  test("预算 = 消息列 − 这一行自己的缩进", () => {
    expect(COLUMNS).toBe(messageColumns(48) - 2)
    expect(COLUMNS).toBe(35)
    // 宽屏同样按 78% 收窄,不是按整列
    expect(workingTitleColumns(120)).toBe(messageColumns(120) - 2)
    expect(workingTitleColumns(200)).toBeLessThan(200 - 2)
    // 再窄也不给负数
    expect(workingTitleColumns(0)).toBe(0)
    expect(workingTitleColumns(1)).toBe(0)
  })
})

describe("workingStepTitle:动词由步骤种类决定", () => {
  test("推理 / 执行 / 作答 三档对应 reasoning / tool / text", () => {
    expect(workingStepTitle([reasoning("在想")], COLUMNS).verb).toBe("推理")
    expect(workingStepTitle([tool("running", { command: "bun test" })], COLUMNS).verb).toBe("执行")
    expect(workingStepTitle([text("答案")], COLUMNS).verb).toBe("作答")
  })

  test("取最后一个有正文的 part:推理之后开始作答,动词就换成作答", () => {
    expect(workingStepTitle([reasoning("在想"), text("答")], COLUMNS).verb).toBe("作答")
    expect(workingStepTitle([reasoning("在想"), tool("running", {})], COLUMNS).verb).toBe("执行")
  })

  test("没有可判定的 part 时既没有动词也没有目标 —— 不拿别的词凑", () => {
    // step-start / step-finish 不带正文也不带输入,不构成「一步」
    expect(workingStepTitle([{ type: "step-start" }, { type: "step-finish" }], COLUMNS)).toEqual({})
    expect(workingStepTitle([], COLUMNS)).toEqual({})
    expect(workingStepTitle(undefined, COLUMNS)).toEqual({})
  })
})

describe("workingStepTitle:目标取自真实数据", () => {
  test("在飞的工具:输入里的 filePath 就是它接下来真要动的那个文件", () => {
    const title = workingStepTitle([tool("running", { filePath: "src/index.tsx" })], COLUMNS)
    expect(title.target).toBe("src/index.tsx")
    expect(title.verb).toBe("执行")
  })

  test("pending 也算在飞;跑完的工具不算(它的目标已经不是「正在看的东西」)", () => {
    expect(workingStepTitle([tool("pending", { path: "locale.ts" })], COLUMNS).target).toBe("locale.ts")
    expect(workingStepTitle([tool("completed", { filePath: "locale.ts" })], COLUMNS).target).toBeUndefined()
    expect(workingStepTitle([tool("error", { filePath: "locale.ts" })], COLUMNS).target).toBeUndefined()
  })

  test("在飞的工具没有路径字段时,退到最新那块推理正文里提到的路径", () => {
    const parts: WorkingPart[] = [reasoning("先看看 queue-dock.tsx 怎么拼的"), tool("running", { command: "bun test" })]
    const title = workingStepTitle(parts, COLUMNS)
    expect(title.verb).toBe("执行")
    expect(title.target).toBe("queue-dock.tsx")
  })

  test("正文里只有符号时取符号:dotted / 调用点 / 驼峰三种形状", () => {
    expect(workingStepTitle([reasoning("path.extname 那段")], COLUMNS).target).toBe("path.extname")
    expect(workingStepTitle([reasoning("先调 draftPreview() 看看")], COLUMNS).target).toBe("draftPreview()")
    expect(workingStepTitle([reasoning("messageColumns 那个上限")], COLUMNS).target).toBe("messageColumns")
  })

  test("路径优先于符号:两者都在正文里时取路径", () => {
    expect(workingStepTitle([reasoning("WorkingLine 在 src/index.tsx 里")], COLUMNS).target).toBe("src/index.tsx")
  })

  test("只看最新那块推理:更早那块的路径不会被拿来顶替", () => {
    const parts: WorkingPart[] = [reasoning("先看 src/early.ts"), reasoning("其实要看的是 bunfig.toml"), text("答")]
    expect(workingStepTitle(parts, COLUMNS).target).toBe("bunfig.toml")
  })

  test("散文与缩写不会被当成目标:e.g / 3.5s / 普通句子都不命中", () => {
    expect(workingStepTitle([reasoning("这个方案 e.g. 那样就行,耗时 3.5s 左右")], COLUMNS).target).toBeUndefined()
    expect(workingStepTitle([reasoning("先确认一下整体思路再动手")], COLUMNS).target).toBeUndefined()
  })

  test("推理正文为空时不画目标", () => {
    expect(workingStepTitle([reasoning("")], COLUMNS)).toEqual({ verb: "推理" })
    expect(workingStepTitle([reasoning("   ")], COLUMNS)).toEqual({ verb: "推理" })
  })
})

describe("workingStepTitle:窄终端下降级", () => {
  test("预算够时目标原样保留", () => {
    const title = workingStepTitle([reasoning("看 src/index.tsx")], COLUMNS)
    expect(title.target).toBe("src/index.tsx")
    expect(displayWidth(title.target!)).toBeLessThanOrEqual(BUDGET)
  })

  test("超预算时从中间截,头尾各留一段(路径的尾部才是「哪个文件」)", () => {
    const parts: WorkingPart[] = [reasoning("看 packages/tui/src/routes/session/queue-dock.tsx")]
    // 48 列终端上整条路径(46 列)放不进 14 列的预算
    const target = workingStepTitle(parts, COLUMNS).target!
    expect(displayWidth(target)).toBeLessThanOrEqual(BUDGET)
    expect(target).toContain("…")
    // 头尾都还在:头是包名那一段,尾带着扩展名 —— 比「只留头的 packages/tui」多认出一个 tsx
    expect(target.startsWith("package")).toBe(true)
    expect(target.endsWith(".tsx")).toBe(true)
    // 预算够大时整条路径原样保留,一个字符都不截
    expect(workingStepTitle(parts, 80).target).toBe("packages/tui/src/routes/session/queue-dock.tsx")
  })

  test("预算跌破目标下限就整段不画,动词仍在(降级是少一段,不是多一截碎片)", () => {
    const parts: WorkingPart[] = [reasoning("看 src/routes/session/index.tsx")]
    // 下限那一列还画,截出来的是这一档的真实样子(头 3 列 + 省略号 + 扩展名)
    const floor = workingStepTitle(parts, MIN_TARGET_COLUMNS + FIXED_COLUMNS)
    expect(floor.target).toBe("src/…tsx")
    // 再窄一列:目标整段消失,动词不受影响
    const narrow = workingStepTitle(parts, MIN_TARGET_COLUMNS + FIXED_COLUMNS - 1)
    expect(narrow.target).toBeUndefined()
    expect(narrow.verb).toBe("推理")
  })

  test("降级的临界宽度落在消息列上:主区 39 列以内目标整段不画", () => {
    const parts: WorkingPart[] = [reasoning("看 src/routes/session/index.tsx")]
    // 目标预算 = messageColumns(ctxWidth) − 2 − 21,要够到下限 8 就需要消息列 ≥ 31
    expect(MIN_TARGET_COLUMNS + FIXED_COLUMNS).toBe(29)
    expect(messageColumns(40)).toBe(31)
    expect(messageColumns(39)).toBe(30)
    expect(workingStepTitle(parts, workingTitleColumns(40)).target).toBeDefined()
    expect(workingStepTitle(parts, workingTitleColumns(39)).target).toBeUndefined()
  })

  test("48 列终端上整行放得下:前缀 + 目标 + 分隔 + 动词 + 弹性空隙 + 计时 ≤ 行预算", () => {
    const title = workingStepTitle([tool("running", { filePath: "src/routes/session/index.tsx" })], COLUMNS)
    // 左段 = `✦ 分析 `(7) + 目标 + 1 + 动词(4);右段 = 弹性空隙(≥1)+ 计时(最宽 8)
    const left = 7 + displayWidth(title.target!) + 1 + displayWidth(title.verb!)
    expect(left + 1 + 8).toBeLessThanOrEqual(COLUMNS)
    // 反向钉一次:没截断的目标(12 列的 src/index.tsx)也一样放得下
    const exact = workingStepTitle([tool("running", { filePath: "src/index.tsx" })], COLUMNS)
    expect(7 + displayWidth(exact.target!) + 1 + 4 + 1 + 8).toBeLessThanOrEqual(COLUMNS)
  })
})
