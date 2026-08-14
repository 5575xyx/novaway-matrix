# SenseNova HTML 到 PPTX 导出器声明

本目录包含从 SenseNova-Skills 项目中提取并修改的 HTML 到 PPTX 导出组件。

- 上游项目：`https://github.com/SenseTime-FVG/Open-SenseNova-Skills`
- 上游提交：`24abfbb1eb5168027be74ecc18f2e5ac55890f5d`
- 上游目录：`skills/sn-ppt-standard/scripts/export_pptx/lib/`
- 许可证：MIT，见同目录 `LICENSE`

NovaWay 的修改：

1. 使用仓库已有的 `playwright-core`，不在运行时执行 `npm install` 或下载 Chromium。
2. 默认使用本机 Chrome 通道进行无界面渲染，可通过 `NOVAWAY_PPT_BROWSER_CHANNEL` 覆盖。
3. 由 NovaWay 内部 CLI 负责输入校验、质量报告和产物路径，不使用上游的独立 CLI 守卫。
4. 仅保留 HTML DOM 提取、PptxGenJS 构建、图表映射、样式解析和 OOXML 后处理模块。
