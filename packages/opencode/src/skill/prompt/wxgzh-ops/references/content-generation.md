# 内容生成详细流程

## 表单状态结构

```typescript
type DraftState = {
  topic: string;        // 主题
  keyPoints: string;    // 核心要点（支持多行）
  audience: string;     // 目标人群（默认：泛用户）
  tone: string;         // 语气风格（默认：专业可信）
  length: 'short' | 'medium' | 'long';  // 篇幅
  cta: string;          // 行动引导
  article: ArticleResult | null;  // 生成的文章结果
};
```

## 篇幅映射

| 选项 | 字数要求 |
|------|----------|
| short | 约600字 |
| medium | 约1200字 |
| long | 约1800字 |

## Prompt 构建规则

构建用户提示词时，必须包含以下要素：
1. 主题
2. 核心要点
3. 目标人群
4. 语气风格
5. 篇幅要求
6. 行动引导
7. 补充要求（HTML 格式、配图计划等）

## 系统提示词

使用 `prompts/article-system.txt` 中的系统提示词，要求 AI 输出严格 JSON 格式。

## 文章结果解析

解析 AI 返回的 JSON 时，需要处理：
1. JSON 解析失败的情况
2. 字段缺失的情况
3. HTML 美化处理
4. 配图计划标准化

## 降级方案

当 AI 生成失败时，使用 `buildFallbackArticle()` 提供基础模板。