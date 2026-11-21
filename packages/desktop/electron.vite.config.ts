import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "electron-vite"
import appPlugin from "@novaway/app/vite"
import * as fs from "node:fs/promises"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import os from "node:os"

const channel = (() => {
  const raw = process.env.NOVAWAY_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

function loadModelsDevSnapshot(): string {
  const cacheDir = path.join(os.homedir(), ".cache", "novaway")
  const cachePath = path.join(cacheDir, "models.json")
  try {
    const raw = readFileSync(cachePath, "utf-8")
    JSON.parse(raw)
    return raw
  } catch {
    return "{}"
  }
}

const NOVAWAY_MODELS_DEV = loadModelsDevSnapshot()

/**
 * electron-vite 内置的 `vite:esm-shim` 会在 chunk 里找「最后一个 import 声明」并把
 * CommonJS shim 插进去 —— 它用的是正则，模板字符串里出现 import … from "…" 也会命中。
 * sidecar bundle 有 39 MB、带内置技能提示词和示例代码，命中点一旦落在双引号字符串
 * 中间，就会产出 `Unterminated string literal`，构建直接失败。
 *
 * 这里用与它**逐字相同**的 shim 文本先插到 chunk 开头：它随后 `code.includes(shim)`
 * 检查会命中并跳过，位置也永远合法。文本必须与 electron-vite 的
 * `CJSShim_normal` / `CJSShim_node_20_11` 保持一致（含首尾换行）。
 */
const CJS_SHIM = (() => {
  const require = createRequire(import.meta.url)
  const modern = (() => {
    try {
      const entry = require.resolve("electron")
      const pkg = readFileSync(path.join(path.dirname(entry), "package.json"), "utf8")
      return Number(JSON.parse(pkg).version.split(".")[0] || 0) >= 30
    } catch {
      return true
    }
  })()
  return modern
    ? `
// -- CommonJS Shims --
import __cjs_mod__ from 'node:module';
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require = __cjs_mod__.createRequire(import.meta.url);
`
    : `
// -- CommonJS Shims --
import __cjs_url__ from 'node:url';
import __cjs_path__ from 'node:path';
import __cjs_mod__ from 'node:module';
const __filename = __cjs_url__.fileURLToPath(import.meta.url);
const __dirname = __cjs_path__.dirname(__filename);
const require = __cjs_mod__.createRequire(import.meta.url);
`
})()

const CJS_SYNTAX = /__filename|__dirname|require\(|require\.resolve\(/

const NOVAWAY_SERVER_DIST = "../novaway/dist/node"
const NOVAWAY_MIGRATION_DIR = "../novaway/migration"

// CI 在 arm64 mac 上交叉打 x64 包时(prebuild 同款环境变量),pty 原生模块要按目标
// 架构 externalize,而不是按构建机自身架构,否则 x64 包里会找不到 arm64 的预编译模块。
const desktopArch = process.env.NOVAWAY_DESKTOP_NODE_ARCH ?? process.arch
const nodePtyPkg = `@lydell/node-pty-${process.platform}-${desktopArch}`

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./out/renderer/**",
          filesToDeleteAfterUpload: "./out/renderer/**/*.map",
        },
      })
    : false

const migrations = await loadMigrations()

export default defineConfig({
  main: {
    define: {
      "import.meta.env.NOVAWAY_CHANNEL": JSON.stringify(channel),
      NOVAWAY_CHANNEL: JSON.stringify(channel),
      NOVAWAY_MIGRATIONS: JSON.stringify(migrations),
      NOVAWAY_MODELS_DEV: NOVAWAY_MODELS_DEV,
    },
    build: {
      rollupOptions: {
        input: {
          index: "src/main/index.ts",
          sidecar: "src/main/sidecar.ts",
        },
      },
      // Workspace packages expose TypeScript source files. Leaving @novaway/core
      // external makes the packaged Electron runtime resolve those .ts exports from
      // app.asar/node_modules, where Node cannot type-strip files under node_modules.
      // Bundle it into the main process instead; native node-pty remains external.
      externalizeDeps: { exclude: ["@novaway/core"], include: [nodePtyPkg] },
    },
    plugins: [
      {
        // electron-vite 自带的 vite:esm-shim 用正则找「最后一个 import 声明」,
        // 再把 CommonJS shim 插到那个位置。sidecar 是 39 MB 的单文件 bundle
        // (内置技能提示词里有大段示例代码), 正则会把字符串里的 `import ...`
        // 当成真 import —— 一旦命中点在双引号字符串中间, 插进去就是
        // "Unterminated string literal", 整个桌面端构建失败。
        // 这里先自己把 shim 放到 chunk 开头(位置确定、永远合法);
        // vite:esm-shim 看到 code 里已经有同样的 shim 文本就会直接跳过。
        name: "novaway:cjs-shim",
        enforce: "pre",
        renderChunk(code, _chunk, options) {
          if (options.format !== "es") return null
          if (!CJS_SYNTAX.test(code)) return null
          if (code.includes(CJS_SHIM)) return null
          return { code: CJS_SHIM + code, map: null }
        },
      },
      {
        name: "novaway:node-pty-narrower",
        enforce: "pre",
        resolveId(s) {
          if (s === "@lydell/node-pty") return nodePtyPkg
        },
      },
      {
        name: "novaway:virtual-server-module",
        enforce: "pre",
        resolveId(id) {
          if (id === "virtual:novaway-server") return this.resolve(`${NOVAWAY_SERVER_DIST}/node.js`)
        },
      },
      {
        name: "novaway:copy-server-assets",
        async writeBundle() {
          // The Node server bundle uses Bun's `with { type: "file" }` imports for
          // built-in skill references and other runtime assets. Once the server is
          // embedded into Electron, those relative imports resolve beside the
          // generated main-process chunks, not beside the original novaway/dist
          // directory. Copy every non-JS server asset so packaged Desktop has the
          // same runtime resource set as the standalone server bundle.
          const target = "./out/main/chunks"
          for (const entry of await fs.readdir(NOVAWAY_SERVER_DIST, { withFileTypes: true })) {
            if (!entry.isFile() || entry.name === "node.js" || entry.name === "node.js.map") continue
            await fs.writeFile(path.join(target, entry.name), await fs.readFile(path.join(NOVAWAY_SERVER_DIST, entry.name)))
          }
        },
      },
    ],
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    plugins: [appPlugin, sentry],
    publicDir: "../../../app/public",
    root: "src/renderer",
    optimizeDeps: {
      // worker / office 编辑器代码里引的是 CJS 包（@pierre/diffs 依赖 lru_map 等）。
      // desktop 的 renderer 配置独立于 packages/app/vite.config.ts，漏掉 include 时
      // Vite 会把 CJS 原件直接发给浏览器，模块图在第一个 default 导入处就抛
      // "does not provide an export named 'default'"，窗口只剩白屏。
      include: ["lru_map", "pako", "fuzzysort", "jszip"],
      exclude: [
        // workspace 里的 TS/TSX 包交给 vite-plugin-solid 编译（与 packages/app/vite.config.ts
        // 一致）。让 esbuild 预打包会把 `export namespace` 这类 TS 语法误判成非 ESM
        // （needsInterop），再按 CJS 默认导出做 interop，运行时找不到 default 导出。
        "@novaway/core",
        "@novaway/sdk",
        "@novaway/ui",
        // `@pierre/diffs` 与 `@pierre/diffs/worker` 是同一包的两个入口，内部靠模块级单例
        // 登记自定义主题。分开预打包会各生成一份 RegisteredCustomThemes：registerCustomTheme("NovaWay")
        // 写进 A，worker 却读 B，报 "resolveTheme: No valid loader for NovaWay"。排除后共享同一份源码。
        "@pierre/diffs",
      ],
    },
    resolve: {
      // desktop 的源码（index.tsx）从 packages/desktop/node_modules 解析 workspace 包，
      // 而 @novaway/app 里的源码会从 packages/app/node_modules 解析。两边一旦落到
      // 不同的目录（例如 app 下留了一份旧拷贝），ThemeProvider / context 就会各建
      // 一个 Solid context 实例，运行时报 "Theme context must be used within a context provider"。
      // dedupe 强制这些包统一从 renderer root（即 packages/desktop）解析。
      dedupe: ["@novaway/core", "@novaway/sdk", "@novaway/ui"],
    },
    define: {
      "import.meta.env.VITE_NOVAWAY_CHANNEL": JSON.stringify(channel),
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
          loading: "src/renderer/loading.html",
        },
      },
    },
  },
})

async function loadMigrations() {
  const dirs = (await fs.readdir(NOVAWAY_MIGRATION_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
    .map((entry) => entry.name)
    .sort()

  return Promise.all(
    dirs.map(async (name) => ({
      sql: await fs.readFile(path.join(NOVAWAY_MIGRATION_DIR, name, "migration.sql"), "utf-8"),
      timestamp: time(name),
      name,
    })),
  )
}

function time(tag: string) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
  if (!match) return 0
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  )
}
