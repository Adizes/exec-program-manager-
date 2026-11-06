// Local server that imitates the Webflow page + the Apps Script web app (including its 302 redirect).
//   node test/server.mjs            → http://localhost:8787  (staff)  ·  /profile?t=…  (learner)
//   IMPORT_DIR=/path node test/server.mjs   also imports cohort JSON files at start
import http from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGas } from './gas-mock.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = Number(process.env.PORT || 8787);

// Fake Teachable: every course has 2 sections / 6 lessons; progress depends on the user id
const routes = (url) => {
  if (url.includes('/lecture_sections')) return [200, { lecture_sections: [
    { id: 1, name: 'Pre-work', is_published: true, lectures: [1, 2, 3].map(i => ({ id: i, name: 'Reading ' + i, is_published: true })) },
    { id: 2, name: 'Check your understanding', is_published: true, lectures: [4, 5, 6].map(i => ({ id: i, name: 'Exercise ' + (i - 3), is_published: true })) }] }];
  if (/\/api\/v1\/courses\/\d+$/.test(url)) return [200, { name: 'Course ' + url.split('/').pop() }];
  if (url.includes('/enrolled_students')) return [200, { included: [] }];
  if (url.includes('/v1/users?email=')) { const e = decodeURIComponent(url.split('email=')[1]); return [200, { users: [{ id: 1000 + (e.length * 7) % 97 }] }]; }
  const m = url.match(/progress\?user_id=(\d+)/);
  if (m) { const n = Number(m[1]) % 7; return [200, { course_progress: { lecture_sections: [{ lectures: [1, 2, 3, 4, 5, 6].map(i => ({ id: i, is_completed: i <= n, completed_at: '2026-10-0' + i + 'T10:00:00Z' })) }] } }]; }
  return null;
};

export function start(opts = {}) {
  const G = loadGas({ routes, props: { TEACHABLE_API_KEY: 'k', TEACHABLE_BASIC_USER: 'u', TEACHABLE_BASIC_PASS: 'p' } });
  G.gas.setup();
  const pmToken = G.login('execprogram@adizes.com');
  G.post({ action: 'users.save', token: pmToken, user: { email: 'dani@adizes.com', name: 'Dani Carrillo', role: 'PM' }, sendInvite: false });
  G.post({ action: 'users.save', token: pmToken, user: { email: 'shoham@adizes.com', name: 'Shoham', role: 'SME' }, claimName: 'Shoham', sendInvite: false });
  const dir = opts.importDir || process.env.IMPORT_DIR;
  if (dir && existsSync(dir)) {
    readdirSync(dir).filter(f => f.endsWith('.json')).sort().forEach(f => {
      const r = G.post({ action: 'import.cohort', token: pmToken, data: JSON.parse(readFileSync(join(dir, f), 'utf8')) });
      console.log('imported', f, r.ok ? '' : r.error);
    });
    // let Shoham see his feedback in every cohort
    G.post({ action: 'bootstrap', token: pmToken }).cohorts.forEach(c => {
      const C = G.post({ action: 'cohort.get', token: pmToken, id: c.id });
      const blocks = C.blocks.map(b => Object.assign({}, b, { smeSeesFeedback: b.smeEmail === 'shoham@adizes.com' }));
      G.post({ action: 'structure.save', token: pmToken, cohortId: c.id, blocks, sessions: C.sessions });
    });
  }
  const results = new Map();
  let seq = 0;
  const page = (cfg) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Exec Program Manager (local)</title>
<style>/* Webflow-like globals that must NOT break the app */
body{margin:0;font-family:Arial,sans-serif;font-size:16px;color:#333;line-height:20px}
h1,h2,h3{margin:20px 0 10px;font-weight:bold;text-transform:uppercase}
a{color:#3898ec;text-decoration:underline} button,input,select,textarea{font-size:18px;margin:0 0 10px;border-radius:0}
ul,ol{padding-left:40px;margin-top:0;margin-bottom:10px} li{list-style:disc} p{margin-bottom:10px} img{max-width:100%;vertical-align:middle;display:inline-block} label{display:block;margin-bottom:5px;font-weight:bold}
.w-nav{height:70px;background:#fff;border-bottom:1px solid #eee}</style></head>
<body><div class="w-nav"></div><div id="epm-app"></div>
<script>window.EPM_CONFIG = ${JSON.stringify(cfg)};</script><script src="/dist/epm.js"></script></body></html>`;

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'POST' && u.pathname === '/exec') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const out = G.gas.doPost({ postData: { contents: body } }).getContent();
        const k = String(++seq); results.set(k, out);
        res.writeHead(302, { Location: '/exec-result?k=' + k }); res.end();   // like Apps Script
      });
      return;
    }
    if (u.pathname === '/exec-result') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(results.get(u.searchParams.get('k')) || '{}'); return; }
    if (u.pathname === '/__emails') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(G.state.emails.slice(-20))); return; }
    if (u.pathname === '/' || u.pathname === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page({ endpoint: '/exec', assets: '/assets/' })); return; }
    if (u.pathname === '/profile') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page({ endpoint: '/exec', mode: 'learner', assets: '/assets/' })); return; }
    const file = join(root, u.pathname);
    if ((u.pathname.startsWith('/dist/') || u.pathname.startsWith('/assets/')) && existsSync(file)) {
      res.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.png': 'image/png' }[extname(file)] || 'application/octet-stream' });
      res.end(readFileSync(file)); return;
    }
    res.writeHead(404); res.end('not found');
  });
  return new Promise(r => server.listen(opts.port || PORT, () => r({ server, G, pmToken, url: 'http://localhost:' + (opts.port || PORT) })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start().then(s => console.log('Local app on ' + s.url + '  · sign in with execprogram@adizes.com; codes at ' + s.url + '/__emails'));
}
