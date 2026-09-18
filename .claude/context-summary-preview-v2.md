# 预览 V2 设计契约：分屏 + dev server 自动发现

生成时间：2026-09-14
任务范围：纯 `packages/app`，不改 `packages/desktop`（WebContentsView 明确推到 V3）

## 已确认的代码事实（编码前验证）

| 事实                                | 位置                                                                                                           | 用途                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| PTY 原始输出流，写入 xterm **之前** | `components/terminal.tsx:556-578` `handleMessage` → `output?.push(data)`                                       | 探测的唯一合理落点，比渲染层嗅探干净 |
| 拖拽手柄已支持横向                  | `packages/ui/src/components/resize-handle.tsx:4` `direction: "horizontal" \| "vertical"`                       | 分屏零新增组件                       |
| 按会话持久化尺寸的既有模式          | `context/layout.tsx:915-926` `todoHeight {get,set}`                                                            | `previewWidth` 照抄                  |
| 拖拽中禁用过渡的助手                | `pages/session/helpers.ts:154` `createSizing()` → `{active,start,touch}`                                       | 复用                                 |
| 可视区上限约定                      | `pages/session/terminal-panel.tsx:44-45` `max = () => store.view * 0.6` / `pane = () => Math.min(size, max())` | 宽度上限照抄                         |
| 图标注册表已有布局三态              | `packages/ui/src/components/icon.tsx` `layout-right` / `layout-right-partial` / `layout-right-full`            | 三态图标自解释，无需新增             |
| i18n parity 测试只校验 2 个 key     | `packages/app/src/i18n/parity.test.ts`（`command.session.previous/next.unseen`）                               | 新增 key 只需 en + zh                |
| desktop 无 WebContentsView          | 全包 grep 零命中                                                                                               | V3 才做，本轮不碰主进程              |

## 关键决策（用户已拍板）

1. **范围**：分屏 + 自动发现，纯 app 层。WebContentsView → V3。
2. **切换入口**：三态循环，一个按钮。`chat → split → preview → chat`，图标始终反映当前状态。
3. **发现呈现**：浮出提示条 + [打开]，按原始规格执行。

## 三态图标映射

| viewMode  | 图标                   | 语义           |
| --------- | ---------------------- | -------------- |
| `chat`    | `layout-right`         | 右侧面板未打开 |
| `split`   | `layout-right-partial` | 右侧部分打开   |
| `preview` | `layout-right-full`    | 右侧全屏       |

比 V1 的 `browser`/`browser-active` 更适合表达第三态；`browser` 仍用于预览面板空状态。

## 布局

```
chat:    [ 聊天内容 (flex-1)                    ]
split:   [ 聊天内容 (flex-1) | handle | 预览 (previewWidth) ]
preview: [ 预览 (flex-1)                        ]

composer：chat / split 显示，preview 隐藏（沿用 V1）
```

`previewWidth` 按会话持久化，默认 640，min 320，上限 `窗口宽度 * 0.6`（照 terminal-panel）。

## 自动发现

### 数据流

```
terminal.tsx handleMessage (WS chunk)
  → devServers.report(chunk)          // 在 output.push 之前
  → context/dev-server.tsx            // 滚动缓冲 + 正则 + 去重
  → suggest() 非空
  → dev-server-suggestion.tsx 浮出提示条
  → 点击 [打开] → preview.setUrl(url) + viewMode.set("split")
```

### 检测算法（`utils/dev-server-detect.ts`，纯函数，可单测）

- **ANSI 剥离**：PTY 输出含转义序列，先 `stripAnsi` 再匹配，否则彩色 URL 会漏
- **滚动缓冲 4096 字符**：PTY 分块边界任意，URL 可能跨两个 chunk；缓冲保证跨块 URL 仍完整。URL < 200 字符，窗口远够
- **只匹配回环/内网**：`localhost` / `127.0.0.1` / `0.0.0.0` / `[::1]` / `10.x` / `172.16-31.x` / `192.168.x`。刻意排除公网地址，避免把终端里随便打印的 URL 当建议（也是 false positive 的主要来源）
- **归一化**：取 origin（剥路径）；`0.0.0.0` → `localhost`（0.0.0.0 不是可靠的目标地址）
- **去重**：detector 生命周期内不重复建议；用户忽略后不会立刻再弹

### 作用域

detector 按 **workspace 重建**（监听 `sdk.directory` 变化）。避免在 A 工作区看到 B 工作区的陈旧建议。代价约 5 行，行为正确性值得。

## 新增文件（5）

| 文件                                      | 职责                                                   |
| ----------------------------------------- | ------------------------------------------------------ |
| `utils/dev-server-detect.ts`              | 纯检测逻辑 + `createDevServerDetector()`               |
| `utils/dev-server-detect.test.ts`         | 检测单测                                               |
| `context/preview.tsx`                     | `usePreview()` `{url, setUrl}`，按 workspace 持久化    |
| `context/dev-server.tsx`                  | `useDevServers()` `{suggest, report, accept, dismiss}` |
| `pages/session/dev-server-suggestion.tsx` | 浮出提示条 UI                                          |

## 修改文件（7）

| 文件                                    | 改动                                                         |
| --------------------------------------- | ------------------------------------------------------------ |
| `context/layout.tsx`                    | `viewMode` 三态 + `toggle()` 循环 + `previewWidth {get,set}` |
| `pages/session.tsx`                     | 分屏布局 + ResizeHandle + 挂载提示条                         |
| `components/session/session-header.tsx` | 三态循环按钮 + `layout-right-*` 图标 + 角标                  |
| `pages/session/preview-panel.tsx`       | 改用 `usePreview()`（持久化上移）                            |
| `components/terminal.tsx`               | `handleMessage` 喂 `devServers.report(data)`                 |
| `app.tsx`                               | 挂 `PreviewProvider` + `DevServerProvider`                   |
| `i18n/en.ts` + `zh.ts`                  | 新增 key                                                     |

## 风险与缓解

| 风险                        | 等级 | 缓解                                              |
| --------------------------- | ---- | ------------------------------------------------- |
| 终端输出含 ANSI 导致漏检    | 中   | `stripAnsi` 在匹配前执行                          |
| URL 跨 chunk 被切断         | 中   | 4096 滚动缓冲                                     |
| 误报公网 URL 骚扰用户       | 中   | 只匹配回环/内网，排除公网                         |
| 提示条遮挡会话内容          | 低   | 绝对定位右下角，仅在 `suggest()` 非空时出现       |
| split 宽度在窄窗口溢出      | 低   | `pane = Math.min(width, 窗口*0.6)` + min 320 钳制 |
| V1 已持久化的 `viewMode` 值 | 无   | 旧值 `chat`/`preview` 是新的三态子集，无需迁移    |

## 验收标准

1. 标题栏按钮循环 chat → split → preview → chat，图标与 tooltip 同步
2. split 下可横向拖拽调整预览宽度，拖拽不触发宽度过渡动画，拖到 320 以下不折叠（保留预览）
3. 刷新/重启后 split 宽度与模式按会话恢复
4. 终端里 dev server 打印 `http://localhost:XXXX` 后提示条浮出；点 [打开] 填入地址并切到 split
5. 忽略建议后不重复弹；不同端口分别弹
6. 切换 workspace 后建议重置
7. `bun typecheck`、oxlint、i18n parity 全绿；新增单测通过
