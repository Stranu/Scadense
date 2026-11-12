// Card "Account e sincronizzazione" nella schermata Altro.
import { h, toast, confirmDialog } from '../ui.js';
import { getMeta } from '../db.js';
import { authAvailable, getSession, signOut } from '../supabase.js';
import { onStatus, fullSync, uploadLocalData } from '../sync.js';
import * as connectivity from '../connectivity.js';
import { openAuthModal } from './auth.js';

const LIB_MSG = 'Accesso e sincronizzazione non disponibili: la libreria non è stata caricata. Scadense continua a funzionare in locale.';
const SAME_ACCOUNT = 'Puoi usare lo stesso account delle altre app, ma l\'accesso qui è separato.';

function fmtWhen(ms) {
  if (!ms) return 'mai';
  try { return new Date(ms).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }); } catch { return '—'; }
}

function statusLine(st) {
  if (st.state === 'syncing') return 'Sincronizzazione in corso…';
  if (st.state === 'offline') return 'Offline: i dati verranno sincronizzati al ritorno della connessione.';
  if (st.state === 'error') return st.message || 'Errore di sincronizzazione.';
  return `Ultima sincronizzazione: ${fmtWhen(st.lastSync)}`;
}

export function renderAccountCard() {
  const title = h('h2', { class: 'section-title' }, 'Account e sincronizzazione');
  const body = h('div', { class: 'account-body' });
  const card = h('section', { class: 'card', 'aria-label': 'Account e sincronizzazione' }, title, body);

  let st = { state: 'guest', lastSync: null, pending: 0, message: '' };
  let session = null;
  let declined = false;
  let seen = false;
  let unsub = () => {};
  let unconn = () => {};

  function guestView() {
    body.replaceChildren(
      h('p', { class: 'muted' }, 'Accedi per sincronizzare le tue scadenze sul cloud e usarle su più dispositivi. Funziona anche senza account.'),
      h('p', { class: 'muted' }, SAME_ACCOUNT),
      h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => openAuthModal({}) }, 'Accedi / Registrati'));
  }

  function loggedView() {
    const offline = connectivity.getState().offline;
    const rows = [
      h('p', { class: 'row-title account-email' }, `Connesso come ${session.user.email || 'account'}`),
      h('p', { class: `row-sub account-status${st.state === 'error' ? ' err' : ''}`, role: st.state === 'error' ? 'alert' : null }, statusLine(st)),
    ];
    if (st.pending > 0) rows.push(h('p', { class: 'row-sub' }, `Modifiche da sincronizzare: ${st.pending}`));
    if (offline && st.state !== 'offline') rows.push(h('p', { class: 'row-sub account-offline' }, 'Sei offline: i dati verranno sincronizzati al ritorno della connessione.'));
    rows.push(h('p', { class: 'row-sub' }, SAME_ACCOUNT));
    const btns = [
      h('button', { type: 'button', class: 'btn btn-primary', disabled: st.state === 'syncing', onclick: async () => {
        const r = await fullSync(session);
        if (r && r.ok) { toast('Sincronizzazione completata'); if (r.applied) window.dispatchEvent(new CustomEvent('scadense:changed')); }
      } }, 'Sincronizza ora'),
    ];
    if (declined) {
      btns.push(h('button', { type: 'button', class: 'btn', onclick: async () => {
        const r = await uploadLocalData(session);
        if (r && r.ok) { declined = false; toast('Dati locali caricati'); refresh(); } else toast('Caricamento non riuscito');
      } }, 'Carica i dati locali'));
    }
    btns.push(h('button', { type: 'button', class: 'btn', onclick: async () => {
      if (!(await confirmDialog({ title: 'Uscire dall\'account?', message: 'I dati restano su questo dispositivo.', okLabel: 'Esci' }))) return;
      const { error } = await signOut();
      if (error) toast('Uscita non riuscita'); else toast('Disconnesso. I dati restano su questo dispositivo.');
    } }, 'Esci'));
    body.replaceChildren(...rows, h('div', { class: 'btn-grid' }, btns));
  }

  let busy = false;
  async function refresh() {
    if (!authAvailable()) { body.replaceChildren(h('p', { class: 'muted' }, LIB_MSG)); return; }
    if (busy) return;
    busy = true;
    try {
      session = await getSession();
      if (session && session.user) {
        declined = (await getMeta(`sync.migrated.${session.user.id}`, null)) === 'declined';
        loggedView();
      } else guestView();
    } catch (e) { console.error(e); guestView(); }
    finally { busy = false; }
  }

  // Stato guest subito (sincrono), poi upgrade con la sessione.
  if (!authAvailable()) {
    body.replaceChildren(h('p', { class: 'muted' }, LIB_MSG));
    return card;
  }
  guestView();
  const cleanup = () => { unsub(); unconn(); };
  const onSt = (s) => {
    st = s;
    if (card.isConnected) seen = true;
    else if (seen) { cleanup(); return; }
    refresh();
  };
  unsub = onStatus(onSt);
  unconn = connectivity.subscribe(() => { if (card.isConnected) refresh(); else if (seen) cleanup(); });
  return card;
}
