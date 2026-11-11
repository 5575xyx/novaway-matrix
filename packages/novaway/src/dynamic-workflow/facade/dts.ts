/**
 * 工作流脚本能看见的唯一一块 API 表面，以 `.d.ts` 的形式内嵌成字符串。
 *
 * 这是**单一事实源**：编译器把它当 ambient 声明喂给 `ts.createProgram`，工具描述与
 * `dynamic-workflows` 技能里的示例也从它派生。改这里就是改作者面；改完必须能通过
 * `test/dynamic-workflow/facade.test.ts`——那份测试把本文件真的编译一遍，并断言
 * 每个声明都能被 `collectSites` 认出来。
 *
 * 为什么是字符串而不是真实的 `.d.ts` 文件：compile 走的是全虚拟 host（内存 Map，不读盘），
 * 打包成单文件 CLI 之后磁盘上根本没有 `src/` 目录。字符串是唯一在任何运行形态下都成立的载体。
 *
 * 三个约束，改动时别破坏：
 *   1. **没有 import/export**。它必须是一份全局声明文件，作者脚本才不需要 import 就能用
 *      `agent` / `files` / `args`。一旦出现顶层 `export`，整份文件会变成模块，全局名全部消失。
 *   2. **没有模板字面量插值**。本常量用 `String.raw` 承载，里面的 `${...}` 会被外层咬掉。
 *      需要写反引号就用普通字符串拼接描述（JSDoc 里也尽量别写）。
 *   3. **每个可调用物都要能被 analyzer 认出来**。`collectSites` 靠 checker 解析符号、再看声明
 *      落在哪个接口/函数上来分类，**绝不按名字猜**。所以新增成员时，形状要跟现有的一致
 *      （函数声明、或接口里的方法签名），别用变量持有箭头函数。
 */

/** 脚本文件在虚拟文件系统里的名字。诊断、source map、错误栈都用它。 */
export const WORKFLOW_SCRIPT_FILE = "workflow-script.ts"

/** 门面声明文件在虚拟文件系统里的名字。analyzer 靠它判断「这个调用是不是 facade 调用」。 */
export const WORKFLOW_FACADE_FILE = "workflow-facade.d.ts"

/**
 * 作者的脚本被包进这个 async 函数里再编译，所以顶层 `await` 与末尾 `return` 都合法。
 * 前缀占一行；诊断的行号要减掉 `WORKFLOW_SCRIPT_PRELUDE_LINES`。
 */
export const WORKFLOW_SCRIPT_PRELUDE = "async function __workflowScript__() {\n"

/** 前缀的行数（用于把诊断坐标还原成作者看到的 1-based 行列）。 */
export const WORKFLOW_SCRIPT_PRELUDE_LINES = 1

/** 后缀：与前缀成对出现。 */
export const WORKFLOW_SCRIPT_EPILOGUE = "\n}"

