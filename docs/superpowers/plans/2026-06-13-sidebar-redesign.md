# 侧边栏UI布局重新设计 实现计划

> **对于代理工作者：** 必须使用子技能：superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 来逐任务实现此计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**目标：** 重新设计侧边栏UI布局，移除独立的侧边项目栏，将项目功能集成到任务会话栏中。

**架构：** 采用渐进式重构，保留现有组件结构，主要修改UI层。修改`sidebar-shell.tsx`移除侧边项目栏，修改`sidebar-project.tsx`将项目图标变为可展开卡片，修改`layout.tsx`移除`SidebarPanel`组件。

**技术栈：** SolidJS, TypeScript, Tailwind CSS

---

## 文件结构

| 文件路径                                            | 职责                                          | 变更类型 |
| --------------------------------------------------- | --------------------------------------------- | -------- |
| `packages/app/src/pages/layout/sidebar-shell.tsx`   | 侧边栏容器，移除侧边项目栏渲染                | 修改     |
| `packages/app/src/pages/layout/sidebar-project.tsx` | 项目卡片组件，从图标变为可展开卡片            | 修改     |
| `packages/app/src/pages/layout.tsx`                 | 主布局，移除`SidebarPanel`，调整悬停/预览逻辑 | 修改     |
| `packages/app/src/pages/layout/sidebar-items.tsx`   | 会话项组件，可能需要样式微调                  | 可选修改 |
| `packages/app/src/index.css`                        | 全局样式，可能需要新增项目卡片样式            | 可选修改 |

---

## 任务1：移除侧边项目栏

**目标：** 修改`SidebarContent`组件，移除侧边项目栏渲染，只保留面板区域。

**文件：**

- 修改：`packages/app/src/pages/layout/sidebar-shell.tsx`

- [ ] **步骤1：分析当前SidebarContent组件结构**

当前组件结构：

```tsx
export const SidebarContent = (props: { ... }): JSX.Element => {
  return (
    <div class="flex h-full w-full min-w-0 overflow-hidden">
      {/* 侧边项目栏 - 需要移除 */}
      <div data-component="sidebar-rail" class="w-16 shrink-0 ...">
        <DragDropProvider ...>
          <SortableProvider ...>
            <For each={props.projects()}>{(project) => props.renderProject(project)}</For>
          </SortableProvider>
          {/* 打开项目和新建项目按钮 */}
          <HoverCard ...>
            ...
          </HoverCard>
        </DragDropProvider>
      </div>

      {/* 面板区域 - 需要保留 */}
      <div ref={panel} classList={{ "flex-1 flex h-full min-h-0 min-w-0 overflow-hidden": true, ... }}>
        {props.renderPanel()}
      </div>
    </div>
  )
}
```

- [ ] **步骤2：移除侧边项目栏渲染**

修改`sidebar-shell.tsx`，移除侧边项目栏（`data-component="sidebar-rail"`的div），只保留面板区域。

```tsx
export const SidebarContent = (props: {
  mobile?: boolean
  opened: Accessor<boolean>
  renderPanel: () => JSX.Element
}): JSX.Element => {
  const expanded = createMemo(() => !!props.mobile || props.opened())
  let panel: HTMLDivElement | undefined

  createEffect(() => {
    const el = panel
    if (!el) return
    if (expanded()) {
      el.removeAttribute("inert")
      return
    }
    el.setAttribute("inert", "")
  })

  return (
    <div class="flex h-full w-full min-w-0 overflow-hidden">
      <div
        ref={(el) => {
          panel = el
        }}
        classList={{ "flex-1 flex h-full min-h-0 min-w-0 overflow-hidden": true, "pointer-events-none": !expanded() }}
        aria-hidden={!expanded()}
      >
        {props.renderPanel()}
      </div>
    </div>
  )
}
```

- [ ] **步骤3：更新SidebarContent的调用方**

修改`layout.tsx`中调用`SidebarContent`的地方，移除不再需要的props：

```tsx
const sidebarContent = (mobile?: boolean) => (
  <SidebarContent
    mobile={mobile}
    opened={() => layout.sidebar.opened()}
    renderPanel={() =>
      mobile ? <SidebarPanel project={currentProject} mobile /> : <SidebarPanel project={currentProject} merged />
    }
  />
)
```

