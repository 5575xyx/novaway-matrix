/**
 * 更新检查的调度策略（纯函数）。
 *
 * 单独拆出来是因为 updater.ts 依赖 electron / electron-log / electron-updater，
 * 单测里 mock 它们会跟别的测试文件抢同一个模块（bun 的 mock 是进程级的，
 * 互相覆盖）。策略本身不碰任何 Electron API，直接测这里就够了。
 */

export interface CheckOutcome {
  updateAvailable: boolean
  /** 安装包已经在本地（重启即可安装）。 */
  downloaded?: boolean
}

/**
 * 自动检查（启动 / 定时轮询）查到新版本后，要不要顺手下载。
 *
 * 自动路径要"备好安装包"：用户可能几周不重启，只检查不下载的话更新按钮
 * 永远不出现。手动路径不走这里 —— 那条要停在「有新版本」，等用户点下载。
 */
export function shouldAutoDownload(result: CheckOutcome, alreadyDownloaded: boolean): boolean {
  if (!result.updateAvailable) return false
  if (result.downloaded) return false
  return !alreadyDownloaded
}

/**
 * 定时轮询时要不要在开启的那一刻立刻补查一次。
 *
 * 开机那次检查由主进程负责（启动时已经查过了），渲染层挂载时再查一遍
 * 就是同一个 latest.yml 打两次，还会把正在后台下载的状态短暂拨回「有新版本」。
 * 只有用户中途把开关重新打开（此前已关掉过）才需要立刻补一次。
 */
export function shouldCheckImmediatelyOnEnable(checkedOnLaunch: boolean): boolean {
  return checkedOnLaunch
}

/** 版本号拆成可比较的片段：`1.2.3-beta.4` → { numbers: [1,2,3], pre: ["beta","4"] }。 */
function segments(version: string): { numbers: number[]; pre: string[] } {
  const clean = version.trim().replace(/^v/i, "").split("+")[0]
  const [core, ...rest] = clean.split("-")
  const numbers = core.split(".").map((part) => {
    const value = Number.parseInt(part, 10)
    return Number.isFinite(value) ? value : 0
  })
  const pre = rest.join("-").split(".").filter(Boolean)
  return { numbers, pre }
}

/**
 * 比较两个 semver 版本：a > b 返回 1，相等 0，a < b 返回 -1。
 *
 * 只覆盖我们自己的版本号形态（`1.2.3`、`1.2.3-beta.4`），不追求完整 semver 语义。
 * 预发布版小于同号正式版（`1.2.3-beta` < `1.2.3`）—— 不然「beta 已下载好、
 * 正式版刚发布」会被判成不需要更新。
 */
export function compareVersions(a: string, b: string): number {
  const left = segments(a)
  const right = segments(b)
  const length = Math.max(left.numbers.length, right.numbers.length)
  for (let i = 0; i < length; i++) {
    const x = left.numbers[i] ?? 0
    const y = right.numbers[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  if (left.pre.length === 0 || right.pre.length === 0) {
    // 都没有预发布标记，或其中一个没有：没有标记的那个更大
    if (left.pre.length === right.pre.length) return 0
    return left.pre.length === 0 ? 1 : -1
  }
  const count = Math.max(left.pre.length, right.pre.length)
  for (let i = 0; i < count; i++) {
    const x = left.pre[i]
    const y = right.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = Number(x)
    const ny = Number(y)
    const bothNumeric = Number.isFinite(nx) && Number.isFinite(ny)
    if (bothNumeric && nx !== ny) return nx > ny ? 1 : -1
    if (!bothNumeric && x !== y) return x > y ? 1 : -1
  }
  return 0
}

/**
 * 服务器上出现的新版本，要不要顶掉本地已经下好的那份。
 *
 * 用户可能下完就放着不装，等下次想起来时线上又发了一版：这时要下最新的那份，
 * 安装也以最新为准。反过来，如果线上版本不比本地的已下载版本新（回滚、
 * allowDowngrade 之类），保留本地那份，别越换越旧。
 */
export function shouldReplaceDownloaded(downloaded: string | undefined, candidate: string | undefined): boolean {
  if (!downloaded) return true
  if (!candidate) return false
  return compareVersions(candidate, downloaded) > 0
}

/**
 * 上次运行留下的安装包还能不能用。
 *
 * 缓存目录里的安装包在装上之后不会自己消失，所以必须按版本判断：
 * 只有「记录里的版本 > 当前运行的版本」才代表"还有一份没装"。
 * 否则重启后会把已经装上的那一版当成待安装更新，按钮一直亮着。
 */
export function isPendingUpdateUsable(record: { version?: string } | undefined, currentVersion: string): boolean {
  const version = record?.version?.trim()
  if (!version) return false
  return compareVersions(version, currentVersion) > 0
}
