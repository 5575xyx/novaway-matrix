import { describe, expect, it as check } from "bun:test"
import { Effect } from "effect"
import { build, DEFAULT_LIMITS, normalizeBrief } from "@/team/context"
import { Service as RunService, defaultLayer as RunLayer } from "@/team/run"
import { SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(RunLayer)

const acceptance = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: "acc_" + index,
    version: 1,
    text: "第 " + index + " 条验收",
  }))

describe("dispatch context manifest", () => {
  check("what the model saw is what the manifest records", () => {
    const { manifest, prompt } = build({
      goal: "把重试补上",
      acceptance: [{ id: "acc_1", version: 2, text: "重试三次后放弃", expected: "3 次" }],
      members: ["- 小明（build）：负责实现"],
      feedback: ["上一条没写测试"],
      rosterVersion: "3",
    })
    // 同一份输出：清单里的 brief 就是投喂的提示词，不会出现两份说法。
    expect(manifest.brief).toBe(prompt)
    expect(manifest.acceptance).toEqual([{ id: "acc_1", version: 2 }])
    expect(manifest.rosterVersion).toBe("3")
    expect(manifest.feedback).toEqual(["上一条没写测试"])
    expect(manifest.truncated).toBe(false)
    expect(prompt).toContain("【总目标】把重试补上")
    expect(prompt).toContain("（预期：3 次）")
    expect(prompt).toContain("上一轮未达标的部分：")
    expect(prompt).toContain("【团队成员】")
  })

  check("too many acceptance lines are dropped and counted, never silently", () => {
    const { manifest, prompt } = build({
      goal: "g",
      acceptance: acceptance(DEFAULT_LIMITS.acceptance + 3),
      members: [],
      feedback: [],
    })
    expect(manifest.acceptance.length).toBe(DEFAULT_LIMITS.acceptance)
    expect(manifest.truncated).toBe(true)
    expect(manifest.omitted).toEqual([{ kind: "acceptance", count: 3, reason: expect.stringContaining("条数上限") }])
    // 模型自己也必须知道：截断说明写进提示词，而不是只写在数据库里。
    expect(prompt).toContain("【上下文截断】")
    expect(prompt).toContain("acceptance 少了 3 条")
  })

  check("feedback keeps the newest entries and cuts by count and length", () => {
    const long = "x".repeat(DEFAULT_LIMITS.feedbackChars + 50)
    const feedback = [long, ...Array.from({ length: DEFAULT_LIMITS.feedback + 5 }, (_, index) => "意见 " + index)]
    const { manifest } = build({ goal: "g", acceptance: [], members: [], feedback })

    // 旧的打回意见先出局：模型只需要照着最近的意见改。
    expect(manifest.feedback.length).toBe(DEFAULT_LIMITS.feedback)
    expect(manifest.feedback.at(-1)).toBe("意见 " + (DEFAULT_LIMITS.feedback + 4))
    const kinds = manifest.omitted.map((item) => item.kind)
    expect(kinds).toEqual(["feedback", "feedback"])
    expect(manifest.omitted[0].reason).toContain("单条超过")
    expect(manifest.omitted[1].reason).toContain("条数上限")
  })

  check("the total character budget tightens sections instead of cutting the JSON contract", () => {
    const { manifest, prompt } = build(
      {
        goal: "g",
        acceptance: acceptance(10),
        members: Array.from({ length: 10 }, (_, index) => "- 成员 " + index),
        feedback: ["意见"],
      },
      { totalChars: 500 },
    )
    expect(manifest.truncated).toBe(true)
    expect(manifest.omitted.length).toBeGreaterThan(0)
    expect(manifest.omitted.every((item) => item.reason.includes("超出总字符预算"))).toBe(true)
    // 截断方式是按段收紧，不是把字符串拦腰截断：输出契约必须完整保留。
    expect(prompt).toContain('"claims"')
    expect(prompt.length).toBeLessThanOrEqual(500)
    // 验收是这次运行的定义，最后才动它。
    expect(manifest.acceptance.length).toBeGreaterThan(0)
  })

  check("an empty acceptance list says so instead of pretending there is one", () => {
    const { prompt } = build({ goal: "g", acceptance: [], members: [], feedback: [] })
    expect(prompt).toContain("（未声明验收，按目标自检）")
  })

  check("scope and constraints reach the prompt right after the goal", () => {
    const { manifest, prompt } = build({
      goal: "修登录超时",
      brief: {
        scope: ["当前 diff", "src/auth"],
        files: ["src/auth/login.ts"],
        constraints: ["不要改测试", "不要新增依赖"],
        context: "线上只有 iOS 复现",
      },
      acceptance: [{ id: "acc_1", text: "超时后重试一次" }],
      members: ["- 小王（build）：实现"],
      feedback: [],
    })
    expect(prompt).toContain("【范围与约束】")
    expect(prompt).toContain("- 当前 diff\n- src/auth")
    expect(prompt).toContain("- src/auth/login.ts")
    expect(prompt).toContain("- 不要改测试\n- 不要新增依赖")
    expect(prompt).toContain("补充背景：线上只有 iOS 复现")
    // 范围约束的是「怎么做」，必须排在验收之前。
    expect(prompt.indexOf("【范围与约束】")).toBeLessThan(prompt.indexOf("【本次验收】"))
    // 没有截断就不该留下截断账：这是「没写」与「被砍掉」的区别。
    expect(manifest.omitted).toEqual([])
    expect(manifest.truncated).toBe(false)
    // 清单仍是同一份输出的账。
    expect(manifest.brief).toBe(prompt)
  })

  check("too many brief lines are dropped, counted and announced", () => {
    const scope = Array.from({ length: DEFAULT_LIMITS.brief + 2 }, (_, index) => "范围 " + index)
    const { manifest, prompt } = build({ goal: "g", brief: { scope }, acceptance: [], members: [], feedback: [] })
    expect(manifest.truncated).toBe(true)
    expect(manifest.omitted).toEqual([
      { kind: "brief", count: 2, reason: expect.stringContaining("范围 条数上限") },
    ])
    expect(prompt).toContain("brief 少了 2 条")
  })

  check("reads only known brief fields and treats empty ones as absent", () => {
    expect(normalizeBrief(undefined)).toBeUndefined()
    expect(normalizeBrief({ nothing: true })).toBeUndefined()
    // 空串与空数组不算「限定过」：派发时不该出现一行空的范围。
    expect(normalizeBrief({ scope: ["  "], constraints: [], context: "  " })).toBeUndefined()
    expect(
      normalizeBrief({ scope: [" 当前 diff ", 3], files: "not-a-list", constraints: ["不要改测试"], extra: "x" }),
    ).toEqual({ scope: ["当前 diff"], constraints: ["不要改测试"] })
  })

  it.effect("the latest manifest is persisted on the team and survives a re-read", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_context"),
        directory: "/tmp/run",
        mode: "team",
        goal: "目标",
      })
      const team = yield* runs.addTeam({ runID: run.id, profileID: "prof_1" })
      const { manifest } = build({ goal: "目标", acceptance: acceptance(2), members: [], feedback: [] })

      yield* runs.updateTeam({ id: team.id, contextManifest: manifest as unknown as Record<string, unknown> })
      const rows = yield* runs.teams(run.id)
      expect(rows[0].contextManifest?.truncated).toBe(false)
      // 清单按值存整份：读回来还能对上是哪一版验收、哪一版名册。
      expect(rows[0].contextManifest?.acceptance).toEqual(manifest.acceptance)
      expect(rows[0].contextManifest?.brief).toBe(manifest.brief)
    }),
  )
})
