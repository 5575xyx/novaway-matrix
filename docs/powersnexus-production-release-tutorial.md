# PowersNexus 生产 stable 发布完整教程

生成时间：2026-07-20  
适用仓库：`E:\AImoney\NovaWay-Matrix\novaway-coder`  
适用版本：PowersNexus `6.1.0`、NovaWay Coder `1.3.x`

> 已确定使用 **Gitee Release**。实际发布请优先按照 `docs/powersnexus-gitee-release-runbook.md` 操作；本文保留平台通用设计和验收要求。

## 1. 教程目标

本文用于完成从本机已签名发布物到生产 stable 更新的完整流程：

```text
确认发布参数
→ 构建确定性 ZIP
→ 使用 Ed25519 私钥签名
→ 本机校验
→ 上传不可变发布物
→ 原子更新 stable Manifest
→ 从生产地址重新下载校验
→ 通过 NovaWay stable 生产门禁
→ 三平台灰度
→ 正式启用 stable
```

当前仓库已经完成密钥生成、公钥安装、bundled 基线重签和 6.1.0 本地发布物签名。本文重点处理尚未完成的生产基础设施、上传、门禁和验收。

## 2. 当前已具备的材料

| 材料 | 当前路径 | 状态 |
|------|----------|------|
| PowersNexus 源码 | `PowersNexus\` | 已固定 6.1.0 发布基线 |
| 生产私钥 | `E:\AImoney\secrets\powersnexus-release\powersnexus-release-private-key.pem` | 已生成，不进 Git |
| 生产公钥 | `packages\desktop\resources\powersnexus-release-public-key.pem` | 已提交 |
| bundled keyID | `powersnexus-bundled-2026-01` | 已使用 |
| stable keyID | `powersnexus-release-2026-01` | 已使用 |
| 已签名 ZIP | `PowersNexus\dist\release\powersnexus-6.1.0.zip` | 已生成 |
| 文件摘要 | `PowersNexus\dist\release\files.sha256` | 已生成 |
| 已签名 Manifest | `PowersNexus\dist\release\manifest.json` | 已生成 |

当前 Manifest 中的目标地址为：

```text
https://gitee.com/nova-way/powersnexus/releases/download/v6.1.0/powersnexus-6.1.0.zip
```

在该地址对应的真实对象存储/CDN 尚未配置完成前，NovaWay 必须继续使用 `bundled`，不能默认启用 `stable`。

## 3. 开始前需要准备的信息

先填写下面的发布参数表。没有确认的项目不要使用占位值直接上线。

| 参数 | 示例 | 当前状态 |
|------|------|----------|
| 对象存储/CDN 供应商 | Cloudflare R2、OSS、COS、S3 等 | 待确认 |
| 存储桶名称 | `novaway-releases` | 待确认 |
| 生产公开域名 | `cdn.novaway.ai` | 待确认 |
| stable 根路径 | `/powersnexus/stable` | 建议使用 |
| CI 平台 | Gitee Go、GitHub Actions 或其他 | 待确认 |
| CI 写入凭证 | Access Key、OIDC 或平台令牌 | 待配置 |
| 私钥 Secret 名 | `POWERSNEXUS_RELEASE_PRIVATE_KEY_PEM` | 建议使用 |
| stable keyID | `powersnexus-release-2026-01` | 已确认 |

生产端点至少需要满足：

1. 对外使用 HTTPS。
2. 客户端可以匿名读取发布文件。
3. 只有发布 CI 可以写入或删除发布文件。
4. 版本 ZIP 和版本 Manifest 发布后不可覆盖。
5. `stable/manifest.json` 可以原子替换。
6. 支持为版本文件和 channel Manifest 设置不同缓存策略。

## 4. 生产目录设计

建议长期使用以下对象结构：

```text
powersnexus/
  releases/
    6.1.0/
      powersnexus-6.1.0.zip
      files.sha256
      manifest.json
  stable/
    manifest.json
