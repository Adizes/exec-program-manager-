// End-to-end: real bundle in Chromium against the local server (real Code.gs with fake Google services).
// IMPORT_DIR=/path/to/json npm test   → runs with real cohort data. Screenshots in test/out/.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { start } from './server.mjs';

const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/npm-tools/node_modules/playwright'); }
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'out'); mkdirSync(OUT, { recursive: true });

const srv = await start({ port: 8799 });
const URL0 = srv.url;
const browser = await pw.chromium.launch();
const errors = [];
let passed = 0;
let current = null;
const step = async (name, fn) => {
  if (current) await current.evaluate(() => document.querySelectorAll('.epm-overlay').forEach(o => o.remove())).catch(() => {});
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n', e.message); process.exitCode = 1; }
};
const watch = (page) => {
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
};
const shot = (page, name) => page.screenshot({ path: join(OUT, name + '.png'), fullPage: false });
const codeFor = async (email) => {
  const mails = await (await fetch(URL0 + '/__emails')).json();
  const m = mails.reverse().find(x => x.to === email);
  return m.subject.match(/(\d{6})/)[1];
};
async function signIn(page, email) {
  await page.goto(URL0 + '/');
  await page.fill('input[type=email]', email);
  await page.click('text=Send me a code');
  await page.waitForSelector('input[autocomplete=one-time-code]', { state: 'visible' });
  await page.fill('input[autocomplete=one-time-code]', await codeFor(email));
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('.epm-top');
}
const noHScroll = async (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
const idle = (page) => page.waitForFunction(() => !document.querySelector('.epm-progress.on'), null, { timeout: 15000 });

const hasData = srv.G.post({ action: 'bootstrap', token: srv.pmToken }).cohorts.length > 0;
if (!hasData) {
  // minimal data: one cohort from the template with three learners
  const b = srv.G.post({ action: 'bootstrap', token: srv.pmToken });
  const blocks = b.template.map((x, i) => ({ key: 'k' + i, kind: x.kind, number: x.number, title: x.title, smeName: x.smeName, teachableCourseId: x.kind === 'course' ? String(3000 + i) : '' }));
  const sessions = []; let d = new Date('2026-09-07T12:00:00Z');
  b.template.forEach((x, i) => x.modules.forEach(m => { for (let k = 0; k < m.sessions; k++) { sessions.push({ blockKey: 'k' + i, date: d.toISOString().slice(0, 10), moduleNo: m.no, moduleTitle: m.title }); d = new Date(d.getTime() + (k ? 5 : 2) * 864e5); } }));
  const c = srv.G.post({ action: 'cohort.create', token: srv.pmToken, data: { name: 'Cohort 6', language: 'en', status: 'Active' }, structure: { blocks, sessions } });
  srv.G.post({ action: 'learner.add', token: srv.pmToken, cohortId: c.id, people: [{ email: 'fernando@x.com', firstName: 'Fernando', lastName: 'Rodriguez' }, { email: 'julia@x.com', firstName: 'Julia', lastName: 'Aboytes' }, { email: 'liliana@x.com', firstName: 'Liliana', lastName: 'Aguilar' }] });
  srv.G.post({ action: 'cohort.update', token: srv.pmToken, id: c.id, patch: { status: 'Active' } });
}
const cohorts = srv.G.post({ action: 'bootstrap', token: srv.pmToken }).cohorts;
const C6 = cohorts.find(c => c.name === 'Cohort 6') || cohorts[0];
const C4 = cohorts.find(c => c.name === 'Cohort 4') || C6;

console.log('desktop · Program Manager');
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage(); watch(page); current = page;

await step('sign in with emailed code', async () => { await signIn(page, 'dani@adizes.com'); await page.waitForSelector('.epm-ccard'); await shot(page, '01-cohorts'); });
await step('Webflow global CSS does not leak (button font size stays 13px)', async () => {
  const fs = await page.$eval('.epm-btn', el => getComputedStyle(el).fontSize);
  assert.equal(fs, '13px');
});
await step('cohort overview', async () => {
  await page.click(`a.epm-ccard[href="#/c/${C4.id}/overview"]`);
  await page.waitForSelector('.epm-kpis'); await page.waitForTimeout(300); await shot(page, '02-overview');
});
await step('learners table + learner panel', async () => {
  await page.click('a.epm-tab:has-text("Learners")'); await page.waitForSelector('.epm-table-click tbody tr');
  await shot(page, '03-learners');
  await page.click('.epm-table-click tbody tr >> nth=0'); await page.waitForSelector('.epm-drawer');
  await page.waitForTimeout(250); await shot(page, '04-learner-drawer');
  await page.click('.epm-drawer a:has-text("Program")'); await page.waitForSelector('text=Move to another cohort');
  await page.keyboard.press('Escape');
});
await step('calendar + edit a session', async () => {
  await page.click('a.epm-tab:has-text("Calendar")'); await page.waitForSelector('.epm-block');
  await shot(page, '05-calendar');
  await page.click('.epm-block tr.epm-clickable >> nth=0');
  await page.fill('.epm-modal textarea >> nth=0', 'What is your favorite city?');
  await page.click('.epm-modal button:has-text("Save")'); await idle(page);
  await page.waitForSelector('text=What is your favorite city?');
});
await step('attendance grid: toggle a cell saves', async () => {
  await page.click('a.epm-tab:has-text("Attendance")'); await page.waitForSelector('.epm-att-table');
  await shot(page, '06-attendance');
  const before = srv.G.sheet('Attendance').rows.length;
  await page.click('.epm-att-table tbody tr:first-child td.epm-att button >> nth=0');
  await page.waitForSelector('.epm-toast:has-text("Attendance saved")', { timeout: 10000 });
  assert.ok(srv.G.sheet('Attendance').rows.length >= before - 1);
});
await step('LMS sync with Teachable', async () => {
  await page.click('a.epm-tab:has-text("LMS")'); await page.click('button:has-text("Sync now")');
  await page.waitForSelector('.epm-toast:has-text("Synced")', { timeout: 15000 }); await page.waitForSelector('.epm-table-click');
  await page.click('.epm-table-click tbody tr >> nth=0'); await page.waitForSelector('.epm-details, .epm-modal .epm-empty');
  await page.click('.epm-details summary >> nth=0').catch(() => {});
  await shot(page, '07-lms-detail'); await page.keyboard.press('Escape');
});
await step('weekly feedback capture', async () => {
  await page.click('a.epm-tab:has-text("Feedback")'); await page.waitForSelector('text=Capture feedback');
  await shot(page, '08-feedback');
  await page.click('button:has-text("Capture feedback")');
  for (let q = 0; q < 5; q++) await page.click(`.epm-modal .epm-scale >> nth=${q} >> button >> nth=4`);
  await page.click('.epm-modal button:has-text("Save & add another")'); await page.waitForSelector('.epm-toast:has-text("Saved")');
  await page.waitForTimeout(1500);
  assert.ok(await page.$('.epm-modal h3:has-text("Capture session feedback")'), 'the next entry form stays open');
  await page.keyboard.press('Escape'); await idle(page);
});
await step('conversations: bulk log', async () => {
  await page.click('a.epm-tab:has-text("Conversations")'); await page.waitForSelector('button:has-text("Log conversation")');
  await page.click('button:has-text("Log conversation")');
  await page.click('.epm-modal .epm-check-all input');
  await page.click('.epm-modal label.epm-check:has-text("Whatsapp") input');
  await page.click('.epm-modal label.epm-check:has-text("Books") input');
  await page.fill('.epm-modal textarea >> nth=0', 'Sent the books code');
  await page.click('.epm-modal button:has-text("Save")');
  await page.waitForSelector('.epm-toast:has-text("conversations logged")');
  await idle(page); await shot(page, '09-conversations');
});
await step('structure editor', async () => {
  await page.click('a.epm-tab:has-text("Settings")'); await page.waitForSelector('.epm-sblock');
  await page.evaluate(() => document.querySelector('.epm-sblock').scrollIntoView()); await shot(page, '10-structure');
  await page.click('button:has-text("Reschedule dates")'); await page.click('.epm-modal button:has-text("Apply")');
  await page.waitForSelector('.epm-toast:has-text("rescheduled")');
});

await step('Zoom CSV import matches by name and saves', async () => {
  await page.goto(URL0 + '/#/c/' + C6.id + '/attendance'); await page.waitForSelector('button:has-text("Import Zoom CSV")');
  const Cx = srv.G.post({ action: 'cohort.get', token: srv.pmToken, id: C6.id });
  const ls = Cx.learners.slice(0, 3);
  const s = Cx.sessions.find(x => x.date) || Cx.sessions[0];
  const [y, mo, da] = s.date.split('-');
  const csv = 'Meeting ID,Topic,Start Time,End Time,User Email,Duration (Minutes),Participants\n' +
    `"867 1234",Exec Program,${mo}/${da}/${y} 08:00:00 AM,${mo}/${da}/${y} 09:30:00 AM,host@adizes.com,90,4\n\n` +
    'Name (Original Name),User Email,Join Time,Leave Time,Duration (Minutes),Guest\n' +
    `Dani Carrillo,dani@adizes.com,${mo}/${da}/${y} 07:58:00 AM,${mo}/${da}/${y} 09:30:00 AM,92,No\n` +
    `${ls[0].firstName} ${ls[0].lastName},,${mo}/${da}/${y} 08:01:00 AM,${mo}/${da}/${y} 09:30:00 AM,89,Yes\n` +
    `${(ls[1].firstName || '').toUpperCase()} (iPhone),,${mo}/${da}/${y} 08:05:00 AM,${mo}/${da}/${y} 08:20:00 AM,15,Yes\n` +
    `Mystery Guest,,${mo}/${da}/${y} 08:05:00 AM,${mo}/${da}/${y} 09:20:00 AM,75,Yes\n`;
  const f = join(OUT, 'zoom.csv'); writeFileSync(f, csv);
  await page.click('button:has-text("Import Zoom CSV")');
  await page.setInputFiles('.epm-modal input[type=file]', f);
  await page.waitForSelector('.epm-modal h4:has-text("not matched")');
  const sel = await page.$eval('.epm-modal select >> nth=0', el => el.value);
  assert.equal(sel, s.id, 'session auto-selected by date');
  await shot(page, '11-zoom-import');
  await page.click('.epm-modal button:has-text("Save attendance")');
  await page.waitForSelector('.epm-toast:has-text("marks saved")');
  const att = srv.G.post({ action: 'cohort.get', token: srv.pmToken, id: C6.id }).attendance.filter(a => a.s === s.id);
  assert.equal(att.find(a => a.e === ls[0].email).v, 'Present');
  assert.equal(att.find(a => a.e === ls[2].email).v, 'Absent');
});

await step('new cohort wizard from template', async () => {
  await page.goto(URL0 + '/#/cohorts'); await page.click('button:has-text("New cohort")');
  await page.fill('.epm-modal input >> nth=0', 'Cohort 9');
  await page.fill('.epm-modal input[type=date] >> nth=0', '2027-01-06');
  await page.fill('.epm-modal input[type=date] >> nth=1', '2027-01-11');
  await page.fill('.epm-modal textarea', '2027-04-01');
  await page.dispatchEvent('.epm-modal textarea', 'change');
  await page.waitForFunction(() => /sessions · /.test(document.querySelector('.epm-modal .epm-small.epm-muted:last-child')?.textContent || '') || /→/.test(document.querySelector('.epm-modal-body')?.textContent || ''));
  await shot(page, '12-new-cohort');
  await page.click('.epm-modal button:has-text("Create cohort")');
  await page.waitForSelector('.epm-sblock', { timeout: 15000 });
});

await step('SME performance chart', async () => {
  await page.goto(URL0 + '/#/smes'); await page.waitForSelector('.epm-toolbar select');
  await page.selectOption('.epm-toolbar select', 'shoham@adizes.com');
  await page.waitForSelector('.epm-svg, .epm-empty'); await page.waitForTimeout(300);
  const svg = await page.$('.epm-svg');
  if (svg) { const box = await svg.boundingBox(); await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2); }
  await shot(page, '13-sme');
});
await step('team & settings pages render', async () => {
  await page.goto(URL0 + '/#/team'); await page.waitForSelector('text=Invite person'); await shot(page, '14-team');
  await page.goto(URL0 + '/#/settings'); await page.waitForSelector('text=Import from the old Matrix sheets'); await shot(page, '15-settings');
  await page.goto(URL0 + '/#/learners'); await page.waitForSelector('.epm-chip');
});

