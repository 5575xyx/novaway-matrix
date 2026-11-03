// e2e 夹具：挂真实的「备注卡片」（聊天区用户消息上方那张），
// 用来验证选元素类备注发送后是**紧凑卡片**，而不是整段源码铺开。
import { render } from "solid-js/web"
import "@/index.css"
import { MessageCommentCard, type MessageCommentCardData } from "@/pages/session/message-comment-card"

// 与 preview-pick / element-comment 拼出来的正文逐字一致。
const picked = (selector: string, request: string) =>
  [
    `用户对「${selector}」的修改要求：`,
    request,
    "",
    "下面是我在预览里选中的元素，请基于它修改页面：",
    "",
    "- CSS 路径: body > aside > div:nth-of-type(4)",
    '- 标签与属性: <div class="user-card">',
    "- 文本内容: 李 李明 专业版 · 剩余 12 次",
    "- 关键样式:",
    "  - color: rgb(26, 29, 39);",
    "  - background-color: rgba(0, 0, 0, 0);",
    "  - font-size: 16px;",
    "- 元素源码:",
    "```html",
    '<div class="user-card"><span>李 李明</span></div>',
    "```",
  ].join("\n")

const comments: MessageCommentCardData[] = [
  {
    path: "ai-tool-prototype.html",
    preview: "div.user-card",
    comment: picked("div.user-card", "这里可以扩展一下别的功能"),
  },
  {
    path: "ai-tool-prototype.html",
    preview: "div.logo",
    comment: picked("div.logo", "logo和名称改一下，改为启思"),
  },
  {
    path: "ai-tool-prototype.html",
    preview: "span.chat-menu",
    comment: picked("span.chat-menu", "这个3个点也可以继续细化"),
  },
  // 行级评论（没有 preview）：文件名 + 行号 + 最多两行评论。
  {
    path: "src/pages/session/file-tabs.tsx",
    selection: { startLine: 42, endLine: 48 },
    comment:
      "这里的空判断漏了，文件还没读出来的时候 status 是 undefined，后面直接取 startLine 会炸掉；" +
      "顺便把注释补一下，说明为什么这里要等基准就绪。",
  },
]

function Fixture() {
  return (
    <div class="w-[1000px] bg-background-base p-4">
      <div data-slot="strip" class="flex w-max min-w-full justify-end gap-2">
        {comments.map((comment) => (
          <MessageCommentCard comment={comment} />
        ))}
      </div>
    </div>
  )
}

render(() => <Fixture />, document.getElementById("root")!)
