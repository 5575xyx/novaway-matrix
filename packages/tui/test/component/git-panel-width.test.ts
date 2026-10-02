import { expect, test } from "bun:test"
import {
  branchHeadline,
  BRANCH_LABEL_MAX,
  commitSubjectText,
  COMMIT_SUBJECT_MAX,
  remoteNameText,
  REMOTE_NAME_MAX,
  remoteUrlText,
  REMOTE_URL_MAX,
  stashMessageText,
  STASH_MESSAGE_MAX,
} from "../../src/component/git-panel"
import { Locale } from "../../src/util/locale"
import { SIDEBAR_CARD_MIN_CONTENT, SIDEBAR_SECTION_MIN_CONTENT } from "../../src/util/sidebar-metrics"

// 这一组盯的是「Git 面板每一行的宽度都按显示列算,纯 ASCII 也不许超」。
// 上一轮把侧栏路径上的 CJK 截断统一到了 util/locale,但 Git 面板这四处漏了:
// 贮藏 / 提交 / 远程 / 当前分支 —— 其中提交行在纯 ASCII 下就已经超了 3 列。
//
// 断言一律走生产里的那几个 *Text 辅助函数(不是测试自己再截一遍),所以谁把
// oneLineToWidth 换回按码元的 oneLine,这里就会红。

// 各行的固定段(行内左内边距 + 不可截的尾巴)。
const STASH_ROW_TAIL = 11 // 最长的 ref「stash@{99}」10 + 它后面的空格 1
const COMMIT_ROW_TAIL = 11 // 「● 」2 + 标题后的空格 1 + 短 hash 7 + 行内左内边距 1
const REMOTE_ROW_TAIL = 6 // 「● 」2 + 悬停「 删」3 + 行内左内边距 1

test("贮藏行:ref + 说明不超卡片内容宽(ASCII 与中文都不超)", () => {
  const width = (message: string) => Locale.displayWidth(`stash@{99} ${stashMessageText(message)}`) + 1
  expect(width("m".repeat(200))).toBeLessThanOrEqual(SIDEBAR_CARD_MIN_CONTENT)
  expect(width("贮藏".repeat(60))).toBeLessThanOrEqual(SIDEBAR_CARD_MIN_CONTENT)
  expect(width("m".repeat(200))).toBeLessThanOrEqual(STASH_ROW_TAIL + STASH_MESSAGE_MAX + 1)
})

test("提交行:标题不超分区外内容宽(ASCII 与中文都不超)", () => {
  const width = (subject: string) => Locale.displayWidth(`● ${commitSubjectText(subject)} 1a2b3c4`) + 1
  expect(width("m".repeat(200))).toBeLessThanOrEqual(SIDEBAR_SECTION_MIN_CONTENT)
  expect(width("这是一条很长的中文提交说明".repeat(20))).toBeLessThanOrEqual(SIDEBAR_SECTION_MIN_CONTENT)
  // 旧值 30 是按码元定的:1 + 2 + 30 + 1 + 7 = 41 > 38。
  expect(COMMIT_SUBJECT_MAX).toBeLessThanOrEqual(SIDEBAR_SECTION_MIN_CONTENT - COMMIT_ROW_TAIL)
})

test("远程行:名字 + 地址不超分区外内容宽(ASCII 与中文都不超)", () => {
  const width = (name: string, url: string) =>
    Locale.displayWidth(`● ${remoteNameText(name)}${remoteUrlText(url)} 删`) + 1
  expect(width("o".repeat(80), "u".repeat(80))).toBeLessThanOrEqual(SIDEBAR_SECTION_MIN_CONTENT)
  expect(width("很长的远程仓库名字".repeat(6), "同样很长的远程地址文本".repeat(6))).toBeLessThanOrEqual(
    SIDEBAR_SECTION_MIN_CONTENT,
  )
  expect(REMOTE_NAME_MAX + REMOTE_URL_MAX + REMOTE_ROW_TAIL).toBeLessThanOrEqual(SIDEBAR_SECTION_MIN_CONTENT)
  // CJK 时这两个上限是真列,不是码元个数。
  expect(Locale.displayWidth(remoteNameText("远程名字".repeat(10)))).toBeLessThanOrEqual(REMOTE_NAME_MAX)
  expect(Locale.displayWidth(remoteUrlText("远程地址".repeat(10)))).toBeLessThanOrEqual(REMOTE_URL_MAX)
})

test("分支列表行:名字不超卡片内容宽", () => {
  // 行 = 左内边距 1 + 名字 + 悬停「 删」3,卡里放得下 36 − 4。
  expect(Locale.displayWidth(remoteNameText("m".repeat(200)))).toBeLessThanOrEqual(BRANCH_LABEL_MAX)
  expect(BRANCH_LABEL_MAX + 4).toBeLessThanOrEqual(SIDEBAR_CARD_MIN_CONTENT)
  expect(Locale.displayWidth(remoteNameText("分支名字".repeat(20)))).toBeLessThanOrEqual(BRANCH_LABEL_MAX)
})

// 当前分支行以前**完全没有截断**:46 个字符的分支名会画 55 列,被视口静默裁掉,
// 没有省略号。这一行是「分支名 → 上游 领先/落后」,上游和领先数每条仓库都不同,
// 所以预算必须按实际值算,不能拍一个固定上限。
test("当前分支行:名字与上游按实际可用列截断,合起来不超卡片内容宽", () => {
  const columns = SIDEBAR_CARD_MIN_CONTENT
  const width = (name: string, upstream: string, tracking: string) => {
    const head = branchHeadline({ name, upstream, tracking, columns })
    return (
      Locale.displayWidth(head.name) +
      (upstream ? 3 + Locale.displayWidth(head.upstream) : 0) +
      (tracking ? 1 + Locale.displayWidth(tracking) : 0)
    )
  }
  expect(width("main", "origin/main", "↑2")).toBeLessThanOrEqual(columns)
  // 最长的跟踪信息(` ↑999 ↓999` 是 10 列)。
  expect(width("main", "origin/main", "↑999 ↓999")).toBeLessThanOrEqual(columns)
  expect(width("a-very-long-branch-name-for-truncation", "origin/a-very-long-branch-name", "")).toBeLessThanOrEqual(
    columns,
  )
  expect(width("很长的中文分支名称".repeat(4), "远程/很长的中文上游分支名".repeat(3), "↑12 ↓3")).toBeLessThanOrEqual(
    columns,
  )
  // 长名字会被截,且带省略号 —— 不再是视口静默裁掉。
  expect(branchHeadline({ name: "m".repeat(80), upstream: "", tracking: "", columns }).name).toContain("…")
  // 没有上游时,名字独占剩余空间。
  expect(Locale.displayWidth(branchHeadline({ name: "m".repeat(80), upstream: "", tracking: "", columns }).name)).toBe(
    31,
  )
  // 上游最多拿 12 列,剩下的留给分支名。
  const head = branchHeadline({ name: "m".repeat(80), upstream: "u".repeat(80), tracking: "", columns })
  expect(Locale.displayWidth(head.upstream)).toBe(12)
  expect(Locale.displayWidth(head.name)).toBeGreaterThanOrEqual(4)
})