console.log('learner link');
const learnerCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
const lp = await learnerCtx.newPage(); watch(lp);
await step('learner opens the personal link (mobile), saves profile and goals', async () => {
  const Cx = srv.G.post({ action: 'cohort.get', token: srv.pmToken, id: C6.id });
  const l = Cx.learners[0];
  await lp.goto(URL0 + '/profile?t=' + l.profileLink.split('t=')[1]);
  await lp.waitForSelector('form.epm-lf-form');
  assert.ok(await noHScroll(lp), 'no horizontal scroll');
  await shot(lp, '20-learner-form');
  await lp.fill('form.epm-lf-form textarea >> nth=1', 'Learn the methodology from the source');
  await lp.click('button:has-text("Save my profile")');
  await lp.waitForSelector('.epm-lf-done'); await shot(lp, '21-learner-done');
  const g = srv.G.post({ action: 'cohort.get', token: srv.pmToken, id: C6.id }).goals.find(x => x.email === l.email);
  assert.equal(g.a1, 'Learn the methodology from the source');
});
const spa = cohorts.find(c => c.language === 'es');
if (spa) await step('Spanish cohort → form in Spanish', async () => {
  const Cx = srv.G.post({ action: 'cohort.get', token: srv.pmToken, id: spa.id });
  await lp.goto(URL0 + '/profile?t=' + Cx.learners[0].profileLink.split('t=')[1]);
  await lp.waitForSelector('text=Tu perfil de participante'); await shot(lp, '22-learner-es');
});
await step('invalid link shows a message', async () => {
  await lp.goto(URL0 + '/profile?t=nope'); await lp.waitForSelector('text=not valid');
});

