import { createMemo, For, Show } from "solid-js"
import type { RGBA } from "@opentui/core"
import { InstallationVersion } from "@novaway/core/installation/version"
import { TUI_BRAND } from "../../brand"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectoryParts } from "../../context/directory"
import { useRoute } from "../../context/route"
import { useConnected } from "../../component/use-connected"
import { icon } from "../../util/panel-icons"
import { Locale } from "../../util/locale"

// 同一组里相邻两段之间的空隙(原型的 gap 14px ≈ 2 列)。
const ITEM_GAP = 2
// 左右两组之间那条弹性空隙的**下界**。根盒是 [左组 | 弹性空隙 | 右组] 三个子盒,
// 所以这一条要留的是**两个** ITEM_GAP(空隙两侧各一个),不是 1。
const SPACER = 2 * ITEM_GAP
// 路径低于这个列数就没有信息量了(只剩省略号和两三个字符),整项丢掉而不是渲染一串省略号。
const PATH_MIN = 12
// 分支名的下限 = 图标 1 + 空格 1 + 4 个字符。低于它截出来的「⑂ …n」是残段,不如整段丢掉。
const BRANCH_MIN = 6

// 终端的字符编码 TUI 拿不到,也不该猜:这是原型的静态标签。做成 prop 而不是写死在渲染层里,
// 是为了将来真接到文件编码探测时不用再改组件签名。
const TERMINAL_ENCODING = "UTF-8"

interface FooterItem {
  /** 图标字形(panel-icons 的 icon(...))。带图标时 itemColumns 要算上图标后面那 1 列空格。 */
  icon?: string
  iconColor?: RGBA
  label: string
  color: RGBA
}

interface State {
  /** 左组的状态项(左到右)。 */
  left: FooterItem[]
  encoding: string
  version: string
}

function itemColumns(item: FooterItem) {
  const glyph = item.icon ? Locale.displayWidth(item.icon) + 1 : 0
  return glyph + Locale.displayWidth(item.label)
}

/**
 * 一组段的列数:各段宽度之和 + 相邻**已渲染**段之间的 ITEM_GAP。
 * null = 这一段没渲染,它两侧的 gap 也就不存在了 —— 所以要先滤掉再数段,不能按固定段数算。
 */
function groupColumns(items: (number | null)[]) {
  const present = items.filter((value): value is number => value !== null)
  return present.reduce((sum, value) => sum + value, 0) + Math.max(0, present.length - 1) * ITEM_GAP
}

/** 弹性项(路径 / 分支名)在给定列预算里怎么显示,规则与常量的理由见文件头。 */
function fitPath(path: string, columns: number) {
  if (!path || columns < PATH_MIN) return ""
  return Locale.truncateMiddleToWidth(path, columns)
}

function fitBranch(branch: string, columns: number) {
  if (!branch || columns < BRANCH_MIN) return ""
  if (Locale.displayWidth(branch) <= columns) return branch
  return Locale.truncateMiddleToWidth(branch, columns)
}

export interface SessionFooterBarProps {
  /** 可用列数。会话主区那一层已经按 paddingLeft/Right=2(共 4 列)和侧栏宽度扣过了
   *  (见 routes/session/index.tsx 的 contentWidth),传进来的是净值,这里不再重复扣。 */
  width: number
  directory: string
  branch?: string
  lsp: number
  mcp: number
  mcpError: boolean
  permissions: number
  connected: boolean
  encoding?: string
  brand: string
  version: string
}

