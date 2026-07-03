# 脉搏模式多平台运营集成 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 将 XYMT-AUTO 的多平台社交媒体管理能力集成到 NovaWay-Coder 的脉搏模式（pulse mode），实现矩阵式跨平台运营工作台。

**架构：** Electron 主进程的平台模块通过 IPC 向 SolidJS 渲染进程暴露账号管理和内容发布能力。PlatformBase 抽象基类 + 各平台实现复用 XYMT-AUTO 的 HTTP 协议层。前端采用三栏布局（账号列表 | 内容详情 | AI 助手）。

**技术栈：** Electron 42, SolidJS 1.x, TailwindCSS 4, electron-store, effect, TypeScript

**前置阅读：**
- `packages/desktop/AGENTS.md` — Electron IPC 模式
- `packages/app/AGENTS.md` — SolidJS 组件规范
- `packages/desktop/src/main/ipc.ts` — 现有 IPC 注册方式
- `packages/desktop/src/preload/types.ts` — preload 类型定义

---

## 文件结构映射

### 新增文件

| 文件路径 | 职责 |
|----------|------|
| `packages/desktop/src/main/platform/PlatformBase.ts` | 抽象基类，定义所有平台必须实现的接口 |
| `packages/desktop/src/main/platform/store.ts` | 基于 electron-store 的账号 CRUD |
| `packages/desktop/src/main/platform/login.ts` | BrowserWindow 登录管理器 |
| `packages/desktop/src/main/platform/index.ts` | 模块入口 + 平台工厂 |
| `packages/desktop/src/main/platform/platforms/xhs.ts` | 小红书 API 实现 |
| `packages/desktop/src/main/platform/platforms/douyin.ts` | 抖音 API 实现 |
| `packages/desktop/src/main/platform/platforms/bilibili.ts` | B 站 API 实现 |
| `packages/desktop/src/main/platform/platforms/kwai.ts` | 快手 API 实现 |
| `packages/desktop/src/main/platform/platforms/wxSph.ts` | 微信视频号 API 实现 |
| `packages/desktop/src/main/platform/platforms/wxGzh.ts` | 微信公众号 API 实现 |
| `packages/desktop/src/main/platform/platforms/xianyu.ts` | 闲鱼 API 实现 |
| `packages/app/src/pages/pulse/PulseLayout.tsx` | 三栏布局容器 |
| `packages/app/src/pages/pulse/PulseSidebar.tsx` | 左侧平台账号列表 |
| `packages/app/src/pages/pulse/PulseMain.tsx` | 中间账号详情/发布 | 
| `packages/app/src/pages/pulse/PulseAssistant.tsx` | 右侧 AI 运营助手 |
| `packages/app/src/pages/pulse/types.ts` | 平台管理类型定义 |
| `packages/app/src/pages/pulse/index.ts` | 统一导出 |
| `packages/app/src/context/platform.tsx` | 平台管理 SolidJS Context |

### 修改文件

| 文件路径 | 修改内容 |
|----------|----------|
| `packages/desktop/src/main/ipc.ts` | 新增 `platform:*` IPC handler 组 |
| `packages/desktop/src/preload/types.ts` | 新增 `PlatformAPI` 接口 |
| `packages/desktop/src/preload/index.ts` | 新增 platform API 暴露 |
| `packages/app/src/app.tsx` | 新增 pulse 路由 |
| `packages/app/src/pages/home.tsx` | 新增 pulse 模式重定向 |

---

## Phase 1: 桌面端基础设施

### Task 1: PlatformBase 抽象基类

**Files:**
- Create: `packages/desktop/src/main/platform/PlatformBase.ts`

- [ ] **Step 1: 创建 PlatformBase.ts**

```typescript
// packages/desktop/src/main/platform/PlatformBase.ts
import type { Cookie } from "electron"

export interface PlatformAccountInfo {
  nickname: string
  avatar: string
  platformUserId: string
}

export interface PublishInput {
  type: "video" | "image_text" | "article"
  title: string
  description: string
  filePaths?: string[]
  tags?: string[]
  scheduleTime?: number
}

export interface PublishResult {
  success: boolean
  platformPostId?: string
  error?: string
  url?: string
}

export interface PublishRecord {
  id: string
  accountId: string
  platform: string
  type: "video" | "image_text" | "article"
  title: string
  status: "pending" | "publishing" | "success" | "failed"
  result?: PublishResult
  createdAt: number
}

export interface AccountStats {
  followers: number
  following: number
  totalPosts: number
  totalLikes: number
  updatedAt: number
}

export abstract class PlatformBase {
  abstract readonly id: string
  abstract readonly name: string
  abstract readonly loginUrl: string

  abstract detectLogin(cookies: Cookie[]): Promise<boolean>
  abstract getAccountInfo(cookies: Cookie[]): Promise<PlatformAccountInfo>
  abstract publish(input: PublishInput, cookies: Cookie[]): Promise<PublishResult>
  abstract getPublishHistory(accountId: string): Promise<PublishRecord[]>
  abstract getAccountStats(accountId: string): Promise<AccountStats>
}
```

- [ ] **Step 2: 验证编译**

Run: `bun typecheck` (from `packages/desktop`)
Expected: 无类型错误 (当前项目可能已有其他错误，只要无 platform 相关错误即可)

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/main/platform/PlatformBase.ts
git commit -m "feat(pulse): add PlatformBase abstract class for multi-platform management"
```

### Task 2: 账号存储

**Files:**
- Create: `packages/desktop/src/main/platform/store.ts`

- [ ] **Step 1: 创建 store.ts**

```typescript
// packages/desktop/src/main/platform/store.ts
import { getStore } from "../store"

