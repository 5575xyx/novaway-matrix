## 项目上下文摘要（Workflow工具实现）
生成时间：2026-08-24

### 1. 相似实现分析
- **实现1**: packages/novaway/src/tool/question.ts:14-44
  - 模式：Tool.define + Effect.gen + Schema.Struct
  - 可复用：Tool.define函数，Effect.gen模式
  - 需注意：需要yield*服务依赖

- **实现2**: packages/novaway/src/tool/glob.ts:19-103
  - 模式：Tool.define + Effect.gen + Schema.Struct
  - 可复用：参数定义模式，execute函数结构
  - 需注意：需要处理权限请求（ctx.ask）

- **实现3**: packages/novaway/src/tool/registry.ts:1-598
  - 模式：工具注册，导入工具，添加到builtin数组
  - 可复用：注册模式，初始化流程
  - 需注意：需要添加到Effect.all和builtin数组

### 2. 项目约定
- **命名约定**: 工具文件使用小写+下划线（如question.ts），导出工具使用PascalCase（如QuestionTool）
- **文件组织**: 每个工具一个文件，在src/tool目录下
- **导入顺序**: 先导入effect相关，再导入项目模块，最后导入本地模块
- **代码风格**: 使用Effect.gen，Schema定义参数，Tool.define导出

### 3. 可复用组件清单
- `src/tool/tool.ts`: Tool.define函数，Tool.Context类型
- `src/workflow/workflow.ts`: WorkflowService，Workflow接口
- `src/session/schema.ts`: SessionID类型
- `src/effect/instance-state.ts`: InstanceState

### 4. 测试策略
- **测试框架**: 项目使用bun test
- **测试模式**: 单元测试，可能需要mock WorkflowService
- **参考文件**: 需要查找现有工具测试
- **覆盖要求**: 测试所有action分支

### 5. 依赖和集成点
- **外部依赖**: effect库（Effect, Schema）
- **内部依赖**: WorkflowService, SessionID
- **集成方式**: 通过Tool.define注册到工具系统
- **配置来源**: 无特殊配置

### 6. 技术选型理由
- **为什么用这个方案**: 遵循项目现有工具定义模式
- **优势**: 与现有代码一致，易于维护
- **劣势**: 需要学习Effect模式

### 7. 关键风险点
- **并发问题**: 工具执行可能涉及异步操作
- **边界条件**: 需要处理workflow不存在的情况
- **性能瓶颈**: 数据库查询可能影响性能
- **安全考虑**: 需要验证输入参数