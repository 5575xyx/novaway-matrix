import { describe, expect, test } from "bun:test"
import type { InterceptorHook, InterceptorRegistration } from "@novaway/plugin-api"
import { createStack } from "@/plugin/runtime/disposable"
import { circuitConfig, createInterceptorRuntime, hookBudget, type Input } from "@/plugin/runtime/hooks"
import type { Source } from "@/plugin/contributions/registry"

/**
 * §14.3 第 6 步的验收：§15.5 的故障注入按预期降级。
 *
 * 本层能覆盖到的注入项：
 * - 拦截器永不返回 → `timeout`，output 保留原值；
 * - 拦截器抛错（同步或异步）→ `throw`，对话链路不冒泡；
 * - 拦截器把 output 改成非法类型 → 回滚被改坏的顶层键，记 `illegal_output`；
 * - 插件被停用 / 释放（等价于「目录中途被删除」在运行时的表现）→ 按 pluginID 批量摘掉，熔断与降级状态一起清；
 * - 同名贡献并发注册 → 后缀与顺序仍确定（见 contributions.test.ts 的互补用例）。
 *
 * 剩下三项不在这一层，留给第 12 步的 `verify:plugins` 标 known-red：
 * 安装断网（属 npm 物化）、Provider 空模型列表（`providers` 注册表在 M2）、UI 指向不存在的 viewId（`surfaces` 在 M4）。
 *
 * 时间全部走假时钟：`wait` 在宏任务里 resolve（所以真实跑完的 handler 一定赢），
 * 但**不动**时钟——时钟只由用例显式 `advance()`，熔断 60s / 降级 10min 这两个窗口才可断言。
 */

const acme: Source = { pluginID: "acme", scope: "global" }
const other: Source = { pluginID: "beta", scope: "global" }

function harness() {
  let clock = 0
  const degrades: string[] = []
  const input: Input = {
    now: () => clock,
    wait: () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      }),
    onDegrade: (pluginID) => degrades.push(pluginID),
  }
  return {
    runtime: createInterceptorRuntime(input),
    advance: (ms: number) => {
      clock += ms
    },
    degrades,
  }
}

/**
 * 用例里把 output 写成具体形状（`(_i, out: { temp: number })`），断言就不用再收窄一次。
 * `handler` 的形参在 `InterceptorRegistration` 里是 `unknown`，所以只有这一处需要跨过去。
 */
function interceptor<Out extends object>(
  id: string,
  hook: InterceptorHook,
  handler: (input: unknown, output: Out) => void | Promise<void>,
  filter?: InterceptorRegistration["filter"],
): InterceptorRegistration {
  return { id, hook, handler: handler as InterceptorRegistration["handler"], filter }
}

const never = () => new Promise<void>(() => {})

describe("正常链路", () => {
  test("按 §4.9 顺序依次改写 output", async () => {
    const { runtime } = harness()
    runtime.register(
      acme,
      interceptor("upper", "chat.params", (_i, out: { temp: number }) => void (out.temp += 1)),
    )
    runtime.register(
      { ...other, priority: 5 },
      interceptor("double", "chat.params", (_i, out: { temp: number }) => void (out.temp *= 2)),
    )
    const result = await runtime.trigger("chat.params", {}, { temp: 1 })
    expect(runtime.chain("chat.params").map((item) => item.name)).toEqual(["beta_double", "acme_upper"])
    // priority 5 在前：1 → ×2 → +1
    expect(result.output).toEqual({ temp: 3 })
    expect(result.skipped).toEqual([])
  })

  test("filter 不匹配时不进链，也不记调用数", async () => {
    const { runtime } = harness()
    runtime.register(
      acme,
      interceptor("only_bash", "tool.execute.before", () => {}, { tool: ["bash"] }),
    )
    const result = await runtime.trigger("tool.execute.before", { tool: "read" }, { args: {} })
    expect(result.skipped).toEqual([])
    expect(runtime.metric("acme", "tool.execute.before")?.calls).toBeUndefined()
    await runtime.trigger("tool.execute.before", { tool: "bash" }, { args: {} })
    expect(runtime.metric("acme", "tool.execute.before")?.calls).toBe(1)
  })
})

