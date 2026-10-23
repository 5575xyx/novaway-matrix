# 知识库

本地优先的文档知识库：导入资料 → 混合检索 → AI 引用回答 → 可评测、可备份。

## 数据位置

```
~/.novaway/knowledge/
  collections/<collectionID>/
    collection.json          # 名称、描述、作用域、只读、开关
    eval.json                # 检索评测用例
    documents/<docID>.json   # 正文 + hash + 版本
    documents/<docID>.embedding.json   # 稠密向量缓存（按 hash 失效）
    documents/<docID>.graph.json       # LLM 图谱缓存（可选）
  sessions/<sessionID>.json  # 会话挂载的集合
```

整套目录可直接备份/迁移；集合也可以在 UI 里导出为 `.knowledge.json`。

「导入知识包」读取导出的 `.knowledge.json`，**新建一个集合**再恢复文档；
同名集合不会覆盖，会追加序号。适合团队分发只读资料包。

导出包带 `signature`（sha256 + 文档数）。导入时如果存在签名就先校验：
文档数不符或内容被改动会**整包拒绝**，不会导入一半。没有签名的旧包仍然可以导入。

## 支持的文件

| 类型                                           | 说明                                                   |
| ---------------------------------------------- | ------------------------------------------------------ |
| md / txt / json / csv / tsv / log / yaml / xml | 直接按文本索引                                         |
| html / htm                                     | 去标签后索引                                           |
| docx                                           | 段落 + 表格（表格还原成 markdown 表格）                |
| pptx                                           | 按页拼接文本                                           |
| xlsx                                           | 数字格式 / 合并单元格 / 真实表名（见下文 XLSX 细节）   |
| pdf                                            | 文本层 + ToUnicode CMap（中文 CID 字体）；扫描件走 OCR |
| png / jpg / jpeg / webp / bmp / tif / tiff     | OCR                                                    |

## 大文件导入

文件数超过 3 个、或总大小超过 2MB 时，前端自动改用**后台导入**：

- 立即返回 job id，面板顶部显示进度条与当前文件名
- 可随时「停止」，已完成的部分保留
- 结束（完成 / 失败 / 取消）后自动刷新文档列表与统计

接口：

- `POST /knowledge/collections/:id/import`，`background: true`
- `GET /knowledge/collections/:id/imports`：该集合的导入任务
- `GET /knowledge/imports/:jobID` / `DELETE /knowledge/imports/:jobID`

## 总览与最近查询

- `GET /knowledge/overview`：集合数、文档数、分片数、字符数
- `GET /knowledge/collections/:id/queries`：最近 20 条检索（相同查询去重置顶）
- `DELETE /knowledge/collections/:id/queries`：清空

界面上：顶部一行总览统计；搜索框为空时显示「最近」查询芯片，点一下直接重搜。

## 文档管理

- **筛选与分页**：按标题 / 来源过滤，按更新、创建、标题排序；每页 100 篇，底部「再加载」
- **批量操作**：勾选后可批量删除或移动到其它集合
  - 移动到只读集合会被拒绝
  - 目标集合已有同内容文档时按「重复」合并，源文档删除
  - 向量与图谱缓存跟着搬迁，不重新计算
- **分片预览**：文档详情里切到「分片」，看到与索引完全一致的切分结果，排查「为什么没检索到」时很有用

## 完整性与备份

- `GET /knowledge/integrity`：扫描孤儿向量/图谱缓存、坏 JSON、同集合重复内容
- `POST /knowledge/integrity/repair`：只清理孤儿缓存；其它问题只报告，不自动删数据
- `GET /knowledge/library/export` / `POST /knowledge/library/import`：**整个知识库**导出与导入
  - 导入按集合名合并：已存在则走版本更新，不存在则新建

## Agent 侧

`knowledge_search` 支持 `action: "list"`：返回集合名、id、文档数，
让模型先知道有哪些资料再决定搜哪里，避免瞎猜集合名。

## 检索

三路召回 + RRF 融合：

1. BM25（英文按词、中文按字 + 二元组）
2. 本地稀疏语义（n-gram 向量）
3. 稠密向量（`memory.embedding_*` 配置，自动降级）

返回前同一文档的多个分片会合并成一条，附带片段用于引用。

### XLSX 细节

抽取时按 `styles.xml` 的 numFmt 还原显示值，而不是直接输出底层数字：

| 情况                        | 之前                   | 现在                          |
| --------------------------- | ---------------------- | ----------------------------- |
| 日期 `45123`                | `45123`                | `2023-07-16`                  |
| 百分比 `0.152`              | `0.152`                | `15%`                         |
| 金额 `1234.5`（`#,##0.00`） | `1234.5`               | `1,234.50`                    |
| 合并单元格                  | 只有左上角有值，行错位 | 值铺满整个合并区域            |
| 工作表标题                  | `Sheet 1`              | `预算表`（来自 workbook.xml） |
| 布尔 / 错误                 | 空                     | `TRUE` / `FALSE` / `#DIV/0!`  |

同时支持 1904 日期系统（Mac 旧版 Excel）。单表最多索引 20000 行，超出会注明截断。

