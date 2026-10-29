import { For, Show, createEffect, createMemo, type JSX } from "solid-js"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { StatusSection } from "./status-section"

export type StatusPanelSection = {
  id: string
  title: string
  summary?: JSX.Element
  defaultOpen?: boolean
  bodyHeight?: string
  children: JSX.Element
}

// 状态类信息要么有内容要么整块不出现，不给空面板留占位。
export function shouldMountStatusPanel(sections: readonly { id: string }[]): boolean {
  return sections.length > 0
}

// todo / agents 是「这一轮运行」的进度与参与者：任务停下来它们只是上一轮的残留，
// 空闲期不出现（对齐 ZCode 的 hasContent 只认活内容）。
// git 对齐 ZCode 的 buildGitModel：有行级变更才算内容——clean 仓库也挂状态卡是
// ZCode 修过的 bug；有变更时空闲期必须留着，提交入口在这张卡的 body 里。
// 其余（background / plan-approval / hooks / temp-files）各自按内容出现
// （模型为 null 就不进 sections），列在这里只表达「空闲期也允许出现」。
// 「记忆与进化」已从面板移除（全局能力，不该占会话状态的位置，见 pages/session.tsx）。
// context 卡已退出面板：占用显示在输入框工具条（session-context-usage，对齐 ZCode 的
// ChatContextUsage），明细仍在审查面板的 context 标签里。
const ALWAYS_VISIBLE_SECTIONS = new Set(["git", "background", "temp-files", "plan-approval", "hooks"])

export function visibleStatusSections<T extends { id: string }>(sections: readonly T[], running: boolean): T[] {
  if (running) return [...sections]
  return sections.filter((section) => ALWAYS_VISIBLE_SECTIONS.has(section.id))
}

// 组件函数体只执行一次，挂载判定必须放在响应式 <Show> 里随 sections 变化重算，
// 否则首次渲染时 sections 为空（数据仍在异步加载）会永久停留在 null，整个状态面板再也不出现。
// 运行相关的区块在「从无到有」时自动展开一次(对齐 ZCode:任务触及某块功能时,
// 用户直接看到内容,而不是一行收着的摘要)。只在出现瞬间触发:用户随后手动收起
// 不会被再次顶开;git/context 等常驻区块不自动展开,保持默认折叠。
const AUTO_EXPAND_SECTIONS = new Set(["todo", "hooks", "plan-approval", "agents"])

export function SessionStatusPanel(props: { sections: StatusPanelSection[] }): JSX.Element {
  return (
    <Show when={shouldMountStatusPanel(props.sections)}>
      <SessionStatusPanelView sections={props.sections} />
    </Show>
  )
}

