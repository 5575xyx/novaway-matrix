import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const resources = path.join(root, "resources")
const baselines = path.join(resources, "powersnexus-baselines")
const publicKey = path.join(resources, "powersnexus-release-public-key.pem")
const builder = path.join(root, "electron-builder.config.ts")
const main = path.join(root, "src/main/index.ts")

const errors = []
const notes = []

function ok(msg) {
  notes.push(`PASS ${msg}`)
}
function fail(msg) {
  errors.push(msg)
  notes.push(`FAIL ${msg}`)
}

if (!existsSync(publicKey)) fail("缺少 powersnexus-release-public-key.pem")
else ok("公钥存在")

if (!existsSync(baselines)) fail("缺少 powersnexus-baselines")
else {
  const versions = readdirSync(baselines).filter((name) => statSync(path.join(baselines, name)).isDirectory())
  if (versions.length === 0) fail("baselines 目录为空")
  else ok(`内置基线目录 ${versions.join(", ")}`)
  for (const version of versions) {
    const zip = readdirSync(path.join(baselines, version)).find((name) => name.endsWith(".zip"))
    if (!zip) fail(`${version} 缺少 zip`)
    else {
      const bytes = readFileSync(path.join(baselines, version, zip))
      const digest = createHash("sha256").update(bytes).digest("hex")
      ok(`${version} zip digest=${digest.slice(0, 12)}… size=${bytes.length}`)
    }
  }
}

const builderText = readFileSync(builder, "utf8")
if (!builderText.includes("powersnexus-baselines")) fail("electron-builder 未打包 baselines")
else ok("electron-builder extraResources 包含 baselines")
if (!builderText.includes("powersnexus-release-public-key.pem")) fail("electron-builder 未打包公钥")
else ok("electron-builder extraResources 包含公钥")
if (builderText.includes("!resources/powersnexus/**/*") === false) {
  notes.push("WARN 仍可能打包旧 powersnexus 目录，请确认 extraResources 排除")
}

const mainText = readFileSync(main, "utf8")
if (!mainText.includes('POWERSNEXUS_UPDATE_POLICY = process.env.POWERSNEXUS_UPDATE_POLICY ?? "bundled"')) {
  fail("桌面端未默认 bundled 策略")
} else ok("桌面端默认 bundled 策略")
if (!mainText.includes("POWERSNEXUS_FIRST_PARTY")) fail("桌面端未设置 FIRST_PARTY")
else ok("桌面端设置 FIRST_PARTY")

console.log(notes.join("\n"))
if (errors.length) {
  console.error("\n打包矩阵预检失败：\n" + errors.map((e) => `- ${e}`).join("\n"))
  process.exit(1)
}
console.log("\n打包矩阵预检通过（Windows 本机资源与配置检查）")
console.log("完整 Win/macOS/Linux 安装包 E2E 需在对应 CI runner 上执行 package + 断网启动。")
