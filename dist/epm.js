/*! Adizes · Exec Program Manager v1.0.0 · github.com/Adizes/exec-program-manager */
(function(){
'use strict';
/* ---- core.js ---- */
/* ===================================================================================
 * CORE — config, API client, state, DOM helpers, router, UI primitives
 * =================================================================================== */
var CFG = window.EPM_CONFIG || {};
var VERSION = "1.0.0";
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

/* ---- charts.js ---- */
/* ===================================================================================
 * CHARTS — small dependency-free SVG charts (line + bar) with hover tooltips,
 * legend for ≥2 series and a "table" view. Categorical colors in fixed order.
 * =================================================================================== */
var SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
var SVGNS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs, parent) {
  var e = document.createElementNS(SVGNS, tag);
  Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
  if (parent) parent.appendChild(e);
  return e;
}
function niceTicks(min, max, n) {
  var span = max - min || 1, step = Math.pow(10, Math.floor(Math.log10(span / n))), err = span / n / step;
  step *= err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  var out = []; for (var v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

// opts: { x: [labels], series: [{name, values:[n|null], color?}], yMin, yMax, yFmt(v), title, height, xShort(label) }
function lineChart(opts) {
  var wrap = h('.epm-chart');
  var tableMode = false;
  var head = h('.epm-chart-head', opts.title ? h('h4', opts.title) : h('span'),
    h('button.epm-link', { type: 'button', onclick: function () { tableMode = !tableMode; this.textContent = tableMode ? 'Chart' : 'Table'; draw(); } }, 'Table'));
  var body = h('.epm-chart-body');
  var tip = h('.epm-tip', { role: 'tooltip' });
  var legend = opts.series.length > 1 ? h('.epm-legend', opts.series.map(function (s, i) {
    return h('span.epm-legend-i', h('i', { style: { background: s.color || SERIES[i % SERIES.length] } }), s.name);
  })) : null;
  append(wrap, [head, legend, body]);
  var fmt = opts.yFmt || function (v) { return v; };

  function draw() {
    clear(body);
    if (tableMode) { body.appendChild(dataTable()); return; }
    var W = Math.max(280, wrap.clientWidth || 640), H = opts.height || 240;
    var m = { l: 44, r: 12, t: 12, b: 46 };
    var vals = []; opts.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null) vals.push(v); }); });
    if (!vals.length) { body.appendChild(empty('No data yet.')); return; }
    var yMin = opts.yMin != null ? opts.yMin : Math.min.apply(null, vals), yMax = opts.yMax != null ? opts.yMax : Math.max.apply(null, vals);
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    var n = opts.x.length, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var X = function (i) { return m.l + (n === 1 ? iw / 2 : i * iw / (n - 1)); };
    var Y = function (v) { return m.t + ih - (v - yMin) / (yMax - yMin) * ih; };
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': opts.title || 'chart', class: 'epm-svg' });
    niceTicks(yMin, yMax, 4).forEach(function (t) {
      sv('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: 'epm-grid' }, svg);
      var tx = sv('text', { x: m.l - 6, y: Y(t) + 4, 'text-anchor': 'end', class: 'epm-axis' }, svg); tx.textContent = fmt(t);
    });
    var every = Math.ceil(n / Math.max(2, Math.floor(iw / 70)));
    opts.x.forEach(function (lab, i) {
      if (i % every && i !== n - 1) return;
      var tx = sv('text', { x: X(i), y: H - m.b + 16, 'text-anchor': 'middle', class: 'epm-axis' }, svg);
      tx.textContent = opts.xShort ? opts.xShort(lab, i) : String(lab).slice(0, 10);
    });
    opts.series.forEach(function (s, si) {
      var col = s.color || SERIES[si % SERIES.length], d = '', pen = false;
      s.values.forEach(function (v, i) { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; });
      sv('path', { d: d, fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      s.values.forEach(function (v, i) {
        var isolated = v != null && (s.values[i - 1] == null) && (s.values[i + 1] == null);
        if (v != null && (n <= 24 || isolated)) sv('circle', { cx: X(i), cy: Y(v), r: 4, fill: col, stroke: '#fff', 'stroke-width': 2 }, svg);
      });
    });
    var cross = sv('line', { y1: m.t, y2: m.t + ih, class: 'epm-cross', visibility: 'hidden' }, svg);
    var hit = sv('rect', { x: m.l - 10, y: 0, width: iw + 20, height: H, fill: 'transparent' }, svg);
    hit.addEventListener('pointermove', function (e) {
      var r = svg.getBoundingClientRect(); var px = (e.clientX - r.left) * W / r.width;
      var i = n === 1 ? 0 : Math.round((px - m.l) / (iw / (n - 1))); i = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
      clear(tip);
      tip.appendChild(h('.epm-tip-t', String(opts.x[i])));
      opts.series.forEach(function (s, si) {
        var v = s.values[i]; if (v == null && opts.series.length > 1) return;
        tip.appendChild(h('.epm-tip-r', h('i', { style: { background: s.color || SERIES[si % SERIES.length] } }), h('b', v == null ? '—' : fmt(v)), opts.series.length > 1 ? h('span', s.name) : null));
      });
      tip.style.display = 'block';
      var left = X(i) * r.width / W; tip.style.left = Math.min(r.width - 180, Math.max(0, left + 12)) + 'px'; tip.style.top = '10px';
    });
    hit.addEventListener('pointerleave', function () { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); });
    body.appendChild(svg); body.appendChild(tip);
  }
  function dataTable() {
    return h('.epm-table-wrap', h('table.epm-table.epm-table-sm', h('thead', h('tr', h('th', ''), opts.series.map(function (s) { return h('th', s.name); }))),
      h('tbody', opts.x.map(function (x, i) { return h('tr', h('td', String(x)), opts.series.map(function (s) { return h('td.num', s.values[i] == null ? '—' : fmt(s.values[i])); })); }))));
  }
  setTimeout(draw, 0);
  if (window.ResizeObserver) { var last = 0; new ResizeObserver(function () { var w = wrap.clientWidth; if (Math.abs(w - last) > 20) { last = w; draw(); } }).observe(wrap); }
  return wrap;
}

// Horizontal bars: opts { rows: [{label, value, sub}], max, fmt, title }
function barList(opts) {
  var fmt = opts.fmt || function (v) { return v; };
  var max = opts.max || Math.max.apply(null, opts.rows.map(function (r) { return r.value || 0; }).concat([1]));
  return h('.epm-chart', opts.title ? h('.epm-chart-head', h('h4', opts.title)) : null,
    opts.rows.length ? h('.epm-bars', opts.rows.map(function (r) {
      var w = r.value == null ? 0 : Math.max(0, Math.min(1, r.value / max)) * 100;
      return h('.epm-bar-row', { title: r.label + ': ' + (r.value == null ? '—' : fmt(r.value)) + (r.sub ? ' · ' + r.sub : '') },
        h('.epm-bar-label', r.label),
        h('.epm-bar-track', h('.epm-bar-fill', { style: { width: w + '%', background: r.color || SERIES[0] } })),
        h('.epm-bar-val', r.value == null ? '—' : fmt(r.value), r.sub ? h('small', ' ' + r.sub) : null));
    })) : empty('No data yet.'));
}

/* ---- zoom.js ---- */
/* ===================================================================================
 * ZOOM — parse the "Participants" CSV exported from Zoom (Reports → Usage →
 * Participants, with or without "Export with meeting data") and match people.
 * =================================================================================== */
function parseCsv(text) {
  var rows = [], row = [], cur = '', q = false;
  text = String(text || '').replace(/^﻿/, '');
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.map(function (r) { return r.map(function (x) { return x.trim(); }); });
}

