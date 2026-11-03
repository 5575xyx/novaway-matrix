// 「跟着 AI 的写盘开右栏」的状态机。
//
// 需求：执行过程中模型写文件时，自动展开右侧面板、逐字看到内容；这一轮结束再自动收起。
// 但自动逻辑必须随时给用户让路，所以这里把边界写死成三条：
//
// 1. **只在会话运行中跟随**：会话结束后的 watcher 事件（用户自己在编辑器里保存）不跟。
// 2. **用户一碰面板就让位**（`hijack`）：只要指针落到右侧面板上（点标签、拖宽度、
//    在预览里选文字），本次跟随立刻停止抢焦点，结束时也不替用户收面板。
// 3. **只收自己开的**：结束时只关本轮自动打开的标签；面板原本就是关着的才顺手收起。
//    用户自己开着的面板绝不被自动关掉。
//
// 全部是纯函数 + 一个不可变状态对象，便于单测（见 live-follow.test.ts）。

import { createSignal } from "solid-js"

export type LiveFollowState = {
  /** 跟随窗口是否激活（一次「非 idle → idle」为一个窗口）。 */
  active: boolean
  /** 用户接管了：不再自动切换文件，结束时也不收面板。 */
  hijacked: boolean
  /** 跟随开始前面板是否已展开。 */
  wasOpen: boolean
  /** 本窗口里由自动逻辑打开、且用户没有接管的文件标签。 */
  tabs: readonly string[]
  /**
   * 展开右栏时顺手收起了左侧栏。
   *
   * 跟随期间右侧面板 + 左侧任务栏同时占着，聊天区只剩一条缝；收起左栏把宽度
   * 让给聊天区（聊天区才是主区域）。只记一次：用户中途自己把左栏拉回来，
   * 后续写盘不再收，免得和人抢。
   */
  sidebarCollapsed: boolean
}

export const IDLE: LiveFollowState = {
  active: false,
  hijacked: false,
  wasOpen: false,
  tabs: [],
  sidebarCollapsed: false,
}

/** 开始跟随窗口。重复调用（已经在跟随中）保持原状态，不重置用户的接管标记。 */
export function beginFollow(state: LiveFollowState, paneOpen: boolean): LiveFollowState {
  if (state.active) return state
  return { active: true, hijacked: false, wasOpen: paneOpen, tabs: [], sidebarCollapsed: false }
}

/**
 * 跟随一个新的写盘目标。
 *
 * 只保留**一个**自动标签：一轮可能写几十个文件，全都留成标签会把右栏堆满；
 * 上一个自动标签在切换时关掉（用户若正看着它，早就在指针落进面板时接管了）。
 */
export function followTab(state: LiveFollowState, tab: string): { state: LiveFollowState; close: string[] } {
  if (!state.active || state.hijacked) return { state, close: [] }
  if (state.tabs.includes(tab)) return { state, close: [] }
  return { state: { ...state, tabs: [tab] }, close: [...state.tabs] }
}

export function hijackFollow(state: LiveFollowState): LiveFollowState {
  if (!state.active || state.hijacked) return state
  return { ...state, hijacked: true }
}

/**
 * 跟随期间收起左侧栏，把宽度让给聊天区。
 *
 * 只在窗口里收一次（`sidebarCollapsed` 置位后就再也不动）：用户中途自己拉回左栏，
 * 说明他这会儿要看任务列表，后续写盘不该再把它收走。左栏本来关着时什么也不做，
 * 自然也不会在结束时替用户打开。
 */
export function takeSidebar(
  state: LiveFollowState,
  sidebarExpanded: boolean,
): { state: LiveFollowState; collapse: boolean } {
  if (!state.active || state.hijacked || state.sidebarCollapsed || !sidebarExpanded) {
    return { state, collapse: false }
  }
  return { state: { ...state, sidebarCollapsed: true }, collapse: true }
}

/** 结束跟随窗口：返回要关的自动标签、是否要把面板收回去，以及是否把左栏还回去。 */
export function endFollow(state: LiveFollowState): {
  state: LiveFollowState
  close: string[]
  closePane: boolean
  restoreSidebar: boolean
} {
  if (!state.active) return { state: IDLE, close: [], closePane: false, restoreSidebar: false }
  // 左栏是我们收的，就得我们负责还 —— 哪怕用户中途接管了右侧面板。
  // 「接管」说的是别再抢右栏焦点，不代表他愿意左栏一直关着。
  const restoreSidebar = state.sidebarCollapsed
  if (state.hijacked) return { state: IDLE, close: [], closePane: false, restoreSidebar }
  return {
    state: IDLE,
    close: [...state.tabs],
    closePane: !state.wasOpen,
    restoreSidebar,
  }
}

// ---------------------------------------------------------------------------
// 输入框上方开关的视觉状态。抽成纯函数：组件只负责把四个布尔量喂进来，
// 配色/文案的分支不散在 JSX 里，单测也能直接钉住优先级。
// ---------------------------------------------------------------------------

export type FollowChipState = "off" | "taken" | "live" | "armed"

/**
 * - off   ：设置里关掉了（灰色，静止）
 * - taken ：用户接管了本轮（灰色，静止，但文案说明原因）
 * - live  ：正在跟着某一笔写盘（绿色 + 脉冲）
 * - armed ：开着、当下没有写盘（绿色 + 呼吸）
 *
 * 关闭优先于接管：关掉之后就不该再提示"你接管了"。
 */
export function followChipState(input: {
  enabled: boolean
  active: boolean
  hijacked: boolean
  writing: boolean
}): FollowChipState {
  if (!input.enabled) return "off"
  if (input.active && input.hijacked) return "taken"
  if (input.active && input.writing) return "live"
  return "armed"
}

// ---------------------------------------------------------------------------
// 模块级单例：同一时刻只有一个会话页在跑跟随，面板的「用户接管」信号
// 来自 session-side-panel 的指针事件，拿不到页面里的闭包，所以状态放在模块上。
// 用 signal 而不是裸变量：输入框上方的跟随开关要跟着「已接管 / 正在跟随」实时变样式。
// ---------------------------------------------------------------------------

const [current, setCurrent] = createSignal(IDLE)

export const liveFollowState = current

export function setLiveFollowState(state: LiveFollowState) {
  setCurrent(state)
}

/** 用户碰了右侧面板：本次跟随立刻让位（不会自动切换文件、结束时也不收面板）。 */
export function hijackLiveFollow() {
  setCurrent(hijackFollow(current()))
}

/**
 * 用户明确要求继续跟随（点了输入框上方的跟随开关）。
 *
 * 只解除「接管」，不重开窗口：窗口还是这一轮，面板仍是我们开的就仍然负责收起。
 */
export function resumeLiveFollow() {
  const state = current()
  if (!state.active || !state.hijacked) return
  setCurrent({ ...state, hijacked: false })
}
