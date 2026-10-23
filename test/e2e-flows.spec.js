// Full user journeys through the wizard UI against the mock Confluence Cloud:
// folder selection, users.json auto-detect, login, multi-channel import with
// monthly pages and single-page channels, re-import, conflicts and errors.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { launchApp, stubOpenDialog } = require('./helpers/app');
const { createMockConfluence } = require('./helpers/mock-confluence');
const { makeMultiExport, makeSingleExport, writeChannel } = require('./helpers/slack-export');

let ctx, mock, w, BASE, parent;
test.beforeEach(async () => {
  mock = await createMockConfluence();
  BASE = `https://acme.atlassian.net:${mock.port}`;
  parent = mock.addPage({ id: 424242, title: 'Slack Archive', space: 'ENG' });
  ctx = await launchApp();
  w = ctx.window;
});
test.afterEach(async () => { await ctx.close(); await mock.close(); });

const parentUrl = () => `${BASE}/wiki/spaces/ENG/pages/${parent.id}/Slack+Archive`;

async function chooseFolder(folder) {
  await stubOpenDialog(ctx.app, folder);
  await w.click('#btn-select-folder');
  await expect(w.locator('#folder-info')).toBeVisible();
}

async function loginAndImport() {
  await w.fill('#parent-page-url', parentUrl());
  await expect(w.locator('#btn-login')).toBeEnabled();
  await w.click('#btn-login');
  await expect(w.locator('#step-import')).toHaveClass(/active/, { timeout: 20000 });
  await w.click('#btn-import');
  await expect(w.locator('#step-complete')).toHaveClass(/active/, { timeout: 60000 });
}

