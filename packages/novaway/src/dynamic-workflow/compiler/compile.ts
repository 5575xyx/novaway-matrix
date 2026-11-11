/**
 * 工作流脚本的**编译期检查**。
 *
 * 一个模型写的脚本在跑起来之前必须先过这一关：语法、类型、门面用法。它不做任何 I/O，
 * 不 spawn 任何东西，不碰磁盘——把 `scriptText` 交进来，拿回诊断和（干净的）程序。
 *
 * 为什么值得做这一层：模型写 TypeScript 时最常犯的错是「拼错成员名」「把 Promise 当值用」
 * 「`ask<T>` 的 T 里有函数」。这些在运行期要么静默产出垃圾（子代理拿到半截指令），要么
 * 在沙箱里炸成一个看不懂的栈。编译期把它们变成 `L12:C5` 的句子，模型自己就能改。
 *
 * 虚拟 host 的由来（见 `libs.ts`）：打包成单文件 CLI 之后磁盘上没有 `node_modules`。
 * 所以脚本、门面声明、标准库全部从内存取；`fileExists` 只认这张表，任何未登记的文件
 * 一律当作不存在——包括 `node:fs`、`@/core` 之类，作者脚本 import 不了任何东西。
 */

import ts from "typescript"
import {
  WORKFLOW_FACADE_DTS,
  WORKFLOW_FACADE_FILE,
  WORKFLOW_SCRIPT_EPILOGUE,
  WORKFLOW_SCRIPT_FILE,
  WORKFLOW_SCRIPT_PRELUDE,
  WORKFLOW_SCRIPT_PRELUDE_LINES,
} from "../facade/dts"
import { libBundle } from "./libs"

/** 一条**面向作者**的诊断。行列是作者脚本里的 1-based 坐标，不是包了前缀的虚拟文件坐标。 */
export interface WorkflowDiagnostic {
  /** TS 的 diagnostic code；analyzer 自造的码从 9001 起。 */
  readonly code: number
  readonly message: string
  readonly line: number
  readonly column: number
}

/** 编译结果。`diagnostics` 非空时 `ok === false`，但 `program` 仍然可用（测试与增量分析要用）。 */
export interface CompileResult {
  readonly ok: boolean
  readonly diagnostics: readonly WorkflowDiagnostic[]
  readonly program: ts.Program
  readonly checker: ts.TypeChecker
  /** 包了前缀的虚拟源文件。作者坐标 = 本文件坐标减去前缀行数。 */
  readonly sourceFile: ts.SourceFile
}

/**
 * 编译选项。**故意与作者在编辑器里的默认设置不同**：
 *   - `noUncheckedIndexedAccess: false`：模型写 TS 时默认它是关的。开着会让 `items[i]` 成为
 *     这类脚本最大的编译失败源，而它挡住的 bug 在工作流脚本里几乎不存在（脚本短、数据形状已知）。
 *   - `types: []`：没有任何 ambient 全局。`process` / `fetch` / `require` / `Buffer` 在编译期
 *     就失败，而不是在沙箱里变成一次 ReferenceError。
 *   - `lib: [LIB_ENTRY]`：只有 ES2022。没有 DOM。
 */
function compilerOptions(): ts.CompilerOptions {
  return {
    allowJs: false,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    lib: [libBundle().entry],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    noUncheckedIndexedAccess: false,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    types: [],
  }
}

/** 虚拟文件系统里的全部文件，键是 basename。 */
function virtualFiles(scriptText: string): Map<string, string> {
  const files = new Map(libBundle().files)
  files.set(WORKFLOW_FACADE_FILE, WORKFLOW_FACADE_DTS)
  files.set(WORKFLOW_SCRIPT_FILE, `${WORKFLOW_SCRIPT_PRELUDE}${scriptText}${WORKFLOW_SCRIPT_EPILOGUE}`)
  return files
}

/**
 * 建虚拟 host。
 *
 * 所有路径按 **basename** 归一：TS 在内部的默认库路径上会拼目录（`/lib.es2022.d.ts`、
 * `<cwd>/lib.es2022.d.ts`），而闭包里每个文件名都是唯一的，归一之后无论它拼出什么都能命中。
 * 同理，`/// <reference path="lib.es5.d.ts" />` 的相对解析也会落回 basename。
 */
