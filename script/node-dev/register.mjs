/**
 * `node --import ./script/node-dev/register.mjs <entry>` 的入口。
 *
 * 顺序很重要：先装 `globalThis.Bun`，再注册 loader —— 这样被加载的模块在求值阶段
 * 就能直接读到 Bun 全局（很多模块是在顶层调 `Bun.file()` 的）。
 */
import { register } from "node:module"
import { pathToFileURL } from "node:url"
import bun from "./shims/bun.mjs"

if (typeof globalThis.Bun === "undefined") {
  globalThis.Bun = bun
}

register("./loader.mjs", pathToFileURL(import.meta.filename))
