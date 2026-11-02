// 输入框上方的「实时跟随」开关。
//
// 跟随是自动行为：面板自己弹出来、自己切文件、自己收起。如果用户看不到它的状态，
// 只会觉得右栏"乱弹"。所以把开关摆在输入框右上角，运行中常驻：
// 现在到底跟不跟、是不是正在跟，一眼能看出来，点一下就能切，不用翻设置页。
//
// 四个视觉状态（颜色只在绿 / 灰之间走，不引入第三种色相）：
// - off   ：灰、圆点静止 —— 设置里关掉了
// - armed ：绿、圆点静止 —— 开着，等下一笔写盘（不动，免得没在跟的时候也像在忙）
// - live  ：绿更实、圆点外圈脉冲 + 呼吸 —— 正在跟着某一笔写盘（标签换成"实时跟随中"）
// - taken ：灰、圆点静止 —— 用户碰了右栏接管了，本轮自动跟随暂停
//
// 点击反馈单独一条扩散环（.live-follow-flash）：它只表示"这一下点到了"，
// 不参与状态配色——否则按下的一瞬间颜色乱跳，反而看不清切没切。

import { Show, createMemo, createSignal, onCleanup } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { liveWritePath } from "@/pages/session/live-write"
import { followChipState, liveFollowState, resumeLiveFollow } from "@/pages/session/live-follow"

export function SessionLiveFollowChip(props: { sessionID: string }) {
  const settings = useSettings()
  const sync = useSync()
  const language = useLanguage()

  const enabled = () => settings.general.liveFileFollow()
  const follow = () => liveFollowState()
  const writing = createMemo(() => !!liveWritePath() && sync.data.session_working(props.sessionID))

  // 视觉状态的优先级在 live-follow.ts 里（followChipState），组件只管配色。
  const state = createMemo(() =>
    followChipState({
      enabled: enabled(),
      active: follow().active,
      hijacked: follow().hijacked,
      writing: writing(),
    }),
  )

  const label = createMemo(() => {
    if (state() === "live") return language.t("session.composer.liveFollow.active")
    if (state() === "taken") return language.t("session.composer.liveFollow.taken")
    return language.t("session.composer.liveFollow.label")
  })

  const title = createMemo(() =>
    language.t(enabled() ? "session.composer.liveFollow.disableHint" : "session.composer.liveFollow.enableHint"),
  )

  // 扩散环靠"值变了就换一个节点"重播 CSS 动画；动画结束后清 0 把节点摘掉。
  const [flash, setFlash] = createSignal(0)
  let flashTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    if (flashTimer) clearTimeout(flashTimer)
  })

  const toggle = () => {
    const next = !enabled()
    settings.general.setLiveFileFollow(next)
    // 重新打开 = 也解除"已接管"：本轮还开着的话，跟随应该马上恢复。
    if (next) resumeLiveFollow()
    setFlash((value) => value + 1)
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      flashTimer = undefined
      setFlash(0)
    }, 560)
  }

  return (
    <button
      type="button"
      data-component="session-live-follow-chip"
      data-state={state()}
      aria-pressed={enabled()}
      aria-label={title()}
      title={title()}
      onClick={toggle}
      classList={{
        "group relative inline-flex shrink-0 select-none items-center gap-1.5 rounded-full border px-2.5 py-1 text-11-medium leading-none": true,
        // 开关本身的过渡：颜色慢一点才看得出"状态换了"，位移快一点跟手。
        "transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out": true,
        "cursor-pointer outline-none hover:-translate-y-px active:translate-y-0 active:scale-[0.97]": true,
        "focus-visible:ring-2 focus-visible:ring-syntax-success/50": true,
        "border-syntax-success/35 bg-syntax-success/10 text-syntax-success hover:border-syntax-success/55 hover:bg-syntax-success/15":
          state() === "armed" || state() === "live",
        "border-syntax-success/60 bg-syntax-success/15 text-syntax-success": state() === "live",
        "border-border bg-surface text-foreground-subtlest hover:border-foreground-subtlest/40 hover:text-foreground-subtle":
          state() === "off",
        "border-border bg-surface text-foreground-subtle hover:text-foreground": state() === "taken",
      }}
    >
      {/* 点击扩散环：从胶囊边缘向外散开一圈，500ms 内消失。 */}
      <Show when={flash()} keyed>
        <span aria-hidden="true" class="live-follow-flash pointer-events-none absolute inset-0 rounded-full" />
      </Show>

      <span class="relative flex size-2 shrink-0 items-center justify-center">
        {/* 正在跟随：外圈脉冲（slow ping）。 */}
        <Show when={state() === "live"}>
          <span aria-hidden="true" class="live-follow-ping absolute inset-0 rounded-full bg-syntax-success" />
        </Show>
        <span
          aria-hidden="true"
          class="relative size-2 rounded-full transition-[background-color,opacity] duration-300"
          classList={{
            "bg-syntax-success": state() === "armed" || state() === "live",
            "bg-foreground-subtlest/50": state() === "taken",
            "bg-foreground-subtlest/60": state() === "off",
            // 只有真的在跟某一笔写盘时才呼吸：开着但没活干的时候保持安静。
            "novaway-breathe-dot": state() === "live",
          }}
        />
      </span>

      <span class="transition-opacity duration-200">{label()}</span>

      {/* 悬停时右侧浮现的小箭头：暗示"可以点"。只在 off/armed 显示，live 时保持安静。 */}
      <Show when={state() === "off"}>
        <span
          aria-hidden="true"
          class="relative -mr-0.5 flex size-3 items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-60"
        >
          <span class="absolute h-px w-2 bg-current" />
          <span class="absolute h-2 w-px bg-current" />
        </span>
      </Show>
      <Show when={state() !== "off"}>
        <span
          aria-hidden="true"
          class="relative -mr-0.5 flex size-3 items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-50"
        >
          <span class="absolute h-px w-2.5 bg-current" />
        </span>
      </Show>
    </button>
  )
}