export const WORKFLOW_FACADE_DTS = String.raw`/**
 * NovaWay 动态工作流门面。
 *
 * 作者写的是一个普通的 async 程序：await 就是等，Promise.all 就是汇合，不 await 就是并发。
 * 没有隐藏的调度语义，也没有 DSL。
 */

/**
 * 一次 ask 的待定结果。
 *
 * 它是个 thenable 而不是 Promise：脚本可以 await 它，也可以把它交给 Promise.all。
 * 把它当成"一个还没回来的调用"来想，比当成"一个 promise"更准确。
 */
declare interface Node<T> extends PromiseLike<T> {}

/** 子代理的人格设定。 */
declare interface AgentPersona {
  /** 这个子代理的系统提示词：它是谁、它该做什么、它不该做什么。 */
  system?: string
}

/**
 * 一个子代理：一段**持续保留上下文**的对话。
 *
 * 同一个 Agent 上的多次 ask 共享上下文，按发出的先后排队（它一次只答一个）。
 * 要并行、要互不干扰，就建多个 agent()。
 */
declare interface Agent {
  /**
   * 派一个任务给这个子代理，返回它的结果。
   *
   * 带类型参数时（例如 ask<Finding[]>(...)），返回值按 T 合成的 schema 校验：
   * 子代理的输出不合 schema 会被要求重答，而不是把半截东西交回来。
   * 不带类型参数时，返回子代理最后一条回复的纯文本。
   */
  ask<T = string>(instructions: string): Node<T>
}

/**
 * 创建一个子代理。
 *
 * 每次调用都是一个**全新的空上下文**；要让多个 ask 共享上下文，就共享同一个返回值：
 *
 *   const r = agent("reviewer")
 *   await r.ask("先读 src/a.ts")
 *   await r.ask("现在说它有什么问题")   // 它记得第一句话
 *
 * 非空的 name 是这个子代理的身份：一次 run 内必须唯一，界面上显示它，
 * 后续把旧 run 的工作带进新 run 时也按它匹配。不写也行，界面会显示兜底名。
 *
 * persona 可以直接给系统提示词字符串，也可以给 AgentPersona 对象。
 */
declare function agent(name?: string, persona?: string | AgentPersona): Agent

/**
 * 标记一个阶段。只影响展示：不启动任何东西、不等待、不返回任何值。
 *
 * 名字用**用户的语言**写——它会长在时间线和完成卡上。同一个 run 里可以重复进入同一个阶段
 * （循环里很常见），每次进入都会记一笔。
 */
declare function phase(name: string): void

/** 给用户发一条进度消息。请写成用户读得懂的话，不要写调试日志。 */
declare function log(message: string): void

/**
 * 发布一条中间结果。
 *
 * 与 log 的区别：report 是**数据**，会进 journal、会出现在完成通知里；log 是**旁白**。
 * item 必须能被 JSON 序列化。每条 report 都该带够上下文，让人单看一条就知道它是什么。
 */
declare function report(item: unknown): void

/**
 * 本次 run 启动时传入的参数，只读。没传就是空对象。
 *
 * 只读是**浅**的（与运行期的 Object.freeze 一致）：args.foo 不能重新赋值，args.foo.bar 可以。
 * 挡的是「手滑改实参」，不是安全边界——实参本来就是调用方给的。
 */
declare const args: Readonly<Record<string, unknown>>

/** 工作区读取。路径一律相对工作区根目录。 */
declare const files: {
  /** 按 glob 列文件，结果是**字典序**排列的相对路径数组。 */
  glob(pattern: string): Promise<string[]>
  /** 读一个文本文件的全文。文件太大、不是文本、路径逃出工作区都会 reject。 */
  read(path: string): Promise<string>
  /**
   * 按正则搜内容。pattern 是 JS 正则源码（不带斜杠）；glob 限定搜索范围。
   * 每条命中给出文件、1-based 行号与该行原文。
   */
  grep(pattern: string, glob?: string): Promise<{ path: string; line: number; text: string }[]>
}

/** 工作区只读 git 查询。参数固定，绝不拼 shell。 */
declare const git: {
  /** 自 base（缺省是 HEAD）以来改动过的文件。 */
  changedFiles(base?: string): Promise<string[]>
  /** diff 文本。给了 path 就只看那个文件。 */
  diff(base?: string, path?: string): Promise<string>
  /** 工作区状态。 */
  status(): Promise<{
    branch?: string
    clean: boolean
    staged: string[]
    unstaged: string[]
    untracked: string[]
  }>
  /** 最近的提交。 */
  log(count?: number): Promise<{ hash: string; subject: string; author: string; date: string }[]>
}

/** 执行命令。 */
declare const world: {
  /**
   * 跑一个命令，拿到结果。
   *
   * 命令必须是**字符串字面量**：用户在看到确认窗时就该知道这次 run 会跑哪些命令。
   * 非零退出码是**返回值**而不是异常——想让非零退出变成失败，自己判断 exitCode 再 throw。
   */
  run(
    cmd: string,
    args?: string[],
    opts?: { timeoutMs?: number },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>
}
`
