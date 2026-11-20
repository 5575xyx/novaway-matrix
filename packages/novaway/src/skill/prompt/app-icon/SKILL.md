---
name: app-icon
description: "Use when the user wants to design, generate, or replace the NovaWay desktop application icon (任务栏/托盘/Dock 图标) from a text description. Trigger on 换图标、应用图标、生成图标、自定义图标、app icon、做个图标、桌面图标. Generates a safe SVG with a text model, rasterizes it to PNG, and saves it into the desktop icon library so it can be switched and reused in Settings → General."
---

# 应用图标生成（app-icon）

把「一句描述」变成一枚可直接使用的桌面应用图标，并落进桌面端的图标库，
用户在「设置 → 通用 → 应用图标与名称」里就能点选切换、反复复用。

## 什么时候用

- 用户说「帮我换个应用图标 / 生成一个图标 / 把图标改成……」。
- 用户给了风格描述（配色、主体图形、形状）想要一枚新图标。

不要用于：普通插图、海报、社交封面（那是 `office-design`）；也不要改项目里的业务代码。

## 硬规则

- 输出自包含的正方形 SVG，主体居中、单个符号，背景纯色或渐变。
- 不要文字；高对比，缩小到 16px 仍可辨认。
- 仅使用 `svg`、`rect`、`circle`、`ellipse`、`path`、`polygon`、`line`、`linearGradient`、`radialGradient`、`stop` 元素。
- 禁止脚本、事件属性、`style`、外部资源、`href`、`image`、`text`、滤镜、`foreignObject`、注释与实体声明。
- 一次只产出一枚主图标；用户要多个方案时才分别生成。

## 流程

1. 整理描述，补充「256x256、居中单符号、高对比、无文字、自包含 SVG」约束。
2. 使用可用文本模型生成 SVG 源码，不调用图像生成工具。
3. 桌面设置的生成入口会在主进程校验 SVG 白名单、栅格化为 PNG 并保存到图标库；用户也可在设置图标墙切换复用。
4. 告诉用户结果及如何在「设置 → 通用 → 应用图标与名称」中切换。

## 提示词模板

```
只输出单个自包含 SVG XML，不要 Markdown 代码围栏或解释。画布 256x256。
仅使用 svg、rect、circle、ellipse、path、polygon、line、linearGradient、radialGradient、stop 元素；
禁止文字、脚本、外部引用和滤镜。设计成简洁、高对比、无文字的应用图标。描述：<用户描述>
```
