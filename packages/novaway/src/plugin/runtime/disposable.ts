import type { Disposable } from "@novaway/plugin-api"

/**
 * 逆序释放（§4.9 卸载语义、§4.12 通用约束 2）。
 *
 * 顺序必须是逆序：后注册的 hook 通常依赖先注册的资源（比如先开的连接、先建的临时目录），
 * 正序释放会让它在一个已经解散的上下文里跑最后一行代码。
 *
 * 释放失败不中断其余条目——否则一个插件的 `dispose()` 抛错就把后面所有插件的资源全留在了进程里，
 * 这正是 §6.4「停用插件后残留 0 个定时器、0 个监听器」要防的东西。失败收集到 `errors` 里给诊断页。
 */

export type Stack = Disposable & {
  /** 已登记的条目数；停用后必须归零（B2 门禁的判据）。 */
  readonly size: number
  /** 释放过程中吞掉的错误，按释放顺序排列。 */
  readonly errors: unknown[]
  push(disposable: Disposable): Disposable
  /** 只释放到某个点为止（激活函数分段时用），返回释放了几条。 */
  release(count: number): number
}

export function createStack(): Stack {
  const items: Disposable[] = []
  const errors: unknown[] = []
  let disposed = false

  const stop = (count: number) => {
    // 边界要在 splice 之前定下来：用 items.length 做条件会随着弹出不断左移，最后把所有条目清空。
    const floor = items.length - Math.max(0, count)
    let done = 0
    for (let index = items.length - 1; index >= floor; index -= 1) {
      const item = items[index]
      items.splice(index, 1)
      done += 1
      try {
        item.dispose()
      } catch (error) {
        errors.push(error)
      }
    }
    return done
  }

  return {
    get size() {
      return items.length
    },
    get errors() {
      return errors
    },
    push(disposable) {
      if (disposed) {
        // 已经停用的栈再来新条目说明注册路径还在跑（激活被取消后没停下来）：
        // 就地释放，不给它留在进程里的机会。
        try {
          disposable.dispose()
        } catch (error) {
          errors.push(error)
        }
        return disposable
      }
      items.push(disposable)
      return disposable
    },
    release: stop,
    dispose() {
      if (disposed) return
      disposed = true
      stop(items.length)
    },
  }
}

/** 多个栈合并成一个释放点（一个插件可能有声明期 + 激活期两份资源）。 */
export function merge(...stacks: Disposable[]): Disposable {
  return {
    dispose() {
      for (const stack of [...stacks].reverse()) stack.dispose()
    },
  }
}
