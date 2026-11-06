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
    kpi('Attendance', pct(K.attendance), 'Average of current learners · ' + M.doneSessions.length + ' of ' + C.sessions.length + ' sessions held', tone(K.attendance)),
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
    series: [
      { name: 'Still in the program', values: held.map(function (s) { return M.sessionRate[s.id].activeRate * 100; }) },
      { name: 'Attended the session', values: held.map(function (s) { return M.sessionRate[s.id].rate * 100; }) }],
    yMin: 0, yMax: 100, yFmt: function (v) { return Math.round(v) + '%'; },
  }), h('p.epm-small.epm-muted', 'Both lines are a share of the ' + M.launch + ' learners enrolled at launch (plus anyone moved in later, from the date they joined). The gap between the lines is people still enrolled who did not attend.')));
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
          h('td', statusBadge(e.status, e)),
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
      h('span.epm-muted', smeLabel(b) ? 'SME: ' + smeLabel(b) : '')));
    var tb = h('tbody');
    ss.forEach(function (s) {
      if (prev && s.date && prev.date && (pd(s.date) - pd(prev.date)) / 864e5 > 10) tb.appendChild(h('tr.epm-break', h('td', { colspan: '5' }, 'Break · ' + Math.round((pd(s.date) - pd(prev.date)) / 864e5 / 7 - 1) + ' week(s) without sessions')));
      if (s.date) prev = s;
      var done = s.date && s.date <= t, rate = M.sessionRate[s.id];
      var recs = String(s.recordingUrl || '').split(/\s+/).filter(function (u) { return /^https?:\/\//.test(u); });
      tb.appendChild(h('tr', { class: (done ? 'epm-done ' : '') + (pm ? 'epm-clickable' : ''), tabindex: pm ? '0' : null, onclick: pm ? function () { sessionModal(ctx, s); } : null, onkeydown: pm ? function (e) { if (e.key === 'Enter') sessionModal(ctx, s); } : null },
        h('td.epm-nowrap', fmtDate(s.date, true)),
        h('td', h('b', s.moduleNo || ''), ' ', s.moduleTitle || '', s.smeEmail || s.smeName ? h('div.epm-small.epm-muted', 'SME: ' + smeLabel(s)) : null),
        h('td.epm-small', s.defreeze ? h('span.epm-defreeze', { title: 'Defreeze question' }, icon('chat', 14), h('span', s.defreeze)) : (done && pm ? h('span.epm-muted', 'No defreeze yet') : '')),
        h('td.epm-nowrap', recs.length ? recs.map(function (u, i) { return h('a.epm-link.epm-rec', { href: u, target: '_blank', rel: 'noopener', onclick: function (e) { e.stopPropagation(); } }, icon('play', 14), recs.length > 1 ? 'Rec ' + (i + 1) : 'Recording'); }) : (done ? h('span.epm-muted.epm-small', 'No recording') : '')),
        h('td.num', rate ? h('span', { title: rate.p + ' of ' + rate.base + ' enrolled learners attended' }, pctCell(rate.rate)) : '')));
    });
    card.appendChild(h('.epm-table-wrap', h('table.epm-table.epm-table-sm.epm-cal', h('colgroup', h('col', { style: { width: '120px' } }), h('col', { style: { width: '36%' } }), h('col'), h('col', { style: { width: '170px' } }), h('col', { style: { width: '96px' } })),
      h('thead', h('tr', h('th', 'Date'), h('th', 'Module'), h('th', 'Defreeze'), h('th', 'Recording'), h('th.num', { title: 'Learners who attended, out of everyone enrolled at that date' }, 'Attendance'))), tb)));
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
    var groups = [], gstart = {};
    sessions.forEach(function (s) { var g = groups[groups.length - 1]; if (!g || g.b !== s.blockId) { groups.push({ b: s.blockId, n: 1 }); gstart[s.id] = 1; } else g.n++; });
    var thead = h('thead',
      h('tr', h('th.epm-sticky', { rowspan: '2' }, 'Learner'), h('th.num', { rowspan: '2' }, 'Total'), groups.map(function (g) { var b = M.block[g.b]; return h('th.epm-group', { colspan: String(g.n), title: b.title }, b.kind === 'course' ? 'C' + b.number : b.title); })),
      h('tr', sessions.map(function (s) {
        var r = M.sessionRate[s.id];
        return h('th.epm-att-h', { class: gstart[s.id] ? 'epm-gstart' : '', title: sessionLabel(s, M) + (r ? ' · ' + r.p + ' of ' + r.base + ' attended' : '') },
          pm ? h('button.epm-att-hb', { type: 'button', onclick: function (e) { columnMenu(e.currentTarget, s); } }, fmtDate(s.date).replace(/ \d\d$/, ''), h('small', s.moduleNo || '')) : [fmtDate(s.date).replace(/ \d\d$/, ''), h('small', s.moduleNo || '')]);
      })));
    var tbody = h('tbody', M.enrollments.map(function (e) {
      var st = M.stats[e.email], inactive = !M.isCounted[e.email];
      return h('tr', { class: inactive ? 'epm-dim' : '' },
        h('td.epm-sticky', h('span', fullName(M.learner[e.email])), NO_LIVE.indexOf(e.status) >= 0 ? h('div.epm-small.epm-muted', e.status + (e.statusDate ? ' · since ' + fmtDate(e.statusDate) : '')) : null),
        h('td.num', pctCell(st.att)),
        sessions.map(function (s) {
          var v = (M.att[e.email] || {})[s.id] || '';
          var gs = gstart[s.id] ? ' epm-gstart' : '';
          var notYet = s.date && M.startOf(e) > s.date;
          if (notYet || !attApplies(e, s.date)) {
            return h('td.epm-att.na', { class: gs, title: notYet ? 'Not in this cohort yet' : 'Not counted: ' + e.status + (e.statusDate ? ' since ' + fmtDate(e.statusDate) : '') }, h('span', '—'));
          }
          var cell = h('td.epm-att', { class: (v === 'Present' ? 'p' : v === 'Absent' ? 'a' : '') + gs });
          if (pm) {
            var b = h('button', { type: 'button', 'aria-label': fullName(M.learner[e.email]) + ' ' + fmtDate(s.date) + ': ' + (v || 'no mark') }, v ? v[0] : '·');
            b.addEventListener('click', function () {
              var cur = (M.att[e.email] || {})[s.id] || '';
              var next = cur === '' ? 'Present' : cur === 'Present' ? 'Absent' : '';
              (M.att[e.email] = M.att[e.email] || {})[s.id] = next;
              cell.className = 'epm-att ' + (next === 'Present' ? 'p' : next === 'Absent' ? 'a' : '') + gs;
              b.textContent = next ? next[0] : '·';
              pending[s.id + '|' + e.email] = { sessionId: s.id, email: e.email, status: next, source: 'manual' };
              clearTimeout(timer); timer = setTimeout(flush, 900);
            });
            cell.appendChild(b);
          } else cell.appendChild(h('span', v ? v[0] : ''));
          return cell;
        }));
    }));
    var foot = h('tfoot', h('tr', h('td.epm-sticky', { title: 'Per session: learners who attended out of everyone enrolled at that date' }, 'Attended'), h('td.num', pctCell(M.kpi.attendance)),
      sessions.map(function (s) { var r = M.sessionRate[s.id]; return h('td.num.epm-small', { class: gstart[s.id] ? 'epm-gstart' : '', title: r ? r.p + ' of ' + r.base : '' }, r ? Math.round(r.rate * 100) + '%' : ''); })));
    wrap.appendChild(h('.epm-table-wrap.epm-att-wrap', h('table.epm-table.epm-att-table', thead, tbody, foot)));
  }
  function columnMenu(anchor, s) {
    var m = modal(sessionLabel(s, M), h('.epm-stack',
      btn('Mark everyone Present', {}, function () { bulk('Present'); }),
      btn('Mark everyone Absent', {}, function () { bulk('Absent'); }),
      btn('Clear this session', { kind: 'ghost' }, function () { bulk(''); }),
      btn('Import Zoom CSV for this session', { icon: 'upload', kind: 'primary' }, function () { m.close(); zoomImportModal(ctx, s.id); })));
    function bulk(v) {
      var recs = M.expectedAt(s).map(function (e) { return { sessionId: s.id, email: e.email, status: v, source: 'manual' }; });
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
  var everyone = M.enrollments.map(function (e) { return M.learner[e.email]; }).filter(Boolean);
  // who was expected at the chosen session (in the cohort by then and attending live)
  var eligible = function () { var s = M.session[sessSel.value]; return (s ? M.expectedAt(s) : M.live).map(function (e) { return M.learner[e.email]; }).filter(Boolean); };
  sessSel.addEventListener('change', function () { draw(); });
  var assign = {}; // participant key -> email ('' = ignore)
  var override = {}; // email -> status
  file.addEventListener('change', function () {
    var f = file.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try { parsed = parseZoomParticipants(rd.result); } catch (e) { return toast(e.message, 'error'); }
      matches = matchZoomPeople(parsed.people, everyone, C.aliases || []);
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
    return eligible().map(function (l) {
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
      var sel = selectEl([{ value: '', label: '— Not a learner —' }].concat(eligible().map(function (l) { return { value: l.email, label: fullName(l) }; })), assign[p.key] || '', {
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
        var n = s.lectures.filter(function (l) { return l.id in done; }).length;
        det.appendChild(h('.epm-lms-sec', h('span', s.name), h('span.epm-lms-count', { class: n === s.lectures.length ? 'all' : n ? 'some' : '' }, n + ' / ' + s.lectures.length)));
        det.appendChild(h('.epm-lms', s.lectures.map(function (l) {
          var ok = l.id in done;
          return h('.epm-lms-row', { class: ok ? 'ok' : '' },
            h('span.epm-lms-pill', ok ? [icon('check', 13), 'Completed'] : 'Not done'),
            h('span.epm-lms-name', l.name),
            ok && typeof done[l.id] === 'string' && done[l.id] ? h('span.epm-muted.epm-small.epm-nowrap', fmtDate(done[l.id])) : h('span'));
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
