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
  parentPageId: ''
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

// Build channel parent page content with children macro
function buildChannelParentContent(channelName) {
  let html = `<h1>Slack Channel: ${escapeHtml(channelName)}</h1>\n`;
  html += `<p><em>Imported on ${new Date().toLocaleString()}</em></p>\n`;
  html += '<p>Monthly history pages are listed below:</p>\n';
  html += '<ac:structured-macro ac:name="children"><ac:parameter ac:name="sort">title</ac:parameter><ac:parameter ac:name="all">true</ac:parameter></ac:structured-macro>\n';
  return html;
}

// Build navigation links for a monthly page
function buildNavLinks(channelName, prevMonthKey, nextMonthKey) {
  let html = '<table style="width: 100%; border-top: 2px solid #dfe1e6; border-bottom: 2px solid #dfe1e6; margin: 16px 0; padding: 0;"><tbody><tr>';
  html += '<td style="text-align: left; padding: 12px 8px; font-size: 16px; font-weight: bold;">';
  if (prevMonthKey) {
    const prevTitle = buildMonthlyPageTitle(channelName, prevMonthKey);
    html += `<ac:link><ri:page ri:content-title="${escapeHtml(prevTitle)}" /><ac:plain-text-link-body><![CDATA[\u2b05 ${formatMonthLabel(prevMonthKey)}]]></ac:plain-text-link-body></ac:link>`;
  }
  html += '</td>';
  html += '<td style="text-align: right; padding: 12px 8px; font-size: 16px; font-weight: bold;">';
  if (nextMonthKey) {
    const nextTitle = buildMonthlyPageTitle(channelName, nextMonthKey);
    html += `<ac:link><ri:page ri:content-title="${escapeHtml(nextTitle)}" /><ac:plain-text-link-body><![CDATA[${formatMonthLabel(nextMonthKey)} \u27a1]]></ac:plain-text-link-body></ac:link>`;
  }
  html += '</td>';
  html += '</tr></tbody></table>\n';
  return html;
}

// Build content for a single monthly page
function buildMonthlyPageContent(channelName, monthKey, monthData, prevMonthKey, nextMonthKey) {
  let html = `<h1>${escapeHtml(channelName)} - ${escapeHtml(formatMonthLabel(monthKey))}</h1>\n`;
  html += `<p><em>Imported on ${new Date().toLocaleString()}</em></p>\n`;

  // Navigation at top
  html += buildNavLinks(channelName, prevMonthKey, nextMonthKey);

  for (const dayData of monthData) {
    html += `<h2>📅 ${escapeHtml(dayData.dateName)}</h2>\n`;
    html += '<hr/>\n';

    const messages = dayData.messages;
    const threads = new Map();
    const mainMessages = [];

    for (const msg of messages) {
      if (msg.thread_ts && msg.thread_ts !== msg.ts) {
        if (!threads.has(msg.thread_ts)) {
          threads.set(msg.thread_ts, []);
        }
        threads.get(msg.thread_ts).push(msg);
      } else {
        mainMessages.push(msg);
      }
    }

    for (const msg of mainMessages) {
      html += renderMessage(msg);

      if (msg.ts && threads.has(msg.ts)) {
        const replies = threads.get(msg.ts);
        html += `<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">💬 Thread replies (${replies.length})</ac:parameter><ac:rich-text-body>\n`;
        for (const reply of replies) {
          html += renderMessage(reply, true);
        }
        html += '</ac:rich-text-body></ac:structured-macro>\n';
      }
    }
  }

  // Navigation at bottom
  html += buildNavLinks(channelName, prevMonthKey, nextMonthKey);

  return html;
}

// ==================== Import Logic ====================

