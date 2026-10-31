/**
 * 办公模式 PPT 的渲染链选择。
 *
 * 两条路都能产出原生可编辑 PPTX，差别在保真度和依赖：
 * - `builtin`：本技能自带的 HTML → PPTX（模板填充 / DOM 提取 + pptxgenjs）。
 *   不依赖 Python，产物是原生形状与可编辑文本框，但版式是「按 DOM 近似还原」；
 *   导出阶段需要本机 Node + Chrome/Edge。
 * - `ppt-master`：市场里装的可插拔扩展，SVG → DrawingML，坐标和字体逐对象落盘，
 *   保真度更高，还能用它的模板家族与原生 PPTX 编辑；依赖 Python（已由 NovaWay 装进独立 venv）。
 *
 * 选择是**确定的**，不靠模型猜：技能工具会把结果写进 `<ppt_engine>` 段，
 * 这里只负责算状态和写这段话。
 */
export type PptEngine = "ppt-master" | "builtin"

export type PptEngineState = {
  engine: PptEngine
  installed: boolean
  pythonReady: boolean
  python?: string
  /** 给模型看的一句话结论。 */
  reason: string
}

export type PptEngineInput = {
  installed: boolean
  pythonReady: boolean
  python?: string
  /** Python 环境失败时的原因，用于提示先修环境而不是换链路。 */
  pythonError?: string
}

export function decidePptEngine(input: PptEngineInput): PptEngineState {
  if (input.installed && input.pythonReady && input.python) {
    return {
      engine: "ppt-master",
      installed: true,
      pythonReady: true,
      python: input.python,
      reason: "ppt-master 已安装且 Python 环境就绪，优先用它生成原生可编辑 PPTX。",
    }
  }
  if (input.installed) {
    return {
      engine: "ppt-master",
      installed: true,
      pythonReady: false,
      reason:
        "ppt-master 已安装但 Python 环境未就绪" +
        (input.pythonError ? "（" + input.pythonError + "）" : "") +
        '：运行脚本前先调用 skill_python 工具（action=prepare, name="ppt-master"）。' +
        "环境准备失败时如实报告，再改用内置 HTML → PPTX 链路并说明降级原因。",
    }
  }
  return {
    engine: "builtin",
    installed: false,
    pythonReady: false,
    reason:
      "本机没有安装 ppt-master：走内置 HTML → PPTX 链路（同样是原生形状 + 可编辑文本）。" +
      "如果用户要求更高的版式保真（SVG 精准坐标、它的模板家族、原生 PPTX 逐对象编辑），" +
      "告诉用户可以在「插件 → 市场 → NovaWay 内置」一键安装 ppt-master，装完这条链路会自动优先。",
  }
}

/** 写进技能内容的 `<ppt_engine>` 段。 */
export function pptEngineNote(state: PptEngineState): string {
  const lines = ["engine: " + state.engine, "python: " + (state.python ?? "n/a"), state.reason]
  if (state.engine === "ppt-master") {
    lines.push(
      '使用方式：先用 skill 工具加载 ppt-master（name: "ppt-master"），按它的 SKILL.md 选一条路由；' +
        "它脚本里的 python 一律用 <python_environment> 给出的解释器绝对路径。",
      "交付口径不变：产物写 .novaway/office/ppt/<标题>.pptx，中间文件放 .novaway/office/ppt-work/ppt-master/<deck-slug>/，" +
        "交付前仍要核对页数、文字溢出、可编辑对象与演讲备注。",
      "只有 ppt-master 自身失败（依赖缺失、attribution_guard 不通过、脚本报错）时才可改用内置链路，" +
        "并且必须在回复里写明降级原因，不要把降级说成「已经用 ppt-master 做好」。",
    )
  } else {
    lines.push("继续使用本技能下面的「高保真 HTML → PPTX 路径」；不要因为听说 ppt-master 更好就假装它在用。")
  }
  return lines.join(String.fromCharCode(10))
}
