export * as ConfigChannels from "./channels"

import { Schema } from "effect"

const Credentials = {
  app_id: Schema.optional(Schema.String).annotate({ description: "Feishu app id" }),
  app_secret: Schema.optional(Schema.String).annotate({ description: "Feishu app secret" }),
  bot_token: Schema.optional(Schema.String).annotate({ description: "Telegram bot token or Slack bot token" }),
  webhook: Schema.optional(Schema.String).annotate({ description: "DingTalk/WeCom outbound webhook URL" }),
  sign_secret: Schema.optional(Schema.String).annotate({
    description: "DingTalk outgoing-webhook signing secret or Slack app signing secret",
  }),
  corp_id: Schema.optional(Schema.String).annotate({ description: "WeCom corp id" }),
  corp_secret: Schema.optional(Schema.String).annotate({ description: "WeCom app secret" }),
  agent_id: Schema.optional(Schema.String).annotate({ description: "WeCom agent id" }),
  callback_token: Schema.optional(Schema.String).annotate({ description: "WeCom callback token" }),
  aes_key: Schema.optional(Schema.String).annotate({ description: "WeCom callback AES key (43 chars)" }),
}

const ChannelInfo = Schema.Struct({
  name: Schema.String.annotate({ description: "Channel instance name, used in the routing map." }),
  kind: Schema.Literals(["feishu", "telegram", "dingtalk", "wecom", "slack"]),
  enabled: Schema.optional(Schema.Boolean).annotate({ description: "Per-channel switch (default: true)" }),
  user_id: Schema.optional(Schema.String).annotate({
    description: "Only accept messages from this sender id. Empty = first sender is bound.",
  }),
  secret_name: Schema.optional(Schema.String).annotate({
    description: "Secret-store entry holding a JSON object of credential fields. Takes precedence over inline values.",
  }),
  host: Schema.optional(Schema.String).annotate({
    description: "Webhook bind host for DingTalk/WeCom/Slack inbound (default: 127.0.0.1).",
  }),
  port: Schema.optional(Schema.Number).annotate({
    description: "Webhook bind port for DingTalk/WeCom/Slack inbound. Omit to disable the inbound listener.",
  }),
  path: Schema.optional(Schema.String).annotate({
    description: "Webhook callback path (default: /channels/<name>).",
  }),
  ...Credentials,
})

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable external IM channels (Feishu, Telegram, DingTalk, WeCom, Slack). Defaults to disabled.",
  }),
  max_restarts: Schema.optional(Schema.Number).annotate({
    description: "Restart attempts before a channel is marked failed (default: 3).",
  }),
  channels: Schema.optional(Schema.mutable(Schema.Array(ChannelInfo))).annotate({
    description: "Configured channel instances. Prefer secret_name for credentials.",
  }),
})

export type Info = Schema.Schema.Type<typeof Info>
export type ChannelInfo = Schema.Schema.Type<typeof ChannelInfo>

export function resolve(info?: Info) {
  return {
    enabled: info?.enabled ?? false,
    max_restarts: Math.max(0, info?.max_restarts ?? 3),
    channels: (info?.channels ?? []).filter((channel) => channel.enabled !== false),
  }
}
