# agy-context

> **🌐 [中文 / Chinese](./README_zh.md)**

Local-only Antigravity session analytics — shows the current session's token usage, context window consumption, time breakdown, tool calls and file activity live in the side panel, plus a global overview dashboard.

All data comes **entirely from local files** — no network, no uploads.

---

## Features

### Side panel (live, per session)

Open the right panel (`Ctrl+Shift+B`); the top shows the current session's stats. The side card is **expanded by default** — its content scrolls inside the card when it exceeds the available height, and its expanded/collapsed state is remembered.

| Section | Content |
|---|---|
| **Session header** | Title, session ID, step count, last updated |
| **KPI** | Token usage · Est. cost · Cache hit · Active time |
| **Current Context** | Used / window size, percentage, colored stacked bar, 6-segment breakdown |
| **Context Events** | Truncated-content (context compaction) records |
| **File Activity** | Write / edit / read counts and character volume per file |
| **Models** | Models used in this session and their call counts |
| **File Types** | Grouped by extension |
| **Hourly Activity** | 24-hour distribution |
| **Command Execution** | Full command history, filterable by failed / slow / background, click a row to expand output |

The card layout matches the overview page, with the grid collapsing to a single column.

### Context Overview (sidebar "Context Overview")

A global view aggregating all sessions:

- Total sessions, total tokens, total estimated cost
- Cache hit rate, total tool calls, active time
- 14-day usage bars (Token / cost dual axis)
- Token composition donut, time breakdown donut
- Activity heatmap (7 rows × N weeks; switch Token / rounds / sessions)
- Skills loaded, tool calls, command execution rankings
- Session list (search / filter by workspace / sort / jump)

---

## Settings & Internationalization

Gear button at the top-right of the overview, in two groups:

### Basic settings (native to panel.js)

| Item | Description |
|---|---|
| **Context window** | 200K / 1.0M / 2.0M — affects the context usage percentage |
| **Auto refresh** | Whether to repaint on sidecar pushes |
| **Compact mode** | Smaller card padding and font size |

### Appearance & behavior (added by the i18n layer)

| Item | Description |
|---|---|
| **Language** | **EN / 中文** switch, defaults to English |
| **UI scale** | 90% / 100% / 110% |
| **Side panel card** | Whether to inject the current-session card in the right panel |
| **Sidebar menu** | Whether to show the "Context Overview" menu item |
| **Reset** | Restore all defaults (including language back to English) |

### How i18n works

Translation lives in a standalone `sidecars/context-panel/i18n.js`, appended as a separate script **after** `panel.js` is injected, and **does not modify any string literal in the UI source**:

- Walks text nodes inside the plugin's own four containers (overview overlay / side card / menu item / hover tooltip) with a `TreeWalker`
- Replaces 中→英 via a longest-match-first dictionary; originals are kept in a `WeakMap` for restoring Chinese
- Also translates `title` / `data-tip` / `placeholder` attributes
- A synchronous `MutationObserver` microtask translates new content before the browser paints, so new content from the 5-second sidecar repaint never flashes Chinese
- Only touches the plugin's own DOM, **never the Antigravity host UI**

All settings are stored in `localStorage` (key prefix `agy-context:`) and persist across restarts. The language key is `agy-context:lang`, with values `en` / `zh`.

---

## Installation

**Install directly from GitHub** (no Marketplace listing needed — `agy` clones the repo):

```bash
agy plugin install https://github.com/richuff/agy-context
```

Or use `/plugin install https://github.com/richuff/agy-context` inside the CLI.

From a local directory or repo:

```bash
agy plugin install ./agy-context
```

> After installation, check Antigravity App → **Customizations → Installed**, or `agy plugin list`.
> To update: `agy plugin uninstall agy-context` then reinstall, or just re-run the install command.

Enable the sidecar in `~/.gemini/config/config.json`:

```json
{
  "sidecars": {
    "agy-context/context-panel": { "enabled": true }
  }
}
```

Restart Antigravity to take effect.

---

## Publishing

### Option 1: Direct GitHub install (already available, no review)

Official `agy plugin install` accepts a GitHub repo URL. As long as the repo is public and has a valid root `plugin.json`, anyone can run:

```bash
agy plugin install https://github.com/richuff/agy-context
```

### Option 2: Antigravity Marketplace (requires Google review)

Once listed, users can install with `agy plugin install agy-context` or find it in the App's **Marketplace** tab.

Prerequisites (already met by this project):

| Check | Status |
|---|---|
| `agy plugin validate` — zero errors | ✅ |
| `plugin.json` has `name` / `displayName` / `description` / `version` / `logo` / `suggestedPrompts` / `author` | ✅ |
| `README.md` + bundled 1:1 logo (`assets/logo.jpg`) | ✅ |
| Component paths follow the spec (`skills/`, `sidecars/`, etc.) | ✅ |

