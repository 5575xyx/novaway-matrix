import { readFileSync } from "node:fs"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"

const theme = fileURLToPath(new URL("./public/oc-theme-preload.js", import.meta.url))

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "opencode-desktop:config",
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
    name: "opencode-desktop:theme-preload",
    transformIndexHtml(html) {
      return html.replace(
        '<script id="oc-theme-preload-script" src="/oc-theme-preload.js"></script>',
        `<script id="oc-theme-preload-script">${readFileSync(theme, "utf8")}</script>`,
      )
    },
  },
  tailwindcss(),
  solidPlugin(),
]
