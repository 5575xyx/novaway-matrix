import { For, Show, type JSX } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import { icon } from "../util/panel-icons"
import { Locale } from "../util/locale"
import { calmStops } from "../ui/neon"
import { NeonRail } from "./neon-rail"

export type TabItem = {
  id: string
  title: string
  type: "chat" | "preview" | "git-diff"
  closable: boolean
  filePath?: string
}

// 标签条的高度是钉死的:1 行标签 + 1 行霓虹渐变导轨。
// 它是一个横排的条,任何让它变高的东西(过长的标题折行、标题里的 \n、被 flex 压缩)
// 都会顶掉下面的会话区。所以高度写死、不参与压缩、内容溢出直接裁掉。
const HEIGHT = 2
const TITLE_MAX = 24

/**
 * 一个标签占多少**显示列**。这个式子就是下面渲染时那条标签的每一项宽度之和:
 *   2   左右内边距
 *   + 1  图标与标题之间那 1 列空格
 *   + 图标列数 + 标题列数(标题已经按 TITLE_MAX 折行/截断过)
 *   + 2 关闭按钮(1 列 paddingLeft + ✕)
 *
 * 有两个用途,所以必须导出:一是给每个标签设成显式 width,二是让**调用方**算出「标签右侧还剩
 * 多少列」给胶囊做宽度预算。之前标签靠内容自然撑开,那样一来这条标签栏的总宽只有 flexbox 自己
 * 知道,胶囊那一侧就没法做预算 —— 而胶囊一旦超宽,被 `overflow:hidden` 裁掉的正好是**最右边那颗**
 * (也就是 `8.2k ctx`),看起来像随机少了一颗胶囊。
 *
 * ✕ 与 tab 的图标都是 East-Asian Ambiguous,这里按标准口径记 1 列(见 util/panel-icons 的文件头)。
 */
export function tabColumns(tab: TabItem) {
  const glyph = tab.type === "chat" ? icon("chat") : icon("doc")
  const title = Locale.oneLine(tab.title, TITLE_MAX)
  return 2 + Locale.displayWidth(glyph) + 1 + Locale.displayWidth(title) + (tab.closable ? 2 : 0)
}

export interface TabBarProps {
  tabs: TabItem[]
  activeTabId: string
  onTabClick: (tabId: string) => void
  onTabClose: (tabId: string) => void
  /**
   * 标签栏的可用列数(**不含**它自己的 paddingLeft/Right 各 1 列)。由调用方给,与
   * SessionFooterBar 的 width 同一套规矩:标签栏在 flex 里被侧栏挤过多宽,只有调用方知道
   * (会话页是 contentWidth + 2,见 routes/session)。组件自己用终端宽度去猜会把侧栏那一档算错。
   */
  width: number
  /**
   * 标签行右端的状态胶囊(原型 card-design-v7.html:883-888 的 `.tb-right`)。不传就没有。
   *
   * 传的是**渲染函数**而不是一段 JSX:胶囊的宽度预算必须从「标签栏内宽 − 所有标签的列数」里出,
   * 而标签有多宽只有这个组件知道(见 tabColumns)。传 JSX 进来,调用方就只能拿整条标签栏的宽度去
   * 猜,多标签时会算多,右端那颗胶囊就会被 `overflow:hidden` 裁掉。
   *
   * 胶囊上写什么(当前视图、上下文占用、session 短 id、命令面板键位)全是**调用方**的数据 ——
   * 会话页有这些,首页一个都没有。TabBar 要是自己算这些,就得同时认识 session 与 sync,
   * 标签栏也就不再是能单独挂载测量的纯布局组件了。宽窄与降级在 component/pill.tsx 的 PillRow 里做。
   */
  pills?: (available: number) => JSX.Element
}

export function TabBar(props: TabBarProps) {
  const { theme } = useTheme()
  const kv = useKV()
  // 胶囊能用的列数 = 标签栏内宽(扣掉自己的 paddingLeft/Right 各 1 列)− 标签占的列数。
  // 同一个 tabColumns 既用来给标签设显式宽度,也用来出这条预算,所以两者不可能对不上。
  const pillWidth = () => Math.max(0, props.width - 2 - props.tabs.reduce((sum, tab) => sum + tabColumns(tab), 0))

  return (
    <box flexDirection="column" height={HEIGHT} flexShrink={0} overflow="hidden">
      <box
        flexDirection="row"
        flexGrow={1}
        overflow="hidden"
        paddingTop={0}
        paddingBottom={0}
        paddingLeft={1}
        paddingRight={1}
      >
        <For each={props.tabs}>
          {(tab) => {
            const isActive = () => tab.id === props.activeTabId
            return (
              <box
                flexDirection="row"
                flexShrink={0}
                // 显式宽度而不是靠内容撑:标签有多宽要能被预算算出来(见 tabColumns)。
                width={tabColumns(tab)}
                paddingLeft={1}
                paddingRight={1}
                paddingTop={0}
                paddingBottom={0}
                backgroundColor={isActive() ? theme.backgroundPanel : theme.backgroundElement}
                onMouseUp={() => props.onTabClick(tab.id)}
              >
                <text
                  wrapMode="none"
                  fg={isActive() ? theme.primary : theme.textMuted}
                  attributes={isActive() ? TextAttributes.BOLD : undefined}
                >
                  {tab.type === "chat" ? `${icon("chat")} ` : `${icon("doc")} `}
                  {Locale.oneLine(tab.title, TITLE_MAX)}
                </text>
                <Show when={tab.closable}>
                  <text
                    wrapMode="none"
                    fg={theme.textMuted}
                    paddingLeft={1}
                    onMouseUp={(e) => {
                      e.stopPropagation()
                      props.onTabClose(tab.id)
                    }}
                  >
                    ✕
                  </text>
                </Show>
              </box>
            )
          }}
        </For>
        {/* 标签与右端胶囊之间的弹性空隙。minWidth={1} 是胶囊与最后一个标签之间的最小距离:
            空隙被压到 0 列时胶囊会贴上标签,看起来像那个标签的后缀(见 component/pill.tsx 的 SPACER)。
            胶囊的宽度已经被 pillWidth() 限死,这个空隙只负责把多出来的列吃掉。 */}
        <Show when={props.pills}>
          <box flexGrow={1} minWidth={1} />
          {props.pills?.(pillWidth())}
        </Show>
      </box>
      {/* 原 border={["bottom"]} 换成主题驱动的霓虹导轨。
          **animated 必须在这里传**:NeonRail 有这个 prop,漏传它不会让 typecheck 皱眉,
          只是这条导轨永远是一条静止的渐变 —— 而原型那边是
          `.titlebar::after { animation: railFlow 7s linear infinite }`(card-design-v7.html:85-91),
          一直流着。这是两条常驻轨里的一条(另一条是侧栏右缘 `railV 9s`,见 routes/session/sidebar
          那个 `flow=`);面板卡与分区卡不在这一档,它们只在悬停时流。

          stops 走 `calmStops`(两段青蓝)而不是 `neonStops`(三段全霓虹):用户反馈这条导轨
          「粉→紫→青一整条彩虹在跑」。原型的 `.titlebar::after` 是 2px 高 + `opacity:.85` 的一行,
          终端的一行没有「2px + 85% 不透明度」可退,只能靠收窄色相跨度还原那份克制 ——
          152° 收到 38°,理由与取值见 ui/neon 的 calmStops。相位节奏不动(仍是一圈 8 秒)。 */}
      <NeonRail stops={calmStops(theme)} animated={kv.get("animations_enabled", true)} />
    </box>
  )
}
