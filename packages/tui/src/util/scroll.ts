import { MacOSScrollAccel, type ScrollAcceleration, type ScrollBoxRenderable } from "@opentui/core"

export type ScrollConfig = {
  scroll_acceleration?: { enabled?: boolean }
  scroll_speed?: number
}

export class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}

  tick(_now?: number): number {
    return this.speed
  }

  reset(): void {}
}

export function getScrollAcceleration(tuiConfig?: ScrollConfig): ScrollAcceleration {
  if (tuiConfig?.scroll_acceleration?.enabled) {
    return new MacOSScrollAccel()
  }
  if (tuiConfig?.scroll_speed !== undefined) {
    return new CustomSpeedScroll(tuiConfig.scroll_speed)
  }

  return new CustomSpeedScroll(3)
}

/**
 * 容器还活着才动它,否则**静默收手**。返回有没有真的执行。
 *
 * 为什么需要它:一个视图切换会把某个 scrollbox 卸载,而 Solid 的 `ref={(r) => (box = r)}`
 * 在元素销毁时**不会再被调用一次置空** —— 于是那个变量会一直指着一个已销毁的 renderable。
 * 之后任何翻页 / 跳消息命令都还能被键盘触发,直接解引用就是在已销毁对象上动手。
 *
 * 抽成纯函数而不是散落成 `if (!box || box.isDestroyed) return`:那样这个守卫本身永远只能
 * 被集成测试盖到,而它是那种「改错了要等用户按了 PageDown 才发现」的分支。见
 * test/util/scroll.test.ts。
 */
export function scrollIfAlive(box: ScrollBoxRenderable | undefined, action: (target: ScrollBoxRenderable) => void) {
  if (!box || box.isDestroyed) return false
  action(box)
  return true
}