describe("故障隔离（§10.3）", () => {
  test("异步抛错：output 保留原值，宿主只看到一条 throw", async () => {
    const { runtime } = harness()
    runtime.register(
      acme,
      interceptor("boom", "chat.params", async (_i, out: { temp: number; extra?: string }) => {
        out.extra = "written"
        throw new Error("插件炸了")
      }),
    )
    const result = await runtime.trigger("chat.params", { text: "hi" }, { temp: 20 })
    expect(result.output).toEqual({ temp: 20 })
    expect(result.skipped.map((item) => [item.reason, item.message])).toEqual([["throw", "插件炸了"]])
    expect(result.refused).toBeUndefined()
  })

  test("抛错前改掉的既有字段也复原：失败不留痕是整份的，不只删新增的键", async () => {
    const { runtime } = harness()
    runtime.register(
      acme,
      interceptor("half", "chat.message", (_i, out: { text: string; extra?: string }) => {
        out.text = "half-written"
        out.extra = "half-written"
        throw new Error("写到一半炸了")
      }),
    )
    const result = await runtime.trigger("chat.message", {}, { text: "keep" })
    expect(result.output).toEqual({ text: "keep" })
    expect(result.skipped[0]?.reason).toBe("throw")
  })

  test("快照只到顶层：嵌套对象里的改动收不回来（hook 只该改顶层字段）", async () => {
    const { runtime } = harness()
    runtime.register(
      acme,
      interceptor("deep", "chat.headers", (_i, out: { headers: Record<string, string> }) => {
        out.headers.LATE = "1"
        throw new Error("改了嵌套字段")
      }),
    )
    const headers: Record<string, string> = { A: "1" }
    await runtime.trigger("chat.headers", {}, { headers })
    // 顶层键 `headers` 的引用没变，所以回滚救不到它——记录这个边界，别把它当成保证。
    expect(headers).toEqual({ A: "1", LATE: "1" })
  })

  test("同步抛错同样被隔离：不能让异常冒到调用点", async () => {
    const { runtime } = harness()
    runtime.register(
      acme,
      interceptor("sync_boom", "chat.message", () => throwSync()),
    )
    const result = await runtime.trigger("chat.message", {}, { text: "keep" })
    expect(result.output).toEqual({ text: "keep" })
    expect(result.skipped[0]?.reason).toBe("throw")
  })

  test("永不返回 → timeout，超时后不再等它", async () => {
    const { runtime } = harness()
    runtime.register(acme, interceptor("hang", "shell.env", never))
    const result = await runtime.trigger("shell.env", {}, { env: { A: "1" } })
    expect(result.output).toEqual({ env: { A: "1" } })
    expect(result.skipped[0]?.reason).toBe("timeout")
    expect(result.skipped[0]?.message).toBe(`超过 ${hookBudget["shell.env"].timeoutMs}ms 未返回`)
  })

  test("超时前的写入同样复原：宿主不能看到一半的 env", async () => {
    const { runtime } = harness()
    runtime.register(
      acme,
      interceptor("hang_write", "chat.params", (_i, out: { temp: number; extra?: string }) => {
        out.temp = 999
        out.extra = "written"
        return never()
      }),
    )
    const result = await runtime.trigger("chat.params", {}, { temp: 1 })
    expect(result.output).toEqual({ temp: 1 })
    expect(result.skipped[0]?.reason).toBe("timeout")
  })

  test("把 output 改成非法类型：只回滚被改坏的那个键", async () => {
    const { runtime } = harness()
    runtime.register(
      acme,
      interceptor("wrong", "tool.execute.after", (_i, out: { output: string; metadata: unknown }) => {
        out.metadata = "not-an-object"
        out.output = `${out.output}!`
      }),
    )
    const result = await runtime.trigger("tool.execute.after", {}, { output: "ok", metadata: { k: "v" } })
    expect(result.output).toEqual({ output: "ok!", metadata: { k: "v" } })
    expect(result.skipped[0]?.reason).toBe("illegal_output")
    expect(result.skipped[0]?.message).toContain("metadata")
  })

  test("tool.execute.before 失败按安全优先拒绝本次工具调用", async () => {
    const { runtime } = harness()
    runtime.register(
      acme,
      interceptor("guard", "tool.execute.before", async () => {
        throw new Error("前置检查读不到配置")
      }),
    )
    const result = await runtime.trigger("tool.execute.before", { tool: "bash" }, { args: { cmd: "rm -rf /" } })
    expect(result.refused?.pluginID).toBe("acme")
    expect(result.refused?.message).toContain("安全优先")
  })

  test("permission.ask 失败回落内核默认判定", async () => {
    const { runtime } = harness()
    runtime.register(
      acme,
      interceptor("ask", "permission.ask", () => {
        throw new Error("拿不到用户选择")
      }),
    )
    const result = await runtime.trigger("permission.ask", { permission: "bash" }, { action: "allow" })
    expect(result.defaulted?.message).toContain("按内核默认判定继续")
    expect(result.refused).toBeUndefined()
  })

  test("event 是旁路：永不返回也不拖住宿主，失败只记账", async () => {
    const { runtime } = harness()
    runtime.register(acme, interceptor("slow", "event", never))
    runtime.register(
      other,
      interceptor("bad", "event", async () => {
        throw new Error("事件处理器炸了")
      }),
    )
    const result = await runtime.trigger("event", { type: "session.idle" }, {})
    expect(result.skipped).toEqual([])
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(runtime.metric("beta", "event")?.failures).toBe(1)
    expect(runtime.metric("acme", "event")?.failures).toBe(0)
  })
})

