#!/usr/bin/env bun

import { $, type BunPlugin } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")

import { Script } from "@novaway/script"
import pkg from "../package.json"

// 主包名（用户 `npm i -g` 装的）。平台包统一命名为 `${MAIN_PACKAGE}-<os>-<arch>`。
// 默认 xymt-novaway（账号 A）；备份到另一账号时用 NOVAWAY_MAIN_PACKAGE=novaway 切换。
const MAIN_PACKAGE = process.env.NOVAWAY_MAIN_PACKAGE || "xymt-novaway"

// Load migrations from migration directories
const migrationDirs = (
  await fs.promises.readdir(path.join(dir, "migration"), {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const file = path.join(dir, "migration", name, "migration.sql")
    const sql = await Bun.file(file).text()
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = match
      ? Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        )
      : 0
    return { sql, timestamp, name }
  }),
)
console.log(`Loaded ${migrations.length} migrations`)

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")
const sourcemapsFlag = process.argv.includes("--sourcemaps")
const plugin = createSolidTransformPlugin()
const skipEmbedWebUi = process.argv.includes("--skip-embed-web-ui")

const createEmbeddedWebUIBundle = async () => {
  console.log(`Building Web UI to embed in the binary`)
  const appDir = path.join(import.meta.dirname, "../../app")
  const dist = path.join(appDir, "dist")
  await $`bun run --cwd ${appDir} build`
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist })))
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !file.endsWith(".map"))
    .sort()
  const imports = files.map((file, i) => {
    const spec = path.relative(dir, path.join(dist, file)).replaceAll("\\", "/")
    return `import file_${i} from ${JSON.stringify(spec.startsWith(".") ? spec : `./${spec}`)} with { type: "file" };`
  })
  const entries = files.map((file, i) => `  ${JSON.stringify(file)}: file_${i},`)
  return [
    `// Import all files as file_$i with type: "file"`,
    ...imports,
    `// Export with original mappings`,
    `export default {`,
    ...entries,
    `}`,
  ].join("\n")
}

const embeddedFileMap = skipEmbedWebUi ? null : await createEmbeddedWebUIBundle()

const chromiumBidiCjsStubPlugin: BunPlugin = {
  name: "stub-chromium-bidi-cjs",
  setup(build) {
    build.onResolve({ filter: /^chromium-bidi\/lib\/cjs\// }, (args) => ({
      path: args.path,
      namespace: "chromium-bidi-cjs-stub",
    }))
    build.onLoad({ filter: /.*/, namespace: "chromium-bidi-cjs-stub" }, () => ({
      contents: "export default {}",
      loader: "js",
    }))
  },
}

const pptxWorkerBundlePath = path.join(dir, "dist", "ppt-worker", "worker.mjs")
const pptxWorkerAssetPath = path.join(dir, "dist", "ppt-worker", "worker.asset")

const buildPptxWorkerBundle = async () => {
  console.log(`Building PPT browser worker bundle`)
  await fs.promises.mkdir(path.dirname(pptxWorkerBundlePath), { recursive: true })
  const result = await Bun.build({
    target: "node",
    entrypoints: [path.join(dir, "src/office/pptx/worker.mjs")],
    outdir: path.dirname(pptxWorkerBundlePath),
    naming: "worker.mjs",
    format: "esm",
    plugins: [chromiumBidiCjsStubPlugin],
  })
  if (!result.success) throw new Error("PPT worker \u6253\u5305\u5931\u8d25")
  await fs.promises.copyFile(pptxWorkerBundlePath, pptxWorkerAssetPath)
}

