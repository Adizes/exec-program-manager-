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
