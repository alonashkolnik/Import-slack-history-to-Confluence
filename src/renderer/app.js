// Application state
const state = {
  parentPageUrl: '',
  folderPath: '',
  folderName: '',
  usersFilePath: '',
  userMap: {},    // Map of user ID to user info
  mode: 'single', // 'single' or 'multi'
  channels: [],   // Metadata only: { channelName, folderPath, fileCount, dateNames }
  confluenceSession: null,
  baseUrl: '',
  spaceKey: '',
  parentPageId: '',
  importErrorLog: [] // { timestamp, channelName, pageTitle, operation, error }
};

// DOM Elements
const elements = {
  parentPageUrl: document.getElementById('parent-page-url'),
  folderPath: document.getElementById('folder-path'),
  usersFilePath: document.getElementById('users-file-path'),
  btnSelectFolder: document.getElementById('btn-select-folder'),
  btnSelectUsersFile: document.getElementById('btn-select-users-file'),
  usersInfo: document.getElementById('users-info'),
  usersCount: document.getElementById('users-count'),
  btnLogin: document.getElementById('btn-login'),
  btnImport: document.getElementById('btn-import'),
  btnRestart: document.getElementById('btn-restart'),
  btnDismissError: document.getElementById('btn-dismiss-error'),
  folderLoading: document.getElementById('folder-loading'),
  folderInfo: document.getElementById('folder-info'),
  folderName: document.getElementById('folder-name'),
  fileCount: document.getElementById('file-count'),
  channelProgressList: document.getElementById('channel-progress-list'),
  importResultsList: document.getElementById('import-results-list'),
  loginPending: document.getElementById('login-pending'),
  loginSuccess: document.getElementById('login-success'),
  importSummary: document.getElementById('import-summary'),
  summaryChannel: document.getElementById('summary-channel'),
  summaryFiles: document.getElementById('summary-files'),
  summaryDestination: document.getElementById('summary-destination'),
  importProgress: document.getElementById('import-progress'),
  progressFill: document.getElementById('progress-fill'),
  progressText: document.getElementById('progress-text'),
  pageLink: document.getElementById('page-link'),
  errorContainer: document.getElementById('error-container'),
  errorMessage: document.getElementById('error-message'),
  steps: {
    config: document.getElementById('step-config'),
    login: document.getElementById('step-login'),
    import: document.getElementById('step-import'),
    complete: document.getElementById('step-complete')
  }
};

// Initialize
function init() {
  // Event listeners
  elements.btnSelectFolder.addEventListener('click', handleSelectFolder);
  elements.btnSelectUsersFile.addEventListener('click', handleSelectUsersFile);
  elements.btnLogin.addEventListener('click', handleLogin);
  elements.btnImport.addEventListener('click', handleImport);
  elements.btnRestart.addEventListener('click', handleRestart);
  elements.btnDismissError.addEventListener('click', hideError);
  
  elements.parentPageUrl.addEventListener('input', validateConfig);

  // Listen for login completion from main process
  window.electronAPI.onConfluenceLoginComplete((data) => {
    handleLoginComplete(data);
  });
}

// Validate configuration and enable/disable login button
function validateConfig() {
  const parentPageUrl = elements.parentPageUrl.value.trim();
  const folderPath = elements.folderPath.value.trim();

  const hasData = state.channels.length > 0;
  const isValid = parentPageUrl && folderPath && hasData;
  elements.btnLogin.disabled = !isValid;
}

// Handle folder selection
async function handleSelectFolder() {
  try {
    const folderPath = await window.electronAPI.selectFolder();
    if (!folderPath) return;

    elements.folderPath.value = folderPath;
    state.folderPath = folderPath;

    // Show loading indicator
    elements.folderInfo.classList.add('hidden');
    elements.folderLoading.classList.remove('hidden');

    // Scan folder (metadata only - fast)
    const result = await window.electronAPI.readSlackFiles(folderPath);
    
    elements.folderLoading.classList.add('hidden');

    if (!result.success) {
      showError(result.error);
      return;
    }

    state.mode = result.mode;
    state.folderName = result.folderName;

    if (result.mode === 'single') {
      // Single channel: store as one-element channels array for uniform handling
      state.channels = [{
        channelName: result.folderName,
        folderPath: result.folderPath,
        fileCount: result.fileCount,
        dateNames: result.dateNames
      }];
      
      elements.folderName.textContent = result.folderName;
      elements.fileCount.textContent = `${result.fileCount} daily files (single channel)`;
    } else {
      // Multi-channel: metadata only
      state.channels = result.channels;
      
      const totalFiles = result.channels.reduce((sum, ch) => sum + ch.fileCount, 0);
      
      elements.folderName.textContent = result.folderName;
      elements.fileCount.textContent = `${result.channels.length} channels, ${totalFiles} daily files`;
    }
    
    elements.folderInfo.classList.remove('hidden');
    validateConfig();

    // Auto-detect users.json if not already loaded by the user
    if (result.usersFilePath && !state.usersFilePath) {
      const usersResult = await window.electronAPI.readUsersFile(result.usersFilePath);
      if (usersResult.success) {
        state.usersFilePath = result.usersFilePath;
        state.userMap = usersResult.userMap;
        elements.usersFilePath.value = result.usersFilePath + '  (auto-detected)';
        elements.usersCount.textContent = usersResult.count;
        elements.usersInfo.classList.remove('hidden');
      }
    }
  } catch (error) {
    elements.folderLoading.classList.add('hidden');
    showError('Failed to read folder: ' + error.message);
  }
}

// Handle users file selection
async function handleSelectUsersFile() {
  try {
    const filePath = await window.electronAPI.selectUsersFile();
    if (!filePath) return;

    elements.usersFilePath.value = filePath;
    state.usersFilePath = filePath;

    // Read and parse users file
    const result = await window.electronAPI.readUsersFile(filePath);
    
    if (!result.success) {
      showError(result.error);
      return;
    }

    state.userMap = result.userMap;
    
    elements.usersCount.textContent = result.count;
    elements.usersInfo.classList.remove('hidden');
  } catch (error) {
    showError('Failed to read users file: ' + error.message);
  }
}

// Parse parent page URL to extract space key and page ID
function parseConfluenceUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const search = urlObj.search;
    
    console.log('Parsing URL:', url);
    console.log('Pathname:', pathname);
    
    // Pattern 1: /wiki/spaces/SPACEKEY/pages/PAGEID/...
    const match = pathname.match(/\/wiki\/spaces\/([^\/]+)\/pages\/(\d+)/);
    if (match) {
      console.log('Matched pattern 1, pageId:', match[2]);
      return {
        baseUrl: urlObj.origin,
        spaceKey: match[1],
        pageId: match[2]
      };
    }
    
    // Pattern 2: /wiki/spaces/SPACEKEY/pages/edit-v2/PAGEID
    const editMatch = pathname.match(/\/wiki\/spaces\/([^\/]+)\/pages\/edit-v2\/(\d+)/);
    if (editMatch) {
      console.log('Matched pattern 2 (edit), pageId:', editMatch[2]);
      return {
        baseUrl: urlObj.origin,
        spaceKey: editMatch[1],
        pageId: editMatch[2]
      };
    }
    
    // Pattern 3: /wiki/pages/viewpage.action?pageId=PAGEID (check query string)
    const queryPageId = new URLSearchParams(search).get('pageId');
    if (queryPageId) {
      console.log('Matched pattern 3 (query), pageId:', queryPageId);
      return {
        baseUrl: urlObj.origin,
        spaceKey: null,
        pageId: queryPageId
      };
    }
    
    // Pattern 4: Just extract any number sequence that looks like a page ID from the path
    const anyPageIdMatch = pathname.match(/\/(\d{5,})/);
    if (anyPageIdMatch) {
      console.log('Matched pattern 4 (any digits), pageId:', anyPageIdMatch[1]);
      return {
        baseUrl: urlObj.origin,
        spaceKey: null,
        pageId: anyPageIdMatch[1]
      };
    }

    console.log('No pattern matched');
    return null;
  } catch (e) {
    console.error('URL parse error:', e);
    return null;
  }
}

