---
name: dynamic-workflows
description: "Use when a job needs several subagents working in parallel, per-item results that must be structured, or a next step that depends on what earlier steps found — 调研、评审、批量分析、多方案对比、逐文件检查、按结果决定下一步。Do NOT use for a single delegation (use task) or a job that is one straight line of tool calls."
---

# 动态工作流

一次工作流 = 一段 **TypeScript 脚本**，由 `create_workflow` 工具运行。脚本里
`agent()` 派子代理、`Promise.all` 扇出、`files`/`git` 读工作区、`world.run` 跑命令，
结尾 `return` 一个结果。脚本先被编译检查，再让用户确认，然后才真的跑。

## 先判断：要不要用

| 情形                                               | 用什么                           |
| -------------------------------------------------- | -------------------------------- |
| 一个子任务，派出去拿回一段话                       | `task` —— 不要用工作流           |
| 一条直线：读文件 → 改文件 → 跑测试                 | 直接做，不要用工作流             |
| 多个互不依赖的子任务，要同时跑                     | 工作流（`Promise.all` 扇出）     |
| 每条结果要结构化（列表、字段、分数），后面要拿来算 | 工作流（`agent().ask<T>()`）     |
| 中途结果决定下一步派谁去干什么                     | 工作流（普通的 if / 循环）       |
| 同一套指令要套在 N 个文件 / N 个方向上             | 工作流（`for...of` + `agent()`） |

判断依据只有一条：**这个活的形状是不是「并行 + 结构化 + 分叉」**。是，就用工作流；
不是，用它只会更慢、更贵、更容易出错。

## 脚本长这样

```ts
phase("找问题")
const changed = await git.changedFiles()
log(`本次改了 ${changed.length} 个文件`)

const reviewers = changed.map((file) => {
  const r = agent(`审阅 ${file}`)
  return r.ask<{ file: string; issues: string[] }>(
    `只读 ${file}，用 JSON 回答，形如 {"file": "...", "issues": ["..."]}。没有问题就给空数组。`,
  )
})

const results = await Promise.all(reviewers)
const real = results.filter((r) => r.issues.length > 0)
report({ checked: results.length, withIssues: real.length })

if (real.length === 0) return { verdict: "干净", files: results.length }

phase("复核")
const senior = agent("复核者", "你只判断哪些问题真的会导致线上故障，其余一律忽略。")
const confirmed = await senior.ask<string[]>(
  `下面这些问题，哪些会真的导致线上故障？只回 JSON 字符串数组。\n${JSON.stringify(real)}`,
)

return { verdict: "有问题", confirmed }
```

要点：

- 顶层可以 `await`，也可以 `return`；整段被包在 async 函数里跑。
- 不 await 就是并发，`Promise.all` 就是等齐。**没有别的调度语义。**
- `agent()` 每调用一次就是一个全新的空上下文。要共享上下文，就复用同一个返回值。
- `phase("…")` 只影响展示：名字用用户的语言写，会出现在时间线上。
- `report(x)` 是数据（进 journal、进完成通知），`log(s)` 是旁白。

## 可用的东西

| 名字                               | 作用                                                       |
| ---------------------------------- | ---------------------------------------------------------- |
| `agent(name?, persona?)`           | 建一个子代理；`persona` 可以是系统提示词字符串             |
| `.ask<T>(instructions)`            | 派一个任务给它；带 `T` 时按 `T` 校验并重答，不带时回纯文本 |
| `phase(name)`                      | 标一个阶段（只用于展示）                                   |
| `log(message)`                     | 给用户一条进度                                             |
| `report(item)`                     | 发布一条中间结果（必须能 JSON 序列化）                     |
| `args`                             | 本次 run 的只读参数，没传就是 `{}`                         |
| `files.glob/read/grep`             | 读工作区；路径相对工作区根                                 |
| `git.changedFiles/diff/status/log` | 只读 git 查询；不拼 shell                                  |
| `world.run(cmd, args?, opts?)`     | 跑命令；非零退出是**返回值**，不是异常                     |

**不需要 import，也不能 import。** 这些名字是脚本里的全局。

## 硬约束（编译期就会挡）

- 不能 `import`、不能 `require`；没有 `process`、`fetch`、`Buffer`、`setTimeout`。
- 不能用 `Date.now()`、无参 `new Date()`、`Math.random()`——同一份输入必须得到同一份行为。
- `world.run` 的第一个参数必须是**字符串字面量**：用户在确认窗里就该看到这次会跑哪些命令。
- `phase("…")` 必须独立成句，参数必须是字面量。
- 子代理的 `name` 在一次 run 内唯一。
- `report` 的 `item`、脚本的返回值都要能 JSON 序列化（不要塞函数、类实例、循环引用）。

## 读诊断

脚本没过检查时，工具只回一段带行列的说明，**什么都还没跑**：

```
工作流脚本有 1 处错误：
L12:C5 类型 "string" 的参数不能赋给类型 "number" 的参数。
```

改那几行，再调一次。不要为了绕过诊断把类型参数去掉——`ask<T>` 的 `T` 正是结构化结果的来源。

## 跑完之后

`create_workflow` 会阻塞到 run 结束，返回结论、过程报告与用量。用户接着问
「刚才那次怎么样」「停掉它」，用 `workflow_run`：`action=get` / `list` / `stop`。

## 别这样做

- ❌ 为了「显得高级」把一件直线的事写成工作流。
- ❌ 一个 `agent()` 里连发 5 个 `ask` 然后以为它们并行——同一个 agent 是排队的。
- ❌ 把大段文件内容原样塞进 `instructions`。让子代理自己用 `files.read` 读。
- ❌ 在脚本里做本该由你（主代理）做的判断：脚本里没有你的上下文。
- ❌ `world.run("rm -rf …")` 这类命令。确认窗是唯一的授权点，用户会看到它。

## 存下来复用

一段验证过、以后还会再跑的脚本，用 `save_workflow` 存成文件（`<name>.dwf.ts`，项目级在
`.novaway/workflows/`，能提交进仓库；`scope: "global"` 存到用户目录，跨仓库通用）。
存之前会先编译检查——存下来却跑不起来的脚本不该存在。

之后用 `create_workflow` 的 `saved` 参数按名字跑，用 `list_saved_workflows` 看有哪些：

```
list_saved_workflows()                      → 名字、说明、何时用
create_workflow({ saved: "review-diff" })   → 跑它
```

什么时候值得存：同样的活出现过两次以上（每周 review、每次发版前的检查清单）。
一次性的事不要存。