test('multi-channel import: monthly pages with nav links, single-page channel, threads, mentions', async () => {
  const root = makeMultiExport();
  await chooseFolder(root);
  await expect(w.locator('#file-count')).toHaveText('2 channels, 15 daily files');
  await expect(w.locator('#users-info')).toBeVisible();
  await expect(w.locator('#users-count')).toHaveText('2');
  await expect(w.locator('#users-file-path')).toHaveValue(`${path.join(root, 'users.json')}  (auto-detected)`);

  await loginAndImport();
  await expect(w.locator('.success-box p')).toHaveText('2 channels imported successfully.');
  await expect(w.locator('#import-results-list .channel-item')).toHaveCount(2);
  await expect(w.locator('#import-results-list .channel-item.success')).toHaveCount(2);
  await expect(w.locator('#import-results-list')).toContainText('2 month(s) created/updated, 0 up to date');
  await expect(w.locator('#import-results-list')).toContainText('3 days imported (single page), 3 new');
  await expect(w.locator('#page-link')).toHaveAttribute('href', `${BASE}/wiki/spaces/ENG/pages/${parent.id}`);

  // Channel pages under the chosen parent
  const channels = mock.childrenOf(parent.id).map(p => p.title).sort();
  expect(channels).toEqual(['general', 'random']);

  // general: two monthly child pages
  const general = mock.byTitle('general');
  const months = mock.childrenOf(general.id).map(p => p.title).sort();
  expect(months).toEqual(['general - February 2026', 'general - January 2026']);
  const jan = mock.byTitle('general - January 2026');
  const feb = mock.byTitle('general - February 2026');
  // January was created before February existed, then back-filled with the "next" link
  expect(jan.version).toBe(2);
  expect(jan.body).toContain(`<a href="${BASE}/wiki/spaces/ENG/pages/${feb.id}">February 2026 &rarr;</a>`);
  expect(feb.body).toContain(`<a href="${BASE}/wiki/spaces/ENG/pages/${jan.id}">&larr; January 2026</a>`);
  // Every day has a header on its month page
  expect((jan.body.match(/<h2>📅 2026-01-\d\d<\/h2>/g) || []).length).toBe(6);
  expect((feb.body.match(/<h2>📅 2026-02-\d\d<\/h2>/g) || []).length).toBe(6);
  // The Feb 2 reply is nested under its Jan 30 parent, not shown on February's page
  expect(jan.body).toContain('💬 Thread replies (2)');
  expect(jan.body).toContain('next-month reply');
  expect(feb.body).not.toContain('next-month reply');
  // Rich text, mention resolved through users.json, emoji, reactions, files
  expect(jan.body).toContain('Release <strong>plan</strong>? cc <strong>@Bob Brown</strong>🚀');
  expect(jan.body).toContain('👍 3</span>');
  expect(jan.body).toContain(':custom_party: 1</span>');
  expect(jan.body).toContain('📎 <strong>plan.pdf</strong>');
  expect(jan.body).toContain('>alice.a</strong>');

  // random: single combined page (fewer than 10 files)
  const random = mock.byTitle('random');
  expect(mock.childrenOf(random.id)).toHaveLength(0);
  expect(random.version).toBe(2);
  expect(random.body).toContain('<h1>Slack Channel: random</h1>');
  expect(random.body).toContain('Hello <strong>@Bob Brown</strong> see <a href="https://example.com">the site</a>');
  expect(random.body).toContain('>alice.a</strong>');
  expect(random.body).toContain('>Guest Gal</strong>');
  expect(random.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; stuff');
  expect(random.body).not.toContain('<script>');
});

test('re-import is incremental: unchanged months are skipped, new days are added', async () => {
  const root = makeMultiExport();
  await chooseFolder(root);
  await loginAndImport();
  const versionsBefore = Object.fromEntries(Object.values(mock.pages).map(p => [p.title, p.version]));

  // Second run: a new March day for general, nothing new for random
  writeChannel(path.join(root, 'general'), { '2026-03-10': [{ type: 'message', user: 'U001', text: 'march news', ts: '1773144000.000100' }] });
  await w.click('#btn-restart');
  await expect(w.locator('#step-config')).toHaveClass(/active/);
  await chooseFolder(root);
  await loginAndImport();

  const results = w.locator('#import-results-list');
  // Jan/Feb contain a cross-month thread, so they are rebuilt; March is new
  await expect(results).toContainText('general');
  const mar = mock.byTitle('general - March 2026');
  expect(mar).toBeTruthy();
  expect(mar.body).toContain('march news');
  expect(mar.body).toContain('&larr; February 2026');
  const feb = mock.byTitle('general - February 2026');
  expect(feb.version).toBeGreaterThan(versionsBefore['general - February 2026']);
  expect(feb.body).toContain(`<a href="${BASE}/wiki/spaces/ENG/pages/${mar.id}">March 2026 &rarr;</a>`);
  // random had nothing new
  await expect(results).toContainText('3 days already imported, 0 new');
  expect(mock.byTitle('random').version).toBe(versionsBefore.random);
  // No duplicate pages were created
  expect(Object.values(mock.pages).filter(p => p.title === 'general')).toHaveLength(1);
});

test('single-channel export imports into one page', async () => {
  const dir = makeSingleExport('design');
  await chooseFolder(dir);
  await expect(w.locator('#file-count')).toHaveText('3 daily files (single channel)');
  await loginAndImport();
  await expect(w.locator('#summary-channel')).toHaveText('Channel: design');
  const design = mock.byTitle('design');
  expect(design.parentId).toBe(parent.id);
  expect(design.body).toContain('<h2>📅 2026-03-03</h2>');
});

test('channel that already exists elsewhere in the space: Update this page imports into it', async () => {
  const other = mock.addPage({ title: 'Somewhere else', space: 'ENG' });
  const existing = mock.addPage({ title: 'general', space: 'ENG', parentId: other.id });
  const root = makeMultiExport();
  await chooseFolder(root);
  await loginAndImport();

  await expect(w.locator('.success-box p')).toContainText('1 channels found elsewhere in space — please decide below.');
  const item = w.locator('.channel-item.elsewhere[data-channel="general"]');
  await expect(item).toContainText(`${BASE}/wiki/spaces/ENG/pages/${existing.id}`);
  await item.locator('.btn-update-elsewhere').click();
  await expect(w.locator('#import-results-list .channel-item.success', { hasText: 'general' })).toContainText('2 month(s) created/updated');
  expect(mock.childrenOf(existing.id).map(p => p.title).sort()).toEqual(['general - February 2026', 'general - January 2026']);
  expect(Object.values(mock.pages).filter(p => p.title === 'general')).toHaveLength(1);
});

test('channel that already exists elsewhere: Skip leaves it alone', async () => {
  const other = mock.addPage({ title: 'Somewhere else', space: 'ENG' });
  const existing = mock.addPage({ title: 'general', space: 'ENG', parentId: other.id });
  await chooseFolder(makeMultiExport());
  await loginAndImport();
  await w.locator('.btn-skip-elsewhere').click();
  await expect(w.locator('#import-results-list')).toContainText('Skipped by user');
  expect(mock.childrenOf(existing.id)).toHaveLength(0);
});

test('page creation errors are listed and offered as a downloadable log', async () => {
  mock.failures.push({ method: 'POST', pathRe: /\/wiki\/rest\/api\/content$/, status: 500, times: 100, body: { message: 'boom' } });
  await chooseFolder(makeMultiExport());
  await loginAndImport();
  await expect(w.locator('.success-box p')).toHaveText('2 channels had errors.');
  await expect(w.locator('#import-results-list .channel-item.error')).toHaveCount(2);
  await expect(w.locator('#import-results-list')).toContainText('Failed to create page "general": 500');
});

test('a failed monthly page goes into the error log section', async () => {
  const root = makeMultiExport();
  await chooseFolder(root);
  await w.fill('#parent-page-url', parentUrl());
  await w.click('#btn-login');
  await expect(w.locator('#step-import')).toHaveClass(/active/, { timeout: 20000 });
  // Let the channel page through; fail the second page POSTed (general's January page)
  let posts = 0;
  const orig = mock.requests.push.bind(mock.requests);
  mock.requests.push = r => { if (r.method === 'POST' && ++posts === 2) mock.failures.push({ method: 'POST', pathRe: /content$/, status: 500, times: 1 }); return orig(r); };
  await w.click('#btn-import');
  await expect(w.locator('#step-complete')).toHaveClass(/active/, { timeout: 60000 });
  const section = w.locator('#import-error-log-section');
  await expect(section).toContainText('1 error(s) occurred during import');
  const link = section.locator('a[download]');
  await expect(link).toHaveAttribute('download', /^import-errors-.*\.txt$/);
  await expect(link).toHaveAttribute('href', /^blob:/);
  const log = await w.evaluate(() => state.importErrorLog);
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ channelName: 'general', pageTitle: 'general - January 2026', operation: 'create page' });
  expect(log[0].error).toContain('500');
});

