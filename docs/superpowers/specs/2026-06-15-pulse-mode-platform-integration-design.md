# 脉搏模式（运营模式）多平台矩阵运营 — 设计文档

## 概述

将 XYMT-AUTO 的多平台社交媒体管理能力集成到 NovaWay-Coder 的脉搏模式（pulse mode）中，实现矩阵式跨平台运营工作台。

## 架构决策

- **架构层次**：Electron 主进程（`packages/desktop/src/main/platform/`）
- **通信方式**：IPC（渲染进程 ↔ 主进程）
- **前端框架**：SolidJS + TailwindCSS（与 NovaWay 现有设计系统一致）
- **存储**：`electron-store`（已有 IPC 封装）
- **复用策略**：直接移植 XYMT-AUTO 的 HTTP 协议层代码

## 总体架构

```
渲染进程 (SolidJS packages/app/)
  └─ pages/pulse/  ← 脉搏模式三栏布局
       ├─ PulseLayout.tsx      ← 三栏容器
       ├─ PulseSidebar.tsx     ← 左侧：平台账号列表
       ├─ PulseMain.tsx        ← 中间：账号详情/发布/数据
       └─ PulseAssistant.tsx   ← 右侧：AI 运营助手
  └─ context/platform.tsx     ← 平台管理 Context (IPC 调用封装)
        │
        │ window.api.platform.*
        ▼
主进程 (Electron packages/desktop/)
  ├─ ipc.ts  ← 新增 platform.* IPC handler 组
  └─ platform/  ← 平台管理模块
       ├─ index.ts           ← 模块入口 + 平台工厂
       ├─ store.ts           ← 账号存储 (electron-store)
       ├─ login.ts           ← 统一登录管理器 (BrowserWindow)
       ├─ PlatformBase.ts    ← 平台抽象基类
       └─ platforms/         ← 各平台真实 API 实现
            ├─ xhs.ts        ← 小红书
            ├─ douyin.ts     ← 抖音
            ├─ bilibili.ts   ← B站
            ├─ kwai.ts       ← 快手
            ├─ wxSph.ts      ← 微信视频号
            ├─ wxGzh.ts      ← 微信公众号
            └─ xianyu.ts     ← 闲鱼
```

## 首次迭代范围

### 功能模块

| 模块     | 优先级 | 说明                                                     |
| -------- | ------ | -------------------------------------------------------- |
| 账号管理 | P0     | 多平台账号登录/BrowserWindow Cookie 注入/登录态检测/CRUD |
| 内容发布 | P0     | 视频/图文/文章多平台分发、发布进度跟踪                   |

### 支持平台

小红书、抖音、B站、快手、微信视频号、微信公众号、闲鱼（全部国内平台）

## 前端 UI 设计

### 三栏布局（PulseLayout）

```
┌──────────────┬───────────────────────────┬──────────────┐
│  左侧栏       │        中间内容区           │   右侧面板    │
│  账号列表     │   (点击账号后动态切换)      │  AI 运营助手  │
│              │                            │              │
│ [⬆排序拖拽]  │  ┌─ 账号概览 ────────────┐│ ┌──────────┐ │
│ 小红书   ✅  │  │ 昵称: 运营小能手       ││ │ AI 对话  │ │
│ 抖音     ✅  │  │ 平台: 小红书           ││ │          │ │
│ B站      ❌  │  │ 粉丝: 1.2w            ││ │ 帮我生成  │ │
│ 快手     ✅  │  │ ───── 快捷操作 ─────  ││ │ 小红书种  │ │
│ 视频号   ❌  │  │ [发布内容] [查看作品]  ││ │ 草文案   │ │
│ 公众号   ✅  │  │ ───── 最近发布 ─────  ││ │          │ │
│ 闲鱼     ✅  │  │ 2026/06/14 ✅ 小红书  ││ │ [自动发布]│ │
│              │  │ 2026/06/13 ✅ 抖音    ││ │ [自动回复]│ │
│ [+ 添加账号] │  └──────────────────────┘│ └──────────┘ │
└──────────────┴───────────────────────────┴──────────────┘
```

### 页面路由

```
/route:
  /pulse          → PulseLayout (三栏工作台)
    /pulse        → PulseHome (默认选中第一个账号)
    /pulse/accounts → 账号管理 (左侧栏展开全量列表)
```

### 与模式系统集成

在 `packages/app/src/pages/home.tsx` 中：

```typescript
if (currentMode() === "pulse") return <Navigate href="/pulse" />
```

## Electron 主进程设计

### IPC Handler 清单

| Channel                        | Direction | 说明                     |
| ------------------------------ | --------- | ------------------------ |
| `platform:get-accounts`        | invoke →  | 获取所有账号             |
| `platform:add-account`         | invoke →  | 添加账号（启动登录流程） |
| `platform:remove-account`      | invoke →  | 删除账号                 |
| `platform:check-login`         | invoke →  | 检测登录态               |
| `platform:publish`             | invoke →  | 发布内容到多平台         |
| `platform:publish-event`       | ← send    | 发布进度事件推送         |
| `platform:get-publish-history` | invoke →  | 获取发布历史             |
| `platform:get-account-stats`   | invoke →  | 获取账号统计数据         |

### 登录流程

