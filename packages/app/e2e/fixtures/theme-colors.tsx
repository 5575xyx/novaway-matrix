import { render } from "solid-js/web"
import "../../../ui/src/styles/tailwind/index.css"
import { Button } from "../../../ui/src/components/button"
import { Card, CardTitle } from "../../../ui/src/components/card"
import { Tag } from "../../../ui/src/components/tag"
import { TextField } from "../../../ui/src/components/text-field"
import { Checkbox } from "../../../ui/src/components/checkbox"
import { PlatformIcon } from "../../src/components/platform-icon"
import xhsIcon from "../../src/assets/platform-icons/xhs.svg?raw"
import { ProviderIcon } from "../../../ui/src/components/provider-icon"
import { ThemeProvider, useTheme } from "../../../ui/src/theme/context"

function ThemeColorFixture() {
  const theme = useTheme()
  return (
    <main
      data-e2e="theme-colors"
      style={{
        background: "var(--background-base)",
        color: "var(--foreground)",
        "min-height": "100vh",
        display: "flex",
        "flex-wrap": "wrap",
        "align-content": "flex-start",
        "align-items": "center",
        gap: "12px",
        padding: "24px",
      }}
    >
      <button data-action="light" onClick={() => theme.setColorScheme("light")}>
        Light
      </button>
      <button data-action="dark" onClick={() => theme.setColorScheme("dark")}>
        Dark
      </button>
      <button data-action="parchment" onClick={() => theme.setTheme("parchment")}>
        Parchment
      </button>
      <ProviderIcon id="openai" brand style={{ width: "32px", height: "32px" }} />
      <ProviderIcon id="google" brand style={{ width: "32px", height: "32px" }} />
      <span data-model-brand="sensenova" style={{ color: "var(--model-brand-sensenova)" }} />
      <span data-model-brand="agnes" style={{ color: "var(--model-brand-agnes)" }} />
      <PlatformIcon
        svg={xhsIcon}
        color="var(--platform-brand-xhs)"
        markColor="var(--platform-brand-xhs-foreground)"
        style={{ width: "32px", height: "32px" }}
      />
      <span data-semantic="success" style={{ color: "var(--icon-success-base)" }}>
        Success
      </span>
      <span data-semantic="warning" style={{ color: "var(--icon-warning-base)" }}>
        Warning
      </span>
      <span data-semantic="critical" style={{ color: "var(--icon-critical-base)" }}>
        Critical
      </span>
      <span data-semantic="info" style={{ color: "var(--icon-info-base)" }}>
        Info
      </span>
      <span data-semantic="interactive" style={{ color: "var(--icon-interactive-base)" }}>
        Interactive
      </span>
      <span class="text-icon-success-base" data-semantic-utility="success">
        Success utility
      </span>
      <span class="text-icon-warning-base" data-semantic-utility="warning">
        Warning utility
      </span>
      <span class="text-icon-critical-base" data-semantic-utility="critical">
        Critical utility
      </span>
      <span data-theme-status-dot="success" class="size-2 rounded-full bg-icon-success-base" />
      <span data-theme-status-dot="warning" class="size-2 rounded-full bg-icon-warning-base" />
      <span data-theme-status-dot="critical" class="size-2 rounded-full bg-icon-critical-base" />
      <span data-theme-status-dot="interactive" class="size-2 rounded-full bg-icon-interactive-base" />
      <span data-semantic-reference="success" style={{ display: "none", color: "var(--icon-success-base)" }} />
      <span data-semantic-reference="warning" style={{ display: "none", color: "var(--icon-warning-base)" }} />
      <span data-semantic-reference="critical" style={{ display: "none", color: "var(--icon-critical-base)" }} />
      <span data-semantic-reference="info" style={{ display: "none", color: "var(--icon-info-base)" }} />
      <div data-component="toast" data-variant="success">
        <div data-slot="toast-icon">
          <span data-component="icon" data-toast-icon="success">
            ✓
          </span>
        </div>
        <div data-slot="toast-progress-fill" data-toast-progress="success" style={{ width: "36px" }} />
      </div>
      <div data-component="toast" data-variant="error">
        <div data-slot="toast-icon">
          <span data-component="icon" data-toast-icon="error">
            !
          </span>
        </div>
        <div data-slot="toast-progress-fill" data-toast-progress="error" style={{ width: "36px" }} />
      </div>
      <div data-component="toast" data-variant="loading">
        <div data-slot="toast-icon">
          <span data-component="icon" data-toast-icon="loading">
            …
          </span>
        </div>
        <div data-slot="toast-progress-fill" data-toast-progress="loading" style={{ width: "36px" }} />
      </div>
      <div data-component="session-turn">
        <span class="error-card" data-theme-error-card>
          Error state
        </span>
      </div>
      <Button variant="primary" data-theme-component="primary-button">
        Primary
      </Button>
      <Card variant="info" data-theme-component="info-card">
        <CardTitle variant="info">Information</CardTitle>
      </Card>
      <Card variant="success" data-theme-component="success-card">
        <CardTitle variant="success">Success</CardTitle>
      </Card>
      <Card variant="warning" data-theme-component="warning-card">
        <CardTitle variant="warning">Warning</CardTitle>
      </Card>
      <Card variant="error" data-theme-component="error-card">
        <CardTitle variant="error">Error</CardTitle>
      </Card>
      <Tag data-theme-component="tag">Theme tag</Tag>
      <span class="text-text-interactive-base" data-theme-component="interactive-text-utility">
        Semantic link
      </span>
      <span class="text-icon-interactive-base" data-theme-component="interactive-icon-utility">
        Interactive icon
      </span>
      <span class="border border-interactive-base" data-theme-component="interactive-border-utility" />
      <span
        data-theme-reference="interactive-text"
        style={{ display: "none", color: "var(--text-interactive-base)" }}
      />
      <span
        data-theme-reference="interactive-icon"
        style={{ display: "none", color: "var(--icon-interactive-base)" }}
      />
      <span
        data-theme-reference="interactive-border"
        style={{ display: "none", borderColor: "var(--border-interactive-base)" }}
      />
      <TextField data-theme-component="text-field" label="Theme input" placeholder="Type here" />
      <Checkbox data-theme-component="checkbox" defaultChecked>
        Theme checkbox
      </Checkbox>
    </main>
  )
}

render(
  () => (
    <ThemeProvider>
      <ThemeColorFixture />
    </ThemeProvider>
  ),
  document.getElementById("root")!,
)
