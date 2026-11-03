/* ===================================================================================
 * CORE — config, API client, state, DOM helpers, router, UI primitives
 * =================================================================================== */
var CFG = window.EPM_CONFIG || {};
var VERSION = '__VERSION__';
var ROOT_ID = CFG.mount || 'epm-app';
var LS_KEY = 'epm_session_v1';

function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }

var S = {
  token: null, user: null, boot: null, cohorts: {}, view: null, busy: 0,
};

/* ---------------- API ---------------- */
var ERRORS = {
  auth_code_expired: 'The code expired. Request a new one.',
  auth_wrong_code: 'That code is not correct.',
  auth_too_many_tries: 'Too many attempts. Request a new code.',
  auth_no_access: 'This email does not have access.',
  auth_expired: 'Your session expired. Sign in again.',
  auth_required: 'Please sign in.',
  forbidden: 'You do not have permission for this.',
  not_found: 'Not found (it may have been deleted).',
  invalid_email: 'Check the email address.',
  invalid_domain: 'Only @adizes.com accounts can be added to the team.',
  invalid_name_exists: 'A cohort with that name already exists.',
  invalid_name: 'A name is required.',
  invalid_template_pending: 'This email template still has placeholder text.',
  invalid_teachable_not_configured: 'Teachable keys are not set in the Apps Script (Script Properties).',
  invalid_no_teachable_courses: 'Add the Teachable course IDs to the blocks first (Settings → Structure).',
  invalid_typeform_not_configured: 'TYPEFORM_TOKEN is not set in the Apps Script (Script Properties).',
  invalid_typeform_no_forms: 'Add the Typeform form ID in Settings first.',
  invalid_typeform_form: 'No Typeform form ID for this cohort language (Settings).',
  invalid_self_demote: 'You cannot remove your own Program Manager access.',
  invalid_link: 'This link is not valid. Please contact the program team. · Este enlace no es válido; escríbenos para ayudarte.',
  invalid_import_format: 'This file is not an import file from tools/migrate.py.',
  network: 'Could not reach the server. Check your connection and try again.',
};
function errText(code) { return ERRORS[code] || String(code || 'Something went wrong').replace(/^invalid_/, '').replace(/_/g, ' '); }

