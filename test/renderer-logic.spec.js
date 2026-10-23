// Slack -> Confluence conversion logic, executed in the real renderer so it
// runs on whichever Chromium the Electron version ships.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers/app');
const { USERS, ts } = require('./helpers/slack-export');

let ctx;
const run = (fn, ...args) => ctx.window.evaluate(fn, ...args);

test.beforeAll(async () => { ctx = await launchApp(); });
test.afterAll(async () => { await ctx.close(); });
test.beforeEach(async () => {
  await run(users => {
    state.userMap = {};
    for (const u of users) state.userMap[u.id] = { id: u.id, name: u.name, realName: u.profile?.real_name || u.real_name || u.name, displayName: u.profile?.display_name || '', avatar: u.profile?.image_72 || '' };
  }, USERS);
});

test('parseConfluenceUrl recognises every supported URL shape', async () => {
  const r = await run(() => [
    parseConfluenceUrl('https://acme.atlassian.net/wiki/spaces/ENG/pages/123456/Parent+Page'),
    parseConfluenceUrl('https://acme.atlassian.net/wiki/spaces/ENG/pages/edit-v2/777'),
    parseConfluenceUrl('https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=42'),
    parseConfluenceUrl('https://acme.atlassian.net/wiki/x/98765/whatever'),
    parseConfluenceUrl('https://acme.atlassian.net/wiki/home'),
    parseConfluenceUrl('not a url'),
  ]);
  expect(r).toEqual([
    { baseUrl: 'https://acme.atlassian.net', spaceKey: 'ENG', pageId: '123456' },
    { baseUrl: 'https://acme.atlassian.net', spaceKey: 'ENG', pageId: '777' },
    { baseUrl: 'https://acme.atlassian.net', spaceKey: null, pageId: '42' },
    { baseUrl: 'https://acme.atlassian.net', spaceKey: null, pageId: '98765' },
    null,
    null,
  ]);
});

test('escapeHtml escapes all five special characters', async () => {
  expect(await run(() => [escapeHtml(`<a href="x">'&'</a>`), escapeHtml(''), escapeHtml(undefined)]))
    .toEqual(['&lt;a href=&quot;x&quot;&gt;&#039;&amp;&#039;&lt;/a&gt;', '', '']);
});

test('formatSlackText converts Slack markup, links and mentions', async () => {
  const r = await run(() => [
    formatSlackText('*bold* _it_ ~gone~ `code`'),
    formatSlackText('line1\nline2'),
    formatSlackText('hi <@U001> and <@U999>'),
    formatSlackText('<script>x</script> & y'),
    formatSlackText(''),
  ]);
  expect(r).toEqual([
    '<strong>bold</strong> <em>it</em> <s>gone</s> <code>code</code>',
    'line1<br/>line2',
    'hi <strong>@alice.a</strong> and <strong>@U999</strong>',
    '&lt;script&gt;x&lt;/script&gt; &amp; y',
    '',
  ]);
});

// Regression: links used to be matched after escapeHtml had turned "<"/">"
// into entities, so they were never converted.
test('formatSlackText converts <url|text> and <url> links without mangling URLs', async () => {
  const r = await run(() => [
    formatSlackText('see <https://example.com|the site>'),
    formatSlackText('raw <https://example.com/a_b_c?x=1&y=*2*> link'),
    formatSlackText('*bold* <https://e.com/_x_|label_with_underscores> _it_'),
    formatSlackText('<@U001> <mailto:a@b.c|mail> <https://e.com|"quoted">'),
  ]);
  expect(r).toEqual([
    'see <a href="https://example.com">the site</a>',
    'raw <a href="https://example.com/a_b_c?x=1&amp;y=*2*">https://example.com/a_b_c?x=1&amp;y=*2*</a> link',
    '<strong>bold</strong> <a href="https://e.com/_x_">label_with_underscores</a> <em>it</em>',
    '<strong>@alice.a</strong> &lt;mailto:a@b.c|mail&gt; <a href="https://e.com">&quot;quoted&quot;</a>',
  ]);
});

