/**
 * TS 标准库的访问入口。
 *
 * 编译走全虚拟 host：脚本、门面声明、标准库全部来自内存。标准库由
 * `script/generate-dwf-libs.ts` 在构建前烘成字符串（`libs.generated.ts`），因此
 * **运行时绝不读 `node_modules`**——这是打包成单文件 CLI 之后仍然能编译的前提。
 *
 * 只暴露 `lib.es2022.d.ts` 的 reference 闭包（57 个文件，约 460 KB）。不引入 DOM：
 * 工作流脚本不该有 `document` / `window` 可用，编译期就该拒绝，而不是等到运行期 ReferenceError。
 */

import { LIB_ENTRY, LIB_FILES, LIB_TYPESCRIPT_VERSION } from "./libs.generated"

/** 一份可用的标准库快照。 */
export interface LibBundle {
  /** 默认 lib 的入口文件名（basename）。 */
  readonly entry: string
  /** 文件名（basename）→ 全文。虚拟 host 只查这张表。 */
  readonly files: ReadonlyMap<string, string>
}

let cached: LibBundle | undefined

/** 取（并缓存）标准库快照。Map 只构造一次：57 个文件的字符串本身是模块级常量，不会重复分配。 */
export function libBundle(): LibBundle {
  if (cached) return cached
  cached = { entry: LIB_ENTRY, files: new Map(Object.entries(LIB_FILES)) }
  return cached
}

/** 生成这份快照时用的 typescript 版本。与运行时 `typescript` 不一致时，编译诊断可能对不上。 */
export function libTypescriptVersion(): string {
  return LIB_TYPESCRIPT_VERSION
}