// Unified import: handles both single and multi-channel with lazy loading
async function importAllChannels() {
  const totalChannels = state.channels.length;
  const results = [];

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

      updateChannelStatus(channel.channelName, 'success', importResult.summary);
      results.push({ channelName: channel.channelName, success: true });
    } catch (error) {
      updateChannelStatus(channel.channelName, 'error', 'Failed', error.message);
      results.push({ channelName: channel.channelName, success: false, message: error.message });
    }
  }

  const successes = results.filter(r => r.success).length;
  const failures = results.filter(r => !r.success).length;

  updateProgress(100, `Complete! ${successes} channels imported, ${failures} failed`);

  const parentPageUrl = `${state.baseUrl}/wiki/spaces/${spaceKeyResolved}/pages/${state.parentPageId}`;
  elements.pageLink.href = parentPageUrl;

  const successMessage = document.querySelector('.success-box p');
  if (successMessage) {
    if (failures > 0) {
      successMessage.innerHTML = `Imported ${successes} channels successfully.<br>${failures} channels had errors.`;
    } else {
      successMessage.textContent = `Successfully imported all ${successes} channels!`;
    }
  }

  showStep('complete');
}

// Core: import a single channel as parent page + monthly child pages
// Returns { summary } string for the channel progress UI
async function importChannelWithMonthlyPages(channelName, slackData, spaceKeyResolved, parentPageId, progressStart, progressEnd) {
  const monthsMap = groupByMonth(slackData);
  const monthKeys = Array.from(monthsMap.keys()); // sorted
  const totalMonths = monthKeys.length;

  // Create or find the channel parent page
  const channelParentContent = buildChannelParentContent(channelName);
  const channelPage = await findOrCreatePage(channelName, channelParentContent, spaceKeyResolved, parentPageId);
  if (!channelPage.success) {
    throw new Error(channelPage.error);
  }

  const channelPageId = channelPage.pageId;

  // Set link (useful for single-channel mode)
  elements.pageLink.href = channelPage.pageUrl;

  // Create monthly child pages
  let createdCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < totalMonths; i++) {
    const monthKey = monthKeys[i];
    const prevMonthKey = i > 0 ? monthKeys[i - 1] : null;
    const nextMonthKey = i < totalMonths - 1 ? monthKeys[i + 1] : null;

    const progress = progressStart + ((i / totalMonths) * (progressEnd - progressStart));
    updateProgress(Math.round(progress), `${channelName}: ${formatMonthLabel(monthKey)} (${i + 1}/${totalMonths})`);
    updateChannelStatus(channelName, 'in-progress', `${formatMonthLabel(monthKey)} (${i + 1}/${totalMonths})`);

    const monthTitle = buildMonthlyPageTitle(channelName, monthKey);
    const monthData = monthsMap.get(monthKey);
    const monthContent = buildMonthlyPageContent(channelName, monthKey, monthData, prevMonthKey, nextMonthKey);

    // Check if monthly page already exists
    const existingMonthPage = await findExistingPage(monthTitle, spaceKeyResolved, channelPageId);

    if (existingMonthPage) {
      // Incremental: check for new dates in this month
      const existingDates = extractExistingDates(existingMonthPage.content);
      const { html: newContent, newDatesCount } = buildIncrementalContent(monthData, existingDates);

      if (newDatesCount === 0) {
        skippedCount++;

        // Still update nav links if neighbors changed
        const needsNavUpdate = checkNavLinksNeedUpdate(existingMonthPage.content, channelName, prevMonthKey, nextMonthKey);
        if (needsNavUpdate) {
          const updatedFullContent = buildMonthlyPageContent(channelName, monthKey, monthData, prevMonthKey, nextMonthKey);
          await updatePageContent(existingMonthPage.id, monthTitle, updatedFullContent, existingMonthPage.version);
        }
        continue;
      }

      // Rebuild the full monthly page with all dates
      const updatedFullContent = buildMonthlyPageContent(channelName, monthKey, monthData, prevMonthKey, nextMonthKey);
      const updateResult = await updatePageContent(existingMonthPage.id, monthTitle, updatedFullContent, existingMonthPage.version);
      if (updateResult.success) {
        createdCount++;
      }
    } else {
      // Create new monthly page
      const createResult = await createNewPage(monthTitle, monthContent, spaceKeyResolved, channelPageId);
      if (createResult.success) {
        createdCount++;
      } else {
        console.error(`Failed to create page ${monthTitle}:`, createResult.error);
      }
    }
  }

  const summary = `${createdCount} month(s) created/updated, ${skippedCount} up to date`;
  return { summary };
}

