# 用 pnpm 装依赖并跑完整流程（bun 仍然保留）

仓库原来只支持 `bun install`。现在**两种包管理器都能走完整流程**：

- `bun install` + `bun run dev` —— 原来的路径，行为不变。
- `pnpm install` + `pnpm dev` —— 只需要装 pnpm，**开发机不需要预装 bun**。

第二条能成立，是因为根 `package.json` 的 `devDependencies` 里加了 `bun@1.3.14`（与
`packageManager` 字段一致）。`pnpm install` 会把 bun 的官方二进制装进
`node_modules/.bin/bun`，所有脚本里的 `bun ...` 都能通过 npm bin 目录解析到它。

## 一句话结论

| 环节                    | bun 用户 | 只有 pnpm 的用户 | 说明                                                          |
| ----------------------- | -------- | ---------------- | ------------------------------------------------------------- |
| 装依赖                  | ✅       | ✅               | 两套锁文件并存，见下                                          |
| 跑单测                  | ✅       | ✅               | 脚本内部调 `bun test`，bun 由 pnpm 装进来                     |
| 打 sidecar / 桌面安装包 | ✅       | ✅               | 同上；`Bun.build` 用的是 pnpm 装的 bun                        |
| TUI / 交互式 CLI        | ✅       | ✅               | 同上                                                          |
| Web / 渲染进程（vite）  | ✅       | ✅               | 本来就与包管理器无关                                          |

也就是说：**pnpm 用户不需要预装 bun，但 bun 仍然是构建与运行时的实际执行者** —— 它只是由
pnpm 装上，而不是由系统全局安装。这不是「脱离 bun」，是「bun 变成依赖」。

### 什么时候不成立

- `pnpm install --ignore-scripts`（CI 里那个 job 就是这么跑的）会跳过 `bun` 包的
  postinstall，`node_modules/.bin/bun` 不会被创建。CI 这步只做 tsgo 类型检查，bun 走
  `setup-bun` action，所以没问题；本地想用 pnpm 跑全流程，必须**不加** `--ignore-scripts`。
- `bun` 的 postinstall 优先从 `@oven/bun-<platform>` 这个 optionalDependency 复制二进制；
  只有缺失时才会去 `registry.npmjs.org` / `bun.com` 下载。镜像源正常就能装上。
- 磁盘上会多一个约 98 MB 的 bun 二进制。

## 用法

```bash
pnpm install                 # 装整个工作区，同时装好 bun
pnpm dev                     # 等价于 bun run dev
pnpm --filter novaway test    # 脚本内部调 bun test

pnpm install --frozen-lockfile   # CI：锁文件与 package.json 必须一致
```

装完以后所有 `bun ...` 命令照常可用，`node_modules` 布局和 bun 装出来的一致（见下）。

pnpm 每条命令都会打一句 `WARN This project is configured to use bun` —— 这是它在提示
`packageManager` 字段写的是 bun，属预期现象（这个字段 CI 和 setup-bun 还要用，不能改）。

## 为什么能兼容：两套配置怎么对齐

bun 的配置分散在三个文件里，pnpm 只认 `pnpm-workspace.yaml`。与其手抄两份、迟早漂移，
不如**用脚本从 bun 的配置生成 pnpm 的配置**：

| bun 侧（真源）                                     | pnpm 侧（生成物）                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `package.json` → `workspaces.packages`             | `pnpm-workspace.yaml` → `packages`                                                  |
| `package.json` → `workspaces.catalog`（61 条）     | `pnpm-workspace.yaml` → `catalog`                                                   |
| `package.json` → `trustedDependencies`             | `pnpm-workspace.yaml` → `onlyBuiltDependencies`                                     |
| `package.json` → `patchedDependencies`             | `pnpm-workspace.yaml` → `patchedDependencies`（同一批补丁文件）                     |
| `package.json` → `overrides`                       | `pnpm-workspace.yaml` → `overrides`（`catalog:` 展开成具体版本，pnpm 不认这个协议） |
| `bunfig.toml` → `exact = true`                     | `.npmrc` → `save-exact=true`                                                        |
| `bunfig.toml` → `minimumReleaseAge = 259200`（秒） | `pnpm-workspace.yaml` → `minimumReleaseAge: 4320`（分钟）                           |

改完版本 / 加依赖之后：

```bash
node script/sync-pnpm-workspace.mjs          # 重新生成 pnpm-workspace.yaml
node script/sync-pnpm-workspace.mjs --check  # CI 里校验是否已过期（过期直接失败）
```

**不要手改 `pnpm-workspace.yaml`** —— 它每次生成都会被整体覆盖。

## 需要知道的四个坑（都已处理）

1. **`packageManager` 字段是 bun**。pnpm 默认会拒绝在 `packageManager: bun@...` 的仓库里运行，
   报 `This project is configured to use bun`。`.npmrc` 里加了 `package-manager-strict=false`。
   CI 里 `setup-bun` 仍然靠这个字段取 bun 版本，所以字段本身不能改。
