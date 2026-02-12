const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectUsersFile: () => ipcRenderer.invoke('select-users-file'),
  readUsersFile: (filePath) => ipcRenderer.invoke('read-users-file', filePath),
  readSlackFiles: (folderPath) => ipcRenderer.invoke('read-slack-files', folderPath),
  openConfluenceLogin: (url) => ipcRenderer.invoke('open-confluence-login', url),
  closeConfluenceWindow: () => ipcRenderer.invoke('close-confluence-window'),
  getConfluenceSession: (baseUrl) => ipcRenderer.invoke('get-confluence-session', baseUrl),
  onConfluenceLoginComplete: (callback) => ipcRenderer.on('confluence-login-complete', (event, data) => callback(data)),
  confluenceApiRequest: (options) => ipcRenderer.invoke('confluence-api-request', options)
});
