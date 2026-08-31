#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@novaway/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

// npm 上的主包名（用户 `npm i -g` 装的就是它）。平台二进制包为 `${MAIN_PACKAGE}-<os>-<arch>`，
// 由 build.ts 产出并挂在主包的 optionalDependencies 下，npm 按 os/cpu 只装匹配的那个。
// 默认 xymt-novaway（账号 A）；备份发布到另一账号时用 NOVAWAY_MAIN_PACKAGE=novaway 切换（并把 NPM_TOKEN 换成该账号）。
const MAIN_PACKAGE = process.env.NOVAWAY_MAIN_PACKAGE || "xymt-novaway"
const REGISTRY = (process.env.NOVAWAY_PUBLISH_REGISTRY || "https://registry.npmjs.org").replace(/\/$/, "")

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// 回查「某版本是否真的在 registry 上」必须绕开所有缓存，否则会得到假阴性：
// `npm view` 先命中 npm 自己的 cacache，而 registry 的 packument 又带 `cache-control: max-age=300`，
// 于是刚发布成功的版本在长达 5 分钟内仍可能被报成 E404 —— 0.1.5 的 xymt-novaway-windows-x64
// 就是这么被误判的：它 05:50:09Z 明明发布成功了，回查却一直 404，白重发两次，最后还让整条流程红掉。
// 这里直接打单版本端点 `/<name>/<version>`（200/404 语义明确），并用查询串破 CDN 缓存。
// 注意 404 只代表「还没上线」，不代表「没收下」——staging 期间也是 404，见 publish()。
async function published(name: string, version: string) {
  const url = `${REGISTRY}/${encodeURIComponent(name)}/${encodeURIComponent(version)}?_=${Date.now()}`
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "cache-control": "no-cache", pragma: "no-cache" },
        signal: AbortSignal.timeout(30000),
      })
      if (res.status === 200) return true
      if (res.status === 404) return false
      console.error(`registry ${res.status} for ${name}@${version}`)
    } catch (error) {
      console.error(`registry probe failed for ${name}@${version}: ${error}`)
    }
    await sleep(3000)
  }
  // 网络实在不通时退回 npm view，--prefer-online 强制回源校验而不是吃本地缓存。
  return (await $`npm view ${name}@${version} version --prefer-online`.nothrow().quiet()).exitCode === 0
}

// npm 对大 tarball 启用了 staged package 流程：上传成功后包不会立刻上线，而是先进处理队列
// （publish 输出里那句 "Your package is being processed and may take a few minutes to
// become available."）。staging 期间 `GET /<name>/<version>` 照样 404，而重发会拿到
// `E409 Cannot publish over previously staged version` —— 这个 409 恰恰是「npm 已经收下了」
// 的铁证，不是失败。0.1.6 的 windows-x64 就是这么被误判的：白重发两次 183MB，最后 throw，
// 害得 darwin-x64 / linux-x64 / 主包根本没发出去（比原来的 bug 更糟：残缺发布）。
const ACCEPTED = /EPUBLISHCONFLICT|cannot publish over|previously published|previously staged/i
const STAGING = /being processed and may take a few minutes/i

/** 已上线返回 "live"；已被 registry 收下但还在 staging 返回 "staged"（绝不重发）。 */
async function publish(dir: string, name: string, version: string): Promise<"live" | "staged"> {
  // GitHub artifact downloads can drop the executable bit, and Docker uses the
  // unpacked dist binaries directly rather than the published tarball.
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(dir)
  if (await published(name, version)) {
    console.log(`already published ${name}@${version}`)
    return "live"
  }
  await $`bun pm pack`.cwd(dir)
  // 发布输出必须打出来：早先这里 .nothrow() 把 npm 的真实报错整个吞掉了，排查时完全瞎。
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await $`npm publish *.tgz --access public --tag ${Script.channel} --fetch-timeout=1800000 --fetch-retries=5`
      .cwd(dir)
      .nothrow()
      .quiet()
    const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim()
    if (output) console.log(output)

    // 退出码 0，或者 npm 明说「这个版本我已经有了/已经收下了」，都算收下。
    if (result.exitCode !== 0 && !ACCEPTED.test(output)) {
      console.error(`⚠️  npm publish ${name}@${version} 退出码 ${result.exitCode}（第 ${attempt}/3 次），重发`)
      await sleep(15000)
      continue
    }
    if (STAGING.test(output)) console.log(`⏳ ${name}@${version} 已进入 npm staging 队列，等待上线`)

    // 已经收下了，接下来只等上线，**绝不重发**：staging 期间重发只会 409，
    // 白传 183MB 还把 CI 时间耗光。3 分钟没上线就先去发别的包，最后统一复核。
    for (let i = 0; i < 18; i++) {
      if (await published(name, version)) {
        console.log(`✅ verified on registry: ${name}@${version}`)
        return "live"
      }
      await sleep(10000)
    }
    console.log(`⏳ ${name}@${version} 仍在 staging，先继续后面的包，最后统一等它上线`)
    return "staged"
  }
  throw new Error(`failed to publish ${name}@${version}: npm publish 连续 3 次都没被 registry 收下`)
}

