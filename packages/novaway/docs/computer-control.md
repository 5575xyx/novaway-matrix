# 电脑控制

让 AI 看到屏幕并操作鼠标、键盘与窗口。默认关闭。

## 开启

设置 → 电脑控制：

- **启用电脑控制**：把桌面自动化工具提供给模型
- **在输入框显示电脑操作按钮**：在输入区加一个快捷入口（未启用时始终隐藏）

也可以直接写配置：

```json
{
  "experimental": {
    "computer_control": true,
    "computer_control_composer": true
  }
}
```

环境变量等价开关：`NOVAWAY_EXPERIMENTAL_COMPUTER_CONTROL=1`。

## 工具

| 工具                  | 作用                              |
| --------------------- | --------------------------------- |
| `computer_screenshot` | 全屏截图，作为图片附件返回给模型  |
| `computer_click`      | 按绝对坐标点击（左/右/中键）      |
| `computer_move`       | 移动指针                          |
| `computer_type`       | 输入文本（支持中文）              |
| `computer_key`        | 按键组合，如 `Ctrl+A` / `Alt+Tab` |
| `computer_scroll`     | 在当前指针位置滚动                |
| `computer_windows`    | 列出可见窗口                      |
| `computer_focus`      | 按标题把窗口切到前台              |

每个动作都走权限确认（`permission: computer`），可以逐次批准。

## 实现方式

不引入原生模块，直接用系统能力：

- **Windows**：PowerShell + `user32.dll`（鼠标、前台窗口）、`System.Drawing`（截图）、
  `SendKeys` / 剪贴板（输入，剪贴板方式支持中文并会恢复原内容）
- **macOS**：`screencapture` + `System Events`（osascript）；滚动需要 `cliclick`
- **Linux**：`xdotool` + `gnome-screenshot` / `scrot` / `import` / `grim`

缺依赖时状态接口会返回明确原因，而不是抛底层错误。

## 使用建议

1. 先 `computer_screenshot` 看清界面，再决定坐标
2. 动作后再次截图确认结果
3. 涉及登录、支付等敏感操作时保持逐次确认
