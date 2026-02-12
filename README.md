# Slack History Import to Confluence

A desktop application that imports Slack channel export history into Confluence Cloud pages.

## Features

- **Embedded Confluence Login**: Opens Confluence in an embedded browser for secure authentication
- **Local Folder Selection**: Browse and select Slack export folders containing JSON files
- **Automatic Parsing**: Reads all daily JSON files (YYYY-MM-DD.json format) from the export
- **Rich Formatting**: Preserves message formatting, threads, reactions, and attachments
- **Date Separators**: Creates clear date headers between each day's messages
- **Thread Support**: Collapses thread replies into expandable sections

## Installation

### Prerequisites
- Node.js 18+ installed
- npm or yarn

### Setup

```bash
# Install dependencies
npm install

# Run the application (Windows)
start.bat

# Or use npm (may require clearing ELECTRON_RUN_AS_NODE env variable)
npm start
```

**Note for Windows users**: If you encounter issues with `npm start`, use `start.bat` instead. This is because some environments have `ELECTRON_RUN_AS_NODE` set which interferes with Electron.

### Build Executable

```bash
# Build for Windows
npm run build:win

# Build for macOS
npm run build:mac

# Build for Linux
npm run build:linux
```

The executable will be created in the `dist` folder.

## Usage

1. **Enter Confluence URL**: Provide your Confluence Cloud base URL (e.g., `https://your-domain.atlassian.net/wiki`)

2. **Enter Parent Page URL**: Provide the full URL of the Confluence page under which the new page will be created

3. **Select Slack Export Folder**: Browse to the folder containing your Slack channel export (the folder with YYYY-MM-DD.json files)

4. **Login to Confluence**: Click "Login to Confluence" - a browser window will open for authentication

5. **Start Import**: After successful login, review the summary and click "Start Import"

6. **View Result**: Once complete, click the link to open your newly created Confluence page

## Slack Export Format

The application expects Slack export files in the standard format:
- Each file named as `YYYY-MM-DD.json` (e.g., `2024-01-15.json`)
- Each file contains an array of message objects
- Messages include `ts`, `user`, `text`, `blocks`, `reactions`, `files`, etc.

## How It Works

1. Reads all JSON files from the selected folder
2. Sorts files chronologically by filename
3. Parses each file's messages, grouping threads together
4. Converts Slack message format to Confluence storage format (XHTML)
5. Creates a new Confluence page as a child of the specified parent page
6. The page title matches the folder name (channel name)

## Message Rendering

The application renders messages with:
- User avatar and display name
- Timestamp
- Rich text formatting (bold, italic, strikethrough, code)
- Links
- Emoji conversion
- Reactions with counts
- File attachments (as references)
- Thread replies in collapsible expand sections

## License

MIT
