import { describe, expect, test } from "bun:test"
import type { AgentContribution, ToolContribution } from "@novaway/plugin-api"
import { isPluginError } from "@novaway/plugin-api"
import {
  createAgentRegistry,
  createCommandRegistry,
  createSkillRegistry,
  createToolRegistry,
} from "@/plugin/contributions"
import { type Source, orderContributions, sanitize } from "@/plugin/contributions/registry"

/**
 * §14.3 第 5 步的验收：同名冲突、覆盖、排序三组单测全绿。
 *
 * 注册表是纯内存的，所以这里不碰文件系统：来源信息（scope / priority / installOrder / overrides）
 * 按 Host 的绑定形状传进来，第 6–9 步才把它接到真实插件上。
 *
 * 断言里的顺序都是 §4.9 的输出顺序（priority 降 → 安装顺序升 → 最终名字典序），
 * 不是注册顺序——注册顺序会被 `list()` 抹平，正因为如此才有「两次启动逐字节相同」这条要求。
 */

const builtin: Source = { pluginID: "builtin.office", scope: "builtin" }
const acme: Source = { pluginID: "acme", scope: "global" }
const local: Source = { pluginID: "acme", scope: "project" }

function tool(id: string, extra?: Partial<ToolContribution>): ToolContribution {
  return { id, description: id, parameters: { type: "object" }, execute: async () => "ok", ...extra }
}

function agent(id: string, pluginID: string, extra?: Partial<AgentContribution>): AgentContribution {
  return { id, description: `${pluginID}/${id}`, mode: "primary", prompt: "x", global: true, ...extra }
}

function names(list: readonly { name: string }[]) {
  return list.map((item) => item.name)
}

function codes(registry: { diagnostics(): readonly { code: string }[] }) {
  return registry.diagnostics().map((item) => item.code)
}

describe("贡献命名（§4.8）", () => {
  test("外部插件命名空间化，作者写的原始大小写与标点被归一", () => {
    const registry = createToolRegistry()
    registry.register(acme, tool("Run Task"))
    registry.register(acme, tool("v2.render"))
    expect(names(registry.list())).toEqual(["acme_run_task", "acme_v2_render"])
    expect(registry.list()[0].localName).toBe("run_task")
  })

  test("内置插件声明 global 才保留原名，没声明照样命名空间化", () => {
    const registry = createToolRegistry()
    registry.register(builtin, tool("office_pptx", { global: true }))
    registry.register(builtin, tool("office_docx"))
    expect(names(registry.list())).toEqual(["builtin_office_office_docx", "office_pptx"])
  })

  test("第三方声明 global 不生效：命名空间是「增强」与「劫持」的分界", () => {
    const registry = createAgentRegistry()
    registry.register(acme, agent("build", "acme"))
    expect(names(registry.list())).toEqual(["acme_build"])
  })

  test("撞内核保留名时即使 global 也要命名空间化，旧提示词里的工具名不能坏", () => {
    const registry = createToolRegistry({ reserved: new Set(["bash"]) })
    registry.register(builtin, tool("Bash", { global: true }))
    expect(names(registry.list())).toEqual(["builtin_office_bash"])
  })

  test("id 归一化后为空 → register 当场抛 contribution_invalid", () => {
    const registry = createToolRegistry()
    let caught: unknown
    try {
      registry.register(acme, tool("///"))
    } catch (error) {
      caught = error
    }
    expect(isPluginError(caught) && caught.code).toBe("contribution_invalid")
    expect(registry.list()).toEqual([])
  })

  test("sanitize：小写、非法字符转下划线、首尾去下划线、截断 48", () => {
    expect(sanitize("Acme Corp")).toBe("acme_corp")
    expect(sanitize("__x__")).toBe("x")
    expect(sanitize("a".repeat(60))).toHaveLength(48)
  })
})

