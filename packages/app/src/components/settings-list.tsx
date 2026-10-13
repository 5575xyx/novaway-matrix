import { type Component, type JSX } from "solid-js"

// 设置项排成卡片网格:窄屏单列、中屏两列、宽屏三列。每个 SettingsRow 就是一张独立长方形卡片,
// 卡片之间靠 gap 留白,不再用 border-b 把整页连成一长条。
export const SettingsList: Component<{ children: JSX.Element }> = (props) => {
  return <div class="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">{props.children}</div>
}