```
渲染进程 platform:add-account({ platform: "xhs" })
  → 主进程创建 BrowserWindow:
     - 窗口标题: "小红书登录"
     - 导航到创作者登录页
     - 注入 Cookie 持久化脚本
  → 用户完成登录
  → 提取关键 Cookie
  → 调用 PlatformBase.detectLogin() 验证
  → 调用 PlatformBase.getAccountInfo() 获取信息
  → 存储到 electron-store
  → 关闭 BrowserWindow
  → 返回账号信息
```

## 平台抽象层

### PlatformBase

```typescript
abstract class PlatformBase {
  abstract readonly id: string
  abstract readonly name: string
  abstract readonly loginUrl: string

  abstract detectLogin(cookies: any[]): Promise<boolean>
  abstract getAccountInfo(cookies: any[]): Promise<AccountInfo>
  abstract videoPublish(input: VideoInput): Promise<PublishResult>
  abstract imgTextPublish(input: ImgTextInput): Promise<PublishResult>
  abstract getPublishHistory(accountId: string): Promise<PublishRecord[]>
  abstract getAccountStats(accountId: string): Promise<AccountStats>
}
```

### 平台实现

各平台的 HTTP 协议实现直接移植自 XYMT-AUTO：

- `electron/main/plat/platforms/xhs/index.ts` → 小红书（Cookie 检测、图文/视频发布）
- `electron/main/plat/platforms/douyin/index.ts` → 抖音（视频 multipart 上传）
- `electron/main/plat/platforms/bilibili/index.ts` → B站
- `electron/main/plat/platforms/Kwai/index.ts` → 快手（含签名算法）
- `electron/main/plat/platforms/wxSph/index.ts` → 微信视频号
- `electron/main/plat/platforms/wxGzh/index.ts` → 公众号（WebView 草稿注入）
- `electron/main/plat/platforms/xianyu/index.ts` → 闲鱼

## 数据存储

使用 `electron-store`（key-value JSON 存储，已集成在 desktop 中）：

```typescript
// 账号存储
interface StoredAccount {
  id: string
  platform: string // "xhs" | "douyin" | ...
  nickname: string
  avatar: string
  cookies: string // 加密 JSON 字符串
  loginTime: number
  status: "valid" | "expired" | "login_failed"
}

// 发布记录
interface PublishRecord {
  id: string
  type: "video" | "image_text" | "article"
  title: string
  accounts: { accountId: string; platform: string; status: string; result?: any }[]
  createdAt: number
}
```

## 预加载桥接增强

在 `packages/desktop/src/preload/types.ts` 中新增：

```typescript
export interface PlatformAPI {
  getAccounts(): Promise<Account[]>
  addAccount(platform: string): Promise<Account>
  removeAccount(id: string): Promise<void>
  checkLogin(id: string): Promise<boolean>
  publish(input: PublishInput): Promise<PublishResult[]>
  getPublishHistory(accountId?: string): Promise<PublishRecord[]>
  getAccountStats(accountId: string): Promise<AccountStats>
}
```

## 实施计划

### 阶段 1：基础设施（桌面端 IPC + 平台框架）

1. 在 `packages/desktop/src/main/` 创建 `platform/` 模块目录
2. 实现 `PlatformBase.ts` 抽象基类
3. 在 `ipc.ts` 注册 `platform:*` handler 组
4. 在 `preload/` 暴露 `window.api.platform.*`
5. 实现 `store.ts`（基于 `electron-store` 的账号 CRUD）
6. 实现 `login.ts`（BrowserWindow 登录管理器）

### 阶段 2：平台接入（逐个平台移植）

1. 移植小红书协议层 + 实现 XhsPlatform
2. 移植抖音协议层 + 实现 DouyinPlatform
3. 移植 B站协议层 + 实现 BilibiliPlatform
4. 移植快手协议层 + 实现 KwaiPlatform
5. 移植视频号协议层 + 实现 WxSphPlatform
6. 移植公众号协议层 + 实现 WxGzhPlatform
7. 移植闲鱼协议层 + 实现 XianyuPlatform

### 阶段 3：前端 UI（SolidJS + Tailwind）

1. 创建 `packages/app/src/pages/pulse/PulseLayout.tsx`（三栏容器）
2. 创建 `PulseSidebar.tsx`（左侧平台账号列表）
3. 创建 `PulseMain.tsx`（中间账号详情/发布表单）
4. 创建 `PulseAssistant.tsx`（右侧 AI 面板）
5. 创建 `platform.tsx` context 封装 IPC 调用
6. 在 `app.tsx` 注册路由
7. 在 `home.tsx` 添加 pulse 模式导航

### 阶段 4：发布引擎

1. 实现多平台并行发布逻辑
2. 实现发布进度 IPC 事件推送
3. 实现发布历史管理
4. 实现草稿暂存（localStorage）

## 风险与缓解

| 风险                               | 缓解措施                                               |
| ---------------------------------- | ------------------------------------------------------ |
| 平台 API 变更导致登录/发布失效     | 平台协议层独立于核心代码，可快速热修复                 |
| Cookie 过期无法自动续期            | 每次操作前调用 `detectLogin()`，过期时通知用户重新登录 |
| 部分平台有反爬签名（快手等）       | 复用 XYMT-AUTO 已有的签名算法实现                      |
| 右侧 AI 助手暂无后端 AI Agent 对接 | 第一阶段使用占位 UI，后续对接营销 Agent                |
