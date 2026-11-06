#!/usr/bin/env bun
/**
 * 内核边界扫描器（插件文档 §2.3、门禁 B1）。
 *
 * 判定只认 kernel.manifest.json，不认文档也不认代码注释：kernel 文件运行时 import 到
 * capability 文件，就是违规。`import type` 放行，因为类型不产生运行时依赖。
 *
 * 违规清单落在 test/architecture/kernel-boundary.baseline.json 里做棘轮：
 * 只许变短，变长即失败；已修好但没删的条目同样失败，逼着人更新基线。
 */
import * as fs from "fs"
import * as path from "path"
import * as ts from "typescript"

const BASE_DIR = path.resolve(import.meta.dir, "..")
const REPO_DIR = path.resolve(BASE_DIR, "..", "..")
const MANIFEST_PATH = path.join(BASE_DIR, "kernel.manifest.json")
const BASELINE_PATH = path.join(BASE_DIR, "test", "architecture", "kernel-boundary.baseline.json")
const PLUGIN_API_DIR = path.join(REPO_DIR, "packages", "plugin-api")

const MILESTONES = ["M0", "M1", "M2", "M3", "M4", "M5"] as const
const SOURCE_EXTENSIONS = [".ts", ".tsx"]
const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"]

/** §2.2 规则 2：插件源码目录不属于内核，哪怕它还没进 capability 清单。 */
const NEVER_IN_KERNEL = ["src/plugins/**", "packages/plugins/**", "../packages/plugins/**", "@novaway/plugins/**"]

export type Milestone = (typeof MILESTONES)[number]

/**
 * capability 与 NEVER_IN_KERNEL 的 glob 同时匹配两种形态：
 * 包内路径（`src/tool/office-*.ts`）与仓库路径 / 裸 specifier（`packages/core/src/office/**`、`@novaway/core/office/**`）。
 */
export type BoundaryManifest = {
  version: number
  milestone: Milestone
  kernel: string[]
  shared: string[]
  capability: string[]
  exempt: Array<{ file: string; reason: string; until: Milestone }>
}

export type Edge = { file: string; spec: string; target: string }

export type ScanResult = {
  kernelCount: number
  capabilityCount: number
  violations: Edge[]
  exempted: Edge[]
  expiredExempts: string[]
  unusedExempts: string[]
  deadGlobs: string[]
  newViolations: Edge[]
  staleBaseline: string[]
  pluginApiViolations: string[]
}

