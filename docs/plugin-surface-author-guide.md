# Surface 插件作者指南

Surface 是声明式贡献，不需要把 Solid/React 组件加载进宿主进程。第三方插件可以贡献侧栏、设置、会话、消息 renderer、预览器和其他 UI 入口。

## 安全边界

- `http`/`https` iframe 运行在 `sandbox="allow-scripts"` 且 `referrerPolicy="no-referrer"` 下。
- `builtin` component 只允许内置插件；第三方插件必须使用 iframe 或声明式 settings。
- Surface action 的 `command` 只能引用同一插件声明的 command。宿主命令（例如 `settings.*`、`session.*`、`plugin.*`）会在 manifest 解析时拒绝。
- command action 会把 `/command` 填入当前输入框，不会绕过输入框直接调用宿主 command。
- `secret` 字段只提供密码输入样式；值会以明文保存在插件配置文件中，请在插件文档中明确告知用户。

## 示例

```json
{
  "apiVersion": 2,
  "kind": "declarative",
  "name": "acme-dashboard",
  "activationEvents": ["onView:acme-dashboard.dashboard"],
  "contributes": {
    "commands": [{ "id": "refresh", "description": "Refresh dashboard", "template": "/refresh" }],
    "surfaces": [
      {
        "slot": "sidebar.item",
        "id": "dashboard",
        "title": "Dashboard",
        "icon": "dot-grid",
        "action": {
          "type": "view",
          "viewId": "acme-dashboard.dashboard",
          "render": { "type": "iframe", "url": "https://example.test/dashboard.html" }
        }
      },
      {
        "slot": "settings.section",
        "id": "settings",
        "title": "Dashboard settings",
        "view": {
          "type": "declarative",
          "fields": [
            { "key": "token", "type": "secret", "label": "Token" },
            { "key": "enabled", "type": "boolean", "label": "Enabled", "default": true }
          ]
        }
      }
    ],
    "previewers": [
      {
        "id": "dashboard-data",
        "match": { "extension": ".acmedata" },
        "render": { "type": "iframe", "url": "https://example.test/preview.html" },
        "priority": 10
      }
    ],
    "storage": { "namespace": "acme-dashboard", "migrations": "./migrations" }
  }
}
```

An iframe receives a `novaway.plugin.init` message after load. Its payload contains `pluginID`, `viewID`, and the contribution data. It may request a same-plugin command with:

```js
window.parent.postMessage(
  {
    type: "novaway.plugin.action",
    pluginID: "acme-dashboard",
    command: "refresh",
  },
  "*",
)
```

The host validates the owning plugin and command declaration before placing the slash command in the composer.
