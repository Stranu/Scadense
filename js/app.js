import { init } from './db.js';
import { initTheme, setTheme, getPref, resolveTheme } from './theme.js';
import { toast } from './ui.js';
import { startCloud } from './cloud.js';
import { runReminders } from './reminders.js';
import { runRollover } from './model.js';
import * as prossime from './views/prossime.js';
import * as calendario from './views/calendario.js';
import * as costi from './views/costi.js';
import * as abbonamenti from './views/abbonamenti.js';
import * as altro from './views/altro.js';

const ROUTES = {
  '/': { view: prossime, title: 'Prossime' },
  '/calendario': { view: calendario, title: 'Calendario' },
  '/abbonamenti': { view: abbonamenti, title: 'Abbonamenti' },
  '/costi': { view: costi, title: 'Costi' },
  '/altro': { view: altro, title: 'Altro' },
};

const main = document.getElementById('view');
let current = null;
let firstRender = true;

function routeOf() {
  const path = location.hash.replace(/^#/, '') || '/';
  return ROUTES[path] ? path : '/';
}

async function render(focus) {
  const path = routeOf();
  const r = ROUTES[path];
  current = path;
  document.querySelectorAll('.nav-link').forEach((a) => {
    const on = a.getAttribute('href') === '#' + path;
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = `${r.title} · Scadense`;
  const scroll = window.scrollY;
  try {
    await r.view.render(main);
  } catch (e) {
    console.error(e);
    main.textContent = 'Si è verificato un errore nel caricamento dei dati.';
  }
  if (focus) { window.scrollTo(0, 0); main.querySelector('h1')?.focus({ preventScroll: true }); }
  else window.scrollTo(0, scroll);
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const offer = (worker) => toast('Aggiornamento disponibile', { label: 'Ricarica', fn: () => worker.postMessage('SKIP_WAITING') });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !navigator.serviceWorker.controller) return;
    reloading = true;
    location.reload();
  });
}

async function boot() {
  window.__scadenseStarted = true;
  initTheme();
  document.getElementById('theme-toggle').addEventListener('click', () => {
    setTheme(resolveTheme(getPref()) === 'dark' ? 'light' : 'dark').then(() => { if (current === '/altro') render(false); });
  });
  await init();
  // Addebiti automatici: registra quelli maturati, mai in loop (runRollover non emette eventi).
  const rolled = async () => {
    try {
      const n = await runRollover();
      if (n) toast(n === 1 ? 'Registrato 1 addebito automatico' : `Registrati ${n} addebiti automatici`);
      return n;
    } catch (e) { console.error(e); return 0; }
  };
  window.addEventListener('hashchange', () => render(true));
  window.addEventListener('scadense:changed', async () => { await rolled(); render(false); runReminders(); });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && (await rolled())) render(false);
  });
  const n0 = await runRollover().catch((e) => { console.error(e); return 0; });
  await render(false);
  if (n0) toast(n0 === 1 ? 'Registrato 1 addebito automatico' : `Registrati ${n0} addebiti automatici`);
  firstRender = false;
  runReminders();
  startCloud().catch(console.error); // facoltativo: mai atteso, non blocca l'avvio
  registerSW();
}

// Messaggio di errore leggibile con "Riprova" al posto di un "Caricamento…" eterno.
function showFatal(e) {
  console.error(e);
  const msg = (e && e.message) || String(e || 'Errore sconosciuto');
  const box = document.createElement('div');
  box.className = 'fatal';
  box.setAttribute('role', 'alert');
  const p1 = document.createElement('p');
  p1.textContent = 'Scadense non è riuscita ad avviarsi.';
  const p2 = document.createElement('p');
  p2.className = 'muted';
  p2.textContent = msg;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.textContent = 'Riprova';
  btn.addEventListener('click', () => location.reload());
  box.append(p1, p2, btn);
  main.replaceChildren(box);
}

let booted = false;
const stillLoading = () => !booted && main.querySelector('.loading');
window.addEventListener('error', (ev) => { if (stillLoading()) showFatal(ev.error || ev.message); });
window.addEventListener('unhandledrejection', (ev) => { if (stillLoading()) showFatal(ev.reason); });

boot().then(() => { booted = true; }, (e) => { booted = true; showFatal(e); });