/**
 * 会话页底栏(原型 card-design-v7.html:1134-1144 的 `.footer`):一行低调的小字,左组是
 * 「目录 / LSP / MCP / 权限」,右组是「分支 / 编码 / 品牌 + 版本」,中间弹性留白。
 *
 * 与霓虹卡壳(NeonCard)、输入卡(PromptCard)、侧栏分区卡(SidebarCard)同一条规矩:
 * 只依赖 useTheme(),不碰 session / sync / project context,所有数据由 props 进来。这样测试能
 * 直接挂载真壳量真实几列 —— 这里的每一列预算都是实测出来的,手抄一份 markup 到测试里的话,
 * 改这里的 gap / 优先级顺序都不会有任何测试变红。
 *
 * 宽度的唯一口径是显示列(Locale.displayWidth),不是码元:这一行里混着 CJK 文案(「权限」4 列)
 * 与 East-Asian Ambiguous 图标,按 str.length 算会低估好几列,右端直接被顶出去。
 *
 * 整行是**单行**:根盒 flexShrink={0},每个 <text> 都 wrapMode="none",所以任何一项都不允许
 * 折行 —— 折行会把下面整个输入区顶高一格。放不下时按下面的顺序主动让位:
 *
 *   「固定项」= 除路径与分支名以外的每一段。按 **保留优先级** 逐项试放:LSP → MCP → 权限 →
 *   版本 → 编码,**第一项放不下就停**(后面的项优先级更低;让更便宜的「编码」挤掉更贵的「LSP」
 *   才是错的)。每放一项都要求剩下的列还够「路径 + 分支名」的存在成本
 *   (PATH_MIN + 分支名自然宽 + 各自的 gap),免得弹性项到最后发现自己一行都放不下。
 *   顺序按「丢了之后用户还能不能自己查到」排:有待批权限 / MCP 失败时,这两件事各自已经有
 *   一整块更醒目的 UI(PermissionPrompt、/status 对话框),状态栏这行是重复的;LSP 只有这一处
 *   常驻,所以排最前;版本在 /status、dialog-debug 里都查得到;编码谁也查不到,只占 5 列,排最后。
 *   品牌落款(● NovaWay)不在候选里 —— 它是这一行的署名,任何一档都保留。
 *
 *   固定项都定下来之后,剩下的列分给两块弹性项:**先路径、后分支名**。两者都先按列从中间截断,
 *   低于各自下限才整段丢。右组整体优先于左组 —— 它回答的是"当前在哪个分支、用哪个构建跑";
 *   左组的目录是底部区域里**唯一**一份路径:输入卡外面的状态行原来也印一份
 *   (`location()?.directory`),但服务端的 Session.createNext 只接受调用方传的 directory,
 *   而它的两个调用方都传 `InstanceState.context.directory`,与 path.get().directory 同一个值
 *   (那一行还少了 abbreviateHome),所以那是纯重复,已经删掉。
 *
 *   由此可证「整行一定放得下」:阶梯停下来的条件是
 *   SPACER + 左组(路径按 PATH_MIN 算) + 右组(分支名按自然宽算) ≤ width。弹性列 =
 *   width − SPACER − 两组去掉弹性项后的固定宽度,而上面那两处的差额恰好是
 *   「路径 + 它的 gap + 分支名 + 它的 gap」,于是弹性列 ≥ 路径预算 + 分支名预算,
 *   两块弹性项各自不会超过自己的预算,总列数 ≤ width。弹性列被 clamp 到 0 时(终端窄到
 *   放不下阶梯的第一项)结论仍成立:此时两块弹性项都不渲染,留下的固定部分正是阶梯量过的那个。
 *   唯一不成立的是 width < SPACER(4) + 「● NovaWay」(9) = 13 列 —— 那时连品牌落款自己都
 *   放不下,交给终端裁切;这个宽度下输入卡本身也已经放不下了。
 */