const createEmbeddedSkillAssetsBundle = async () => {
  console.log(`Generating embedded skill assets bundle`)
  await buildPptxWorkerBundle()
  const SKILL_DIRS = [
    {
      name: "office-ppt",
      dir: path.join(dir, "src/skill/prompt/office-ppt"),
      extraFiles: [{ key: "pptx-worker/worker.mjs", absPath: pptxWorkerAssetPath }],
    },
    { name: "xiaohongshu-ops", dir: path.join(dir, "src/skill/prompt/xiaohongshu-ops") },
    { name: "wxgzh-ops", dir: path.join(dir, "src/skill/prompt/wxgzh-ops") },
  ]
  const entries = []
  let fileIdx = 0
  for (const { name, dir: skillDir, extraFiles } of SKILL_DIRS) {
    const extraEntries = []
    for (const extra of extraFiles ?? []) {
      const spec = path.relative(dir, extra.absPath).replaceAll("\\", "/")
      extraEntries.push({
        key: `${name}/${extra.key}`,
        spec: spec.startsWith(".") ? spec : `./${spec}`,
        idx: fileIdx++,
      })
    }
    const exists = await fs.promises.stat(skillDir).then(
      () => true,
      () => false,
    )
    if (!exists) {
      entries.push(...extraEntries)
      console.log(`  ${name}: directory not found, ${extraFiles?.length ?? 0} extra files`)
      continue
    }
    const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: skillDir })))
      .map((f) => f.replaceAll("\\", "/"))
      .filter((f) => f !== "SKILL.md" && f !== "CLAUDE.md" && !f.includes("__pycache__"))
      .sort()
    for (const file of files) {
      const absPath = path.join(skillDir, file)
      const spec = path.relative(dir, absPath).replaceAll("\\", "/")
      entries.push({ key: `${name}/${file}`, spec: spec.startsWith(".") ? spec : `./${spec}`, idx: fileIdx++ })
    }
    entries.push(...extraEntries)
    console.log(`  ${name}: ${files.length + (extraFiles?.length ?? 0)} files`)
  }
  if (entries.length === 0) return null
  const imports = entries.map((e) => `import file_${e.idx} from ${JSON.stringify(e.spec)} with { type: "file" };`)
  const mapEntries = entries.map((e) => `  ${JSON.stringify(e.key)}: file_${e.idx},`)
  return [`// Generated by build.ts — built-in skill assets`, ...imports, `export default {`, ...mapEntries, `}`].join(
    "\n",
  )
}

await $`rm -rf dist`
const skillAssetsMap = await createEmbeddedSkillAssetsBundle()

// @opentui/core runtime assets that cannot be baked into a Bun single-file binary
// (tree-sitter worker, native render lib, tree-sitter wasm, grammar files). We embed
// them keyed by their OTUI_ASSET_ROOT-relative path so src/cli/tui/otui-assets.ts can
// extract them on first launch and point opentui at the extracted dir. The native lib
// differs per target, so this is built inside the per-target loop.
type OtuiAssetEntry = { key: string; abs: string }
function otuiAssetEntries(parserWorker: string, item: { os: string; arch: string; abi?: "musl" }): OtuiAssetEntry[] {
  const coreDir = path.dirname(parserWorker)
  const bunStore = path.resolve(coreDir, "../../../..") // .../.bun
  // parser.worker.js is also a Bun entrypoint (compiled/bundled for the actual worker
  // spawn via OTUI_TREE_SITTER_WORKER_PATH). Embedding the SAME path with type:"file"
  // conflicts (Bun parses it as a module). We only need a copy under OTUI_ASSET_ROOT so
  // opentui's module-init path resolution doesn't crash, so stage a raw copy under a
  // neutral name and embed that; the extracted file is renamed to the real key.
  const stageDir = path.join(dir, "dist", "_otui_stage")
  fs.mkdirSync(stageDir, { recursive: true })
  const stagedWorker = path.join(stageDir, "parser.worker.js.bin")
  fs.copyFileSync(parserWorker, stagedWorker)
  const entries: OtuiAssetEntry[] = [{ key: "@opentui/core/parser.worker.js", abs: stagedWorker }]
  const assetsDir = path.join(coreDir, "assets")
  for (const f of new Bun.Glob("**/*").scanSync({ cwd: assetsDir })) {
    entries.push({ key: `@opentui/core/assets/${f.replaceAll("\\", "/")}`, abs: path.join(assetsDir, f) })
  }
  const wts = [
    ...new Bun.Glob("web-tree-sitter@*/node_modules/web-tree-sitter/tree-sitter.wasm").scanSync({
      cwd: bunStore,
      absolute: true,
    }),
  ][0]
  if (!wts) throw new Error("missing web-tree-sitter/tree-sitter.wasm in bun store")
  entries.push({ key: "web-tree-sitter/tree-sitter.wasm", abs: wts })
  const nativeFile = item.os === "win32" ? "opentui.dll" : item.os === "darwin" ? "libopentui.dylib" : "libopentui.so"
  const suffix = item.abi === "musl" ? "-musl" : ""
  const pkg = `@opentui/core-${item.os}-${item.arch}${suffix}`
  const storePkg = `@opentui+core-${item.os}-${item.arch}${suffix}`
  const nativeAbs = [
    ...new Bun.Glob(`${storePkg}@*/node_modules/${pkg}/${nativeFile}`).scanSync({ cwd: bunStore, absolute: true }),
  ][0]
  if (!nativeAbs) throw new Error(`missing opentui native lib ${pkg}/${nativeFile} in bun store`)
  entries.push({ key: `${pkg}/${nativeFile}`, abs: nativeAbs })
  return entries
}
function buildOtuiAssetsGen(entries: OtuiAssetEntry[]): string {
  const imports = entries.map((e, i) => {
    const spec = path.relative(dir, e.abs).replaceAll("\\", "/")
    return `import file_${i} from ${JSON.stringify(spec.startsWith(".") ? spec : `./${spec}`)} with { type: "file" };`
  })
  const map = entries.map((e, i) => `  ${JSON.stringify(e.key)}: file_${i},`)
  return [
    `// Generated by build.ts — embedded @opentui/core runtime assets`,
    ...imports,
    `export default {`,
    ...map,
    `}`,
  ].join("\n")
}

