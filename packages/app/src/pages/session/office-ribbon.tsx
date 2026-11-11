/**
 * 统一的 Office 功能区（ribbon）。
 *
 * 布局约定：**标签行由宿主画，命令由编辑器画**。
 * 不管当前是 Word、Excel、PPT 还是 PDF，顶部都是同一套「开始 / 插入 / 视图 …」
 * 标签行；切换文件类型时位置不变，只是标签和命令换了内容，手感一致。
 *
 * 实现上是「编辑器注册、宿主渲染」：
 *   - 编辑器（docx / xlsx / pptx / pdf / legacy 预览）调用 `useOfficeRibbonTabs`，
 *     把自己的标签（含命令节点）注册上来；
 *   - 宿主在预览上方渲染 `<OfficeRibbonBar />`；
 *   - 编辑器卸载（切文件）时自动清空，不会串台。
 *
 * 命令节点就是编辑器自己的 JSX —— 选中态、禁用态都来自编辑器自己的信号，
 * 这里不做状态镜像，避免「功能区显示加粗、正文其实没加粗」这类不同步。
 */
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  useContext,
  type Accessor,
  type JSX,
  type ParentProps,
} from "solid-js"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Icon } from "@novaway/ui/icon"

export type OfficeRibbonTab = {
  /** 稳定的 id，切换文件时用来保持「还停在同一个标签」。 */
  id: string
  label: string
  /** 命令节点；每次渲染都会调用，所以可以直接读信号。 */
  render: () => JSX.Element
  /** 可选：这个标签在当前文件里是否可用（比如 PDF 没有「插入表格」）。 */
  disabled?: boolean
}

type RibbonContext = {
  tabs: Accessor<OfficeRibbonTab[]>
  setTabs: (tabs: OfficeRibbonTab[]) => void
  active: Accessor<string>
  setActive: (id: string) => void
  /** 阅读模式下整条功能区收起：编辑器照常注册标签，只是宿主不画。 */
  enabled: Accessor<boolean>
}

const Context = createContext<RibbonContext>()

/** 记住上次停在哪个标签：同一批标签里的偏好不应该每次打开文件都被重置。 */
let rememberedTab = "home"

export function OfficeRibbonProvider(props: ParentProps<{ enabled?: boolean }>) {
  const [tabs, setTabs] = createSignal<OfficeRibbonTab[]>([])
  const [active, setActiveRaw] = createSignal(rememberedTab)

  const setActive = (id: string) => {
    rememberedTab = id
    setActiveRaw(id)
  }

  return (
    <Context.Provider value={{ tabs, setTabs, active, setActive, enabled: () => props.enabled !== false }}>
      <div class="flex h-full min-h-0 flex-col">{props.children}</div>
    </Context.Provider>
  )
}

/** 编辑器注册自己的标签；组件卸载时自动清空。 */
export function useOfficeRibbonTabs(tabs: Accessor<OfficeRibbonTab[]>) {
  const context = useContext(Context)
  if (!context) return
  createEffect(() => context.setTabs(tabs()))
  onCleanup(() => context.setTabs([]))
}

const TAB_BUTTON =
  "rounded-t-md px-2.5 py-1 text-11-regular transition-colors " +
  "text-foreground-subtle hover:bg-hover hover:text-foreground"

/**
 * 标签行 + 当前标签的命令区。
 *
 * 没有注册任何标签时整块不渲染（Markdown / 代码编辑器保持原样）。
 */
export function OfficeRibbonBar() {
  const context = useContext(Context)
  if (!context) return null

  const current = createMemo(() => {
    const list = context.tabs()
    if (list.length === 0) return undefined
    return list.find((tab) => tab.id === context.active()) ?? list[0]
  })

  createEffect(() => {
    const tab = current()
    if (tab && tab.id !== context.active()) context.setActive(tab.id)
  })

  return (
    <Show when={context.enabled() && context.tabs().length > 0}>
      <div data-component="office-ribbon" class="shrink-0 border-b border-border bg-panel/40">
        <div role="tablist" class="flex items-end gap-0.5 px-2 pt-1">
          <For each={context.tabs()}>
            {(tab) => (
              <button
                type="button"
                role="tab"
                data-action={`office-ribbon-tab-${tab.id}`}
                aria-selected={current()?.id === tab.id}
                disabled={tab.disabled}
                class={[
                  TAB_BUTTON,
                  current()?.id === tab.id
                    ? "border-b-2 border-primary bg-background text-foreground"
                    : "border-b-2 border-transparent",
                ].join(" ")}
                onClick={() => context.setActive(tab.id)}
              >
                {tab.label}
              </button>
            )}
          </For>
        </div>
        {/* 内边距与行高由编辑器自己的 <RibbonRow> 提供，宿主只保底一个高度，避免双层 padding 叠出来。 */}
        <div class="min-h-9" data-action="office-ribbon-commands">
          <Show when={current()} keyed>{(tab) => tab.render()}</Show>
        </div>
      </div>
    </Show>
  )
}