console.log('mobile · staff');
await step('cohorts and overview fit a phone', async () => {
  const mp = await learnerCtx.newPage(); watch(mp);
  await signIn(mp, 'execprogram@adizes.com');
  await mp.waitForSelector('.epm-ccard'); assert.ok(await noHScroll(mp), 'cohorts: no horizontal scroll'); await shot(mp, '30-mobile-cohorts');
  await mp.goto(URL0 + '/#/c/' + C4.id + '/overview'); await mp.waitForSelector('.epm-kpis'); await mp.waitForTimeout(300);
  assert.ok(await noHScroll(mp), 'overview: no horizontal scroll'); await shot(mp, '31-mobile-overview');
  await mp.goto(URL0 + '/#/c/' + C4.id + '/attendance'); await mp.waitForSelector('.epm-att-table');
  assert.ok(await noHScroll(mp), 'attendance: no horizontal page scroll'); await shot(mp, '32-mobile-attendance');
});

console.log('SME');
await step('SME sees only assigned cohorts and no conversations', async () => {
  const sc = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const sp = await sc.newPage(); watch(sp);
  await signIn(sp, 'shoham@adizes.com');
  await sp.waitForSelector('.epm-ccard, .epm-empty');
  const tabsText = await sp.$$eval('.epm-nav a', as => as.map(a => a.textContent));
  assert.deepEqual(tabsText, ['My cohorts', 'My ratings']);
  if (await sp.$('.epm-ccard')) {
    await sp.click('.epm-ccard >> nth=0'); await sp.waitForSelector('.epm-tabs');
    const t = await sp.$$eval('.epm-tab', as => as.map(a => a.textContent));
    assert.ok(!t.includes('Conversations') && !t.includes('Settings'));
    await sp.click('a.epm-tab:has-text("Learners")'); await sp.waitForSelector('.epm-table');
    await shot(sp, '40-sme-learners');
  }
  await sp.goto(URL0 + '/#/smes'); await sp.waitForSelector('.epm-card'); await sp.waitForTimeout(300); await shot(sp, '41-sme-ratings');
  await sc.close();
});

await step('no JavaScript errors', async () => { assert.deepEqual(errors, []); });
await browser.close();
srv.server.close();
console.log(`\n${passed} passed${process.exitCode ? ' · FAILURES' : ''}`);
