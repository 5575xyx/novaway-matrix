<p align="center">
  <img src="packages/desktop/icons/novaway-icon.svg" alt="NovaWay Matrix" width="120">
</p>

<h1 align="center">NovaWay Matrix</h1>

<p align="center">An AI coding and office-automation agent for the terminal — tuned for Chinese LLMs and Chinese-language workflows.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/xymt-novaway"><img alt="npm" src="https://img.shields.io/npm/v/xymt-novaway?style=flat-square&label=xymt-novaway"></a>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square">
  <img alt="platform" src="https://img.shields.io/badge/platform-win--x64%20%7C%20mac--arm64%2Fx64%20%7C%20linux--x64-lightgrey?style=flat-square">
</p>

<p align="center">
  <a href="README.md">简体中文</a> |
  <b>English</b>
</p>

---

NovaWay Matrix is built on the open-source project [opencode](https://github.com/anomalyco/opencode). It is an AI coding and office-automation agent available both as a **terminal UI (TUI)** and as an **Electron desktop app**. On top of upstream, it adds system prompts tailored to Chinese LLMs, a fully Chinese interface with NovaWay branding, and Chinese office skills (PPT, Xiaohongshu, WeChat Official Accounts). The CLI entry point is `novaway`.

> Disclaimer: this is an independent fork of opencode (MIT) and is not affiliated with the opencode team.

## Install

Requires Node.js ≥ 18 (for the global install and the postinstall unpack step). Supported platforms: **Windows x64**, **macOS** (Apple Silicon and Intel), **Linux x64**. npm resolves `os` / `cpu` and installs only the binary package matching your machine.

```bash
npm install -g xymt-novaway
```

Then just run:

```bash
novaway
```

### Faster installs in mainland China

The platform binaries ship through npm (no GitHub download), so each platform package is about **180 MB**. The official registry is often only tens of KB/s from China and will time out. Because the platform packages are `optionalDependencies`, **npm silently skips one that fails to download** — postinstall then reports `Try manually installing xymt-novaway-<os>-<arch>` and npm rolls the whole install back. It looks like a broken package, but it is just a slow network. Use the npmmirror registry:

```bash
npm install -g xymt-novaway --registry=https://registry.npmmirror.com --foreground-scripts
```

`--foreground-scripts` merely surfaces the postinstall output so you can confirm the binary was unpacked (optional). To make the mirror permanent:

```bash
npm config set registry https://registry.npmmirror.com
```

If the mirror 404s or serves a stale version it has not synced yet — trigger a sync and retry after about a minute:

```bash
curl -X PUT "https://registry-direct.npmmirror.com/-/package/xymt-novaway/syncs"
curl -X PUT "https://registry-direct.npmmirror.com/-/package/xymt-novaway-windows-x64/syncs"
```

> Replace `windows-x64` in the second command with your platform: `darwin-arm64` / `darwin-x64` / `linux-x64`.

### Other package managers

```bash
pnpm add -g xymt-novaway
yarn global add xymt-novaway
bun add -g xymt-novaway
```

> `pnpm` does not run postinstall scripts by default. If `novaway` reports `postinstall script was not run`, run it manually:
> `cd $(pnpm root -g)/xymt-novaway && node postinstall.mjs`

### Verify

```bash
novaway --version     # prints the version, e.g. 0.1.5
novaway               # launches the TUI
```

## Desktop app

Besides the terminal, NovaWay ships an **Electron** desktop app (not a thin wrapper) with NovaWay branding, a Chinese UI, 16 bundled languages, and auto-update via electron-updater. It runs the `novaway` core as a **sidecar** and offers two surfaces:

**① Workbench window** — the full NovaWay main window for coding and office conversations; supports a custom server address, deep-link activation, and WSL configuration on Windows.

**② Floating pet** — a desktop companion that can follow the cursor and be summoned any time:

- **Two display modes**: `full` and `minimal`, toggled with one click.
- **Expandable panel** with two tabs: **Task monitor** (live agent task progress — pending / running / done / cancelled) and **Notifications**.
- **Skins** — several built-in pet skins (e.g. snow) plus custom colors.

### Multi-platform accounts and one-click publishing

The desktop app manages login sessions for major Chinese content platforms and automates publishing, closing the loop with the built-in skills (Xiaohongshu, WeChat Official Accounts, etc.):

> Xiaohongshu, Douyin, Kuaishou (with signing), Bilibili, WeChat Official Accounts, WeChat Channels, Xianyu

- **QR / web login** with automatic session capture and validation, including batch expiry checks.
- **Account grouping** — create, edit and delete groups; move accounts between them.
- **One-click publish** to any logged-in account.

### Packaging

Builds for macOS (`.dmg` / `.zip`, Apple Silicon and Intel), Windows (`.exe`, NSIS) and Linux (`.AppImage` / `.deb` / `.rpm`), named `novaway-desktop-<os>-<arch>.<ext>`.

```bash
cd packages/desktop
bun run dev              # local development
bun run package:win      # build for Windows (or package:mac / package:linux)
```

## Highlights

- **Chinese LLMs out of the box** — dedicated system prompts for DeepSeek, Qwen, Zhipu GLM, Kimi, MiniMax and Xiaomi MiMo, alongside Claude, GPT and Gemini.
- **Chinese interface** — both the terminal TUI and the Electron desktop app are localized and rebranded.
- **Built-in skills** — one-sentence PPT generation (office-ppt), Xiaohongshu ops (xiaohongshu-ops), WeChat Official Account ops (wxgzh-ops), plus document / data / meeting / design / web skills.
- **Multi-agent orchestration** — a built-in Orchestrator builds a dependency-aware task plan, spawns subagents concurrently in topological order and passes results between tasks; pairs with Workflow for complex flows and supports background parallelism. It is available to every primary agent and invoked by the model on demand (it does not run permanently), while the pulse-orchestrator ops agent uses it actively for multi-step work.
- **Session intelligence** — goals, checkpoints and distillation for session memory and self-organization.
- **MCP ecosystem** — context7 (live docs), sequential-thinking, memory, browser and desktop-commander are preconfigured.
- **Database management** — a built-in visual database client: manage multiple connections, browse databases / tables / columns as a tree, run SQL and inspect results.

## Built-in agents

Switch primary agents with `Tab`. There are three families:

### Development

- **build** — the default primary agent, with access to every tool allowed by your config (read/write files, run commands, run tests). Takes a coding task end to end, from implementation through verification.
- **plan** — a read-only planning agent with all editing tools disabled that asks before running commands. Best for safely exploring an unfamiliar codebase and settling on an approach before touching anything.

### Office mode

A set of specialist "coworker" agents, one per everyday office scenario:

- **Documents** (office-document) — writing, rewriting, review, proposals, reports, weekly/monthly updates. Turns scattered material into deliverable, well-structured documents.
- **Presentations** (office-ppt) — outlines, page-level storylines, slide copy, chart suggestions and speaker notes. Goes from a topic to a full storyline and, with the PPT skill, straight to a `.pptx`.
- **Spreadsheets** (office-data) — CSV / Excel cleanup, pivots, trend attribution, chart suggestions. Turns raw tables into an analysis with conclusions.
- **Visual design** (office-design) — posters, covers, illustrations, brand palettes and visual guidelines.
- **Web dashboards** (office-web) — HTML dashboards, project trackers, customer-facing tools and demo sites, with no frontend build step.
- **Meetings** (office-meeting) — minutes, decisions, action items, owners, deadlines and risk follow-ups. Turns a meeting into an executable checklist.
- **Knowledge base** (office-knowledge) — summaries, multi-document comparison, knowledge indexes and FAQs.
- **Tasks** (office-task) — goal breakdown, prioritization, weekly plans, risk boards and dependency mapping.
- **Communication** (office-communication) — email, announcements, business phrasing, bilingual copy and tone rewriting.

### Operations

- **Ops orchestrator** (pulse-orchestrator) — content-operations control: reads intent, then plans and coordinates subagents step by step.

There are also **general** / **explore** / **scout** subagents, invoked internally by primary agents or with `@`, for complex search, codebase exploration and external research.

## Database management

A visual database client (powered by **dbx**, embedded in the web UI and the desktop app) that both you and the agent can drive:

- **Multiple connections** — add, remove and disconnect connections; the list is persisted.
- **Tree browsing** — connection → database → table → column, with type, nullability, default and comment.
- **SQL queries** — write and run SQL, results rendered as a table.
- **Many engines** — MySQL, PostgreSQL, SQLite, MariaDB, Doris, StarRocks and more.

Open it from the command palette ("打开数据库" / "关闭数据库").

## Quick start

1. Run `novaway`.
2. Pick a model and enter the provider's API key when prompted.
3. Start a conversation inside your project directory: read code, edit code, run tests, or generate slides and marketing copy.

## Update

```bash
novaway upgrade              # upgrade to the latest version
novaway upgrade 0.1.5        # upgrade to a specific version
```

It detects how you installed (npm / pnpm / bun / yarn / brew / scoop / choco), runs the equivalent of `npm install -g xymt-novaway@<version>`, and **honors your npm registry config** — so if you set the npmmirror registry, upgrades use it too. Force a method with `-m`: `novaway upgrade -m npm`.

Reinstalling works just as well:

```bash
npm install -g xymt-novaway@latest --registry=https://registry.npmmirror.com
```

## Uninstall

The built-in command also clears config, data and cache, and calls your package manager to remove the program itself:

```bash
novaway uninstall              # list what will be removed, then confirm
novaway uninstall --dry-run    # preview only, delete nothing
novaway uninstall -f           # skip confirmation
novaway uninstall -c -d        # keep config (-c) and session data (-d)
```

To remove only the program and leave all data untouched, use your package manager directly:

```bash
npm uninstall -g xymt-novaway
# or pnpm uninstall -g xymt-novaway / yarn global remove xymt-novaway / bun remove -g xymt-novaway
```

User data directories (cleared by `novaway uninstall`, untouched by a manual uninstall):

| Purpose | Linux / macOS | Windows |
| --- | --- | --- |
| Config | `~/.config/novaway` | `C:\Users\<you>\.config\novaway` |
| Data (sessions / logs / snapshots) | `~/.local/share/novaway` | `C:\Users\<you>\.local\share\novaway` |
| Cache | `~/.cache/novaway` | `C:\Users\<you>\.cache\novaway` |
| State | `~/.local/state/novaway` | `C:\Users\<you>\.local\state\novaway` |

## Install troubleshooting

**`failed to install the right novaway CLI package` / `Try manually installing xymt-novaway-<os>-<arch>`**

The 180 MB platform binary timed out mid-download; npm skipped it silently because it is optional, postinstall then failed and the install rolled back. Reinstall through the npmmirror registry (see above). You can also warm the npm cache with the big package first:

```bash
npm cache add xymt-novaway-windows-x64@latest --registry=https://registry.npmmirror.com
npm install -g xymt-novaway --registry=https://registry.npmmirror.com
```

**`postinstall script was not run`**

You used `--ignore-scripts`, or a package manager that skips postinstall by default. Run it manually: `cd <global node_modules>/xymt-novaway && node postinstall.mjs`.

**The install hangs**

Check whether it is still fetching the 180 MB package (`--foreground-scripts` shows progress). If the official registry is simply too slow, interrupt it and switch to the mirror; run `npm uninstall -g xymt-novaway` first to clear the half-finished install.

## Build from source

Requires [Bun](https://bun.sh).

```bash
bun install
cd packages/novaway
bun run build --single   # current platform only (fast smoke build)
bun run build            # cross-compile all four platforms
```

Output lands in `packages/novaway/dist/<platform-package>/bin/novaway`.

## Releasing (maintainers)

Distribution is **native npm binaries**: the main package `xymt-novaway` pulls in per-platform packages `xymt-novaway-<os>-<arch>` through `optionalDependencies`, and npm installs only the one matching `os` / `cpu`. Everything goes through npm; no GitHub download.

Trigger the `publish-npm` workflow manually in GitHub Actions and enter a version — it publishes 5 packages at once (main + 4 platform packages), comfortably under npm's limit of 10 new package names per hour.

Package naming is controlled by the workflow input `main_package` (env var `NOVAWAY_MAIN_PACKAGE`), default `xymt-novaway`. To **publish a backup copy under a different npm account**: swap the repo secret `NPM_TOKEN` for that account's token and set `main_package` to `novaway`, which publishes `novaway` + `novaway-<os>-<arch>`. Each binary embeds its own main package name, so `novaway upgrade` updates the matching package.

## Credits

- Built on [opencode](https://github.com/anomalyco/opencode) (MIT License).
- Thanks to all upstream contributors.

## License

[MIT](./LICENSE)