- [ ] **步骤4：运行类型检查**

Run: `cd packages/app && bun typecheck`
Expected: PASS

- [ ] **步骤5：提交更改**

```bash
git add packages/app/src/pages/layout/sidebar-shell.tsx packages/app/src/pages/layout.tsx
git commit -m "refactor(sidebar): remove sidebar rail, keep panel area only"
```

---

## 任务2：创建项目卡片组件

**目标：** 修改`SortableProject`组件，从图标变为可展开卡片，显示项目名称和路径。

**文件：**

- 修改：`packages/app/src/pages/layout/sidebar-project.tsx`

- [ ] **步骤1：分析当前ProjectTile组件**

当前组件是图标形式：

```tsx
const ProjectTile = (props: { ... }): JSX.Element => {
  return (
    <ContextMenu ...>
      <ContextMenu.Trigger
        as="button"
        classList={{
          "project-card flex items-center justify-center size-10 p-1 rounded-xl ...": true,
          ...
        }}
        ...
      >
        <ProjectIcon project={props.project} notify working={props.isWorking()} />
      </ContextMenu.Trigger>
      ...
    </ContextMenu>
  )
}
```

- [ ] **步骤2：创建ProjectCard组件**

在`sidebar-project.tsx`中添加新的`ProjectCard`组件：

```tsx
const ProjectCard = (props: {
  project: LocalProject
  mobile?: boolean
  selected: Accessor<boolean>
  isWorking: Accessor<boolean>
  expanded: Accessor<boolean>
  onToggleExpand: () => void
  navigateToProject: (directory: string) => void
  showEditProjectDialog: (project: LocalProject) => void
  closeProject: (directory: string) => void
  moveProjectToMode: (directory: string, mode: AppMode) => void
  workspacesEnabled: (project: LocalProject) => boolean
  toggleProjectWorkspaces: (project: LocalProject) => void
  language: ReturnType<typeof useLanguage>
}): JSX.Element => {
  const name = createMemo(() => props.project.name || getFilename(props.project.worktree))
  const path = createMemo(() => props.project.worktree)

  return (
    <div
      classList={{
        "flex flex-col p-2 rounded-lg border border-solid border-border-weak-base cursor-pointer transition-colors": true,
        "bg-surface-raised-base-hover": props.selected(),
        "bg-transparent hover:bg-surface-raised-base-hover": !props.selected(),
      }}
      onClick={() => props.navigateToProject(props.project.worktree)}
    >
      <div class="flex items-center gap-2">
        <div class="shrink-0 size-6 flex items-center justify-center">
          <Icon name="folder" size="small" class="text-icon-base" />
        </div>
        <span class="text-14-medium text-text-strong min-w-0 flex-1 truncate">{name()}</span>
        <button
          type="button"
          class="shrink-0 size-6 flex items-center justify-center rounded-md hover:bg-surface-base-active transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            props.onToggleExpand()
          }}
          aria-label={props.expanded() ? "折叠" : "展开"}
        >
          <Icon name={props.expanded() ? "chevron-down" : "chevron-right"} size="small" class="text-icon-base" />
        </button>
      </div>
      <span class="text-12-regular text-text-weak pl-8 truncate">{path()}</span>
    </div>
  )
}
```

- [ ] **步骤3：更新SortableProject使用ProjectCard**

修改`SortableProject`组件，使用新的`ProjectCard`替代`ProjectTile`：

```tsx
export const SortableProject = (props: {
  project: LocalProject
  mobile?: boolean
  ctx: ProjectSidebarContext
  sortNow: Accessor<number>
}): JSX.Element => {
  // ... 现有逻辑保持不变 ...

  const expanded = createMemo(() => {
    if (selected()) return true
    return props.ctx.workspaceExpanded(props.project.worktree, true)
  })

  const card = () => (
    <ProjectCard
      project={props.project}
      mobile={props.mobile}
      selected={selected}
      isWorking={isWorking}
      expanded={expanded}
      onToggleExpand={() => {
        props.ctx.setWorkspaceExpanded(props.project.worktree, !expanded())
      }}
      navigateToProject={props.ctx.navigateToProject}
      showEditProjectDialog={props.ctx.showEditProjectDialog}
      closeProject={props.ctx.closeProject}
      moveProjectToMode={props.ctx.moveProjectToMode}
      workspacesEnabled={props.ctx.workspacesEnabled}
      toggleProjectWorkspaces={props.ctx.toggleProjectWorkspaces}
      language={language}
    />
  )

  // ... 后续逻辑保持不变，但移除HoverCard预览 ...
}
```

