/* ===================================================================================
 * BOOT — mounts on <div id="epm-app">. window.EPM_CONFIG = { endpoint, mode: 'staff' | 'learner' }
 * =================================================================================== */
var ASSETS = 'https://cdn.jsdelivr.net/gh/Adizes/exec-program-manager@v' + VERSION + '/assets/';

function injectStyles() {
  if (document.getElementById('epm-styles')) return;
  var st = document.createElement('style'); st.id = 'epm-styles'; st.textContent = __CSS__;
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
