// Chip di stato sincronizzazione nell'header (#sync-chip). Nascosto se la libreria Supabase non c'è.
import { onStatus } from './sync.js';
import { authAvailable } from './supabase.js';
import { openAuthModal } from './views/auth.js';
import { toast } from './ui.js';

const ERR_COOLDOWN = 8000;

function describe(st) {
  if (st.state === 'guest') return { text: 'Accedi', label: 'Accedi per sincronizzare le scadenze' };
  if (st.state === 'syncing') return { text: 'Sincronizzo…', label: 'Sincronizzazione in corso' };
  if (st.state === 'offline') return { text: 'Offline', label: 'Offline: i dati verranno sincronizzati al ritorno della connessione' };
  if (st.state === 'error') return { text: 'Errore sync', label: 'Errore di sincronizzazione' };
  if (st.pending > 0) return { text: `Da sincronizzare (${st.pending})`, label: `${st.pending} modifiche da sincronizzare` };
  return { text: 'Sincronizzato', label: 'Dati sincronizzati' };
}

export function mountSyncChip(button) {
  if (!button) return () => {};
  if (!authAvailable()) { button.hidden = true; return () => {}; }
  button.hidden = false;
  let lastErrAt = 0;
  let prevState = null;
  const click = () => {
    if (button.dataset.state === 'guest') openAuthModal({});
    else location.hash = '#/altro';
  };
  button.addEventListener('click', click);
  const off = onStatus((st) => {
    const d = describe(st);
    const key = st.state === 'idle' && st.pending > 0 ? 'pending' : st.state;
    button.dataset.state = key === 'pending' ? 'pending' : st.state;
    button.textContent = d.text;
    button.setAttribute('aria-label', d.label);
    if (st.state === 'error' && prevState !== 'error' && Date.now() - lastErrAt > ERR_COOLDOWN) {
      lastErrAt = Date.now();
      toast(st.message || 'Errore di sincronizzazione');
    }
    prevState = st.state;
  });
  return () => { off(); button.removeEventListener('click', click); };
}
