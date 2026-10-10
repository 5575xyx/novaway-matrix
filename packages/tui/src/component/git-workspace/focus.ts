// 工作区的面板枚举与键位映射。**纯数据 + 纯函数**,不碰终端、不碰 Solid —— 键位表是这套
// 交互里最容易错的东西(同一个键在不同面板含义不同),只有脱离渲染才能单测得住。
//
// 键名的词汇表由本仓库的 `keyOfParsed`(本文件末尾)定义 —— **不是** @opentui/keymap
// 的写法。两者不一样:keymap 把 `return` 规范成 `enter`、把 shift+tab 拼成 `shift+tab`,
// 而 opentui 的**事件名**是 `escape` / `return`(见 src/util/selection.ts:66)。
// 表里的拼写以 keyOfParsed 的输出为准,改一边就要同步改另一边。
export type PanelID = "status" | "files" | "branches" | "commits" | "stash"

export const PANEL_ORDER: readonly PanelID[] = ["status", "files", "branches", "commits", "stash"]

/** 面板标题,全中文(规格:面向国内用户,git 术语也中文化)。 */
export const PANEL_TITLE: Record<PanelID, string> = {
  status: "状态",
  files: "文件",
  branches: "分支",
  commits: "提交",
  stash: "贮藏",
}

export function panelIndex(id: PanelID): number {
  return PANEL_ORDER.indexOf(id)
}

export function panelAt(index: number): PanelID {
  // 负数要能绕回末尾(shift-tab 从第一个面板往回按),所以先归一化到 [0, len)。
  const length = PANEL_ORDER.length
  return PANEL_ORDER[((index % length) + length) % length]
}

/**
 * 解析出来的工作区命令。`panel.jump:N` 带目标面板下标 —— 数字键 1-5 直接跳面板,
 * 拼成一个命令而不是五条,是因为调用方拿到之后的动作是同一个(把焦点设到第 N 个面板)。
 */
export type WorkspaceCommand =
  | "panel.next"
  | "panel.prev"
  | `panel.jump:${number}`
  | "row.up"
  | "row.down"
  | "status.space"
  | "status.m"
  | "files.stage"
  | "files.stageAll"
  | "files.focusDiff"
  | "files.discard"
  | "files.delete"
  | "branches.checkout"
  | "branches.new"
  | "branches.delete"
  | "commits.focusDiff"
  | "commits.undo"
  | "stash.pop"
  | "stash.discard"
  | "global.commit"
  | "global.pull"
  | "global.push"
  | "global.refresh"
  | "global.help"
  | "global.close"

/**
 * 全局键:**任何时候**都有效,与焦点面板无关。
 *
 * **刻意不在表里的**:ctrl+c(中断)、ctrl+l(清屏)。工作区的拦截器必须放行这两个 ——
 * 它们是整个 TUI 的逃生口,吞掉它们等于让用户在工作区里没法中断卡住的命令。
 */
export const GLOBAL_KEYS: Readonly<Record<string, WorkspaceCommand>> = {
  tab: "panel.next",
  "shift-tab": "panel.prev",
  c: "global.commit",
  p: "global.pull",
  f: "global.push",
  r: "global.refresh",
  "?": "global.help",
  esc: "global.close",
  j: "row.down",
  k: "row.up",
}

/**
 * 每个面板的**局部键**,覆盖同名全局键。
 *
 * 为什么需要覆盖层而不是一张大表:键位要跟着焦点面板变(规格「底部键位提示条跟着焦点面板变」),
 * 而同一个键在不同面板确实是不同动作 —— `空格` 在状态面板是「作用于当前行」,在文件面板是
 * 「暂存这个文件」,在分支面板是「切换分支」。合成一张大表就得给每个面板都写全所有键,
 * 既啰嗦又容易漏。
 */
