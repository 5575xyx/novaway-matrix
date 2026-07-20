# 项目上下文摘要（Agnes 图片编辑与图生视频）

生成时间：2026-07-09

## 任务背景

用户要求根据 Agnes 官方文档检查：

1. 当前图片生成实现是否支持图片编辑（image editing / image-to-image）。
2. 当前视频生成实现是否支持根据图片生成视频（image-to-video）。

参考文档：

- `https://agnes-ai.com/zh-Hans/docs/agnes-image-21-flash`
- `https://agnes-ai.com/zh-Hans/docs/agnes-video-v20`

## 文档关键信息

### Agnes Image 2.1 Flash

- Endpoint：`POST https://apihub.agnes-ai.com/v1/images/generations`
- 图片编辑（图生图）时，`image` 数组必须放在 `extra_body.image` 中，而不是请求体顶层。
- 示例：
  ```json
  {
    "model": "agnes-image-2.1-flash",
    "prompt": "...",
    "size": "1024x768",
    "extra_body": {
      "image": ["https://example.com/input-image.png"],
      "response_format": "url"
    }
  }
  ```

### Agnes Video V2.0

- Endpoint：`POST https://apihub.agnes-ai.com/v1/videos`
- 图生视频时，`image` 字符串放在请求体顶层。
- 示例：
  ```json
  {
    "model": "agnes-video-v2.0",
    "prompt": "...",
    "image": "https://example.com/image.png",
    "num_frames": 121,
    "frame_rate": 24
  }
  ```

## 当前实现分析

### 图片生成

- 文件：`packages/llm/src/protocols/image-generation/agnes.ts`
- 问题：`params.image` 被错误地放在 `body.image` 顶层，不符合文档要求。
- 结论：当前不支持图片编辑，需要修复。

### 视频生成

- 文件：`packages/llm/src/protocols/video-generation/agnes.ts`
- 状态：`params.image` 正确地放在 `body.image` 顶层，与文档一致。
- 结论：当前已支持图生视频，可通过 `generate_video` 工具的 `image` 参数传入图片 URL。

## 相似实现分析

- **实现1**: `packages/llm/src/protocols/video-generation/agnes.ts`
  - 模式：根据 `VideoGenerationParams` 构建请求体，支持 `image` 字段
  - 可复用：buildCreateBody 中的参数处理模式
  - 需注意： Agnes 视频有 `extra_body` 关键帧模式，但本次不涉及

- **实现2**: `packages/llm/test/protocols/video-generation/agnes.test.ts`
  - 模式：直接测试 protocol 的 buildBody / parseResponse
  - 可复用：测试文件结构和断言方式
  - 需注意：图片生成目前无测试目录

- **实现3**: `packages/opencode/src/tool/generate_image.ts`
  - 模式：工具参数 Schema 已包含 `image: optional(Array(String))`
  - 可复用：工具层无需修改
  - 需注意：只需修复协议层

## 项目约定

- **命名约定**: 测试文件使用 `.test.ts`，协议文件使用小写连字符命名
- **文件组织**: 协议测试放在 `packages/llm/test/protocols/<domain>/`
- **代码风格**: 使用单引号、无分号、函数式风格
- **测试风格**: 使用 `bun:test`，直接断言 protocol 的输出

## 可复用组件清单

- `packages/llm/src/protocols/image-generation/index.ts` 中的 `ImageGenerationParams` 接口
- `packages/llm/test/protocols/video-generation/agnes.test.ts` 的测试结构
- `packages/opencode/src/tool/generate_image.ts` 中已定义的工具参数 Schema

## 测试策略

- **测试框架**: bun:test
- **测试模式**: 单元测试 protocol 的 buildBody 和 parseResponse
- **参考文件**: `packages/llm/test/protocols/video-generation/agnes.test.ts`
- **覆盖要求**: 文生图（无 image）、图生图（有 image 数组）、base64 输出解析

## 依赖和集成点

- **外部依赖**: 无新增
- **内部依赖**: `packages/llm/src/protocols/image-generation/agnes.ts` 修复后影响 `packages/opencode/src/tool/generate_image.ts`
- **集成方式**: 通过 `ProtocolRegistry` 注册协议
- **配置来源**: 模型配置和 provider 配置

## 技术选型理由

- 仅修复协议层 `buildBody`：工具层已经具备传入 image 的能力，最小化改动范围。
- 添加图片生成协议测试：与视频生成协议测试保持一致，形成对称的测试覆盖。

## 关键风险点

- **向后兼容**：修复后，`body.image` 不再存在，改为 `extra_body.image`。这是符合文档的正确行为，但如果有其他调用方依赖顶层 image，会受影响。经检查，`generate_image` 工具是唯一调用方，且其调用方式不变。
- **base64 输出**：当前 parseResponse 已支持 `b64_json`，无需修改。
