# External IM channels

NovaWay can answer prompts from Feishu/Lark, Telegram, DingTalk, WeCom and Slack.
The feature is **disabled by default** and every channel is opt-in.

## Config

```jsonc
{
  "channels": {
    "enabled": true,
    "max_restarts": 3,
    "channels": [
      {
        "name": "feishu-main",
        "kind": "feishu",
        "secret_name": "feishu-main", // JSON credentials in the secret store
      },
      {
        "name": "telegram-main",
        "kind": "telegram",
        "bot_token": "123:abc",
      },
      {
        "name": "dingtalk-ops",
        "kind": "dingtalk",
        "webhook": "https://oapi.dingtalk.com/robot/send?access_token=...",
        "sign_secret": "SEC...",
        "port": 8787,
      },
      {
        "name": "slack-main",
        "kind": "slack",
        "bot_token": "xoxb-...",
        "sign_secret": "slack-signing-secret",
        "port": 8788,
      },
    ],
  },
}
```

`secret_name` reads a JSON object from the plugin secret store and takes precedence
over inline values. Keep credentials out of the workspace config when possible.

| kind       | Inbound                               | Outbound                                       |
| ---------- | ------------------------------------- | ---------------------------------------------- |
| `feishu`   | existing Feishu websocket client      | same shared connection                         |
| `telegram` | long polling (`getUpdates`)           | `sendMessage`                                  |
| `dingtalk` | outgoing callback over HTTP (`port`)  | signed group robot webhook or `sessionWebhook` |
| `wecom`    | encrypted callback over HTTP (`port`) | `message/send` with cached access token        |
| `slack`    | Events API over HTTP (`port`)         | `chat.postMessage` (threads preserved)         |

Slack and DingTalk/WeCom inbound receivers only start when `port` is set; nothing
listens by default. Feishu and Telegram connect outbound and need no port.

## Routing and state

- One supervisor per project directory. Restarts only reconnect — consumed
  inbound messages are never replayed, so a user action cannot run twice.
- A channel with no route drops the message and increments its dropped counter.
- When `user_id` is empty, the first sender is bound to that channel and later
  messages from other senders are ignored. State lives in
  `<project>/.novaway/channels/state.json`.
- Sessions are keyed by channel name plus conversation id, so each chat keeps its
  own thread.

## Verification status

Supervisor lifecycle and Slack outbound calls are covered by unit tests with fake
transports and an injected `fetch`. **Real bots (tokens, webhooks, encrypted
callbacks) are not verified in this repository's Windows development environment.**
