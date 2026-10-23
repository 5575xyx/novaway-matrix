import { For, Show, createMemo, type JSX } from "solid-js"
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

// todo / context 只在任务运行期间按需出现：todo 是这次运行的进度，context 是这次运行的上下文占用，
// 任务停下来它们只是上一轮的残留，一直挂在右上角会盖住消息区。
// 另外三个必须常驻，否则任务一停用户就再也找不到入口了：
//   git —— 全 app 唯一的提交入口就在这一块的 body 里（status-panel-git-commit）
//   context —— 上下文占用与缓存命中率合并成一张卡；缓存是**整个会话累积**的统计，
//              不是这一轮的临时残留，所以任务停下后仍然保留。
//   background —— 后台子代理/命令可以独立于主线程运行，主线程 idle 时也必须能看到并停止。
// 「记忆与进化」已从面板移除（全局能力，不该占会话状态的位置，见 pages/session.tsx）。
// plan-approval 也常驻：子代理会一直阻塞在那里，主线程此时恰好是 idle 状态。
//   hooks —— 只在有 Hook 真正在跑时出现（自带轮询），它回答"这一轮为什么慢"，
//            恰好也发生在主线程看起来 idle 的时刻，所以常驻判定必须包含它。
const ALWAYS_VISIBLE_SECTIONS = new Set(["git", "context", "background", "temp-files", "plan-approval", "hooks"])

export function visibleStatusSections<T extends { id: string }>(sections: readonly T[], running: boolean): T[] {
  if (running) return [...sections]
  return sections.filter((section) => ALWAYS_VISIBLE_SECTIONS.has(section.id))
}

// 组件函数体只执行一次，挂载判定必须放在响应式 <Show> 里随 sections 变化重算，
// 否则首次渲染时 sections 为空（数据仍在异步加载）会永久停留在 null，整个状态面板再也不出现。
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

  return (
    <aside
      data-component="status-panel"
      class="group absolute top-4 right-4 z-10"
      data-collapsed={collapsed() ? "true" : "false"}
    >
      <div
        data-component="status-panel-expanded"
        class="absolute top-0 right-0 flex w-80 min-h-0 max-h-[min(76dvh,42rem)] flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-lg @max-[768px]:hidden group-data-[collapsed=true]:hidden"
      >
        <div class="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
          <span class="text-ui-sm font-medium text-foreground truncate">{language.t("statusPanel.title")}</span>
          <div class="flex-1" />
          <IconButton
            icon="collapse"
            variant="ghost"
            size="small"
            class="h-6 w-6 shrink-0"
            title={language.t("statusPanel.collapse")}
            aria-label={language.t("statusPanel.collapse")}
            onClick={() => layout.statusPanel.toggleCollapsed(directory())}
          />
        </div>
        {/*
          这里**不**用 `no-scrollbar`：区块多于两个时面板会超高超限（max-h 64dvh / 32rem），
          展开的区块被裁掉、又没有滚动条提示，看起来就是"挤在一起显示不全"。
          留一条细滚动条，用户一眼知道还能往下翻。
        */}
        <div class="status-panel-scroll flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 p-2">
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
              return (
                <div class="shrink-0 overflow-hidden rounded-lg border border-border bg-background">
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

      {/* 窄容器强制 mini 时显示：纯信息展示，非控件，因此不挂 onClick 也不声明可展开。 */}
      <div
        data-component="status-panel-mini"
        class="absolute top-0 right-0 hidden h-8 items-center gap-1 rounded-lg border border-border bg-panel px-2 shadow-sm @max-[768px]:flex"
        title={language.t("statusPanel.summary")}
      >
        <CapsuleBody sections={summaries()} />
      </div>

      {/* 外层只做「非窄容器」闸门；按钮自己只处理 data-collapsed，两轴各管一条互斥规则。 */}
      <div class="absolute top-0 right-0 @max-[768px]:hidden">
        <button
          type="button"
          data-component="status-panel-expand"
          class="hidden h-8 items-center gap-1 rounded-lg border border-border bg-panel px-2 shadow-sm group-data-[collapsed=true]:flex"
          title={language.t("statusPanel.expand")}
          aria-label={language.t("statusPanel.expand")}
          onClick={() => layout.statusPanel.toggleCollapsed(directory())}
        >
          <CapsuleBody sections={summaries()} />
        </button>
      </div>
    </aside>
  )
}

const CapsuleBody = (props: { sections: StatusPanelSection[] }): JSX.Element => (
  <>
    <Icon name="status" size="small" class="text-foreground-subtle shrink-0" />
    <For each={props.sections}>
      {(section) => <span class="text-ui-sm tabular-nums text-foreground-subtle shrink-0">{section.summary}</span>}
    </For>
  </>
)