/** 常用的小按钮样式：功能区里的文字按钮。 */
export const RIBBON_BUTTON =
  "rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors " +
  "hover:bg-hover hover:text-foreground disabled:opacity-40"

/**
 * 「开着的命令 / 正在编辑」这一种状态在整个右栏只有一种画法：用主题的强调色。
 * 之前各处写死 emerald-100/300，浅色主题下浅字压浅底直接看不见。
 */
export const PREVIEW_ACTIVE_CLASS = "border-icon-blue/40 bg-icon-blue/10 text-icon-blue hover:bg-icon-blue/20"

/** 开关按钮：开着的命令给一层底色，和编辑器里的工具栏保持一致。 */
export function ribbonToggleClass(active: boolean | undefined) {
  return [
    "grid size-6 place-items-center rounded border text-11-medium transition-colors",
    active ? PREVIEW_ACTIVE_CLASS : "border-transparent text-foreground-subtle hover:bg-hover hover:text-foreground",
  ].join(" ")
}

/** 分组之间的竖分隔线。 */
export function RibbonSeparator() {
  return <span class="mx-0.5 h-4 w-px shrink-0 self-center bg-border" />
}

const RIBBON_TRIGGER =
  "flex h-6 shrink-0 cursor-pointer items-center gap-0.5 rounded border border-transparent px-1.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground data-[disabled]:opacity-40"

/**
 * 功能区的一行：永远只有一行，控件不换行。
 *
 * 之前每类文件都把命令铺成 `flex flex-wrap`，右栏一窄就变成两三行高，
 * 找按钮要横向纵向一起扫。这里钉死单行 + 横向滚动兜底；放不下的高频度低的命令
 * 由各标签自己收进 `RibbonMore`，互斥选项收成 `RibbonChoice`。
 */
export function RibbonRow(props: ParentProps) {
  return (
    <div
      data-component="ribbon-row"
      class="flex h-9 min-w-0 flex-nowrap items-center gap-1 overflow-x-auto overflow-y-hidden px-2 [scrollbar-width:thin]"
    >
      {props.children}
    </div>
  )
}

export type RibbonChoiceOption<T extends string> = {
  id: T
  label: string
  /** 悬停说明，例如「两端对齐」。 */
  title?: string
}

/** 一组互斥选项压成一个下拉控件（对齐▾、列表▾、换行方式▾）。 */
export function RibbonChoice<T extends string>(props: {
  /** data-action 后缀，给测试和样式用，例如 `docx-list`。 */
  id: string
  label: string
  options: readonly RibbonChoiceOption<T>[]
  value?: T
  onSelect: (id: T) => void
  disabled?: boolean
  title?: string
  /** 触发器上显示的文字；不传就用 label（选项很多时显示当前值更直观）。 */
  display?: string
}) {
  return (
    <DropdownMenu gutter={4} placement="bottom-start">
      <DropdownMenu.Trigger
        class={RIBBON_TRIGGER}
        disabled={props.disabled}
        title={props.title ?? props.label}
        data-action={`ribbon-choice-${props.id}`}
      >
        <span class="truncate">{props.display ?? props.label}</span>
        <Icon name="chevron-down" size="small" class="shrink-0" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="min-w-32">
          <For each={props.options}>
            {(option) => (
              <DropdownMenu.Item disabled={props.disabled} onSelect={() => props.onSelect(option.id)}>
                <DropdownMenu.ItemLabel class="flex items-center gap-2">
                  <span class="w-3 shrink-0 text-11-regular">{option.id === props.value ? "✓" : ""}</span>
                  <span title={option.title}>{option.label}</span>
                </DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}

/**
 * 「更多格式▾」：这一行放不下的低频命令统一收在这里。
 *
 * 面板里直接放编辑器自己的命令节点（选择框、色块、数字框都行），不复制状态 ——
 * 显示的就是当前段落/单元格的真实值。菜单不会因为点了控件就自动收起，
 * 连改两项不用重新展开。
 */
export function RibbonMore(props: { label?: string; children: JSX.Element }) {
  return (
    <DropdownMenu gutter={4} placement="bottom-end">
      <DropdownMenu.Trigger class={RIBBON_TRIGGER} data-action="ribbon-more" title={props.label ?? "更多格式"}>
        <span class="shrink-0">{props.label ?? "更多格式"}</span>
        <Icon name="chevron-down" size="small" class="shrink-0" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="max-w-[min(420px,calc(100vw-32px))]">
          <div class="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto p-0.5">{props.children}</div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}

/** 「更多格式」面板里的一小组：标题 + 控件横排。 */
export function RibbonMoreGroup(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-1">
      <span class="text-11-regular text-foreground-subtlest">{props.label}</span>
      <div class="flex flex-wrap items-center gap-1">{props.children}</div>
    </div>
  )
}