// Handle login button click
async function handleLogin() {
  const parentPageUrl = elements.parentPageUrl.value.trim();

  // Parse the parent page URL
  const parsed = parseConfluenceUrl(parentPageUrl);
  if (!parsed) {
    showError('Invalid parent page URL. Please use a URL like: https://your-domain.atlassian.net/wiki/spaces/SPACE/pages/123456/Page+Title');
    return;
  }

  console.log('Parsed URL:', parsed);

  state.parentPageUrl = parentPageUrl;
  state.baseUrl = parsed.baseUrl;
  state.spaceKey = parsed.spaceKey;
  state.parentPageId = parsed.pageId;

  // Show login step
  showStep('login');

  // Open Confluence login window - use the base URL from the parent page
  await window.electronAPI.openConfluenceLogin(parsed.baseUrl + '/wiki');
}

// Handle login completion
function handleLoginComplete(data) {
  state.confluenceSession = data;
  state.baseUrl = data.baseUrl;

  // Update UI
  elements.loginPending.classList.add('hidden');
  elements.loginSuccess.classList.remove('hidden');

  // Close Confluence window
  window.electronAPI.closeConfluenceWindow();

  // Move to import step after a short delay
  setTimeout(() => {
    prepareImport();
    showStep('import');
  }, 1000);
}

// Prepare import summary
function prepareImport() {
  const totalFiles = state.channels.reduce((sum, ch) => sum + ch.fileCount, 0);
  if (state.channels.length === 1) {
    elements.summaryChannel.textContent = `Channel: ${state.channels[0].channelName}`;
    elements.summaryFiles.textContent = `${totalFiles} daily files`;
  } else {
    elements.summaryChannel.textContent = `Multi-channel import: ${state.channels.length} channels`;
    elements.summaryFiles.textContent = `${totalFiles} daily files total`;
  }
  elements.summaryDestination.innerHTML = `Parent Page ID: <strong>${state.parentPageId}</strong><br>Base URL: ${state.baseUrl}`;
}

// Handle import
async function handleImport() {
  elements.btnImport.disabled = true;
  elements.importProgress.classList.remove('hidden');

  // Build channel progress list UI
  buildChannelProgressList();

  try {
    await importAllChannels();
  } catch (error) {
    showError('Import failed: ' + error.message);
    elements.btnImport.disabled = false;
    elements.importProgress.classList.add('hidden');
  }
}

// Build the per-channel progress list in the UI
function buildChannelProgressList() {
  const list = elements.channelProgressList;
  list.innerHTML = '';
  list.classList.remove('hidden');

  for (const channel of state.channels) {
    const item = document.createElement('div');
    item.className = 'channel-item pending';
    item.id = `ch-progress-${channel.channelName}`;
    item.innerHTML = `
      <span class="channel-status-icon">⏳</span>
      <span class="channel-name">${escapeHtml(channel.channelName)}</span>
      <span class="channel-detail">${channel.fileCount} files</span>
      <div class="channel-error-msg"></div>
    `;
    list.appendChild(item);
  }
}

// Update a single channel's status in the progress list
function updateChannelStatus(channelName, status, detail, errorMsg) {
  const item = document.getElementById(`ch-progress-${channelName}`);
  if (!item) return;

  item.className = `channel-item ${status}`;
  const icon = item.querySelector('.channel-status-icon');
  const detailEl = item.querySelector('.channel-detail');
  const errorEl = item.querySelector('.channel-error-msg');

  switch (status) {
    case 'in-progress':
      icon.innerHTML = '<span class="spinner"></span>';
      break;
    case 'success':
      icon.textContent = '\u2705';
      break;
    case 'error':
      icon.textContent = '\u274C';
      if (errorMsg && errorEl) {
        errorEl.textContent = errorMsg;
      }
      break;
  }

  if (detail) {
    detailEl.textContent = detail;
  }
}

// Build the final results list shown on the completion screen
function buildImportResultsList(results) {
  const list = elements.importResultsList;
  list.innerHTML = '';
  list.classList.remove('hidden');

  // Remove any existing error log download link
  const existingLog = document.getElementById('import-error-log-section');
  if (existingLog) existingLog.remove();

  for (const r of results) {
    const item = document.createElement('div');

    if (r.existedElsewhere) {
      // "Exists elsewhere" — show link + Update/Skip buttons
      item.className = 'channel-item elsewhere';
      item.setAttribute('data-channel', r.channelName);
      item.innerHTML = `
        <span class="channel-status-icon">\u26A0\uFE0F</span>
        <div class="channel-elsewhere-info">
          <span class="channel-name">${escapeHtml(r.channelName)}</span>
          <div class="channel-elsewhere-detail">
            Page already exists elsewhere:
            <a href="${escapeHtml(r.elsewherePageUrl)}" target="_blank" class="elsewhere-link">${escapeHtml(r.elsewherePageUrl)}</a>
          </div>
          <div class="channel-elsewhere-actions">
            <button class="btn btn-small btn-primary btn-update-elsewhere" data-channel="${escapeHtml(r.channelName)}">Update this page</button>
            <button class="btn btn-small btn-secondary btn-skip-elsewhere" data-channel="${escapeHtml(r.channelName)}">Skip</button>
          </div>
        </div>
      `;
      list.appendChild(item);

      // Attach button handlers
      item.querySelector('.btn-update-elsewhere').addEventListener('click', () => handleUpdateElsewhere(r));
      item.querySelector('.btn-skip-elsewhere').addEventListener('click', () => handleSkipElsewhere(r.channelName));
    } else {
      const statusClass = r.success ? 'success' : 'error';
      const icon = r.success ? '\u2705' : '\u274C';
      const detail = r.success ? (r.summary || 'Done') : 'Failed';
      const errorHtml = r.message ? `<div class="channel-error-msg">${escapeHtml(r.message)}</div>` : '';

      item.className = `channel-item ${statusClass}`;
      item.innerHTML = `
        <span class="channel-status-icon">${icon}</span>
        <span class="channel-name">${escapeHtml(r.channelName)}</span>
        <span class="channel-detail">${escapeHtml(detail)}</span>
        ${errorHtml}
      `;
      list.appendChild(item);
    }
  }
}

// Handle user clicking "Update this page" for a channel that exists elsewhere
async function handleUpdateElsewhere(r) {
  const item = elements.importResultsList.querySelector(`[data-channel="${r.channelName}"]`);
  if (!item) return;

  // Replace buttons with spinner
  const actionsDiv = item.querySelector('.channel-elsewhere-actions');
  actionsDiv.innerHTML = '<div class="spinner"></div> Importing...';

  try {
    const spaceKey = state.lastSpaceKey;
    // Import using the elsewhere page as the channel parent
    const importResult = await importChannelMonthlyPagesInto(
      r.channelName, r.slackData, spaceKey, r.elsewherePageId
    );

    item.className = 'channel-item success';
    item.innerHTML = `
      <span class="channel-status-icon">\u2705</span>
      <span class="channel-name">${escapeHtml(r.channelName)}</span>
      <span class="channel-detail">${escapeHtml(importResult.summary)}</span>
    `;
  } catch (error) {
    item.className = 'channel-item error';
    item.innerHTML = `
      <span class="channel-status-icon">\u274C</span>
      <span class="channel-name">${escapeHtml(r.channelName)}</span>
      <span class="channel-detail">Failed</span>
      <div class="channel-error-msg">${escapeHtml(error.message)}</div>
    `;
  }
}

// Handle user clicking "Skip" for a channel that exists elsewhere
function handleSkipElsewhere(channelName) {
  const item = elements.importResultsList.querySelector(`[data-channel="${channelName}"]`);
  if (!item) return;

  item.className = 'channel-item pending';
  item.innerHTML = `
    <span class="channel-status-icon">\u23ED\uFE0F</span>
    <span class="channel-name">${escapeHtml(channelName)}</span>
    <span class="channel-detail">Skipped by user</span>
  `;
}