function globToRegExp(glob: string): RegExp {
  let source = ""
  for (let index = 0; index < glob.length; index++) {
    const char = glob.charAt(index)
    if (char === "*") {
      if (glob[index + 1] === "*") {
        source += ".*"
        index++
      } else source += "[^/]*"
      continue
    }
    if (char === "?") {
      source += "[^/]"
      continue
    }
    source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${source}$`)
}

const globCache = new Map<string, RegExp>()

function matches(glob: string, value: string): boolean {
  const pattern = globCache.get(glob) ?? globToRegExp(glob)
  globCache.set(glob, pattern)
  return pattern.test(value)
}

function matchesAny(globs: string[], value: string): boolean {
  return globs.some((glob) => matches(glob, value))
}

/** 一个 import 目标要匹配的候选形态：仓库相对、包内相对、原始 specifier。 */
function formsOf(spec: string, target: string | undefined): string[] {
  if (target === undefined) return [spec]
  return [target, target.replace(/^packages\/novaway\//, ""), spec]
}

function listSourceFiles(dir: string, root: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return listSourceFiles(full, root)
      if (!SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) return []
      return [path.relative(root, full).replaceAll("\\", "/")]
    })
    .sort()
}

function resolveTarget(spec: string, fromFile: string): string | undefined {
  const base = spec.startsWith("@/")
    ? path.join(BASE_DIR, "src", spec.slice(2))
    : spec.startsWith("./") || spec.startsWith("../")
      ? path.resolve(path.dirname(path.join(BASE_DIR, fromFile)), spec)
      : undefined
  if (base === undefined) return undefined
  const candidate = [
    base,
    ...RESOLVE_EXTENSIONS.map((ext) => base + ext),
    ...RESOLVE_EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ].find((item) => fs.existsSync(item) && fs.statSync(item).isFile())
  return candidate === undefined ? undefined : path.relative(REPO_DIR, candidate).replaceAll("\\", "/")
}

/**
 * 只取运行时依赖：整条 `import type` 声明丢掉；`import { type A } from "x"` 保守算作运行时，
 * 因为它是否被擦除取决于打包器，边界测试不该赌这一步。
 */
function dependenciesOf(file: string): Array<{ spec: string; target: string | undefined; typeOnly: boolean }> {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(BASE_DIR, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  )
  const found: Array<{ spec: string; target: string | undefined; typeOnly: boolean }> = []

  function add(spec: string, typeOnly: boolean) {
    if (typeOnly) return
    found.push({ spec, target: resolveTarget(spec, file), typeOnly })
  }

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, node.importClause?.isTypeOnly === true)
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, node.isTypeOnly)
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const first = node.arguments[0]
      if (first && ts.isStringLiteral(first)) add(first.text, false)
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return found
}

export function edgeKey(edge: Edge): string {
  return `${edge.file} -> ${edge.spec}`
}

function dedupe(edges: Edge[]): Edge[] {
  return [...new Map(edges.map((edge) => [edgeKey(edge), edge])).values()]
}

export function readManifest(): BoundaryManifest {
  const raw: unknown = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))
  if (!isManifest(raw)) throw new Error(`kernel.manifest.json 不再是合法的边界清单：${MANIFEST_PATH}`)
  return raw
}

/** 不靠断言读 JSON：字段拿不准就当成不存在，让门禁在清单腐烂时失败而不是静默放行。 */
function has(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value ? Reflect.get(value, key) : undefined
}

function isManifest(value: unknown): value is BoundaryManifest {
  const milestone = has(value, "milestone")
  return (
    typeof has(value, "version") === "number" &&
    typeof milestone === "string" &&
    (MILESTONES as readonly string[]).includes(milestone) &&
    Array.isArray(has(value, "kernel")) &&
    Array.isArray(has(value, "shared")) &&
    Array.isArray(has(value, "capability")) &&
    Array.isArray(has(value, "exempt"))
  )
}

export function readBaseline(): string[] {
  if (!fs.existsSync(BASELINE_PATH)) return []
  const raw: unknown = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"))
  if (!Array.isArray(raw)) throw new Error(`基线必须是字符串数组：${BASELINE_PATH}`)
  return raw.filter((item): item is string => typeof item === "string")
}

function runtimeDeps(value: unknown): string[] {
  const deps = has(value, "dependencies")
  if (typeof deps !== "object" || deps === null) return []
  return Object.keys(deps)
}

/** plugin-api 纯度：只能相对 import、只能是类型与纯函数，不碰 Bun / node / 任何 npm 包。 */
export function scanPluginApi(): string[] {
  const declared = runtimeDeps(JSON.parse(fs.readFileSync(path.join(PLUGIN_API_DIR, "package.json"), "utf8"))).map(
    (name) => `package.json 有运行时依赖 "${name}"：plugin-api 必须零依赖`,
  )

  return [
    ...declared,
    ...listSourceFiles(path.join(PLUGIN_API_DIR, "src"), path.join(PLUGIN_API_DIR, "src")).flatMap((file) => {
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(path.join(PLUGIN_API_DIR, "src", file), "utf8"),
        ts.ScriptTarget.Latest,
        true,
      )
      const found: string[] = []
      function visit(node: ts.Node) {
        const spec =
          ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
            ? node.moduleSpecifier.text
            : ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
              ? node.moduleSpecifier.text
              : undefined
        if (spec !== undefined && !spec.startsWith("./") && !spec.startsWith("../")) {
          found.push(`${file} import 了非相对模块 "${spec}"`)
        }
        // 只认真正调到宿主全局的位置：`process?: Array<...>` 这种类型属性名不算。
        if (ts.isIdentifier(node) && (node.text === "Bun" || node.text === "process")) {
          const parent = node.parent
          if (
            parent !== undefined &&
            ((ts.isPropertyAccessExpression(parent) && parent.expression === node) ||
              (ts.isCallExpression(parent) && parent.expression === node))
          ) {
            found.push(`${file} 引用了宿主全局 ${node.text}`)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
      return found
    }),
  ]
}

/** 清单腐烂检查：glob 匹配不到任何文件时门禁会静默失效，必须报错。 */
export function findDeadGlobs(manifest: BoundaryManifest, files: string[]): string[] {
  return [...manifest.kernel, ...manifest.shared, ...manifest.capability]
    .filter((glob) =>
      glob.startsWith("@")
        ? false
        : glob.startsWith("packages/")
          ? !fs.existsSync(path.join(REPO_DIR, glob.replace(/[*?].*$/, "").replace(/\/$/, "")))
          : !files.some((file) => matches(glob, file)),
    )
    .map((glob) => `kernel.manifest.json 里的 ${glob} 已经匹配不到任何文件：门禁会静默失效`)
}

export function scan(manifest: BoundaryManifest, baseline: string[]): ScanResult {
  const files = listSourceFiles(path.join(BASE_DIR, "src"), BASE_DIR)
  const kernel = files.filter((file) => matchesAny(manifest.kernel, file) && !matchesAny(manifest.capability, file))
  const capability = files.filter((file) => matchesAny(manifest.capability, file))

  const edges = kernel.flatMap((file) =>
    dependenciesOf(file).flatMap((dep) => {
      const candidates = formsOf(dep.spec, dep.target)
      const hit = candidates.find(
        (value) => matchesAny(manifest.capability, value) || matchesAny(NEVER_IN_KERNEL, value),
      )
      return hit === undefined ? [] : [{ file, spec: dep.spec, target: hit }]
    }),
  )

  const exemptGlobs = manifest.exempt.map((item) => item.file)
  const exempted = dedupe(edges.filter((edge) => matchesAny(exemptGlobs, edge.file)))
  const plain = dedupe(edges.filter((edge) => !matchesAny(exemptGlobs, edge.file)))
  const expiredExempts = manifest.exempt
    .filter((item) => MILESTONES.indexOf(item.until) < MILESTONES.indexOf(manifest.milestone))
    .map((item) => `${item.file} 的豁免到期于 ${item.until}，当前已是 ${manifest.milestone}：${item.reason}`)
  const unusedExempts = manifest.exempt
    .filter((item) => MILESTONES.indexOf(item.until) >= MILESTONES.indexOf(manifest.milestone))
    .filter((item) => !exempted.some((edge) => matches(item.file, edge.file)))
    .map((item) => `${item.file} 的豁免已无命中（${item.reason}），请从 kernel.manifest.json 删除`)

  const keys = new Set(plain.map(edgeKey))
  return {
    kernelCount: kernel.length,
    capabilityCount: capability.length,
    violations: plain,
    exempted,
    expiredExempts,
    unusedExempts,
    deadGlobs: findDeadGlobs(manifest, files),
    newViolations: plain.filter((edge) => !baseline.includes(edgeKey(edge))),
    staleBaseline: baseline.filter((key) => !keys.has(key)),
    pluginApiViolations: scanPluginApi(),
  }
}

/** 只看会阻断的条目：新违规、到期/空转的豁免、失效的清单 glob、变短的基线、plugin-api 不纯。 */
export function failures(result: ScanResult): string[] {
  return [
    ...result.newViolations.map((edge) => `${edge.file} → ${edge.spec}（命中 ${edge.target}）：该能力应改为插件贡献`),
    ...result.expiredExempts,
    ...result.unusedExempts,
    ...result.deadGlobs,
    ...result.staleBaseline.map((key) => `基线里的 ${key} 已不存在，跑 --update 收紧棘轮`),
    ...result.pluginApiViolations.map((item) => `plugin-api ${item}`),
  ]
}

function main() {
  const args = new Set(process.argv.slice(2))
  const manifest = readManifest()
  const result = scan(manifest, readBaseline())

  if (args.has("--update")) {
    const next = result.violations.map(edgeKey).sort()
    fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true })
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`)
    console.log(`基线已写入 ${next.length} 条`)
    const rest = [...result.expiredExempts, ...result.unusedExempts, ...result.deadGlobs, ...result.pluginApiViolations]
    if (rest.length > 0) {
      console.log(rest.join("\n"))
      process.exit(1)
    }
    return
  }

  const blocked = failures(result)
  if (args.has("--json")) {
    console.log(JSON.stringify({ ...result, blocked }, null, 2))
  } else {
    console.log(
      `kernel ${result.kernelCount} 个 · capability ${result.capabilityCount} 个 · 违规 ${result.violations.length} 条（豁免内 ${result.exempted.length}）· 基线外新增 ${result.newViolations.length} 条`,
    )
    if (blocked.length > 0) console.log(blocked.join("\n"))
    else console.log("B1 依赖方向：通过")
  }
  process.exit(blocked.length > 0 ? 1 : 0)
}

if (import.meta.main) main()