- [ ] **步骤4：移除ProjectPreviewPanel组件**

删除`ProjectPreviewPanel`组件及其相关代码。

- [ ] **步骤5：运行类型检查**

Run: `cd packages/app && bun typecheck`
Expected: PASS

- [ ] **步骤6：提交更改**

```bash
git add packages/app/src/pages/layout/sidebar-project.tsx
git commit -m "feat(sidebar): replace project icon with expandable project card"
```

---

## 任务3：集成项目操作按钮

**目标：** 在侧边栏顶部添加"打开项目"和"新建项目"按钮。

**文件：**

- 修改：`packages/app/src/pages/layout.tsx`

- [ ] **步骤1：分析当前项目操作按钮位置**

当前按钮在`HoverCard`中：

```tsx
<HoverCard ...>
  <div class="flex flex-col gap-0.5 p-1">
    <button ... onClick={() => props.onOpenProject()}>
      <Icon name="folder-add-left" size="small" />
      <span class="flex-1">{props.openProjectLabel}</span>
    </button>
    <button ... onClick={() => props.onCreateProject()}>
      <Icon name="plus" size="small" />
      <span class="flex-1">{props.createProjectLabel}</span>
    </button>
  </div>
</HoverCard>
```

- [ ] **步骤2：在SidebarPanel中添加项目操作按钮**

修改`layout.tsx`中的`SidebarPanel`组件，在顶部添加项目操作按钮：

```tsx
const SidebarPanel = (panelProps: {
  project: Accessor<LocalProject | undefined>
  mobile?: boolean
  merged?: boolean
}) => {
  // ... 现有逻辑 ...

  return (
    <div classList={{ ... }}>
      {/* 项目操作按钮 */}
      <div class="shrink-0 py-3 px-1">
        <div class="flex gap-2">
          <Button
            size="large"
            icon="folder-add-left"
            variant="ghost"
            class="flex-1"
            onClick={chooseProject}
          >
            {language.t("command.project.open")}
          </Button>
          <Button
            size="large"
            icon="plus"
            variant="ghost"
            class="flex-1"
            onClick={createProject}
          >
            {language.t("command.project.create")}
          </Button>
        </div>
      </div>

      {/* 项目列表 */}
      <div class="flex-1 min-h-0 overflow-y-auto">
        <For each={projects()}>
          {(project) => (
            <SortableProject
              ctx={projectSidebarCtx}
              project={project}
              sortNow={sortNow}
              mobile={panelProps.mobile}
            />
          )}
        </For>
      </div>
    </div>
  )
}
```

- [ ] **步骤3：运行类型检查**

Run: `cd packages/app && bun typecheck`
Expected: PASS

- [ ] **步骤4：提交更改**

```bash
git add packages/app/src/pages/layout.tsx
git commit -m "feat(sidebar): add open/create project buttons at top"
```

---

## 任务4：调整布局逻辑

**目标：** 修改`layout.tsx`，移除悬停/预览相关逻辑，调整侧边栏宽度计算。

**文件：**

- 修改：`packages/app/src/pages/layout.tsx`

- [ ] **步骤1：移除hoverProject相关状态**

在`layout.tsx`中移除以下状态和逻辑：

```tsx
// 移除这些状态
const [state, setState] = createStore({
  // ...
  hoverProject: undefined as string | undefined,  // 移除
  // ...
})

// 移除这些函数
const setHoverProject = (value: string | undefined) => { ... }
const clearHoverProjectSoon = () => queueMicrotask(() => setHoverProject(undefined))

// 移除aim相关逻辑
const aim = createAim({ ... })
```

- [ ] **步骤2：移除peekProject相关逻辑**

```tsx
// 移除这些状态
const [state, setState] = createStore({
  // ...
  peek: undefined as string | undefined,  // 移除
  peeked: false,  // 移除
  // ...
})

// 移除这些计算属性
const hoverProjectData = createMemo(() => { ... })
const peekProject = createMemo(() => { ... })
```

