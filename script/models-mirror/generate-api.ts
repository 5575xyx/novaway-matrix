#!/usr/bin/env bun
// 复制到 fork 仓库根目录的 script/generate-api.ts。
// 产出与 models.dev/api.json 相同的 v1 目录（default 变体：剔除 decision 类模型），
// 外加 UI 需要的 /logos/<provider>.svg，全部写入 dist/ 供 GitHub Pages 发布。
import fs from "fs/promises"
import path from "path"
import { generate, filterProvidersByModelType } from "@models.dev/core"

const providersDir = path.resolve(import.meta.dir, "../providers")
const outDir = path.resolve(import.meta.dir, "../dist")

const providers = await generate(providersDir)
const filtered = filterProvidersByModelType(providers, "default")

await fs.rm(outDir, { recursive: true, force: true })
await fs.mkdir(path.join(outDir, "logos"), { recursive: true })
await Bun.write(path.join(outDir, "api.json"), JSON.stringify(filtered))

const defaultLogo = Bun.file(path.join(providersDir, "logo.svg"))
if (await defaultLogo.exists()) {
  await Bun.write(path.join(outDir, "logos", "default.svg"), defaultLogo)
}
for (const entry of await fs.readdir(providersDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const logo = Bun.file(path.join(providersDir, entry.name, "logo.svg"))
  if (await logo.exists()) {
    await Bun.write(path.join(outDir, "logos", `${entry.name}.svg`), logo)
  }
}

console.log(`Wrote dist/api.json (${Object.keys(filtered).length} providers) and logos`)