2. **补丁文件必须是 LF**。原来的 `patches/*.patch` 是 Windows 上 `core.autocrlf=true` 转出来的 CRLF，
   bun 能容忍，pnpm 的补丁器按字节比对上下文，直接报 `ERR_PNPM_PATCH_FAILED`。
   现在新增的 `.gitattributes` 把 `patches/*.patch` 钉成 `eol=lf`，并已把现有补丁转成 LF。
   `@silvia-odwyer/photon-node` 那条补丁还额外按 LF 基线重新生成过（旧补丁的行号是按 CRLF 文件算的，
   第 10 个 hunk 在 pnpm 下对不上）。改过的补丁在 bun / pnpm 两边都验证过能打上。
3. **`node_modules` 布局**。`.npmrc` 里 `node-linker=hoisted`，与 bun 的扁平结构一致 ——
   这个仓库有不少跨包隐式依赖，换安装器不该顺手把构建弄坏。想验证 pnpm 的严格模式可以临时用
   `pnpm install --config.node-linker=isolated`，但默认不这么跑。
4. **peer 依赖**。bun 不校验 peer，pnpm 默认报错；`.npmrc` 里 `strict-peer-dependencies=false` 对齐 bun 行为
   （`solid-js 1.9.10` vs `@opentui/*` 要求的 `1.9.12` 这类告警仍然会打印，但不阻断）。

另外两个补丁（`@npmcli/agent@4.0.0`、`@standard-community/standard-openapi@0.2.9`）原本是按"安装时解析到的版本"
打补丁的。pnpm 重新解析时会拿到更新的 `4.0.2` / `0.2.11`，补丁就静默失效了。所以这两个版本被显式写进根
`package.json` 的 `overrides` 钉住，和 `bun.lock` 里已有的版本一致 —— 对 bun 没有任何行为变化。

## 为什么不用 npm

npm 缺三样东西，改造成本比 pnpm 高得多：

- **不支持 `catalog:`**：220 处依赖版本要内联成具体版本，`package.json` 从此变成两份真源。
- **不支持 `workspace:` 协议**：36 处 `workspace:*` 要改成 `file:` 或版本号。
- **不支持 `patchedDependencies`**：得引入 `patch-package` + 改补丁文件名 + 串进 postinstall，
  而且它只在 postinstall 后生效，不是真正的安装期补丁。
- 另外没有 `minimumReleaseAge`（新版本冷却）这种能力。

## 已知限制

- **`@solidjs/start` 来自 pkg.pr.new**（`https://pkg.pr.new/@solidjs/start@dfb2020`，一个 PR 预览构建，
  不是 npm 上的正式版本）。这个域名在国内网络经常连不上：bun / pnpm 都一样装不下来。
  pnpm 额外要求锁文件里带 tarball 的 `integrity`，否则直接拒绝安装（`ERR_PNPM_MISSING_TARBALL_INTEGRITY`）——
  这里已经把 `bun.lock` 里记录的 sha512 补进 `pnpm-lock.yaml`，所以锁文件本身是合法的；
  真正卡住的是下载这一步。备用方案：能访问 pkg.pr.new 的网络，或把它换成 npm 上的正式版本。
- **`.husky/pre-push` 调用 `bun`**：它会校验 `packageManager` 里的 bun 版本并跑 `bun typecheck`。
  现在 bun 是 devDependency，`pnpm install` 之后这条 hook 可以直接跑通，不需要系统级 bun；
  `packageManager` 字段里的版本和 `devDependencies.bun` 一样是 `1.3.14`，校验会通过。

## 两个锁文件

- `bun.lock` —— bun 用，保持不变。
- `pnpm-lock.yaml` —— pnpm 用，由 pnpm 生成。

改依赖时两个都要刷新（`bun install` + `pnpm install`），否则 CI 里 `--frozen-lockfile` 会失败。
`pnpm install --frozen-lockfile` 这一步在 `.github/workflows/test.yml` 的 `pnpm` job 里跑，
顺便用 `script/sync-pnpm-workspace.mjs --check` 拦住配置漂移。

## 验证过的事

- `pnpm install --lockfile-only --frozen-lockfile`：锁文件自洽（2758 个包解析成功）。
- 五个补丁在临时工作区里分别用 **pnpm** 和 **bun** 实际安装：两边都能打上，改后的文件内容一致。
- `package-manager-strict=false`、`save-exact`、`onlyBuiltDependencies` 等都生效。
- 在一个只含 22 个 `package.json` 的骨架工作区里跑通了真实安装（`--frozen-lockfile`，2642 个包）：
  `@npmcli/agent`、`solid-js` 的补丁确实打进了结果文件，`node_modules` 是扁平布局（与 bun 一致）。
  整仓安装的最后一环卡在 pkg.pr.new 下载（见上文已知限制）。
