#!/usr/bin/env python3
"""
Convert a legacy "Cohort X - Matrix.xlsx" (Google Sheets export) into an import JSON
for the Exec Program Manager (Settings → Import data).

    python3 tools/migrate.py "Cohort 4 - Matrix.xlsx" --name "Cohort 4" --out cohort-4.json
    python3 tools/migrate.py "Cohort 1 SPA - Matrix.xlsx" --name "Cohort 1 SPA" --lang es --out spa-1.json

The output contains personal data: NEVER commit it to the (public) repository.

Rules
- Sessions come from "Defreezes & Recordings" (it is the sheet the PM keeps up to date).
  Attendance is matched by SESSION NUMBER, not by date (some matrices were copied from
  another cohort and their Attendance/Calendar dates are stale).
- Module titles come from row 2 of "Attendance"; SMEs from "Weekly Feedback" (most
  frequent SME per block), falling back to "Calendar".
- People are matched by email; sheets that only have a name are matched to the
  General sheet by (accent-insensitive, fuzzy) name.
"""
import argparse, datetime as dt, difflib, json, re, sys, unicodedata
from collections import Counter, defaultdict

import openpyxl

# Teachable bundle + course IDs known from the existing Apps Script tracker (program order:
# Welcome, Course 1, Course 2, ...). Cohorts not listed here are filled in later in the app.
TEACHABLE = {
    'Cohort 3': (677482, [2871771, 2884348, 2884405, 2884404, 2884403, 2884402, 2884401, 2884399, 2884398, 2884400]),
    'Cohort 4': (734805, [2930595, 2930594, 2930596, 2930597, 2930598, 2930599, 2930600, 2990355, 2990356, 2990357]),
    'Cohort 5': (764303, [2967542, 2973836, 2979847, 2981927, 2990358, 2990359, 2990360, 2990361, 2990362, 2990363]),
    'Cohort 6': (783728, [2990364, 2990366, 2990368, 2990372, 2990369, 2990370, 2984479, 2984480, 2990371]),
}

STATUS_MAP = {
    'enrrolled active': 'Enrolled Active', 'enrolled active': 'Enrolled Active',
    'enrrolled inactive': 'Enrolled Inactive', 'enrolled inactive': 'Enrolled Inactive',
    'dropped out': 'Dropped Out', 'moved to next cohort': 'Moved to next cohort',
    'graduated': 'Graduated', 'asynchronous': 'Asynchronous',
}
LIFECYCLE_MAP = {'adolescense': 'Adolescence', 'go go': 'Go-Go', 'gogo': 'Go-Go'}


def norm(s):
    s = unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9@. ]+', ' ', s)).strip()


def text(v):
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).strip()
    return '' if s in ('#REF!', '#N/A', '#VALUE!', 'None') else s


def day(v):
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    return ''


def num(v):
    try:
        f = float(str(v).replace('%', '').strip())
        return f
    except (TypeError, ValueError):
        return None


def header_index(row, *names):
    for i, h in enumerate(row):
        h = norm(h)
        for n in names:
            if h.startswith(norm(n)):
                return i
    return None


class People:
    """Name → email resolver built from the General sheet."""

    def __init__(self):
        self.by_name = {}
        self.emails = set()

    def add(self, name, email, first='', last=''):
        email = email.lower()
        self.emails.add(email)
        for n in {name, f'{first} {last}', f'{first} {last.split(" ")[0] if last else ""}'}:
            if norm(n):
                self.by_name.setdefault(norm(n), email)

    def find(self, name):
        n = norm(name)
        if not n:
            return ''
        if '@' in n and n in self.emails:
            return n
        if n in self.by_name:
            return self.by_name[n]
        # first + last token
        toks = n.split()
        for k, e in self.by_name.items():
            kt = k.split()
            if len(toks) >= 2 and len(kt) >= 2 and toks[0] == kt[0] and toks[-1] in kt:
                return e
        best = difflib.get_close_matches(n, list(self.by_name), n=1, cutoff=0.82)
        return self.by_name[best[0]] if best else ''


def block_kind(title):
    t = norm(title)
    if t.startswith('welcome'):
        return 'welcome'
    if 'case stud' in t:
        return 'case_study'
    if 'graduation' in t or 'wrap' in t or t.startswith('q a') or 'conclusion' in t:
        return 'wrapup'
    if 'recap' in t or 'summariz' in t:
        return 'other'
    return 'course'


def clean_block_title(title, kind, cs_no):
    t = re.sub(r'\s+', ' ', str(title)).strip()
    if kind == 'welcome':
        return 'Welcome'
    if kind == 'case_study':
        return f'Case Study {cs_no}'
    if kind == 'wrapup':
        return 'Wrap-Up'
    return t


