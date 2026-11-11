/**
 * 把作者写的脚本降级成沙箱里能跑的函数体。
 *
 * 两趟：
 *   1. **打桩**：站点表里每一个 facade 调用，按其 ts.Node **身份**替换成 `__host.*`。类型还原样留着，
 *      这一趟只做文本替换，不解析、不重排——注释、空行、作者的行序都保住。
 *   2. **擦类型**：`ts.transpileModule` 把 TS 擦成 ES2022。作者写的 interface / as / 泛型参数
 *      到这一步全部消失，产物里只剩能直接丢进 vm 的 JS。
 *
 * 产物只有一个自由标识符：`__host`。这条不变量由测试真的编译一遍来守——「只剩 __host」是
 * 沙箱成立的前提（cell 里没有别的全局），漏掉一个 agent( 就会在运行期变成一次 ReferenceError，
 * 而那时用户已经批准、子进程已经起了。
 *
 * 为什么按节点身份而不是重新扫描文本：重新扫描就多了一个「分析与 lowering 判断不一致」的
 * 机会，而站点 id 一旦错位，journal 就会把两次执行记成同一件事。判据只有一份：
 * `analysis/sites.ts` 的 facadeTargetOf。
 */

import ts from "typescript"
import type { CompileResult } from "../compiler/compile"
import { facadeTargetOf, type Site, type SiteTable } from "../analysis/sites"
import { WORKFLOW_FACADE_FILE, WORKFLOW_SCRIPT_EPILOGUE, WORKFLOW_SCRIPT_PRELUDE } from "../facade/dts"

/** 降级产物。 */
export interface LoweredWorkflow {
  /** 可以直接当 async 函数体用的 JS。唯一自由标识符是 __host。 */
  readonly code: string
  /** 产物里出现过的站点 id，按首次出现（也就是文本）顺序。harness 拿它和站点表对账。 */
  readonly siteIds: readonly string[]
}

/** 在 cell 里构造的宿主绑定名。与 child 源码里的 `__host` 是同一个词。 */
const HOST = "__host"

/**
 * 打桩器：按 AST 递归重写文本。
 *
 * 每层都「切片 + 递归 + 切片」拼回去，所以**没有站点的地方逐字节不变**——注释与空行原样
 * 保留，diff 出来只剩下真正被改写的那几行。看着比「整棵重印」笨，但它不会因为格式器的
 * 某个怪癖而改掉作者的代码。
 */
class Rewriter {
  private readonly sites = new Map<ts.Node, Site>()
  private readonly text: string
  private readonly facade: ts.SourceFile
  private readonly emitted: string[] = []

  constructor(
    private readonly compiled: CompileResult,
    table: SiteTable,
    /** 作者脚本原文（没有前后缀）。 */
    scriptText: string,
  ) {
    // 节点偏移量来自**包了前后缀**的虚拟文件，所以切片也必须在同一份文本上做。
    // 拿作者原文直接切会把每一处替换都错位一个前缀长度——注意，是完全不报错的那种错。
    this.text = WORKFLOW_SCRIPT_PRELUDE + scriptText + WORKFLOW_SCRIPT_EPILOGUE
    for (const site of table.sites) {
      // join / fan-out 是**展示**用的节点，没有要改写的调用文本；留给递归照常穿过。
      if (site.kind === "join" || site.kind === "fan-out") continue
      this.sites.set(site.node, site)
    }
    this.facade = compiled.program.getSourceFile(WORKFLOW_FACADE_FILE)!
  }

  run(): LoweredWorkflow {
    const printed = this.print(this.compiled.sourceFile)
    // 剥掉包脚本用的前后缀，只留作者自己的函数体。
    const body = printed.slice(WORKFLOW_SCRIPT_PRELUDE.length, printed.length - WORKFLOW_SCRIPT_EPILOGUE.length)
    return { code: this.transpile(body), siteIds: this.emitted }
  }

