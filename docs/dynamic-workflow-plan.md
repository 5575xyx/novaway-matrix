# NovaWay 动态工作流（Dynamic Workflow）落地方案

状态：草案 · 2026-11-05
参考实现：参照产品 3.16/3.17 的 dynamic-workflow 包 + dynamic-workflow-runtime 包
目标版本：NovaWay 1.16

---

## 0. TL;DR

一句话：**让模型写一段 TypeScript 程序来指挥一群子代理，而不是在对话里手动派活。**

本方案给出一个 5 周可落地的裁剪版：

- **1 个 facade**：`agent() / .ask<T>() / phase() / log() / report() / files.* / git.* / world.run / args`
- **4 张表**：`dwf_run / dwf_actor / dwf_node / dwf_event`
- **7 个 v1 工具**：`create_workflow / get_workflow_run / list_workflow_runs / stop_workflow_run / resume_workflow_run / save_workflow / list_saved_workflows`
- **3 条边界**：脚本 → 引擎（HostApi）、引擎 → 世界（Driver）、引擎 → 观察者（RunEvent）
- **1 个闭环**：编译 → 确认 → 沙箱执行 → 子代理 → journal → 通知

v1 不做：artifact、hole、channel/future、Amend、多模型路由、时间线 UI、完整 taint 分析。
这些都在 v2/v3，且不需要改 v1 的接口。

---

### 实现进度：M0 + M2 + M3 + M4 已完成（2026-11-06）

已落地在 `packages/novaway/src/dynamic-workflow/`，164 个测试全绿（`bun test test/dynamic-workflow`），
外加 8 个 HTTP 接口测试（`test/server/httpapi-dynamic-workflow.test.ts`）。

| 层     | 文件                                                   | 状态                                                                   |
| ------ | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| 门面   | `facade/dts.ts`                                        | ✅ v1 的全部成员                                                       |
| 编译器 | `compiler/compile.ts` + `libs.generated.ts`            | ✅ 全虚拟 host，57 个标准库文件烘进包                                  |
| 分析   | `analysis/sites.ts` + `diagnostics.ts`                 | ✅ site / phase / fan-out（含 `for...of`）/ join + 9001/9003/9004/9005 |
| 降级   | `lowering/lower.ts`                                    | ✅ 按节点身份打桩 + 擦类型                                             |
| 引擎   | `engine/engine.ts` + `scheduler.ts` + `replay.ts`      | ✅ 身份、调度、缓存重放、结算                                          |
| 记录   | `engine/{memory,sqlite}-journal.ts` + `journal.sql.ts` | ✅ 两个实现逐字段等价；四张表 + 迁移                                   |
| 读侧   | `journal/read.ts`                                      | ✅ 分页读、列表、进度汇总、恢复计划                                    |
| 沙箱   | `runtime/{child-bootstrap,entry,harness,protocol}.ts`  | ✅ 子进程 + vm + NDJSON + 停滞检测                                     |
| 世界读 | `driver/world.ts`                                      | ✅ `files.*` / `git.*` / `world.run`，越界与超时都有界                 |
| 驱动   | `driver/nova-driver.ts`                                | ✅ `Session.create` + `SessionPrompt.prompt` + 增量用量                |
| 登记表 | `runtime/registry.ts` + `report.ts`                    | ✅ 进程内运行清单 + 渲染（跨进程回落到库）                             |
| 工具   | `src/tool/workflow-{script,run,resume,save,model}.ts`  | ✅ `create_workflow` / `workflow_run` / `resume_workflow_run` / 存读   |
| 事件   | `events.ts` + `publish.ts`                             | ✅ RunEvent → 有界载荷 → Bus，串行发布、失败不影响 run                 |
| 接口   | `server/…/groups/dynamic-workflow.ts` + handler        | ✅ 只读的 runs / nodes / actors / events + stop                        |
| 技能   | `src/skill/prompt/dynamic-workflows.md`                | ✅ 内置技能，写清了「什么时候不该用」                                  |

端到端跑通的四条链路：

````
# 执行侧（harness.test.ts，真起子进程）
prepareWorkflow → lower → 写 .mjs → spawn(bun/node) → vm + NDJSON
   → WorkflowEngine → journal → Settlement

# 工具侧（tool-integration.test.ts，桩服务但真起子进程）
create_workflow → prepareWorkflow → ctx.ask（确认窗）
   → makeNovaDriver → runWorkflow → registry.settle → renderRun

# 恢复（resume.test.ts + tool-integration.test.ts）
读库 → prepareWorkflow(旧脚本) → loadReplayPlan → 同一 runId 再跑一遍
   → 已完成的 ask 直接拿缓存、子代理接回原会话 → 新的结算覆盖 stopped

# 事件与接口（events.test.ts + tool-integration.test.ts + httpapi-dynamic-workflow.test.ts）
引擎 RunEvent → toBusEvents（载荷有界）→ 串行 promise 链 → Bus.publish
库里的行   → listRuns / readRun / summarizeRun / readEvents → HTTP → 界面

覆盖的行为：world-read 过线、agent+ask 常驻会话、`Promise.all` 扇出、脚本抛错、
驱动拒绝被脚本 catch、永不兑现的 promise → `ScriptStalled`、同步死循环 → 超时 `stopped`、
`Date.now`/`Math.random` 禁令、cell 里没有 `process`/`require`/`fetch`；
工具侧：编译不过不弹窗不起 run、确认窗拿到 phase/actor/site 形状、子代理回复原样回到脚本、
脚本抛错结算成 `errored` 而不是把异常扔给调用方、没有 `promptOps` 时说清原因而不是半路炸、
`workflow_run` 的 get/list/stop 与跨进程查询；
恢复侧：缓存命中不调驱动、子代理不重复落行并接回旧会话、编号接着数、
失败的节点重放成同样的拒绝、输入哈希对不上就整次 run 失败而不是拿错答案。

### 与设计稿的偏离（都是实现时才看出来的）

1. **`args` 声明成 `Readonly<Record<string, unknown>>`。** `const` 绑定挡不住 `args.topic = "x"`，
   只有只读属性类型挡得住；这与运行期的 `Object.freeze` 正好对上。
2. **多了一条 9900 自检码。** 降级产物里的站点必须与站点表逐个对上，对不上就 fail。那不是
   作者的错误，是 NovaWay 自己的 bug，所以单独一个码。
3. **`siteIds` 是前序顺序。** `agent("x").ask("hi")` 里外层调用与内层调用起始位置相同，
   外层排在前面，所以 `ask#1` 先于 `actor#1`。编号按 kind 独立计数，所以仍然稳定。
4. **子进程而不是 worker thread。** 本来想用 `worker_threads`（不用写临时文件、没有 argv 上限），
   但 Bun 下 worker 起不来（Node 正常）。子进程在两个运行时都稳，且 `kill()` 是真正的终止。
5. **子进程代码是字符串常量，不是 `toString()`。** 参照产品用 `toString()` 换来了类型检查，代价是
   `minify + keepNames` 会把内层函数改写成 `__name(...)`，内嵌出去就是 ReferenceError——只在
   发布产物里坏。`child-bootstrap.ts` 是一段 String.raw，任何构建形态下都是同一份文本。
6. **`worldRead` 不过调度器。** 它不占模型名额，塞进同一个闸门会让 50ms 的 glob 排在 30s 的
   ask 后面。需要限流的是对模型的并发，不是对磁盘的。
7. **停止时引擎自己放手。** 驱动不一定理会 `AbortSignal`（可能卡在不可中断的调用里），所以
   ask / worldRead 都与一个 abort 哨兵 race 一次，停止之后这些 promise 一定会有结局。