export interface StoredAccount {
  id: string
  platform: string
  nickname: string
  avatar: string
  cookies: string
  loginTime: number
  status: "valid" | "expired" | "login_failed"
}

const ACCOUNTS_KEY = "platform.accounts"
const PUBLISH_RECORDS_KEY = "platform.publishRecords"

const store = getStore("novaway.platform")

export function getAccounts(): StoredAccount[] {
  return (store.get(ACCOUNTS_KEY) as StoredAccount[]) || []
}

export function saveAccount(account: StoredAccount): void {
  const accounts = getAccounts().filter((a) => a.id !== account.id)
  accounts.push(account)
  store.set(ACCOUNTS_KEY, accounts)
}

export function removeAccount(id: string): void {
  const accounts = getAccounts().filter((a) => a.id !== id)
  store.set(ACCOUNTS_KEY, accounts)
}

export function getAccount(id: string): StoredAccount | undefined {
  return getAccounts().find((a) => a.id === id)
}

export function getPublishRecords(): PublishRecord[] {
  return (store.get(PUBLISH_RECORDS_KEY) as PublishRecord[]) || []
}

export function savePublishRecord(record: PublishRecord): void {
  const records = getPublishRecords()
  records.push(record)
  store.set(PUBLISH_RECORDS_KEY, records)
}
```

注：`PublishRecord` 类型引用自 `PlatformBase.ts`。

- [ ] **Step 2: 验证编译**

Run: `bun typecheck` (from `packages/desktop`)

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/main/platform/store.ts
git commit -m "feat(pulse): add account and publish record storage"
```

### Task 3: 登录管理器

**Files:**
- Create: `packages/desktop/src/main/platform/login.ts`

- [ ] **Step 1: 创建 login.ts**

```typescript
// packages/desktop/src/main/platform/login.ts
import { BrowserWindow, session } from "electron"
import { EventEmitter } from "events"

export interface LoginResult {
  success: boolean
  cookies?: Electron.Cookie[]
  error?: string
}

export class PlatformLoginManager extends EventEmitter {
  private window: BrowserWindow | null = null

  async startLogin(loginUrl: string, platform: string): Promise<LoginResult> {
    return new Promise((resolve) => {
      this.window = new BrowserWindow({
        width: 800,
        height: 700,
        title: `${platform} 登录`,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
        },
      })

      this.window.loadURL(loginUrl)

      this.window.on("closed", () => {
        this.window = null
      })

      this.monitorCookies(this.window, platform, resolve)
    })
  }

  private async monitorCookies(
    win: BrowserWindow,
    platform: string,
    resolve: (result: LoginResult) => void,
  ): Promise<void> {
    const sess = session.defaultSession
    let checkCount = 0
    const maxChecks = 120

    const interval = setInterval(async () => {
      checkCount++
      const cookies = await sess.cookies.get({})

      const platformCookies = cookies.filter((c) =>
        c.domain?.includes(this.getCookieDomain(platform)),
      )

      if (platformCookies.length > 3 && cookies.some((c) => c.name.includes("session") || c.name.includes("token") || c.name.includes("passport"))) {
        clearInterval(interval)
        resolve({ success: true, cookies: platformCookies })
        win.close()
        return
      }

      if (checkCount >= maxChecks) {
        clearInterval(interval)
        resolve({ success: false, error: "登录超时" })
        win.close()
      }
    }, 1000)
  }

  private getCookieDomain(platform: string): string {
    const domains: Record<string, string> = {
      xhs: "xiaohongshu.com",
      douyin: "douyin.com",
      bilibili: "bilibili.com",
      kwai: "kuaishou.com",
      wxSph: "weixin.qq.com",
      wxGzh: "weixin.qq.com",
      xianyu: "xianyu.com",
    }
    return domains[platform] || `${platform}.com`
  }

  cancel(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close()
    }
  }
}
```

- [ ] **Step 2: 验证编译**

Run: `bun typecheck` (from `packages/desktop`)

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/main/platform/login.ts
git commit -m "feat(pulse): add BrowserWindow login manager for platform auth"
```

### Task 4: 平台工厂与模块入口

**Files:**
- Create: `packages/desktop/src/main/platform/index.ts`

- [ ] **Step 1: 创建 index.ts**

```typescript
// packages/desktop/src/main/platform/index.ts
import type { PlatformBase } from "./PlatformBase"
import { XhsPlatform } from "./platforms/xhs"
import { DouyinPlatform } from "./platforms/douyin"
import { BilibiliPlatform } from "./platforms/bilibili"
import { KwaiPlatform } from "./platforms/kwai"
import { WxSphPlatform } from "./platforms/wxSph"
import { WxGzhPlatform } from "./platforms/wxGzh"
import { XianyuPlatform } from "./platforms/xianyu"

const platformRegistry: Record<string, new () => PlatformBase> = {
  xhs: XhsPlatform,
  douyin: DouyinPlatform,
  bilibili: BilibiliPlatform,
  kwai: KwaiPlatform,
  wxSph: WxSphPlatform,
  wxGzh: WxGzhPlatform,
  xianyu: XianyuPlatform,
}