def fix_years(dates):
    """Fix obvious year typos (2026-01-05 after 2026-12-17 → 2027-01-05)."""
    out, prev = [], None
    for d in dates:
        if d and prev:
            a, b = dt.date.fromisoformat(prev), dt.date.fromisoformat(d)
            if b < a - dt.timedelta(days=150):
                try:
                    b2 = b.replace(year=b.year + 1)
                    if b2 >= a:
                        d = b2.isoformat()
                except ValueError:
                    pass
        out.append(d)
        prev = d or prev
    return out


def migrate(path, name, lang):
    wb = openpyxl.load_workbook(path, data_only=True)
    warnings = []
    today = dt.date.today().isoformat()

    # ---------------- General → learners + enrollments ----------------
    ws = wb['General']
    rows = list(ws.iter_rows(values_only=True))
    H = rows[0]
    ix = {k: header_index(H, *v) for k, v in {
        'first': ['First Name'], 'last': ['Last Name'], 'name': ['Name'], 'company': ['Company'],
        'job': ['Job Title'], 'profile': ['Learner Profile'], 'status': ['Learner Status'], 'email': ['Email'],
        'birthday': ['Birthday'], 'address': ['Address'], 'wemail': ['Welcome Email'], 'kit': ['Welcome Kit'],
        'books': ['Books Code'], 'cert': ['Certification'], 'phone': ['Phone'], 'P': ['P'], 'A': ['A'], 'E': ['E'],
        'I': ['I'], 'lc': ['Life Cycle', 'Lifecycle'],
    }.items()}
    # single-letter headers must match exactly
    for k in 'PAEI':
        ix[k] = next((i for i, h in enumerate(H) if text(h) == k), None)
    people = People()
    learners, enrollments = [], []
    for r in rows[1:]:
        g = lambda k: r[ix[k]] if ix.get(k) is not None and ix[k] < len(r) else None
        email = text(g('email')).lower()
        nm = text(g('name')) or (text(g('first')) + ' ' + text(g('last'))).strip()
        if not email or '@' not in email:
            if nm and norm(nm) not in ('all', 'surveys'):
                warnings.append(f'General: "{nm}" has no email → skipped')
            continue
        first, last = text(g('first')), text(g('last'))
        if not first and nm:
            first, last = nm.split(' ', 1)[0], (nm.split(' ', 1) + [''])[1]
        people.add(nm, email, first, last)
        lc = text(g('lc'))
        lc = LIFECYCLE_MAP.get(norm(lc), lc)
        status_raw = text(g('status'))
        status = STATUS_MAP.get(norm(status_raw), status_raw or 'Enrolled Active')
        wemail = g('wemail')
        learners.append({
            'email': email, 'firstName': first, 'lastName': last, 'company': text(g('company')),
            'jobTitle': text(g('job')),
            'profile': [p.strip() for p in text(g('profile')).split(',') if p.strip()],
            'birthday': day(g('birthday')), 'address': text(g('address')), 'phone': text(g('phone')),
            'P': num(g('P')), 'A': num(g('A')), 'E': num(g('E')), 'I': num(g('I')), 'lifecycle': lc,
            'welcomeKit': text(g('kit')), 'booksCode': text(g('books')),
        })
        enrollments.append({
            'email': email, 'status': status,
            'welcomeEmailSent': bool(wemail) and str(wemail).lower() not in ('false', 'no', '0'),
            'certificationSent': text(g('cert')),
        })

    # ---------------- Sessions (Defreezes & Recordings) ----------------
    ws = wb['Defreezes & Recordings']
    blocks, sessions = [], []
    cur = None
    course_no = cs_no = 0
    for r in list(ws.iter_rows(values_only=True))[1:]:
        r = list(r) + [None] * 5
        n, course, date, defreeze, rec = r[0], text(r[1]), r[2], text(r[3]), text(r[4])
        if course:
            kind = block_kind(course)
            if kind == 'course':
                course_no += 1
                number = str(course_no)
            elif kind == 'case_study':
                cs_no += 1
                number = f'CS{cs_no}'
            elif kind == 'welcome':
                number = '0'
            elif kind == 'wrapup':
                number = 'W'
            else:
                number = ''
            cur = {'key': f'B{len(blocks) + 1}', 'order': len(blocks) + 1, 'kind': kind, 'number': number,
                   'title': clean_block_title(course, kind, cs_no), 'smeName': '', 'teachableCourseId': ''}
            blocks.append(cur)
        if cur is None:
            continue
        if n is None and not day(date):
            # extra recording row (e.g. "Just introductions:") → attach to previous session
            if sessions and rec:
                s = sessions[-1]
                s['recordingUrl'] = (s['recordingUrl'] + '\n' + rec).strip()
                if defreeze:
                    s['notes'] = (s.get('notes', '') + ' ' + defreeze).strip()
            continue
        if n is None:
            if not day(date):
                continue
            n = 0 if cur['kind'] == 'welcome' and not sessions else (sessions[-1]['number'] + 1 if sessions else 0)
        sessions.append({'key': f'S{int(num(n))}', 'number': int(num(n)), 'blockKey': cur['key'],
                         'date': day(date), 'defreeze': defreeze, 'recordingUrl': rec,
                         'moduleTitle': '', 'moduleNo': ''})
    for s, d in zip(sessions, fix_years([s['date'] for s in sessions])):
        if s['date'] != d:
            warnings.append(f'Session {s["number"]}: date {s["date"]} looked like a year typo → {d}')
        s['date'] = d

    # ---------------- Attendance (module titles + marks) ----------------
    ws = wb['Attendance']
    arows = list(ws.iter_rows(values_only=True))
    session_cols = {}
    titles_row, labels_row, blocks_row = arows[1], arows[2], arows[0]
    regions, reg = [], None
    for c in range(5, max(len(labels_row), len(blocks_row))):
        bt = text(blocks_row[c]) if c < len(blocks_row) else ''
        if bt and norm(bt) not in ('welcome',):
            if 'attendance' in norm(bt) or reg is None or reg['title']:
                mnum = re.match(r'course\s*(\d+)', norm(bt))
                reg = {'title': '' if 'attendance' in norm(bt) else bt, 'modules': [],
                       'num': mnum.group(1) if mnum else ''}
                regions.append(reg)
            else:
                reg['title'] = bt
        lab = labels_row[c] if c < len(labels_row) else None
        m = re.match(r'session\s*(\d+)', norm(lab))
        if not m or reg is None:
            continue
        t = text(titles_row[c]) if c < len(titles_row) else ''
        if t or not reg['modules']:
            reg['modules'].append([t, 0])
        reg['modules'][-1][1] += 1
        session_cols[int(m.group(1))] = (c, '')
    welcome_col = header_index(arows[0], 'Welcome')
    by_num = {s['number']: s for s in sessions}
    if 0 in by_num:
        by_num[0]['moduleTitle'] = 'Welcome to the program'
    used = set()
    for b in blocks:
        bs = [s for s in sessions if s['blockKey'] == b['key']]
        if b['kind'] == 'welcome' or not bs:
            continue
        if b['kind'] == 'case_study':
            cands = [i for i, r in enumerate(regions) if 'case stud' in norm(r['title']) and i not in used]
            pick = cands[0] if cands else None
        else:
            names = {norm(r['title']): i for i, r in enumerate(regions) if i not in used and r['title']}
            best = difflib.get_close_matches(norm(b['title']), list(names), n=1, cutoff=0.6)
            pick = names[best[0]] if best else None
            if pick is None:
                pick = next((i for i, r in enumerate(regions) if i not in used and r.get('num') == b['number']), None)
        if pick is None:
            continue
        used.add(pick)
        seq = []
        for t, k in regions[pick]['modules']:
            seq += [t] * k
        for i, sx in enumerate(bs):
            t = seq[i] if i < len(seq) else (seq[-1] if seq else '')
            sx['moduleTitle'] = t
    # module numbers
    for b in blocks:
        bs = [s for s in sessions if s['blockKey'] == b['key']]
        for s in bs:
            if not s['moduleTitle']:
                s['moduleTitle'] = b['title'] if b['kind'] != 'course' else ''
        titles = []
        for s in bs:
            if s['moduleTitle'] and s['moduleTitle'] not in titles:
                titles.append(s['moduleTitle'])
        for s in bs:
            if b['kind'] == 'course':
                k = titles.index(s['moduleTitle']) + 1 if s['moduleTitle'] in titles else 0
                s['moduleNo'] = f"{b['number']}.{k}" if len(titles) > 1 and k else b['number']
            elif b['kind'] == 'case_study':
                s['moduleNo'] = 'CS.' + b['number'][2:]
            else:
                s['moduleNo'] = b['number'] if b['kind'] == 'welcome' else ''

    attendance = []
    email_col = next((i for i, h in enumerate(arows[1]) if norm(h) == 'email'), 1)
    for r in arows[4:]:
        em = text(r[email_col] if email_col < len(r) else '').lower()
        if '@' not in em:
            continue
        if em not in people.emails:
            em2 = people.find(text(r[0]))
            if em2:
                em = em2
        cols = dict(session_cols)
        if welcome_col is not None:
            cols[0] = (welcome_col, '')
        for n_, (c, _) in cols.items():
            v = norm(r[c] if c < len(r) else '')
            st = {'present': 'Present', 'online': 'Present', 'absent': 'Absent'}.get(v)
            if st and n_ in by_num:
                attendance.append({'sessionKey': f'S{n_}', 'email': em, 'status': st})

    # ---------------- Weekly feedback ----------------
    date_to_session = defaultdict(list)
    for s in sessions:
        if s['date']:
            date_to_session[s['date']].append(s)
    block_by_number = {b['number']: b for b in blocks}

    def block_from_module(mod):
        m = norm(mod)
        mm = re.match(r'(\d+)\s', m + ' ')
        if 'case study' in m:
            k = re.findall(r'\d+', m)
            return block_by_number.get('CS' + (k[0] if k else '1'))
        if m.startswith('welcome'):
            return block_by_number.get('0')
        if 'graduation' in m or 'q a' in m or 'recap' in m or 'summar' in m:
            return block_by_number.get('W')
        if mm:
            return block_by_number.get(mm.group(1))
        return None

    weekly, sme_votes = [], defaultdict(Counter)
    ws = wb['Weekly Feedback']
    wrows = list(ws.iter_rows(values_only=True))
    unmatched = Counter()
    for r in wrows[1:]:
        r = list(r) + [None] * 12
        d, nm, mod, sme = day(r[0]), text(r[1]), text(r[2]), text(r[3])
        qs = [num(x) for x in r[4:9]]
        if not d and not nm and not any(q is not None for q in qs):
            continue
        if not any(q is not None for q in qs):
            continue
        email = people.find(nm) if nm and norm(nm) not in ('unknown', 'uknown', 'anonymous') else ''
        if nm and not email and norm(nm) not in ('unknown', 'uknown', 'anonymous'):
            unmatched[nm] += 1
        sess = None
        cands = date_to_session.get(d, [])
        b = block_from_module(mod)
        if cands:
            sess = cands[0]
        elif d and b:
            near = [s for s in sessions if s['blockKey'] == b['key'] and s['date'] and
                    abs((dt.date.fromisoformat(s['date']) - dt.date.fromisoformat(d)).days) <= 3]
            sess = near[0] if near else None
        bkey = sess['blockKey'] if sess else (b['key'] if b else '')
        if sme and bkey:
            for one in re.split(r',| and ', sme):
                if one.strip():
                    sme_votes[bkey][one.strip()] += 1
        weekly.append({'date': d, 'sessionKey': sess['key'] if sess else '', 'blockKey': bkey,
                       'moduleLabel': mod, 'email': email, 'nameRaw': '' if email else nm,
                       'smeName': sme.strip(), 'q1': qs[0], 'q2': qs[1], 'q3': qs[2], 'q4': qs[3], 'q5': qs[4],
                       'improve': text(r[9]), 'comments': text(r[10])})

    # ---------------- Module feedback ----------------
    modfb = []
    if 'Module Feedback' in wb.sheetnames:
        mrows = list(wb['Module Feedback'].iter_rows(values_only=True))
        for r in mrows[1:]:
            r = list(r) + [None] * 13
            nm = text(r[2])
            qs = [num(x) for x in r[5:10]]
            if not nm or not any(q is not None for q in qs):
                continue
            email = people.find(nm)
            if not email:
                unmatched[nm] += 1
            b = block_from_module(text(r[3]))
            modfb.append({'date': day(r[1]), 'blockKey': b['key'] if b else '', 'moduleLabel': text(r[3]),
                          'email': email, 'nameRaw': '' if email else nm, 'smeName': text(r[4]),
                          'q1': qs[0], 'q2': qs[1], 'q3': qs[2], 'q4': qs[3], 'q5': qs[4],
                          'applied': text(r[10]), 'suggest': text(r[11])})

    # ---------------- SMEs per block ----------------
    cal_smes = {}
    if 'Calendar' in wb.sheetnames:
        crows = list(wb['Calendar'].iter_rows(values_only=True))
        cal_title = ' '.join(text(x) for x in (crows[0] if crows else []))
        stale = name.lower() not in cal_title.lower()
        if not stale:
            for r in crows:
                for v in r:
                    t = text(v)
                    if '\n' in t:
                        title, sme = t.split('\n', 1)
                        cal_smes[norm(title)] = sme.strip()
    for b in blocks:
        if sme_votes[b['key']]:
            b['smeName'] = sme_votes[b['key']].most_common(1)[0][0]
        else:
            best = difflib.get_close_matches(norm(b['title']), list(cal_smes), n=1, cutoff=0.6)
            if best:
                b['smeName'] = cal_smes[best[0]]
            elif b['kind'] == 'case_study':
                best = [k for k in cal_smes if k.startswith('case study')]
                b['smeName'] = ''

    # ---------------- Conversations ----------------
    convs = []
    crows = list(wb['Conversations'].iter_rows(values_only=True))
    for r in crows[1:]:
        r = list(r) + [None] * 9
        nm = text(r[1])
        if not nm and not text(r[6]):
            continue
        email = people.find(nm)
        if nm and not email:
            unmatched[nm] += 1
        split = lambda v: [x.strip() for x in re.split(r'[,\n]', text(v)) if x.strip()]
        convs.append({'date': day(r[0]), 'email': email, 'nameRaw': '' if email else nm, 'withName': text(r[2]),
                      'initiatedBy': text(r[3]) or 'Adizes', 'via': split(r[4]), 'categories': split(r[5]),
                      'description': text(r[6]), 'status': text(r[7]) or 'Completed', 'comments': text(r[8])})

    # ---------------- Goals and intentions ----------------
    goals = []
    if 'Goals and Intentions' in wb.sheetnames:
        grows = list(wb['Goals and Intentions'].iter_rows(values_only=True))
        for r in grows[1:]:
            r = list(r) + [None] * 10
            nm = text(r[1])
            answers = [text(x) for x in r[2:10]]
            if not nm or not any(answers):
                continue
            email = people.find(nm)
            if not email:
                unmatched[nm] += 1
                continue
            goals.append({'email': email, 'answers': answers})

    # ---------------- LMS snapshot (Program Tracker) ----------------
    lms = []
    lms_blocks = [b for b in blocks if b['kind'] in ('welcome', 'course')]
    if 'Program Tracker' in wb.sheetnames:
        prows = list(wb['Program Tracker'].iter_rows(values_only=True))
        for r in prows:
            em = text(r[1] if len(r) > 1 else '').lower()
            if '@' not in em:
                continue
            for k, v in enumerate(r[3:3 + len(lms_blocks)]):
                p = num(v)
                if p is None:
                    continue
                if p <= 1.0 and not (isinstance(v, str) and '%' in v):
                    p *= 100
                lms.append({'email': em, 'blockKey': lms_blocks[k]['key'], 'percent': round(p, 1)})

    # ---------------- Cohort ----------------
    code = ''
    if 'Reports' in wb.sheetnames:
        m = re.search(r'C-AEP-\d+-\d+', text(wb['Reports']['D4'].value))
        cn = re.search(r'(\d+)', name)
        if m and cn and m.group(0).split('-')[2].endswith(cn.group(1)) and 'spa' not in name.lower():
            code = m.group(0)
    bundle, course_ids = TEACHABLE.get(name, ('', []))
    for b, cid in zip(lms_blocks, course_ids):
        b['teachableCourseId'] = str(cid)
    dates = [s['date'] for s in sessions if s['date']]
    status = 'Planned' if dates and dates[0] > today else ('Completed' if dates and dates[-1] < today else 'Active')

    for nm, k in unmatched.most_common():
        warnings.append(f'Name not matched to any learner (kept as text): "{nm}" × {k}')
    for sh in wb.sheetnames:
        if sh in ('End of the Program Feedback', 'LMS Open-ended A'):
            warnings.append(f'Sheet "{sh}" is not imported in v1')

    return {
        'format': 'epm-import', 'version': 1, 'source': path.split('/')[-1],
        'cohort': {'name': name, 'code': code, 'language': lang, 'teachableBundleId': str(bundle or ''),
                   'startDate': dates[0] if dates else '', 'status': status},
        'blocks': blocks, 'sessions': sessions, 'learners': learners, 'enrollments': enrollments,
        'attendance': attendance, 'weeklyFeedback': weekly, 'moduleFeedback': modfb,
        'conversations': convs, 'goals': goals, 'lmsSnapshot': lms, 'warnings': warnings,
    }


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('xlsx')
    ap.add_argument('--name', required=True)
    ap.add_argument('--lang', default='en', choices=['en', 'es'])
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    data = migrate(a.xlsx, a.name, a.lang)
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    c = {k: len(v) for k, v in data.items() if isinstance(v, list)}
    print(a.name, json.dumps(c))
    for w in data['warnings']:
        print('  !', w)
