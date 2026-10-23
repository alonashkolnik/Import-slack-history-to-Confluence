// Launches the real Electron app for a test, with every hostname resolving to
// the local mock server and a throwaway profile so persisted sessions never
// leak between tests.
const { _electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ALLOWLISTED_SPKI = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'allowlisted.spki'), 'utf8').trim();

async function launchApp() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slackimport-test-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  // ELECTRON_APP_EXE=<path to packaged .exe> runs the suite against a packaged build;
  // ELECTRON_APP_ASAR=<path to resources/app.asar> runs a packaged app under the
  // stock (signed) Electron, e.g. when Smart App Control blocks the unsigned .exe
  const exe = process.env.ELECTRON_APP_EXE;
  const appPath = process.env.ELECTRON_APP_ASAR || '.';
  const app = await _electron.launch({
    cwd: ROOT,
    ...(exe ? { executablePath: exe } : {}),
    args: [
      '--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost',
      `--user-data-dir=${userDataDir}`,
      // Accept only the test/fixtures/allowlisted certificate
      `--ignore-certificate-errors-spki-list=${ALLOWLISTED_SPKI}`,
      ...(exe ? [] : [appPath]),
    ],
    env,
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  return {
    app,
    window,
    userDataDir,
    async close() {
      // A pending login window can keep a graceful close waiting forever;
      // fall back to killing the process tree so teardown never hangs.
      const closed = app.close().catch(() => {});
      const timedOut = await Promise.race([closed.then(() => false), new Promise(r => setTimeout(() => r(true), 10000))]);
      if (timedOut) {
        const pid = app.process().pid;
        if (process.platform === 'win32') require('child_process').spawnSync('taskkill', ['/pid', String(pid), '/T', '/F']);
        else app.process().kill('SIGKILL');
      }
      try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* temp dir; best effort */ }
    },
  };
}

// Make the next showOpenDialog calls return these paths, in order (null = cancel).
async function stubOpenDialog(app, ...paths) {
  await app.evaluate(({ dialog }, paths) => {
    global.__openDialogs = [];
    const queue = [...paths];
    dialog.showOpenDialog = async (...args) => {
      global.__openDialogs.push(args[args.length - 1]);
      const p = queue.shift();
      return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] };
    };
  }, paths);
}

module.exports = { launchApp, stubOpenDialog, ROOT };