export const PANEL_KEYS: Readonly<Record<PanelID, Readonly<Record<string, WorkspaceCommand>>>> = {
  status: {
    space: "status.space",
    m: "status.m",
  },
  files: {
    space: "files.stage",
    a: "files.stageAll",
    enter: "files.focusDiff",
    d: "files.discard",
    x: "files.delete",
  },
  branches: {
    space: "branches.checkout",
    n: "branches.new",
    d: "branches.delete",
  },
  commits: {
    enter: "commits.focusDiff",
    z: "commits.undo",
  },
  stash: {
    space: "stash.pop",
    d: "stash.discard",
  },
}

/**
 * 要二次确认的命令(规格「危险操作不用弹窗,用再按一次确认」)。
 * 调用方按下这类键时不立刻执行,而是进入确认态;**同键**再按一次才真执行。
 */
export const DANGEROUS_COMMANDS: ReadonlySet<WorkspaceCommand> = new Set<WorkspaceCommand>([
  "files.discard",
  "files.delete",
  "branches.delete",
  "stash.discard",
])

/**
 * 一个键 → 一条工作区命令。焦点面板的局部键优先,没配到再落回全局键。
 *
 * 没有命令返回 `undefined`,调用方据此决定「不拦截,放行给上层」——
 * 这是聊天输入框还能正常打字的关键:用户在工作区里按 `q`、按 `v`、按输入法的字母,
 * 都得漏过去。
 *
 * 后两个参数默认取模块导出的真实表,**只为测试注入一对故意冲突的表**而存在:
 * 真实表的局部键与全局键没有同名交集,光跑真实表的话把这两层顺序对调照样全绿 ——
 * 覆盖优先级这条语义就没有任何测试保护。不额外抽 helper,它仍然是同一个函数。
 */
export function resolveWorkspaceCommand(
  panel: PanelID,
  key: string,
  localTable: Readonly<Record<string, WorkspaceCommand>> = PANEL_KEYS[panel],
  globalTable: Readonly<Record<string, WorkspaceCommand>> = GLOBAL_KEYS,
): WorkspaceCommand | undefined {
  const local = localTable[key]
  if (local) return local
  const global = globalTable[key]
  if (global) return global
  // 数字键 1-5 直接跳到对应面板(1 是状态,5 是贮藏)。
  if (key.length === 1 && key >= "1" && key <= "5") return `panel.jump:${Number(key) - 1}`
  return undefined
}

/**
 * @opentui/core 的键事件 → 本模块的键名。
 *
 * 为什么要这层归一化:ParsedKey 对同一个键有两套口径 —— 空格在 `sequence` 里是 `" "`,
 * 而 `name` 有时是 `" "`、有时已经是 `"space"`;ctrl 组合又只体现在 `ctrl` 布尔上而不是 name 里。
 * 不归一化的话,键位表里写的 `space` 和 `ctrl+c` 永远匹配不上实际事件。
 *
 * 还有一层是**词汇差异**:opentui 事件的 `name` 是 `escape` / `return`(仓库里
 * `src/util/selection.ts:66`、`src/component/error-component.tsx:63` 都是这么比的),
 * 而 `focus.ts` 的键位表写的是 `esc` / `enter`。这套映射是两者的契约 —— 少了它,
 * 按 `esc` 关工作区、按 `enter` 看差异都会解析成 `undefined` 而静默失效。
 *
 * 入参故意用结构化最小类型而不是 `ParsedKey`:这样测试能直接传对象字面量,
 * 不必去构造一个完整的核心类型。
 */
export function keyOfParsed(event: { name: string; ctrl: boolean; shift: boolean; sequence: string }): string {
  if (event.ctrl && event.name.length === 1) return `ctrl+${event.name}`
  if (event.shift && event.name === "tab") return "shift-tab"
  if (event.sequence === " " || event.name === " " || event.name === "space") return "space"
  if (event.name === "escape") return "esc"
  if (event.name === "return") return "enter"
  return event.name
}
