# PowersNexus 更新发布与 stable 自动更新操作总手册

生成时间：2026-07-21  
适用仓库：
- NovaWay Coder：`E:\AImoney\NovaWay-Matrix\novaway-coder`
- PowersNexus：`E:\AImoney\NovaWay-Matrix\novaway-coder\PowersNexus`（或独立 `E:\AImoney\PowersNexus`）
- Gitee 发布仓：`https://gitee.com/nova-way/powersnexus`

> 本文是后续「改 PowersNexus → 发布 → 用户更新」的**唯一主入口**。  
> 更细的专项文档见文末「相关文档索引」。

---

## 0. 先读懂：当前模型

### 0.1 两套版本来源

| 来源 | 含义 | 何时用 |
|------|------|--------|
| **bundled** | 打进 NovaWay 安装包的内置 PowersNexus 基线 | **当前默认**；离线可用 |
| **stable（Gitee Release）** | 签名后的在线稳定版 | 策略为 `stable` 且门禁通过时 |

### 0.2 当前默认行为（很重要）

```text
POWERSNEXUS_UPDATE_POLICY = bundled   ← 桌面端默认
```

因此：

1. 用户启动 NovaWay → 使用**内置** PowersNexus。  
2. **不会**因为你在 Gitee 仓库 `git push` 了代码就自动更新。  
3. 只有走完本文的 **签名 + Gitee Release 发布**，并且客户端策略为 **`stable`**，才会走在线更新通道。

### 0.3 在线更新不是「git push」

用户端只认：

```text
https://gitee.com/nova-way/powersnexus/releases/download/powersnexus-stable/manifest.json
```

以及 Manifest 里 `artifactUrl` 指向的 **已签名 ZIP**。

只 push commit、不开 Release、不更新 channel Manifest = **用户端无更新**。

---

## 1. 发布架构（Gitee 双 Release）

Gitee 没有可用的「永远固定的 latest 附件 URL」可直接当 channel，因此采用：

### 1.1 版本 Release（不可变）

```text
Tag：v{version}          例：v6.1.0
附件：
  powersnexus-{version}.zip
  files.sha256
  manifest.json          （已签名）
```

示例 ZIP：

```text
https://gitee.com/nova-way/powersnexus/releases/download/v6.1.0/powersnexus-6.1.0.zip
```

**规则：同一 tag 的 ZIP 发布后禁止覆盖。** 修 bug 必须升版本（如 6.1.1）。

### 1.2 channel Release（可更新）

```text
Tag：powersnexus-stable
附件：
  manifest.json          （当前 stable 指向哪个版本）
```

固定 URL（NovaWay 默认读这个）：

```text
https://gitee.com/nova-way/powersnexus/releases/download/powersnexus-stable/manifest.json
```

发布时顺序必须是：

```text
1) 上传不可变版本附件
2) 远程复验 ZIP + Manifest
3) 最后才更新 powersnexus-stable/manifest.json
```

### 1.3 密钥

| 物品 | 路径 | 进 Git？ |
|------|------|----------|
| 发布私钥 | `E:\AImoney\secrets\powersnexus-release\powersnexus-release-private-key.pem` | **否** |
| 发布公钥 | `packages/desktop/resources/powersnexus-release-public-key.pem` | 是 |
| 内置 keyID | `powersnexus-bundled-2026-01` | 是（bundled 重签） |
| 在线 keyID | `powersnexus-release-2026-01` | 环境/Manifest |

CI Secret 建议名：

```text
POWERSNEXUS_RELEASE_PRIVATE_KEY_PEM
GITEE_ACCESS_TOKEN
```

---

## 2. 日常更新 PowersNexus：完整 SOP

下面是你**每次改完 PowersNexus 要上线**时的标准流程。

### 步骤 A：改代码并固定版本

```powershell
cd E:\AImoney\NovaWay-Matrix\novaway-coder\PowersNexus

# 1) 开发、测试
npm.cmd run test:core
npm.cmd run test:uiux
npm.cmd run test:package
# 完整平台测试（Git Bash）
& "C:\Program Files\Git\bin\bash.exe" -lc "cd /e/AImoney/NovaWay-Matrix/novaway-coder/PowersNexus && npm run test:all"

# 2) 若功能变更需要发版，先改 package.json 版本号
# 例：6.1.0 → 6.1.1（禁止复用已发布版本号）
node -p "require('./package.json').version"

# 3) 提交到 gitee/main（或你的发布分支）
git status
git rev-parse HEAD   # 记下 40 位 SHA，发布时要用
```

### 步骤 B：构建确定性发布物

