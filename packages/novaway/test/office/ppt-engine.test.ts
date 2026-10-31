import { describe, expect, test } from "bun:test"
import { decidePptEngine, pptEngineNote } from "@/office/ppt-engine"

describe("office.ppt-engine", () => {
  test("prefers ppt-master once it is installed and its venv is ready", () => {
    const state = decidePptEngine({
      installed: true,
      pythonReady: true,
      python: "C:/data/skill-python/ppt-master/venv/Scripts/python.exe",
    })
    expect(state.engine).toBe("ppt-master")
    const note = pptEngineNote(state)
    expect(note).toContain("engine: ppt-master")
    expect(note).toContain("C:/data/skill-python/ppt-master/venv/Scripts/python.exe")
    expect(note).toContain("attr")
    expect(note).not.toContain("内置 HTML → PPTX 链路（同样是原生形状")
  })

  test("asks for the venv when ppt-master is installed without one", () => {
    const state = decidePptEngine({ installed: true, pythonReady: false, pythonError: "Read timed out" })
    expect(state.engine).toBe("ppt-master")
    expect(state.reason).toContain("skill_python")
    expect(state.reason).toContain("Read timed out")
    const note = pptEngineNote(state)
    expect(note).toContain("降级原因")
  })

  test("falls back to the builtin chain and offers the one-click install", () => {
    const state = decidePptEngine({ installed: false, pythonReady: false })
    expect(state.engine).toBe("builtin")
    expect(state.reason).toContain("NovaWay 内置")
    const note = pptEngineNote(state)
    expect(note).toContain("engine: builtin")
    // 未安装时不能暗示已经用上 ppt-master
    expect(note).toContain("不要因为听说 ppt-master 更好就假装它在用")
  })

  test("never claims ppt-master is in use without an interpreter", () => {
    const state = decidePptEngine({ installed: true, pythonReady: true })
    // pythonReady 但没有 python 路径：按未就绪处理，不能把路径写成 undefined
    expect(state.pythonReady).toBe(false)
    expect(pptEngineNote(state)).not.toContain("python: undefined")
  })
})
