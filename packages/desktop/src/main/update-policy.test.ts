import { describe, expect, test } from "bun:test"
import {
  compareVersions,
  isPendingUpdateUsable,
  shouldAutoDownload,
  shouldCheckImmediatelyOnEnable,
  shouldReplaceDownloaded,
} from "./update-policy"

describe("update policy", () => {
  test("没有新版本不下载", () => {
    expect(shouldAutoDownload({ updateAvailable: false }, false)).toBe(false)
  })

  test("自动检查查到新版本就下载", () => {
    expect(shouldAutoDownload({ updateAvailable: true }, false)).toBe(true)
  })

  test("已经下载过就不再重复下载", () => {
    expect(shouldAutoDownload({ updateAvailable: true, downloaded: true }, false)).toBe(false)
    expect(shouldAutoDownload({ updateAvailable: true }, true)).toBe(false)
  })

  test("开机那次检查由主进程负责，渲染层挂载时不再重复查", () => {
    expect(shouldCheckImmediatelyOnEnable(false)).toBe(false)
  })

  test("用户中途重新打开开关，立刻补查一次", () => {
    expect(shouldCheckImmediatelyOnEnable(true)).toBe(true)
  })
})

describe("版本比较", () => {
  test("按数字逐段比较，不是字符串比较", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1)
    expect(compareVersions("1.9.0", "1.10.0")).toBe(-1)
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0)
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0)
  })

  test("预发布版小于同号正式版", () => {
    expect(compareVersions("1.2.3-beta.1", "1.2.3")).toBe(-1)
    expect(compareVersions("1.2.3", "1.2.3-beta.1")).toBe(1)
    expect(compareVersions("1.2.3-beta.2", "1.2.3-beta.10")).toBe(-1)
  })
})

describe("替换已下载的安装包", () => {
  test("什么都没下过 → 要下", () => {
    expect(shouldReplaceDownloaded(undefined, "2.0.0")).toBe(true)
  })

  test("线上有更新的版本 → 顶掉旧包，下最新的", () => {
    expect(shouldReplaceDownloaded("1.0.0", "2.0.0")).toBe(true)
  })

  test("线上还是同一版本 → 保留旧包，不重复下载", () => {
    expect(shouldReplaceDownloaded("2.0.0", "2.0.0")).toBe(false)
  })

  test("线上版本更旧（发布回滚）→ 不越换越旧", () => {
    expect(shouldReplaceDownloaded("2.0.0", "1.9.0")).toBe(false)
  })
})

describe("待安装更新是否还有效", () => {
  test("记录版本高于当前运行版本 → 没装，保留", () => {
    expect(isPendingUpdateUsable({ version: "2.0.0" }, "1.0.0")).toBe(true)
  })

  test("记录版本等于当前版本 → 已经装上了，安装包可以删", () => {
    expect(isPendingUpdateUsable({ version: "2.0.0" }, "2.0.0")).toBe(false)
  })

  test("没有记录 → 没有待安装的更新", () => {
    expect(isPendingUpdateUsable(undefined, "1.0.0")).toBe(false)
  })
})