// @opentui/core@0.4.5 resolves the tree-sitter parser.worker at MODULE-INIT via a top-level
// await (chunk-bun-*.js, PARSER_WORKER_ASSET_KEY, `{ useAssetRoot: false }`):
//   return normalizeLoadedFilePath((await loadBundledFile()).default, metaUrl)
// where loadBundledFile is `import("@opentui/core/parser.worker", {type:"file"})`. In a compiled
// Bun single-file binary that import's `.default` is undefined, so `normalizeLoadedFilePath(undefined)`
// throws `$.startsWith` — and because it's a TOP-LEVEL await it fires the instant the opentui chunk
// is first evaluated (before our tui handler can set OTUI_ASSET_ROOT), killing the TUI at startup.
// Flipping `useAssetRoot` wouldn't help: the root isn't set yet at that point. Instead we patch the
// Bun branch of resolveBundledFilePath to tolerate an undefined `.default` and fall back to the
// package-relative path (which is unused anyway — the worker is actually spawned via the
// OTUI_TREE_SITTER_WORKER_PATH define, and every other asset is resolved lazily from OTUI_ASSET_ROOT
// once it's set). This makes module-init crash-proof regardless of env timing. Re-applied every build
// after `bun install` so it survives reinstalls. The anchor is unique (the same normalizeLoadedFilePath
// call inside loadBundledFilePath is followed by `} catch`, not by `resolveFallbackFilePath`); if a
// version bump changes it we throw so the regression is caught instead of shipping a broken TUI.
function patchOpentuiParserWorkerCrash(coreDir: string) {
  const ANCHOR =
    "  return normalizeLoadedFilePath((await loadBundledFile()).default, metaUrl);\n}\nfunction resolveFallbackFilePath"
  const REPLACEMENT =
    "  { const __d = (await loadBundledFile()).default; return __d == null ? resolveFallbackFilePath(fallbackPath, metaUrl) : normalizeLoadedFilePath(__d, metaUrl); }\n}\nfunction resolveFallbackFilePath"
  const MARKER = "const __d = (await loadBundledFile()).default"
  let patched = 0
  let alreadyPatched = false
  for (const rel of new Bun.Glob("*.js").scanSync({ cwd: coreDir })) {
    const abs = path.join(coreDir, rel)
    const text = fs.readFileSync(abs, "utf8")
    if (text.includes(ANCHOR)) {
      fs.writeFileSync(abs, text.replace(ANCHOR, REPLACEMENT))
      patched++
    } else if (text.includes(MARKER)) {
      alreadyPatched = true
    }
  }
  if (patched > 0) {
    console.log(`  patched @opentui/core parser.worker module-init crash guard in ${patched} file(s)`)
  } else if (!alreadyPatched) {
    throw new Error(
      `patchOpentuiParserWorkerCrash: resolveBundledFilePath anchor not found in ${coreDir} — ` +
        `@opentui/core likely changed; re-verify parser.worker resolution or the compiled TUI will crash with $.startsWith`,
    )
  }
}

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
  {
    os: "linux",
    arch: "x64",
  },
  {
    os: "darwin",
    arch: "arm64",
  },
  {
    os: "darwin",
    arch: "x64",
  },
  {
    os: "win32",
    arch: "x64",
  },
]

const targets = singleFlag
  ? allTargets.filter((item) => {
      if (item.os !== process.platform || item.arch !== process.arch) {
        return false
      }

      // When building for the current platform, prefer a single native binary by default.
      // Baseline binaries require additional Bun artifacts and can be flaky to download.
      if (item.avx2 === false) {
        return baselineFlag
      }

      // also skip abi-specific builds for the same reason
      if (item.abi !== undefined) {
        return false
      }

      return true
    })
  : allTargets