/** 轮询等一批版本真正上线。staging 可能要十几分钟，所以给足窗口再判死。 */
async function waitForLive(entries: [string, string][], minutes: number) {
  const deadline = Date.now() + minutes * 60_000
  while (true) {
    const missing: string[] = []
    for (const [name, version] of entries) if (!(await published(name, version))) missing.push(`${name}@${version}`)
    if (missing.length === 0) return []
    if (Date.now() > deadline) return missing
    console.log(`⏳ 等待 staging 上线（剩 ${Math.ceil((deadline - Date.now()) / 60_000)} 分钟）：${missing.join(", ")}`)
    await sleep(30000)
  }
}


const binaries: Record<string, string> = {}
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const pkg = await Bun.file(`./dist/${filepath}`).json()
  binaries[pkg.name] = pkg.version
}
console.log("binaries", binaries)
const version = Object.values(binaries)[0]

await $`mkdir -p ./dist/${pkg.name}`
await $`mkdir -p ./dist/${pkg.name}/bin`
await $`cp ./script/postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`
await Bun.file(`./dist/${pkg.name}/LICENSE`).write(await Bun.file("../../LICENSE").text())
await Bun.file(`./dist/${pkg.name}/bin/${pkg.name}.exe`).write(
  [
    `echo "Error: ${MAIN_PACKAGE}'s postinstall script was not run." >&2`,
    'echo "" >&2',
    'echo "This occurs when using --ignore-scripts during installation, or when using a" >&2',
    'echo "package manager like pnpm that does not run postinstall scripts by default." >&2',
    'echo "" >&2',
    'echo "To fix this, run the postinstall script manually:" >&2',
    `echo "  cd node_modules/${MAIN_PACKAGE} && node postinstall.mjs" >&2`,
    'echo "" >&2',
    `echo "Or reinstall ${MAIN_PACKAGE} without the --ignore-scripts flag." >&2`,
    "exit 1",
    "",
  ].join("\n"),
)

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: MAIN_PACKAGE,
      bin: {
        [pkg.name]: `./bin/${pkg.name}.exe`,
      },
      scripts: {
        postinstall: "node ./postinstall.mjs",
      },
      version: version,
      license: pkg.license,
      os: ["darwin", "linux", "win32"],
      cpu: ["arm64", "x64"],
      optionalDependencies: binaries,
      repository: {
        type: "git",
        url: "https://github.com/5575xyx/novaway-matrix.git",
      },
      description: "AI coding agent built for the terminal - NovaWay Matrix Edition",
      keywords: ["ai", "cli", "coding-assistant", "novaway", "opencode"],
    },
    null,
    2,
  ),
)

// npm 免费账户限制：每小时 10 个包
// 策略：发布 8 个包后暂停 1 小时，然后继续发布剩余包
let publishCount = 0
const MAX_PACKAGES_PER_HOUR = 8 // 留 2 个配额余量
const DELAY_BETWEEN_PACKAGES = 60000 // 1 分钟
const DELAY_AFTER_BATCH = 3660000 // 1 小时 + 1 分钟

