# 会话临时文件清理

AI 在任务中经常写一次性脚本（`tmp-*.mjs`、`debug-*.ts`、`scratch/` 下的输出）。
这些文件不进 Git，也容易被忘记，越积越多。

## 追踪规则

只有**工具新建**且**名字明确像临时文件**的路径会被记录：

- 位于 `tmp/`、`temp/`、`.tmp/`、`scratch/` 目录下
- 文件名以 `tmp-` / `temp-` / `scratch-` / `debug-` 开头
- 扩展名 `.tmp` / `.bak` / `.orig` / `.rej` / `.swp`，或以 `~` 结尾

`src/app.ts`、`README.md`、`templates/index.html`、`node_modules/**` 一律不记录。
清单存在 `~/.novaway/temp-files/<sessionID>.json`，不写工作区。

## 自动清理

会话空闲（一轮任务结束）时自动触发，条件：

1. 文件创建已满 30 秒
2. 内容 hash 与记录时一致（被改过就跳过）
3. 仍符合上面的临时文件命名规则

删除后只清理变空的临时目录；失败不影响主流程。

## 手动清理

- 模型可以用 `cleanup_temp_files` 工具列出/清理
- 右上角状态面板的「临时文件」卡片支持单条删除与全部清理
- API：`GET /session/:id/temp-files`、`POST /session/:id/temp-files/clean`