## 版面与引用定位

**PDF 双栏重排**：解析时会从 `Tm` / `Td` 取每行起始坐标，若行坐标明显分成两簇
（间隔 > 页面宽度 15%、两簇各占 ≥30% 的行）就判定为双栏，按「先左栏自上而下、
再右栏自上而下」输出；单栏保持原始顺序，不会被打乱。少于 8 个定位行时不做判断。

**精确引用**：每个切片都会记录它在原文中的起始偏移（`offset`），检索命中时一并返回。

UI 侧点击命中结果会打开「原文定位」视图：

1. 优先用 `offset` 在附近 ±64 字符的窗口里验证片段，命中即高亮并滚到视野中央；
2. offset 缺失或已过期（旧索引）时，退回「原样 → 去省略号 → 空白归一化」三级匹配；
3. 仍找不到就只展示原文，不做高亮。

Markdown 渲染会重排文本、无法映射源文偏移，所以定位视图用原始文本；
想看排版效果可切到「Markdown」标签。

## 回收站

删除文档默认进 `<collection>/trash/`，保留 **30 天**后自动清理：

| 接口                                                        | 说明                         |
| ----------------------------------------------------------- | ---------------------------- |
| `GET /knowledge/collections/:id/trash`                      | 列出回收站（顺带清理过期项） |
| `POST /knowledge/collections/:id/trash/:documentID/restore` | 恢复                         |
| `DELETE /knowledge/collections/:id/trash`                   | 清空                         |

需要立即彻底删除时传 `permanent: true`（重建索引、批量清理时用）。

## 索引与性能

检索索引**持久化**在集合目录下的 `index/`：

| 文件                  | 内容                                   |
| --------------------- | -------------------------------------- |
| `index/<docID>.json`  | 该文档的切片正文、词频（tf）、稀疏向量 |
| `index/manifest.json` | 集合签名 + 每篇文档的内容 hash         |

- 第一次检索后索引落盘；**重启进程不再重新分词**，只读缓存；
- 改动某篇文档时按 hash 比对，**只重建这一篇**；
- 索引只存**偏移 + 长度**，正文从原文切回来；稀疏向量只保留权重靠前的 48 项并量化到 4 位小数；
- 删除文档会同步清掉对应索引文件；`reindex` 会清空整个 `index/` 重算；
- 建索引时每 20 篇让出一次事件循环，不会整段卡住 HTTP 请求。

实测（2000 篇 × 约 4KB，9.5MB 语料）：

| 指标                       | 数值                         |
| -------------------------- | ---------------------------- |
| 建索引                     | 6.9 s                        |
| 重启后加载（命中缓存）     | 457 ms                       |
| 单次检索                   | 34 ms                        |
| 索引体积                   | 8.6 MB（原文的 **0.90 倍**） |
| 建索引期间最大事件循环阻塞 | 4 ms                         |

### 已知限制

以下场景会产出不完整文本（有 warning，但不会报错中断）：

- 加密 PDF（需要密码）；
- PDF 里的 JPEG2000（`JPXDecode`）图像；
- 跨行断字（英文单词被连字符拆到两行）；
- 跨行跨列的复杂表格（合并单元格只按行还原）；
- XLSX 超过 20000 行的部分会被截断。

多进程写入已用 `Flock` 做跨进程互斥（桌面端 + TUI + Web 同时写同一集合时不会丢更新），
但**索引缓存是进程内的**：另一个进程写入后，本进程要等集合签名变化才会重新加载。

批量导入在「文件数 > 3」或「总大小 > 2MB」时自动转后台任务，顶部显示进度条；
首个大文件解析期间进度条为流动动画（宽度未知时不假装有百分比）。

## OCR

优先级：**RapidOCR（PP-OCR ONNX）** → `tesseract` CLI → `tesseract.js`（WASM）→ 多模态模型。

```bash
NOVAWAY_OCR=auto|off|rapid|cli|wasm  # 默认 auto
NOVAWAY_OCR_LANGS=chi_sim+eng        # 默认简中 + 英文
NOVAWAY_OCR_PYTHON=/usr/bin/python3  # 指定解释器（默认 python / python3）
NOVAWAY_OCR_UV_URL=...               # uv 二进制下载地址（镜像）
NOVAWAY_OCR_PYTHON_MIRROR=...        # CPython 运行时镜像
NOVAWAY_OCR_PIP_INDEX=...            # PyPI 镜像
```

### RapidOCR（推荐，一键安装）

知识库右上角有一个 OCR 状态按钮：没装引擎时显示「一键安装 OCR」，点一下即可，全程无需命令行。

安装流程：