```powershell
cd E:\AImoney\NovaWay-Matrix\novaway-coder\PowersNexus

$sha = git rev-parse HEAD
$version = node -p "require('./package.json').version"
# 版本化目录 URL 前缀必须与 Gitee 下载地址一致：
$baseUrl = "https://gitee.com/nova-way/powersnexus/releases/download/v$version"

node scripts/build-release-artifact.mjs `
  --source-commit $sha `
  --artifact-base-url $baseUrl `
  --minimum-novaway-version 1.3.0 `
  --maximum-novaway-version "<2.0.0" `
  --key-id powersnexus-release-2026-01 `
  --channel stable
```

产物目录：

```text
PowersNexus/dist/release/
  powersnexus-{version}.zip
  files.sha256
  manifest.unsigned.json
  manifest.canonical.json
```

**检查点：**

```powershell
$m = Get-Content .\dist\release\manifest.unsigned.json -Raw | ConvertFrom-Json
$m | Select-Object version, channel, sourceCommit, artifactUrl, keyID, artifactSha256
```

`artifactUrl` 必须恰好等于：

```text
https://gitee.com/nova-way/powersnexus/releases/download/v{version}/powersnexus-{version}.zip
```

### 步骤 C：用生产私钥签名

```powershell
$priv = "E:\AImoney\secrets\powersnexus-release\powersnexus-release-private-key.pem"

node scripts/sign-release-manifest.mjs `
  --manifest dist/release/manifest.unsigned.json `
  --output dist/release/manifest.json `
  --private-key $priv
```

**禁止：**

- 把私钥复制进仓库
- 在聊天/日志打印私钥
- 签名后再改 Manifest 任意字段或 ZIP 内容

### 步骤 D：发布计划检查（不上传）

回到 NovaWay 仓库根：

```powershell
cd E:\AImoney\NovaWay-Matrix\novaway-coder
bun packages/desktop/scripts/publish-powersnexus-gitee-release.mjs --json
```

必须：

```json
{
  "ready": true,
  "blockers": []
}
```

若 `artifactUrl 不匹配`：回到步骤 B 用正确 `baseUrl` 重构建并重签。

### 步骤 E：真实上传到 Gitee Release

```powershell
# 令牌不要写进仓库；会话级注入：
$secure = Read-Host "粘贴 Gitee 私人令牌" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:GITEE_ACCESS_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

bun packages/desktop/scripts/publish-powersnexus-gitee-release.mjs --execute --json

Remove-Item Env:GITEE_ACCESS_TOKEN
```

脚本会自动：

1. 创建/更新 `v{version}` Release  
2. 上传 ZIP / files.sha256 / 版本 Manifest（同内容可复用，不同内容拒绝覆盖）  
3. 创建/更新 `powersnexus-stable`  
4. 备份并替换 channel `manifest.json`  
5. 从公开 URL 重新下载并校验 digest  

### 步骤 F：发布后验收（必须做）

```powershell
cd E:\AImoney\NovaWay-Matrix\novaway-coder

# 1) 门禁（配置形态）
$env:POWERSNEXUS_UPDATE_POLICY = "stable"
$env:POWERSNEXUS_RELEASE_KEY_ID = "powersnexus-release-2026-01"
$env:POWERSNEXUS_RELEASE_MANIFEST_URLS = "https://gitee.com/nova-way/powersnexus/releases/download/powersnexus-stable/manifest.json"
$env:POWERSNEXUS_RELEASE_ALLOWED_HOSTS = "gitee.com,foruda.gitee.com"
$env:POWERSNEXUS_RELEASE_PUBLIC_KEY = "$PWD\packages\desktop\resources\powersnexus-release-public-key.pem"
bun packages/desktop/scripts/check-stable-production-gate.mjs
# 期望：ready=true

# 2) Windows 真实在线升级 E2E（check/install/activate/rollback）
$env:POWERSNEXUS_NOVAWAY_VERSION = "1.15.4"
bun packages/opencode/script/powersnexus-stable-online.ts
# 期望：passed=true