```

对应 URL：

```text
https://cdn.novaway.ai/powersnexus/releases/6.1.0/powersnexus-6.1.0.zip
https://cdn.novaway.ai/powersnexus/releases/6.1.0/files.sha256
https://cdn.novaway.ai/powersnexus/releases/6.1.0/manifest.json
https://cdn.novaway.ai/powersnexus/stable/manifest.json
```

当前 6.1.0 Manifest 的 `artifactUrl` 已经指向：

```text
https://gitee.com/nova-way/powersnexus/releases/download/v6.1.0/powersnexus-6.1.0.zip
```

因此首次发布有两种选择：

### 方案 A：保持当前 URL

直接将 ZIP 上传到：

```text
/powersnexus/stable/powersnexus-6.1.0.zip
```

优点是不需要重新构建和签名；缺点是版本制品与 channel Manifest 位于同一目录。

### 方案 B：改为版本化目录，推荐长期使用

把 `artifact-base-url` 改为：

```text
https://cdn.novaway.ai/powersnexus/releases/6.1.0
```

然后重新构建并签名。`stable/manifest.json` 只负责指向版本化 ZIP。

一旦某个版本已经正式发布，禁止替换同版本 ZIP。修复发布错误时必须提升 PowersNexus 版本后重新发布。

## 5. 本机发布前检查

在 PowerShell 中执行：

```powershell
cd E:\AImoney\NovaWay-Matrix\novaway-coder

bun --version
node --version
npm --version

# 只检查文件是否存在，不要输出私钥内容
Test-Path "E:\AImoney\secrets\powersnexus-release\powersnexus-release-private-key.pem"
Test-Path ".\packages\desktop\resources\powersnexus-release-public-key.pem"

cd PowersNexus
node -p "require('./package.json').version"
git rev-parse HEAD
git status --short
```

预期：

- 两个 `Test-Path` 都返回 `True`。
- PowersNexus 版本为计划发布版本。
- `git rev-parse HEAD` 返回 40 位 SHA。
- 发布源码不存在未确认的修改。

如果 PowersNexus 工作区有修改，不要直接发布。先确认修改属于正式版本，并在测试、提交和版本号一致后继续。

## 6. 运行发布前测试

在 `PowersNexus` 目录执行：

```powershell
npm.cmd run test:core
npm.cmd run test:uiux
npm.cmd run test:package
```

Windows 完整平台测试应显式使用 Git Bash，避免调用到 WSL 的 `bash`：

```powershell
& "C:\Program Files\Git\bin\bash.exe" -lc "cd /e/AImoney/NovaWay-Matrix/novaway-coder/PowersNexus && npm run test:all"
```

任何测试失败都应停止发布，不能继续签名或上传。

## 7. 构建发布物

### 7.1 推荐的版本化目录构建

在 `PowersNexus` 目录执行：

```powershell
$sha = git rev-parse HEAD
$version = node -p "require('./package.json').version"
$baseUrl = "https://cdn.novaway.ai/powersnexus/releases/$version"

node scripts/build-release-artifact.mjs `
  --source-commit $sha `
  --artifact-base-url $baseUrl `
  --minimum-novaway-version 1.3.0 `
  --maximum-novaway-version "<2.0.0" `
  --key-id powersnexus-release-2026-01 `
  --channel stable
```

脚本会重建：

```text
dist/release/
  powersnexus-<version>.zip
  files.sha256
  manifest.unsigned.json
  manifest.canonical.json
```

构建约束：

- `sourceCommit` 必须是 40 位 Git SHA。
- `artifactBaseUrl` 必须是 HTTPS。
- `keyID` 只能包含字母、数字、点、下划线和连字符。
- channel 只能是 `stable` 或 `preview`。

### 7.2 保持当前 6.1.0 URL 的构建

```powershell
$sha = git rev-parse HEAD

node scripts/build-release-artifact.mjs `
  --source-commit $sha `
  --artifact-base-url "https://cdn.novaway.ai/powersnexus/stable" `
  --minimum-novaway-version 1.3.0 `
  --maximum-novaway-version "<2.0.0" `
  --key-id powersnexus-release-2026-01 `
  --channel stable
```

## 8. 使用生产私钥签名

继续在 `PowersNexus` 目录执行：

```powershell
$priv = "E:\AImoney\secrets\powersnexus-release\powersnexus-release-private-key.pem"

node scripts/sign-release-manifest.mjs `
  --manifest dist/release/manifest.unsigned.json `
  --output dist/release/manifest.json `
  --private-key $priv
```

预期输出包含：

```json
{
  "signed": true,
  "keyID": "powersnexus-release-2026-01"
}
```

禁止：

- 不要用 `Get-Content` 打印私钥。
- 不要把私钥复制进两个仓库。
- 不要把私钥放入 ZIP。
- 不要把私钥写入普通 CI 日志或构建 artifact。
- 不要通过命令行参数传递私钥正文，只传私钥文件路径。