describe("同名冲突（§4.8、§4.9）", () => {
  test("累加型：同名不抛错，追加后缀并写 collision 诊断", () => {
    const registry = createToolRegistry()
    registry.register(acme, tool("render"))
    registry.register(acme, tool("render"))
    registry.register(acme, tool("render"))
    expect(names(registry.list())).toEqual(["acme_render", "acme_render_2", "acme_render_3"])
    expect(codes(registry)).toEqual(["collision", "collision"])
  })

  test("后缀按 rank 分配，与注册先后无关：同一配置两次构建逐字节相同", () => {
    const first = createToolRegistry()
    first.register(acme, tool("render"))
    first.register({ ...acme, priority: 5 }, tool("render"))
    const second = createToolRegistry()
    second.register({ ...acme, priority: 5 }, tool("render"))
    second.register(acme, tool("render"))
    expect(names(second.list())).toEqual(names(first.list()))
    expect(second.list()[0].priority).toBe(5)
    expect(first.list()[1].priority).toBe(0)
  })

  test("可覆盖型：同名只留 rank 最优的一条，其余写 overridden", () => {
    const registry = createAgentRegistry()
    registry.register(builtin, agent("review", "builtin.office"))
    registry.register({ pluginID: "builtin.knowledge", scope: "builtin" }, agent("review", "builtin.knowledge"))
    expect(names(registry.list())).toEqual(["review"])
    expect(registry.list()[0].item.description).toBe("builtin.knowledge/review")
    expect(codes(registry)).toEqual(["overridden"])
    expect(registry.resolve("builtin_office_review")).toBeUndefined()
  })

  test("scope 相同时比 priority，再比安装顺序，最后比 pluginID", () => {
    const byID = createAgentRegistry()
    byID.register({ pluginID: "zzz", scope: "builtin" }, agent("x", "zzz"))
    byID.register({ pluginID: "aaa", scope: "builtin" }, agent("x", "aaa"))
    expect(byID.list()[0].item.description).toBe("aaa/x")
    byID.release("aaa")
    expect(byID.list()[0].item.description).toBe("zzz/x")

    const byPriority = createAgentRegistry()
    byPriority.register({ pluginID: "aaa", scope: "builtin", priority: 0 }, agent("x", "aaa"))
    byPriority.register({ pluginID: "zzz", scope: "builtin", priority: 10 }, agent("x", "zzz"))
    expect(byPriority.list()[0].item.description).toBe("zzz/x")

    const byInstall = createAgentRegistry()
    byInstall.register({ pluginID: "aaa", scope: "builtin", installOrder: 99 }, agent("x", "aaa"))
    byInstall.register({ pluginID: "zzz", scope: "builtin", installOrder: 5 }, agent("x", "zzz"))
    expect(byInstall.list()[0].item.description).toBe("zzz/x")
  })

  test("命令同名只留一个：一个名字对应一种语义", () => {
    const registry = createCommandRegistry()
    registry.register(builtin, { id: "deploy", description: "内置", template: "a", global: true })
    registry.register(acme, { id: "deploy", description: "外部", template: "b" })
    expect(names(registry.list())).toEqual(["acme_deploy", "deploy"])
    expect(registry.diagnostics()).toEqual([])
  })
})

describe("排序（§4.9、§4.2.1）", () => {
  test("priority 降 → 安装顺序升 → 最终名字典序", () => {
    const list = orderContributions([
      { name: "late", priority: 0 },
      { name: "aaa", priority: 0, installOrder: 7 },
      { name: "high", priority: 9 },
      { name: "bbb", priority: 0, installOrder: 3 },
      { name: "mid", priority: 4 },
    ])
    expect(list.map((item) => item.name)).toEqual(["high", "mid", "bbb", "aaa", "late"])
  })

  test("list() 已经是排好序的，调用点不再自己 sort", () => {
    const registry = createSkillRegistry()
    registry.register(acme, { id: "beta", source: { text: "x" }, description: "1" })
    registry.register({ ...acme, priority: 3 }, { id: "alpha", source: { text: "y" }, description: "2" })
    registry.register({ ...acme, installOrder: 1 }, { id: "gamma", source: { text: "z" }, description: "3" })
    expect(names(registry.list())).toEqual(["acme_alpha", "acme_gamma", "acme_beta"])
  })
})

