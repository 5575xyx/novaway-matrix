// 侧栏自适应宽度:随终端宽度伸缩,但钉死上下限。
// 下限 44:五个标签(文件/信息/Git/数据/智能中枢)一行放得下;
// 上限 60:再宽就把会话区挤得太窄,宽屏也就到此为止。
export const SIDEBAR_MIN_WIDTH = 44
export const SIDEBAR_MAX_WIDTH = 60

export function sidebarWidth(terminalWidth: number): number {
  const scaled = Math.round(terminalWidth * 0.25)
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, scaled))
}
