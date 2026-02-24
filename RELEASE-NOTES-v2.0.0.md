# Slack History Import v2.0.0 — Release Notes

## How to Use

1. **Unzip** `Slack-History-Import-v2.0.0.zip`
2. Open the folder `Slack History Import-win32-x64`
3. Run **`Slack History Import.exe`**
4. Follow the 4-step wizard:
   - **Step 1 — Configure**: Select your Slack export folder, optionally load `users.json`, and enter your Confluence parent page URL
   - **Step 2 — Login**: Authenticate with Confluence using your email and API token
   - **Step 3 — Import**: Click "Start Import" and watch per-channel progress
   - **Step 4 — Complete**: Review results, handle any pages that need your decision

### Getting a Confluence API Token
1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click **Create API token**, give it a name, and copy the token
3. Use your Atlassian email + this token to log in

### Slack Export Folder Structure
The tool expects either:
- A **single channel folder** containing `YYYY-MM-DD.json` files
- A **multi-channel export folder** containing subfolders (one per channel), each with `YYYY-MM-DD.json` files

Optionally include `users.json` from the Slack export to resolve user mentions to real names.

---

## What's New in v2.0.0

### Multi-Channel Import
- Select a folder containing multiple channel subfolders — all channels are imported in one run
- Each channel gets its own parent page under your chosen Confluence parent page
- Messages are organized into **monthly child pages** (e.g., "general — January 2026")

### User Mention Resolution
- Load `users.json` from your Slack export to resolve `<@U12345>` mentions to real display names
- Works in both plain text messages and rich text blocks

### Monthly Page Organization
- Messages are grouped by month into separate Confluence pages
- Navigation links (← Previous Month / Next Month →) connect monthly pages
- Incremental imports: re-running only adds new dates, existing content is preserved

### Performance — Lazy Loading
- Folder scanning is now instant (metadata only, no file reading)
- Channel data is loaded one at a time during import, keeping memory usage low
- Large exports (100MB+) are handled without freezing

### Loading & Progress UI
- **Loading spinner** shown while scanning the selected folder
- **Per-channel progress** during import with live status:
  - ⏳ Pending — waiting to start
  - 🔄 In progress — shows current month being processed
  - ✅ Success — completed with summary
  - ❌ Error — failed with error message

### Smart Page Conflict Handling
- If a page with the same name already exists **under your parent page** → updated automatically (safe, it's your page)
- If a page exists **elsewhere in the Confluence space** → shown with a ⚠️ warning on the completion screen:
  - Clickable link to the existing page so you can inspect it
  - **"Update this page"** button to import into it
  - **"Skip"** button to leave it untouched

### Completion Screen
- Full results summary showing status of every channel
- Error details shown inline for failed channels
- Interactive resolution for pages found elsewhere

---

## Known Limitations
- Slack file attachments (images, PDFs) are referenced by URL but not re-uploaded to Confluence
- Very large individual messages may be truncated by Confluence's page size limits
- The tool uses Confluence REST API v1 (compatible with Confluence Cloud)
