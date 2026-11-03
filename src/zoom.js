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
