/* ===================================================================================
 * MODEL — derived numbers for a cohort bundle (same rules as the old Matrix sheets)
 * =================================================================================== */
var INACTIVE = ['Dropped Out', 'Moved to next cohort'];          // left the cohort: not in counts / averages
var NO_LIVE = INACTIVE.concat(['Asynchronous']);                  // no live attendance from their statusDate on
// Does live attendance count for this enrollment on this date?
function attApplies(e, date) { return NO_LIVE.indexOf(e.status) < 0 || !!(e.statusDate && date && date <= e.statusDate); }

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
  M.live = M.counted.filter(function (e) { return NO_LIVE.indexOf(e.status) < 0; });   // expected at live sessions today
  M.enr = {}; M.enrollments.forEach(function (e) { M.enr[e.email] = e; });
  var dates = C.sessions.map(function (s) { return s.date; }).filter(Boolean).sort();
  M.firstDate = dates[0] || '';
  // when each person joined: cohort start, or the move date for people moved in later
  M.startOf = function (e) { var c = String(e.createdAt || '').slice(0, 10); return e.movedFromCohortId && c > M.firstDate ? c : M.firstDate; };
  M.launch = M.enrollments.filter(function (e) { return M.startOf(e) <= M.firstDate; }).length;
  // people expected at a given session (already in the cohort and still attending live)
  M.expectedAt = function (s) { return M.enrollments.filter(function (e) { return (!s.date || M.startOf(e) <= s.date) && attApplies(e, s.date); }); };
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
      var s = M.session[sid]; if (!s || !attApplies(e, s.date)) return;
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
  // per session, both against the people enrolled by then (fixed base, not a moving total):
  //   rate = attended / enrolled · activeRate = still in the program / enrolled
  M.sessionRate = {};
  C.sessions.forEach(function (s) {
    var base = 0, p = 0, active = 0, marks = 0;
    M.enrollments.forEach(function (e) {
      if (s.date && M.startOf(e) > s.date) return;
      base++;
      if (INACTIVE.indexOf(e.status) < 0 || (e.statusDate && s.date && s.date <= e.statusDate)) active++;
      var v = (M.att[e.email] || {})[s.id];
      if (v) marks++;
      if (v === 'Present' && attApplies(e, s.date)) p++;
    });
    M.sessionRate[s.id] = marks && base ? { rate: p / base, activeRate: active / base, p: p, active: active, base: base } : null;
  });
  M.kpi = {
    learners: M.counted.length,
    attendance: avg(M.live.map(function (e) { return M.stats[e.email].att; })),
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
