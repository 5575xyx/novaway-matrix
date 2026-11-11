import { describe, expect, test } from "bun:test"
import { prepareWorkflow } from "../../src/dynamic-workflow"
import { confirmationMetadata, renderDiagnostics } from "../../src/tool/workflow-script"
import { CAPABILITIES } from "../../src/tool/registry"

// 工具的那层壳（ctx.ask / Effect 上下文）在集成时才有意义，这里钉住两件纯逻辑：
// 有诊断时回给模型的话要能直接照做；确认窗里展示的东西必须是有界的。

describe("renderDiagnostics", () => {
  test("给出位置与「改完再调一次」的指引", () => {
    const prepared = prepareWorkflow('const x: number = "nope"\nreturn x')
    const text = renderDiagnostics(prepared.diagnostics)
    expect(text).toContain("脚本没有通过检查，没有启动")
    expect(text).toContain("L1:C7")
    expect(text).toContain("改完再调用一次")
  })

  test("门面误用的诊断走同一条通道", () => {
    const prepared = prepareWorkflow("const g = files.glob\nreturn g")
    expect(renderDiagnostics(prepared.diagnostics)).toContain("只能直接调用")
  })
})

describe("confirmationMetadata", () => {
  test("展示脚本、阶段、命令、子代理与并发上限", () => {
    const prepared = prepareWorkflow(
      [
        'phase("准备")',
        'const a = agent("builder")',
        'const b = agent("checker")',
        'await world.run("git", ["status"])',
        'await world.run("bun", ["test"])',
        'return await a.ask("做")',
      ].join("\n"),
    )
    const meta = confirmationMetadata(prepared, 6)
    expect(meta.phases).toEqual(["准备"])
    expect(meta.commands).toEqual(["git", "bun"])
    expect(meta.actors).toEqual(["builder", "checker"])
    expect(meta.maxConcurrency).toBe(6)
    expect(meta.script).toContain("world.run")
  })

  test("长脚本被截断，并说明总行数", () => {
    const long = Array.from({ length: 300 }, (_, index) => `const v${index} = ${index}`).join("\n")
    const prepared = prepareWorkflow(`${long}\nreturn 1`)
    const meta = confirmationMetadata(prepared, 4)
    expect(meta.script).toContain("共 301 行")
    expect(meta.script.split("\n").length).toBeLessThan(210)
  })
})

describe("capabilities", () => {
  test("create_workflow 不并发、不占工作区锁、被打断时取消", () => {
    const caps = CAPABILITIES.create_workflow!
    expect(caps.concurrencySafe).toBe(false)
    expect(caps.workspace).toBe(false)
    expect(caps.interrupt).toBe("cancel")
  })

  test("workflow_run 的只读性按动作判定", () => {
    const readOnly = CAPABILITIES.workflow_run!.readOnly as (args: unknown) => boolean
    expect(readOnly({ action: "get" })).toBe(true)
    expect(readOnly({ action: "list" })).toBe(true)
    expect(readOnly({ action: "stop" })).toBe(false)
  })
})