export function getPlatform(type: string): PlatformBase {
  const PlatformClass = platformRegistry[type]
  if (!PlatformClass) {
    throw new Error(`不支持的平台类型: ${type}`)
  }
  return new PlatformClass()
}

export function getSupportedPlatforms(): { id: string; name: string }[] {
  return Object.entries(platformRegistry).map(([id, cls]) => ({
    id,
    name: new cls().name,
  }))
}

export { PlatformLoginManager } from "./login"
export * from "./store"
export * from "./PlatformBase"
```

- [ ] **Step 2: 验证编译**

Run: `bun typecheck` (from `packages/desktop`)
Expected: 由于平台实现文件还没创建，这里会有导入错误。先确认目录结构正确。

- [ ] **Step 3: Commit (先提交, 平台实现后续补全)**

```bash
git add packages/desktop/src/main/platform/index.ts
git commit -m "feat(pulse): add platform factory and module entry"
```

---

## Phase 2: 平台实现

### Task 5: 小红书平台实现

**Files:**
- Create: `packages/desktop/src/main/platform/platforms/xhs.ts`

- [ ] **Step 1: 查看 XYMT-AUTO 的小红书协议实现**

Read: `XYMT-AUTO/electron/main/plat/platforms/xhs/index.ts` 了解发布逻辑
Read: `XYMT-AUTO/electron/plat/xiaohongshu/` 目录了解 HTTP 协议实现

- [ ] **Step 2: 创建 xhs.ts**

```typescript
// packages/desktop/src/main/platform/platforms/xhs.ts
import { PlatformBase, type PublishInput, type PublishResult, type PlatformAccountInfo, type AccountStats } from "../PlatformBase"
import type { Cookie } from "electron"

export class XhsPlatform extends PlatformBase {
  readonly id = "xhs"
  readonly name = "小红书"
  readonly loginUrl = "https://creator.xiaohongshu.com/login"

  async detectLogin(cookies: Cookie[]): Promise<boolean> {
    return cookies.some((c) =>
      (c.name.includes("session") || c.name.includes("token")) &&
      c.domain?.includes("xiaohongshu.com")
    )
  }

  async getAccountInfo(cookies: Cookie[]): Promise<PlatformAccountInfo> {
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ")
    const res = await fetch("https://creator.xiaohongshu.com/api/user/me", {
      headers: { Cookie: cookieStr },
    })
    const data = await res.json()
    return {
      nickname: data.data?.nickname || "未知用户",
      avatar: data.data?.avatar || "",
      platformUserId: data.data?.userId || "",
    }
  }

  async publish(input: PublishInput, cookies: Cookie[]): Promise<PublishResult> {
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ")
    try {
      // 移植自 XYMT-AUTO 的小红书发布逻辑
      // 根据 input.type 选择图文/视频发布接口
      const endpoint = input.type === "video"
        ? "https://creator.xiaohongshu.com/api/v1/publish/video"
        : "https://creator.xiaohongshu.com/api/v1/publish/image-text"

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Cookie: cookieStr,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: input.title,
          description: input.description,
          tags: input.tags,
          filePaths: input.filePaths,
        }),
      })
      const data = await res.json()
      if (data.success) {
        return { success: true, platformPostId: data.data?.id, url: data.data?.url }
      }
      return { success: false, error: data.msg || "发布失败" }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  async getPublishHistory(accountId: string): Promise<any[]> {
    // MVP: 暂不实现发布历史，后续迭代补充
    return []
  }

  async getAccountStats(accountId: string): Promise<AccountStats> {
    return { followers: 0, following: 0, totalPosts: 0, totalLikes: 0, updatedAt: Date.now() }
  }
}
```

- [ ] **Step 3: 验证编译**

Run: `bun typecheck` (from `packages/desktop`)

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/main/platform/platforms/xhs.ts
git commit -m "feat(pulse): add Xiaohongshu platform implementation"
```

### Task 6: 抖音平台实现

**Files:**
- Create: `packages/desktop/src/main/platform/platforms/douyin.ts`

- [ ] **Step 1: 查看 XYMT-AUTO 的抖音协议实现**

Read: `XYMT-AUTO/electron/main/plat/platforms/douyin/index.ts`

- [ ] **Step 2: 创建 douyin.ts**

```typescript
// packages/desktop/src/main/platform/platforms/douyin.ts
import { PlatformBase, type PublishInput, type PublishResult, type PlatformAccountInfo, type AccountStats } from "../PlatformBase"
import type { Cookie } from "electron"

export class DouyinPlatform extends PlatformBase {
  readonly id = "douyin"
  readonly name = "抖音"
  readonly loginUrl = "https://creator.douyin.com/login"

  async detectLogin(cookies: Cookie[]): Promise<boolean> {
    return cookies.some((c) =>
      c.name.includes("sessionid") && c.domain?.includes("douyin.com")
    )
  }

  async getAccountInfo(cookies: Cookie[]): Promise<PlatformAccountInfo> {
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ")
    const res = await fetch("https://creator.douyin.com/api/v1/user/info", {
      headers: { Cookie: cookieStr },
    })
    const data = await res.json()
    return {
      nickname: data.data?.nickname || "未知用户",
      avatar: data.data?.avatar || "",
      platformUserId: data.data?.userId || "",
    }
  }

  async publish(input: PublishInput, cookies: Cookie[]): Promise<PublishResult> {
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ")
    try {
      const formData = new FormData()
      formData.append("title", input.title)
      formData.append("description", input.description)
      if (input.filePaths?.length) {
        const fileBuffer = await Bun.file(input.filePaths[0]).arrayBuffer()
        formData.append("video", new Blob([fileBuffer]), "video.mp4")
      }

      const res = await fetch("https://creator.douyin.com/api/v1/video/upload", {
        method: "POST",
        headers: { Cookie: cookieStr },
        body: formData,
      })
      const data = await res.json()
      if (data.success) {
        return { success: true, platformPostId: data.data?.id, url: data.data?.url }
      }
      return { success: false, error: data.msg || "发布失败" }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  async getPublishHistory(accountId: string): Promise<any[]> {
    return []
  }

  async getAccountStats(accountId: string): Promise<AccountStats> {
    return { followers: 0, following: 0, totalPosts: 0, totalLikes: 0, updatedAt: Date.now() }
  }
}
```

