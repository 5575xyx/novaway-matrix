/**
 * Windows Defender 误杀自检与修复引导(纯逻辑,方便测试)。
 *
 * 背景:未签名/自签的 Electron exe 是 Defender 机器学习启发式的高危画像。
 * 实时防护把它隔离后,进程"还活着但 exe 文件没了"(Windows 不删除正在运行的
 * 进程的映像),用户下次启动点快捷方式就弹「Windows 无法找到 NovaWay.exe」。
 *
 * 这里只做"检测 + 生成修复指引",不碰任何系统命令 —— 真正的修复动作
 * (打开 Defender 历史页 / 添加排除项)由用户在 UI 上点击后经 shell 执行。
 */

/** 安装目录可能被隔离的关键文件;只挑 Defender 历史上确实动过的 */
export const CRITICAL_FILES = [
  "NovaWay.exe",
  "ffmpeg.dll",
  "libGLESv2.dll",
  "libEGL.dll",
  "vk_swiftshader.dll",
] as const

export interface DefenderRepairCheck {
  /** 是否判定为"被隔离/缺失" */
  quarantined: boolean
  /** 实际缺失的文件名列表 */
  missing: string[]
  /** 安装目录本身不存在时为 true(快捷方式指向的整个目录被搬空) */
  dirMissing: boolean
}

/** 检查安装目录下关键文件是否被隔离 */
export function checkQuarantine(
  execPath: string,
  exists: (p: string) => boolean,
): DefenderRepairCheck {
  if (process.platform !== "win32") return { quarantined: false, missing: [], dirMissing: false }
  const dir = execPath.replace(/[\\/]([^\\/]+)$/, "")
  if (!exists(execPath)) {
    return { quarantined: true, missing: [CRITICAL_FILES[0]], dirMissing: true }
  }
  const missing = CRITICAL_FILES.filter((f) => f !== CRITICAL_FILES[0] && !exists(`${dir}/${f}`))
  // 主 exe 在但关键 DLL 缺 → 也算中招(Defender 就是这么干的:只留 exe 或只删 exe 都见过)
  return { quarantined: missing.length >= 2, missing, dirMissing: false }
}

/** Windows 安全中心各页面协议链接 */
export const DEFENDER_URIS = {
  /** 病毒和威胁防护 → 保护历史记录 */
  history: "windowsdefender://history",
  /** 病毒和威胁防护设置(排除项入口) */
  settings: "windowsdefender://threatsettings",
} as const

/**
 * 生成"一键加排除"的 PowerShell 命令。管理员运行后把安装目录加进 Defender
 * 白名单 —— 装完不用再被实时防护扫描。
 */
export function exclusionCommand(installDir: string): string {
  return `Start-Process powershell -Verb runAs -ArgumentList '-NoProfile -Command Add-MpPreference -ExclusionPath """${installDir}"""'`
}