1. 优先复用本机 Python（`NOVAWAY_OCR_PYTHON` → 内置 venv → `python` / `python3` / `py -3`）；
2. 本机没有 Python 时，自动下载 [uv](https://github.com/astral-sh/uv)（约 30MB 单文件工具），
   由 uv 拉取托管的 CPython 3.12 并创建环境；
3. 依赖装进 NovaWay 数据目录下的 `ocr/venv`，不污染系统环境；
4. PyPI 官方源失败会自动切换清华镜像重试；
5. 安装进度、日志与失败建议都会实时显示在弹窗里，可随时取消。

前置条件只有网络；不需要用户自己装 Python，也不需要执行任何 `pip` 命令。
RapidOCR 自带 det/cls/rec 三件套 PP-OCR 模型，中英文识别明显强于 tesseract。

**让 AI 来装**：弹窗左下角有「让 AI 帮我装」。它会新建一个会话，把当前状态、错误和
安装日志交给 Agent；Agent 优先调用内置的 `knowledge_ocr` 工具（`action=install`）——
也就是上面这套安装逻辑，只是由 AI 决定何时重试、如何解释失败。工具也支持
`action=status` 查询当前后端。固定流程装不上（代理、自建 Python、权限受限等）时，
Agent 还可以回退到终端逐条排查，不用用户自己动手。

高级用法（可选）：

- 内网/镜像环境可设置 `NOVAWAY_OCR_UV_URL` 指向 uv 二进制、`NOVAWAY_OCR_PYTHON_MIRROR`
  指向 CPython 运行时镜像、`NOVAWAY_OCR_PIP_INDEX` 指向 PyPI 镜像；
- 想手动安装也可以：`pip install rapidocr_onnxruntime`（或新版 `pip install rapidocr`），
  后端会自动探测到；
- 没有 Python 时 Node 侧也可回退到 `@gutenye/ocr-node`（`npm i @gutenye/ocr-node`）；
- 两代 API 都兼容：`rapidocr_onnxruntime`（v1 元组返回）与 `rapidocr`（v2/v3 对象返回）；
- 识别结果按「先上后左」排序后再拼行，多栏截图不会串行。

想换成更重的 server 模型时，直接用 RapidOCR 自己的配置（`~/.rapidocr/config.yaml`）即可，
我们的调用方式不绑定具体模型文件。

扫描版 PDF 会直接抽取内嵌 JPEG 后 OCR，不需要 PDF 渲染器。

## 导入与更新

- 同一来源文件（文件名）重新导入 → **就地更新**，`version + 1`，旧向量/图谱缓存失效
- 同一集合内正文完全相同 → 跳过（duplicate）
- 批量导入一次最多 50 个文件、64MB

## 引用

`knowledge_search` 返回编号结果与 `citations`（文档、片段、分片序号）。
工具行里是可点击的来源芯片，点开可以：

- 查看渲染后的 Markdown
- 切到「原文定位」，把引用片段高亮并滚动到可见位置

## 会话挂载

每个会话可以挂载若干集合；`knowledge_search` 未指定集合时只检索挂载的集合。
挂载为空时回落到全部启用集合。

## 作用域与只读

- `global`：所有项目可见（默认）
- `project`：只在创建它的项目里可见
- `readOnly`：只拦截文档增删改；改名、作用域、删除集合仍是管理动作

## 图谱交互

- 悬停节点：高亮邻居，其余淡化
- 点击节点：在集合内按该实体检索，直接跳到结果

## 评测

「评测」页签保存「问题 → 期望命中的文档」，运行后给出：

- hit rate@k
- recall@k
- MRR
- 平均延迟

改切片大小、RRF 权重、图谱扩展前后各跑一次即可对比。

每次运行都会写入历史（保留最近 50 次），面板顶部有趋势折线：

- 实线：hit rate
- 虚线：MRR
- 右侧标出与**上一次同 k 运行**的差值（不同 k 不互相比较，避免误导）

### 报告导出

评测面板右上角「导出报告」会下载一份 Markdown：指标、与上次的差值、
用例级变化（变好/变差）与逐条排名。可直接贴进 PR 或周报。

### 运行对比

趋势图看整体，逐用例 diff 看细节：

- `GET /knowledge/collections/:id/eval/diff`
- 默认比较最近两次同 k 的运行，也可以传 `from` / `to` 指定
- 每条用例标为：变好 / 变差 / 仍命中 / 仍未命中 / 新增 / 已删除
- 概览行给出「较上次运行」的改善与回退数量

### 集合模板

新建集合时可以选模板（产品文档 / 运维手册 / 客服 FAQ / 数据字典 / 调研资料）。
模板只预填名称与描述；勾选「附带示例文档」时会额外写入一篇示例资料，
导入后可以立刻试检索（不需要示例时保持关闭，避免污染真实资料）。

新集合不知道该写什么用例时，点「生成用例」：会从文档标题（或文档里区分度最高的术语）
自动生成一批「问题 → 期望文档」并写入用例列表，导入完立刻就能跑出基线分。
已存在的用例不会被覆盖。

## LLM 图谱（可选）

```bash
NOVAWAY_KNOWLEDGE_LLM_GRAPH=1
```

开启后，导入文档会额外调用一次模型抽取实体与关系，写入 `documents/<docID>.graph.json`；
图谱与关联检索优先使用这些结果，失败自动回落到启发式抽取。

## 性能

- 集合级索引缓存（签名 = 集合 updatedAt + 文档数）
- 文档级分片缓存（key 带内容 hash，改一篇只重算一篇）
- 稠密向量落盘缓存，重启不重复 embedding
- 「重建索引」清空分片缓存与向量缓存后重算