  private print(node: ts.Node): string {
    if (ts.isCallExpression(node)) {
      const site = this.sites.get(node)
      if (site) return this.renderSite(site)
      // log / phase 没有身份（不落 journal、不分配 id），但仍要过线。
      const target = facadeTargetOf(this.compiled.checker, node, this.facade)
      if (target === "log") return `${HOST}.log(${this.printOrNull(node.arguments[0])})`
      if (target === "phase") return `${HOST}.enterPhase(${this.printOrNull(node.arguments[0])})`
    }
    // args 是门面 const：读它必须变成 __host.args。
    if (ts.isIdentifier(node) && this.isFacadeArgs(node)) return `${HOST}.args`

    const children = node.getChildren()
    if (children.length === 0) return this.text.slice(node.getStart(), node.getEnd())
    let out = ""
    let cursor = node.getStart()
    for (const child of children) {
      out += this.text.slice(cursor, child.getStart())
      out += this.print(child)
      cursor = child.getEnd()
    }
    out += this.text.slice(cursor, node.getEnd())
    return out
  }

  private printOrNull(node: ts.Expression | undefined): string {
    return node ? this.print(node) : '""'
  }

  /**
   * 与 analyzer 同一套判据：符号的声明落在门面文件里，且名字是 args。
   * 用符号而不是文本，是为了让作者自己声明的 args（遮蔽）仍然按他自己的语义走。
   */
  private isFacadeArgs(node: ts.Identifier): boolean {
    const symbol = this.compiled.checker.getSymbolAtLocation(node)
    if (!symbol || symbol.getName() !== "args") return false
    const declarations = symbol.getDeclarations() ?? []
    return declarations.some((declaration) => declaration.getSourceFile() === this.facade)
  }

  /** 一个站点的替换文本。实参用 `print` 递归重写，所以嵌套站点（agent().ask()）也对。 */
  private renderSite(site: Site): string {
    // 只有带 id 的调用站点会走到这里；join / fan-out 在构造时就排除了，所以这个断言恒成立。
    const call = site.node as ts.CallExpression
    const args = call.arguments.map((argument) => this.print(argument))
    switch (site.target) {
      case "agent":
        // agent(name?, persona?) —— 缺席的实参直接不写，让默认值生效。
        return this.emit(site, `${HOST}.createActor(${[JSON.stringify(site.id), ...args].join(", ")})`)
      case "Agent.ask": {
        const receiver = ts.isPropertyAccessExpression(call.expression)
          ? this.print(call.expression.expression)
          : "undefined"
        return this.emit(site, `${HOST}.ask(${[JSON.stringify(site.id), receiver, ...args].join(", ")})`)
      }
      case "report":
        return this.emit(site, `${HOST}.report(${[JSON.stringify(site.id), ...args].join(", ")})`)
      default: {
        // world-read：位置实参数组原样过线，元数与校验归 driver。
        const op = site.op
        if (!op) return this.text.slice(call.getStart(), call.getEnd())
        return this.emit(
          site,
          `${HOST}.worldRead(${[JSON.stringify(site.id), JSON.stringify(op), `[${args.join(", ")}]`].join(", ")})`,
        )
      }
    }
  }

  private emit(site: Site, text: string): string {
    this.emitted.push(site.id)
    return text
  }

  /** 擦类型。transpileModule 不做类型检查（已经查过了），只负责把 TS 变成 JS。 */
  private transpile(source: string): string {
    const output = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        removeComments: false,
      },
      fileName: "workflow-script.ts",
    })
    return output.outputText
  }
}

/**
 * 降级。纯函数：编译结果 + 站点表 + 原文进去，JS 出来。
 *
 * `compiled` 必须与 `table` 出自同一份 `scriptText`——传错的话节点身份对不上，打桩会静默失效。
 */
export function lower(compiled: CompileResult, table: SiteTable, scriptText: string): LoweredWorkflow {
  return new Rewriter(compiled, table, scriptText).run()
}
