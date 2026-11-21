# Super-Agent / Goal 生产验收标准

> 本文是发布前的硬门槛，不是功能说明。任何一项 P0/P1 未通过，都不能宣称生产就绪。

## 1. 发布阻断条件

| 类别 | 必须满足的条件 | 验证方式 |
| --- | --- | --- |
| 构建 | Backend、App TypeScript 检查通过；生产构建成功 | `bun run typecheck`、`bun run build` |
| 数据库 | 全量迁移成功；重启后 schema 和数据可读 | 独立临时 DB 启动两次 |
| 安全 | 配置密码时未认证请求拒绝；正确凭证可访问；Token 不进入日志 | HTTP auth smoke、日志扫描 |
| MCP | 真实 stdio 或 remote MCP Server 可发现、调用、失败和断开 | `test/mcp/super-agent-real.test.ts` |
| 插件 Tool | 安装、启用、禁用、卸载期间不会执行已释放 Tool | 插件生命周期 E2E |
| Durable Run | Worker 自动执行，不允许测试手动调用 execute-tool 代替调度 | HTTP E2E、事件审计 |
| 恢复 | 重启、Operation Lease 过期、Permission waiting、Graph 冲突均有确定终态 | Durable E2E |
| 副作用 | 非幂等/危险 Tool 必须经过独立副作用权限门；未知 Operation 不自动重放 | side-effect gate 测试 |
| 并发 | 至少 100 和 500 Durable Run 通过；多进程抢占无重复副作用 | `NOVAWAY_DURABLE_LOAD_RUNS=500` |
| 稳定性 | 连续小时级运行无失败、死锁、无限 pending 或进程泄漏 | 40 轮 soak test |

## 1.1 Goal 与 Durable Run 的原子启动契约

Goal 模式的长期目标不得由前端串行执行“创建 Run → 启动 Run → PATCH Goal 绑定”。正式入口是：

```text
POST /session/:sessionId/goals/launch
```

请求携带持久 `idempotencyKey`。该入口在同一 SQLite `IMMEDIATE` 事务中完成 Goal 行创建、
Durable Run 创建和 `executionConfig.superAgentRunId` 绑定；重复请求返回同一个 Goal/Run，
不会创建第二个长期任务。事务成功后，统一的 `startSuperAgentRun` 服务负责模型规划、
`draft → planning → ready → running` 状态转换和规划失败事件。新前端已经切换到该事务入口。
旧的 `POST /goals` 加 `POST /goals/:goalId/launch` 入口保留用于兼容已有客户端，但旧客户端
仍需承担两个请求之间的中间崩溃窗口。

启动恢复协调器已在实例启动时注册：它会发现已绑定但仍处于 `draft`、`planning` 或 `ready`
的 Goal Run，并重新执行统一启动流程；模型规划失败会持久化为 `failed`，不会留下永久
`draft`。该行为仍需要目标 Runner 的进程终止/重启 Smoke 覆盖，才能作为发布证据，而不能
仅凭代码路径视为已验收。


Run 不允许无限停留在以下状态：

```text
planning
ready
running
waiting_approval
needs_review
```

这些状态必须满足其一：

```text
completed
failed
cancelled
paused（明确需要用户或外部系统介入）
```

`needs_review` 和 `paused` 不是成功状态，必须带有：

- 最后一个失败事件；
- Operation ID；
- 原因和恢复建议；
- 是否可能存在未知外部副作用；
- 关联 Goal 状态。

## 3. 外部副作用策略

以下 Tool 必须经过：

```text
super-agent.external_side_effect
```

包括：

- `destructive === true`；
- `readOnly === false && idempotent === false`；
- MCP Tool（默认按外部系统调用处理）；
- 插件声明为非幂等的 Tool。

进程在副作用边界内崩溃后：

```text
Operation → unknown
Run → needs_review
Goal → paused
```

禁止自动重放，除非用户明确确认或插件提供了可验证的幂等恢复策略。

## 4. 已完成的验收证据

当前已完成：

```text
真实本地 stdio MCP Server：1 pass
MCP / Executor 回归：8 pass
插件 MCP 与生命周期：16 pass
Super-Agent 全量回归：65 pass
Permission 回归：127 pass
500 Durable Run：8 pass，0 fail，2055 expect()
小时级 soak：40 轮 × 100 Run，0 fail
TypeScript：通过
```

500 Run 的命令：

```bash
NOVAWAY_DURABLE_LOAD_RUNS=500 \
  bun test test/server/httpapi-goal-durable.test.ts --timeout 1800000
```

## 6. 可重复执行的生产部署 Smoke

当前平台生产二进制构建完成后，可执行（脚本会自动选择当前 OS/架构）：

```bash
bun run script/production-deployment-smoke.ts
```

该脚本会：

```text
1. 启动当前 Runner 对应的 `dist/xymt-novaway-<os>-<arch>/bin/novaway[.exe]`
2. 使用独立 SQLite 数据库
3. 设置 NOVAWAY_SERVER_PASSWORD
4. 验证未认证请求返回 401
5. 创建 Session 和 Goal
6. 创建 Durable Run
7. 修改任务图并启动后台 Worker
8. 验证 Run completed
9. 验证 Goal completed
10. 启动长 Operation
11. 强制终止生产进程
12. 使用同一个数据库重新启动
13. 验证 Operation 不被重放
14. 验证 Run 进入 needs_review
15. 清理临时数据库和工作目录
```

