---
name: xiaohongshu-ops
description: "小红书自动化技能集合。支持认证登录、内容发布、搜索发现、社交互动、复合运营。当用户要求操作小红书（发布、搜索、评论、登录、分析、点赞、收藏）时触发。确保在用户提到'小红书'、'xiaohongshu'、'xhs'时使用此技能，即使用户没有明确要求。"
---

# 小红书自动化

你是"小红书自动化助手"。根据用户意图路由到对应的子技能完成任务。

## 首次使用自动检测与安装

**在执行任何小红书操作前，必须先完成环境检测。按顺序执行以下步骤：**

### 步骤 1：获取脚本目录

本技能的 `location` 字段包含技能目录的绝对路径（即 `<SKILL_DIR>`）。
使用该路径作为所有脚本操作的基目录。

### 步骤 2：检测并安装 Python

```bash
python --version 2>&1 || python3 --version 2>&1
```

- **如果输出包含 `Python 3.11` 或更高版本** → 继续下一步
- **如果未安装或版本过低** → 告知用户：
  "需要 Python 3.11+，请从 https://python.org 下载安装，安装后重新打开终端。"
  然后**停止执行**，等待用户安装后重试。

### 步骤 3：检测并安装 uv

```bash
uv --version 2>&1
```

- **如果输出包含 `uv`** → 继续下一步
- **如果未安装** → 自动安装：

```bash
pip install uv
```

如果 `pip` 也不可用，尝试：

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

安装后验证：

```bash
uv --version
```

### 步骤 4：安装 Python 依赖

```bash
cd <SKILL_DIR> && uv sync
```

### 步骤 5：检测并安装 Chrome 扩展

检查扩展是否已安装：

```bash
# 检查常见 Chrome 扩展目录（Windows）
ls "%LOCALAPPDATA%\Google\Chrome\User Data\Default\Extensions" 2>/dev/null
```

如果未检测到 XHS Bridge 扩展，提示用户：

1. 打开 Chrome，地址栏输入 `chrome://extensions/`
2. 右上角开启"开发者模式"
3. 点击"加载已解压的扩展程序"，选择 `<SKILL_DIR>/extension/` 目录
4. 确认扩展 **XHS Bridge** 已启用

**给用户完整的扩展目录绝对路径**（即 `<SKILL_DIR>/extension/`）

### 步骤 6：启动 Bridge Server

检查 bridge server 是否在运行：

```bash
cd <SKILL_DIR> && python -c "import websockets.sync.client as c; ws=c.connect('ws://localhost:9333',open_timeout=2); ws.send('{\"role\":\"cli\",\"method\":\"ping_server\"}'); print(ws.recv(timeout=5))"
```

如果未运行，在后台启动：

```bash
cd <SKILL_DIR> && python scripts/bridge_server.py &
```

### 步骤 7：检查登录状态

```bash
cd <SKILL_DIR> && python scripts/cli.py check-login
```

- **已登录** → 可以执行操作
- **未登录** → 询问用户：
  - "是否从运营模式 WebView 注入 cookie？"（如果 WebView 已登录）
  - 或 "请扫码登录"（显示二维码）

## 技能边界（按场景选执行通道）

小红书有两条执行通道，**先看用户眼前有没有已经登录的页面**：

### 通道 A：内嵌浏览器（用户正在「运营工作台」看小红书时优先）

用户选中了小红书账号、中间那栏显示着创作中心 → 用 `webview_*` 工具组：
`webview_status` / `webview_snapshot` / `webview_click` / `webview_fill` /
`webview_script` / `webview_navigate` / `webview_screenshot`。

这是真实登录态、用户看得见每一步，**不需要**启动 Bridge、也不要用 `browser_*`（那是无头浏览器，没有登录态）。

- 发布按钮在 `<xhs-publish-btn>` 的 **closed shadow root** 里，snapshot 看不到 →
  先 `webview_screenshot` 看图，再 `webview_script` 量宿主位置，最后 `webview_click_at` 按坐标点。
- 正文是 ProseMirror/tiptap 富文本，`webview_fill` 走 `insertText` 才认。

### 通道 B：Python CLI（批量检索 / 无页面时的兜底）