- [ ] **步骤3：调整侧边栏宽度计算**

```tsx
const side = createMemo(() => Math.max(layout.sidebar.width(), 244))
const panel = createMemo(() => side()) // 移除 -64 计算
```

- [ ] **步骤4：移除悬停预览面板渲染**

```tsx
// 移除这些JSX
<Show when={modeSelected()}>
  <div class="hidden xl:block absolute inset-y-0 left-16 z-30" ...>
    <Show when={peekProject()}>
      <SidebarPanel project={peekProject} merged={false} />
    </Show>
  </div>
</Show>

// 移除阴影线
<Show when={modeSelected()}>
  <div class="hidden xl:block pointer-events-none absolute inset-y-0 right-0 z-25 ..." ...>
    <div class="h-full w-px" ... />
  </div>
</Show>
```

- [ ] **步骤5：更新projectSidebarCtx**

```tsx
const projectSidebarCtx: ProjectSidebarContext = {
  // ...
  // 移除悬停相关
  sidebarHovering: () => false,
  hoverProject: () => undefined,
  onProjectMouseEnter: () => {},
  onProjectMouseLeave: () => {},
  onProjectFocus: () => {},
  onHoverOpenChanged: () => {},
  // ...
}
```

- [ ] **步骤6：运行类型检查**

Run: `cd packages/app && bun typecheck`
Expected: PASS

- [ ] **步骤7：提交更改**

```bash
git add packages/app/src/pages/layout.tsx
git commit -m "refactor(sidebar): remove hover/peek preview logic"
```

---

## 任务5：调整CSS样式

**目标：** 可能需要添加或调整项目卡片相关样式。

**文件：**

- 可选修改：`packages/app/src/index.css`

- [ ] **步骤1：检查是否需要新增样式**

查看现有样式，确认是否需要为项目卡片添加新样式。

```bash
grep -n "project-card" packages/app/src/index.css
```

- [ ] **步骤2：添加项目卡片样式（如需要）**

```css
/* 项目卡片样式 */
.project-card {
  @apply flex flex-col p-2 rounded-lg border border-solid border-border-weak-base;
  @apply cursor-pointer transition-colors;
}

.project-card.selected {
  @apply bg-surface-raised-base-hover;
}

.project-card:not(.selected):hover {
  @apply bg-surface-raised-base-hover;
}
```

- [ ] **步骤3：运行类型检查和lint**

Run: `cd packages/app && bun typecheck && bun lint`
Expected: PASS

- [ ] **步骤4：提交更改**

```bash
git add packages/app/src/index.css
git commit -m "style(sidebar): add project card styles"
```

---

## 任务6：测试与验证

**目标：** 运行测试，验证功能正常。

**文件：**

- 测试：`packages/app/src/pages/layout.test.ts`（如存在）

- [ ] **步骤1：运行现有测试**

Run: `cd packages/app && bun test`
Expected: PASS

- [ ] **步骤2：手动测试功能**

1. 打开应用，确认侧边栏显示正常
2. 点击项目卡片，确认项目切换正常
3. 点击展开/折叠按钮，确认展开折叠正常
4. 拖拽项目卡片，确认排序正常
5. 右键点击项目，确认菜单正常
6. 点击"打开项目"和"新建项目"按钮，确认功能正常

- [ ] **步骤3：测试移动端布局**

1. 缩小窗口到移动端尺寸
2. 确认侧边栏显示为全屏抽屉
3. 确认所有功能正常

- [ ] **步骤4：最终提交**

```bash
git add -A
git commit -m "feat(sidebar): complete UI redesign, merge project and session panels"
```

---

## 验证清单

- [ ] 项目切换正常工作
- [ ] 项目拖拽排序正常工作
- [ ] 项目右键菜单正常工作
- [ ] 当前项目默认展开，其他项目默认折叠
- [ ] 会话列表显示正确
- [ ] 移动端布局正常
- [ ] 项目卡片显示项目名称和路径
- [ ] 当前项目有背景色区分
- [ ] 展开/折叠按钮显示正确
- [ ] 侧边栏宽度可拖拽调整
- [ ] 所有测试通过
- [ ] 类型检查通过
- [ ] Lint检查通过