## 9. 本机校验发布物

### 9.1 检查 Manifest 字段

```powershell
$manifest = Get-Content .\dist\release\manifest.json -Raw | ConvertFrom-Json
$manifest | Select-Object `
  version, channel, protocolVersion, sourceCommit, artifactUrl, `
  artifactSha256, filesSha256, artifactSize, fileCount, publishedAt, keyID
```

确认：

- `version` 与 `package.json` 一致。
- `channel` 为 `stable`。
- `sourceCommit` 与 `git rev-parse HEAD` 一致。
- `artifactUrl` 是最终生产 HTTPS 地址。
- `keyID` 为 `powersnexus-release-2026-01`。
- `signature` 非空。

### 9.2 检查 ZIP 摘要

```powershell
$zip = ".\dist\release\powersnexus-$($manifest.version).zip"
$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$expected = $manifest.artifactSha256.ToLowerInvariant()

[pscustomobject]@{
  actual = $actual
  expected = $expected
  matched = $actual -eq $expected
}
```

`matched` 必须为 `True`。

### 9.3 运行 NovaWay Manifest 和更新流程测试

```powershell
cd E:\AImoney\NovaWay-Matrix\novaway-coder\packages\opencode

bun test test/powersnexus/update-manifest.test.ts --timeout 30000
bun test test/powersnexus/update-service.test.ts --timeout 60000
bun test test/powersnexus/update-flow.test.ts --timeout 60000
```

这些测试必须全部通过。

## 10. 配置 CI Secret

建议 Secret 名称：

```text
POWERSNEXUS_RELEASE_PRIVATE_KEY_PEM
```

Secret 值为私钥 PEM 全文。只能在 CI 平台的加密 Secret 输入框中粘贴，禁止写入仓库文件。

CI 中的标准处理逻辑：

```powershell
$privateKeyFile = Join-Path $env:RUNNER_TEMP "powersnexus-release-private-key.pem"
[System.IO.File]::WriteAllText($privateKeyFile, $env:POWERSNEXUS_RELEASE_PRIVATE_KEY_PEM)
$env:POWERSNEXUS_RELEASE_PRIVATE_KEY_FILE = $privateKeyFile

node scripts/sign-release-manifest.mjs `
  --manifest dist/release/manifest.unsigned.json `
  --output dist/release/manifest.json

Remove-Item -LiteralPath $privateKeyFile -Force
```

CI 必须确保：

1. Secret 只对受保护发布分支或审批环境可见。
2. 外部 PR 任务不能读取发布 Secret。
3. 临时密钥文件不上传为 artifact。
4. 任务结束后删除临时文件。
5. 上传凭证和签名私钥使用不同 Secret。
6. 日志中不输出完整环境变量列表。

当前仓库远程为：

```text
https://gitee.com/stalkerno1/novaway-matrix.git
```

因此需要先确认实际使用 Gitee Go、外部 CI，还是同步到 GitHub 后通过 GitHub Actions 发布，再按对应平台配置 Secret。

## 11. 对象存储和 CDN 配置

### 11.1 权限

| 主体 | 权限 |
|------|------|
| 普通客户端 | 只读发布文件 |
| 发布 CI | 写入新版本、更新 channel Manifest |
| 日常开发账号 | 默认无生产写权限 |
| CDN | 从对象存储读取 |

### 11.2 MIME 类型

| 文件 | Content-Type |
|------|--------------|
| `.zip` | `application/zip` |
| `.json` | `application/json; charset=utf-8` |
| `.sha256` | `text/plain; charset=utf-8` |

### 11.3 缓存策略

| 文件 | 缓存策略 |
|------|----------|
| 版本 ZIP | 长缓存、immutable |
| 版本 Manifest | 长缓存、immutable |
| `stable/manifest.json` | 短缓存或必须重新验证 |

不要为 `stable/manifest.json` 设置与版本 ZIP 相同的长期 immutable 缓存，否则客户端无法及时看到新版本。

## 12. 正式上传顺序

上传必须按以下顺序：

1. ZIP。
2. `files.sha256`。
3. 版本化 `manifest.json`。
4. 从生产 URL 重新下载并校验前三项。
5. 最后原子更新 `stable/manifest.json`。

推荐目录示例：