for (const [name] of Object.entries(binaries)) {
  await publish(`./dist/${name}`, name, binaries[name])
  publishCount++

  if (publishCount >= MAX_PACKAGES_PER_HOUR && publishCount < Object.keys(binaries).length) {
    console.log(`\n⏸️  Published ${publishCount} packages. Waiting 1 hour to avoid npm rate limit...`)
    await sleep(DELAY_AFTER_BATCH)
    console.log(`✅ Rate limit window passed. Continuing with remaining packages...\n`)
    publishCount = 0
  } else if (publishCount < Object.keys(binaries).length) {
    // 包之间延迟 1 分钟
    await sleep(DELAY_BETWEEN_PACKAGES)
  }
}

// 平台包全部上线之后才发主包：主包的 optionalDependencies 指向这些版本，
// 先上线主包会让用户装到一个依赖还不存在的版本。
const stillStaging = await waitForLive(Object.entries(binaries), 20)
if (stillStaging.length > 0) {
  console.error(`❌ 这些平台包 20 分钟后仍未上线，主包不发布（避免用户装到装不上的版本）：${stillStaging.join(", ")}`)
  console.error(`   npm staging 队列可能还在处理。等它上线后用同一版本号重跑本工作流即可补发（已上线的会跳过）。`)
  process.exit(1)
}

await publish(`./dist/${pkg.name}`, MAIN_PACKAGE, version)

// 最后再整体断言一次：主包和每个 optionalDependency 都必须能在 registry 上解析到。
// 少任何一个平台包 = 该平台用户 `npm i -g` 直接失败，这种发布必须报错而不是绿灯。
const missing = await waitForLive([...Object.entries(binaries), [MAIN_PACKAGE, version]], 10)
if (missing.length > 0) {
  console.error(`❌ 发布未完成，这些包没能上线：${missing.join(", ")}`)
  process.exit(1)
}
console.log(`✅ ${MAIN_PACKAGE}@${version} + ${Object.keys(binaries).length} 个平台包全部在 registry 上验证通过`)

const image = "ghcr.io/anomalyco/opencode"
const platforms = "linux/amd64,linux/arm64"
const tags = [`${image}:${version}`, `${image}:${Script.channel}`]
const tagFlags = tags.flatMap((t) => ["-t", t])

