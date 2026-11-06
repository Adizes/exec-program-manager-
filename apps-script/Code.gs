/*************************************************************************************
 * ADIZES · EXEC PROGRAM MANAGER — BACKEND (Google Apps Script web app)
 * -----------------------------------------------------------------------------------
 * The Webflow pages send POST requests here (Content-Type text/plain, JSON body):
 *   { action: 'auth.request', email }                → emails a 6-digit code
 *   { action: 'auth.verify', email, code }           → returns a session token
 *   { action: '<anything else>', token, ... }        → staff API (PM / SME)
 *   { action: 'learner.get' | 'learner.save', t }    → learner profile form (personal link)
 *
 * The bound Google Sheet is the database: one tab per table (Users, Cohorts, Blocks,
 * Sessions, Learners, Enrollments, Attendance, ...). Columns are matched by HEADER
 * NAME and everything is stored as plain text, so nothing is turned into a formula or
 * a date by Sheets. Do not edit the tabs by hand while people are using the app.
 *
 * Secrets live in Project Settings → Script Properties (never in this file):
 *   TEACHABLE_API_KEY, TEACHABLE_BASIC_USER, TEACHABLE_BASIC_PASS, TYPEFORM_TOKEN
 *
 * Deploy: Deploy → New deployment → Web app → Execute as: Me · Who has access: Anyone.
 * After pasting a new version: Deploy → Manage deployments → ✏️ → Version: New version.
 *************************************************************************************/

const CONFIG = {
  APP_NAME: 'Exec Program Manager',
  ALLOWED_DOMAINS: ['adizes.com'],              // staff must sign in with one of these
  INITIAL_PMS: ['execprogram@adizes.com'],      // created as Program Managers by setup()
  PORTAL_URL: 'https://www.adizes.com/exec-program-manager',   // Webflow page with the staff app
  LEARNER_URL: 'https://www.adizes.com/exec-program-profile',  // Webflow page with the learner form
  EMAIL: {
    FROM_ADDRESS: '',                 // leave empty: mail goes out from the account that runs the script
    FROM_NAME: 'Adizes Executive Program',
  },
  ASSETS_BASE: 'https://cdn.jsdelivr.net/gh/Adizes/exec-program-manager@v1.0.0/assets/',
  SESSION_DAYS: 30,
  CODE_MINUTES: 10,
  TEACHABLE_SCHOOL_URL: 'https://courses.adizes.com',
  TEACHABLE_API_URL: 'https://developers.teachable.com',
  TYPEFORM_API_URL: 'https://api.typeform.com',
  TEACHABLE_EXCLUDED_NAMES: ['Daniela Carrillo'],
};

/* ----------------------------------------------------------------------------------
 * Option lists shared with the web app (edit here to add values)
 * ---------------------------------------------------------------------------------- */
const OPTIONS = {
  enrollmentStatus: ['Enrolled Active', 'Low Activity', 'Asynchronous', 'Dropped Out', 'Moved to next cohort', 'Graduated'],
  welcomeKit: ['Yes', 'No', 'On the way', 'N/A', 'Pending'],
  certification: ['Yes', 'No', 'Pending'],
  lifecycle: ['Infancy', 'Go-Go', 'Adolescence', 'Prime', 'Aristocracy', 'Bureaucracy', 'Recrimination'],
  profile: ['Senior Executive', 'Startup Founder', 'Board Member', 'Consultant', 'Scholar', 'Independent Professionals', 'HR Manager'],
  via: ['Whatsapp', 'Email', 'Call', 'Personal', 'Videocall'],
  categories: ['ALIS/LC', 'Books', 'Live Sessions', 'LMS Content', 'Onboarding', 'Surveys', 'Other'],
  convStatus: ['Completed', 'Pending', 'Not completed'],
  initiatedBy: ['Adizes', 'Learner'],
  blockKinds: ['welcome', 'course', 'case_study', 'other', 'wrapup'],
  cohortStatus: ['Planned', 'Active', 'Completed'],
  languages: ['en', 'es'],
  roles: ['PM', 'SME'],
};
// Statuses of people who left the cohort: not counted in learner counts or averages
const INACTIVE_STATUSES = ['Dropped Out', 'Moved to next cohort'];
// Statuses with no live attendance FROM their statusDate on (sessions after that date do not count)
const NO_LIVE_STATUSES = INACTIVE_STATUSES.concat(['Asynchronous']);
const SCHEMA_VERSION = 2;
function attendanceApplies_(e, date) {
  if (NO_LIVE_STATUSES.indexOf(e.status) < 0) return true;
  return !!(e.statusDate && date && date <= e.statusDate);
}

const DEFAULT_SETTINGS = {
  presentThresholdPct: '50',      // Zoom import: % of the session a person must attend to be Present
  riskAttendancePct: '60',        // learner flagged "at risk" below this attendance
  riskLmsGapPct: '25',            // ... or this many points behind the expected LMS progress
  typeformModuleFormId_en: '',
  typeformModuleFormId_es: '',
  typeformLastSync: '',
  schemaVersion: '1',
};

/* ----------------------------------------------------------------------------------
 * Database schema. Types: n = number, b = boolean, j = JSON. Others are text.
 * ---------------------------------------------------------------------------------- */
const SCHEMA = {
  Users: { key: 'email', cols: ['email', 'name', 'role', 'active', 'invitedBy', 'createdAt', 'lastLoginAt'], types: { active: 'b' } },
  AuthSessions: { key: 'tokenHash', cols: ['tokenHash', 'email', 'createdAt', 'expiresAt'] },
  Settings: { key: 'key', cols: ['key', 'value'] },
  Cohorts: {
    key: 'id', cols: ['id', 'name', 'code', 'language', 'startDate', 'status', 'teachableBundleId', 'zoomMeetingId', 'zoomLink',
      'moduleFeedbackFormId', 'notes', 'createdAt', 'updatedAt', 'lastLmsSync', 'lastLmsSyncResult'],
  },
  Blocks: {
    key: 'id', cols: ['id', 'cohortId', 'order', 'kind', 'number', 'title', 'smeEmail', 'smeName', 'smeSeesFeedback', 'teachableCourseId'],
    types: { order: 'n', smeSeesFeedback: 'b' },
  },
  Sessions: {
    key: 'id', cols: ['id', 'cohortId', 'blockId', 'order', 'date', 'moduleNo', 'moduleTitle', 'smeEmail', 'smeName', 'defreeze', 'recordingUrl', 'notes'],
    types: { order: 'n' },
  },
  Learners: {
    key: 'email', cols: ['email', 'firstName', 'lastName', 'company', 'jobTitle', 'profile', 'birthday', 'address', 'phone', 'linkedin',
      'P', 'A', 'E', 'I', 'lifecycle', 'welcomeKit', 'booksCode', 'profileToken', 'profileSubmittedAt', 'notes', 'createdAt', 'updatedAt'],
    types: { profile: 'j', P: 'n', A: 'n', E: 'n', I: 'n' },
  },
  Enrollments: {
    key: 'id', cols: ['id', 'email', 'cohortId', 'status', 'welcomeEmailSent', 'certificationSent', 'teachableUserId', 'statusChangedAt',
      'movedFromCohortId', 'movedToCohortId', 'createdAt', 'statusDate'],
    types: { welcomeEmailSent: 'b' },
  },
  Attendance: { key: 'id', cols: ['id', 'cohortId', 'sessionId', 'email', 'status', 'minutes', 'source', 'updatedAt'], types: { minutes: 'n' } },
  ZoomAliases: { key: 'alias', cols: ['alias', 'email'] },
  WeeklyFeedback: {
    key: 'id', cols: ['id', 'cohortId', 'sessionId', 'blockId', 'date', 'email', 'nameRaw', 'smeName', 'smeEmail', 'q1', 'q2', 'q3', 'q4', 'q5',
      'improve', 'comments', 'source', 'createdBy', 'createdAt'],
    types: { q1: 'n', q2: 'n', q3: 'n', q4: 'n', q5: 'n' },
  },
  ModuleFeedback: {
    key: 'id', cols: ['id', 'cohortId', 'blockId', 'date', 'email', 'nameRaw', 'smeName', 'smeEmail', 'q1', 'q2', 'q3', 'q4', 'q5',
      'applied', 'suggest', 'source', 'externalId', 'createdAt'],
    types: { q1: 'n', q2: 'n', q3: 'n', q4: 'n', q5: 'n' },
  },
  Goals: { key: 'id', cols: ['id', 'cohortId', 'email', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'submittedAt'] },
  Conversations: {
    key: 'id', cols: ['id', 'cohortId', 'email', 'nameRaw', 'date', 'withName', 'initiatedBy', 'via', 'categories', 'description', 'status',
      'comments', 'emailSubject', 'emailSentAt', 'createdBy', 'createdAt'],
    types: { via: 'j', categories: 'j' },
  },
  LmsProgress: {
    key: 'id', cols: ['id', 'cohortId', 'email', 'blockId', 'courseId', 'percent', 'done', 'total', 'completed', 'source', 'updatedAt'],
    types: { percent: 'n', done: 'n', total: 'n', completed: 'j' },
  },
  LmsCourses: { key: 'courseId', cols: ['courseId', 'name', 'structure', 'updatedAt'], types: { structure: 'j' } },
  Log: { key: 'at', cols: ['at', 'email', 'action', 'detail'] },
};

/* ----------------------------------------------------------------------------------
 * Questions (learner form + labels). Keep the order: answers are stored as a1..a8.
 * ---------------------------------------------------------------------------------- */
const GOALS_QUESTIONS = {
  en: [
    'Share one interesting fact about yourself (professional or personal) that you’d like your peers or faculty to know.',
    'What inspired you to join the Adizes Executive Program?',
    'What are your personal and/or professional goals for this program?',
    'Imagine it’s the final day of the program. What would make you feel it was a worthwhile experience?',
    'In one sentence, how would you describe your current leadership style or approach?',
    'What challenges might get in the way of your full participation?',
    'How do you best learn and stay motivated?',
    'Is there anything else you’d like us to know to support your learning journey?',
  ],
  es: [
    'Comparte algún dato interesante sobre ti (profesional o personal) que te gustaría que tus compañeros o el faculty conocieran.',
    '¿Qué te inspiró a unirte al Adizes Executive Program?',
    '¿Cuáles son tus objetivos personales y/o profesionales para este programa?',
    'Imagina que es el último día del programa. ¿Qué tendría que haber sucedido para que sintieras que fue una experiencia que valió la pena?',
    'En una frase, ¿cómo describirías tu estilo o enfoque de liderazgo actual?',
    '¿Qué desafíos podrían dificultar tu participación en el programa?',
    '¿Cuál es la forma en la que mejor aprendes y mantienes tu motivación?',
    '¿Hay algo más que te gustaría que supiéramos para acompañarte mejor durante tu proceso de aprendizaje?',
  ],
};

/* ----------------------------------------------------------------------------------
 * Email templates. {first}, {cohort}, {link} are replaced. Texts marked PENDING are
 * placeholders until the final copy is provided.
 * ---------------------------------------------------------------------------------- */
const EMAILS = {
  profile: {
    en: { subject: 'Adizes Executive Program · Complete your participant profile',
      body: 'Hi {first},\n\nWelcome to the Adizes Executive Program ({cohort}). To prepare your experience, please take a few minutes to complete your participant profile and share your goals for the program.',
      cta: 'Complete my profile' },
    es: { subject: 'Adizes Executive Program · Completa tu perfil de participante',
      body: 'Hola, {first}:\n\nTe damos la bienvenida al Adizes Executive Program ({cohort}). Para preparar tu experiencia, tómate unos minutos para completar tu perfil de participante y compartirnos tus objetivos para el programa.',
      cta: 'Completar mi perfil' },
    category: 'Onboarding',
  },
  moduleFeedback: {
    en: { subject: 'Adizes Executive Program · Share your feedback on {module}',
      body: 'Hi {first},\n\nWe would love to hear how {module} went for you. The survey takes about 3 minutes and helps us improve the program for you and future cohorts.',
      cta: 'Answer the survey' },
    es: { subject: 'Adizes Executive Program · Cuéntanos cómo te fue en {module}',
      body: 'Hola, {first}:\n\nNos encantaría saber cómo te fue en {module}. La encuesta toma unos 3 minutos y nos ayuda a mejorar el programa para ti y para las siguientes generaciones.',
      cta: 'Responder la encuesta' },
    category: 'Surveys',
  },
  certificate: {
    pending: true,
    en: { subject: 'Adizes Executive Program · Your certificate', body: 'Hi {first},\n\n[PENDING TEXT — certificate email]', cta: '' },
    es: { subject: 'Adizes Executive Program · Tu certificado', body: 'Hola, {first}:\n\n[TEXTO PENDIENTE — correo del certificado]', cta: '' },
    category: 'Other',
  },
  linkedin: {
    pending: true,
    en: { subject: 'Adizes Executive Program · Add the program to your LinkedIn', body: 'Hi {first},\n\n[PENDING TEXT — LinkedIn tutorial]', cta: '' },
    es: { subject: 'Adizes Executive Program · Agrega el programa a tu LinkedIn', body: 'Hola, {first}:\n\n[TEXTO PENDIENTE — tutorial de LinkedIn]', cta: '' },
    category: 'Other',
  },
  custom: { en: { subject: '', body: '', cta: '' }, es: { subject: '', body: '', cta: '' }, category: 'Other' },
};
const EMAIL_SIGN = { en: 'The Adizes Executive Program team', es: 'El equipo del Adizes Executive Program' };

/* =================================================================================
 *  ENTRY POINTS
 * ================================================================================= */
