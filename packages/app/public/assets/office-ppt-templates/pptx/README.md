# NovaWay 真实 PPTX 模板包

本目录包含 20 套真实、可编辑的 `.pptx` 模板。每套模板都有：

- `template.pptx`：PowerPoint 原生可编辑模板文件。
- `preview/cover.jpg`、`preview/overview.jpg`、`preview/content.jpg`、`preview/cards.jpg`、`preview/data.jpg`、`preview/closing.jpg`：由 PowerPoint 直接从 `template.pptx` 导出的真实页面预览。

模板通过开源库 `pptxgenjs` 生成，生成脚本位于 `packages/novaway/script/generate-real-ppt-templates.mjs`，预览渲染脚本位于 `script/render-real-ppt-previews.ps1`。

这 20 套不是同一套版式换色。每套模板拥有独立的封面、目录、内容、卡片、数据和收尾组合；当前版式签名覆盖：封面 11 种、目录 10 种、内容 9 种、卡片 14 种、数据 7 种、收尾 7 种。

当前 20 套中有 13 套数据页包含 PowerPoint 原生图表，另有表格页、KPI 页和蓝图页；导出时如果模板缺少表格或图表槽位，填充器会自动创建原生表格或原生图表。

原 Presenton 8 套也已由 `script/build-presenton-pptx-templates.mjs` 转成真实 PPTX，位于 `packages/app/public/assets/office-ppt-templates/presenton-pptx/<id>/template.pptx`，同样由 PowerPoint 渲染真实预览。

模板原始设计属于 NovaWay 项目，遵循项目 MIT 许可证。`pptxgenjs` 自身遵循 MIT License；重新分发时请保留本说明及对应开源许可信息。

导出 PPT 时，前端会下载选中模板的 `template.pptx`，克隆模板页面并替换用户标题、正文、表格、图片、原生图表、演讲备注和页面转场，保留模板的母版、主题、版式、形状和媒体资源。
