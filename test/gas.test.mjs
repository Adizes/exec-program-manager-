// Backend tests: the real Code.gs with fake Google services.
// Optional: IMPORT_DIR=/path/to/json  → also imports real cohort exports produced by tools/migrate.py
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadGas } from './gas-mock.mjs';

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n', e); process.exitCode = 1; } };

// ---- fake Teachable + Typeform ----
const routes = (url) => {
  if (url.includes('/lecture_sections')) return [200, { lecture_sections: [
    { id: 1, name: 'Week 1', is_published: true, lectures: [{ id: 11, name: 'Intro', is_published: true }, { id: 12, name: 'Reading', is_published: true }] },
    { id: 2, name: 'Draft', is_published: false, lectures: [{ id: 21, name: 'Hidden', is_published: true }] },
  ] }];
  if (/\/api\/v1\/courses\/\d+$/.test(url)) return [200, { name: 'Course ' + url.split('/').pop() }];
  if (url.includes('/enrolled_students')) return [200, { included: [{ id: 501, attributes: { name: 'Ana Pérez' } }, { id: 999, attributes: { name: 'Daniela Carrillo' } }] }];
  if (url.includes('/v1/users?email=')) return url.includes('bob%40') ? [200, { users: [{ id: 502 }] }] : [200, { users: [] }];
  if (url.includes('/progress?user_id=501')) return [200, { course_progress: { lecture_sections: [{ lectures: [{ id: 11, is_completed: true, completed_at: '2026-10-01T10:00:00Z' }, { id: 12, is_completed: false }] }] } }];
  if (url.includes('/progress?user_id=502')) return [200, { course_progress: { lecture_sections: [{ lectures: [{ id: 11, is_completed: true }, { id: 12, is_completed: true }] }] } }];
  if (/api\.typeform\.com\/forms\/[^/]+$/.test(url)) return [200, { fields: [
    { id: 'f1', type: 'opinion_scale' }, { id: 'f2', type: 'opinion_scale' }, { id: 'f3', type: 'opinion_scale' }, { id: 'f4', type: 'opinion_scale' }, { id: 'f5', type: 'opinion_scale' },
    { id: 'f6', type: 'long_text' }, { id: 'f7', type: 'long_text' }] }];
  if (url.includes('/responses')) return [200, { items: TF_ITEMS }];
  return null;
};
let TF_ITEMS = [];

const { gas, state, post, login, sheet } = loadGas({
  routes, props: { TEACHABLE_API_KEY: 'k', TEACHABLE_BASIC_USER: 'u', TEACHABLE_BASIC_PASS: 'p', TYPEFORM_TOKEN: 'tf' },
});

console.log('setup & auth');
gas.setup();
let pm, sme;
t('setup creates every table and the first PM', () => {
  Object.keys(gas.SCHEMA).forEach(n => assert.ok(sheet(n), n));
  assert.equal(sheet('Users').rows[1][0], 'execprogram@adizes.com');
  assert.equal(state.triggers.length, 1);
});
t('unknown emails get the same answer and no code', () => {
  const n = state.emails.length;
  assert.equal(post({ action: 'auth.request', email: 'stranger@gmail.com' }).ok, true);
  assert.equal(post({ action: 'auth.request', email: 'nobody@adizes.com' }).ok, true);
  assert.equal(state.emails.length, n);
});
t('wrong code is rejected, then locked after 5 tries', () => {
  post({ action: 'auth.request', email: 'execprogram@adizes.com' });
  for (let i = 0; i < 5; i++) assert.equal(post({ action: 'auth.verify', email: 'execprogram@adizes.com', code: '000000' }).error, 'auth_wrong_code');
  assert.equal(post({ action: 'auth.verify', email: 'execprogram@adizes.com', code: '000000' }).error, 'auth_too_many_tries');
});
t('PM signs in with the emailed code', () => {
  state.cache.m.clear();
  pm = login('execprogram@adizes.com');
  assert.ok(pm.length >= 40);
});
t('staff actions need a valid token', () => {
  assert.equal(post({ action: 'bootstrap' }).error, 'auth_required');
  assert.equal(post({ action: 'bootstrap', token: 'nope' }).error, 'auth_expired');
});
t('PM invites an SME (domain enforced) and the SME can sign in', () => {
  assert.equal(post({ action: 'users.save', token: pm, user: { email: 'x@gmail.com', name: 'X', role: 'SME' } }).error, 'invalid_domain');
  const n = state.emails.length;
  assert.equal(post({ action: 'users.save', token: pm, user: { email: 'rodrigo@adizes.com', name: 'Rodrigo', role: 'SME' }, claimName: 'Rodrigo' }).ok, true);
  assert.match(state.emails[n].subject, /access/);
  sme = login('rodrigo@adizes.com');
});
t('a PM cannot demote themselves', () => {
  assert.equal(post({ action: 'users.save', token: pm, user: { email: 'execprogram@adizes.com', role: 'SME' } }).error, 'invalid_self_demote');
});

