export type Channel = "dev" | "beta" | "prod"

/**
 * 把构建期注入的 channel 字符串收敛成合法值。
 *
 * electron-vite 只 define 了 import.meta.env.NOVAWAY_CHANNEL (SCREAMING_SNAKE_CASE)，
 * 读成 PascalCase (NovaWay_CHANNEL) 会得到 undefined 并回退 "dev"，
 * 让 UPDATER_ENABLED 静默恒为 false，自动更新完全不工作。
 * 抽成纯函数方便单测覆盖回归场景。
 */
export function resolveChannel(raw: string | undefined): Channel {
  return raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"
}