// "11/03/2026 09:58:12 AM", "2026-11-03 09:58:12", "Nov 3, 2026 09:58 AM"
function parseZoomDate(s) {
  s = String(s || '').trim(); if (!s) return null;
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (m) {
    var hh = +m[4]; if (m[7]) { if (/pm/i.test(m[7]) && hh < 12) hh += 12; if (/am/i.test(m[7]) && hh === 12) hh = 0; }
    return new Date(+m[3], +m[1] - 1, +m[2], hh, +m[5], +(m[6] || 0));
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  var d = new Date(s); return isNaN(d) ? null : d;
}
function localIso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

// Returns { date, meetingMinutes, topic, people: [{key, name, email, minutes}] }
function parseZoomParticipants(text) {
  var rows = parseCsv(text).filter(function (r) { return r.some(function (x) { return x !== ''; }); });
  var hi = -1;
  for (var i = 0; i < rows.length; i++) {
    var low = rows[i].map(function (x) { return x.toLowerCase(); });
    var isMeetingRow = low.some(function (x) { return /meeting id|^topic$/.test(x); });
    if (!isMeetingRow && low.some(function (x) { return /^(name|user name|participant name|participant$)/.test(x); }) && low.some(function (x) { return /duration/.test(x); })) { hi = i; break; }
  }
  if (hi < 0) throw new Error('This does not look like a Zoom participants CSV (no Name / Duration columns).');
  var H = rows[hi].map(function (x) { return x.toLowerCase(); });
  var col = function (re) { for (var k = 0; k < H.length; k++) if (re.test(H[k])) return k; return -1; };
  var cName = col(/^(name|user name|participant name|participant$)/), cEmail = col(/email/), cDur = col(/duration/), cJoin = col(/join/), cLeave = col(/leave/);
  var meta = { date: '', meetingMinutes: null, topic: '' };
  if (hi >= 2) {
    var MH = rows[hi - 2].map(function (x) { return x.toLowerCase(); }), MV = rows[hi - 1];
    var mc = function (re) { for (var k = 0; k < MH.length; k++) if (re.test(MH[k])) return k; return -1; };
    var st = parseZoomDate(MV[mc(/start time/)]);
    if (st) meta.date = localIso(st);
    var md = Number(MV[mc(/duration/)]); if (md > 0) meta.meetingMinutes = md;
    meta.topic = MV[mc(/topic/)] || '';
  }
  var people = {}, minJoin = null, maxLeave = null;
  rows.slice(hi + 1).forEach(function (r) {
    var name = (r[cName] || '').replace(/\s*\(.*\)\s*$/, '').trim(); // "Name (Original Name)"
    var email = cEmail >= 0 ? String(r[cEmail] || '').trim().toLowerCase() : '';
    if (!name && !email) return;
    var mins = Number(r[cDur]) || 0;
    var j = cJoin >= 0 ? parseZoomDate(r[cJoin]) : null, l = cLeave >= 0 ? parseZoomDate(r[cLeave]) : null;
    if (j && (!minJoin || j < minJoin)) minJoin = j;
    if (l && (!maxLeave || l > maxLeave)) maxLeave = l;
    var key = email || 'name:' + normName(name);
    var p = people[key] || (people[key] = { key: key, name: name, email: email, minutes: 0 });
    p.minutes += mins;
  });
  if (!meta.date && minJoin) meta.date = localIso(minJoin);
  if (!meta.meetingMinutes && minJoin && maxLeave) meta.meetingMinutes = Math.round((maxLeave - minJoin) / 60000);
  meta.people = Object.keys(people).map(function (k) { return people[k]; });
  return meta;
}

function nameScore(a, b) {
  a = normName(a); b = normName(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  var ta = a.split(' '), tb = b.split(' ');
  if (ta[0] === tb[0] && (ta[ta.length - 1] === tb[tb.length - 1] || tb.indexOf(ta[ta.length - 1]) >= 0 || ta.indexOf(tb[tb.length - 1]) >= 0)) return 0.95;
  // Dice coefficient on bigrams
  var bg = function (s) { var o = {}; for (var i = 0; i < s.length - 1; i++) { var g = s.slice(i, i + 2); o[g] = (o[g] || 0) + 1; } return o; };
  var A = bg(a), B = bg(b), inter = 0, na = 0, nb = 0;
  Object.keys(A).forEach(function (g) { na += A[g]; if (B[g]) inter += Math.min(A[g], B[g]); });
  Object.keys(B).forEach(function (g) { nb += B[g]; });
  return 2 * inter / (na + nb || 1);
}

// people from the CSV → learners. aliases: [{alias, email}]
function matchZoomPeople(people, learners, aliases) {
  var byEmail = {}; learners.forEach(function (l) { byEmail[l.email] = l; });
  var byAlias = {}; (aliases || []).forEach(function (a) { byAlias[a.alias] = a.email; });
  return people.map(function (p) {
    var m = null, how = '';
    if (p.email && byEmail[p.email]) { m = p.email; how = 'email'; }
    else if (byAlias[normName(p.name)] && byEmail[byAlias[normName(p.name)]]) { m = byAlias[normName(p.name)]; how = 'alias'; }
    else {
      var best = null, bs = 0;
      learners.forEach(function (l) { var s = nameScore(p.name, fullName(l)); if (s > bs) { bs = s; best = l; } });
      if (best && bs >= 0.8) { m = best.email; how = bs >= 0.95 ? 'name' : 'similar name'; }
    }
    return Object.assign({}, p, { match: m, how: how });
  });
}

/* ---- model.js ---- */
/* ===================================================================================
 * MODEL — derived numbers for a cohort bundle (same rules as the old Matrix sheets)
 * =================================================================================== */
var INACTIVE = ['Dropped Out', 'Moved to next cohort'];

function computeCohort(C) {
  var t = today();
  var M = { C: C };
  M.learner = {}; C.learners.forEach(function (l) { M.learner[l.email] = l; });
  M.block = {}; C.blocks.forEach(function (b) { M.block[b.id] = b; });
  M.session = {}; C.sessions.forEach(function (s) { M.session[s.id] = s; });
  M.enrollments = C.enrollments.slice().sort(function (a, b) {
    var ia = INACTIVE.indexOf(a.status) >= 0 ? 1 : 0, ib = INACTIVE.indexOf(b.status) >= 0 ? 1 : 0;
    return ia - ib || fullName(M.learner[a.email]).localeCompare(fullName(M.learner[b.email]));
  });
  M.counted = M.enrollments.filter(function (e) { return INACTIVE.indexOf(e.status) < 0; });
  M.isCounted = {}; M.counted.forEach(function (e) { M.isCounted[e.email] = 1; });
  M.att = {}; // email -> sessionId -> status
  C.attendance.forEach(function (a) { (M.att[a.e] = M.att[a.e] || {})[a.s] = a.v; });
  M.lmsBlocks = C.blocks.filter(function (b) { return b.teachableCourseId; });
  M.lms = {}; // email -> blockId -> rec
  C.lms.forEach(function (p) { (M.lms[p.e] = M.lms[p.e] || {})[p.b] = p; });
  M.blockSessions = {}; C.sessions.forEach(function (s) { (M.blockSessions[s.blockId] = M.blockSessions[s.blockId] || []).push(s); });
  M.doneSessions = C.sessions.filter(function (s) { return s.date && s.date <= t; });
  M.nextSession = C.sessions.filter(function (s) { return s.date && s.date >= t; }).sort(function (a, b) { return a.date.localeCompare(b.date); })[0] || null;
  // Expected LMS progress: courses whose block already finished
  var finished = M.lmsBlocks.filter(function (b) { var ss = M.blockSessions[b.id] || []; var last = ss.map(function (s) { return s.date; }).filter(Boolean).sort().pop(); return last && last < t; });
  M.expectedLms = M.lmsBlocks.length ? finished.length / M.lmsBlocks.length : null;
  var st = (S.boot && S.boot.settings) || {};
  var riskAtt = Number(st.riskAttendancePct || 60) / 100, riskGap = Number(st.riskLmsGapPct || 25) / 100;

  M.stats = {};
  M.enrollments.forEach(function (e) {
    var a = M.att[e.email] || {}, p = 0, tot = 0, byBlock = {};
    Object.keys(a).forEach(function (sid) {
      var s = M.session[sid]; if (!s) return;
      var bb = byBlock[s.blockId] || (byBlock[s.blockId] = { p: 0, t: 0 });
      if (a[sid] === 'Present') { p++; tot++; bb.p++; bb.t++; } else if (a[sid] === 'Absent') { tot++; bb.t++; }
    });
    var lm = M.lms[e.email] || {};
    var lmsVals = M.lmsBlocks.map(function (b) { return lm[b.id] ? (lm[b.id].p || 0) / 100 : 0; });
    var weekly = (C.weeklyFeedback || []).filter(function (w) { return w.email === e.email; }).map(overall5);
    var mod = (C.moduleFeedback || []).filter(function (w) { return w.email === e.email; }).map(overall5);
    var s = {
      present: p, total: tot, att: tot ? p / tot : null, attByBlock: byBlock,
      lms: M.lmsBlocks.length && Object.keys(lm).length ? avg(lmsVals) : null,
      exp: avg(weekly), mod: avg(mod), weeklyCount: weekly.length, moduleCount: mod.length,
      convs: (C.conversations || []).filter(function (c) { return c.email === e.email; }).length,
    };
    s.risk = [];
    if (INACTIVE.indexOf(e.status) < 0) {
      if (s.att != null && tot >= 2 && s.att < riskAtt) s.risk.push('Attendance ' + pct(s.att));
      if (M.expectedLms != null && s.lms != null && M.expectedLms - s.lms > riskGap) s.risk.push('LMS ' + pct(s.lms) + ' vs ' + pct(M.expectedLms) + ' expected');
    }
    M.stats[e.email] = s;
  });
  // per session: % present among counted learners with a mark
  M.sessionRate = {};
  C.sessions.forEach(function (s) {
    var p = 0, tot = 0;
    M.counted.forEach(function (e) { var v = (M.att[e.email] || {})[s.id]; if (v === 'Present') { p++; tot++; } else if (v === 'Absent') tot++; });
    M.sessionRate[s.id] = tot ? { rate: p / tot, p: p, t: tot } : null;
  });
  M.kpi = {
    learners: M.counted.length,
    attendance: avg(M.counted.map(function (e) { return M.stats[e.email].att; })),
    lms: avg(M.counted.map(function (e) { return M.stats[e.email].lms; })),
    weekly: avg((C.weeklyFeedback || []).map(overall5)),
    module: avg((C.moduleFeedback || []).map(overall5)),
    pending: (C.conversations || []).filter(function (c) { return c.status === 'Pending'; }).length,
    risk: M.counted.filter(function (e) { return M.stats[e.email].risk.length; }).length,
  };
  return M;
}

function smeLabel(x) {
  if (!x) return '';
  if (x.smeEmail) { var u = (S.boot.smes || []).find(function (s) { return s.email === x.smeEmail; }); return u ? u.name : x.smeEmail; }
  return x.smeName || '';
}
function smeOptions(includeNone) {
  var o = includeNone ? [{ value: '', label: includeNone }] : [];
  return o.concat((S.boot.smes || []).map(function (s) { return { value: s.email || s.key, label: s.name + (s.email ? '' : ' (no account yet)') }; }));
}
function smeValue(x) { return x.smeEmail || (x.smeName ? 'name:' + String(x.smeName).trim().toLowerCase() : ''); }
function applySme(x, value) {
  if (!value) { x.smeEmail = ''; x.smeName = ''; return; }
  var s = (S.boot.smes || []).find(function (k) { return (k.email || k.key) === value; });
  if (value.indexOf('name:') === 0) { x.smeEmail = ''; x.smeName = s ? s.name : value.slice(5); }
  else { x.smeEmail = value; x.smeName = s ? s.name : ''; }
}
function blockLabel(b) { return b ? ((b.number && b.kind === 'course' ? b.number + '. ' : '') + b.title) : '—'; }
function sessionLabel(s, M) { var b = M.block[s.blockId]; return fmtDate(s.date, true) + ' · ' + (s.moduleNo ? s.moduleNo + ' ' : '') + (s.moduleTitle || (b ? b.title : '')); }

// Dates for N sessions: weekdays (0=Sun..6=Sat) starting at `start`, skipping weeks that contain a date in `skip`
function generateDates(start, weekdays, skip, count) {
  var out = []; if (!start || !weekdays.length || !count) return out;
  var weekKey = function (s) { var d = pd(s); var dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return iso(d); };
  var skipWeeks = {}; (skip || []).forEach(function (s) { if (/^\d{4}-\d{2}-\d{2}$/.test(s)) skipWeeks[weekKey(s)] = 1; });
  var d = start, guard = 0;
  while (out.length < count && guard++ < 4000) {
    if (weekdays.indexOf(pd(d).getUTCDay()) >= 0 && !skipWeeks[weekKey(d)]) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

/* ---- cohort.js ---- */
/* ===================================================================================
 * COHORT VIEW — tabs: Overview · Learners · Calendar · Attendance · LMS · Feedback ·
 * Conversations · Settings (details + structure editor)
 * =================================================================================== */
var TABS_PM = [['overview', 'Overview'], ['learners', 'Learners'], ['calendar', 'Calendar'], ['attendance', 'Attendance'], ['lms', 'LMS'], ['feedback', 'Feedback'], ['conversations', 'Conversations'], ['settings', 'Settings']];
var TABS_SME = [['overview', 'Overview'], ['learners', 'Learners'], ['calendar', 'Calendar'], ['attendance', 'Attendance'], ['lms', 'LMS'], ['feedback', 'Feedback']];
function isPM() { return S.user && S.user.role === 'PM'; }

function loadCohort(id, force) {
  if (!force && S.cohorts[id]) return Promise.resolve(S.cohorts[id]);
  return api('cohort.get', { id: id }).then(function (C) { S.cohorts[id] = C; return C; });
}

function viewCohort(main, r) {
  var id = r.id, tab = r.tab || 'overview';
  var tabs = isPM() ? TABS_PM : TABS_SME;
  if (!tabs.some(function (t) { return t[0] === tab; })) tab = 'overview';
  main.appendChild(h('.epm-loading', 'Loading cohort…'));
  loadCohort(id).then(function (C) {
    clear(main);
    var M = computeCohort(C);
    var c = C.cohort;
    main.appendChild(h('.epm-page-head',
      h('div', h('a.epm-crumb', { href: '#/cohorts' }, icon('back', 14), 'Cohorts'),
        h('h1', c.name, ' ', badge(c.language === 'es' ? 'ES' : 'EN', 'muted'), ' ', badge(c.status, c.status === 'Active' ? 'good' : 'muted')),
        h('p.epm-sub', [c.code, M.C.sessions.length ? fmtDate(M.C.sessions.map(function (s) { return s.date; }).filter(Boolean).sort()[0]) + ' – ' + fmtDate(M.C.sessions.map(function (s) { return s.date; }).filter(Boolean).sort().pop()) : '', M.counted.length + ' learners'].filter(Boolean).join(' · '))),
      h('.epm-actions', btn('Refresh', { icon: 'sync', kind: 'ghost' }, function () { delete S.cohorts[id]; render(); }))));
    main.appendChild(h('nav.epm-tabs', { role: 'tablist' }, tabs.map(function (t) {
      return h('a.epm-tab', { href: '#/c/' + id + '/' + t[0], class: t[0] === tab ? 'on' : '', role: 'tab', 'aria-selected': String(t[0] === tab) }, t[1]);
    })));
    var body = h('.epm-tabbody');
    main.appendChild(body);
    var reload = function () { delete S.cohorts[id]; return loadCohort(id, true).then(function () { render(); }); };
    var ctx = { C: C, M: M, id: id, reload: reload, sub: r.sub };
    ({ overview: tabOverview, learners: tabLearners, calendar: tabCalendar, attendance: tabAttendance, lms: tabLms, feedback: tabFeedback,
      conversations: tabConversations, settings: tabSettings })[tab](body, ctx);
  }).catch(function (e) { clear(main); main.appendChild(empty(e.message, btn('Back to cohorts', {}, function () { go('cohorts'); }))); });
}

/* ------------------------------- OVERVIEW ------------------------------- */
function kpi(label, value, sub, toneKey) {
  return h('.epm-kpi', { class: toneKey ? 'epm-kpi-' + toneKey : '' }, h('.epm-kpi-v', value), h('.epm-kpi-l', label), sub ? h('.epm-kpi-s', sub) : null);
}
function tabOverview(el, ctx) {
  var M = ctx.M, C = ctx.C, K = M.kpi;
  el.appendChild(h('.epm-kpis',
    kpi('Learners counted', String(K.learners), C.enrollments.length !== K.learners ? (C.enrollments.length - K.learners) + ' dropped / moved' : null),
    kpi('Attendance', pct(K.attendance), M.doneSessions.length + ' of ' + C.sessions.length + ' sessions held', tone(K.attendance)),
    kpi('LMS progress', pct(K.lms), M.expectedLms != null ? 'Expected by now: ' + pct(M.expectedLms) : 'No Teachable courses yet', tone(K.lms)),
    kpi('Session rating', K.weekly == null ? '—' : num(K.weekly) + ' / 5', (C.weeklyFeedback || []).length + ' responses'),
    kpi('Module rating', K.module == null ? '—' : num(K.module) + ' / 10', (C.moduleFeedback || []).length + ' responses'),
    isPM() ? kpi('Pending conversations', String(K.pending), null, K.pending ? 'mid' : null) : null));

  var grid = h('.epm-grid2');
  el.appendChild(grid);
  // next session card
  var ns = M.nextSession;
  grid.appendChild(h('.epm-card',
    h('h3', 'Next session'),
    ns ? [h('.epm-next-date', fmtDate(ns.date, true)), h('p', (ns.moduleNo ? ns.moduleNo + ' · ' : '') + (ns.moduleTitle || '')), h('p.epm-muted', blockLabel(M.block[ns.blockId]) + (smeLabel(ns) || smeLabel(M.block[ns.blockId]) ? ' · ' + (smeLabel(ns) || smeLabel(M.block[ns.blockId])) : '')),
      C.cohort.zoomLink ? h('p', h('a.epm-link', { href: C.cohort.zoomLink, target: '_blank', rel: 'noopener' }, icon('ext', 14), ' Zoom link')) : null]
      : h('p.epm-muted', 'No upcoming sessions.')));
  // at risk
  var risky = M.counted.filter(function (e) { return M.stats[e.email].risk.length; });
  grid.appendChild(h('.epm-card',
    h('h3', 'Learners needing attention ', badge(String(risky.length), risky.length ? 'bad' : 'good')),
    risky.length ? h('ul.epm-risk', risky.map(function (e) {
      return h('li', h('a', { href: '#/c/' + ctx.id + '/learners/' + encodeURIComponent(e.email) }, fullName(M.learner[e.email])), h('span.epm-muted', M.stats[e.email].risk.join(' · ')));
    })) : h('p.epm-muted', 'Nobody below the thresholds (attendance < ' + ((S.boot.settings || {}).riskAttendancePct || 60) + '% or LMS more than ' + ((S.boot.settings || {}).riskLmsGapPct || 25) + ' points behind).')));

  // attendance per session
  var held = M.doneSessions.filter(function (s) { return M.sessionRate[s.id]; });
  el.appendChild(h('.epm-card', lineChart({
    title: 'Attendance per session', x: held.map(function (s) { return fmtDate(s.date) + ' · ' + (s.moduleNo || M.block[s.blockId].title); }),
    xShort: function (lab) { return lab.split(' · ')[0]; },
    series: [{ name: 'Attendance', values: held.map(function (s) { return M.sessionRate[s.id].rate * 100; }) }], yMin: 0, yMax: 100, yFmt: function (v) { return Math.round(v) + '%'; },
  })));
  // ratings by block
  var rows = C.blocks.map(function (b) {
    var w = (C.weeklyFeedback || []).filter(function (x) { return x.blockId === b.id; }).map(overall5).filter(function (v) { return v != null; });
    return { label: blockLabel(b), value: avg(w), sub: w.length ? '(' + w.length + ')' : '' };
  }).filter(function (r) { return r.value != null; });
  el.appendChild(h('.epm-card', barList({ title: 'Session rating by block (1–5)', rows: rows, max: 5, fmt: function (v) { return num(v); } })));
}

/* ------------------------------- LEARNERS ------------------------------- */
function tabLearners(el, ctx) {
  var M = ctx.M, C = ctx.C, pm = isPM();
  var filter = 'counted';
  var bar = h('.epm-toolbar',
    selectEl([{ value: 'counted', label: 'Active in this cohort' }, { value: 'all', label: 'Everyone (incl. dropped / moved)' }], filter, { onchange: function () { filter = this.value; draw(); }, 'aria-label': 'Filter' }),
    h('.epm-spacer'),
    pm ? btn('Send email', { icon: 'mail', kind: 'ghost' }, function () { emailComposer(ctx, []); }) : null,
    pm ? btn('Add learners', { icon: 'plus', kind: 'primary' }, function () { addLearnersModal(ctx); }) : null);
  var wrap = h('div');
  append(el, [bar, wrap]);
  function draw() {
    clear(wrap);
    var list = filter === 'all' ? M.enrollments : M.counted;
    if (!list.length) { wrap.appendChild(empty('No learners yet.', pm ? btn('Add learners', { icon: 'plus', kind: 'primary' }, function () { addLearnersModal(ctx); }) : null)); return; }
    var heads = ['Learner', 'Status', 'Attendance', 'LMS', 'Session ★', 'Module ★'].concat(pm ? ['Conv.', 'Profile', 'Kit', 'Books', 'Cert.'] : []).concat(['P', 'A', 'E', 'I', 'Lifecycle']);
    wrap.appendChild(h('.epm-table-wrap', h('table.epm-table.epm-table-click', h('thead', h('tr', heads.map(function (x, i) { return h('th', { class: i > 1 ? 'num' : '' }, x); }))),
      h('tbody', list.map(function (e) {
        var l = M.learner[e.email] || { email: e.email }, s = M.stats[e.email];
        return h('tr', { tabindex: '0', onclick: function () { learnerDrawer(ctx, e.email); }, onkeydown: function (ev) { if (ev.key === 'Enter') learnerDrawer(ctx, e.email); } },
          h('td', h('b', fullName(l)), h('div.epm-muted.epm-small', [l.company, pm ? l.email : ''].filter(Boolean).join(' · '))),
          h('td', statusBadge(e.status)),
          h('td.num', pctCell(s.att)), h('td.num', pctCell(s.lms)),
          h('td.num', s.exp == null ? '—' : num(s.exp)), h('td.num', s.mod == null ? '—' : num(s.mod)),
          pm ? [h('td.num', String(s.convs)), h('td.num', l.profileSubmittedAt ? badge('Done', 'good') : badge('—', 'muted')), h('td.num', l.welcomeKit || '—'), h('td.num', l.booksCode || '—'), h('td.num', e.certificationSent || '—')] : null,
          ['P', 'A', 'E', 'I'].map(function (k) { return h('td.num', l[k] == null ? '—' : String(l[k])); }),
          h('td.num', l.lifecycle || '—'));
      })))));
  }
  draw();
  if (ctx.sub) setTimeout(function () { learnerDrawer(ctx, decodeURIComponent(ctx.sub)); }, 50);
}

function addLearnersModal(ctx) {
  var rows = h('.epm-rows');
  var addRow = function (v) {
    v = v || {};
    var r = h('.epm-row3', inputEl(v.email, { placeholder: 'email@company.com', type: 'email', 'aria-label': 'Email' }), inputEl(v.firstName, { placeholder: 'First name', 'aria-label': 'First name' }), inputEl(v.lastName, { placeholder: 'Last name', 'aria-label': 'Last name' }),
      btn('', { icon: 'close', kind: 'ghost', aria: 'Remove row' }, function () { r.remove(); }));
    rows.appendChild(r);
  };
  addRow();
  var paste = textareaEl('', { rows: 3, placeholder: 'Or paste rows from a spreadsheet: email, first name, last name (one person per line)' });
  paste.addEventListener('change', function () {
    paste.value.split(/\n/).map(function (l) { return l.split(/\t|,|;/).map(function (x) { return x.trim(); }); }).filter(function (p) { return p[0] && p[0].indexOf('@') > 0; })
      .forEach(function (p) { addRow({ email: p[0], firstName: p[1], lastName: p[2] }); });
    Array.prototype.slice.call(rows.children).forEach(function (r) { if (!r.children[0].value) r.remove(); });
    paste.value = '';
  });
  var send = h('input', { type: 'checkbox', checked: true });
  var m = modal('Add learners to ' + ctx.C.cohort.name, [
    h('p.epm-p', 'Each learner gets a personal link to complete their profile and goals. The email is sent in the cohort language (' + (ctx.C.cohort.language === 'es' ? 'Spanish' : 'English') + ').'),
    rows, btn('Add another', { icon: 'plus', kind: 'ghost' }, function () { addRow(); }), paste,
    h('label.epm-check', send, h('span', 'Send the profile link now'))], {
    wide: true,
    footer: [btn('Cancel', { kind: 'ghost' }, function () { m.close(); }), btn('Add learners', { kind: 'primary' }, function () {
      var people = Array.prototype.slice.call(rows.children).map(function (r) { return { email: r.children[0].value.trim(), firstName: r.children[1].value.trim(), lastName: r.children[2].value.trim() }; }).filter(function (p) { return p.email; });
      if (!people.length) return toast('Add at least one email', 'error');
      api('learner.add', { cohortId: ctx.id, people: people, sendProfileLink: send.checked }).then(function (res) {
        m.close();
        toast(res.added.length + ' added' + (res.skipped.length ? ' · ' + res.skipped.length + ' skipped (' + res.skipped.map(function (s) { return s.email + ': ' + s.reason.replace(/_/g, ' '); }).join(', ') + ')' : ''), res.skipped.length ? 'error' : null);
        ctx.reload();
      }).catch(fail);
    })],
  });
}

/* ------------------------------- CALENDAR ------------------------------- */
function tabCalendar(el, ctx) {
  var M = ctx.M, C = ctx.C, pm = isPM(), t = today();
  if (!C.sessions.length) { el.appendChild(empty('This cohort has no sessions yet.', pm ? btn('Build the structure', { kind: 'primary' }, function () { go('c/' + ctx.id + '/settings'); }) : null)); return; }
  if (pm) el.appendChild(h('.epm-toolbar', h('p.epm-muted', 'Click a session to add the defreeze question and the recording link.'), h('.epm-spacer'), btn('Edit structure & dates', { icon: 'edit', kind: 'ghost' }, function () { go('c/' + ctx.id + '/settings'); })));
  var prev = null;
  C.blocks.forEach(function (b) {
    var ss = M.blockSessions[b.id] || [];
    var card = h('.epm-card.epm-block');
    card.appendChild(h('.epm-block-head', h('div', h('span.epm-block-no', b.kind === 'course' ? b.number : (b.kind === 'case_study' ? b.number : '')), h('b', b.title)),
      h('span.epm-muted', [smeLabel(b), b.teachableCourseId ? 'Teachable ' + b.teachableCourseId : ''].filter(Boolean).join(' · '))));
    var tb = h('tbody');
    ss.forEach(function (s) {
      if (prev && s.date && prev.date && (pd(s.date) - pd(prev.date)) / 864e5 > 10) tb.appendChild(h('tr.epm-break', h('td', { colspan: '5' }, 'Break · ' + Math.round((pd(s.date) - pd(prev.date)) / 864e5 / 7 - 1) + ' week(s) without sessions')));
      if (s.date) prev = s;
      var done = s.date && s.date <= t, rate = M.sessionRate[s.id];
      var recs = String(s.recordingUrl || '').split(/\s+/).filter(function (u) { return /^https?:\/\//.test(u); });
      tb.appendChild(h('tr', { class: (done ? 'epm-done ' : '') + (pm ? 'epm-clickable' : ''), tabindex: pm ? '0' : null, onclick: pm ? function () { sessionModal(ctx, s); } : null, onkeydown: pm ? function (e) { if (e.key === 'Enter') sessionModal(ctx, s); } : null },
        h('td.epm-nowrap', fmtDate(s.date, true)),
        h('td', h('b', s.moduleNo || ''), ' ', s.moduleTitle || '', s.smeEmail || s.smeName ? h('div.epm-small.epm-muted', 'SME: ' + smeLabel(s)) : null),
        h('td.epm-small', s.defreeze ? h('span', { title: 'Defreeze question' }, '❄ ' + s.defreeze) : (done && pm ? h('span.epm-muted', 'No defreeze yet') : '')),
        h('td.epm-nowrap', recs.length ? recs.map(function (u, i) { return h('a.epm-link.epm-rec', { href: u, target: '_blank', rel: 'noopener', onclick: function (e) { e.stopPropagation(); } }, icon('play', 14), recs.length > 1 ? 'Rec ' + (i + 1) : 'Recording'); }) : (done ? h('span.epm-muted.epm-small', 'No recording') : '')),
        h('td.num', rate ? pctCell(rate.rate) : '')));
    });
    card.appendChild(h('.epm-table-wrap', h('table.epm-table.epm-table-sm.epm-cal', h('colgroup', h('col', { style: { width: '120px' } }), h('col', { style: { width: '36%' } }), h('col'), h('col', { style: { width: '170px' } }), h('col', { style: { width: '76px' } })), tb)));
    el.appendChild(card);
  });
}

function sessionModal(ctx, s) {
  var date = inputEl(s.date, { type: 'date' });
  var def = textareaEl(s.defreeze, { rows: 2 });
  var rec = textareaEl(String(s.recordingUrl || '').replace(/\s+/g, '\n'), { rows: 2, placeholder: 'https://drive.google.com/…  (one link per line)' });
  var notes = textareaEl(s.notes, { rows: 2 });
  var m = modal(sessionLabel(s, ctx.M), [
    field('Date', date, 'Changing one date here does not move the others. To reschedule many, use Settings → Structure.'),
    field('Defreeze question', def), field('Recording links (Google Drive)', rec), field('Notes', notes)], {
    footer: [btn('Cancel', { kind: 'ghost' }, function () { m.close(); }), btn('Save', { kind: 'primary' }, function () {
      var links = rec.value.split(/\s+/).filter(Boolean);
      var bad = links.filter(function (u) { return !/^https?:\/\//.test(u); });
      if (bad.length) return toast('Links must start with https://', 'error');
      api('session.update', { id: s.id, patch: { date: date.value, defreeze: def.value, recordingUrl: links.join('\n'), notes: notes.value } }).then(function () { m.close(); toast('Saved'); ctx.reload(); }).catch(fail);
    })],
  });
}

/* ------------------------------- ATTENDANCE ------------------------------- */
function tabAttendance(el, ctx) {
  var M = ctx.M, C = ctx.C, pm = isPM();
  var showAll = false;
  var pending = {}, timer = null;
  var bar = h('.epm-toolbar',
    h('label.epm-check', h('input', { type: 'checkbox', onchange: function () { showAll = this.checked; draw(); } }), h('span', 'Show future sessions')),
    h('.epm-spacer'),
    pm ? h('span.epm-muted.epm-small', 'Click a cell: Present → Absent → empty') : null,
    pm ? btn('Import Zoom CSV', { icon: 'upload', kind: 'primary' }, function () { zoomImportModal(ctx); }) : null);
  var wrap = h('div');
  append(el, [bar, wrap]);
  function flush() {
    var recs = Object.keys(pending).map(function (k) { return pending[k]; });
    pending = {};
    if (!recs.length) return;
    api('attendance.save', { cohortId: ctx.id, records: recs }, { silent: true }).then(function () {
      toast('Attendance saved');
      recs.forEach(function (r) {
        C.attendance = C.attendance.filter(function (a) { return !(a.s === r.sessionId && a.e === r.email); });
        if (r.status) C.attendance.push({ s: r.sessionId, e: r.email, v: r.status });
      });
    }).catch(function (e) { fail(e); ctx.reload(); });
  }
  function draw() {
    clear(wrap);
    var sessions = C.sessions.filter(function (s) { return showAll || (s.date && s.date <= today()); });
    if (!sessions.length) { wrap.appendChild(empty('No sessions held yet. Tick “Show future sessions” to see the plan.')); return; }
    var groups = [];
    sessions.forEach(function (s) { var g = groups[groups.length - 1]; if (!g || g.b !== s.blockId) groups.push({ b: s.blockId, n: 1 }); else g.n++; });
    var thead = h('thead',
      h('tr', h('th.epm-sticky', { rowspan: '2' }, 'Learner'), h('th.num', { rowspan: '2' }, 'Total'), groups.map(function (g) { var b = M.block[g.b]; return h('th.epm-group', { colspan: String(g.n), title: b.title }, b.kind === 'course' ? 'C' + b.number : b.title); })),
      h('tr', sessions.map(function (s) {
        var r = M.sessionRate[s.id];
        return h('th.epm-att-h', { title: sessionLabel(s, M) + (r ? ' · ' + pct(r.rate) + ' present' : '') },
          pm ? h('button.epm-att-hb', { type: 'button', onclick: function (e) { columnMenu(e.currentTarget, s); } }, fmtDate(s.date).replace(/ \d\d$/, ''), h('small', s.moduleNo || '')) : [fmtDate(s.date).replace(/ \d\d$/, ''), h('small', s.moduleNo || '')]);
      })));
    var tbody = h('tbody', M.enrollments.map(function (e) {
      var st = M.stats[e.email], inactive = !M.isCounted[e.email];
      return h('tr', { class: inactive ? 'epm-dim' : '' },
        h('td.epm-sticky', h('span', fullName(M.learner[e.email])), inactive ? h('div.epm-small.epm-muted', e.status) : null),
        h('td.num', pctCell(st.att)),
        sessions.map(function (s) {
          var v = (M.att[e.email] || {})[s.id] || '';
          var cell = h('td.epm-att', { class: v === 'Present' ? 'p' : v === 'Absent' ? 'a' : '' });
          if (pm) {
            var b = h('button', { type: 'button', 'aria-label': fullName(M.learner[e.email]) + ' ' + fmtDate(s.date) + ': ' + (v || 'no mark') }, v ? v[0] : '·');
            b.addEventListener('click', function () {
              var cur = (M.att[e.email] || {})[s.id] || '';
              var next = cur === '' ? 'Present' : cur === 'Present' ? 'Absent' : '';
              (M.att[e.email] = M.att[e.email] || {})[s.id] = next;
              cell.className = 'epm-att ' + (next === 'Present' ? 'p' : next === 'Absent' ? 'a' : '');
              b.textContent = next ? next[0] : '·';
              pending[s.id + '|' + e.email] = { sessionId: s.id, email: e.email, status: next, source: 'manual' };
              clearTimeout(timer); timer = setTimeout(flush, 900);
            });
            cell.appendChild(b);
          } else cell.appendChild(h('span', v ? v[0] : ''));
          return cell;
        }));
    }));
    var foot = h('tfoot', h('tr', h('td.epm-sticky', 'Present'), h('td.num', pctCell(M.kpi.attendance)), sessions.map(function (s) { var r = M.sessionRate[s.id]; return h('td.num.epm-small', r ? Math.round(r.rate * 100) + '%' : ''); })));
    wrap.appendChild(h('.epm-table-wrap.epm-att-wrap', h('table.epm-table.epm-att-table', thead, tbody, foot)));
  }
  function columnMenu(anchor, s) {
    var m = modal(sessionLabel(s, M), h('.epm-stack',
      btn('Mark everyone Present', {}, function () { bulk('Present'); }),
      btn('Mark everyone Absent', {}, function () { bulk('Absent'); }),
      btn('Clear this session', { kind: 'ghost' }, function () { bulk(''); }),
      btn('Import Zoom CSV for this session', { icon: 'upload', kind: 'primary' }, function () { m.close(); zoomImportModal(ctx, s.id); })));
    function bulk(v) {
      var recs = M.counted.map(function (e) { return { sessionId: s.id, email: e.email, status: v, source: 'manual' }; });
      api('attendance.save', { cohortId: ctx.id, records: recs }).then(function () { m.close(); toast('Saved'); ctx.reload(); }).catch(fail);
    }
  }
  draw();
}

function zoomImportModal(ctx, sessionId) {
  var M = ctx.M, C = ctx.C;
  var file = h('input', { type: 'file', accept: '.csv,text/csv' });
  var out = h('div');
  var parsed = null, matches = [], thr = Number((S.boot.settings || {}).presentThresholdPct || 50);
  var sessSel = selectEl([{ value: '', label: 'Choose session…' }].concat(C.sessions.map(function (s) { return { value: s.id, label: sessionLabel(s, M) }; })), sessionId || '');
  var thrIn = inputEl(thr, { type: 'number', min: '0', max: '100', style: { width: '80px' } });
  var durIn = inputEl('', { type: 'number', min: '1', style: { width: '90px' } });
  var learners = M.counted.map(function (e) { return M.learner[e.email]; }).filter(Boolean);
  var assign = {}; // participant key -> email ('' = ignore)
  var override = {}; // email -> status
  file.addEventListener('change', function () {
    var f = file.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try { parsed = parseZoomParticipants(rd.result); } catch (e) { return toast(e.message, 'error'); }
      matches = matchZoomPeople(parsed.people, learners, C.aliases || []);
      if (parsed.meetingMinutes) durIn.value = parsed.meetingMinutes;
      if (!sessSel.value && parsed.date) {
        var exact = C.sessions.find(function (s) { return s.date === parsed.date; });
        if (exact) sessSel.value = exact.id;
      }
      assign = {}; override = {};
      draw();
    };
    rd.readAsText(f);
  });
  [thrIn, durIn].forEach(function (i) { i.addEventListener('input', draw); });
  function result() {
    var minutesBy = {};
    matches.forEach(function (p) {
      var em = p.key in assign ? assign[p.key] : p.match;
      if (em) minutesBy[em] = (minutesBy[em] || 0) + p.minutes;
    });
    var need = (Number(durIn.value) || 0) * (Number(thrIn.value) || 0) / 100;
    return learners.map(function (l) {
      var mins = minutesBy[l.email] || 0;
      var auto = mins > 0 && mins >= need ? 'Present' : 'Absent';
      return { email: l.email, minutes: Math.round(mins), status: override[l.email] || auto, auto: auto };
    });
  }
  function draw() {
    clear(out);
    if (!parsed) { out.appendChild(h('p.epm-muted', 'In Zoom: Reports → Usage → click the number of Participants of the meeting → Export. Then choose that CSV here.')); return; }
    var res = result();
    var unmatched = matches.filter(function (p) { return !(p.key in assign ? assign[p.key] : p.match); });
    out.appendChild(h('p.epm-p', 'Meeting ', h('b', parsed.date ? fmtDate(parsed.date, true) : 'date unknown'), parsed.topic ? ' · ' + parsed.topic : '', ' · ', parsed.people.length + ' participants in the file.'));
    out.appendChild(h('.epm-table-wrap', h('table.epm-table.epm-table-sm', h('thead', h('tr', h('th', 'Learner'), h('th.num', 'Minutes'), h('th', 'Status'))),
      h('tbody', res.map(function (r) {
        var sel = selectEl(['Present', 'Absent'], r.status, { 'aria-label': 'Status', onchange: function () { override[r.email] = this.value; } });
        return h('tr', h('td', fullName(M.learner[r.email])), h('td.num', String(r.minutes)), h('td', sel, r.status !== r.auto ? h('span.epm-small.epm-muted', ' (changed)') : null));
      })))));
    out.appendChild(h('h4', 'Participants not matched (' + unmatched.length + ')'));
    out.appendChild(h('p.epm-muted.epm-small', 'Host, staff and guests usually appear here. If one of them is a learner with a different Zoom name, choose who it is: the platform will remember it next time.'));
    out.appendChild(h('.epm-stack', matches.filter(function (p) { return !p.match || p.key in assign; }).map(function (p) {
      var sel = selectEl([{ value: '', label: '— Not a learner —' }].concat(learners.map(function (l) { return { value: l.email, label: fullName(l) }; })), assign[p.key] || '', {
        'aria-label': 'Who is ' + p.name, onchange: function () { assign[p.key] = this.value; draw(); } });
      return h('.epm-row2', h('span', h('b', p.name || p.email), ' ', h('span.epm-muted.epm-small', (p.email || '') + ' · ' + Math.round(p.minutes) + ' min')), sel);
    })));
  }
  draw();
  var m = modal('Import attendance from Zoom', [
    h('.epm-row2', field('Zoom participants CSV', file), field('Session', sessSel)),
    h('.epm-row2', field('Meeting length (minutes)', durIn), field('Present if attended at least (%)', thrIn)),
    out], {
    wide: true,
    footer: [btn('Cancel', { kind: 'ghost' }, function () { m.close(); }), btn('Save attendance', { kind: 'primary' }, function () {
      if (!parsed) return toast('Choose the CSV first', 'error');
      if (!sessSel.value) return toast('Choose the session', 'error');
      var recs = result().map(function (r) { return { sessionId: sessSel.value, email: r.email, status: r.status, minutes: r.minutes, source: 'zoom' }; });
      var aliases = matches.filter(function (p) { return assign[p.key] && !p.email; }).map(function (p) { return { alias: p.name, email: assign[p.key] }; });
      api('attendance.save', { cohortId: ctx.id, records: recs, aliases: aliases }).then(function (r) { m.close(); toast(r.saved + ' marks saved'); ctx.reload(); }).catch(fail);
    })],
  });
}

/* ------------------------------- LMS ------------------------------- */
function tabLms(el, ctx) {
  var M = ctx.M, C = ctx.C, pm = isPM();
  var last = C.cohort.lastLmsSync;
  el.appendChild(h('.epm-toolbar', h('p.epm-muted', last ? 'Last sync with Teachable: ' + fmtDateTime(last) + ' (runs every night for active cohorts)' : 'Not synced with Teachable yet.'),
    h('.epm-spacer'), pm ? btn('Sync now', { icon: 'sync', kind: 'primary' }, function () {
      toast('Syncing with Teachable… this can take a minute');
      api('lms.sync', { cohortId: ctx.id }).then(function (r) {
        toast('Synced ' + r.matched + ' of ' + r.learners + ' learners' + (r.unmatched.length ? ' · not found in Teachable: ' + r.unmatched.join(', ') : ''), r.unmatched.length ? 'error' : null);
        ctx.reload();
      }).catch(fail);
    }) : null));
  if (!M.lmsBlocks.length) { el.appendChild(empty('No Teachable course IDs in this cohort yet.', pm ? btn('Add them in Settings → Structure', {}, function () { go('c/' + ctx.id + '/settings'); }) : null)); return; }
  el.appendChild(h('.epm-table-wrap', h('table.epm-table.epm-table-click', h('thead', h('tr', h('th.epm-sticky', 'Learner'), h('th.num', 'Overall'), M.lmsBlocks.map(function (b) { return h('th.num', { title: b.title }, b.kind === 'welcome' ? 'W' : b.number); }))),
    h('tbody', M.counted.map(function (e) {
      var lm = M.lms[e.email] || {};
      return h('tr', { tabindex: '0', onclick: function () { lmsDetailModal(ctx, e.email); }, onkeydown: function (ev) { if (ev.key === 'Enter') lmsDetailModal(ctx, e.email); } },
        h('td.epm-sticky', fullName(M.learner[e.email])), h('td.num', pctCell(M.stats[e.email].lms)),
        M.lmsBlocks.map(function (b) { var p = lm[b.id]; return h('td.num', p ? pctCell((p.p || 0) / 100) : h('span.epm-muted', '—')); }));
    })))));
  el.appendChild(h('p.epm-muted.epm-small', 'Overall = average of the course percentages (every course weighs the same). Click a learner to see each lesson.'));
}

function lmsDetailModal(ctx, email) {
  var M = ctx.M;
  var body = h('div', h('.epm-loading', 'Loading lessons…'));
  modal('LMS progress · ' + fullName(M.learner[email]), body, { wide: true });
  api('lms.detail', { cohortId: ctx.id, email: email }).then(function (d) {
    clear(body);
    if (!d.progress.length) { body.appendChild(empty('No lesson-level data yet. Run “Sync now” in the LMS tab.')); return; }
    M.lmsBlocks.forEach(function (b) {
      var p = d.progress.find(function (x) { return x.blockId === b.id; }); if (!p) return;
      var course = d.courses[p.courseId] || { structure: [] };
      var done = {}; (p.completed || []).forEach(function (c) { done[c[0]] = c[1] || true; });
      var det = h('details.epm-details', h('summary', h('b', blockLabel(b)), ' ', pctCell((p.percent || 0) / 100)));
      (course.structure || []).forEach(function (s) {
        det.appendChild(h('.epm-lms-sec', s.name));
        det.appendChild(h('ul.epm-lms', s.lectures.map(function (l) {
          var ok = l.id in done;
          return h('li', { class: ok ? 'ok' : '' }, h('span.epm-lms-mark', ok ? '✓' : '–'), l.name, ok && typeof done[l.id] === 'string' ? h('span.epm-muted.epm-small', ' ' + fmtDate(done[l.id])) : null);
        })));
      });
      body.appendChild(det);
    });
  }).catch(function (e) { clear(body); body.appendChild(empty(e.message)); });
}

/* ------------------------------- FEEDBACK ------------------------------- */
function tabFeedback(el, ctx) {
  var C = ctx.C, pm = isPM();
  var sub = ctx.sub || 'weekly';
  var subs = [['weekly', 'Session feedback'], ['module', 'Module feedback']].concat(pm ? [['goals', 'Goals & intentions']] : []);
  el.appendChild(h('.epm-subtabs', subs.map(function (s) { return h('a', { href: '#/c/' + ctx.id + '/feedback/' + s[0], class: s[0] === sub ? 'on' : '' }, s[1]); })));
  if (!pm && !C.feedbackBlocks.length) { el.appendChild(empty('The Program Manager has not shared feedback for your blocks yet.')); return; }
  ({ weekly: feedbackWeekly, module: feedbackModule, goals: feedbackGoals })[sub](el, ctx);
}

function feedbackWeekly(el, ctx) {
  var M = ctx.M, C = ctx.C, pm = isPM();
  if (pm) el.appendChild(h('.epm-toolbar', h('p.epm-muted', 'Ratings from the end-of-session survey (1–5).'), h('.epm-spacer'), btn('Capture feedback', { icon: 'plus', kind: 'primary' }, function () { weeklyEntryModal(ctx); })));
  var list = (C.weeklyFeedback || []).slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  if (!list.length) { el.appendChild(empty('No session feedback yet.')); return; }
  // by SME
  var bySme = {};
  list.forEach(function (w) { var k = smeLabel(w) || '—'; (bySme[k] = bySme[k] || []).push(overall5(w)); });
  el.appendChild(h('.epm-card', barList({ title: 'Average by SME (1–5)', max: 5, fmt: function (v) { return num(v); }, rows: Object.keys(bySme).map(function (k) { return { label: k, value: avg(bySme[k]), sub: '(' + bySme[k].length + ')' }; }) })));
  // grouped by date
  var groups = {};
  list.forEach(function (w) { var k = w.sessionId || ('d:' + w.date + ':' + w.blockId); (groups[k] = groups[k] || []).push(w); });
  Object.keys(groups).forEach(function (k) {
    var ws = groups[k], s = M.session[ws[0].sessionId], b = M.block[ws[0].blockId];
    var det = h('details.epm-details', h('summary', h('b', fmtDate(ws[0].date, true)), ' · ', s ? (s.moduleNo ? s.moduleNo + ' ' : '') + (s.moduleTitle || '') : blockLabel(b), ' · ', smeLabel(ws[0]) || '', ' ',
      badge(num(avg(ws.map(overall5))) + ' · ' + ws.length + ' resp.', 'muted')));
    det.appendChild(h('.epm-table-wrap', h('table.epm-table.epm-table-sm', h('thead', h('tr', h('th', 'Learner'), ['Content', 'SME', 'Tech', 'Pace', 'Community'].map(function (x) { return h('th.num', x); }), h('th', 'What would you improve?'), h('th', 'Comments'), pm ? h('th', '') : null)),
      h('tbody', ws.map(function (w) {
        return h('tr', h('td', w.email ? fullName(M.learner[w.email]) || w.email : (w.nameRaw || 'Anonymous')), [w.q1, w.q2, w.q3, w.q4, w.q5].map(function (q) { return h('td.num', q == null ? '—' : String(q)); }),
          h('td.epm-small', w.improve || ''), h('td.epm-small', w.comments || ''),
          pm ? h('td', btn('', { icon: 'edit', kind: 'ghost', aria: 'Edit' }, function () { weeklyEntryModal(ctx, w); })) : null);
      })))));
    el.appendChild(det);
  });
}

function weeklyEntryModal(ctx, rec) {
  var M = ctx.M, C = ctx.C;
  rec = rec || {};
  var held = C.sessions.filter(function (s) { return s.date && s.date <= today(); });
  var defaultSession = rec.sessionId || (held[held.length - 1] || {}).id || '';
  var sess = selectEl([{ value: '', label: 'Choose session…' }].concat(C.sessions.map(function (s) { return { value: s.id, label: sessionLabel(s, M) }; })), defaultSession);
  var who = selectEl([{ value: '', label: 'Anonymous / unknown' }].concat(M.counted.map(function (e) { return { value: e.email, label: fullName(M.learner[e.email]) }; })), rec.email || '');
  var labels = ['Program content (pre-work)', 'SMEs (instructors)', 'Technical experience (Teachable, Zoom)', 'Pace and duration', 'Community / interaction with other participants'];
  var scales = labels.map(function (l, i) { return scaleEl(5, rec['q' + (i + 1)], l); });
  var improve = textareaEl(rec.improve, { rows: 2 }), comments = textareaEl(rec.comments, { rows: 2 });
  var m, changed = !!rec._changed, chaining = false;
  function save(next) {
    if (!sess.value) return toast('Choose the session', 'error');
    var r = { id: rec.id, cohortId: ctx.id, sessionId: sess.value, email: who.value, nameRaw: rec.nameRaw || '', improve: improve.value, comments: comments.value };
    scales.forEach(function (s, i) { r['q' + (i + 1)] = s.value; });
    api('weekly.save', { record: r }).then(function (res) {
      toast('Saved');
      C.weeklyFeedback = (C.weeklyFeedback || []).filter(function (x) { return x.id !== res.record.id; }).concat([res.record]);
      changed = true;
      if (next) { chaining = true; m.close(); weeklyEntryModal(ctx, { sessionId: sess.value, _changed: true }); }
      else m.close();
    }).catch(fail);
  }
  m = modal(rec.id ? 'Edit session feedback' : 'Capture session feedback', [
    h('.epm-row2', field('Session', sess), field('Learner', who)),
    labels.map(function (l, i) { return field((i + 1) + '. ' + l, scales[i]); }),
    field('6. What would you improve?', improve), field('7. Additional comments', comments)], {
    wide: true,
    footer: [rec.id ? btn('Delete', { kind: 'danger-ghost', icon: 'trash' }, function () {
      confirmBox('Delete this response?', 'This cannot be undone.', 'Delete', true).then(function (ok) { if (ok) api('weekly.delete', { id: rec.id }).then(function () { changed = true; m.close(); }).catch(fail); });
    }) : null, h('.epm-spacer'), rec.id ? null : btn('Save & add another', { kind: 'ghost' }, function () { save(true); }), btn('Save', { kind: 'primary' }, function () { save(false); })],
    onClose: function () { if (changed && !chaining) ctx.reload(); },
  });
}

function feedbackModule(el, ctx) {
  var M = ctx.M, C = ctx.C, pm = isPM();
  var formId = C.moduleFormId;
  if (pm) el.appendChild(h('.epm-toolbar', h('p.epm-muted', formId ? 'Typeform form: ' + formId + ' · personalized links include email, name, cohort and module.' : 'Add the Typeform form ID in Settings to generate personalized links.'),
    h('.epm-spacer'), btn('Pull Typeform responses', { icon: 'sync', kind: 'ghost' }, function () {
      api('typeform.sync', {}).then(function (r) { toast(r.imported + ' new responses' + (r.unmatched.length ? ' · ' + r.unmatched.length + ' could not be matched' : '')); ctx.reload(); }).catch(fail);
    })));
  var blocks = C.blocks.filter(function (b) { return b.kind === 'course' && (pm || C.feedbackBlocks.indexOf(b.id) >= 0); });
  el.appendChild(h('.epm-table-wrap', h('table.epm-table', h('thead', h('tr', h('th', 'Block'), h('th', 'SME'), h('th.num', 'Responses'), h('th.num', 'Average /10'), pm ? h('th', '') : null)),
    h('tbody', blocks.map(function (b) {
      var rs = (C.moduleFeedback || []).filter(function (x) { return x.blockId === b.id; });
      var answered = {}; rs.forEach(function (x) { if (x.email) answered[x.email] = 1; });
      return h('tr', h('td', blockLabel(b)), h('td', smeLabel(b) || '—'), h('td.num', rs.length + ' / ' + M.counted.length), h('td.num', rs.length ? num(avg(rs.map(overall5))) : '—'),
        pm ? h('td.epm-nowrap', btn('Links', { icon: 'link', kind: 'ghost' }, function () { moduleLinksModal(ctx, b, answered); }),
          btn('', { icon: 'plus', kind: 'ghost', aria: 'Add a response manually', title: 'Add a response manually' }, function () { moduleEntryModal(ctx, { blockId: b.id }); })) : null);
    })))));
  var list = (C.moduleFeedback || []).slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  if (!list.length) return;
  el.appendChild(h('h3.epm-h3', 'Responses'));
  el.appendChild(h('.epm-table-wrap', h('table.epm-table.epm-table-sm', h('thead', h('tr', h('th', 'Date'), h('th', 'Learner'), h('th', 'Block'), ['Overall', 'Pre-work', 'Facilitation', 'Peers', 'Pacing'].map(function (x) { return h('th.num', x); }), h('th', 'Applied in their work'), h('th', 'Suggestion'), pm ? h('th', '') : null)),
    h('tbody', list.map(function (w) {
      return h('tr', h('td.epm-nowrap', fmtDate(w.date)), h('td', w.email ? fullName(M.learner[w.email]) || w.email : (w.nameRaw || 'Anonymous')), h('td.epm-small', blockLabel(M.block[w.blockId])),
        [w.q1, w.q2, w.q3, w.q4, w.q5].map(function (q) { return h('td.num', q == null ? '—' : String(q)); }), h('td.epm-small', w.applied || ''), h('td.epm-small', w.suggest || ''),
        pm ? h('td', btn('', { icon: 'edit', kind: 'ghost', aria: 'Edit' }, function () { moduleEntryModal(ctx, w); })) : null);
    })))));
}

function typeformUrl(ctx, b, l) {
  var fid = ctx.C.moduleFormId; if (!fid) return '';
  return 'https://form.typeform.com/to/' + encodeURIComponent(fid) + '#email=' + encodeURIComponent(l.email) + '&name=' + encodeURIComponent(fullName(l)) + '&cohort=' + encodeURIComponent(ctx.id) + '&module=' + encodeURIComponent(b.id);
}
function moduleLinksModal(ctx, b, answered) {
  var M = ctx.M;
  if (!ctx.C.moduleFormId) return toast(ERRORS.invalid_typeform_form, 'error');
  var pendingEmails = M.counted.filter(function (e) { return !answered[e.email]; }).map(function (e) { return e.email; });
  var m = modal('Survey links · ' + blockLabel(b), [
    h('p.epm-p', 'Each link fills in the learner’s email, name, cohort and module as hidden fields, so the answer lands in the right place automatically.'),
    h('.epm-table-wrap', h('table.epm-table.epm-table-sm', h('tbody', M.counted.map(function (e) {
      var l = M.learner[e.email], u = typeformUrl(ctx, b, l);
      return h('tr', h('td', fullName(l)), h('td', answered[e.email] ? badge('Answered', 'good') : badge('Pending', 'muted')),
        h('td.epm-nowrap', btn('Copy link', { icon: 'copy', kind: 'ghost' }, function () { copyText(u); })));
    }))))], {
    wide: true,
    footer: [btn('Close', { kind: 'ghost' }, function () { m.close(); }), btn('Email the ' + pendingEmails.length + ' pending', { icon: 'mail', kind: 'primary', disabled: !pendingEmails.length }, function () {
      confirmBox('Send the survey?', 'Each pending learner gets their personal link by email (' + (ctx.C.cohort.language === 'es' ? 'Spanish' : 'English') + '). It is logged in Conversations.', 'Send').then(function (ok) {
        if (!ok) return;
        api('email.send', { cohortId: ctx.id, template: 'moduleFeedback', blockId: b.id, emails: pendingEmails }).then(function (r) {
          m.close(); toast(r.sent.length + ' sent' + (r.failed.length ? ' · ' + r.failed.length + ' failed' : ''), r.failed.length ? 'error' : null); ctx.reload();
        }).catch(fail);
      });
    })],
  });
}

function moduleEntryModal(ctx, rec) {
  var M = ctx.M, C = ctx.C;
  var blk = selectEl(C.blocks.filter(function (b) { return b.kind === 'course'; }).map(function (b) { return { value: b.id, label: blockLabel(b) }; }), rec.blockId);
  var who = selectEl([{ value: '', label: 'Anonymous / unknown' }].concat(M.enrollments.map(function (e) { return { value: e.email, label: fullName(M.learner[e.email]) }; })), rec.email || '');
  var date = inputEl(rec.date || today(), { type: 'date' });
  var labels = ['Overall learning experience', 'Pre-work materials', 'Quality of facilitation', 'Interactions with peers', 'Pacing and structure'];
  var scales = labels.map(function (l, i) { return scaleEl(10, rec['q' + (i + 1)], l); });
  var applied = textareaEl(rec.applied, { rows: 2 }), suggest = textareaEl(rec.suggest, { rows: 2 });
  var m = modal(rec.id ? 'Edit module feedback' : 'Add module feedback', [h('.epm-row3', field('Block', blk), field('Learner', who), field('Date', date)),
    labels.map(function (l, i) { return field((i + 1) + '. ' + l, scales[i]); }), field('6. Concepts or tools applied in their work', applied), field('7. Suggestions for future cohorts', suggest)], {
    wide: true,
    footer: [rec.id ? btn('Delete', { kind: 'danger-ghost', icon: 'trash' }, function () {
      confirmBox('Delete this response?', 'This cannot be undone.', 'Delete', true).then(function (ok) { if (ok) api('module.delete', { id: rec.id }).then(function () { m.close(); ctx.reload(); }).catch(fail); });
    }) : null, h('.epm-spacer'), btn('Save', { kind: 'primary' }, function () {
      var r = { id: rec.id, cohortId: ctx.id, blockId: blk.value, email: who.value, nameRaw: rec.nameRaw || '', date: date.value, applied: applied.value, suggest: suggest.value, source: rec.source, externalId: rec.externalId };
      scales.forEach(function (s, i) { r['q' + (i + 1)] = s.value; });
      api('module.save', { record: r }).then(function () { m.close(); toast('Saved'); ctx.reload(); }).catch(fail);
    })],
  });
}

function feedbackGoals(el, ctx) {
  var M = ctx.M, C = ctx.C;
  var qs = S.boot.goalsQuestions[C.cohort.language === 'es' ? 'es' : 'en'];
  var byEmail = {}; (C.goals || []).forEach(function (g) { byEmail[g.email] = g; });
  el.appendChild(h('p.epm-muted', 'Learners answer these in their personal profile link. ' + Object.keys(byEmail).length + ' of ' + M.counted.length + ' have answered.'));
  M.counted.forEach(function (e) {
    var g = byEmail[e.email];
    var det = h('details.epm-details', h('summary', h('b', fullName(M.learner[e.email])), ' ', g ? badge('Answered', 'good') : badge('Pending', 'muted')));
    if (g) qs.forEach(function (q, i) { det.appendChild(h('.epm-qa', h('.epm-q', q), h('.epm-a', g['a' + (i + 1)] || '—'))); });
    else det.appendChild(h('p.epm-muted', 'No answers yet. Share the profile link from the learner panel.'));
    el.appendChild(det);
  });
}

/* ------------------------------- CONVERSATIONS ------------------------------- */
function tabConversations(el, ctx) {
  var M = ctx.M, C = ctx.C, O = S.boot.options;
  var f = { who: '', cat: '', status: '' };
  var bar = h('.epm-toolbar',
    selectEl([{ value: '', label: 'All learners' }].concat(M.enrollments.map(function (e) { return { value: e.email, label: fullName(M.learner[e.email]) }; })), '', { 'aria-label': 'Learner', onchange: function () { f.who = this.value; draw(); } }),
    selectEl([{ value: '', label: 'All categories' }].concat(O.categories), '', { 'aria-label': 'Category', onchange: function () { f.cat = this.value; draw(); } }),
    selectEl([{ value: '', label: 'All statuses' }].concat(O.convStatus), '', { 'aria-label': 'Status', onchange: function () { f.status = this.value; draw(); } }),
    h('.epm-spacer'),
    btn('Send email', { icon: 'mail', kind: 'ghost' }, function () { emailComposer(ctx, []); }),
    btn('Log conversation', { icon: 'plus', kind: 'primary' }, function () { conversationModal(ctx, {}); }));
  var wrap = h('div');
  append(el, [bar, wrap]);
  function draw() {
    clear(wrap);
    var list = (C.conversations || []).filter(function (c) {
      return (!f.who || c.email === f.who) && (!f.cat || (c.categories || []).indexOf(f.cat) >= 0) && (!f.status || c.status === f.status);
    }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)); });
    if (!list.length) { wrap.appendChild(empty('No conversations match.')); return; }
    wrap.appendChild(h('.epm-table-wrap', h('table.epm-table.epm-table-click', h('thead', h('tr', ['Date', 'Learner', 'By', 'Via', 'Category', 'Description', 'Status'].map(function (x) { return h('th', x); }))),
      h('tbody', list.map(function (c) {
        return h('tr', { tabindex: '0', onclick: function () { conversationModal(ctx, c); }, onkeydown: function (e) { if (e.key === 'Enter') conversationModal(ctx, c); } },
          h('td.epm-nowrap', fmtDate(c.date)), h('td', c.email ? fullName(M.learner[c.email]) || c.email : (c.nameRaw || '—')),
          h('td.epm-small', c.initiatedBy + (c.withName ? ' · ' + c.withName : '')),
          h('td', (c.via || []).map(function (v) { return badge(v, 'muted'); })), h('td', (c.categories || []).map(function (v) { return badge(v, 'info'); })),
          h('td.epm-small', c.description, c.comments ? h('div.epm-muted', c.comments) : null),
          h('td', badge(c.status, c.status === 'Completed' ? 'good' : c.status === 'Pending' ? 'mid' : 'bad')));
      })))));
  }
  draw();
}

function learnerPicker(M, selected, onlyCounted) {
  var list = onlyCounted ? M.counted : M.enrollments;
  var wrap = h('.epm-picker');
  var all = h('input', { type: 'checkbox' });
  var boxes = list.map(function (e) { return h('label.epm-check', h('input', { type: 'checkbox', value: e.email, checked: selected.indexOf(e.email) >= 0 }), h('span', fullName(M.learner[e.email]))); });
  all.addEventListener('change', function () { boxes.forEach(function (b) { b.firstChild.checked = all.checked; }); });
  append(wrap, [h('label.epm-check.epm-check-all', all, h('b', 'Select all')), h('.epm-picker-list', boxes)]);
  wrap.getValues = function () { return boxes.filter(function (b) { return b.firstChild.checked; }).map(function (b) { return b.firstChild.value; }); };
  return wrap;
}

function conversationModal(ctx, c) {
  var M = ctx.M, O = S.boot.options;
  var editing = !!c.id;
  var picker = editing ? null : learnerPicker(M, c.email ? [c.email] : [], false);
  var date = inputEl(c.date || today(), { type: 'date' });
  var by = selectEl(O.initiatedBy, c.initiatedBy || 'Adizes');
  var via = checksEl(O.via, c.via || []), cats = checksEl(O.categories, c.categories || []);
  var desc = textareaEl(c.description, { rows: 2 }), comments = textareaEl(c.comments, { rows: 2 });
  var status = selectEl(O.convStatus, c.status || 'Completed');
  var m = modal(editing ? 'Conversation' : 'Log a conversation', [
    editing ? h('p.epm-p', h('b', c.email ? fullName(M.learner[c.email]) || c.email : c.nameRaw), c.emailSentAt ? h('span.epm-muted', ' · email sent ' + fmtDateTime(c.emailSentAt)) : null)
      : field('Learners (one entry is logged for each)', picker),
    h('.epm-row3', field('Date', date), field('Initiated by', by), field('Status', status)),
    field('Via', via), field('Category', cats), field('Description', desc), field('Comments', comments)], {
    wide: true,
    footer: [editing ? btn('Delete', { kind: 'danger-ghost', icon: 'trash' }, function () {
      confirmBox('Delete this conversation?', 'This cannot be undone.', 'Delete', true).then(function (ok) { if (ok) api('conversation.delete', { id: c.id }).then(function () { m.close(); ctx.reload(); }).catch(fail); });
    }) : null, h('.epm-spacer'), btn('Save', { kind: 'primary' }, function () {
      var rec = { id: c.id, cohortId: ctx.id, email: c.email, emails: picker ? picker.getValues() : null, date: date.value, initiatedBy: by.value, via: via.getValues(), categories: cats.getValues(), description: desc.value, status: status.value, comments: comments.value, withName: c.withName };
      if (!editing && !rec.emails.length) return toast('Choose at least one learner', 'error');
      if (!rec.description.trim()) return toast('Add a short description', 'error');
      api('conversation.save', { record: rec }).then(function (r) { m.close(); toast(r.ids.length > 1 ? r.ids.length + ' conversations logged' : 'Saved'); ctx.reload(); }).catch(fail);
    })],
  });
}

function emailComposer(ctx, preselected) {
  var M = ctx.M, C = ctx.C, T = S.boot.emailTemplates || {};
  var lang = C.cohort.language === 'es' ? 'es' : 'en';
  var names = { profile: 'Profile & goals link', moduleFeedback: 'Module feedback survey', certificate: 'Certificate', linkedin: 'LinkedIn tutorial', custom: 'Custom message' };
  var tpl = selectEl(Object.keys(names).map(function (k) { return { value: k, label: names[k] + (T[k] && T[k].pending ? ' (text pending)' : '') }; }), 'custom');
  var blk = selectEl(C.blocks.filter(function (b) { return b.kind === 'course'; }).map(function (b) { return { value: b.id, label: blockLabel(b) }; }), '');
  var blkField = field('Module', blk);
  var subject = inputEl(''), body = textareaEl('', { rows: 7 });
  var picker = learnerPicker(M, preselected || [], true);
  var note = h('p.epm-small.epm-muted');
  function sync() {
    var k = tpl.value, t = T[k] && T[k][lang];
    blkField.style.display = k === 'moduleFeedback' ? '' : 'none';
    var custom = k === 'custom';
    subject.readOnly = !custom; body.readOnly = !custom;
    subject.value = t ? t.subject : ''; body.value = t ? t.body : '';
    note.textContent = custom ? 'Use {first} for the first name. Sent in ' + (lang === 'es' ? 'Spanish' : 'English') + ' style; write it in the cohort language.' :
      (T[k] && T[k].pending ? 'This template still has placeholder text — it cannot be sent yet.' : 'Template text in ' + (lang === 'es' ? 'Spanish' : 'English') + '. {first}, {module} and the personal link are filled in for each learner.');
  }
  tpl.addEventListener('change', sync);
  sync();
  var m = modal('Send email · ' + C.cohort.name, [h('.epm-row2', field('Template', tpl), blkField), field('Recipients', picker), field('Subject', subject), field('Message', body), note,
    h('p.epm-small.epm-muted', 'Sent from the program mailbox. Each email is logged in Conversations (Via: Email).')], {
    wide: true,
    footer: [btn('Cancel', { kind: 'ghost' }, function () { m.close(); }), btn('Send', { kind: 'primary', icon: 'mail' }, function () {
      var emails = picker.getValues();
      if (!emails.length) return toast('Choose at least one recipient', 'error');
      if (tpl.value === 'custom' && (!subject.value.trim() || !body.value.trim())) return toast('Write a subject and a message', 'error');
      confirmBox('Send to ' + emails.length + ' learner(s)?', 'This sends real emails.', 'Send').then(function (ok) {
        if (!ok) return;
        api('email.send', { cohortId: ctx.id, template: tpl.value, blockId: blk.value, emails: emails, subject: subject.value, body: body.value }).then(function (r) {
          m.close(); toast(r.sent.length + ' sent' + (r.failed.length ? ' · failed: ' + r.failed.map(function (f) { return f.email + ' (' + errText(f.error) + ')'; }).join(', ') : ''), r.failed.length ? 'error' : null); ctx.reload();
        }).catch(fail);
      });
    })],
  });
}

/* ------------------------------- SETTINGS (cohort) ------------------------------- */
function tabSettings(el, ctx) {
  var C = ctx.C, c = C.cohort, O = S.boot.options;
  var F = {
    name: inputEl(c.name), code: inputEl(c.code), language: selectEl([{ value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' }], c.language),
    status: selectEl(O.cohortStatus, c.status), startDate: inputEl(c.startDate, { type: 'date' }), teachableBundleId: inputEl(c.teachableBundleId),
    zoomMeetingId: inputEl(c.zoomMeetingId), zoomLink: inputEl(c.zoomLink, { placeholder: 'https://zoom.us/j/…' }), moduleFeedbackFormId: inputEl(c.moduleFeedbackFormId, { placeholder: 'Leave empty to use the default for the language' }),
    notes: textareaEl(c.notes, { rows: 2 }),
  };
  el.appendChild(h('.epm-card', h('h3', 'Cohort details'),
    h('.epm-row3', field('Name', F.name), field('Code', F.code), field('Language (all learner emails & forms)', F.language)),
    h('.epm-row3', field('Status', F.status), field('Start date', F.startDate), field('Teachable bundle ID', F.teachableBundleId)),
    h('.epm-row3', field('Zoom meeting ID', F.zoomMeetingId), field('Zoom link', F.zoomLink), field('Typeform module form ID (optional)', F.moduleFeedbackFormId)),
    field('Notes', F.notes),
    h('.epm-actions', btn('Save details', { kind: 'primary' }, function () {
      var patch = {}; Object.keys(F).forEach(function (k) { patch[k] = F[k].value; });
      api('cohort.update', { id: ctx.id, patch: patch }).then(function () { toast('Saved'); refreshBoot(); ctx.reload(); }).catch(fail);
    }))));
  el.appendChild(structureEditor(ctx));
  el.appendChild(h('.epm-card.epm-danger-zone', h('h3', 'Delete cohort'), h('p.epm-muted', 'Deletes the cohort with its sessions, attendance, feedback and conversations. Learner profiles stay (they may be in other cohorts).'),
    btn('Delete ' + c.name, { kind: 'danger', icon: 'trash' }, function () {
      var inp = inputEl('', { placeholder: 'DELETE' });
      var m = modal('Delete ' + c.name + '?', [h('p.epm-p', 'Type DELETE to confirm. This cannot be undone.'), inp], {
        footer: [btn('Cancel', { kind: 'ghost' }, function () { m.close(); }), btn('Delete permanently', { kind: 'danger' }, function () {
          api('cohort.delete', { id: ctx.id, confirm: inp.value.trim() }).then(function () { m.close(); delete S.cohorts[ctx.id]; refreshBoot().then(function () { go('cohorts'); }); }).catch(fail);
        })],
      });
    })));
}

function structureEditor(ctx) {
  var C = ctx.C, O = S.boot.options;
  var blocks = C.blocks.map(function (b) { return Object.assign({}, b); });
  var sessions = C.sessions.map(function (s) { return Object.assign({}, s); });
  var dirty = false;
  var card = h('.epm-card');
  var list = h('div');
  var saveBtn = btn('Save structure', { kind: 'primary' }, save);
  append(card, [h('.epm-card-head', h('h3', 'Structure & dates'), h('.epm-actions', btn('Reschedule dates', { icon: 'sync', kind: 'ghost' }, reschedule), saveBtn)),
    h('p.epm-muted.epm-small', 'Blocks and sessions in program order. Changes are kept here until you press “Save structure”. Removing a session also removes its attendance marks.'), list,
    btn('Add block', { icon: 'plus', kind: 'ghost' }, function () { blocks.push({ id: 'new' + Date.now(), kind: 'course', number: '', title: 'New block' }); mark(); draw(); })]);
  function mark() { dirty = true; saveBtn.classList.add('epm-pulse'); }
  function sessionsOf(b) { return sessions.filter(function (s) { return s.blockId === b.id; }); }
  function draw() {
    clear(list);
    blocks.forEach(function (b, bi) {
      var bx = h('.epm-sblock');
      var kind = selectEl(O.blockKinds.map(function (k) { return { value: k, label: { welcome: 'Welcome', course: 'Course', case_study: 'Case study', other: 'Other', wrapup: 'Wrap-up' }[k] }; }), b.kind, { 'aria-label': 'Kind', onchange: function () { b.kind = this.value; mark(); } });
      var no = inputEl(b.number, { 'aria-label': 'Number', style: { width: '64px' }, oninput: function () { b.number = this.value; mark(); } });
      var title = inputEl(b.title, { 'aria-label': 'Title', oninput: function () { b.title = this.value; mark(); } });
      var sme = selectEl(smeOptions('No SME'), smeValue(b), { 'aria-label': 'SME', onchange: function () { applySme(b, this.value); mark(); } });
      var tc = inputEl(b.teachableCourseId, { 'aria-label': 'Teachable course ID', placeholder: 'Teachable course ID', style: { width: '150px' }, oninput: function () { b.teachableCourseId = this.value.trim(); mark(); } });
      var fb = h('label.epm-check', h('input', { type: 'checkbox', checked: !!b.smeSeesFeedback, onchange: function () { b.smeSeesFeedback = this.checked; mark(); } }), h('span', 'SME can see feedback'));
      bx.appendChild(h('.epm-sblock-head', kind, no, title, sme, tc, fb, h('.epm-sblock-btns',
        btn('', { icon: 'up', kind: 'ghost', aria: 'Move block up', disabled: bi === 0 }, function () { move(bi, -1); }),
        btn('', { icon: 'down', kind: 'ghost', aria: 'Move block down', disabled: bi === blocks.length - 1 }, function () { move(bi, 1); }),
        btn('', { icon: 'trash', kind: 'ghost', aria: 'Delete block' }, function () {
          confirmBox('Delete “' + b.title + '”?', 'Its ' + sessionsOf(b).length + ' sessions (and their attendance) will be removed when you save.', 'Delete', true).then(function (ok) {
            if (!ok) return; blocks.splice(bi, 1); sessions = sessions.filter(function (s) { return s.blockId !== b.id; }); mark(); draw(); });
        }))));
      var rows = h('.epm-srows');
      sessionsOf(b).forEach(function (s) {
        rows.appendChild(h('.epm-srow',
          inputEl(s.date, { type: 'date', 'aria-label': 'Date', onchange: function () { s.date = this.value; mark(); } }),
          inputEl(s.moduleNo, { 'aria-label': 'Module number', placeholder: 'No.', style: { width: '64px' }, oninput: function () { s.moduleNo = this.value; mark(); } }),
          inputEl(s.moduleTitle, { 'aria-label': 'Module title', placeholder: 'Module title', oninput: function () { s.moduleTitle = this.value; mark(); } }),
          selectEl(smeOptions('Block SME'), smeValue(s), { 'aria-label': 'Session SME', onchange: function () { applySme(s, this.value); mark(); } }),
          btn('', { icon: 'close', kind: 'ghost', aria: 'Remove session' }, function () { sessions.splice(sessions.indexOf(s), 1); mark(); draw(); })));
      });
      rows.appendChild(btn('Add session', { icon: 'plus', kind: 'ghost' }, function () {
        var ss = sessionsOf(b), last = ss[ss.length - 1];
        var ns = { id: 'new' + Date.now(), blockId: b.id, date: last && last.date ? addDays(last.date, 2) : '', moduleNo: last ? last.moduleNo : '', moduleTitle: last ? last.moduleTitle : '' };
        var idx = last ? sessions.indexOf(last) + 1 : sessions.length;
        sessions.splice(idx, 0, ns); mark(); draw();
      }));
      bx.appendChild(rows);
      list.appendChild(bx);
    });
  }
  function move(i, d) {
    var b = blocks.splice(i, 1)[0]; blocks.splice(i + d, 0, b);
    // keep sessions in block order
    var ordered = []; blocks.forEach(function (x) { ordered = ordered.concat(sessionsOf(x)); }); sessions = ordered;
    mark(); draw();
  }
  function reschedule() {
    var ordered = []; blocks.forEach(function (x) { ordered = ordered.concat(sessionsOf(x)); }); sessions = ordered;
    var from = selectEl(sessions.map(function (s, i) { return { value: String(i), label: (s.date ? fmtDate(s.date) : 'no date') + ' · ' + (s.moduleNo || '') + ' ' + (s.moduleTitle || '') }; }), String(Math.max(0, sessions.findIndex(function (s) { return !s.date || s.date >= today(); }))));
    var start = inputEl(today(), { type: 'date' });
    var days = h('.epm-checks', [1, 2, 3, 4, 5, 6].map(function (d) { return h('label.epm-check', h('input', { type: 'checkbox', value: String(d), checked: d === 1 || d === 3 }), h('span', WD[d])); }));
    var skip = textareaEl('', { rows: 3, placeholder: 'One date per line (YYYY-MM-DD): the whole week of each date is skipped' });
    var m = modal('Reschedule dates', [field('From session', from), field('First date', start), field('Session days', days), field('Weeks without sessions (holidays)', skip),
      h('p.epm-small.epm-muted', 'Assigns new dates to that session and all the following ones, keeping their order. Review, then press “Save structure”.')], {
      footer: [btn('Cancel', { kind: 'ghost' }, function () { m.close(); }), btn('Apply', { kind: 'primary' }, function () {
        var wd = Array.prototype.slice.call(days.querySelectorAll('input:checked')).map(function (i) { return Number(i.value); });
        var fromI = Number(from.value), rest = sessions.slice(fromI);
        var dates = generateDates(start.value, wd, skip.value.split(/\s+/), rest.length);
        if (dates.length < rest.length) return toast('Choose a start date and at least one weekday', 'error');
        rest.forEach(function (s, i) { s.date = dates[i]; });
        m.close(); mark(); draw(); toast(rest.length + ' sessions rescheduled — remember to save');
      })],
    });
  }
  function save() {
    var ordered = []; blocks.forEach(function (x) { ordered = ordered.concat(sessionsOf(x)); });
    api('structure.save', { cohortId: ctx.id, blocks: blocks.map(function (b) { return Object.assign({}, b, { key: b.id }); }), sessions: ordered }).then(function (r) {
      dirty = false; toast('Structure saved' + (r.removedAttendance ? ' · ' + r.removedAttendance + ' attendance marks removed' : '')); refreshBoot(); ctx.reload();
    }).catch(fail);
  }
  draw();
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  return card;
}

/* ---- app.js ---- */
/* ===================================================================================
 * STAFF APP — shell, sign-in, cohorts list & wizard, learner panel, global pages
 * =================================================================================== */
function signOutLocal() { S.token = null; S.user = null; S.boot = null; S.cohorts = {}; lsSet(LS_KEY, null); }
function refreshBoot() { return api('bootstrap', {}, { silent: true }).then(function (b) { S.boot = b; S.user = b.user; return b; }); }

function shell() {
  var root = document.getElementById(ROOT_ID);
  resetRoot(root);
  var pm = isPM();
  var nav = pm ? [['cohorts', 'Cohorts'], ['learners', 'Learners'], ['smes', 'SMEs'], ['team', 'Team'], ['settings', 'Settings']] : [['cohorts', 'My cohorts'], ['smes', 'My ratings']];
  var r = route();
  var active = r.name === 'c' ? 'cohorts' : r.name;
  var header = h('header.epm-top',
    h('a.epm-brand', { href: '#/cohorts' }, h('img', { src: (CFG.assets || ASSETS) + 'adizes-logo-white.png', alt: 'Adizes', width: '92', height: '31' }), h('span', 'Exec Program Manager')),
    h('nav.epm-nav', nav.map(function (n) { return h('a', { href: '#/' + n[0], class: active === n[0] ? 'on' : '' }, n[1]); })),
    h('.epm-me', h('span.epm-me-name', S.user.name || S.user.email, h('small', S.user.role === 'PM' ? 'Program Manager' : 'SME')),
      btn('', { icon: 'out', kind: 'ghost-inv', aria: 'Sign out', title: 'Sign out' }, function () {
        api('auth.logout', {}).catch(function () {}).then(function () { signOutLocal(); render(); });
      })));
  var main = h('main.epm-main');
  append(root, [h('.epm-progress'), header, main]);
  return main;
}

function render() {
  var root = document.getElementById(ROOT_ID);
  if (!root) return;
  if (!S.token) return viewLogin(root);
  if (!S.boot) {
    resetRoot(root).appendChild(h('.epm-loading.epm-center', 'Loading…'));
    return refreshBoot().then(render).catch(function (e) { if (!S.token) render(); else { resetRoot(root); root.appendChild(empty(e.message, btn('Try again', {}, function () { render(); }))); } });
  }
  var main = shell();
  var r = route();
  var views = { cohorts: viewCohorts, c: viewCohort, learners: viewLearners, smes: viewSmes, team: viewTeam, settings: viewSettings };
  var fn = views[r.name] || viewCohorts;
  if (!isPM() && ['learners', 'team', 'settings'].indexOf(r.name) >= 0) fn = viewCohorts;
  fn(main, r);
  window.scrollTo(0, 0);
}

/* ------------------------------- LOGIN ------------------------------- */
function viewLogin(root) {
  resetRoot(root);
  var email = inputEl((lsGet('epm_last_email') || ''), { type: 'email', autocomplete: 'email', placeholder: 'you@adizes.com', 'aria-label': 'Email' });
  var code = inputEl('', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: '6-digit code', 'aria-label': 'Code' });
  var msg = h('p.epm-login-msg', { role: 'status' });
  var step1 = h('form.epm-login-form', { onsubmit: function (e) {
    e.preventDefault();
    var v = email.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { msg.textContent = 'Enter a valid email.'; return; }
    lsSet('epm_last_email', v);
    sendBtn.disabled = true;
    api('auth.request', { email: v }, { noToken: true }).then(function () {
      step1.hidden = true; step2.hidden = false; code.focus();
      msg.textContent = 'If ' + v + ' has access, a code is on its way. It expires in 10 minutes.';
    }).catch(function (e) { msg.textContent = e.message; }).then(function () { sendBtn.disabled = false; });
  } }, field('Work email', email), h('button.epm-btn.epm-btn-primary.epm-btn-block', { type: 'submit' }, 'Send me a code'));
  var sendBtn = step1.querySelector('button');
  var step2 = h('form.epm-login-form', { hidden: true, onsubmit: function (e) {
    e.preventDefault();
    api('auth.verify', { email: email.value.trim().toLowerCase(), code: code.value }, { noToken: true }).then(function (r) {
      S.token = r.token; S.user = r.user; lsSet(LS_KEY, { token: r.token });
      render();
    }).catch(function (e) { msg.textContent = e.message; code.select(); });
  } }, field('Code', code), h('button.epm-btn.epm-btn-primary.epm-btn-block', { type: 'submit' }, 'Sign in'),
    h('button.epm-link', { type: 'button', onclick: function () { step2.hidden = true; step1.hidden = false; msg.textContent = ''; } }, 'Use another email / resend'));
  root.appendChild(h('.epm-login', h('.epm-login-card',
    h('.epm-login-brand', h('img', { src: (CFG.assets || ASSETS) + 'adizes-logo-white.png', alt: 'Adizes', width: '120', height: '40' })),
    h('.epm-login-body', h('h1', 'Exec Program Manager'), h('p.epm-muted', 'For Program Managers and SMEs of the Adizes Executive Program.'), step1, step2, msg))));
  setTimeout(function () { email.focus(); }, 30);
}

/* ------------------------------- COHORTS ------------------------------- */
function viewCohorts(main) {
  var B = S.boot;
  main.appendChild(h('.epm-page-head', h('div', h('h1', isPM() ? 'Cohorts' : 'My cohorts'), h('p.epm-sub', B.cohorts.length + ' cohort' + (B.cohorts.length === 1 ? '' : 's'))),
    isPM() ? h('.epm-actions', btn('New cohort', { icon: 'plus', kind: 'primary' }, newCohortWizard)) : null));
  if (!B.cohorts.length) {
    main.appendChild(empty(isPM() ? 'No cohorts yet. Create one, or import the old Matrix sheets in Settings → Import.' : 'You are not assigned to any cohort yet. The Program Manager assigns SMEs to blocks.',
      isPM() ? btn('New cohort', { icon: 'plus', kind: 'primary' }, newCohortWizard) : null));
    return;
  }
  var groups = { Active: [], Planned: [], Completed: [] };
  B.cohorts.forEach(function (c) { (groups[c.status] || groups.Active).push(c); });
  Object.keys(groups).forEach(function (g) {
    if (!groups[g].length) return;
    main.appendChild(h('h2.epm-h2', g));
    main.appendChild(h('.epm-cards', groups[g].map(function (c) {
      var prog = c.sessionsTotal ? c.sessionsDone / c.sessionsTotal : 0;
      return h('a.epm-ccard', { href: '#/c/' + c.id + '/overview' },
        h('.epm-ccard-top', h('h3', c.name), badge(c.language === 'es' ? 'ES' : 'EN', 'muted')),
        h('p.epm-muted.epm-small', [c.code, c.firstSession ? fmtDate(c.firstSession) + ' – ' + fmtDate(c.lastSession) : ''].filter(Boolean).join(' · ') || ' '),
        h('.epm-progressbar', { title: c.sessionsDone + ' of ' + c.sessionsTotal + ' sessions' }, h('i', { style: { width: Math.round(prog * 100) + '%' } })),
        h('p.epm-small.epm-muted', c.sessionsDone + ' / ' + c.sessionsTotal + ' sessions'),
        h('.epm-ccard-kpis',
          h('div', h('b', String(c.learners)), h('span', 'learners')),
          h('div', h('b', { class: 'epm-t-' + tone(c.attendance) }, pct(c.attendance)), h('span', 'attendance')),
          h('div', h('b', { class: 'epm-t-' + tone(c.lms) }, pct(c.lms)), h('span', 'LMS')),
          h('div', h('b', c.weeklyRating == null ? '—' : num(c.weeklyRating, 1)), h('span', 'rating /5'))),
        isPM() && c.pendingConversations ? h('p.epm-small', badge(c.pendingConversations + ' pending conversation' + (c.pendingConversations > 1 ? 's' : ''), 'mid')) : null);
    })));
  });
}

function newCohortWizard() {
  var B = S.boot, O = B.options;
  var name = inputEl('', { placeholder: 'Cohort 8' }), code = inputEl('', { placeholder: 'C-AEP-108-27' });
  var lang = selectEl([{ value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' }], 'en');
  var bundle = inputEl('', { placeholder: 'e.g. 783728' }), zoom = inputEl('', { placeholder: 'https://zoom.us/j/…' });
  var source = selectEl([{ value: 'template', label: 'Default program template (' + B.template.length + ' blocks)' }].concat(B.cohorts.map(function (c) { return { value: c.id, label: 'Copy structure from ' + c.name }; })), 'template');
  var welcome = inputEl('', { type: 'date' }), first = inputEl('', { type: 'date' });
  var days = h('.epm-checks', [1, 2, 3, 4, 5, 6].map(function (d) { return h('label.epm-check', h('input', { type: 'checkbox', value: String(d), checked: d === 1 || d === 3 }), h('span', WD[d])); }));
  var skip = textareaEl('', { rows: 3, placeholder: 'Holiday weeks: one date per line (YYYY-MM-DD). The whole week is skipped.' });
  var preview = h('p.epm-small.epm-muted');
  var structure = null;
  function buildStructure() {
    var wd = Array.prototype.slice.call(days.querySelectorAll('input:checked')).map(function (i) { return Number(i.value); });
    var getSrc = source.value === 'template' ? Promise.resolve(templateStructure(B.template)) : loadCohort(source.value).then(copyStructure);
    return getSrc.then(function (st) {
      var regular = st.sessions.filter(function (s) { return st.blocks.find(function (b) { return b.key === s.blockKey; }).kind !== 'welcome'; });
      var dates = generateDates(first.value, wd, skip.value.split(/\s+/), regular.length);
      regular.forEach(function (s, i) { s.date = dates[i] || ''; });
      st.sessions.forEach(function (s) { if (st.blocks.find(function (b) { return b.key === s.blockKey; }).kind === 'welcome') s.date = welcome.value; });
      structure = st;
      var ds = st.sessions.map(function (s) { return s.date; }).filter(Boolean).sort();
      preview.textContent = st.blocks.length + ' blocks · ' + st.sessions.length + ' sessions' + (ds.length ? ' · ' + fmtDate(ds[0]) + ' → ' + fmtDate(ds[ds.length - 1]) : ' · choose the dates to generate the calendar');
      return st;
    });
  }
  [source, welcome, first, skip].forEach(function (x) { x.addEventListener('change', function () { buildStructure().catch(fail); }); });
  days.addEventListener('change', function () { buildStructure().catch(fail); });
  buildStructure();
  var m = modal('New cohort', [
    h('.epm-row3', field('Name', name), field('Code', code), field('Language', lang, 'All learner emails and forms use this language.')),
    h('.epm-row2', field('Teachable bundle ID', bundle), field('Zoom link', zoom)),
    field('Structure', source, 'You can edit blocks, titles, SMEs and dates afterwards in the cohort Settings.'),
    h('.epm-row2', field('Welcome session date', welcome), field('First module session', first)),
    field('Session days', days), field('Weeks without sessions', skip), preview], {
    wide: true,
    footer: [btn('Cancel', { kind: 'ghost' }, function () { m.close(); }), btn('Create cohort', { kind: 'primary' }, function () {
      if (!name.value.trim()) return toast('Give the cohort a name', 'error');
      buildStructure().then(function (st) {
        return api('cohort.create', { data: { name: name.value, code: code.value, language: lang.value, startDate: welcome.value || first.value, teachableBundleId: bundle.value, zoomLink: zoom.value, status: 'Planned' }, structure: st });
      }).then(function (r) { m.close(); toast('Cohort created'); return refreshBoot().then(function () { go('c/' + r.id + '/settings'); }); }).catch(fail);
    })],
  });
}
function templateStructure(tpl) {
  var blocks = [], sessions = [];
  tpl.forEach(function (b, i) {
    var key = 'b' + i;
    blocks.push({ key: key, kind: b.kind, number: b.number, title: b.title, smeName: b.smeName || '', smeEmail: matchSmeEmail(b.smeName) });
    b.modules.forEach(function (mo) { for (var k = 0; k < (mo.sessions || 2); k++) sessions.push({ blockKey: key, moduleNo: mo.no, moduleTitle: mo.title }); });
  });
  return { blocks: blocks, sessions: sessions };
}
function copyStructure(C) {
  var blocks = C.blocks.map(function (b) { return { key: b.id, kind: b.kind, number: b.number, title: b.title, smeName: b.smeName, smeEmail: b.smeEmail, smeSeesFeedback: b.smeSeesFeedback }; });
  var sessions = C.sessions.map(function (s) { return { blockKey: s.blockId, moduleNo: s.moduleNo, moduleTitle: s.moduleTitle, smeName: s.smeName, smeEmail: s.smeEmail }; });
  return { blocks: blocks, sessions: sessions };
}
function matchSmeEmail(n) {
  if (!n) return '';
  var s = (S.boot.smes || []).find(function (x) { return x.email && x.name && normName(x.name).indexOf(normName(n)) === 0; });
  return s ? s.email : '';
}

/* ------------------------------- LEARNER PANEL ------------------------------- */
function learnerDrawer(ctx, email) {
  var M = ctx.M, C = ctx.C, O = S.boot.options, pm = isPM();
  var l = M.learner[email], e = C.enrollments.find(function (x) { return x.email === email; });
  if (!l || !e) return toast('Learner not found in this cohort', 'error');
  var st = M.stats[email];
  var body = h('div');
  var m = modal(fullName(l), body, { drawer: true, onClose: function () {
    // forget the learner in the URL so a later re-render does not reopen the panel
    if (route().sub && history.replaceState) history.replaceState(null, '', '#/c/' + ctx.id + '/learners');
    ctx.sub = '';
  } });
  var tabs = [['profile', 'Profile'], ['progress', 'Progress']].concat(pm ? [['program', 'Program'], ['goals', 'Goals'], ['conv', 'Conversations']] : []).concat([['feedback', 'Feedback']]);
  var cur = 'profile';
  var nav = h('.epm-subtabs');
  var pane = h('div');
  append(body, [
    h('.epm-drawer-sum', statusBadge(e.status), h('span', 'Attendance ', pctCell(st.att)), h('span', 'LMS ', pctCell(st.lms)), st.exp != null ? h('span', 'Rating ' + num(st.exp) + '/5') : null,
      st.risk.length ? badge('Needs attention', 'bad') : null),
    nav, pane]);
  function drawNav() { clear(nav); tabs.forEach(function (t) { nav.appendChild(h('a', { href: 'javascript:void 0', class: t[0] === cur ? 'on' : '', onclick: function () { cur = t[0]; drawNav(); draw(); } }, t[1])); }); }
  function saveLearner(patch) { return api('learner.update', { email: email, patch: patch }).then(function (r) { toast('Saved'); return r; }); }
  function draw() {
    clear(pane);
    if (cur === 'profile') {
      if (!pm) {
        pane.appendChild(h('dl.epm-dl', [['Company', l.company], ['Job title', l.jobTitle], ['Profile', (l.profile || []).join(', ')], ['PAEI', ['P', 'A', 'E', 'I'].map(function (k) { return k + ' ' + (l[k] == null ? '—' : l[k]); }).join(' · ')], ['Lifecycle', l.lifecycle]]
          .map(function (r) { return [h('dt', r[0]), h('dd', r[1] || '—')]; })));
        return;
      }
      var F = {
        firstName: inputEl(l.firstName), lastName: inputEl(l.lastName), newEmail: inputEl(l.email, { type: 'email' }), company: inputEl(l.company), jobTitle: inputEl(l.jobTitle),
        phone: inputEl(l.phone), birthday: inputEl(l.birthday, { type: 'date' }), linkedin: inputEl(l.linkedin), address: textareaEl(l.address, { rows: 2 }),
        P: inputEl(l.P, { type: 'number' }), A: inputEl(l.A, { type: 'number' }), E: inputEl(l.E, { type: 'number' }), I: inputEl(l.I, { type: 'number' }),
        lifecycle: selectEl([''].concat(O.lifecycle).concat(l.lifecycle && O.lifecycle.indexOf(l.lifecycle) < 0 ? [l.lifecycle] : []), l.lifecycle || ''),
        notes: textareaEl(l.notes, { rows: 2 }),
      };
      var prof = checksEl(O.profile.concat((l.profile || []).filter(function (p) { return O.profile.indexOf(p) < 0; })), l.profile || []);
      append(pane, [
        h('.epm-row2', field('First name', F.firstName), field('Last name', F.lastName)),
        h('.epm-row2', field('Email', F.newEmail, 'Changing it updates every record of this person.'), field('Company', F.company)),
        h('.epm-row2', field('Job title', F.jobTitle), field('Phone', F.phone)),
        h('.epm-row2', field('Birthday', F.birthday), field('LinkedIn', F.linkedin)),
        field('Address (welcome kit)', F.address), field('Learner profile', prof),
        h('.epm-row4', field('P', F.P), field('A', F.A), field('E', F.E), field('I', F.I)),
        field('Lifecycle test', F.lifecycle), field('Internal notes', F.notes),
        h('.epm-actions', btn('Save profile', { kind: 'primary' }, function () {
          var patch = { profile: prof.getValues() }; Object.keys(F).forEach(function (k) { patch[k] = F[k].value; });
          saveLearner(patch).then(function (r) { m.close(); delete S.cohorts[ctx.id]; go('c/' + ctx.id + '/learners/' + encodeURIComponent(r.email)); }).catch(fail);
        })),
        h('.epm-card.epm-card-flat', h('h4', 'Personal profile link'), h('p.epm-small.epm-muted', l.profileSubmittedAt ? 'Completed on ' + fmtDateTime(l.profileSubmittedAt) + '. The learner can open it again to update.' : 'Not completed yet.'),
          h('.epm-actions', btn('Copy link', { icon: 'copy', kind: 'ghost' }, function () { copyText(l.profileLink); }),
            btn('Email the link', { icon: 'mail', kind: 'ghost' }, function () {
              api('learner.sendProfileLink', { cohortId: ctx.id, email: email }).then(function () { toast('Link sent and logged'); delete S.cohorts[ctx.id]; }).catch(fail);
            })))]);
    }
    if (cur === 'program') {
      var status = selectEl(O.enrollmentStatus, e.status), wes = h('input', { type: 'checkbox', checked: !!e.welcomeEmailSent });
      var kit = selectEl([''].concat(O.welcomeKit), l.welcomeKit || ''), books = inputEl(l.booksCode), cert = selectEl([''].concat(O.certification), e.certificationSent || '');
      append(pane, [
        h('.epm-row2', field('Status in ' + C.cohort.name, status), field('Certification sent', cert)),
        h('.epm-row2', field('Welcome kit sent', kit), field('Books code', books)),
        h('label.epm-check', wes, h('span', 'Welcome email sent')),
        h('.epm-actions', btn('Save', { kind: 'primary' }, function () {
          Promise.all([api('enrollment.update', { id: e.id, patch: { status: status.value, welcomeEmailSent: wes.checked, certificationSent: cert.value } }),
            api('learner.update', { email: email, patch: { welcomeKit: kit.value, booksCode: books.value } })]).then(function () { toast('Saved'); m.close(); ctx.reload(); }).catch(fail);
        })),
        h('.epm-card.epm-card-flat', h('h4', 'Move to another cohort'), h('p.epm-small.epm-muted', 'Marks this enrollment as “Moved to next cohort” and enrolls the person in the other cohort. Their history stays.'),
          (function () {
            var to = selectEl([{ value: '', label: 'Choose cohort…' }].concat((C.otherCohorts || []).map(function (c) { return { value: c.id, label: c.name + ' (' + c.status + ')' }; })), '');
            var note = inputEl('', { placeholder: 'Reason (optional, logged in Conversations)' });
            return h('div', h('.epm-row2', to, note), h('.epm-actions', btn('Move learner', { kind: 'primary' }, function () {
              if (!to.value) return toast('Choose the cohort', 'error');
              api('enrollment.move', { id: e.id, toCohortId: to.value, note: note.value || ' ' }).then(function () { toast('Moved'); m.close(); S.cohorts = {}; refreshBoot(); ctx.reload(); }).catch(fail);
            })));
          })()),
        h('.epm-card.epm-card-flat', h('h4', 'Remove from this cohort'), h('p.epm-small.epm-muted', 'Only for mistakes. To record that someone left, use the status “Dropped Out” instead.'),
          btn('Remove enrollment', { kind: 'danger-ghost', icon: 'trash' }, function () {
            confirmBox('Remove ' + fullName(l) + ' from ' + C.cohort.name + '?', 'Deletes their attendance, goals and LMS data for this cohort.', 'Remove', true).then(function (ok) {
              if (ok) api('enrollment.delete', { id: e.id, confirm: 'DELETE' }).then(function () { m.close(); ctx.reload(); }).catch(fail);
            });
          }))]);
    }
    if (cur === 'progress') {
      var rows = C.blocks.map(function (b) {
        var a = st.attByBlock[b.id], lp = (M.lms[email] || {})[b.id];
        if (!a && !lp && !b.teachableCourseId) return null;
        return h('tr', h('td', blockLabel(b)), h('td.num', a ? pctCell(a.p / a.t) : '—'), h('td.num', a ? a.p + '/' + a.t : ''), h('td.num', lp ? pctCell((lp.p || 0) / 100) : (b.teachableCourseId ? '—' : '')));
      }).filter(Boolean);
      append(pane, [h('.epm-table-wrap', h('table.epm-table.epm-table-sm', h('thead', h('tr', h('th', 'Block'), h('th.num', 'Attendance'), h('th.num', 'Sessions'), h('th.num', 'LMS'))), h('tbody', rows))),
        M.lmsBlocks.length ? btn('See every lesson', { kind: 'ghost' }, function () { lmsDetailModal(ctx, email); }) : null]);
    }
    if (cur === 'goals') {
      var g = (C.goals || []).find(function (x) { return x.email === email; }) || {};
      var qs = S.boot.goalsQuestions[C.cohort.language === 'es' ? 'es' : 'en'];
      var tas = qs.map(function (q, i) { return textareaEl(g['a' + (i + 1)], { rows: 2 }); });
      append(pane, [h('p.epm-small.epm-muted', g.submittedAt ? 'Answered ' + fmtDateTime(g.submittedAt) : 'The learner answers this in their profile link. You can also type the answers here.'),
        qs.map(function (q, i) { return field(q, tas[i]); }),
        h('.epm-actions', btn('Save answers', { kind: 'primary' }, function () {
          api('goals.save', { cohortId: ctx.id, email: email, answers: tas.map(function (t) { return t.value; }) }).then(function () { toast('Saved'); delete S.cohorts[ctx.id]; }).catch(fail);
        }))]);
    }
    if (cur === 'conv') {
      var conv = (C.conversations || []).filter(function (c) { return c.email === email; }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
      append(pane, [h('.epm-actions', btn('Log conversation', { icon: 'plus', kind: 'primary' }, function () { m.close(); conversationModal(ctx, { email: email }); }),
        btn('Send email', { icon: 'mail', kind: 'ghost' }, function () { m.close(); emailComposer(ctx, [email]); })),
        conv.length ? h('ul.epm-timeline', conv.map(function (c) {
          return h('li', h('.epm-tl-date', fmtDate(c.date)), h('div', h('b', c.description), h('div.epm-small.epm-muted', [c.initiatedBy, (c.via || []).join(', '), (c.categories || []).join(', ')].filter(Boolean).join(' · ')), c.comments ? h('div.epm-small', c.comments) : null),
            badge(c.status, c.status === 'Completed' ? 'good' : c.status === 'Pending' ? 'mid' : 'bad'));
        })) : empty('No conversations yet.')]);
    }
    if (cur === 'feedback') {
      var wf = (C.weeklyFeedback || []).filter(function (w) { return w.email === email; });
      var mf = (C.moduleFeedback || []).filter(function (w) { return w.email === email; });
      if (!wf.length && !mf.length) { pane.appendChild(empty('No feedback from this learner yet.')); return; }
      append(pane, [wf.length ? h('h4', 'Session feedback (1–5)') : null, wf.length ? h('.epm-table-wrap', h('table.epm-table.epm-table-sm', h('tbody', wf.map(function (w) {
        return h('tr', h('td.epm-nowrap', fmtDate(w.date)), h('td.num', num(overall5(w))), h('td.epm-small', [w.improve, w.comments].filter(Boolean).join(' · ')));
      })))) : null,
      mf.length ? h('h4', 'Module feedback (1–10)') : null, mf.length ? h('.epm-table-wrap', h('table.epm-table.epm-table-sm', h('tbody', mf.map(function (w) {
        return h('tr', h('td', blockLabel(M.block[w.blockId])), h('td.num', num(overall5(w))), h('td.epm-small', [w.applied, w.suggest].filter(Boolean).join(' · ')));
      })))) : null]);
    }
  }
  drawNav(); draw();
}

/* ------------------------------- ALL LEARNERS ------------------------------- */
function viewLearners(main) {
  main.appendChild(h('.epm-page-head', h('div', h('h1', 'Learners'), h('p.epm-sub', 'Everyone across cohorts. Click a cohort to open the learner there.'))));
  var q = inputEl('', { type: 'search', placeholder: 'Search name, email or company', 'aria-label': 'Search' });
  var wrap = h('div', h('.epm-loading', 'Loading…'));
  append(main, [h('.epm-toolbar', q), wrap]);
  api('learners.all', {}).then(function (r) {
    var all = r.learners.sort(function (a, b) { return fullName(a).localeCompare(fullName(b)); });
    function draw() {
      clear(wrap);
      var t = normName(q.value);
      var list = all.filter(function (l) { return !t || normName(fullName(l) + ' ' + l.email + ' ' + (l.company || '')).indexOf(t) >= 0; });
      wrap.appendChild(h('p.epm-small.epm-muted', list.length + ' people'));
      wrap.appendChild(h('.epm-table-wrap', h('table.epm-table', h('thead', h('tr', ['Name', 'Email', 'Company', 'Cohorts', 'PAEI', 'Lifecycle', 'Profile'].map(function (x) { return h('th', x); }))),
        h('tbody', list.slice(0, 400).map(function (l) {
          return h('tr', h('td', h('b', fullName(l))), h('td.epm-small', l.email), h('td.epm-small', l.company || ''),
            h('td', l.enrollments.map(function (e) { return h('a.epm-chip', { href: '#/c/' + e.cohortId + '/learners/' + encodeURIComponent(l.email), title: e.status }, e.cohort, ' ', h('i', { class: 'epm-dot epm-dot-' + (STATUS_KIND[e.status] || 'muted') })); })),
            h('td.epm-small.epm-nowrap', ['P', 'A', 'E', 'I'].map(function (k) { return l[k] == null ? '–' : l[k]; }).join(' / ')), h('td', l.lifecycle || '—'), h('td', l.profileSubmittedAt ? badge('Done', 'good') : '—'));
        })))));
    }
    q.addEventListener('input', draw);
    draw();
  }).catch(function (e) { clear(wrap); wrap.appendChild(empty(e.message)); });
}

/* ------------------------------- SMEs ------------------------------- */
function viewSmes(main) {
  var pm = isPM();
  main.appendChild(h('.epm-page-head', h('div', h('h1', pm ? 'SME performance' : 'My ratings'),
    h('p.epm-sub', 'X: the content the SME teaches · Y: average rating · one line per cohort.'))));
  var smes = (S.boot.smes || []).filter(function (s) { return s.role === 'SME' || !s.email; });
  var sel = pm ? selectEl([{ value: '', label: 'Choose an SME…' }].concat(smes.map(function (s) { return { value: s.email || s.key, label: s.name }; })), '', { 'aria-label': 'SME' }) : null;
  var out = h('div');
  if (pm) main.appendChild(h('.epm-toolbar', sel));
  main.appendChild(out);
  function load(v) {
    clear(out);
    if (!v) { out.appendChild(empty('Choose an SME to see their ratings across cohorts.')); return; }
    out.appendChild(h('.epm-loading', 'Loading…'));
    api('sme.performance', { sme: v }).then(function (r) {
      clear(out);
      var draw = function (title, data, min, max, note) {
        if (!data.lines.length) { out.appendChild(h('.epm-card', h('h3', title), empty(pm ? 'No ratings for this SME yet.' : 'No ratings shared with you yet.'))); return; }
        var series = data.lines.map(function (l) { return { name: l.cohort, values: l.points.map(function (p) { return p ? p.v : null; }) }; });
        var lo = Math.min.apply(null, series.reduce(function (a, s) { return a.concat(s.values.filter(function (v) { return v != null; })); }, []));
        out.appendChild(h('.epm-card', lineChart({ title: title, x: data.x, series: series, yMin: Math.min(min, Math.floor(lo)), yMax: max, yFmt: function (v) { return Number(v).toFixed(1); },
          xShort: function (lab, i) { return String(i + 1); }, height: 280 }),
          h('ol.epm-xkey', data.x.map(function (x) { return h('li', x); })), note ? h('p.epm-small.epm-muted', note) : null));
      };
      draw('Session feedback (1–5) by module', r.weekly, 3, 5, 'Average of the 5 questions of the end-of-session survey, for sessions this SME taught.');
      draw('Module feedback (1–10) by block', r.module, 6, 10);
    }).catch(function (e) { clear(out); out.appendChild(empty(e.message)); });
  }
  if (pm) sel.addEventListener('change', function () { load(sel.value); }); else load(S.user.email);
  if (pm) load('');
}

/* ------------------------------- TEAM ------------------------------- */
function viewTeam(main) {
  var users = (S.boot.users || []).slice().sort(function (a, b) { return (a.role + a.name).localeCompare(b.role + b.name); });
  main.appendChild(h('.epm-page-head', h('div', h('h1', 'Team'), h('p.epm-sub', 'Program Managers manage everything. SMEs see the cohorts where they teach; feedback only where you allow it.')),
    h('.epm-actions', btn('Invite person', { icon: 'plus', kind: 'primary' }, function () { userModal({}); }))));
  main.appendChild(h('.epm-table-wrap', h('table.epm-table.epm-table-click', h('thead', h('tr', ['Name', 'Email', 'Role', 'Status', 'Last sign-in'].map(function (x) { return h('th', x); }))),
    h('tbody', users.map(function (u) {
      return h('tr', { tabindex: '0', onclick: function () { userModal(u); }, onkeydown: function (e) { if (e.key === 'Enter') userModal(u); } },
        h('td', h('b', u.name || '—')), h('td', u.email), h('td', badge(u.role === 'PM' ? 'Program Manager' : 'SME', u.role === 'PM' ? 'dark' : 'info')),
        h('td', u.active ? badge('Active', 'good') : badge('Disabled', 'muted')), h('td.epm-small', u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : 'never'));
    })))));
  var unlinked = (S.boot.smes || []).filter(function (s) { return !s.email; });
  if (unlinked.length) main.appendChild(h('.epm-card.epm-card-flat', h('h4', 'SME names from imported sheets without an account'),
    h('p.epm-small.epm-muted', 'Invite them and choose their name under “Link imported name”, so their past blocks and ratings are attached to their account.'),
    h('p', unlinked.map(function (s) { return badge(s.name, 'muted'); }))));
}
function userModal(u) {
  var isNew = !u.email;
  var email = inputEl(u.email, { type: 'email', placeholder: 'name@adizes.com', disabled: !isNew });
  var name = inputEl(u.name), role = selectEl([{ value: 'SME', label: 'SME' }, { value: 'PM', label: 'Program Manager' }], u.role || 'SME');
  var active = h('input', { type: 'checkbox', checked: u.active !== false });
  var claim = selectEl([{ value: '', label: '—' }].concat((S.boot.smes || []).filter(function (s) { return !s.email; }).map(function (s) { return { value: s.name, label: s.name }; })), '');
  var m = modal(isNew ? 'Invite person' : 'Edit ' + (u.name || u.email), [field('Email (@adizes.com)', email), field('Name', name), field('Role', role),
    field('Link imported name', claim, 'Attaches blocks and ratings recorded under this name to this account.'),
    !isNew ? h('label.epm-check', active, h('span', 'Active (can sign in)')) : h('p.epm-small.epm-muted', 'They receive an email with the link to sign in.')], {
    footer: [btn('Cancel', { kind: 'ghost' }, function () { m.close(); }), btn(isNew ? 'Invite' : 'Save', { kind: 'primary' }, function () {
      api('users.save', { user: { email: email.value, name: name.value, role: role.value, active: active.checked }, claimName: claim.value }).then(function () {
        m.close(); toast(isNew ? 'Invitation sent' : 'Saved'); S.cohorts = {}; refreshBoot().then(render);
      }).catch(fail);
    })],
  });
}

/* ------------------------------- SETTINGS ------------------------------- */
function viewSettings(main) {
  var st = S.boot.settings, I = S.boot.integrations;
  main.appendChild(h('.epm-page-head', h('div', h('h1', 'Settings'))));
  var F = {
    presentThresholdPct: inputEl(st.presentThresholdPct, { type: 'number', min: '0', max: '100' }), riskAttendancePct: inputEl(st.riskAttendancePct, { type: 'number', min: '0', max: '100' }),
    riskLmsGapPct: inputEl(st.riskLmsGapPct, { type: 'number', min: '0', max: '100' }),
    typeformModuleFormId_en: inputEl(st.typeformModuleFormId_en, { placeholder: 'e.g. aBcD1234' }), typeformModuleFormId_es: inputEl(st.typeformModuleFormId_es),
  };
  main.appendChild(h('.epm-card', h('h3', 'Rules'),
    h('.epm-row3', field('Zoom: Present from (% of the session)', F.presentThresholdPct), field('At risk below attendance (%)', F.riskAttendancePct), field('At risk when LMS is behind by (points)', F.riskLmsGapPct)),
    h('h3', 'Typeform · Module feedback form'),
    h('p.epm-small.epm-muted', 'The form must have the hidden fields email, name, cohort and module. A cohort can override the form in its own settings.'),
    h('.epm-row2', field('Form ID (English cohorts)', F.typeformModuleFormId_en), field('Form ID (Spanish cohorts)', F.typeformModuleFormId_es)),
    h('.epm-actions', btn('Save settings', { kind: 'primary' }, function () {
      var p = {}; Object.keys(F).forEach(function (k) { p[k] = F[k].value; });
      api('settings.save', { settings: p }).then(function (r) { S.boot.settings = r.settings; toast('Saved'); S.cohorts = {}; }).catch(fail);
    }))));
  main.appendChild(h('.epm-card', h('h3', 'Integrations'),
    h('ul.epm-int', h('li', I.teachable ? badge('Connected', 'good') : badge('Not configured', 'bad'), ' Teachable — progress syncs every night for Active cohorts, or from each cohort’s LMS tab.'),
      h('li', I.typeform ? badge('Connected', 'good') : badge('Not configured', 'bad'), ' Typeform — responses are pulled every night. Last pull: ' + (st.typeformLastSync ? fmtDateTime(st.typeformLastSync) : 'never'),
        I.typeform ? h('span', ' ', btn('Pull now', { icon: 'sync', kind: 'ghost' }, function () { api('typeform.sync', {}).then(function (r) { toast(r.imported + ' new responses'); S.cohorts = {}; }).catch(fail); })) : null)),
    h('p.epm-small.epm-muted', 'Keys are stored in the Apps Script project (Project Settings → Script Properties), never in this page.')));
  // import
  var files = h('input', { type: 'file', accept: '.json,application/json', multiple: true });
  var replace = h('input', { type: 'checkbox' });
  var log = h('ul.epm-log');
  main.appendChild(h('.epm-card', h('h3', 'Import from the old Matrix sheets'),
    h('p.epm-small.epm-muted', 'Upload the .json files generated from each “Cohort X – Matrix” with tools/migrate.py. One cohort per file.'),
    h('.epm-row2', files, h('label.epm-check', replace, h('span', 'Replace a cohort with the same name'))),
    h('.epm-actions', btn('Import', { icon: 'upload', kind: 'primary' }, function () {
      var list = Array.prototype.slice.call(files.files);
      if (!list.length) return toast('Choose the JSON files', 'error');
      var chain = Promise.resolve();
      list.forEach(function (f) {
        chain = chain.then(function () { return f.text(); }).then(function (txt) {
          var data = JSON.parse(txt);
          log.appendChild(h('li', 'Importing ' + (data.cohort && data.cohort.name) + '…'));
          return api('import.cohort', { data: data, replace: replace.checked }).then(function (r) {
            log.lastChild.textContent = '✓ ' + data.cohort.name + ': ' + Object.keys(r.counts).map(function (k) { return r.counts[k] + ' ' + k; }).join(', ');
          });
        }).catch(function (e) { log.appendChild(h('li.epm-t-low', '✗ ' + f.name + ': ' + e.message)); });
      });
      chain.then(function () { S.cohorts = {}; refreshBoot(); toast('Import finished'); });
    })), log));
}

/* ---- learner.js ---- */
/* ===================================================================================
 * LEARNER FORM — personal link (?t=…): profile + goals & intentions, in the cohort language
 * =================================================================================== */
var LT = {
  en: {
    title: 'Your participant profile', intro: 'Help us prepare your experience in the Adizes Executive Program. It takes about 10 minutes; you can come back to this link to update your answers.',
    about: 'About you', first: 'First name', last: 'Last name', email: 'Email', company: 'Company', job: 'Job title', profile: 'Which describes you best?', profileHint: 'Choose all that apply.',
    birthday: 'Birthday', phone: 'Phone (WhatsApp)', linkedin: 'LinkedIn profile', address: 'Mailing address for your welcome kit', addressHint: 'Street, number, city, postal code, country.',
    goals: 'Goals and intentions', save: 'Save my profile', saving: 'Saving…', done: 'Thank you! Your profile is saved.', doneSub: 'You can open this link again any time to update it.',
    again: 'Edit my answers', required: 'Please write your first name.', updated: 'Last updated', loading: 'Loading…', cohort: 'Cohort',
  },
  es: {
    title: 'Tu perfil de participante', intro: 'Ayúdanos a preparar tu experiencia en el Adizes Executive Program. Toma unos 10 minutos; puedes volver a este enlace para actualizar tus respuestas.',
    about: 'Sobre ti', first: 'Nombre', last: 'Apellidos', email: 'Correo', company: 'Empresa', job: 'Puesto', profile: '¿Qué te describe mejor?', profileHint: 'Elige todas las que apliquen.',
    birthday: 'Fecha de nacimiento', phone: 'Teléfono (WhatsApp)', linkedin: 'Perfil de LinkedIn', address: 'Dirección de envío para tu kit de bienvenida', addressHint: 'Calle, número, ciudad, código postal y país.',
    goals: 'Objetivos e intenciones', save: 'Guardar mi perfil', saving: 'Guardando…', done: '¡Gracias! Tu perfil quedó guardado.', doneSub: 'Puedes abrir este enlace cuando quieras para actualizarlo.',
    again: 'Editar mis respuestas', required: 'Escribe tu nombre, por favor.', updated: 'Última actualización', loading: 'Cargando…', cohort: 'Generación',
  },
};
var PROFILE_ES = { 'Senior Executive': 'Alta dirección', 'Startup Founder': 'Fundador(a) de startup', 'Board Member': 'Miembro de consejo', 'Consultant': 'Consultor(a)', 'Scholar': 'Académico(a)', 'Independent Professionals': 'Profesional independiente', 'HR Manager': 'Recursos Humanos' };

function learnerApp(root) {
  var t = new URLSearchParams(location.search).get('t') || (location.hash.match(/t=([^&]+)/) || [])[1] || '';
  clear(root).appendChild(h('.epm-lf', h('.epm-loading.epm-center', '…')));
  api('learner.get', { t: t }, { noToken: true }).then(function (d) { learnerForm(root, d, t); })
    .catch(function (e) { clear(root).appendChild(h('.epm-lf', h('.epm-lf-card', h('.epm-lf-head', h('img', { src: (CFG.assets || ASSETS) + 'adizes-logo-white.png', alt: 'Adizes', width: '110' })), h('.epm-lf-body', h('p', e.message))))); });
}

function learnerForm(root, d, token) {
  var L = LT[d.lang] || LT.en, p = d.profile || {};
  var F = {
    firstName: inputEl(p.firstName, { autocomplete: 'given-name', required: true }), lastName: inputEl(p.lastName, { autocomplete: 'family-name' }),
    company: inputEl(p.company, { autocomplete: 'organization' }), jobTitle: inputEl(p.jobTitle, { autocomplete: 'organization-title' }),
    birthday: inputEl(p.birthday, { type: 'date', autocomplete: 'bday' }), phone: inputEl(p.phone, { type: 'tel', autocomplete: 'tel' }),
    linkedin: inputEl(p.linkedin, { type: 'url', placeholder: 'https://www.linkedin.com/in/…' }), address: textareaEl(p.address, { rows: 2, autocomplete: 'street-address' }),
  };
  var prof = h('.epm-checks', d.profileOptions.map(function (o) { return h('label.epm-check', h('input', { type: 'checkbox', value: o, checked: (p.profile || []).indexOf(o) >= 0 }), h('span', d.lang === 'es' ? (PROFILE_ES[o] || o) : o)); }));
  var goals = d.questions.map(function (q, i) { return textareaEl(d.goals[i], { rows: 3 }); });
  var msg = h('p.epm-lf-msg', { role: 'status' });
  var form = h('form.epm-lf-form', { onsubmit: submit },
    h('h2', L.about),
    h('.epm-row2', field(L.first, F.firstName), field(L.last, F.lastName)),
    field(L.email, inputEl(p.email, { disabled: true })),
    h('.epm-row2', field(L.company, F.company), field(L.job, F.jobTitle)),
    field(L.profile, prof, L.profileHint),
    h('.epm-row2', field(L.birthday, F.birthday), field(L.phone, F.phone)),
    field(L.linkedin, F.linkedin), field(L.address, F.address, L.addressHint),
    h('h2', L.goals),
    d.questions.map(function (q, i) { return field((i + 1) + '. ' + q, goals[i]); }),
    msg,
    h('button.epm-btn.epm-btn-primary.epm-btn-lg', { type: 'submit' }, L.save));
  var card = h('.epm-lf-card',
    h('.epm-lf-head', h('img', { src: (CFG.assets || ASSETS) + 'adizes-logo-white.png', alt: 'Adizes Institute', width: '110', height: '37' }), h('span', 'Adizes Executive Program')),
    h('.epm-lf-body', h('h1', L.title), d.cohort ? h('p.epm-muted', L.cohort + ': ' + d.cohort) : null, h('p', L.intro),
      d.submittedAt ? h('p.epm-small.epm-muted', L.updated + ': ' + new Date(d.submittedAt).toLocaleDateString(d.lang)) : null, form));
  clear(root).appendChild(h('.epm-lf', card));
  document.documentElement.lang = d.lang;
  function submit(e) {
    e.preventDefault();
    if (!F.firstName.value.trim()) { msg.textContent = L.required; F.firstName.focus(); return; }
    var btnEl = form.querySelector('button[type=submit]'); btnEl.disabled = true; btnEl.textContent = L.saving; msg.textContent = '';
    var profile = {}; Object.keys(F).forEach(function (k) { profile[k] = F[k].value; });
    profile.profile = Array.prototype.slice.call(prof.querySelectorAll('input:checked')).map(function (i) { return i.value; });
    api('learner.save', { t: token, profile: profile, goals: goals.map(function (g) { return g.value; }) }, { noToken: true }).then(function () {
      clear(card.lastChild).appendChild(h('.epm-lf-done', h('.epm-lf-check', icon('check', 28)), h('h1', L.done), h('p', L.doneSub),
        h('button.epm-btn.epm-btn-ghost', { type: 'button', onclick: function () { learnerApp(root); } }, L.again)));
      window.scrollTo(0, 0);
    }).catch(function (err) { msg.textContent = err.message; btnEl.disabled = false; btnEl.textContent = L.save; });
  }
}

/* ---- main.js ---- */
/* ===================================================================================
 * BOOT — mounts on <div id="epm-app">. window.EPM_CONFIG = { endpoint, mode: 'staff' | 'learner' }
 * =================================================================================== */
var ASSETS = 'https://cdn.jsdelivr.net/gh/Adizes/exec-program-manager@v' + VERSION + '/assets/';

function injectStyles() {
  if (document.getElementById('epm-styles')) return;
  var st = document.createElement('style'); st.id = 'epm-styles'; st.textContent = ".epm-root {\n--red: #d7141a; --red-d: #b00f14; --red-soft: #fdecec;\n--ink: #141414; --ink-2: #3a3a3a; --muted: #6e6e6e; --line: #e5e5e3; --line-2: #f0f0ee;\n--bg: #f6f6f4; --white: #ffffff; --black: #111111;\n--good: #1d7a35; --good-bg: #e6f3e9; --mid: #8a5a00; --mid-bg: #fff3d6; --low: #b3141a; --low-bg: #fbe6e6;\n--info: #1f5fae; --info-bg: #e7effa; --violet: #5b3fb8; --violet-bg: #eeeafb;\n--r: 8px; --shadow: 0 1px 2px rgba(0,0,0,.05), 0 6px 20px rgba(0,0,0,.06);\nfont-family: Montserrat, system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;\nfont-size: 14px; line-height: 1.5; color: var(--ink); background: var(--bg);\nmin-height: 100vh; text-align: left; -webkit-font-smoothing: antialiased; position: relative;\n}\n.epm-root *, .epm-root *::before, .epm-root *::after { box-sizing: border-box; }\n.epm-root :where(h1, h2, h3, h4) { font-family: inherit; color: var(--ink); margin: 0; letter-spacing: -0.01em; line-height: 1.25; text-transform: none; }\n.epm-root :where(h1) { font-size: 26px; font-weight: 800; }\n.epm-root :where(h2) { font-size: 18px; font-weight: 700; }\n.epm-root :where(h3) { font-size: 15px; font-weight: 700; }\n.epm-root :where(h4) { font-size: 13px; font-weight: 700; margin: 14px 0 6px; }\n.epm-root :where(p) { margin: 0 0 8px; font-size: inherit; }\n.epm-root :where(a) { color: inherit; text-decoration: none; }\n.epm-root :where(img) { max-width: 100%; display: block; }\n.epm-root :where(button, input, select, textarea) { font: inherit; color: inherit; letter-spacing: normal; text-transform: none; margin: 0; border-radius: 0; }\n.epm-root :where(label) { display: inline; font-weight: inherit; margin: 0; }\n.epm-root :where(ul, ol) { margin: 0; padding: 0; }\n.epm-root :where(table) { font-size: inherit; }\n.epm-root [hidden] { display: none !important; }\n.epm-root :focus-visible { outline: 2px solid var(--red); outline-offset: 2px; }\n.epm-progress { position: fixed; top: 0; left: 0; right: 0; height: 3px; z-index: 100; background: transparent; overflow: hidden; pointer-events: none; }\n.epm-progress.on::after { content: ''; position: absolute; left: -40%; width: 40%; height: 100%; background: var(--red); animation: epm-load 1s ease-in-out infinite; }\n@keyframes epm-load { to { left: 100%; } }\n.epm-top { background: var(--black); color: #fff; display: flex; align-items: center; gap: 24px; padding: 0 24px; height: 60px; border-bottom: 3px solid var(--red); position: sticky; top: 0; z-index: 20; }\n.epm-brand { display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 14px; color: #fff !important; white-space: nowrap; }\n.epm-brand img { height: 26px; width: auto; }\n.epm-brand span { border-left: 1px solid #444; padding-left: 12px; }\n.epm-nav { display: flex; gap: 2px; flex: 1; overflow-x: auto; scrollbar-width: none; }\n.epm-nav a { color: #c9c9c9 !important; padding: 8px 12px; border-radius: 6px; font-weight: 600; font-size: 13px; white-space: nowrap; }\n.epm-nav a:hover { color: #fff !important; background: #222; }\n.epm-nav a.on { color: #fff !important; background: #262626; box-shadow: inset 0 -2px 0 var(--red); }\n.epm-me { display: flex; align-items: center; gap: 8px; }\n.epm-me-name { display: flex; flex-direction: column; align-items: flex-end; font-size: 12px; font-weight: 600; line-height: 1.2; }\n.epm-me-name small { color: #9a9a9a; font-weight: 500; }\n.epm-main { max-width: 1280px; margin: 0 auto; padding: 28px 24px 80px; }\n.epm-page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }\n.epm-sub { color: var(--muted); margin: 4px 0 0 !important; }\n.epm-crumb { display: inline-flex; align-items: center; gap: 4px; color: var(--muted) !important; font-size: 12px; font-weight: 600; margin-bottom: 6px; }\n.epm-crumb:hover { color: var(--red) !important; }\n.epm-h2 { margin: 26px 0 12px !important; font-size: 13px !important; text-transform: uppercase !important; letter-spacing: .08em !important; color: var(--muted) !important; }\n.epm-h3 { margin: 22px 0 10px !important; }\n.epm-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--line); background: var(--white); color: var(--ink); font-weight: 600; font-size: 13px; cursor: pointer; white-space: nowrap; transition: background .15s, border-color .15s, color .15s; }\n.epm-btn:hover { border-color: #cfcfcc; background: #fafafa; }\n.epm-btn:disabled { opacity: .5; cursor: not-allowed; }\n.epm-btn-primary { background: var(--red); border-color: var(--red); color: #fff; }\n.epm-btn-primary:hover { background: var(--red-d); border-color: var(--red-d); }\n.epm-btn-ghost { background: transparent; border-color: transparent; }\n.epm-btn-ghost:hover { background: var(--line-2); border-color: transparent; }\n.epm-btn-ghost-inv { background: transparent; border-color: transparent; color: #ddd; }\n.epm-btn-ghost-inv:hover { background: #262626; color: #fff; border-color: transparent; }\n.epm-btn-danger { background: var(--low); border-color: var(--low); color: #fff; }\n.epm-btn-danger-ghost { background: transparent; border-color: transparent; color: var(--low); }\n.epm-btn-danger-ghost:hover { background: var(--low-bg); }\n.epm-btn-block { width: 100%; min-height: 44px; }\n.epm-btn-lg { min-height: 48px; padding: 0 24px; font-size: 15px; }\n.epm-btn .epm-ic { flex: none; }\n.epm-pulse { box-shadow: 0 0 0 4px rgba(215,20,26,.18); }\n.epm-link { background: none; border: 0; padding: 0; color: var(--red) !important; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }\n.epm-link:hover { text-decoration: underline; }\n.epm-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 8px; }\n.epm-page-head .epm-actions { margin-top: 0; }\n.epm-spacer { flex: 1; }\n.epm-card { background: var(--white); border: 1px solid var(--line); border-radius: var(--r); padding: 18px 20px; margin-bottom: 16px; }\n.epm-card > h3 { margin-bottom: 12px; }\n.epm-card-flat { background: var(--bg); border-style: dashed; margin-top: 16px; }\n.epm-card-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }\n.epm-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }\n.epm-ccard { display: block; background: var(--white); border: 1px solid var(--line); border-radius: var(--r); padding: 18px; transition: border-color .15s, box-shadow .15s, transform .15s; }\n.epm-ccard:hover { border-color: #cfcfcc; box-shadow: var(--shadow); transform: translateY(-1px); }\n.epm-ccard-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 2px; }\n.epm-ccard-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; border-top: 1px solid var(--line-2); padding-top: 12px; margin-top: 10px; }\n.epm-ccard-kpis div { display: flex; flex-direction: column; }\n.epm-ccard-kpis b { font-size: 16px; font-weight: 700; }\n.epm-ccard-kpis span { font-size: 11px; color: var(--muted); }\n.epm-progressbar { height: 4px; border-radius: 2px; background: var(--line-2); margin: 12px 0 4px; overflow: hidden; }\n.epm-progressbar i { display: block; height: 100%; background: var(--black); }\n.epm-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }\n.epm-grid2 > .epm-card { margin-bottom: 0; }\n.epm-grid2 { margin-bottom: 16px; }\n.epm-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px; }\n.epm-kpi { background: var(--white); border: 1px solid var(--line); border-radius: var(--r); padding: 14px 16px; position: relative; overflow: hidden; }\n.epm-kpi::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--line); }\n.epm-kpi-good::before { background: var(--good); } .epm-kpi-mid::before { background: #e3a008; } .epm-kpi-low::before { background: var(--low); }\n.epm-kpi-v { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; }\n.epm-kpi-l { font-size: 12px; font-weight: 600; color: var(--ink-2); margin-top: 4px; }\n.epm-kpi-s { font-size: 11px; color: var(--muted); }\n.epm-next-date { font-size: 22px; font-weight: 800; margin-bottom: 4px; }\n.epm-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--line); margin-bottom: 18px; overflow-x: auto; scrollbar-width: thin; }\n.epm-tab { padding: 10px 14px; font-weight: 600; font-size: 13px; color: var(--muted) !important; border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap; }\n.epm-tab:hover { color: var(--ink) !important; }\n.epm-tab.on { color: var(--ink) !important; border-bottom-color: var(--red); }\n.epm-subtabs { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }\n.epm-subtabs a { padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); font-weight: 600; font-size: 12px; color: var(--ink-2) !important; background: var(--white); cursor: pointer; }\n.epm-subtabs a.on { background: var(--black); border-color: var(--black); color: #fff !important; }\n.epm-toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }\n.epm-toolbar .epm-input { width: auto; min-width: 180px; }\n.epm-toolbar p { margin: 0; }\n.epm-table-wrap { overflow-x: auto; background: var(--white); border: 1px solid var(--line); border-radius: var(--r); margin-bottom: 12px; max-width: 100%; }\n.epm-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }\n.epm-table th { text-align: left; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); padding: 10px 12px; border-bottom: 1px solid var(--line); background: #fbfbfa; white-space: nowrap; position: sticky; top: 0; z-index: 1; }\n.epm-table td { padding: 10px 12px; border-bottom: 1px solid var(--line-2); vertical-align: top; }\n.epm-table tbody tr:last-child td { border-bottom: 0; }\n.epm-table .num { text-align: right; white-space: nowrap; }\n.epm-table-sm td, .epm-table-sm th { padding: 7px 10px; }\n.epm-table-click tbody tr { cursor: pointer; }\n.epm-table-click tbody tr:hover td { background: #fafaf8; }\n.epm-table tr.epm-clickable { cursor: pointer; }\n.epm-table tr.epm-clickable:hover td { background: #fafaf8; }\n.epm-table tr.epm-dim td { opacity: .55; }\n.epm-table tfoot td { font-weight: 700; border-top: 1px solid var(--line); background: #fbfbfa; }\n.epm-sticky { position: sticky; left: 0; background: var(--white); z-index: 2; min-width: 170px; }\nth.epm-sticky { background: #fbfbfa; z-index: 3; }\n.epm-nowrap { white-space: nowrap; }\n.epm-small { font-size: 12px; }\n.epm-muted { color: var(--muted); }\n.epm-pct { display: inline-block; min-width: 48px; text-align: center; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 12px; }\n.epm-t-good { color: var(--good); } .epm-t-mid { color: var(--mid); } .epm-t-low { color: var(--low); } .epm-t-none { color: var(--muted); }\n.epm-pct.epm-t-good { background: var(--good-bg); } .epm-pct.epm-t-mid { background: var(--mid-bg); } .epm-pct.epm-t-low { background: var(--low-bg); }\n.epm-badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; line-height: 1.5; background: var(--line-2); color: var(--ink-2); white-space: nowrap; margin: 1px 2px 1px 0; vertical-align: middle; }\n.epm-badge-good { background: var(--good-bg); color: var(--good); } .epm-badge-bad { background: var(--low-bg); color: var(--low); }\n.epm-badge-mid { background: var(--mid-bg); color: var(--mid); } .epm-badge-info { background: var(--info-bg); color: var(--info); }\n.epm-badge-violet { background: var(--violet-bg); color: var(--violet); } .epm-badge-dark { background: var(--black); color: #fff; }\n.epm-chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; font-size: 12px; font-weight: 600; margin: 2px 4px 2px 0; }\n.epm-chip:hover { border-color: var(--red); }\n.epm-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: var(--muted); }\n.epm-dot-good { background: var(--good); } .epm-dot-bad { background: var(--low); } .epm-dot-info { background: var(--info); } .epm-dot-violet { background: var(--violet); } .epm-dot-dark { background: var(--black); }\n.epm-att-wrap { max-height: 70vh; }\n.epm-att-table th, .epm-att-table td { padding: 0; }\n.epm-att-table td.epm-sticky, .epm-att-table th.epm-sticky { padding: 6px 10px; }\n.epm-att-table td.num, .epm-att-table th.num { padding: 6px 8px; }\n.epm-att-h { text-align: center !important; min-width: 44px; font-size: 10px !important; letter-spacing: 0 !important; top: 33px !important; }\n.epm-att-h small { display: block; color: var(--ink-2); font-weight: 600; }\n.epm-att-hb { border: 0; background: none; padding: 6px 2px; cursor: pointer; width: 100%; font-weight: 700; color: inherit; font-size: 10px; text-transform: uppercase; }\n.epm-att-hb:hover { color: var(--red); }\n.epm-group { text-align: center !important; border-left: 1px solid var(--line); background: #f3f3f1 !important; color: var(--ink) !important; padding: 6px 4px !important; }\n.epm-att { text-align: center; border-left: 1px solid var(--line-2); }\n.epm-att button, .epm-att span { width: 100%; min-height: 34px; border: 0; background: transparent; cursor: pointer; font-weight: 700; font-size: 12px; color: #b5b5b5; display: block; line-height: 34px; }\n.epm-att.p { background: var(--good-bg); } .epm-att.p button, .epm-att.p span { color: var(--good); }\n.epm-att.a { background: var(--low-bg); } .epm-att.a button, .epm-att.a span { color: var(--low); }\n.epm-att button:hover { box-shadow: inset 0 0 0 2px var(--ink); }\n.epm-block { padding: 0; overflow: hidden; }\n.epm-block .epm-table-wrap { border: 0; border-radius: 0; margin: 0; }\n.epm-block-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); background: #fbfbfa; flex-wrap: wrap; }\n.epm-block-no { display: inline-block; min-width: 28px; margin-right: 8px; padding: 1px 6px; border-radius: 4px; background: var(--black); color: #fff; font-size: 12px; font-weight: 700; text-align: center; }\n.epm-block-no:empty { display: none; }\ntr.epm-done td:first-child { color: var(--muted); }\n.epm-cal { table-layout: fixed; min-width: 760px; }\n.epm-cal td { overflow-wrap: anywhere; }\n.epm-rec { margin-right: 10px; }\ntr.epm-break td { background: repeating-linear-gradient(135deg, #fafaf8, #fafaf8 6px, #f2f2ef 6px, #f2f2ef 12px); color: var(--muted); font-size: 12px; font-weight: 600; text-align: center; }\n.epm-chart { position: relative; }\n.epm-chart-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }\n.epm-chart-head h4 { margin: 0; font-size: 14px; }\n.epm-chart-body { position: relative; }\n.epm-svg { display: block; width: 100%; height: auto; overflow: visible; }\n.epm-grid { stroke: #ececea; stroke-width: 1; }\n.epm-axis { fill: var(--muted); font-size: 11px; font-family: inherit; }\n.epm-cross { stroke: #9a9a9a; stroke-width: 1; stroke-dasharray: 3 3; }\n.epm-tip { position: absolute; display: none; background: var(--black); color: #fff; padding: 8px 10px; border-radius: 6px; font-size: 12px; pointer-events: none; min-width: 140px; max-width: 260px; z-index: 5; box-shadow: var(--shadow); }\n.epm-tip-t { color: #bbb; margin-bottom: 4px; font-size: 11px; }\n.epm-tip-r { display: flex; align-items: center; gap: 6px; }\n.epm-tip-r i { width: 12px; height: 2px; display: inline-block; }\n.epm-tip-r b { font-weight: 700; }\n.epm-tip-r span { color: #ccc; }\n.epm-legend { display: flex; flex-wrap: wrap; gap: 12px; margin: 0 0 8px; font-size: 12px; color: var(--ink-2); }\n.epm-legend-i { display: inline-flex; align-items: center; gap: 6px; }\n.epm-legend-i i { width: 14px; height: 2px; display: inline-block; border-radius: 1px; }\n.epm-bars { display: flex; flex-direction: column; gap: 6px; }\n.epm-bar-row { display: grid; grid-template-columns: minmax(120px, 34%) 1fr 90px; gap: 10px; align-items: center; font-size: 12px; }\n.epm-bar-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.epm-bar-track { height: 12px; background: var(--line-2); border-radius: 0 4px 4px 0; overflow: hidden; }\n.epm-bar-fill { height: 100%; border-radius: 0 4px 4px 0; }\n.epm-bar-val { font-weight: 700; }\n.epm-bar-val small { color: var(--muted); font-weight: 500; }\n.epm-xkey { columns: 2; column-gap: 24px; padding-left: 20px !important; font-size: 12px; color: var(--ink-2); margin-top: 10px !important; }\n.epm-xkey li { margin-bottom: 2px; break-inside: avoid; }\n.epm-risk { list-style: none; }\n.epm-risk li { display: flex; justify-content: space-between; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--line-2); font-size: 13px; flex-wrap: wrap; }\n.epm-risk a { font-weight: 600; } .epm-risk a:hover { color: var(--red); }\n.epm-timeline { list-style: none; margin-top: 12px !important; }\n.epm-timeline li { display: grid; grid-template-columns: 74px 1fr auto; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line-2); font-size: 13px; align-items: start; }\n.epm-tl-date { color: var(--muted); font-size: 12px; font-weight: 600; }\n.epm-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; min-width: 0; }\n.epm-label { font-size: 12px; font-weight: 600; color: var(--ink-2); }\n.epm-hint { font-size: 11px; color: var(--muted); }\n.epm-input { width: 100%; min-height: 38px; padding: 8px 10px; border: 1px solid #d6d6d2; border-radius: 6px; background: var(--white); font-size: 14px; color: var(--ink); margin: 0; box-shadow: none; }\ntextarea.epm-input { resize: vertical; min-height: 60px; line-height: 1.45; }\n.epm-input:focus { outline: none; border-color: var(--ink); box-shadow: 0 0 0 3px rgba(17,17,17,.08); }\n.epm-input:disabled, .epm-input[readonly] { background: #f4f4f2; color: var(--ink-2); }\nselect.epm-input { padding-right: 28px; }\n.epm-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }\n.epm-row3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; align-items: start; }\n.epm-row4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }\n.epm-checks { display: flex; flex-wrap: wrap; gap: 6px 14px; }\n.epm-check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; margin: 0; font-weight: 500; }\n.epm-check input { width: 16px; height: 16px; accent-color: var(--red); margin: 0; }\n.epm-scale { display: flex; flex-wrap: wrap; gap: 4px; }\n.epm-scale-b { width: 38px; height: 34px; border: 1px solid #d6d6d2; border-radius: 6px; background: var(--white); cursor: pointer; font-weight: 700; }\n.epm-scale-b.on { background: var(--black); border-color: var(--black); color: #fff; }\n.epm-stack { display: flex; flex-direction: column; gap: 8px; }\n.epm-rows { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }\n.epm-row3 > .epm-btn { align-self: center; }\n.epm-rows .epm-row3 { grid-template-columns: 1.4fr 1fr 1fr auto; }\n.epm-picker { border: 1px solid var(--line); border-radius: 6px; padding: 10px; }\n.epm-picker-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px; max-height: 200px; overflow: auto; margin-top: 8px; }\n.epm-check-all { padding-bottom: 6px; border-bottom: 1px solid var(--line-2); width: 100%; }\n.epm-p { margin-bottom: 12px !important; }\n.epm-sblock { border: 1px solid var(--line); border-radius: 6px; margin-bottom: 10px; overflow: hidden; }\n.epm-sblock-head { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding: 10px; background: #f7f7f5; border-bottom: 1px solid var(--line); }\n.epm-sblock-head .epm-input { width: auto; }\n.epm-sblock-head .epm-input[aria-label=\"Title\"] { flex: 1; min-width: 200px; }\n.epm-sblock-btns { display: flex; margin-left: auto; }\n.epm-srows { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }\n.epm-srow { display: grid; grid-template-columns: 150px 70px 1fr 180px auto; gap: 6px; align-items: center; }\n.epm-srow .epm-input { min-height: 34px; padding: 5px 8px; font-size: 13px; }\n.epm-danger-zone { border-color: #f1c4c5; }\n.epm-overlay { position: fixed; inset: 0; background: rgba(17,17,17,.45); z-index: 1000; display: flex; align-items: flex-start; justify-content: center; padding: 6vh 16px; overflow-y: auto; animation: epm-fade .15s; }\n.epm-overlay-drawer { justify-content: flex-end; padding: 0; align-items: stretch; }\n@keyframes epm-fade { from { opacity: 0; } }\n.epm-modal { background: var(--white); border-radius: 10px; width: 100%; max-width: 560px; box-shadow: 0 20px 60px rgba(0,0,0,.25); display: flex; flex-direction: column; max-height: none; font-family: Montserrat, system-ui, sans-serif; font-size: 14px; color: var(--ink); }\n.epm-modal-wide { max-width: 880px; }\n.epm-drawer { max-width: 720px; border-radius: 0; min-height: 100vh; animation: epm-slide .2s ease-out; }\n@keyframes epm-slide { from { transform: translateX(40px); opacity: 0; } }\n.epm-modal-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 16px 20px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--white); z-index: 2; border-radius: 10px 10px 0 0; }\n.epm-modal-head h3 { font-size: 17px; font-weight: 800; }\n.epm-modal-body { padding: 18px 20px; }\n.epm-modal-foot { display: flex; gap: 8px; justify-content: flex-end; align-items: center; padding: 14px 20px; border-top: 1px solid var(--line); position: sticky; bottom: 0; background: var(--white); border-radius: 0 0 10px 10px; }\n.epm-drawer-sum { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; font-size: 13px; padding-bottom: 14px; margin-bottom: 14px; border-bottom: 1px solid var(--line-2); }\n.epm-dl { display: grid; grid-template-columns: 120px 1fr; gap: 8px 12px; margin: 0; }\n.epm-dl dt { color: var(--muted); font-size: 12px; font-weight: 600; } .epm-dl dd { margin: 0; }\n.epm-details { background: var(--white); border: 1px solid var(--line); border-radius: var(--r); margin-bottom: 8px; padding: 0 14px; }\n.epm-details summary { padding: 12px 0; cursor: pointer; font-size: 13px; list-style-position: inside; }\n.epm-details[open] summary { border-bottom: 1px solid var(--line-2); margin-bottom: 10px; }\n.epm-details .epm-table-wrap { margin-bottom: 14px; }\n.epm-qa { padding: 6px 0 12px; }\n.epm-q { font-size: 12px; font-weight: 700; color: var(--ink-2); margin-bottom: 2px; }\n.epm-a { white-space: pre-wrap; font-size: 13px; }\n.epm-lms-sec { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin: 8px 0 4px; }\n.epm-lms { list-style: none; margin-bottom: 8px !important; }\n.epm-lms li { display: flex; gap: 8px; padding: 3px 0; font-size: 13px; color: var(--ink-2); }\n.epm-lms li.ok { color: var(--ink); }\n.epm-lms-mark { width: 18px; flex: none; font-weight: 800; color: #bbb; text-align: center; }\n.epm-lms li.ok .epm-lms-mark { color: var(--good); }\n.epm-int { list-style: none; } .epm-int li { padding: 6px 0; }\n.epm-log { list-style: none; margin-top: 10px !important; font-size: 13px; } .epm-log li { padding: 3px 0; }\n.epm-toasts { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; z-index: 2000; align-items: center; width: max-content; max-width: calc(100vw - 32px); }\n.epm-toast { background: var(--black); color: #fff; padding: 10px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; box-shadow: var(--shadow); transition: opacity .3s, transform .3s; max-width: 640px; }\n.epm-toast-error { background: var(--low); }\n.epm-toast.out { opacity: 0; transform: translateY(8px); }\n.epm-empty { text-align: center; padding: 36px 16px; color: var(--muted); background: var(--white); border: 1px dashed var(--line); border-radius: var(--r); }\n.epm-empty p { margin-bottom: 12px !important; }\n.epm-loading { color: var(--muted); padding: 24px 0; font-weight: 600; }\n.epm-center { text-align: center; padding-top: 30vh; }\n.epm-login { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; background: var(--black); background-image: radial-gradient(circle at 15% 20%, #2a2a2a 0, transparent 45%), radial-gradient(circle at 85% 90%, #3a0a0c 0, transparent 40%); }\n.epm-login-card { width: 100%; max-width: 400px; background: var(--white); border-radius: 12px; overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,.4); }\n.epm-login-brand { background: var(--black); padding: 22px 28px; border-bottom: 4px solid var(--red); }\n.epm-login-brand img { height: 34px; width: auto; }\n.epm-login-body { padding: 26px 28px 28px; }\n.epm-login-body h1 { font-size: 22px; margin-bottom: 4px; }\n.epm-login-form { margin-top: 18px; display: flex; flex-direction: column; gap: 6px; }\n.epm-login-form .epm-link { margin-top: 8px; align-self: center; }\n.epm-login-msg { font-size: 13px; color: var(--ink-2); margin-top: 12px !important; min-height: 1em; }\n.epm-learner { background: #ececea; }\n.epm-lf { padding: 32px 16px 64px; }\n.epm-lf-card { max-width: 760px; margin: 0 auto; background: var(--white); border-radius: 12px; overflow: hidden; box-shadow: var(--shadow); }\n.epm-lf-head { background: var(--black); color: #fff; display: flex; align-items: center; gap: 14px; padding: 20px 28px; border-bottom: 4px solid var(--red); font-weight: 700; font-size: 13px; }\n.epm-lf-head img { height: 30px; width: auto; }\n.epm-lf-head span { border-left: 1px solid #444; padding-left: 14px; }\n.epm-lf-body { padding: 30px 28px 34px; }\n.epm-lf-body h1 { font-size: 26px; margin-bottom: 6px; }\n.epm-lf-form h2 { font-size: 13px !important; text-transform: uppercase !important; letter-spacing: .08em !important; color: var(--red) !important; margin: 28px 0 14px !important; padding-top: 18px; border-top: 1px solid var(--line); }\n.epm-lf-form .epm-btn-lg { margin-top: 10px; }\n.epm-lf-msg { color: var(--low); font-weight: 600; min-height: 1em; }\n.epm-lf-done { text-align: center; padding: 30px 0; }\n.epm-lf-check { width: 56px; height: 56px; border-radius: 50%; background: var(--good-bg); color: var(--good); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 14px; }\n@media (max-width: 900px) {\n.epm-grid2 { grid-template-columns: 1fr; }\n.epm-row3, .epm-row4 { grid-template-columns: 1fr 1fr; }\n.epm-srow { grid-template-columns: 1fr 70px; }\n.epm-srow > :nth-child(3), .epm-srow > :nth-child(4) { grid-column: 1 / -1; }\n.epm-brand span { display: none; }\n}\n@media (max-width: 640px) {\n.epm-top { padding: 0 12px; gap: 10px; height: auto; min-height: 56px; flex-wrap: wrap; }\n.epm-nav { order: 3; flex-basis: 100%; padding-bottom: 6px; }\n.epm-me-name { display: none; }\n.epm-me { margin-left: auto; }\n.epm-main { padding: 18px 16px 60px; }\n.epm-root h1 { font-size: 22px; }\n.epm-row2, .epm-row3, .epm-row4, .epm-rows .epm-row3 { grid-template-columns: 1fr; }\n.epm-ccard-kpis { grid-template-columns: repeat(2, 1fr); row-gap: 10px; }\n.epm-bar-row { grid-template-columns: 1fr 70px; }\n.epm-bar-label { grid-column: 1 / -1; }\n.epm-xkey { columns: 1; }\n.epm-timeline li { grid-template-columns: 1fr auto; }\n.epm-tl-date { grid-column: 1 / -1; }\n.epm-lf { padding: 0 0 40px; }\n.epm-lf-card { border-radius: 0; }\n.epm-lf-body { padding: 22px 16px; }\n.epm-lf-head { padding: 16px; }\n.epm-overlay { padding: 0; }\n.epm-modal { border-radius: 0; min-height: 100vh; }\n.epm-modal-foot { flex-wrap: wrap; }\n.epm-sticky { min-width: 130px; }\n.epm-toolbar .epm-input { min-width: 0; flex: 1 1 100%; }\n}";
  document.head.appendChild(st);
  if (!document.querySelector('link[href*="family=Montserrat"]')) {
    var l = document.createElement('link'); l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(l);
  }
}

function boot() {
  var root = document.getElementById(ROOT_ID);
  if (!root) return;
  injectStyles();
  root.classList.add('epm-root');
  if (!CFG.endpoint) { root.appendChild(h('p', 'EPM_CONFIG.endpoint is missing.')); return; }
  if (CFG.mode === 'learner') { root.classList.add('epm-learner'); learnerApp(root); return; }
  var saved = lsGet(LS_KEY);
  if (saved && saved.token) S.token = saved.token;
  window.addEventListener('hashchange', function () { if (S.token && S.boot) render(); });
  render();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

})();
