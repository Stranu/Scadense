/* Scadense - fonte di verità UNICA dello stato di connettività (port di GymBro).
 *
 *   offline = (!navigator.onLine) OPPURE (ultima chiamata a una tabella Supabase fallita)
 *
 * NESSUN import: semplice contenitore di stato, privo di dipendenze (niente cicli).
 * - Il browser segnala la connettività del dispositivo (eventi online/offline).
 * - Solo il motore di sync segnala la raggiungibilità di Supabase (markReachable/markUnreachable).
 * - Il fullSync sul reconnect è lanciato da cloud.js sull'evento `online`.
 */

let _offline = (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') ? !navigator.onLine : false;
let _supabaseReachable = true;      // finché non fallisce una chiamata a tabella
let _started = false;               // start() idempotente
const _subs = new Set();

function _deviceOffline() {
  return typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? !navigator.onLine : false;
}

function _recompute() {
  const next = _deviceOffline() || !_supabaseReachable;
  if (next === _offline) return;    // emetti SOLO sui cambi effettivi
  _offline = next;
  for (const cb of _subs) {
    try { cb(getState()); } catch (e) { console.error(e); }
  }
}

/** Snapshot sincrono dello stato. */
export function getState() {
  return { offline: _offline };
}

/** Registra un listener invocato ad ogni cambio di stato. Ritorna l'unsubscribe. */
export function subscribe(cb) {
  _subs.add(cb);
  return () => _subs.delete(cb);
}

/** Supabase ha risposto: segnala raggiungibile. */
export function markReachable() {
  _supabaseReachable = true;
  _recompute();
}

/** Una chiamata a una tabella Supabase è fallita: segnala irraggiungibile. */
export function markUnreachable() {
  _supabaseReachable = false;
  _recompute();
}

/** Registra i listener window online/offline e fa un _recompute() iniziale. Idempotente. */
export function start() {
  if (_started) return;
  _started = true;
  if (typeof window !== 'undefined') {
    window.addEventListener('offline', () => { _recompute(); });
    window.addEventListener('online', () => { _recompute(); });
  }
  _recompute();
}
