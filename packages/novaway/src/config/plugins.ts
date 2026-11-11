export * as ConfigPlugins from "./plugins"

import { NonNegativeInt } from "@novaway/core/schema"
import { Schema } from "effect"

/**
 * `plugins` 命名空间（§12.3）。
 *
 * 和已有的 `plugin` 不是一回事，也不合并：`plugin` 是**安装来源**列表（npm spec / 路径），
 * 回答「装什么」；这里的 `plugins` 是**运行期覆盖**，回答「装好的这批在本机怎么用」——
 * 停用谁、给谁传设置、谁的排序权重更高。把两者塞进同一个键会让 `["acme"]` 这种字符串
 * 一会儿是 spec 一会儿是开关，配置文件读的人猜不动。
 *
 * 密钥不进这里：§12.3 明确「密钥类字段写入 secrets 存储，不落 novaway.json」，
 * 所以 `config.<id>` 的值只放声明式设置。
 */
export const Info = Schema.Struct({
  disabled: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Plugin IDs to keep disabled on this machine, regardless of where they were installed from",
  }),
  config: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))).annotate({
    description:
      "Per-plugin declarative settings, read by the plugin through ctx.config. Secrets belong in the secrets store, not here",
  }),
  overrides: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        priority: Schema.optional(NonNegativeInt).annotate({
          description: "Ordering weight for this plugin's contributions (design doc §4.9). Higher wins ties",
        }),
      }),
    ),
  ).annotate({
    description: "Per-plugin ordering overrides, applied on top of whatever the manifest declares",
  }),
})
export type Info = Schema.Schema.Type<typeof Info>

export function isDisabled(info: Info | undefined, pluginID: string) {
  return info?.disabled?.includes(pluginID) ?? false
}

/** 插件读到的设置；没写过就是 undefined，由 `ctx.config` 侧决定默认值。 */
export function options(info: Info | undefined, pluginID: string) {
  return info?.config?.[pluginID]
}

export function priority(info: Info | undefined, pluginID: string) {
  return info?.overrides?.[pluginID]?.priority
}
