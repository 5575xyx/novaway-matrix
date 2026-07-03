# Superpowers 插件 Gitee 镜像方案规划

## 问题分析

### 当前状态

`superpowers` 插件是 NovaWay 的默认全局插件，配置在 [config.ts](file:///e:/AImoney/NovaWay-Matrix/novaway-coder/packages/opencode/src/config/config.ts#L48-L50) 中：

```typescript
export const DEFAULT_GLOBAL_PLUGINS: string[] = [
  "superpowers@git+https://github.com/obra/superpowers.git",
]
```

### 问题根因

1. **网络依赖**：插件通过 git URL 从 GitHub 拉取，中国大陆用户需要 VPN 才能访问
2. **安装流程**：插件安装走 `Npm.add` → `@npmcli/arborist` → git clone，无 fallback 机制
3. **错误处理**：安装失败虽不会导致启动崩溃（`Effect.forkDetach` 隔离），但用户无法正常使用该插件功能

### 数据流分析

```
首次启动
  ↓
loadGlobal() 写入配置文件 → plugin: ["superpowers@git+https://github.com/obra/superpowers.git"]
  ↓
Plugin.Service.init() 解析配置
  ↓
Npm.add("superpowers@git+https://github.com/obra/superpowers.git")
  ↓
arborist.reify() → git clone
  ↓
成功 → 插件可用
失败 → InstallFailedError → 插件不可用，启动继续
```

***

## 方案对比

| 方案                  | 优点           | 缺点       | 复杂度 |
| ------------------- | ------------ | -------- | --- |
| **A: Gitee 镜像**     | 国内访问快，无需 VPN | 需要维护镜像同步 | 低   |
| **B: 多镜像 Fallback** | 自动选择可用源，高可用  | 增加代码复杂度  | 中   |
| **C: 内置到应用包**       | 完全无需网络，体验最好  | 增大安装包体积  | 高   |

### 推荐方案

**方案 A + 方案 B 的混合方案**：

* 默认使用 Gitee 镜像作为主源

* 安装失败时自动尝试 GitHub 作为 fallback

* 失败时给出清晰的用户提示

***

## 实施计划

### Task 1: 修改默认插件 URL 为 Gitee 镜像

**文件**：`packages/opencode/src/config/config.ts`

**改动**：

1. 修改 `DEFAULT_GLOBAL_PLUGINS` 常量，将 GitHub URL 替换为 Gitee 镜像 URL
2. 添加注释说明镜像源和 fallback 策略

```typescript
// Default plugins seeded into the global config the first time it's created.
// Users can remove or override these entries in their own config file.
// Using Gitee mirror for better accessibility in China, GitHub as fallback.
export const DEFAULT_GLOBAL_PLUGINS: string[] = [
  "superpowers@git+https://gitee.com/novaway-ai/superpowers.git",
]

// Fallback plugin sources when primary source fails
export const FALLBACK_GLOBAL_PLUGINS: Record<string, string[]> = {
  superpowers: ["git+https://github.com/obra/superpowers.git"],
}
```

### Task 2: 实现多镜像 Fallback 机制

**文件**：`packages/core/src/npm.ts`

**改动**：

1. 在 `Npm.add` 函数中添加 fallback 逻辑
2. 当主源安装失败时，依次尝试 fallback 源
3. 记录安装成功/失败日志

### Task 3: 改进插件安装失败的用户提示

**文件**：`packages/opencode/src/plugin/plugin.ts`

**改动**：

1. 当插件安装失败时，输出友好的错误提示
2. 告知用户可以尝试手动安装或更换源
3. 提供 fallback 源的信息

### Task 4: 更新测试用例

**文件**：`packages/opencode/test/config/config.test.ts`

**改动**：

1. 更新现有测试用例中的 URL
2. 添加 fallback 机制的单元测试

### Task 5: 验证与打包

**验证步骤**：

1. 运行 lint 检查
2. 运行 typecheck
3. 运行 config 测试套件
4. 重新打包桌面端安装程序

***

## 风险评估

| 风险           | 概率 | 影响 | 缓解措施                    |
| ------------ | -- | -- | ----------------------- |
| Gitee 镜像同步延迟 | 中  | 中  | 设置自动同步流程，定期检查           |
| Gitee 仓库权限问题 | 低  | 高  | 使用公开仓库，设置合理权限           |
| 多镜像逻辑引入 bug  | 低  | 中  | 添加充分的单元测试               |
| 用户已有配置不更新    | 中  | 低  | 在 `loadGlobal` 中检测并提示用户 |

***

## Gitee 镜像准备步骤（需要用户操作）

1. 在 Gitee 创建账号或使用现有账号
2. 创建仓库 `superpowers`（建议命名为 `novaway-ai/superpowers`）
3. 从 GitHub 镜像代码：

   ```bash
   git clone --mirror https://github.com/obra/superpowers.git
   cd superpowers.git
   git push --mirror https://gitee.com/novaway-ai/superpowers.git
   ```
4. 设置自动同步（可选）：

   * 使用 Gitee 的镜像同步功能

   * 或使用 GitHub Actions 定期同步

***

## 预期效果

1. **国内用户**：无需 VPN 即可正常初始化插件
2. **国外用户**：若 Gitee 访问慢，自动 fallback 到 GitHub
3. **安装失败**：给出清晰的错误提示和解决建议