test('renderRichTextElements renders styles, links, emoji, mentions and groups', async () => {
  const html = await run(() => renderRichTextElements([
    { type: 'text', text: 'a<b', style: { bold: true, italic: true } },
    { type: 'text', text: 'x', style: { strike: true, code: true } },
    { type: 'link', url: 'https://e.com/?q="1"', text: 'E' },
    { type: 'link', url: 'https://bare.com' },
    { type: 'emoji', name: 'tada' },
    { type: 'emoji', name: 'not_known' },
    { type: 'user', user_id: 'U002' },
    { type: 'user', user_id: 'U404' },
    { type: 'usergroup', usergroup_id: 'S1' },
    { type: 'channel', channel_id: 'C1' },
    { type: 'broadcast', text: '@here' },
  ]));
  expect(html).toBe(
    '<em><strong>a&lt;b</strong></em><code><s>x</s></code>' +
    '<a href="https://e.com/?q=&quot;1&quot;">E</a><a href="https://bare.com">https://bare.com</a>' +
    '🎉:not_known:<strong>@Bob Brown</strong><strong>@U404</strong><strong>@group</strong><strong>#channel</strong>@here');
});

test('renderRichTextBlock handles sections, lists, code and quotes', async () => {
  const html = await run(() => renderRichTextBlock({ type: 'rich_text', elements: [
    { type: 'rich_text_section', elements: [{ type: 'text', text: 'p' }] },
    { type: 'rich_text_list', style: 'ordered', elements: [{ elements: [{ type: 'text', text: 'one' }] }] },
    { type: 'rich_text_list', style: 'bullet', elements: [{ elements: [{ type: 'text', text: 'dot' }] }] },
    { type: 'rich_text_preformatted', elements: [{ type: 'text', text: 'x = 1' }] },
    { type: 'rich_text_quote', elements: [{ type: 'text', text: 'q' }] },
  ] }));
  expect(html).toBe('<p>p</p><ol><li>one</li></ol><ul><li>dot</li></ul><pre>x = 1</pre><blockquote>q</blockquote>');
});

test('renderMessage: user map, profile fallback, reactions, files, reply styling', async () => {
  const r = await run(t => ({
    known: renderMessage({ user: 'U001', text: 'hi', ts: t, reactions: [{ name: 'fire', count: 2 }], files: [{ title: 'doc', permalink: 'https://f/x' }] }),
    fallback: renderMessage({ user: 'UX', text: 'yo', ts: t, user_profile: { display_name: 'Guest', image_72: 'https://a/g.png' } }),
    anonymous: renderMessage({ text: 'anon' }),
    reply: renderMessage({ user: 'U002', text: 'r', ts: t }, true),
    blocksWin: renderMessage({ user: 'U002', text: 'plain', blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'rich' }] }] }] }),
  }), ts('2026-01-05'));
  expect(r.known).toContain('<strong style="vertical-align: middle;">alice.a</strong>');
  expect(r.known).toContain('<img src="https://avatars.example/alice.png"');
  expect(r.known).toContain('🔥 2</span>');
  expect(r.known).toContain('📎 <strong>doc</strong>');
  expect(r.known).toContain('(Original: https://f/x)');
  expect(r.fallback).toContain('>Guest</strong>');
  expect(r.fallback).toContain('<img src="https://a/g.png"');
  expect(r.anonymous).toContain('>Unknown User</strong>');
  expect(r.anonymous).not.toContain('<img');
  expect(r.reply).toContain('background: #f4f5f7; margin-left: 40px;');
  expect(r.blocksWin).toContain('<p>rich</p>');
  expect(r.blocksWin).not.toContain('plain');
});

test('groupByMonth sorts months and keeps day order; month labels and titles', async () => {
  const r = await run(() => {
    const m = groupByMonth([{ dateName: '2026-02-01', messages: [] }, { dateName: '2025-12-31', messages: [] }, { dateName: '2026-02-03', messages: [] }]);
    return {
      keys: [...m.keys()],
      feb: m.get('2026-02').map(d => d.dateName),
      labels: [formatMonthLabel('2026-01'), formatMonthLabel('2025-12')],
      title: buildMonthlyPageTitle('general', '2026-03'),
    };
  });
  expect(r).toEqual({ keys: ['2025-12', '2026-02'], feb: ['2026-02-01', '2026-02-03'], labels: ['January 2026', 'December 2025'], title: 'general - March 2026' });
});

