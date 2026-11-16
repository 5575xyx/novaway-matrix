# NovaWay 自有插件市场长期产品路线与实施方案

> 文档状态：长期产品路线规划稿
>
> 目标：把 NovaWay 扩展市场建设为可长期运行的自有插件市场，而不是只完成一版截图式首期 UI。
>
> 适用范围：NovaWay 内核、Plugin Host、旧 Extension 兼容层、HTTP API、Web/Desktop/TUI 共用状态、市场 UI、自有市场仓库和发布体系。
>
> 执行约束：所有实施必须在当前工作区现状和用户未提交修改之上做最小增量修改；不覆盖、清理或回滚无关改动；不提交代码；不重启用户现有 Host/server；任何远端仓库创建、推送、发布和 Secrets 写入都必须另行获得明确确认。

---

## 1. 背景与问题定义

NovaWay 需要一个长期可维护的插件市场。市场的目标不是展示若干静态卡片，而是提供完整产品闭环：

```text
发现
→ 搜索与分类
→ 查看详情、兼容性、权限和来源
→ 安装与校验
→ 发现并激活
→ 被真实生产消费者使用
→ 启用/停用
→ 更新、回滚或卸载
→ 冷启动恢复
```

当前实现存在两条尚未完全统一的路径：

1. **旧 Extension 市场**
   - 目录和安装逻辑位于 `packages/novaway/src/extension/`；
   - 支持 ZCode ZIP、Claude Git 目录等既有格式；
   - 已有下载、可选 SHA-256、安全解包、安装记录、更新探测和卸载能力；
   - HTTP API 和 UI 已经存在一部分实现。

2. **NovaWay v2 Plugin Host**
   - 位于 `packages/novaway/src/plugin/`；
   - 负责插件扫描、归一化、激活和向 Tools、Agents、Skills、Commands、Surfaces、Office 等注册表贡献能力；
   - 已存在运行时、存储和生命周期原型，但旧市场的安装流程尚不能自动保证插件进入 v2 Plugin Host 并被真实消费者使用。

长期方案必须统一市场产品体验，但不能错误地把不同协议、制品格式和运行时当成同一种插件。统一的应该是：

- 市场领域模型；
- API 和 UI 管理方式；
- 安装事务和状态表达；
- 安全校验与诊断；
- 版本、来源、摘要和生命周期记录。

不能被强行统一的是：

- Claude/ZCode 与 NovaWay v2 的运行时语义；
- 旧 Extension 与 v2 Plugin Host 的安装目录和加载方式；
- declarative、code、mixed 插件的信任级别；
- 不同 contribution kind 的消费者和停用机制。

---

## 2. 产品愿景与最终结果

### 2.1 用户侧最终体验

用户能够在任意 NovaWay 前端形态中：

1. 浏览官方市场和自定义市场源；
2. 搜索、分类、筛选和查看精选内容；
3. 查看插件详情、作者、许可证、更新日志、版本、来源、校验摘要和兼容范围；
4. 在安装前查看贡献能力、依赖、权限、网络/文件/执行风险和运行时类型；
5. 安装并看到真实的安装阶段，而不是一个模糊的成功/失败提示；
6. 查看安装后的实际运行状态和消费者可见状态；
7. 启用、停用、更新、回滚、重装和卸载；
8. 在离线或市场刷新失败时继续查看缓存并获得明确诊断；
9. 对 Claude/ZCode 兼容插件看到明确的映射范围和未支持能力；
10. 不因添加或删除市场源而意外卸载已经安装的插件。

### 2.2 平台侧最终结果

平台能够：

- 通过版本化目录持续发布 NovaWay 自有插件；
- 在目录、制品、安装记录和运行时之间建立可追踪关系；
- 支持多个协议 Adapter 和多个 Runtime Adapter；
- 在安装失败、激活失败、升级失败和进程崩溃后恢复；
- 让所有标记为“可用”的贡献类型具备真实消费者和自动化测试证据；
- 对高风险 code/mixed 插件实施明确的信任和权限策略；
- 以 GitHub 官方源为主，并可扩展到 Gitee/CDN 镜像；
- 在不破坏旧 Extension 的情况下逐步迁移到统一市场模型。

---

## 3. 范围与非目标

### 3.1 长期范围

本路线最终覆盖：

- NovaWay 原生市场目录；
- Claude `.claude-plugin/marketplace.json`；
- ZCode `marketplace.json`；
- ZIP、Git、仓库子目录和发布制品；
- NovaWay v2 declarative/code/mixed 插件；
- 旧 Claude/ZCode/Extension 兼容安装路径；
- Tools、Agents、Skills、Commands、Interceptors、Providers、Surfaces、Previewers、Office、Super-Agent 等目标能力；
- 搜索、分类、精选、详情、已安装、更新、回滚、卸载和来源管理；
- 目录缓存、离线展示、镜像摘要一致性和发布 CI；
- 内置 Office Skill 修复以及 Office 市场插件化；
- 本地 fixture、单元测试、契约测试、运行时测试和浏览器 E2E。

### 3.2 不属于默认承诺的内容

以下内容需要单独的设计和安全门，不可因为“能解析”就默认可运行：

- 任意第三方 JavaScript 在宿主进程内执行；
- 未经审查的高权限 code/mixed 插件；
- 将 Claude/ZCode 的 MCP、hooks、权限语义静默映射到 NovaWay v2；
- 将 Office Agent 声称为已经替代现有内置 Agent；
- 将依赖 `packages/app` 私有模板或本地脚本的插件声称为通用可移植插件；
- 将动态启停承诺给没有可靠 unregister/dispose 契约的贡献类型；
- 将下载成功、目录解析成功或文件落盘成功标记为“NovaWay 可用”。

---

## 4. 执行约束与工作方式

### 4.1 工作区保护

每次实施前必须：

1. 读取当前 `git status` 和相关未提交差异；
2. 读取目标文件的最新版本，而不是根据旧计划假设文件内容；
3. 标记与本路线相关的已有修改、原型和测试；
4. 只做最小增量修改；
5. 不使用大范围格式化、批量替换或重构来清理无关代码；
6. 不覆盖、删除或回滚用户已有修改；
7. 不执行 `git commit`、`git reset`、`git clean` 或远端写操作。

### 4.2 进程与环境保护

- 不重启用户当前运行的 Host、server 或其他服务；
- 需要 E2E 时使用独立 fixture 进程、专用端口或已有可用进程；
- 启动专用服务前确认端口和进程状态；
- 不用真实公网市场作为唯一测试依赖；
- 浏览器 UI 验证遵守 `packages/app/AGENTS.md`；
- 所有未执行的测试必须在报告中明确列出。

