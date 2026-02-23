const { app, BrowserWindow, ipcMain, dialog, net, session } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let confluenceWindow;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../assets/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
  
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (confluenceWindow) {
      confluenceWindow.close();
    }
  });
}

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

// Handle folder selection
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Slack Export Folder'
  });
  
  if (result.canceled) {
    return null;
  }
  
  return result.filePaths[0];
});

// Handle users file selection
ipcMain.handle('select-users-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Select users.json File',
    filters: [
      { name: 'JSON Files', extensions: ['json'] }
    ]
  });
  
  if (result.canceled) {
    return null;
  }
  
  return result.filePaths[0];
});

// Read and parse users.json file
ipcMain.handle('read-users-file', async (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const users = JSON.parse(content);
    
    // Build a map of user ID to user info
    const userMap = {};
    for (const user of users) {
      userMap[user.id] = {
        id: user.id,
        name: user.name,
        realName: user.profile?.real_name || user.real_name || user.name,
        displayName: user.profile?.display_name || '',
        email: user.profile?.email || '',
        avatar: user.profile?.image_72 || user.profile?.image_48 || ''
      };
    }
    
    return { 
      success: true, 
      userMap: userMap,
      count: Object.keys(userMap).length
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Scan a channel folder for metadata only (no full message loading)
// Returns { dateNames, messageCount }
function scanChannelFolder(folderPath) {
  const files = fs.readdirSync(folderPath)
    .filter(file => file.endsWith('.json') && /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .sort();
  
  let messageCount = 0;
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(folderPath, file), 'utf-8');
      const arr = JSON.parse(content);
      if (Array.isArray(arr)) messageCount += arr.length;
    } catch (e) { /* skip corrupt files */ }
  }

  return {
    dateNames: files.map(file => file.replace('.json', '')),
    messageCount
  };
}

// Read a single channel folder - loads all message data (used during import)
function readChannelFolder(folderPath) {
  const files = fs.readdirSync(folderPath)
    .filter(file => file.endsWith('.json') && /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .sort();
  
  const slackData = [];
  
  for (const file of files) {
    const filePath = path.join(folderPath, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const messages = JSON.parse(content);
    const dateName = file.replace('.json', '');
    
    slackData.push({
      fileName: file,
      dateName: dateName,
      messages: messages
    });
  }
  
  return slackData;
}

// Handle scanning Slack export folder - returns metadata only (fast)
ipcMain.handle('read-slack-files', async (event, folderPath) => {
  try {
    const items = fs.readdirSync(folderPath);
    
    const subfolders = items.filter(item => {
      const itemPath = path.join(folderPath, item);
      return fs.statSync(itemPath).isDirectory();
    });
    
    // PRIORITY: Check for subfolders with date JSON files first (multi-channel mode)
    if (subfolders.length > 0) {
      const channels = [];
      
      for (const subfolder of subfolders) {
        const subfolderPath = path.join(folderPath, subfolder);
        const scan = scanChannelFolder(subfolderPath);
        
        if (scan.dateNames.length > 0) {
          channels.push({
            channelName: subfolder,
            folderPath: subfolderPath,
            fileCount: scan.dateNames.length,
            messageCount: scan.messageCount,
            dateNames: scan.dateNames
          });
        }
      }
      
      if (channels.length > 0) {
        return { 
          success: true, 
          mode: 'multi', 
          channels: channels,
          folderName: path.basename(folderPath)
        };
      }
    }
    
    // Fallback: check for date JSON files directly (single channel mode)
    const scan = scanChannelFolder(folderPath);
    if (scan.dateNames.length > 0) {
      return { 
        success: true, 
        mode: 'single', 
        folderPath: folderPath,
        fileCount: scan.dateNames.length,
        messageCount: scan.messageCount,
        dateNames: scan.dateNames,
        folderName: path.basename(folderPath) 
      };
    }
    
    return { success: false, error: 'No Slack export files found. Select a folder containing YYYY-MM-DD.json files or channel subfolders.' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Lazy-load a single channel's full message data (called during import)
ipcMain.handle('read-channel-data', async (event, folderPath) => {
  try {
    const slackData = readChannelFolder(folderPath);
    return { success: true, data: slackData };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Open Confluence login window
ipcMain.handle('open-confluence-login', async (event, confluenceUrl) => {
  return new Promise((resolve) => {
    confluenceWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      parent: mainWindow,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: 'persist:confluence'
      }
    });

    confluenceWindow.loadURL(confluenceUrl);

    let loginDetected = false;

    // Function to check if login is complete
    const checkLoginComplete = async (url) => {
      if (loginDetected) return;
      
      console.log('Checking URL:', url);
      
      // Check if we're on a Confluence page (not login/auth pages)
      const isConfluencePage = url.includes('/wiki/') && 
        !url.includes('/login') && 
        !url.includes('/gateway/') &&
        !url.includes('id.atlassian.com');
      
      if (isConfluencePage) {
        loginDetected = true;
        console.log('Login detected! URL:', url);
        
        // Get cookies for API calls
        const cookies = await confluenceWindow.webContents.session.cookies.get({});
        
        // Notify main window that login is complete
        mainWindow.webContents.send('confluence-login-complete', {
          baseUrl: new URL(url).origin,
          cookies: cookies
        });
      }
    };

    // Listen for various navigation events
    confluenceWindow.webContents.on('did-navigate', (event, url) => {
      checkLoginComplete(url);
    });

    confluenceWindow.webContents.on('did-navigate-in-page', (event, url) => {
      checkLoginComplete(url);
    });

    confluenceWindow.webContents.on('did-finish-load', () => {
      const url = confluenceWindow.webContents.getURL();
      checkLoginComplete(url);
    });

    confluenceWindow.on('closed', () => {
      confluenceWindow = null;
      resolve();
    });
  });
});

// Close Confluence window
ipcMain.handle('close-confluence-window', async () => {
  if (confluenceWindow) {
    confluenceWindow.close();
    confluenceWindow = null;
  }
});

// Get session cookies from Confluence window
ipcMain.handle('get-confluence-session', async (event, baseUrl) => {
  if (!confluenceWindow) {
    return null;
  }
  
  try {
    const cookies = await confluenceWindow.webContents.session.cookies.get({});
    return cookies;
  } catch (error) {
    return null;
  }
});

// Make Confluence API request from main process (to avoid CORS issues)
ipcMain.handle('confluence-api-request', async (event, { method, url, body }) => {
  return new Promise(async (resolve) => {
    try {
      // Use the confluence session for cookies
      const confluenceSession = session.fromPartition('persist:confluence');
      
      // Get cookies to check authentication
      const cookies = await confluenceSession.cookies.get({});
      console.log('Making API request to:', url);
      console.log('Method:', method);
      console.log('Cookies count:', cookies.length);
      
      const request = net.request({
        method: method || 'GET',
        url: url,
        session: confluenceSession,
        useSessionCookies: true
      });

      request.setHeader('Accept', 'application/json');
      request.setHeader('X-Atlassian-Token', 'no-check');
      if (body) {
        request.setHeader('Content-Type', 'application/json');
      }

      let responseData = '';

      request.on('response', (response) => {
        console.log('Response status:', response.statusCode);
        console.log('Response headers:', response.headers);
        
        response.on('data', (chunk) => {
          responseData += chunk.toString();
        });

        response.on('end', () => {
          try {
            const jsonData = JSON.parse(responseData);
            resolve({
              ok: response.statusCode >= 200 && response.statusCode < 300,
              status: response.statusCode,
              data: jsonData
            });
          } catch (e) {
            resolve({
              ok: response.statusCode >= 200 && response.statusCode < 300,
              status: response.statusCode,
              data: responseData
            });
          }
        });

        response.on('error', (error) => {
          resolve({ ok: false, error: error.message });
        });
      });

      request.on('error', (error) => {
        resolve({ ok: false, error: error.message });
      });

      if (body) {
        request.write(JSON.stringify(body));
      }
      request.end();
    } catch (error) {
      resolve({ ok: false, error: error.message });
    }
  });
});