- [ ] **Step 3: 验证编译**

Run: `bun typecheck`

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/main/platform/platforms/douyin.ts
git commit -m "feat(pulse): add Douyin platform implementation"
```

### Task 7: B站平台实现

**Files:**
- Create: `packages/desktop/src/main/platform/platforms/bilibili.ts`

```typescript
// packages/desktop/src/main/platform/platforms/bilibili.ts
import { PlatformBase, type PublishInput, type PublishResult, type PlatformAccountInfo, type AccountStats } from "../PlatformBase"
import type { Cookie } from "electron"

export class BilibiliPlatform extends PlatformBase {
  readonly id = "bilibili"
  readonly name = "B站"
  readonly loginUrl = "https://member.bilibili.com/platform/upload"

  async detectLogin(cookies: Cookie[]): Promise<boolean> {
    return cookies.some((c) =>
      (c.name.includes("bili_jct") || c.name.includes("SESSDATA")) &&
      c.domain?.includes("bilibili.com")
    )
  }

  async getAccountInfo(cookies: Cookie[]): Promise<PlatformAccountInfo> {
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ")
    const res = await fetch("https://api.bilibili.com/x/web-interface/nav", {
      headers: { Cookie: cookieStr },
    })
    const data = await res.json()
    return {
      nickname: data.data?.uname || "未知用户",
      avatar: data.data?.face || "",
      platformUserId: String(data.data?.mid || ""),
    }
  }

  async publish(input: PublishInput, cookies: Cookie[]): Promise<PublishResult> {
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ")
    try {
      const res = await fetch("https://member.bilibili.com/cgi-bin/submit/video", {
        method: "POST",
        headers: {
          Cookie: cookieStr,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          title: input.title,
          desc: input.description,
          tag: input.tags?.join(",") || "",
        }).toString(),
      })
      const data = await res.json()
      return data.code === 0
        ? { success: true, platformPostId: String(data.data?.aid) }
        : { success: false, error: data.message || "发布失败" }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  async getPublishHistory(accountId: string): Promise<any[]> { return [] }
  async getAccountStats(accountId: string): Promise<AccountStats> {
    return { followers: 0, following: 0, totalPosts: 0, totalLikes: 0, updatedAt: Date.now() }
  }
}
```

- [ ] **Step 1-3: 创建文件 + 验证编译 + Commit**

```bash
git add packages/desktop/src/main/platform/platforms/bilibili.ts
git commit -m "feat(pulse): add Bilibili platform implementation"
```

### Task 8: 其他平台实现（快手/视频号/公众号/闲鱼）

**Files:**
- Create: `packages/desktop/src/main/platform/platforms/kwai.ts`
- Create: `packages/desktop/src/main/platform/platforms/wxSph.ts`
- Create: `packages/desktop/src/main/platform/platforms/wxGzh.ts`
- Create: `packages/desktop/src/main/platform/platforms/xianyu.ts`

每个文件遵循相同的模式：

```typescript
// 模板：
import { PlatformBase, type PublishInput, type PublishResult, type PlatformAccountInfo, type AccountStats } from "../PlatformBase"
import type { Cookie } from "electron"

export class XxxPlatform extends PlatformBase {
  readonly id = "xxx"
  readonly name = "平台名"
  readonly loginUrl = "https://creator.xxx.com/login"

  async detectLogin(cookies: Cookie[]): Promise<boolean> {
    // 检查平台特有的 session cookie
  }

  async getAccountInfo(cookies: Cookie[]): Promise<PlatformAccountInfo> {
    // 调用平台的用户信息 API
  }

  async publish(input: PublishInput, cookies: Cookie[]): Promise<PublishResult> {
    // 移植自 XYMT-AUTO 的平台发布逻辑
  }