### 4.3 证据优先

每项能力的状态必须以代码、测试或实际运行证据为准：

```text
已实现 ≠ 已发现
已发现 ≠ 已激活
已激活 ≠ 已被消费者使用
已被使用 ≠ 已验证停用和冷启动恢复
```

---

## 5. 总体架构

### 5.1 分层结构

```text
┌─────────────────────────────────────────────────────────────┐
│ Web / Desktop / TUI / CLI                                  │
│ 市场列表、详情、已安装、源管理、权限确认、错误诊断          │
└───────────────────────────────┬─────────────────────────────┘
                                │ HTTP API / SDK
┌───────────────────────────────▼─────────────────────────────┐
│ Marketplace Application Service                             │
│ 源管理、目录缓存、搜索、安装操作、更新、回滚、诊断          │
└───────────────┬───────────────────────┬─────────────────────┘
                │                       │
┌───────────────▼──────────────┐ ┌──────▼─────────────────────┐
│ Source Adapters              │ │ Runtime Adapters           │
│ NovaWay / Claude / ZCode     │ │ NovaWay v2 / Legacy        │
└───────────────┬──────────────┘ └──────┬─────────────────────┘
                │                       │
┌───────────────▼───────────────────────▼─────────────────────┐
│ Artifact Resolver / Secure Installer                         │
│ 下载、Git 固定、摘要、签名、解包、staging、原子替换、回滚     │
└───────────────────────────────┬─────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────┐
│ Installed Package / Plugin Host / Legacy Extension Loader    │
│ discovery、兼容性、activate、deactivate、dispose、恢复       │
└───────────────────────────────┬─────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────┐
│ Real Consumers                                               │
│ Tool、Agent、Skill、Command、Interceptor、Surface、Office 等 │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 两类 Adapter

必须区分两种 Adapter。

#### Source Adapter

负责理解市场目录协议：

- 拉取目录；
- 解析和校验目录；
- 发现条目；
- 保留原始协议字段；
- 解析制品定位；
- 报告协议级 warning/error。

Source Adapter 不应该直接决定运行时如何加载插件。

#### Runtime Adapter

负责理解安装后的运行时：

- 安装目录和索引；
- manifest/schema 校验；
- discovery；
- activation/deactivation/dispose；
- capability registration；
- 权限与信任策略；
- 冷启动恢复。

Runtime Adapter 不应该直接解析远端市场目录。

---

## 6. 核心领域模型

### 6.1 MarketplaceSource

表示一个用户配置的市场源：

```text
id                    稳定本地 ID
name                  展示名称
type                  novaway | claude | zcode | auto
catalogUrl            目录 URL
enabled               是否参与刷新和展示
trustPolicy           信任等级、签名要求、允许的 runtime
artifactPolicy        下载端点、重定向、大小和文件数限制
refreshPolicy         刷新间隔和缓存策略
lastRefreshAt         最近成功刷新时间
lastError             最近一次可展示错误
createdAt / updatedAt 管理时间
```

源被删除不等于卸载该源曾经安装的插件。

### 6.2 CatalogSnapshot

表示某次目录刷新结果：

```text
sourceId
fetchedAt
etag / lastModified
schemaVersion
contentDigest
entries
warnings
errors
expiresAt
```

刷新失败时保留上一次成功快照，并在 UI 中显示过期或离线状态。

### 6.3 MarketEntry

表示市场目录中的逻辑插件条目。它应以静态市场信息为主，不直接持久化本机激活状态：

```text
packageId
name
version
description
longDescription
author
icon
screenshots
categories
tags
license
homepage
repository
sourceId
runtimeTargets
packageFormats
artifacts
compatibility
capabilities
permissions
dependencies
releaseNotes
verifiedStatus
```

其中：

- `packageId` 是逻辑包身份；
- `version` 遵循明确的版本规则；
- `runtimeTargets` 可以是多个目标，不应假设只有一个 runtime；
- `capabilities` 只表示声明能力，是否可用还要结合本机消费者矩阵；
- `verifiedStatus` 必须由签名、发布门和本地验证结果共同决定。

### 6.4 Artifact

表示一个具体可下载或可 clone 的制品：

```text
artifactId
packageId
version
format            zip | tar | git | directory | release
url
repositoryUrl
subdirectory
commitSha
sha256
signature
size
fileCount
```

镜像是同一个 artifact 的备用端点，不应制造新的逻辑插件身份。

### 6.5 InstalledPackage

表示本机已安装的版本：

```text
packageId
installedVersion
sourceId
runtime
scope              global | project | session
installPath
artifactDigest
manifestDigest
installedAt
updatedAt
enabled
previousVersion
backupPath
permissionGrant
```

### 6.6 PluginRuntimeState

运行状态必须与安装状态分开：

```text
installationStatus:
  absent | staging | validating | installed | updating | uninstalling | failed

compatibilityStatus:
  compatible | incompatible | experimental | unknown

activationStatus:
  disabled | activating | active | draining | deactivating |
  disabled-pending-restart | failed | cleanup-pending

consumerStatus:
  undiscovered | discovered | registered | partially-registered |
  usable | unavailable
