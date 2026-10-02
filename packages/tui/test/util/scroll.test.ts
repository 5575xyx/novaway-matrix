// 滚动守卫的单测。
//
// `scrollIfAlive` 是那种「改错了要等用户按了 PageDown 才发现」的分支:视图切换会把某个
// scrollbox 卸载,而 Solid 的 `ref={(r) => (box = r)}` 在元素销毁时不会再被调用一次置空,
// 于是那个变量会一直指着一个已销毁的 renderable。抽成纯函数就是为了能在这里直接钉住它。
import { expect, test } from "bun:test"
import type { ScrollBoxRenderable } from "@opentui/core"
import { scrollIfAlive } from "../../src/util/scroll"

// 只用到 isDestroyed 与被转发的方法,其余一律不需要 —— 真造一个 ScrollBoxRenderable 要挂渲染上下文。
function fake(alive: boolean, calls: string[] = []) {
  return {
    isDestroyed: !alive,
    scrollBy: (delta: number) => calls.push(`scrollBy:${delta}`),
    scrollTo: (top: number) => calls.push(`scrollTo:${top}`),
  } as unknown as ScrollBoxRenderable & { isDestroyed: boolean }
}

test("scrollIfAlive:容器活着就把动作转发出去,并报告执行了", () => {
  const calls: string[] = []
  const done = scrollIfAlive(fake(true, calls), (target) => target.scrollBy(-10))
  expect(done).toBe(true)
  expect(calls).toEqual(["scrollBy:-10"])
})

test("scrollIfAlive:容器已销毁就静默收手,一个动作都不发", () => {
  const calls: string[] = []
  expect(scrollIfAlive(fake(false, calls), (target) => target.scrollBy(-10))).toBe(false)
  expect(calls).toEqual([])
})

test("scrollIfAlive:容器压根不存在(视图还没挂上)同样静默收手", () => {
  const calls: string[] = []
  expect(scrollIfAlive(undefined, (target) => target.scrollBy(1))).toBe(false)
  expect(calls).toEqual([])
})

// 「已销毁」这条是真正会咬人的那一种:bubble → flow 切一次,scroll 就变成已销毁对象,
// 而翻页命令仍然能被键盘触发。
test("scrollIfAlive:视图切走之后 scrollbox 已销毁,翻页命令不再打在它身上", () => {
  const calls: string[] = []
  const container = fake(true, calls)
  expect(scrollIfAlive(container, (target) => target.scrollBy(100))).toBe(true)
  container.isDestroyed = true
  expect(scrollIfAlive(container, (target) => target.scrollBy(100))).toBe(false)
  expect(calls).toEqual(["scrollBy:100"])
})
