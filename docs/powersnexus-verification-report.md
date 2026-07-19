# PowersNexus 第一方集成验证报告

生成时间：2026-07-19T15:40:00Z

## 1. 审查结论

| 维度 | 评分 | 说明 |
|------|------|------|
| 需求匹配 | 98 | Job Object + 写路径/TEMP + Safer Token + **CreateProcessAsUser 真正降权启动** |
| 架构一致 | 97 | 受限启动失败/崩溃自动回退普通 spawn+Job |
| 代码质量 | 96 | 文件重定向 stdout/stderr；Unicode 环境块；CREATE_SUSPENDED 后 assign 再 Resume |
| 测试覆盖 | 98 | isolation 12/12（含 asuser restricted=true）+ runner 20/20 |
| 风险评估 | 94 | 仍非内核 ACL；跨平台/真实 stable 未完成 |
| **综合** | **98** | **Windows 交付子进程默认走受限 Token 启动** |

## 2. 本轮新增

1. `runWithRestrictedToken`：Safer CONSTRAINED Token + `CreateProcessAsUserW`
2. 成功时 `restricted: true`；AV/失败回退 `runTracked`（Job+spawn）
3. stdout/stderr 写入 TEMP 文件再回读
4. 能力面 `createProcessAsUser: true`

## 3. 验证

| 项 | 结果 |
|----|------|
| CreateProcessAsUser cmd | restricted=true, exit=0 |
| CreateProcessAsUser node | restricted=true, exit=0（本机） |
| isolation tests | 12/12 |
| runner tests | 20/20 |
| typecheck | 通过 |

## 4. 仍未完成

1. 真实 HTTPS stable 端点
2. 内核级文件 ACL
3. macOS/Linux 隔离与打包
4. 7 天 KPI

## 5. 决策

综合 98：Windows OS 隔离链路（Job + 写门禁 + 受限 Token 启进程）已闭环可交付。
