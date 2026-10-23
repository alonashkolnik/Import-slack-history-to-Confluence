// Fake Confluence Cloud REST API (HTTPS, allowlisted test certificate) for the
// Electron tests. The app reaches it as acme.atlassian.net, mapped to
// 127.0.0.1 by the launcher's --host-resolver-rules.
const https = require('https');
const fs = require('fs');
const path = require('path');

const COOKIE = 'cloud.session.token=slack-test-1';

function json(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': body.length });
  res.end(body);
}

function createMockConfluence() {
  const pages = {}; // id -> { id, title, space, parentId, body, version }
  const requests = [];
  const failures = []; // [{ method, pathRe, status, body, times }]
  let nextId = 100000;

  function addPage({ id, title, space = 'ENG', parentId = null, body = '', version = 1 }) {
    const page = { id: String(id || nextId++), title, space, parentId: parentId && String(parentId), body, version };
    pages[page.id] = page;
    return page;
  }

  function ancestorsOf(page) {
    const out = [];
    let p = page.parentId && pages[page.parentId];
    while (p) { out.unshift({ id: p.id, title: p.title }); p = p.parentId && pages[p.parentId]; }
    return out;
  }

  function pageJson(page, expand) {
    const out = { id: page.id, type: 'page', title: page.title, _links: { webui: `/spaces/${page.space}/pages/${page.id}` } };
    if (expand.includes('space')) out.space = { key: page.space };
    if (expand.includes('version')) out.version = { number: page.version };
    if (expand.includes('body.storage')) out.body = { storage: { value: page.body, representation: 'storage' } };
    if (expand.includes('ancestors')) out.ancestors = ancestorsOf(page);
    return out;
  }

  function handler(req, res) {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, `https://${req.headers.host}`);
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      const authed = (req.headers.cookie || '').split(/;\s*/).includes(COOKIE);

      const fi = failures.findIndex(f => (!f.method || f.method === req.method) && f.pathRe.test(req.url));
      if (fi !== -1) {
        const f = failures[fi];
        if (--f.times <= 0) failures.splice(fi, 1);
        return json(res, f.status, f.body || { message: `injected ${f.status}` });
      }

      const p = url.pathname;
      // Login flow: /wiki -> /login (sets cookie) -> /wiki/spaces/ENG/overview
      if (p === '/wiki' || p === '/wiki/') {
        res.writeHead(302, { Location: authed ? '/wiki/home' : '/login?continue=%2Fwiki' });
        return res.end();
      }
      if (p === '/login') {
        res.writeHead(302, { Location: '/wiki/spaces/ENG/overview', 'Set-Cookie': `${COOKIE}; Path=/; Secure; HttpOnly` });
        return res.end();
      }
      // Sets the session cookie but is not a /wiki/ URL, so the app does not treat it as "logged in"
      if (p === '/cookie-only') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': `${COOKIE}; Path=/; Secure; HttpOnly` });
        return res.end('<html><body>cookie set</body></html>');
      }
      if (!p.startsWith('/wiki/rest/')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<html><head><title>Confluence</title></head><body>wiki page</body></html>');
      }
      if (!authed) return json(res, 401, { message: 'Unauthorized' });

      const expand = (url.searchParams.get('expand') || '').split(',');
      let m;
      if (req.method === 'GET' && p === '/wiki/rest/api/content') {
        const title = url.searchParams.get('title');
        const space = url.searchParams.get('spaceKey');
        const results = Object.values(pages).filter(pg => pg.title === title && pg.space === space).map(pg => pageJson(pg, expand));
        return json(res, 200, { results, size: results.length });
      }
      if (req.method === 'POST' && p === '/wiki/rest/api/content') {
        const c = JSON.parse(body.toString());
        if (Object.values(pages).some(pg => pg.title === c.title && pg.space === c.space.key)) {
          return json(res, 400, { statusCode: 400, message: 'A page with this title already exists: A page already exists with the same TITLE in this space' });
        }
        const page = addPage({ title: c.title, space: c.space.key, parentId: c.ancestors?.[0]?.id, body: c.body.storage.value });
        return json(res, 200, pageJson(page, ['version']));
      }
      if ((m = p.match(/^\/wiki\/rest\/api\/content\/(\d+)\/child\/page$/))) {
        const results = Object.values(pages).filter(pg => pg.parentId === m[1]).map(pg => ({ id: pg.id, title: pg.title }));
        return json(res, 200, { results, size: results.length });
      }
      if ((m = p.match(/^\/wiki\/rest\/api\/content\/(\d+)$/))) {
        const page = pages[m[1]];
        if (!page) return json(res, 404, { message: `No content found with id ${m[1]}` });
        if (req.method === 'PUT') {
          const u = JSON.parse(body.toString());
          if (u.version.number !== page.version + 1) {
            return json(res, 409, { message: `Version must be incremented on update. Current version is: ${page.version}` });
          }
          page.version = u.version.number;
          page.title = u.title;
          page.body = u.body.storage.value;
          return json(res, 200, pageJson(page, ['version']));
        }
        return json(res, 200, pageJson(page, expand));
      }
      return json(res, 404, { message: `mock: unhandled ${req.method} ${p}` });
    });
  }

  const server = https.createServer({
    key: fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'allowlisted.key')),
    cert: fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'allowlisted.crt')),
  }, handler);

  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port,
    pages, requests, failures, addPage,
    childrenOf: id => Object.values(pages).filter(pg => pg.parentId === String(id)),
    byTitle: title => Object.values(pages).find(pg => pg.title === title),
    close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }),
  })));
}

module.exports = { createMockConfluence, COOKIE };