console.log('cohort from template');
let cid, boot;
t('bootstrap returns options, template and integrations', () => {
  boot = post({ action: 'bootstrap', token: pm });
  assert.equal(boot.ok, true);
  assert.ok(boot.template.length >= 10);
  assert.deepEqual(boot.integrations, { teachable: true, typeform: true });
  assert.equal(boot.options.enrollmentStatus.includes('Graduated'), true);
});
t('create cohort with a generated structure', () => {
  const blocks = boot.template.map((b, i) => ({ key: 'k' + i, kind: b.kind, number: b.number, title: b.title, smeName: b.smeName,
    smeEmail: b.smeName === 'Rodrigo' ? 'rodrigo@adizes.com' : '', teachableCourseId: b.kind === 'course' && b.number === '1' ? '1001' : (b.number === '2' ? '1002' : '') }));
  const sessions = [];
  let d = new Date('2026-11-02T12:00:00Z');
  boot.template.forEach((b, i) => b.modules.forEach(m => { for (let k = 0; k < m.sessions; k++) { sessions.push({ blockKey: 'k' + i, date: d.toISOString().slice(0, 10), moduleNo: m.no, moduleTitle: m.title }); d = new Date(d.getTime() + 3 * 864e5); } }));
  const r = post({ action: 'cohort.create', token: pm, data: { name: 'Cohort 8', language: 'en', startDate: '2026-11-02', teachableBundleId: '777' }, structure: { blocks, sessions } });
  assert.equal(r.ok, true, JSON.stringify(r));
  cid = r.id;
  assert.equal(post({ action: 'cohort.create', token: pm, data: { name: 'cohort 8' } }).error, 'invalid_name_exists');
});
let C;
const reload = () => (C = post({ action: 'cohort.get', token: pm, id: cid }));
t('cohort.get returns blocks and sessions in order', () => {
  reload();
  assert.equal(C.blocks[0].kind, 'welcome');
  assert.ok(C.sessions.length > 50);
  assert.equal(C.sessions[0].order, 1);
});

console.log('learners');
t('add learners (with profile link email) and reject duplicates', () => {
  const n = state.emails.length;
  const r = post({ action: 'learner.add', token: pm, cohortId: cid, sendProfileLink: true, people: [
    { email: 'Ana@Example.com', firstName: 'Ana', lastName: 'Pérez' }, { email: 'bob@example.com', firstName: 'Bob', lastName: 'Stone' }, { email: 'bad' }] });
  assert.deepEqual(r.added, ['ana@example.com', 'bob@example.com']);
  assert.equal(r.skipped[0].reason, 'invalid_email');
  assert.equal(state.emails.length, n + 2);
  assert.match(state.emails[n].options.htmlBody, /exec-program-profile\?t=/);
  assert.equal(post({ action: 'learner.add', token: pm, cohortId: cid, email: 'ana@example.com' }).skipped[0].reason, 'already_enrolled');
  reload();
  assert.equal(C.conversations.length, 2, 'profile email is logged as a conversation');
  assert.deepEqual(C.conversations[0].via, ['Email']);
});
let token;
t('learner opens personal link and saves profile + goals (no login)', () => {
  reload();
  token = C.learners.find(l => l.email === 'ana@example.com').profileLink.split('t=')[1];
  const g = post({ action: 'learner.get', t: token });
  assert.equal(g.lang, 'en');
  assert.equal(g.questions.length, 8);
  const s = post({ action: 'learner.save', t: token, profile: { firstName: 'Ana', company: '=HACK()', birthday: '1990-05-01', profile: ['Senior Executive', 'Nope'] }, goals: ['a', 'b'] });
  assert.equal(s.ok, true);
  reload();
  const ana = C.learners.find(l => l.email === 'ana@example.com');
  assert.equal(ana.company, '=HACK()');      // stored as literal text
  assert.deepEqual(ana.profile, ['Senior Executive']);
  assert.equal(C.goals[0].a1, 'a');
  assert.equal(post({ action: 'learner.get', t: 'short' }).error, 'invalid_link');
});
t('PM updates learner fields and renames an email everywhere', () => {
  assert.equal(post({ action: 'learner.update', token: pm, email: 'bob@example.com', patch: { P: '30', lifecycle: 'Prime', welcomeKit: 'On the way' } }).ok, true);
  const r = post({ action: 'learner.update', token: pm, email: 'bob@example.com', patch: { newEmail: 'bob@stone.com' } });
  assert.equal(r.email, 'bob@stone.com');
  reload();
  assert.ok(C.enrollments.some(e => e.email === 'bob@stone.com'));
  assert.equal(C.learners.find(l => l.email === 'bob@stone.com').P, 30);
});

