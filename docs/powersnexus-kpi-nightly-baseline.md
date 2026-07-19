# PowersNexus 7 天 KPI 夜间基线

生成时间：2026-07-19

## 目标

对接交接文档第 3 节成功指标，提供**可本地执行、可落盘、可汇总 7 天**的夜间基线骨架。

> 完整端到端样本集（20 次标准模板任务）依赖真实产品会话与模型，当前骨架用**可自动重复的代理指标**先建立趋势；有真实样本后替换对应 probe 即可。

## 指标映射（代理 → 发布门槛）

| KPI（文档） | 发布门槛 | 当前本地代理（可自动） |
|-------------|----------|------------------------|
| PowersNexus 加载成功率 | 100% | 打包预检 + 本机离线包 smoke（若有产物） |
| 严重权限越界 | 0 | isolation + runner 对抗测试全通过 |
| 失败可诊断率 | 100% | runner 失败日志/错误码相关测试 |
| 交付证据完整率 | 100% | delivery/evidence 相关 powersnexus 测试子集 |
| 端到端本地交付成功率 | ≥85% | stable-local harness + e2e 矩阵本机必跑项 |
| 无人值守衔接率 | ≥90% | 代理：矩阵必跑项无人工介入（自动通过） |
| 状态恢复正确率 | 100% | runner interrupted 恢复测试 |
| 工件与 Session 一致率 | 100% | service/reconcile 相关测试（若存在则跑） |

性能指标（轻量探测）：

- 门禁评估耗时（`evaluateStableProductionGate` 调用墙钟）
- 矩阵本机必跑总耗时

## 一键运行

```powershell
# 单次夜间基线（写入当天记录）
bun packages/desktop/scripts/run-kpi-nightly-baseline.mjs

# 只汇总近 7 天，不重新跑探针
bun packages/desktop/scripts/run-kpi-nightly-baseline.mjs --summary-only

# JSON 输出
bun packages/desktop/scripts/run-kpi-nightly-baseline.mjs --json
```

## 落盘位置

```text
.codex/powersnexus-kpi/
  YYYY-MM-DD.json          # 单日明细
  summary-7d-latest.json   # 近 7 天汇总
  summary-7d-latest.md     # 人读摘要
```

## 通过判定（骨架）

单日：

- 所有 `required` 探针 PASS
- `severe_permission_violations == 0`

7 日：

- 每日记录存在（允许缺口，但 summary 会标 `missing_days`）
- 各 KPI 代理成功率 ≥ 对应门槛（缺数据不虚报达标）

## 与发布的关系

- 本基线**不能**单独替代真实 20 次标准模板端到端人工样本
- 本基线**可以**拦截：加载失败、隔离回归、升级逻辑回退、门禁被误关
- 真实 stable 在线升级仍受生产门禁约束
