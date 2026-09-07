// electron-vite 的 bin 在默认 isolated linker 下装在包内 node_modules(符号链接),
// 而 Windows CI 的 bun install 用 --linker hoisted(绕 bun#28147),依赖被提升到仓库根
// node_modules —— 硬编码 ./node_modules/electron-vite/... 的相对路径只有 isolated 布局能命中。
// 这里用 Node 的模块解析从 cwd 向上查找(electron-vite 的 exports 放行 ./package.json),
// 解析出包根再拼 bin 路径,两种布局通吃,dev/build 共用。
import { createRequire } from "node:module"
import { spawn } from "node:child_process"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const mode = process.argv[2] ?? "build"
const heap = mode === "dev" ? 3072 : 4096

const require = createRequire(pathToFileURL(join(process.cwd(), "package.json")))
const pkgPath = require.resolve("electron-vite/package.json")
const binPath = join(pkgPath, "..", "bin", "electron-vite.js")

const child = spawn(
  process.execPath,
  [`--max-old-space-size=${heap}`, binPath, mode, ...process.argv.slice(3)],
  { stdio: "inherit", env: process.env },
)
child.on("exit", (code) => {
  process.exitCode = code ?? 1
})
