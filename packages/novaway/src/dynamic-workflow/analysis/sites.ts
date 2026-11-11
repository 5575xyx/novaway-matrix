/**
 * 从编译好的脚本里收集**站点（site）**：脚本里每一次有身份的 facade 调用。
 *
 * 站点是下游一切的身份证——lowering 按它打桩、journal 按它落行、界面按它点灯、
 * 恢复按它判断「这件事发生过没有」。一次 run 的身份词就是「站点 + 第几次到达」。
 *
 * 两条实现纪律，破坏任何一条都会让整条管线悄悄错位：
 *
 *   1. **是不是 facade 调用，由符号判定，不由名字判定。**
 *      走 checker.getSymbolAtLocation(callee)，看声明是否落在门面声明文件里。不然作者写一个
 *      自己的 agent 函数（很自然：做测试替身）就会被误判成站点。
 *      判定归属之后，名字才从语法里取——那只是**标签**，不是判据。
 *
 *   2. **编号只在 collectSites 里铸造，且只按源码顺序。**
 *      站点 id 进入 journal，跨机器、跨平台、跨 resume 必须稳定。任何「按遍历顺序顺手编号」的
 *      旁路（比如某个辅助分析自己数一遍）都会让同一份脚本在不同入口下拿到不同的 id。
 *
 * 站点的 node 保留的是**原始 ts.Node**。lowering 按节点身份命中，不重新识别一次——重新识别
 * 就多了一个「两边判断不一致」的机会。
 */

import ts from "typescript"
import type { CompileResult, WorkflowDiagnostic } from "../compiler/compile"
import { authorPosition } from "../compiler/compile"
import { WORKFLOW_FACADE_FILE } from "../facade/dts"
import {
  ACTOR_NAME_DUPLICATE,
  FACADE_NOT_DIRECT_CALL,
  PHASE_SITE_INVALID,
  WORLD_RUN_COMMAND_NOT_LITERAL,
} from "./diagnostics"

/** 站点种类。决定它在 journal 里落成哪一类行、在界面上长什么样。 */
export type SiteKind = "actor" | "ask" | "world-read" | "report" | "join" | "fan-out"

/** 门面上的**可调用物**，用 `接口.成员` 或裸函数名的形式标识。 */
export type FacadeTarget =
  | "agent"
  | "Agent.ask"
  | "phase"
  | "log"
  | "report"
  | "files.glob"
  | "files.read"
  | "files.grep"
  | "git.changedFiles"
  | "git.diff"
  | "git.status"
  | "git.log"
  | "world.run"

/** world-read 的 op：跨过边界时用的词，与 files.* / git.* / world.run 一一对应。 */
export type WorldReadOp = "glob" | "read" | "grep" | "git-changed-files" | "git-diff" | "git-status" | "git-log" | "run"

export const WORLD_READ_OPS: Readonly<Record<string, WorldReadOp>> = Object.freeze({
  "files.glob": "glob",
  "files.read": "read",
  "files.grep": "grep",
  "git.changedFiles": "git-changed-files",
  "git.diff": "git-diff",
  "git.status": "git-status",
  "git.log": "git-log",
  "world.run": "run",
})

/** 一个站点。id 形如 ask#3。 */
export interface Site {
  readonly id: string
  readonly kind: SiteKind
  readonly target: FacadeTarget | "Promise.all" | "Promise.allSettled" | "iteration"
  /** world-read 专属：跨边界的 op 词。 */
  readonly op?: WorldReadOp
  /** 作者脚本里的 1-based 位置。 */
  readonly line: number
  readonly column: number
  /**
   * 原始节点。lowering 按它命中。
   *
   * 有 id 的调用站点一定是 CallExpression；`join` / `fan-out` 是展示用的节点，fan-out
   * 由 `for...of` 提升时锚点是循环语句本身，所以这里放宽到 Node。
   */
  readonly node: ts.Node
  /** 词法上所在的阶段（最近一个在前面的 phase 标记）。运行期事件才是权威，这里只供展示。 */
  readonly phase?: string
  /** 若这个站点在 fan-out 体里，指向那个 fan-out 站点。 */
  readonly within?: string
  /** actor 专属：字面量名字。动态名字不填，由运行期决定。 */
  readonly name?: string
  /** world.run 专属：字面量命令。确认窗要在运行前把这些命令列给用户看。 */
  readonly command?: string
}

/** 收集结果。 */
export interface SiteTable {
  readonly sites: readonly Site[]
  /** 按源码顺序的全部站点 id。harness 用它断言 lowered 脚本没有多/少站点。 */
  readonly siteIds: readonly string[]
  /** phase 出现过的名字，按首次出现顺序去重。确认窗要展示它。 */
  readonly phaseNames: readonly string[]
  readonly diagnostics: readonly WorkflowDiagnostic[]
}

