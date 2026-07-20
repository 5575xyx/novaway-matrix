# 操作日志

## 视频复制完整文件 - 开始

时间：2026-07-09

### 问题定位

- 用户反馈视频复制应复制整个视频文件，而非仅图片帧。
- 经检查，`packages/desktop/src/main/ipc.ts` 中 Windows 实现使用 `Set-Clipboard -LiteralPath`，该参数在标准 PowerShell 中不存在，无法将文件对象写入剪贴板。
- macOS 和 Linux 实现基本正确。

### 执行步骤

1. 抽取 `copyLocalFileToClipboard` 和 `downloadUrlToTempFile` 到独立模块 `packages/desktop/src/main/clipboard-file.ts`。
2. 修正 Windows 实现为 `System.Windows.Forms.Clipboard.SetFileDropList`。
3. 修改 `packages/desktop/src/main/ipc.ts` 导入新模块。
4. 添加 `packages/desktop/src/main/clipboard-file.test.ts` 单元测试。
5. 运行 `bun typecheck` 和 `bun test` 验证。

### 完成情况

- `packages/desktop/src/main/clipboard-file.ts` 已创建，包含跨平台文件复制和临时文件下载逻辑。
- Windows 实现改为调用 PowerShell 加载 `System.Windows.Forms` 程序集，使用 `Clipboard.SetFileDropList` 将视频文件作为文件对象写入剪贴板。
- `packages/desktop/src/main/ipc.ts` 已移除重复实现并导入新模块。
- `packages/desktop/src/main/clipboard-file.test.ts` 已添加，覆盖 Windows/macOS/Linux 三种平台命令、路径转义和下载失败场景。

### 本地验证结果

- `bun typecheck`（packages/desktop）：通过
- `bun typecheck`（packages/ui）：通过
- `bun test src/main/clipboard-file.test.ts`（packages/desktop）：8 个测试全部通过
- `bun test src/util/clipboard.test.ts`（packages/ui）：10 个测试全部通过
- `npx oxlint` 对修改文件检查：无新增错误，新文件无警告

### 已知风险

- 临时文件在复制后不会立即删除，否则剪贴板中的文件引用会失效；依赖系统临时目录自动清理。
- Web 浏览器环境受 Clipboard API 限制，无法直接复制视频文件，仍会回退到复制第一帧图片。
- desktop 包中 `resources/powersnexus/tests/brainstorm-server/` 下存在与本次改动无关的测试失败。

## Agnes 图片编辑与图生视频支持

时间：2026-07-09

### 问题定位

- 用户要求根据 Agnes 官方文档检查图片编辑和图生视频支持情况。
- 图片编辑：`packages/llm/src/protocols/image-generation/agnes.ts` 将 `image` 数组错误地放在请求体顶层 `body.image`，文档要求放在 `extra_body.image`。
- 图生视频：`packages/llm/src/protocols/video-generation/agnes.ts` 已将 `image` 字符串正确放在请求体顶层，与文档一致。

### 执行步骤

1. 修复 `agnesImage.buildBody`，将 `params.image` 放入 `extra_body.image`。
2. 保持 `agnesVideo.buildCreateBody` 不变，确认图生视频已支持。
3. 添加 `packages/llm/test/protocols/image-generation/agnes.test.ts` 单元测试。
4. 补充 `agnesVideo` 的 buildCreateBody 图生视频测试。
5. 运行 `bun typecheck` 和 `bun test` 验证。

### 完成情况

- `packages/llm/src/protocols/image-generation/agnes.ts` 已修复，`image` 数组现在正确放入 `extra_body.image`。
- `packages/llm/test/protocols/image-generation/agnes.test.ts` 已创建，覆盖文生图、图生图、options 合并和响应解析。
- `packages/llm/test/protocols/video-generation/agnes.test.ts` 已补充文生视频和图生视频 buildCreateBody 测试。

### 本地验证结果

- `bun typecheck`（packages/llm）：通过
- `bun typecheck`（packages/opencode）：通过
- `bun test test/protocols/`（packages/llm）：12 个测试全部通过
- `npx oxlint` 对修改文件检查：仅剩余 1 个原有 type assertion 警告，无新增错误

