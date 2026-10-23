// Main-process IPC handlers through the real preload bridge: dialogs, export
// scanning, the auto-detecting login window, session cookies and net.request
// with useSessionCookies — the Electron APIs most exposed to breaking changes.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, stubOpenDialog } = require('./helpers/app');
const { createMockConfluence } = require('./helpers/mock-confluence');
const { makeMultiExport, makeSingleExport, USERS } = require('./helpers/slack-export');

let ctx, mock, BASE;
const api = (name, ...args) => ctx.window.evaluate(([n, a]) => window.electronAPI[n](...a), [name, args]);

test.beforeEach(async () => {
  mock = await createMockConfluence();
  BASE = `https://acme.atlassian.net:${mock.port}`;
  ctx = await launchApp();
});
test.afterEach(async () => { await ctx.close(); await mock.close(); });

async function login() {
  await ctx.window.evaluate(u => {
    window.__login = new Promise(r => window.electronAPI.onConfluenceLoginComplete(r));
    window.__loginClosed = window.electronAPI.openConfluenceLogin(u);
  }, `${BASE}/wiki`);
  const data = await ctx.window.evaluate(() => Promise.race([window.__login, new Promise(r => setTimeout(() => r(null), 15000))]));
  await api('closeConfluenceWindow');
  await ctx.window.evaluate(() => window.__loginClosed);
  return data;
}

test.describe('preload bridge and window security', () => {
  test('exposes exactly the expected electronAPI surface', async () => {
    expect(await ctx.window.evaluate(() => Object.keys(window.electronAPI).sort())).toEqual([
      'closeConfluenceWindow', 'confluenceApiRequest', 'getConfluenceSession', 'onConfluenceLoginComplete',
      'openConfluenceLogin', 'readChannelData', 'readSlackFiles', 'readUsersFile', 'selectFolder', 'selectUsersFile',
    ]);
  });

  test('renderer has no Node.js access', async () => {
    expect(await ctx.window.evaluate(() => [typeof require, typeof process, typeof module])).toEqual(['undefined', 'undefined', 'undefined']);
  });

  test('main and login windows run with context isolation and without node integration', async () => {
    await ctx.window.evaluate(u => { window.__closed = window.electronAPI.openConfluenceLogin(u); }, `${BASE}/login-page-that-never-logs-in`);
    const prefs = await ctx.app.evaluate(async ({ BrowserWindow }) => {
      for (let i = 0; i < 100 && BrowserWindow.getAllWindows().length < 2; i++) await new Promise(r => setTimeout(r, 100));
      return BrowserWindow.getAllWindows().map(w => ({ ...(({ contextIsolation, nodeIntegration }) => ({ contextIsolation, nodeIntegration }))(w.webContents.getLastWebPreferences()), hasParent: !!w.getParentWindow() }));
    });
    expect(prefs).toHaveLength(2);
    for (const p of prefs) { expect(p.contextIsolation).toBe(true); expect(p.nodeIntegration).toBe(false); }
    expect(prefs.filter(p => p.hasParent)).toHaveLength(1);
    await api('closeConfluenceWindow');
    await ctx.window.evaluate(() => window.__closed);
  });
});

