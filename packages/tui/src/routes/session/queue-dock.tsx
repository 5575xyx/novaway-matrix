import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { BoxRenderable, TextAttributes, type RGBA } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { useKV } from "../../context/kv"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "../../ui/border"
import { fadeIn } from "../../ui/neon"
import { draftPreview, type QueueDraft } from "../../prompt/queue"
import { useCommandShortcut } from "../../keymap"

type QueueDockProps = {
  items: QueueDraft[]
  sending?: string
  collapsed: boolean
  onToggle: () => void
  onSend: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onClearAll: () => void
  onMount?: (ref: BoxRenderable) => void
  /**
   * `⇧` 那一枚要不要播入场淡入。**省略 = 读 KV 里那个 animations_enabled**(默认开),
   * 与 SegmentTabs / ViewEntrance 的注入口同一套约定。
   *
   * 为什么给注入口而不是让测试去 KV 那一侧拨:kv.set 写的是**共享**的 state/kv.json
   * (test/component/prompt-card.test.tsx:384 记着这件事),中途失败就把后续所有测试的动画
   * 关掉。而「关动画 ⇒ 直接终态」恰恰是最该被测试的那条分支。
   */
  animate?: boolean
  /** 一帧多少毫秒,测试里调小。省略 = QUEUE_GLYPH_FADE_FRAME_MS。 */
  frameMs?: number
}

/**
 * 原型那枚 `⇧` 挂的是 `animation: nudge 1.6s ease-in-out infinite`(card-design-v7.html:490,
 * 关键帧在 :568),也就是一枚 translateY(-3px) 的上下轻推。
 *
 * **单行的盒子里没有纵向位移**:一行就是一格,而 `⇧` 与条数、`· <键>追加`、预览、折叠按钮
 * 挤在同一行上(标题行是钉死一行的,overflow 关不掉)—— 上下挪一格就是把它画到邻居那一行
 * 上去,那正是「排队提示串到别处」这类问题。所以换成这个设计语言里已经有的另一个维度:
 * ui/neon 的 `fadeIn` —— 两个**实色**之间插值(终端只有 RGB,alpha 到这一层必然被丢掉,
 * 见 fadeIn 的注释)。起点取 dock 自己的底色 `theme.backgroundPanel`,于是这一枚是从
 * 「和背景同色」长成 `theme.secondary` 的,读起来是「它亮起来了」而不是「它动了」。
 *
 * **不是循环**:原型那个 nudge 是 infinite,但单行里一枚反复明灭的字形会跟用户正在读的那条
 * 提示抢注意力,而这个 dock 只在「有消息排队」这一小段时间里挂在输入框上方。所以只在**挂载
 * 那一拍**播一次 —— 而 dock 本身是 `queueStore.items.length > 0` 才挂的(index.tsx:2109),
 * 也就是说挂载 ≈ 「刚刚排进来一条」,正是原型想提醒的那一下。走完就停,不留残影。
 */

/** 淡入的总帧数。5 帧 × 40ms = 200ms:跨过「看得出在变」的全部信息,又短到不像在等。 */
export const QUEUE_GLYPH_FADE_FRAMES = 5

/** 一帧多少毫秒。5 × 40 = 200ms(理由见上)。 */
const QUEUE_GLYPH_FADE_FRAME_MS = 40

/**
 * 相位 → `⇧` 那一枚的字色。走 ui/neon 的 fadeIn(两个实色插值),外面套一层 ease-out ——
 * 与 segment-tabs 的 easeOutCubic、view-entrance 的 easeOut 二次同族:起步快、收尾稳。
 *
 * k = FRAMES 时**精确**回到 `to`:这是「一定落到位」这条断言的根据(动画只是过程,终态不许
 * 有误差,否则收尾那一帧会看见一次极短的回退)。越界的相位在这里夹紧。
 */
export function queueGlyphFade(from: RGBA, to: RGBA, frame: number) {
  // 夹紧的是**比例**而不是帧号:帧号夹到 1 会把 5 帧的淡入压成永远走不完的一帧。
  const k = Math.min(1, Math.max(0, frame) / QUEUE_GLYPH_FADE_FRAMES)
  return fadeIn(from, to, 1 - (1 - k) ** 2)
}