describe("熔断与降级（§10.3）", () => {
  test("连续失败 3 次开熔断，60s 后自动放行", async () => {
    const { runtime, advance } = harness()
    runtime.register(acme, interceptor("hang", "chat.params", never))
    for (let index = 0; index < circuitConfig.consecutiveOpens; index += 1) {
      const result = await runtime.trigger("chat.params", {}, { temp: 1 })
      expect(result.skipped[0]?.reason).toBe("timeout")
    }
    const blocked = await runtime.trigger("chat.params", {}, { temp: 1 })
    expect(blocked.skipped[0]?.reason).toBe("circuit_open")
    expect(runtime.metric("acme", "chat.params")?.calls).toBe(3)

    advance(circuitConfig.openMs + 1)
    const again = await runtime.trigger("chat.params", {}, { temp: 1 })
    expect(again.skipped[0]?.reason).toBe("timeout")
    expect(runtime.metric("acme", "chat.params")?.calls).toBe(4)
  })

  test("成功一次就把连续失败清零：只有真的连挂三次才熔断", async () => {
    const { runtime } = harness()
    let boom = true
    runtime.register(
      acme,
      interceptor("flaky", "chat.params", () => {
        if (boom) {
          boom = false
          throw new Error("第一次挂")
        }
        boom = true
      }),
    )
    await runtime.trigger("chat.params", {}, { temp: 1 })
    await runtime.trigger("chat.params", {}, { temp: 1 })
    await runtime.trigger("chat.params", {}, { temp: 1 })
    expect(runtime.metric("acme", "chat.params")?.consecutive).toBe(1)
    expect(runtime.metric("acme", "chat.params")?.openUntil).toBe(0)
  })

  test("窗口内失败 10 次 → degraded，除 event 外全部跳过", async () => {
    const { runtime, degrades } = harness()
    runtime.register(acme, interceptor("hang_params", "chat.params", never))
    runtime.register(acme, interceptor("hang_env", "shell.env", never))
    runtime.register(
      acme,
      interceptor("event", "event", () => {}),
    )
    for (let index = 0; index < circuitConfig.degradeFailures; index += 1) {
      await runtime.trigger("chat.params", {}, { temp: 1 })
      runtime.trip("acme", "chat.params", -circuitConfig.openMs * 2)
    }
    expect(runtime.degraded()).toEqual(["acme"])
    expect(degrades).toEqual(["acme"])
    const params = await runtime.trigger("chat.params", {}, { temp: 7 })
    expect(params.skipped[0]?.reason).toBe("degraded")
    const env = await runtime.trigger("shell.env", {}, { env: {} })
    expect(env.skipped[0]?.reason).toBe("degraded")
    const event = await runtime.trigger("event", { type: "x" }, {})
    expect(event.skipped).toEqual([])
  })

  test("降级窗口滑出后不再计新失败：窗口外的旧失败不会永久挂住插件", () => {
    const { runtime, advance } = harness()
    runtime.trip("acme", "chat.params", 0)
    advance(circuitConfig.degradeWindowMs)
    expect(runtime.metric("acme", "chat.params")?.openUntil).toBe(0)
    expect(runtime.degraded()).toEqual([])
  })

  test("release 一次摘干净：贡献、指标、降级状态都不留", async () => {
    const { runtime } = harness()
    runtime.register(acme, interceptor("hang", "chat.params", never))
    runtime.register(
      other,
      interceptor("ok", "chat.params", () => {}),
    )
    await runtime.trigger("chat.params", {}, { temp: 1 })
    runtime.release("acme")
    expect(runtime.chain("chat.params")).toEqual([{ pluginID: "beta", name: "beta_ok" }])
    expect(runtime.metric("acme", "chat.params")).toBeUndefined()
    expect(runtime.metrics().length).toBe(1)
    const result = await runtime.trigger("chat.params", {}, { temp: 1 })
    expect(result.skipped).toEqual([])
  })
})

