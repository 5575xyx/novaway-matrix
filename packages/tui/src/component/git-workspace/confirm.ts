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
 *   armed  —— 进入(或重新进入)确认态,什么都没执行
 *   fire   —— 用户在窗口内按了同一个键,调用方**现在**该执行那条危险命令
 *   cancel —— 用户按了别的键,确认态被顶掉了
 */
export type ConfirmPressResult = "armed" | "fire" | "cancel"

export function createConfirm(now: () => number) {
  let armed: ArmedConfirm | undefined

  return {
    press(key: string, label: string): ConfirmPressResult {
      // 超时的确认态等同于没有:先把过期的清掉,再判断是不是「同键第二次」。
      // 不先清的话,用户在 4 秒后按同一个 d 会误判成 fire,而那个确认态早就该失效了。
      if (armed && now() >= armed.deadline) armed = undefined

      // label 为空 = 这个键不带危险动作(比如导航键 j)。它没有资格武装确认态,只会把已有的顶掉。
      // 反过来,label 非空的危险键即使撞上已有确认态也是接管(见「换一个键会顶掉上一个确认态」)。
      if (label === "") {
        armed = undefined
        return "cancel"
      }

      // 同键第二次:确认态被消费掉,调用方现在就该执行那条危险命令。
      if (armed?.key === key) {
        armed = undefined
        return "fire"
      }

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