function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad_json' });
  }
  MEMO_ = {};
  try {
    return json_(route_(body));
  } catch (err) {
    const msg = String(err && err.message || err);
    if (!/^(auth_|forbidden|not_found|invalid_)/.test(msg)) console.error(body.action, err && err.stack || err);
    return json_({ ok: false, error: msg });
  }
}

function doGet() {
  return json_({ ok: true, service: 'exec-program-manager', time: new Date().toISOString() });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

const PUBLIC_ACTIONS = {
  'ping': () => ({ ok: true }),
  'auth.request': (b) => authRequest_(b),
  'auth.verify': (b) => authVerify_(b),
  'learner.get': (b) => learnerGet_(b),
  'learner.save': (b) => withLock_(() => learnerSave_(b)),
};

// [handler, roles allowed, mutates?]
const STAFF_ACTIONS = {
  'auth.logout': [(b, u) => authLogout_(b), ['PM', 'SME'], true],
  'bootstrap': [(b, u) => bootstrap_(u), ['PM', 'SME'], false],
  'cohort.get': [(b, u) => cohortGet_(b, u), ['PM', 'SME'], false],
  'cohort.create': [(b, u) => cohortCreate_(b, u), ['PM'], true],
  'cohort.update': [(b, u) => cohortUpdate_(b, u), ['PM'], true],
  'cohort.delete': [(b, u) => cohortDelete_(b, u), ['PM'], true],
  'structure.save': [(b, u) => structureSave_(b, u), ['PM'], true],
  'session.update': [(b, u) => sessionUpdate_(b, u), ['PM'], true],
  'learner.add': [(b, u) => learnerAdd_(b, u), ['PM'], true],
  'learner.update': [(b, u) => learnerUpdate_(b, u), ['PM'], true],
  'learner.sendProfileLink': [(b, u) => learnerSendProfileLink_(b, u), ['PM'], true],
  'learners.all': [(b, u) => learnersAll_(b, u), ['PM'], false],
  'enrollment.update': [(b, u) => enrollmentUpdate_(b, u), ['PM'], true],
  'enrollment.move': [(b, u) => enrollmentMove_(b, u), ['PM'], true],
  'enrollment.delete': [(b, u) => enrollmentDelete_(b, u), ['PM'], true],
  'attendance.save': [(b, u) => attendanceSave_(b, u), ['PM'], true],
  'weekly.save': [(b, u) => weeklySave_(b, u), ['PM'], true],
  'weekly.delete': [(b, u) => deleteById_('WeeklyFeedback', b.id, u), ['PM'], true],
  'module.save': [(b, u) => moduleSave_(b, u), ['PM'], true],
  'module.delete': [(b, u) => deleteById_('ModuleFeedback', b.id, u), ['PM'], true],
  'goals.save': [(b, u) => goalsSave_(b, u), ['PM'], true],
  'conversation.save': [(b, u) => conversationSave_(b, u), ['PM'], true],
  'conversation.delete': [(b, u) => deleteById_('Conversations', b.id, u), ['PM'], true],
  'email.send': [(b, u) => emailSend_(b, u), ['PM'], true],
  'lms.sync': [(b, u) => lmsSync_(b.cohortId, u), ['PM'], true],
  'lms.detail': [(b, u) => lmsDetail_(b, u), ['PM', 'SME'], false],
  'typeform.sync': [(b, u) => typeformSync_(u), ['PM'], true],
  'users.save': [(b, u) => userSave_(b, u), ['PM'], true],
  'settings.save': [(b, u) => settingsSave_(b, u), ['PM'], true],
  'import.cohort': [(b, u) => importCohort_(b, u), ['PM'], true],
  'sme.performance': [(b, u) => smePerformance_(b, u), ['PM', 'SME'], false],
};

function route_(b) {
  const pub = PUBLIC_ACTIONS[b.action];
  if (pub) return pub(b);
  const def = STAFF_ACTIONS[b.action];
  if (!def) throw new Error('unknown_action');
  const user = requireUser_(b.token);
  if (def[1].indexOf(user.role) < 0) throw new Error('forbidden');
  if (!def[2]) return def[0](b, user);
  return withLock_(() => {
    const out = def[0](b, user);
    try { log_(user.email, b.action, logDetail_(b)); } catch (e) { /* never block on the log */ }
    return out;
  });
}

function logDetail_(b) {
  const copy = {};
  Object.keys(b).forEach(k => {
    if (k === 'token' || k === 'data' || k === 'action') return;
    const v = b[k];
    copy[k] = typeof v === 'string' ? v.slice(0, 80) : Array.isArray(v) ? '[' + v.length + ']' : (v && typeof v === 'object' ? '{…}' : v);
  });
  return JSON.stringify(copy).slice(0, 500);
}

/* =================================================================================
 *  AUTH — email code, staff only (allowed domain + active user)
 * ================================================================================= */
function authRequest_(b) {
  const email = normEmail_(b.email);
  if (!isEmail_(email)) throw new Error('invalid_email');
  const cache = CacheService.getScriptCache();
  const countKey = 'codecount_' + email;
  const count = Number(cache.get(countKey) || 0);
  if (count >= 5) return { ok: true, throttled: true };
  cache.put(countKey, String(count + 1), 15 * 60);
  const user = findUser_(email);
  const domainOk = CONFIG.ALLOWED_DOMAINS.some(d => email.endsWith('@' + d));
  // Same answer whether or not the email has access (does not reveal who is a user)
  if (!user || !user.active || !domainOk) return { ok: true };
  const code = String(Math.floor(100000 + Math.random() * 900000));
  cache.put('code_' + email, JSON.stringify({ h: sha_(code), tries: 0 }), CONFIG.CODE_MINUTES * 60);
  const html = emailShell_('en', '<p style="margin:0 0 14px">Hi ' + esc_(user.name || '') + ',</p>' +
    '<p style="margin:0 0 18px">Your access code for the ' + esc_(CONFIG.APP_NAME) + ' is:</p>' +
    '<div style="font:800 32px/1 Arial,sans-serif;letter-spacing:.3em;color:#111;padding:16px 0">' + code + '</div>' +
    '<p style="margin:18px 0 0;color:#555">It expires in ' + CONFIG.CODE_MINUTES + ' minutes. If you did not request it, ignore this email.</p>', true);
  sendMail_(email, 'Your access code: ' + code, 'Your access code is ' + code + ' (valid ' + CONFIG.CODE_MINUTES + ' minutes).', html);
  return { ok: true };
}

function authVerify_(b) {
  const email = normEmail_(b.email);
  const code = String(b.code || '').replace(/\D/g, '');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('code_' + email);
  if (!raw) throw new Error('auth_code_expired');
  const rec = JSON.parse(raw);
  if (rec.tries >= 5) { cache.remove('code_' + email); throw new Error('auth_too_many_tries'); }
  if (sha_(code) !== rec.h) {
    rec.tries++;
    cache.put('code_' + email, JSON.stringify(rec), CONFIG.CODE_MINUTES * 60);
    throw new Error('auth_wrong_code');
  }
  cache.remove('code_' + email);
  const user = findUser_(email);
  if (!user || !user.active) throw new Error('auth_no_access');
  const token = randomToken_(40);
  const now = new Date();
  withLock_(() => {
    // housekeeping: drop expired sessions
    const keep = rows_('AuthSessions').filter(s => s.expiresAt > now.toISOString());
    if (keep.length !== rows_('AuthSessions').length) rewrite_('AuthSessions', keep);
    insert_('AuthSessions', [{ tokenHash: sha_(token), email: email, createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + CONFIG.SESSION_DAYS * 864e5).toISOString() }]);
    update_('Users', email, { lastLoginAt: now.toISOString() });
  });
  return { ok: true, token: token, user: publicUser_(user) };
}

function authLogout_(b) {
  const h = sha_(String(b.token || ''));
  CacheService.getScriptCache().remove('tok_' + h);
  const left = rows_('AuthSessions').filter(s => s.tokenHash !== h);
  rewrite_('AuthSessions', left);
  return { ok: true };
}

function requireUser_(token) {
  if (!token) throw new Error('auth_required');
  const h = sha_(String(token));
  const cache = CacheService.getScriptCache();
  let email = cache.get('tok_' + h);
  if (!email) {
    const s = rows_('AuthSessions').find(x => x.tokenHash === h);
    if (!s || s.expiresAt < new Date().toISOString()) throw new Error('auth_expired');
    email = s.email;
    cache.put('tok_' + h, email, 6 * 3600);
  }
  const user = findUser_(email);
  if (!user || !user.active) throw new Error('auth_no_access');
  return user;
}

function findUser_(email) { return rows_('Users').find(u => u.email === email) || null; }
function publicUser_(u) { return { email: u.email, name: u.name, role: u.role }; }

/* =================================================================================
 *  BOOTSTRAP — what the app needs after sign-in
 * ================================================================================= */
function bootstrap_(user) {
  migrate_();
  const cohorts = visibleCohorts_(user).map(c => Object.assign(pick_(c, ['id', 'name', 'code', 'language', 'startDate', 'status', 'lastLmsSync']), cohortSummary_(c.id)));
  cohorts.sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
  const out = {
    ok: true,
    user: publicUser_(user),
    cohorts: cohorts,
    options: OPTIONS,
    goalsQuestions: GOALS_QUESTIONS,
    settings: settings_(),
    smes: smeDirectory_(),
    today: today_(),
  };
  if (user.role === 'PM') {
    out.users = rows_('Users').map(u => pick_(u, ['email', 'name', 'role', 'active', 'lastLoginAt']));
    out.emailTemplates = Object.keys(EMAILS).reduce((m, k) => { m[k] = { pending: !!EMAILS[k].pending, en: EMAILS[k].en, es: EMAILS[k].es, category: EMAILS[k].category }; return m; }, {});
    out.integrations = integrations_();
    out.template = DEFAULT_TEMPLATE;
  }
  return out;
}

function integrations_() {
  const p = PropertiesService.getScriptProperties();
  return {
    teachable: !!(p.getProperty('TEACHABLE_API_KEY') && p.getProperty('TEACHABLE_BASIC_USER') && p.getProperty('TEACHABLE_BASIC_PASS')),
    typeform: !!p.getProperty('TYPEFORM_TOKEN'),
  };
}