最近一次结果（Windows x64 Runner）同时验证了正确认证、未认证和错误凭证：

```text
PRODUCTION_DEPLOYMENT_SMOKE=PASS
PRODUCTION_FLOW=completed
PRODUCTION_RESTART_RECOVERY=needs_review
PRODUCTION_AUTH=unauthenticated:401/wrong:401/authenticated:200
```

该 Smoke 使用的是已经打包的生产二进制，而不是 `src/index.ts` 开发入口。

## 7. 多平台构建策略

发布环境必须为每个目标平台单独生成并验证二进制。Windows x64 当前已完成生产构建和业务 Smoke。Linux/macOS 构建依赖对应 Bun Runtime 下载或 CI 构建节点；本地网络无法下载 Runtime 时不得把“跳过构建”当成通过，必须在 CI 的目标平台 Runner 上执行：

```bash
# glibc：在对应 Linux/macOS/Windows Runner 上执行
bun run build -- --single --skip-install
bun run script/production-deployment-smoke.ts

# Linux x64 musl：在 Linux Runner 上执行
bun run build -- --single --musl
NOVAWAY_BINARY_ABI=musl bun run script/production-artifact-attestation.ts
NOVAWAY_BINARY_ABI=musl bun run script/production-deployment-smoke.ts
```

目标平台 Runner 需要保存：

- 构建日志；
- SHA-256；
- 迁移数量；
- Health 和认证结果；
- Durable completion 结果；
- 重启恢复结果。
## 8. 当前平台证据状态

本地 Windows Runner 已完成生产业务 Smoke。当前工作站还完成了使用目标 Bun Runtime 的跨平台编译和文件格式校验：

```text
Linux x64 glibc：ELF x86-64，编译通过
Linux x64 musl：ELF x86-64，解释器为 /lib/ld-musl-x86_64.so.1，编译通过
macOS x64：Mach-O x86_64，编译通过
macOS arm64：Mach-O arm64，编译通过
Windows x64：PE32+ x86-64，编译和业务 Smoke 通过
```

跨平台编译证明：

```text
Linux x64 glibc
SHA-256: ea644524b4f191d48700c5a11fbc758a652bc2ff3c49f53772aef1aed1d79c72

Linux x64 musl
SHA-256: 71a738b2b60bdf05a0d2592bfc383a134bb6d9105620c97e2ee6ab7301b2fa53

macOS x64
SHA-256: f33d2f0fa0063ac23992604b9dc17eec80bee6766973274585bbcacc6d98f599

macOS arm64
SHA-256: f33375c226bb9dd92213433dc0e6650f7c705a1d9b3ddd859dca28b619aa1d54

Windows x64
SHA-256: 31e921bcf939d75000371608fdcfa7f6471266476cceda14a4800090a639b1a0
```

由于当前开发机是 Windows，Linux/macOS 二进制尚未在原生目标 Runner 上完成启动、认证、迁移和 Durable Run 重启 Smoke。因此它们仍不能标记为“目标平台生产验收通过”。发布必须等待 `.github/workflows/production-readiness.yml` 在对应 Runner 完成全部业务 Smoke。
## 9. 生产部署前完整 Smoke 清单

除自动化脚本外，正式发布还必须确认：

```text
1. 设置 NOVAWAY_SERVER_PASSWORD
2. 启动生产 Server
3. 未认证 / 错误认证请求必须拒绝
4. 正确认证访问 /global/health
5. 执行一次真实 read Tool
6. 执行一次真实 stdio MCP Tool
7. 创建 Durable Run 并重启进程
8. 批准 Permission Request
9. 验证 Run、Goal、Operation、Evidence 终态
10. 停止服务并确认无 dangling worker/process
```

同时必须执行生产运维 Smoke：

```bash
bun run script/production-operations-smoke.ts
```

该 Smoke 在目标 Runner 上启动打包二进制，通过本地 TLS 反向代理访问服务，捕获服务日志，
停止服务后执行 SQLite checkpoint、备份、删除原库、恢复备份并重新启动，只有以下结果全部
通过才允许上传运维证据：

```text
PRODUCTION_OPERATIONS_SMOKE=PASS
PRODUCTION_TLS_REVERSE_PROXY=PASS
PRODUCTION_BACKUP_RESTORE=PASS
PRODUCTION_LOG_BYTES>0
```

该脚本只能证明目标 Runner 上的可重复运维流程，不能替代正式环境的证书、反向代理、日志
采集和备份系统配置验收。


## 10. SA-G12 人工发布记录门禁

SA-G12 不能由自动化结果、AI 结论或预生成签名替代。发布操作者必须复制
`docs/sa-g12-manual-release-record.template.json`，在真实发布候选版本上填写每个场景的观察记录、证据路径、操作者签名和复核者签名，然后执行：

```bash
SA_G12_RECORD=test-results/sa-g12-manual-release.json bun run gate:sa-g12
```

该门禁在任何场景未观察、缺少证据、缺少签名或任一结论不是 `pass` 时失败。只有输出
`SA-G12_MANUAL_ACCEPTANCE=PASS` 后，SA-G12 才能进入发布审批；模板本身必须保持失败，不能作为发布证据。