```

不建议把这些维度压缩成一个枚举。

### 6.7 InstallOperation

所有变更操作都应具备可追踪 ID：

```text
operationId
operationType       install | update | rollback | enable | disable | uninstall
packageId
version
runtime
scope
phase
startedAt
finishedAt
progress
errorCode
recoveryHint
```

---

## 7. 统一目录与协议 Adapter

### 7.1 NovaWay 原生目录

自有目录必须是版本化 JSON schema，至少支持：

- schema 版本；
- 插件 ID 和版本；
- 作者、主页、许可证；
- 分类、标签、精选标记；
- 图标、README、截图、更新日志；
- runtime 和 package format；
- 下载 URL、仓库子目录、固定 commit；
- SHA-256 和后续签名；
- 最低/最高 NovaWay API 版本；
- manifest 版本；
- capability 和权限声明；
- 依赖和冲突；
- 发布状态和验证状态。

### 7.2 Claude Adapter

需要支持：

- `.claude-plugin/marketplace.json` 目录解析；
- Claude 条目的原始字段保留；
- Git 仓库、子目录和版本定位；
- Claude commands、agents、skills、hooks、MCP 等能力分开映射；
- 未映射字段产生 warning，而不是静默丢弃；
- 不能因为能解析 MCP 或 hooks 就声称 NovaWay v2 已支持。

### 7.3 ZCode Adapter

需要支持：

- `marketplace.json` 解析；
- ZIP、Git 和仓库子目录定位；
- ZCode 原始 manifest 保留；
- 能力映射表；
- 旧 Extension 安装目录和生命周期；
- 不兼容字段、缺失字段和不安全字段的诊断。

### 7.4 Adapter 统一接口

建议抽象出类似下列职责，而不是让一个类包揽所有逻辑：

```text
parseCatalog(input) -> CatalogSnapshot
validateCatalog(snapshot) -> Diagnostics
resolveEntry(entry) -> Artifact
inspectArtifact(artifact) -> PackageInspection
install(artifact, target) -> InstallOperation
activate(installedPackage) -> RuntimeResult
```

Source Adapter 主要负责前两步，Artifact Resolver 负责制品定位，Runtime Adapter 负责安装后的加载和激活。

### 7.5 去重与冲突规则

必须定义：

- `packageId` 的规范化规则；
- 同 ID 多来源时的展示方式；
- 来源优先级；
- 同版本不同摘要的处理；
- 同插件多个 runtime 的选择；
- 旧 Extension 和 v2 插件同 ID 的冲突；
- 来源变化是否要求用户确认；
- 更新是否允许跨来源；
- 镜像摘要不一致时的处理。

默认安全策略应是：

```text
同 packageId + version + 不同摘要 = 冲突，不自动覆盖
来源变化 = 显式确认
可变 Git branch = 不作为生产安装依据
```

---

## 8. 安装事务与运行时生命周期

### 8.1 安装事务

标准流程：

```text
读取目录元数据
→ 确认用户选择和目标 scope
→ 检查 runtime、package format 和兼容性
→ 展示权限和风险
→ 用户确认高风险能力
→ 解析 artifact
→ 下载或 clone
→ 限制重定向和来源
→ 校验大小、文件数和摘要
→ 安全解包或复制到 staging
→ 校验 manifest/schema/入口/资源
→ 备份现有版本
→ 原子落盘
→ 写入 InstalledPackage
→ discovery
→ 试加载和兼容性检查
→ 根据用户选择激活
→ 写入最终状态
```

失败时：

- 删除 staging；
- 不破坏当前已安装版本；
- 恢复索引和安装记录；
- 保留可诊断的 operation 记录；
- 如果旧版本已备份，支持回滚；
- 不把“文件已落盘”返回为“插件可用”。

### 8.2 启用和停用

安装和启用必须是两个操作。

启用：

```text
检查已安装版本
→ 检查兼容性和权限
→ activating
→ 创建运行时上下文
→ 注册 capability
→ 更新消费者缓存
→ active / usable
```

停用：

```text
disabled request
→ draining
→ 阻止新调用
→ 等待或取消 in-flight 调用
→ unregister capability
→ dispose 监听器、定时器、子进程和资源
→ disabled
```

如果某种 contribution 不支持可靠的注销或资源释放，应返回 `disabled-pending-restart`，不能伪装成已完全停用。

### 8.3 更新和回滚

更新必须支持：

- 当前版本和目标版本对比；
- 权限变化预览；
- 来源变化确认；
- 依赖变化预览；
- 备份当前版本；
- 新版本 staging；
- 原子替换；
- 激活失败自动回滚；
- 用户主动回滚；
- 版本历史和摘要记录。

### 8.4 冷启动恢复

冷启动时：

1. 读取持久化安装状态；
2. 校验文件和索引一致性；
3. 清理中断的 staging/operation；
4. 按依赖拓扑排序；
5. 处理冲突和循环；
6. 恢复 scope；
7. 恢复 enabled 状态；
8. 激活插件；
9. 重建消费者索引；
10. 对失败项保留原始安装并报告恢复错误。

依赖循环不能简单忽略，应显示为不可激活并阻止相关插件进入 active。

---

## 9. Plugin Host 与真实消费者

### 9.1 消费者覆盖原则

每个可发布 contribution 都必须同时具备：

1. manifest 声明；
2. Host discovery；
3. runtime registration；
4. 真实生产消费者；
5. 启用后的可见性；
6. 实际调用或渲染；
7. 停用后的移除；
8. 冷启动恢复；
9. 自动化测试证据。

### 9.2 目标能力

#### Tools

验证：

- 工具进入工具索引；
- `tool_search` 或等效发现路径可见；
- 实际模型/Agent 调用成功；
- 权限和 destructive 标记生效；
- 停用后新调用被拒绝；
- 已开始调用按 drain 规则完成或取消。

#### Agents

验证：

- Agent 列表和选择器能发现；
- prompt、工具集和权限正确；
- 真实 Agent 入口可执行；
- 停用后不再被选择；
- 冷启动后恢复。

#### Skills

验证：

- Skill discovery 正确；
- Skill Tool 能返回正文；
- 资源根目录和可选资源正确；
- Python、`rg.files` 等资源扫描只针对真实路径；
- 内置 Skill 不把 `"<built-in>"` 当作文件系统 cwd。

对 `packages/novaway/src/tool/skill.ts` 的修复要求：

- 将正文内容和可选资源根目录拆开；
- 无资源的内置 Skill 跳过目录扫描和 requirements 检查；
- 仍正确返回正文和 base path 语义；
- 文件型插件 Skill 保留真实资源根目录行为。

#### Commands

验证：

- 命令被发现；
- 参数和权限正确；
- 执行入口真实可调用；
- 停用后不再出现在可用命令中。

#### Interceptors

验证：

- 注册顺序明确；
- 失败策略明确；
- 每轮调用不会重复注册；
- 停用后不再拦截；
- 监听器和资源被释放。

#### Surfaces

验证：

- 真实 UI slot 存在；
- renderer 不执行任意远程代码；
- 插件卸载后 slot 消失；
- 权限和来源信息可见。

#### Previewers

验证：

- 文件类型匹配；
- 预览入口真实执行；
- 不支持或高风险格式显示诊断；
- 停用后回退到默认 previewer。

#### Providers、Office、Super-Agent

这些能力需要分别建立消费者契约，不能只依靠通用 registry。Super-Agent 的 Trigger、Router、Thread、Worker、Channel 等能力必须在独立设计通过后再纳入生产贡献矩阵。

### 9.3 未接通能力的展示规则

如果某类能力只有 manifest 解析和注册，没有真实消费者，应显示：

```text
已声明 / 实验性 / 当前宿主不可用
```

不得显示：

```text
可用 / 推荐 / 已支持
```

---

## 10. 权限、安全和信任模型

### 10.1 不可信来源原则

所有第三方目录、Git 仓库、ZIP、release artifact 和镜像都视为不可信输入。

目录、下载和安装统一由内核服务执行，renderer 不直接抓取远端资源。

### 10.2 URL 与网络安全

必须校验：

- URL scheme，仅允许明确配置的 `https`、受控 `git` 等协议；
- hostname 和 IP 解析；
- 私网、回环、link-local 和云元数据地址；
- 重定向次数和最终 hostname；
- 跨来源重定向；
- 请求超时；
- 响应大小；
- 下载速度和总时长；
- 认证信息是否被转发到不可信域；
- 错误中是否泄露 token 或请求头。

### 10.3 制品安全

必须限制：

- 最大字节数；
- 最大文件数；
- 最大解包后总大小；
- 路径穿越；
- 绝对路径；
- 符号链接和硬链接；
- ZIP bomb；
- 重复文件名；
- 未声明的可执行入口；
- manifest 外的危险配置。

生产自有市场至少要求 SHA-256。签名体系可以分阶段上线，但目录中的摘要、制品摘要和镜像摘要必须一致。

### 10.4 权限模型

权限至少分为：

```text
read_workspace
write_workspace
read_user_files
write_user_files
network
execute_process
spawn_worker
access_secrets
register_ui
register_tool
register_provider
```

权限必须：

- 在目录详情中展示；
- 在安装前展示；
- 在权限变化时重新确认；
- 持久化用户授权；
- 绑定 packageId、版本或权限策略；
- 不因更新自动扩大权限；
- 在日志中可追踪但不泄露机密。

### 10.5 code/mixed 插件

code/mixed 插件进入独立安全门：

- 明确信任来源；
- 评估宿主进程内执行风险；
- 优先使用隔离进程或沙箱；
- 限制网络、文件和子进程；
- 处理异常和资源泄漏；
- 支持停用、终止和清理；
- 需要重启时真实展示；
- 生产源是否允许安装必须由信任策略决定。

在安全边界没有形成前，可以先完成 declarative 插件支持，但不能把 code/mixed 误标为普通低风险插件。

---

## 11. 存储、迁移和一致性

### 11.1 持久化内容

建议持久化：

- source 配置；
- catalog snapshot 元数据和缓存索引；
- installed package；
- 版本历史；
- operation 记录；
- permission grant；
- runtime enabled 状态；
- scope；
- artifact 和 manifest 摘要；
- 回滚备份信息；
- 失败诊断。

### 11.2 旧 Extension 迁移

迁移必须是显式、可回滚的：

1. 读取旧安装记录；
2. 映射到 `InstalledPackage` 的 legacy runtime；
3. 保留原安装目录和 loader；
4. 在统一 UI 展示 runtime=legacy；
5. 不自动将旧包写入 v2 目录；
6. 不因添加或删除源而卸载旧包；
7. 迁移失败时保留旧记录和旧文件；
8. 对同 ID 冲突提供诊断和选择。

### 11.3 并发和崩溃恢复

必须处理：

- 两个客户端同时安装同一个插件；
- 同一插件同时更新和停用；
- 安装过程中进程退出；
- 更新过程中进程退出；
- staging 残留；
- 文件被占用；
- 索引和目录不一致；
- 数据库写入成功但文件替换失败；
- 文件替换成功但状态写入失败。

安装操作需要锁、幂等键或等效机制。状态写入和文件操作必须有恢复策略。

---

## 12. HTTP API 与跨前端一致性

API 需要成为 Web、Desktop、TUI、CLI 的唯一事实来源。renderer 不得维护一份独立的安装和运行状态。

建议 API 分为：

### 源管理

```text
GET    /marketplace/sources
POST   /marketplace/sources
PATCH  /marketplace/sources/:sourceId
DELETE /marketplace/sources/:sourceId
POST   /marketplace/sources/:sourceId/test
POST   /marketplace/sources/:sourceId/refresh
```

### 目录查询

```text
GET /marketplace/catalog
GET /marketplace/catalog/:packageId
GET /marketplace/catalog/:packageId/versions
```

支持：

- query；
- category；
- source；
- runtime；
- capability；
- compatibility；
- featured；
- pagination；
- offline/cache mode。

### 安装和生命周期

```text
POST /marketplace/install
GET  /marketplace/operations/:operationId
POST /marketplace/packages/:packageId/enable
POST /marketplace/packages/:packageId/disable
POST /marketplace/packages/:packageId/update
POST /marketplace/packages/:packageId/rollback
POST /marketplace/packages/:packageId/uninstall
GET  /marketplace/installed
GET  /marketplace/installed/:packageId/diagnostics
```

API 返回的错误必须包含：

```text
errorCode
phase
packageId
runtime
operationId
userMessage
recoveryHint
```

不得泄露密钥、认证头、本地敏感目录或内部请求凭据。

---

## 13. UI 产品方案

### 13.1 市场主页

位于现有扩展市场页面基础上演进，包含：

- 页面标题；
- 精选 banner；
- 搜索框；
- 分类 chips；
- 来源筛选；
- runtime 筛选；
- 兼容性筛选；
- 精选、新品、全部内容；
- 响应式插件卡片；
- 图标、名称、作者、版本、摘要；
- 来源、协议、信任和兼容性标签；
- 安装、已安装、更新或不可用按钮。

### 13.2 添加插件源

弹窗或侧栏包含：

- 名称；
- URL；
- 类型：NovaWay、Claude、ZCode、自动识别；
- 连通性预检；
- 目录 schema 预览；
- 信任和安全说明；
- 保存、刷新、删除；
- 最后刷新时间；
- 离线/过期/失败状态；
- 源级错误诊断。

### 13.3 详情页

包含：

- 长描述；
- 图标和截图；
- 作者、主页、仓库、许可证；
- 版本和更新日志；
- runtime 和协议；
- contribution 列表；
- 宿主兼容范围；
- 权限、网络、文件和执行能力；
- 依赖和冲突；
- checksum/签名；
- 来源和信任信息；
- 安装目录；
- 版本历史；
- 已映射和未映射能力；
- 安装阶段与失败恢复说明。

### 13.4 已安装视图

显示：

- 运行时；
- scope；
- 当前版本；
- 来源；
- artifact/manifest 摘要；
- 安装、激活和消费者状态；
- 启用/停用；
- 更新；
- 重装；
- 回滚；
- 卸载；
- 重启要求；
- 诊断。

UI 不应显示虚假的“立即生效”。如果某能力确实只能重启，应明确显示原因。

### 13.5 国际化

覆盖：

- 源管理；
- 协议和 runtime；
- 权限；
- 安装阶段；
- 兼容性；
- 错误状态；
- 详情字段；
- 迁移和回滚；
- 离线缓存；
- 未映射能力。

复用现有 `AppIcon`、`Tag`、`Button`、loading、empty、toast 和 SDK API 模式。

---

## 14. Office 与内置技能路线

Office 作为长期产品子路线实施，不把 Office 的复杂依赖隐藏在通用插件市场之后。

### 14.1 内置 Skill 修复

修复 `packages/novaway/src/tool/skill.ts`：

- 内置 Skill 的正文内容与资源根目录分离；
- `"<built-in>"` 不再作为文件系统 cwd；
- 没有资源时跳过 Python requirements 和 `rg.files` 目录扫描；
- 有真实资源根目录的插件 Skill 保留目录枚举行为；
- Skill Tool 返回正确正文和 base path。

测试应覆盖：

- 无资源内置 Skill；
- 有资源内置 Skill；
- 文件型插件 Skill；
- 可选 Python 资源；
- 可选 PPT/Office 资源；
- 资源目录不存在；
- 资源目录权限失败。

### 14.2 Office 市场插件

首发 Office 插件优先以 Skills 和工具为内容，必须具备：

- 完整 `plugin.json`；
- Skill 正文；
- Agent prompt；
- 所需资源；
- 宿主 API 契约；
- 安装和实际消费测试。

不能声称替代现有 9 个内置 Office Agents，除非已经完成对应入口和回归。

### 14.3 PPT 插件

`office-ppt/SKILL.md` 如果依赖 `packages/app` 模板、NovaWay CLI 或脚本，必须：

1. 将依赖资源打包进插件并依赖稳定宿主 API；或
2. 明确标记为 NovaWay 原生集成，并在兼容性页面展示依赖。

在可移植资源和可编辑产物契约完成前，不标记为通用生产推荐。

---

## 15. 自有 GitHub 市场仓库与发布体系

### 15.0.1 已确定的官方仓库

官方公开插件市场仓库已经创建：

```text
https://github.com/NovaWay-AI/novaway-plugins.git
```

规划中的静态目录入口为：

```text
https://raw.githubusercontent.com/NovaWay-AI/novaway-plugins/main/catalog/index.json
```

GitHub Pages 目录地址待仓库启用 Pages 后再作为主入口配置，Raw 地址作为可用的备用入口。当前远端仓库为空，先在本地完成 schema、目录入口、仓库说明和 CI 骨架；未经单独确认不向远端推送。

### 15.0.2 推荐的仓库和发布设计

在 GitHub public 前提下，采用“**中央市场仓库 + 首方插件集中维护 + 后续允许独立插件仓库**”的混合方案：

1. 建立一个公开的中央市场仓库，例如 `novaway-plugins` 或 `novaway-marketplace`；
2. 中央仓库负责官方目录、schema、精选内容、首方插件、fixture、校验脚本和发布工作流；
3. 首批 NovaWay 官方插件先放在中央仓库的 `plugins/<package-id>/` 下，降低首期仓库和 CI 管理成本；
4. 后续第三方或需要独立发布节奏的插件可以放到独立 GitHub 仓库，中央目录只记录其 manifest、Release 和摘要；
5. NovaWay 客户端始终只接入中央目录，不直接搜索 GitHub，也不把 GitHub 仓库列表当作市场目录。

这样可以同时满足首期简单和长期扩展：首批办公插件只维护一个仓库即可完成发布；以后插件数量、维护者和权限边界扩大时，不需要更换客户端协议，只需在目录中增加独立 artifact 来源。

### 15.0.2 推荐的事实来源关系

不要手工维护多份完整插件元数据。建议采用以下事实来源规则：

```text
plugin.json                 插件运行时能力和权限的事实来源
插件目录/源码                首方插件实现的事实来源
GitHub Release artifact      可安装二进制/压缩包的事实来源
catalog/overrides            描述、精选、截图等编辑内容
catalog/index.json           CI 根据上述内容生成的市场索引
```

其中 `catalog/index.json` 应当是生成产物，不鼓励人工直接修改。CI 在 Pull Request 和发布时完成：

```text
读取 plugin.json
→ 校验 manifest/schema
→ 构建 artifact
→ 计算 SHA-256
→ 执行安装和真实消费者测试
→ 生成 catalog entry
→ 更新 index.json
→ 发布 GitHub Release asset
```

市场索引和运行时 manifest 可以有不同字段，但不应对 package ID、版本、runtime、capability 和权限产生冲突。目录需要展示的长描述、精选标记、截图和营销文案可以放在 `catalog/overrides/`，由 CI 合并到最终索引。

### 15.0.3 推荐的目录结构

```text
novaway-plugins/
├─ catalog/
│  ├─ schema/
│  │  ├─ catalog.schema.json
│  │  ├─ entry.schema.json
│  │  └─ manifest.schema.json
│  ├─ entries/
│  │  └─ <package-id>.json
│  ├─ overrides/
│  │  └─ <package-id>.json
│  ├─ channels/
│  │  ├─ stable.json
│  │  └─ beta.json
│  └─ index.json                 CI 生成的静态入口
├─ plugins/
│  └─ <package-id>/              首方插件源码和 manifest
│     ├─ plugin.json
│     ├─ README.md
│     ├─ LICENSE
│     ├─ CHANGELOG.md
│     ├─ skills/
│     ├─ agents/
│     ├─ commands/
│     └─ resources/
├─ fixtures/
├─ scripts/
└─ .github/workflows/
   ├─ validate.yml
   ├─ test-plugin.yml
   └─ publish-catalog.yml
