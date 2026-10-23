# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A desktop Electron application that imports Slack channel export history (JSON files) into Confluence Cloud, preserving message formatting, threads, user mentions, reactions, and organizing content by month.

## Commands

```bash
npm start          # Run in development mode (Electron)
npm run build:win  # Build Windows NSIS installer + portable exe
npm run build:mac  # Build macOS DMG
npm run build:linux # Build Linux AppImage
npm run build      # Build for all platforms
```

`npm test` runs the Playwright suite: it launches the real app against a mock Confluence Cloud (`test/helpers/mock-confluence.js`) with generated Slack exports (`test/helpers/slack-export.js`). Set `ELECTRON_APP_EXE` to run it against a packaged build. There is no linter or formatter; the project has zero runtime dependencies.

## Architecture

The app uses a standard Electron 3-process model:

- **`src/main.js`** — Main process: file dialogs, Slack folder scanning, Confluence API requests (via Electron's `net` module with session cookies), 11 IPC handlers
- **`src/preload.js`** — Context-isolated IPC bridge exposing 6 safe API functions to the renderer
- **`src/renderer/app.js`** — Renderer: vanilla JavaScript (no framework), 1600+ lines driving a 4-step wizard UI
- **`src/renderer/index.html`** / **`styles.css`** — Markup and styling for the wizard

### 4-Step Wizard Flow

1. **Config** — Select Slack export folder, optional `users.json`, and Confluence parent page URL
2. **Login** — Embedded Confluence browser window for authentication
3. **Import** — Per-channel progress with lazy-loaded message data
4. **Complete** — Results summary with conflict resolution UI

### Data Flow

```
Slack export folder
  → Fast metadata scan (no file reads) — detects single vs. multi-channel mode
  → User picks parent Confluence page URL
  → Auth via embedded browser (cookies captured)
  → Per-channel: lazy-load JSON → group by month → render Confluence storage format (XHTML) → create/update pages via REST API
```

### Key Behaviors

**Dual-mode detection:** Single-channel exports (flat JSON files in root) vs. multi-channel exports (per-channel subfolders) are auto-detected during the metadata scan.

**Incremental updates:** Existing monthly pages are updated; only new date ranges are added. Pages are not recreated.

**Conflict resolution:** If a page title already exists elsewhere in the Confluence space, an interactive UI lets the user update-in-place or skip.

**Monthly pagination:** Messages split by month to avoid Confluence page size limits. Navigation links (`← Previous / Next →`) rendered as XHTML tables (not Confluence macros) for robustness.

**Single-page mode:** Channels with fewer than 10 files get a single combined page instead of monthly splits.

### Confluence API Calls (all in `main.js`)

- `GET /rest/api/content/{pageId}` — Fetch page details
- `GET /rest/api/content?spaceKey=&title=&expand=version` — Find existing pages by title
- `POST /rest/api/content` — Create new page
- `PUT /rest/api/content/{pageId}` — Update existing page
- `GET /rest/api/space` — Resolve space key from parent URL

### Slack → Confluence Conversion (in `app.js`)

The renderer converts Slack's message format to Confluence storage format (XHTML):
- Rich text: bold (`*`), italic (`_`), strikethrough (`~`), inline code, links
- User mentions: `<@U12345>` resolved via `users.json` userMap to display names
- Thread replies: grouped in expandable `<ac:structured-macro name="expand">` sections
- Reactions: rendered inline with counts
- File attachments: referenced by URL (not re-uploaded)
- Emoji: converted from `:emoji_name:` shortcodes

## Important Context

- **No TypeScript** — vanilla JavaScript throughout; no tsconfig, no webpack, no babel
- **Tests** — `npm test` (Playwright, drives the real Electron app; see Commands)
- **IPC security** — renderer has no direct file system or network access; all privileged operations go through `preload.js` → `main.js`
- **Electron `net` module** — used for Confluence API requests (not `fetch`/`axios`) so session cookies from the embedded login window are automatically included
- **`users.json`** — optional 1.5 MB Slack workspace export file mapping user IDs to display names; auto-detected if present in the export folder root