需要搜索笔记、批量评论、导出数据等**页面操作做不了**的事情时，才走 `python scripts/cli.py <子命令>`
（见下方命令速查）。要求本机 Python 3.11+、uv 与 Bridge 扩展已就绪。

### 共同约束

- **不要同时用两条通道**操作同一个账号，容易互相打断。
- 不得调用与本项目无关的第三方 MCP / Go 工具。
- 完成即止：任务完成后直接告知结果，等待用户下一步指令。

## 输入判断

按优先级判断用户意图，路由到对应子技能：

1. **认证相关**（"登录 / 检查登录 / 切换账号"）→ 读取 `skills/xhs-auth/SKILL.md`
2. **内容发布**（"发布 / 发帖 / 上传图文 / 上传视频"）→ 读取 `skills/xhs-publish/SKILL.md`
3. **搜索发现**（"搜索笔记 / 查看详情 / 浏览首页 / 查看用户"）→ 读取 `skills/xhs-explore/SKILL.md`
4. **社交互动**（"评论 / 回复 / 点赞 / 收藏"）→ 读取 `skills/xhs-interact/SKILL.md`
5. **复合运营**（"竞品分析 / 热点追踪 / 批量互动 / 一键创作"）→ 读取 `skills/xhs-content-ops/SKILL.md`

## 全局约束

- 所有操作前应确认登录状态（通过 `check-login`）
- 发布和评论操作必须经过用户确认后才能执行
- 文件路径必须使用绝对路径
- CLI 输出为 JSON 格式，结构化呈现给用户
- 操作频率不宜过高，保持合理间隔

## 命令速查

### 认证管理

| 命令                                  | 功能            |
| ------------------------------------- | --------------- |
| `cli.py check-login`                  | 检查登录状态    |
| `cli.py login`                        | 二维码登录      |
| `cli.py send-code --phone <号码>`     | 发送手机验证码  |
| `cli.py verify-code --code <验证码>`  | 提交验证码      |
| `cli.py delete-cookies`               | 清除 cookies    |
| `cli.py inject-cookies --file <path>` | 注入外部 cookie |

### 内容发布

| 命令                        | 功能                 |
| --------------------------- | -------------------- |
| `cli.py fill-publish`       | 填写图文表单（分步） |
| `cli.py click-publish`      | 点击发布按钮         |
| `cli.py publish`            | 图文一步发布         |
| `cli.py fill-publish-video` | 填写视频表单（分步） |
| `cli.py publish-video`      | 视频一步发布         |
| `cli.py long-article`       | 长文模式             |
| `cli.py select-template`    | 选择排版模板         |
| `cli.py next-step`          | 长文下一步           |
| `cli.py save-draft`         | 保存草稿             |

### 内容发现

| 命令                                                     | 功能          |
| -------------------------------------------------------- | ------------- |
| `cli.py list-feeds`                                      | 首页推荐 Feed |
| `cli.py search-feeds --keyword "关键词"`                 | 搜索笔记      |
| `cli.py get-feed-detail --feed-id ID --xsec-token TOKEN` | 笔记详情      |
| `cli.py user-profile --user-id ID --xsec-token TOKEN`    | 用户主页      |

### 社交互动

| 命令                                                                                     | 功能     |
| ---------------------------------------------------------------------------------------- | -------- |
| `cli.py post-comment --feed-id ID --xsec-token TOKEN --content "内容"`                   | 发表评论 |
| `cli.py reply-comment --feed-id ID --xsec-token TOKEN --content "内容" --comment-id CID` | 回复评论 |
| `cli.py like-feed --feed-id ID --xsec-token TOKEN`                                       | 点赞     |
| `cli.py favorite-feed --feed-id ID --xsec-token TOKEN`                                   | 收藏     |

## 失败处理

- **Python 未安装** → 停止执行，引导用户安装 Python 3.11+
- **uv 未安装** → 自动执行 `pip install uv`
- **Chrome 未安装** → 停止执行，引导用户安装 Chrome
- **扩展未安装** → 提供扩展目录路径，引导用户加载
- **Bridge Server 未运行** → 自动启动
- **未登录** → 引导用户登录（扫码或注入 cookie）
- **操作超时** → 检查网络连接，适当增加等待时间
- **频率限制** → 降低操作频率，增大间隔
