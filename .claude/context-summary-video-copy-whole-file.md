# 项目上下文摘要（视频复制完整文件）

生成时间：2026-07-09

## 任务背景

用户反馈视频复制功能应复制整个视频文件，而不是仅复制第一帧图片。此前实现已在 Electron 桌面端添加 `copy-file-to-clipboard` IPC，但存在 Windows 平台命令错误的问题。

## 相似实现分析

- **实现1**: `packages/ui/src/util/clipboard.ts`
  - 模式：渲染进程根据媒体类型选择复制路径，视频优先调用 Electron 原生 `copyFileToClipboard`
  - 可复用：`copyMediaToClipboard` 函数、Electron API 检测辅助函数
  - 需注意：浏览器环境无法复制视频文件，会回退到帧捕获

- **实现2**: `packages/ui/src/util/download.ts`
  - 模式：优先使用 Electron `saveFilePicker`，其次浏览器 File System Access API，最后 `<a download>` 降级
  - 可复用：`filenameFromUrl` 工具函数
  - 需注意：跨域 fetch 需要 `mode: "cors"`

- **实现3**: `packages/desktop/src/main/ipc.ts` 中的 `save-file-picker` 处理
  - 模式：主进程通过 `dialog.showSaveDialog` 提供保存路径
  - 可复用：主进程文件操作模式
  - 需注意：IPC 处理函数应做参数校验

## 项目约定

- **命名约定**: 文件/函数使用 camelCase，测试文件使用 `.test.ts`
- **文件组织**: 主进程辅助函数可独立成模块以便测试
- **代码风格**: 使用单引号字符串、无分号、printWidth 120
- **错误处理**: 使用 `try/catch` 并在失败时返回 `false`，避免抛出

## 可复用组件清单

- `packages/ui/src/util/download.ts` 中的 `filenameFromUrl`
- `packages/desktop/src/main/ipc.ts` 中的 `shellEscape`
- `packages/desktop/src/main/shell-env.test.ts` 的测试结构

## 测试策略

- **测试框架**: bun:test
- **测试模式**: 单元测试
- **参考文件**: `packages/desktop/src/main/shell-env.test.ts`
- **覆盖要求**: Windows/macOS/Linux 三种平台命令、下载失败回退、路径转义

## 依赖和集成点

- **外部依赖**: `node:child_process`, `node:fs/promises`, `node:os`, `node:path`
- **内部依赖**: `packages/desktop/src/main/ipc.ts` 导入并注册 IPC 处理
- **集成方式**: 渲染进程通过 `window.api.copyFileToClipboard` 调用
- **配置来源**: 无特殊配置

## 技术选型理由

- 将辅助函数抽取到独立模块 `clipboard-file.ts`：避免在测试中加载整个 `electron` 依赖，提升可测试性
- Windows 使用 `System.Windows.Forms.Clipboard.SetFileDropList`：这是 Windows 上将文件路径放入剪贴板的标准 WinForms API，能被资源管理器识别为文件对象

## 关键风险点

- **Windows PowerShell 版本差异**: 旧版本可能缺少 WinForms 程序集，需要验证
- **临时文件清理**: 下载到临时目录的文件在复制后不能及时删除，否则剪贴板中的文件引用会失效
- **Linux 桌面环境差异**: `xclip` 和 `wl-copy` 的可用性因发行版而异
