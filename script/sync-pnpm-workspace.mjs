#!/usr/bin/env node
/**
 * 由根 package.json 生成 pnpm-workspace.yaml。
 *
 * 为什么需要生成：bun 把「工作区列表 + 版本目录（catalog）+ 补丁 + 可信依赖 + 版本冷却」
 * 分散写在 package.json（workspaces / patchedDependencies / trustedDependencies）和
 * bunfig.toml（exact / minimumReleaseAge）里；pnpm 只认 pnpm-workspace.yaml。
 * 两边各手抄一份迟早会漂移 —— 改了一个版本、忘了另一个，pnpm 装出来的就是旧版本。
 *
 * 所以约定：上面那些字段的唯一真源仍然是 bun 的那几个文件，本脚本负责把它们
 * 翻译成 pnpm 能读的 yaml。改完版本记得跑：
 *
 *     node script/sync-pnpm-workspace.mjs          # 重新生成
 *     node script/sync-pnpm-workspace.mjs --check  # CI 里校验有没有过期
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const target = path.join(root, "pnpm-workspace.yaml")

/** YAML 里这些位置都要能安全放 @scope/pkg、https://... 、1.0.0-beta.x 这种值。 */
const yaml = (value) => JSON.stringify(value)

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"))
const stripComment = (line) => line.split("#")[0].trim()

/**
 * 从 bunfig.toml 的 [install] 段里捞几个字段。
 *
 * 不用正则：TOML 里这些值要么是裸标量要么是单行字符串数组，按行切就够，
 * 也免得正则转义在脚本里再出岔子。只认这一段里的键，[test] 等段落不参与。
 */
function readBunfig() {
  const file = path.join(root, "bunfig.toml")
  const result = { exact: false, minimumReleaseAge: undefined, minimumReleaseAgeExcludes: [] }
  if (!fs.existsSync(file)) return result
  let section = ""
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = stripComment(raw)
    if (!line) continue
    if (line.startsWith("[")) {
      section = line
      continue
    }
    if (section !== "[install]") continue
    const eq = line.indexOf("=")
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (key === "exact") result.exact = value === "true"
    if (key === "minimumReleaseAge") result.minimumReleaseAge = value
    if (key === "minimumReleaseAgeExcludes" && value.startsWith("[") && value.endsWith("]")) {
      result.minimumReleaseAgeExcludes = value
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim().replaceAll('"', "").replaceAll("'", ""))
        .filter(Boolean)
    }
  }
  return result
}

function build() {
  const pkg = readJson(path.join(root, "package.json"))
  const workspaces = pkg.workspaces ?? {}
  const bunfig = readBunfig()
  const lines = []

  lines.push("# 此文件由 script/sync-pnpm-workspace.mjs 生成，请勿手改。")
  lines.push("#")
  lines.push("# 真源是根 package.json 的 workspaces / trustedDependencies / patchedDependencies")
  lines.push("# 以及 bunfig.toml 的 exact / minimumReleaseAge。改完跑：")
  lines.push("#   node script/sync-pnpm-workspace.mjs")
  lines.push("")

  lines.push("packages:")
  for (const pattern of workspaces.packages ?? []) lines.push("  - " + yaml(pattern))
  lines.push("")

  lines.push("# 与 package.json 的 workspaces.catalog 一一对应（依赖里写 catalog: 就是查这张表）。")
  lines.push("catalog:")
  const catalog = workspaces.catalog ?? {}
  for (const [name, version] of Object.entries(catalog)) {
    lines.push("  " + yaml(name) + ": " + yaml(version))
  }
  lines.push("")

  // npm 风格的顶层 overrides，pnpm 不读；它只认 pnpm.overrides 或 pnpm-workspace.yaml 的 overrides。
  // 顺手把 catalog: 展开成具体版本 —— pnpm 的 overrides 不认 catalog 协议。
  const overrides = pkg.overrides ?? {}
  if (Object.keys(overrides).length > 0) {
    lines.push("# package.json 的 overrides（catalog: 已展开成具体版本）。")
    lines.push("overrides:")
    for (const [name, value] of Object.entries(overrides)) {
      const resolved = value === "catalog:" ? catalog[name] : value
      if (!resolved) throw new Error("overrides 里 " + name + " 指向了 catalog 里没有的条目: " + value)
      lines.push("  " + yaml(name) + ": " + yaml(resolved))
    }
    lines.push("")
  }

  const trusted = pkg.trustedDependencies ?? []
  if (trusted.length > 0) {
    lines.push("# bun 的 trustedDependencies：只有这些包允许跑安装脚本（pnpm 默认全部拒绝）。")
    lines.push("onlyBuiltDependencies:")
    for (const name of trusted) lines.push("  - " + yaml(name))
    lines.push("")
  }

  const patches = pkg.patchedDependencies ?? {}
  if (Object.keys(patches).length > 0) {
    lines.push("# 与 package.json 的 patchedDependencies 相同，补丁文件两边共用一份。")
    lines.push("patchedDependencies:")
    for (const [name, file] of Object.entries(patches)) lines.push("  " + yaml(name) + ": " + yaml(file))
    lines.push("")
  }

  if (bunfig.minimumReleaseAge) {
    // bun 的单位是秒，pnpm 是分钟。
    const minutes = Math.max(1, Math.round(Number(bunfig.minimumReleaseAge) / 60))
    lines.push("# bunfig.toml 的 minimumReleaseAge（秒换算成分钟）：新版本要发布满这么久才会被解析到。")
    lines.push("minimumReleaseAge: " + minutes)
    if (bunfig.minimumReleaseAgeExcludes.length > 0) {
      lines.push("minimumReleaseAgeExclude:")
      for (const name of bunfig.minimumReleaseAgeExcludes) lines.push("  - " + yaml(name))
    }
    lines.push("")
  }

  return { text: lines.join("\n"), exact: bunfig.exact }
}

const { text, exact } = build()
const check = process.argv.includes("--check")

if (!check) {
  fs.writeFileSync(target, text)
  console.log("已写入 " + path.relative(root, target) + "（" + text.split("\n").length + " 行）")
} else {
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : ""
  if (current !== text) {
    console.error("pnpm-workspace.yaml 已过期：请运行 node script/sync-pnpm-workspace.mjs")
    process.exit(1)
  }
  if (exact) {
    const npmrc = path.join(root, ".npmrc")
    const content = fs.existsSync(npmrc) ? fs.readFileSync(npmrc, "utf8") : ""
    const hasExact = content.split(/\r?\n/).some((line) => stripComment(line) === "save-exact=true")
    if (!hasExact) {
      console.error(".npmrc 缺少 save-exact=true（对应 bunfig.toml 的 exact = true）")
      process.exit(1)
    }
  }
  console.log("pnpm-workspace.yaml 与 bun 配置一致")
}