# 3) 清理临时环境变量（避免污染后续默认 bundled）
Remove-Item Env:POWERSNEXUS_UPDATE_POLICY,Env:POWERSNEXUS_RELEASE_KEY_ID,Env:POWERSNEXUS_RELEASE_MANIFEST_URLS,Env:POWERSNEXUS_RELEASE_ALLOWED_HOSTS,Env:POWERSNEXUS_RELEASE_PUBLIC_KEY,Env:POWERSNEXUS_NOVAWAY_VERSION -ErrorAction SilentlyContinue
```

公开地址快速人工检查：

```text
https://gitee.com/nova-way/powersnexus/releases/tag/v{version}
https://gitee.com/nova-way/powersnexus/releases/tag/powersnexus-stable
```

---

## 3. 版本号与兼容性规则

### 3.1 何时必须升版本

| 情况 | 动作 |
|------|------|
| 任意代码/技能/文档进入发布 ZIP | 升 `package.json` 版本 |
| 已发布 `v6.1.0` 后发现错误 | **禁止覆盖**；发 `6.1.1+` |
| 仅改 NovaWay 客户端、不改 PowersNexus 内容 | 不必发 PowersNexus Release |

### 3.2 Manifest 关键字段

| 字段 | 说明 |
|------|------|
| `version` | 与 package.json 一致 |
| `channel` | `stable` 或 `preview` |
| `sourceCommit` | 40 位 git SHA |
| `artifactUrl` | 必须 HTTPS，且与实际上传路径一致 |
| `artifactSha256` / `filesSha256` | 与 ZIP/清单一致 |
| `keyID` | `powersnexus-release-2026-01` |
| `minimumNovaWayVersion` / `maximumNovaWayVersion` | 与 NovaWay 兼容窗口 |
| `signature` | Ed25519，对规范化 JSON 签名 |

### 3.3 是否需要重发 NovaWay

| 变更 | 是否必须重发 NovaWay |
|------|----------------------|
| 仅 PowersNexus stable 热更新 | **否**（策略 stable 时） |
| 换发布公钥 / 新 keyID | **是**（公钥在安装包内） |
| 更新内置 bundled 基线 | **是**（基线打进安装资源） |
| 默认策略从 bundled 改 stable | **是**（改桌面默认配置） |

---

## 4. 客户端更新策略：bundled vs stable

### 4.1 配置来源（优先级概念）

```text
配置文件 powersnexus.updatePolicy
  > 环境变量 POWERSNEXUS_UPDATE_POLICY
  > 代码默认 "bundled"
```

相关环境变量：

```text
POWERSNEXUS_UPDATE_POLICY              # bundled | stable | manual | developer
POWERSNEXUS_RELEASE_MANIFEST_URLS      # 逗号分隔 Manifest URL
POWERSNEXUS_RELEASE_ALLOWED_HOSTS      # 必须含 gitee.com 与 foruda.gitee.com
POWERSNEXUS_RELEASE_KEY_ID             # powersnexus-release-2026-01
POWERSNEXUS_RELEASE_PUBLIC_KEY         # 公钥 PEM 路径（桌面端会自动设置）
```

桌面端当前**已内置**（即使策略是 bundled）：

```text
Manifest：.../powersnexus-stable/manifest.json
Hosts：gitee.com,foruda.gitee.com
keyID：powersnexus-release-2026-01
Policy 默认：bundled
```

> `foruda.gitee.com` 必须在白名单：Gitee 下载会 302 到附件域名。

### 4.2 更新 API（已实现）

| 动作 | 路径 | 作用 |
|------|------|------|
| check | `POST /powersnexus/update/check` | 拉取并验签 Manifest |
| install | `POST /powersnexus/update/install` | 下载 ZIP、校验、doctor、注册版本 |
| activate | `POST /powersnexus/update/activate` | 切换 active（活动工作流可能 deferred） |
| rollback | `POST /powersnexus/update/rollback` | 回退 previous |

设置页当前按钮：

- **检查更新** → 调用 check  
- **回滚** → 调用 rollback  
- install / activate：API 已具备；UI 可后续补按钮或做启动自动链路  

### 4.3 策略行为对照

| 策略 | 启动时用什么 | 能否在线更新 |
|------|--------------|--------------|
| `bundled`（默认） | 内置基线 | check 直接返回，不拉网 |
| `stable` | 上次激活版本 / 下载版本 | 可 check/install/activate |
| `developer` | 本地开发目录 | 不走 Gitee stable |
| `manual` | 本地已安装版本管理 | 按实现选择 |

### 4.4 活动工作流保护

若存在活动 PowersNexus run：

- `activate` 可能返回 **deferred**  
- 不会在跑任务中途硬切版本  
- run 结束后再激活  

---

## 5. 如何把默认策略改为 stable（让用户走在线更新）

> 改默认策略 = **发新的 NovaWay 版本**，不是只改 PowersNexus。

### 5.1 改默认前的检查清单

- [ ] Gitee `powersnexus-stable/manifest.json` 可公网下载  
- [ ] ZIP 验签与 digest 通过  
- [ ] `check-stable-production-gate.mjs` → `ready=true`  
- [ ] Windows `powersnexus-stable-online.ts` → `passed=true`  
- [ ] （建议）macOS/Linux 至少完成冒烟  
- [ ] （建议）7 日 KPI `ready_for_release_proxy=true`  
- [ ] 已演练紧急切回 `bundled`

### 5.2 代码改动点（桌面默认）

文件：`packages/desktop/src/main/index.ts`

当前：

```ts
process.env.POWERSNEXUS_UPDATE_POLICY = process.env.POWERSNEXUS_UPDATE_POLICY ?? "bundled"
```

改为默认 stable（仍允许环境变量覆盖）：

```ts
process.env.POWERSNEXUS_UPDATE_POLICY = process.env.POWERSNEXUS_UPDATE_POLICY ?? "stable"
```

Manifest / Hosts / keyID 已有默认，一般不用再改。

同步检查：

```text
packages/desktop/scripts/verify-powersnexus-packaging.mjs
```

其中断言「默认 bundled」的检查需改为「默认 stable」或删除该硬编码断言。

### 5.3 配置文件方式（不改默认，仅本机/灰度）

用户或管理员配置：

```json
{
  "powersnexus": {
    "updatePolicy": "stable",
    "releaseManifestUrls": [
      "https://gitee.com/nova-way/powersnexus/releases/download/powersnexus-stable/manifest.json"
    ],
    "releaseAllowedHosts": ["gitee.com", "foruda.gitee.com"]
  }
}
```

### 5.4 改成 stable 之后，用户侧会发生什么

**现在（API 已具备，启动全自动链路仍偏「检查能力」）：**

1. 策略为 `stable` 时，允许在线 check。  
2. 设置页可点「检查更新」。  
3. install/activate 可通过 API 完成。  
4. **尚未**在启动时无条件自动执行完整 `check → install → activate` 闭环（避免误升）。  

**若你要「启动即自动更新到 Gitee 最新」**，还需在 NovaWay 增加启动钩子（建议实现）：

```text
应用启动 / version-service.init 之后：
  if policy === stable && gate.ready:
    check()
    if available.digest !== active.digest:
      install({ targetDigest })
      activate({ targetDigest })  // 活动 run 则 deferred
    失败 → 保留 active/bundled，写 lastErrorCode