```

`packageId` 必须稳定且与分类解耦，不要把可变化的 category 放进 ID。建议采用统一的小写、不可变格式，例如 `com.novaway.office-skills` 或既定的 NovaWay package ID 规范。版本、artifact 摘要和 runtime 必须是独立字段。

### 15.0.4 推荐的制品分发方式

生产安装优先使用 GitHub Release asset，不直接安装 `main` 分支目录：

```text
GitHub catalog/index.json
→ entry.artifact
→ GitHub Release tag
→ release asset
→ SHA-256 校验
→ NovaWay staging
```

推荐规则：

- 每个插件版本发布不可变 Release；
- artifact 文件名包含 package ID 和版本；
- Release asset 旁边发布 SHA-256 清单；
- catalog 记录 Release tag、asset name、size 和 SHA-256；
- Git 仓库目录或固定 commit 只作为开发安装或备用格式；
- 生产目录不允许依赖可变 branch；
- 同一个版本的不同下载端点必须产生相同摘要。

如果首方插件集中在市场仓库中，可以为每个插件使用独立的版本 tag 或 Release 标识，不要让一个市场仓库的整体版本成为所有插件的版本。后续迁移到独立插件仓库时，客户端不需要改变，只需改变 artifact 的 repository 和 release 定位。

### 15.0.5 推荐的官方源接入方式

公开 GitHub 市场不需要客户端 token。建议提供静态目录端点：

```text
主目录：GitHub Pages 静态地址
备用目录：raw.githubusercontent.com 地址
制品：GitHub Release asset
源码：GitHub repository URL
```

客户端不要依赖 GitHub API 搜索市场内容，以避免公开 API 的速率限制和不稳定性。GitHub API 只在必要的发布工具或可选的版本诊断中使用。

官方源应当作为默认源展示，但仍可被用户禁用；第三方源通过相同 Source Adapter 机制添加。官方源、第三方源和镜像必须在 UI 中清楚区分，不能因为都使用 GitHub 就显示为同一信任等级。

### 15.0.6 推荐的频道和版本策略

第一版只开放 `stable`，但从 schema 开始保留频道字段：

```text
stable   面向普通用户，必须通过完整安装和消费者验收
beta     经过自动化测试但可能有实验能力
nightly  开发验证，不保证兼容和回滚
```

默认只显示 stable。beta 和 nightly 需要用户主动开启，并且目录条目必须显示频道、风险和兼容性。

版本使用 SemVer 或项目统一版本规则，且：

- 已发布版本不可覆盖；
- 权限扩大必须触发重新确认；
- manifest 不兼容必须阻止安装或显示明确迁移路径；
- 更新失败自动恢复上一版本；
- catalog、manifest、artifact 和 Release tag 可相互验证。

NovaWay 插件市场采用“**独立 GitHub 市场仓库 + NovaWay 客户端接入**”的产品形态：

```text
独立 GitHub 插件市场仓库
  ├─ catalog/index.json              市场目录和版本索引
  ├─ catalog/schema/                 目录 schema
  ├─ plugins/<package-id>/           插件源码或发布描述
  ├─ releases / artifacts             可安装制品
  ├─ fixtures/                        测试插件和兼容样本
  └─ CI 发布工作流

