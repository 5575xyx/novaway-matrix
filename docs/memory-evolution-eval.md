# 记忆与进化评测

## 目的

用可重复指标判断 NovaWay 的记忆召回和进化候选是否可用，而不是只依赖功能开关。

## 命令

在 `packages/opencode` 下执行：

```bash
bun run eval:memory
bun run eval:task
bun run eval:memory-relations
bun run eval:evolution
```

CI 已通过 `.github/workflows/memory-evolution-eval.yml` 自动执行以上三组评测。

当前基线快照见 `.codex/memory-eval-baseline.md`。

## 当前指标

- 记忆检索评测：Precision@K、Recall@K、MRR、Hit@K。
- 任务对比评测：无记忆 / 仅记忆召回 / 记忆+关系线索 的上下文覆盖率。
- 内置 4 个代表场景，当前回归门槛：
  - HitRate >= 0.75
  - 平均 MRR >= 0.75
  - 平均 Recall@K >= 0.75
- 关系评测：关系边写入、更新刷新、删除级联、按实体/关系查询。
- 进化评测：候选字段完整性、必需内容片段、类型符合性。
- 进化回归：候选自带 `expectedOutcomes`，写盘后按预期结果评分，不达标自动回滚。

## 后续

1. 增加真实业务场景数据集，替换内置示例。
2. 增加“无记忆 / 有记忆 / 有进化”同一任务对比。
3. 将评测结果写入 `.codex/` 作为历史基线。
