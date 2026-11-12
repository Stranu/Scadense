// Client Supabase di Scadense (opzionale). La libreria è vendorizzata in vendor/supabase.js (UMD, script classico)
// ed espone window.supabase. Se manca, l'app funziona comunque in locale: tutte le funzioni qui sotto
// non lanciano mai e ritornano un errore in italiano. Nessun accesso a window/document all'import.
// URL e chiave pubblica (anon/publishable) sono pubblici per design: la sicurezza è nelle policy RLS.
export const SUPABASE_URL = 'https://dzxnmexvregajijjseqt.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_E77K0UCQ5FPkGwChJE541A_5KO3ii8U';

// Chiave di sessione PROPRIA di Scadense: diversa da quella di GymBro (sb-<ref>-auth-token) e di
// IndiSpesabile ('indispesabile-auth'). Stesso account, ma login e logout restano separati per app.
export const AUTH_STORAGE_KEY = 'scadense-auth';

const MISSING = 'Accesso non disponibile: libreria non caricata.';
const missing = () => ({ data: null, error: { message: MISSING } });

let _client;      // undefined = non ancora creato; null = non disponibile
export function _resetClientForTests() { _client = undefined; }

function lib() {
  const w = typeof window !== 'undefined' ? window : globalThis;
  return w && w.supabase && typeof w.supabase.createClient === 'function' ? w.supabase : null;
}

export function authAvailable() { return !!lib(); }

export function getClient() {
  if (_client) return _client;
  const l = lib();
  if (!l) return null; // non memorizzo il null: la libreria (script defer) potrebbe arrivare dopo
  try {
    _client = l.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { storageKey: AUTH_STORAGE_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (e) {
    console.error(e);
    return null;
  }
  return _client;
}

async function call(fn) {
  const c = getClient();
  if (!c) return missing();
  try { return await fn(c.auth); } catch (e) { return { data: null, error: { message: (e && e.message) || String(e) } }; }
}

export const signUp = (email, password) => call((a) => a.signUp({ email, password }));
export const signIn = (email, password) => call((a) => a.signInWithPassword({ email, password }));
export const signOut = () => call((a) => a.signOut());
export const resetPassword = (email) => call((a) => a.resetPasswordForEmail(email, {
  redirectTo: (typeof location !== 'undefined' ? location.origin + location.pathname : undefined),
}));
export const updatePassword = (password) => call((a) => a.updateUser({ password }));

// Ritorna la sessione locale o null; non lancia mai (un errore equivale a "nessuna sessione").
export async function getSession() {
  const c = getClient();
  if (!c) return null;
  try {
    const { data } = await c.auth.getSession();
    return (data && data.session) || null;
  } catch (e) { return null; }
}

// ATTENZIONE: la callback deve essere sincrona e non attendere chiamate Supabase (deadlock del lock auth).
export function onAuthStateChange(cb) {
  const c = getClient();
  if (!c) return { data: { subscription: { unsubscribe() {} } } };
  try { return c.auth.onAuthStateChange(cb); } catch (e) { return { data: { subscription: { unsubscribe() {} } } }; }
}

export function authErrorMessage(err) {
  const raw = (err && (err.message || err.error_description || err.msg)) || '';
  const m = String(raw).toLowerCase();
  if (!m) return 'Operazione non riuscita. Riprova.';
  if (raw === MISSING) return MISSING;
  if (m.includes('invalid login credentials')) return 'Email o password non corrette.';
  if (m.includes('email not confirmed')) return 'Email non ancora confermata: apri il link che ti abbiamo inviato.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'Esiste già un account con questa email. Prova ad accedere.';
  if (m.includes('rate limit') || m.includes('too many') || err.status === 429) return 'Troppi tentativi. Attendi qualche minuto e riprova.';
  if (m.includes('password') && (m.includes('at least') || m.includes('short') || m.includes('weak'))) return 'La password è troppo corta o debole (minimo 6 caratteri).';
  if (m.includes('invalid') && m.includes('email')) return 'Indirizzo email non valido.';
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('network request failed') || m.includes('load failed')) return 'Connessione assente: riprova quando sei online.';
  return 'Operazione non riuscita: ' + raw;
}
