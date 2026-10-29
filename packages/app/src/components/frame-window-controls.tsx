import { WindowControls } from "@/components/window-controls"

/**
 * 覆盖式整帧面板（设置 / 数据库）自带的窗口控制条。
 *
 * 这两页会盖住会话帧 Header —— 而窗口的拖动带和自绘窗控（最小化/最大化/关闭）
 * 都在那条 Header 上。补一组之后，窗口在被面板盖住时依然可拖、可关。
 *
 * 只占右上角一小块（不是整条顶带）：整条会把页面自己顶行里的按钮一起吃掉。
 *
 * **页面自己的动作按钮一律放左边**（紧接标题，或放进页面左侧栏顶部）—— 放右边
 * 就会和这组窗控叠在一起。确实需要右侧内容（筛选器之类）的页面，用
 * `@/components/page-header` 的 `PageHeader` / `PAGE_HEADER_RIGHT_INSET`，
 * 它会自动让出 `FRAME_WINDOW_CONTROLS_WIDTH` 的宽度。
 */
export function FrameWindowControls() {
  return (
    <div
      // 透明条：只负责拖拽 + 放窗控，不铺底色。
      // 铺底色会在这块区域留下一块与面板不同色的矩形（`bg-background` 与
      // 面板/表头实际叠加出来的颜色不完全等值），看起来像多了一条「带子」。
      // 被盖住的页面顶行本身是静态的（滚动的只有下方 main），不需要遮罩。
      class="absolute right-0 top-0 z-10 flex h-12 items-center gap-2 pl-4 pr-3"
      data-window-drag
    >
      <WindowControls />
    </div>
  )
}

/** 右上角窗控占位宽度（含内边距）：给同层的页面顶行留白用。 */
export const FRAME_WINDOW_CONTROLS_WIDTH = 108