console.log('attendance & feedback');
t('attendance save, toggle off, aliases', () => {
  const s1 = C.sessions[0].id, s2 = C.sessions[1].id;
  const r = post({ action: 'attendance.save', token: pm, cohortId: cid, records: [
    { sessionId: s1, email: 'ana@example.com', status: 'Present', minutes: 80, source: 'zoom' },
    { sessionId: s2, email: 'ana@example.com', status: 'Absent' }, { sessionId: s1, email: 'bob@stone.com', status: 'Present' }],
    aliases: [{ alias: 'Anita P', email: 'ana@example.com' }] });
  assert.equal(r.saved, 3);
  post({ action: 'attendance.save', token: pm, cohortId: cid, records: [{ sessionId: s2, email: 'ana@example.com', status: '' }] });
  reload();
  assert.equal(C.attendance.length, 2);
  assert.equal(C.aliases[0].alias, 'anita p');
});
t('weekly feedback takes SME from the session block', () => {
  const s = C.sessions.find(x => C.blocks.find(b => b.id === x.blockId).smeEmail === 'rodrigo@adizes.com');
  const r = post({ action: 'weekly.save', token: pm, record: { cohortId: cid, sessionId: s.id, email: 'ana@example.com', q1: 5, q2: 4, q3: 9, q4: 5, q5: 5, improve: 'x' } });
  assert.equal(r.record.smeEmail, 'rodrigo@adizes.com');
  assert.equal(r.record.q3, null, 'out-of-range score dropped');
});
t('module feedback manual save', () => {
  const b = C.blocks.find(x => x.smeEmail === 'rodrigo@adizes.com');
  assert.equal(post({ action: 'module.save', token: pm, record: { cohortId: cid, blockId: b.id, email: 'bob@stone.com', q1: 9, q2: 8, q3: 10, q4: 7, q5: 9 } }).ok, true);
});

console.log('SME permissions');
t('SME sees only their cohorts, without personal data, conversations or hidden feedback', () => {
  const b = post({ action: 'bootstrap', token: sme });
  assert.deepEqual(b.cohorts.map(c => c.id), [cid]);
  assert.equal(b.users, undefined);
  const c = post({ action: 'cohort.get', token: sme, id: cid });
  assert.equal(c.conversations, undefined);
  assert.equal(c.learners[0].address, undefined);
  assert.equal(c.learners[0].profileLink, undefined);
  assert.equal(c.weeklyFeedback.length, 0, 'feedback hidden until the PM allows it');
  assert.equal(post({ action: 'attendance.save', token: sme, cohortId: cid, records: [] }).error, 'forbidden');
});
t('PM opens feedback for one SME block', () => {
  reload();
  const blocks = C.blocks.map(b => Object.assign({}, b, { smeSeesFeedback: b.smeEmail === 'rodrigo@adizes.com' }));
  const r = post({ action: 'structure.save', token: pm, cohortId: cid, blocks, sessions: C.sessions });
  assert.equal(r.ok, true, JSON.stringify(r));
  const c = post({ action: 'cohort.get', token: sme, id: cid });
  assert.equal(c.weeklyFeedback.length, 1);
  const perf = post({ action: 'sme.performance', token: sme, sme: 'someone-else' });
  assert.equal(perf.sme.key, 'rodrigo@adizes.com');
  assert.equal(perf.weekly.lines.length, 1);
});
t('structure.save keeps ids (attendance survives) and drops attendance of removed sessions', () => {
  reload();
  const before = C.attendance.length;
  const r = post({ action: 'structure.save', token: pm, cohortId: cid, blocks: C.blocks, sessions: C.sessions.slice(1) });
  assert.equal(r.removedAttendance, before - 0 - C.attendance.filter(a => a.s !== C.sessions[0].id).length);
  reload();
  assert.equal(C.attendance.length, 0);
});