function createVirtualHost(files: ReadonlyMap<string, string>): ts.CompilerHost {
  const host: ts.CompilerHost = {
    getSourceFile(fileName, languageVersion) {
      const name = baseName(fileName)
      const text = files.get(name)
      if (text === undefined) return undefined
      // 用 basename 建源文件：`/// <reference path>` 的相对解析起点因此是空目录，落点正好
      // 又是一个 basename——不用再猜 TS 从哪个目录开始拼。
      return ts.createSourceFile(name, text, languageVersion, /* setParentNodes */ true)
    },
    getDefaultLibFileName: () => libBundle().entry,
    getDefaultLibLocation: () => "",
    writeFile: () => {},
    getCurrentDirectory: () => "",
    getCanonicalFileName: (fileName) => fileName,
    // 大小写敏感**恒为真**：两个平台必须给出同一组文件名，否则同一份脚本在 Windows 与
    // Linux 上的诊断顺序可能不同，resume 的 scriptHash 也就失去了跨平台意义。
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (fileName) => files.has(baseName(fileName)),
    readFile: (fileName) => files.get(baseName(fileName)),
    directoryExists: () => false,
    getDirectories: () => [],
  }
  return host
}

function baseName(fileName: string): string {
  const at = Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\"))
  return at === -1 ? fileName : fileName.slice(at + 1)
}

/**
 * 把虚拟文件的行号还原成作者脚本的行号。
 *
 * 前缀是一整行，所以作者的第 N 行 = 虚拟文件的第 N + 前缀行数 行；列不变。
 * 落在前缀里的诊断（理论上不会有）夹到 1。
 */
export function authorPosition(line: number, column: number): { line: number; column: number } {
  return { line: Math.max(1, line - WORKFLOW_SCRIPT_PRELUDE_LINES), column }
}

function toDiagnostic(diagnostic: ts.Diagnostic): WorkflowDiagnostic {
  const position =
    diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : undefined
  const author = position ? authorPosition(position.line + 1, position.character + 1) : { line: 1, column: 1 }
  return {
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    line: author.line,
    column: author.column,
  }
}

/**
 * 编译一段脚本，拿回诊断与程序。
 *
 * 只报告**脚本自己**的诊断：标准库与门面声明里的噪音（`skipLibCheck` 已挡掉大部分）不该
 * 出现在模型眼前——它改不了那些文件，看到只会浪费一轮。
 */
export function compileScript(scriptText: string): CompileResult {
  const files = virtualFiles(scriptText)
  const host = createVirtualHost(files)
  const program = ts.createProgram({
    rootNames: [WORKFLOW_SCRIPT_FILE, WORKFLOW_FACADE_FILE],
    options: compilerOptions(),
    host,
  })
  const checker = program.getTypeChecker()
  const sourceFile = program.getSourceFile(WORKFLOW_SCRIPT_FILE)!

  const raw = [...program.getSyntacticDiagnostics(sourceFile), ...program.getSemanticDiagnostics(sourceFile)]
  // 诊断可能重复（同一个节点在语法与语义两趟里各报一次），按 位置+码 去重，保序。
  const seen = new Set<string>()
  const diagnostics: WorkflowDiagnostic[] = []
  for (const diagnostic of raw.sort((a, b) => (a.start ?? 0) - (b.start ?? 0))) {
    const next = toDiagnostic(diagnostic)
    const key = `${next.line}:${next.column}:${next.code}`
    if (seen.has(key)) continue
    seen.add(key)
    diagnostics.push(next)
  }

  return { ok: diagnostics.length === 0, diagnostics, program, checker, sourceFile }
}

/**
 * 把诊断渲染成回给模型的一段文本。
 *
 * 形如：
 *
 *   工作流脚本有 2 处错误：
 *   L12:C5 类型 "string" 的参数不能赋给类型 "number" 的参数。
 *   L20:C3 找不到名称 "fetch"。
 *
 * 位置在前、消息在后，是为了让模型一眼定位；不用 TS 自己的 `error TS2304:` 前缀，
 * 因为模型容易把它当成需要解释的行话。
 */
export function formatDiagnostics(diagnostics: readonly WorkflowDiagnostic[]): string {
  if (diagnostics.length === 0) return ""
  const lines = diagnostics.map((item) => `L${item.line}:C${item.column} ${item.message}`)
  return `工作流脚本有 ${diagnostics.length} 处错误：\n${lines.join("\n")}`
}
