import { type Component, type JSX } from "solid-js"

// 紧凑型设置资源使用自适应卡片网格，与 SettingsGroup 保持一致的圆角、细边框和轻量层次。
export const SettingsList: Component<{ children: JSX.Element }> = (props) => {
  return <div class="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">{props.children}</div>
}
