/**
 * 安装诊断（doctor）。
 *
 * README 的「安装故障排查」里那些坑——平台包 180MB 超时被 npm 静默跳过、
 * postinstall 没跑、镜像没同步、装到了别的包管理器下——本质都是同一组事实：
 * 包装包在哪、里面的二进制是不是 postinstall 占位脚本、平台包在不在、
 * 当前 registry 是哪个、能不能拿到 latest。
 *
 * 这里不装任何东西，只把这些事实读出来，交给上层（doctor 工具 / UI）判断，
 * 便于 AI 直接在用户机器上给出可执行的下一步。
 */
import fs from "node:fs"
import path from "node:path"
import { NPM_PACKAGE } from "@/installation"

/** 平台包名后缀：<os>-<arch>，与 publish.ts / optionalDependencies 保持一致。 */
export function platformSuffix(osName = process.platform, arch = process.arch) {
  const os = osName === "win32" ? "windows" : osName === "darwin" ? "darwin" : osName
  const cpu = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : arch
  return os + "-" + cpu
}

export type InstallLayout = {
  /** 当前可执行文件（编译后的二进制，或开发时的 bun/node）。 */
  execPath: string
  /** 是否为从源码运行的开发环境。 */
  development: boolean
  /** 包装包目录（含 package.json 的那一层）。 */
  wrapperDir?: string
  /** 包装包名，用于确认真的找对了目录。 */
  wrapperName?: string
  /** 包装包里的二进制路径。 */
  binaryPath?: string
  /** 二进制存在，但内容是 postinstall 占位脚本。 */
  postinstallStub: boolean
  /** 期望的平台包名。 */
  platformPackage: string
  /** 平台包是否能在 node_modules 里解析到。 */
  platformPackagePresent: boolean
  /** 平台包实际解析到的路径。 */
  platformPackageDir?: string
}

const BINARY = process.platform === "win32" ? "novaway.exe" : "novaway"
const STUB_MARKER = "postinstall script was not run"

/** 判断一个文件是不是 publish.ts 生成的占位脚本（而不是真正的二进制）。 */
export function isPostinstallStub(file: string) {
  try {
    const stat = fs.statSync(file)
    // 真正的二进制至少几十 MB；占位脚本只有几百字节。
    if (stat.size > 64 * 1024) return false
    return fs.readFileSync(file, "utf8").includes(STUB_MARKER)
  } catch {
    return false
  }
}

/** 从某个目录向上找 node_modules/<包名>，最多走到根目录。 */
export function findPackageDir(startDir: string, name: string, limit = 12) {
  let current = path.resolve(startDir)
  for (let depth = 0; depth < limit; depth++) {
    const candidate = path.join(current, "node_modules", name)
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
  return undefined
}

function readWrapperName(dir: string) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { name?: unknown }
    return typeof pkg.name === "string" ? pkg.name : undefined
  } catch {
    return undefined
  }
}

export function inspectInstall(input?: {
  execPath?: string
  platform?: NodeJS.Platform
  platformPackagePrefix?: string
  /** 额外候选目录（NOVAWAY_BIN_PATH 等）。 */
  extraRoots?: string[]
}): InstallLayout {
  const execPath = input?.execPath ?? process.execPath
  const osName = input?.platform ?? process.platform
  const prefix = input?.platformPackagePrefix ?? NPM_PACKAGE
  const platformPackage = prefix + "-" + platformSuffix(osName)
  const base = path.basename(execPath).toLowerCase()
  // 开发环境：直接用 bun / node 跑源码，没有包装包概念。
  const development = base.startsWith("bun") || base === "node" || base === "node.exe"

  const binDir = path.dirname(execPath)
  const wrapperDir = development ? undefined : path.dirname(binDir)
  const wrapperName = wrapperDir ? readWrapperName(wrapperDir) : undefined
  const binaryPath = development ? execPath : path.join(binDir, BINARY)

  const searchRoots = [wrapperDir ?? binDir, path.dirname(wrapperDir ?? binDir), ...(input?.extraRoots ?? [])].filter(
    (value): value is string => Boolean(value),
  )
  let platformPackageDir: string | undefined
  for (const root of searchRoots) {
    platformPackageDir = findPackageDir(root, platformPackage)
    if (platformPackageDir) break
  }

  return {
    execPath,
    development,
    wrapperDir,
    wrapperName,
    binaryPath: fs.existsSync(binaryPath) ? binaryPath : undefined,
    postinstallStub: !development && fs.existsSync(binaryPath) ? isPostinstallStub(binaryPath) : false,
    platformPackage,
    platformPackagePresent: Boolean(platformPackageDir),
    platformPackageDir,
  }
}

/** 把安装布局转成一句人话，供 doctor 报告复用。 */
export function describeLayout(layout: InstallLayout) {
  if (layout.development) return "running from source (" + path.basename(layout.execPath) + ")"
  if (layout.postinstallStub) return "postinstall placeholder found at " + layout.binaryPath
  if (!layout.binaryPath) return "compiled binary missing under " + (layout.wrapperDir ?? "unknown")
  return "compiled binary present at " + layout.binaryPath
}
