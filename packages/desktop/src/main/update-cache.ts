/**
 * 更新安装包的缓存目录：定位、清理。
 *
 * electron-updater 把安装包放在 `<系统缓存目录>/<updaterCacheDirName>/pending/`，
 * **装完之后不会删除**。用户每更新一次就留下一个几百 MB 的安装包，几个月下来
 * 是几个 G 的垃圾。这里负责两件事：
 *
 * 1. 找到那个目录（electron-updater 自己用 `getAppCacheDir()` + app-update.yml 的
 *    `updaterCacheDirName`，我们照它的规则拼一遍，不碰它的私有字段）；
 * 2. 只保留"还没装的这一份"，其它（已装版本的安装包、半成品、旧的 blockmap）删掉。
 */
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

/** 和 electron-updater 的 AppAdapter.getAppCacheDir 保持一致。 */
export function systemCacheRoot(): string {
  if (process.platform === "win32") return process.env["LOCALAPPDATA"] || join(homedir(), "AppData", "Local")
  if (process.platform === "darwin") return join(homedir(), "Library", "Caches")
  return process.env["XDG_CACHE_HOME"] || join(homedir(), ".cache")
}

/**
 * 从 app-update.yml 里读 `updaterCacheDirName`。
 *
 * 只做一行正则：这个文件是 electron-builder 生成的固定格式，用 YAML 解析器
 * 只为读一个键不值当（而且 dev 环境下文件不存在，要能安静地回退）。
 */
export function readUpdaterCacheDirName(configFile: string): string | undefined {
  try {
    if (!existsSync(configFile)) return undefined
    const text = readFileSync(configFile, "utf8")
    const match = text.match(/^updaterCacheDirName:\s*(.+)$/m)
    return match?.[1]?.trim().replace(/^["']|["']$/g, "") || undefined
  } catch {
    return undefined
  }
}

/** electron-updater 的更新缓存根目录（安装包在它的 `pending/` 子目录里）。 */
export function updaterCacheDir(options: { baseCachePath: string; dirName?: string; appName: string }): string {
  return join(options.baseCachePath, options.dirName || options.appName)
}

export function pendingDir(cacheDir: string): string {
  return join(cacheDir, "pending")
}

/** 安装包的扩展名（各平台 electron-builder 的产物）。 */
const INSTALLER_EXTENSIONS = [".exe", ".msi", ".dmg", ".pkg", ".zip", ".deb", ".rpm", ".AppImage"]

function isInstallerFile(name: string): boolean {
  return INSTALLER_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension))
}

function listFiles(dir: string): { path: string; name: string; size: number }[] {
  try {
    if (!existsSync(dir)) return []
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      try {
        const info = statSync(path)
        return info.isFile() ? [{ path, name, size: info.size }] : []
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

function remove(path: string) {
  try {
    unlinkSync(path)
  } catch {
    /* 文件被占用/已删除都无所谓 */
  }
}

export interface PruneResult {
  removed: string[]
  freedBytes: number
}

/**
 * 清理更新缓存。
 *
 * `keep` 是"还不能删"的那一份安装包（上次下好但用户还没装）。传空表示
 * 没有待安装的更新 —— 那就把缓存目录里所有安装包和分片包都清掉，
 * 包括 `pending/` 下 electron-updater 自己的 `update-info.json` 和 blockmap。
 *
 * 刻意保留缓存根目录的 `current.blockmap`：下次更新时 electron-updater 靠它
 * 做差量下载，删了只会让用户多下几十 MB。
 */
export function pruneUpdateCache(cacheDir: string, keep?: string): PruneResult {
  const removed: string[] = []
  let freedBytes = 0

  const keepName = keep ? basename(keep) : undefined
  const keepVersion = keepName?.match(/(\d+\.\d+\.\d+(?:[-.][\w.]+)?)/)?.[1]

  // 1) pending/：上一次更新的工作目录，除了待安装的那一份都可以删。
  for (const file of listFiles(pendingDir(cacheDir))) {
    if (keepName && file.name === keepName) continue
    // 「还有一份没装」时，electron-updater 要靠 update-info.json 里的 sha512
    // 认领本地安装包（重启后不重新下载），必须留着。
    if (keepName && file.name === "update-info.json") continue
    // 同一版本的差量包 / 元数据跟着保留
    if (keepVersion && file.name.includes(keepVersion)) continue
    remove(file.path)
    removed.push(file.path)
    freedBytes += file.size
  }

  // 2) 缓存根目录：旧版 electron-updater 会把安装包直接放在这里。
  for (const file of listFiles(cacheDir)) {
    if (file.name === "current.blockmap") continue
    if (keepName && file.name === keepName) continue
    if (!isInstallerFile(file.name)) continue
    remove(file.path)
    removed.push(file.path)
    freedBytes += file.size
  }

  return { removed, freedBytes }
}
