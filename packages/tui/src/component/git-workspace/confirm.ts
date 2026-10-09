// 危险操作的「再按一次确认」。规格要求**不用弹窗** —— 弹窗会打断键盘流,而这套交互的核心
// 就是一只手在键盘上走完全程。
//
// 时钟是注入的(参数 `now`),不直接读 Date.now / setTimeout。理由:超时逻辑如果绑死真实时间,
// 测试就只能 sleep 3 秒才敢断言,既慢又容易在慢机器上偶发失败。
// 调用方(工作区外壳)用真实时钟,测试用自己的假时钟 —— 同一份代码,两种时间。
export const CONFIRM_WINDOW_MS = 3000

export interface ArmedConfirm {
  /** 触发这条确认的键。同键再按一次才算确认 —— 所以必须记住是哪个键。 */
  key: string
  /** 确认态那一行显示的文案,例如「再按一次 d 确认丢弃」。 */
  label: string
  /** 过了这个时间点还没确认就自动取消(毫秒,单调递增的时钟口径)。 */
  deadline: number
}

/**
 * press 的返回值就是状态机的迁移结果:
 *   armed  —— 进入确认态,或换到另一条危险命令的确认态。什么都没执行。
 *   fire   —— 用户在窗口内按了**同一个**键,调用方现在该执行那条危险命令。
 *
 * 只有两个值,没有「cancel」:外壳只在 `DANGEROUS_COMMANDS.has(command)` 为真时才调本方法,
 * 非危险键压根走不到这里 —— 它们由外壳直接调 `clear()`。把「这个键危不危险」的判断
 * 塞进本方法(比如去看 label 是不是空串)是把语义藏进展示文案,迟早出事。
 */
export type ConfirmPressResult = "armed" | "fire"

export function createConfirm(now: () => number) {
  let armed: ArmedConfirm | undefined

  return {
    press(key: string, label: string): ConfirmPressResult {
      // 超时的确认态等同于没有:先把过期的清掉,再判断是不是「同键第二次」。
      // 不先清的话,用户在 4 秒后按同一个 d 会误判成 fire,而那个确认态早就该失效了。
      if (armed && now() >= armed.deadline) armed = undefined

      // 同键第二次 = 确认,执行。到这里 armed 一定还在窗口内。
      if (armed && armed.key === key) {
        armed = undefined
        return "fire"
      }

      // 没武装,或者换了一条危险命令 —— 都是武装新的那条。换成新的而不是取消掉,
      // 是因为按了 x 却毫无反应比「d 的确认被 x 顶掉」更让人困惑。
      armed = { key, label, deadline: now() + CONFIRM_WINDOW_MS }
      return "armed"
    },

    /** 当前的确认态;`undefined` 表示没在等确认。渲染层靠它画那行黄色提示。 */
    pending(): ArmedConfirm | undefined {
      if (armed && now() >= armed.deadline) {
        armed = undefined
        return undefined
      }
      return armed
    },

    clear() {
      armed = undefined
    },
  }
}

export type Confirm = ReturnType<typeof createConfirm>
