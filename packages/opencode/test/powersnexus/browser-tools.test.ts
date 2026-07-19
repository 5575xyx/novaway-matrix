import { expect, test } from "bun:test"
import {
  BrowserAccessibilityTool,
  BrowserClickTool,
  BrowserCloseTool,
  BrowserConsoleTool,
  BrowserFillTool,
  BrowserNavigateTool,
  BrowserNetworkTool,
  BrowserPressTool,
  BrowserScreenshotTool,
  BrowserSnapshotTool,
} from "../../src/tool/browser"

test("Browser 工具 ID 覆盖 PRD 首期能力", () => {
  expect(BrowserNavigateTool.id).toBe("browser_navigate")
  expect(BrowserSnapshotTool.id).toBe("browser_snapshot")
  expect(BrowserClickTool.id).toBe("browser_click")
  expect(BrowserFillTool.id).toBe("browser_fill")
  expect(BrowserPressTool.id).toBe("browser_press")
  expect(BrowserScreenshotTool.id).toBe("browser_screenshot")
  expect(BrowserConsoleTool.id).toBe("browser_console")
  expect(BrowserNetworkTool.id).toBe("browser_network")
  expect(BrowserAccessibilityTool.id).toBe("browser_accessibility")
  expect(BrowserCloseTool.id).toBe("browser_close")
})