```

实现位置建议：

- `packages/opencode/src/powersnexus/version-service.ts`（服务内可选 auto）  
- 或桌面/sidecar 启动后调用 HTTP API  

在补上该钩子之前：

```text
默认改成 stable ≠ 启动就一定静默装完最新版
= 允许并优先使用 Gitee 在线通道
```

### 5.5 紧急关闭 stable

任意一层即可：

```powershell
# 客户端
$env:POWERSNEXUS_UPDATE_POLICY = "bundled"
```

或改回代码默认 `bundled` 后发 NovaWay 热修。

或冻结 Gitee channel：停止更新 `powersnexus-stable/manifest.json`，必要时回滚 channel 附件到旧 Manifest。

---

## 6. 端到端时序图（发布 + 用户更新）

### 6.1 你发版

```text
改 PowersNexus
 → 测通
 → 升版本号
 → build-release-artifact（Gitee URL）
 → sign-release-manifest（私钥）
 → publish-powersnexus-gitee-release --execute
 → 公网复验 + stable-online E2E
```

### 6.2 用户侧（策略 stable）

```text
check：
  GET powersnexus-stable/manifest.json
  → 302 foruda.gitee.com（白名单必须覆盖）
  → Ed25519 验签
  → 记录 available

install：
  GET artifactUrl 的 ZIP
  → artifactSha256 / filesSha256
  → 解压 + doctor
  → 注册 installed

activate：
  无活动 run → active 切换
  有活动 run → deferred，结束后再切

失败：
  保留 active；可 rollback 到 previous；bundled 始终可回退
```

---

## 7. 故障排查速查

| 现象 | 排查 |
|------|------|
| 发了 Gitee 代码，用户没更新 | 是否只 push 了 git？必须发 Release + 更新 channel Manifest；默认是否仍是 bundled |
| 门禁 ready=false | 策略是否 stable、URL 是否 HTTPS、hosts 是否含 gitee.com **和** foruda.gitee.com、公钥是否存在、keyID 是否生产值 |
| 验签失败 | 公钥/私钥是否一对、签名后是否改过字段、keyID 是否匹配 |
| ZIP digest 不一致 | 是否覆盖了同版本 ZIP、CDN/附件是否返回错误页 |
| artifactUrl 不匹配 | build 时 baseUrl 是否用 `.../releases/download/v{version}` |
| 激活 deferred | 是否有活动工作流；等结束后再 activate |
| 发布脚本拒绝同名附件 | 同版本内容变了；升版本重发 |

---

## 8. 一键命令备忘（复制区）

### 8.1 发新版（示例 6.1.1）

```powershell
cd E:\AImoney\NovaWay-Matrix\novaway-coder\PowersNexus
# 先改 package.json version=6.1.1 并提交
$sha = git rev-parse HEAD
$version = node -p "require('./package.json').version"
$baseUrl = "https://gitee.com/nova-way/powersnexus/releases/download/v$version"
$priv = "E:\AImoney\secrets\powersnexus-release\powersnexus-release-private-key.pem"

