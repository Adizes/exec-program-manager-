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
    h('.epm-drawer-sum', statusBadge(e.status, e), h('span', 'Attendance ', pctCell(st.att)), h('span', 'LMS ', pctCell(st.lms)), st.exp != null ? h('span', 'Rating ' + num(st.exp) + '/5') : null,
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
      var status = selectEl(O.enrollmentStatus.concat(O.enrollmentStatus.indexOf(e.status) < 0 ? [e.status] : []), e.status), wes = h('input', { type: 'checkbox', checked: !!e.welcomeEmailSent });
      var since = inputEl(e.statusDate || today(), { type: 'date' });
      var sinceField = field('Since (sessions after this date do not count)', since);
      var syncSince = function () { sinceField.style.display = NO_LIVE.indexOf(status.value) >= 0 ? '' : 'none'; if (status.value !== e.status && !e.statusDate) since.value = today(); };
      status.addEventListener('change', syncSince);
      var kit = selectEl([''].concat(O.welcomeKit), l.welcomeKit || ''), books = inputEl(l.booksCode), cert = selectEl([''].concat(O.certification), e.certificationSent || '');
      append(pane, [
        h('.epm-row2', field('Status in ' + C.cohort.name, status), sinceField),
        h('.epm-row2', field('Certification sent', cert), h('span')),
        h('.epm-row2', field('Welcome kit sent', kit), field('Books code', books)),
        h('label.epm-check', wes, h('span', 'Welcome email sent')),
        (setTimeout(syncSince, 0), null),
        h('.epm-actions', btn('Save', { kind: 'primary' }, function () {
          var patch = { status: status.value, welcomeEmailSent: wes.checked, certificationSent: cert.value };
          if (NO_LIVE.indexOf(status.value) >= 0) patch.statusDate = since.value || today();
          Promise.all([api('enrollment.update', { id: e.id, patch: patch }),
            api('learner.update', { email: email, patch: { welcomeKit: kit.value, booksCode: books.value } })]).then(function () { toast('Saved'); m.close(); ctx.reload(); }).catch(fail);
        })),
        h('.epm-card.epm-card-flat', h('h4', 'Move to another cohort'), h('p.epm-small.epm-muted', 'Marks this enrollment as “Moved to next cohort” and enrolls the person in the other cohort. Their history stays.'),
          (function () {
            var to = selectEl([{ value: '', label: 'Choose cohort…' }].concat((C.otherCohorts || []).map(function (c) { return { value: c.id, label: c.name + ' (' + c.status + ')' }; })), '');
            var note = inputEl('', { placeholder: 'Reason (optional, logged in Conversations)' });
            var mdate = inputEl(today(), { type: 'date' });
            return h('div', h('.epm-row2', field('Move to', to), field('Moved on (later sessions here do not count)', mdate)), field('Reason', note), h('.epm-actions', btn('Move learner', { kind: 'primary' }, function () {
              if (!to.value) return toast('Choose the cohort', 'error');
              api('enrollment.move', { id: e.id, toCohortId: to.value, date: mdate.value, note: note.value || ' ' }).then(function () { toast('Moved'); m.close(); S.cohorts = {}; refreshBoot(); ctx.reload(); }).catch(fail);
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
    h('p.epm-sub', 'Ratings of the content each SME teaches, compared across cohorts.'))));
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
      // one color per cohort, the same in both charts (oldest cohort first)
      var cohorts = {};
      r.weekly.lines.concat(r.module.lines).forEach(function (l) { cohorts[l.cohort] = l.startDate || ''; });
      var names = Object.keys(cohorts).sort(function (a, b) { return String(cohorts[a]).localeCompare(String(cohorts[b])); });
      var color = {}; names.forEach(function (n, i) { color[n] = SERIES[i % SERIES.length]; });
      var none = function (title) { out.appendChild(h('.epm-card', h('h3', title), empty(pm ? 'No ratings for this SME yet.' : 'No ratings shared with you yet.'))); };
      // Session feedback: a sequence of modules → lines
      var W = r.weekly, wt = 'Session feedback (1–5) by module';
      if (!W.lines.length) none(wt);
      else {
        var series = W.lines.map(function (l) { return { name: l.cohort, color: color[l.cohort], values: l.points.map(function (p) { return p ? p.v : null; }), counts: l.points.map(function (p) { return p ? p.n : 0; }) }; });
        var lo = Math.min.apply(null, series.reduce(function (a, s) { return a.concat(s.values.filter(function (v) { return v != null; })); }, []));
        out.appendChild(h('.epm-card', lineChart({ title: wt, x: W.x, series: series, yMin: Math.min(3, Math.floor(lo)), yMax: 5, yFmt: function (v) { return Number(v).toFixed(1); },
          xShort: function (lab, i) { return String(i + 1); }, xLabel: 'Module', xNumbered: true, height: 280 }),
          h('ol.epm-xkey', W.x.map(function (x) { return h('li', x); })),
          h('p.epm-small.epm-muted', 'Average of the 5 questions of the end-of-session survey, for sessions this SME taught. The numbers on the axis are the modules listed above.')));
      }
      // Module feedback: few blocks → one card per block
      var Md = r.module, mt = 'Module feedback (1–10) by block';
      if (!Md.lines.length) none(mt);
      else {
        var rows = Md.x.map(function (label, i) {
          var items = Md.lines.map(function (l) { var p = l.points[i]; return p ? { name: l.cohort, value: p.v, n: p.n, color: color[l.cohort] } : null; }).filter(Boolean);
          var n = items.reduce(function (a, it) { return a + it.n; }, 0);
          return { label: label, items: items, n: n, overall: n ? items.reduce(function (a, it) { return a + it.value * it.n; }, 0) / n : null };
        }).filter(function (row) { return row.items.length; });
        out.appendChild(h('.epm-card', ratingCards({ title: mt, min: 1, max: 10, rows: rows, itemLabel: 'Block',
          groups: names.filter(function (n) { return Md.lines.some(function (l) { return l.cohort === n; }); }).map(function (n) { return { name: n, color: color[n] }; }) })));
      }
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
  var onlyMf = h('input', { type: 'checkbox' });
  var log = h('ul.epm-log');
  main.appendChild(h('.epm-card', h('h3', 'Import from the old Matrix sheets'),
    h('p.epm-small.epm-muted', 'Upload the .json files generated from each “Cohort X – Matrix” with tools/migrate.py. One cohort per file.'),
    h('.epm-row2', files, h('.epm-stack', h('label.epm-check', replace, h('span', 'Replace a cohort with the same name')),
      h('label.epm-check', onlyMf, h('span', 'Only re-import the module feedback (keeps everything else)')))),
    h('.epm-actions', btn('Import', { icon: 'upload', kind: 'primary' }, function () {
      var list = Array.prototype.slice.call(files.files);
      if (!list.length) return toast('Choose the JSON files', 'error');
      var chain = Promise.resolve();
      list.forEach(function (f) {
        chain = chain.then(function () { return f.text(); }).then(function (txt) {
          var data = JSON.parse(txt);
          log.appendChild(h('li', 'Importing ' + (data.cohort && data.cohort.name) + '…'));
          return api('import.cohort', { data: data, replace: replace.checked, only: onlyMf.checked ? 'moduleFeedback' : '' }).then(function (r) {
            log.lastChild.textContent = '✓ ' + data.cohort.name + ': ' + Object.keys(r.counts).map(function (k) { return r.counts[k] + ' ' + k; }).join(', ');
          });
        }).catch(function (e) { log.appendChild(h('li.epm-t-low', '✗ ' + f.name + ': ' + e.message)); });
      });
      chain.then(function () { S.cohorts = {}; refreshBoot(); toast('Import finished'); });
    })), log));
}