const binaries: Record<string, string> = {}
if (!skipInstall) {
  await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
  await $`bun install --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
}
for (const item of targets) {
  // 平台包名 = `${MAIN_PACKAGE}-<os>-<arch>`，与主包同属一个 npm 账号。
  // changing to win32 flags npm for some reason
  const osName = item.os === "win32" ? "windows" : item.os
  const name = [MAIN_PACKAGE, osName, item.arch].join("-")
  // bun 编译 target 单独构造，避免把包名里的字段 replace 坏。
  const bunTarget = ["bun", osName, item.arch].join("-")
  console.log(`building ${name}`)
  await $`mkdir -p dist/${name}/bin`

  const localPath = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
  const rootPath = path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js")
  const parserWorker = fs.realpathSync(fs.existsSync(localPath) ? localPath : rootPath)
  const workerPath = "./src/cli/tui/worker.ts"

  patchOpentuiParserWorkerCrash(path.dirname(parserWorker))

  const otuiAssetsGen = buildOtuiAssetsGen(otuiAssetEntries(parserWorker, item))

  // Use platform-specific bunfs root path based on target OS
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
  const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

  await Bun.build({
    conditions: ["browser"],
    tsconfig: "./tsconfig.json",
    plugins: [plugin, chromiumBidiCjsStubPlugin],
    external: ["node-gyp", "playwright-core", "chromium-bidi"],
    format: "esm",
    minify: true,
    sourcemap: sourcemapsFlag ? "linked" : "none",
    splitting: true,
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: bunTarget as any,
      outfile: `dist/${name}/bin/novaway`,
      execArgv: [`--user-agent=novaway/${Script.version}`, "--use-system-ca", "--"],
      windows: {},
    },
    files: {
      ...(embeddedFileMap ? { "opencode-web-ui.gen.ts": embeddedFileMap } : {}),
      ...(skillAssetsMap ? { "opencode-skills.gen.ts": skillAssetsMap } : {}),
      "opencode-otui-assets.gen.ts": otuiAssetsGen,
    },
    entrypoints: [
      "./src/index.ts",
      parserWorker,
      workerPath,
      "opencode-otui-assets.gen.ts",
      ...(embeddedFileMap ? ["opencode-web-ui.gen.ts"] : []),
      ...(skillAssetsMap ? ["opencode-skills.gen.ts"] : []),
    ],
    define: {
      OPENCODE_VERSION: `'${Script.version}'`,
      // 运行时读的是 NOVAWAY_MIGRATIONS（见 storage/db.ts）；若写成 OPENCODE_MIGRATIONS
      // 则该全局在二进制里为 undefined，迁移逻辑会回退去 scandir 一个不存在的 migration 目录
      // （Windows 上解析成 B:\migration）而崩溃。build-node.ts 已用正确名字，这里对齐。
      NOVAWAY_MIGRATIONS: JSON.stringify(migrations),
      OPENCODE_MODELS_DEV: generated.modelsData,
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
      OPENCODE_WORKER_PATH: workerPath,
      OPENCODE_CHANNEL: `'${Script.channel}'`,
      // watcher.ts 读的是 NovaWay_LIBC；始终注入合法字符串字面量（非 linux 用不到，但保持替换合法）。
      NovaWay_LIBC: `'${item.abi ?? "glibc"}'`,
      // installation/version.ts reads these globals; keep them in sync with the OPENCODE_* defines
      // so the published binary reports its real version/channel (not "local") and update checks work.
      NovaWay_VERSION: `'${Script.version}'`,
      NovaWay_CHANNEL: `'${Script.channel}'`,
      // 让二进制知道自己发布用的主包名，auto-update 才会升级正确的包（账号切换时随之变）。
      NovaWay_NPM_PACKAGE: `'${MAIN_PACKAGE}'`,
    },
  })

  // Smoke test: only run if binary is for current platform
  if (item.os === process.platform && item.arch === process.arch && !item.abi) {
    const binaryPath = `dist/${name}/bin/novaway`
    console.log(`Running smoke test: ${binaryPath} --version`)
    try {
      const versionOutput = await $`${binaryPath} --version`.text()
      console.log(`Smoke test passed: ${versionOutput.trim()}`)
    } catch (e) {
      console.error(`Smoke test failed for ${name}:`, e)
      process.exit(1)
    }
  }

  await $`rm -rf ./dist/${name}/bin/tui`
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        preferUnplugged: true,
        os: [item.os],
        cpu: [item.arch],
      },
      null,
      2,
    ),
  )
  binaries[name] = Script.version
}

if (Script.release) {
  for (const key of Object.keys(binaries)) {
    if (key.includes("linux")) {
      await $`tar -czf ../../${key}.tar.gz *`.cwd(`dist/${key}/bin`)
    } else {
      await $`zip -r ../../${key}.zip *`.cwd(`dist/${key}/bin`)
    }
  }
  await $`gh release upload v${Script.version} ./dist/*.zip ./dist/*.tar.gz --clobber --repo ${process.env.GH_REPO}`
}

export { binaries }