// 展开/收起形态由父级 conv-frame 的 @container 裁决，纯 CSS 决定，形态切换不依赖任何 JS 尺寸监听。
// 容器 < 768px 一律显示信息胶囊：只读摘要，不承载展开动作——窄态下点击无法越过 CSS 强制 mini，
// 所以窄态可见的那个元素不带任何「可展开」声明。展开按钮只存在于宽容器，此时 data-collapsed 点击确实生效。
// 阈值取 768 而不是 1279：容器宽度 = 主区宽度 = 视口 − 侧栏（约 284px），
// 用 1279 的话普通 1440/1920 屏只要展开侧栏就掉进胶囊态，展开按钮也被一起藏掉，看起来像「展不开」。
function SessionStatusPanelView(props: { sections: StatusPanelSection[] }): JSX.Element {
  const language = useLanguage()
  const layout = useLayout()
  const sdk = useSDK()
  const directory = createMemo(() => sdk.directory)

  const collapsed = layout.statusPanel.collapsed(directory())
  const summaries = createMemo(() => props.sections.filter((section) => section.summary !== undefined))

  // 区块「从无到有」时按需自动展开一次(todo/hooks/plan-approval/agents)。
  // todo、hooks 只在任务运行期间出现(visibleStatusSections),所以重新出现
  // 恰好对应新一轮任务触及该功能;已看过的 id 不再触发,手动收起后保持收起。
  const seenSections = new Set<string>()
  createEffect(() => {
    const dir = directory()
    for (const section of props.sections) {
      const key = `${dir}:${section.id}`
      if (seenSections.has(key)) continue
      seenSections.add(key)
      if (AUTO_EXPAND_SECTIONS.has(section.id)) layout.statusPanel.setOpen(dir, section.id, true)
    }
  })

  return (
    // w-80 显式定宽:折叠胶囊与展开卡都锚定在同一个 320px 盒子的右缘,
    // 不依赖零宽 aside 的绝对定位推断,任何状态下都离容器边缘 16px。
    <aside
      data-component="status-panel"
      class="group absolute top-4 right-4 z-10 w-80"
      data-collapsed={collapsed() ? "true" : "false"}
    >
      <div
        data-component="status-panel-expanded"
        class="absolute top-0 right-0 flex w-80 min-h-0 max-h-[min(76dvh,42rem)] flex-col origin-top-right transition-[opacity,transform,visibility] duration-200 ease-out motion-reduce:transition-none group-data-[collapsed=true]:invisible group-data-[collapsed=true]:pointer-events-none group-data-[collapsed=true]:opacity-0 group-data-[collapsed=true]:-translate-y-1 group-data-[collapsed=true]:scale-[0.98] @max-[768px]:invisible @max-[768px]:pointer-events-none @max-[768px]:opacity-0 @max-[768px]:scale-[0.98] @max-[768px]:group-hover:visible @max-[768px]:group-hover:pointer-events-auto @max-[768px]:group-hover:opacity-100 @max-[768px]:group-hover:scale-100"
      >
        {/* 无标题胶囊(对齐 ZCode):面板直接是卡片列表;收起入口是一个右上角的小图标钮,
            悬浮在卡片列表之上,不占一行高度。 */}
        <div class="pointer-events-none absolute top-0.5 right-0 z-10">
          <IconButton
            icon="collapse"
            variant="ghost"
            size="small"
            class="pointer-events-auto h-6 w-6"
            title={language.t("statusPanel.collapse")}
            aria-label={language.t("statusPanel.collapse")}
            onClick={() => layout.statusPanel.toggleCollapsed(directory())}
          />
        </div>
        {/*
          这里**不**用 `no-scrollbar`：区块多于两个时面板会超高超限（max-h 64dvh / 32rem），
          展开的区块被裁掉、又没有滚动条提示，看起来就是"挤在一起显示不全"。
          留一条细滚动条，用户一眼知道还能往下翻。
          间距对齐 ZCode:卡与卡 gap-1.5,不再套外层 padding。
        */}
        <div class="status-panel-scroll flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 pr-1 pt-3">
          {/*
            按 id 而不是按对象做 key：sections 数组每次重建都是新对象，直接 <For each={props.sections}>
            会把所有区块的 DOM 整体重挂 —— 后台任务每 2 秒的心跳、git 每 5 秒的轮询都会让
            正在输入的分支名输入框被销毁（表现为"鼠标还在菜单里，菜单自己关了"）。
            这里只把 id 当 key，区块内容用 memo 按 id 查；对象没变时 memo 不通知，子树保持挂载。
          */}
          <For each={props.sections.map((section) => section.id)}>
            {(id) => {
              const section = createMemo(() => props.sections.find((item) => item.id === id))
              const isOpen = layout.statusPanel.open(directory(), id, section()?.defaultOpen)
              // shrink-0：卡片不能被 flex 压扁。之前总高度超限时每张卡都被压缩，
              // 卡片体被裁掉，看起来"挤在一起、显示不全"。让外层滚动条承担溢出。
              // 无边框半透明卡(对齐 ZCode):圆角悬浮,不带 border。
              return (
                <div class="shrink-0 overflow-hidden rounded-xl bg-background/85 shadow-md backdrop-blur-sm">
                  <StatusSection
                    id={id}
                    title={section()?.title ?? ""}
                    summary={section()?.summary}
                    open={isOpen()}
                    onToggle={() => layout.statusPanel.toggleOpen(directory(), id, section()?.defaultOpen)}
                    bodyHeight={section()?.bodyHeight}
                  >
                    {section()?.children}
                  </StatusSection>
                </div>
              )
            }}
          </For>
        </div>
      </div>

      {/* 窄容器强制 mini 时显示。悬停浮现:指上胶囊时 mini 淡出、完整面板从右上浮出
          (见 status-panel-expanded 的 @max-[768px]:group-hover 覆盖);纯 CSS,无 JS 状态。
          胶囊按需出现(对齐 ZCode 的 !summaryMetric → return null):没有一条可显示的
          摘要时连壳都不渲染,只留一个图标空壳挂在右上角只会被当成 bug。 */}
      <Show when={summaries().length > 0}>
        <div
          data-component="status-panel-mini"
          class="absolute top-0 right-0 hidden h-8 max-w-full items-center gap-1 overflow-hidden rounded-lg border border-border bg-panel px-2 shadow-sm transition-opacity duration-200 ease-out motion-reduce:transition-none @max-[768px]:flex @max-[768px]:group-hover:pointer-events-none @max-[768px]:group-hover:opacity-0"
          title={language.t("statusPanel.summary")}
        >
          <CapsuleBody sections={summaries()} />
        </div>
      </Show>

      {/* 外层只做「非窄容器」闸门；按钮自己只处理 data-collapsed，两轴各管一条互斥规则。
          收起时淡入(与展开卡的淡出同一节奏),内容超宽截断,不越出面板盒子。
          同样按需出现:没有摘要内容就不渲染(与上面的 mini 同一条闸门)。 */}
      <Show when={summaries().length > 0}>
        <div class="absolute top-0 right-0 transition-opacity duration-200 ease-out motion-reduce:transition-none @max-[768px]:invisible @max-[768px]:pointer-events-none @max-[768px]:opacity-0">
          <button
            type="button"
            data-component="status-panel-expand"
            class="hidden h-8 max-w-full items-center gap-1 overflow-hidden rounded-lg border border-border bg-panel px-2 shadow-sm transition-opacity duration-200 group-data-[collapsed=true]:flex"
            title={language.t("statusPanel.expand")}
            aria-label={language.t("statusPanel.expand")}
            onClick={() => layout.statusPanel.toggleCollapsed(directory())}
          >
            <CapsuleBody sections={summaries()} />
          </button>
        </div>
      </Show>
    </aside>
  )
}

const CapsuleBody = (props: { sections: StatusPanelSection[] }): JSX.Element => (
  <>
    <Icon name="status" size="small" class="text-foreground-subtle shrink-0" />
    <For each={props.sections}>
      {(section) => (
        <span class="min-w-0 truncate text-ui-sm tabular-nums text-foreground-subtle">{section.summary}</span>
      )}
    </For>
  </>
)