  async getPublishHistory(accountId: string): Promise<any[]> { return [] }
  async getAccountStats(accountId: string): Promise<AccountStats> {
    return { followers: 0, following: 0, totalPosts: 0, totalLikes: 0, updatedAt: Date.now() }
  }
}
```

- [ ] **Step 1: 创建 kwai.ts（快手）**
  - loginUrl: `https://cp.kuaishou.com/login`
  - Cookie 检测: `kuaishou.com` + `token` 或 `passport` cookie
  - 发布 API: `https://cp.kuaishou.com/rest/ai/video/publish`
  - 移植参考: `XYMT-AUTO/electron/plat/Kwai/`

- [ ] **Step 2: 创建 wxSph.ts（微信视频号）**
  - loginUrl: `https://channels.weixin.qq.com/platform/login`
  - Cookie 检测: `weixin.qq.com` + `token` cookie
  - 发布使用 WebView 注入方式

- [ ] **Step 3: 创建 wxGzh.ts（微信公众号）**
  - loginUrl: `https://mp.weixin.qq.com/`
  - Cookie 检测: `mp.weixin.qq.com` + `token` cookie
  - 发布使用 WebView 注入（自动填写草稿）

- [ ] **Step 4: 创建 xianyu.ts（闲鱼）**
  - loginUrl: `https://www.xianyu.com/login`
  - Cookie 检测: `xianyu.com` + `token` cookie
  - 发布逻辑：商品发布 API

- [ ] **Step 5: 全部验证编译 + Commit**

```bash
git add packages/desktop/src/main/platform/platforms/kwai.ts
git add packages/desktop/src/main/platform/platforms/wxSph.ts
git add packages/desktop/src/main/platform/platforms/wxGzh.ts
git add packages/desktop/src/main/platform/platforms/xianyu.ts
git commit -m "feat(pulse): add Kwai, WxSph, WxGzh, Xianyu platform implementations"
```

---

## Phase 3: IPC 与 Preload 桥接

### Task 9: 注册 IPC Handlers

**Files:**
- Modify: `packages/desktop/src/main/ipc.ts`

- [ ] **Step 1: 阅读现有 ipc.ts**

Read: `packages/desktop/src/main/ipc.ts` — 了解现有 handler 注册模式（使用 `ipcMain.handle`）

- [ ] **Step 2: 添加 platform IPC handlers**

在 `packages/desktop/src/main/ipc.ts` 中，找到 `registerIpcHandlers` 函数，在其中添加：

```typescript
import { ipcMain, BrowserWindow, session } from "electron"
import {
  getAccounts,
  saveAccount,
  removeAccount,
  getAccount,
  PlatformLoginManager,
  getSupportedPlatforms,
  getPlatform,
} from "./platform"

export function registerIpcHandlers() {
  // ... 现有 handlers ...

  // === Platform Management ===
  ipcMain.handle("platform:get-accounts", async () => {
    return getAccounts()
  })

  ipcMain.handle("platform:get-supported-platforms", async () => {
    return getSupportedPlatforms()
  })

  ipcMain.handle("platform:add-account", async (_event, platformType: string) => {
    const platform = getPlatform(platformType)
    const loginManager = new PlatformLoginManager()
    const result = await loginManager.startLogin(platform.loginUrl, platform.name)

    if (!result.success || !result.cookies) {
      return { success: false, error: result.error || "登录失败" }
    }

    const isLoggedIn = await platform.detectLogin(result.cookies)
    if (!isLoggedIn) {
      return { success: false, error: "Cookie 验证失败" }
    }

    const accountInfo = await platform.getAccountInfo(result.cookies)
    const account = {
      id: `${platformType}_${Date.now()}`,
      platform: platformType,
      nickname: accountInfo.nickname,
      avatar: accountInfo.avatar,
      cookies: JSON.stringify(result.cookies),
      loginTime: Date.now(),
      status: "valid" as const,
    }
    saveAccount(account)
    return { success: true, account }
  })

  ipcMain.handle("platform:remove-account", async (_event, id: string) => {
    removeAccount(id)
    return { success: true }
  })

  ipcMain.handle("platform:check-login", async (_event, id: string) => {
    const account = getAccount(id)
    if (!account) return { valid: false }
    const platform = getPlatform(account.platform)
    const cookies: Electron.Cookie[] = JSON.parse(account.cookies)
    const valid = await platform.detectLogin(cookies)
    if (!valid) {
      saveAccount({ ...account, status: "expired" })
    }
    return { valid }
  })

  ipcMain.handle("platform:publish", async (event, input: { accountId: string; publishInput: any }) => {
    const account = getAccount(input.accountId)
    if (!account) throw new Error("账号不存在")
    const platform = getPlatform(account.platform)
    const cookies: Electron.Cookie[] = JSON.parse(account.cookies)
    return platform.publish(input.publishInput, cookies)
  })
}
```

- [ ] **Step 3: 验证编译**

Run: `bun typecheck` (from `packages/desktop`)

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/main/ipc.ts
git commit -m "feat(pulse): add platform IPC handlers for account and publish management"
```

### Task 10: 更新 Preload 桥接

**Files:**
- Modify: `packages/desktop/src/preload/types.ts`
- Modify: `packages/desktop/src/preload/index.ts`

- [ ] **Step 1: 在 types.ts 中添加 PlatformAPI 类型**

在 `packages/desktop/src/preload/types.ts` 末尾添加：

```typescript
export interface PlatformAccount {
  id: string
  platform: string
  nickname: string
  avatar: string
  cookies: string
  loginTime: number
  status: "valid" | "expired" | "login_failed"
}

export interface PlatformPublishInput {
  type: "video" | "image_text" | "article"
  title: string
  description: string
  filePaths?: string[]
  tags?: string[]
  scheduleTime?: number
}

export interface PlatformPublishResult {
  success: boolean
  platformPostId?: string
  error?: string
  url?: string
}

export interface PlatformAPI {
  getAccounts: () => Promise<PlatformAccount[]>
  getSupportedPlatforms: () => Promise<{ id: string; name: string }[]>
  addAccount: (platformType: string) => Promise<{ success: boolean; account?: PlatformAccount; error?: string }>
  removeAccount: (id: string) => Promise<{ success: boolean }>
  checkLogin: (id: string) => Promise<{ valid: boolean }>
  publish: (input: { accountId: string; publishInput: PlatformPublishInput }) => Promise<PlatformPublishResult>
}

export interface ElectronAPI {
  // ... existing ...
  platform: PlatformAPI
}
```

- [ ] **Step 2: 在 index.ts 中添加 platform API 暴露**

在 `packages/desktop/src/preload/index.ts` 中，在 `contextBridge.exposeInMainWorld` 内添加：

```typescript
contextBridge.exposeInMainWorld("api", {
  // ... existing ...

  platform: {
    getAccounts: () => ipcRenderer.invoke("platform:get-accounts"),
    getSupportedPlatforms: () => ipcRenderer.invoke("platform:get-supported-platforms"),
    addAccount: (platformType: string) => ipcRenderer.invoke("platform:add-account", platformType),
    removeAccount: (id: string) => ipcRenderer.invoke("platform:remove-account", id),
    checkLogin: (id: string) => ipcRenderer.invoke("platform:check-login", id),
    publish: (input: any) => ipcRenderer.invoke("platform:publish", input),
  },
})
```

- [ ] **Step 3: 验证编译**

Run: `bun typecheck` (from `packages/desktop`)

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/preload/types.ts packages/desktop/src/preload/index.ts
git commit -m "feat(pulse): add platform API to preload bridge"
```

---

## Phase 4: 前端 UI

### Task 11: 创建平台管理 Context

**Files:**
- Create: `packages/app/src/context/platform.tsx`

- [ ] **Step 1: 创建 platform.tsx**

```typescript
// packages/app/src/context/platform.tsx
import { createContext, useContext } from "solid-js"
import { createStore } from "solid-js/store"

export interface PlatformAccount {
  id: string
  platform: string
  nickname: string
  avatar: string
  loginTime: number
  status: "valid" | "expired" | "login_failed"
}

export interface PlatformInfo {
  id: string
  name: string
  icon: string
  color: string
}

export const PLATFORM_LIST: PlatformInfo[] = [
  { id: "xhs", name: "小红书", icon: "📕", color: "#FF2442" },
  { id: "douyin", name: "抖音", icon: "🎵", color: "#000000" },
  { id: "bilibili", name: "B站", icon: "📺", color: "#00A1D6" },
  { id: "kwai", name: "快手", icon: "🎬", color: "#FF4906" },
  { id: "wxSph", name: "视频号", icon: "📹", color: "#07C160" },
  { id: "wxGzh", name: "公众号", icon: "📰", color: "#07C160" },
  { id: "xianyu", name: "闲鱼", icon: "🐟", color: "#FF6A00" },
]

interface PlatformStore {
  accounts: PlatformAccount[]
  selectedAccountId: string | null
  loading: boolean
}

const [platformStore, setPlatformStore] = createStore<PlatformStore>({
  accounts: [],
  selectedAccountId: null,
  loading: false,
})

const PlatformContext = createContext<{
  store: typeof platformStore
  setStore: typeof setPlatformStore
  refreshAccounts: () => Promise<void>
  addAccount: (platform: string) => Promise<void>
  removeAccount: (id: string) => Promise<void>
  selectAccount: (id: string | null) => void
}>(null!)

export function PlatformProvider(props: { children: any }) {
  const refreshAccounts = async () => {
    if (window.api?.platform?.getAccounts) {
      const accounts = await window.api.platform.getAccounts()
      setPlatformStore("accounts", accounts)
    }
  }

  const addAccount = async (platform: string) => {
    if (!window.api?.platform?.addAccount) return
    const result = await window.api.platform.addAccount(platform)
    if (result.success) {
      await refreshAccounts()
    }
  }

  const removeAccount = async (id: string) => {
    if (!window.api?.platform?.removeAccount) return
    await window.api.platform.removeAccount(id)
    await refreshAccounts()
    if (platformStore.selectedAccountId === id) {
      setPlatformStore("selectedAccountId", null)
    }
  }

  const selectAccount = (id: string | null) => {
    setPlatformStore("selectedAccountId", id)
  }

  return (
    <PlatformContext.Provider
      value={{ store: platformStore, setStore: setPlatformStore, refreshAccounts, addAccount, removeAccount, selectAccount }}
    >
      {props.children}
    </PlatformContext.Provider>
  )
}

export function usePlatform() {
  return useContext(PlatformContext)
}
```

- [ ] **Step 2: 验证编译**

Run: `bun typecheck` (from `packages/app`)

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/context/platform.tsx
git commit -m "feat(pulse): add platform management context"
```

### Task 12: PulseLayout 三栏容器

**Files:**
- Create: `packages/app/src/pages/pulse/PulseLayout.tsx`
- Create: `packages/app/src/pages/pulse/types.ts`
- Create: `packages/app/src/pages/pulse/index.ts`

- [ ] **Step 1: 创建 types.ts**

```typescript
// packages/app/src/pages/pulse/types.ts
import type { PlatformAccount } from "@/context/platform"

export interface PublishForm {
  type: "video" | "image_text" | "article"
  title: string
  description: string
  filePaths: string[]
  tags: string[]
  scheduleTime?: number
  selectedAccounts: string[]  // account IDs
}
```

- [ ] **Step 2: 创建 PulseLayout.tsx**

```typescript
// packages/app/src/pages/pulse/PulseLayout.tsx
import { onMount } from "solid-js"
import { PlatformProvider, usePlatform } from "@/context/platform"
import { PulseSidebar } from "./PulseSidebar"
import { PulseMain } from "./PulseMain"
import { PulseAssistant } from "./PulseAssistant"

function PulseLayoutInner() {
  const platform = usePlatform()

  onMount(() => {
    platform.refreshAccounts()
  })

  return (
    <div class="flex h-full w-full">
      {/* 左侧: 账号列表 */}
      <div class="w-64 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
        <PulseSidebar />
      </div>
      {/* 中间: 内容区域 */}
      <div class="flex-1 overflow-auto">
        <PulseMain />
      </div>
      {/* 右侧: AI 助手 */}
      <div class="w-80 flex-shrink-0 border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
        <PulseAssistant />
      </div>
    </div>
  )
}

export default function PulseLayout() {
  return (
    <PlatformProvider>
      <PulseLayoutInner />
    </PlatformProvider>
  )
}
```

- [ ] **Step 3: 创建 index.ts**

```typescript
// packages/app/src/pages/pulse/index.ts
export { default as PulseLayout } from "./PulseLayout"
export { PulseSidebar } from "./PulseSidebar"
export { PulseMain } from "./PulseMain"
export { PulseAssistant } from "./PulseAssistant"
```

- [ ] **Step 4: 验证编译**

Run: `bun typecheck` (from `packages/app`)

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/pages/pulse/types.ts
git add packages/app/src/pages/pulse/PulseLayout.tsx
git add packages/app/src/pages/pulse/index.ts
git commit -m "feat(pulse): add PulseLayout three-column container"
```

### Task 13: PulseSidebar 左侧账号列表

**Files:**
- Create: `packages/app/src/pages/pulse/PulseSidebar.tsx`

- [ ] **Step 1: 创建 PulseSidebar.tsx**

```typescript
// packages/app/src/pages/pulse/PulseSidebar.tsx
import { For, Show } from "solid-js"
import { usePlatform, PLATFORM_LIST, type PlatformInfo } from "@/context/platform"

function PlatformIcon(props: { platform: PlatformInfo; status?: string }) {
  const statusColor = () => {
    switch (props.status) {
      case "valid": return "bg-green-500"
      case "expired": return "bg-yellow-500"
      case "login_failed": return "bg-red-500"
      default: return "bg-gray-300"
    }
  }

  return (
    <div class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer">
      <div class="relative flex-shrink-0 text-xl w-8 h-8 flex items-center justify-center"
        style={{ color: props.platform.color }}>
        {props.platform.icon}
        <Show when={props.status}>
          <span class={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${statusColor()} border-2 border-white dark:border-gray-900`} />
        </Show>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium truncate">{props.platform.name}</div>
        <div class="text-xs text-gray-500 truncate">
          {props.status === "valid" ? "已登录" : props.status === "expired" ? "已过期" : "未登录"}
        </div>
      </div>
    </div>
  )
}