function api(action, payload, opts) {
  opts = opts || {};
  if (!CFG.endpoint) return Promise.reject(new Error('Missing EPM_CONFIG.endpoint'));
  var body = Object.assign({ action: action, v: VERSION }, payload || {});
  if (S.token && !opts.noToken) body.token = S.token;
  if (!opts.silent) busy(1);
  return fetch(CFG.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' })
    .then(function (r) { return r.json(); })
    .catch(function () { return { ok: false, error: 'network' }; })
    .then(function (res) {
      if (!opts.silent) busy(-1);
      if (!res || !res.ok) {
        var code = res && res.error;
        if (code === 'auth_expired' || code === 'auth_required' || code === 'auth_no_access') { signOutLocal(); }
        var err = new Error(errText(code)); err.code = code; throw err;
      }
      return res;
    });
}

function busy(d) {
  S.busy = Math.max(0, S.busy + d);
  var el = document.querySelector('#' + ROOT_ID + ' .epm-progress');
  if (el) el.classList.toggle('on', S.busy > 0);
}

/* ---------------- DOM ---------------- */
// h('div.cls#id', {attrs/props/on...}, children...)
function h(sel, attrs) {
  var m = String(sel).match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i) || [];
  var el = document.createElement(m[1] || 'div');
  (m[2] || '').replace(/([.#])([\w-]+)/g, function (_, t, n) { if (t === '.') el.classList.add(n); else el.id = n; });
  var kids = Array.prototype.slice.call(arguments, 2);
  if (attrs && (attrs.nodeType || Array.isArray(attrs) || typeof attrs !== 'object')) { kids.unshift(attrs); attrs = null; }
  if (attrs) Object.keys(attrs).forEach(function (k) {
    var v = attrs[k];
    if (v == null || v === false) return;
    if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach(function (c) { el.classList.add(c); });
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v; // only for trusted, static markup (icons)
    else if (k in el && k !== 'list' && k !== 'type' && typeof v !== 'string') el[k] = v;
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  });
  append(el, kids);
  return el;
}
function append(el, kids) {
  (kids || []).forEach(function (c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  });
  return el;
}
function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
// Clears the app root but keeps the toast stack, so messages survive a re-render
function resetRoot(root) { var keep = root.querySelector(':scope > .epm-toasts'); clear(root); if (keep) root.appendChild(keep); return root; }
function $(sel, root) { return (root || document).querySelector(sel); }

var ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>', check: '<path d="M5 12l5 5L20 7"/>', up: '<path d="M12 19V5M6 11l6-6 6 6"/>', down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  mail: '<path d="M3 6h18v12H3z"/><path d="M3 6l9 7 9-7"/>', link: '<path d="M10 14a4 4 0 006 0l3-3a4 4 0 00-6-6l-1 1"/><path d="M14 10a4 4 0 00-6 0l-3 3a4 4 0 006 6l1-1"/>',
  sync: '<path d="M20 11a8 8 0 00-14-5L4 8M4 4v4h4M4 13a8 8 0 0014 5l2-2M20 20v-4h-4"/>', upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  copy: '<path d="M8 8h12v12H8z"/><path d="M4 16V4h12"/>', play: '<path d="M7 5l12 7-12 7z"/>', chevron: '<path d="M9 6l6 6-6 6"/>', back: '<path d="M15 6l-6 6 6 6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>', alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17v1"/>', out: '<path d="M14 4h6v16h-6M10 8l-4 4 4 4M6 12h10"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>', filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
};
function icon(name, size) {
  var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size || 16); s.setAttribute('height', size || 16);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || '';
  s.classList.add('epm-ic');
  return s;
}
function btn(label, opts, onClick) {
  opts = opts || {};
  var b = h('button.epm-btn', { type: 'button', class: opts.kind ? 'epm-btn-' + opts.kind : '', title: opts.title || null, disabled: !!opts.disabled, 'aria-label': opts.aria || null, onclick: onClick });
  if (opts.icon) b.appendChild(icon(opts.icon));
  if (label) b.appendChild(h('span', label));
  return b;
}

/* ---------------- formatting ---------------- */
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function pd(s) { if (!s) return null; var p = String(s).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
function iso(d) { return d.toISOString().slice(0, 10); }
function fmtDate(s, withWd) { var d = pd(s); if (!d || isNaN(d)) return '—'; return (withWd ? WD[d.getUTCDay()] + ' ' : '') + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2); }
function fmtDateTime(s) { if (!s) return '—'; var d = new Date(s); if (isNaN(d)) return s; return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function pct(v, digits) { return v == null || isNaN(v) ? '—' : (v * 100).toFixed(digits == null ? 0 : digits) + '%'; }
function num(v, d) { return v == null || isNaN(v) ? '—' : Number(v).toFixed(d == null ? 2 : d); }
function today() { return (S.boot && S.boot.today) || iso(new Date()); }
function fullName(l) { return l ? ((l.firstName || '') + ' ' + (l.lastName || '')).trim() || l.email : ''; }
function addDays(s, n) { var d = pd(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
function normName(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9@. ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function tone(v) { if (v == null || isNaN(v)) return 'none'; return v >= 0.75 ? 'good' : v >= 0.4 ? 'mid' : 'low'; }
function pctCell(v) { return h('span.epm-pct', { class: 'epm-t-' + tone(v) }, pct(v)); }
function avg(a) { a = a.filter(function (x) { return x != null && !isNaN(x); }); return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; }
function overall5(r) { return avg([r.q1, r.q2, r.q3, r.q4, r.q5]); }
function copyText(s) {
  var done = function () { toast('Copied'); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(done, function () { fallback(); });
  else fallback();
  function fallback() { var ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }); ta.value = s; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ } ta.remove(); }
}

/* ---------------- toast / modal / confirm ---------------- */
function toast(msg, kind) {
  var root = document.getElementById(ROOT_ID);
  var wrap = $('.epm-toasts', root) || root.appendChild(h('.epm-toasts', { role: 'status', 'aria-live': 'polite' }));
  var t = h('.epm-toast', { class: kind ? 'epm-toast-' + kind : '' }, msg);
  wrap.appendChild(t);
  setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 300); }, kind === 'error' ? 6000 : 2600);
}
function fail(e) { toast(e && e.message ? e.message : String(e), 'error'); }

