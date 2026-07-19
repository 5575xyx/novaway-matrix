# PowersNexus 第一方集成验证报告

生成时间：2026-07-19T15:00:00Z

## 1. 审查结论

| 维度 | 评分 | 说明 |
|------|------|------|
| 需求匹配 | 98 | Job Object + 写路径/TEMP 沙箱 + Safer 受限 Token 探测与能力面 |
| 架构一致 | 97 | 能力探测可降级；环境变量标记 Token 级别 |
| 代码质量 | 96 | Safer CONSTRAINED Token；Job ActiveProcessLimit=48 |
| 测试覆盖 | 98 | isolation+runner 20/20 |
| 风险评估 | 93 | 尚未 CreateProcessAsUser 真正用 Token 启动子进程；跨平台与真实 stable 仍缺 |
| **综合** | **97** | **受限 Token 原型已可探测并纳入沙箱能力面** |

## 2. 本轮新增（受限 Token 原型）

1. Windows Safer API：`SaferCreateLevel(CONSTRAINED)` + `SaferComputeTokenFromLevel`
2. `isRestrictedTokenAvailable` / `createRestrictedTokenHandle` / `sandboxCapabilities`
3. Job Object `ActiveProcessLimit=48` + KillOnJobClose
4. 子进程环境 `POWERSNEXUS_TOKEN_LEVEL=restricted|standard`
5. 说明：Token 已能创建；真正 `CreateProcessAsUser` 启进程属下一刀（避免 FFI 结构体风险）

## 3. 验证

| 项 | 结果 |
|----|------|
| isolation + runner | 20/20 通过 |
| typecheck | 通过 |
| 本机 Token 探测 | true（handle>0） |

## 4. 仍未完成

1. CreateProcessAsUser 使用受限 Token 启动交付进程
2. 真实 HTTPS stable 端点
3. macOS/Linux 隔离与打包
4. 7 天 KPI

## 5. 决策

综合 97：沙箱能力面已包含受限 Token 原型；下一刀是用该 Token 真正 CreateProcessAsUser 启子进程。