/**
 * 排队消息 dock：渲染在 Prompt 上方，展示当前会话中排队等待发送的提示。
 *
 * 折叠态显示条数 + 首条预览；展开态按顺序列出每条，支持「发送」「编辑」「删除」。
 * 键盘 `<leader>q` 切换折叠，鼠标点击操作按钮执行对应动作。
 *
 * 首部那一段照的是原型 card-design-v7.html:1104 的 `⇧ 2 条消息排队中 · 回车追加`：
 * `⇧` 字形 + `· <键>追加`。**键名不写死**——走 `useCommandShortcut("input.submit")` 现取，
 * 与输入卡发送按钮上那个键名（`PromptSend`）是同一套取法：`input_submit` 在 keybind.ts 里
 * 是 `keybind("return", …)`（可配置），由 keymap.tsx 的托管输入层 `gather("input", …)` 注册，
 * 所以用户改键之后这一行会跟着变；写死 "enter" 会在改键后变成一句假提示。
 * 那枚 `⇧` 的入场淡入见上面 queueGlyphFade。
 */
export function QueueDock(props: QueueDockProps) {
  const { theme } = useTheme()
  const kv = useKV()
  const renderer = useRenderer()
  const toggleShortcut = useCommandShortcut("session.queued_prompts")
  const submitShortcut = useCommandShortcut("input.submit")
  const [hover, setHover] = createSignal<string | null>(null)

  const count = createMemo(() => props.items.length)
  const preview = createMemo(() => (props.items[0] ? draftPreview(props.items[0], 48) : ""))
  const label = createMemo(() => (count() === 1 ? "1 条排队消息" : `${count()} 条排队消息`))
  // 取不到绑定时退回 "enter"：`formatKeySequence` 对未注册的序列给的是空串，而 keybind.ts 里
  // `input_submit` 的默认绑定就是 return —— 退回的是那条默认值，不是另编的一个键。
  const submitKey = createMemo(() => submitShortcut() || "enter")

  // 相位。首帧就是**起点**(而不是终态):这一枚就是要在挂载那一拍亮起来,所以这里从 0 起步。
  const [fadeFrame, setFadeFrame] = createSignal(0)
  const settled = createMemo(() => fadeFrame() >= QUEUE_GLYPH_FADE_FRAMES)
  const glyphColor = createMemo(() => queueGlyphFade(theme.backgroundPanel, theme.secondary, fadeFrame()))

  // 相位表只在淡入期间存在,推满即停 —— 与 NeonBox 的相位表 / NeonRail 的流动 / ViewEntrance
  // 的入场同一个取向:画完即静止,空闲零开销。
  createEffect(() => {
    if (settled()) return
    // 关掉动画 = 直接落终态:不留中间位置,也不留一张还在走的表(留着的话用户重新打开动画
    // 时它会接着往一个早就作废的目标上走)。与 ViewEntrance / SegmentTabs 同一套约定。
    if (!(props.animate ?? kv.get("animations_enabled", true))) {
      setFadeFrame(QUEUE_GLYPH_FADE_FRAMES)
      return
    }
    const timer = setInterval(() => {
      setFadeFrame((value) => Math.min(QUEUE_GLYPH_FADE_FRAMES, value + 1))
      // 这一版 opentui 不消费渲染物的 dirty 标志(见 component/segment-tabs 那个代价注释),
      // 动画每一格都要自己叫一次重绘。
      renderer.requestRender()
    }, props.frameMs ?? QUEUE_GLYPH_FADE_FRAME_MS)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <box
      ref={props.onMount}
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.secondary}
      customBorderChars={SplitBorder.customBorderChars}
      flexShrink={0}
    >
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={1} gap={1} flexShrink={0}>
        {/* 标题行：⇧ + 条数 + 「· <键>追加」+ 预览/说明 + 右端的折叠按钮 */}
        <box
          flexDirection="row"
          gap={1}
          alignItems="center"
          onMouseUp={() => props.onToggle()}
          onMouseOver={() => setHover("toggle")}
          onMouseOut={() => setHover(null)}
          backgroundColor={hover() === "toggle" ? theme.backgroundElement : theme.backgroundPanel}
          paddingLeft={1}
          paddingRight={1}
        >
          {/* `⇧` 的字色跟着入场淡入走:第 0 帧就是 dock 底色(那一格与背景同色,看不见),
              5 帧之后精确落在 theme.secondary 上。粗体不变 —— 那一档是「它是标题那一枚」,
              与亮度无关。 */}
          <text fg={glyphColor()}>
            <span style={{ attributes: TextAttributes.BOLD }}>⇧</span>
          </text>
          <text fg={theme.text} wrapMode="none">
            <b>{label()}</b>
          </text>
          {/* 原型那一行是 `⇧ 2 条消息排队中 · 回车追加`：`· <键>追加` 紧跟在条数后面。
              `{"· "}` 用表达式而不是裸文本 —— JSX 会吃掉独占一行的首尾空白。 */}
          <text fg={theme.textMuted} wrapMode="none">
            {"· "}
            {submitKey()} 追加
          </text>
          <Show when={props.collapsed}>
            <Show when={preview()}>
              <text fg={theme.textMuted} wrapMode="none">
                · {preview()}
              </text>
            </Show>
          </Show>
          <Show when={!props.collapsed}>
            <text fg={theme.textMuted} wrapMode="none">
              将按顺序自动发送
            </text>
          </Show>
          <box flexGrow={1} />
          <text fg={theme.textMuted} wrapMode="none">
            {props.collapsed ? "展开" : "折叠"} {toggleShortcut()}
          </text>
        </box>

        {/* 展开态：按序号列出每条消息 */}
        <Show when={!props.collapsed}>
          <box flexDirection="column" gap={1}>
            <For each={props.items}>
              {(item, index) => {
                const isSending = createMemo(() => item.id === props.sending)
                const isLast = createMemo(() => index() === props.items.length - 1)
                return (
                  <box
                    flexDirection="row"
                    gap={1}
                    paddingLeft={2}
                    paddingRight={1}
                    paddingTop={1}
                    paddingBottom={1}
                    backgroundColor={isSending() ? theme.backgroundElement : theme.backgroundPanel}
                    border={isLast() ? ["top"] : undefined}
                    borderColor={theme.border}
                    customBorderChars={SplitBorder.customBorderChars}
                    onMouseUp={() => props.onEdit(item.id)}
                    onMouseOver={() => setHover(`edit-${item.id}`)}
                    onMouseOut={() => setHover(null)}
                  >
                    <text fg={index() === 0 ? theme.secondary : theme.textMuted} wrapMode="none">
                      {index() + 1}
                    </text>
                    <text fg={theme.text} flexGrow={1}>
                      {isSending() ? <span style={{ fg: theme.secondary }}>发送中…</span> : draftPreview(item, 80)}
                    </text>
                    <Show when={!isSending()}>
                      <box
                        onMouseUp={(e) => {
                          e.stopPropagation()
                          props.onSend(item.id)
                        }}
                        onMouseOver={() => setHover(`send-${item.id}`)}
                        onMouseOut={() => setHover(null)}
                        backgroundColor={
                          hover() === `send-${item.id}` ? theme.backgroundElement : theme.backgroundPanel
                        }
                        paddingLeft={1}
                        paddingRight={1}
                      >
                        <text fg={theme.text}>发送</text>
                      </box>
                    </Show>
                    <Show when={!isSending()}>
                      <box
                        onMouseUp={(e) => {
                          e.stopPropagation()
                          props.onDelete(item.id)
                        }}
                        onMouseOver={() => setHover(`del-${item.id}`)}
                        onMouseOut={() => setHover(null)}
                        backgroundColor={hover() === `del-${item.id}` ? theme.backgroundElement : theme.backgroundPanel}
                        paddingLeft={1}
                        paddingRight={1}
                      >
                        <text fg={theme.textMuted}>删除</text>
                      </box>
                    </Show>
                  </box>
                )
              }}
            </For>
          </box>
        </Show>

        {/* 展开态底部：清空全部 */}
        <Show when={!props.collapsed}>
          <box flexDirection="row" gap={1} paddingLeft={2} paddingRight={1}>
            <box flexGrow={1} />
            <box
              onMouseUp={(e) => {
                e.stopPropagation()
                props.onClearAll()
              }}
              onMouseOver={() => setHover("clear")}
              onMouseOut={() => setHover(null)}
              backgroundColor={hover() === "clear" ? theme.backgroundElement : theme.backgroundPanel}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={theme.textMuted}>清空全部</text>
            </box>
          </box>
        </Show>
      </box>
    </box>
  )
}
