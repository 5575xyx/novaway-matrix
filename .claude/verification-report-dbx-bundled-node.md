# 验证报告：打包环境下 DBX MCP 内置独立 Node.js 运行时

生成时间：2026-07-05

## 需求字段完整性

- **目标**: 解决 Electron 打包后 DBX MCP 因 Electron ABI 与 better-sqlite3/keytar 原生模块不匹配而无法运行的问题
- **范围**: packages/desktop/scripts/prebuild.ts、packages/desktop/electron-builder.config.ts、packages/desktop/src/main/index.ts、packages/opencode/src/mcp/index.ts
- **交付物**: 代码修改、验证脚本、操作日志、验证报告
- **审查要点**: ABI 兼容性、打包体积、构建脚本可靠性、运行时路径正确性

## 覆盖原始意图

已覆盖用户"打包后的环境也要解决这个问题"的意图：

1. 在 prebuild 阶段下载独立 Node.js 运行时
2. 将 Node.js 作为 extraResource 打包进 Electron 应用
3. 打包环境下 DBX MCP Server 使用内置 Node.js 启动
4. 原生模块使用内置 Node.js 重新编译，确保 ABI 一致

## 交付物映射

| 交付物       | 路径                                            | 说明                                              |
| ------------ | ----------------------------------------------- | ------------------------------------------------- |
| 构建脚本     | packages/desktop/scripts/prebuild.ts            | 下载 Node.js 并重建原生模块                       |
| 打包配置     | packages/desktop/electron-builder.config.ts     | 将 Node.js 作为 extraResource                     |
| 主进程代码   | packages/desktop/src/main/index.ts              | 打包环境下指向内置 Node.js                        |
| MCP 连接代码 | packages/opencode/src/mcp/index.ts              | 移除旧的 ELECTRON_RUN_AS_NODE 逻辑                |
| Git 忽略配置 | packages/desktop/.gitignore                     | 忽略 resources/dbx-mcp 和 resources/node 构建产物 |
| 临时测试脚本 | .claude/test-bundled-node.ts                    | 验证 Node.js 下载和原生模块重建                   |
| 临时加载测试 | .claude/test-native-load.cjs                    | 验证原生模块可在内置 Node.js 加载                 |
| 操作日志     | .claude/operations-log.md                       | 记录决策和验证步骤                                |
| 验证报告     | .claude/verification-report-dbx-bundled-node.md | 本文件                                            |

## 依赖与风险评估

- **外部依赖**: Node.js 官方下载地址可访问性、构建机编译工具链
- **内部依赖**: resources/dbx-mcp 目录结构和依赖完整性
- **风险**: 打包体积增加约 30-50MB；构建机需支持原生模块编译

## 技术维度评分

| 维度     | 评分 | 说明                                                         |
| -------- | ---- | ------------------------------------------------------------ |
| 代码质量 | 85   | 逻辑清晰，使用现有工具链，但下载函数可进一步抽离为可测试模块 |
| 测试覆盖 | 75   | 已验证下载、重建、加载，缺少打包后端到端验证                 |
| 规范遵循 | 90   | 遵循项目 Bun/Electron 风格，注释说明意图                     |

## 战略维度评分

| 维度     | 评分 | 说明                                               |
| -------- | ---- | -------------------------------------------------- |
| 需求匹配 | 95   | 直接解决打包环境 ABI 不兼容问题                    |
| 架构一致 | 85   | 与现有 dbx-mcp 集成方案一致，额外增加 Node.js 资源 |
| 风险评估 | 80   | 体积和编译依赖是主要风险，已记录                   |

## 综合评分

**总分**: 84

## 建议

**通过**。建议后续在 CI 中分平台验证打包后的 DBX MCP 功能，并考虑缓存 Node.js 下载以加速构建。

## 审查结论

审查结论：通过
时间戳：2026-07-05
