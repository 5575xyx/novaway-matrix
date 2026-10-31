/**
 * 运行内任务板注入（§5.5）。
 *
 * 任务板本身已经在库里（`agent_task`，落在 `team_run_team.id` 上），运行详情也读得到；
 * 但**模型看不到**。队长/成员在自己的上下文里不知道「这一轮还开着哪些口」，只能等
 * 用户开口。这里把「自己该关心的那些任务」写成一段提示词。
 *
 * 四条口径（与 §5.5 一致）：
 *
 * 1. 成员只看**自己负责**的非终态任务；队长看全队。别人的任务注进来只会制造噪音，
 *    而且会诱导成员去写别人的看板。
 * 2. 两种「空」必须分开：真实为空说「当前无待办」；被上限截掉说「另有 N 项未列出」，
 *    **不列被排除的 id**，否则截断就等于把排除清单泄露出去。
 * 3. 顺序稳定（按传入顺序，也就是创建顺序），不按更新时间抖动；同样的输入必须得到
 *    同样的上下文，否则两次运行看到的东西对不上，行为无法复现。
 * 4. 任务存在 ≠ 有会话在做：没有认领人的待办要标出来，别让模型以为已经有人开工。
 */
import type { Task, TaskStatus } from "./task-list"

/** 非终态：只有这两种状态还会被推进。已完成 / 失败 / 取消都是事实，不再提醒。 */
const ACTIVE: readonly TaskStatus[] = ["pending", "in_progress"]

/**
 * 注入上限：条数与字符各一道闸。
 *
 * 20 条足够描述一次运行里一个人手上的活；再多的部分对模型也没有信息量 ——
 * 它需要的是「该做什么」，不是完整清单。
 */
export const LIMITS = { count: 20, chars: 2_000 } as const

export type Input = {
  /** 队长看全队，成员只看自己的。 */
  captain: boolean
  sessionID: string
  tasks: readonly Task[]
  limits?: { count: number; chars: number }
}

export type View = {
  /** 写进上下文的整段文本（含 `<system-reminder>` 包裹）。 */
  text: string
  /** 内容签名：没变就不要重复注入。 */
  signature: string
  shown: number
  omitted: number
}

/**
 * 一次注入的完整视野。
 *
 * 纯函数：不读库、不看时间，同样的输入永远得到同样的输出 —— 这是它能被单测、
 * 也能用来判断「这一轮要不要重新注入」的前提。
 */
export function view(input: Input): View {
  const limits = input.limits ?? LIMITS
  const open = input.tasks.filter((task) => ACTIVE.includes(task.status))
  const tasks = input.captain ? open : open.filter((task) => task.ownerSessionID === input.sessionID)

  const lines: string[] = []
  let chars = 0
  for (const task of tasks) {
    if (lines.length >= limits.count) break
    const line = "- [" + task.status + "] " + task.subject + (task.ownerSessionID ? "" : "（未认领）")
    // 第一条无论如何都要写：否则字符上限比一行还小时，会显示成「当前无待办」——
    // 那是错的，任务是存在的，只是放不下。
    if (lines.length > 0 && chars + line.length > limits.chars) break
    lines.push(line)
    chars += line.length + 1
  }
  const omitted = tasks.length - lines.length

  const heading = input.captain
    ? "这次运行里全队还没结束的任务（队长视角，按创建顺序；有任务不代表已经有会话在做）："
    : "这次运行里分给你、还没结束的任务（按创建顺序；没认领的不算有人在做）："
  const text = [
    "<system-reminder>",
    heading,
    ...(lines.length > 0 ? lines : ["当前无待办。"]),
    ...(omitted > 0 ? ["另有 " + omitted + " 项未列出（超出注入上限）。"] : []),
    "</system-reminder>",
  ].join("\n")

  return {
    text,
    // 签名只覆盖**注入出去的内容**：任务改了描述但没有改标题/状态时不必重发。
    signature: [input.captain ? "captain" : "member", ...lines, "omitted=" + omitted].join("|"),
    shown: lines.length,
    omitted,
  }
}

export * as TaskBoard from "./task-board"
