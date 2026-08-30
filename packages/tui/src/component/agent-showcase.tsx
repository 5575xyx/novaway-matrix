import { RGBA, TextAttributes } from "@opentui/core"
import { For, Show, createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { useTheme } from "../context/theme"
import { agentFeatureList } from "../util/agent-name"

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

// 启动页中央的特征行:不显示 agent 名字,只显示它擅长什么。
// 终端改不了字号,"大字"的分量靠:词内逐字空格拉开字距 + 加粗 + 沿行渐变 + 两侧 ╱ 对角线点缀。
// 整行是单个 box,由外层(居中布局)作为整体水平居中;tab 切换 agent 时颜色和内容随之切换。
export function AgentShowcase() {
  const { theme } = useTheme()
  const local = useLocal()
  const agent = createMemo(() => local.agent.current())

  return (
    <Show when={agent()} fallback={<box height={1} flexShrink={0} />}>
      {(agent) => {
        const color = createMemo(() => local.agent.color(agent().name))
        // 词间用 " · " 分隔;两端 ╱ 用降饱和的 agent 色,不跟正文抢亮度。
        const words = createMemo(() => agentFeatureList(agent().name, agent().description))
        const chars = createMemo(() => Array.from(words().join("  ·  ")))
        return (
          <box flexDirection="row" flexShrink={0}>
            <text
              fg={RGBA.fromValues(
                lerp(theme.background.r, color().r, 0.55),
                lerp(theme.background.g, color().g, 0.55),
                lerp(theme.background.b, color().b, 0.55),
                1,
              )}
              selectable={false}
            >
              {"╱╱╱  "}
            </text>
            <For each={chars()}>
              {(char, i) => {
                const t = i() / Math.max(1, chars().length - 1)
                // 渐变从 agent 色走到接近正文的亮度,右端不至于突兀
                const fg = RGBA.fromValues(
                  lerp(color().r, theme.text.r, t * 0.45),
                  lerp(color().g, theme.text.g, t * 0.45),
                  lerp(color().b, theme.text.b, t * 0.45),
                  1,
                )
                return (
                  <text fg={fg} attributes={TextAttributes.BOLD} selectable={false}>
                    {char === " " ? " " : char}
                  </text>
                )
              }}
            </For>
            <text
              fg={RGBA.fromValues(
                lerp(theme.background.r, color().r, 0.55),
                lerp(theme.background.g, color().g, 0.55),
                lerp(theme.background.b, color().b, 0.55),
                1,
              )}
              selectable={false}
            >
              {"  ╱╱╱"}
            </text>
          </box>
        )
      }}
    </Show>
  )
}
