/**
 * Node 下加载本仓库 TypeScript 源码的 ESM loader。
 *
 * 只服务于 `script/node-dev/` 这条「用 Node 跑开发模式」的路径；bun 下完全不参与。
 * 做三件事：
 *   1. 补上 Node 不会自动做的扩展名解析（`./x` → `./x.ts`、`./x.tsx`、`./x/index.ts`）
 *     以及 tsconfig 的 `paths` 别名（`@/*`）。
 *   2. 用 esbuild 把 .ts/.tsx 转成 ESM（enums / namespace / 参数属性这些 Node 的
 *      类型剥离处理不了的语法由 esbuild 负责）。
 *   3. 把 bun 专有的模块请求（`bun:sqlite`、`bun:ffi`、`bun:test`）指到 Node 等价物或空实现。
 *
 * JSX：`@opentui/solid` 的 TSX 需要 solid 的编译期转换，esbuild 只能给到
 * `@opentui/solid/jsx-runtime` 的运行时实现。TUI 界面在 Node 下不保证渲染正确，
 * 但模块图能加载起来、命令行与 HTTP 服务可以工作。
 */
import { createRequire } from "node:module"
import { existsSync, statSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.resolve(here, "../..")
const novawayDir = path.join(repoRoot, "packages/novaway")

const JSX_IMPORT_SOURCE = "@opentui/solid"

const CANDIDATES = [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx", ".json"]

function tryFile(base) {
  if (existsSync(base) && statSync(base).isFile()) return base
  for (const ext of CANDIDATES) {
    const candidate = base + ext
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  for (const ext of CANDIDATES) {
    const candidate = path.join(base, "index" + ext)
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** `@/*` → `packages/novaway/src/*`（与 packages/novaway/tsconfig.json 的 paths 一致）。 */
function expandAlias(specifier) {
  if (specifier.startsWith("@/")) return path.join(novawayDir, "src", specifier.slice(2))
  if (specifier.startsWith("@test/")) return path.join(novawayDir, "test", specifier.slice(6))
  return null
}

export async function resolve(specifier, context, nextResolve) {
  // bun: 前缀在 Node 里没有对应物，交给 load 处理成空模块/等价实现。
  if (specifier.startsWith("bun:")) {
    return { url: `novaway-node-shim:${specifier}`, shortCircuit: true }
  }

  const aliased = expandAlias(specifier)
  if (aliased) {
    const hit = tryFile(aliased)
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true }
    throw new Error(`Cannot resolve ${specifier} (aliased to ${aliased})`)
  }

  // 相对/绝对路径的扩展名补全。`.` / `..` 也算相对路径（源码里有 `export * as X from "."`）。
  const relative =
    specifier === "." ||
    specifier === ".." ||
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("/")
  if (relative) {
    const parent = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd()
    const base = path.resolve(parent, specifier)
    const hit = tryFile(base)
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true }
    // .js 后缀写在 import 里、真实文件是 .ts 的 ESM 写法
    if (base.endsWith(".js")) {
      const swapped = tryFile(base.slice(0, -3))
      if (swapped) return { url: pathToFileURL(swapped).href, shortCircuit: true }
    }
  }

  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    // node_modules 里的包有时用无扩展名的子路径（`@parcel/watcher/wrapper`），
    // ESM 解析器不补扩展名。退回 CommonJS 的解析规则再试一次。
    if (error?.code !== "ERR_MODULE_NOT_FOUND" || relative) throw error
    const parent = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd()
    try {
      const require = createRequire(pathToFileURL(path.join(parent, "noop.js")))
      const hit = require.resolve(specifier)
      return { url: pathToFileURL(hit).href, shortCircuit: true }
    } catch {
      throw error
    }
  }
}

const SQLITE_SHIM = `
import { DatabaseSync } from "node:sqlite"
export class Database extends DatabaseSync {
  constructor(filename, options = {}) {
    super(filename, { readOnly: options.readonly === true || options.readOnly === true, readBigInts: false })
  }
  get inTransaction() { return false }
  // bun:sqlite 的便捷 API：db.query(sql) 返回可复用的语句。
  query(sql) {
    const statement = this.prepare(sql)
    return {
      all: (...params) => statement.all(...params),
      get: (...params) => statement.get(...params),
      run: (...params) => statement.run(...params),
      values: (...params) => statement.all(...params).map((row) => Object.values(row)),
      columnNames: statement.columns().map((column) => String(column.name)),
    }
  }
  transaction(fn) {
    return (...args) => {
      this.exec("BEGIN")
      try {
        const out = fn(...args)
        this.exec("COMMIT")
        return out
      } catch (error) {
        this.exec("ROLLBACK")
        throw error
      }
    }
  }
}
export const Statement = undefined
export function serialize() { throw new Error("bun:sqlite serialize() is not available under Node") }
export default Database
`

const FFI_SHIM = `
// bun:ffi 只用于 Windows 终端的输入模式控制。Node 下用 stub，调用方会退化成默认行为。
export function dlopen() {
  return {
    symbols: new Proxy({}, { get: (_, key) => () => 0 }),
    close() {},
  }
}
export const ptr = (value) => value
export const toArrayBuffer = () => new ArrayBuffer(0)
export const CString = () => ""
export default { dlopen, ptr, toArrayBuffer, CString }
`

const EMPTY = `export default {}; export const __novawayStub = true;`

export async function load(url, context, nextLoad) {
  if (url.startsWith("novaway-node-shim:")) {
    const kind = url.slice("novaway-node-shim:".length)
    const source = kind === "bun:sqlite" ? SQLITE_SHIM : kind === "bun:ffi" ? FFI_SHIM : EMPTY
    return { format: "module", source, shortCircuit: true }
  }

  if (url.startsWith("file:")) {
    const file = fileURLToPath(url)
    // bun 允许 `import text from "./x.txt"`（默认导出文件内容），Node 不认识这种扩展名。
    if (/\.(txt|md|sql|html|css|prompt)$/.test(file) && !file.startsWith(path.join(repoRoot, "node_modules"))) {
      const raw = await readFile(file, "utf8")
      return {
        format: "module",
        source: `export default ${JSON.stringify(raw)}`,
        shortCircuit: true,
      }
    }
    // `import wasm from "./x.wasm" with { type: "file" }` 是 bun 的语法，Node 不支持
    // 这个 attribute。bun 的语义是「给我文件路径」，用同样的语义返回字符串。
    if (file.endsWith(".wasm") && context.importAttributes?.type === "file") {
      return {
        format: "module",
        source: `export default ${JSON.stringify(file)}`,
        shortCircuit: true,
      }
    }
    if (/\.(ts|tsx|mts)$/.test(file) && !file.startsWith(path.join(repoRoot, "node_modules"))) {
      const raw = await readFile(file, "utf8")
      const { transform } = await import("esbuild")
      const result = await transform(raw, {
        loader: file.endsWith(".tsx") ? "tsx" : "ts",
        format: "esm",
        target: "node22",
        sourcefile: file,
        sourcemap: "inline",
        jsx: "automatic",
        jsxImportSource: JSX_IMPORT_SOURCE,
        // 保持 import 路径原样，交给上面 resolve 处理；不打成 bundle。
        tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: false } },
      })
      return { format: "module", source: result.code, shortCircuit: true }
    }
  }

  return nextLoad(url, context)
}
