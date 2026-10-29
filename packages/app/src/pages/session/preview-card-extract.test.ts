import { describe, expect, test } from "bun:test"
import {
  buildPreviewCardCandidates,
  cleanPreviewPathCandidate,
  extractAnswerFileReferences,
  extractAnswerWebsites,
  projectCitationText,
} from "./preview-card-extract"

const WS = "E:/proj"

describe("cleanPreviewPathCandidate", () => {
  test("剥尾部标点与行列后缀", () => {
    expect(cleanPreviewPathCandidate("报告.docx。")).toBe("报告.docx")
    expect(cleanPreviewPathCandidate("report.pdf:12:34,")).toBe("report.pdf")
    expect(cleanPreviewPathCandidate(" a.md ")).toBe("a.md")
  })
})

describe("extractAnswerFileReferences", () => {
  test("裸路径:中英文标点边界", () => {
    const refs = extractAnswerFileReferences("报告在 .claude/order-demo/reconciliation-report.html，请查收", WS)
    expect(refs).toHaveLength(1)
    expect(refs[0]?.kind).toBe("html")
    expect(refs[0]?.path).toBe("E:/proj/.claude/order-demo/reconciliation-report.html")
  })

  test("markdown 链接占用保护区间,内部路径不再被裸路径层捞出", () => {
    const refs = extractAnswerFileReferences("见 [对账报告](.claude/a.html) 以及 .claude/b.docx", WS)
    expect(refs).toHaveLength(2)
    expect(refs[0]?.source).toBe("markdown")
    expect(refs[1]?.source).toBe("bare")
  })

  test("引号定界路径(中英文引号)", () => {
    const refs = extractAnswerFileReferences("产物是 `.claude/demo.pptx` 和 “.claude/b.xlsx”", WS)
    expect(refs.map((r) => r.kind).sort().join(",")).toBe("pptx,xlsx")
  })

  test("引号错配不提取", () => {
    const refs = extractAnswerFileReferences('这是 ".claude/broken.docx\' 不是引用', WS)
    expect(refs).toHaveLength(0)
  })

  test("file:// URL 解码 Windows 盘符", () => {
    const refs = extractAnswerFileReferences("file:///E:/proj/learning-methods.pptx", WS)
    expect(refs).toHaveLength(1)
    expect(refs[0]?.kind).toBe("pptx")
    expect(refs[0]?.path.toLowerCase()).toBe("e:/proj/learning-methods.pptx")
  })

  test("家目录路径不出卡", () => {
    expect(extractAnswerFileReferences("写在 ~/notes.md 里了", WS)).toHaveLength(0)
  })

  test("不支持的扩展名(.doc/.xls/.ppt)不出卡", () => {
    expect(extractAnswerFileReferences(" legacy/a.doc 和 b.xls 和 c.ppt", WS)).toHaveLength(0)
  })

  test("图片扩展名出卡", () => {
    const refs = extractAnswerFileReferences("截图见 .claude/shot.PNG", WS)
    expect(refs).toHaveLength(1)
    expect(refs[0]?.kind).toBe("image")
  })

  test("反斜杠路径 + 全角括号边界", () => {
    const refs = extractAnswerFileReferences(
      "已生成：.claude\\order-demo\\deck.pptx（35.6 KB，5 页）",
      WS,
    )
    expect(refs).toHaveLength(1)
    expect(refs[0]?.kind).toBe("pptx")
    expect(refs[0]?.raw).toBe(".claude\\order-demo\\deck.pptx")
  })
})

describe("extractAnswerWebsites", () => {
  test("正文里的 localhost 地址,剥尾部标点", () => {
    const sites = extractAnswerWebsites("可访问 http://127.0.0.1:8765/order-demo/list。")
    expect(sites).toHaveLength(1)
    expect(sites[0]?.url).toBe("http://127.0.0.1:8765/order-demo/list")
    expect(sites[0]?.title).toBe("list")
  })

  test("标题优先取 markdown 链接文字", () => {
    const sites = extractAnswerWebsites("[对账报告](http://127.0.0.1:8765/report.html)")
    expect(sites).toHaveLength(1)
    expect(sites[0]?.title).toBe("对账报告")
  })

  test("公网地址不出", () => {
    expect(extractAnswerWebsites("参考 https://example.com/docs")).toHaveLength(0)
  })
})