test('expired session during import: channels fail with a clear message', async () => {
  await chooseFolder(makeMultiExport());
  await w.fill('#parent-page-url', parentUrl());
  await w.click('#btn-login');
  await expect(w.locator('#step-import')).toHaveClass(/active/, { timeout: 20000 });
  mock.failures.push({ pathRe: /\/wiki\/rest\//, status: 401, times: 1000 });
  await w.click('#btn-import');
  await expect(w.locator('#step-complete')).toHaveClass(/active/, { timeout: 60000 });
  await expect(w.locator('#import-results-list .channel-item.error')).toHaveCount(2);
  await expect(w.locator('#import-results-list')).toContainText('401');
});

test('invalid parent page URL is rejected before login', async () => {
  await chooseFolder(makeMultiExport());
  await w.fill('#parent-page-url', `${BASE}/wiki/home`);
  await w.click('#btn-login');
  await expect(w.locator('#error-message')).toContainText('Invalid parent page URL');
  await expect(w.locator('#step-config')).toHaveClass(/active/);
  await w.click('#btn-dismiss-error');
  await expect(w.locator('#error-container')).toBeHidden();
});

test('folder without Slack files shows an error and keeps login disabled', async () => {
  const empty = fs.mkdtempSync(path.join(require('os').tmpdir(), 'empty-'));
  await stubOpenDialog(ctx.app, empty);
  await w.click('#btn-select-folder');
  await expect(w.locator('#error-message')).toContainText('No Slack export files found');
  await w.fill('#parent-page-url', parentUrl());
  await expect(w.locator('#btn-login')).toBeDisabled();
});

test('a users.json picked by hand overrides auto-detect', async () => {
  const root = makeMultiExport({ users: false });
  const custom = path.join(root, '..', `custom-users-${Date.now()}.json`);
  fs.writeFileSync(custom, JSON.stringify([{ id: 'U001', name: 'a', profile: { display_name: 'Custom Alice' } }]));
  await stubOpenDialog(ctx.app, custom, root);
  await w.click('#btn-select-users-file');
  await expect(w.locator('#users-count')).toHaveText('1');
  await w.click('#btn-select-folder');
  await expect(w.locator('#folder-info')).toBeVisible();
  await loginAndImport();
  const body = mock.byTitle('random').body;
  expect(body).toContain('>Custom Alice</strong>');
  expect(body).toContain('Hello <strong>@U002</strong>'); // not in the hand-picked users.json
});
