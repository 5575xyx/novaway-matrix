# PowersNexus 本地签名 stable 联调手册

生成时间：2026-07-19

## 目标

在**没有真实 CDN/签名发布端点**时，本机完整演练：

`check → install → activate → rollback`

并证明：

1. 主源断网可回退镜像
2. 签名与 doctor 自检通过后才会注册版本
3. 活动工作流时激活 deferred
4. 生产默认仍保持 `bundled`，占位 URL 禁止启用 stable

## 一键运行

```powershell
# 建议把 TEMP 放到空间充足的盘
$env:TEMP = "E:\tmp\opencode-temp"
$env:TMP = "E:\tmp\opencode-temp"
$env:POWERSNEXUS_STABLE_LOCAL_ROOT = "E:\tmp\powersnexus-stable-local"

node packages/desktop/scripts/run-stable-local-harness.mjs
```

或直接：

```powershell
cd packages/opencode
$env:POWERSNEXUS_STABLE_LOCAL_ROOT = "E:\tmp\powersnexus-stable-local"
bun test test/powersnexus/stable-local-harness.test.ts --timeout 60000
```

## 产物

`POWERSNEXUS_STABLE_LOCAL_ROOT` 下：

```text
keys/public.pem
stable/manifest.json
artifacts/powersnexus-6.2.0.zip
README.local.txt
```

这些密钥是**临时联调密钥**，不能写入生产公钥文件，也不能当作真实发布凭证。

## 与生产 stable 的差距

| 项 | 本机 harness | 生产 stable |
|----|--------------|-------------|
| 传输 | 进程内 ReadRemote 模拟 HTTPS | 真实 HTTPS CDN/Gitee Release |
| 密钥 | 临时 Ed25519 | 独立保管私钥 + 打包公钥 |
| 默认策略 | 不改，仍 bundled | 仅在端点就绪后启用 stable |
| 域名白名单 | `*.local.test` | 真实 `releaseAllowedHosts` |

## 生产启用 stable 检查清单

1. 生成并安全存放发布私钥（CI Secret）
2. 将对应公钥打进 `packages/desktop/resources/powersnexus-release-public-key.pem`
3. 配置真实：
   - `powersnexus.updatePolicy = "stable"`
   - `powersnexus.releaseManifestUrls`
   - `powersnexus.releaseAllowedHosts`
4. 通过 `assertReleaseUrlsReady`（禁止占位 URL）
5. 完成 Win/macOS/Linux 断网 + 在线升级 E2E

在上述清单完成前，**禁止**把默认策略改为 stable。


## 生产启用门禁（自动检查）

```powershell
# 默认（bundled）——应显示 ready=false / 未请求 stable
bun packages/desktop/scripts/check-stable-production-gate.mjs

# 模拟完整生产配置
$env:POWERSNEXUS_UPDATE_POLICY = "stable"
$env:POWERSNEXUS_RELEASE_MANIFEST_URLS = "https://cdn.novaway.ai/powersnexus/stable/manifest.json,https://releases.novaway.ai/powersnexus/stable/manifest.json"
$env:POWERSNEXUS_RELEASE_ALLOWED_HOSTS = "cdn.novaway.ai,releases.novaway.ai"
$env:POWERSNEXUS_RELEASE_PUBLIC_KEY = "$PWD\packages\desktop\resources\powersnexus-release-public-key.pem"
$env:POWERSNEXUS_RELEASE_KEY_ID = "powersnexus-release-2026-01"
bun packages/desktop/scripts/check-stable-production-gate.mjs
```

程序 API：

- `evaluateStableProductionGate(...)`：返回检查清单
- `resolveUpdatePolicy(...)`：stable 不满足时降级 `bundled`
- 桌面端在设置了 `POWERSNEXUS_RELEASE_PUBLIC_KEY` 时自动启用严格门禁

### 门禁项

| ID | 要求 |
|----|------|
| manifest_urls_present | 至少一个 HTTPS Manifest |
| url_* | 非占位、非内网（除非 ALLOW_LOCAL） |
| allowed_hosts_present | releaseAllowedHosts 非空 |
| hosts_cover_urls | 白名单覆盖 URL 主机 |
| key_id | 生产 keyID（非 local/test） |
| public_key | SPKI PEM 存在且非联调标记 |

**默认策略必须保持 `bundled`，直到 `ready=true` 且完成三平台 E2E。**