// Check if navigation links need updating (e.g., a new month was added)
function checkNavLinksNeedUpdate(existingContent, channelName, prevMonthKey, nextMonthKey) {
  if (prevMonthKey) {
    const prevTitle = buildMonthlyPageTitle(channelName, prevMonthKey);
    if (!existingContent.includes(prevTitle)) return true;
  }
  if (nextMonthKey) {
    const nextTitle = buildMonthlyPageTitle(channelName, nextMonthKey);
    if (!existingContent.includes(nextTitle)) return true;
  }
  return false;
}

// ==================== Confluence API Helpers ====================

// Resolve space key from parent page
async function resolveSpaceKey(spaceKey, parentPageId) {
  const apiUrl = `${state.baseUrl}/wiki/rest/api/content/${parentPageId}?expand=space`;
  const response = await window.electronAPI.confluenceApiRequest({ method: 'GET', url: apiUrl });
  if (!response.ok) return spaceKey;
  return response.data.space?.key || spaceKey;
}

// Find or create a page (returns { success, pageId, pageUrl, error })
async function findOrCreatePage(title, content, spaceKey, parentPageId) {
  const existing = await findExistingPage(title, spaceKey, parentPageId);
  if (existing) {
    const pageUrl = `${state.baseUrl}/wiki/spaces/${spaceKey}/pages/${existing.id}`;
    return { success: true, pageId: existing.id, pageUrl };
  }
  return await createNewPage(title, content, spaceKey, parentPageId);
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
    return { success: false, error: `Failed to create page "${title}": ${response.status} - ${JSON.stringify(response.data)}` };
  }

  const page = response.data;
  const pageUrl = `${state.baseUrl}/wiki${page._links?.webui || `/spaces/${spaceKey}/pages/${page.id}`}`;
  return { success: true, pageId: page.id, pageUrl };
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
  
  // Bold: *text*
  formatted = formatted.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
  
  // Italic: _text_
  formatted = formatted.replace(/_([^_]+)_/g, '<em>$1</em>');
  
  // Strike: ~text~
  formatted = formatted.replace(/~([^~]+)~/g, '<s>$1</s>');
  
  // Code: `text`
  formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Links: <url|text> or <url>
  formatted = formatted.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '<a href="$1">$2</a>');
  formatted = formatted.replace(/<(https?:\/\/[^>]+)>/g, '<a href="$1">$1</a>');
  
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
  
  return formatted;
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
  
  for (const dayData of slackData) {
    // Skip if this date already exists
    if (existingDates.has(dayData.dateName)) {
      console.log('Skipping existing date:', dayData.dateName);
      continue;
    }
    
    newDatesCount++;
    
    // Add date header
    html += `<h2>📅 ${escapeHtml(dayData.dateName)}</h2>\n`;
    html += '<hr/>\n';

    // Process messages for this day
    const messages = dayData.messages;
    
    // Group messages by thread
    const threads = new Map();
    const mainMessages = [];

    for (const msg of messages) {
      if (msg.thread_ts && msg.thread_ts !== msg.ts) {
        if (!threads.has(msg.thread_ts)) {
          threads.set(msg.thread_ts, []);
        }
        threads.get(msg.thread_ts).push(msg);
      } else {
        mainMessages.push(msg);
      }
    }

    // Render messages
    for (const msg of mainMessages) {
      html += renderMessage(msg);

      // Render thread replies if any
      if (msg.ts && threads.has(msg.ts)) {
        const replies = threads.get(msg.ts);
        html += `<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">💬 Thread replies (${replies.length})</ac:parameter><ac:rich-text-body>\n`;
        for (const reply of replies) {
          html += renderMessage(reply, true);
        }
        html += '</ac:rich-text-body></ac:structured-macro>\n';
      }
    }
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
  elements.btnLogin.disabled = true;
  elements.btnImport.disabled = false;
  elements.progressFill.style.width = '0%';
  
  showStep('config');
}

// Initialize on load
init();
