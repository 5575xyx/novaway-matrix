# Super-Agent 人工发布抽样清单

> 本清单是 SA-G12 的人工证据模板。自动化测试结果不能替代以下人工签名和观察记录。

## 抽样环境

- 日期：
- 操作者：
- 版本 / 工作树：
- 浏览器与版本：
- backend / UI 隔离端口：
- 数据库与 workspace：

## 必须人工观察并记录

- [ ] 创建 Run、编辑 Goal 和 Acceptance Criteria。
- [ ] 创建危险操作 Approval，确认未批准前不能执行。
- [ ] 批准后继续执行，并观察 Timeline / Task Graph / Event 顺序。
- [ ] 暂停、刷新、恢复，确认 checkpoint 和状态一致。
- [ ] 断开网络后刷新，恢复网络后确认状态可恢复。
- [ ] 关闭并重新启动 test-owned backend，确认 Run、Graph、Evidence、Verification 和 mutation history 保留。
- [ ] 观察一个 parallel Agent 成功、一个失败，确认 parent 不会伪造 completed。
- [ ] 禁用第三方 Agent 插件，确认后续调用被阻断并进入安全状态。
- [ ] 观察失败 Verification → Repair → 新 Evidence → 新 Verification → completed 全链路。
- [ ] 确认页面、事件和日志中没有 token、secret 或未脱敏凭证。
- [ ] 确认人工批准、插件 disable、cancel 和 backend stop 后没有残留 timer、listener 或 child process。

## 证据

- 截图 / 录屏路径：
- Event / Run ID：
- Evidence ID：
- Verification ID：
- 观察到的问题：
- 回滚结果：

## 签名

- 操作者结论：`pass` / `fail` / `needs_review`
- 操作者签名：
- 复核者签名：
- 复核日期：

未填写签名和真实观察记录前，SA-G12 必须保持未通过，不能以自动化测试代替。
