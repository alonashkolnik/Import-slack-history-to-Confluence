# Slack History Import to Confluence

A desktop application that imports Slack channel export history into Confluence Cloud pages.

## Features

- **Multi-Channel Support**: Automatically detects if you have a single channel or multiple channels (folder of folders) to import
- **Incremental Import**: If a page already exists, only adds new dates instead of recreating the entire page
- **User Name Resolution**: Optionally provide a `users.json` file to resolve Slack user IDs to real names
- **Embedded Confluence Login**: Opens Confluence in an embedded browser for secure authentication
- **Smart Folder Detection**: Prioritizes channel subfolders over loose JSON files in the root
- **Local Folder Selection**: Browse and select Slack export folders containing JSON files
- **Automatic Parsing**: Reads all daily JSON files (YYYY-MM-DD.json format) from the export
- **Rich Formatting**: Preserves message formatting, threads, reactions, and attachments
- **Date Separators**: Creates clear date headers between each day's messages
- **Thread Support**: Collapses thread replies into expandable sections

## Distribution (For End Users)

The application is distributed as a **portable Windows executable** - no installation required.

### Getting the Application

1. Download the ZIP file: `SlackHistoryImport-v1.0.zip`
2. Extract the ZIP to any folder on your computer
3. Run `Slack History Import.exe`

### Requirements

- Windows 10 or later
- Internet connection for Confluence authentication
- Slack export folder with JSON files

## Installation (For Developers)

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

### Quick Start

1. **Run the application**: Double-click `Slack History Import.exe`

2. **Enter Parent Page URL**: Provide the full URL of the Confluence page where you want to create the import (e.g., `https://your-domain.atlassian.net/wiki/spaces/SPACE/pages/123456/Parent+Page`)

3. **Select Slack Export Folder**: Browse to your Slack export folder
   - For single channel: Select the folder containing `YYYY-MM-DD.json` files
   - For multiple channels: Select the parent folder containing channel subfolders (each with their own JSON files)

4. **Select Users File (Optional)**: Browse to the `users.json` file from your Slack export. This allows the app to display real names instead of user IDs.

5. **Login to Confluence**: Click "Login to Confluence" - a browser window will open for authentication. Navigate to any Confluence page after logging in.

6. **Start Import**: Review the summary and click "Start Import"

7. **View Result**: Once complete, click the link to open your newly created or updated Confluence page(s)

### Import Modes

**Single Channel Mode**: When you select a folder that directly contains `YYYY-MM-DD.json` files, the app creates one page with the folder name as the title.

**Multi-Channel Mode**: When you select a folder containing subfolders (each with JSON files), the app creates a child page for each channel under the parent page. The parent page URL you provide becomes the parent for all imported channels.

**Incremental Updates**: If a page with the same title already exists under the parent, the app will only add new dates (days) that aren't already present in the page. This prevents duplicates when re-importing.

## Slack Export Format

The application expects Slack export files in the standard format:

### Folder Structure

```
Slack_Export/
├── channel-name/           # Single channel folder
│   ├── 2024-01-15.json
│   ├── 2024-01-16.json
│   └── ...
└── users.json              # User data file (optional, for name resolution)
```

Or for multiple channels:

```
Slack_Export/
├── channel-one/            # First channel
│   ├── 2024-01-15.json
│   └── ...
├── channel-two/            # Second channel
│   ├── 2024-01-15.json
│   └── ...
└── users.json              # User data file (optional, for name resolution)
```

### File Format

- Each daily file named as `YYYY-MM-DD.json` (e.g., `2024-01-15.json`)
- Each file contains an array of message objects
- Messages include `ts`, `user`, `text`, `blocks`, `reactions`, `files`, etc.

### users.json

Optional file containing user information. When provided:
- Resolves Slack user IDs to real names
- Displays user avatars
- Makes messages more readable (e.g., "John Doe" instead of "U12345678")

## How It Works

1. Reads all JSON files from the selected folder
2. Sorts files chronologically by filename
3. Parses each file's messages, grouping threads together
4. Converts Slack message format to Confluence storage format (XHTML)
5. Creates a new Confluence page as a child of the specified parent page
6. The page title matches the folder name (channel name)

## Message Rendering

The application renders messages with:
- User avatar and display name (resolved from users.json if provided)
- Timestamp
- Rich text formatting (bold, italic, strikethrough, code)
- Links
- Emoji conversion
- Reactions with counts
- File attachments (as references)
- Thread replies in collapsible expand sections

## Troubleshooting

### "No Slack export files found" Error
- Ensure your export folder contains `YYYY-MM-DD.json` files
- For multi-channel imports, make sure channel folders contain JSON files
- Check that the JSON files are not in a nested subfolder

### Login Issues
- Make sure you're using a Confluence Cloud URL (not Server/Data Center)
- After logging in, navigate to any Confluence page to trigger the login detection
- If the login window doesn't close automatically, close it manually after seeing "Logged in successfully!"

### Users Not Resolving to Names
- Make sure to select the `users.json` file from the root of your Slack export
- The users.json must be from the same export as your channel data

### Large Exports
- For very large channels, the import may take several minutes
- The progress bar will show the current status
- For multi-channel imports, each channel is processed sequentially

## License

MIT
