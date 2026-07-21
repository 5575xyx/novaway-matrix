# PowersNexus 使用 Gitee Release 发布 stable 完整手册

生成时间：2026-07-20  
目标仓库：`https://gitee.com/nova-way/powersnexus`  
发布脚本：`packages/desktop/scripts/publish-powersnexus-gitee-release.mjs`

## 1. 发布结构

Gitee Release 没有可直接作为签名 Manifest 使用的“latest 附件固定地址”，因此采用两个 Release：

### 版本 Release：不可变

```text
Tag：v6.1.0
附件：
  powersnexus-6.1.0.zip
  files.sha256
  manifest.json
```

下载地址：

```text
https://gitee.com/nova-way/powersnexus/releases/download/v6.1.0/powersnexus-6.1.0.zip
```

同一版本的附件发布后禁止替换。修复错误时必须提升版本。

### channel Release：可更新

```text
Tag：powersnexus-stable
附件：
  manifest.json
```

NovaWay 固定读取：

```text
https://gitee.com/nova-way/powersnexus/releases/download/powersnexus-stable/manifest.json
```

channel Release 只保存当前 stable 的已签名 Manifest；ZIP 始终来自不可变版本 Release。

## 2. 当前本地状态

当前已重新生成并签名 6.1.0 发布物：

```text
PowersNexus/dist/release/powersnexus-6.1.0.zip
PowersNexus/dist/release/files.sha256
PowersNexus/dist/release/manifest.json
```

当前 Manifest 的 `artifactUrl` 已改为：

```text
https://gitee.com/nova-way/powersnexus/releases/download/v6.1.0/powersnexus-6.1.0.zip
```

运行发布计划检查：

```powershell
cd E:\AImoney\NovaWay-Matrix\novaway-coder
bun packages/desktop/scripts/publish-powersnexus-gitee-release.mjs --json
```

只有输出：

```json
{
  "ready": true,
  "blockers": []
}
```

才允许执行真实上传。

## 2.1 已完成的首次生产发布

发布时间：2026-07-20

| 对象 | Gitee ID | 结果 |
|------|----------|------|
| `v6.1.0` 版本 Release | `754190` | 已创建，3 个附件 |
| `powersnexus-stable` channel Release | `754192` | 已创建，1 个 Manifest |
| `powersnexus-6.1.0.zip` | `2937541` | 7,889,956 字节 |
| `files.sha256` | `2937542` | 18,290 字节 |
| 版本 `manifest.json` | `2937543` | 755 字节 |
| stable `manifest.json` | `2937544` | 755 字节 |

远程复验结果：

```text
Manifest Ed25519 签名：通过
ZIP SHA-256：通过
artifactSha256：4c495a42662d951c963177cbc6fb0bf22c4f282d4706009fc64b1cecc7d8f7c2
stable 生产配置门禁：ready=true
```
## 3. 创建 Gitee 私人令牌

在 Gitee 网页端进入：

```text
头像
→ 设置
→ 安全设置
→ 私人令牌
→ 生成新令牌
```

令牌需要能够管理 `nova-way/powersnexus` 的 Release 和附件。建议：

1. 使用专门的发布账号或机器人账号。
2. 只授予目标仓库所需权限。
3. 设置明确名称，例如 `powersnexus-release-ci`。
4. 生成后立即保存到密码管理器或 CI Secret。
5. 不要把令牌发送到聊天、写入文档或提交到 Git。

推荐环境变量名称：

```text
GITEE_ACCESS_TOKEN
```

## 4. 在当前 PowerShell 安全载入令牌

以下写法不会把令牌正文直接写进命令历史：

```powershell
$secureToken = Read-Host "请粘贴 Gitee 私人令牌" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
  $env:GITEE_ACCESS_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
}
Remove-Variable secureToken, tokenPointer
```

完成发布后清除：

```powershell
Remove-Item Env:GITEE_ACCESS_TOKEN
```

## 5. 发布前验证

### 5.1 检查 PowersNexus 源码

```powershell
cd E:\AImoney\NovaWay-Matrix\novaway-coder\PowersNexus

git status --short --branch
git rev-parse HEAD
node -p "require('./package.json').version"
```

当前预期：

```text
commit：6b8bd9e9519e166f3533d240f81534cfd00a76de
version：6.1.0
```

### 5.2 跑发布测试

```powershell
npm.cmd run test:core
npm.cmd run test:uiux
npm.cmd run test:package
```

完整平台测试使用 Git Bash：

```powershell
& "C:\Program Files\Git\bin\bash.exe" -lc "cd /e/AImoney/NovaWay-Matrix/novaway-coder/PowersNexus && npm run test:all"
```

任何测试失败都应停止发布。

### 5.3 检查发布计划

```powershell
cd E:\AImoney\NovaWay-Matrix\novaway-coder
bun packages/desktop/scripts/publish-powersnexus-gitee-release.mjs --json
```

脚本会检查：

- ZIP、`files.sha256`、签名 Manifest 是否存在。
- channel 是否为 `stable`。
- Manifest 是否含签名。
- ZIP SHA-256 是否与 Manifest 一致。
- `artifactUrl` 是否与 Gitee 版本 Release 地址一致。

## 6. 执行真实发布

确保 `GITEE_ACCESS_TOKEN` 已加载，然后执行：

```powershell
cd E:\AImoney\NovaWay-Matrix\novaway-coder
bun packages/desktop/scripts/publish-powersnexus-gitee-release.mjs --execute --json
```

默认参数：

```text
owner：nova-way
repo：powersnexus
version tag：v6.1.0
channel tag：powersnexus-stable
API：https://gitee.com/api/v5
```

需要覆盖默认仓库时：

