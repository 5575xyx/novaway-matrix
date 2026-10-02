import { createEffect, createMemo, createSignal, on, Show } from "solid-js"
import { readFile, stat } from "node:fs/promises"
import { useTheme } from "../context/theme"
import { SidebarCard } from "./sidebar-card"
import { selectedPath } from "./file-tree"
import { filetype } from "../util/filetype"
import { icon } from "../util/panel-icons"
import {
  isCodeModel,
  PREVIEW_MAX_BYTES,
  previewBadge,
  previewModel,
  type PreviewModel,
} from "../util/file-preview-head"

/**
 * 侧栏「快速预览」卡(原型 card-design-v7.html:809-818):选中文件的一段代码预览,
 * 卡头是「图标 + 快速预览 + 文件名徽标」,正文是带语法高亮的若干行。
 *
 * 三件复用,都是查过之后确认现成的,没有另起炉灶:
 *   - **选中状态**:file-tree 的模块级 `selectedPath`(与 sidebarTab 同一个先例)。
 *     文件树点一行就写进去,这里只读。
 *   - **代码高亮**:`<code>` 元素 + 主题那一份 `syntaxStyle` —— 和助手消息里的 `<markdown>`
 *     代码块、工具卡的 `<diff>`、写入块的 `<code>` 是**同一个** tree-sitter 渲染器
 *     (见 routes/session/index.tsx 的 ReadTool / WriteTool)。file-preview.tsx 帮不上忙:
 *     它是纯 `<textarea>` 编辑器,一行高亮都没有。
 *   - **卡片外壳**:SidebarCard(与「资源管理器」那张同一套卡头排版与宽度账)。
 *
 * **读盘路径**用 `node:fs/promises` 的异步 stat + readFile,与 file-tree 列目录、
 * context/theme 读主题文件同一套 —— 不引入同步 IO(file-preview.tsx 那种 readFileSync 会
 * 卡渲染线程,侧栏点一下就卡一下不可接受)。
 *
 * 降级规则全在 util/file-preview-head 的 previewModel 里(可单测):读不到 / 过大 /
 * 二进制 / 空文件各自一句明确文案,绝不留白。空态(没选中文件)整张卡不出现 ——
 * 原型里这张卡就是在选中文件时才出现的。
 */
export function QuickPreviewCard() {
  const { theme, syntax } = useTheme()
  // undefined = 「还没选中」或「正在读」;两者都不画正文,免得把上一个文件的正文留在那儿
  // 看起来像当前文件的。
  const [model, setModel] = createSignal<PreviewModel | undefined>()

  const filePath = selectedPath

  createEffect(
    on(
      filePath,
      async (current) => {
        setModel(undefined)
        if (!current) return
        const loaded = await readPreview(current)
        // 快速连点时后一次的结果才是要的:只在路径仍是当前选中项时才落地。
        if (filePath() !== current) return
        setModel(loaded)
      },
      // 不 defer:挂载时也要读一次当前选中项。切路由回侧栏(组件重挂载)时那个选中项还在,
      // defer 会让这张卡空白,用户得再点一次文件才看得到。
    ),
  )

  // 判别联合拆成两个 memo,渲染层因此不需要一处 as 强转就能各自拿到收窄后的形状。
  const code = createMemo(() => {
    const value = model()
    return value && isCodeModel(value) ? value : undefined
  })
  const notice = createMemo(() => {
    const value = model()
    return value && !isCodeModel(value) ? value.text : undefined
  })

  return (
    <Show when={filePath()}>
      {(current) => (
        // 图标用 panel-icons 的 view(emoji 风格 ◱):原型那张卡画的是 🔍,但 panel-icons 三套
        // 风格里没有放大镜字形,而 icon() 的契约是「只给已注册的字形,不猜风格」——
        // 为了一张卡的图标往里加一套新字形不值当,view 是既有的「预览/视图」语义。
        <SidebarCard title="快速预览" icon={icon("view")} badge={previewBadge(current())} page="files">
          <Show when={notice()}>
            {(text) => (
              <text fg={theme.textMuted} wrapMode="none">
                {text()}
              </text>
            )}
          </Show>
          <Show when={code()}>
            {(value) => (
              <box flexDirection="column" flexShrink={0}>
                <code
                  content={value().content}
                  filetype={filetype(current())}
                  syntaxStyle={syntax()}
                  fg={theme.textMuted}
                  conceal={false}
                  wrapMode="none"
                />
                <Show when={value().truncated}>
                  {/* 截断了就必须说明:否则用户会以为这就是文件全文。 */}
                  <text fg={theme.textMuted} wrapMode="none">
                    … 还有 {value().remaining} 行(双击在主区打开全文)
                  </text>
                </Show>
              </box>
            )}
          </Show>
        </SidebarCard>
      )}
    </Show>
  )
}

/**
 * 读一个文件的前若干行。**先 stat 再读**:体积超上限时直接给降级文案,正文一个字节都不读。
 * 两次 IO 都失败都归到「无法读取该文件」—— 侧栏预览不值得为「不存在」与「没权限」写两句话。
 */
async function readPreview(filePath: string): Promise<PreviewModel> {
  const bytes = await stat(filePath)
    .then((value) => value.size)
    .catch(() => undefined)
  if (bytes !== undefined && bytes > PREVIEW_MAX_BYTES) return previewModel({ path: filePath, bytes })
  const text = await readFile(filePath, "utf8").catch(() => undefined)
  return previewModel({ path: filePath, text, bytes })
}