// SMEs known to the system (users with role SME + names found in blocks)
function smeDirectory_() {
  const map = {};
  rows_('Users').filter(u => u.role === 'SME' || u.role === 'PM').forEach(u => { map[u.email] = { key: u.email, email: u.email, name: u.name, role: u.role }; });
  rows_('Blocks').forEach(b => {
    if (b.smeEmail) return;
    const n = String(b.smeName || '').trim();
    if (n && !map['name:' + n.toLowerCase()]) map['name:' + n.toLowerCase()] = { key: 'name:' + n.toLowerCase(), email: '', name: n, role: 'SME' };
  });
  return Object.keys(map).map(k => map[k]).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function visibleCohorts_(user) {
  const cohorts = rows_('Cohorts');
  if (user.role === 'PM') return cohorts;
  const ids = {};
  rows_('Blocks').forEach(b => { if (b.smeEmail === user.email) ids[b.cohortId] = 1; });
  rows_('Sessions').forEach(s => { if (s.smeEmail === user.email) ids[s.cohortId] = 1; });
  return cohorts.filter(c => ids[c.id]);
}

function canSeeCohort_(user, cohortId) {
  return visibleCohorts_(user).some(c => c.id === cohortId);
}

/* ----- summary numbers for the cohort list ----- */
function cohortSummary_(cohortId) {
  const enr = rows_('Enrollments').filter(e => e.cohortId === cohortId);
  const counted = enr.filter(e => INACTIVE_STATUSES.indexOf(e.status) < 0);
  const emails = {}; counted.forEach(e => emails[e.email] = 1);
  // attendance average: people expected at live sessions (not Asynchronous)
  const live = {}; counted.forEach(e => { if (NO_LIVE_STATUSES.indexOf(e.status) < 0) live[e.email] = 1; });
  const att = {};
  rows_('Attendance').forEach(a => {
    if (a.cohortId !== cohortId || !live[a.email]) return;
    const r = att[a.email] || (att[a.email] = { p: 0, t: 0 });
    if (a.status === 'Present') { r.p++; r.t++; } else if (a.status === 'Absent') r.t++;
  });
  const attVals = Object.keys(att).filter(k => att[k].t > 0).map(k => att[k].p / att[k].t);
  const blocks = rows_('Blocks').filter(b => b.cohortId === cohortId && b.teachableCourseId);
  const lms = {};
  rows_('LmsProgress').forEach(p => { if (p.cohortId === cohortId && emails[p.email]) (lms[p.email] = lms[p.email] || {})[p.blockId] = p.percent || 0; });
  const lmsVals = Object.keys(lms).map(e => blocks.length ? blocks.reduce((s, b) => s + (lms[e][b.id] || 0), 0) / blocks.length : null).filter(v => v != null);
  const wf = rows_('WeeklyFeedback').filter(w => w.cohortId === cohortId).map(overall5_).filter(v => v != null);
  const mf = rows_('ModuleFeedback').filter(w => w.cohortId === cohortId).map(overall5_).filter(v => v != null);
  const sessions = rows_('Sessions').filter(s => s.cohortId === cohortId && s.date).map(s => s.date).sort();
  const t = today_();
  return {
    learners: counted.length,
    enrolledTotal: enr.length,
    attendance: avg_(attVals),
    lms: lmsVals.length ? avg_(lmsVals) / 100 : null,
    weeklyRating: avg_(wf),
    moduleRating: avg_(mf),
    firstSession: sessions[0] || '',
    lastSession: sessions[sessions.length - 1] || '',
    sessionsDone: sessions.filter(d => d <= t).length,
    sessionsTotal: sessions.length,
    pendingConversations: rows_('Conversations').filter(c => c.cohortId === cohortId && c.status === 'Pending').length,
  };
}
function overall5_(r) {
  const v = [r.q1, r.q2, r.q3, r.q4, r.q5].filter(x => typeof x === 'number' && !isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/* =================================================================================
 *  COHORTS
 * ================================================================================= */
function cohortGet_(b, user) {
  const id = String(b.id || '');
  const cohort = rows_('Cohorts').find(c => c.id === id);
  if (!cohort) throw new Error('not_found');
  if (!canSeeCohort_(user, id)) throw new Error('forbidden');
  const pm = user.role === 'PM';
  const blocks = rows_('Blocks').filter(x => x.cohortId === id).sort(byOrder_);
  const sessions = rows_('Sessions').filter(x => x.cohortId === id).sort(byOrder_);
  const enrollments = rows_('Enrollments').filter(x => x.cohortId === id);
  const emails = {}; enrollments.forEach(e => emails[e.email] = 1);
  let learners = rows_('Learners').filter(l => emails[l.email]);
  const SME_HIDDEN = ['birthday', 'address', 'phone', 'booksCode', 'welcomeKit', 'profileToken', 'notes', 'linkedin'];
  learners = learners.map(l => {
    const o = strip_(l);
    if (!pm) SME_HIDDEN.forEach(k => delete o[k]);
    if (pm) o.profileLink = l.profileToken ? profileUrl_(l.profileToken) : '';
    delete o.profileToken;
    return o;
  });
  const out = {
    ok: true,
    cohort: strip_(cohort),
    blocks: blocks.map(strip_),
    sessions: sessions.map(strip_),
    enrollments: enrollments.map(e => { const o = strip_(e); if (!pm) { delete o.teachableUserId; } return o; }),
    learners: learners,
    attendance: rows_('Attendance').filter(x => x.cohortId === id).map(a => ({ s: a.sessionId, e: a.email, v: a.status, m: a.minutes })),
    lms: rows_('LmsProgress').filter(x => x.cohortId === id).map(p => ({ e: p.email, b: p.blockId, p: p.percent, d: p.done, t: p.total, src: p.source, at: p.updatedAt })),
  };
  // Feedback: PM sees all; SME only for the blocks the PM opened to them
  const allowedBlocks = {};
  blocks.forEach(bl => { if (pm || (bl.smeEmail === user.email && bl.smeSeesFeedback)) allowedBlocks[bl.id] = 1; });
  if (!pm) sessions.forEach(s => { if (s.smeEmail === user.email && allowedBlocks[s.blockId]) allowedBlocks[s.blockId] = 1; });
  out.weeklyFeedback = rows_('WeeklyFeedback').filter(w => w.cohortId === id && (pm || allowedBlocks[w.blockId])).map(strip_);
  out.moduleFeedback = rows_('ModuleFeedback').filter(w => w.cohortId === id && (pm || allowedBlocks[w.blockId])).map(strip_);
  out.feedbackBlocks = Object.keys(allowedBlocks);
  if (pm) {
    out.goals = rows_('Goals').filter(g => g.cohortId === id).map(strip_);
    out.conversations = rows_('Conversations').filter(c => c.cohortId === id).map(strip_);
    out.aliases = rows_('ZoomAliases').filter(a => emails[a.email]).map(strip_);
    out.otherCohorts = rows_('Cohorts').filter(c => c.id !== id).map(c => pick_(c, ['id', 'name', 'status', 'language', 'startDate']));
    const fid = cohort.moduleFeedbackFormId || settings_()['typeformModuleFormId_' + (cohort.language || 'en')] || '';
    out.moduleFormId = fid;
  }
  return out;
}

function cohortCreate_(b, user) {
  const d = b.data || {};
  const name = clean_(d.name, 80);
  if (!name) throw new Error('invalid_name');
  if (rows_('Cohorts').some(c => c.name.toLowerCase() === name.toLowerCase())) throw new Error('invalid_name_exists');
  const now = new Date().toISOString();
  const cohort = {
    id: newId_('C'), name: name, code: clean_(d.code, 40), language: OPTIONS.languages.indexOf(d.language) >= 0 ? d.language : 'en',
    startDate: cleanDate_(d.startDate), status: OPTIONS.cohortStatus.indexOf(d.status) >= 0 ? d.status : 'Planned',
    teachableBundleId: clean_(d.teachableBundleId, 20), zoomMeetingId: clean_(d.zoomMeetingId, 40), zoomLink: clean_(d.zoomLink, 300),
    moduleFeedbackFormId: clean_(d.moduleFeedbackFormId, 40), notes: clean_(d.notes, 2000), createdAt: now, updatedAt: now,
  };
  insert_('Cohorts', [cohort]);
  if (b.structure) writeStructure_(cohort.id, b.structure.blocks || [], b.structure.sessions || []);
  return { ok: true, id: cohort.id };
}

function cohortUpdate_(b) {
  const c = rows_('Cohorts').find(x => x.id === b.id);
  if (!c) throw new Error('not_found');
  const p = b.patch || {};
  const patch = { updatedAt: new Date().toISOString() };
  ['name', 'code', 'teachableBundleId', 'zoomMeetingId', 'zoomLink', 'moduleFeedbackFormId', 'notes'].forEach(k => { if (k in p) patch[k] = clean_(p[k], k === 'notes' ? 2000 : 300); });
  if ('startDate' in p) patch.startDate = cleanDate_(p.startDate);
  if ('language' in p && OPTIONS.languages.indexOf(p.language) >= 0) patch.language = p.language;
  if ('status' in p && OPTIONS.cohortStatus.indexOf(p.status) >= 0) patch.status = p.status;
  if (patch.name && rows_('Cohorts').some(x => x.id !== c.id && x.name.toLowerCase() === patch.name.toLowerCase())) throw new Error('invalid_name_exists');
  update_('Cohorts', c.id, patch);
  return { ok: true };
}

// Deletes a cohort and everything attached to it (not the people).
function cohortDelete_(b) {
  const id = String(b.id || '');
  if (!rows_('Cohorts').some(c => c.id === id)) throw new Error('not_found');
  if (String(b.confirm || '') !== 'DELETE') throw new Error('invalid_confirm');
  ['Blocks', 'Sessions', 'Enrollments', 'Attendance', 'WeeklyFeedback', 'ModuleFeedback', 'Goals', 'Conversations', 'LmsProgress']
    .forEach(t => { const all = rows_(t); const keep = all.filter(r => r.cohortId !== id); if (keep.length !== all.length) rewrite_(t, keep); });
  rewrite_('Cohorts', rows_('Cohorts').filter(c => c.id !== id));
  return { ok: true };
}

/* ----- structure (blocks + sessions), saved as a whole by the editor ----- */
function structureSave_(b) {
  const id = String(b.cohortId || '');
  if (!rows_('Cohorts').some(c => c.id === id)) throw new Error('not_found');
  const res = writeStructure_(id, b.blocks || [], b.sessions || []);
  update_('Cohorts', id, { updatedAt: new Date().toISOString() });
  return Object.assign({ ok: true }, res);
}

function writeStructure_(cohortId, blocksIn, sessionsIn) {
  const keyToId = {};
  const blocks = blocksIn.map((x, i) => {
    const id = /^B[A-Z0-9]{6,}$/.test(String(x.id || '')) ? x.id : newId_('B');
    if (x.key) keyToId[x.key] = id;
    keyToId[id] = id;
    return {
      id: id, cohortId: cohortId, order: i + 1, kind: OPTIONS.blockKinds.indexOf(x.kind) >= 0 ? x.kind : 'course',
      number: clean_(x.number, 10), title: clean_(x.title, 200), smeEmail: normEmail_(x.smeEmail), smeName: clean_(x.smeName, 80),
      smeSeesFeedback: !!x.smeSeesFeedback, teachableCourseId: clean_(x.teachableCourseId, 20),
    };
  });
  const sessions = sessionsIn.map((x, i) => {
    const blockId = keyToId[x.blockId] || keyToId[x.blockKey];
    if (!blockId) throw new Error('invalid_session_block');
    return {
      id: /^S[A-Z0-9]{6,}$/.test(String(x.id || '')) ? x.id : newId_('S'), cohortId: cohortId, blockId: blockId, order: i + 1,
      date: cleanDate_(x.date), moduleNo: clean_(x.moduleNo, 12), moduleTitle: clean_(x.moduleTitle, 200),
      smeEmail: normEmail_(x.smeEmail), smeName: clean_(x.smeName, 80), defreeze: clean_(x.defreeze, 1000),
      recordingUrl: clean_(x.recordingUrl, 1000), notes: clean_(x.notes, 1000),
    };
  });
  const sessIds = {}; sessions.forEach(s => sessIds[s.id] = 1);
  const blockIds = {}; blocks.forEach(x => blockIds[x.id] = 1);
  rewrite_('Blocks', rows_('Blocks').filter(x => x.cohortId !== cohortId).concat(blocks));
  rewrite_('Sessions', rows_('Sessions').filter(x => x.cohortId !== cohortId).concat(sessions));
  // attendance of deleted sessions goes away; feedback keeps its date but loses the link
  const att = rows_('Attendance');
  const attKeep = att.filter(a => a.cohortId !== cohortId || sessIds[a.sessionId]);
  if (attKeep.length !== att.length) rewrite_('Attendance', attKeep);
  let changed = false;
  const wf = rows_('WeeklyFeedback').map(w => {
    if (w.cohortId !== cohortId) return w;
    if (w.sessionId && !sessIds[w.sessionId]) { changed = true; w = Object.assign({}, w, { sessionId: '' }); }
    if (w.blockId && !blockIds[w.blockId]) { changed = true; w = Object.assign({}, w, { blockId: '' }); }
    return w;
  });
  if (changed) rewrite_('WeeklyFeedback', wf);
  return { blocks: blocks.length, sessions: sessions.length, removedAttendance: att.length - attKeep.length };
}

function sessionUpdate_(b) {
  const s = rows_('Sessions').find(x => x.id === b.id);
  if (!s) throw new Error('not_found');
  const p = b.patch || {}, patch = {};
  ['defreeze', 'recordingUrl', 'notes', 'moduleTitle', 'moduleNo', 'smeName'].forEach(k => { if (k in p) patch[k] = clean_(p[k], 1000); });
  if ('smeEmail' in p) patch.smeEmail = normEmail_(p.smeEmail);
  if ('date' in p) patch.date = cleanDate_(p.date);
  update_('Sessions', s.id, patch);
  return { ok: true, session: strip_(Object.assign({}, s, patch)) };
}

/* =================================================================================
 *  LEARNERS & ENROLLMENTS
 * ================================================================================= */
const LEARNER_TEXT_FIELDS = ['firstName', 'lastName', 'company', 'jobTitle', 'birthday', 'address', 'phone', 'linkedin', 'lifecycle', 'welcomeKit', 'booksCode', 'notes'];

function learnerAdd_(b, user) {
  const cohortId = String(b.cohortId || '');
  const cohort = rows_('Cohorts').find(c => c.id === cohortId);
  if (!cohort) throw new Error('not_found');
  const list = (b.people || [b]).map(p => ({ email: normEmail_(p.email), firstName: clean_(p.firstName, 80), lastName: clean_(p.lastName, 80) }));
  const added = [], skipped = [];
  const now = new Date().toISOString();
  list.forEach(p => {
    if (!isEmail_(p.email)) { skipped.push({ email: p.email, reason: 'invalid_email' }); return; }
    let l = rows_('Learners').find(x => x.email === p.email);
    if (!l) {
      l = { email: p.email, firstName: p.firstName, lastName: p.lastName, profile: [], profileToken: randomToken_(32), createdAt: now, updatedAt: now };
      insert_('Learners', [l]);
    } else {
      const patch = {};
      if (!l.firstName && p.firstName) patch.firstName = p.firstName;
      if (!l.lastName && p.lastName) patch.lastName = p.lastName;
      if (!l.profileToken) patch.profileToken = randomToken_(32);
      if (Object.keys(patch).length) update_('Learners', l.email, patch);
    }
    if (rows_('Enrollments').some(e => e.email === p.email && e.cohortId === cohortId)) { skipped.push({ email: p.email, reason: 'already_enrolled' }); return; }
    insert_('Enrollments', [{ id: newId_('E'), email: p.email, cohortId: cohortId, status: 'Enrolled Active', welcomeEmailSent: false,
      certificationSent: '', statusChangedAt: now, createdAt: now }]);
    added.push(p.email);
  });
  if (b.sendProfileLink) added.forEach(email => { try { sendProfileLink_(email, cohort, user); } catch (e) { skipped.push({ email: email, reason: 'email_failed: ' + e.message }); } });
  return { ok: true, added: added, skipped: skipped };
}

function learnerUpdate_(b) {
  const email = normEmail_(b.email);
  const l = rows_('Learners').find(x => x.email === email);
  if (!l) throw new Error('not_found');
  const p = b.patch || {}, patch = { updatedAt: new Date().toISOString() };
  LEARNER_TEXT_FIELDS.forEach(k => { if (k in p) patch[k] = clean_(p[k], k === 'notes' || k === 'address' ? 1000 : 200); });
  if ('birthday' in p) patch.birthday = cleanDate_(p.birthday);
  ['P', 'A', 'E', 'I'].forEach(k => { if (k in p) patch[k] = numOrNull_(p[k]); });
  if ('profile' in p) patch.profile = (Array.isArray(p.profile) ? p.profile : []).map(x => clean_(x, 60)).filter(String);
  if (p.newEmail && normEmail_(p.newEmail) !== email) {
    const ne = normEmail_(p.newEmail);
    if (!isEmail_(ne)) throw new Error('invalid_email');
    if (rows_('Learners').some(x => x.email === ne)) throw new Error('invalid_email_exists');
    changeEmail_(email, ne);
    update_('Learners', ne, patch);
    return { ok: true, email: ne };
  }
  update_('Learners', email, patch);
  return { ok: true, email: email };
}

// Renames a learner's email everywhere it is used as a key
function changeEmail_(oldE, newE) {
  ['Learners', 'Enrollments', 'Attendance', 'WeeklyFeedback', 'ModuleFeedback', 'Goals', 'Conversations', 'LmsProgress', 'ZoomAliases'].forEach(t => {
    const all = rows_(t);
    let hit = false;
    const out = all.map(r => {
      if (r.email !== oldE) return r;
      hit = true;
      const o = Object.assign({}, r, { email: newE });
      if (t === 'Attendance') o.id = o.sessionId + '|' + newE;
      if (t === 'Goals') o.id = o.cohortId + '|' + newE;
      if (t === 'LmsProgress') o.id = o.cohortId + '|' + newE + '|' + o.blockId;
      return o;
    });
    if (hit) rewrite_(t, out);
  });
}

function learnersAll_() {
  const enr = rows_('Enrollments');
  const cohorts = {}; rows_('Cohorts').forEach(c => cohorts[c.id] = c.name);
  return {
    ok: true,
    learners: rows_('Learners').map(l => {
      const o = pick_(l, ['email', 'firstName', 'lastName', 'company', 'jobTitle', 'profile', 'lifecycle', 'P', 'A', 'E', 'I', 'profileSubmittedAt']);
      o.enrollments = enr.filter(e => e.email === l.email).map(e => ({ id: e.id, cohortId: e.cohortId, cohort: cohorts[e.cohortId] || '?', status: e.status }));
      return o;
    }),
  };
}

function enrollmentUpdate_(b) {
  const e = rows_('Enrollments').find(x => x.id === b.id);
  if (!e) throw new Error('not_found');
  const p = b.patch || {}, patch = {};
  if ('status' in p) {
    if (OPTIONS.enrollmentStatus.indexOf(p.status) < 0) throw new Error('invalid_status');
    if (p.status !== e.status) { patch.status = p.status; patch.statusChangedAt = new Date().toISOString(); patch.statusDate = today_(); }
  }
  // date from which the status applies (Dropped Out / Moved / Asynchronous: later sessions do not count)
  if ('statusDate' in p && cleanDate_(p.statusDate)) patch.statusDate = cleanDate_(p.statusDate);
  if ('welcomeEmailSent' in p) patch.welcomeEmailSent = !!p.welcomeEmailSent;
  if ('certificationSent' in p) patch.certificationSent = OPTIONS.certification.indexOf(p.certificationSent) >= 0 ? p.certificationSent : '';
  if ('teachableUserId' in p) patch.teachableUserId = clean_(p.teachableUserId, 20);
  update_('Enrollments', e.id, patch);
  return { ok: true, enrollment: strip_(Object.assign({}, e, patch)) };
}

// Moves a learner to another cohort: old enrollment → "Moved to next cohort", new one → Enrolled Active
function enrollmentMove_(b, user) {
  const e = rows_('Enrollments').find(x => x.id === b.id);
  if (!e) throw new Error('not_found');
  const to = rows_('Cohorts').find(c => c.id === b.toCohortId);
  if (!to || to.id === e.cohortId) throw new Error('invalid_target');
  const now = new Date().toISOString();
  let target = rows_('Enrollments').find(x => x.email === e.email && x.cohortId === to.id);
  if (target) update_('Enrollments', target.id, { status: 'Enrolled Active', movedFromCohortId: e.cohortId, statusChangedAt: now });
  else {
    target = { id: newId_('E'), email: e.email, cohortId: to.id, status: 'Enrolled Active', welcomeEmailSent: false, certificationSent: '',
      teachableUserId: e.teachableUserId, statusChangedAt: now, movedFromCohortId: e.cohortId, createdAt: now };
    insert_('Enrollments', [target]);
  }
  update_('Enrollments', e.id, { status: 'Moved to next cohort', movedToCohortId: to.id, statusChangedAt: now, statusDate: cleanDate_(b.date) || today_() });
  if (b.note) {
    insert_('Conversations', [{ id: newId_('V'), cohortId: e.cohortId, email: e.email, date: today_(), withName: user.name || user.email,
      initiatedBy: 'Adizes', via: [], categories: ['Other'], description: 'Moved to ' + to.name + (b.note ? ': ' + clean_(b.note, 500) : ''),
      status: 'Completed', createdBy: user.email, createdAt: now }]);
  }
  return { ok: true, newEnrollmentId: target.id };
}

function enrollmentDelete_(b) {
  const e = rows_('Enrollments').find(x => x.id === b.id);
  if (!e) throw new Error('not_found');
  if (String(b.confirm || '') !== 'DELETE') throw new Error('invalid_confirm');
  rewrite_('Enrollments', rows_('Enrollments').filter(x => x.id !== e.id));
  ['Attendance', 'Goals', 'LmsProgress'].forEach(t => {
    const all = rows_(t); const keep = all.filter(r => !(r.cohortId === e.cohortId && r.email === e.email));
    if (keep.length !== all.length) rewrite_(t, keep);
  });
  return { ok: true };
}

/* ----- learner profile link (no login, personal token) ----- */
function profileUrl_(token) { return CONFIG.LEARNER_URL + (CONFIG.LEARNER_URL.indexOf('?') >= 0 ? '&' : '?') + 't=' + encodeURIComponent(token); }

function learnerByToken_(t) {
  t = String(t || '');
  if (t.length < 20) throw new Error('invalid_link');
  const l = rows_('Learners').find(x => x.profileToken === t);
  if (!l) throw new Error('invalid_link');
  return l;
}

function latestEnrollment_(email) {
  const cohorts = {}; rows_('Cohorts').forEach(c => cohorts[c.id] = c);
  const list = rows_('Enrollments').filter(e => e.email === email && cohorts[e.cohortId]);
  list.sort((a, b) => {
    const ai = INACTIVE_STATUSES.indexOf(a.status) >= 0 ? 1 : 0, bi = INACTIVE_STATUSES.indexOf(b.status) >= 0 ? 1 : 0;
    return ai - bi || String(cohorts[b.cohortId].startDate).localeCompare(String(cohorts[a.cohortId].startDate));
  });
  return list[0] ? { enrollment: list[0], cohort: cohorts[list[0].cohortId] } : null;
}

function learnerGet_(b) {
  const l = learnerByToken_(b.t);
  const le = latestEnrollment_(l.email);
  const lang = le && le.cohort.language === 'es' ? 'es' : 'en';
  const goals = le ? rows_('Goals').find(g => g.cohortId === le.cohort.id && g.email === l.email) : null;
  return {
    ok: true, lang: lang, cohort: le ? le.cohort.name : '',
    profile: pick_(l, ['email', 'firstName', 'lastName', 'company', 'jobTitle', 'profile', 'birthday', 'address', 'phone', 'linkedin']),
    goals: goals ? [1, 2, 3, 4, 5, 6, 7, 8].map(i => goals['a' + i] || '') : ['', '', '', '', '', '', '', ''],
    questions: GOALS_QUESTIONS[lang], profileOptions: OPTIONS.profile, submittedAt: l.profileSubmittedAt || '',
  };
}

function learnerSave_(b) {
  const l = learnerByToken_(b.t);
  const p = b.profile || {};
  const now = new Date().toISOString();
  const patch = { updatedAt: now, profileSubmittedAt: now };
  ['firstName', 'lastName', 'company', 'jobTitle', 'address', 'phone', 'linkedin'].forEach(k => { if (k in p) patch[k] = clean_(p[k], k === 'address' ? 500 : 160); });
  if ('birthday' in p) patch.birthday = cleanDate_(p.birthday);
  if ('profile' in p) patch.profile = (Array.isArray(p.profile) ? p.profile : []).filter(x => OPTIONS.profile.indexOf(x) >= 0);
  if (!patch.firstName && !l.firstName) throw new Error('invalid_name');
  update_('Learners', l.email, patch);
  const le = latestEnrollment_(l.email);
  if (le && Array.isArray(b.goals)) {
    const g = { id: le.cohort.id + '|' + l.email, cohortId: le.cohort.id, email: l.email, submittedAt: now };
    for (let i = 0; i < 8; i++) g['a' + (i + 1)] = clean_(b.goals[i], 3000);
    upsert_('Goals', [g]);
  }
  return { ok: true };
}

function learnerSendProfileLink_(b, user) {
  const cohort = rows_('Cohorts').find(c => c.id === b.cohortId);
  if (!cohort) throw new Error('not_found');
  const emails = (b.emails || [b.email]).map(normEmail_).filter(Boolean);
  const sent = [];
  emails.forEach(e => { sendProfileLink_(e, cohort, user); sent.push(e); });
  return { ok: true, sent: sent };
}

function sendProfileLink_(email, cohort, user) {
  let l = rows_('Learners').find(x => x.email === email);
  if (!l) throw new Error('not_found');
  if (!l.profileToken) { update_('Learners', email, { profileToken: randomToken_(32) }); l = rows_('Learners').find(x => x.email === email); }
  sendTemplate_('profile', cohort, l, { link: profileUrl_(l.profileToken) }, user);
}

/* =================================================================================
 *  ATTENDANCE
 * ================================================================================= */
function attendanceSave_(b, user) {
  const cohortId = String(b.cohortId || '');
  const sessions = {}; rows_('Sessions').filter(s => s.cohortId === cohortId).forEach(s => sessions[s.id] = s);
  const now = new Date().toISOString();
  const upserts = [], removeIds = {};
  (b.records || []).forEach(r => {
    if (!sessions[r.sessionId]) return;
    const email = normEmail_(r.email);
    const id = r.sessionId + '|' + email;
    if (r.status === 'Present' || r.status === 'Absent') {
      upserts.push({ id: id, cohortId: cohortId, sessionId: r.sessionId, email: email, status: r.status,
        minutes: numOrNull_(r.minutes), source: clean_(r.source || 'manual', 20), updatedAt: now });
    } else removeIds[id] = 1;
  });
  if (Object.keys(removeIds).length) rewrite_('Attendance', rows_('Attendance').filter(a => !removeIds[a.id]));
  if (upserts.length) upsert_('Attendance', upserts);
  const aliases = (b.aliases || []).map(a => ({ alias: normName_(a.alias), email: normEmail_(a.email) })).filter(a => a.alias && a.email);
  if (aliases.length) upsert_('ZoomAliases', aliases);
  return { ok: true, saved: upserts.length, removed: Object.keys(removeIds).length };
}

/* =================================================================================
 *  FEEDBACK
 * ================================================================================= */
function weeklySave_(b, user) {
  const r = b.record || {};
  const cohortId = String(r.cohortId || '');
  if (!rows_('Cohorts').some(c => c.id === cohortId)) throw new Error('not_found');
  const sess = rows_('Sessions').find(s => s.id === r.sessionId && s.cohortId === cohortId);
  const block = sess ? rows_('Blocks').find(x => x.id === sess.blockId) : null;
  const rec = {
    id: r.id || newId_('W'), cohortId: cohortId, sessionId: sess ? sess.id : '', blockId: sess ? sess.blockId : clean_(r.blockId, 20),
    date: sess ? sess.date : cleanDate_(r.date), email: normEmail_(r.email), nameRaw: r.email ? '' : clean_(r.nameRaw, 120),
    smeName: clean_(r.smeName || (sess && sess.smeName) || (block && block.smeName), 80),
    smeEmail: normEmail_(r.smeEmail || (sess && sess.smeEmail) || (block && block.smeEmail)),
    improve: clean_(r.improve, 3000), comments: clean_(r.comments, 3000), source: 'manual', createdBy: user.email, createdAt: new Date().toISOString(),
  };
  for (let i = 1; i <= 5; i++) rec['q' + i] = score_(r['q' + i], 1, 5);
  upsert_('WeeklyFeedback', [rec]);
  return { ok: true, record: rec };
}

function moduleSave_(b, user) {
  const r = b.record || {};
  const cohortId = String(r.cohortId || '');
  const block = rows_('Blocks').find(x => x.id === r.blockId && x.cohortId === cohortId);
  if (!block) throw new Error('not_found');
  const rec = {
    id: r.id || newId_('M'), cohortId: cohortId, blockId: block.id, date: cleanDate_(r.date) || today_(), email: normEmail_(r.email),
    nameRaw: r.email ? '' : clean_(r.nameRaw, 120), smeName: clean_(r.smeName || block.smeName, 80), smeEmail: normEmail_(r.smeEmail || block.smeEmail),
    applied: clean_(r.applied, 3000), suggest: clean_(r.suggest, 3000), source: r.source === 'typeform' ? 'typeform' : 'manual',
    externalId: clean_(r.externalId, 60), createdAt: new Date().toISOString(),
  };
  for (let i = 1; i <= 5; i++) rec['q' + i] = score_(r['q' + i], 1, 10);
  upsert_('ModuleFeedback', [rec]);
  return { ok: true, record: rec };
}

function goalsSave_(b) {
  const cohortId = String(b.cohortId || ''), email = normEmail_(b.email);
  if (!rows_('Enrollments').some(e => e.cohortId === cohortId && e.email === email)) throw new Error('not_found');
  const g = { id: cohortId + '|' + email, cohortId: cohortId, email: email, submittedAt: new Date().toISOString() };
  for (let i = 0; i < 8; i++) g['a' + (i + 1)] = clean_((b.answers || [])[i], 3000);
  upsert_('Goals', [g]);
  return { ok: true };
}

function deleteById_(table, id) {
  const all = rows_(table);
  const keep = all.filter(r => r.id !== id);
  if (keep.length === all.length) throw new Error('not_found');
  rewrite_(table, keep);
  return { ok: true };
}

/* =================================================================================
 *  CONVERSATIONS & EMAIL
 * ================================================================================= */
function conversationSave_(b, user) {
  const r = b.record || {};
  const cohortId = String(r.cohortId || '');
  if (!rows_('Cohorts').some(c => c.id === cohortId)) throw new Error('not_found');
  const emails = r.id ? [normEmail_(r.email)] : (r.emails || [r.email]).map(normEmail_).filter(Boolean);
  if (!emails.length) throw new Error('invalid_email');
  const now = new Date().toISOString();
  const base = {
    cohortId: cohortId, date: cleanDate_(r.date) || today_(), withName: clean_(r.withName || user.name || user.email, 120),
    initiatedBy: OPTIONS.initiatedBy.indexOf(r.initiatedBy) >= 0 ? r.initiatedBy : 'Adizes',
    via: (r.via || []).filter(v => OPTIONS.via.indexOf(v) >= 0), categories: (r.categories || []).filter(v => OPTIONS.categories.indexOf(v) >= 0),
    description: clean_(r.description, 2000), status: OPTIONS.convStatus.indexOf(r.status) >= 0 ? r.status : 'Completed', comments: clean_(r.comments, 2000),
  };
  if (r.id) {
    const old = rows_('Conversations').find(x => x.id === r.id);
    if (!old) throw new Error('not_found');
    update_('Conversations', r.id, base);
    return { ok: true, ids: [r.id] };
  }
  const recs = emails.map(e => Object.assign({ id: newId_('V'), email: e, createdBy: user.email, createdAt: now }, base));
  insert_('Conversations', recs);
  return { ok: true, ids: recs.map(x => x.id) };
}

// Sends a template (or custom) email to one or more learners and logs a conversation per person.
function emailSend_(b, user) {
  const cohort = rows_('Cohorts').find(c => c.id === b.cohortId);
  if (!cohort) throw new Error('not_found');
  const key = EMAILS[b.template] ? b.template : 'custom';
  if (EMAILS[key].pending && !b.allowPending) throw new Error('invalid_template_pending');
  const emails = (b.emails || []).map(normEmail_).filter(Boolean);
  if (!emails.length) throw new Error('invalid_email');
  const sent = [], failed = [];
  emails.forEach(email => {
    const l = rows_('Learners').find(x => x.email === email);
    if (!l) { failed.push({ email: email, error: 'not_found' }); return; }
    try {
      const vars = {};
      if (key === 'profile') {
        if (!l.profileToken) update_('Learners', email, { profileToken: randomToken_(32) });
        vars.link = profileUrl_((rows_('Learners').find(x => x.email === email)).profileToken);
      }
      if (key === 'moduleFeedback') {
        const block = rows_('Blocks').find(x => x.id === b.blockId && x.cohortId === cohort.id);
        if (!block) throw new Error('invalid_block');
        vars.module = block.title;
        vars.link = typeformLink_(cohort, block, l);
        if (!vars.link) throw new Error('invalid_typeform_form');
      }
      sendTemplate_(key, cohort, l, vars, user, { subject: b.subject, body: b.body });
      sent.push(email);
    } catch (e) { failed.push({ email: email, error: String(e.message || e) }); }
  });
  return { ok: true, sent: sent, failed: failed };
}

function sendTemplate_(key, cohort, learner, vars, user, custom) {
  const lang = cohort.language === 'es' ? 'es' : 'en';
  const tpl = EMAILS[key][lang];
  const v = Object.assign({ first: learner.firstName || '', cohort: cohort.name }, vars || {});
  const subject = fill_((custom && custom.subject) || tpl.subject, v);
  const body = fill_((custom && custom.body) || tpl.body, v);
  if (!subject || !body) throw new Error('invalid_email_text');
  const paras = body.split(/\n{2,}/).map(p => '<p style="margin:0 0 14px">' + esc_(p).replace(/\n/g, '<br>') + '</p>').join('');
  const cta = v.link && tpl.cta ? '<p style="margin:22px 0"><a href="' + esc_(v.link) + '" style="display:inline-block;background:#d7141a;color:#ffffff;font:700 15px Arial,sans-serif;text-decoration:none;padding:12px 22px;border-radius:4px">' + esc_(tpl.cta) + ' &rarr;</a></p>' : '';
  const html = emailShell_(lang, paras + cta + '<p style="margin:22px 0 0">' + esc_(EMAIL_SIGN[lang]) + '</p>');
  sendMail_(learner.email, subject, body + (v.link ? '\n\n' + v.link : '') + '\n\n' + EMAIL_SIGN[lang], html);
  const now = new Date().toISOString();
  insert_('Conversations', [{ id: newId_('V'), cohortId: cohort.id, email: learner.email, date: today_(), withName: user ? (user.name || user.email) : 'System',
    initiatedBy: 'Adizes', via: ['Email'], categories: [EMAILS[key].category], description: subject, status: 'Completed',
    emailSubject: subject, emailSentAt: now, createdBy: user ? user.email : 'system', createdAt: now }]);
}

function emailShell_(lang, inner, staff) {
  return '<div style="background:#f4f4f4;padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden">' +
    '<tr><td style="background:#111111;padding:22px 32px;border-bottom:4px solid #d7141a"><img src="' + CONFIG.ASSETS_BASE + 'adizes-logo-white.png" alt="Adizes Institute" width="130" style="display:block;width:130px;height:auto"></td></tr>' +
    '<tr><td style="padding:30px 32px;font:15px/1.6 Arial,sans-serif;color:#1a1a1a">' + inner + '</td></tr>' +
    '<tr><td style="padding:14px 32px;background:#f4f4f4;font:12px/1.5 Arial,sans-serif;color:#777">' +
    (staff ? esc_(CONFIG.APP_NAME) : (lang === 'es' ? 'Adizes Institute · Adizes Executive Program' : 'Adizes Institute · Adizes Executive Program')) + '</td></tr></table></div>';
}

function sendMail_(to, subject, plain, html) {
  const options = { name: CONFIG.EMAIL.FROM_NAME, htmlBody: html };
  if (CONFIG.EMAIL.FROM_ADDRESS) options.from = CONFIG.EMAIL.FROM_ADDRESS;
  GmailApp.sendEmail(to, subject, plain, options);
}

/* =================================================================================
 *  TEAM (users) & SETTINGS
 * ================================================================================= */
function userSave_(b, user) {
  const u = b.user || {};
  const email = normEmail_(u.email);
  if (!isEmail_(email)) throw new Error('invalid_email');
  if (!CONFIG.ALLOWED_DOMAINS.some(d => email.endsWith('@' + d))) throw new Error('invalid_domain');
  const role = OPTIONS.roles.indexOf(u.role) >= 0 ? u.role : 'SME';
  const existing = findUser_(email);
  if (existing && email === user.email && (role !== 'PM' || u.active === false)) throw new Error('invalid_self_demote');
  const rec = { email: email, name: clean_(u.name, 80), role: role, active: u.active !== false };
  if (existing) update_('Users', email, rec);
  else insert_('Users', [Object.assign(rec, { invitedBy: user.email, createdAt: new Date().toISOString() })]);
  if (!existing && b.sendInvite !== false) {
    const html = emailShell_('en', '<p style="margin:0 0 14px">Hi ' + esc_(rec.name || '') + ',</p>' +
      '<p style="margin:0 0 14px">' + esc_(user.name || user.email) + ' gave you access to the <b>' + esc_(CONFIG.APP_NAME) + '</b>' +
      (role === 'SME' ? ', where you can follow the progress of the cohorts you teach.' : ' as a Program Manager.') + '</p>' +
      '<p style="margin:0 0 14px">Sign in with this email address; we will send you a one-time code each time.</p>' +
      '<p style="margin:22px 0"><a href="' + esc_(CONFIG.PORTAL_URL) + '" style="display:inline-block;background:#d7141a;color:#fff;font:700 15px Arial,sans-serif;text-decoration:none;padding:12px 22px;border-radius:4px">Open the ' + esc_(CONFIG.APP_NAME) + ' &rarr;</a></p>', true);
    sendMail_(email, 'You have access to the ' + CONFIG.APP_NAME, 'Open ' + CONFIG.PORTAL_URL + ' and sign in with ' + email + '.', html);
  }
  // Link blocks typed with this person's name (from imports) to the new account
  if (b.claimName) {
    const n = String(b.claimName).trim().toLowerCase();
    const bl = rows_('Blocks'); let hit = false;
    const out = bl.map(x => (!x.smeEmail && String(x.smeName).trim().toLowerCase() === n) ? (hit = true, Object.assign({}, x, { smeEmail: email })) : x);
    if (hit) rewrite_('Blocks', out);
    const ss = rows_('Sessions'); let hit2 = false;
    const out2 = ss.map(x => (!x.smeEmail && String(x.smeName).trim().toLowerCase() === n) ? (hit2 = true, Object.assign({}, x, { smeEmail: email })) : x);
    if (hit2) rewrite_('Sessions', out2);
    const wf = rows_('WeeklyFeedback'); let hit3 = false;
    const out3 = wf.map(x => (!x.smeEmail && smeNameMatches_(x.smeName, n)) ? (hit3 = true, Object.assign({}, x, { smeEmail: email })) : x);
    if (hit3) rewrite_('WeeklyFeedback', out3);
    const mf = rows_('ModuleFeedback'); let hit4 = false;
    const out4 = mf.map(x => (!x.smeEmail && smeNameMatches_(x.smeName, n)) ? (hit4 = true, Object.assign({}, x, { smeEmail: email })) : x);
    if (hit4) rewrite_('ModuleFeedback', out4);
  }
  return { ok: true };
}
function smeNameMatches_(raw, n) {
  return String(raw || '').split(/,| and /).some(p => p.trim().toLowerCase() === n);
}

function settings_() {
  const out = Object.assign({}, DEFAULT_SETTINGS);
  rows_('Settings').forEach(s => { out[s.key] = s.value; });
  return out;
}
function settingsSave_(b) {
  const p = b.settings || {};
  const recs = Object.keys(DEFAULT_SETTINGS).filter(k => k in p && k !== 'typeformLastSync' && k !== 'schemaVersion').map(k => ({ key: k, value: clean_(p[k], 200) }));
  if (recs.length) upsert_('Settings', recs);
  return { ok: true, settings: settings_() };
}

/* =================================================================================
 *  SME PERFORMANCE — X: the content an SME teaches, Y: rating, one line per cohort
 * ================================================================================= */
function smePerformance_(b, user) {
  let key = String(b.sme || '');
  if (user.role === 'SME') key = user.email;  // SMEs only see themselves
  const isEmailKey = key.indexOf('@') > 0;
  const name = isEmailKey ? ((findUser_(key) || {}).name || '') : key.replace(/^name:/, '');
  const nameL = name.trim().toLowerCase();
  const matches = (em, nm) => (isEmailKey && em === key) || (nameL && smeNameMatches_(nm, nameL));
  const cohorts = {}; rows_('Cohorts').forEach(c => cohorts[c.id] = c);
  const blocks = {}; rows_('Blocks').forEach(x => blocks[x.id] = x);
  const sessions = {}; rows_('Sessions').forEach(x => sessions[x.id] = x);
  const series = {};  // cohortId -> point key -> {sum,n}
  const xs = {};      // point key -> {label, order}
  const add = (cohortId, k, label, order, v) => {
    if (v == null || !cohorts[cohortId]) return;
    if (!xs[k]) xs[k] = { key: k, label: label, order: order };
    const s = series[cohortId] || (series[cohortId] = {});
    const p = s[k] || (s[k] = { sum: 0, n: 0 });
    p.sum += v; p.n++;
  };
  // Weekly (1–5) by module (moduleNo + title)
  rows_('WeeklyFeedback').forEach(w => {
    if (!matches(w.smeEmail, w.smeName)) return;
    const bl = blocks[w.blockId];
    if (user.role === 'SME' && !(bl && bl.smeSeesFeedback)) return;
    const s = sessions[w.sessionId];
    const label = s && s.moduleTitle ? s.moduleTitle : (bl ? bl.title : 'Other');
    const order = moduleOrder_(s ? s.moduleNo : (bl ? bl.number : ''));
    add(w.cohortId, normName_(label), label, order, overall5_(w));
  });
  const weekly = buildSeries_(series, xs, cohorts);
  // Module feedback (1–10) by block title
  const series2 = {}, xs2 = {};
  rows_('ModuleFeedback').forEach(m => {
    if (!matches(m.smeEmail, m.smeName)) return;
    const bl = blocks[m.blockId];
    if (user.role === 'SME' && !(bl && bl.smeSeesFeedback)) return;
    const label = bl ? bl.title : 'Other';
    if (!xs2[normName_(label)]) xs2[normName_(label)] = { key: normName_(label), label: label, order: moduleOrder_(bl ? bl.number : '') };
    const s = series2[m.cohortId] || (series2[m.cohortId] = {});
    const p = s[normName_(label)] || (s[normName_(label)] = { sum: 0, n: 0 });
    const v = overall5_(m); if (v == null) return;
    p.sum += v; p.n++;
  });
  return { ok: true, sme: { key: key, name: name }, weekly: weekly, module: buildSeries_(series2, xs2, cohorts) };
}
function moduleOrder_(no) {
  const s = String(no || '');
  if (/^CS/i.test(s)) return 50 + Number(s.replace(/\D/g, '') || 0) / 10;
  const m = s.match(/^(\d+)(?:\.(\d+))?/);
  return m ? Number(m[1]) + Number(m[2] || 0) / 100 : 99;
}
function buildSeries_(series, xs, cohorts) {
  const x = Object.keys(xs).map(k => xs[k]).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  const lines = Object.keys(series).map(cid => ({
    cohortId: cid, cohort: cohorts[cid].name, startDate: cohorts[cid].startDate,
    points: x.map(p => { const v = series[cid][p.key]; return v ? { v: Math.round(v.sum / v.n * 100) / 100, n: v.n } : null; }),
  })).sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  return { x: x.map(p => p.label), lines: lines };
}

/* =================================================================================
 *  TEACHABLE (LMS progress)
 * ================================================================================= */
function teachableCreds_() {
  const p = PropertiesService.getScriptProperties();
  const c = { key: p.getProperty('TEACHABLE_API_KEY'), user: p.getProperty('TEACHABLE_BASIC_USER'), pass: p.getProperty('TEACHABLE_BASIC_PASS') };
  if (!c.key || !c.user || !c.pass) throw new Error('invalid_teachable_not_configured');
  return c;
}
function tReqSchool_(cr, path) {
  return { url: CONFIG.TEACHABLE_SCHOOL_URL + path, method: 'get', muteHttpExceptions: true,
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(cr.user + ':' + cr.pass) } };
}
function tReqApi_(cr, path) {
  return { url: CONFIG.TEACHABLE_API_URL + path, method: 'get', muteHttpExceptions: true, headers: { apiKey: cr.key, accept: 'application/json' } };
}
// fetchAll in batches, retrying 429/5xx once
function fetchJsonAll_(reqs) {
  const out = new Array(reqs.length).fill(null);
  for (let i = 0; i < reqs.length; i += 10) {
    const batch = reqs.slice(i, i + 10);
    let resps = UrlFetchApp.fetchAll(batch);
    const retry = [];
    resps.forEach((r, k) => { const code = r.getResponseCode(); if (code === 429 || code >= 500) retry.push(k); });
    if (retry.length) {
      Utilities.sleep(2000);
      const again = UrlFetchApp.fetchAll(retry.map(k => batch[k]));
      retry.forEach((k, j) => { resps[k] = again[j]; });
    }
    resps.forEach((r, k) => {
      if (r.getResponseCode() === 200) { try { out[i + k] = JSON.parse(r.getContentText()); } catch (e) { /* ignore */ } }
    });
  }
  return out;
}

function lmsSync_(cohortId, user) {
  const cohort = rows_('Cohorts').find(c => c.id === cohortId);
  if (!cohort) throw new Error('not_found');
  const cr = teachableCreds_();
  const blocks = rows_('Blocks').filter(b => b.cohortId === cohortId && b.teachableCourseId).sort(byOrder_);
  if (!blocks.length) throw new Error('invalid_no_teachable_courses');
  const enr = rows_('Enrollments').filter(e => e.cohortId === cohortId);
  const learners = {}; rows_('Learners').forEach(l => learners[l.email] = l);
  const result = { courses: blocks.length, learners: 0, matched: 0, unmatched: [], errors: [] };

  // 1) course structures (published lectures only)
  const sReqs = [];
  blocks.forEach(b => { sReqs.push(tReqSchool_(cr, '/api/v1/courses/' + b.teachableCourseId + '/lecture_sections')); sReqs.push(tReqSchool_(cr, '/api/v1/courses/' + b.teachableCourseId)); });
  const sRes = fetchJsonAll_(sReqs);
  const structures = {};
  blocks.forEach((b, i) => {
    const data = sRes[i * 2], info = sRes[i * 2 + 1];
    if (!data || !data.lecture_sections) { result.errors.push('course ' + b.teachableCourseId + ': structure not available'); return; }
    const sections = [];
    data.lecture_sections.forEach(s => {
      if (s.is_published === false) return;
      const lectures = (s.lectures || []).filter(l => l.is_published !== false).map(l => ({ id: l.id, name: l.name }));
      if (lectures.length) sections.push({ id: s.id, name: s.name, lectures: lectures });
    });
    structures[b.teachableCourseId] = sections;
    upsert_('LmsCourses', [{ courseId: String(b.teachableCourseId), name: (info && info.name) || b.title, structure: sections, updatedAt: new Date().toISOString() }]);
  });

  // 2) Teachable user ids: from the bundle (name / email) and, if missing, lookup by email
  const idByEmail = {};
  enr.forEach(e => { if (e.teachableUserId) idByEmail[e.email] = e.teachableUserId; });
  if (cohort.teachableBundleId) {
    const data = fetchJsonAll_([tReqSchool_(cr, '/api/v2/product_collections/' + cohort.teachableBundleId + '/enrolled_students')])[0];
    const students = ((data && data.included) || []).map(u => ({ id: u.id || (u.attributes && u.attributes.id), name: (u.attributes && u.attributes.name) || '', email: normEmail_(u.attributes && u.attributes.email) }))
      .filter(s => CONFIG.TEACHABLE_EXCLUDED_NAMES.indexOf(s.name) < 0);
    const people = {};
    enr.forEach(e => { const l = learners[e.email]; if (l) people[normName_((l.firstName || '') + ' ' + (l.lastName || ''))] = e.email; });
    students.forEach(s => {
      const em = (s.email && enr.some(e => e.email === s.email)) ? s.email : people[normName_(s.name)];
      if (em && !idByEmail[em]) idByEmail[em] = String(s.id);
    });
  }
  const missing = enr.filter(e => !idByEmail[e.email]);
  if (missing.length) {
    const res = fetchJsonAll_(missing.map(e => tReqApi_(cr, '/v1/users?email=' + encodeURIComponent(e.email))));
    missing.forEach((e, i) => { const u = res[i] && res[i].users && res[i].users[0]; if (u && u.id) idByEmail[e.email] = String(u.id); });
  }
  enr.forEach(e => { if (idByEmail[e.email] && idByEmail[e.email] !== e.teachableUserId) update_('Enrollments', e.id, { teachableUserId: idByEmail[e.email] }); });

  // 3) progress per learner × course
  const pairs = [];
  enr.forEach(e => {
    if (!idByEmail[e.email]) { result.unmatched.push(e.email); return; }
    blocks.forEach(b => { if (structures[b.teachableCourseId]) pairs.push({ e: e, b: b }); });
  });
  result.learners = enr.length; result.matched = enr.length - result.unmatched.length;
  const pRes = fetchJsonAll_(pairs.map(p => tReqApi_(cr, '/v1/courses/' + p.b.teachableCourseId + '/progress?user_id=' + idByEmail[p.e.email] + '&per=100')));
  const now = new Date().toISOString();
  const recs = [];
  pairs.forEach((p, i) => {
    const data = pRes[i];
    if (!data || !data.course_progress) { result.errors.push(p.e.email + ' / ' + p.b.teachableCourseId + ': no progress'); return; }
    const done = {};
    (data.course_progress.lecture_sections || []).forEach(s => (s.lectures || []).forEach(l => { if (l.is_completed) done[l.id] = l.completed_at || ''; }));
    const lectures = [];
    structures[p.b.teachableCourseId].forEach(s => s.lectures.forEach(l => lectures.push(l.id)));
    const completed = lectures.filter(id => id in done).map(id => [id, String(done[id]).slice(0, 10)]);
    recs.push({ id: cohortId + '|' + p.e.email + '|' + p.b.id, cohortId: cohortId, email: p.e.email, blockId: p.b.id, courseId: String(p.b.teachableCourseId),
      percent: lectures.length ? Math.round(completed.length / lectures.length * 1000) / 10 : 0, done: completed.length, total: lectures.length,
      completed: completed, source: 'teachable', updatedAt: now });
  });
  if (recs.length) upsert_('LmsProgress', recs);
  update_('Cohorts', cohortId, { lastLmsSync: now, lastLmsSyncResult: JSON.stringify({ matched: result.matched, unmatched: result.unmatched.length, errors: result.errors.length }) });
  result.errors = result.errors.slice(0, 20);
  return Object.assign({ ok: true }, result);
}

function lmsDetail_(b, user) {
  if (!canSeeCohort_(user, b.cohortId)) throw new Error('forbidden');
  const email = normEmail_(b.email);
  const prog = rows_('LmsProgress').filter(p => p.cohortId === b.cohortId && p.email === email);
  const courses = {};
  rows_('LmsCourses').forEach(c => { if (prog.some(p => p.courseId === c.courseId)) courses[c.courseId] = { name: c.name, structure: c.structure }; });
  return { ok: true, progress: prog.map(p => ({ blockId: p.blockId, courseId: p.courseId, percent: p.percent, completed: p.completed || [], updatedAt: p.updatedAt })), courses: courses };
}

/* =================================================================================
 *  TYPEFORM (module feedback): personalized links + pulling responses
 * ================================================================================= */
function typeformLink_(cohort, block, learner) {
  const fid = cohort.moduleFeedbackFormId || settings_()['typeformModuleFormId_' + (cohort.language || 'en')];
  if (!fid) return '';
  const name = ((learner.firstName || '') + ' ' + (learner.lastName || '')).trim();
  return 'https://form.typeform.com/to/' + encodeURIComponent(fid) + '#email=' + encodeURIComponent(learner.email) +
    '&name=' + encodeURIComponent(name) + '&cohort=' + encodeURIComponent(cohort.id) + '&module=' + encodeURIComponent(block.id);
}

function typeformSync_(user) {
  const token = PropertiesService.getScriptProperties().getProperty('TYPEFORM_TOKEN');
  if (!token) throw new Error('invalid_typeform_not_configured');
  const st = settings_();
  const forms = {};
  ['en', 'es'].forEach(l => { if (st['typeformModuleFormId_' + l]) forms[st['typeformModuleFormId_' + l]] = 1; });
  rows_('Cohorts').forEach(c => { if (c.moduleFeedbackFormId) forms[c.moduleFeedbackFormId] = 1; });
  const formIds = Object.keys(forms);
  if (!formIds.length) throw new Error('invalid_typeform_no_forms');
  const H = { Authorization: 'Bearer ' + token };
  const known = {}; rows_('ModuleFeedback').forEach(m => { if (m.externalId) known[m.externalId] = 1; });
  const blocks = rows_('Blocks'), cohorts = rows_('Cohorts');
  const result = { forms: formIds.length, imported: 0, skipped: 0, unmatched: [] };
  formIds.forEach(fid => {
    const defR = UrlFetchApp.fetch(CONFIG.TYPEFORM_API_URL + '/forms/' + encodeURIComponent(fid), { headers: H, muteHttpExceptions: true });
    if (defR.getResponseCode() !== 200) { result.unmatched.push('form ' + fid + ': HTTP ' + defR.getResponseCode()); return; }
    const def = JSON.parse(defR.getContentText());
    const fieldType = {}; const order = [];
    const walk = fs => (fs || []).forEach(f => { fieldType[f.id] = f.type; order.push(f.id); if (f.properties && f.properties.fields) walk(f.properties.fields); });
    walk(def.fields);
    let before = '';
    for (let page = 0; page < 20; page++) {
      const url = CONFIG.TYPEFORM_API_URL + '/forms/' + encodeURIComponent(fid) + '/responses?page_size=1000&completed=true' + (before ? '&before=' + encodeURIComponent(before) : '');
      const r = UrlFetchApp.fetch(url, { headers: H, muteHttpExceptions: true });
      if (r.getResponseCode() !== 200) { result.unmatched.push('responses ' + fid + ': HTTP ' + r.getResponseCode()); break; }
      const data = JSON.parse(r.getContentText());
      const items = data.items || [];
      const recs = [];
      items.forEach(it => {
        const rid = it.response_id || it.token;
        if (!rid || known[rid]) { result.skipped++; return; }
        const hid = it.hidden || {};
        const answers = (it.answers || []).slice().sort((a, b) => order.indexOf(a.field.id) - order.indexOf(b.field.id));
        const nums = [], texts = []; let ansEmail = '';
        answers.forEach(a => {
          if (a.type === 'number') nums.push(a.number);
          else if (a.type === 'text') texts.push(a.text);
          else if (a.type === 'email') ansEmail = a.email;
          else if (a.type === 'choice' && a.choice) texts.push('§' + (a.choice.label || ''));
        });
        const email = normEmail_(hid.email || ansEmail);
        let cohortId = hid.cohort && cohorts.some(c => c.id === hid.cohort) ? hid.cohort : '';
        let blockId = hid.module && blocks.some(x => x.id === hid.module) ? hid.module : '';
        if (!cohortId && email) { const le = latestEnrollment_(email); if (le) cohortId = le.cohort.id; }
        if (cohortId && !blockId) {
          const choice = texts.find(t => t.charAt(0) === '§');
          const m = choice && choice.match(/(\d+)/);
          const bl = m && blocks.find(x => x.cohortId === cohortId && x.number === m[1]);
          if (bl) blockId = bl.id;
        }
        if (!cohortId || !blockId) { result.unmatched.push(rid + (email ? ' (' + email + ')' : '')); return; }
        const bl = blocks.find(x => x.id === blockId);
        const plain = texts.filter(t => t.charAt(0) !== '§');
        const rec = { id: newId_('M'), cohortId: cohortId, blockId: blockId, date: String(it.submitted_at || '').slice(0, 10), email: email,
          nameRaw: email ? '' : clean_(hid.name, 120), smeName: bl.smeName, smeEmail: bl.smeEmail, applied: clean_(plain[0], 3000), suggest: clean_(plain[1], 3000),
          source: 'typeform', externalId: rid, createdAt: new Date().toISOString() };
        for (let i = 0; i < 5; i++) rec['q' + (i + 1)] = score_(nums[i], 1, 10);
        recs.push(rec); known[rid] = 1;
      });
      if (recs.length) { insert_('ModuleFeedback', recs); result.imported += recs.length; }
      if (items.length < 1000) break;
      before = items[items.length - 1].token;
    }
  });
  upsert_('Settings', [{ key: 'typeformLastSync', value: new Date().toISOString() }]);
  result.unmatched = result.unmatched.slice(0, 30);
  return Object.assign({ ok: true }, result);
}

/* =================================================================================
 *  IMPORT (JSON produced by tools/migrate.py from the old "Cohort X - Matrix" sheets)
 * ================================================================================= */
function importCohort_(b, user) {
  const d = b.data || {};
  if (d.format !== 'epm-import') throw new Error('invalid_import_format');
  const c = d.cohort || {};
  const existing = rows_('Cohorts').find(x => x.name.toLowerCase() === String(c.name || '').toLowerCase());
  if (existing) {
    if (!b.replace) throw new Error('invalid_name_exists');
    cohortDelete_({ id: existing.id, confirm: 'DELETE' });
  }
  const now = new Date().toISOString();
  const cohort = { id: newId_('C'), name: clean_(c.name, 80), code: clean_(c.code, 40), language: c.language === 'es' ? 'es' : 'en', startDate: cleanDate_(c.startDate),
    status: OPTIONS.cohortStatus.indexOf(c.status) >= 0 ? c.status : 'Active', teachableBundleId: clean_(c.teachableBundleId, 20), createdAt: now, updatedAt: now,
    notes: 'Imported from ' + clean_(d.source, 120) + ' on ' + today_() };
  insert_('Cohorts', [cohort]);
  const bk = {}, sk = {};
  const blocks = (d.blocks || []).map((x, i) => { const id = newId_('B'); bk[x.key] = id; return { id: id, cohortId: cohort.id, order: i + 1, kind: x.kind, number: clean_(x.number, 10),
    title: clean_(x.title, 200), smeName: clean_(x.smeName, 80), smeEmail: '', smeSeesFeedback: false, teachableCourseId: clean_(x.teachableCourseId, 20) }; });
  const sessions = (d.sessions || []).map((x, i) => { const id = newId_('S'); sk[x.key] = id; return { id: id, cohortId: cohort.id, blockId: bk[x.blockKey], order: i + 1,
    date: cleanDate_(x.date), moduleNo: clean_(x.moduleNo, 12), moduleTitle: clean_(x.moduleTitle, 200), smeName: '', smeEmail: '',
    defreeze: clean_(x.defreeze, 1000), recordingUrl: clean_(x.recordingUrl, 1000), notes: clean_(x.notes, 1000) }; });
  // SME names → existing user emails when the name matches a user
  const users = rows_('Users');
  blocks.forEach(x => { const u = users.find(u => x.smeName && u.name && u.name.toLowerCase().indexOf(x.smeName.toLowerCase().replace(/\.$/, '')) === 0); if (u) x.smeEmail = u.email; });
  insert_('Blocks', blocks);
  insert_('Sessions', sessions);

  // learners: keep existing values, fill what is empty
  const existingL = {}; rows_('Learners').forEach(l => existingL[l.email] = l);
  const newL = [];
  (d.learners || []).forEach(x => {
    const email = normEmail_(x.email); if (!isEmail_(email)) return;
    const rec = { email: email, firstName: clean_(x.firstName, 80), lastName: clean_(x.lastName, 80), company: clean_(x.company, 160), jobTitle: clean_(x.jobTitle, 160),
      profile: (x.profile || []).map(p => clean_(p, 60)), birthday: cleanDate_(x.birthday), address: clean_(x.address, 500), phone: clean_(x.phone, 60),
      P: numOrNull_(x.P), A: numOrNull_(x.A), E: numOrNull_(x.E), I: numOrNull_(x.I), lifecycle: clean_(x.lifecycle, 40), welcomeKit: clean_(x.welcomeKit, 20),
      booksCode: clean_(x.booksCode, 40) };
    const old = existingL[email];
    if (old) {
      const patch = {};
      Object.keys(rec).forEach(k => { const v = rec[k]; const empty = old[k] == null || old[k] === '' || (Array.isArray(old[k]) && !old[k].length);
        if (empty && v != null && v !== '' && !(Array.isArray(v) && !v.length)) patch[k] = v; });
      if (Object.keys(patch).length) update_('Learners', email, patch);
    } else {
      rec.profileToken = randomToken_(32); rec.createdAt = now; rec.updatedAt = now;
      newL.push(rec); existingL[email] = rec;
    }
  });
  if (newL.length) insert_('Learners', newL);
  // people who left: their status applies from their last session attended (the PM can correct it)
  const sessDate = {}; (d.sessions || []).forEach(x => { sessDate[x.key] = cleanDate_(x.date); });
  const firstDate = Object.keys(sessDate).map(k => sessDate[k]).filter(Boolean).sort()[0] || '';
  const lastPresent = {};
  (d.attendance || []).forEach(a => { const dt = sessDate[a.sessionKey]; const em = normEmail_(a.email);
    if (a.status === 'Present' && dt && (!lastPresent[em] || dt > lastPresent[em])) lastPresent[em] = dt; });
  insert_('Enrollments', (d.enrollments || []).filter(x => isEmail_(normEmail_(x.email))).map(x => {
    const status = x.status === 'Enrolled Inactive' ? 'Low Activity' : (OPTIONS.enrollmentStatus.indexOf(x.status) >= 0 ? x.status : 'Enrolled Active');
    return { id: newId_('E'), email: normEmail_(x.email), cohortId: cohort.id, status: status, welcomeEmailSent: !!x.welcomeEmailSent,
      certificationSent: OPTIONS.certification.indexOf(x.certificationSent) >= 0 ? x.certificationSent : '', statusChangedAt: now, createdAt: now,
      statusDate: NO_LIVE_STATUSES.indexOf(status) >= 0 ? (lastPresent[normEmail_(x.email)] || firstDate) : '' };
  }));

  // name → email across ALL learners (people moved between cohorts appear by name in other sheets)
  const byName = {};
  Object.keys(existingL).forEach(e => { const l = existingL[e]; byName[normName_((l.firstName || '') + ' ' + (l.lastName || ''))] = e; });
  const resolve = (email, nameRaw) => { if (email) return [normEmail_(email), '']; const e = byName[normName_(nameRaw)]; return e ? [e, ''] : ['', clean_(nameRaw, 120)]; };

  const att = {};
  (d.attendance || []).forEach(a => { if (!sk[a.sessionKey]) return; const id = sk[a.sessionKey] + '|' + normEmail_(a.email);
    att[id] = { id: id, cohortId: cohort.id, sessionId: sk[a.sessionKey], email: normEmail_(a.email), status: a.status, source: 'import', updatedAt: now }; });
  insert_('Attendance', Object.keys(att).map(k => att[k]));
  insert_('WeeklyFeedback', (d.weeklyFeedback || []).map(w => { const r = resolve(w.email, w.nameRaw); const rec = { id: newId_('W'), cohortId: cohort.id,
    sessionId: sk[w.sessionKey] || '', blockId: bk[w.blockKey] || '', date: cleanDate_(w.date), email: r[0], nameRaw: r[1], smeName: clean_(w.smeName, 80),
    improve: clean_(w.improve, 3000), comments: clean_(w.comments, 3000), source: 'import', createdBy: user.email, createdAt: now };
    for (let i = 1; i <= 5; i++) rec['q' + i] = score_(w['q' + i], 1, 5); return rec; }));
  insert_('ModuleFeedback', (d.moduleFeedback || []).map(w => { const r = resolve(w.email, w.nameRaw); const rec = { id: newId_('M'), cohortId: cohort.id,
    blockId: bk[w.blockKey] || '', date: cleanDate_(w.date), email: r[0], nameRaw: r[1], smeName: clean_(w.smeName, 80), applied: clean_(w.applied, 3000),
    suggest: clean_(w.suggest, 3000), source: 'import', createdAt: now };
    for (let i = 1; i <= 5; i++) rec['q' + i] = score_(w['q' + i], 1, 10); return rec; }));
  insert_('Conversations', (d.conversations || []).map(v => { const r = resolve(v.email, v.nameRaw); return { id: newId_('V'), cohortId: cohort.id, email: r[0], nameRaw: r[1],
    date: cleanDate_(v.date), withName: clean_(v.withName, 120), initiatedBy: OPTIONS.initiatedBy.indexOf(v.initiatedBy) >= 0 ? v.initiatedBy : 'Adizes',
    via: (v.via || []).map(x => matchOption_(x, OPTIONS.via)).filter(Boolean), categories: (v.categories || []).map(x => matchOption_(x, OPTIONS.categories)).filter(Boolean),
    description: clean_(v.description, 2000), status: matchOption_(v.status, OPTIONS.convStatus) || 'Completed', comments: clean_(v.comments, 2000),
    createdBy: user.email, createdAt: now }; }));
  insert_('Goals', (d.goals || []).filter(g => isEmail_(normEmail_(g.email))).map(g => { const rec = { id: cohort.id + '|' + normEmail_(g.email), cohortId: cohort.id, email: normEmail_(g.email), submittedAt: '' };
    for (let i = 0; i < 8; i++) rec['a' + (i + 1)] = clean_((g.answers || [])[i], 3000); return rec; }));
  const lms = {};
  (d.lmsSnapshot || []).forEach(p => { const bid = bk[p.blockKey]; if (!bid) return; const bl = blocks.find(x => x.id === bid); const id = cohort.id + '|' + normEmail_(p.email) + '|' + bid;
    lms[id] = { id: id, cohortId: cohort.id, email: normEmail_(p.email), blockId: bid, courseId: bl.teachableCourseId, percent: numOrNull_(p.percent), source: 'import', updatedAt: now }; });
  insert_('LmsProgress', Object.keys(lms).map(k => lms[k]));
  return { ok: true, id: cohort.id, counts: { blocks: blocks.length, sessions: sessions.length, learners: (d.learners || []).length, newLearners: newL.length,
    attendance: Object.keys(att).length, weekly: (d.weeklyFeedback || []).length, module: (d.moduleFeedback || []).length, conversations: (d.conversations || []).length } };
}
function matchOption_(v, list) {
  const n = String(v || '').trim().toLowerCase();
  return list.find(o => o.toLowerCase() === n) || '';
}

/* =================================================================================
 *  SCHEDULED JOBS
 * ================================================================================= */
function dailyJobs() {
  MEMO_ = {};
  migrate_();
  const system = { email: 'system', name: 'System', role: 'PM' };
  const t = today_();
  rows_('Cohorts').filter(c => c.status === 'Active').forEach(c => {
    try { withLock_(() => lmsSync_(c.id, system)); } catch (e) { console.error('lms ' + c.name, e); }
    MEMO_ = {};
  });
  try { if (PropertiesService.getScriptProperties().getProperty('TYPEFORM_TOKEN')) withLock_(() => typeformSync_(system)); } catch (e) { console.error('typeform', e); }
  // housekeeping: expired auth sessions
  MEMO_ = {};
  withLock_(() => { const keep = rows_('AuthSessions').filter(s => s.expiresAt > new Date().toISOString()); if (keep.length !== rows_('AuthSessions').length) rewrite_('AuthSessions', keep); });
  return t;
}

/* =================================================================================
 *  DATA MIGRATIONS — run automatically (sign-in bootstrap, nightly job, setup)
 *  v2: "Enrolled Inactive" → "Low Activity"; Dropped / Moved / Asynchronous get the date
 *      their status applies from (last session attended, or the cohort start).
 * ================================================================================= */
function migrate_() {
  if (Number(settings_().schemaVersion || 1) >= SCHEMA_VERSION) return;
  withLock_(() => {
    MEMO_ = {};
    if (Number(settings_().schemaVersion || 1) >= SCHEMA_VERSION) return;
    const sess = {}, firstDate = {}, lastPresent = {};
    rows_('Sessions').forEach(x => { sess[x.id] = x; if (x.date && (!firstDate[x.cohortId] || x.date < firstDate[x.cohortId])) firstDate[x.cohortId] = x.date; });
    rows_('Attendance').forEach(a => {
      const x = sess[a.sessionId]; if (a.status !== 'Present' || !x || !x.date) return;
      const k = a.cohortId + '|' + a.email; if (!lastPresent[k] || x.date > lastPresent[k]) lastPresent[k] = x.date;
    });
    let changed = false;
    const out = rows_('Enrollments').map(e => {
      let o = e;
      if (o.status === 'Enrolled Inactive') { o = Object.assign({}, o, { status: 'Low Activity' }); changed = true; }
      if (NO_LIVE_STATUSES.indexOf(o.status) >= 0 && !o.statusDate) {
        o = Object.assign({}, o, { statusDate: lastPresent[o.cohortId + '|' + o.email] || firstDate[o.cohortId] || '' }); changed = true;
      }
      return o;
    });
    if (changed) rewrite_('Enrollments', out);
    upsert_('Settings', [{ key: 'schemaVersion', value: String(SCHEMA_VERSION) }]);
  });
}

/* =================================================================================
 *  SHEET-AS-DATABASE LAYER
 * ================================================================================= */
let MEMO_ = {};

function table_(name) {
  if (MEMO_[name]) return MEMO_[name];
  const def = SCHEMA[name];
  if (!def) throw new Error('no table ' + name);
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, def.cols.length).setNumberFormat('@').setValues([def.cols]).setFontWeight('bold').setBackground('#111111').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const lastRow = sh.getLastRow();
  const values = lastRow >= 1 ? sh.getRange(1, 1, lastRow, lastCol).getValues() : [[]];
  let heads = (values[0] || []).map(h => String(h).trim());
  const missing = def.cols.filter(c => heads.indexOf(c) < 0);
  if (missing.length) {
    const start = heads.filter(h => h !== '').length + 1;
    sh.getRange(1, start, 1, missing.length).setNumberFormat('@').setValues([missing]).setFontWeight('bold').setBackground('#111111').setFontColor('#ffffff');
    heads = heads.slice(0, start - 1).concat(missing);
  }
  const idx = {}; heads.forEach((h, i) => { if (h) idx[h] = i; });
  const types = def.types || {};
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const v = values[r];
    if (v.every(x => x === '' || x == null)) continue;
    const o = { _r: r + 1 };
    def.cols.forEach(c => { o[c] = parse_(v[idx[c]], types[c]); });
    rows.push(o);
  }
  MEMO_[name] = { sh: sh, def: def, idx: idx, width: heads.length, rows: rows };
  return MEMO_[name];
}

