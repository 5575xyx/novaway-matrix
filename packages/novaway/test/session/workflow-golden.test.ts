import { describe, expect, test } from "bun:test"
import { existsSync } from "fs"
import path from "path"
import { BUILTIN_EXTENSIONS } from "@novaway/core/builtin-extensions"

const read = async (filePath: string) => Bun.file(filePath).text()

const promptPath = path.resolve(import.meta.dir, "../../src/session/prompt/default.txt")
const questionPath = path.resolve(import.meta.dir, "../../src/tool/question.txt")
const llmPath = path.resolve(import.meta.dir, "../../src/session/llm.ts")
const pluginsRoot = process.env.NOVAWAY_PLUGINS_ROOT ?? path.resolve(import.meta.dir, "../../../../../novaway-plugins")
const routingPath = path.join(pluginsRoot, "plugins/com.novaway.powersnexus/skills/using-powersnexus/SKILL.md")
const brainstormingPath = path.join(pluginsRoot, "plugins/com.novaway.powersnexus/skills/brainstorming/SKILL.md")
const taskSizePath = path.join(pluginsRoot, "plugins/com.novaway.powersnexus/skills/task-size-assessor/SKILL.md")
const l1TemplatePath = path.join(pluginsRoot, "plugins/com.novaway.powersnexus/skills/openspec/templates/L1-quick-fix.md")
const pluginReadmePath = path.join(pluginsRoot, "plugins/com.novaway.powersnexus/skills/README.md")
const pluginGolden = existsSync(routingPath) && existsSync(brainstormingPath) && existsSync(taskSizePath) && existsSync(l1TemplatePath) && existsSync(pluginReadmePath) ? test : test.skip

describe("workflow golden eval", () => {
  test("keeps the host interaction contract stable", async () => {
    const [prompt, question, llm] = await Promise.all([read(promptPath), read(questionPath), read(llmPath)])

    expect(prompt).toContain("MUST call the `question` tool")
    expect(prompt).toContain("options: []")
    expect(prompt).toContain("lightweight `powersnexus_grill-me` gate")
    expect(prompt).toContain("host-owned workflow state")
    expect(prompt).toContain("question budget")
    expect(prompt).toContain("zero questions when the request and acceptance criteria are clear")
    expect(prompt).toContain("at most one `question` call for a blocking unknown")
    expect(prompt).toContain("L2+ loads `powersnexus_brainstorming`")
    expect(prompt).not.toContain("This OVERRIDES any skill instructions")
    expect(prompt).not.toContain("Do NOT ask questions like:")

    expect(question).toContain("open-ended clarification questions")
    expect(question).toContain("empty `options` array")
    expect(question).toContain("In unattended mode")
    expect(question).not.toContain("Batch all clarifying questions into one ask up front")
    expect(question).not.toContain("Once a todo list has been created, do NOT ask further questions")

    expect(llm).toContain('const INTERACTIVE_QUESTION_DIRECTIVE')
    expect(llm).toContain("必须调用 question 工具")
    expect(llm).toContain("powersnexus_grill-me")
    expect(llm).toContain("需求清晰时零提问")
    expect(llm).toContain("最多一次 question")
    expect(llm).toContain("L2+ 加载 powersnexus_brainstorming")
    expect(llm.indexOf("...(input.user.system ? [input.user.system] : [])")).toBeLessThan(
      llm.indexOf("INTERACTIVE_QUESTION_DIRECTIVE] : []"),
    )
  })

  pluginGolden("keeps the default PowersNexus release contract aligned", async () => {
    const powersnexus = BUILTIN_EXTENSIONS.find((entry) => entry.name === "com.novaway.powersnexus")
    expect(powersnexus).toMatchObject({
      version: "1.1.4",
      url: "https://gitee.com/NovaWay-AI/novaway-plugins/releases/download/com.novaway.powersnexus-v1.1.4/com.novaway.powersnexus-1.1.4.zip",
      autoInstall: true,
    })

    const [routing, brainstorming, taskSize, l1Template, pluginReadme] = await Promise.all([
      read(routingPath),
      read(brainstormingPath),
      read(taskSizePath),
      read(l1TemplatePath),
      read(pluginReadmePath),
    ])
    expect(routing).toContain("L0：先经过 grill-me 快速门禁")
    expect(routing).toContain("L1：先经过 grill-me 轻量拷问")
    expect(routing).toContain("L2：使用一次设计契约、计划、实现、审查和测试")
    expect(routing).toContain("编码 L0/L1 不因流程完整性而强制加载重型技能")
    expect(routing).not.toContain("L0：直接修改并进行聚焦验证")
    expect(routing).not.toContain("L1：仅在存在关键未知项时做一次澄清")
    expect(routing).not.toContain("L0 | grill-me（可选快速澄清）")

    expect(brainstorming).toContain("L2+ 行为或功能变更")
    expect(brainstorming).toContain("do not ask for approval after every section")
    expect(brainstorming).toContain("Decision-dependent artifact review")
    expect(brainstorming).not.toContain("User must select one approach before proceeding")
    expect(brainstorming).not.toContain("After each section, use the `question` tool")

    expect(taskSize).toContain("grill-me 轻量门禁")
    expect(taskSize).toContain("不默认创建 tasks.md，不加载 writing-plans")
    expect(taskSize).not.toContain("grill-me（入口拷问）→ writing-plans（简化）")
    expect(l1Template).toContain("不创建 OpenSpec 工件")
    expect(l1Template).toContain("不要创建 `tasks.md`")
    expect(l1Template).not.toContain("创建简化版 tasks.md")
    expect(pluginReadme).toContain("brainstorming](brainstorming/) | Use for L2+")
  })
})
