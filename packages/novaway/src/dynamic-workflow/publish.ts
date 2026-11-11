/**
 * 把引擎事件送上总线。
 *
 * 两件事必须成立，缺一件界面就会说谎：
 *   1. **顺序**：报告与阶段标记是按到达顺序讲一个故事，乱序的「第 3 条报告」比没有报告更糟。
 *   2. **不阻塞**：总线订阅者慢（比如界面正在重绘）不该让 run 停下来。发布失败同理——
 *      看的人出问题，不该让跑的事失败。
 *
 * 所以这里把发布串成一条 promise 链：一条接一条，谁都不等它，谁也都不会被它拖住。
 * 链上任何一环失败都被吞掉，链条继续。
 */

import type { RunEvent } from "./engine/types"
import { toBusEvents, type BusPublishable } from "./events"

/** 一次 run 的上下文，用于给 `run-started` 补上不在引擎里的那些字段。 */
export interface PublisherContext {
  readonly phases: readonly string[]
  readonly siteCount: number
  readonly name?: string
  readonly parentSessionID?: string
  readonly resumedFrom?: string
}

export interface RunPublisherDeps {
  /** 发布一条总线事件。类型由调用方填实（`Bus.Service.publish`）。 */
  publish: (item: BusPublishable) => Promise<unknown>
}

export function makeRunPublisher(context: PublisherContext, deps: RunPublisherDeps): (event: RunEvent) => void {
  let chain: Promise<unknown> = Promise.resolve()
  return (event) => {
    for (const item of toBusEvents(event, context)) {
      chain = chain.then(() => deps.publish(item)).catch(() => {})
    }
  }
}
