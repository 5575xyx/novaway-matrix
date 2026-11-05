# 用 Node 跑开发模式（bun 仍然保留）

仓库的主运行时是 bun。这份文档讲的是**另一条可选的开发路径**：用 Node 加载同一份
TypeScript 源码，不经过 bun 的构建与 `Bun.*` API。两条路径并存，互相不影响。

## 一句话结论

```bash
pnpm install          # 或 bun install
pnpm dev:node         # Node 启动，等价于 pnpm dev 的默认命令
```

`pnpm dev`（bun）与 `pnpm dev:node`（Node）跑的是同一个入口
`packages/novaway/src/index.ts`，行为应当一致。**没有引入第二份源码。**

## 能做什么

| 事项                                                                | bun 路径 | Node 路径                           |
| ------------------------------------------------------------------- | -------- | ----------------------------------- |
| CLI 全部子命令（`serve` / `db` / `run` / `models` / `providers` …） | ✅       | ✅（Node ≥ 22）                     |
| HTTP 服务（桌面端 sidecar 跑的就是这套）                            | ✅       | ✅（Node ≥ 22）                     |
| TUI 界面                                                            | ✅       | ✅（Node ≥ 26.1，需要 `node:ffi`）  |
| 单测（`bun:test`）                                                  | ✅       | ❌ 见「已知限制」                   |
| 打单文件可执行（`build.ts`）                                        | ✅       | ❌ 见「已知限制」                   |

TUI 的门槛来自 `@opentui/core` 的 FFI 后端：它用 `node:ffi` 直接调终端控制库，
而这个模块是 Node 26.1 才进内核的（`@opentui/core` 的 bun 构建走 `bun:ffi`）。
Node 22/24 上 TUI 会启动到一半就崩，CLI 与 HTTP 服务不受影响。

## 它是怎么工作的

三块拼起来，都在 `script/node-dev/` 下，只在这条路径上生效：

### 1. `shims/bun.mjs` — `Bun` 全局的 Node 近似实现

源码里用到 `Bun.file` / `Bun.write` / `Bun.stringWidth` / `Bun.Glob` / `Bun.stdin` /
`Bun.which`，这些在 Node 下没有。shim 用 `node:fs`、`string-width`、`glob` 做出等价物，
只在 Node 路径注入到 `globalThis.Bun`，bun 运行时下完全不参与。

宽度计算用 `string-width`，与 Bun 采用同一套 East Asian Width + emoji 规则（`中文`
= 4 列，ANSI 转义默认不计宽）。

### 2. `loader.mjs` — 让 Node 认得出这份 TS 源码

Node 原生类型剥离处理不了 enums / namespace / 参数属性，也不会补 `.ts` 扩展名、
不认 tsconfig 的 `paths`、不认 `.txt` 里的字符串导入、不认 `with { type: "file" }`。
loader 逐条补上：

| 源码写法                                            | 处理方式                                             |
| --------------------------------------------------- | ---------------------------------------------------- |
| `import { x } from "@/util/iife"`                   | 映射到 `packages/novaway/src/util/iife.ts`           |
| `import { x } from "./foo"`                         | 补 `.ts` / `.tsx` / `/index.ts`（含 `.js` 后缀写法） |
| `import text from "./prompt.txt"`                   | 变成 `export default <文件内容>`                     |
| `import wasm from "./x.wasm" with { type: "file" }` | 变成 `export default <绝对路径>`                     |
| `import { Database } from "bun:sqlite"`             | 换成 `node:sqlite` 包装（含 `db.query()`）           |
| `import { dlopen } from "bun:ffi"`                  | 空实现（只影响 Windows 终端输入模式）                |
| `solid-js` / `solid-js/dist/solid.js` 等入口        | 统一指回同一个文件，见下                             |
| `@parcel/watcher/wrapper` 这类无扩展名子路径        | 退回 CommonJS 解析规则                               |

`.ts` / `.tsx` 由 esbuild 转成 ESM（`target: node22`），保持 import 路径原样不打 bundle。
`.tsx` 例外：它必须走 solid 的编译期转换（`@opentui/solid/scripts/solid-transform.js`），
esbuild 的 `jsx: automatic` 只做运行时 JSX，组件会被重复执行、响应式追踪会乱。

solid 这里还有一个容易踩的点：`solid-js` 的 `node` 条件导出指向 `dist/server.js`（SSR，
没有渲染器和响应式），必须指回 `dist/solid.js`。如果只对裸写的 `solid-js` 做映射，
`@opentui/solid` 内部写死的 `solid-js/dist/solid.js` 仍会解析到依赖树里的另一份拷贝，
于是项目里同时存在两份 solid 核心：`@opentui/solid` 用自己的那份建 context/owner，
业务代码用另一份读，两边模块状态不共享 —— 症状是 `useRenderer()` 抛
`No renderer found`。所以 loader 把 `solid-js` / `solid-js/store` 及其 `dist/*.js`
写法全部归一到仓库根解析出的同一路径。

### 3. `register.mjs` — 入口

```bash
node --import ./script/node-dev/register.mjs packages/novaway/src/index.ts
```

顺序是「先装 `Bun` 全局，再注册 loader，最后过滤两条只在开发期出现的警告」——
很多模块在顶层就调 `Bun.file()`；Node 26 会把 `module.register()` 标成废弃（DEP0205），
`node:ffi` 每次启动也会提醒 experimental，这两条在 TUI 的 alternate-screen 里都会打花画面。
`register()` 换不掉：`registerHooks()` 要求同步钩子，而 TSX 转换用的是 esbuild/babel 的
异步 API。所以只把这两条咽掉，其它警告照 Node 默认格式输出。

## 已知限制

1. **单测跑不了**。835 个测试文件都用 `bun:test`，其中 54 处 `mock.module`、50 处
   `jest.*`、24 个快照。Node 的 `node:test` 没有对应能力，迁移是独立工程。
2. **打不出单文件可执行**。`script/build.ts` 用的是 `Bun.build` 的 `compile` 选项
   （把运行时和源码打成一个可执行文件），Node 生态没有等价物。esbuild 只能顶替其中
   打 PPT worker 的那两处。
3. **TUI 需要 Node ≥ 26.1**。渲染走 `@opentui/core` 的 FFI 后端，Node 22/24 没有
   `node:ffi`，TUI 会在建立渲染器时崩掉（CLI 和 HTTP 服务不受影响）。26.1 起可用，
   启动时的 FFI experimental 提示已被入口过滤。
4. **`--conditions=browser`**。bun 路径用 `--conditions=browser` 选依赖的浏览器构建；
   Node 没有这个开关，用的是默认 `node` 条件。目前只影响 solid-js（已在 loader 里
   手工指回客户端构建），新依赖如果区分条件导出需要注意。
5. **`import.meta.dir`**。bun 专有字段（等于 `import.meta.dirname`）。`packages/script`
   里还在用，不在 CLI 的加载路径上。

## 顺便修掉的一处耦合

`packages/core/src/npm-config.ts` 原来从 CommonJS 包里用具名导入：

```ts
import { definitions, flatten, nerfDarts, shorthands } from "@npmcli/config/lib/definitions/index.js"
```

bun 能静态分析出这些名字，Node 的 CJS 分析器不能，运行时会报
`does not provide an export named`。改成默认导入再解构，两种运行时都能跑。