8. **`create_workflow` 的模型从 `ctx.extra.model` 取，不读消息表。** 工具在助手轮次里被调用，
   那一轮正在用的 `Provider.Model` 就是最权威的答案，也省掉一次数据库往返；只有独立调用
   （`extra` 缺席）时才回落到 `MessageV2.get`。两个工具共用 `workflow-model.ts` 的一处判断。
9. **恢复沿用同一个 `runId`，`startRun` 幂等。** 一次逻辑上的 run 只有一份 journal：状态
   `stopped → running → completed`，查询、时间线、用量都只有一条记录。`resumed_from` 这一列
   留着，等 amend（新 run 导入旧进度）时才有意义。
10. **编号不从 journal 接着数，而是从头重数。** 恢复就是同一份脚本再跑一次：第 k 次到达站点 S
    仍然是 `S#k`，只有这样才能命中 journal 里那一行；真正新的那一次自然接在后面。子代理同理，
    已经在库里的那些由 `replay.actors` 认领、不重复落行、并接回原会话。
11. **子进程的 stdout 改为同步写，父进程改听 `close` 而不是 `exit`。** 这两个都是同一类 bug 的
    两半：结果写在管道里，父进程却在字节到达之前就判「没发出 complete」。前者要子进程自己
    保证写完，后者要父进程等管道关掉——只修一边，run 仍会间歇性地变成 `stopped(interrupted)`。
12. **子代理用量按增量记。** 会话的 token 是累计值，原实现每轮都把累计量加进 `spent_tokens`，
    同一个子代理问两轮就翻倍；恢复时还会把上一段生命的账再算一遍。现在按会话记上次读到的数，
    只交差值。
13. **`listRuns` 按创建时间倒序，不是更新时间。** run 行的时间戳只在开场与结算时推进（推进它
    意味着每个节点多一次写），按更新时间排会让一次跑得久的 run 被后来的短 run 挤出去——恰恰
    是最该被看见的那条不见了。`time_updated` 与 id 只用作同一毫秒内的稳定次序。
14. **`summarizeRun` 让数据库数数，不读行。** 卡片只要「完成 / 失败 / 在跑 / 报告几条」，
    一次 `group by kind, status` 就够；把上千个节点读进内存再数，在界面上就是每次刷新一次卡顿。
    报告（`report` 节点）单列：它是脚本主动交出的结论，与「执行了几步」不是一回事。
15. **HTTP 层是只读的，唯一写操作是 stop。** 起点永远是工具调用（那里有脚本、确认、驱动），
    HTTP 只回答「跑过什么、跑到哪、留下了什么」。stop 是例外：用户点停止不该绕回模型再走一轮。
    跨目录要显式 `all=true`，与 `workflow_run` 的 list 口径一致——默认收窄到当前目录。

### 尚未做

- 子代理的 `escalate` / 提问（v2）
- amend（新 run 导入前驱已完成的工作、只改并发时原地 retune）
- 前端 run 卡片与时间线（数据与接口都就位了，`packages/app` 还没消费）
- 总线事件的 SDK/界面消费方：接口已有 OpenAPI 描述，但 `openapi.json` 尚未重新生成
  （工作区里另有一批 office 相关的接口改动，重生成会把它们一起带进去，所以留给下一次统一生成）

---

## 1. 为什么做 / 不做什么

### 1.1 为什么

现有 `packages/novaway/src/workflow/` 是「配置化步骤图 + 模板插值」：

```ts
{ id: "plan", type: "agent", config: { agent: "plan", prompt: "…{{input}}" }, next: "execute" }
````

它能表达线性流程，但表达不了：

- 跑完一个文件再决定下一个（循环 / 条件 / 动态 fan-out）
- 每个子任务返回**结构化结果**并据此分支
- 一半任务失败时保住另一半的产出
- 崩溃后从断点继续，而不是从头再来
- 让用户在执行前看到「这次会跑什么」

动态工作流用一段**可类型检查、可静态分析、可回放**的脚本来解决这些问题。harness 从脚本里恢复类型、schema、依赖图、身份和持久性；模型只负责写最自然的程序。

### 1.2 不做

- 不是替代 `task`：单次派发仍然走它。`task` 的 `task_id` 续跑已经是「同一个子代理多轮」的雏形，动态工作流只是把这件事从一次调用扩到一段程序。
- 不是 DAG 编辑器：用户写的是代码，不是拖节点。
- 不是「模型自己决定开工作流」：必须用户明说（`/workflow` 或「用工作流…」），否则一律走 `task` 或直接做。
- 不是安全沙箱：子进程 + `vm` 是**隔离与确定性**手段，不是信任边界。脚本被用户批准后才运行。

---

## 2. 现状盘点：能复用什么

| 现有能力                        | 位置                                                   | 在动态工作流里的角色                             |
| ------------------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| Effect Service / Layer          | 全仓                                                   | 所有服务装配                                     |
| `Tool.define` + `Effect.Schema` | `src/tool/tool.ts`                                     | 新工具的定义方式                                 |
| 工具注册与过滤                  | `src/tool/registry.ts`                                 | `create_workflow` 等注册、按 agent 裁剪          |
| 子代理执行                      | `src/session/agent-step.ts` 的 `makeRunAgent`          | driver 的 `createActorSession` / `startAsk` 底座 |
| 持久子会话                      | `Session.Service.create` + `SessionPrompt.prompt`      | 一个 actor = 一个常驻子会话，多轮 ask 共享上下文 |
| 提问                            | `src/question/` + `src/tool/question.ts`               | 子代理 escalate（v2）                            |
| 权限                            | `src/permission/index.ts` 的 `ctx.ask`                 | 执行前确认窗                                     |
| 后台任务 + 事件                 | `src/background/job.ts`                                | run 的后台生命周期与完成通知                     |
| 事件总线                        | `src/bus/bus-event.ts`                                 | 进度事件                                         |
| SQLite + drizzle                | `src/storage/db.ts`、`*.sql.ts`                        | journal                                          |
| 迁移                            | `packages/novaway/migration/<ts>_<name>/migration.sql` | 建 `dwf_*` 表                                    |
| 内置技能                        | `src/skill/index.ts` 的 `BUILT_IN_SKILLS`              | `dynamic-workflows` 技能                         |
| TypeScript 5.8.2                | `package.json`                                         | 编译期类型检查                                   |
| HTTP API                        | `src/server/routes/instance/httpapi/`                  | run 查询 / 事件流                                |

**结论**：执行、会话、权限、事件、存储全都有，缺的是「编译 + 沙箱 + 纯引擎 + 脚本化作者面」。

---

## 3. 设计原则

从参照产品借 8 条，全部裁剪到当前规模：

1. **恢复严谨，而不是要求严谨。**
   模型写最自然的程序；类型、schema、身份、持久性由 harness 推导。推导不出来的用编译诊断精确指出。

2. **不精确就画宽，不拒绝脚本。**
   静态分析宁可少画一条边，也不因为「分析不了」退回。唯一硬规则：facade 调用必须是直接调用（否则没有 site，没有身份）。

3. **静态图在运行前就完整。**
   确认窗展示的是完整形状；运行时只给图点灯，不临时长出新节点。

4. **journal 是唯一真相。**
   先写 journal 再展示；恢复、通知、完成卡都从引擎记录构建，不从模型的话构建。

5. **语义直白。**
   `await` 就是等，`Promise.all` 就是汇合，不 await 就是并发。ask 失败就是 reject，重试循环是代码、会出现在图里。只有 provider 瞬态错误在运行内隐式重试。

6. **超限就失败，绝不截断。**
   world read 超限 reject，report 超限 fail run。静默不完整的视图比失败更危险。

7. **确认与取消是仅有的控制。**
   没有 token budget、没有节点上限；用户在确认窗批准一次，运行内不再弹权限窗。

8. **写给用户看。**
   phase 名、子代理名、log、报告都用用户的语言写。

---

## 4. 总体架构

```
┌──────────────── 主 Agent / 用户 ────────────────┐
│ /workflow 命令 + dynamic-workflows 技能           │
│ create_workflow / amend / resume / get / list     │
└───────────────────┬───────────────────────────────┘
                    │ 编译、分析、确认