NovaWay 主仓库
  ├─ Source Adapter                  读取 GitHub 市场目录
  ├─ Marketplace API                 代理目录、安装和状态
  ├─ Runtime Adapter                 安装到 NovaWay / legacy runtime
  ├─ Plugin Host                     发现、激活和注册插件
  └─ 市场 UI                         展示和管理插件
```

独立 GitHub 仓库是市场内容和发布版本的事实来源；当前 NovaWay 仓库不复制一份长期有效的插件目录，也不把市场插件源码作为客户端代码的一部分。NovaWay 仓库只负责：

- 配置或发现官方 GitHub 市场源；
- 拉取并缓存目录；
- 展示市场条目和兼容性；
- 根据目录中的 artifact 信息执行安全安装；
- 将安装结果交给对应 Runtime Adapter 和 Plugin Host；
- 反馈安装、运行、更新和卸载状态。

默认接入链路为：

```text
GitHub catalog/index.json
→ NovaWay GitHub Source Adapter
→ 统一 MarketEntry
→ 用户查看详情和权限
→ 解析 GitHub Release / archive / repository artifact
→ SHA-256 / signature / manifest 校验
→ staging 和原子安装
→ Plugin Host 或 Legacy Extension Loader
→ 真实消费者使用
```

目录和制品端点应分开配置：

- `catalogUrl` 指向 GitHub Raw、GitHub Pages 或等效目录端点；
- artifact URL 指向 GitHub Release asset、固定 commit 的仓库目录或其他明确发布端点；
- GitHub 仓库地址用于展示、源码查看和必要的固定 commit 解析；
- GitHub 镜像或 CDN 只能作为同一 artifact 的备用端点；
- 客户端必须比较所有端点的摘要，不能因为 URL 不同而产生第二个插件身份。

对于公共 GitHub 市场，客户端可以使用公开 Raw/Release URL。对于私有市场，访问令牌必须由现有安全凭据机制管理，不得保存到 renderer storage、目录文件或错误日志中。远程仓库创建、仓库可见性设置、Secrets 配置、推送和发布不属于客户端接入动作，必须单独确认后执行。

### 15.1 仓库结构

独立市场仓库建议包含：

```text
catalog/
  schema/
  index.json
  channels/
