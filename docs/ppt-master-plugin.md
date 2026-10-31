# PPT Master 扩展接入说明

这篇文档说明办公模式的 PPT 能力和 [ppt-master](https://github.com/hugohe3/ppt-master) 的关系：
为什么不做内置打包、怎么按需安装、装完之后 Python 依赖怎么准备、以及哪些地方做了适配。

## 结论

- **不内置打包。** ppt-master 的技能目录 54 MB、13051 个文件（其中 `templates/` 45 MB / 12193 个 SVG），
  仓库浅克隆约 142 MB，依赖还需要一套 Python 环境。把它塞进安装包和「瘦身」方向直接冲突。
- **应用装好之后自动装它。** 首次启动时内核会在后台调用
  `packages/novaway/src/extension/provision.ts`：清单来自
  `packages/core/src/builtin-extensions.ts`（市场 UI 共用同一份），联网就装，
  装完立刻刷新技能列表并准备 Python 环境 —— 用户不用点任何按钮。
  用户手动卸载过就记 `dismissed`，不会每次启动偷偷装回来。
- **做成可插拔扩展。** 插件市场的「NovaWay 内置」页里也保留了这一条，可以手动装 / 卸 / 重装。
  安装走的是和远程市场完全相同的流程（安装记录、可卸载、扩展加载器可见）；
  有 git 时浅克隆，没有 git 时自动改用 GitHub 归档下载（见 `docs/no-environment-installs.md`）。
- **依赖自动准备。** 装完扩展后内核会在后台建一个独立 venv 并安装 `requirements.txt` 里的依赖，
  不碰系统 Python；没有 Python 时下载 uv 并托管 CPython；进度写进后台任务，失败原因原样保留。
- **装了就用它。** 办公模式的 PPT 生成会先看 `<ppt_engine>`：
  - 已安装且 Python 环境就绪 → 走 ppt-master（SVG → DrawingML，坐标与字体逐对象落盘）；
  - 已安装但环境没备好 → 先调 `skill_python` 准备依赖，失败才降级并说明原因；
  - 没安装 → 走 `office-ppt` 自带的「HTML → 原生 PPTX」链路（同样是原生形状 + 可编辑文本框，
    但版式是按 DOM 近似还原），并提示用户可以在市场一键安装。
    这条判断由 `packages/novaway/src/office/ppt-engine.ts` 算出，写进技能输出的 `<ppt_engine>`，
    不让模型猜。

## 安装与运行

1. 正常情况下**什么都不用做**：NovaWay 启动后后台自动安装（见上面「自动装它」）。
   也可以手动在 插件选择器 → 市场 → `ppt-master` 点安装。
2. 安装完成后内核会立刻刷新技能列表（不用重启应用），随后准备环境：
   - 优先复用本机 Python（3.9+）；没有或太旧时下载 uv 并托管一个 CPython 3.12；
   - venv 位于 `<数据目录>/skill-python/ppt-master/venv`；
   - 网络类失败会换国内 PyPI 镜像重试；
   - 结果写到同目录的 `environment.json`。
3. 模型调用 `skill` 工具加载 `ppt-master` 时，工具输出末尾会带一段 `<python_environment>`，
   给出解释器绝对路径。第三方技能里写的 `python3 scripts/xxx.py` 在 Windows 上会踩到
   应用商店占位符，所以适配的重点就是**把正确解释器显式交给模型**。
4. 环境没准备好或装失败时，模型调用 `skill_python` 工具
   （`action=prepare, name="ppt-master"`）重试；失败原因会照实报给用户。
5. 启动时自动安装失败（断网、镜像都不可达）只会记日志，下次启动自动重试。
6. 官方仓库有新提交时，市场目录里这条会显示「有更新」并可一键更新：
   安装时记下提交哈希（浅克隆）或归档 ETag（没有 git 的机器），
   检测时用 `git ls-remote` / `If-None-Match` 对比，详见 `docs/no-environment-installs.md` 第 7 节。

## 相关代码

| 位置                                                                        | 作用                                                  |
| --------------------------------------------------------------------------- | ----------------------------------------------------- |
| `packages/core/src/builtin-extensions.ts`                                   | 内置条目清单（市场 UI 与启动自动安装共用）            |
| `packages/novaway/src/extension/provision.ts`                               | 启动后自动安装 + Python 环境补齐 + dismiss 记录       |
| `packages/novaway/src/extension/generation.ts`                              | 装完让扩展 / 技能缓存立即失效                         |
| `packages/app/src/constants/novaway-marketplace.ts`                         | 市场 UI 的内置条目视图（从 core 清单派生）            |
| `packages/app/src/components/office-plugin-market.tsx`                      | 插件选择器里的市场段，按 `kind` 区分 zip / git 安装   |
| `packages/app/src/components/settings-market-catalog.tsx`                   | 设置页市场目录的「NovaWay 内置」页签                  |
| `packages/novaway/src/python/venv.ts`                                       | 通用 Python 环境准备（探测 → uv → venv → pip → 验证） |
| `packages/novaway/src/skill/python-env.ts`                                  | 每个技能一个 venv、状态记录、给模型的解释器提示       |
| `packages/novaway/src/tool/skill-python.ts`                                 | `skill_python` 工具（status / prepare）               |
| `packages/novaway/src/server/routes/instance/httpapi/handlers/extension.ts` | 安装 / 卸载时刷新扩展与技能缓存、触发环境准备         |
| `packages/novaway/src/skill/prompt/office-ppt/SKILL.md`                     | 渲染链选择一节，写清何时用哪条链路                    |

## 适配点

- **路由对齐**：ppt-master 的 Image-to-PPTX、Beautify 两条路由补进了 `office-ppt` 的路由契约；
  其余三条（Generate / Fill Native PPTX / Create Template / Enhance）本来就有对应实现。
- **解释器**：不再让模型自己猜 `python3` / `python` / `py -3`，统一用 venv 里的解释器。
- **产物位置**：ppt-master 的输出统一落到 `.novaway/office/ppt/<标题>.pptx`，
  中间文件放 `.novaway/office/ppt-work/ppt-master/<deck-slug>/`，不污染正式产物目录。
- **质量门**：ppt-master 自带的 `attribution_guard.py` 和 LICENSE 原样保留；交付前仍要跑
  `office-ppt` 的页数 / 溢出 / 可编辑对象检查。
- **许可证**：ppt-master 是 MIT；其模板素材的许可随扩展一起安装，不随应用分发。

## 升级版本

内置条目的 `ref` 目前跟随 `main`。需要固定版本时改 `packages/core/src/builtin-extensions.ts`
里的 `ref` / `version`，重新打包即可（市场 UI 会自动同步）；已安装的条目在设置页市场里
可以卸载后重装。想暂时不自动装，设 `NOVAWAY_DISABLE_AUTOPROVISION=1`。
