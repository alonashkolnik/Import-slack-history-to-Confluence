// Builds Slack export folders on disk for the tests.
const fs = require('fs');
const os = require('os');
const path = require('path');

const USERS = [
  { id: 'U001', name: 'alice', real_name: 'Alice A', profile: { real_name: 'Alice Anderson', display_name: 'alice.a', email: 'alice@example.com', image_72: 'https://avatars.example/alice.png' } },
  { id: 'U002', name: 'bob', profile: { real_name: 'Bob Brown', display_name: '' } },
];

// Slack timestamps (seconds) at noon UTC on the given date, plus an offset
const ts = (date, offsetSec = 0) => String(Date.parse(`${date}T12:00:00Z`) / 1000 + offsetSec) + '.000100';

function msg(date, user, text, extra = {}) {
  return { type: 'message', user, text, ts: ts(date, extra.offset || 0), ...extra, offset: undefined };
}

// 12 days across Jan/Feb 2026 (=> monthly pages), with a thread whose parent
// is on Jan 30 and whose replies are on Jan 30 and Feb 2 (cross-month).
function generalChannel() {
  const days = {};
  const dates = ['2026-01-05', '2026-01-06', '2026-01-12', '2026-01-19', '2026-01-26', '2026-01-30',
    '2026-02-02', '2026-02-03', '2026-02-09', '2026-02-16', '2026-02-23', '2026-02-27'];
  for (const d of dates) days[d] = [msg(d, 'U002', `status update for ${d}`)];

  const parentTs = ts('2026-01-30', 60);
  days['2026-01-30'].push({
    type: 'message', user: 'U001', ts: parentTs, thread_ts: parentTs, text: 'Release plan?',
    blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [
      { type: 'text', text: 'Release ' }, { type: 'text', text: 'plan', style: { bold: true } }, { type: 'text', text: '? cc ' },
      { type: 'user', user_id: 'U002' }, { type: 'emoji', name: 'rocket' },
    ] }] }],
    reactions: [{ name: 'thumbsup', count: 3 }, { name: 'custom_party', count: 1 }],
    files: [{ name: 'plan.pdf', permalink: 'https://files.slack.com/plan.pdf' }],
  });
  days['2026-01-30'].push({ type: 'message', user: 'U002', ts: ts('2026-01-30', 120), thread_ts: parentTs, text: 'same-day reply' });
  days['2026-02-02'].push({ type: 'message', user: 'U001', ts: ts('2026-02-02', 30), thread_ts: parentTs, text: 'next-month reply' });
  return days;
}

// 3 days (=> single combined page)
function randomChannel() {
  return {
    '2026-03-01': [msg('2026-03-01', 'U001', 'Hello <@U002> see <https://example.com|the site> *bold* _it_ ~gone~ `code`')],
    '2026-03-02': [msg('2026-03-02', 'UNKNOWN', 'from someone unknown', { user_profile: { display_name: 'Guest Gal' } })],
    '2026-03-03': [msg('2026-03-03', 'U002', '<script>alert(1)</script> & stuff')],
  };
}

function writeChannel(dir, days) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [date, messages] of Object.entries(days)) {
    fs.writeFileSync(path.join(dir, `${date}.json`), JSON.stringify(messages, null, 2));
  }
}

// Multi-channel export: <root>/general/*.json, <root>/random/*.json, <root>/users.json
function makeMultiExport({ users = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-export-'));
  writeChannel(path.join(root, 'general'), generalChannel());
  writeChannel(path.join(root, 'random'), randomChannel());
  fs.mkdirSync(path.join(root, 'empty-folder'));
  fs.writeFileSync(path.join(root, 'channels.json'), '[]');
  if (users) fs.writeFileSync(path.join(root, 'users.json'), JSON.stringify(USERS));
  return root;
}

// Single-channel export: <parent>/users.json, <parent>/<name>/*.json
function makeSingleExport(name = 'design', days = randomChannel()) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-single-'));
  writeChannel(path.join(parent, name), days);
  fs.writeFileSync(path.join(parent, 'users.json'), JSON.stringify(USERS));
  return path.join(parent, name);
}

module.exports = { makeMultiExport, makeSingleExport, writeChannel, generalChannel, randomChannel, USERS, ts };