test.describe('dialogs and Slack export scanning', () => {
  test('select-folder / select-users-file return the chosen path or null on cancel', async () => {
    await stubOpenDialog(ctx.app, 'C:\\exports\\slack', null, 'C:\\exports\\users.json', null);
    expect(await api('selectFolder')).toBe('C:\\exports\\slack');
    expect(await api('selectFolder')).toBeNull();
    expect(await api('selectUsersFile')).toBe('C:\\exports\\users.json');
    expect(await api('selectUsersFile')).toBeNull();
    const opts = await ctx.app.evaluate(() => global.__openDialogs);
    expect(opts[0].properties).toEqual(['openDirectory']);
    expect(opts[2].properties).toEqual(['openFile']);
    expect(opts[2].filters).toEqual([{ name: 'JSON Files', extensions: ['json'] }]);
  });

  test('multi-channel export: lists channels with dated files only, finds users.json', async () => {
    const root = makeMultiExport();
    const r = await api('readSlackFiles', root);
    expect(r.success).toBe(true);
    expect(r.mode).toBe('multi');
    expect(r.folderName).toBe(path.basename(root));
    expect(r.usersFilePath).toBe(path.join(root, 'users.json'));
    expect(r.channels.map(c => [c.channelName, c.fileCount])).toEqual([['general', 12], ['random', 3]]);
    expect(r.channels[1].dateNames).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
    expect(r.channels[0].folderPath).toBe(path.join(root, 'general'));
  });

  test('single-channel export: users.json is found in the parent folder', async () => {
    const dir = makeSingleExport('design');
    fs.writeFileSync(path.join(dir, 'not-a-date.json'), '[]');
    const r = await api('readSlackFiles', dir);
    expect(r).toEqual({ success: true, mode: 'single', folderPath: dir, fileCount: 3, dateNames: ['2026-03-01', '2026-03-02', '2026-03-03'], folderName: 'design', usersFilePath: path.join(path.dirname(dir), 'users.json') });
  });

  test('a folder without Slack files, or a missing folder, reports an error', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
    const r = await api('readSlackFiles', empty);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/No Slack export files found/);
    const missing = await api('readSlackFiles', path.join(empty, 'nope'));
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/ENOENT/);
  });

  test('read-channel-data loads every day in date order with its messages', async () => {
    const root = makeMultiExport();
    const r = await api('readChannelData', path.join(root, 'general'));
    expect(r.success).toBe(true);
    expect(r.data.map(d => d.dateName)).toEqual(['2026-01-05', '2026-01-06', '2026-01-12', '2026-01-19', '2026-01-26', '2026-01-30', '2026-02-02', '2026-02-03', '2026-02-09', '2026-02-16', '2026-02-23', '2026-02-27']);
    expect(r.data[5].fileName).toBe('2026-01-30.json');
    expect(r.data[5].messages).toHaveLength(3);
  });

  test('read-channel-data reports malformed JSON', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bad-'));
    fs.writeFileSync(path.join(dir, '2026-01-01.json'), '{ not json');
    const r = await api('readChannelData', dir);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/JSON/);
  });

  test('read-users-file builds the user map with fallbacks', async () => {
    const root = makeMultiExport();
    const r = await api('readUsersFile', path.join(root, 'users.json'));
    expect(r.success).toBe(true);
    expect(r.count).toBe(USERS.length);
    expect(r.userMap.U001).toEqual({ id: 'U001', name: 'alice', realName: 'Alice Anderson', displayName: 'alice.a', email: 'alice@example.com', avatar: 'https://avatars.example/alice.png' });
    expect(r.userMap.U002).toEqual({ id: 'U002', name: 'bob', realName: 'Bob Brown', displayName: '', email: '', avatar: '' });
    const bad = await api('readUsersFile', path.join(root, 'missing.json'));
    expect(bad.success).toBe(false);
  });
});

test.describe('Confluence login window', () => {
  test('detects login after the redirect chain and sends the session cookies', async () => {
    const data = await login();
    expect(data).not.toBeNull();
    expect(data.baseUrl).toBe(BASE);
    expect(data.cookies.map(c => c.name)).toContain('cloud.session.token');
    // It went through the login page first
    expect(mock.requests.map(r => r.url.split('?')[0]).slice(0, 3)).toEqual(['/wiki', '/login', '/wiki/spaces/ENG/overview']);
  });

  test('stays on the login step while the window is on a login URL', async () => {
    await ctx.window.evaluate(u => {
      window.__login = null;
      window.electronAPI.onConfluenceLoginComplete(d => { window.__login = d; });
      window.__closed = window.electronAPI.openConfluenceLogin(u);
    }, `${BASE}/wiki/login-required`.replace('/wiki/login-required', '/gateway/login'));
    await new Promise(r => setTimeout(r, 3000));
    expect(await ctx.window.evaluate(() => window.__login)).toBeNull();
    await api('closeConfluenceWindow');
    await ctx.window.evaluate(() => window.__closed);
  });

  test('get-confluence-session returns cookies while the window is open, null after', async () => {
    // (a /wiki/ URL would be detected as a login and the renderer closes the window)
    await ctx.window.evaluate(u => { window.__closed = window.electronAPI.openConfluenceLogin(u); }, `${BASE}/cookie-only`);
    let cookies = null;
    for (let i = 0; i < 50 && !(cookies && cookies.length); i++) {
      cookies = await api('getConfluenceSession', BASE);
      await new Promise(r => setTimeout(r, 200));
    }
    expect(cookies.map(c => c.name)).toContain('cloud.session.token');
    await api('closeConfluenceWindow');
    await ctx.window.evaluate(() => window.__closed);
    expect(await api('getConfluenceSession', BASE)).toBeNull();
  });
});