export function SessionFooterBar(props: SessionFooterBarProps) {
  const { theme } = useTheme()

  // 左组的状态项。0 项的显示规则:只有 LSP 保留 0(「没有语言服务器」本身是有效信息,也是原型的
  // 第一项);MCP 与权限在 0 时整项不渲染 —— 静默成功不是状态,显示出来只是噪声。有 MCP failed /
  // 有待批权限时才有事要说,而那两件事各自已经有一大块更醒目的 UI。
  // 还没连上任何提供商时不显示这几项,改成给一条「开始使用 /connect」的提示(旧版底栏的行为)。
  const status = createMemo<FooterItem[]>(() => {
    if (!props.connected) return [{ label: "开始使用 /connect", color: theme.textMuted }]
    const items: FooterItem[] = [
      {
        icon: icon("check"),
        iconColor: props.lsp > 0 ? theme.success : theme.textMuted,
        label: `${props.lsp} LSP`,
        color: theme.textMuted,
      },
    ]
    if (props.mcp > 0 || props.mcpError)
      items.push({
        icon: icon("gear"),
        iconColor: props.mcpError ? theme.error : theme.success,
        label: `${props.mcp} MCP`,
        color: theme.textMuted,
      })
    if (props.permissions > 0)
      items.push({
        icon: icon("key"),
        iconColor: theme.warning,
        label: `${props.permissions} 权限`,
        color: theme.warning,
      })
    return items
  })

  const layout = createMemo(() => {
    const brand = `${icon("led")} ${props.brand}`
    const branch = props.branch ? `${icon("branch")} ${props.branch}` : ""
    const branchWidth = branch ? Locale.displayWidth(branch) : null
    const encoding = props.encoding ?? ""

    // 左组的排布是 [路径] + 状态项,右组是 [分支] + 编码 + 品牌落款(版本粘在落款后面,
    // 中间只隔 1 列空格,不占 ITEM_GAP)。路径与分支各自是本组第一段,前面没有 gap。
    const leftColumns = (pathWidth: number | null, left: FooterItem[]) =>
      groupColumns([pathWidth, ...left.map(itemColumns)])
    const rightColumns = (branchWidth: number | null, state: { encoding: string; version: string }) =>
      groupColumns([
        branchWidth,
        state.encoding ? Locale.displayWidth(state.encoding) : null,
        state.version ? Locale.displayWidth(`${brand} ${state.version}`) : Locale.displayWidth(brand),
      ])

    // 「固定项」= 除路径与分支以外的每一段。候选顺序 = **保留优先级**,理由见文件头。
    const candidates: ({ kind: "item"; item: FooterItem } | { kind: "version" } | { kind: "encoding" })[] = [
      ...status().map((item) => ({ kind: "item" as const, item })),
      { kind: "version" as const },
      { kind: "encoding" as const },
    ]
    const grow = (acc: State, candidate: (typeof candidates)[number]): State =>
      candidate.kind === "item"
        ? { ...acc, left: [...acc.left, candidate.item] }
        : candidate.kind === "version"
          ? { ...acc, version: props.version }
          : { ...acc, encoding }

    // 逐项试放,**第一项放不下就停**:后面的项优先级更低,为了让它们挤上来而丢掉更高优先级的
    // 那一项是错的(而且更便宜的项会一路挤到底 —— 窄终端上最后留下来的会是「编码在、LSP 不在」)。
    // 每放一项都要求「路径 + 分支名」的存在成本还留得住,免得弹性项到最后发现自己一行都放不下。
    const kept = candidates.reduce<{ state: State; done: boolean }>(
      ({ state, done }, candidate) => {
        if (done) return { state, done }
        const next = grow(state, candidate)
        const reserved = SPACER + leftColumns(PATH_MIN, next.left) + rightColumns(branchWidth, next)
        return reserved > props.width ? { state, done: true } : { state: next, done }
      },
      { state: { left: [], encoding: "", version: "" }, done: false },
    ).state

    // 弹性列 = 整行减去两组的固定部分。路径与分支各自是本组第一段,但只要渲染出来,它们
    // 与本组第二段之间各多带一个 ITEM_GAP(路径↔第一个状态项 / 分支↔编码),这两个 gap 由
    // pathGap / branchGap 先各留一列 —— 其中一个最终没渲染时,这一列落进中间的弹性空隙,不亏。
    const leftFixed = leftColumns(null, kept.left)
    const rightFixed = rightColumns(null, kept)
    const elastic = Math.max(0, props.width - SPACER - leftFixed - rightFixed)
    const pathGap = kept.left.length > 0 ? ITEM_GAP : 0
    const branchGap = branch ? ITEM_GAP : 0
    // 先路径(把分支名的存在成本让出来),剩下的给分支名。
    const path = fitPath(props.directory, elastic - pathGap - (branchWidth ?? 0) - branchGap)
    const rest = elastic - pathGap - Locale.displayWidth(path)
    return { ...kept, path, branch: fitBranch(branch, rest - branchGap) }
  })

  return (
    <box width="100%" flexDirection="row" gap={1} flexShrink={0}>
      <box flexDirection="row" gap={ITEM_GAP} flexShrink={0}>
        <Show when={layout().path}>
          <text flexShrink={0} fg={theme.textMuted} wrapMode="none">
            {layout().path}
          </text>
        </Show>
        <For each={layout().left}>
          {(item) => (
            <text flexShrink={0} fg={item.color} wrapMode="none">
              <Show when={item.icon}>
                <span style={{ fg: item.iconColor }}>{item.icon} </span>
              </Show>
              {item.label}
            </text>
          )}
        </For>
      </box>
      {/* 左右两组之间的弹性空隙。宽度账已经保证整行放得下,这里只负责把多出来的列吃掉。 */}
      <box flexGrow={1} minWidth={0} />
      <box flexDirection="row" gap={ITEM_GAP} flexShrink={0}>
        <Show when={layout().branch}>
          <text flexShrink={0} fg={theme.textMuted} wrapMode="none">
            {layout().branch}
          </text>
        </Show>
        <Show when={layout().encoding}>
          <text flexShrink={0} fg={theme.textMuted} wrapMode="none">
            {layout().encoding}
          </text>
        </Show>
        <text flexShrink={0} wrapMode="none">
          <span style={{ fg: theme.success }}>{icon("led")} </span>
          <b>{props.brand}</b>
          {/* 版本被跳过时这里连那个空格一起不渲染 —— 否则渲染出来的列数比宽度账多 1。 */}
          <Show when={layout().version}>
            <span style={{ fg: theme.textMuted }}> {layout().version}</span>
          </Show>
        </text>
      </box>
    </box>
  )
}

/**
 * 数据采集的薄容器。上面那个组件只管画,这里负责从 sync / project / route 里把数取出来。
 * 会话页底栏只有这一个调用方,没有必要做成插件槽(sidebar_footer / home_footer 那种);
 * 真要开放给第三方时,把这层换成 session_footer 槽即可。
 */
export function Footer(props: { width: number }) {
  const sync = useSync()
  const route = useRoute()
  const connected = useConnected()
  const parts = useDirectoryParts()
  const lsp = createMemo(() => sync.data.lsp.length)
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((item) => item.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((item) => item.status === "failed"))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return 0
    return sync.data.permission[route.data.sessionID]?.length ?? 0
  })

  return (
    <SessionFooterBar
      width={props.width}
      directory={parts().directory}
      branch={parts().branch}
      lsp={lsp()}
      mcp={mcp()}
      mcpError={mcpError()}
      permissions={permissions()}
      connected={connected()}
      encoding={TERMINAL_ENCODING}
      brand={TUI_BRAND.name}
      version={InstallationVersion}
    />
  )
}