┌───────────────────▼───────────────────────────────┐
│ src/dynamic-workflow/（纯函数库，无 I/O）          │
│  facade/      facade.d.ts 单一事实源               │
│  compiler/    虚拟 TS host + 诊断                  │
│  analysis/    site 表 + phase 表 + lane/fan-out    │
│  schema/      ask<T> → JSON Schema + 校验器        │
│  lowering/    TS → __host.* 打桩后的 JS            │
│  engine/      纯执行引擎（scheduler + engine）      │
└───────────────────┬───────────────────────────────┘
          Boundary A │ WorkflowHostApi
┌───────────────────▼───────────────────────────────┐
│ src/dynamic-workflow/runtime/（沙箱 harness）      │
│  child process + vm cell + NDJSON 桥               │
└───────────────────┬───────────────────────────────┘
          Boundary B │ WorkflowDriver
┌───────────────────▼───────────────────────────────┐
│ src/dynamic-workflow/driver/（生产接线）           │
│  子代理 session、SQLite journal、world reads、      │
│  background job、Bus 事件、权限                    │
└───────────────────┬───────────────────────────────┘
          Boundary C │ RunEvent
┌───────────────────▼───────────────────────────────┐
│ 纯 reducer → 工具卡 / run 卡片 / 通知 / run 面板    │
└───────────────────────────────────────────────────┘
```

三条边界都是窄接口，各有一个生产实现和一个测试替身：

```ts
// Boundary A：脚本 → 引擎
interface WorkflowHostApi {
  createActor(siteId: string, name?: string, persona?: PersonaSpec): ActorId
  ask(siteId: string, actor: ActorId, instructions: string): Promise<unknown>
  worldRead(siteId: string, op: WorldReadOp, args: unknown[]): Promise<unknown>
  report(siteId: string, item: unknown): void
  enterPhase(name: string): void
  log(message: string): void
}

// Boundary B：引擎 → 世界
interface WorkflowDriver {
  createActorSession(actor: ActorRef, persona: PersonaSpec): Promise<SessionRef>
  startAsk(session: SessionRef, instance: InstanceRef, message: AskMessage): void
  respondToSubmit(instance: InstanceRef, verdict: SubmitVerdict): void
  cancelAsk(instance: InstanceRef): void
  executeWorldRead(op: WorldReadOp, args: unknown[]): Promise<unknown>
  journal: JournalStorePort
  emit(event: RunEvent): void
  dispose?(): Promise<void>
}

// Boundary C：引擎 → 观察者
type RunEvent = { type: string; [key: string]: unknown }
```

引擎核心是**纯的**：拥有状态和决策，除 journal 外不做 I/O，同样输入 + 同样 driver 回答 = 同样输出。这是 resume/replay 成立的前提。

---

## 5. 最小 facade（v1）

### 5.1 `facade.d.ts` 草案

放在 `src/dynamic-workflow/facade/dts.ts`，作为常量导出。**编译器喂它，工具描述引用它，技能里嵌入它**——三处同源，不会漂移。

```ts
/** 一次 ask 的待定结果。可以 await，也可以交给 Promise.all。 */
declare interface Node<T> extends PromiseLike<T> {}

declare interface AgentPersona {
  /** 子代理的系统提示词，描述它的角色。 */
  system?: string
}

/**
 * 一个子代理：一段持续保留上下文的对话。
 * 它忙时收到的 ask 按先进先出排队。
 */
declare interface Agent {
  /**
   * 派一个任务。带类型参数时，返回值是 T，并按 T 合成的 schema 校验；
   * 不带时返回子代理的最后一条文本。
   */
  ask<T = string>(instructions: string): Node<T>
}

/**
 * 创建一个子代理。每次调用都是全新的空上下文；
 * 要共享上下文就共享这个返回值。
 * 非空 name 是身份：一次 run 内必须唯一，也是 Amend 匹配缓存的键。
 */
declare function agent(name?: string, persona?: string | AgentPersona): Agent

/** 标记一个阶段。只影响展示：不启动、不等待、不返回任何东西。 */
declare function phase(name: string): void

/** 给用户发一条进度消息。 */
declare function log(message: string): void

/**
 * 发布一条中间结果。必须有 JSON 序列化能力。
 * 运行的 journal 会记录它；失败时也会随完成通知一起交付。
 */
declare function report(item: unknown): void

/** 这次 run 启动时传入的参数。只读。 */
declare const args: Record<string, unknown>

/** 工作区读取：相对工作区路径，按字典序排序。 */
declare const files: {
  glob(pattern: string): Promise<string[]>
  read(path: string): Promise<string>
  grep(pattern: string, glob?: string): Promise<{ path: string; line: number; text: string }[]>
}

/** 工作区只读查询：固定参数向量，绝不拼 shell。 */
declare const git: {
  changedFiles(base?: string): Promise<string[]>
  diff(base?: string, path?: string): Promise<string>
  status(): Promise<{
    branch?: string
    clean: boolean
    staged: string[]
    unstaged: string[]
    untracked: string[]
  }>
  log(count?: number): Promise<{ hash: string; subject: string; author: string; date: string }[]>
}

