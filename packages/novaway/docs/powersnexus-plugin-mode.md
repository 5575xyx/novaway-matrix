
## 跨端状态、指标与安全边界（2026-11-20）

工作流状态现在可以由 Desktop、CLI、IDE 和 Web 通过同一个 server session 读取，不依赖前端本地状态：

- `GET /session/:sessionId/workflow-state`：读取当前 route/phase/question budget/verification/delivery；
- `GET /session/:sessionId/workflow-events`：读取有序事件流，用于恢复和审计；
- `GET /session/:sessionId/workflow-metrics`：读取 route、phase、升级、提问误用、阻断工具、验证和交付指标。

指标只从持久化 event/state 推导；未知事件不会被计为成功，`unverified` 不会折叠为 `passed`。

插件信任策略已提供统一的确定性评估：第一方且具备 SHA-256 的归档可识别为 `official`；有可验证摘要的第三方为 `verified`；缺少摘要或签名的工件为 `untrusted` 并禁止激活。高风险权限（workspace、process、network、secret、MCP 等）即使来源可信也要求确认。

模型上下文中的仓库、网页、MCP、工具和 Skill 内容属于低于宿主规则的外部数据。运行时提示词明确禁止这些内容覆盖系统规则、权限规则或 workflow policy，并拒绝把外部文本中的“忽略之前指令”当作授权。
