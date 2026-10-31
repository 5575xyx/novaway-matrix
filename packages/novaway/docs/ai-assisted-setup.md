# AI 辅助安装（AI-assisted setup）

目标：用户不需要自己装环境、敲命令。应用内的确定性安装流程负责「正常情况」，
AI 负责「正常流程走不通时怎么办」——判断原因、换路径、解释结果。

## 交互形态

1. 页面上出现「缺失 / 失败」提示时，旁边同时给出两个入口：
   - **立即安装**：走确定性流程，最快；
   - **让 AI 帮我装 / 帮我处理**：新建会话，把状态、错误、hint 和日志尾部交给 Agent。
2. Agent 第一选择是调用对应的 `*_setup` 工具（复用同一套安装代码），
   只有工具返回失败时才回退到终端逐步排查。
3. 安装类工具调用前会走 `ctx.ask` 权限确认，不会静默改环境。

## 现有工具

| 工具                     | 动作                 | 背后复用的逻辑                                                                                                                                                             |
| ------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `knowledge_ocr`          | `status` / `install` | `knowledge/ocr-install.ts`：隔离 venv、自动准备 Python（uv）、PyPI 镜像回退、导入验证                                                                                      |
| `memory_embedding_setup` | `status` / `install` | `memory/ollama-setup.ts`：检测 / 安装 Ollama / 启动服务 / 拉取嵌入模型                                                                                                     |
| `installation_doctor`    | `status` / `upgrade` | `installation/diagnose.ts` + `installation/index.ts`：识别安装方式、检查包装包/二进制（含 postinstall 占位脚本）、平台包是否解包、registry、当前与最新版本；可选走镜像升级 |

## 结果形状

底层两个安装器返回结构不同（`InstallResult` vs `SetupResult { ok, status, steps }`），
统一在 `src/setup/report.ts` 里转换成给模型看的一份报告：

```ts
formatSetupReport({ domain, ready, phase, summary, facts, hint, error, steps, next })
```

顺序固定为：结论 → 事实 → hint → error → 步骤 → 下一步。新增能力时复用这个格式，
模型读到的结构就是一致的，不用每个工具各写一套拼字符串。

## 安装诊断（doctor）

`installation/diagnose.ts` 只读事实，不装东西；`tool/installation-doctor.ts` 负责判断与执行。

它能识别的典型问题（对应 README 的排查章节）：

| 现象                                               | 检查点                                                       | 建议动作                    |
| -------------------------------------------------- | ------------------------------------------------------------ | --------------------------- |
| `Try manually installing xymt-novaway-<os>-<arch>` | 平台包目录是否存在于 node_modules                            | 换镜像重装                  |
| `postinstall script was not run`                   | 包装包 `bin/` 下的文件是否是占位脚本（体积 < 64KB 且含标记） | 补跑 `node postinstall.mjs` |
| 升级失败 / 版本停旧                                | registry、latest 能否取到                                    | 用 `--registry` 走镜像      |
| 安装方式未知                                       | `Installation.method()` 返回 unknown                         | 用 npm 重装并说明来源       |

升级动作只在用户明确要求时执行，且先走 `ctx.ask` 权限确认。

## 语言工具链（LSP）

`lsp_setup` 没有另写安装逻辑，而是复用 `server.spawn()` 里已有的「缺二进制就自动装」分支：

1. 按 `language`（如 `go` / `.rs`）或 `server`（如 `gopls`）匹配服务端；
2. 用项目目录构造一个探测文件路径，交给 `server.root()` 找根目录；
3. 调 `server.spawn()`：缺二进制时它自己安装；返回 handle 说明成功，随即 `Process.stop()` 停掉进程；
4. 失败时报告「缺前置工具链」，让 AI 说明该装 Go / Ruby / Zig / .NET / Node 中的哪一个。

入口在状态面板的 LSP 标签页：没有服务端在运行或有 `error` 时出现。

## MCP 接入

`mcp_setup` 把「状态 + 配置 + 本机探测」拼在一起判断：

| 状态                        | 诊断                             | AI 的动作                                                    |
| --------------------------- | -------------------------------- | ------------------------------------------------------------ |
| `failed`                    | 命令不存在 / URL 非法 / 启动报错 | 指出缺哪个运行时，或让用户改配置后 `action=connect`          |
| `needs_auth`                | 需要 OAuth                       | `action=authenticate` 打开浏览器完成授权；失败时给出手动链接 |
| `needs_client_registration` | 服务端不支持动态注册             | 指出要补 `oauth.clientId`                                    |
| 环境变量为空                | 只报变量名与 `(empty)`           | 让用户填值，绝不编造凭据                                     |
| 未配置                      | 空列表                           | 可用 `action=add` 添加目录里的常见服务器                     |

