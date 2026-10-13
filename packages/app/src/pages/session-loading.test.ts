import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const sessionSource = readFileSync(join(import.meta.dir, "session.tsx"), "utf8")

// 全屏闪烁的病根是一个"返回值被丢弃却驱动顶层 Suspense"的 resource。Solid 把 pending 与
// refreshing 都算作 loading(solid dist/dev.js:407),所以 sessionSync 的每次后台 refetch 都会把
// 整个窗口换成 Splash。而会话数据实际走 WebSocket 写进 sync.data.message,与该返回值无关。
describe("session page stops blanking the whole window", () => {
  test("sessionSync is never read into the render tree", () => {
    expect(sessionSource).not.toContain("sessionSync")
  })

  // 去掉 Splash 会让时间线未就绪的空档露出来,所以必须就地补上骨架,否则只是把闪烁换成空白。
  test("the timeline gate falls back to a skeleton instead of nothing", () => {
    expect(sessionSource).toMatch(/<Show when=\{timelineReady\(\)\} fallback=\{<MessageTimelineSkeleton \/>\}>/)
  })

  // 骨架屏的开关必须是"只进不出"的:sync.data.message[id] 会被 dropSessionCaches 反复删掉再拉回
  // (列表清理、预取淘汰、LRU 淘汰共多个调用方),直接拿 messagesReady() 当开关会让骨架屏反复顶掉
  // 时间线,表现为每隔几秒闪一下。hydrated 记录"这个会话的数据到过",到过就永久为真,清不掉。
  test("the gate latches on first load so background cache churn cannot re-trigger it", () => {
    expect(sessionSource).toContain("return hydrated().has(id)")
    expect(sessionSource).toContain("sync.data.message[id] === undefined) return")
  })
})

describe("skeleton matches the real timeline so nothing shifts on load", () => {
  // 宽度取自 message-timeline.tsx 的真实内容容器,数据到位时才不会横向跳动。
  test("mirrors the centred content width", () => {
    expect(sessionSource).toContain("md:max-w-200 2xl:max-w-[1000px]")
    expect(sessionSource).toContain("md:mx-auto")
  })

  test("uses the project's existing bubble surface and pulse", () => {
    expect(sessionSource).toContain("bg-background-stronger")
    expect(sessionSource).toContain("animate-pulse")
  })
})
