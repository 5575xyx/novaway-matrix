# 创作中心数据页与指标

## 各平台数据入口（先登录，再用 webview_*）

| 平台 | 地址 | 取什么 |
| --- | --- | --- |
| 抖音 | `https://creator.douyin.com/creator-micro/data/content` | 播放、完播、点赞、评论、分享、涨粉 |
| 小红书 | `https://creator.xiaohongshu.com/creator/notemanage` | 曝光、阅读、点赞、收藏、评论、涨粉 |
| 视频号 | `https://channels.weixin.qq.com/platform/post/list` | 播放、完播、互动、关注 |
| 快手 | `https://cp.kuaishou.com/profile` | 播放、互动、粉丝 |
| B站 | `https://member.bilibili.com/platform/home` | 播放、弹幕、评论、收藏、粉丝 |
| 公众号 | `https://mp.weixin.qq.com` → 内容与互动 → 已发表 | 阅读、分享、在看、涨粉 |

页面会改版，下面的脚本选择器只是起点；取不到时用 `webview_screenshot` 看结构，
再用 `webview_script` 量新选择器，**不要反复盲试**。

## 通用取数脚本

```js
(() => {
  const rows = Array.from(document.querySelectorAll("tr, [class*='item'], [class*='card'], [class*='row']"))
    .slice(0, 40)
    .map((node) => (node.innerText || "").replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 8)
  return { url: location.href, title: document.title, rows }
})()
```

## 派生指标

| 指标 | 公式 | 看什么 |
| --- | --- | --- |
| 完播率 | 完播数 / 播放数 | 开头与节奏 |
| 互动率 | (点赞 + 评论 + 收藏 + 分享) / 播放 | 内容是否值得回应 |
| 收藏率 | 收藏 / 播放 | 实用价值（小红书尤其重要） |
| 关注转化 | 新增关注 / 播放 | 账号人设是否成立 |
| 涨粉率 | 新增关注 / 期初粉丝 | 周期增长 |
| 单条效率 | 播放 / 发布条数 | 产能是否有效 |

## 基线怎么取

- 用**同账号最近 10-20 条**的中位数做基线（平均会被爆款拉偏）；
- 样本少于 5 条时不下结论，只说「样本不足」；
- 跨平台不比较绝对数，只比较趋势方向。

## 记录模板

每次复盘留一行，便于下次对比：

| 日期 | 条数 | 播放中位数 | 互动率 | 涨粉 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 2026-11-05 | 12 | 3.2 万 | 4.1% | +86 | 露营装备系列有效 |