### 结论

- 图片编辑（image-to-image）：已支持。用户可通过 `generate_image` 工具的 `image` 参数传入图片 URL 或 Base64 Data URI。
- 图生视频（image-to-video）：已支持。用户可通过 `generate_video` 工具的 `image` 参数传入图片 URL。

## 图片编辑上传图片未传入 API 修复

时间：2026-07-09

### 问题定位

- 用户反馈图片编辑生成结果与上传图片和要求完全不符。
- 检查 `packages/opencode/src/session/llm.ts` 发现：虽然已从用户消息中解析出图片附件的 Data URL 并存入 `imageUrls`，但在调用 `ImageGeneration.make().generate()` 和 `VideoGeneration.make().createTask()` 时未将 `imageUrls` 传入，导致 Agnes API 收不到输入图片，实际变成纯文生图。

### 执行步骤

1. 在 `llm.ts` 的图片生成分支中，将 `image: imageUrls` 加入 `ImageGeneration.generate` 的参数。
2. 在视频生成分支中，将 `image: imageUrls[0]` 加入 `VideoGeneration.createTask` 的参数，以适配 Agnes 图生视频只接受单张图片的接口。
3. 在 `packages/opencode/test/session/llm.test.ts` 新增集成测试，验证当模型具备图片输出能力且用户消息包含图片附件时，请求体 `extra_body.image` 正确包含上传的图片 Data URL。
4. 运行 `bun typecheck` 和 `bun test` 验证。

### 完成情况

- `packages/opencode/src/session/llm.ts` 已修复，上传的图片现在会作为 `image` 参数传给图片/视频生成协议。
- `packages/opencode/test/session/llm.test.ts` 已新增测试用例 `routes image generation models and forwards uploaded image data URLs`。

### 本地验证结果

- `bun typecheck`（packages/opencode）：通过
- `bun test test/session/llm.test.ts`（packages/opencode）：15 个测试全部通过
- 根目录 `bun lint`：因仓库范围 oxlint OOM 无法完成，与本次改动无关

## 图片生成只显示“图片生成成功（base64格式）”且官网无调用记录

时间：2026-07-09

### 问题定位

- 用户截图显示返回文本“图片生成成功（base64格式）”，且 Agnes 账单中没有对应调用记录。
- 该文本是 `packages/opencode/src/session/llm.ts` 在 `imageUrl` 为空时的兜底文案，说明 Agnes 响应里没拿到 `url`。
- `ImageGeneration` Service 在 `packages/llm/src/protocols/image-generation/index.ts` 里未检查 HTTP 状态码，若 Agnes 返回 4xx/5xx 错误，代码会把错误响应的 JSON 当作正常数据解析，导致 `images` 为空，进而显示兜底文案，且没有真正的成功调用记录。

### 执行步骤

1. 在 `ImageGeneration` Service 中增加 `response.status >= 400` 的错误处理，失败时读取响应体并抛出明确错误，避免把错误响应当成空结果。
2. 在 `llm.ts` 图片生成分支增加日志，记录 `imageCount`、`imageSizes` 以及返回结果中是否包含 `url` 或 `base64`。
3. 修正兜底文案：当没有 `url` 但有 `base64` 时，渲染为 `data:image/png;base64,...` 图片；两者都没有时提示“未包含图片数据”，不再显示容易误导的“base64格式”。
4. 重新运行 `bun typecheck` 和对应测试验证。

### 完成情况

- `packages/llm/src/protocols/image-generation/index.ts` 已增加 HTTP 错误状态检查。
- `packages/opencode/src/session/llm.ts` 已增加日志和 base64 图片渲染兜底。

### 本地验证结果

- `bun typecheck`（packages/llm）：通过
- `bun typecheck`（packages/opencode）：通过
- `bun test test/session/llm.test.ts -t "routes image generation models"`：通过
- `bun test test/protocols/image-generation/agnes.test.ts test/protocols/video-generation/agnes.test.ts`（packages/llm）：11 个测试全部通过
