<div align="center">
  
<p align="center">
  <img src="resources/icon.png" width="132" alt="TokenDash app icon">
</p>
  
# TokenDash
  
  **Your local command center for AI coding usage.**

  Track tokens, costs, models, projects, and coding-plan limits from the macOS menu bar or the Ubuntu system tray, with a detailed local dashboard when you need to dig deeper.

  [![Latest release](https://img.shields.io/github/v/release/zhangferry/tokendash?style=flat-square)](https://github.com/zhangferry/tokendash/releases/latest)
  [![npm](https://img.shields.io/npm/v/@zhangferry-dev/tokendash?style=flat-square)](https://www.npmjs.com/package/@zhangferry-dev/tokendash)
  [![Test](https://img.shields.io/github/actions/workflow/status/zhangferry/tokendash/test.yml?branch=main&style=flat-square&label=tests)](https://github.com/zhangferry/tokendash/actions/workflows/test.yml)
  [![License](https://img.shields.io/github/license/zhangferry/tokendash?style=flat-square)](LICENSE)

  [Download for macOS](https://github.com/zhangferry/tokendash/releases/latest) · [Download for Ubuntu](https://github.com/zhangferry/tokendash/releases/latest) · [Download for Windows](https://github.com/zhangferry/tokendash/releases/latest) · [Run with npx](#run-the-web-dashboard) · [Features](#what-you-get) · [Development](#development)
</div>

![TokenDash menu bar app and web dashboard](resources/readme-hero.png)

## Why TokenDash?

AI coding tools make it easy to consume millions of tokens without a clear picture of where they went. TokenDash turns local session data into an at-a-glance view of today's activity and a deeper history of your usage.

- **Glanceable by design** — see today's tokens, estimated cost, cache rate, model mix, and quota status without leaving the menu bar or system tray.
- **One view across tools** — bring Claude Code, Codex, OpenClaw, and OpenCode usage into the same product.
- **Local-first** — usage history is parsed directly from files already stored on your machine.
- **Useful beyond totals** — understand hourly activity, model and project distribution, cache efficiency, code changes, and tool calls.
- **No companion analytics service** — the dashboard runs on your computer and does not require an account.

## Quick Start

### macOS Menu Bar App

The native menu bar app is the recommended way to use TokenDash.

1. Download the latest Apple silicon DMG from [GitHub Releases](https://github.com/zhangferry/tokendash/releases/latest).
2. Open the DMG and drag **TokenDash** into **Applications**.
3. TokenDash is not currently notarized. Open Terminal and remove the macOS
   quarantine attribute from the installed app:

   ```bash
   xattr -dr com.apple.quarantine /Applications/TokenDash.app
   ```

4. Launch TokenDash. It will detect supported AI coding tools and start the local dashboard automatically.

TokenDash requires **macOS 14 or later**. It runs as a menu-bar-only app, so it does not add an icon to the Dock.

### Ubuntu Desktop App

A native tray app for Ubuntu 22.04 or later (amd64) ships as a `.deb` and an AppImage, built with Tauri 2 on the Ubuntu 22.04 compatibility baseline.

1. Download the latest `TokenDash-<version>-linux-amd64.deb` (or the AppImage) from [GitHub Releases](https://github.com/zhangferry/tokendash/releases/latest).
2. Install it:

   ```bash
   sudo apt install ./TokenDash-*-linux-amd64.deb
   ```

3. Launch **TokenDash**. It starts the same local dashboard automatically and shows today's token total in the system tray.

The tray uses the AppIndicator API, so GNOME needs the **ubuntu-appindicators** extension (preinstalled on Ubuntu). Because AppIndicator does not deliver icon-click events, open the popover panel from the tray menu (right-click the icon, then **打开面板**). The app bundles the dashboard server but not Node.js: install Node.js 20.10 or later (system package, nvm, fnm, or asdf) so the tray can run it. The app skips incompatible system runtimes when looking for Node.js. With Node.js 20, also install the `sqlite3` command (`sudo apt install sqlite3`) to read OpenCode data; recent Node.js 22 and Node.js 24 use their built-in SQLite support.

The popover panel mirrors the macOS menu bar app: today's tokens, cost, and cache rate; an hourly activity chart with 1D/3H/15M ranges; model and token-type usage; the seven-day trend; and coding-plan quota status. The panel is borderless and frameless — drag it by its header to move it, and it stays open until you dismiss it from the tray menu or press Escape. Panel settings (launch at login, background refresh interval, appearance, low-quota alerts, and API credentials) live under the panel's **Settings** entry and are shared with the tray process.

### Install on Windows

Download `TokenDash-<version>-windows-x64-setup.exe` from the [latest release](https://github.com/zhangferry/tokendash/releases/latest) and run the per-user installer on Windows 10/11 x64. Install Node.js 20.10 or later first; Node.js 22/24 is recommended, and the installer provisions Microsoft WebView2 if it is missing. The installer is currently unsigned, so Windows may show a publisher/SmartScreen warning.

Open TokenDash from the Start menu. The system tray provides the usage panel, dashboard, settings and quit action; Windows uses a compact tray icon with token totals in its tooltip/menu. Settings and data live in `%USERPROFILE%\.tokendash`. Launch at login is per user and is removed during uninstall. With Node.js 20, reading OpenCode data additionally requires `sqlite3` on PATH; other agents do not need it.

### Run the Web Dashboard

On macOS, Linux, or Windows, run the local web dashboard with Node.js 20.10 or later:

```bash
npx @zhangferry-dev/tokendash
```

TokenDash opens `http://localhost:3456` automatically. No global installation is required. On runtimes without built-in SQLite support (including Node.js 20), install the `sqlite3` command to read OpenCode data; other agents do not require it.

## What You Get

### A Native Desktop Companion

On macOS the menu bar, and on Ubuntu the system tray, keep the information you check most often close at hand:

- Live token total in the status bar
- Today's token and estimated cost summary
- Hourly consumption chart and seven-day trend
- Usage breakdown by model and token type
- Coding-plan usage with reset countdowns
- Configurable low-quota notifications
- Launch at login, light/dark appearance (automatic update checks on macOS)

<p align="center">
  <img src="resources/product_menu.png" width="420" alt="TokenDash macOS menu bar popover">
</p>

### A Detailed Local Dashboard

Open the full dashboard when you want to investigate a spike or understand longer-term patterns:

- Token and cost views across today, 7, 30, 60, or all days
- Per-project and per-model distribution
- Input, output, cache creation, and cache read metrics
- Cache efficiency and estimated savings
- Hour-by-day activity heatmap
- Daily trends and session-level breakdowns
- Code change, tool call, and productivity analytics where supported
- Persistent agent, project, time-range, and metric filters

![TokenDash web analytics dashboard](resources/product_screenshoot.png)

## Supported Tools

### Usage Analytics

| Tool | Local data source | Usage history | Code analytics |
| --- | --- | :---: | :---: |
| Claude Code | `~/.claude/projects/` | Yes | Yes |
| OpenAI Codex | `~/.codex/sessions/` | Yes | — |
| OpenClaw | `~/.openclaw/sessions/` | Yes | Yes |
| OpenCode | `~/.local/share/opencode/opencode.db` | Yes | — |

TokenDash only shows tools it detects on the current machine.

### Coding-Plan Quotas

The macOS and Ubuntu apps can also display the current limits reported by:

- Claude Code
- OpenAI Codex
- GLM Coding Plan
- MiniMax Coding Plan
- Kimi Code

Claude Code and Codex reuse their existing local authentication. Credentials entered for other providers are stored in `~/.tokendash/credentials.json` with owner-only file permissions.

## Privacy

TokenDash is local-first:

- Session history is read and processed on your machine.
- The web dashboard and its API are served locally.
- TokenDash does not upload usage history to a TokenDash service.
- No TokenDash account, telemetry endpoint, or external analytics database is required.

When coding-plan monitoring is enabled, TokenDash contacts the corresponding provider's API to retrieve current quota information. Only the authentication and request data required by that provider is sent; your local session history is not included.

## CLI

Install globally if you prefer a persistent command:

```bash
npm install -g @zhangferry-dev/tokendash
tokendash
```

### Install this fork or the current checkout

The npm package above is published by upstream. You can install this fork directly
from GitHub, including a specific commit, without publishing an npm package or
creating a version tag. Use **npm 12.2.1** with Node.js **22.22.2+ (22.x)**,
**24.15.0+ (24.x)**, or **26+**, and have Git available on PATH:

```sh
npm install -g npm@12.2.1
npm install -g "git+https://github.com/cmstar/tokendash.git#main" --allow-git=root --allow-scripts="git+https://github.com/cmstar/tokendash.git" --registry=https://registry.npmjs.org --replace-registry-host=registry.npmmirror.com
tokendash --version
```

The first command is a one-time npm upgrade. The second command works in
PowerShell, cmd.exe, Bash, and zsh. Replace `#main` with a commit SHA to install
that revision. `--allow-git=root` permits the requested Git source, and
`--allow-scripts` permits this repository's build hook; npm 12 requires these
explicit permissions. The script permission uses the repository URL, not the
upstream npm package name. The mirror-host option handles older commits whose
lockfile contains an `npmmirror.com` download URL. The two registry options use
the official npm registry for this command without changing your saved settings.
They can be omitted for revisions whose lockfile uses only the npm registry.

Older npm releases, including 11.16.0 and 11.21.1, contain the
[Git global-install bug](https://github.com/npm/cli/issues/9406): dependency
preparation inherits global mode, creates a link to npm's temporary clone, and
leaves a broken command when the clone is removed. The
[official fix](https://github.com/npm/pacote/pull/494) is included in npm 12.
This affects Windows and Linux; creating a tag does not fix it. If you keep an
older npm or Node.js version, use the checkout installer or tarball flow below.

To install the current checkout, use Node.js 22 or 24 and run this on
**Windows, macOS, or Linux** (PowerShell, cmd.exe, Bash, and zsh use the same command):

```sh
npm run install:global
tokendash --version
```

The installer uses Node.js built-ins, so no prior `npm install` is needed. It
installs the locked development dependencies, builds the current source including
uncommitted changes, packs it in a temporary directory, installs that tarball
globally, and verifies the installed version. The result is an independent copy
with runtime dependencies; temporary files are cleaned up on success or failure.
If a step fails, the installer stops.

To perform the installation manually, without the installer script, run these
commands from the repository root on any of the supported platforms:

```sh
npm ci --global=false --include=dev
npm pack --global=false
```

The `prepare` hook builds the source automatically. Install the exact `.tgz`
filename printed by `npm pack`; for the current version, `1.10.0`, that is:

```sh
npm install -g ./zhangferry-dev-tokendash-1.10.0.tgz
tokendash --version
```

Use the newly printed filename after a version change so an older tarball is
not installed accidentally. Only the final tarball installation uses `-g`.

To use the installer for a specific Git ref instead of the current source:

```sh
npm run install:global -- "git+https://github.com/cmstar/tokendash.git#main"
```

The selected Git branch or commit must include this fork's `prepare` build hook.
Changes that have not been pushed are only available through the local-checkout
method. Replace `#main` with a commit SHA to install a specific revision.
On npm 12, Git-source preparation uses the official npm registry and translates
the mirror URL found in older commits. Local-checkout installs retain your
configured registry.

Without a checkout containing the installer, use the equivalent two-step flow.
On **macOS/Linux with Bash or zsh**:

```sh
tarball=$(npm pack --global=false --foreground-scripts=false --json \
  --allow-git=all --registry=https://registry.npmjs.org --replace-registry-host=registry.npmmirror.com \
  "git+https://github.com/cmstar/tokendash.git#main" | \
  node -e "let s=''; process.stdin.on('data', c => s += c); process.stdin.on('end', () => { const p = JSON.parse(s); console.log((Array.isArray(p) ? p[0] : p['@zhangferry-dev/tokendash']).filename); });")
npm install -g "./$tarball"
tokendash --version
```

On **Windows with PowerShell**:

```powershell
$packed = npm pack --global=false --foreground-scripts=false --json --allow-git=all --registry=https://registry.npmjs.org --replace-registry-host=registry.npmmirror.com "git+https://github.com/cmstar/tokendash.git#main" | ConvertFrom-Json
$item = @($packed)[0]
if (-not $item.PSObject.Properties['filename']) { $item = $item.'@zhangferry-dev/tokendash' }
npm install -g ".\$($item.filename)"
tokendash --version
```

The tarball filename is read from npm's output so upgrades do not accidentally
reuse an older version such as `1.9.0`. `--foreground-scripts=false` keeps build logs
out of the JSON output; it does not disable the build. On npm 12, `pack` needs
`--allow-git=all` because it does not treat its Git argument as a root dependency;
the direct `install -g` command above can use the narrower `--allow-git=root`.
The snippets accept both npm 10/11's JSON array and npm 12's object keyed by
package name.

Source installs need a build because `dist/` is not tracked in Git. The `prepare`
hook builds the frontend and server during dependency installation and packing;
`prepack` alone does not cover local-directory installation. See the
[npm lifecycle documentation](https://docs.npmjs.com/cli/v11/using-npm/scripts/#life-cycle-scripts).

The installer and two-step commands above keep source preparation local with
`--global=false` and apply `-g` only to the finished tarball, so they also work
around the older npm bug. With npm 10, omit `--allow-git=all` from the manual
packing commands; that version predates this option. Do not use `--ignore-scripts`
while preparing the source.

`npm install -g .` instead links the current checkout. Install its dependencies
first and keep the checkout and its `node_modules` in place, or use the tarball
method above for an independent installation.

### Time ranges

Use Today, 2D, 3D, 7D, 30D, 60D, or ALL for quick filtering. Custom offers
two modes: an inclusive date range, or Last X days with suggested day counts
and a manual number input. Click Apply to update the dashboard and Sessions.
Recent-day windows include today and move forward each day; the selected
mode and value are remembered when you reload the page.

### Codex Time dashboard

Select **Codex → Time** to view duration statistics with the same date and
project filters as the usage dashboard. Time is available only for Codex.

- **Agent work time** adds the durations of completed or interrupted turns,
  including the main agent and delegated subagents. Parallel turns add up.
- **Elapsed time** merges overlapping intervals, so concurrent agents and
  conversations count only once. Tool execution and waiting within a turn
  are included; gaps between turns are excluded. This measures recorded
  turn lifetimes, not CPU time or time spent generating tokens.
- **Daily averages** divide by all calendar days in the selected range,
  including days without activity. ALL starts on the first recorded day
  matching the filters and ends today.
- **Avg conversation time** averages elapsed time within each main
  conversation and its delegated subagents. Only conversations with valid
  timing in the selected range contribute; overlapping conversations remain
  separate for this average.
- **Avg turn time** averages the full elapsed duration of each completed
  main-agent question-and-answer turn, rather than an entire session. Turns
  are selected by their completion date and the main agent's project; a turn
  crossing midnight retains its full duration. Waiting for delegated agents
  is already included in the main turn and is not added again. Interrupted,
  ongoing, child-agent, and system-agent turns do not enter this average.
  Simultaneous questions count separately, and no completed turns shows `—`.

The Time dashboard includes daily work time by model, daily elapsed time,
project rankings for both measures, an hourly work-time heatmap, and a daily
detail table. Heatmap cells show summed agent work time, so parallel work
can exceed one hour in a single hourly cell. Daily and hourly boundaries use
the reported dashboard timezone, currently Asia/Shanghai. Each project's
elapsed time is calculated independently; adding project elapsed times can
exceed the overall elapsed time when projects overlap.

Daily detail also shows **Avg conversation time** and **Avg turn time**.
The first averages each active session's elapsed time within that date; the
second averages full durations of main-agent answers completed on that date.
Days without eligible sessions or completed answers show `—`. The Total row
uses the selected period's overall averages, matching the summary cards,
rather than averaging the daily averages.

**Include system agents** optionally includes Codex's internal agents, such
as automatic reviews; it is off by default. Copied history is deduplicated
before filtering. Ongoing or incomplete turns are excluded from duration
totals. The dashboard reports missing timing, estimates derived from older
event timestamps, and turns whose conversation lineage is unavailable.

Timing uses the same persistent rollout index as token usage, including
compressed history. This upgrade rebuilds that index once; later requests
reuse parsed intervals and recalculate the selected date/project totals.

### Codex history and caching

Codex history statistics include both `.jsonl` and Zstandard-compressed
`.jsonl.zst` rollouts in the configured live and archived session directories.
New `token_usage_record` responses take precedence over their legacy
`token_count` status events; inherited subagent history is excluded from the
child's usage. Older sessions continue to use the legacy events.

Parsed usage and session metadata are persisted under
`~/.tokendash/usage-index-v1/` (or `TOKENDASH_USAGE_INDEX_DIR`). The first scan
after this parser upgrade rebuilds the indexes; subsequent starts reuse
unchanged files and process only new or modified rollouts. Compressed history
is decoded in memory, without creating uncompressed copies in the Codex home.
Session bodies are read on demand when opening full content. Node.js 20 remains
supported through a bundled JavaScript Zstandard decoder; newer runtimes use
native decoding when available. No system `zstd` command is required.

### Options

Available options:

```text
tokendash [options]

--port <number>  Port for the local server (default: 3456 or PORT)
--no-open        Start without opening a browser
--tray           Launch the macOS menu bar app instead of opening a browser
--version, -v    Print the installed version
```

During development, Vite serves the frontend at `http://localhost:5173`; packaged and npm installations use the local server port.

## How It Works

TokenDash consists of three small layers:

1. **Local parsers** read each supported tool's session files or database.
2. **An Express API** validates and caches normalized usage data.
3. **Three interfaces** present the same data: a React analytics dashboard, a native SwiftUI macOS menu bar app, and a Tauri 2 tray app for Ubuntu that reuses the dashboard's web client for its popover panel.

Data is cached locally with a stale-while-revalidate strategy so the interface remains responsive while files are being reparsed.

## Development

```bash
git clone https://github.com/zhangferry/tokendash.git
cd tokendash
npm install
npm run dev
```

Common commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Express and Vite development servers |
| `npm run build` | Build the web client and server |
| `npm run install:global` | Build, pack, and install the checkout globally on Windows, macOS, or Linux |
| `npm run build:swift` | Build the native macOS app |
| `npm run build:dmg` | Package the macOS app and DMG |
| `npm run build:linux` | Package the Ubuntu deb and AppImage |
| `npm run build:windows` | Package the Windows x64 NSIS installer (on Windows) |
| `npm run dev:tauri` | Run the Ubuntu tray app against the dev servers |
| `npm run typecheck` | Type-check the server and frontend |
| `npm test` | Run Vitest unit tests |
| `npm run test:e2e` | Run Playwright end-to-end tests |

The web client uses React, TypeScript, Tailwind CSS, Recharts, and Vite. The local server uses Express and Zod. The macOS app is built with SwiftUI and Sparkle. The Linux and Windows tray apps are built with Tauri 2 and reuses the same web client for its popover panel.

## Contributing

Issues and pull requests are welcome. For a new integration, keep the parser boundary consistent by implementing daily, project, and block responses, then wire detection, API routing, and the agent switcher.

Before submitting a change, run:

```bash
npm run typecheck
npm test
npm run test:e2e
```

If you touched the Linux/Windows tray app under `src-tauri/`, also run the Rust gates the CI enforces:

```bash
cd src-tauri
cargo fmt --check
cargo clippy --release -- -D warnings
cargo test --release
```

## License

TokenDash is available under the [MIT License](LICENSE).
