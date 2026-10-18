# 自我进化型 Agent 的常见做法与我们的取舍

日期：2026-10-18

## 结论先说

会。开启「自动写入进化文件」后，进化候选在通过校验时会直接落盘：

- `kind=skill` → `.novaway/skills/<target>/SKILL.md`（全局候选写入 `~/.config/novaway/skills/`）
- `kind=agent` → `.novaway/agents/<target>.md`
- `kind=workflow` / `prompt` → `.novaway/workflows|prompts/<target>.md`
- `kind=tool` → `.novaway/tools/<target>.ts`（可加载的插件工具模块）
- 其它（project / strategy / habit / knowledge）→ `.novaway/evolution/<target>.md`

关闭时只生成候选，等待人工在「设置 → 记忆与进化 → 进化」里确认。写盘后会自动做三步校验：
文件存在且内容一致 → 期望结果（expectedOutcomes）逐字命中 → 失败自动回滚并标记「待验证」。

## 其他 Agent 的做法

| 方案 | 进化对象 | 触发方式 | 人工确认 | 回滚/验证 |
| --- | --- | --- | --- | --- |
| Voyager (NVIDIA, 2023) | 可执行技能库（JS 代码） | 任务成功后自动写入技能库，下次检索复用 | 无（自动） | 环境执行成功才算数 |
| Reflexion (2023) | 语言化的「反思笔记」 | 每轮失败后写一条反思 | 无 | 只影响后续提示，不改代码 |
| ADAS / Meta Agent Search | 新 Agent 的代码 | 搜索循环里生成、评估、归档 | 无（有评估器） | 用基准分数做适应度 |
| Darwin Gödel Machine | 自身代码（可修改自身） | 自修改 + 基准评测 | 无 | 评测不过就淘汰 |
| SICA (Self-Improving Coding Agent) | 自身工具/提示 | 自编辑后跑基准 | 有限 | 版本归档、可回退 |
| Claude Agent Skills / ZCode Plugins | 技能包（SKILL.md + 脚本 + MCP） | 用户安装；部分平台按需加载 | 市场安装即确认 | 卸载即移除 |
| Cursor Rules / AGENTS.md | 项目约定文件 | 人工编写或由对话沉淀 | 人工 | git diff |

共同点：**低风险对象（记忆、反思笔记）自动写；高风险对象（代码、Agent 行为、系统提示）保留人工确认或评测门禁。**

## 我们的设计

1. **三层对象分开**：
   - 记忆（DB）：自动抽取、自动应用，错了删一条即可；
   - 进化候选（文件）：技能 / Agent / 工作流 / 提示词 / 工具，默认只生成候选；
   - 插件与扩展（技能+MCP 包）：显式安装、可卸载。
2. **写盘默认需要确认**：`auto_apply_file` 是显式开关，且只写 `.novaway/`（或全局配置目录）下的受控子目录，不碰项目源码。
3. **写盘后立刻验证**：内容一致性 + 期望结果命中，失败回滚。这相当于 Voyager 的「执行成功」门禁的轻量版。
4. **可追溯**：候选保留来源消息 id、kind、reason，设置页能看到「待审查 / 已应用 / 已忽略」。
5. **不做**：修改自身代码、无门禁地改系统提示、静默覆盖用户已有文件（同名 target 会被校验/回滚挡住）。

## 后续可补（按收益排序）

1. **按 kind 分级自动写盘**：技能/工作流可自动，Agent/提示词/工具仍需人工确认（目前是一个总开关）。
2. **重复候选聚类**：同一 factKey/target 的候选合并，避免周期性重复建议。
3. **评测门禁**：对 `kind=tool` 先做一次 dry-run 执行（沙箱、超时），成功才落盘。
4. **变更预览**：写盘前展示 unified diff（`preview` 已有，可在自动写盘时也记录到日志）。
