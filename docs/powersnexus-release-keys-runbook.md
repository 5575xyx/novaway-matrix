# PowersNexus 发布密钥与签名操作手册

生成时间：2026-07-20

## 密钥位置

| 物品 | 位置 | 进 Git？ |
|------|------|----------|
| 私钥 | `E:\AImoney\secrets\powersnexus-release\powersnexus-release-private-key.pem` | **否** |
| 公钥 | `packages/desktop/resources/powersnexus-release-public-key.pem` | 是 |
| keyID 内置 | `powersnexus-bundled-2026-01` | 是 |
| keyID 在线 | `powersnexus-release-2026-01` | 环境变量 |

## 本机已完成

1. 生成 Ed25519 密钥对（仓库外 secrets 目录）
2. 公钥写入 NovaWay 安装资源
3. 用新私钥重签内置 6.1.0 bundled Manifest（验签通过）
4. PowersNexus `dist/release` 构建并签名（验签通过）
5. version-service 同时信任 bundled/release 两个 keyID

## 再次发布（PowersNexus）

```powershell
cd PowersNexus
$sha = git rev-parse HEAD
$priv = "E:\AImoney\secrets\powersnexus-release\powersnexus-release-private-key.pem"

node scripts/build-release-artifact.mjs `
  --source-commit $sha `
  --artifact-base-url "https://cdn.novaway.ai/powersnexus/stable" `
  --minimum-novaway-version 1.3.0 `
  --maximum-novaway-version "<2.0.0" `
  --key-id powersnexus-release-2026-01 `
  --channel stable

node scripts/sign-release-manifest.mjs `
  --manifest dist/release/manifest.unsigned.json `
  --output dist/release/manifest.json `
  --private-key $priv
```

上传顺序：ZIP -> files.sha256 -> 版本 Manifest -> 原子更新 channel Manifest。

## 启用 stable（CDN 就绪后）

```powershell
$env:POWERSNEXUS_UPDATE_POLICY = "stable"
$env:POWERSNEXUS_RELEASE_KEY_ID = "powersnexus-release-2026-01"
$env:POWERSNEXUS_RELEASE_MANIFEST_URLS = "https://cdn.novaway.ai/powersnexus/stable/manifest.json"
$env:POWERSNEXUS_RELEASE_ALLOWED_HOSTS = "cdn.novaway.ai"
$env:POWERSNEXUS_RELEASE_PUBLIC_KEY = "$PWD\packages\desktop\resources\powersnexus-release-public-key.pem"
bun packages/desktop/scripts/check-stable-production-gate.mjs
```

门禁 ready=true 前保持默认 bundled。

## 我无法代劳

- 写入 CI Secret
- 上传到真实 CDN
- 配置线上对象存储/DNS