Submission: [Antigravity Marketplace partner intake form](https://forms.gle/2EX5RFYPoJe1UgxR9)

> `agy plugin validate --strict` reports one warning about a root `AGENTS.md` ("plugins load rules only from rules/").
> This is the **expected behavior for a multi-tool repo** per official docs — `AGENTS.md` is a standing constraint for contributors,
> intentionally kept out of `rules/` so it is not injected into end-user sessions. With the official CI filter excluding that file,
> there are 0 blocking issues.

### Release flow

1. Bump `version` in `plugin.json` (SemVer) and add release notes to `CHANGELOG.md`.
2. Run `agy plugin validate .` and `node test/test-stats.mjs`.
3. Commit, tag `v<version>`, and push the branch and tag.
4. Create a GitHub Release for the tag and attach a ZIP containing the plugin files.
5. Users uninstall/reinstall to get the new version.

---

## Data Sources

Everything is read from local files under `~/.gemini/antigravity/`:

| Data | Source |
|---|---|
| Session list, titles, steps | `conversation_summaries.db` |
| Token usage | `brain/<id>/.system_generated/logs/transcript.jsonl` → `input_tokens` / `cache_read_tokens` / `output_tokens` |
| Tool calls | transcript `tool_calls` |
| Commands & output | `tool_calls` `run_command` + `GENERIC` records |
| File operations | `tool_calls` `write_file` / `edit_file` / `read_file` |
| Context composition | Mapped to real tokens by each message type's character share |
| Context events | transcript event types and text (`GENERIC`, `PLANNER_RESPONSE`, `SYSTEM_MESSAGE`, `USER_INPUT`, etc.) plus `truncated_fields` |
| Model names | `conversations/<id>.db` `gen_metadata` |

### How context usage is computed

**Used = `input_tokens + cache_read_tokens` of the last request**

This is exact. The breakdown (system prompt / tool definitions / user messages / assistant messages / model thinking / tool results) is estimated from the character share of each message type in the transcript.

### How time is computed

Take the gap between adjacent event timestamps and classify it by **the type of the following event**:

| Following event | Classified as |
|---|---|
| `GENERIC` | Tool execution |
| `PLANNER_RESPONSE` + thinking | Model thinking |
| `PLANNER_RESPONSE` without thinking | Model reply |
| `SYSTEM_MESSAGE` | System overhead |
| `USER_INPUT` | Awaiting input |

Gaps > 5 minutes are treated as idle and excluded from active time.

Daily usage and hourly activity convert transcript timestamps to the computer's system local timezone before grouping. Context events are read from the active session transcript; the side panel can filter by event type and search the captured text. Displayed content is path-redacted and kept local.

---

## Privacy

All paths are redacted before display:

| Raw | Shown |
|---|---|
| `C:\Users\<user>\...` | `~\...` |
| `C:\Users\<user>\.gemini\antigravity\brain\<uuid>\scratch\x.exe` | `~\…\scratch\x.exe` |
| `D:\Mygit\foo\bar.hpp` | `…\foo\bar.hpp` |

- Home directory collapsed to `~`
- Deep paths compressed to `…\last two segments`
- Drive letters removed
- File lists show only filenames

The side panel never shows internal `.gemini` paths.

---

## Cost Estimation

Computed from public API pricing — **not an official bill**:

| Item | Unit price |
|---|---|
| Input | $1.25 / M tokens |
| Output | $10 / M tokens |
| Cache read | $0.31 / M tokens |

Override via environment variables:

```bash
AGY_PRICE_IN=1.25
AGY_PRICE_OUT=10
AGY_PRICE_CACHE=0.31
```

---

## Technical Implementation

| Component | Description |
|---|---|
| `plugin.json` | Plugin manifest |
| `sidecars/context-panel/sidecar.json` | Sidecar definition |
| `sidecars/context-panel/main.mjs` | CDP client that injects the panel into the Antigravity page |
| `sidecars/context-panel/panel.js` | Front-end UI (overview overlay + side card) |
| `sidecars/context-panel/i18n.js` | Standalone i18n DOM post-processing layer |
| `scripts/stats.mjs` | Statistics engine |
| `skills/agy-stats/SKILL.md` | Skill documentation |
| `assets/logo.jpg` | Plugin logo (1:1) |

### Injection

The sidecar connects to Antigravity over CDP:

1. Read `%APPDATA%\Antigravity\DevToolsActivePort` for the debug port
2. WebSocket to `/json/version` to get `webSocketDebuggerUrl`
3. `Target.attachToTarget` + `Runtime.evaluate` to inject `panel.js`
4. Push the latest stats every 5 seconds

After the page loads:

- Insert the "Context Overview" menu item in the sidebar
- Inject the current-session card into the right panel (expanded by default, with its own scroll area)

### Why not the official Sidecar WebUI

`sidecar.json` supports `has_web_ui` + `ui_config`; the official path mounts an iframe:

```html
<div data-testid="sidecar-iframe-slot"
     data-sidecar-id="agy-context/context-panel"
     data-visible="false">
```

But the entry UI is behind a feature flag:

```js
pluginSidebarSection: {
  feature: false,
  applyAll: [{ runtimeGating: { customFlag: "enable-plugin-sidebar-section" } }]
}
```

That flag is served by Google's Mendel experiment system and cannot be enabled locally, so CDP injection is used instead.

---

## Compatibility

| Item | Version |
|---|---|
| Antigravity | 2.32.1 (tested) |
| Node.js | 22+ (requires `node:sqlite`) |
| Platform | Windows (other platforms untested) |

---

## Known Limitations

- **Model name** is empty in some sessions (not recorded in transcript); falls back to `gen_metadata`
- **Context breakdown** is estimated; only the total is exact
- **No real compaction events**: Antigravity doesn't record context compaction; `truncated_fields` is only an approximation
- **Sub-agent titles** are mostly "(Untitled)" because Antigravity doesn't name them
- **Line-count delta** (`+16/-3`) can't be computed; only character volume is available

---

## Acknowledgements

The overview dashboard UI design and layout are inspired by and adapted from [dsh-context](https://github.com/deepseek-ai/dsh-context). Special thanks to the original project for the design inspiration.

---

## License

MIT