plugins/
  <package-id>/
    plugin.json
    README.md
    LICENSE
    CHANGELOG.md
    icon.*
    skills/
    agents/
    commands/
    resources/
fixtures/
scripts/
  validate-manifest.ts
  validate-catalog.ts
  verify-consumers.ts
  build-artifact.ts
  verify-artifact.ts
.github/workflows/
```

### 15.2 发布不可变性

生产版本一旦发布，不允许原地覆盖：

```text
plugin-id@1.2.0
```

修复必须生成新版本。目录、artifact、摘要和发布说明应可追踪。

### 15.3 CI 发布门禁

必须检查：

- manifest/schema；
- 包 ID 和版本；
- 目录重复项；
- 链接和仓库路径；
- 路径穿越和危险文件；
- 权限和高风险能力；
- 依赖许可；
- 可重现打包；
- SHA-256；
- 签名字段；
- 兼容性；
- 安装、启用、停用、卸载；
- 真实消费者覆盖；
- 本地 fixture E2E。

### 15.4 GitHub、Gitee 和 CDN 镜像

客户端支持：

- GitHub 官方源；
- 可配置 Gitee/CDN 镜像；
- artifact 多端点；
- 摘要一致性验证；
- 镜像失败回退；
- 离线缓存；
- 逐端点诊断。

镜像不能改变逻辑插件身份，也不能绕过摘要校验。

### 15.5 远端写操作

下列操作必须获得明确确认后才能执行：

- 创建远端仓库；
- 选择 owner/name；
- 设置 public/private；
- 配置 Secrets；
- 推送代码；
- 发布首个版本；
- 发布市场索引。

未确认前只能准备本地结构、fixture、CI 草稿和发布说明。

---

## 16. 长期阶段与工作流

### 阶段 0：现状基线与兼容矩阵

目标：形成可验证的架构基线，不急于重构。

工作：

- 检查当前未提交差异；
- 追踪发现→安装→解析→启用→注册→消费者→停用→重启恢复；
- 阅读 Host、loader、manifest、storage、runtime、Extension loader 和 HTTP handlers；
- 建立 contribution × runtime × producer/consumer 矩阵；
- 记录旧 Extension 迁移策略；
- 确认动态启停和 dispose 能力；
- 形成 `runtime-boundaries.md`、`contribution-matrix.md`、`install-state-model.md` 等证据。

退出条件：

- 所有关键链路有当前实现或缺口证据；
- 没有将未实现能力误列为已支持；
- 旧 Extension 和 v2 Plugin Host 的边界明确；
- 后续目录、安装和 UI 建模不再依赖猜测。

### 阶段 1：统一市场数据、源管理和缓存

工作：

- 建立领域对象；
- 实现源配置持久化和 API；
- 实现 NovaWay、Claude、ZCode Source Adapter；
- 版本化 NovaWay catalog schema；
- 目录缓存、刷新和离线展示；
- 搜索、分类、精选、分页和去重 DTO；
- 记录原始字段和可解释诊断。

退出条件：

- 三类目录都有真实样本和畸形样本测试；
- 源配置不依赖 renderer storage；
- 单源失败不影响其他源；
- 缓存和过期状态可展示；
- 同 ID、版本和摘要冲突规则明确。

### 阶段 2：统一安装事务和 Runtime Adapter

工作：

- 根据 package format 和 runtime 分流；
- 接入 v2 Plugin Host 安装目录、索引和 discovery；
- 接入旧 Extension installer；
- staging、摘要、manifest、权限和原子替换；
- 安装、启用、停用、更新、回滚、卸载；
- scope、enabled、安装顺序和权限审查；
- 安装操作和可恢复诊断；
- 冷启动恢复、依赖、冲突和循环。

退出条件：

- 安装失败不破坏旧版本；
- v2 市场安装确实被 Plugin Host 发现；
- 旧 Extension 仍由其兼容 loader 管理；
- 启用和安装状态分离；
- 运行时失败可以诊断和恢复。

### 阶段 3：真实消费者接线和 Office 基础修复

工作：

- Tools、Agents、Skills、Commands；
- Interceptors、Surfaces、Previewers；
- Providers、Office、Super-Agent 的独立消费者契约；
- 修复内置 Skill 的 `<built-in>` 路径问题；
- 增加真实 Tool/Skill/Agent 执行测试；
- 建立 capability coverage gate。

退出条件：

- 每个标记为可用的 contribution 有生产消费者；
- 停用能注销或准确展示重启要求；
- 冷启动能恢复；
- Office 插件不冒充已替代内置 Agent；
- 未接通能力被标记为实验或不可用。

### 阶段 4：完整市场 UI 和管理体验

工作：

- 市场主页；
- 添加插件源；
- 详情页；
- 已安装；
- 权限预览；
- 更新、回滚、重装、卸载；
- 错误态、空态、离线态；
- 多语言；
- 浏览器 E2E。

退出条件：

- UI 状态与 API/Host generation 一致；
- 搜索、分类、源管理和详情真实可用；
- 安装和停用不靠静态假状态；
- 关键错误可以操作性恢复；
- 完成 Web/Desktop/TUI 的共用 API 验证。

### 阶段 5：自有市场仓库和发布系统

工作：

- 独立市场仓库结构；
- 首批真实消费者覆盖的办公 Skills；
- schema、manifest、权限、许可、摘要和链接检查；
- 可重现打包；
- GitHub 官方源；
- Gitee/CDN 镜像；
- 发布和回滚说明；
- 远端操作确认流程。

退出条件：

- 本地发布 fixture 能完整安装和消费；
- CI 可以阻止不兼容或无消费者插件；
- 镜像摘要不一致会失败；
- 未经确认不发生远端写操作。

### 阶段 6：生产验收、回归与分阶段发布

工作：

- 单元、契约、运行时和 HTTP API 测试；
- 本地 fixture E2E；
- UI 浏览器验证；
- Office 回归；
- 安全门；
- 性能和泄漏检查；
- 逐步开放不同 runtime 和权限级别。

发布门：

```text
协议与消费者矩阵通过
→ NovaWay declarative 插件通过
→ 旧 Extension 兼容通过
→ 受限 Claude/ZCode 能力通过
→ Office 真实消费通过
→ code/mixed 安全评审通过
→ GitHub 市场和镜像上线
```

---

## 17. 测试策略

### 17.1 Source Adapter 测试

每个协议至少包含：

- 真实样本；
- 最小有效目录；
- 缺失字段；
- 错误类型；
- 重复 ID；
- 版本冲突；
- 不支持的能力；
- 错误 URL；
- 过期缓存；
- 部分条目损坏。

### 17.2 安全和安装测试

覆盖：

- URL scheme；
- SSRF；
- 重定向；
- 超时；
- 下载大小；
- 文件数；
- ZIP bomb；
- 路径穿越；
- 符号链接；
- checksum 不匹配；
- signature 不匹配；
- manifest 错误；
- staging 失败；
- 原子替换失败；
- 更新回滚；
- 卸载清理失败。

### 17.3 Runtime 测试

固定流程：

```text
安装
→ 发现
→ 验证兼容性
→ 启用
→ 消费者发现
→ 实际执行
→ 停用
→ 资源清理
→ 卸载
→ 冷启动恢复
```

覆盖：

- global scope；
- project scope；
- session scope；
- 依赖顺序；
- 冲突；
- 循环依赖；
- activation failure；
- dispose failure；
- in-flight 调用；
- 多客户端并发。

### 17.4 Office 回归

至少验证：

- 一个内置 Office Skill；
- 一个市场安装 Skill；
- Skill 正文；
- 可选资源枚举；
- Python/PPT 路由；
- 没有访问 `<built-in>` 占位目录；
- PPT fallback；
- 可编辑产物契约（仅在插件具备宿主链时）。

### 17.5 UI E2E

至少验证：

1. 添加 NovaWay 源；
2. 添加 Claude 源；
3. 添加 ZCode 源；
4. 源预检成功和失败；
5. 搜索和分类；
6. 详情和权限；
7. 安装进行中；
8. 安装成功；
9. 安装失败和恢复；
10. 启用和停用；
11. 更新和回滚；
12. 卸载；
13. 删除源但保留已安装包；
14. 离线缓存；
15. 空态、错误态和长文本布局。

测试使用本地可控 fixture，不把公网源作为唯一证据。

---

## 18. 性能、资源和可观测性

长期市场会频繁扫描、刷新和激活插件，需要关注：

- 目录刷新是否阻塞 UI；
- 大目录搜索是否需要索引；
- 列表是否需要分页或虚拟化；
- 插件 discovery 是否重复扫描；
- activation 是否重复注册；
- 停用是否释放 timer、listener、worker、child process 和 file handle；
- 更新是否暂时占用双倍磁盘空间；
- 缓存是否有上限和清理策略。

每次操作都应有结构化诊断：

```text
operationId
sourceId
packageId
version
runtime
scope
phase
status
duration
errorCode
recoveryHint
```

诊断必须脱敏，不能输出认证 token、完整私有 URL、密钥或敏感文件内容。

---

## 19. 版本兼容与发布策略

需要分别版本化：

```text
catalogSchemaVersion
manifestSchemaVersion
novaWayApiVersion
runtimeApiVersion
consumerCapabilityVersion
```

兼容性判断不能只比较 NovaWay 应用版本。目录条目应明确：

- 最低 NovaWay API；
- 最高已验证 NovaWay API；
- 所需 runtime；
- 所需 capability；
- 是否需要重启；
- 是否需要额外权限；
- 是否只支持某个前端形态。

版本升级时：

- 旧 manifest 应有迁移或明确错误；
- 新权限不能静默继承；
- 破坏性 capability 变更需要重新确认；
- 已发布 artifact 不可变；
- 回滚必须回到可验证的完整版本。

---

## 20. 最终验收标准

产品完整交付必须满足：

### 市场源

- 用户可以添加、验证、编辑、启用、禁用、刷新和移除源；
- 源配置跨 Web、Desktop、TUI 共用；
- 源刷新失败不破坏缓存；
- 不同源可以部分成功；
- 源诊断可操作；
- 删除源不会隐式卸载已安装插件。

### NovaWay 原生插件

- 通过版本化目录发现；
- 显示兼容性、权限、来源和摘要；
- 安装前确认目标 runtime 和能力；
- 下载、校验、解包和落盘有事务；
- 失败不破坏旧版本；
- Plugin Host 可以真实发现和激活；
- 真实消费者可以完成任务；
- 支持更新、停用、卸载和冷启动恢复。

### Claude/ZCode 兼容

- 只显示明确映射的能力；
- 未映射字段和原因透明可见；
- 不同 runtime 不互相伪装；
- 旧安装不被破坏；
- 兼容能力有自动化测试。

### 消费者

- 每个标记为可用的 contribution 有真实生产消费者；
- 有实际执行或渲染测试；
- 停用后不再被消费者使用；
- 资源、监听器和注册状态得到清理；
- 冷启动恢复行为已验证。

### Office

- 内置 Skill 不访问 `<built-in>` 占位目录；
- 真实 Skill Tool 回归通过；
- 市场 Office Skill 有完整资源和宿主契约；
- 未完成宿主链的 PPT 插件不会标记为通用生产推荐。

### UI

- 搜索、分类、精选、详情和已安装完整；
- 源管理完整；
- 安装、停用、更新、回滚和卸载状态真实；
- 权限、兼容性、来源和错误完整展示；
- 多语言完整；
- 关键流程经过浏览器验证。

### 发布

- 自有市场可独立发布；
- CI 阻止 schema、权限、摘要、链接和消费者覆盖问题；
- artifact 版本不可变；
- 镜像摘要一致；
- 未经明确确认不创建远端仓库、不推送、不发布。

---

## 21. 执行记录模板

每个阶段、子项目和发布门都应记录：

| 字段         | 内容                                     |
| ------------ | ---------------------------------------- |
| 状态         | 未开始 / 进行中 / 阻塞 / 已完成 / 已验证 |
| 范围         | 本次实际修改的模块和文件                 |
| 前置条件     | 已满足的依赖和门禁                       |
| 证据         | 测试、fixture、运行日志或浏览器验证      |
| 未验证项     | 尚未执行的测试或环境限制                 |
| 风险         | 安全、兼容、迁移、性能和回滚风险         |
| 用户修改保护 | 是否触及已有未提交修改                   |
| 进程约束     | 是否启动专用进程，是否未触碰现有进程     |
| 远端操作     | 是否涉及远端写操作及确认状态             |
| 下一步       | 可执行的后续任务                         |

只有有证据的“已完成”才能进入下一阶段的正式发布门。未验证内容必须明确标记为：

```text
未验证 / 环境受限 / 等待用户授权 / 后续阶段
```

---

---

## 21.1 当前执行状态（2026-11-16）

核心内核、安装事务、Plugin Host、真实 Skill consumer、跨客户端 durable operation、归档安全回归、官方 immutable Release 冷启动证据以及完整受控 Chromium UI 矩阵已经完成并通过对应测试。浏览器流程覆盖目录发现、官方源渲染、搜索/分类、详情/权限、NovaWay/Claude/ZCode 源添加、自定义源编辑/启停/刷新/删除、源预检成功/失败、安装中/安装成功、失败重试恢复、更新、回滚、卸载、删除源保留已安装包、离线缓存错误展示、独立空分类态、长文本不溢出以及 Installed 扩展启停。

SDK 生成和 workspace relink 也已按 `.github/workflows/plugin-marketplace.yml` 的顺序在本地 CI-equivalent gate 中验证通过：`bun packages/sdk/js/script/build.ts` → `bun install --frozen-lockfile` → App 生成 SDK 包含 `marketplaceOperations` → Chromium 门禁。路线第 20 节定义的市场源、原生插件、兼容层、消费者、Office 和 UI 验收项均已具备代码及测试证据；但该 CI job 尚未在外部远程 CI 环境运行，因此路线仍保持“本地完成、远程 CI 待验收”，不能标记为 fully stable。

验收报告见 `docs/plugin-marketplace-final-acceptance.md`。在外部远程 CI job 成功运行并保存可复核结果前，不得将本路线或市场标记为 fully stable，也不得声称没有剩余 acceptance gates。

## 22. 结论

NovaWay 插件市场应被作为一个长期平台产品建设，而不是一个独立的 UI 页面或下载器。完整路线的主线是：

```text
稳定领域模型
→ 多协议目录 Adapter
→ 多 runtime 安装 Adapter
→ 安全安装事务
→ Plugin Host 生命周期
→ 真实消费者接线
→ 跨前端统一 API
→ 市场 UI
→ 自有市场仓库和发布 CI
→ 可验证的生产发布门
```

长期目标可以全部保留，但必须始终坚持以下边界：

1. 市场目录不等于运行时能力；
2. 下载成功不等于安装成功；
3. 安装成功不等于激活成功；
4. 激活成功不等于消费者可用；
5. 解析兼容不等于运行时兼容；
6. UI 状态不应成为独立事实来源；
7. 旧 Extension、NovaWay v2、Claude 和 ZCode 必须通过明确 Adapter 分流；
8. code/mixed 和高权限能力必须经过独立安全门；
9. 每个“可用”能力都必须有真实生产消费者和自动化测试证据；
10. 未经确认不得执行远端创建、推送、发布或现有进程重启。