export function PulseSidebar() {
  const platform = usePlatform()

  return (
    <div class="flex flex-col h-full">
      <div class="p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 class="text-lg font-bold">运营平台</h2>
      </div>

      <div class="flex-1 overflow-y-auto p-2 space-y-1">
        <For each={PLATFORM_LIST}>
          {(plat) => {
            const account = () => platform.store.accounts.find((a) => a.platform === plat.id)
            const isSelected = () => platform.store.selectedAccountId === account()?.id
            return (
              <div
                class={`rounded-lg transition-colors ${
                  isSelected() ? "bg-blue-50 dark:bg-blue-900/30 ring-1 ring-blue-200 dark:ring-blue-700" : ""
                }`}
                onClick={() => account() ? platform.selectAccount(account()!.id) : platform.addAccount(plat.id)}
              >
                <PlatformIcon platform={plat} status={account()?.status} />
              </div>
            )
          }}
        </For>
      </div>

      <div class="p-3 border-t border-gray-200 dark:border-gray-700">
        <button
          class="w-full text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 py-1.5 px-3 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          onClick={() => {/* 刷新全部登录态 */}}
        >
          🔄 刷新状态
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证编译**

Run: `bun typecheck` (from `packages/app`)

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/pages/pulse/PulseSidebar.tsx
git commit -m "feat(pulse): add PulseSidebar with platform account list"
```

### Task 14: PulseMain 中间内容区

**Files:**
- Create: `packages/app/src/pages/pulse/PulseMain.tsx`

- [ ] **Step 1: 创建 PulseMain.tsx**

```typescript
// packages/app/src/pages/pulse/PulseMain.tsx
import { Show, createSignal } from "solid-js"
import { usePlatform, PLATFORM_LIST } from "@/context/platform"
import type { PlatformAccount } from "@/context/platform"

function AccountOverview(props: { account: PlatformAccount }) {
  const platformInfo = () => PLATFORM_LIST.find((p) => p.id === props.account.platform)

  return (
    <div class="p-6 space-y-6">
      <div class="flex items-center gap-4">
        <div class="text-4xl">{platformInfo()?.icon}</div>
        <div>
          <h2 class="text-xl font-bold">{props.account.nickname}</h2>
          <p class="text-sm text-gray-500">{platformInfo()?.name} · {props.account.status === "valid" ? "已登录" : "已过期"}</p>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-4">
        <div class="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div class="text-2xl font-bold">-</div>
          <div class="text-sm text-gray-500">粉丝</div>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div class="text-2xl font-bold">-</div>
          <div class="text-sm text-gray-500">作品</div>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div class="text-2xl font-bold">-</div>
          <div class="text-sm text-gray-500">获赞</div>
        </div>
      </div>

      <div class="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
        <h3 class="font-medium mb-3">快捷操作</h3>
        <div class="flex gap-3">
          <button class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm transition-colors">
            📤 发布内容
          </button>
          <button class="px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-sm transition-colors">
            📋 查看作品
          </button>
        </div>
      </div>

      <div class="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
        <h3 class="font-medium mb-3">最近发布</h3>
        <p class="text-sm text-gray-400 py-8 text-center">暂无发布记录</p>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div class="flex items-center justify-center h-full">
      <div class="text-center text-gray-400">
        <div class="text-5xl mb-4">👈</div>
        <p class="text-lg">选择一个平台账号</p>
        <p class="text-sm mt-1">点击左侧已登录的账号查看详情</p>
        <p class="text-sm">或点击未登录的账号进行绑定</p>
      </div>
    </div>
  )
}

export function PulseMain() {
  const platform = usePlatform()
  const selectedAccount = () =>
    platform.store.accounts.find((a) => a.id === platform.store.selectedAccountId)

  return (
    <Show when={selectedAccount()} fallback={<EmptyState />}>
      {(account) => <AccountOverview account={account()} />}
    </Show>
  )
}
```

- [ ] **Step 2: 验证编译**

Run: `bun typecheck` (from `packages/app`)

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/pages/pulse/PulseMain.tsx
git commit -m "feat(pulse): add PulseMain content area with account overview"
```

### Task 15: PulseAssistant 右侧 AI 面板

**Files:**
- Create: `packages/app/src/pages/pulse/PulseAssistant.tsx`

- [ ] **Step 1: 创建 PulseAssistant.tsx**

```typescript
// packages/app/src/pages/pulse/PulseAssistant.tsx
import { createSignal } from "solid-js"

export function PulseAssistant() {
  const [input, setInput] = createSignal("")
  const [messages, setMessages] = createSignal<{ role: string; content: string }[]>([])

  const handleSend = () => {
    if (!input().trim()) return
    setMessages([...messages(), { role: "user", content: input() }])
    setMessages((prev) => [...prev, { role: "assistant", content: "AI 运营助手功能即将上线，敬请期待！" }])
    setInput("")
  }

  return (
    <div class="flex flex-col h-full">
      <div class="p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 class="font-semibold text-sm">AI 运营助手</h3>
        <p class="text-xs text-gray-500 mt-0.5">内容生成 · 自动发布 · 智能回复</p>
      </div>

      <div class="flex-1 overflow-y-auto p-3 space-y-3">
        {messages().length === 0 && (
          <div class="text-center text-gray-400 text-sm mt-8 space-y-2">
            <p>💡 我可以帮你：</p>
            <p class="text-xs">• 生成小红书种草文案</p>
            <p class="text-xs">• 撰写抖音短视频脚本</p>
            <p class="text-xs">• 创建公众号文章</p>
            <p class="text-xs">• 多平台一键分发</p>
          </div>
        )}
        {messages().map((msg) => (
          <div class={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div class={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
              msg.role === "user"
                ? "bg-blue-500 text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200"
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
      </div>

      <div class="p-3 border-t border-gray-200 dark:border-gray-700">
        <div class="flex gap-2">
          <input
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="输入指令..."
            class="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSend}
            class="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm transition-colors"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证编译**

Run: `bun typecheck` (from `packages/app`)

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/pages/pulse/PulseAssistant.tsx
git commit -m "feat(pulse): add PulseAssistant right panel with AI chat UI"
```

### Task 16: 路由集成

**Files:**
- Modify: `packages/app/src/app.tsx`
- Modify: `packages/app/src/pages/home.tsx`

- [ ] **Step 1: 在 app.tsx 中添加 pulse 路由**

在 `packages/app/src/app.tsx` 中，找到 `Router` 部分，添加：

```typescript
import { lazy } from "solid-js"

const PulseLayout = lazy(() => import("@/pages/pulse/PulseLayout"))

// 在 Router 内添加：
<Route path="/pulse" component={PulseLayout} />
```

完整路由结构变为：
```typescript
<Route path="/" component={HomeRoute} />
<Route path="/pulse" component={PulseLayout} />
<Route path="/:dir" component={DirectoryLayout}>
  <Route path="/" component={SessionIndexRoute} />
  <Route path="/session/:id?" component={SessionRoute} />
</Route>
```

- [ ] **Step 2: 在 home.tsx 中添加 pulse 模式导航**

在 `packages/app/src/pages/home.tsx` 中，找到模式判断逻辑，添加 pulse 情况：

```typescript
// 找到类似这样的代码：
if (currentMode() === "zen") return <ZenHome />

// 在后面添加：
if (currentMode() === "pulse") return <Navigate href="/pulse" />
```

- [ ] **Step 3: 验证编译**

Run: `bun typecheck` (from `packages/app`)
Run: `bun lint` (from project root)

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/app.tsx packages/app/src/pages/home.tsx
git commit -m "feat(pulse): add pulse route and mode navigation"
```

---

## 自检清单

- [ ] **覆盖度检查**：设计文档中的每个模块都有对应的实现任务
- [ ] **无占位符**：所有代码块都包含完整的实现代码
- [ ] **类型一致**：PlatformBase 的方法签名在 store、IPC、preload、前端各层保持一致
- [ ] **依赖顺序**：Task 1→4 是基础设施，Task 5→8 是平台实现，Task 9→10 是 IPC 桥接，Task 11→16 是前端 UI
