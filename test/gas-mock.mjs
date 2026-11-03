// Runs the REAL apps-script/Code.gs inside Node with in-memory fakes of the Google services it uses.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; this.fmt = {}; this.maxRows = 1000; this.writes = 0; }
  get(r, c) { return (this.rows[r - 1] || [])[c - 1] ?? ''; }
  set(r, c, v) {
    if (r > this.maxRows) throw new Error(`Range beyond max rows (${r} > ${this.maxRows}) in ${this.name}`);
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    while (row.length < c) row.push('');
    // emulate Sheets: unless the cell is plain text ('@'), "=..." becomes a formula and dates become Date
    if (typeof v === 'string' && this.fmt[r + ':' + c] !== '@') {
      if (/^=/.test(v)) throw new Error('FORMULA INJECTION at ' + this.name + ' ' + r + ':' + c + ': ' + v);
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('DATE COERCION at ' + this.name + ' ' + r + ':' + c);
    }
    row[c - 1] = v;
  }
  getRange(r, c, nr = 1, nc = 1) {
    const sh = this;
    const api = {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => sh.get(r + i, c + j))),
      getValue: () => sh.get(r, c),
      setValues: (vals) => { sh.writes++; vals.forEach((row, i) => row.forEach((v, j) => sh.set(r + i, c + j, v))); return api; },
      setValue: (v) => { sh.set(r, c, v); return api; },
      setNumberFormat: (f) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh.fmt[(r + i) + ':' + (c + j)] = f; return api; },
      clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (sh.rows[r + i - 1]) sh.rows[r + i - 1][c + j - 1] = ''; return api; },
      setFontWeight: () => api, setBackground: () => api, setFontColor: () => api,
    };
    return api;
  }
  getLastRow() {
    for (let i = this.rows.length; i > 0; i--) if (this.rows[i - 1].some(v => v !== '' && v != null)) return i;
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.rows.map(r => { for (let j = r.length; j > 0; j--) if (r[j - 1] !== '' && r[j - 1] != null) return j; return 0; })); }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(after, n) { this.maxRows += n; }
  setFrozenRows() {}
}

class FakeCache {
  constructor() { this.m = new Map(); }
  get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  put(k, v) { this.m.set(k, String(v)); }
  remove(k) { this.m.delete(k); }
}

export function loadGas(opts = {}) {
  const state = {
    sheets: {}, emails: [], fetches: [], triggers: [], props: Object.assign({}, opts.props || {}),
    cache: new FakeCache(), routes: opts.routes || (() => null), tz: 'America/Mexico_City', lastError: '',
  };
  const ss = {
    getSheetByName: (n) => state.sheets[n] || null,
    insertSheet: (n) => (state.sheets[n] = new FakeSheet(n)),
  };
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const doFetch = (url, o = {}) => {
    state.fetches.push({ url, o });
    const r = state.routes(url, o);
    return r ? resp(r[0], r[1]) : resp(404, { error: 'no route' });
  };
  const ctx = {
    console: { log() {}, error: (...a) => { state.lastError = a.map(String).join(' '); } },
    Logger: { log: (m) => { state.log = m; } },
    SpreadsheetApp: { getActive: () => ss },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
    CacheService: { getScriptCache: () => state.cache },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => state.props[k] ?? null }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ _s: s, setMimeType() { return this; }, getContent() { return this._s; } }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map(x => (x > 127 ? x - 256 : x)),
      getUuid: () => crypto.randomUUID(),
      base64Encode: (s) => Buffer.from(String(s)).toString('base64'),
      formatDate: (d, tz, f) => {
        const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz || state.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
        return p; // yyyy-MM-dd
      },
      sleep: () => {},
    },
    Session: {
      getScriptTimeZone: () => state.tz,
      getEffectiveUser: () => ({ getEmail: () => opts.owner || 'execprogram@adizes.com' }),
      getActiveUser: () => ({ getEmail: () => opts.owner || 'execprogram@adizes.com' }),
    },
    GmailApp: {
      getAliases: () => [],
      sendEmail: (to, subject, body, options) => { if (opts.emailFail) throw new Error('mail down'); state.emails.push({ to, subject, body, options }); },
    },
    UrlFetchApp: {
      fetch: (url, o) => doFetch(url, o),
      fetchAll: (reqs) => reqs.map(r => doFetch(r.url, r)),
    },
    ScriptApp: {
      getProjectTriggers: () => state.triggers,
      deleteTrigger: () => {},
      newTrigger: (fn) => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create: () => state.triggers.push({ fn, getHandlerFunction: () => fn }) }) }) }) }),
    },
  };
  vm.createContext(ctx);
  const code = readFileSync(join(here, '..', 'apps-script', 'Code.gs'), 'utf8');
  vm.runInContext(code + '\n;globalThis.__gas = { doPost, doGet, setup, dailyJobs, CONFIG, SCHEMA, DEFAULT_TEMPLATE };', ctx);
  const gas = ctx.__gas;
  const post = (obj) => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(obj) } }).getContent());
  // sign in through the real code flow; returns token
  const login = (email) => {
    const before = state.emails.length;
    const r1 = post({ action: 'auth.request', email });
    if (!r1.ok) throw new Error('auth.request failed ' + JSON.stringify(r1));
    const mail = state.emails.slice(before).find(m => m.to === email);
    if (!mail) throw new Error('no code email for ' + email);
    const code = mail.subject.match(/(\d{6})/)[1];
    const r2 = post({ action: 'auth.verify', email, code });
    if (!r2.ok) throw new Error('auth.verify failed ' + JSON.stringify(r2));
    return r2.token;
  };
  return { gas, state, post, login, sheet: (n) => state.sheets[n] };
}
