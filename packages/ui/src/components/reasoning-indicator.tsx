import type { Component } from "solid-js"

export type ReasoningIndicatorProps = {
  /** 这条思考是否仍在输出（用来决定要不要脉冲）。 */
  streaming: boolean
}

export type ReasoningIndicatorComponent = Component<ReasoningIndicatorProps>

let renderer: ReasoningIndicatorComponent | undefined

/**
 * 「思考过程」标题行左侧图标的注入点。
 *
 * UI 包不知道宿主当前用的是哪个模型、开的是哪一档思考强度，所以这个图标
 * 由宿主注册：没注册时用内置的 `lu-brain`；注册后可以换成能反映档位的版本
 * （应用里就是和输入框右上角同款的大脑档位图标）。
 *
 * 放在模块级（而不是 context）：消息正文的渲染层级很深，且各页面（会话、
 * 辅助对话、脉冲对话）共用同一份 `message-part`，注册一次就全局生效。
 */
export function registerReasoningIndicator(component: ReasoningIndicatorComponent | undefined) {
  renderer = component
}

export function getReasoningIndicator() {
  return renderer
}

export const ReasoningIndicator = {
  register: registerReasoningIndicator,
  get: getReasoningIndicator,
}