function rows_(name) { return table_(name).rows; }

function parse_(v, type) {
  if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (v == null) v = '';
  if (type === 'n') { if (v === '') return null; const n = Number(v); return isNaN(n) ? null : n; }
  if (type === 'b') return v === true || String(v).toUpperCase() === 'TRUE';
  if (type === 'j') { if (v === '') return null; try { return JSON.parse(v); } catch (e) { return null; } }
  return String(v);
}
function ser_(v) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return isFinite(v) ? String(v) : '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function rowValues_(t, o) {
  const out = new Array(t.width).fill('');
  t.def.cols.forEach(c => { out[t.idx[c]] = ser_(o[c]); });
  return out;
}
function writeBlock_(t, startRow, matrix) {
  if (!matrix.length) return;
  const need = startRow + matrix.length - 1;
  const max = t.sh.getMaxRows();
  if (need > max) t.sh.insertRowsAfter(max, need - max + 50);
  t.sh.getRange(startRow, 1, matrix.length, t.width).setNumberFormat('@').setValues(matrix);
}
function nextRow_(t) { return t.rows.reduce((m, r) => Math.max(m, r._r), 1) + 1; }

function insert_(name, objs) {
  if (!objs.length) return;
  const t = table_(name);
  const start = nextRow_(t);
  writeBlock_(t, start, objs.map(o => rowValues_(t, o)));
  objs.forEach((o, i) => { const c = Object.assign({}, o); c._r = start + i; normalizeRow_(t, c); t.rows.push(c); });
}
function normalizeRow_(t, o) {
  t.def.cols.forEach(c => { o[c] = parse_(ser_(o[c]), (t.def.types || {})[c]); });
}
function update_(name, key, patch) {
  const t = table_(name);
  const row = t.rows.find(r => r[t.def.key] === key);
  if (!row) throw new Error('not_found');
  Object.assign(row, patch);
  normalizeRow_(t, row);
  writeBlock_(t, row._r, [rowValues_(t, row)]);
  return row;
}
function upsert_(name, objs) {
  const t = table_(name);
  const k = t.def.key;
  const index = {}; t.rows.forEach(r => index[r[k]] = r);
  const fresh = [];
  const changed = [];
  objs.forEach(o => {
    const ex = index[o[k]];
    if (ex) { Object.assign(ex, o); normalizeRow_(t, ex); changed.push(ex); }
    else { fresh.push(o); index[o[k]] = o; }
  });
  if (changed.length > 20) rewrite_(name, t.rows);
  else changed.forEach(r => writeBlock_(t, r._r, [rowValues_(t, r)]));
  insert_(name, fresh);
}
// Rewrites the whole table (used for deletes and large updates)
function rewrite_(name, objs) {
  const t = table_(name);
  const keep = objs.map(o => Object.assign({}, o));
  const oldLast = Math.max(t.sh.getLastRow(), 1);
  if (oldLast > 1) t.sh.getRange(2, 1, oldLast - 1, t.width).clearContent();
  writeBlock_(t, 2, keep.map(o => rowValues_(t, o)));
  keep.forEach((o, i) => { o._r = i + 2; normalizeRow_(t, o); });
  t.rows = keep;
}
function strip_(o) { const c = {}; Object.keys(o).forEach(k => { if (k !== '_r') c[k] = o[k]; }); return c; }
function pick_(o, keys) { const c = {}; keys.forEach(k => c[k] = o[k]); return c; }
function byOrder_(a, b) { return (a.order || 0) - (b.order || 0); }