// Import monthly pages into an existing channel parent page (used for "elsewhere" resolution)
async function importChannelMonthlyPagesInto(channelName, slackData, spaceKey, channelPageId) {
  const monthsMap = groupByMonth(slackData);
  const monthKeys = Array.from(monthsMap.keys());
  const totalMonths = monthKeys.length;
  const channelAnalysis = buildThreadMapAcrossDays(slackData);

  let createdCount = 0;
  let skippedCount = 0;
  let elsewhereCount = 0;

  // Pre-fetch existing children page IDs for correct nav link URLs
  const existingChildren = await getPageChildren(channelPageId);
  const monthPageIds = new Map(existingChildren.map(c => [c.title, c.id]));
  const pageVersions = new Map();
  const newlyCreatedTitles = new Set();
  const baseUrl = state.baseUrl || '';

  for (let i = 0; i < totalMonths; i++) {
    const monthKey = monthKeys[i];
    const prevMonthKey = i > 0 ? monthKeys[i - 1] : null;
    const nextMonthKey = i < totalMonths - 1 ? monthKeys[i + 1] : null;

    const monthTitle = buildMonthlyPageTitle(channelName, monthKey);
    const monthData = monthsMap.get(monthKey);

    const prevLabel = prevMonthKey ? formatMonthLabel(prevMonthKey) : null;
    const nextLabel = nextMonthKey ? formatMonthLabel(nextMonthKey) : null;
    const prevId = prevMonthKey ? monthPageIds.get(buildMonthlyPageTitle(channelName, prevMonthKey)) : null;
    const nextId = nextMonthKey ? monthPageIds.get(buildMonthlyPageTitle(channelName, nextMonthKey)) : null;
    const prevUrl = prevId ? `${baseUrl}/wiki/spaces/${spaceKey}/pages/${prevId}` : null;
    const nextUrl = nextId ? `${baseUrl}/wiki/spaces/${spaceKey}/pages/${nextId}` : null;

    const monthContent = buildMonthlyPageContent(channelName, monthKey, monthData, prevUrl, prevLabel, nextUrl, nextLabel, channelAnalysis);

    const existingMonthPage = await findExistingPage(monthTitle, spaceKey, channelPageId);

    if (existingMonthPage) {
      monthPageIds.set(monthTitle, existingMonthPage.id);
      const existingDates = extractExistingDates(existingMonthPage.content);
      const { newDatesCount } = buildIncrementalContent(monthData, existingDates);
      const forceRebuild = monthHasCrossDateThreads(monthData, channelAnalysis);

      if (newDatesCount === 0 && !forceRebuild) {
        skippedCount++;
        pageVersions.set(monthTitle, existingMonthPage.version);
        const needsNavUpdate = checkNavLinksNeedUpdate(existingMonthPage.content, channelName, prevMonthKey, nextMonthKey);
        if (needsNavUpdate) {
          const updatedContent = buildMonthlyPageContent(channelName, monthKey, monthData, prevUrl, prevLabel, nextUrl, nextLabel, channelAnalysis);
          await updatePageContent(existingMonthPage.id, monthTitle, updatedContent, existingMonthPage.version);
          pageVersions.set(monthTitle, existingMonthPage.version + 1);
        }
        continue;
      }

      const updatedContent = buildMonthlyPageContent(channelName, monthKey, monthData, prevUrl, prevLabel, nextUrl, nextLabel, channelAnalysis);
      const updateResult = await updatePageContent(existingMonthPage.id, monthTitle, updatedContent, existingMonthPage.version);
      if (updateResult.success) {
        createdCount++;
        pageVersions.set(monthTitle, existingMonthPage.version + 1);
      } else {
        pageVersions.set(monthTitle, existingMonthPage.version);
        logImportError(channelName, monthTitle, 'update page', updateResult.error);
      }
    } else {
      const createResult = await createNewPage(monthTitle, monthContent, spaceKey, channelPageId);
      if (createResult.success) {
        createdCount++;
        monthPageIds.set(monthTitle, createResult.pageId);
        pageVersions.set(monthTitle, 1);
        newlyCreatedTitles.add(monthTitle);
      } else if (createResult.existsElsewhere) {
        elsewhereCount++;
      } else {
        logImportError(channelName, monthTitle, 'create page', createResult.error);
      }
    }
  }

  // Second pass: back-fill "next" links for pages whose next-month was just created in this run
  for (let i = 0; i < totalMonths - 1; i++) {
    const nextMonthKey = monthKeys[i + 1];
    const nextTitle = buildMonthlyPageTitle(channelName, nextMonthKey);
    if (!newlyCreatedTitles.has(nextTitle)) continue;

    const monthKey = monthKeys[i];
    const prevMonthKey = i > 0 ? monthKeys[i - 1] : null;
    const currentTitle = buildMonthlyPageTitle(channelName, monthKey);
    const currentPageId = monthPageIds.get(currentTitle);
    const currentVersion = pageVersions.get(currentTitle);
    if (!currentPageId || currentVersion === undefined) continue;

    const prevLabel = prevMonthKey ? formatMonthLabel(prevMonthKey) : null;
    const prevId = prevMonthKey ? monthPageIds.get(buildMonthlyPageTitle(channelName, prevMonthKey)) : null;
    const prevUrl = prevId ? `${baseUrl}/wiki/spaces/${spaceKey}/pages/${prevId}` : null;
    const nextLabel = formatMonthLabel(nextMonthKey);
    const nextId = monthPageIds.get(nextTitle);
    const nextUrl = nextId ? `${baseUrl}/wiki/spaces/${spaceKey}/pages/${nextId}` : null;

    const monthData = monthsMap.get(monthKey);
    const updatedContent = buildMonthlyPageContent(channelName, monthKey, monthData, prevUrl, prevLabel, nextUrl, nextLabel, channelAnalysis);
    const navUpdateResult = await updatePageContent(currentPageId, currentTitle, updatedContent, currentVersion);
    if (!navUpdateResult.success) {
      logImportError(channelName, currentTitle, 'update next-link', navUpdateResult.error);
    }
  }

  let summary = `${createdCount} month(s) created/updated, ${skippedCount} up to date`;
  if (elsewhereCount > 0) summary += `, ${elsewhereCount} skipped (exist elsewhere)`;
  return { summary };
}

// ==================== Monthly Page Utilities ====================