/** Array 上会把回调对每个元素调一次的方法。命中且回调体内有站点，就提升为 fan-out。 */
const ITERATION_METHODS = new Set(["map", "flatMap", "forEach", "filter", "some", "every", "find", "reduce"])

/**
 * 判断一个调用是不是门面调用，返回门面目标（如 Agent.ask / files.glob），或 undefined。
 *
 * 判据是**符号的声明文件**，不是文本。导出给 lowering 用：打桩与分析必须是**同一个判断**，
 * 两边各写一份迟早会分叉——那种分叉的表现是「分析说有站点，打桩没打」，运行期才炸。
 */
export function facadeTargetOf(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
  facade: ts.SourceFile,
): FacadeTarget | undefined {
  const symbol = checker.getSymbolAtLocation(call.expression)
  if (!symbol) return undefined
  const declarations = symbol.getDeclarations() ?? []
  if (!declarations.some((declaration) => declaration.getSourceFile() === facade)) return undefined

  const declaration = declarations[0]!
  // 方法签名（Agent.ask、files.glob）：前缀由所属接口或属性访问的接收者决定。
  if (ts.isMethodSignature(declaration)) {
    const parent = declaration.parent
    if (ts.isInterfaceDeclaration(parent)) {
      return `${parent.name.text}.${declaration.name.getText()}` as FacadeTarget
    }
    // files / git / world 是 declare const x: { … }：前缀取属性访问的接收者。
    const expression = call.expression
    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
      return `${expression.expression.text}.${declaration.name.getText()}` as FacadeTarget
    }
    return undefined
  }
  // 函数声明（agent / phase / log / report）。
  if (ts.isFunctionDeclaration(declaration)) {
    const name = declaration.name?.text
    return name ? (name as FacadeTarget) : undefined
  }
  return undefined
}

/** 名字是不是一个 facade 的**值**符号（用于 9001 判定）。args 是唯一允许自由读取的。 */
function facadeValueOf(checker: ts.TypeChecker, node: ts.Node, facade: ts.SourceFile): string | undefined {
  const symbol = checker.getSymbolAtLocation(node)
  if (!symbol) return undefined
  if (!(symbol.flags & ts.SymbolFlags.Value)) return undefined
  const declarations = symbol.getDeclarations() ?? []
  if (!declarations.some((declaration) => declaration.getSourceFile() === facade)) return undefined
  return symbol.getName()
}

/** 认 Promise.all / Promise.allSettled：两者都是语言内建，按名字认是安全的。 */
function promiseJoinOf(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
): "Promise.all" | "Promise.allSettled" | undefined {
  const expression = call.expression
  if (!ts.isPropertyAccessExpression(expression)) return undefined
  const name = expression.name.text
  if (name !== "all" && name !== "allSettled") return undefined
  const symbol = checker.getSymbolAtLocation(expression.expression)
  // 必须真的是全局 Promise 构造器，不能是作者自己的同名对象。
  if (!symbol || symbol.getName() !== "Promise") return undefined
  const declarations = symbol.getDeclarations() ?? []
  const isLib = declarations.some((declaration) => /^lib\..*\.d\.ts$/.test(declaration.getSourceFile().fileName))
  return isLib ? (`Promise.${name}` as "Promise.all" | "Promise.allSettled") : undefined
}

/** 认 Array 上对每个元素调用一次回调的方法。 */
function iterationCallOf(call: ts.CallExpression): boolean {
  const expression = call.expression
  if (!ts.isPropertyAccessExpression(expression)) return false
  return ITERATION_METHODS.has(expression.name.text)
}

/** 一个语句是不是独立的 phase 标记。返回名字，或一句诊断。 */
function standalonePhaseOf(
  checker: ts.TypeChecker,
  statement: ts.Statement,
  facade: ts.SourceFile,
): { name?: string; message?: string } | undefined {
  if (!ts.isExpressionStatement(statement)) return undefined
  const expression = statement.expression
  if (!ts.isCallExpression(expression)) return undefined
  if (facadeTargetOf(checker, expression, facade) !== "phase") return undefined
  const argument = expression.arguments[0]
  if (!argument || !ts.isStringLiteralLike(argument) || argument.text.trim() === "") {
    return { message: 'phase() 需要一个非空的字面量名字，例如 phase("收集改动")。' }
  }
  return { name: argument.text.trim() }
}

/** 字面量名字（字符串字面量，或无插值的模板串）。 */
function literalActorName(call: ts.CallExpression): { text: string; node: ts.Node } | undefined {
  const argument = call.arguments[0]
  if (!argument) return undefined
  if (ts.isStringLiteralLike(argument)) {
    const text = argument.text.trim()
    return text === "" ? undefined : { text, node: argument }
  }
  return undefined
}

