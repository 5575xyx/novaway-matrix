## 项目上下文摘要（Agnes 图片/视频显示修复）

生成时间：2026-07-08

### 1. 相似实现分析

- **图片生成协议**: packages/llm/src/protocols/image-generation/agnes.ts
  - 模式：ProtocolRegistry 注册适配器，service 负责 HTTP 调用
  - 可复用：ImageGeneration.make().generate()
  - 需注意：endpoint 与 baseURL 拼接规则

- **视频生成协议**: packages/llm/src/protocols/video-generation/agnes.ts
  - 模式：create + waitForCompletion 两轮调用
  - 可复用：VideoGeneration.make().createTask() / waitForCompletion()
  - 需注意：statusEndpoint 与 baseURL 拼接后路径是否正确

- **直接调用路径**: packages/opencode/src/session/llm.ts
  - 模式：根据 capabilities.output.image/video 直接路由到生成 API
  - 可复用：ProtocolRegistry.getImageProtocol/getVideoProtocol
  - 需注意：流式事件序列必须包含 text-start

### 2. 项目约定

- 命名约定：驼峰/帕斯卡，snake_case 用于 API 字段映射
- 文件组织：协议在 packages/llm/src/protocols/\*/
- 代码风格：无分号，printWidth 120

### 3. 可复用组件清单

- packages/llm/src/protocols/image-generation/index.ts: ImageGenerationService
- packages/llm/src/protocols/video-generation/index.ts: VideoGenerationService
- packages/ui/src/components/message-part.tsx: ToolRegistry

### 4. 测试策略

- bun typecheck（包级）
- bun lint / oxlint
- 端到端手动测试图片/视频生成

### 5. 依赖和集成点

- Agnes API 端点：apihub.agnes-ai.com
- 图片返回路径：data[0].url
- 视频创建返回：video_id
- 视频状态返回：url（status=completed）

### 6. 关键风险点

- 视频状态 URL 拼接错误导致 404
- 视频状态 'in_progress' 未在类型中声明
- 缺少 ui.tool.generateVideo 国际化翻译
