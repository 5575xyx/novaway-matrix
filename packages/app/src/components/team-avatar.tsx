import { For, Show, type Component } from "solid-js"

/**
 * 团队头像与成员叠层（群聊列表用）。
 *
 * 列表里一行的两个问题：这是哪支队、里面都有谁。前者用一枚稳定的团队头像回答，
 * 后者用最多三张成员头像叠在右边回答 —— 只看人数和只看名字都答不了「谁在这支队里」。
 * 头像全部来自员工自己的离线头像，不额外引入资源。
 */

const TONES = [
  "bg-primary/10 text-primary",
  "bg-success/10 text-success",
  "bg-warning/10 text-warning",
  "bg-icon-blue/10 text-icon-blue",
  "bg-destructive/10 text-destructive",
] as const

const hash = (value: string) => {
  let result = 2166136261
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

/**
 * 团队头像里的两个字。
 *
 * 中文直接取前两个字；英文名（`parallel-test-team`）取前两个词的首字母 ——
 * 截前两个字符会得到 `pa`、`fm` 这种看不出区别的缩写。
 */
export function teamInitials(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return "队"
  const ascii = /^[\x20-\x7F]+$/.test(trimmed)
  const words = trimmed.split(/[\s\-_·]+/).filter(Boolean)
  if (ascii && words.length > 1) return (words[0]![0]! + words[1]![0]!).toUpperCase()
  return trimmed.slice(0, 2)
}

/** 团队头像：按队名稳定着色，同一支队每次打开都是同一个颜色。 */
export const TeamAvatar: Component<{ name: string; class?: string }> = (props) => {
  const tone = () => TONES[hash(props.name) % TONES.length] ?? TONES[0]
  return (
    <span
      class={`grid size-9 shrink-0 place-items-center rounded-[10px] text-ui-xs font-medium ring-1 ring-inset ring-border ${tone()} ${props.class ?? ""}`}
      aria-hidden="true"
    >
      {teamInitials(props.name)}
    </span>
  )
}

/**
 * 成员叠层。
 *
 * 最多三张，按名册顺序从左往右压着排；多于三张时补一个「+N」，告诉用户
 * 这支队里还有人，而不是假装只有三个。悬停显示是谁。
 */
export const MemberStack: Component<{
  members: readonly { name: string; agent: string; role: string }[]
  /** 名册总人数：用来算「+N」，与叠出来的张数无关。 */
  total: number
  avatarOf: (agent: string) => string
  labelOf: (member: { name: string; agent: string; role: string }) => string
}> = (props) => {
  const shown = () => props.members.slice(0, 3)
  const rest = () => Math.max(0, props.total - shown().length)
  return (
    <Show when={shown().length > 0}>
      <span class="flex shrink-0 items-center">
        <For each={shown()}>
          {(member, index) => (
            <img
              src={props.avatarOf(member.agent)}
              alt=""
              draggable={false}
              title={props.labelOf(member)}
              class="size-6 rounded-full border-2 border-background object-cover"
              style={{
                "margin-left": index() === 0 ? "0" : "-8px",
                "z-index": String(shown().length - index()),
              }}
            />
          )}
        </For>
        <Show when={rest() > 0}>
          <span
            class="grid size-6 place-items-center rounded-full border-2 border-background bg-surface text-[10px] font-medium text-foreground-subtle"
            style={{ "margin-left": "-8px" }}
          >
            +{rest()}
          </span>
        </Show>
      </span>
    </Show>
  )
}