class Collector {
  readonly sites: Site[] = []
  readonly diagnostics: WorkflowDiagnostic[] = []
  readonly phaseNames: string[] = []
  readonly counters = new Map<SiteKind, number>()
  readonly actorNames = new Map<string, ts.Node>()

  constructor(
    private readonly checker: ts.TypeChecker,
    private readonly facade: ts.SourceFile,
  ) {}

  mint(kind: SiteKind): string {
    const next = (this.counters.get(kind) ?? 0) + 1
    this.counters.set(kind, next)
    return `${kind}#${next}`
  }

  report(node: ts.Node, code: number, message: string) {
    const position = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart())
    const author = authorPosition(position.line + 1, position.character + 1)
    this.diagnostics.push({ code, message, line: author.line, column: author.column })
  }

  /** 走一遍节点树：记站点、追踪词法阶段、顺手做 9003 / 9004 / 9005。 */
  walk(node: ts.Node, phase: string | undefined, within: string | undefined) {
    if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseClause(node)) {
      let current = phase
      for (const statement of node.statements) current = this.statement(statement, current, within)
      return
    }
    if (ts.isCallExpression(node)) {
      // call() 自己负责下沉到子节点：walk 不再遍历一遍，否则同一个子树会被访问两次。
      this.call(node, phase, within)
      return
    }
    // 循环体里有站点：这是「同一个站点会被到达很多次」的另一种写法（顺序版）。
    // 循环头（被迭代的表达式）照常走，只有循环体带 within。
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      const body = node.statement
      if (this.containsSite(body)) {
        const id = this.mint("fan-out")
        const position = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart())
        const author = authorPosition(position.line + 1, position.character + 1)
        this.sites.push({
          id,
          kind: "fan-out",
          target: "iteration",
          line: author.line,
          column: author.column,
          node,
          phase,
          within,
        })
        ts.forEachChild(node, (child) => this.walk(child, phase, child === body ? id : within))
        return
      }
    }
    ts.forEachChild(node, (child) => this.walk(child, phase, within))
  }

  /** 处理一个语句，返回**它之后**兄弟语句所处的阶段。 */
  private statement(node: ts.Statement, phase: string | undefined, within: string | undefined): string | undefined {
    const marked = standalonePhaseOf(this.checker, node, this.facade)
    if (marked) {
      if (marked.message) {
        this.report(node, PHASE_SITE_INVALID, marked.message)
        return phase
      }
      if (!this.phaseNames.includes(marked.name!)) this.phaseNames.push(marked.name!)
      // 不下沉：独立成句的 phase 标记不产生站点，下沉只会让 call() 把它误判成「写在表达式里」。
      return marked.name
    }
    this.walk(node, phase, within)
    return phase
  }

  private call(node: ts.CallExpression, phase: string | undefined, within: string | undefined) {
    const position = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart())
    const author = authorPosition(position.line + 1, position.character + 1)
    const base = { line: author.line, column: author.column, node, phase, within } as const

    const join = promiseJoinOf(this.checker, node)
    if (join) {
      this.sites.push({ ...base, kind: "join", id: this.mint("join"), target: join })
      ts.forEachChild(node, (child) => this.walk(child, phase, within))
      return
    }

    const target = facadeTargetOf(this.checker, node, this.facade)
    if (!target) {
      // 迭代方法：回调体里有站点就提升成 fan-out，其后代站点带上 within。
      if (iterationCallOf(node)) {
        const callback = node.arguments[0]
        if (callback && this.containsSite(callback)) {
          const id = this.mint("fan-out")
          this.sites.push({ ...base, kind: "fan-out", id, target: "iteration" })
          ts.forEachChild(node, (child) => this.walk(child, phase, child === callback ? id : within))
          return
        }
      }
      ts.forEachChild(node, (child) => this.walk(child, phase, within))
      return
    }

    switch (target) {
      case "agent": {
        const id = this.mint("actor")
        const name = literalActorName(node)
        if (name) {
          if (this.actorNames.has(name.text)) {
            this.report(
              name.node,
              ACTOR_NAME_DUPLICATE,
              `agent("${name.text}") 这个名字已经用过了。同一个 run 里子代理的名字必须唯一——重名会让日志、界面和后续复用都对不上号。换个名字，或者干脆不给名字。`,
            )
          } else {
            this.actorNames.set(name.text, name.node)
          }
        }
        this.sites.push({ ...base, kind: "actor", id, target, ...(name ? { name: name.text } : {}) })
        break
      }
      case "Agent.ask":
        this.sites.push({ ...base, kind: "ask", id: this.mint("ask"), target })
        break
      case "report":
        this.sites.push({ ...base, kind: "report", id: this.mint("report"), target })
        break
      case "log":
        // 旁白，没有身份。
        break
      case "phase":
        // 走到这里说明 phase 写在表达式里而不是独立成句。
        this.report(
          node,
          PHASE_SITE_INVALID,
          "phase() 要独立成一句话，不要写在表达式里——它标记的是「从这里开始进入哪个阶段」。",
        )
        break
      default: {
        const op = WORLD_READ_OPS[target]
        if (!op) break
        let command: string | undefined
        if (target === "world.run") {
          const argument = node.arguments[0]
          if (!argument || !ts.isStringLiteralLike(argument)) {
            this.report(
              node,
              WORLD_RUN_COMMAND_NOT_LITERAL,
              "world.run 的命令必须是字符串字面量：用户在确认窗里要看到这次 run 会跑哪些命令。命令写成直接的字面量，参数放第二个参数。",
            )
          } else {
            command = argument.text
          }
        }
        this.sites.push({ ...base, kind: "world-read", id: this.mint("world-read"), target, op, command })
        break
      }
    }

    ts.forEachChild(node, (child) => this.walk(child, phase, within))
  }

  /** 子树里有没有 facade 调用。v1 只看字面可见的部分，不追跨函数调用链。 */
  private containsSite(root: ts.Node): boolean {
    let found = false
    const visit = (node: ts.Node) => {
      if (found) return
      if (ts.isCallExpression(node)) {
        const target = facadeTargetOf(this.checker, node, this.facade)
        // log / phase 没有身份，单靠它们不足以把循环提升成 fan-out。
        if (target && target !== "log" && target !== "phase") {
          found = true
          return
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(root)
    return found
  }
}

/**
 * 收集站点。纯函数：同样的编译结果进去，同样的站点表出来（顺序、编号、诊断都稳定）。
 */
export function collectSites(compiled: CompileResult): SiteTable {
  const facade = compiled.program.getSourceFile(WORKFLOW_FACADE_FILE)!
  const collector = new Collector(compiled.checker, facade)
  collector.walk(compiled.sourceFile, undefined, undefined)
  collectIndirectFacadeUses(compiled, facade, collector)

  const sites = collector.sites
  return {
    sites,
    siteIds: sites.map((site) => site.id),
    phaseNames: collector.phaseNames,
    diagnostics: collector.diagnostics.sort((a, b) => a.line - b.line || a.column - b.column),
  }
}

/**
 * 9001：const f = agent、const g = files.glob、const a = agent("x").ask 之类。
 *
 * 为什么必须拒：站点是**调用点**的身份。把可调用物存进变量再调用，调用点就不再对应脚本里的
 * 某个位置，journal 也就没有东西可记——恢复时无法回答「这件事发生过没有」。所以门面只支持
 * 直接调用这种写法，而这条规则要在编译期说清楚，不能让作者在运行期撞见一个莫名其妙的 id。
 */
function collectIndirectFacadeUses(compiled: CompileResult, facade: ts.SourceFile, collector: Collector) {
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      // 只报**链根**：`const g = files.glob` 该报一次（files），不是两次（files + glob）。
      // 属性访问的名字一定有一个更靠左的链根，交给那次报告即可。
      const isMemberName = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node
      const name = isMemberName ? undefined : facadeValueOf(compiled.checker, node, facade)
      if (name && name !== "args" && !isDirectCallCallee(node)) {
        collector.report(
          node,
          FACADE_NOT_DIRECT_CALL,
          `${name} 只能直接调用，不能存进变量再用。工作流按调用点记账，所以 agent(...).ask(...)、files.glob(...) 这样的写法要连着写；要在循环里复用，就每次重新写一遍调用。`,
        )
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(compiled.sourceFile)
}

/**
 * 这个标识符是否处在「直接调用」链上：它自己就是 callee，或它是 callee 的属性访问链的根。
 *
 *   agent("x")         → agent  ✓
 *   files.glob("p")    → files  ✓（链根，整条链是 callee）
 *   agent("x").ask(m)  → agent  ✓
 *   const g = files.glob → files ✗
 */
function isDirectCallCallee(node: ts.Node): boolean {
  let current: ts.Node = node
  // 自己若是属性访问的**名字**（git.changedFiles 里的 changedFiles），先上移到整个属性访问。
  if (ts.isPropertyAccessExpression(current.parent) && current.parent.name === current) current = current.parent
  // 一路向上走「callee 链」：属性访问 → 调用 → 它的属性访问 → ……
  // 只有链条顶端是调用时才成立——`const a = agent("x").ask` 的链顶是赋值，所以不成立。
  for (;;) {
    const parent = current.parent
    if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === current) {
      current = parent
      continue
    }
    if (parent && (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === current) {
      const above = parent.parent
      if (above && ts.isPropertyAccessExpression(above) && above.expression === parent) {
        current = above
        continue
      }
      return true
    }
    return false
  }
}
