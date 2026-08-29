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

// 回查「某版本是否真的在 registry 上」必须绕开所有缓存，否则会得到假阴性：
// `npm view` 先命中 npm 自己的 cacache，而 registry 的 packument 又带 `cache-control: max-age=300`，
// 于是刚发布成功的版本在长达 5 分钟内仍可能被报成 E404 —— 0.1.5 的 xymt-novaway-windows-x64
// 就是这么被误判的：它 05:50:09Z 明明发布成功了，回查却一直 404，白重发两次，最后还让整条流程红掉。
// 这里直接打单版本端点 `/<name>/<version>`（200/404 语义明确），并用查询串破 CDN 缓存。
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
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  // 网络实在不通时退回 npm view，--prefer-online 强制回源校验而不是吃本地缓存。
  return (await $`npm view ${name}@${version} version --prefer-online`.nothrow().quiet()).exitCode === 0
}

async function publish(dir: string, name: string, version: string) {
  // GitHub artifact downloads can drop the executable bit, and Docker uses the
  // unpacked dist binaries directly rather than the published tarball.
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(dir)
  if (await published(name, version)) {
    console.log(`already published ${name}@${version}`)
    return
  }
  await $`bun pm pack`.cwd(dir)
  // 180MB+ 的平台包上传偶发失败，且失败方式不止一种（退出码非 0、退出码 0 但 registry 落库很慢）。
  // 所以既不能只信退出码，也不能把回查的 404 直接当成「没发上去」——见 published() 的注释。
  // 发布输出必须打出来：早先这里 .nothrow() 把 npm 的真实报错整个吞掉了，排查时完全瞎。
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await $`npm publish *.tgz --access public --tag ${Script.channel} --fetch-timeout=1800000 --fetch-retries=5`
      .cwd(dir)
      .nothrow()
      .quiet()
    const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim()
    if (output) console.log(output)
    // 「不能覆盖已发布版本」说明它已经在 registry 上了，属于成功而不是失败。
    const conflict = /EPUBLISHCONFLICT|cannot publish over|previously published/i.test(output)
    if (result.exitCode !== 0 && !conflict)
      console.error(`⚠️  npm publish ${name}@${version} 退出码 ${result.exitCode}（第 ${attempt}/3 次）`)
    for (let i = 0; i < 18; i++) {
      if (await published(name, version)) {
        console.log(`✅ verified on registry: ${name}@${version}`)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 10000))
    }
    console.error(`⚠️  ${name}@${version} 发布后 3 分钟内仍未出现在 registry（第 ${attempt}/3 次），重发`)
  }
  throw new Error(`failed to publish ${name}@${version}: registry never served this version after 3 attempts`)
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
    await new Promise((resolve) => setTimeout(resolve, DELAY_AFTER_BATCH))
    console.log(`✅ Rate limit window passed. Continuing with remaining packages...\n`)
    publishCount = 0
  } else if (publishCount < Object.keys(binaries).length) {
    // 包之间延迟 1 分钟
    await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_PACKAGES))
  }
}

await publish(`./dist/${pkg.name}`, MAIN_PACKAGE, version)

// 最后再整体断言一次：主包的每个 optionalDependency 都必须能在 registry 上解析到。
// 少任何一个平台包 = 该平台用户 `npm i -g` 直接失败，这种发布必须报错而不是绿灯。
const missing: string[] = []
for (const [name, ver] of Object.entries(binaries)) {
  if (!(await published(name, ver))) missing.push(`${name}@${ver}`)
}
if (missing.length > 0) {
  console.error(`❌ 平台包缺失，主包 ${MAIN_PACKAGE}@${version} 在这些平台上装不了：${missing.join(", ")}`)
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