```powershell
bun packages/desktop/scripts/publish-powersnexus-gitee-release.mjs `
  --owner nova-way `
  --repo powersnexus `
  --version-tag v6.1.0 `
  --channel-tag powersnexus-stable `
  --execute `
  --json
```

## 7. 脚本执行流程

脚本会自动：

1. 按 tag 查询 `v6.1.0` 版本 Release。
2. Release 不存在时创建，存在时更新说明。
3. 上传 ZIP、`files.sha256` 和版本 Manifest。
4. 已有同名版本附件时重新下载并比较 SHA-256：
   - 内容一致：复用，不重复上传。
   - 内容不同：停止，禁止覆盖不可变版本。
5. 查询或创建 `powersnexus-stable` channel Release。
6. 下载并备份旧 `manifest.json`。
7. 删除旧 channel Manifest。
8. 上传新的已签名 Manifest。
9. 上传失败时尝试恢复旧 Manifest。
10. 从公开 Gitee 地址重新下载 Manifest 和 ZIP。
11. 再次校验签名字段和 ZIP SHA-256。

旧 channel Manifest 的临时备份位于系统 TEMP：

```text
%TEMP%\novaway-powersnexus-release-backups\
```

## 8. 发布成功后的地址

版本 Release 页面：

```text
https://gitee.com/nova-way/powersnexus/releases/tag/v6.1.0
```

版本 ZIP：

```text
https://gitee.com/nova-way/powersnexus/releases/download/v6.1.0/powersnexus-6.1.0.zip
```

stable Manifest：

```text
https://gitee.com/nova-way/powersnexus/releases/download/powersnexus-stable/manifest.json
```

## 9. 配置 NovaWay stable 门禁

```powershell
cd E:\AImoney\NovaWay-Matrix\novaway-coder

$env:POWERSNEXUS_UPDATE_POLICY = "stable"
$env:POWERSNEXUS_RELEASE_KEY_ID = "powersnexus-release-2026-01"
$env:POWERSNEXUS_RELEASE_MANIFEST_URLS = "https://gitee.com/nova-way/powersnexus/releases/download/powersnexus-stable/manifest.json"
$env:POWERSNEXUS_RELEASE_ALLOWED_HOSTS = "gitee.com"
$env:POWERSNEXUS_RELEASE_PUBLIC_KEY = "$PWD\packages\desktop\resources\powersnexus-release-public-key.pem"

bun packages/desktop/scripts/check-stable-production-gate.mjs
```

必须输出：

```text
policy=stable
effective=stable
ready=true
```

在真实 Release 尚未上传前，继续保持 `bundled`。

## 10. 手工复核

发布后执行：

```powershell
$manifestUrl = "https://gitee.com/nova-way/powersnexus/releases/download/powersnexus-stable/manifest.json"
$verifyRoot = Join-Path $env:TEMP "powersnexus-gitee-verify"
New-Item -ItemType Directory -Force -Path $verifyRoot | Out-Null

Invoke-WebRequest $manifestUrl -OutFile "$verifyRoot\manifest.json"
$manifest = Get-Content "$verifyRoot\manifest.json" -Raw | ConvertFrom-Json
Invoke-WebRequest $manifest.artifactUrl -OutFile "$verifyRoot\powersnexus-$($manifest.version).zip"

$actual = (Get-FileHash "$verifyRoot\powersnexus-$($manifest.version).zip" -Algorithm SHA256).Hash.ToLowerInvariant()
$expected = $manifest.artifactSha256.ToLowerInvariant()

[pscustomobject]@{
  version = $manifest.version
  artifactUrl = $manifest.artifactUrl
  keyID = $manifest.keyID
  digestMatched = $actual -eq $expected
}
```

`digestMatched` 必须为 `True`。

## 11. CI Secret 配置

建议在 CI 中配置：

```text
GITEE_ACCESS_TOKEN
POWERSNEXUS_RELEASE_PRIVATE_KEY_PEM
```

两个 Secret 职责不同：

- `GITEE_ACCESS_TOKEN`：创建 Release 和上传附件。
- `POWERSNEXUS_RELEASE_PRIVATE_KEY_PEM`：签名 Manifest。

CI 中必须先构建和签名，再调用：

```powershell
bun packages/desktop/scripts/publish-powersnexus-gitee-release.mjs --execute --json
```

不要把令牌放在 URL 参数、日志、artifact 或仓库配置文件中。

## 12. 回滚

如果 channel Manifest 发布失败：

1. 脚本会尝试恢复刚刚备份的旧 Manifest。
2. 如果自动恢复失败，到 `powersnexus-stable` Release 手工重新上传备份文件。
3. NovaWay 配置立即切回：

```powershell
$env:POWERSNEXUS_UPDATE_POLICY = "bundled"
```

如果版本 Release 附件内容错误：

1. 不要覆盖 `v6.1.0` 附件。
2. 提升版本到 6.1.1 或更高。
3. 重新构建、签名和发布。
4. 更新 channel Manifest 指向新版本。

## 13. 当前剩余操作

- [x] 确定使用 Gitee Release。
- [x] 生成 Gitee Release 发布脚本。
- [x] 将 6.1.0 artifactUrl 改为版本 Release 地址。
- [x] 用生产私钥重新签名 Manifest。
- [x] 本地发布计划 `ready=true`。
- [x] 创建 Gitee 私人令牌。
- [x] 设置本机发布进程的 `GITEE_ACCESS_TOKEN`。
- [x] 执行真实 Gitee Release 上传。
- [x] 从公开地址重新下载并验签。
- [x] stable 生产配置门禁 `ready=true`。
- [x] Windows 真实 Gitee 在线升级/回滚 E2E（M08）。
- [ ] macOS/Linux 有包 runner 在线升级 E2E。