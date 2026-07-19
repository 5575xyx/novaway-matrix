# PowersNexus 跨平台升级 E2E 矩阵

生成时间：2026-07-19

## 目标

在 **不误开生产 stable** 的前提下，定义并自动执行（或明确跳过）三平台升级验收骨架：

| 平台 | 包形态 | 断网基线 | 在线升级 | 回滚 |
|------|--------|----------|----------|------|
| Windows | NSIS / win-unpacked | 资源 + doctor | stable check/install | activate/rollback |
| macOS | dmg/zip | 资源 + doctor | 同上 | 同上 |
| Linux | AppImage/deb | 资源 + doctor | 同上 | 同上 |

## 一键矩阵（当前机）

```powershell
# Windows 示例
$env:TEMP = "E:\tmp\opencode-temp"
$env:TMP = $env:TEMP
bun packages/desktop/scripts/run-cross-platform-e2e-matrix.mjs

# JSON 报告
bun packages/desktop/scripts/run-cross-platform-e2e-matrix.mjs --json > e2e-matrix-report.json
```

脚本会：

1. 识别 `process.platform`
2. 跑本机可执行检查
3. 对其它平台输出 `SKIP` + 原因（需对应 runner）
4. 汇总 `passed / failed / skipped / blocked`

退出码：

| code | 含义 |
|------|------|
| 0 | 本机必跑项全部通过；其它平台为预期 SKIP |
| 1 | 本机必跑项失败 |
| 2 | 配置了 `--strict-all-platforms` 且存在 SKIP |

## 矩阵行定义

| ID | 名称 | Win | macOS | Linux | 实现 |
|----|------|-----|-------|-------|------|
| M01 | 打包资源预检 | 必跑 | 必跑 | 必跑 | `verify-powersnexus-packaging.mjs` |
| M02 | stable 生产门禁（默认 bundled） | 必跑 | 必跑 | 必跑 | `check-stable-production-gate.mjs` |
| M03 | 本地签名 stable 闭环 | 必跑 | 必跑 | 必跑 | `bun run test:stable-local` |
| M04 | isolation + runner 单元 | 必跑 | 必跑 | 必跑 | `bun test test/powersnexus/isolation|runner` |
| M05 | Windows 离线包资源+doctor | 本机 Win 有产物则跑 | SKIP | SKIP | `smoke-powersnexus-offline.mjs` |
| M06 | macOS 离线包冒烟 | SKIP | 有产物则跑 | SKIP | 待 CI runner |
| M07 | Linux 离线包冒烟 | SKIP | SKIP | 有产物则跑 | 待 CI runner |
| M08 | 在线升级 E2E（真实 CDN） | BLOCKED | BLOCKED | BLOCKED | 需生产门禁 ready=true |
| M09 | 跨版本回滚 E2E | 逻辑已覆盖 | 逻辑已覆盖 | 逻辑已覆盖 | stable-local harness |

## 当前状态（本仓库）

- **逻辑层**升级/回滚：本地 harness 已覆盖
- **Windows 离线包**：有 `package:win` + smoke 脚本
- **macOS/Linux 包冒烟**：骨架已定义，需在对应 OS runner 执行 `package:mac` / `package:linux` 后启用
- **真实在线升级**：被 stable 生产门禁阻塞（正确默认）

## CI 建议

```yaml
# 伪配置
jobs:
  e2e-win:
    runs-on: windows-latest
    steps:
      - run: bun packages/desktop/scripts/run-cross-platform-e2e-matrix.mjs
  e2e-mac:
    runs-on: macos-latest
    steps:
      - run: bun packages/desktop/scripts/run-cross-platform-e2e-matrix.mjs
  e2e-linux:
    runs-on: ubuntu-latest
    steps:
      - run: bun packages/desktop/scripts/run-cross-platform-e2e-matrix.mjs
```

## 与交接文档对齐

- 第 24 节发布门槛：三平台打包 E2E
- 未配置真实签名端点前不得默认 stable
- 本矩阵将「未具备 runner」显式记为 SKIP，而不是静默当作通过
