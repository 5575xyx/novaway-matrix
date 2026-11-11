import { readFileSync } from "node:fs"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"

const theme = fileURLToPath(new URL("./public/novaway-theme-preload.js", import.meta.url))
const officeBundleRoot = fileURLToPath(new URL("./public/office", import.meta.url))

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "novaway-desktop:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
          },
        },
        worker: {
          format: "es",
        },
        // node_modules 里按 solid 条件分发的包(virtua/lib/solid)自带
        // `/** @jsxImportSource solid-js */` 文件内注释。esbuild 默认不是 automatic
        // JSX transform,看到这个注释只会告警;真正的 JSX 编译由 vite-plugin-solid 的
        // babel 完成,所以这里跳过 esbuild 这一趟,输出不变,只去掉告警。
        esbuild: {
          exclude: [/node_modules[\\/].+\.jsx$/],
        },
      }
    },
  },
  {
    name: "novaway-desktop:theme-preload",
    transformIndexHtml(html) {
      return html.replace(
        '<script id="novaway-theme-preload-script" src="/novaway-theme-preload.js"></script>',
        `<script id="novaway-theme-preload-script">${readFileSync(theme, "utf8")}</script>`,
      )
    },
  },
  {
    // Office 编辑器产物是预构建的独立 ESM bundle（React 19 + GenOffice），
    // 内部用 `import.meta.url` 相对解析 worker / CSS / 字体。Vite 不允许从模块代码
    // `import()` 一个 public 里的 .js（会拦为 "Cannot import non-asset file"），
    // 所以在 Vite 的 transform 中间件之前用原始静态文件响应 /office/*，
    // 让浏览器原生加载这些预构建产物，避免 Vite 二次 transform 破坏相对资源解析。
    name: "novaway-desktop:office-static",
    configureServer(server) {
      // 直接在 configureServer 回调体里注册（不要用「返回函数」的 post-hook 写法）：
      // Vite 在调用 configureServer 后、注册内置中间件之前，会先执行到这里，
      // 这样我们的中间件排在 transformMiddleware / servePublicMiddleware 之前，
      // 才能先拦下 /office/*，避免 Vite 二次 transform 破坏预构建 ESM。
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith("/office/")) return next()
        const requestPath = decodeURIComponent(req.url.split("?")[0])
        const relative = requestPath.slice("/office/".length)
        if (relative.includes("..") || relative.includes("\\")) return next()
        const file = path.join(officeBundleRoot, relative)
        const info = await stat(file).catch(() => null)
        if (!info || !info.isFile()) return next()
        const mime = file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : file.endsWith(".woff2")
              ? "font/woff2"
              : file.endsWith(".ttf")
                ? "font/ttf"
                : file.endsWith(".svg")
                  ? "image/svg+xml"
                  : file.endsWith(".png")
                    ? "image/png"
                    : "application/octet-stream"
        res.statusCode = 200
        res.setHeader("Content-Type", mime)
        res.setHeader("Cache-Control", "no-cache")
        createReadStream(file).pipe(res)
      })
    },
  },
  tailwindcss(),
  solidPlugin(),
]