```text
上传：/powersnexus/releases/6.1.0/powersnexus-6.1.0.zip
上传：/powersnexus/releases/6.1.0/files.sha256
上传：/powersnexus/releases/6.1.0/manifest.json
验证：上述三个生产 URL
更新：/powersnexus/stable/manifest.json
```

禁止：

- 先上传 `stable/manifest.json`。
- 覆盖已经正式发布的同版本 ZIP。
- 在签名之后修改 Manifest 任意字段。
- 在签名之后改变 ZIP 内容。

## 13. 从生产地址重新验证

上传完成后，在 NovaWay 仓库根目录执行：

```powershell
$releaseRoot = "E:\tmp\powersnexus-production-verify"
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null

$manifestUrl = "https://cdn.novaway.ai/powersnexus/stable/manifest.json"
Invoke-WebRequest $manifestUrl -OutFile "$releaseRoot\manifest.json"

$manifest = Get-Content "$releaseRoot\manifest.json" -Raw | ConvertFrom-Json
Invoke-WebRequest $manifest.artifactUrl -OutFile "$releaseRoot\powersnexus-$($manifest.version).zip"

$actual = (Get-FileHash "$releaseRoot\powersnexus-$($manifest.version).zip" -Algorithm SHA256).Hash.ToLowerInvariant()
$expected = $manifest.artifactSha256.ToLowerInvariant()

[pscustomobject]@{
  manifestUrl = $manifestUrl
  artifactUrl = $manifest.artifactUrl
  expected = $expected
  actual = $actual
  digestMatched = $actual -eq $expected
}
```

`digestMatched` 必须为 `True`。随后还要通过 NovaWay 完整更新流程完成 Manifest 签名验证和 doctor 自检，不能只检查 HTTP 200。

## 14. 运行 stable 生产门禁

在 NovaWay 仓库根目录执行：

```powershell
cd E:\AImoney\NovaWay-Matrix\novaway-coder

$env:POWERSNEXUS_UPDATE_POLICY = "stable"
$env:POWERSNEXUS_RELEASE_KEY_ID = "powersnexus-release-2026-01"
$env:POWERSNEXUS_RELEASE_MANIFEST_URLS = "https://cdn.novaway.ai/powersnexus/stable/manifest.json"
$env:POWERSNEXUS_RELEASE_ALLOWED_HOSTS = "cdn.novaway.ai"
$env:POWERSNEXUS_RELEASE_PUBLIC_KEY = "$PWD\packages\desktop\resources\powersnexus-release-public-key.pem"

bun packages/desktop/scripts/check-stable-production-gate.mjs
```

保存机器可读报告：

```powershell
bun packages/desktop/scripts/check-stable-production-gate.mjs --json `
  | Set-Content -Encoding utf8 .codex\powersnexus-stable-production-gate.json
