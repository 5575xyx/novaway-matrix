/**
 * 团队编排总控（§13.1）。
 *
 * 它管的是「还能不能开始新的团队协作」，不是「立刻中止正在做的事」：
 * 关闭后不删任何数据、不停止已在跑的运行，只是不再注入 `team_run`、
 * 隐藏选择器、拒绝启动。
 *
 * 与内核的 `teams` 特性不是一回事：那个表示团队工具（team_create 等）是否加载。
 *
 * 默认开启：这个开关是在功能已经上线之后才补的，缺省关闭等于替用户把一个在用的
 * 功能关掉。用户要关，得自己写 `false`。
 */
export function enabled(experimental: { team_orchestration?: boolean } | undefined): boolean {
  return experimental?.team_orchestration !== false
}

/**
 * 关闭时给模型的话术。
 *
 * 不是「操作失败」：模型要能照着这句话继续做事 —— 退回普通对话，而不是重试同一个工具。
 */
export const DISABLED_OUTPUT =
  "Team orchestration is turned off in this workspace. Continue in the normal conversation instead: " +
  "do the work yourself, or ask the user to turn team orchestration back on."