let LOCK_DEPTH_ = 0;
function withLock_(fn) {
  if (LOCK_DEPTH_ > 0) return fn();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  LOCK_DEPTH_++;
  try { return fn(); } finally { LOCK_DEPTH_--; lock.releaseLock(); }
}

// Appends one row without reading the (ever-growing) Log tab
function log_(email, action, detail) {
  if (!SpreadsheetApp.getActive().getSheetByName('Log')) table_('Log');
  const sh = SpreadsheetApp.getActive().getSheetByName('Log');
  const r = sh.getLastRow() + 1;
  if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 500);
  sh.getRange(r, 1, 1, 4).setNumberFormat('@').setValues([[new Date().toISOString(), email, action, detail]]);
}

/* =================================================================================
 *  SMALL UTILITIES
 * ================================================================================= */
function clean_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, max || 200); }
function normEmail_(v) { return String(v == null ? '' : v).trim().toLowerCase().slice(0, 160); }
function isEmail_(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '')); }
function cleanDate_(v) { const s = String(v == null ? '' : v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
function numOrNull_(v) { if (v === '' || v == null) return null; const n = Number(v); return isNaN(n) ? null : n; }
function score_(v, min, max) { const n = numOrNull_(v); return n == null || n < min || n > max ? null : n; }
function avg_(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
function normName_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9@. ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fill_(tpl, map) { return String(tpl).replace(/\{(\w+)\}/g, (m, k) => map[k] != null ? map[k] : m); }
function today_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function sha_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}
function randomToken_(n) {
  let s = '';
  while (s.length < n) s += Utilities.getUuid().replace(/-/g, '');
  return s.slice(0, n);
}
function newId_(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = ''; for (let i = 0; i < 8; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return prefix + r;
}

/* =================================================================================
 *  SETUP — run once from the editor: select "setup" and press ▶ Run
 * ================================================================================= */
function setup() {
  MEMO_ = {};
  Object.keys(SCHEMA).forEach(t => table_(t));
  migrate_();
  const me = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  const pms = CONFIG.INITIAL_PMS.concat(me && CONFIG.ALLOWED_DOMAINS.some(d => me.endsWith('@' + d)) ? [me] : []);
  pms.forEach(email => {
    if (!findUser_(email)) insert_('Users', [{ email: email, name: email.split('@')[0], role: 'PM', active: true, invitedBy: 'setup', createdAt: new Date().toISOString() }]);
  });
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'dailyJobs') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyJobs').timeBased().everyDays(1).atHour(5).create();
  // Touch the services once so Google asks for every permission now
  GmailApp.getAliases();
  CacheService.getScriptCache().get('x');
  Logger.log('Ready. Tables created; Program Managers: ' + pms.join(', ') + '. Daily sync scheduled at 5 am.');
}

/* =================================================================================
 *  DEFAULT PROGRAM TEMPLATE (structure of the latest English cohort). Used by
 *  "New cohort → Start from the default template". Dates are generated by the app.
 * ================================================================================= */
const DEFAULT_TEMPLATE = [
 {
  "kind": "welcome",
  "number": "0",
  "title": "Welcome",
  "smeName": "",
  "modules": [
   {
    "no": "0",
    "title": "Welcome to the program",
    "sessions": 1
   }
  ]
 },
 {
  "kind": "course",
  "number": "1",
  "title": "Introduction to Adizes Methodology",
  "smeName": "Shoham",
  "modules": [
   {
    "no": "1",
    "title": "The Adizes Conceptual Map",
    "sessions": 2
   }
  ]
 },
 {
  "kind": "course",
  "number": "2",
  "title": "Adizes Model of Diverse Management Styles",
  "smeName": "Rodrigo",
  "modules": [
   {
    "no": "2.1",
    "title": "Comprehending the Dynamics of Change",
    "sessions": 2
   },
   {
    "no": "2.2",
    "title": "Managerial Roles",
    "sessions": 2
   },
   {
    "no": "2.3",
    "title": "Leadership Styles",
    "sessions": 2
   }
  ]
 },
 {
  "kind": "course",
  "number": "3",
  "title": "Foundations of CAPI for Decision Implementation",
  "smeName": "Joaquin",
  "modules": [
   {
    "no": "3.1",
    "title": "Establishing Control Over a Problem",
    "sessions": 2
   },
   {
    "no": "3.2",
    "title": "Coalescing Authority, Power & Influence",
    "sessions": 2
   },
   {
    "no": "3.3",
    "title": "Applying CAPI",
    "sessions": 2
   }
  ]
 },
 {
  "kind": "course",
  "number": "4",
  "title": "Adizes Concept of Corporate Lifecycles",
  "smeName": "Rodrigo",
  "modules": [
   {
    "no": "4.1",
    "title": "Identifying the Early Lifecycle Stages",
    "sessions": 2
   },
   {
    "no": "4.2",
    "title": "Management Professionalization",
    "sessions": 2
   },
   {
    "no": "4.3",
    "title": "Existing Companies Lifecycle",
    "sessions": 2
   }
  ]
 },
 {
  "kind": "case_study",
  "number": "CS1",
  "title": "Case Study 1",
  "smeName": "Greg",
  "modules": [
   {
    "no": "CS.1",
    "title": "Analyzing Case Study - 1",
    "sessions": 2
   }
  ]
 },
 {
  "kind": "course",
  "number": "5",
  "title": "Adizes Business and Operational Best Practices",
  "smeName": "David",
  "modules": [
   {
    "no": "5.1",
    "title": "Creating an Organizational Holistic Approach for Complexity of Change",
    "sessions": 2
   },
   {
    "no": "5.2",
    "title": "Building Effective and Efficient Teams and Management Techniques",
    "sessions": 2
   },
   {
    "no": "5.3",
    "title": "Navigating the Tension Between Long- and Short-Term Goals",
    "sessions": 2
   }
  ]
 },
 {
  "kind": "course",
  "number": "6",
  "title": "Adizes Problem Diagnosis and Sensemaking",
  "smeName": "Shoham",
  "modules": [
   {
    "no": "6.1",
    "title": "Analyzing what Organizational Transformation is and How it is Achieved",
    "sessions": 2
   },
   {
    "no": "6.2",
    "title": "Understanding the Chain of Causality Toward Problem Solving",
    "sessions": 2
   },
   {
    "no": "6.3",
    "title": "Understanding the Solution Chain and the Adizes Program for Organizational Transformation",
    "sessions": 2
   }
  ]
 },
 {
  "kind": "course",
  "number": "7",
  "title": "Conflict Sources and Adizes Facilitation Process",
  "smeName": "Shoham",
  "modules": [
   {
    "no": "7.1",
    "title": "The Collaborative Team Problem-Solving Matrix",
    "sessions": 2
   },
   {
    "no": "7.2",
    "title": "Understanding and Harnessing Conflict",
    "sessions": 2
   },
   {
    "no": "7.3",
    "title": "Illustrating the Tool and \"The Big Picture\"",
    "sessions": 2
   }
  ]
 },
 {
  "kind": "case_study",
  "number": "CS2",
  "title": "Case Study 2",
  "smeName": "Juan Jose",
  "modules": [
   {
    "no": "CS.2",
    "title": "Analyzing Case Study - 2",
    "sessions": 2
   }
  ]
 },
 {
  "kind": "course",
  "number": "8",
  "title": "Adizes Model of Institutional Strategic Direction",
  "smeName": "Pavel",
  "modules": [
   {
    "no": "8.1",
    "title": "Setting the Grand Strategy",
    "sessions": 2
   },
   {
    "no": "8.2",
    "title": "Applying Practical Considerations of Capabilities",
    "sessions": 2
   },
   {
    "no": "8.3",
    "title": "Challenging the Purpose, Values, and Beliefs in an Organization",
    "sessions": 2
   },
   {
    "no": "8.4",
    "title": "Determining Important Changes to Organizations to Address Threats and Opportunities",
    "sessions": 2
   }
  ]
 },
 {
  "kind": "course",
  "number": "9",
  "title": "Organizational Structure",
  "smeName": "Rufat",
  "modules": [
   {
    "no": "9.1",
    "title": "Fundamentals of Organizing",
    "sessions": 2
   },
   {
    "no": "9.2",
    "title": "Organizational Hierarchy",
    "sessions": 2
   },
   {
    "no": "9.3",
    "title": "Organizational Portfolio",
    "sessions": 2
   },
   {
    "no": "9.4",
    "title": "Vertical Alignment",
    "sessions": 2
   },
   {
    "no": "9.5",
    "title": "Interdependence and Coordination",
    "sessions": 2
   }
  ]
 },
 {
  "kind": "course",
  "number": "10",
  "title": "Organizational Design",
  "smeName": "Rufat",
  "modules": [
   {
    "no": "10.1",
    "title": "Design Architecture",
    "sessions": 2
   },
   {
    "no": "10.2",
    "title": "Design Specification",
    "sessions": 2
   },
   {
    "no": "10.3",
    "title": "Design Activation",
    "sessions": 2
   }
  ]
 },
 {
  "kind": "case_study",
  "number": "CS3",
  "title": "Case Study 3",
  "smeName": "Zvezdan",
  "modules": [
   {
    "no": "CS.3",
    "title": "Analyzing Case Study - 3",
    "sessions": 2
   }
  ]
 },
 {
  "kind": "wrapup",
  "number": "W",
  "title": "Wrap-Up",
  "smeName": "",
  "modules": [
   {
    "no": "",
    "title": "Q&A and Graduation",
    "sessions": 2
   }
  ]
 }
];