test.describe('confluence-api-request (net.request + useSessionCookies)', () => {
  test.beforeEach(async () => { await login(); });

  test('GET sends session cookies and Atlassian headers, parses JSON', async () => {
    const page = mock.addPage({ id: 555, title: 'Parent' });
    const r = await api('confluenceApiRequest', { method: 'GET', url: `${BASE}/wiki/rest/api/content/${page.id}?expand=space` });
    expect(r).toEqual({ ok: true, status: 200, data: { id: '555', type: 'page', title: 'Parent', space: { key: 'ENG' }, _links: { webui: '/spaces/ENG/pages/555' } } });
    const req = mock.requests.filter(q => q.url.startsWith('/wiki/rest/api/content/555')).pop();
    expect(req.headers.cookie).toContain('cloud.session.token=slack-test-1');
    expect(req.headers.accept).toBe('application/json');
    expect(req.headers['x-atlassian-token']).toBe('no-check');
  });

  test('POST and PUT send JSON bodies', async () => {
    const parent = mock.addPage({ title: 'Parent' });
    const created = await api('confluenceApiRequest', { method: 'POST', url: `${BASE}/wiki/rest/api/content`, body: { type: 'page', title: 'New 🚀 ünïcode', space: { key: 'ENG' }, ancestors: [{ id: parent.id }], body: { storage: { value: '<p>é</p>', representation: 'storage' } } } });
    expect(created.ok).toBe(true);
    expect(mock.byTitle('New 🚀 ünïcode').body).toBe('<p>é</p>');
    const req = mock.requests.find(q => q.method === 'POST');
    expect(req.headers['content-type']).toBe('application/json');

    const updated = await api('confluenceApiRequest', { method: 'PUT', url: `${BASE}/wiki/rest/api/content/${created.data.id}`, body: { version: { number: 2 }, title: 'New 🚀 ünïcode', type: 'page', body: { storage: { value: '<p>v2</p>', representation: 'storage' } } } });
    expect(updated.ok).toBe(true);
    expect(mock.byTitle('New 🚀 ünïcode').version).toBe(2);
  });

  // Regression: response chunks used to be decoded one by one, corrupting
  // multi-byte UTF-8 characters split across chunk boundaries.
  test('large multi-byte response bodies arrive intact', async () => {
    const big = '<p>' + 'héllo 🌍 '.repeat(200000) + '</p>';
    const page = mock.addPage({ title: 'Big', body: big });
    const r = await api('confluenceApiRequest', { method: 'GET', url: `${BASE}/wiki/rest/api/content/${page.id}?expand=body.storage` });
    expect(r.ok).toBe(true);
    expect(r.data.body.storage.value).toBe(big);
  });

  test('HTTP errors resolve with ok:false and status; HTML comes back as text', async () => {
    const r = await api('confluenceApiRequest', { method: 'GET', url: `${BASE}/wiki/rest/api/content/999` });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    const html = await api('confluenceApiRequest', { method: 'GET', url: `${BASE}/wiki/spaces/ENG/overview` });
    expect(html.ok).toBe(true);
    expect(html.data).toContain('<title>Confluence</title>');
  });

  test('connection failures resolve with ok:false and an error', async () => {
    const r = await api('confluenceApiRequest', { method: 'GET', url: 'https://acme.atlassian.net:1/wiki/rest/api/space' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ERR_/);
  });
});

test('without login, API requests are unauthenticated', async () => {
  const r = await api('confluenceApiRequest', { method: 'GET', url: `${BASE}/wiki/rest/api/content/1` });
  expect(r.status).toBe(401);
});

// Regression: the main window's 'closed' handler called .close() on the login
// window Electron had already destroyed with its parent, throwing "Object has
// been destroyed" in the main process (error dialog on quit).
test('closing the main window while the login window is open does not throw', async () => {
  await ctx.window.evaluate(u => { window.electronAPI.openConfluenceLogin(u); }, `${BASE}/cookie-only`);
  const errors = await ctx.app.evaluate(async ({ app, BrowserWindow }) => {
    for (let i = 0; i < 100 && BrowserWindow.getAllWindows().length < 2; i++) await new Promise(r => setTimeout(r, 100));
    const errors = [];
    process.on('uncaughtException', e => errors.push(e.message));
    app.quit = () => {}; // keep the app alive so the result can be read back
    BrowserWindow.getAllWindows().find(w => !w.getParentWindow()).close();
    await new Promise(r => setTimeout(r, 1000));
    return errors;
  });
  expect(errors).toEqual([]);
});