console.log('conversations & email');
t('bulk conversation log for several learners', () => {
  const r = post({ action: 'conversation.save', token: pm, record: { cohortId: cid, emails: ['ana@example.com', 'bob@stone.com'], via: ['Whatsapp', 'Fax'], categories: ['Books'], description: 'Sent book codes', status: 'Pending' } });
  assert.equal(r.ids.length, 2);
  reload();
  const v = C.conversations.find(x => x.description === 'Sent book codes');
  assert.deepEqual(v.via, ['Whatsapp']);
});
t('pending templates are blocked; custom email is sent and logged', () => {
  assert.equal(post({ action: 'email.send', token: pm, cohortId: cid, template: 'certificate', emails: ['ana@example.com'] }).error, 'invalid_template_pending');
  const n = state.emails.length;
  const r = post({ action: 'email.send', token: pm, cohortId: cid, template: 'custom', emails: ['ana@example.com'], subject: 'Hello {first}', body: 'Line one\n\n<b>Line two</b>' });
  assert.deepEqual(r.sent, ['ana@example.com']);
  assert.equal(state.emails[n].subject, 'Hello Ana');
  assert.match(state.emails[n].options.htmlBody, /&lt;b&gt;Line two/);
});
t('module feedback email needs a Typeform form id', () => {
  const b = C.blocks.find(x => x.kind === 'course');
  const r = post({ action: 'email.send', token: pm, cohortId: cid, template: 'moduleFeedback', blockId: b.id, emails: ['ana@example.com'] });
  assert.equal(r.failed[0].error, 'invalid_typeform_form');
  post({ action: 'settings.save', token: pm, settings: { typeformModuleFormId_en: 'FORM1' } });
  const r2 = post({ action: 'email.send', token: pm, cohortId: cid, template: 'moduleFeedback', blockId: b.id, emails: ['ana@example.com'] });
  assert.deepEqual(r2.sent, ['ana@example.com']);
  assert.match(state.emails.at(-1).options.htmlBody, /form\.typeform\.com\/to\/FORM1#email=ana%40example\.com/);
});

console.log('integrations');
t('Teachable sync: bundle name match + email lookup, published lectures only', () => {
  const r = post({ action: 'lms.sync', token: pm, cohortId: cid });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.matched, 2);
  reload();
  const ana = C.lms.filter(p => p.e === 'ana@example.com');
  assert.equal(ana.length, 2);
  assert.equal(ana[0].p, 50);
  assert.equal(ana[0].t, 2);
  assert.equal(C.lms.find(p => p.e === 'bob@stone.com').p, 100);
  const d = post({ action: 'lms.detail', token: pm, cohortId: cid, email: 'ana@example.com' });
  assert.equal(d.progress[0].completed[0][0], 11);
  assert.ok(Object.keys(d.courses).length === 2);
});
t('Typeform sync imports by hidden fields, skips duplicates', () => {
  reload();
  const b = C.blocks.find(x => x.kind === 'course');
  const ans = (n) => ({ field: { id: 'f' + n }, type: 'number', number: 8 });
  TF_ITEMS = [{ response_id: 'r1', submitted_at: '2026-11-10T10:00:00Z', hidden: { email: 'bob@stone.com', cohort: cid, module: b.id },
    answers: [ans(1), ans(2), ans(3), ans(4), ans(5), { field: { id: 'f6' }, type: 'text', text: 'PAEI' }, { field: { id: 'f7' }, type: 'text', text: 'More cases' }] }];
  const r = post({ action: 'typeform.sync', token: pm });
  assert.equal(r.imported, 1, JSON.stringify(r));
  assert.equal(post({ action: 'typeform.sync', token: pm }).imported, 0);
  reload();
  const m = C.moduleFeedback.find(x => x.source === 'typeform');
  assert.equal(m.applied, 'PAEI');
  assert.equal(m.q5, 8);
});