/** 执行命令：非零退出码是返回值，不是异常。 */
declare const world: {
  run(
    cmd: string,
    args?: string[],
    opts?: { timeoutMs?: number },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>
}
```

### 5.2 编译选项

```ts
const COMPILER_OPTIONS: ts.CompilerOptions = {
  allowJs: false,
  lib: ["lib.es2022.d.ts"],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  // 故意关闭：模型写 TS 时默认它是关的，开着会让 items[i] 成为最大编译失败源。
  noUncheckedIndexedAccess: false,
  target: ts.ScriptTarget.ES2022,
  // 没有 ambient @types：process / fetch / require 编译期就失败。
  types: [],
}
```

脚本被包进：

```ts
async function __workflowScript__() {
  <用户脚本>
}
```

所以顶层 `await` 和末尾 `return` 合法，`declare` / `import` / `export` 非法（诊断会给出改写建议）。

### 5.3 v1 明确不做

| 能力                 | 放到 | 原因                             |
| -------------------- | ---- | -------------------------------- |
| `artifact.*`         | v2   | 需要产物存储与卡片 UI            |
| `hole()`             | v3   | 需要「运行中补代码」的完整链路   |
| `channel` / `future` | v2   | 先让 `Promise.all` 覆盖 90% 场景 |
| `model()` 路由       | v2   | 先继承父会话模型                 |
| `escalate`           | v2   | 需要子代理工具面与问答注册表     |
| 完整 taint / 四张图  | v2   | v1 只画 phase + step + lane      |
| Amend / 导入缓存     | v2   | 先把 resume 做对                 |
| 时间线 UI            | v2   | v1 用工具卡 + 文本进度           |

---

## 6. 编译器与静态分析

### 6.1 虚拟编译 host

`src/dynamic-workflow/compiler/compile.ts`：

- 创建内存 `Map<fileName, text>`，包含脚本、`workflow-facade.d.ts`、以及内嵌的 TS 标准库。
- `ts.createProgram({ host, options, rootNames: [SCRIPT_FILE, FACADE_FILE] })`。
- 所有文件都从 Map 取，**不读磁盘**：打包后的单文件 CLI 和 dev 行为一致。

TS 标准库的嵌入有两种做法：

1. **推荐**：脚本 `script/dynamic-workflow/libs.ts` 读取 `node_modules/typescript/lib/lib.es2022.d.ts` 及其 reference 闭包，生成 `src/dynamic-workflow/compiler/libs.generated.ts`；构建前自动跑。
2. v1 过渡：运行时用 `ts.getDefaultLibFilePath` + `readFileSync`。**不要长期这样做**，打包后会失效。

诊断位置要减去 prelude 行数，回到作者的 1-based 行列。

### 6.2 site 表（v1 的核心产物）

site = 脚本里的一次 facade 调用。它是下游一切的身份证：

| 调用                                 | site id        | 说明                                      |
| ------------------------------------ | -------------- | ----------------------------------------- |
| `x.ask(...)`                         | `ask#1`        | 别人要等的步骤                            |
| `agent(...)`                         | `actor#1`      | 谁来做                                    |
| `files.*` / `git.*` / `world.run`    | `world-read#1` | 一次 journal 化的世界读取                 |
| `Promise.all` / `Promise.allSettled` | `join#1`       | 汇合点                                    |
| 被提升的循环                         | `fan-out#1`    | 扇出                                      |
| `report(...)`                        | `report#1`     | 中间结果                                  |
| `phase("x")`                         | 无             | 标记，lowering 改写成 `__host.enterPhase` |
| `log(...)`                           | 无             | 无身份                                    |

实现要点：

- 用 **checker 解析符号**判断一个调用是不是 facade 调用（解析到 `workflow-facade.d.ts` 的声明），**绝不按名字猜**。
- id 只在 `collectSites` 里铸造；新增收集结构不得碰全局 `order` 计数器。
- 站点表持原始 `ts.Node` 引用；lowering 按**节点身份**命中，不重新识别。

### 6.3 phase / lane / fan-out

v1 只需要三样：

1. **phase 表**：`Map<siteId, phaseName>`。按源码顺序遍历，遇到独立的 `phase("x")` 语句就切换当前阶段；它覆盖到所在 block 结束。
2. **lane 表**：每个 `agent()` site 一条 lane，带名字或名字模式（`` `researcher-${i}` `` → head `researcher-`）。
3. **fan-out**：`for...of` 和 `map/filter/forEach/reduce` 等回调；如果回调体里（含它调用的函数）有 site，就提升为 `fan-out#N`，其中的 site 带 `within`。

v1 **不计算数据边**，确认窗只画「阶段 → 子代理 → 步骤」的先后结构。v2 再加 taint 与依赖边。

### 6.4 诊断码（v1）

| 码   | 规则                                                                                   | 为什么                     |
| ---- | -------------------------------------------------------------------------------------- | -------------------------- |
| 9001 | facade 可调用物只能作为直接调用的 callee；带 site 成员的值不能被转换到没有该成员的类型 | 没有 site 就没有身份       |
| 9002 | `ask<T>` 的 T 必须能表达成 JSON Schema                                                 | 运行时要校验               |
| 9003 | `world.run` 的命令必须是字符串字面量                                                   | 确认窗要在运行前展示命令集 |
| 9004 | `phase()` 的名字必须是非空字面量，且调用独立成句                                       | 名字要上时间线             |
| 9005 | 两个 `agent()` site 不能共用同一个字面量名字                                           | 名字是 Amend 的缓存键      |
| 9006 | fan-out 体里的 `agent("x")` 不能给每个元素同一个固定名字                               | 第二个元素会撞名           |
| 9100 | `report()` 的 item 必须可 JSON 序列化                                                  | journal 要落盘             |

诊断格式统一：`L{line}:C{column} {message}`，直接回给模型。**有诊断就不弹确认窗**——让用户批准一段跑不起来的代码，只会打断模型自己的改错循环。

---

## 7. Lowering

`src/dynamic-workflow/lowering/lower.ts`，两趟：

1. **打桩**：按站点表的节点身份，把 facade 调用改写成 `__host.*`，类型还没擦除。
2. **transpile**：`ts.transpileModule(..., { target: ES2022 })` 擦类型。

| 源码                         | 改写后                                               |
| ---------------------------- | ---------------------------------------------------- |
| `agent(name?, persona?)`     | `__host.createActor(siteId, name, persona)`          |
| `x.ask<T>(msg)`              | `__host.ask(siteId, x, msg)`                         |
| `files.glob(p)`              | `__host.worldRead(siteId, "glob", [p])`              |
| `git.diff(base, path)`       | `__host.worldRead(siteId, "git-diff", [base, path])` |
| `world.run(cmd, args, opts)` | `__host.worldRead(siteId, "run", [cmd, args, opts])` |
| `report(item)`               | `__host.report(siteId, item)`                        |
| `phase("x")`                 | `__host.enterPhase("x")`                             |
| `log(msg)`                   | `__host.log(msg)`                                    |
| `args`                       | `__host.args`                                        |

输出：

```ts
interface LoweredWorkflow {
  /** async 函数体；唯一自由标识符是 __host */
  code: string
  /** 按源码顺序的全部 site id，供 harness 断言 */
  siteIds: string[]
}
```

world-read 的 op 表放在**一张注册表**里（`facade/registry.ts`），站点收集、9003 检查、lowering 三处共读，加一个原语只改一行。

---

## 8. 沙箱

`src/dynamic-workflow/runtime/`，不依赖 `@/core`，只依赖 node 内建 + 纯引擎包。

### 8.1 入口文件

- 写入 `<cwd>/.novaway/workflow-runs/<runId>.mjs`，目录里放一个内容为 `*` 的 `.gitignore`。
- 目录不可写时退到 `<os.tmpdir()>/novaway-workflow-runs/`。
- **不要用命令行传 payload**：Windows 命令行上限 32,767 字符。
- 子进程：`spawn(process.execPath, ["--max-old-space-size=256", entry])`。
  - Bun 下 `process.execPath` 是 bun 二进制，同一份入口也能跑。
  - 打包成单文件 CLI 时，改为 `[...argsPrefix, entry]`（CLI 自己的隐藏子命令）。
  - 桌面端需要 `ELECTRON_RUN_AS_NODE=1`。

### 8.2 vm cell

`vm.createContext(sandbox)`，全局只暴露：

- `__send(line)`：向父进程写一行 NDJSON
- `__argsJson`：本次 run 的参数 JSON
- `__deliver(line)`：父进程投递 response
- `__execute(runFn)`：跑脚本
- `__checkStalled()`：停滞检测

`__host` 在 cell 内构造。`args = Object.freeze(JSON.parse(__argsJson))`（浅冻结）。

**确定性禁令**（抛错）：

- `Date.now()`
- 无参 `new Date()`
- `Math.random()`

理由：resume 要逐字节重放，任何非确定性都会让 `inputHash` 失配。

### 8.3 NDJSON 线协议

```
child → parent:
  { kind: "create-actor", localId, siteId, name?, persona? }
  { kind: "request", id, type: "ask" | "world-read", siteId, ... }
  { kind: "event", type: "log" | "report" | "phase-entered", ... }
  { kind: "complete", ok, value?, error? }

parent → child:
  { kind: "response", id, ok, value?, error? }
```

- `create-actor` 是即发即忘：父进程按 stdio FIFO 在后续 ask 之前完成 `local#N → ActorId` 映射。
- `report` 走事件通道（脚本从不 await 它），但**到达顺序承重**：父进程按到达顺序落 journal。
- 错误跨边界时重建为带 `code / violations / finalText` 的 Error，脚本可以 `try/catch` 按结构处理。

### 8.4 停滞检测

cell 没有定时器、没有 I/O，唯一能唤醒脚本的是 host response。所以：

> 已投递 response、微任务排空、脚本未完成、没有在飞请求 ⇒ 永远不会再有事发生。

外层在 `__execute` 起步后和每条 response 投递后各调一次 `__checkStalled`（`setImmediate`，在微任务之后）。命中即发 error `complete`：

- `ScriptStalled`：一个永不兑现的 promise
- `ChannelDeadlock`（v2）：有接收者停在 channel 上

这不是超时，是**可证明的静止**。

---

## 9. 引擎与 driver

### 9.1 引擎核心

`src/dynamic-workflow/engine/`，纯 TS class：

```ts
class WorkflowEngine {
  constructor(config: EngineConfig)
  createActor(siteId, name?, persona?): ActorId
  ask(siteId, actor, instructions): Promise<unknown>
  worldRead(siteId, op, args): Promise<unknown>
  report(siteId, item): void
  enterPhase(name): void
  complete(value): void
  fail(error): void
  stop(reason, error?): void
  get settled: Promise<RunSettlement>
}
```

职责：

- 分配 site 的 ordinal（到达计数器）
- 落 journal（running → completed/failed）
- 计算 `inputHash`
- 维护每个 actor 的 FIFO
- 执行并发上限
- 把事件交给 `driver.emit`

### 9.2 调度规则

- **每个子代理一次只答一个 ask**；同一子代理的 ask 按脚本发出顺序排队，队列位置记进 journal 的 `actor_seq`。
- **全局最多 `caps.maxConcurrency` 个 ask 在飞**。默认：

```ts
D = max(4, min(16, availableParallelism() - 2))
```

- **hold 规则**：恢复时，journal 里已存在的 ask 先按记录顺序排队放行，之后才允许 live ask 进入。否则缓存答案与现场答案会交错，子代理的转录顺序和第一次不一致。
- **phase 标记：词法优先，动态兜底**。编译产物的 `sitePhases` 能唯一定位就按它打戳；否则用调用时当前的 marker。这样两个并发 stage 各自开 marker 也不会互相打错戳。

### 9.3 ask 生命周期

```
queued → dispatched → (repairing | nudged)* → settled ok / failed / cancelled
```

v1：

- **无类型 ask**（无类型参数或 `string`）：结果是子代理最后一条 assistant 文本。
- **有类型 ask**：v1 先把 schema 放进 ask 文本尾注，要求子代理**最后一条消息只输出 JSON**；driver 解析并校验。解析失败重试一次，再失败该 ask 失败。
- **v1.5**：增加 `submit_result` 工具，把 schema 变成工具声明，校验失败让模型原轮修复（最多 3 次），比解析文本稳得多。

v1.5 需要：

- 一个内置隐藏 agent `workflow_child`（`src/agent/agent.ts` 的 `agents` 默认表），`tools` 白名单里含 `submit_result` / `escalate`，`disallowedTools` 含 `task` / `create_workflow`。
- 一个 `submit_result` 工具，`checkPermissions` 永远 allow，输入 schema 由 run 注入（或者用通用 `{ result: unknown }`）。

### 9.4 终态

| 状态                 | 含义                                                    | 可恢复             |
| -------------------- | ------------------------------------------------------- | ------------------ |
| `completed`          | 脚本 return                                             | 否                 |
| `errored`            | 脚本抛错 / run 级失败                                   | 否，走 Amend（v2） |
| `stopped { reason }` | 外部结束：`user` / `model` / `provider` / `interrupted` | 是                 |

- `complete / fail / stop` 都先中止在飞 ask，再写终态。
- `provider` 错误带结构化 `ProviderStopDetails`（kind / reason / provider / model），修好原因后可以 resume。
- `interrupted` 是宿主关闭 / 沙箱崩溃 / 协议损坏，可 resume。
- 结算清理：`driver.dispose()` 释放子代理 session、取消订阅、关闭浏览器等。

### 9.5 driver 接线要点（与现有代码的接缝）

- `makeRunAgent`（`src/session/agent-step.ts`）是**一次性**的：每次调用 `sessions.create` 一个新会话，
  跑一轮 `ops.prompt`，读用量。actor 需要相反的形状——**建一次会话，多次 prompt**。所以 driver
  不复用 `makeRunAgent`，而是直接组合它内部那三件事：

```ts
// createActorSession：一次
const child = yield* sessions.create({ parentID, title, permission: [...], ... }, { runID })
// startAsk：每一轮
const result = yield* ops.prompt({
  sessionID: child.id,
  messageID: MessageID.ascending(),
  model: { providerID, modelID },
  agent: actorAgent,
  parts: yield* ops.resolvePromptParts(instructions),
})
```

- `ops.cancel(sessionID)` 是 `cancelAsk` 的底座。
- 团队登记（`teams.addMember`）v1 默认**不**做：一个 run 的 8 个子代理不该污染团队面板。
  需要时由 run 参数显式打开。
- `deriveSubagentSessionPermission` 决定子会话能做什么；`workflow_child` 的 `tools` 白名单在这里生效。
- 用量按 `sessionID` 读（`sessions.get(id).tokens`），累计进 `dwf_run.spent_tokens`；
  resume 时从这一列接着加。

---

## 10. 数据模型

### 10.1 迁移

新建 `packages/novaway/migration/<timestamp>_dynamic_workflow/migration.sql` 和对应的 `src/dynamic-workflow/journal.sql.ts`。

```sql
CREATE TABLE `dwf_run` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_session_id` text,
	`cwd` text NOT NULL,
	`name` text,
	`script_text` text NOT NULL,
	`script_hash` text NOT NULL,
	`script_path` text,
	`args_json` text,
	`tool_call_id` text,
	`resumed_from` text,
	`caps_max_concurrency` integer NOT NULL,
	`spent_tokens` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`stop_reason` text,
	`result_json` text,
	`failure_json` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dwf_run_cwd_idx` ON `dwf_run` (`cwd`, `time_updated`);
--> statement-breakpoint
CREATE INDEX `dwf_run_session_idx` ON `dwf_run` (`parent_session_id`, `time_updated`);
--> statement-breakpoint
CREATE TABLE `dwf_actor` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`site_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`name` text,
	`persona_json` text,
	`session_id` text,
	`resolved_model` text,
	`time_created` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `dwf_run`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dwf_actor_site_idx` ON `dwf_actor` (`run_id`, `site_id`, `ordinal`);
--> statement-breakpoint
CREATE TABLE `dwf_node` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`site_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_site_id` text,
	`actor_ordinal` integer,
	`actor_seq` integer,
	`phase_name` text,
	`input_hash` text NOT NULL,
	`input_json` text,
	`status` text NOT NULL,
	`result_json` text,
	`error_json` text,
	`stats_json` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `dwf_run`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dwf_node_instance_idx` ON `dwf_node` (`run_id`, `site_id`, `ordinal`);
--> statement-breakpoint
CREATE INDEX `dwf_node_kind_idx` ON `dwf_node` (`run_id`, `kind`);
--> statement-breakpoint
CREATE TABLE `dwf_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`time_created` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `dwf_run`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dwf_event_seq_idx` ON `dwf_event` (`run_id`, `sequence`);
```

v2 增加：

```sql
CREATE TABLE `dwf_question` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`actor_site_id` text,
	`actor_ordinal` integer,
	`question` text NOT NULL,
	`context` text,
	`status` text NOT NULL,      -- pending | answered | withdrawn
	`answer` text,
	`asked_at` integer NOT NULL,
	`answered_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `dwf_run`(`id`) ON DELETE CASCADE
);
```

### 10.2 字段语义

| 表          | 关键字段                          | 说明                                                             |
| ----------- | --------------------------------- | ---------------------------------------------------------------- |
| `dwf_run`   | `script_hash`                     | resume 前必须与 `script_text` 一致，否则 `ScriptHashMismatch`    |
|             | `caps_max_concurrency`            | submit 时落库；resume 复用；可原地 retune                        |
|             | `status`                          | 逻辑三态 `completed / errored / stopped`，`stop_reason` 单独一列 |
| `dwf_actor` | `(run_id, site_id, ordinal)` 唯一 | 一个 `agent()` site 的第 n 个子代理                              |
|             | `session_id`                      | 常驻子会话                                                       |
|             | `persona_json`                    | 规范化后记入；Amend 匹配时忽略 `model`                           |
| `dwf_node`  | `(run_id, site_id, ordinal)` 唯一 | 一次执行                                                         |
|             | `kind`                            | `ask / world-read / world-run / report`                          |
|             | `actor_seq`                       | 该 ask 在这个子代理序列里的位置                                  |
|             | `input_hash`                      | ask = instructions；world read = `{op,args}`；report = item      |
| `dwf_event` | `(run_id, sequence)` 唯一         | 事件先落库再 emit，顺序与对象身份都承重                          |

**为什么不用现有 `workflow` / `workflow_run` 表**：

- 现有表是「步骤配置 + 单一 state JSON」，语义是 DAG 快照，不是逐节点 journal。
- 混用会让 resume 的两个真相打架。
- 新表用 `dwf_` 前缀，互不干扰；旧 `workflow` 工具保留，后续可以迁移或下线。

### 10.3 journal 读写原则

- 所有读都**显式说明取什么**：`kinds`、`withResult`、`limit` 必填。
- 计数用 SQL：`count(*)`、`sum(octet_length(result_json))`，不把行读进内存再数。
- report 的读取按页：默认只取前 64 条，终态快照取前 256 条且不超过 8 MiB。
- 任何一张表都不做全表加载。

---

## 11. 工具清单

命名沿用本仓的 snake_case。全部在 `src/tool/` 下新增文件，并在 `src/tool/registry.ts` 注册。

### 11.1 v1（闭环必需）

| 工具                   | 参数                                                                     | 行为                                             |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| `create_workflow`      | `name?`, `script?`, `path?`, `saved?`, `args?`, `max_concurrency?`       | 编译 → 诊断或确认 → 后台启动 → 返回 runId        |
| `get_workflow_run`     | `run_id`                                                                 | 读 run 快照：状态、阶段、节点、报告、用量        |
| `list_workflow_runs`   | `limit?`, `cwd?`                                                         | 当前项目的历史 run                               |
| `stop_workflow_run`    | `run_id`, `reason?`                                                      | 取消在飞 ask，落 `stopped(user/model)`           |
| `resume_workflow_run`  | `run_id`                                                                 | 校验可恢复 → 同脚本重跑 → journal 回答已发生的事 |
| `save_workflow`        | `name`, `description`, `when_to_use?`, `script?`/`script_path?`, `scope` | 写 `<name>.dwf.ts`                               |
| `list_saved_workflows` | `scope?`                                                                 | 扫目录，返回元数据                               |

### 11.2 v2

| 工具                       | 说明                                                            |
| -------------------------- | --------------------------------------------------------------- |
| `amend_workflow`           | 新 run + 导入前驱已完成工作；只改并发时原地 retune              |
| `answer_workflow_question` | 回答子代理的 `escalate`                                         |
| `fill_workflow_hole`       | 补全运行中脚本的缺口（v3）                                      |
| `eval_workflow_snippet`    | 只跑 `files.*` / `git.*` / `world.run` 的片段，用于验证固定逻辑 |

### 11.3 参数与确认

`create_workflow` 的关键点：

```ts
const params = Schema.Struct({
  name: Schema.optional(Schema.String),
  script: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  saved: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  ),
  args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  max_concurrency: Schema.optional(Schema.Finite),
})
```

- `script` / `path` / `saved` 三选一，在 `validateInput` 里检查（不要用 schema refine，因为 `resolveInput` 之后会同时存在）。
- 编译有诊断：直接返回 `{ ok: false, diagnostics, response: "…" }`，**不弹窗、不启动**。
- 编译干净：调用 `ctx.ask` 做确认。

**阻塞还是后台。** v1 默认**阻塞**：`execute` 等 run 结算，把结果直接还给模型，模型同一轮就能读到
报告（参照产品同款）。run 本身仍然注册为 `BackgroundJob`——它承担三件事：宿主重启后能恢复/标记
中断、进度事件有处可发、用户切走再回来还能查到。`background: true` 时立即返回 `run_id`，
完成事件再由 `BackgroundJob` 的 `Event.Completed` 送回会话。

### 11.4 确认窗

`create_workflow` 的 `Capabilities.checkPermissions` 返回 `"ask"`，并在 `execute` 里发一条带 metadata 的确认：

```ts
yield *
  ctx.ask({
    permission: "workflow",
    patterns: [runName],
    always: ["*"],
    metadata: {
      name: runName,
      script,
      phases: phaseNames,
      commands: declaredWorldRunCommands, // 字符串字面量集合
      maxConcurrency,
    },
  })
```

需要在权限默认值里加：

```ts
workflow: "ask",
```

否则默认 `"*": "allow"` 会让它静默通过。子代理的默认规则里则设 `workflow: "deny"`，禁止套娃。

`yolo` / `bypassPermissions` / `unattended` 档位会跳过确认——这是既有语义，保持。

---

## 12. 恢复、并发与错误

### 12.1 恢复 = 同一脚本再跑一次

1. 校验 `script_hash` 与 `script_text` 一致；不一致 → `ScriptHashMismatch`。
2. 只允许 `stopped` 恢复；`completed` / `errored` 拒绝。
3. 从 journal 恢复：
   - `completed` / `failed` 的节点：直接结算，`node-settled { cached: true }`，不调 driver。
   - `running` 的节点：重新 live 执行。
   - report 计数、artifact 状态、每个 actor 已记录的 ask 数量、`spent_tokens`。
4. **重放结算顺序**：读第一次生命里每个实例首次 `node-settled` 的顺序，做一道闸门，按序释放缓存结算。否则 fan-out 的完成顺序变化会让下游 ordinal 漂移，撞 `InputHashMismatch`。

### 12.2 并发

| 上界                             | 单位                | 默认                           | 可变                                |
| -------------------------------- | ------------------- | ------------------------------ | ----------------------------------- |
| run 自己的 `caps.maxConcurrency` | 在飞 ask            | `D = max(4, min(16, cores-2))` | 是，`max_concurrency` 或原地 retune |
| 进程级共享 cap                   | provider 的在飞请求 | 由 governor 学习               | 是                                  |

v1 只实现 run 上界 + 一个固定的 provider 侧退避（429 / 5xx 重试，指数退避到 60s，尊重 `Retry-After`）。完整的自适应 governor 放 v2。

### 12.3 错误分类

| 类别                              | 处理                                       |
| --------------------------------- | ------------------------------------------ |
| 脚本抛错                          | `errored`，失败信息进通知                  |
| 沙箱崩溃 / 协议损坏 / 超时        | `stopped(interrupted)`，可 resume          |
| 用户取消                          | `stopped(user)`                            |
| provider 认证 / 配额 / 模型不存在 | `stopped(provider)`，修好原因后可 resume   |
| 上下文超限                        | 该 ask 失败 `ContextLimit`，脚本可以 catch |
| 瞬态模型错误                      | 运行内无限重试，脚本看不到                 |

---

## 13. 事件与 UI

### 13.1 Bus 事件

新增 `src/dynamic-workflow/events.ts`：

```ts
export const Event = {
  RunStarted: BusEvent.define("workflow.run.started", Schema.Struct({ run: RunInfoSchema })),
  RunUpdated: BusEvent.define("workflow.run.updated", Schema.Struct({ run: RunInfoSchema })),
  RunSettled: BusEvent.define(
    "workflow.run.settled",
    Schema.Struct({ run: RunInfoSchema, settlement: SettlementSchema }),
  ),
  NodeChanged: BusEvent.define("workflow.node.changed", Schema.Struct({ runId: Schema.String, node: NodeInfoSchema })),
  Report: BusEvent.define("workflow.report", Schema.Struct({ runId: Schema.String, item: Schema.Unknown })),
  Question: BusEvent.define("workflow.question", Schema.Struct({ runId: Schema.String, question: QuestionSchema })),
}
```

事件 payload 只放**有界**字段：脚本正文、报告 item、工具输出各自限量；超限截断并标记 `truncated: true`。

### 13.2 纯 reducer

`src/dynamic-workflow/projection.ts`：

```ts
type WorkflowRunState = {
  run: RunInfo
  phases: PhaseState[]
  actors: ActorState[]
  nodes: Record<string, NodeState>
  reports: ReportItem[]
  usage: { spentTokens: number; nodesUsed: number }
}
```

- 输入：`RunEvent`
- 输出：新的 `WorkflowRunState`
- 无 `Date.now`、无随机、无 I/O
- 前端、TUI、HTTP 共用同一份

### 13.3 v1 的三块 UI

| 界面     | v1                                                                  | v2                             |
| -------- | ------------------------------------------------------------------- | ------------------------------ |
| 工具卡   | `create_workflow` 运行中显示阶段列表；结束后显示 run 状态和结果摘要 | 时间线、子代理 pill、弧线      |
| run 卡片 | 一行状态 + 用量 + 报告前 3 条                                       | 完成卡、产物、筛选             |
| run 面板 | 文本树：阶段 → 子代理 → ask → 状态                                  | 竖向 spine、子代理转录、事件流 |

v1 不画时间线，先保证**数据正确**。UI 只是 `WorkflowRunState` 的渲染。

### 13.4 通知

run 在后台跑，主 Agent 通过 `background/job.ts` 的完成通知拿到结果：

```
<task-notification>
  <run id="dwfrun-..." status="completed">
    <result>…</result>
    <reports count="12" shown="8">…</reports>
  </run>
</task-notification>
```

完成通知里带一段给模型的呈现指引：

- 先给结论；
- 每条发现带证据（`path:line` 或命令 + 输出）；
- 哪些是确定性检查确认的，哪些只是判断；
- 没覆盖什么；
- 不要复述阶段图和脚本。

---

## 14. 权限与安全

1. **确认窗是唯一的授权点。**
   `create_workflow` 默认 `workflow: "ask"`；允许后可以「本会话总是允许」。运行内不再弹权限窗。

2. **`world.run` 的命令在编译期闭合。**
   命令必须是字符串字面量；确认窗展示完整命令集。driver 只执行编译产物里的命令，没有第二份运行时名单。

3. **固定 argv，绝不拼 shell。**
   没有管道、重定向、变量展开、`cwd`、`env`。需要组合就写多次调用和普通代码。

4. **路径必须留在工作区。**
   `files.read` / `artifact.file` 解析后再次用 realpath 校验，符号链接也不能逃逸。

5. **子代理工具面裁剪。**
   `workflow_child` 不含：`task`、`create_workflow`、`amend_workflow`、`plan_enter`、`plan_exit`、`question`（v1，避免子代理直接问人）。含：读写、搜索、bash、`submit_result`（v1.5）、`escalate`（v2）。

6. **沙箱不是安全边界。**
   `vm` 只提供确定性和隔离；脚本是用户批准后运行的本地代码。文档里要写清楚，不要对外宣称「安全沙箱」。

---

## 15. 里程碑

按 1 名工程师、每周 5 个工作日估算。

### M0 · 设计冻结与脚手架（2 天）

交付：

- `src/dynamic-workflow/` 目录骨架
- `facade/dts.ts`（d.ts 常量）
- `compiler/compile.ts` + 标准库嵌入脚本
- 10 个编译 fixture（干净 / 各类诊断）
- `docs/dynamic-workflow.md`（本方案的实现版）

验收：

- `bun test src/dynamic-workflow` 全绿
- 一段合法脚本能编译并拿到 site 表；一段非法脚本能拿到 `L:C` 诊断

### M1 · 编译 + 确认（4 天）

交付：

- `create_workflow` 工具（只编译，不执行）
- site 表 + phase 表 + lane 表
- 确认窗 metadata（脚本、阶段、命令集）
- `workflow` 权限默认 `ask`
- 草稿文件：`.novaway/workflows/drafts/<name>-<ts>.ts`

验收：

- 模型调用 `create_workflow` → 用户看到脚本和阶段 → 拒绝/允许
- 编译失败不弹窗，模型收到诊断并重试
- 工具描述 < 1.5k token

### M2 · 执行最小闭环（7 天）

交付：

- lowering
- 沙箱 harness（child + vm + NDJSON + 停滞检测）
- 纯引擎（scheduler + engine）
- driver：`createActorSession` / `startAsk` / `worldRead` / `report`
- 4 张表 + 迁移
- `get_workflow_run` / `list_workflow_runs` / `stop_workflow_run`
- run 后台化 + 完成通知

验收（端到端）：

```ts
phase("读取")
const files = await files.glob("packages/novaway/src/**/*.ts")
phase("审查")
const reviews = await Promise.all(files.slice(0, 3).map((f) => agent(`review-${f}`).ask(`Review ${f}`)))
report({ count: reviews.length })
return reviews.join("\n\n")
```

- run 完成，journal 有 1 个 world-read + 3 个 ask + 1 个 report
- 工具卡显示阶段和每个 ask 的状态
- 断开进程后 run 落 `stopped(interrupted)`

### M3 · 可靠性与恢复（5 天）

交付：

- ~~`resume_workflow_run`~~ ✅ `src/tool/workflow-resume.ts`
- ~~`inputHash` + `InputHashMismatch`~~ ✅ 引擎在缓存命中前逐个比对；对不上就整次 run 失败
- ~~hold 规则 + 结算顺序重放~~ ✅ `engine/replay.ts`（帧内按首次结算顺序批量释放）
- 并发上限 ✅（run 级）；429 退避 ⏳ 仍由 provider 层负责
- `stop(provider)` 分类 ⏳
- 纯 reducer + 事件 ⏳（事件已落 `dwf_event`，还没接总线）

验收：

- ✅ 跑到一半杀掉进程 → resume → 已完成的 ask 不重复花 token，结果一致
- ✅ 脚本改一个字符 → 编译期由 `script_hash` 挡住；运行期由 `InputHashMismatch` 挡住
- ✅ fan-out 完成顺序变化 → resume 后下游 ordinal 不漂移（`replay.ts` 的结算顺序队列）

### M4 · 作者面与 UI（7 天）

交付：

- ~~`save_workflow` / `list_saved_workflows` / 项目与全局作用域~~ ✅ `src/tool/workflow-save.ts`（`.novaway/workflows/*.dwf.ts` 与全局目录，头部即元数据）
- ~~`dynamic-workflows` 内置技能~~ ✅ `src/skill/prompt/dynamic-workflows.md`
- 技能门（不做）：硬拒绝会多一轮往返，而编译诊断本身已经把错误讲清楚了
- 总线事件 ✅（`events.ts` / `publish.ts`）；只读 HTTP 接口 ✅（`groups/dynamic-workflow.ts`）；
  run 卡片与时间线 ⏳ 前端未消费
- `eval_workflow_snippet`（可选）

验收：

- ✅ 技能里的示例脚本全部能编译（`test/dynamic-workflow/skill.test.ts`）
- ✅ 保存的工作流能在新会话里按名字运行（`tool-integration.test.ts` 的 saved 用例）
- ✅ 重启之后能从 HTTP 读到上一次的 run：列表按目录收窄、详情带进度、节点/事件可分页
  （`httpapi-dynamic-workflow.test.ts`）

### M5 · v2 能力（按需）

- `amend_workflow` + 导入缓存
- `answer_workflow_question` + `escalate`
- `artifact.*` + 产物卡
- `channel` / `future`
- 自适应并发 governor
- 时间线 UI
- `fill_workflow_hole`

---

## 16. 风险与缓解

| 风险                        | 影响                 | 缓解                                                                      |
| --------------------------- | -------------------- | ------------------------------------------------------------------------- |
| Bun / Node 的 `vm` 行为差异 | 沙箱在某个运行时失效 | 先用子进程隔离；`vm` 不可用时降级为普通全局，并在测试矩阵里覆盖两个运行时 |
| TS 标准库嵌入               | 打包后编译失败       | M0 就做生成脚本，测试打包产物                                             |
| 单文件 CLI 子进程启动       | 入口找不到           | 用 CLI 自身的隐藏子命令 + `argsPrefix`，并在 CI 里测                      |
| 子代理会话成本              | 一次 run 很贵        | 确认窗显示「最多 N 个子代理」；默认并发 D；报告与用量可见                 |
| 模型写不出可编译脚本        | 体验差               | 技能 + 示例 + 精确诊断；`eval_workflow_snippet` 让固定逻辑先验证          |
| 上下文膨胀                  | 工具描述占满 context | 描述做薄，规则放技能，技能门保证读过                                      |
| 权限疲劳                    | 每次都要点           | 「本会话总是允许」；只对脚本级动作确认一次                                |
| journal 写放大              | report 太多          | 每 run 65,536 条 / 单条 1 MiB / 总 1 GiB 上限，超限 fail run              |

---

## 17. 与参照产品的差异

| 维度       | 参照产品                         | 本方案 v1                           | 理由                           |
| ---------- | -------------------------------- | ----------------------------------- | ------------------------------ |
| 分析       | taint 不动点 + 时序走查 + 四张图 | site 表 + phase 表 + lane/fan-out   | 先把身份和展示做对，数据边后置 |
| 类型化结果 | `submit_result` + schema 合成    | 尾注 JSON + 校验（v1.5 再上工具）   | 避免子代理工具面改造阻塞闭环   |
| 沙箱       | 独立包 + SEA 子命令              | 同进程包 + 子进程                   | 规模小，先合在一起             |
| 产物       | `artifact.*` + 仪表盘            | v2                                  | UI 成本高                      |
| 恢复       | 重放结算顺序 + hold 规则         | 同                                  | 这是正确性核心，不裁剪         |
| Amend      | 导入缓存 + inFlight 续跑         | v2 先做「连续前缀」                 | 先保证 resume 正确             |
| UI         | 时间线 + run pane + 完成卡       | 文本树 + 卡片 + 只读 HTTP           | 先数据后视觉                   |
| 灰度       | `disabled/onDemand/alwaysOn`     | 配置开关 `workflow.dynamic.enabled` | 先本地开关                     |

---

## 附录 A · 示例脚本

```ts
interface Finding {
  /** 文件与行号，例如 "src/a.ts:42"。 */
  where: string
  /** 一句话说明问题。 */
  what: string
  /** 读到或跑到的证据。 */
  evidence: string
  severity: "low" | "medium" | "high"
}

const reviewer = agent("reviewer", {
  system: "你是代码评审员。只报告你能指出证据的问题；没有证据的猜测不要写。",
})

phase("收集改动")
const changed = await git.changedFiles()
log(`检查 ${changed.length} 个改动的文件`)

phase("逐文件评审")
const results = await Promise.all(
  changed.map(async (file) => {
    const diff = await git.diff(undefined, file)
    const found = await reviewer.ask<Finding[]>(`审查这个 diff，只报告真实问题：\n${diff}`)
    report({ file, count: found.length })
    return found
  }),
)

const all = results.flat()
report({ total: all.length })

phase("汇总")
return {
  conclusion: `检查了 ${changed.length} 个文件，发现 ${all.length} 个问题。`,
  findings: all,
}
```

## 附录 B · 文件清单与 PR 拆分

| PR    | 内容                                                         | 依赖 |
| ----- | ------------------------------------------------------------ | ---- |
| PR-1  | `dynamic-workflow/facade` + `compiler` + fixture 测试        | 无   |
| PR-2  | `analysis`（site / phase / lane / fan-out）+ 9001-9006       | PR-1 |
| PR-3  | `lowering` + `runtime`（沙箱）+ 端到端 fake driver 测试      | PR-2 |
| PR-4  | `engine`（scheduler + journal port）+ 内存 journal 契约测试  | PR-3 |
| PR-5  | `journal.sql.ts` + 迁移 + SQLite store                       | PR-4 |
| PR-6  | `driver`（session / world read / report）+ `create_workflow` | PR-5 |
| PR-7  | `get/list/stop` + background job + Bus 事件 + 纯 reducer     | PR-6 |
| PR-8  | `resume` + hash / hold / 重放顺序                            | PR-7 |
| PR-9  | `save/list saved` + 技能 + 技能门                            | PR-8 |
| PR-10 | UI：工具卡、run 卡片、run 面板                               | PR-7 |

## 附录 C · 术语

| 词                   | 含义                                                         |
| -------------------- | ------------------------------------------------------------ |
| **workflow**         | 模型写、用户批准的东西：一个脚本和它的名字                   |
| **script**           | TypeScript 源码                                              |
| **site**             | 脚本里的一次 facade 调用，身份单位：`ask#3`                  |
| **instance**         | site 的一次执行：`ask#3@1`                                   |
| **run**              | 一个脚本的一次执行：`dwfrun-<uuid>`                          |
| **actor / subagent** | `agent()` 背后的常驻子会话                                   |
| **ask**              | 一次 `.ask()`：给子代理的消息和它结算出的结果                |
| **phase**            | 脚本用 `phase("…")` 声明的命名阶段                           |
| **world read**       | `files.*` / `git.*` / `world.run` 的一次 journal 化调用      |
| **journal**          | run 的持久记录：`dwf_run / dwf_actor / dwf_node / dwf_event` |
| **settlement**       | run 到达终态的那一刻，以及如何结束的记录                     |
