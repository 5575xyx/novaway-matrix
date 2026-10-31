/**
 * GitHub 加速地址。
 *
 * 国内直连 github.com / codeload.github.com / release 资源经常超时。扩展安装、
 * uv 下载、托管 Python 运行时的下载都走这里，保证同一套镜像配置贯穿全链路：
 *
 * - 默认顺序：直连优先，再试公共镜像；
 * - `NOVAWAY_GITHUB_MIRROR` 可用逗号分隔的地址覆盖（内网镜像 / 公司代理），
 *   设置后只用这些前缀。
 */
const DEFAULT_MIRRORS = ["https://ghfast.top/", "https://ghproxy.net/"]

export function githubMirrors(): string[] {
  const override = process.env.NOVAWAY_GITHUB_MIRROR?.trim()
  if (override) {
    return override
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => (item.endsWith("/") ? item : item + "/"))
  }
  return DEFAULT_MIRRORS
}

/** 给一个 https://github.com/... 地址加镜像前缀（直连地址保持原样排在前面）。 */
export function withGithubMirrors(url: string): string[] {
  return [url, ...githubMirrors().map((prefix) => prefix + url)]
}