describe("buildPreviewCardCandidates", () => {
  test("md/html 引用必须命中本轮 diff(精确或唯一叶子名)", () => {
    const text = "报告: .claude/a.html 和 b.md 和 missing/c.html"
    const noDiff = buildPreviewCardCandidates({ turnText: text, workspacePath: WS })
    expect(noDiff).toHaveLength(0)

    const withDiff = buildPreviewCardCandidates({
      turnText: text,
      workspacePath: WS,
      changedFilePaths: ["E:/proj/.claude/a.html", "E:/proj/sub/b.md"],
    })
    // c.html 无 diff 证明被闸掉;a.html 精确命中;b.md 叶子唯一命中
    expect(withDiff).toHaveLength(2)
    expect(withDiff.find((c) => c.title === "b.md")?.path).toBe("E:/proj/sub/b.md")
  })

  test("没有任何写盘证明时,正文里写全的绝对路径仍出卡(存在性交给 stat 校验)", () => {
    const text = "创建完成: E:\\AImoney\\test\\ai-markdown-optimizer.html"
    const candidates = buildPreviewCardCandidates({ turnText: text, workspacePath: WS })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.kind).toBe("html")
    expect(candidates[0]?.path).toBe("E:\\AImoney\\test\\ai-markdown-optimizer.html")

    // 相对路径没有证明时仍然不出卡:避免把正文里随口提到的文档变成卡片。
    expect(buildPreviewCardCandidates({ turnText: "看看 .claude/a.html", workspacePath: WS })).toHaveLength(0)
  })

  test("叶子名歧义不出卡", () => {
    const candidates = buildPreviewCardCandidates({
      turnText: "报告 a.html",
      workspacePath: WS,
      changedFilePaths: ["E:/proj/x/a.html", "E:/proj/y/a.html"],
    })
    expect(candidates).toHaveLength(0)
  })

  test("office/pdf/图片引用不需要 diff 证明", () => {
    const candidates = buildPreviewCardCandidates({
      turnText: "交付 .claude/report.docx",
      workspacePath: WS,
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.kind).toBe("file")
    expect(candidates[0]?.title).toBe("report.docx")
  })

  test("有本地服务时抑制 html 文件卡,server 卡保留", () => {
    const candidates = buildPreviewCardCandidates({
      turnText: "访问 http://127.0.0.1:3000 或源文件 .claude/index.html",
      workspacePath: WS,
      changedFilePaths: ["E:/proj/.claude/index.html"],
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.kind).toBe("server")
  })

  test("有 html 原型卡时不再补 bash 里的服务卡(同一份产物不重复出卡)", () => {
    const candidates = buildPreviewCardCandidates({
      turnText: "文件: E:\\test\\dashboard.html",
      workspacePath: WS,
      bashUrls: ["http://localhost:8099"],
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.kind).toBe("html")
    expect(candidates[0]?.title).toBe("dashboard.html")
  })

  test("排序:最后提到的优先;去重;bash 兜底垫底", () => {
    const candidates = buildPreviewCardCandidates({
      turnText: "先写了 .claude/first.docx,最终交付 .claude/final.docx",
      workspacePath: WS,
      bashUrls: ["http://127.0.0.1:8765"],
    })
    expect(candidates.map((c) => c.title)).toEqual(["final.docx", "first.docx", "127.0.0.1:8765"])
  })

  test("bash URL 与正文 URL 去重", () => {
    const candidates = buildPreviewCardCandidates({
      turnText: "服务在 http://127.0.0.1:8765",
      workspacePath: WS,
      bashUrls: ["http://127.0.0.1:8765/"],
    })
    expect(candidates).toHaveLength(1)
  })

  test("候选限额 15", () => {
    const text = Array.from({ length: 20 }, (_, i) => `.claude/f${i}.docx`).join(" ")
    const candidates = buildPreviewCardCandidates({ turnText: text, workspacePath: WS })
    expect(candidates).toHaveLength(15)
  })

  test("citation 指令:Office/PDF/图片出卡,md 与 artifact_kind 不匹配不出", () => {
    const ok = buildPreviewCardCandidates({
      turnText: ":nova-file-citation{path=.claude/a.docx}",
      workspacePath: WS,
    })
    expect(ok).toHaveLength(1)
    expect(ok[0]?.kind).toBe("file")

    const kindMismatch = buildPreviewCardCandidates({
      turnText: ":nova-file-citation{path=.claude/a.docx;artifact_kind=presentation}",
      workspacePath: WS,
    })
    expect(kindMismatch).toHaveLength(0)

    const markdown = buildPreviewCardCandidates({
      turnText: ":nova-file-citation{path=.claude/notes.md}",
      workspacePath: WS,
    })
    expect(markdown).toHaveLength(0)
  })

  test("citation 带引号与 artifact_kind 命中", () => {
    const candidates = buildPreviewCardCandidates({
      turnText: '结果 :nova-file-citation{path=".claude/deck.pptx";artifact_kind="presentation"}',
      workspacePath: WS,
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.title).toBe("deck.pptx")
  })

  test("空正文 + 无 bash URL 返回空", () => {
    expect(buildPreviewCardCandidates({ turnText: "", workspacePath: WS })).toHaveLength(0)
  })
})

describe("projectCitationText", () => {
  test("完整指令行整行移除(流式与完成态一致)", () => {
    const text = "正文第一段。\n:nova-file-citation{path=.claude/a.docx}\n正文第二段。"
    // 指令连同其前导换行一起移除,前后文之间只留原本的换行
    expect(projectCitationText(text, { streaming: false })).toBe("正文第一段。\n正文第二段。")
    expect(projectCitationText(text, { streaming: true })).toBe("正文第一段。\n正文第二段。")
  })

  test("流式期间隐藏末尾未闭合指令,完成态保留原文", () => {
    const streaming = "正文。\n:nova-file-citation{path=.claude/a.docx"
    expect(projectCitationText(streaming, { streaming: true })).toBe("正文。\n")
    expect(projectCitationText(streaming, { streaming: false })).toBe(streaming)
  })

  test("流式期间隐藏指令前缀残句", () => {
    expect(projectCitationText("正文。\n:nova-file-cit", { streaming: true })).toBe("正文。\n")
    expect(projectCitationText("正文。\n:nova", { streaming: true })).toBe("正文。\n")
  })

  test("普通冒号开头的行不受影响", () => {
    const text = "比例：\n注意:this is fine"
    expect(projectCitationText(text, { streaming: true })).toBe(text)
  })

  test("无冒号快速返回", () => {
    expect(projectCitationText("纯文本正文", { streaming: true })).toBe("纯文本正文")
  })
})