console.log('moves, deletes');
let c2;
t('move a learner to another cohort', () => {
  c2 = post({ action: 'cohort.create', token: pm, data: { name: 'Cohort 1 SPA', language: 'es' } }).id;
  reload();
  const e = C.enrollments.find(x => x.email === 'bob@stone.com');
  const r = post({ action: 'enrollment.move', token: pm, id: e.id, toCohortId: c2, note: 'schedule' });
  assert.equal(r.ok, true);
  reload();
  assert.equal(C.enrollments.find(x => x.email === 'bob@stone.com').status, 'Moved to next cohort');
  const g = post({ action: 'cohort.get', token: pm, id: c2 });
  assert.equal(g.enrollments[0].movedFromCohortId, cid);
  // Spanish cohort → learner link now opens in Spanish
  const bobToken = g.learners[0].profileLink.split('t=')[1];
  assert.equal(post({ action: 'learner.get', t: bobToken }).lang, 'es');
});
t('cohort delete needs confirmation', () => {
  assert.equal(post({ action: 'cohort.delete', token: pm, id: c2 }).error, 'invalid_confirm');
  assert.equal(post({ action: 'cohort.delete', token: pm, id: c2, confirm: 'DELETE' }).ok, true);
  assert.ok(!post({ action: 'bootstrap', token: pm }).cohorts.some(c => c.id === c2));
});
t('logout kills the token', () => {
  const tk = login('rodrigo@adizes.com');
  assert.equal(post({ action: 'auth.logout', token: tk }).ok, true);
  assert.equal(post({ action: 'bootstrap', token: tk }).error, 'auth_expired');
});
t('every mutation is in the Log tab', () => {
  assert.ok(sheet('Log').rows.length > 10);
  assert.ok(!JSON.stringify(sheet('Log').rows).includes(pm), 'tokens never logged');
});

console.log('v1.1 status rules');
t('status change records the date it applies from', () => {
  const r0 = post({ action: 'cohort.create', token: pm, data: { name: 'Cohort Status' }, structure: { blocks: [{ key: 'a', kind: 'course', number: '1', title: 'X' }],
    sessions: ['2026-01-05', '2026-01-07', '2026-01-12', '2026-01-14'].map(d => ({ blockKey: 'a', date: d })) } });
  post({ action: 'learner.add', token: pm, cohortId: r0.id, people: [{ email: 'p1@x.com', firstName: 'P', lastName: 'One' }, { email: 'p2@x.com', firstName: 'P', lastName: 'Two' }, { email: 'p3@x.com', firstName: 'P', lastName: 'Three' }] });
  let C = post({ action: 'cohort.get', token: pm, id: r0.id });
  const recs = [];
  C.sessions.forEach(x => ['p1@x.com', 'p2@x.com', 'p3@x.com'].forEach(e => recs.push({ sessionId: x.id, email: e, status: e === 'p2@x.com' && x.date > '2026-01-07' ? 'Absent' : 'Present' })));
  post({ action: 'attendance.save', token: pm, cohortId: r0.id, records: recs });
  const e2 = C.enrollments.find(e => e.email === 'p2@x.com'), e3 = C.enrollments.find(e => e.email === 'p3@x.com');
  assert.equal(post({ action: 'enrollment.update', token: pm, id: e2.id, patch: { status: 'Dropped Out', statusDate: '2026-01-07' } }).enrollment.statusDate, '2026-01-07');
  assert.equal(post({ action: 'enrollment.update', token: pm, id: e3.id, patch: { status: 'Low Activity' } }).ok, true);
  assert.equal(post({ action: 'enrollment.update', token: pm, id: e3.id, patch: { status: 'Enrolled Inactive' } }).error, 'invalid_status');
  const sum = post({ action: 'bootstrap', token: pm }).cohorts.find(c => c.id === r0.id);
  assert.equal(sum.learners, 2, 'Low Activity still counts, Dropped Out does not');
  assert.equal(sum.attendance, 1);
});
t('legacy data is migrated automatically (Enrolled Inactive, missing status dates)', () => {
  const E = sheet('Enrollments');
  const H = E.rows[0];
  const ix = (c) => H.indexOf(c);
  // fake legacy rows: rename one to Enrolled Inactive and blank a status date
  const rows = E.rows.slice(1).filter(r => r[ix('email')] === 'p3@x.com' || r[ix('email')] === 'p2@x.com');
  rows.forEach(r => { if (r[ix('email')] === 'p3@x.com') r[ix('status')] = 'Enrolled Inactive'; else r[ix('statusDate')] = ''; });
  const st = sheet('Settings'); const vr = st.rows.find(r => r[0] === 'schemaVersion'); vr[1] = '1';
  post({ action: 'bootstrap', token: pm });
  const after = E.rows.slice(1).filter(r => r[ix('email')] === 'p3@x.com' || r[ix('email')] === 'p2@x.com');
  assert.equal(after.find(r => r[ix('email')] === 'p3@x.com')[ix('status')], 'Low Activity');
  assert.equal(after.find(r => r[ix('email')] === 'p2@x.com')[ix('statusDate')], '2026-01-07', 'last session attended');
  assert.equal(st.rows.find(r => r[0] === 'schemaVersion')[1], '2');
});

