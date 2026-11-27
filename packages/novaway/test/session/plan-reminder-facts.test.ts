import { describe, expect, test } from "bun:test"
import path from "node:path"
import { planReminderFacts } from "../../src/session/prompt"

/**
 * `planReminderFacts` 决定计划模式提示词"要求模型做的事是不是它真能做到的"。
 *
 * 本次线上事故的根因就是这个判据不存在：提示词无条件写"把计划写到 <plan>"、
 * "最后调用 plan_exit"，而实际下发的工具列表里既没有 `plan_exit`、agent 也没有
 * 写工具 —— 模型只能反复试 write → edit → bash，10 轮过去一个字节没落盘。
 *
 * 判错的方向不对称：
 * - 说"能写"但实际不能 → 模型空转（事故形态）；
 * - 说"不能写"但实际能 → 模型把计划贴在回复里，用户少拿一个文件，不影响正确性。
 * 所以这里宁可保守，两个能力都得同时满足"会话不是 global"和"agent 的工具配置允许"。
 *
 * 有一条口径必须和 `tool/registry.ts` 严格一致，否则判据就是假的：
 * 空数组 `tools: []` 在两边都表示"不限制"，而不是"一个工具都不给"
 * （registry 写的是 `input.agent.tools?.length ? new Set(...) : undefined`）。
 */
describe("planReminderFacts", () => {
  /** 默认按最普通的项目会话调用，只覆盖用例真正关心的字段。 */
  const facts = (input: {
    scope?: string
    agent?: { tools?: readonly string[]; disallowedTools?: readonly string[] }
  }) => planReminderFacts({ scope: input.scope ?? "project", agent: input.agent })

  test("a global session may neither write the plan nor exit planning", () => {
    // global 会话不解析任何工具（registry 直接把列表清空），所以哪怕 agent 声明了
    // 全套写工具，实际一个都下发不到 —— 两个能力都必须关掉。
    expect(
      facts({ scope: "global", agent: { tools: ["read", "write", "edit", "bash", "plan_exit"] } }),
    ).toEqual({ canExitPlan: false, canWritePlan: false })
  })

  test("a global session is still closed off when the agent declares nothing", () => {
    expect(facts({ scope: "global" })).toEqual({ canExitPlan: false, canWritePlan: false })
  })

  test("an agent with no tool configuration keeps both capabilities", () => {
    expect(facts({})).toEqual({ canExitPlan: true, canWritePlan: true })
    // `agent` 允许缺失（子代理还没解析出来时就是 undefined），不能因为缺就降级成"不能写"。
    expect(facts({ agent: undefined })).toEqual({ canExitPlan: true, canWritePlan: true })
  })

  test("a read-only whitelist loses both capabilities, consistently", () => {
    // 只读 agent（explore / verification 这类白名单）既写不了计划文件，也没有
    // plan_exit 可调 —— 两端同时为 false 是自洽的：没有计划文件可提交，就不该 exit。
    // 提示词此时走"把计划写在回复里"的分支，模型不会再去试旁路。
    expect(facts({ agent: { tools: ["read", "grep", "glob", "list", "bash"] } })).toEqual({
      canExitPlan: false,
      canWritePlan: false,
    })
  })

  test("a whitelist that carries a write tool and plan_exit keeps both capabilities", () => {
    expect(facts({ agent: { tools: ["read", "write", "edit", "plan_exit"] } })).toEqual({
      canExitPlan: true,
      canWritePlan: true,
    })
  })

  test("the historical patch alias counts as a write tool", () => {
    // `apply_patch` 在老配置里叫 `patch`，两个名字都得算写能力。
    expect(facts({ agent: { tools: ["read", "patch", "plan_exit"] } }).canWritePlan).toBe(true)
  })

  test("blacklisting the write tools only removes the write half", () => {
    // coordinator 就是这一形态：工具列表不限，但显式禁掉写工具。
    // 它仍然能调 plan_exit 把计划交出去，所以 canWritePlan=false 不能连带压掉 exit。
    expect(facts({ agent: { disallowedTools: ["write", "edit", "apply_patch", "patch"] } })).toEqual({
      canExitPlan: true,
      canWritePlan: false,
    })
  })

  test("blacklisting plan_exit only removes the exit half", () => {
    // 反过来同理：能写不能交，提示词得让模型自己说"计划写好了，请切档位"。
    expect(facts({ agent: { disallowedTools: ["plan_exit"] } })).toEqual({
      canExitPlan: false,
      canWritePlan: true,
    })
  })

  test("an empty whitelist means 'no restriction', matching the registry", () => {
    // 这条是和 registry 的对齐锚点：两边都用 `tools?.length` 判空，
    // 改任一侧都必须同步改另一侧，否则判据与实际下发的工具列表脱节。
    expect(facts({ agent: { tools: [] } })).toEqual({ canExitPlan: true, canWritePlan: true })
  })

  test("the real coordinator agent is told it can neither write nor exit", () => {
    // 取自 src/agent/agent.ts 的 coordinator（白名单里没有写工具也没有 plan_exit）。
    // Phase 4 的降级分支真正服务的对象就是这类只读编排 agent。
    expect(
      facts({
        agent: {
          tools: ["read", "grep", "glob", "list", "task", "skill", "webfetch", "question"],
          disallowedTools: ["write", "edit", "apply_patch", "patch", "shell", "orchestrator", "workflow"],
        },
      }),
    ).toEqual({ canExitPlan: false, canWritePlan: false })
  })
})

/**
 * 文案层的一条形状守卫（不是行为断言）。
 *
 * `insertReminders` 是 `SessionPrompt` 工厂里的局部闭包，运行期文本要起一个完整
 * LLM 会话才拿得到 —— 成本远超收益。所以这里退一步，只在源码上钉住一件事：
 * `## Plan File Info` 段必须按 `canWritePlan` 分叉，"Create the plan at" 不能
 * 无条件出现。上一版正是无条件的 `Create the plan at ${plan}.`，也就是事故的文案形态。
 *
 * 形状守卫较脆（重构会误伤），所以只保留两条最钝的断言；真正的回归防线是上面的
 * 纯函数用例 —— 判据一变，文案分支自然会跟着变。
 */
describe("plan reminder copy", () => {
  const source = path.join(import.meta.dir, "../../src/session/prompt.ts")
  const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

  test("the plan file info block has a 'write it in your reply' branch", async () => {
    const text = await Bun.file(source).text()
    // 两个 "不能写" 的分支（计划文件已存在 / 还没存在）都得有替代文案。
    expect(count(text, "present the plan in your reply")).toBe(2)
  })

  test("'Create the plan at' only appears under a canWritePlan guard", async () => {
    const text = await Bun.file(source).text()
    const at = text.indexOf("Create the plan at")
    expect(at).toBeGreaterThan(-1)
    // 反证：如果有人把它拍平成无条件文案，这 300 个字符里就不会再有 canWritePlan。
    expect(text.slice(Math.max(0, at - 300), at)).toContain("canWritePlan")
  })
})