// registries
// 默认仅发布 npm(平台包 + xymt-novaway 主包)。Docker/AUR/Homebrew 仍指向 opencode 官方仓库,
// 需显式设 NOVAWAY_PUBLISH_EXTRAS=true 才会执行(且需先把下面的镜像/tap 改成你自己的)。
if (!Script.preview && process.env.NOVAWAY_PUBLISH_EXTRAS === "true") {
  await $`docker buildx build --platform ${platforms} ${tagFlags} --push .`
  // Calculate SHA values
  const arm64Sha = await $`sha256sum ./dist/opencode-linux-arm64.tar.gz | cut -d' ' -f1`.text().then((x) => x.trim())
  const x64Sha = await $`sha256sum ./dist/opencode-linux-x64.tar.gz | cut -d' ' -f1`.text().then((x) => x.trim())
  const macX64Sha = await $`sha256sum ./dist/opencode-darwin-x64.zip | cut -d' ' -f1`.text().then((x) => x.trim())
  const macArm64Sha = await $`sha256sum ./dist/opencode-darwin-arm64.zip | cut -d' ' -f1`.text().then((x) => x.trim())

  const [pkgver, _subver = ""] = Script.version.split(/(-.*)/, 2)

  // arch
  const binaryPkgbuild = [
    "# Maintainer: dax",
    "# Maintainer: adam",
    "",
    "pkgname='opencode-bin'",
    `pkgver=${pkgver}`,
    `_subver=${_subver}`,
    "options=('!debug' '!strip')",
    "pkgrel=1",
    "pkgdesc='The AI coding agent built for the terminal.'",
    "url='https://github.com/anomalyco/opencode'",
    "arch=('aarch64' 'x86_64')",
    "license=('MIT')",
    "provides=('opencode')",
    "conflicts=('opencode')",
    "depends=('ripgrep')",
    "",
    `source_aarch64=("\${pkgname}_\${pkgver}_aarch64.tar.gz::https://github.com/anomalyco/opencode/releases/download/v\${pkgver}\${_subver}/opencode-linux-arm64.tar.gz")`,
    `sha256sums_aarch64=('${arm64Sha}')`,

    `source_x86_64=("\${pkgname}_\${pkgver}_x86_64.tar.gz::https://github.com/anomalyco/opencode/releases/download/v\${pkgver}\${_subver}/opencode-linux-x64.tar.gz")`,
    `sha256sums_x86_64=('${x64Sha}')`,
    "",
    "package() {",
    '  install -Dm755 ./opencode "${pkgdir}/usr/bin/opencode"',
    "}",
    "",
  ].join("\n")

  for (const [pkg, pkgbuild] of [["opencode-bin", binaryPkgbuild]]) {
    for (let i = 0; i < 30; i++) {
      try {
        await $`rm -rf ./dist/aur-${pkg}`
        await $`git clone ssh://aur@aur.archlinux.org/${pkg}.git ./dist/aur-${pkg}`
        await $`cd ./dist/aur-${pkg} && git checkout master`
        await Bun.file(`./dist/aur-${pkg}/PKGBUILD`).write(pkgbuild)
        await $`cd ./dist/aur-${pkg} && makepkg --printsrcinfo > .SRCINFO`
        await $`cd ./dist/aur-${pkg} && git add PKGBUILD .SRCINFO`
        if ((await $`cd ./dist/aur-${pkg} && git diff --cached --quiet`.nothrow()).exitCode === 0) break
        await $`cd ./dist/aur-${pkg} && git commit -m "Update to v${Script.version}"`
        await $`cd ./dist/aur-${pkg} && git push`
        break
      } catch {
        continue
      }
    }
  }

  // Homebrew formula
  const homebrewFormula = [
    "# typed: false",
    "# frozen_string_literal: true",
    "",
    "# This file was generated by GoReleaser. DO NOT EDIT.",
    "class Opencode < Formula",
    `  desc "The AI coding agent built for the terminal."`,
    `  homepage "https://github.com/anomalyco/opencode"`,
    `  version "${Script.version.split("-")[0]}"`,
    "",
    `  depends_on "ripgrep"`,
    "",
    "  on_macos do",
    "    if Hardware::CPU.intel?",
    `      url "https://github.com/anomalyco/opencode/releases/download/v${Script.version}/opencode-darwin-x64.zip"`,
    `      sha256 "${macX64Sha}"`,
    "",
    "      def install",
    '        bin.install "opencode"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm?",
    `      url "https://github.com/anomalyco/opencode/releases/download/v${Script.version}/opencode-darwin-arm64.zip"`,
    `      sha256 "${macArm64Sha}"`,
    "",
    "      def install",
    '        bin.install "opencode"',
    "      end",
    "    end",
    "  end",
    "",
    "  on_linux do",
    "    if Hardware::CPU.intel? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/anomalyco/opencode/releases/download/v${Script.version}/opencode-linux-x64.tar.gz"`,
    `      sha256 "${x64Sha}"`,
    "      def install",
    '        bin.install "opencode"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/anomalyco/opencode/releases/download/v${Script.version}/opencode-linux-arm64.tar.gz"`,
    `      sha256 "${arm64Sha}"`,
    "      def install",
    '        bin.install "opencode"',
    "      end",
    "    end",
    "  end",
    "end",
    "",
    "",
  ].join("\n")

  const token = process.env.GITHUB_TOKEN
  if (!token) {
    console.error("GITHUB_TOKEN is required to update homebrew tap")
    process.exit(1)
  }
  const tap = `https://x-access-token:${token}@github.com/anomalyco/homebrew-tap.git`
  await $`rm -rf ./dist/homebrew-tap`
  await $`git clone ${tap} ./dist/homebrew-tap`
  await Bun.file("./dist/homebrew-tap/opencode.rb").write(homebrewFormula)
  await $`cd ./dist/homebrew-tap && git add opencode.rb`
  if ((await $`cd ./dist/homebrew-tap && git diff --cached --quiet`.nothrow()).exitCode !== 0) {
    await $`cd ./dist/homebrew-tap && git commit -m "Update to v${Script.version}"`
    await $`cd ./dist/homebrew-tap && git push`
  }
}
