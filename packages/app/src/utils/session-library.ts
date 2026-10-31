/**
 * 会话语料库的"分支隔离"提示。
 *
 * 服务端在开发构建里把 `NovaWay_CHANNEL` 编译成**当前 git 分支名**，而数据库文件名
 * 是 `novaway-<channel>.db`（见 `packages/novaway/src/storage/db.ts` 的 `getChannelPath`）。
 * 结果是：`git checkout` 到另一个分支后重开应用，会连到另一个全新的库 ——
 * 界面里看起来就像"历史会话全部消失"，其实数据还在原来那个分支的 db 里。
 *
 * 这里不去改存储策略（分支隔离是有意为之：实验性的表结构不该污染日常库），
 * 只把这件事**说出来**：从服务端版本号里解析出通道名，界面上给一句话提示。
 */

const SHARED_CHANNELS = new Set(["latest", "beta", "prod", "local"])

/**
 * 从服务端版本号里取出分支通道。
 *
 * 开发构建的版本形如 `0.0.0-feat/team-orchestration-202610291155`
 * （见 `packages/script/src/index.ts` 的 VERSION）。正式构建是 `1.2.3`，
 * 没有通道前缀 —— 这类返回 undefined，界面不提示。
 */
export function branchChannel(version: string | undefined): string | undefined {
  if (!version) return undefined
  const match = /^0\.0\.0-(.+?)-\d{12,14}$/.exec(version.trim())
  if (!match) return undefined
  const channel = match[1]
  if (!channel || SHARED_CHANNELS.has(channel)) return undefined
  return channel
}