npm.cmd run test:core
node scripts/build-release-artifact.mjs --source-commit $sha --artifact-base-url $baseUrl --minimum-novaway-version 1.3.0 --maximum-novaway-version "<2.0.0" --key-id powersnexus-release-2026-01 --channel stable
node scripts/sign-release-manifest.mjs --manifest dist/release/manifest.unsigned.json --output dist/release/manifest.json --private-key $priv

cd E:\AImoney\NovaWay-Matrix\novaway-coder
bun packages/desktop/scripts/publish-powersnexus-gitee-release.mjs --json
# ready=true 后：
# $env:GITEE_ACCESS_TOKEN = ...
bun packages/desktop/scripts/publish-powersnexus-gitee-release.mjs --execute --json
```

### 8.2 验证 stable 通道

```powershell
cd E:\AImoney\NovaWay-Matrix\novaway-coder
$env:POWERSNEXUS_UPDATE_POLICY="stable"
$env:POWERSNEXUS_RELEASE_KEY_ID="powersnexus-release-2026-01"
$env:POWERSNEXUS_RELEASE_MANIFEST_URLS="https://gitee.com/nova-way/powersnexus/releases/download/powersnexus-stable/manifest.json"
$env:POWERSNEXUS_RELEASE_ALLOWED_HOSTS="gitee.com,foruda.gitee.com"
$env:POWERSNEXUS_RELEASE_PUBLIC_KEY="$PWD\packages\desktop\resources\powersnexus-release-public-key.pem"
$env:POWERSNEXUS_NOVAWAY_VERSION="1.15.4"
bun packages/desktop/scripts/check-stable-production-gate.mjs
bun packages/opencode/script/powersnexus-stable-online.ts
```

### 8.3 切回安全默认

```powershell
$env:POWERSNEXUS_UPDATE_POLICY="bundled"
# 或恢复桌面 index.ts 默认 "bundled" 后重发 NovaWay
```

---

## 9. 首次生产基线（已完成，供对照）

| 项 | 值 |
|----|-----|
| 版本 | 6.1.0 |
| 版本 Release | tag `v6.1.0` |
| channel | tag `powersnexus-stable` |
| 公钥 | `packages/desktop/resources/powersnexus-release-public-key.pem` |
| keyID | `powersnexus-release-2026-01` |
| Windows 在线 E2E | 已通过（M08） |
| 默认策略 | 仍为 **bundled** |

---

## 10. 相关文档索引

| 文档 | 用途 |
|------|------|
| **本文** `docs/powersnexus-update-and-stable-ops-guide.md` | **主入口：更新 + stable 全流程** |
| `docs/powersnexus-gitee-release-runbook.md` | Gitee 双 Release 细节与首次发布记录 |
| `docs/powersnexus-production-release-tutorial.md` | 通用生产发布设计与验收清单 |
| `docs/powersnexus-release-keys-runbook.md` | 密钥位置与签名命令 |
| `docs/powersnexus-stable-local-runbook.md` | 无 CDN 时的本机 harness |
| `docs/powersnexus-cross-platform-e2e-matrix.md` | M01–M09 矩阵 |
| `docs/powersnexus-kpi-nightly-baseline.md` | 7 天 KPI 与定时任务 |
| `docs/powersnexus-verification-report.md` | 当前完成度快照 |
| `docs/novaway-coder-powersnexus-first-party-integration-prd.md` | 产品/工程规格（含协议与门槛） |

---

## 11. 给你自己的最短记忆版

```text
1. 改 PowersNexus → 测通 → 升版本
2. build（artifactUrl 必须是 Gitee v{version} 下载地址）
3. 私钥签名 Manifest
4. publish-powersnexus-gitee-release --execute
5. 跑门禁 + stable-online E2E
6. 默认仍是 bundled：用户不会自动更新
7. 要用户走 Gitee：发 NovaWay，默认策略改 stable（并建议补启动自动 check/install/activate）
8. 出事：策略改回 bundled 或回滚 channel Manifest
```