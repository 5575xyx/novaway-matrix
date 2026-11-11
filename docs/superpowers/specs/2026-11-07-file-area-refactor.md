# 文件树与右侧预览区按参照产品收敛

日期：2026-11-07 · 状态：实施中 · 参照：本地只读参照产品 v3.15.1 源码

## 目标

让 NovaWay 的工作区文件树和右侧文件预览逐步采用参照产品的职责边界与交互：文件树负责目录浏览/搜索/变更状态，预览容器负责文件头部和类型分发，各格式 renderer 负责格式专属展示。Office 的原生可编辑体验暂缓，之后作为单独编辑器能力接回。

## 已确认的参考实现

- `packages/ui/src/workspace-file-tree/WorkspaceFileTree.tsx` 编排树 UI；目录读取、watcher、Git 状态分离到 `useWorkspaceFileTreeData`，行/搜索/吸顶等继续拆分。
- `packages/ui/src/PreviewPane.tsx` 持有当前预览资源和刷新生命周期；`previewPaneContent.tsx` 负责按 source 类型分发到 Markdown、代码、图片、媒体、PDF、Office 等 renderer。
- 外部编辑器由平台服务提供，UI 不自行猜本机路径；远程路径必须经过 identity/session 匹配和平台适配。
- 参照产品普通 Office 预览只读。打开菜单启动系统关联应用不等于编辑回写；workflow artifact 的本机副本也不回写工作区。

## NovaWay 当前边界

- `workspace-files-store.ts` 是左侧变更列表与右侧文件树共用的数据层，当前实现集中目录缓存、Git 快照、watcher 订阅及 5 秒轮询兜底。
- `WorkspaceFileTree` 是轻量递归视图，尚无参照产品的搜索索引、虚拟列表、Git ignored/状态与远程 editor 选择等完整能力。
- `session-side-panel.tsx` 拥有右侧面板/分屏编排，并在文件树旁渲染 `FileTabContent`。
- `file-tabs.tsx` 目前同时承担标签路径解析、文件读取、打字机跟写、文本编辑/保存/冲突/历史、Office binary load/reload、PDF/图片/Office 预览及工具栏动作；本阶段不迁移读取与写入状态所有权。
- `office-file-preview.tsx` 当前分发 PDF、旧 Office、图片、DOCX、PPTX、XLSX，具体 renderer 仍携带编辑回调。

## 分阶段实施

### Phase 1：建立预览分发边界

将 `FileTabContent` 中与渲染有关的类型判断和 JSX 分发提取到独立 preview content 组件。宿主继续作为唯一的数据/编辑状态 owner，通过显式 props 传入文本、binary 预览、加载/错误状态及类型 renderer callbacks。保持现有 watcher、打字机、标签、分屏、保存/冲突、undo/redo 行为不变。

### Phase 2：对齐文件树交互

在不另建数据源的前提下，扩充现有 `createWorkspaceFiles` / `WorkspaceFileTree` 的树行语义、搜索、Git 状态/ignored、刷新和可访问性；是否引入虚拟列表以规模与依赖现状为依据。左侧最近打开/变更与右侧树继续复用同一个工作区数据所有者。

### Phase 3：暂缓 Office 内嵌编辑

先按只读预览对齐参照产品：隐藏 Office 专属编辑/保存/工具入口，但保留查看、翻页/缩放、导出及只读诊断等适用功能。已有 Office 编辑/写入实现在迁移期间保留源码，不删除、不自动执行；待新只读路径验证并获验收后再明确移除旧 UI 接线。原生应用打开只针对已证实本机可达的文件。

### Phase 4：独立恢复可编辑能力

将 Office 编辑器作为独立 editor capability 接回，明确格式支持、平台限制、唯一写入 owner、冲突/历史/watcher 事件顺序及保存验收；不得把打开外部应用等同于自动回写。

## 验收

- 文件树与左侧变更/最近打开仍共享同一工作区事实来源。
- 打开文件、切换标签、分屏、浏览器链接、文本实时跟写、Office/PDF/图片读取路径和外部修改冲突行为不回归。
- Phase 1 完成后渲染分发器不直接持有服务/写入副作用；读写状态仍只有宿主一个 owner。
- Office 暂时只读时 UI 不显示会误导用户的就地编辑/保存入口。
- 每阶段通过 app typecheck 与受影响的单测；UI 交互需在可用的现成运行实例中验收。未经用户同意不得启动、重载或终止既有桌面应用/服务；若无法使用现成实例，明确报告未完成运行时视觉验收。