describe("显式覆盖（§4.9）", () => {
  test("overrides 整包：目标插件在本注册表里的贡献全部消失", () => {
    const registry = createToolRegistry()
    registry.register(builtin, tool("knowledge_search", { global: true }))
    registry.register(builtin, tool("knowledge_read", { global: true }))
    registry.register({ ...local, overrides: ["builtin.office"] }, tool("search"))
    expect(names(registry.list())).toEqual(["acme_search"])
  })

  test("高 scope 覆盖低 scope：内置贡献被替换，覆盖者自己仍是命名空间名", () => {
    const registry = createToolRegistry()
    registry.register(builtin, tool("knowledge_search", { global: true }))
    registry.register({ pluginID: "acme", scope: "global", overrides: ["builtin.office"] }, tool("knowledge_search"))
    expect(names(registry.list())).toEqual(["acme_knowledge_search"])
  })

  test("内置覆盖外部不生效：rank 更低就写 override_ignored，原贡献保留", () => {
    const registry = createToolRegistry()
    registry.register(acme, tool("search"))
    registry.register({ ...builtin, overrides: ["acme"] }, tool("knowledge_search", { global: true }))
    expect(names(registry.list())).toEqual(["acme_search", "knowledge_search"])
    expect(codes(registry)).toEqual(["override_ignored"])
  })

  test("overrides 单项：整包只掉那一条，其余照常生效", () => {
    const registry = createToolRegistry()
    registry.register(builtin, tool("knowledge_search", { global: true }))
    registry.register(builtin, tool("knowledge_read", { global: true }))
    registry.register({ ...local, overrides: ["builtin.office:knowledge_search"] }, tool("search"))
    expect(names(registry.list())).toEqual(["acme_search", "knowledge_read"])
  })

  test("目标不存在 → override_unknown，不影响别人", () => {
    const registry = createToolRegistry()
    registry.register(acme, tool("render"))
    registry.register({ pluginID: "ghost", scope: "project", overrides: ["builtin.office:tool"] }, tool("haunt"))
    expect(names(registry.list())).toEqual(["acme_render", "ghost_haunt"])
    expect(codes(registry)).toEqual(["override_unknown"])
  })

  test("覆盖者被停用后原贡献自动恢复，无需重启", () => {
    const registry = createToolRegistry()
    registry.register(builtin, tool("knowledge_search", { global: true }))
    const disposable = registry.register({ ...local, overrides: ["builtin.office"] }, tool("search"))
    expect(names(registry.list())).toEqual(["acme_search"])
    disposable.dispose()
    expect(names(registry.list())).toEqual(["knowledge_search"])
  })

  test("覆盖链：C 覆盖 A、A 覆盖 B 时，A 出局后 B 不再被 A 拉下去", () => {
    const registry = createToolRegistry()
    registry.register(builtin, tool("knowledge_search", { global: true }))
    registry.register({ pluginID: "a", scope: "global", overrides: ["builtin.office"] }, tool("search"))
    registry.register({ pluginID: "c", scope: "project", overrides: ["a"] }, tool("search"))
    expect(names(registry.list())).toEqual(["c_search"])
  })

  test("release 按 pluginID 批量释放，并触发 onDidChange", () => {
    const registry = createToolRegistry()
    registry.register(acme, tool("render"))
    registry.register(builtin, tool("office_pptx", { global: true }))
    let changed = 0
    const watch = registry.onDidChange(() => (changed += 1))
    registry.release("acme")
    expect(names(registry.list())).toEqual(["office_pptx"])
    expect(changed).toBe(1)
    watch.dispose()
    registry.release("builtin.office")
    expect(registry.list()).toEqual([])
    expect(changed).toBe(1)
  })
})