describe("停用与在途轮次（§4.11）", () => {
  test("链已组装后停用：本轮仍按快照走完，下一轮才消失", async () => {
    const { runtime } = harness()
    const seen: string[] = []
    runtime.register(
      acme,
      interceptor("first", "chat.params", () => {
        seen.push("first")
        runtime.release("beta")
      }),
    )
    runtime.register(
      other,
      interceptor("second", "chat.params", () => void seen.push("second")),
    )
    await runtime.trigger("chat.params", {}, { temp: 1 })
    expect(seen).toEqual(["first", "second"])
    seen.length = 0
    await runtime.trigger("chat.params", {}, { temp: 1 })
    expect(seen).toEqual(["first"])
  })

  test("在途轮次走完快照链，且改动仍然生效（§4.11 不切断本轮）", async () => {
    const { runtime } = harness()
    const seen: string[] = []
    runtime.register(
      { ...acme, priority: 9 },
      interceptor("slow", "chat.params", async (_i, out: { temp: number }) => {
        seen.push("slow")
        await Promise.resolve()
        runtime.release("beta")
        out.temp += 1
      }),
    )
    runtime.register(
      other,
      interceptor("last", "chat.params", (_i, out: { temp: number }) => {
        seen.push("last")
        out.temp *= 10
      }),
    )
    const round = await runtime.trigger("chat.params", {}, { temp: 1 })
    expect(seen).toEqual(["slow", "last"])
    expect(round.output).toEqual({ temp: 20 })
    expect(runtime.chain("chat.params").map((item) => item.name)).toEqual(["acme_slow"])
  })
})

describe("并发注册（§15.5 同名贡献并发注册）", () => {
  test("两条同名拦截器交错注册：名字与顺序仍然确定", async () => {
    const { runtime } = harness()
    const tasks = [
      () =>
        runtime.register(
          acme,
          interceptor("render", "tool.definition", () => {}),
        ),
      () =>
        runtime.register(
          acme,
          interceptor("render", "tool.definition", () => {}),
        ),
    ]
    await Promise.all(tasks.map((task) => Promise.resolve().then(task)))
    expect(runtime.chain("tool.definition").map((item) => item.name)).toEqual(["acme_render", "acme_render_2"])
  })
})

describe("逆序释放（§4.9）", () => {
  test("后注册的先释放；重复 dispose 只跑一次", () => {
    const order: string[] = []
    const stack = createStack()
    stack.push({ dispose: () => void order.push("a") })
    stack.push({ dispose: () => void order.push("b") })
    stack.dispose()
    stack.dispose()
    expect(order).toEqual(["b", "a"])
    expect(stack.size).toBe(0)
  })

  test("释放回调重入 dispose 或登记新资源不会泄漏", () => {
    const order: string[] = []
    const stack = createStack()
    stack.push({ dispose: () => void order.push("first") })
    stack.push({
      dispose() {
        stack.dispose()
        stack.push({ dispose: () => void order.push("late") })
      },
    })
    stack.dispose()
    expect(order).toEqual(["late", "first"])
    expect(stack.size).toBe(0)
    expect(stack.errors).toEqual([])
  })

  test("某一条 dispose 抛错不影响其余条目，错误进 errors", () => {
    const order: string[] = []
    const stack = createStack()
    stack.push({ dispose: () => void order.push("a") })
    stack.push({
      dispose: () => {
        throw new Error("资源释放失败")
      },
    })
    stack.dispose()
    expect(order).toEqual(["a"])
    expect(stack.errors.length).toBe(1)
  })

  test("已停用的栈再收到条目就地释放：激活被取消后不该留下资源", () => {
    const order: string[] = []
    const stack = createStack()
    stack.dispose()
    stack.push({ dispose: () => void order.push("late") })
    expect(order).toEqual(["late"])
    expect(stack.size).toBe(0)
  })

  test("release(count) 只回退最后几条：激活分段失败时保留已完成的部分", () => {
    const order: string[] = []
    const stack = createStack()
    for (const name of ["a", "b", "c"]) stack.push({ dispose: () => void order.push(name) })
    expect(stack.release(2)).toBe(2)
    expect(order).toEqual(["c", "b"])
    expect(stack.size).toBe(1)
  })

  test("跨贡献类型逐条注销互不牵连：栈逆序弹出时前面的条目要活到自己的回合", () => {
    const { runtime } = harness()
    const first = runtime.register(
      acme,
      interceptor("a", "chat.params", () => {}),
    )
    const second = runtime.register(
      acme,
      interceptor("b", "shell.env", () => {}),
    )
    const third = runtime.register(
      acme,
      interceptor("c", "tool.definition", () => {}),
    )
    third.dispose()
    expect(runtime.chain("tool.definition")).toEqual([])
    expect(runtime.chain("shell.env").length).toBe(1)
    expect(runtime.chain("chat.params").length).toBe(1)
    second.dispose()
    expect(runtime.chain("chat.params").length).toBe(1)
    first.dispose()
    expect(runtime.chain("chat.params")).toEqual([])
  })
})

function throwSync() {
  throw new Error("同步就炸")
}