注意：`action=add` 会写入用户级配置文件，失败时不会落盘（先连上再写）。

## 供应商与模型

`provider_setup` 解决的是「Key 填了但拉不到模型」这类问题：

| 现象               | 检查                                                          | 动作                              |
| ------------------ | ------------------------------------------------------------- | --------------------------------- |
| 连不上 / 401 / 404 | `status` 报告 auth 类型与 baseURL                             | 缺 Key 让用户去设置里填           |
| 模型列表为空       | `probe` 依次试 `原始 / 去掉 chat/completions / 补 v1 / 去 v1` | 找到可用地址后 `configure`        |
| 想知道能不能看图   | `status` 统计 `vision=` 与 `tools=` 模型数                    | 据此选模型（例如知识库 OCR 兜底） |

安全边界：工具**从不返回 API Key**，只报告「有没有 Key」与认证类型（`api` / `oauth` / `env`）；
`configure` 写配置前会走权限确认。

## 办公平台（飞书 / 腾讯文档）

| 现象                     | 检查点                                     | 说明                                      |
| ------------------------ | ------------------------------------------ | ----------------------------------------- |
| 显示「未配置」但明明填了 | `feishuView()` 合并了已保存配置 + 环境变量 | 顺带修了 `status()` 只看 env 的旧问题     |
| 只填了 App ID            | `feishuMode()` 返回 `incomplete`           | App Secret 必须同时填写，否则长连接起不来 |
| 凭据疑似错误             | `action=verify` 调开放平台换取 token       | 不发消息、不回显密钥，只回错误码          |
| 不知道下一步             | `action=guide` 返回有序清单                | 让 AI 只讲用户缺的那一步                  |
| 腾讯文档                 | 只判断令牌是否存在                         | 有效性要到实际发布时才会暴露              |

安全边界：**不接受、不写入、不回显**任何 App Secret / 令牌；需要填写时只指引到设置页。

## 对话里直接说“帮我装个 X”能装到哪一步

| 说法                             | 工具                       | 写完立刻生效？                                   | 设置页能看到？                   |
| -------------------------------- | -------------------------- | ------------------------------------------------ | -------------------------------- |
| 装个 MCP 服务器                  | `mcp_setup add`            | 是（连接 + 写配置 + 内存状态）                   | 是（设置 → MCP，重新进入即刷新） |
| 写一个技能                       | `skill_install install`    | 是（`Skill.reload()` 后当前会话可 `skill` 调用） | 是（设置 → 技能，磁盘重扫）      |
| 装个插件（npm / 本地 / git）     | `plugin_install install`   | 是（`Plugin.reload()` 重载 hooks）               | 是（设置 → 插件读 config）       |
| 换供应商 baseURL                 | `provider_setup configure` | 是（`Provider.reload()`）                        | 是                               |
| 装 OCR / Ollama / LSP / 办公平台 | 各自 `*_setup`             | 是（安装后清缓存或直接连接）                     | 是                               |

刷新语义：设置页的 config 查询默认 `staleTime: 0`，**重新进入设置页就会拉最新值**；
不需要重启应用。`*_setup` 里的写操作都会先走 `ctx.ask` 权限确认。

## 前端复用

`packages/app/src/components/ai-fix-button.tsx` 是通用按钮：

```tsx
<AiFixButton
  promptKey="knowledge.ocr.install.askAiPrompt"
  params={{ label: status()?.label ?? "" }}
  context={() => ({ status: message(), error: lastError(), hint: hint(), log: logs() })}
  onBeforeAsk={() => dialog.close()}
/>
```

- `context` 支持传函数，读取最新状态；
- 日志由 `utils/ai-fix.ts` 统一截断到尾部 2000 字，并丢弃被截断的半行；
- **不要**把 API Key、数据库密码、App Secret 放进 context。

## 新增一个能力时怎么做

1. 后端：把现有安装/诊断逻辑包成 `<domain>_setup` 工具（`src/tool/`），
   提供 `status` 与 `install` 两个动作，`install` 前 `ctx.ask`；
2. 注册：`src/tool/registry.ts` 里加能力标记
   （`readOnly` 对 `install` 返回 false，`concurrencySafe: false`）；
3. 前端：在失败提示旁放 `AiFixButton`，写一条 `*aiFixPrompt` 提示词，
   要求 AI **先调工具、失败再排查**；
4. 测试：至少覆盖「已就绪」「缺依赖走安装」「安装失败带 hint 且不抛异常」。
