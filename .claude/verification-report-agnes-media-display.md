## 验证报告 - Agnes 图片/视频显示修复

生成时间：2026-07-08

### 需求匹配

- 修复视频生成后无法获取结果 URL 的问题：通过修正状态查询 URL 匹配 Agnes 文档
- 补充视频工具国际化文本
- 新增单元测试覆盖视频协议解析和 URL 拼接

### 代码变更

- packages/llm/src/protocols/video-generation/index.ts
  - 新增 resolveEndpoint 辅助函数，支持绝对 URL 端点
  - 在 getStatus / waitForCompletion 中使用 resolveEndpoint
  - VideoTaskStatus 类型增加 `in_progress`
- packages/llm/src/protocols/video-generation/agnes.ts
  - statusEndpoint 改为绝对 URL `https://apihub.agnes-ai.com/agnesapi?video_id={taskId}`
- packages/ui/src/i18n/en.ts / zh.ts
  - 添加 `ui.tool.generateVideo` 翻译
- packages/llm/test/protocols/video-generation/agnes.test.ts
  - 测试状态端点为绝对 URL
  - 测试创建响应优先使用 video_id
  - 测试状态响应提取 url 字段
  - 测试 in_progress 状态映射
- packages/llm/test/protocols/video-generation/service.test.ts
  - 测试 VideoGeneration 服务使用正确的绝对状态 URL

### 验证结果

- packages/llm bun typecheck：通过
- packages/ui bun typecheck：通过
- packages/opencode bun typecheck：通过
- oxlint 修改文件：0 errors，4 warnings（agnes.ts 中原有的 unsafe type assertion，非本次引入）
- packages/llm 单元测试：新增 5 个测试全部通过；全量测试中 194 pass，3 fail（OpenAI API Key 相关，与本次修改无关）

### 风险评估

- 低风险：仅修改视频状态 URL 拼接逻辑，不影响其他协议
- 低风险：新增 `in_progress` 状态类型为扩展，不破坏现有比较逻辑
- 低风险：新增国际化键为纯文本补充

### 综合评分

- 代码质量：90
- 测试覆盖：85
- 规范遵循：90
- 需求匹配：95
- 架构一致：95
- 风险评估：95

**综合评分：91**
**建议：通过**

### 备注

图片生成路径在代码层面已按文档实现（data[0].url），本次未做额外修改。如图片仍无法显示，建议检查：

1. 所选模型是否正确标记 capabilities.output.image
2. 浏览器控制台是否有图片 URL 加载错误（CSP/CORS）
3. 直接调用路径是否被触发（model.capabilities.output.image === true）