test('threads: replies nest under their parent across days; orphans render standalone', async () => {
  const r = await run(([p, r1, r2, o]) => {
    const days = [
      { dateName: '2026-01-30', messages: [{ user: 'U001', ts: p, thread_ts: p, text: 'PARENT' }, { user: 'U002', ts: r1, thread_ts: p, text: 'REPLY1' }] },
      { dateName: '2026-02-02', messages: [{ user: 'U001', ts: r2, thread_ts: p, text: 'REPLY2' }, { user: 'U002', ts: o, thread_ts: '1.0', text: 'ORPHAN' }] },
    ];
    const a = buildThreadMapAcrossDays(days);
    const day1 = renderDayMessages(days[0].messages, a.threads, a.parentTsSet);
    const day2 = renderDayMessages(days[1].messages, a.threads, a.parentTsSet);
    return {
      replyOrder: a.threads.get(p).map(m => m.text),
      replyDates: [...a.replyDatesByThreadTs.get(p)],
      day1, day2,
      crossJan: monthHasCrossDateThreads([days[0]], a),
      crossNone: monthHasCrossDateThreads([{ dateName: '2026-03-01', messages: [{ ts: '9.0', text: 'solo' }] }], buildThreadMapAcrossDays([{ dateName: '2026-03-01', messages: [{ ts: '9.0', text: 'solo' }] }])),
    };
  }, [ts('2026-01-30'), ts('2026-01-30', 60), ts('2026-02-02'), ts('2026-02-02', 5)]);
  expect(r.replyOrder).toEqual(['REPLY1', 'REPLY2']);
  expect(r.replyDates).toEqual(['2026-01-30', '2026-02-02']);
  expect(r.day1).toContain('💬 Thread replies (2)');
  expect(r.day1.indexOf('PARENT')).toBeLessThan(r.day1.indexOf('REPLY1'));
  expect(r.day1.indexOf('REPLY1')).toBeLessThan(r.day1.indexOf('REPLY2'));
  expect(r.day2).not.toContain('REPLY2');
  expect(r.day2).toContain('ORPHAN');
  expect(r.day2).toContain('margin-left: 40px;');
  expect(r.crossJan).toBe(true);
  expect(r.crossNone).toBe(false);
});

test('nav links: linked, unlinked and absent neighbours', async () => {
  const r = await run(() => [
    buildNavLinks('https://c/p1', 'January 2026', 'https://c/p3', 'March 2026'),
    buildNavLinks(null, 'January 2026', null, null),
  ]);
  expect(r[0]).toContain('<a href="https://c/p1">&larr; January 2026</a>');
  expect(r[0]).toContain('<a href="https://c/p3">March 2026 &rarr;</a>');
  expect(r[1]).toContain('&larr; January 2026</td>');
  expect(r[1]).not.toContain('<a ');
  expect(r[1]).not.toContain('&rarr;');
});

test('checkNavLinksNeedUpdate notices a missing neighbour label', async () => {
  const r = await run(() => [
    checkNavLinksNeedUpdate('… January 2026 … March 2026 …', 'g', '2026-01', '2026-03'),
    checkNavLinksNeedUpdate('… January 2026 …', 'g', '2026-01', '2026-03'),
    checkNavLinksNeedUpdate('', 'g', null, null),
  ]);
  expect(r).toEqual([false, true, false]);
});

test('incremental import: existing dates are detected and skipped', async () => {
  const r = await run(() => {
    const page = '<h1>x</h1><h2>📅 2026-01-05</h2><hr/><p>a</p><h2 style="x">📅 2026-01-06 </h2>';
    const existing = extractExistingDates(page);
    const inc = buildIncrementalContent([
      { dateName: '2026-01-05', messages: [{ text: 'old' }] },
      { dateName: '2026-01-07', messages: [{ text: 'NEW' }] },
    ], existing);
    return { existing: [...existing], count: inc.newDatesCount, html: inc.html };
  });
  expect(r.existing).toEqual(['2026-01-05', '2026-01-06']);
  expect(r.count).toBe(1);
  expect(r.html).toContain('<h2>📅 2026-01-07</h2>');
  expect(r.html).toContain('NEW');
  expect(r.html).not.toContain('old');
});

test('monthly page content round-trips through extractExistingDates', async () => {
  const r = await run(() => {
    const html = buildMonthlyPageContent('gen<eral>', '2026-01', [
      { dateName: '2026-01-05', messages: [{ text: 'a' }] }, { dateName: '2026-01-06', messages: [{ text: 'b' }] },
    ], null, null, 'https://c/next', 'February 2026');
    return { html, dates: [...extractExistingDates(html)] };
  });
  expect(r.html.startsWith('<h1>gen&lt;eral&gt; - January 2026</h1>')).toBe(true);
  expect(r.html.match(/February 2026 &rarr;/g)).toHaveLength(2); // top and bottom nav
  expect(r.dates).toEqual(['2026-01-05', '2026-01-06']);
});

test('channel parent page has the children macro', async () => {
  const html = await run(() => buildChannelParentContent('dev & ops'));
  expect(html).toContain('<h1>Slack Channel: dev &amp; ops</h1>');
  expect(html).toContain('<ac:structured-macro ac:name="children">');
});