// Group slackData (array of { dateName, messages }) by month key "YYYY-MM"
function groupByMonth(slackData) {
  const months = new Map(); // key: "YYYY-MM", value: [dayData, ...]
  for (const dayData of slackData) {
    // dateName is like "2026-01-05"
    const monthKey = dayData.dateName.substring(0, 7); // "2026-01"
    if (!months.has(monthKey)) {
      months.set(monthKey, []);
    }
    months.get(monthKey).push(dayData);
  }
  // Return sorted by month key
  return new Map([...months.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

// Format month key "2026-01" to human-readable "January 2026"
function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-');
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${monthNames[parseInt(month, 10) - 1]} ${year}`;
}

// Build the monthly page title: "<channelName> - January 2026"
function buildMonthlyPageTitle(channelName, monthKey) {
  return `${channelName} - ${formatMonthLabel(monthKey)}`;
}

// Build a channel-wide (or arbitrary scope) thread analysis.
// Lets thread replies attach to their parent regardless of which day or month they live in.
//   threads: thread_ts -> [replies sorted by ts]
//   parentTsSet: ts values of all messages that act as thread parents (non-reply messages)
//   parentDateByTs: ts -> dateName of the parent message
//   replyDatesByThreadTs: thread_ts -> Set of dateNames where replies appear
function buildThreadMapAcrossDays(daysData) {
  const threads = new Map();
  const parentTsSet = new Set();
  const parentDateByTs = new Map();
  const replyDatesByThreadTs = new Map();

  for (const dayData of daysData) {
    for (const msg of dayData.messages) {
      if (msg.thread_ts && msg.thread_ts !== msg.ts) {
        if (!threads.has(msg.thread_ts)) {
          threads.set(msg.thread_ts, []);
        }
        threads.get(msg.thread_ts).push(msg);
        if (!replyDatesByThreadTs.has(msg.thread_ts)) {
          replyDatesByThreadTs.set(msg.thread_ts, new Set());
        }
        replyDatesByThreadTs.get(msg.thread_ts).add(dayData.dateName);
      } else if (msg.ts) {
        parentTsSet.add(msg.ts);
        parentDateByTs.set(msg.ts, dayData.dateName);
      }
    }
  }
  for (const replies of threads.values()) {
    replies.sort((a, b) => parseFloat(a.ts || '0') - parseFloat(b.ts || '0'));
  }
  return { threads, parentTsSet, parentDateByTs, replyDatesByThreadTs };
}

// True if any thread parent in `monthData` has replies on different dates anywhere in the channel,
// or if any reply in `monthData` has a parent on a different date anywhere in the channel.
// Used to force a re-import rebuild for pages saved before the cross-day/month thread fix.
function monthHasCrossDateThreads(monthData, channelAnalysis) {
  const { parentDateByTs, replyDatesByThreadTs } = channelAnalysis;
  for (const dayData of monthData) {
    for (const msg of dayData.messages) {
      if (msg.thread_ts && msg.thread_ts !== msg.ts) {
        const parentDate = parentDateByTs.get(msg.thread_ts);
        if (parentDate && parentDate !== dayData.dateName) return true;
      } else if (msg.ts) {
        const replyDates = replyDatesByThreadTs.get(msg.ts);
        if (replyDates) {
          for (const rd of replyDates) {
            if (rd !== dayData.dateName) return true;
          }
        }
      }
    }
  }
  return false;
}

// Render a thread block (expand macro) for a parent message's replies.
function renderThreadBlock(replies) {
  let html = `<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">💬 Thread replies (${replies.length})</ac:parameter><ac:rich-text-body>\n`;
  for (const reply of replies) {
    html += renderMessage(reply, true);
  }
  html += '</ac:rich-text-body></ac:structured-macro>\n';
  return html;
}

// Render one day's messages using a thread map shared across days.
// Replies whose parent lives in the same scope (parentTsSet) are rendered under that parent,
// not as standalone messages on the reply's own date.
function renderDayMessages(messages, threads, parentTsSet) {
  let html = '';
  for (const msg of messages) {
    const isReply = msg.thread_ts && msg.thread_ts !== msg.ts;

    if (isReply) {
      if (parentTsSet.has(msg.thread_ts)) {
        // Parent is in this scope — will be rendered under parent's thread block
        continue;
      }
      // Orphan: parent is outside this scope (different month, or missing). Render standalone.
      html += renderMessage(msg, true);
      continue;
    }

    html += renderMessage(msg);
    if (msg.ts && threads.has(msg.ts)) {
      html += renderThreadBlock(threads.get(msg.ts));
    }
  }
  return html;
}

// Build channel parent page content
function buildChannelParentContent(channelName) {
  let html = `<h1>Slack Channel: ${escapeHtml(channelName)}</h1>\n`;
  html += `<p><em>Imported on ${new Date().toLocaleString()}</em></p>\n`;
  html += '<ac:structured-macro ac:name="children"><ac:parameter ac:name="sort">title</ac:parameter></ac:structured-macro>\n';
  return html;
}

// Build navigation links for a monthly page (prevUrl/nextUrl are full Confluence page URLs or null)
function buildNavLinks(prevUrl, prevLabel, nextUrl, nextLabel) {
  let html = '<table style="width: 100%; border-top: 2px solid #dfe1e6; border-bottom: 2px solid #dfe1e6; margin: 16px 0; padding: 0;"><tbody><tr>';
  html += '<td style="text-align: left; padding: 12px 8px; font-size: 16px; font-weight: bold;">';
  if (prevLabel) {
    if (prevUrl) {
      html += `<a href="${escapeHtml(prevUrl)}">&larr; ${escapeHtml(prevLabel)}</a>`;
    } else {
      html += `&larr; ${escapeHtml(prevLabel)}`;
    }
  }
  html += '</td>';
  html += '<td style="text-align: right; padding: 12px 8px; font-size: 16px; font-weight: bold;">';
  if (nextLabel) {
    if (nextUrl) {
      html += `<a href="${escapeHtml(nextUrl)}">${escapeHtml(nextLabel)} &rarr;</a>`;
    } else {
      html += `${escapeHtml(nextLabel)} &rarr;`;
    }
  }
  html += '</td>';
  html += '</tr></tbody></table>\n';
  return html;
}

// Build content for a single monthly page
// prevUrl/nextUrl: full Confluence page URLs (or null if page doesn't exist yet)
// prevLabel/nextLabel: human-readable month labels (or null)
function buildMonthlyPageContent(channelName, monthKey, monthData, prevUrl, prevLabel, nextUrl, nextLabel, channelAnalysis) {
  let html = `<h1>${escapeHtml(channelName)} - ${escapeHtml(formatMonthLabel(monthKey))}</h1>\n`;
  html += `<p><em>Imported on ${new Date().toLocaleString()}</em></p>\n`;

  // Navigation at top
  html += buildNavLinks(prevUrl, prevLabel, nextUrl, nextLabel);

  // Use channel-wide analysis if provided; threads spanning months attach to their parent's month page.
  // Falls back to per-month scope if caller didn't pass one.
  const analysis = channelAnalysis || buildThreadMapAcrossDays(monthData);
  const { threads, parentTsSet } = analysis;

  for (const dayData of monthData) {
    html += `<h2>📅 ${escapeHtml(dayData.dateName)}</h2>\n`;
    html += '<hr/>\n';
    html += renderDayMessages(dayData.messages, threads, parentTsSet);
  }

  // Navigation at bottom
  html += buildNavLinks(prevUrl, prevLabel, nextUrl, nextLabel);

  return html;
}

// ==================== Import Logic ====================

// Unified import: handles both single and multi-channel with lazy loading
async function importAllChannels() {
  const totalChannels = state.channels.length;
  const results = [];

  // Reset error log for this run
  state.importErrorLog = [];

  // Resolve space key once
  const spaceKeyResolved = await resolveSpaceKey(state.spaceKey, state.parentPageId);
  if (!spaceKeyResolved) {
    throw new Error('Could not determine space key from parent page');
  }

  for (let i = 0; i < totalChannels; i++) {
    const channel = state.channels[i];
    const progressStart = Math.round((i / totalChannels) * 90) + 5;
    const progressEnd = Math.round(((i + 1) / totalChannels) * 90) + 5;

    updateChannelStatus(channel.channelName, 'in-progress', 'Loading data...');
    updateProgress(progressStart, `Loading channel ${i + 1}/${totalChannels}: ${channel.channelName}...`);

    try {
      // Lazy-load channel data from disk
      const dataResult = await window.electronAPI.readChannelData(channel.folderPath);
      if (!dataResult.success) {
        throw new Error(dataResult.error);
      }

      const slackData = dataResult.data;
      updateChannelStatus(channel.channelName, 'in-progress', `${slackData.length} days loaded, importing...`);

      // Import this channel with monthly pages
      const importResult = await importChannelWithMonthlyPages(
        channel.channelName, slackData, spaceKeyResolved, state.parentPageId, progressStart, progressEnd
      );

      if (importResult.existedElsewhere) {
        // Channel page exists elsewhere — needs user decision
        updateChannelStatus(channel.channelName, 'pending', 'Exists elsewhere — awaiting your decision');
        results.push({
          channelName: channel.channelName,
          success: true,
          summary: importResult.summary,
          existedElsewhere: true,
          elsewherePageId: importResult.elsewherePageId,
          elsewherePageUrl: importResult.elsewherePageUrl,
          folderPath: channel.folderPath,
          slackData: slackData
        });
      } else {
        updateChannelStatus(channel.channelName, 'success', importResult.summary);
        results.push({ channelName: channel.channelName, success: true, summary: importResult.summary });
      }
    } catch (error) {
      updateChannelStatus(channel.channelName, 'error', 'Failed', error.message);
      results.push({ channelName: channel.channelName, success: false, message: error.message });
    }
  }

  // Store for use by completion screen
  state.lastImportResults = results;
  state.lastSpaceKey = spaceKeyResolved;

  const successes = results.filter(r => r.success && !r.existedElsewhere).length;
  const elsewhere = results.filter(r => r.existedElsewhere).length;
  const failures = results.filter(r => !r.success).length;

  let statusMsg = `${successes} channels imported`;
  if (elsewhere > 0) statusMsg += `, ${elsewhere} need your decision`;
  if (failures > 0) statusMsg += `, ${failures} failed`;
  updateProgress(100, statusMsg);

  const parentPageUrl = `${state.baseUrl}/wiki/spaces/${spaceKeyResolved}/pages/${state.parentPageId}`;
  elements.pageLink.href = parentPageUrl;

  const successMessage = document.querySelector('.success-box p');
  if (successMessage) {
    let msg = '';
    if (successes > 0) msg += `${successes} channels imported successfully.`;
    if (elsewhere > 0) msg += `${msg ? '<br>' : ''}${elsewhere} channels found elsewhere in space — please decide below.`;
    if (failures > 0) msg += `${msg ? '<br>' : ''}${failures} channels had errors.`;
    if (!msg) msg = 'Import complete.';
    successMessage.innerHTML = msg;
  }

  // Reset error log before building list (accumulated during this run)
  // Build results list on completion screen
  buildImportResultsList(results);

  // Append error log download link if any errors occurred
  if (state.importErrorLog.length > 0) {
    const logLines = state.importErrorLog.map(e =>
      `[${e.timestamp}] ${e.operation.toUpperCase()} "${e.pageTitle}" (channel: ${e.channelName})\nError: ${e.error}\n`
    ).join('\n');
    const blob = new Blob([logLines], { type: 'text/plain' });
    const blobUrl = URL.createObjectURL(blob);
    const fileName = `import-errors-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    const section = document.createElement('div');
    section.id = 'import-error-log-section';
    section.style.cssText = 'margin-top: 16px; padding: 12px; background: #fff3f3; border: 1px solid #f5a0a0; border-radius: 6px;';
    section.innerHTML = `
      <p style="margin: 0 0 8px 0; color: #c0392b; font-weight: bold;">⚠️ ${state.importErrorLog.length} error(s) occurred during import</p>
      <a href="${blobUrl}" download="${fileName}" class="btn btn-secondary" style="font-size: 13px;">📄 Download Error Log</a>
    `;
    elements.importResultsList.parentElement.insertBefore(section, elements.importResultsList.nextSibling);
  }

  showStep('complete');
}

// Core: import a single channel as parent page + monthly child pages
// Returns { summary } string for the channel progress UI
async function importChannelWithMonthlyPages(channelName, slackData, spaceKeyResolved, parentPageId, progressStart, progressEnd) {
  const monthsMap = groupByMonth(slackData);
  const monthKeys = Array.from(monthsMap.keys()); // sorted
  const totalMonths = monthKeys.length;
  // Channel-wide thread analysis: cross-month replies nest under their parent's month page.
  const channelAnalysis = buildThreadMapAcrossDays(slackData);

  // Create or find the channel parent page
  const channelParentContent = buildChannelParentContent(channelName);
  const channelPage = await findOrCreatePage(channelName, channelParentContent, spaceKeyResolved, parentPageId);
  if (!channelPage.success) {
    throw new Error(channelPage.error);
  }

  // If channel parent page exists elsewhere (not under our parent), return for user decision
  if (channelPage.existedElsewhere) {
    return {
      summary: `Page "${channelName}" already exists elsewhere in the space`,
      existedElsewhere: true,
      elsewherePageId: channelPage.pageId,
      elsewherePageUrl: channelPage.pageUrl
    };
  }

  const channelPageId = channelPage.pageId;

  // Set link (useful for single-channel mode)
  elements.pageLink.href = channelPage.pageUrl;

  // DECISION: If channel has <10 files, import all content into single parent page (no monthly subpages)
  // BUT: if the channel already has monthly subpages, continue using them for consistency
  const existingChildren = await getPageChildren(channelPageId);
  const hasMonthlySubpages = existingChildren.length > 0;

  if (slackData.length < 10 && !hasMonthlySubpages) {
    return await importChannelSinglePage(channelName, slackData, spaceKeyResolved, channelPageId, channelPage.pageUrl, channelPage.version, progressStart, progressEnd);
  }

  // Create monthly child pages
  let createdCount = 0;
  let skippedCount = 0;
  let elsewhereCount = 0;

  // Use already-fetched existingChildren for nav link URLs
  const monthPageIds = new Map(existingChildren.map(c => [c.title, c.id]));
  const pageVersions = new Map(); // title → last known version after first pass
  const newlyCreatedTitles = new Set();
  const baseUrl = state.baseUrl || '';

  for (let i = 0; i < totalMonths; i++) {
    const monthKey = monthKeys[i];
    const prevMonthKey = i > 0 ? monthKeys[i - 1] : null;
    const nextMonthKey = i < totalMonths - 1 ? monthKeys[i + 1] : null;

    const progress = progressStart + ((i / totalMonths) * (progressEnd - progressStart));
    updateProgress(Math.round(progress), `${channelName}: ${formatMonthLabel(monthKey)} (${i + 1}/${totalMonths})`);
    updateChannelStatus(channelName, 'in-progress', `${formatMonthLabel(monthKey)} (${i + 1}/${totalMonths})`);

    const monthTitle = buildMonthlyPageTitle(channelName, monthKey);
    const monthData = monthsMap.get(monthKey);

    const prevLabel = prevMonthKey ? formatMonthLabel(prevMonthKey) : null;
    const nextLabel = nextMonthKey ? formatMonthLabel(nextMonthKey) : null;
    const prevId = prevMonthKey ? monthPageIds.get(buildMonthlyPageTitle(channelName, prevMonthKey)) : null;
    const nextId = nextMonthKey ? monthPageIds.get(buildMonthlyPageTitle(channelName, nextMonthKey)) : null;
    const prevUrl = prevId ? `${baseUrl}/wiki/spaces/${spaceKeyResolved}/pages/${prevId}` : null;
    const nextUrl = nextId ? `${baseUrl}/wiki/spaces/${spaceKeyResolved}/pages/${nextId}` : null;

    const monthContent = buildMonthlyPageContent(channelName, monthKey, monthData, prevUrl, prevLabel, nextUrl, nextLabel, channelAnalysis);

    // Check if monthly page already exists under channel parent
    const existingMonthPage = await findExistingPage(monthTitle, spaceKeyResolved, channelPageId);

    if (existingMonthPage) {
      monthPageIds.set(monthTitle, existingMonthPage.id);
      // Page is a subpage — safe to update
      const existingDates = extractExistingDates(existingMonthPage.content);
      const { html: newContent, newDatesCount } = buildIncrementalContent(monthData, existingDates);
      // Force rebuild on re-import if any thread in this month spans dates (within-month or cross-month) —
      // pages saved before the fix may be missing reply continuations that lived in a different file.
      const forceRebuild = monthHasCrossDateThreads(monthData, channelAnalysis);

      if (newDatesCount === 0 && !forceRebuild) {
        skippedCount++;
        pageVersions.set(monthTitle, existingMonthPage.version);

        // Still update nav links if neighbors changed
        const needsNavUpdate = checkNavLinksNeedUpdate(existingMonthPage.content, channelName, prevMonthKey, nextMonthKey);
        if (needsNavUpdate) {
          const updatedContent = buildMonthlyPageContent(channelName, monthKey, monthData, prevUrl, prevLabel, nextUrl, nextLabel, channelAnalysis);
          await updatePageContent(existingMonthPage.id, monthTitle, updatedContent, existingMonthPage.version);
          pageVersions.set(monthTitle, existingMonthPage.version + 1);
        }
        continue;
      }

      // Rebuild the full monthly page with all dates
      const updatedContent = buildMonthlyPageContent(channelName, monthKey, monthData, prevUrl, prevLabel, nextUrl, nextLabel, channelAnalysis);
      const updateResult = await updatePageContent(existingMonthPage.id, monthTitle, updatedContent, existingMonthPage.version);
      if (updateResult.success) {
        createdCount++;
        pageVersions.set(monthTitle, existingMonthPage.version + 1);
      } else {
        pageVersions.set(monthTitle, existingMonthPage.version);
        logImportError(channelName, monthTitle, 'update page', updateResult.error);
      }
    } else {
      // Try to create new monthly page
      const createResult = await createNewPage(monthTitle, monthContent, spaceKeyResolved, channelPageId);
      if (createResult.success) {
        createdCount++;
        monthPageIds.set(monthTitle, createResult.pageId);
        pageVersions.set(monthTitle, 1);
        newlyCreatedTitles.add(monthTitle);
      } else if (createResult.existsElsewhere) {
        // Page exists elsewhere in space — skip it, don't update without permission
        elsewhereCount++;
        console.log(`Skipping "${monthTitle}" — exists elsewhere in space`);
      } else {
        console.error(`Failed to create page ${monthTitle}:`, createResult.error);
        logImportError(channelName, monthTitle, 'create page', createResult.error);
      }
    }
  }

  // Second pass: back-fill "next" links for pages whose next-month was just created in this run
  for (let i = 0; i < totalMonths - 1; i++) {
    const nextMonthKey = monthKeys[i + 1];
    const nextTitle = buildMonthlyPageTitle(channelName, nextMonthKey);
    if (!newlyCreatedTitles.has(nextTitle)) continue;

    const monthKey = monthKeys[i];
    const prevMonthKey = i > 0 ? monthKeys[i - 1] : null;
    const currentTitle = buildMonthlyPageTitle(channelName, monthKey);
    const currentPageId = monthPageIds.get(currentTitle);
    const currentVersion = pageVersions.get(currentTitle);
    if (!currentPageId || currentVersion === undefined) continue;

    const prevLabel = prevMonthKey ? formatMonthLabel(prevMonthKey) : null;
    const prevId = prevMonthKey ? monthPageIds.get(buildMonthlyPageTitle(channelName, prevMonthKey)) : null;
    const prevUrl = prevId ? `${baseUrl}/wiki/spaces/${spaceKeyResolved}/pages/${prevId}` : null;
    const nextLabel = formatMonthLabel(nextMonthKey);
    const nextId = monthPageIds.get(nextTitle);
    const nextUrl = nextId ? `${baseUrl}/wiki/spaces/${spaceKeyResolved}/pages/${nextId}` : null;

    const monthData = monthsMap.get(monthKey);
    const updatedContent = buildMonthlyPageContent(channelName, monthKey, monthData, prevUrl, prevLabel, nextUrl, nextLabel, channelAnalysis);
    const navUpdateResult = await updatePageContent(currentPageId, currentTitle, updatedContent, currentVersion);
    if (!navUpdateResult.success) {
      logImportError(channelName, currentTitle, 'update next-link', navUpdateResult.error);
    }
  }

  let summary = `${createdCount} month(s) created/updated, ${skippedCount} up to date`;
  if (elsewhereCount > 0) {
    summary += `, ${elsewhereCount} skipped (exist elsewhere in space)`;
  }
  return { summary };
}

// Import a channel as a single page (no monthly subpages) — for channels with <10 files
// Supports incremental updates
async function importChannelSinglePage(channelName, slackData, spaceKeyResolved, channelPageId, channelPageUrl, currentVersion, progressStart, progressEnd) {
  updateProgress(Math.round(progressStart), `${channelName}: importing ${slackData.length} days into single page...`);
  updateChannelStatus(channelName, 'in-progress', `Importing ${slackData.length} days...`);

  // Fetch the latest page state to get current version and existing content
  const existingPage = await getPageById(channelPageId);
  let existingDates = new Set();
  let version = existingPage ? existingPage.version : currentVersion;

  if (existingPage && existingPage.content) {
    existingDates = extractExistingDates(existingPage.content);
  }

  // Build incremental content (only new dates)
  const { html: newContent, newDatesCount } = buildIncrementalContent(slackData, existingDates);
  // Force rebuild on re-import if any thread in this channel spans dates — pages saved before
  // the fix may be missing reply continuations that lived in a different day's file.
  const channelAnalysis = buildThreadMapAcrossDays(slackData);
  const forceRebuild = monthHasCrossDateThreads(slackData, channelAnalysis);

  if (newDatesCount === 0 && !forceRebuild) {
    updateProgress(Math.round(progressEnd), `${channelName}: up to date`);
    return { summary: `${slackData.length} days already imported, 0 new` };
  }

  // Build full page content: header + children macro + all messages
  let fullContent = `<h1>Slack Channel: ${escapeHtml(channelName)}</h1>\n`;
  fullContent += `<p><em>Imported on ${new Date().toLocaleString()}</em></p>\n`;
  fullContent += '<ac:structured-macro ac:name="children"><ac:parameter ac:name="sort">title</ac:parameter></ac:structured-macro>\n';

  // Thread map across the entire channel — keeps cross-day and cross-month threads intact.
  const { threads, parentTsSet } = channelAnalysis;

  // Append all existing content (rebuild from slackData to maintain order)
  for (const dayData of slackData) {
    fullContent += `<h2>📅 ${escapeHtml(dayData.dateName)}</h2>\n`;
    fullContent += '<hr/>\n';
    fullContent += renderDayMessages(dayData.messages, threads, parentTsSet);
  }

  // Update the page with full content
  const updateResult = await updatePageContent(channelPageId, channelName, fullContent, version);
  if (!updateResult.success) {
    logImportError(channelName, channelName, 'update single-page', updateResult.error);
    throw new Error(`Failed to update page: ${updateResult.error}`);
  }

  updateProgress(Math.round(progressEnd), `${channelName}: ${newDatesCount} new days imported`);
  return { summary: `${slackData.length} days imported (single page), ${newDatesCount} new` };
}

// Check if navigation links need updating (e.g., a new month was added)
function checkNavLinksNeedUpdate(existingContent, channelName, prevMonthKey, nextMonthKey) {
  if (prevMonthKey) {
    const prevLabel = formatMonthLabel(prevMonthKey);
    if (!existingContent.includes(prevLabel)) return true;
  }
  if (nextMonthKey) {
    const nextLabel = formatMonthLabel(nextMonthKey);
    if (!existingContent.includes(nextLabel)) return true;
  }
  return false;
}

// ==================== Confluence API Helpers ====================

// Get all child pages of a given page (returns array of { id, title })
async function getPageChildren(pageId) {
  const response = await window.electronAPI.confluenceApiRequest({
    method: 'GET',
    url: `${state.baseUrl}/wiki/rest/api/content/${pageId}/child/page?limit=200`
  });
  if (!response.ok) return [];
  return (response.data.results || []).map(p => ({ id: p.id, title: p.title }));
}

// Resolve space key from parent page
async function resolveSpaceKey(spaceKey, parentPageId) {
  const apiUrl = `${state.baseUrl}/wiki/rest/api/content/${parentPageId}?expand=space`;
  const response = await window.electronAPI.confluenceApiRequest({ method: 'GET', url: apiUrl });
  if (!response.ok) return spaceKey;
  return response.data.space?.key || spaceKey;
}

// Find or create a page (returns { success, pageId, pageUrl, error, skippedElsewhere })
async function findOrCreatePage(title, content, spaceKey, parentPageId) {
  const existing = await findExistingPage(title, spaceKey, parentPageId);
  if (existing) {
    const pageUrl = `${state.baseUrl}/wiki/spaces/${spaceKey}/pages/${existing.id}`;
    return { success: true, pageId: existing.id, pageUrl };
  }
  const result = await createNewPage(title, content, spaceKey, parentPageId);
  // If page exists elsewhere in space, find it and return with a flag
  if (result.existsElsewhere) {
    const elsewhere = await findPageByTitleInSpace(title, spaceKey);
    if (elsewhere) {
      const pageUrl = `${state.baseUrl}/wiki/spaces/${spaceKey}/pages/${elsewhere.id}`;
      return { success: true, pageId: elsewhere.id, pageUrl, existedElsewhere: true };
    }
  }
  return result;
}

// Create a new Confluence page
async function createNewPage(title, content, spaceKey, parentPageId) {
  const createBody = {
    type: 'page',
    title: title,
    space: { key: spaceKey },
    ancestors: [{ id: parentPageId }],
    body: {
      storage: {
        value: content,
        representation: 'storage'
      }
    }
  };

  const response = await window.electronAPI.confluenceApiRequest({
    method: 'POST',
    url: `${state.baseUrl}/wiki/rest/api/content`,
    body: createBody
  });

  if (!response.ok) {
    // Log full response body to help diagnose errors
    console.error(`[createNewPage] "${title}" failed with status ${response.status}:`, JSON.stringify(response.data, null, 2));
    // Detect "page already exists" error
    const errMsg = JSON.stringify(response.data).toLowerCase();
    if (errMsg.includes('already exists') || errMsg.includes('duplicate') || response.status === 409) {
      console.log(`Page "${title}" already exists elsewhere in space.`);
      return { success: false, existsElsewhere: true, error: `Page "${title}" already exists elsewhere in the space` };
    }
    return { success: false, error: `Failed to create page "${title}": ${response.status} - ${JSON.stringify(response.data)}` };
  }

  const page = response.data;
  const pageUrl = `${state.baseUrl}/wiki${page._links?.webui || `/spaces/${spaceKey}/pages/${page.id}`}`;
  return { success: true, pageId: page.id, pageUrl };
}

// Find a page by title anywhere in the space (no parent filter)
async function findPageByTitleInSpace(title, spaceKey) {
  try {
    const searchUrl = `${state.baseUrl}/wiki/rest/api/content?title=${encodeURIComponent(title)}&spaceKey=${spaceKey}&expand=body.storage,version`;
    const response = await window.electronAPI.confluenceApiRequest({ method: 'GET', url: searchUrl });
    if (!response.ok) return null;
    const results = response.data.results || [];
    if (results.length > 0) {
      const page = results[0];
      return {
        id: page.id,
        version: page.version?.number || 1,
        content: page.body?.storage?.value || ''
      };
    }
    return null;
  } catch (error) {
    console.error('findPageByTitleInSpace error:', error);
    return null;
  }
}

// Update an existing Confluence page
async function updatePageContent(pageId, title, content, currentVersion) {
  const updateBody = {
    version: { number: currentVersion + 1 },
    title: title,
    type: 'page',
    body: {
      storage: {
        value: content,
        representation: 'storage'
      }
    }
  };

  const response = await window.electronAPI.confluenceApiRequest({
    method: 'PUT',
    url: `${state.baseUrl}/wiki/rest/api/content/${pageId}`,
    body: updateBody
  });

  if (!response.ok) {
    return { success: false, error: `Failed to update page: ${response.status} - ${JSON.stringify(response.data)}` };
  }

  return { success: true };
}

// Resolve user ID to display name using userMap
function resolveUserName(userId) {
  if (!userId) return 'Unknown User';
  
  const user = state.userMap[userId];
  if (user) {
    return user.displayName || user.realName || user.name || userId;
  }
  return userId;
}

// Resolve user ID to avatar URL using userMap
function resolveUserAvatar(userId) {
  if (!userId) return '';
  
  const user = state.userMap[userId];
  if (user && user.avatar) {
    return user.avatar;
  }
  return '';
}

// Render a single Slack message to HTML
function renderMessage(msg, isReply = false) {
  // Try to resolve user from userMap first, then fall back to message data
  let userName = 'Unknown User';
  let avatarUrl = '';
  
  if (msg.user && state.userMap[msg.user]) {
    userName = resolveUserName(msg.user);
    avatarUrl = resolveUserAvatar(msg.user);
  } else {
    userName = msg.user_profile?.display_name || msg.user_profile?.real_name || msg.username || msg.user || 'Unknown User';
    avatarUrl = msg.user_profile?.image_72 || '';
  }
  const timestamp = msg.ts ? new Date(parseFloat(msg.ts) * 1000).toLocaleString() : '';
  
  const indent = isReply ? 'margin-left: 40px;' : '';
  const bgColor = isReply ? '#f4f5f7' : '#ffffff';
  
  let html = `<div style="border: 1px solid #dfe1e6; border-radius: 8px; padding: 12px; margin: 8px 0; background: ${bgColor}; ${indent}">\n`;
  
  // User info header
  html += '<p style="margin: 0 0 8px 0;">';
  if (avatarUrl) {
    html += `<img src="${escapeHtml(avatarUrl)}" width="20" height="20" style="width: 20px !important; height: 20px !important; max-width: 20px !important; max-height: 20px !important; border-radius: 3px; vertical-align: middle; margin-right: 6px;" />`;
  }
  html += `<strong style="vertical-align: middle;">${escapeHtml(userName)}</strong>`;
  html += `<span style="color: #6b778c; font-size: 11px; margin-left: 8px; vertical-align: middle;">${escapeHtml(timestamp)}</span>`;
  html += '</p>\n';
  
  // Message content
  html += '<div style="margin-top: 8px;">\n';
  html += renderMessageContent(msg);
  html += '</div>\n';
  
  // Reactions
  if (msg.reactions && msg.reactions.length > 0) {
    html += '<div style="margin-top: 8px;">';
    for (const reaction of msg.reactions) {
      const emoji = getEmojiFromName(reaction.name);
      html += `<span style="background: #f4f5f7; padding: 2px 6px; border-radius: 12px; margin-right: 4px; font-size: 12px;">${emoji} ${reaction.count}</span>`;
    }
    html += '</div>\n';
  }
  
  // Files/attachments
  if (msg.files && msg.files.length > 0) {
    html += '<div style="margin-top: 8px; padding: 8px; background: #f4f5f7; border-radius: 4px;">';
    for (const file of msg.files) {
      html += `<p>📎 <strong>${escapeHtml(file.name || file.title || 'Attachment')}</strong></p>`;
      if (file.permalink) {
        html += `<p><em>(Original: ${escapeHtml(file.permalink)})</em></p>`;
      }
    }
    html += '</div>\n';
  }
  
  html += '</div>\n';
  return html;
}

// Render message content from blocks or text
function renderMessageContent(msg) {
  if (msg.blocks && msg.blocks.length > 0) {
    let content = '';
    for (const block of msg.blocks) {
      if (block.type === 'rich_text') {
        content += renderRichTextBlock(block);
      }
    }
    if (content) return content;
  }
  
  return `<p>${formatSlackText(msg.text || '')}</p>`;
}

// Render rich text block
function renderRichTextBlock(block) {
  let html = '';
  
  if (block.elements) {
    for (const element of block.elements) {
      if (element.type === 'rich_text_section') {
        html += '<p>' + renderRichTextElements(element.elements || []) + '</p>';
      } else if (element.type === 'rich_text_list') {
        const listTag = element.style === 'ordered' ? 'ol' : 'ul';
        html += `<${listTag}>`;
        for (const item of element.elements || []) {
          html += '<li>' + renderRichTextElements(item.elements || []) + '</li>';
        }
        html += `</${listTag}>`;
      } else if (element.type === 'rich_text_preformatted') {
        html += '<pre>' + renderRichTextElements(element.elements || []) + '</pre>';
      } else if (element.type === 'rich_text_quote') {
        html += '<blockquote>' + renderRichTextElements(element.elements || []) + '</blockquote>';
      }
    }
  }
  
  return html;
}

// Render rich text elements
function renderRichTextElements(elements) {
  let html = '';
  
  for (const el of elements) {
    let text = '';
    
    switch (el.type) {
      case 'text':
        text = escapeHtml(el.text || '');
        if (el.style) {
          if (el.style.bold) text = `<strong>${text}</strong>`;
          if (el.style.italic) text = `<em>${text}</em>`;
          if (el.style.strike) text = `<s>${text}</s>`;
          if (el.style.code) text = `<code>${text}</code>`;
        }
        html += text;
        break;
        
      case 'link':
        const linkText = el.text || el.url;
        html += `<a href="${escapeHtml(el.url)}">${escapeHtml(linkText)}</a>`;
        break;
        
      case 'emoji':
        html += getEmojiFromName(el.name);
        break;
        
      case 'user':
        const mentionUserId = el.user_id || '';
        const mentionUser = state.userMap[mentionUserId];
        const mentionName = mentionUser ? (mentionUser.displayName || mentionUser.realName || mentionUser.name || mentionUserId) : mentionUserId || 'user';
        html += `<strong>@${escapeHtml(mentionName)}</strong>`;
        break;
        
      case 'usergroup':
        html += `<strong>@group</strong>`;
        break;
        
      case 'channel':
        html += `<strong>#channel</strong>`;
        break;
        
      default:
        if (el.text) {
          html += escapeHtml(el.text);
        }
    }
  }
  
  return html;
}

// Format Slack text (basic markdown-like formatting)
function formatSlackText(text) {
  if (!text) return '';
  
  let formatted = escapeHtml(text);

  // Links: <url|text> or <url> (already escaped to &lt;…&gt;). Swap them for
  // placeholders so the bold/italic rules below can't mangle the URLs.
  const links = [];
  formatted = formatted.replace(/&lt;(https?:\/\/(?:(?!&gt;)[^|])+?)(?:\|((?:(?!&gt;).)+?))?&gt;/g, (match, url, label) => {
    links.push(`<a href="${url}">${label || url}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  });

  // Bold: *text*
  formatted = formatted.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
  
  // Italic: _text_
  formatted = formatted.replace(/_([^_]+)_/g, '<em>$1</em>');
  
  // Strike: ~text~
  formatted = formatted.replace(/~([^~]+)~/g, '<s>$1</s>');
  
  // Code: `text`
  formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // User mentions: <@U12345> or &lt;@U12345&gt; (after escapeHtml)
  formatted = formatted.replace(/&lt;@(U[A-Z0-9]+)&gt;/g, (match, userId) => {
    const user = state.userMap[userId];
    if (user) {
      const name = user.displayName || user.realName || user.name || userId;
      return `<strong>@${escapeHtml(name)}</strong>`;
    }
    return `<strong>@${userId}</strong>`;
  });
  
  // Newlines
  formatted = formatted.replace(/\n/g, '<br/>');

  formatted = formatted.replace(/\u0000(\d+)\u0000/g, (match, i) => links[i]);

  return formatted;
}

// Get page by ID with content and version
async function getPageById(pageId) {
  try {
    const url = `${state.baseUrl}/wiki/rest/api/content/${pageId}?expand=body.storage,version`;
    const response = await window.electronAPI.confluenceApiRequest({
      method: 'GET',
      url: url
    });
    
    if (!response.ok) {
      console.log('Failed to get page by ID:', response);
      return null;
    }
    
    return {
      id: response.data.id,
      version: response.data.version?.number || 1,
      content: response.data.body?.storage?.value || ''
    };
  } catch (error) {
    console.error('Error getting page by ID:', error);
    return null;
  }
}

// Check if a page with the given title exists under the parent
async function findExistingPage(title, spaceKey, parentPageId) {
  try {
    // Search for page by title in the space
    const searchUrl = `${state.baseUrl}/wiki/rest/api/content?title=${encodeURIComponent(title)}&spaceKey=${spaceKey}&expand=body.storage,version`;
    console.log('Searching for existing page:', searchUrl);
    
    const searchResponse = await window.electronAPI.confluenceApiRequest({
      method: 'GET',
      url: searchUrl
    });
    
    if (!searchResponse.ok) {
      console.log('Search failed:', searchResponse);
      return null;
    }
    
    const results = searchResponse.data.results || [];
    
    // Find page that is a child of our parent
    for (const page of results) {
      // Check ancestors to confirm it's under our parent
      const ancestorsUrl = `${state.baseUrl}/wiki/rest/api/content/${page.id}?expand=ancestors`;
      const ancestorsResponse = await window.electronAPI.confluenceApiRequest({
        method: 'GET',
        url: ancestorsUrl
      });
      
      if (ancestorsResponse.ok) {
        const ancestors = ancestorsResponse.data.ancestors || [];
        if (ancestors.some(a => a.id === parentPageId)) {
          return {
            id: page.id,
            version: page.version?.number || 1,
            content: page.body?.storage?.value || ''
          };
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error finding existing page:', error);
    return null;
  }
}

// Extract dates already present in the page content
function extractExistingDates(htmlContent) {
  const dates = new Set();
  // Match date headers like: <h2>📅 2024-01-15</h2> or <h2>📅 January 15, 2024</h2>
  const datePattern = /<h2[^>]*>📅\s*([^<]+)<\/h2>/gi;
  let match;
  
  while ((match = datePattern.exec(htmlContent)) !== null) {
    const dateStr = match[1].trim();
    dates.add(dateStr);
  }
  
  console.log('Existing dates found:', Array.from(dates));
  return dates;
}

// Build content for only the new dates
function buildIncrementalContent(slackData, existingDates) {
  let html = '';
  let newDatesCount = 0;

  // Build thread map across the entire provided data so cross-day threads stay intact.
  const { threads, parentTsSet } = buildThreadMapAcrossDays(slackData);

  for (const dayData of slackData) {
    // Skip if this date already exists
    if (existingDates.has(dayData.dateName)) {
      console.log('Skipping existing date:', dayData.dateName);
      continue;
    }

    newDatesCount++;

    html += `<h2>📅 ${escapeHtml(dayData.dateName)}</h2>\n`;
    html += '<hr/>\n';
    html += renderDayMessages(dayData.messages, threads, parentTsSet);
  }

  return { html, newDatesCount };
}

// Emoji mapping (subset - same as in the macro)
function getEmojiFromName(name) {
  const emojiMap = {
    'white_check_mark': '✅',
    'sos': '🆘',
    'pray': '🙏',
    'thumbsup': '👍',
    '+1': '👍',
    'thumbsdown': '👎',
    '-1': '👎',
    'heart': '❤️',
    'fire': '🔥',
    'rocket': '🚀',
    'eyes': '👀',
    'tada': '🎉',
    'warning': '⚠️',
    'x': '❌',
    'heavy_check_mark': '✔️',
    'question': '❓',
    'exclamation': '❗',
    'bulb': '💡',
    'memo': '📝',
    'link': '🔗',
    'gear': '⚙️',
    'wrench': '🔧',
    'hammer': '🔨',
    'bug': '🐛',
    'zap': '⚡',
    'star': '⭐',
    'sparkles': '✨',
    'wave': '👋',
    'clap': '👏',
    'muscle': '💪',
    'thinking_face': '🤔',
    'slightly_smiling_face': '🙂',
    'smile': '😄',
    'laughing': '😆',
    'sweat_smile': '😅',
    'joy': '😂',
    'sob': '😭',
    'angry': '😠',
    'confused': '😕',
    'disappointed': '😞',
    'sunglasses': '😎',
    'robot_face': '🤖',
    'skull': '💀',
    'ghost': '👻',
    'poop': '💩',
    'see_no_evil': '🙈',
    'hear_no_evil': '🙉',
    'speak_no_evil': '🙊'
  };
  
  return emojiMap[name] || `:${name}:`;
}

// Escape HTML
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Log an import error to the global error log
function logImportError(channelName, pageTitle, operation, error) {
  state.importErrorLog.push({
    timestamp: new Date().toISOString(),
    channelName,
    pageTitle,
    operation,
    error: String(error)
  });
}

// Update progress bar
function updateProgress(percent, text) {
  elements.progressFill.style.width = `${percent}%`;
  elements.progressText.textContent = text;
}

// Show a specific step
function showStep(stepName) {
  Object.values(elements.steps).forEach(step => step.classList.remove('active'));
  elements.steps[stepName].classList.add('active');
}

// Show error message
function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorContainer.classList.remove('hidden');
}

// Hide error message
function hideError() {
  elements.errorContainer.classList.add('hidden');
}

// Restart the process
function handleRestart() {
  // Reset state
  state.channels = [];
  state.userMap = {};
  state.usersFilePath = '';
  state.confluenceSession = null;
  state.lastImportResults = null;
  state.lastSpaceKey = null;
  
  // Reset UI
  elements.folderPath.value = '';
  elements.usersFilePath.value = '';
  elements.folderLoading.classList.add('hidden');
  elements.folderInfo.classList.add('hidden');
  elements.usersInfo.classList.add('hidden');
  elements.loginPending.classList.remove('hidden');
  elements.loginSuccess.classList.add('hidden');
  elements.importProgress.classList.add('hidden');
  elements.channelProgressList.classList.add('hidden');
  elements.channelProgressList.innerHTML = '';
  elements.importResultsList.classList.add('hidden');
  elements.importResultsList.innerHTML = '';
  elements.btnLogin.disabled = true;
  elements.btnImport.disabled = false;
  elements.progressFill.style.width = '0%';
  
  showStep('config');
}

// Initialize on load
init();