function modal(title, body, opts) {
  opts = opts || {};
  var root = document.getElementById(ROOT_ID);
  var prevFocus = document.activeElement;
  var close = function () { ov.remove(); document.removeEventListener('keydown', onKey); if (prevFocus && prevFocus.focus) prevFocus.focus(); if (opts.onClose) opts.onClose(); };
  var onKey = function (e) { if (e.key === 'Escape') close(); };
  var panel = h('.epm-modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, class: opts.wide ? 'epm-modal-wide' : (opts.drawer ? 'epm-drawer' : '') },
    h('.epm-modal-head', h('h3', title), btn('', { icon: 'close', kind: 'ghost', aria: 'Close' }, close)),
    h('.epm-modal-body', body),
    opts.footer ? h('.epm-modal-foot', opts.footer) : null);
  var ov = h('.epm-overlay', { class: opts.drawer ? 'epm-overlay-drawer' : '', onmousedown: function (e) { if (e.target === ov) close(); } }, panel);
  root.appendChild(ov);
  document.addEventListener('keydown', onKey);
  setTimeout(function () { var f = panel.querySelector('input,select,textarea,button:not(.epm-btn-ghost)'); if (f) f.focus(); }, 30);
  return { close: close, panel: panel, body: $('.epm-modal-body', panel) };
}
function confirmBox(title, text, okLabel, danger) {
  return new Promise(function (res) {
    var m;
    var ok = btn(okLabel || 'Confirm', { kind: danger ? 'danger' : 'primary' }, function () { m.close(); res(true); });
    m = modal(title, h('p.epm-p', text), { footer: [btn('Cancel', { kind: 'ghost' }, function () { m.close(); res(false); }), ok], onClose: function () { res(false); } });
  });
}

/* ---------------- form helpers ---------------- */
function field(label, input, hint) {
  return h('label.epm-field', h('span.epm-label', label), input, hint ? h('span.epm-hint', hint) : null);
}
function inputEl(value, attrs) { return h('input.epm-input', Object.assign({ type: 'text', value: value == null ? '' : value }, attrs || {})); }
function textareaEl(value, attrs) { var t = h('textarea.epm-input', Object.assign({ rows: 3 }, attrs || {})); t.value = value || ''; return t; }
function selectEl(options, value, attrs) {
  var s = h('select.epm-input', attrs || {});
  options.forEach(function (o) { var v = typeof o === 'object' ? o.value : o, l = typeof o === 'object' ? o.label : o; s.appendChild(h('option', { value: v, selected: String(v) === String(value == null ? '' : value) }, l)); });
  return s;
}
function checksEl(options, values) {
  var wrap = h('.epm-checks');
  options.forEach(function (o) {
    wrap.appendChild(h('label.epm-check', h('input', { type: 'checkbox', value: o, checked: (values || []).indexOf(o) >= 0 }), h('span', o)));
  });
  wrap.getValues = function () { return Array.prototype.slice.call(wrap.querySelectorAll('input:checked')).map(function (i) { return i.value; }); };
  return wrap;
}
function scaleEl(max, value, name) {
  var wrap = h('.epm-scale', { role: 'radiogroup', 'aria-label': name });
  for (var i = 1; i <= max; i++) (function (v) {
    var b = h('button.epm-scale-b', { type: 'button', role: 'radio', 'aria-checked': String(value === v), class: value === v ? 'on' : '' }, String(v));
    b.addEventListener('click', function () { wrap.value = wrap.value === v ? null : v; Array.prototype.forEach.call(wrap.children, function (c, k) { c.classList.toggle('on', k + 1 === wrap.value); c.setAttribute('aria-checked', String(k + 1 === wrap.value)); }); });
    wrap.appendChild(b);
  })(i);
  wrap.value = value || null;
  return wrap;
}
function badge(text, kind) { return h('span.epm-badge', { class: kind ? 'epm-badge-' + kind : '' }, text); }
var STATUS_KIND = { 'Enrolled Active': 'good', 'Enrolled Inactive': 'muted', 'Asynchronous': 'info', 'Dropped Out': 'bad', 'Moved to next cohort': 'violet', 'Graduated': 'dark' };
function statusBadge(s) { return badge(s || '—', STATUS_KIND[s] || 'muted'); }
function empty(text, action) { return h('.epm-empty', h('p', text), action || null); }

/* ---------------- router ---------------- */
function route() {
  var p = (location.hash || '').replace(/^#\/?/, '').split('/');
  return { name: p[0] || 'cohorts', id: p[1] || '', tab: p[2] || '', sub: p[3] || '' };
}
function go(path) { if (location.hash !== '#/' + path) location.hash = '#/' + path; else render(); }