```

门禁要求：

- Manifest URL 非空且使用 HTTPS。
- URL 不是示例或占位域名。
- URL 不是 localhost 或内网地址。
- allowed hosts 覆盖全部 Manifest URL 主机。
- keyID 不是 local/test 标识。
- 生产公钥文件存在且是有效 SPKI PEM。

只有输出满足以下条件才可进入灰度：

```text
policy=stable
effective=stable
ready=true
```

## 15. 三平台灰度验收

即使门禁 `ready=true`，也不能直接全量启用。应在 Windows、macOS、Linux 分别执行：

```powershell
bun packages/desktop/scripts/run-cross-platform-e2e-matrix.mjs
```

最终发布前执行严格模式：

```powershell
bun packages/desktop/scripts/run-cross-platform-e2e-matrix.mjs --strict-all-platforms
```

需要通过：

- M01 打包资源预检。
- M02 stable 生产门禁。
- M03 本地签名 stable 闭环。
- M04 isolation + runner。
- M05 Windows 离线包。
- M06 macOS 离线包。
- M07 Linux 离线包。
- M08 真实 CDN 在线升级。
- M09 跨版本回滚。

当前 Windows 已有通过记录；macOS/Linux 仍需对应有包 runner，M08 仍需真实 CDN。

## 16. 正式启用策略

推荐分阶段启用：

1. 内部开发机器保持 `bundled`，手动设置 `stable` 验证。
2. 小范围测试用户启用 `stable`。
3. 观察下载、验签、安装、激活和回滚指标。
4. 完成三平台 E2E、连续 7 天 KPI 和真实模板样本。
5. 最后才考虑把默认策略改为 `stable`。

启用后必须保留：

- 当前 bundled 基线。
- previous 版本缓存。
- stable 门禁。
- 自动回滚。
- 紧急切回 `bundled` 的配置能力。

## 17. 回滚操作

### 17.1 只停止继续更新

```powershell
$env:POWERSNEXUS_UPDATE_POLICY = "bundled"
```

客户端继续使用 active/bundled，不再拉取 stable。

### 17.2 stable Manifest 发布错误

1. 停止更新 `stable/manifest.json`。
2. 不覆盖错误版本 ZIP。
3. 提升 PowersNexus 版本。
4. 重新构建、签名和上传。
5. 验证新版本后更新 channel Manifest。

### 17.3 私钥疑似泄露

1. 立即撤销 CI 和对象存储写权限。
2. 停止 stable 更新。
3. 保持 bundled/active 可用。
4. 生成新 Ed25519 密钥和新 keyID。
5. 先发布同时信任新旧公钥的 NovaWay 版本。
6. 达到覆盖率后再使用新私钥签名。
7. 不复用旧 keyID。

## 18. 常见问题

### 门禁返回 `ready=false`

```powershell
bun packages/desktop/scripts/check-stable-production-gate.mjs --json
```

根据 `blockers` 修复 URL、allowed hosts、keyID 或公钥路径。

### Manifest 下载成功但 ZIP 下载失败

通常是先发布了 channel Manifest，或 Manifest 中的 `artifactUrl` 与真实上传路径不一致。恢复旧 channel Manifest，再上传正确 ZIP。

### ZIP SHA-256 不一致

禁止继续。可能原因：

- 上传过程改变文件。
- CDN 返回错误页而不是 ZIP。
- Manifest 与 ZIP 来自不同构建。
- 同版本 ZIP 被覆盖。

### 签名无效

确认：

- 公钥与私钥属于同一密钥对。
- `keyID` 被 NovaWay 信任。
- 签名后没有修改 Manifest。
- 使用 Ed25519，不是 RSA。
- CI Secret 没有丢失 PEM 换行。

### 本机通过但生产失败

生产验收必须从公开 URL 重新下载，不能用 CI 工作目录中的本地文件代替。

## 19. 最终验收清单

### 基础设施

- [ ] 真实对象存储已创建。
- [ ] `cdn.novaway.ai` 已正确解析并启用 HTTPS。
- [ ] 客户端只有读取权限。
- [ ] CI 拥有最小写入权限。
- [ ] stable Manifest 支持原子更新。

### 密钥和 CI

- [ ] `POWERSNEXUS_RELEASE_PRIVATE_KEY_PEM` 已写入 CI Secret。
- [ ] 私钥未进入 Git、ZIP、日志和 artifact。
- [ ] 发布任务仅能由受保护分支或审批环境触发。
- [ ] CI 临时私钥在任务结束后删除。

### 发布物

- [ ] PowersNexus 全量测试通过。
- [ ] ZIP、`files.sha256` 和 Manifest 已生成。
- [ ] Manifest 使用 Ed25519 签名。
- [ ] ZIP SHA-256 与 Manifest 一致。
- [ ] 生产 URL 重新下载校验通过。
- [ ] 版本发布物未被覆盖。

### NovaWay

- [ ] stable 门禁 `ready=true`。
- [ ] Windows 在线升级和回滚通过。
- [ ] macOS 在线升级和回滚通过。
- [ ] Linux 在线升级和回滚通过。
- [ ] 连续 7 天 KPI 达标。
- [ ] 20 次真实模板样本完成。
- [ ] 紧急切回 `bundled` 已演练。

## 20. 继续代操作所需信息

如果由 Codex 继续完成生产接入，需要用户提供以下信息，但不要把密码或私钥正文发送到聊天：

1. 使用哪家对象存储/CDN。
2. bucket 名称和目标区域。
3. `cdn.novaway.ai` 的 DNS/CDN 管理入口。
4. 使用 Gitee Go、GitHub Actions 还是其他 CI。
5. 是否允许通过已有登录状态操作控制台。
6. 上传凭证应写入哪个 CI Secret。
7. 最终选择方案 A 还是方案 B 的目录结构。

获得这些信息后，可以继续补充：

- 对应平台的上传脚本。
- PowersNexus Release CI。
- 发布后远程验签步骤。
- 三平台在线升级矩阵。
- stable 灰度与回滚记录。