// ---- real data ----
const dir = process.env.IMPORT_DIR;
if (dir && existsSync(dir)) {
  console.log('import real cohorts from', dir);
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  files.forEach(f => t('import ' + f, () => {
    const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const r = post({ action: 'import.cohort', token: pm, data });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(post({ action: 'import.cohort', token: pm, data }).error, 'invalid_name_exists');
    const c = post({ action: 'cohort.get', token: pm, id: r.id });
    assert.equal(c.sessions.length, data.sessions.length);
    assert.ok(!c.enrollments.some(e => e.status === 'Enrolled Inactive'));
    c.enrollments.filter(e => ['Dropped Out', 'Moved to next cohort', 'Asynchronous'].includes(e.status)).forEach(e => assert.ok(e.statusDate, 'status date for ' + e.email));
    assert.equal(c.enrollments.length, data.enrollments.length);
  }));
  t('re-import only the module feedback fixes rows without block and keeps the rest', () => {
    const data = JSON.parse(readFileSync(join(dir, 'cohort-4.json'), 'utf8'));
    const c4 = post({ action: 'bootstrap', token: pm }).cohorts.find(c => c.name === 'Cohort 4');
    // simulate the v1.0 bug: imported module feedback without block, plus one Typeform answer that must survive
    const M = sheet('ModuleFeedback'); const H = M.rows[0];
    M.rows.slice(1).forEach(r => { if (r[H.indexOf('cohortId')] === c4.id) r[H.indexOf('blockId')] = ''; });
    const C = post({ action: 'cohort.get', token: pm, id: c4.id });
    const blk = C.blocks.find(b => b.kind === 'course');
    post({ action: 'module.save', token: pm, record: { cohortId: c4.id, blockId: blk.id, email: C.enrollments[0].email, q1: 7, source: 'typeform', externalId: 'tf1' } });
    const before = C.enrollments.length;
    const r = post({ action: 'import.cohort', token: pm, data, only: 'moduleFeedback' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.counts['without block'], 0);
    const after = post({ action: 'cohort.get', token: pm, id: c4.id });
    assert.equal(after.moduleFeedback.length, data.moduleFeedback.length + 1);
    assert.ok(after.moduleFeedback.every(m => m.blockId), 'every response has a block');
    assert.ok(after.moduleFeedback.some(m => m.externalId === 'tf1'), 'typeform answer kept');
    assert.equal(after.enrollments.length, before, 'nothing else touched');
    const perf = post({ action: 'sme.performance', token: pm, sme: 'name:pavel' });
    assert.ok(perf.module.x.every(x => x !== 'Other'), 'no "Other" block: ' + perf.module.x.join(', '));
  });
  t('summaries for imported cohorts', () => {
    const b = post({ action: 'bootstrap', token: pm });
    b.cohorts.forEach(c => console.log('     ', c.name.padEnd(14), 'learners', c.learners, 'att', c.attendance == null ? '-' : (c.attendance * 100).toFixed(1) + '%',
      'lms', c.lms == null ? '-' : (c.lms * 100).toFixed(1) + '%', 'weekly', c.weeklyRating == null ? '-' : c.weeklyRating.toFixed(2), 'sessions', c.sessionsDone + '/' + c.sessionsTotal));
    const c4 = b.cohorts.find(c => c.name === 'Cohort 4');
    if (c4) assert.ok(Math.abs(c4.attendance - 0.6376) < 0.02, 'Cohort 4 overall attendance ≈ 63.76% like the sheet, got ' + c4.attendance);
    const perf = post({ action: 'sme.performance', token: pm, sme: 'name:shoham' });
    console.log('      Shoham weekly series:', perf.weekly.lines.map(l => l.cohort).join(', '), '·', perf.weekly.x.length, 'modules');
    assert.ok(perf.weekly.lines.length >= 3);
  });
}

console.log(`\n${passed} passed${process.exitCode ? ' · FAILURES' : ''}`);
