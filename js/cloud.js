// Orchestrazione cloud: sessione, primo accesso, cambio account, trigger di sync.
// Non blocca mai l'avvio e non lancia mai verso la UI. Senza sessione nessuna chiamata di rete.
import { authAvailable, onAuthStateChange, signOut } from './supabase.js';
import * as connectivity from './connectivity.js';
import * as sync from './sync.js';
import { getMeta, setMeta, countLocalData, outboxAll, outboxRemove } from './db.js';
import { mountSyncChip } from './sync-chip.js';
import { openNewPasswordModal, askUploadLocal, confirmAccountSwitch } from './views/auth.js';

const POLL_MS = 60000;

let started = false;
let loggedInUid = null;   // uid per cui il flusso di login è stato eseguito
let flow = Promise.resolve();
let pollTimer = null;

const changed = () => { try { window.dispatchEvent(new CustomEvent('scadense:changed')); } catch (e) { console.error(e); } };

function stopTimers() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function startTimers() {
  stopTimers();
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible') pullAndRefresh(); }, POLL_MS);
}

async function pullAndRefresh() {
  if (!loggedInUid) return;
  try {
    const r = await sync.pull();
    if (r && r.applied) changed();
  } catch (e) { console.error(e); }
}

async function onLogin(session) {
  const uid = session.user.id;
  const lastUser = await getMeta('sync.lastUser', null);
  if (lastUser && lastUser !== uid) {
    if (!(await confirmAccountSwitch())) { await signOut(); return; }
    await sync.switchAccount(uid);
  }
  loggedInUid = uid;
  sync.start();
  let res;
  const migrated = await getMeta(`sync.migrated.${uid}`, null);
  if (!migrated) {
    const counts = await countLocalData();
    if ((counts.items || 0) + (counts.history || 0) > 0) {
      const choice = await askUploadLocal(counts);
      if (choice === 'upload') res = await sync.uploadLocalData(session);
      else {
        // "Non ora": solo pull. La coda locale (scritta anche da ospite) non va inviata: si svuota,
        // i dati locali si caricano poi da "Carica i dati locali" (enqueueAll).
        await outboxRemove(await outboxAll());
        await setMeta(`sync.migrated.${uid}`, 'declined');
        res = await sync.fullSync(session);
      }
    } else {
      await setMeta(`sync.migrated.${uid}`, 'done');
      res = await sync.fullSync(session);
    }
  } else {
    res = await sync.fullSync(session);
  }
  startTimers();
  if (res && res.applied) changed(); // la vista si aggiorna solo se il pull ha applicato righe
}

function onLogout() {
  loggedInUid = null;
  stopTimers();
  sync.stop(); // i dati locali restano; lo stato torna "guest"
}

function handleAuth(event, session) {
  try {
    if (event === 'PASSWORD_RECOVERY') { openNewPasswordModal(); return; }
    if (event === 'SIGNED_OUT') { flow = flow.then(onLogout).catch(console.error); return; }
    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
    if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session && session.user) {
      if (loggedInUid === session.user.id) return; // ri-emissione: nessun re-render
      flow = flow.then(() => onLogin(session)).catch((e) => { console.error(e); });
    }
  } catch (e) { console.error(e); }
}

export async function startCloud() {
  if (started) return;
  started = true;
  try {
    connectivity.start();
    const chip = document.getElementById('sync-chip');
    mountSyncChip(chip);
    if (!authAvailable()) return;
    // La callback deve essere sincrona: il lavoro vero è rimandato (deadlock del lock auth).
    onAuthStateChange((event, session) => { setTimeout(() => handleAuth(event, session), 0); });
    window.addEventListener('online', () => { if (loggedInUid) sync.fullSync().then((r) => { if (r && r.applied) changed(); }).catch(console.error); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pullAndRefresh(); });
  } catch (e) {
    console.error(e);
  }
}
