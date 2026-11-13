/* GENERATO da tools/build.mjs: non modificare a mano (modifica js/ e riesegui il build). */
(function () {
'use strict';
var __defs = {}, __cache = {};
function __def(id, fn) { __defs[id] = fn; }
function __req(id) {
  if (__cache[id]) return __cache[id];
  var exp = __cache[id] = {};
  __defs[id](exp);
  return exp;
}
__def('js/db.js', function (__exp) {
// IndexedDB promisificato: scadense-db v3 (v3 = store 'outbox' per la sincronizzazione cloud)
const DB_NAME = 'scadense-db';
const VERSION = 3;
const STORES = ['items', 'history', 'categories', 'meta'];
// Store sincronizzati col cloud; 'meta' e 'outbox' restano per-dispositivo.
const SYNCED_STORES = ['items', 'history', 'categories'];

const DEFAULT_CATEGORIES = [
  { id: 'veicoli', name: 'Veicoli', emoji: '🚗', color: '#2563eb', defaultRemind: 30, order: 0 },
  { id: 'documenti', name: 'Documenti', emoji: '🪪', color: '#7c3aed', defaultRemind: 60, order: 1 },
  { id: 'casa', name: 'Casa e bollette', emoji: '🏠', color: '#d97706', defaultRemind: 7, order: 2 },
  { id: 'abbonamenti', name: 'Abbonamenti', emoji: '📺', color: '#db2777', defaultRemind: 7, order: 3 },
  { id: 'salute', name: 'Salute', emoji: '🩺', color: '#059669', defaultRemind: 14, order: 4 },
  { id: 'tasse', name: 'Tasse', emoji: '🧾', color: '#dc2626', defaultRemind: 15, order: 5 },
  { id: 'garanzie', name: 'Garanzie', emoji: '🛡️', color: '#0891b2', defaultRemind: 30, order: 6 },
  { id: 'altro', name: 'Altro', emoji: '📌', color: '#64748b', defaultRemind: 7, order: 7 },
];

// Campi aggiunti nello schema 2 (pagamento automatico, fine/rate, pausa, disdetta).
const ITEM_DEFAULTS = {
  autoPay: false, payMethod: '', endDate: null, paidCount: 0, paused: false, cancelledOn: null, closedReason: null,
};
const normalizeItem = (item) => ({ ...ITEM_DEFAULTS, ...item });
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); fn(v); };
    const timer = setTimeout(() => fail(new Error('Apertura del database troppo lenta o bloccata. Chiudi le altre schede di Scadense e riprova.')), 10000);
    // In caso di errore la promessa fallita non deve restare in cache: il retry riparte da zero.
    const fail = (e) => { dbPromise = null; done(reject, e); };
    if (!globalThis.indexedDB) { fail(new Error('IndexedDB non disponibile in questo browser.')); return; }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onblocked = () => fail(new Error('Database bloccato da un\'altra scheda di Scadense aperta. Chiudila e riprova.'));
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const old = e.oldVersion;
      if (old < 1) {
        const items = db.createObjectStore('items', { keyPath: 'id' });
        items.createIndex('dueDate', 'dueDate');
        items.createIndex('categoryId', 'categoryId');
        items.createIndex('status', 'status');
        const hist = db.createObjectStore('history', { keyPath: 'id' });
        hist.createIndex('itemId', 'itemId');
        db.createObjectStore('categories', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (old >= 1 && old < 2) {
        // Migrazione v1 -> v2: default per i nuovi campi delle voci esistenti.
        const store = req.transaction.objectStore('items');
        store.openCursor().onsuccess = (ev) => {
          const cur = ev.target.result;
          if (!cur) return;
          cur.update(normalizeItem(cur.value));
          cur.continue();
        };
        req.transaction.objectStore('meta').put({ key: 'schema', value: 2 });
      }
      if (old < 3 && !db.objectStoreNames.contains('outbox')) {
        // Migrazione v2 -> v3: coda di sincronizzazione {tid:'store:id', store, id, op:'put'|'del', at}.
        db.createObjectStore('outbox', { keyPath: 'tid' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      if (settled) { db.close(); return; }
      done(resolve, db);
    };
    req.onerror = () => fail(req.error || new Error('Impossibile aprire il database.'));
  });
  return dbPromise;
}

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

let changeCb = null;
// Unico callback di notifica "scritture app completate" (db.js non importa mai sync.js).
function onChange(cb) { changeCb = typeof cb === 'function' ? cb : null; }

// Puro: avvolge gli object store sincronizzati di `map` ({nome: objectStore}, con 'outbox').
// put() imposta updatedAt = now() su una copia e accoda {op:'put'}; delete() accoda {op:'del'};
// clear() è vietato (usare delete per id, così le cancellazioni arrivano all'outbox).
function wrapWriteStores(map, now = Date.now) {
  const out = { ...map };
  const outbox = map.outbox;
  for (const name of SYNCED_STORES) {
    const st = map[name];
    if (!st) continue;
    out[name] = {
      put(value, key) {
        const at = now();
        const stamped = { ...value, updatedAt: at };
        const r = st.put(stamped, key);
        outbox.put({ tid: name + ':' + stamped.id, store: name, id: stamped.id, op: 'put', at });
        return r;
      },
      delete(key) {
        const r = st.delete(key);
        outbox.put({ tid: name + ':' + key, store: name, id: key, op: 'del', at: now() });
        return r;
      },
      clear() { throw new Error('clear() non consentito su ' + name + ': elimina per id.'); },
      get: (...a) => st.get(...a),
      getAll: (...a) => st.getAll(...a),
      getAllKeys: (...a) => st.getAllKeys(...a),
      openCursor: (...a) => st.openCursor(...a),
      index: (...a) => st.index(...a),
      count: (...a) => st.count(...a),
    };
  }
  return out;
}

// Transazione atomica: fn riceve gli object store (richieste senza await interni).
// Le scritture su store sincronizzati scrivono l'outbox NELLA STESSA transazione (opts.raw = senza).
async function transact(stores, fn, mode = 'readwrite', opts = {}) {
  const db = await openDB();
  const synced = mode === 'readwrite' && !opts.raw && stores.some((s) => SYNCED_STORES.includes(s));
  const scope = synced && !stores.includes('outbox') ? [...stores, 'outbox'] : stores;
  return new Promise((resolve, reject) => {
    const t = db.transaction(scope, mode);
    const map = {};
    scope.forEach((s) => { map[s] = t.objectStore(s); });
    let out;
    try { out = fn(synced ? wrapWriteStores(map) : map); } catch (e) { try { t.abort(); } catch (_) { /* già chiusa */ } reject(e); return; }
    t.oncomplete = () => {
      resolve(out);
      if (synced && changeCb) {
        try { changeCb(stores.filter((s) => SYNCED_STORES.includes(s))); } catch (e) { console.error(e); }
      }
    };
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transazione annullata'));
  });
}

// ---- Outbox e operazioni di sincronizzazione (non generano mai nuove voci outbox) ----
const outboxAll = () => getAll('outbox');

// Rimuove solo le voci il cui `at` è invariato rispetto allo snapshot (scritture arrivate durante il push restano).
async function outboxRemove(entries) {
  if (!entries || !entries.length) return;
  await transact(['outbox'], (s) => {
    entries.forEach((e) => {
      s.outbox.get(e.tid).onsuccess = (ev) => {
        const cur = ev.target.result;
        if (cur && cur.at === e.at) s.outbox.delete(e.tid);
      };
    });
  }, 'readwrite', { raw: true });
}

// Accoda tutte le righe locali (baseline di primo accesso).
async function enqueueAll() {
  const at = Date.now();
  const lists = await Promise.all(SYNCED_STORES.map((n) => getAll(n)));
  await transact(['outbox'], (s) => {
    SYNCED_STORES.forEach((n, i) => lists[i].forEach((r) => s.outbox.put({ tid: n + ':' + r.id, store: n, id: r.id, op: 'put', at })));
  }, 'readwrite', { raw: true });
}

// Applica righe remote in un'unica transazione atomica: niente stamp, niente outbox, niente onChange.
async function applyRaw({ puts = [], dels = [], dropOutbox = [] } = {}) {
  if (!puts.length && !dels.length && !dropOutbox.length) return;
  await transact([...SYNCED_STORES, 'outbox'], (s) => {
    puts.forEach(({ store, row }) => s[store].put(row));
    dels.forEach(({ store, id }) => s[store].delete(id));
    dropOutbox.forEach((tid) => s.outbox.delete(tid));
  }, 'readwrite', { raw: true });
}

// Cambio account: svuota i dati sincronizzati e l'outbox, poi ripristina le categorie predefinite (raw).
async function clearSynced() {
  await transact([...SYNCED_STORES, 'outbox'], (s) => {
    SYNCED_STORES.forEach((n) => s[n].clear());
    s.outbox.clear();
    DEFAULT_CATEGORIES.forEach((c) => s.categories.put(c));
  }, 'readwrite', { raw: true });
}

async function countLocalData() {
  const [items, history, categories] = await Promise.all(SYNCED_STORES.map((n) => getAll(n)));
  return { items: items.length, history: history.length, categories: categories.length };
}

async function getAll(store) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).getAll());
}
async function get(store, key) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).get(key));
}
const put = (store, value) => transact([store], (s) => { s[store].put(value); });
const del = (store, key) => transact([store], (s) => { s[store].delete(key); });

async function historyOf(itemId) {
  const db = await openDB();
  const list = await wrap(db.transaction('history').objectStore('history').index('itemId').getAll(itemId));
  return list.sort((a, b) => (a.doneOn < b.doneOn ? 1 : a.doneOn > b.doneOn ? -1 : 0));
}

async function getMeta(key, def = null) {
  const r = await get('meta', key);
  return r ? r.value : def;
}
const setMeta = (key, value) => put('meta', { key, value });

async function getCategories() {
  const list = await getAll('categories');
  return list.sort((a, b) => a.order - b.order);
}

function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// Prima apertura: categorie predefinite.
async function init() {
  await openDB();
  const seeded = await getMeta('seeded', false);
  if (!seeded) {
    await transact(['categories', 'meta'], (s) => {
      DEFAULT_CATEGORIES.forEach((c) => s.categories.put(c));
      s.meta.put({ key: 'seeded', value: true });
      s.meta.put({ key: 'schema', value: 2 });
    }, 'readwrite', { raw: true }); // seed deterministico: non va in outbox né riceve updatedAt
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

__exp.STORES = STORES;
__exp.SYNCED_STORES = SYNCED_STORES;
__exp.DEFAULT_CATEGORIES = DEFAULT_CATEGORIES;
__exp.ITEM_DEFAULTS = ITEM_DEFAULTS;
__exp.normalizeItem = normalizeItem;
__exp.openDB = openDB;
__exp.onChange = onChange;
__exp.wrapWriteStores = wrapWriteStores;
__exp.transact = transact;
__exp.outboxAll = outboxAll;
__exp.outboxRemove = outboxRemove;
__exp.enqueueAll = enqueueAll;
__exp.applyRaw = applyRaw;
__exp.clearSynced = clearSynced;
__exp.countLocalData = countLocalData;
__exp.getAll = getAll;
__exp.get = get;
__exp.put = put;
__exp.del = del;
__exp.historyOf = historyOf;
__exp.getMeta = getMeta;
__exp.setMeta = setMeta;
__exp.getCategories = getCategories;
__exp.uuid = uuid;
__exp.init = init;
});
__def('js/theme.js', function (__exp) {
const { setMeta } = __req('js/db.js');

const KEY = 'scadense-theme';
const COLORS = { light: '#f5f6fb', dark: '#0f1020' };

const getPref = () => localStorage.getItem(KEY) || 'auto';

function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(pref = getPref()) {
  const t = resolveTheme(pref);
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', COLORS[t]);
  return t;
}

async function setTheme(pref) {
  localStorage.setItem(KEY, pref);
  applyTheme(pref);
  try { await setMeta('theme', pref); } catch { /* cache locale sufficiente */ }
}

function initTheme() {
  applyTheme();
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', () => { if (getPref() === 'auto') applyTheme('auto'); });
}

__exp.getPref = getPref;
__exp.resolveTheme = resolveTheme;
__exp.applyTheme = applyTheme;
__exp.setTheme = setTheme;
__exp.initTheme = initTheme;
});
__def('js/ui.js', function (__exp) {
// Helper UI: creazione DOM sicura (testo mai come HTML), toast, dialog.
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return e;
}

let uid = 0;
const nextId = (p = 'id') => `${p}-${++uid}`;

function notifyChanged() {
  window.dispatchEvent(new CustomEvent('scadense:changed'));
}

// ---- Toast ----
let toastTimer = null;
function toast(message, action) {
  const box = document.getElementById('toast');
  if (!box) return;
  clearTimeout(toastTimer);
  box.replaceChildren();
  const inner = h('div', { class: 'toast' }, h('span', null, message));
  if (action) {
    inner.append(h('button', {
      type: 'button', class: 'toast-action',
      onclick: () => { box.replaceChildren(); clearTimeout(toastTimer); action.fn(); },
    }, action.label));
  }
  box.append(inner);
  toastTimer = setTimeout(() => box.replaceChildren(), action ? 8000 : 4000);
}

// ---- Dialog modale ----
let openCount = 0;
// build(close) ritorna il contenuto; la promise si risolve col valore passato a close().
function modal(build, { label } = {}) {
  return new Promise((resolve) => {
    let result;
    const dlg = h('dialog', { class: 'sheet', 'aria-label': label || null });
    const close = (v) => { result = v; dlg.close(); };
    dlg.addEventListener('close', () => {
      dlg.remove();
      openCount--;
      if (openCount <= 0) document.body.classList.remove('modal-open');
      resolve(result);
    });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.append(h('div', { class: 'sheet-body' }, build(close)));
    document.body.append(dlg);
    openCount++;
    document.body.classList.add('modal-open');
    dlg.showModal();
  });
}

function sheetHeader(title, close) {
  return h('div', { class: 'sheet-head' },
    h('h2', { class: 'sheet-title' }, title),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Chiudi', onclick: () => close() }, '✕'));
}

function confirmDialog({ title, message, okLabel = 'Conferma', danger = false }) {
  return modal((close) => h('div', null,
    sheetHeader(title, close),
    h('p', { class: 'muted' }, message),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', onclick: () => close(false) }, 'Annulla'),
      h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => close(true) }, okLabel)),
  ), { label: title }).then((v) => v === true);
}

// Campo etichettato: ritorna {wrap, input}
function field(label, input, { hint, error } = {}) {
  const id = nextId('f');
  input.id = id;
  const wrap = h('div', { class: 'field' },
    h('label', { for: id }, label),
    input,
    hint ? h('small', { class: 'hint' }, hint) : null,
    h('small', { class: 'err', role: 'alert', id: id + '-err' }, error || ''));
  return wrap;
}

function setError(input, msg) {
  const err = document.getElementById(input.id + '-err');
  if (err) err.textContent = msg || '';
  if (msg) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', input.id + '-err'); }
  else { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
}

function downloadFile(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

__exp.esc = esc;
__exp.h = h;
__exp.nextId = nextId;
__exp.notifyChanged = notifyChanged;
__exp.toast = toast;
__exp.modal = modal;
__exp.sheetHeader = sheetHeader;
__exp.confirmDialog = confirmDialog;
__exp.field = field;
__exp.setError = setError;
__exp.downloadFile = downloadFile;
});
__def('js/supabase.js', function (__exp) {
// Client Supabase di Scadense (opzionale). La libreria è vendorizzata in vendor/supabase.js (UMD, script classico)
// ed espone window.supabase. Se manca, l'app funziona comunque in locale: tutte le funzioni qui sotto
// non lanciano mai e ritornano un errore in italiano. Nessun accesso a window/document all'import.
// URL e chiave pubblica (anon/publishable) sono pubblici per design: la sicurezza è nelle policy RLS.
const SUPABASE_URL = 'https://dzxnmexvregajijjseqt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_E77K0UCQ5FPkGwChJE541A_5KO3ii8U';

// Chiave di sessione PROPRIA di Scadense: diversa da quella di GymBro (sb-<ref>-auth-token) e di
// IndiSpesabile ('indispesabile-auth'). Stesso account, ma login e logout restano separati per app.
const AUTH_STORAGE_KEY = 'scadense-auth';

const MISSING = 'Accesso non disponibile: libreria non caricata.';
const missing = () => ({ data: null, error: { message: MISSING } });

let _client;      // undefined = non ancora creato; null = non disponibile
function _resetClientForTests() { _client = undefined; }

function lib() {
  const w = typeof window !== 'undefined' ? window : globalThis;
  return w && w.supabase && typeof w.supabase.createClient === 'function' ? w.supabase : null;
}

function authAvailable() { return !!lib(); }

function getClient() {
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

const signUp = (email, password) => call((a) => a.signUp({ email, password }));
const signIn = (email, password) => call((a) => a.signInWithPassword({ email, password }));
const signOut = () => call((a) => a.signOut());
const resetPassword = (email) => call((a) => a.resetPasswordForEmail(email, {
  redirectTo: (typeof location !== 'undefined' ? location.origin + location.pathname : undefined),
}));
const updatePassword = (password) => call((a) => a.updateUser({ password }));

// Ritorna la sessione locale o null; non lancia mai (un errore equivale a "nessuna sessione").
async function getSession() {
  const c = getClient();
  if (!c) return null;
  try {
    const { data } = await c.auth.getSession();
    return (data && data.session) || null;
  } catch (e) { return null; }
}

// ATTENZIONE: la callback deve essere sincrona e non attendere chiamate Supabase (deadlock del lock auth).
function onAuthStateChange(cb) {
  const c = getClient();
  if (!c) return { data: { subscription: { unsubscribe() {} } } };
  try { return c.auth.onAuthStateChange(cb); } catch (e) { return { data: { subscription: { unsubscribe() {} } } }; }
}

function authErrorMessage(err) {
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

__exp.SUPABASE_URL = SUPABASE_URL;
__exp.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
__exp.AUTH_STORAGE_KEY = AUTH_STORAGE_KEY;
__exp._resetClientForTests = _resetClientForTests;
__exp.authAvailable = authAvailable;
__exp.getClient = getClient;
__exp.signUp = signUp;
__exp.signIn = signIn;
__exp.signOut = signOut;
__exp.resetPassword = resetPassword;
__exp.updatePassword = updatePassword;
__exp.getSession = getSession;
__exp.onAuthStateChange = onAuthStateChange;
__exp.authErrorMessage = authErrorMessage;
});
__def('js/connectivity.js', function (__exp) {
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
function getState() {
  return { offline: _offline };
}

/** Registra un listener invocato ad ogni cambio di stato. Ritorna l'unsubscribe. */
function subscribe(cb) {
  _subs.add(cb);
  return () => _subs.delete(cb);
}

/** Supabase ha risposto: segnala raggiungibile. */
function markReachable() {
  _supabaseReachable = true;
  _recompute();
}

/** Una chiamata a una tabella Supabase è fallita: segnala irraggiungibile. */
function markUnreachable() {
  _supabaseReachable = false;
  _recompute();
}

/** Registra i listener window online/offline e fa un _recompute() iniziale. Idempotente. */
function start() {
  if (_started) return;
  _started = true;
  if (typeof window !== 'undefined') {
    window.addEventListener('offline', () => { _recompute(); });
    window.addEventListener('online', () => { _recompute(); });
  }
  _recompute();
}

__exp.getState = getState;
__exp.subscribe = subscribe;
__exp.markReachable = markReachable;
__exp.markUnreachable = markUnreachable;
__exp.start = start;
});
__def('js/sync-core.js', function (__exp) {
// Logica PURA della sincronizzazione (nessun I/O): mappatura locale <-> remoto, LWW, utilità.
const { normalizeItem } = __req('js/db.js');

const toMs = (iso) => {
  const n = typeof iso === 'number' ? iso : Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
};
const toIso = (ms) => new Date(Number.isFinite(ms) ? ms : 0).toISOString();

// Orologio LWW di una riga locale: updatedAt, poi createdAt, poi epoch (deterministico tra dispositivi).
function stampOf(row) {
  if (!row) return 0;
  if (Number.isFinite(row.updatedAt)) return row.updatedAt;
  if (Number.isFinite(row.createdAt)) return row.createdAt;
  return 0;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const NO_REC = () => ({ unit: 'none', every: 0 });

const items = {
  store: 'items', remote: 'scadense_items',
  toRemote(r) {
    const it = normalizeItem(r);
    const stamp = stampOf(it);
    return {
      id: it.id, title: it.title ?? null, category_id: it.categoryId ?? null, due_date: it.dueDate ?? null,
      recurrence: it.recurrence ?? null, amount: it.amount ?? null, remind_days: it.remindDays ?? null,
      notes: it.notes ?? null, reference: it.reference ?? null, status: it.status ?? null,
      auto_pay: it.autoPay === true, pay_method: it.payMethod ?? null, end_date: it.endDate ?? null,
      paid_count: it.paidCount ?? 0, paused: it.paused === true, cancelled_on: it.cancelledOn ?? null,
      closed_reason: it.closedReason ?? null,
      created_at: toIso(Number.isFinite(it.createdAt) ? it.createdAt : stamp),
      updated_at: toIso(stamp),
    };
  },
  toLocal(x) {
    const updatedAt = toMs(x.updated_at);
    return normalizeItem({
      id: x.id, title: x.title ?? '', categoryId: x.category_id ?? 'altro', dueDate: x.due_date,
      recurrence: x.recurrence ?? NO_REC(), amount: x.amount ?? null, remindDays: x.remind_days ?? 7,
      notes: x.notes ?? '', reference: x.reference ?? '', status: x.status ?? 'active',
      autoPay: x.auto_pay ?? false, payMethod: x.pay_method ?? '', endDate: x.end_date ?? null,
      paidCount: x.paid_count ?? 0, paused: x.paused ?? false, cancelledOn: x.cancelled_on ?? null,
      closedReason: x.closed_reason ?? null,
      createdAt: x.created_at ? toMs(x.created_at) : updatedAt, updatedAt,
    });
  },
};

const history = {
  store: 'history', remote: 'scadense_history',
  toRemote(r) {
    return {
      id: r.id, item_id: r.itemId ?? null, done_on: r.doneOn ?? null, due_was: r.dueWas ?? null,
      amount: r.amount ?? null, note: r.note ?? null, auto: r.auto === true, updated_at: toIso(stampOf(r)),
    };
  },
  toLocal(x) {
    return {
      id: x.id, itemId: x.item_id, doneOn: x.done_on, dueWas: x.due_was ?? x.done_on,
      amount: x.amount ?? null, note: x.note ?? '', ...(x.auto === true ? { auto: true } : {}),
      updatedAt: toMs(x.updated_at),
    };
  },
};

const categories = {
  store: 'categories', remote: 'scadense_categories',
  toRemote(r) {
    return {
      id: r.id, name: r.name ?? null, emoji: r.emoji ?? null, color: r.color ?? null,
      default_remind: r.defaultRemind ?? null, sort_order: r.order ?? null, updated_at: toIso(stampOf(r)),
    };
  },
  toLocal(x) {
    return {
      id: x.id, name: x.name ?? '', emoji: x.emoji ?? '📌', color: x.color ?? '#64748b',
      defaultRemind: x.default_remind ?? 7, order: x.sort_order ?? 0, updatedAt: toMs(x.updated_at),
    };
  },
};

// Registro per nome dello store locale. Ordine di push/pull: categories, items, history.
const TABLES = { categories, items, history };
const TABLE_ORDER = ['categories', 'items', 'history'];

// Decide cosa fare con una riga remota. local = riga locale o undefined; pending = voce outbox o undefined;
// remote = riga remota ({deleted, updated_at, ...}). Ritorna 'apply' | 'skip' | 'delete-local'.
function decideRemote({ local, pending, remote }) {
  const remoteStamp = toMs(remote.updated_at);
  const pendingAt = pending && Number.isFinite(pending.at) ? pending.at : -Infinity;
  if (remote.deleted === true) {
    if (!local) return 'skip';
    return remoteStamp >= Math.max(stampOf(local), pendingAt) ? 'delete-local' : 'skip';
  }
  if (!local) {
    // Cancellazione locale in coda più recente della riga remota: vince la cancellazione.
    if (pending && pending.op === 'del' && pendingAt >= remoteStamp) return 'skip';
    return 'apply';
  }
  return remoteStamp > Math.max(stampOf(local), pendingAt) ? 'apply' : 'skip';
}

// Ritardo di retry dopo il n-esimo fallimento consecutivo (1-based): 5 s, 15 s, 45 s, 120 s, poi 300 s.
const BACKOFF = [5000, 15000, 45000, 120000, 300000];
function backoffDelay(attempt) {
  const i = Math.max(0, Math.floor(attempt || 1) - 1);
  return BACKOFF[Math.min(i, BACKOFF.length - 1)];
}

__exp.toMs = toMs;
__exp.toIso = toIso;
__exp.stampOf = stampOf;
__exp.chunk = chunk;
__exp.TABLES = TABLES;
__exp.TABLE_ORDER = TABLE_ORDER;
__exp.decideRemote = decideRemote;
__exp.backoffDelay = backoffDelay;
});
__def('js/sync.js', function (__exp) {
// Motore di sincronizzazione Scadense <-> Supabase. Dipendenze iniettabili (testabili senza rete né IndexedDB).
// Senza sessione NON fa nessuna chiamata di rete. Non lancia mai verso la UI. Non importa viste.
const db = __req('js/db.js');
const sb = __req('js/supabase.js');
const conn = __req('js/connectivity.js');
const { TABLES, TABLE_ORDER, toMs, toIso, chunk, decideRemote, backoffDelay } = __req('js/sync-core.js');

const PUSH_CHUNK = 200;
const PAGE = 1000;
const DEBOUNCE_MS = 1500;
const TABLES_MISSING_MSG = 'Tabelle Supabase non trovate: esegui docs/supabase-scadense.sql';
const EPOCH = '1970-01-01T00:00:00.000Z';

function classify(err) {
  const code = String((err && (err.code || '')) || '');
  const status = err && err.status;
  const msg = String((err && err.message) || err || '');
  if (code === 'PGRST205' || code === '42P01' || status === 404) return { kind: 'tables', message: TABLES_MISSING_MSG };
  if (!code && (!status || status === 0) && /fetch|network|timeout|offline|load failed|abort/i.test(msg)) {
    return { kind: 'network', message: 'Sei offline: i dati verranno sincronizzati al ritorno della connessione.' };
  }
  if (status === 401 || status === 403 || code === '42501') return { kind: 'error', message: 'Accesso al cloud non autorizzato: riprova ad accedere.' };
  return { kind: 'error', message: 'Errore di sincronizzazione: ' + msg };
}

// deps: { store, getClient, getSession, connectivity, now?, schedule? }
//  store: getAll(store) get(store,key) applyRaw({puts,dels,dropOutbox}) outboxAll() outboxRemove(entries)
//         enqueueAll() getMeta(k,def) setMeta(k,v) clearSynced() [onChange(cb)]
//  schedule(fn, ms) deve ritornare una funzione di annullamento.
function createEngine(deps) {
  const { store, connectivity } = deps;
  const now = deps.now || Date.now;
  const schedule = deps.schedule || ((fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); });

  let status = { state: 'guest', lastSync: null, pending: 0, message: '' };
  const listeners = new Set();
  let chain = Promise.resolve();
  let queuedFull = null;
  let attempt = 0;
  let cancelRetry = null;
  let cancelDebounce = null;
  let started = false;

  const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

  function setStatus(patch) {
    status = { ...status, ...patch };
    for (const cb of listeners) { try { cb({ ...status }); } catch (e) { console.error(e); } }
  }
  const getStatus = () => ({ ...status });
  function onStatus(cb) {
    listeners.add(cb);
    try { cb({ ...status }); } catch (e) { console.error(e); }
    return () => listeners.delete(cb);
  }
  async function pendingCount() {
    try { return (await store.outboxAll()).length; } catch (e) { return 0; }
  }

  async function resolveSession(known) {
    if (known && known.user && known.user.id) return known;
    try {
      const s = await deps.getSession();
      return s && s.user && s.user.id ? s : null;
    } catch (e) { return null; }
  }

  function scheduleRetry() {
    if (cancelRetry) cancelRetry();
    attempt += 1;
    cancelRetry = schedule(() => { cancelRetry = null; fullSync(); }, backoffDelay(attempt));
  }
  function resetRetry() {
    attempt = 0;
    if (cancelRetry) { cancelRetry(); cancelRetry = null; }
  }

  // Registra l'esito di un errore: stato, raggiungibilità, retry.
  async function fail(c) {
    if (c.kind === 'network') connectivity.markUnreachable();
    setStatus({ state: c.kind === 'network' ? 'offline' : 'error', message: c.message, pending: await pendingCount() });
    if (c.kind !== 'tables') scheduleRetry();
    return { ok: false, error: c };
  }

  // ---- Push ----
  async function pushNow(session) {
    const uid = session.user.id;
    const client = deps.getClient();
    if (!client) return { ok: false, pushed: 0, error: { kind: 'error', message: 'Libreria Supabase non disponibile.' } };
    const entries = await store.outboxAll();
    if (!entries.length) return { ok: true, pushed: 0 };
    let pushed = 0;
    for (const name of TABLE_ORDER) {
      const T = TABLES[name];
      const mine = entries.filter((e) => e.store === name);
      if (!mine.length) continue;
      const live = [], tomb = [], consumed = [];
      for (const e of mine) {
        if (e.op === 'del') {
          tomb.push({ user_id: uid, id: e.id, deleted: true, updated_at: toIso(e.at) });
        } else {
          const row = await store.get(name, e.id);
          if (row) live.push({ ...T.toRemote(row), user_id: uid, deleted: false });
        }
        consumed.push(e);
      }
      // Batch separati: PostgREST unisce le colonne dentro uno stesso batch.
      for (const batch of [...chunk(live, PUSH_CHUNK), ...chunk(tomb, PUSH_CHUNK)]) {
        const { error } = await client.from(T.remote).upsert(batch, { onConflict: 'user_id,id' });
        if (error) return { ok: false, pushed, error: classify(error), raw: error };
        pushed += batch.length;
      }
      await store.outboxRemove(consumed);
    }
    return { ok: true, pushed };
  }

  // ---- Pull ----
  async function pullNow(session) {
    const uid = session.user.id;
    const client = deps.getClient();
    if (!client) return { ok: false, applied: 0, error: { kind: 'error', message: 'Libreria Supabase non disponibile.' } };
    let applied = 0;
    for (const name of TABLE_ORDER) {
      const T = TABLES[name];
      const curKey = `sync.pull.${uid}.${T.remote}`;
      const cursor = (await store.getMeta(curKey, null)) || EPOCH;
      const rows = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await client.from(T.remote).select('*').eq('user_id', uid).gte('synced_at', cursor)
          .order('synced_at', { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1);
        if (error) return { ok: false, applied, error: classify(error), raw: error };
        const page = data || [];
        rows.push(...page);
        if (page.length < PAGE) break;
      }
      if (rows.length) {
        const locals = new Map((await store.getAll(name)).map((r) => [r.id, r]));
        const pendings = new Map((await store.outboxAll()).filter((e) => e.store === name).map((e) => [e.id, e]));
        const puts = [], dels = [], drop = [];
        for (const r of rows) {
          const local = locals.get(r.id), pending = pendings.get(r.id);
          const act = decideRemote({ local, pending, remote: r });
          if (act === 'apply') { puts.push({ store: name, row: T.toLocal(r) }); if (pending) drop.push(pending.tid); }
          else if (act === 'delete-local') { dels.push({ store: name, id: r.id }); if (pending) drop.push(pending.tid); }
        }
        await store.applyRaw({ puts, dels, dropOutbox: drop });
        applied += puts.length + dels.length;
        // Cursore avanzato UNA volta, al massimo synced_at visto, solo dopo aver applicato tutte le pagine.
        let max = rows[0].synced_at;
        for (const r of rows) if (toMs(r.synced_at) > toMs(max)) max = r.synced_at;
        if (max) await store.setMeta(curKey, max);
      }
      // Una SELECT riuscita (anche vuota) = Supabase raggiungibile.
      connectivity.markReachable();
    }
    return { ok: true, applied };
  }

  // ---- API pubblica ----
  async function runFull(known) {
    try {
      const session = await resolveSession(known);
      if (!session) {
        setStatus({ state: 'guest', message: '', pending: await pendingCount() });
        return { ok: false, reason: 'no-session', applied: 0, pushed: 0 };
      }
      setStatus({ state: 'syncing', message: '' });
      const pl = await pullNow(session);
      if (!pl.ok) return { ...(await fail(pl.error)), applied: pl.applied, pushed: 0 };
      const ps = await pushNow(session);
      if (!ps.ok) return { ...(await fail(ps.error)), applied: pl.applied, pushed: ps.pushed };
      connectivity.markReachable();
      resetRetry();
      const t = now();
      await store.setMeta('sync.lastSync', t);
      await store.setMeta('sync.lastUser', session.user.id);
      setStatus({ state: 'idle', lastSync: t, message: '', pending: await pendingCount() });
      return { ok: true, applied: pl.applied, pushed: ps.pushed };
    } catch (e) {
      return { ...(await fail(classify(e))), applied: 0, pushed: 0 };
    }
  }

  function fullSync(knownSession) {
    if (queuedFull) return queuedFull;
    queuedFull = serial(() => { queuedFull = null; return runFull(knownSession); });
    return queuedFull;
  }

  function runSide(op) {
    return serial(async () => {
      try {
        const session = await resolveSession();
        if (!session) { setStatus({ state: 'guest', message: '', pending: await pendingCount() }); return { ok: false, reason: 'no-session', applied: 0, pushed: 0 }; }
        setStatus({ state: 'syncing', message: '' });
        const r = await op(session);
        if (!r.ok) return { ...(await fail(r.error)), applied: r.applied || 0, pushed: r.pushed || 0 };
        connectivity.markReachable();
        resetRetry();
        const t = now();
        setStatus({ state: 'idle', lastSync: t, message: '', pending: await pendingCount() });
        return { ok: true, applied: r.applied || 0, pushed: r.pushed || 0 };
      } catch (e) { return { ...(await fail(classify(e))), applied: 0, pushed: 0 }; }
    });
  }
  const push = () => runSide(pushNow);
  const pull = () => runSide(pullNow);

  // Baseline di primo accesso: accoda TUTTE le righe locali e le invia PRIMA del primo pull,
  // così un remoto vuoto o parziale non può cancellare i dati locali. Poi sincronizza.
  function uploadLocalData(knownSession) {
    return serial(async () => {
      try {
        const session = await resolveSession(knownSession);
        if (!session) return { ok: false, reason: 'no-session', applied: 0, pushed: 0 };
        setStatus({ state: 'syncing', message: '' });
        await store.enqueueAll();
        const ps = await pushNow(session);
        if (!ps.ok) return { ...(await fail(ps.error)), applied: 0, pushed: ps.pushed };
        await store.setMeta(`sync.migrated.${session.user.id}`, 'done');
        return await runFull(session);
      } catch (e) { return { ...(await fail(classify(e))), applied: 0, pushed: 0 }; }
    });
  }

  // Cambio account: svuota dati sincronizzati e outbox (categorie predefinite re-inserite), azzera i cursori.
  async function switchAccount(newUid) {
    await serial(async () => {
      await store.clearSynced();
      for (const name of TABLE_ORDER) await store.setMeta(`sync.pull.${newUid}.${TABLES[name].remote}`, null);
      await store.setMeta(`sync.migrated.${newUid}`, null);
      await store.setMeta('sync.lastUser', newUid);
      setStatus({ pending: 0 });
    });
  }

  function start() {
    if (started) return;
    started = true;
    if (typeof store.onChange === 'function') {
      store.onChange(() => {
        if (cancelDebounce) cancelDebounce();
        cancelDebounce = schedule(() => { cancelDebounce = null; push(); }, DEBOUNCE_MS);
        pendingCount().then((n) => setStatus({ pending: n }));
      });
    }
  }
  function stop() {
    started = false;
    if (cancelRetry) { cancelRetry(); cancelRetry = null; }
    if (cancelDebounce) { cancelDebounce(); cancelDebounce = null; }
    attempt = 0;
    if (typeof store.onChange === 'function') store.onChange(null);
    setStatus({ state: 'guest', message: '' });
  }

  return { start, stop, fullSync, push, pull, uploadLocalData, switchAccount, onStatus, getStatus, pendingCount };
}

// ---- Istanza predefinita con db.js / supabase.js / connectivity.js ----
const engine = createEngine({
  store: {
    getAll: db.getAll, get: db.get, applyRaw: db.applyRaw, outboxAll: db.outboxAll, outboxRemove: db.outboxRemove,
    enqueueAll: db.enqueueAll, getMeta: db.getMeta, setMeta: db.setMeta, clearSynced: db.clearSynced, onChange: db.onChange,
  },
  getClient: sb.getClient,
  getSession: sb.getSession,
  connectivity: conn,
});

const start = () => engine.start();
const stop = () => engine.stop();
const fullSync = (s) => engine.fullSync(s);
const push = () => engine.push();
const pull = () => engine.pull();
const uploadLocalData = (s) => engine.uploadLocalData(s);
const switchAccount = (uid) => engine.switchAccount(uid);
const onStatus = (cb) => engine.onStatus(cb);
const getStatus = () => engine.getStatus();
const pendingCount = () => engine.pendingCount();

__exp.createEngine = createEngine;
__exp.engine = engine;
__exp.start = start;
__exp.stop = stop;
__exp.fullSync = fullSync;
__exp.push = push;
__exp.pull = pull;
__exp.uploadLocalData = uploadLocalData;
__exp.switchAccount = switchAccount;
__exp.onStatus = onStatus;
__exp.getStatus = getStatus;
__exp.pendingCount = pendingCount;
});
__def('js/views/auth.js', function (__exp) {
// Dialog di autenticazione: accesso / registrazione / recupero, nuova password, primo accesso, cambio account.
const { h, modal, sheetHeader, field, setError, toast } = __req('js/ui.js');
const { signIn, signUp, resetPassword, updatePassword, authErrorMessage, authAvailable } = __req('js/supabase.js');

const LIB_MSG = 'Accesso e sincronizzazione non disponibili: la libreria non è stata caricata. Scadense continua a funzionare in locale.';
const OFFLINE_HINT = 'Sei offline: per accedere serve una connessione.';

// Modalità: login | signup | recover. Il dialog resta aperto in caso di errore.
function openAuthModal({ onDone } = {}) {
  let mode = 'login';
  return modal((close) => {
    const email = h('input', { type: 'email', autocomplete: 'email', inputmode: 'email', placeholder: 'tu@email.it' });
    const pass = h('input', { type: 'password', autocomplete: 'current-password' });
    const emailF = field('Email', email);
    const passF = field('Password', pass, { hint: 'Almeno 6 caratteri.' });
    const formErr = h('p', { class: 'err', role: 'alert' });
    const intro = h('p', { class: 'muted' });
    const offlineNote = h('p', { class: 'muted', hidden: true }, OFFLINE_HINT);
    const heading = sheetHeader('Accesso', close);
    const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary' });
    const forgot = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { mode = 'recover'; apply(); email.focus(); } }, 'Password dimenticata?');
    const toggle = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { mode = mode === 'login' ? 'signup' : 'login'; apply(); } });
    const back = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { mode = 'login'; apply(); } }, '‹ Torna all\'accesso');
    const libNote = h('p', { class: 'err', role: 'alert', hidden: authAvailable() }, LIB_MSG);

    function apply() {
      formErr.textContent = '';
      setError(email, ''); setError(pass, '');
      passF.hidden = mode === 'recover';
      forgot.hidden = mode !== 'login';
      toggle.hidden = mode === 'recover';
      back.hidden = mode !== 'recover';
      offlineNote.hidden = navigator.onLine !== false;
      if (mode === 'login') {
        intro.textContent = 'Accedi per sincronizzare le tue scadenze sul cloud e usarle su più dispositivi. Scadense funziona comunque anche senza account e offline.';
        submitBtn.textContent = 'Accedi';
        toggle.textContent = 'Non hai un account? Registrati';
        pass.autocomplete = 'current-password';
      } else if (mode === 'signup') {
        intro.textContent = 'Crea un account per salvare le tue scadenze sul cloud. Puoi usare lo stesso account delle altre app.';
        submitBtn.textContent = 'Registrati';
        toggle.textContent = 'Hai già un account? Accedi';
        pass.autocomplete = 'new-password';
      } else {
        intro.textContent = 'Inserisci la tua email: ti invieremo un link per reimpostare la password.';
        submitBtn.textContent = 'Invia link di recupero';
      }
    }

    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (submitBtn.disabled) return;
      const em = email.value.trim();
      const pw = pass.value;
      formErr.textContent = '';
      setError(email, em ? '' : 'Inserisci la tua email.');
      const needPw = mode !== 'recover';
      setError(pass, !needPw ? '' : (!pw ? 'Inserisci la password.' : (mode === 'signup' && pw.length < 6 ? 'La password deve avere almeno 6 caratteri.' : '')));
      if (!em || (needPw && (!pw || (mode === 'signup' && pw.length < 6)))) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
      submitBtn.disabled = true;
      try {
        const res = mode === 'login' ? await signIn(em, pw) : mode === 'signup' ? await signUp(em, pw) : await resetPassword(em);
        if (res && res.error) { formErr.textContent = authErrorMessage(res.error); return; }
        if (mode === 'recover') {
          toast('Se l\'email è registrata, riceverai un link per reimpostare la password.');
          close(true);
        } else if (mode === 'signup') {
          toast('Registrazione effettuata. Controlla la tua email se richiesto.');
          close(true);
          if (res && res.data && res.data.session && typeof onDone === 'function') onDone();
        } else {
          toast('Accesso effettuato');
          close(true);
          if (typeof onDone === 'function') onDone();
        }
      } catch (err) {
        console.error(err);
        formErr.textContent = authErrorMessage(err);
      } finally {
        submitBtn.disabled = false;
      }
    } },
      heading, intro, libNote, offlineNote, emailF, passF, formErr,
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Annulla'),
        submitBtn),
      forgot, toggle, back);
    apply();
    setTimeout(() => email.focus(), 50);
    return form;
  }, { label: 'Accesso' });
}

// Dialog "nuova password" dopo l'evento PASSWORD_RECOVERY. Chiude solo con successo o Annulla.
function openNewPasswordModal() {
  return modal((close) => {
    const p1 = h('input', { type: 'password', autocomplete: 'new-password' });
    const p2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const formErr = h('p', { class: 'err', role: 'alert' });
    const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Salva password');
    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (submitBtn.disabled) return;
      formErr.textContent = '';
      setError(p1, !p1.value ? 'Inserisci la nuova password.' : (p1.value.length < 6 ? 'La password deve avere almeno 6 caratteri.' : ''));
      setError(p2, p1.value && p2.value !== p1.value ? 'Le due password non coincidono.' : '');
      if (form.querySelector('[aria-invalid="true"]')) { form.querySelector('[aria-invalid="true"]').focus(); return; }
      submitBtn.disabled = true;
      try {
        const { error } = await updatePassword(p1.value);
        if (error) { formErr.textContent = authErrorMessage(error); return; }
        toast('Password aggiornata');
        close(true);
      } catch (err) {
        console.error(err);
        formErr.textContent = authErrorMessage(err);
      } finally { submitBtn.disabled = false; }
    } },
      sheetHeader('Nuova password', close),
      h('p', { class: 'muted' }, 'Imposta la tua nuova password.'),
      field('Nuova password', p1), field('Ripeti password', p2), formErr,
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Annulla'),
        submitBtn));
    setTimeout(() => p1.focus(), 50);
    return form;
  }, { label: 'Nuova password' });
}

// Primo accesso con dati locali: 'upload' | 'later'.
function askUploadLocal(counts) {
  const c = counts || {};
  const msg = `Trovati ${c.items || 0} scadenze, ${c.categories || 0} categorie su questo dispositivo. Vuoi caricarle nel tuo account? I dati già presenti nel cloud vengono uniti, niente viene cancellato.`;
  return modal((close) => h('div', null,
    sheetHeader('Carica i dati di questo dispositivo?', () => close('later')),
    h('p', { class: 'muted' }, msg),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', onclick: () => close('later') }, 'Non ora'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => close('upload') }, 'Carica e unisci'))),
  { label: 'Carica i dati di questo dispositivo' }).then((v) => (v === 'upload' ? 'upload' : 'later'));
}

// Cambio account: true = sostituisci, false = annulla (il chiamante esegue signOut).
function confirmAccountSwitch() {
  return modal((close) => h('div', null,
    sheetHeader('Cambio account', () => close(false)),
    h('p', { class: 'muted' }, 'Questo dispositivo contiene i dati di un altro account. Per continuare verranno sostituiti con quelli di questo account. Esporta prima un backup se ti serve.'),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', onclick: () => close(false) }, 'Annulla'),
      h('button', { type: 'button', class: 'btn btn-danger', onclick: () => close(true) }, 'Sostituisci'))),
  { label: 'Cambio account' }).then((v) => v === true);
}

__exp.openAuthModal = openAuthModal;
__exp.openNewPasswordModal = openNewPasswordModal;
__exp.askUploadLocal = askUploadLocal;
__exp.confirmAccountSwitch = confirmAccountSwitch;
});
__def('js/sync-chip.js', function (__exp) {
// Chip di stato sincronizzazione nell'header (#sync-chip). Nascosto se la libreria Supabase non c'è.
const { onStatus } = __req('js/sync.js');
const { authAvailable } = __req('js/supabase.js');
const { openAuthModal } = __req('js/views/auth.js');
const { toast } = __req('js/ui.js');

const ERR_COOLDOWN = 8000;

function describe(st) {
  if (st.state === 'guest') return { text: 'Accedi', label: 'Accedi per sincronizzare le scadenze' };
  if (st.state === 'syncing') return { text: 'Sincronizzo…', label: 'Sincronizzazione in corso' };
  if (st.state === 'offline') return { text: 'Offline', label: 'Offline: i dati verranno sincronizzati al ritorno della connessione' };
  if (st.state === 'error') return { text: 'Errore sync', label: 'Errore di sincronizzazione' };
  if (st.pending > 0) return { text: `Da sincronizzare (${st.pending})`, label: `${st.pending} modifiche da sincronizzare` };
  return { text: 'Sincronizzato', label: 'Dati sincronizzati' };
}

function mountSyncChip(button) {
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

__exp.mountSyncChip = mountSyncChip;
});
__def('js/cloud.js', function (__exp) {
// Orchestrazione cloud: sessione, primo accesso, cambio account, trigger di sync.
// Non blocca mai l'avvio e non lancia mai verso la UI. Senza sessione nessuna chiamata di rete.
const { authAvailable, onAuthStateChange, signOut } = __req('js/supabase.js');
const connectivity = __req('js/connectivity.js');
const sync = __req('js/sync.js');
const { getMeta, setMeta, countLocalData, outboxAll, outboxRemove } = __req('js/db.js');
const { mountSyncChip } = __req('js/sync-chip.js');
const { openNewPasswordModal, askUploadLocal, confirmAccountSwitch } = __req('js/views/auth.js');

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

async function startCloud() {
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

__exp.startCloud = startCloud;
});
__def('js/dates.js', function (__exp) {
// Date come stringhe locali 'YYYY-MM-DD'; calcoli con Date a mezzogiorno locale.
const pad = (n) => String(n).padStart(2, '0');

function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(y, mo - 1, d, 12);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

const isValidISO = (s) => typeof s === 'string' && parseISO(s) !== null;
const todayISO = () => toISO(new Date());

function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

// Somma mesi con clamp a fine mese (31 gen + 1 mese = 28/29 feb).
function addMonths(iso, n) {
  const d = parseISO(iso);
  const day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1, 12);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0, 12).getDate();
  t.setDate(Math.min(day, last));
  return toISO(t);
}

// Giorni da a verso b (b - a).
function diffDays(a, b) {
  const A = parseISO(a), B = parseISO(b);
  const ua = Date.UTC(A.getFullYear(), A.getMonth(), A.getDate());
  const ub = Date.UTC(B.getFullYear(), B.getMonth(), B.getDate());
  return Math.round((ub - ua) / 86400000);
}

const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const DAYS_SHORT = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const DAYS_LONG = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

function formatShort(iso) {
  const d = parseISO(iso);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function formatLong(iso) {
  const d = parseISO(iso);
  return `${DAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].toLowerCase()} ${d.getFullYear()}`;
}

function formatDayShort(iso) {
  const d = parseISO(iso);
  return `${DAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

const monthLabel = (y, m) => `${MONTHS[m]} ${y}`;
const monthKey = (iso) => iso.slice(0, 7);

__exp.pad = pad;
__exp.toISO = toISO;
__exp.parseISO = parseISO;
__exp.isValidISO = isValidISO;
__exp.todayISO = todayISO;
__exp.addDays = addDays;
__exp.addMonths = addMonths;
__exp.diffDays = diffDays;
__exp.MONTHS = MONTHS;
__exp.formatShort = formatShort;
__exp.formatLong = formatLong;
__exp.formatDayShort = formatDayShort;
__exp.monthLabel = monthLabel;
__exp.monthKey = monthKey;
});
__def('js/recurrence.js', function (__exp) {
const { addMonths, addDays, todayISO } = __req('js/dates.js');
const ITEM_END_LIMIT = 600;

const PRESETS = [
  { id: 'none', label: 'Nessuna', unit: 'none', every: 0 },
  { id: 'm1', label: 'Ogni mese', unit: 'month', every: 1 },
  { id: 'm3', label: 'Ogni trimestre', unit: 'month', every: 3 },
  { id: 'm6', label: 'Ogni semestre', unit: 'month', every: 6 },
  { id: 'y1', label: 'Ogni anno', unit: 'year', every: 1 },
  { id: 'y2', label: 'Ogni 2 anni', unit: 'year', every: 2 },
];

function monthsOf(rec) {
  if (!rec || (rec.unit !== 'month' && rec.unit !== 'year')) return 0;
  const n = Math.floor(Number(rec.every));
  if (!(n > 0)) return 0;
  return rec.unit === 'year' ? n * 12 : n;
}

const isRecurring = (rec) => monthsOf(rec) > 0;

function presetIdOf(rec) {
  if (!isRecurring(rec)) return 'none';
  const p = PRESETS.find((x) => x.unit === rec.unit && x.every === rec.every);
  return p ? p.id : 'custom';
}

function describeRecurrence(rec) {
  if (!isRecurring(rec)) return 'Non ricorrente';
  const p = PRESETS.find((x) => x.unit === rec.unit && x.every === rec.every);
  if (p) return p.label;
  const n = rec.every;
  if (rec.unit === 'year') return n === 1 ? 'Ogni anno' : `Ogni ${n} anni`;
  return n === 1 ? 'Ogni mese' : `Ogni ${n} mesi`;
}

// Prossima scadenza dopo `dueISO`. Se `fromISO` è dato, salta le date precedenti.
// Se `endISO` è dato e la prossima data lo supera ritorna null (serie conclusa).
function nextDue(dueISO, rec, fromISO, endISO) {
  const m = monthsOf(rec);
  if (!m) return null;
  let k = 1;
  let next = addMonths(dueISO, m);
  if (fromISO) {
    while (next < fromISO) { k++; next = addMonths(dueISO, m * k); }
  }
  if (endISO && next > endISO) return null;
  return next;
}
const hasEnd = (item) => !!(item && item.endDate && isRecurring(item.recurrence));
// Voce attiva, non in pausa e non disdetta: genera scadenze, costi e promemoria.
const isActiveSchedule = (item) => item.status === 'active' && !item.paused && !item.cancelledOn;
// Date da `dueISO` a `endISO` (inclusa) secondo la ricorrenza.
function occurrenceDates(dueISO, rec, endISO, limit = ITEM_END_LIMIT) {
  const out = [];
  const m = monthsOf(rec);
  if (!m) { if (!endISO || dueISO <= endISO) out.push(dueISO); return out; }
  for (let k = 0; k < limit; k++) {
    const d = addMonths(dueISO, m * k);
    if (endISO && d > endISO) break;
    out.push(d);
  }
  return out;
}
const countOccurrences = (dueISO, rec, endISO) => occurrenceDates(dueISO, rec, endISO).length;
// Data dell'ultima rata dato il numero di rate (la prima è `dueISO`).
function endFromCount(dueISO, rec, n) {
  return addMonths(dueISO, monthsOf(rec) * (Math.max(1, n) - 1));
}
function remainingCount(item) {
  if (!hasEnd(item)) return null;
  return countOccurrences(item.dueDate, item.recurrence, item.endDate);
}
function lastOccurrence(item) {
  if (!hasEnd(item)) return null;
  const l = occurrenceDates(item.dueDate, item.recurrence, item.endDate);
  return l.length ? l[l.length - 1] : item.dueDate;
}
function remainingTotal(item) {
  const r = remainingCount(item);
  if (r === null || !(item.amount > 0)) return null;
  return r * item.amount;
}
// Rate già pagate / totali / percentuale (solo voci a termine).
function progress(item) {
  const r = remainingCount(item);
  if (r === null) return null;
  const paid = Math.max(0, Math.floor(item.paidCount || 0));
  const total = paid + r;
  return { paid, total, remaining: r, pct: total ? Math.round((paid / total) * 100) : 0 };
}
// Costo annuo stimato (solo voci ricorrenti con importo, attive).
// Con data di fine: somma delle rate nei 12 mesi da `fromISO`.
function annualCost(item, fromISO = todayISO()) {
  const m = monthsOf(item.recurrence);
  if (!m || !(item.amount > 0) || item.paused || item.cancelledOn) return 0;
  if (!item.endDate) return (item.amount * 12) / m;
  return occurrences(item, fromISO, addDays(addMonths(fromISO, 12), -1)).length * item.amount;
}
// Date delle occorrenze in [startISO, endISO]; le scadute contano come "oggi".
function occurrences(item, startISO, endISO) {
  const out = [];
  if (item.paused || item.cancelledOn) return out;
  const m = monthsOf(item.recurrence);
  const stop = item.endDate && m ? (item.endDate < endISO ? item.endDate : endISO) : endISO;
  if (m && item.endDate && item.endDate < startISO) return out; // serie già terminata
  let d = item.dueDate;
  if (!m) {
    if (d <= endISO) out.push(d < startISO ? startISO : d);
    return out;
  }
  let k = 0;
  while (d <= stop && k < ITEM_END_LIMIT) {
    if (d >= startISO) out.push(d);
    else if (k === 0) out.push(startISO);
    k++;
    d = addMonths(item.dueDate, m * k);
  }
  return out;
}
__exp.ITEM_END_LIMIT = ITEM_END_LIMIT;
__exp.PRESETS = PRESETS;
__exp.monthsOf = monthsOf;
__exp.isRecurring = isRecurring;
__exp.presetIdOf = presetIdOf;
__exp.describeRecurrence = describeRecurrence;
__exp.nextDue = nextDue;
__exp.hasEnd = hasEnd;
__exp.isActiveSchedule = isActiveSchedule;
__exp.occurrenceDates = occurrenceDates;
__exp.countOccurrences = countOccurrences;
__exp.endFromCount = endFromCount;
__exp.remainingCount = remainingCount;
__exp.lastOccurrence = lastOccurrence;
__exp.remainingTotal = remainingTotal;
__exp.progress = progress;
__exp.annualCost = annualCost;
__exp.occurrences = occurrences;
});
__def('js/model.js', function (__exp) {
const { diffDays, todayISO, addDays, addMonths, formatShort } = __req('js/dates.js');
const { isRecurring, annualCost, nextDue, isActiveSchedule, hasEnd, remainingCount, endFromCount, ITEM_END_LIMIT } = __req('js/recurrence.js');
const { transact, uuid, getAll, normalizeItem } = __req('js/db.js');

const GROUPS = [
  { id: 'scadute', label: 'Scadute' },
  { id: 'settimana', label: 'Questa settimana' },
  { id: 'mese', label: 'Questo mese' },
  { id: 'dopo', label: 'Più avanti' },
];

function daysLeft(item, today = todayISO()) {
  return diffDays(today, item.dueDate);
}

const isLive = isActiveSchedule;

// Categoria "Abbonamenti": l'unico criterio per stare nella vista Abbonamenti (il pagamento automatico � indipendente).
const SUBSCRIPTION_CATEGORY_ID = 'abbonamenti';
const isSubscription = (item) => item.categoryId === SUBSCRIPTION_CATEGORY_ID
  && (item.status === 'active' || (item.status === 'archived' && item.closedReason === 'cancelled'));
// Pausa e disdetta: per i pagamenti automatici e per le voci della categoria Abbonamenti.
const canPauseCancel = (item) => !!item.autoPay || item.categoryId === SUBSCRIPTION_CATEGORY_ID;

// Costo per categoria: annuo, oppure mensile (annuo / 12). In modalit� mensile gli importi sono in centesimi
// ripartiti con il metodo del resto pi� alto, cos� la somma delle righe coincide con il totale mensile arrotondato.
function costByCategory(items, cats, mode = 'annual') {
  const rec = items.filter((i) => isLive(i) && isRecurring(i.recurrence) && i.amount > 0);
  const rows = cats.map((c) => ({ c, v: rec.filter((i) => i.categoryId === c.id).reduce((s, i) => s + annualCost(i), 0) }))
    .filter((x) => x.v > 0);
  if (mode === 'monthly') {
    const raw = rows.map((x) => (x.v / 12) * 100);
    const cents = raw.map(Math.floor);
    let left = Math.round(raw.reduce((s, v) => s + v, 0)) - cents.reduce((s, v) => s + v, 0);
    raw.map((v, k) => [v - cents[k], k]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, k]) => { if (left > 0) { cents[k]++; left--; } });
    rows.forEach((x, k) => { x.v = cents[k] / 100; });
  }
  return rows.filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
}
function groupOf(item, today = todayISO()) {
  if (item.paused || item.cancelledOn) return 'dopo';
  let d = daysLeft(item, today);
  if (item.autoPay && d < 0) d = 0;
  if (d < 0) return 'scadute';
  if (d <= 7) return 'settimana';
  if (d <= 30) return 'mese';
  return 'dopo';
}

function sortByUrgency(list) {
  return [...list].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.title.localeCompare(b.title, 'it')));
}

// Testo + tono del badge giorni rimanenti.
function badgeOf(item, today = todayISO()) {
  const d = daysLeft(item, today);
  if (item.paused) return { text: 'In pausa', tone: 'far', icon: '⏸' };
  if (item.cancelledOn) return { text: `Disdetto · fino al ${formatShort(item.cancelledOn)}`, tone: 'far', icon: '✕' };
  if (item.autoPay) {
    if (d <= 0) return { text: 'Addebito oggi', tone: 'auto', icon: '⟳' };
    if (d === 1) return { text: 'Addebito domani', tone: 'auto', icon: '⟳' };
    return { text: `Addebito tra ${d} g`, tone: 'auto', icon: '⟳' };
  }
  if (d < 0) return { text: d === -1 ? 'Scaduta ieri' : `Scaduta da ${-d} g`, tone: 'late', icon: '⚠' };
  if (d === 0) return { text: 'Oggi', tone: 'soon', icon: '●' };
  if (d === 1) return { text: 'Domani', tone: 'soon', icon: '●' };
  if (d <= 7) return { text: `Tra ${d} g`, tone: 'soon', icon: '●' };
  if (d <= 30) return { text: `Tra ${d} g`, tone: 'near', icon: '◐' };
  if (d < 100) return { text: `Tra ${d} g`, tone: 'far', icon: '○' };
  return { text: `Tra ${Math.round(d / 30)} mesi`, tone: 'far', icon: '○' };
}

// Segna come fatto. Ricorrente: avanza la data; altrimenti archivia. Ritorna info per annullare.
// Voci a termine (data di fine/rate): avanza di un solo passo e conclude dopo l'ultima rata.
async function markDone(item, { doneOn = todayISO(), amount = null, note = '' } = {}) {
  const before = { ...item, recurrence: { ...item.recurrence } };
  const entry = { id: uuid(), itemId: item.id, doneOn, dueWas: item.dueDate, amount: amount ?? null, note };
  const after = { ...item, updatedAt: Date.now(), paidCount: (item.paidCount || 0) + 1 };
  if (isRecurring(item.recurrence)) {
    if (hasEnd(item)) {
      const nx = nextDue(item.dueDate, item.recurrence, undefined, item.endDate);
      if (nx) after.dueDate = nx; else { after.status = 'archived'; after.closedReason = 'concluded'; }
    } else {
      after.dueDate = nextDue(item.dueDate, item.recurrence, doneOn);
    }
  } else {
    after.status = 'archived';
  }
  await transact(['items', 'history'], (s) => {
    s.items.put(after);
    s.history.put(entry);
  });
  return { before, after, entry };
}
// Piano puro di rollover per un pagamento automatico: ritorna {after, entries} o null.
function planRollover(raw, today = todayISO()) {
  const item = normalizeItem(raw);
  if (item.status !== 'active') return null;
  if (item.cancelledOn && item.cancelledOn < today) {
    return { after: { ...item, status: 'archived', closedReason: 'cancelled', updatedAt: Date.now() }, entries: [] };
  }
  if (!item.autoPay || item.paused || item.cancelledOn || item.dueDate >= today) return null;
  const entries = [];
  let due = item.dueDate;
  let paid = item.paidCount;
  let concluded = false;
  for (let i = 0; i < ITEM_END_LIMIT && due < today; i++) {
    entries.push({ id: `auto-${item.id}-${due}`, itemId: item.id, doneOn: due, dueWas: due, amount: item.amount > 0 ? item.amount : null, note: 'Addebito automatico', auto: true });
    paid++;
    const nx = nextDue(due, item.recurrence, undefined, item.endDate);
    if (!nx) { concluded = true; break; }
    due = nx;
  }
  const after = { ...item, dueDate: due, paidCount: paid, updatedAt: Date.now() };
  if (concluded) { after.status = 'archived'; after.closedReason = 'concluded'; }
  return { after, entries };
}
// Registra gli addebiti automatici mancanti. Non emette eventi. Ritorna il numero di addebiti.
let rolloverChain = Promise.resolve();
function runRollover(today = todayISO()) {
  const job = rolloverChain.then(async () => {
    const plans = (await getAll('items')).map((i) => planRollover(i, today)).filter(Boolean);
    if (!plans.length) return 0;
    await transact(['items', 'history'], (s) => {
      plans.forEach((p) => { s.items.put(p.after); p.entries.forEach((e) => s.history.put(e)); });
    });
    return plans.reduce((n, p) => n + p.entries.length, 0);
  });
  rolloverChain = job.catch(() => {});
  return job;
}
async function undoDone({ before, entry }) {
  await transact(['items', 'history'], (s) => {
    s.items.put(before);
    s.history.delete(entry.id);
  });
}

async function setDueDate(item, dueDate) {
  const before = { ...item };
  const after = { ...item, dueDate, updatedAt: Date.now() };
  // Voci a termine: le rate rimanenti restano le stesse, si sposta anche la fine.
  if (hasEnd(item)) after.endDate = endFromCount(dueDate, item.recurrence, remainingCount(item) || 1);
  await transact(['items'], (s) => { s.items.put(after); });
  return { before, after };
}
async function patchItem(item, patch) {
  const before = { ...item };
  const after = { ...item, ...patch, updatedAt: Date.now() };
  await transact(['items'], (s) => { s.items.put(after); });
  return { before, after };
}
const setPaused = (item, paused, nextDate) => patchItem(item, paused ? { paused: true } : { paused: false, dueDate: nextDate || item.dueDate });
const setCancelled = (item, dateOrNull) => patchItem(item, { cancelledOn: dateOrNull || null });
const restoreItem = (item) => patchItem(item, { status: 'active', closedReason: null, cancelledOn: null });

function postponeTarget(item, kind, today = todayISO()) {
  const base = item.dueDate > today ? item.dueDate : today;
  if (kind === 'day') return addDays(base, 1);
  if (kind === 'week') return addDays(base, 7);
  return addMonths(base, 1);
}

const formatMoney = (n) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n || 0);



__exp.GROUPS = GROUPS;
__exp.daysLeft = daysLeft;
__exp.isLive = isLive;
__exp.SUBSCRIPTION_CATEGORY_ID = SUBSCRIPTION_CATEGORY_ID;
__exp.isSubscription = isSubscription;
__exp.canPauseCancel = canPauseCancel;
__exp.costByCategory = costByCategory;
__exp.groupOf = groupOf;
__exp.sortByUrgency = sortByUrgency;
__exp.badgeOf = badgeOf;
__exp.markDone = markDone;
__exp.planRollover = planRollover;
__exp.runRollover = runRollover;
__exp.undoDone = undoDone;
__exp.setDueDate = setDueDate;
__exp.setPaused = setPaused;
__exp.setCancelled = setCancelled;
__exp.restoreItem = restoreItem;
__exp.postponeTarget = postponeTarget;
__exp.formatMoney = formatMoney;
__exp.formatShort = formatShort;
});
__def('js/reminders.js', function (__exp) {
const { diffDays, todayISO } = __req('js/dates.js');
const { getAll, getMeta, setMeta } = __req('js/db.js');
const { sortByUrgency, isLive } = __req('js/model.js');

// Voci attive scadute o entro il loro periodo di preavviso.
function dueForReminder(items, today = todayISO()) {
  return sortByUrgency(items.filter((i) => {
    if (!isLive(i)) return false;
    const d = diffDays(today, i.dueDate);
    // Pagamenti automatici: solo avviso pre-addebito, mai "scaduti".
    return i.autoPay ? d >= 0 && d <= (i.remindDays || 0) : d <= (i.remindDays || 0);
  }));
}

function summaryText(n) {
  return n === 1 ? '1 scadenza richiede attenzione' : `${n} scadenze richiedono attenzione`;
}

const notificationsSupported = () => 'Notification' in window;

// All'apertura: badge e (se abilitata) notifica una volta al giorno. Fallback silenzioso.
async function runReminders() {
  try {
    const list = dueForReminder(await getAll('items'));
    if (navigator.setAppBadge) {
      if (list.length) await navigator.setAppBadge(list.length); else await navigator.clearAppBadge();
    }
    const enabled = await getMeta('notify', false);
    const today = todayISO();
    if (!enabled || !list.length || !notificationsSupported() || Notification.permission !== 'granted') return;
    if ((await getMeta('lastReminder', '')) === today) return;
    await setMeta('lastReminder', today);
    const opts = { body: list.slice(0, 3).map((i) => i.title).join(', '), icon: 'icons/icon-192.png', tag: 'scadense-reminder' };
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg && reg.showNotification) await reg.showNotification(summaryText(list.length), opts);
    else new Notification(summaryText(list.length), opts);
  } catch { /* nessun errore visibile */ }
}

__exp.dueForReminder = dueForReminder;
__exp.summaryText = summaryText;
__exp.notificationsSupported = notificationsSupported;
__exp.runReminders = runReminders;
});
__def('js/templates.js', function (__exp) {
const { h, modal, sheetHeader } = __req('js/ui.js');

const y = (every) => ({ unit: 'year', every });
const m = (every) => ({ unit: 'month', every });
const none = { unit: 'none', every: 0 };

const TEMPLATES = [
  { title: 'Bollo auto', categoryId: 'veicoli', recurrence: y(1), remindDays: 30 },
  { title: 'Assicurazione RC auto', categoryId: 'veicoli', recurrence: y(1), remindDays: 30 },
  { title: 'Revisione auto', categoryId: 'veicoli', recurrence: y(2), remindDays: 45 },
  { title: 'Tagliando auto', categoryId: 'veicoli', recurrence: y(1), remindDays: 30 },
  { title: 'Carta d\'identità', categoryId: 'documenti', recurrence: none, remindDays: 90 },
  { title: 'Passaporto', categoryId: 'documenti', recurrence: none, remindDays: 90 },
  { title: 'Patente di guida', categoryId: 'documenti', recurrence: none, remindDays: 60 },
  { title: 'Bolletta luce', categoryId: 'casa', recurrence: m(2), remindDays: 7 },
  { title: 'Bolletta gas', categoryId: 'casa', recurrence: m(2), remindDays: 7 },
  { title: 'Canone TV', categoryId: 'casa', recurrence: y(1), remindDays: 15 },
  { title: 'Abbonamento streaming', categoryId: 'abbonamenti', recurrence: m(1), remindDays: 3, autoPay: true },
  { title: 'Rinnovo dominio o hosting', categoryId: 'abbonamenti', recurrence: y(1), remindDays: 30 },
  { title: 'Visita medica di controllo', categoryId: 'salute', recurrence: y(1), remindDays: 14 },
  { title: 'Visita dentista', categoryId: 'salute', recurrence: m(6), remindDays: 14 },
  { title: 'Dichiarazione dei redditi', categoryId: 'tasse', recurrence: y(1), remindDays: 30 },
  { title: 'Garanzia elettrodomestico', categoryId: 'garanzie', recurrence: none, remindDays: 30 },
  // Abbonamenti (categoria Abbonamenti) e rata finanziamento (altro), tutti con addebito automatico; nessun prezzo: lo inserisci tu.
  ...['Netflix', 'Spotify', 'Amazon Prime', 'Disney+', 'YouTube Premium', 'iCloud / Google One', 'Abbonamento palestra']
    .map((title) => ({ title, categoryId: 'abbonamenti', recurrence: m(1), remindDays: 3, autoPay: true })),
  { title: 'Software in abbonamento (es. Microsoft 365)', categoryId: 'abbonamenti', recurrence: y(1), remindDays: 7, autoPay: true },
  { title: 'Rata finanziamento', categoryId: 'altro', recurrence: m(1), remindDays: 3, autoPay: true },
];

// Mostra l'elenco dei modelli; ritorna il modello scelto o undefined.
function pickTemplate() {
  return modal((close) => h('div', null,
    sheetHeader('Modelli rapidi', close),
    h('p', { class: 'muted' }, 'Scegli un modello: dovrai solo indicare la data.'),
    h('ul', { class: 'tpl-list' }, TEMPLATES.map((t) =>
      h('li', null, h('button', { type: 'button', class: 'tpl-btn', onclick: () => close(t) }, t.title))))),
  { label: 'Modelli rapidi' });
}

__exp.TEMPLATES = TEMPLATES;
__exp.pickTemplate = pickTemplate;
});
__def('js/ics.js', function (__exp) {
const { addDays, parseISO } = __req('js/dates.js');
const { monthsOf, remainingCount, lastOccurrence } = __req('js/recurrence.js');

const compact = (iso) => iso.replace(/-/g, '');

function icsEscape(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Piega le righe a 75 caratteri (continuazione con spazio).
function fold(line) {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(' ' + line.slice(i, i + 74));
  return parts.join('\r\n');
}

function stamp(now) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}T${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`;
}

function buildICS(items, categories = [], now = new Date()) {
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Scadense//Scadenziario//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Scadense'];
  for (const it of items) {
    if (!parseISO(it.dueDate)) continue;
    const desc = [
      catName[it.categoryId] ? `Categoria: ${catName[it.categoryId]}` : '',
      it.amount > 0 ? `Importo: ${it.amount.toFixed(2)} EUR` : '',
      it.autoPay ? `Addebito automatico: ${it.payMethod || 'sì'}` : '',
      it.endDate && remainingCount(it) !== null ? `Rate rimanenti: ${remainingCount(it)}` : '',
      it.reference ? `Riferimento: ${it.reference}` : '',
      it.notes || '',
    ].filter(Boolean).join('\n');
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${it.id}@scadense.local`);
    lines.push(`DTSTAMP:${stamp(now)}`);
    lines.push(`DTSTART;VALUE=DATE:${compact(it.dueDate)}`);
    lines.push(`DTEND;VALUE=DATE:${compact(addDays(it.dueDate, 1))}`);
    lines.push(`SUMMARY:${icsEscape(it.title)}`);
    if (desc) lines.push(`DESCRIPTION:${icsEscape(desc)}`);
    const m = monthsOf(it.recurrence);
    const rem = it.endDate ? remainingCount(it) : null;
    // Pausa/disdetta: nessuna ricorrenza. Voci a termine: UNTIL = ultima rata (data), una sola rata = evento singolo.
    if (m && !it.paused && !it.cancelledOn && !(rem !== null && rem <= 1)) {
      const freq = m % 12 === 0 ? `FREQ=YEARLY;INTERVAL=${m / 12}` : `FREQ=MONTHLY;INTERVAL=${m}`;
      lines.push(`RRULE:${freq}${rem !== null ? `;UNTIL=${compact(lastOccurrence(it))}` : ''}`);
    }
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(it.title)}`, `TRIGGER:-P${Math.max(0, Math.floor(it.remindDays || 0))}D`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

__exp.icsEscape = icsEscape;
__exp.fold = fold;
__exp.buildICS = buildICS;
});
__def('js/views/item-form.js', function (__exp) {
const { h, modal, sheetHeader, field, setError, toast, notifyChanged } = __req('js/ui.js');
const { isValidISO } = __req('js/dates.js');
const { getCategories, put, uuid } = __req('js/db.js');
const { PRESETS, presetIdOf, isRecurring, countOccurrences, endFromCount, remainingCount, ITEM_END_LIMIT } = __req('js/recurrence.js');
const { pickTemplate } = __req('js/templates.js');
// item: voce da modificare | null; prefill: valori iniziali per una nuova voce.
async function openItemForm({ item = null, prefill = {} } = {}) {
  const cats = await getCategories();
  const base = item || { title: '', categoryId: cats[0]?.id, dueDate: '', recurrence: { unit: 'none', every: 0 }, amount: null, remindDays: null, notes: '', reference: '', autoPay: false, payMethod: '', endDate: null, paidCount: 0, ...prefill };
  const catById = (id) => cats.find((c) => c.id === id);
  const startCat = catById(base.categoryId) ? base.categoryId : (cats.find((c) => c.id === 'altro') || cats[0]).id;
  return modal((close) => {
    let remindTouched = !!item || base.remindDays != null;
    const title = h('input', { type: 'text', maxlength: '120', autocomplete: 'off', value: base.title });
    const category = h('select', null, cats.map((c) => h('option', { value: c.id, selected: c.id === startCat }, `${c.emoji} ${c.name}`)));
    const date = h('input', { type: 'date', value: base.dueDate });
    const preset = presetIdOf(base.recurrence);
    const rec = h('select', null,
      PRESETS.map((p) => h('option', { value: p.id, selected: p.id === preset }, p.label)),
      h('option', { value: 'custom', selected: preset === 'custom' }, 'Personalizzata…'));
    const every = h('input', { type: 'number', min: '1', max: '120', inputmode: 'numeric', 'aria-label': 'Intervallo personalizzato', value: isRecurring(base.recurrence) ? base.recurrence.every : 1 });
    const unit = h('select', { 'aria-label': 'Unità di tempo' },
      h('option', { value: 'month', selected: base.recurrence.unit !== 'year' }, 'mesi'),
      h('option', { value: 'year', selected: base.recurrence.unit === 'year' }, 'anni'));
    const customRow = h('div', { class: 'inline-row', hidden: preset !== 'custom' },
      h('span', null, 'Ogni'), every, unit);
    const amount = h('input', { type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: base.amount ?? '' });
    const initRemind = base.remindDays ?? catById(startCat)?.defaultRemind ?? 7;
    const remind = h('input', { type: 'number', min: '0', max: '365', inputmode: 'numeric', value: initRemind });
    const reference = h('input', { type: 'text', maxlength: '200', value: base.reference || '' });
    const notes = h('textarea', { rows: '3', maxlength: '4000' }, base.notes || '');
    // Pagamento automatico + metodo.
    const autoPay = h('input', { type: 'checkbox', checked: !!base.autoPay });
    const payMethod = h('input', { type: 'text', maxlength: '60', autocomplete: 'off', value: base.payMethod || '' });
    const methodField = field('Metodo di pagamento (carta, conto, PayPal…)', payMethod);
    methodField.hidden = !base.autoPay;
    autoPay.addEventListener('change', () => { methodField.hidden = !autoPay.checked; });
    const autoRow = h('label', { class: 'check' }, autoPay,
      h('span', null, h('strong', null, 'Pagamento automatico'), h('small', { class: 'hint' }, 'Scadense registra l\'addebito alla data e passa alla successiva.')));
    // Fine della serie: data di fine e numero di rate sono collegati (vale l'ultimo campo modificato).
    const endDate = h('input', { type: 'date', value: base.endDate || '' });
    const initRem = item && base.endDate ? remainingCount(base) : null;
    const count = h('input', { type: 'number', min: '1', max: String(ITEM_END_LIMIT), inputmode: 'numeric', value: initRem ?? '' });
    const paid = h('input', { type: 'number', min: '0', inputmode: 'numeric', value: base.paidCount || 0 });
    let source = base.endDate ? 'date' : null;
    const curRec = () => {
      if (rec.value === 'custom') {
        const n = Math.floor(Number(every.value));
        return n >= 1 && n <= 120 ? { unit: unit.value, every: n } : null;
      }
      const p = PRESETS.find((x) => x.id === rec.value);
      return p && p.unit !== 'none' ? { unit: p.unit, every: p.every } : null;
    };
    const syncEnd = () => {
      const r = curRec();
      if (!r || !isValidISO(date.value)) return;
      if (source === 'count') {
        const n = Math.floor(Number(count.value));
        if (n >= 1 && n <= ITEM_END_LIMIT) endDate.value = endFromCount(date.value, r, n);
      } else if (source === 'date') {
        if (isValidISO(endDate.value)) { const n = countOccurrences(date.value, r, endDate.value); count.value = n > 0 ? n : ''; }
        else count.value = '';
      }
    };
    endDate.addEventListener('input', () => { source = endDate.value ? 'date' : null; if (!endDate.value) count.value = ''; syncEnd(); });
    count.addEventListener('input', () => { source = count.value !== '' ? 'count' : null; if (count.value === '') endDate.value = ''; syncEnd(); });
    const endBox = h('div', { class: 'end-box' },
      h('p', { class: 'hint' }, 'Per finanziamenti e rate: indica la data dell\'ultimo pagamento oppure quante rate mancano.'),
      field('Data di fine (facoltativa)', endDate),
      field('Rate rimanenti (da questa scadenza)', count),
      field('Rate già pagate', paid));
    const toggleEnd = () => {
      endBox.hidden = rec.value === 'none';
      if (endBox.hidden) { endDate.value = ''; count.value = ''; source = null; }
    };
    toggleEnd();
    date.addEventListener('input', syncEnd);
    every.addEventListener('input', syncEnd);
    unit.addEventListener('change', syncEnd);
    rec.addEventListener('change', () => { customRow.hidden = rec.value !== 'custom'; toggleEnd(); syncEnd(); });
    remind.addEventListener('input', () => { remindTouched = true; });
    category.addEventListener('change', () => {
      if (!remindTouched) remind.value = catById(category.value)?.defaultRemind ?? 7;
    });
    const tplBtn = item ? null : h('button', {
      type: 'button', class: 'btn btn-ghost',
      onclick: async () => {
        const t = await pickTemplate();
        if (!t) return;
        title.value = t.title;
        if (catById(t.categoryId)) category.value = t.categoryId;
        const p = PRESETS.find((x) => x.unit === t.recurrence.unit && x.every === t.recurrence.every);
        rec.value = p ? p.id : 'none';
        customRow.hidden = true;
        toggleEnd();
        remind.value = t.remindDays;
        autoPay.checked = !!t.autoPay;
        methodField.hidden = !autoPay.checked;
        remindTouched = true;
        date.focus();
      },
    }, '✨ Usa un modello');
    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      let ok = true;
      const t = title.value.trim();
      setError(title, t ? '' : 'Inserisci un titolo.'); if (!t) ok = false;
      const dateOk = isValidISO(date.value);
      setError(date, dateOk ? '' : 'Scegli una data di scadenza.'); if (!dateOk) ok = false;
      let recurrence = { unit: 'none', every: 0 };
      if (rec.value === 'custom') {
        const n = Math.floor(Number(every.value));
        const evOk = n >= 1 && n <= 120;
        setError(every, evOk ? '' : 'Inserisci un numero tra 1 e 120.'); if (!evOk) ok = false; else recurrence = { unit: unit.value, every: n };
      } else {
        setError(every, '');
        const p = PRESETS.find((x) => x.id === rec.value);
        if (p) recurrence = { unit: p.unit, every: p.every };
      }
      const amt = amount.value === '' ? null : Number(amount.value);
      const amtOk = amt === null || (Number.isFinite(amt) && amt >= 0);
      setError(amount, amtOk ? '' : 'Importo non valido.'); if (!amtOk) ok = false;
      const rd = Math.floor(Number(remind.value));
      const rdOk = remind.value !== '' && rd >= 0 && rd <= 365;
      setError(remind, rdOk ? '' : 'Inserisci un numero tra 0 e 365.'); if (!rdOk) ok = false;
      // Fine serie: data di fine o numero di rate (ultimo campo modificato), solo con ricorrenza.
      let end = null;
      if (endDate.value || count.value !== '') {
        const r = curRec();
        if (!r) { setError(rec, 'Imposta una ricorrenza per usare data di fine o rate.'); ok = false; }
        else {
          setError(rec, '');
          const useCount = count.value !== '' && (source === 'count' || !endDate.value);
          if (useCount) {
            const n = Number(count.value);
            const nOk = Number.isInteger(n) && n >= 1 && n <= ITEM_END_LIMIT;
            setError(count, nOk ? '' : `Inserisci un numero di rate tra 1 e ${ITEM_END_LIMIT}.`); setError(endDate, '');
            if (!nOk) ok = false; else if (dateOk) end = endFromCount(date.value, r, n);
          } else {
            setError(count, '');
            const eOk = isValidISO(endDate.value) && (!dateOk || endDate.value >= date.value);
            setError(endDate, eOk ? '' : 'La data di fine non può precedere la prima scadenza.');
            if (!eOk) ok = false; else end = endDate.value;
          }
        }
      } else { setError(count, ''); setError(endDate, ''); }
      const paidN = paid.value === '' ? 0 : Number(paid.value);
      const paidOk = Number.isInteger(paidN) && paidN >= 0;
      setError(paid, paidOk ? '' : 'Inserisci un numero intero da 0 in su.'); if (!paidOk) ok = false;
      if (!ok) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
      const now = Date.now();
      const rec2 = {
        id: item ? item.id : uuid(), title: t, categoryId: category.value, dueDate: date.value, recurrence,
        amount: amt, remindDays: rd, notes: notes.value.trim(), reference: reference.value.trim(),
        autoPay: autoPay.checked, payMethod: autoPay.checked ? payMethod.value.trim() : '', endDate: end, paidCount: paidN,
        paused: item ? !!item.paused : false, cancelledOn: item ? item.cancelledOn || null : null, closedReason: item ? item.closedReason || null : null,
        status: item ? item.status : 'active', createdAt: item ? item.createdAt : now, updatedAt: now,
      };
      await put('items', rec2);
      notifyChanged();
      toast(item ? 'Scadenza aggiornata' : 'Scadenza aggiunta');
      close(rec2);
    } },
      sheetHeader(item ? 'Modifica scadenza' : 'Nuova scadenza', close),
      tplBtn,
      field('Titolo', title),
      field('Categoria', category),
      field('Data di scadenza', date),
      field('Ricorrenza', rec), customRow, endBox,
      field('Importo (€, facoltativo)', amount),
      autoRow, methodField,
      field('Preavviso (giorni prima)', remind, { hint: 'Quanti giorni prima iniziare a segnalarla.' }),
      field('Riferimento (n. polizza, targa…)', reference),
      field('Note', notes),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Annulla'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, 'Salva')));
    setTimeout(() => title.focus(), 50);
    return form;
  }, { label: item ? 'Modifica scadenza' : 'Nuova scadenza' });
}

__exp.openItemForm = openItemForm;
});
__def('js/views/actions.js', function (__exp) {
// Azioni condivise tra elenco, dettaglio e calendario.
const { h, modal, sheetHeader, field, toast, notifyChanged, confirmDialog, setError } = __req('js/ui.js');
const { todayISO, formatShort, isValidISO } = __req('js/dates.js');
const { markDone, undoDone, setDueDate, postponeTarget, setPaused, setCancelled, restoreItem } = __req('js/model.js');
const { isRecurring, hasEnd, remainingCount } = __req('js/recurrence.js');
const { transact, historyOf } = __req('js/db.js');

async function doneFlow(item) {
  const res = await modal((close) => {
    const date = h('input', { type: 'date', value: todayISO(), required: true });
    const amount = h('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', value: item.amount ?? '' });
    const note = h('input', { type: 'text', maxlength: '200' });
    const rec = isRecurring(item.recurrence);
    const form = h('form', { novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      if (!isValidISO(date.value)) { setError(date, 'Inserisci una data valida.'); return; }
      const a = amount.value === '' ? null : Number(amount.value);
      if (a !== null && !(a >= 0)) { setError(amount, 'Importo non valido.'); return; }
      close({ doneOn: date.value, amount: a, note: note.value.trim() });
    } },
      sheetHeader(hasEnd(item) ? 'Rata pagata' : rec ? 'Rinnovata' : 'Fatto', close),
      h('p', { class: 'muted' }, `${item.title}: ${hasEnd(item)
        ? (remainingCount(item) <= 1 ? 'ultima rata, la voce verrà conclusa.' : `rata registrata, ne restano ${remainingCount(item) - 1}.`)
        : rec ? 'verrà impostata la prossima scadenza.' : 'verrà spostata in archivio.'}`),
      field('Data in cui l\'hai fatto', date),
      field('Importo pagato (€)', amount),
      field('Nota (facoltativa)', note),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Annulla'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, 'Conferma')));
    return form;
  }, { label: 'Segna come fatto' });
  if (!res) return false;
  const r = await markDone(item, res);
  notifyChanged();
  const msg = r.after.closedReason === 'concluded'
    ? 'Ultima rata pagata: voce conclusa'
    : isRecurring(item.recurrence)
    ? `Rinnovata. Prossima scadenza: ${formatShort(r.after.dueDate)}`
    : 'Completata e spostata in archivio';
  toast(msg, { label: 'Annulla', fn: async () => { await undoDone(r); notifyChanged(); toast('Azione annullata'); } });
  return true;
}

async function postponeFlow(item) {
  const choice = await modal((close) => {
    const date = h('input', { type: 'date', value: item.dueDate });
    const opt = (kind, label) => h('button', { type: 'button', class: 'btn', onclick: () => close({ date: postponeTarget(item, kind) }) }, label);
    return h('div', null,
      sheetHeader('Posticipa', close),
      h('p', { class: 'muted' }, `${item.title}: scadenza attuale ${formatShort(item.dueDate)}.`),
      h('div', { class: 'btn-grid' }, opt('day', '+1 giorno'), opt('week', '+1 settimana'), opt('month', '+1 mese')),
      h('form', { novalidate: true, onsubmit: (e) => {
        e.preventDefault();
        if (!isValidISO(date.value)) { setError(date, 'Inserisci una data valida.'); return; }
        close({ date: date.value });
      } },
        field('Oppure scegli una data', date),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Annulla'),
          h('button', { type: 'submit', class: 'btn btn-primary' }, 'Applica'))));
  }, { label: 'Posticipa' });
  if (!choice) return false;
  const r = await setDueDate(item, choice.date);
  notifyChanged();
  toast(`Posticipata al ${formatShort(choice.date)}`, {
    label: 'Annulla',
    fn: async () => { await transact(['items'], (s) => s.items.put(r.before)); notifyChanged(); toast('Azione annullata'); },
  });
  return true;
}

async function deleteFlow(item) {
  const ok = await confirmDialog({
    title: 'Elimina scadenza', message: `Vuoi eliminare "${item.title}" e il suo storico?`, okLabel: 'Elimina', danger: true,
  });
  if (!ok) return false;
  const hist = await historyOf(item.id);
  await transact(['items', 'history'], (s) => {
    s.items.delete(item.id);
    hist.forEach((e) => s.history.delete(e.id));
  });
  notifyChanged();
  toast('Scadenza eliminata', {
    label: 'Annulla',
    fn: async () => {
      await transact(['items', 'history'], (s) => { s.items.put(item); hist.forEach((e) => s.history.put(e)); });
      notifyChanged();
      toast('Scadenza ripristinata');
    },
  });
  return true;
}

async function restoreFlow(item) {
  await restoreItem(item);
  notifyChanged();
  toast('Scadenza riportata tra le attive');
}
const undoPatch = (r) => async () => { await transact(['items'], (s) => s.items.put(r.before)); notifyChanged(); toast('Azione annullata'); };
const dateModal = (label, intro, fieldLabel, okLabel, def, danger) => modal((close) => {
  const date = h('input', { type: 'date', value: def, required: true });
  return h('form', { novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    if (!isValidISO(date.value)) { setError(date, 'Inserisci una data valida.'); return; }
    close(date.value);
  } },
    sheetHeader(label, close),
    h('p', { class: 'muted' }, intro),
    field(fieldLabel, date),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Annulla'),
      h('button', { type: 'submit', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}` }, okLabel)));
}, { label });
// Pausa / ripresa di un pagamento automatico o di un abbonamento.
async function pauseFlow(item) {
  if (!item.paused) {
    const ok = await confirmDialog({ title: 'Metti in pausa', message: `"${item.title}" non verrà più addebitata né conteggiata nei costi finché non la riprendi.`, okLabel: 'Metti in pausa' });
    if (!ok) return false;
    const r = await setPaused(item, true);
    notifyChanged();
    toast('Messa in pausa', { label: 'Annulla', fn: undoPatch(r) });
    return true;
  }
  const today = todayISO();
  const res = await dateModal('Riprendi', `${item.title}: scegli la data del prossimo addebito.`, 'Prossimo addebito', 'Riprendi', item.dueDate > today ? item.dueDate : today, false);
  if (!res) return false;
  const r = await setPaused(item, false, res);
  notifyChanged();
  toast('Ripresa', { label: 'Annulla', fn: undoPatch(r) });
  return true;
}
// Disdetta con data "attivo fino al" / riattivazione.
async function cancelFlow(item) {
  if (item.cancelledOn) {
    const r = await setCancelled(item, null);
    notifyChanged();
    toast('Disdetta annullata', { label: 'Annulla', fn: undoPatch(r) });
    return true;
  }
  const today = todayISO();
  const res = await dateModal('Disdici', `${item.title}: dopo questa data non ci saranno più addebiti e la voce passerà in archivio come Disdetto. Lo storico resta.`, 'Attivo fino al', 'Disdici', item.dueDate > today ? item.dueDate : today, true);
  if (!res) return false;
  const r = await setCancelled(item, res);
  notifyChanged();
  toast(`Disdetta: attiva fino al ${formatShort(res)}`, { label: 'Annulla', fn: undoPatch(r) });
  return true;
}

__exp.doneFlow = doneFlow;
__exp.postponeFlow = postponeFlow;
__exp.deleteFlow = deleteFlow;
__exp.restoreFlow = restoreFlow;
__exp.pauseFlow = pauseFlow;
__exp.cancelFlow = cancelFlow;
});
__def('js/views/item-detail.js', function (__exp) {
const { h, modal, sheetHeader, downloadFile } = __req('js/ui.js');
const { formatLong, formatShort } = __req('js/dates.js');
const { get, getCategories, historyOf } = __req('js/db.js');
const { badgeOf, formatMoney, canPauseCancel } = __req('js/model.js');
const { describeRecurrence, hasEnd, progress, lastOccurrence, remainingTotal } = __req('js/recurrence.js');
const { buildICS } = __req('js/ics.js');
const { openItemForm } = __req('js/views/item-form.js');
const { doneFlow, postponeFlow, deleteFlow, restoreFlow, pauseFlow, cancelFlow } = __req('js/views/actions.js');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scadenza';
async function openItemDetail(id) {
  const item = await get('items', id);
  if (!item) return;
  const [cats, hist] = await Promise.all([getCategories(), historyOf(id)]);
  const cat = cats.find((c) => c.id === item.categoryId);
  const archived = item.status === 'archived';
  const archLabel = item.closedReason === 'concluded' ? 'Concluso' : item.closedReason === 'cancelled' ? 'Disdetto' : 'Archivio';
  const b = badgeOf(item);
  const pr = hasEnd(item) ? progress(item) : null;
  const residual = remainingTotal(item);
  const act = await modal((close) => {
    const dl = (k, v) => (v ? [h('dt', null, k), h('dd', null, v)] : null);
    const btn = (label, cls, key) => h('button', { type: 'button', class: `btn ${cls}`, onclick: () => close(key) }, label);
    const live = !archived;
    const doneBtn = live && !item.autoPay && !item.paused ? btn(hasEnd(item) ? '✓ Rata pagata' : '✓ Fatto / Rinnovato', 'btn-primary', 'done') : null;
    return h('div', null,
      sheetHeader(item.title, close),
      h('div', { class: 'detail-top' },
        h('span', { class: 'cat-pill', style: `--c:${cat ? cat.color : '#64748b'}` }, `${cat ? cat.emoji : '📌'} ${cat ? cat.name : 'Altro'}`),
        item.autoPay ? h('span', { class: 'auto-pill' }, `🔁 Automatico${item.payMethod ? ' · ' + item.payMethod : ''}`) : null,
        archived ? h('span', { class: 'badge badge-far' }, archLabel) : h('span', { class: `badge badge-${b.tone}` }, h('span', { 'aria-hidden': 'true' }, b.icon + ' '), b.text)),
      h('dl', { class: 'detail' },
        dl(archived && hasEnd(item) ? 'Ultima rata' : 'Scadenza', formatLong(item.dueDate)),
        dl('Ricorrenza', describeRecurrence(item.recurrence)),
        dl('Importo', item.amount > 0 ? formatMoney(item.amount) : ''),
        dl('Fine', hasEnd(item) ? formatLong(item.endDate) : ''),
        dl('Rate', pr ? `rate rimanenti: ${archived ? 0 : pr.remaining}${residual !== null && !archived ? ` · residuo: ${formatMoney(residual)}` : ''}` : ''),
        dl('Estinzione prevista', pr ? formatLong(lastOccurrence(item)) : ''),
        dl('Disdetta', item.cancelledOn ? `attivo fino al ${formatShort(item.cancelledOn)}` : ''),
        dl('Preavviso', `${item.remindDays} giorni prima`),
        dl('Riferimento', item.reference),
        dl('Note', item.notes)),
      pr ? h('div', { class: 'progress-wrap' },
        h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Avanzamento rate', 'aria-valuemin': '0', 'aria-valuemax': String(pr.total), 'aria-valuenow': String(archived ? pr.total : pr.paid) },
          h('div', { class: 'progress-fill', style: `width:${archived ? 100 : pr.pct}%` })),
        h('small', { class: 'muted' }, archived ? `${pr.total} rate su ${pr.total}` : `${pr.paid} pagate su ${pr.total}${pr.remaining ? ` · prossima: rata ${pr.paid + 1} di ${pr.total}` : ''}`)) : null,
      h('div', { class: 'btn-grid' },
        archived ? btn('Ripristina', 'btn-primary', 'restore') : doneBtn,
        live && canPauseCancel(item) ? btn(item.paused ? 'Riprendi' : 'Metti in pausa', item.paused ? 'btn-primary' : '', 'pause') : null,
        live && canPauseCancel(item) ? btn(item.cancelledOn ? 'Riattiva' : 'Disdici', '', 'cancel') : null,
        live ? btn('Posticipa', '', 'postpone') : null,
        btn('Modifica', '', 'edit'),
        btn('Aggiungi al calendario (.ics)', '', 'ics'),
        btn('Elimina', 'btn-danger-ghost', 'delete')),
      h('h3', { class: 'section-title' }, 'Cronologia'),
      hist.length
        ? h('ul', { class: 'history' }, hist.map((e) => h('li', null,
          h('span', null, `${e.auto ? 'Addebitato' : 'Fatto'} il ${formatShort(e.doneOn)}`),
          h('span', { class: 'muted' }, `scadenza ${formatShort(e.dueWas)}${e.amount != null ? ' · ' + formatMoney(e.amount) : ''}`))))
        : h('p', { class: 'muted' }, 'Nessun rinnovo registrato.'));
  }, { label: item.title });
  if (act === 'done') await doneFlow(item);
  else if (act === 'postpone') await postponeFlow(item);
  else if (act === 'pause') await pauseFlow(item);
  else if (act === 'cancel') await cancelFlow(item);
  else if (act === 'edit') await openItemForm({ item });
  else if (act === 'delete') await deleteFlow(item);
  else if (act === 'restore') await restoreFlow(item);
  else if (act === 'ics') downloadFile(`scadense-${slug(item.title)}.ics`, buildICS([item], cats), 'text/calendar');
}

__exp.openItemDetail = openItemDetail;
});
__def('js/views/row.js', function (__exp) {
const { h } = __req('js/ui.js');
const { formatShort } = __req('js/dates.js');
const { badgeOf, formatMoney } = __req('js/model.js');
const { hasEnd, remainingCount } = __req('js/recurrence.js');
const { openItemDetail } = __req('js/views/item-detail.js');
const { doneFlow } = __req('js/views/actions.js');
function catChip(cat) {
  const c = cat || { emoji: '📌', color: '#64748b' };
  return h('span', { class: 'cat-dot', style: `--c:${c.color}`, 'aria-hidden': 'true' }, c.emoji);
}
function itemRow(item, cat) {
  const b = badgeOf(item);
  const archived = item.status === 'archived';
  const archLabel = item.closedReason === 'concluded' ? 'Concluso' : item.closedReason === 'cancelled' ? 'Disdetto' : 'Archivio';
  const sub = [
    cat ? cat.name : 'Altro',
    item.autoPay ? ['🔁', item.payMethod].filter(Boolean).join(' ') : null,
    formatShort(item.dueDate),
    item.amount > 0 ? formatMoney(item.amount) : null,
    !archived && hasEnd(item) ? `${remainingCount(item)} rate rimanenti` : null,
  ].filter(Boolean).join(' · ');
  return h('li', { class: 'row' },
    h('button', { type: 'button', class: 'row-main', onclick: () => openItemDetail(item.id) },
      catChip(cat),
      h('span', { class: 'row-text' },
        archived
          ? h('span', { class: 'badge badge-far' }, archLabel)
          : h('span', { class: `badge badge-${b.tone}` }, h('span', { 'aria-hidden': 'true' }, b.icon + ' '), b.text),
        h('span', { class: 'row-title' }, item.title),
        h('span', { class: 'row-sub' }, sub))),
    archived || item.autoPay || item.paused ? null : h('button', {
      type: 'button', class: 'row-done', 'aria-label': `Segna come fatto: ${item.title}`, title: 'Fatto',
      onclick: () => doneFlow(item),
    }, '✓'));
}

__exp.catChip = catChip;
__exp.itemRow = itemRow;
});
__def('js/views/prossime.js', function (__exp) {
const { h } = __req('js/ui.js');
const { getAll, getCategories, getMeta, setMeta } = __req('js/db.js');
const { todayISO, diffDays } = __req('js/dates.js');
const { GROUPS, groupOf, sortByUrgency, isLive } = __req('js/model.js');
const { dueForReminder, summaryText } = __req('js/reminders.js');
const { TEMPLATES } = __req('js/templates.js');
const { itemRow } = __req('js/views/row.js');
const { openItemForm } = __req('js/views/item-form.js');

// Stato dei filtri (persiste tra le schermate).
const filters = { q: '', cat: '', status: 'active', auto: false };

async function render(root) {
  const [items, cats, dismissed] = await Promise.all([getAll('items'), getCategories(), getMeta('bannerDismissed', '')]);
  const today = todayISO();
  const catById = Object.fromEntries(cats.map((c) => [c.id, c]));
  const active = items.filter((i) => i.status === 'active');
  const live = active.filter(isLive);
  const overdue = live.filter((i) => !i.autoPay && diffDays(today, i.dueDate) < 0).length;
  const soon = live.filter((i) => { const d = diffDays(today, i.dueDate); return d >= 0 && d <= 30; }).length;

  const head = h('h1', { class: 'page-title', tabindex: '-1' }, 'Prossime scadenze');
  const summary = h('div', { class: 'summary', role: 'group', 'aria-label': 'Riepilogo' },
    h('div', { class: `stat ${overdue ? 'stat-late' : ''}` }, h('strong', null, overdue), h('span', null, overdue === 1 ? 'scaduta' : 'scadute')),
    h('div', { class: 'stat' }, h('strong', null, soon), h('span', null, 'entro 30 giorni')),
    h('div', { class: 'stat' }, h('strong', null, active.length), h('span', null, 'attive')));

  const due = dueForReminder(items, today);
  let banner = null;
  if (due.length && dismissed !== today) {
    banner = h('div', { class: 'banner', role: 'status' },
      h('span', null, '🔔 ', h('strong', null, summaryText(due.length)), ': ', due.slice(0, 2).map((i) => i.title).join(', '), due.length > 2 ? '…' : ''),
      h('button', { type: 'button', class: 'btn btn-small', onclick: async () => { await setMeta('bannerDismissed', today); banner.remove(); } }, 'Nascondi'));
  }

  const q = h('input', { type: 'search', id: 'f-q', placeholder: 'Cerca…', value: filters.q, autocomplete: 'off', enterkeyhint: 'search' });
  const cat = h('select', { id: 'f-cat', 'aria-label': 'Filtra per categoria' },
    h('option', { value: '' }, 'Tutte le categorie'),
    cats.map((c) => h('option', { value: c.id, selected: c.id === filters.cat }, `${c.emoji} ${c.name}`)));
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Stato' },
    ['active', 'archived'].map((s) => h('button', {
      type: 'button', class: 'seg-btn', 'aria-pressed': String(filters.status === s),
      onclick: () => { filters.status = s; render(root); },
    }, s === 'active' ? 'Attive' : 'Archivio')));

  const autoBtn = h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(filters.auto),
    onclick: () => { filters.auto = !filters.auto; autoBtn.setAttribute('aria-pressed', String(filters.auto)); paint(); },
  }, '🔁 Automatici');
  const list = h('div', { id: 'list' });
  const paint = () => {
    filters.q = q.value; filters.cat = cat.value;
    const needle = q.value.trim().toLowerCase();
    let sel = items.filter((i) => i.status === filters.status);
    if (filters.cat) sel = sel.filter((i) => i.categoryId === filters.cat);
    if (filters.auto) sel = sel.filter((i) => i.autoPay);
    if (needle) sel = sel.filter((i) => [i.title, i.notes, i.reference].join(' ').toLowerCase().includes(needle));
    list.replaceChildren();
    if (!sel.length) {
      list.append(emptyState(items.length === 0, filters.status === 'archived' || needle || filters.cat || filters.auto, () => openItemForm()));
      return;
    }
    if (filters.status === 'archived') {
      sel.sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
      list.append(h('ul', { class: 'list' }, sel.map((i) => itemRow(i, catById[i.categoryId]))));
      return;
    }
    sel = sortByUrgency(sel);
    for (const g of GROUPS) {
      const part = sel.filter((i) => groupOf(i, today) === g.id);
      if (!part.length) continue;
      list.append(h('section', { class: 'group' },
        h('h2', { class: `group-title ${g.id === 'scadute' ? 'late' : ''}` }, g.label, h('span', { class: 'count' }, part.length)),
        h('ul', { class: 'list' }, part.map((i) => itemRow(i, catById[i.categoryId])))));
    }
  };
  q.addEventListener('input', paint);
  cat.addEventListener('change', paint);
  paint();

  const fab = h('button', { type: 'button', class: 'fab', onclick: () => openItemForm() }, h('span', { 'aria-hidden': 'true' }, '＋'), ' Nuova');
  root.replaceChildren(...[head, banner, summary,
    h('div', { class: 'filters' }, h('label', { for: 'f-q', class: 'sr-only' }, 'Cerca'), q, cat), seg, h('div', { class: 'chips start' }, autoBtn), list, fab].filter(Boolean));
}

function emptyState(noData, filtered, onNew) {
  if (noData) {
    return h('div', { class: 'empty' },
      h('div', { class: 'empty-art', 'aria-hidden': 'true' }, '🗓️'),
      h('h2', null, 'Nessuna scadenza, per ora'),
      h('p', { class: 'muted' }, 'Parti da un modello oppure creane una da zero.'),
      h('div', { class: 'chips' }, TEMPLATES.slice(0, 8).map((t) =>
        h('button', { type: 'button', class: 'chip', onclick: () => openItemForm({ prefill: { ...t, recurrence: { ...t.recurrence } } }) }, t.title))),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: onNew }, 'Crea da zero'));
  }
  return h('div', { class: 'empty' },
    h('h2', null, filtered ? 'Nessun risultato' : 'Tutto in ordine'),
    h('p', { class: 'muted' }, filtered ? 'Prova a cambiare ricerca o filtri.' : 'Non ci sono scadenze attive.'));
}

__exp.filters = filters;
__exp.render = render;
});
__def('js/views/calendario.js', function (__exp) {
const { h } = __req('js/ui.js');
const { getAll, getCategories } = __req('js/db.js');
const { todayISO, toISO, monthLabel, formatLong, pad } = __req('js/dates.js');
const { sortByUrgency, isLive } = __req('js/model.js');
const { itemRow } = __req('js/views/row.js');

const now = new Date();
let view = { y: now.getFullYear(), m: now.getMonth() };
let selected = todayISO();
const WEEK = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

async function render(root) {
  const [items, cats] = await Promise.all([getAll('items'), getCategories()]);
  const catById = Object.fromEntries(cats.map((c) => [c.id, c]));
  const active = items.filter(isLive);
  const byDay = {};
  active.forEach((i) => { (byDay[i.dueDate] ||= []).push(i); });
  const today = todayISO();

  const shift = (n) => {
    const d = new Date(view.y, view.m + n, 1);
    view = { y: d.getFullYear(), m: d.getMonth() };
    render(root);
  };
  const nav = h('div', { class: 'cal-nav' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mese precedente', onclick: () => shift(-1) }, '‹'),
    h('h1', { class: 'cal-title', tabindex: '-1', 'aria-live': 'polite' }, monthLabel(view.y, view.m)),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mese successivo', onclick: () => shift(1) }, '›'));

  const first = new Date(view.y, view.m, 1, 12);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(h('div', { class: 'cal-cell empty', 'aria-hidden': 'true' }));
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${view.y}-${pad(view.m + 1)}-${pad(d)}`;
    const list = byDay[iso] || [];
    const late = list.length && iso < today;
    const dots = list.slice(0, 3).map((i) => h('i', { class: `dot${i.autoPay ? ' dot-auto' : ''}`, style: `--c:${(catById[i.categoryId] || {}).color || '#64748b'}` }));
    cells.push(h('button', {
      type: 'button',
      class: `cal-cell day${iso === today ? ' today' : ''}${iso === selected ? ' sel' : ''}${late ? ' late' : ''}`,
      'aria-pressed': String(iso === selected),
      'aria-label': `${formatLong(iso)}${list.length ? `, ${list.length} ${list.length === 1 ? 'scadenza' : 'scadenze'}` : ''}`,
      onclick: () => { selected = iso; render(root); },
    }, h('span', { class: 'num' }, d), h('span', { class: 'dots', 'aria-hidden': 'true' }, dots, list.length > 3 ? h('b', null, '+') : null)));
  }

  const dayList = byDay[selected] ? sortByUrgency(byDay[selected]) : [];
  const detail = h('section', { class: 'group', 'aria-live': 'polite' },
    h('h2', { class: 'group-title' }, formatLong(selected)),
    dayList.length
      ? h('ul', { class: 'list' }, dayList.map((i) => itemRow(i, catById[i.categoryId])))
      : h('p', { class: 'muted' }, 'Nessuna scadenza in questo giorno.'));

  root.replaceChildren(nav,
    h('div', { class: 'cal', role: 'group', 'aria-label': 'Calendario' },
      WEEK.map((w) => h('div', { class: 'cal-wd', 'aria-hidden': 'true' }, w)), cells),
    h('div', { class: 'btn-row start' },
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => { const t = new Date(); view = { y: t.getFullYear(), m: t.getMonth() }; selected = todayISO(); render(root); } }, 'Vai a oggi')),
    detail);
}

__exp.render = render;
});
__def('js/views/costi.js', function (__exp) {
const { h } = __req('js/ui.js');
const { getAll, getCategories } = __req('js/db.js');
const { todayISO, addMonths, monthKey, MONTHS, formatShort } = __req('js/dates.js');
const { annualCost, isRecurring, occurrences, hasEnd, progress, remainingTotal, lastOccurrence } = __req('js/recurrence.js');
const { formatMoney, isLive, costByCategory } = __req('js/model.js');

const MODE_KEY = 'scadense-costs-mode';
const getMode = () => { try { return localStorage.getItem(MODE_KEY) === 'monthly' ? 'monthly' : 'annual'; } catch { return 'annual'; } };
const setMode = (m) => { try { localStorage.setItem(MODE_KEY, m); } catch { /* preferenza non salvata */ } };

async function render(root) {
  const [items, cats] = await Promise.all([getAll('items'), getCategories()]);
  const active = items.filter(isLive);
  const rec = active.filter((i) => isRecurring(i.recurrence) && i.amount > 0);
  const annual = rec.reduce((s, i) => s + annualCost(i), 0);

  const mode = getMode();
  const byCat = costByCategory(items, cats, mode);

  const maxCat = byCat[0]?.v || 1;

  // Prossimi 12 mesi: tutte le occorrenze attive con importo.
  const today = todayISO();
  const end = addMonths(today, 12);
  const months = [];
  for (let k = 0; k < 12; k++) {
    const iso = addMonths(today.slice(0, 8) + '01', k);
    months.push({ key: monthKey(iso), label: `${MONTHS[+iso.slice(5, 7) - 1].slice(0, 3)} ${iso.slice(2, 4)}`, v: 0 });
  }
  const lastKey = months[11].key;
  active.filter((i) => i.amount > 0).forEach((i) => {
    occurrences(i, today, end).forEach((d) => {
      const m = months.find((x) => x.key === monthKey(d));
      if (m && monthKey(d) <= lastKey) m.v += i.amount;
    });
  });
  const timed = active.filter((i) => hasEnd(i)).sort((a, b) => (lastOccurrence(a) < lastOccurrence(b) ? -1 : 1));
  const residual = timed.reduce((s, i) => s + (remainingTotal(i) || 0), 0);
  const total12 = months.reduce((s, m) => s + m.v, 0);
  const maxMonth = Math.max(...months.map((m) => m.v), 1);

  root.replaceChildren(...[
    h('h1', { class: 'page-title', tabindex: '-1' }, 'Costi'),
    h('div', { class: 'summary two' },
      h('div', { class: 'stat' }, h('strong', null, formatMoney(annual)), h('span', null, 'stima annua ricorrenti')),
      h('div', { class: 'stat' }, h('strong', null, formatMoney(annual / 12)), h('span', null, 'equivalente al mese'))),
    !rec.length ? h('p', { class: 'muted' }, 'Aggiungi un importo alle scadenze ricorrenti per vedere la stima dei costi.') : null,
    h('section', { class: 'card' },
      h('h2', { class: 'section-title', id: 'cost-cat-title' }, `Per categoria (${mode === 'monthly' ? 'mensile' : 'annuo'})`),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Periodo di riferimento' },
        [['annual', 'Annuo'], ['monthly', 'Mensile']].map(([v, l]) =>
          h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(mode === v), onclick: async () => { setMode(v); await render(root); root.querySelector('.seg [aria-pressed=\'true\']')?.focus(); } }, l))),
      byCat.length
        ? h('ul', { class: 'bars' }, byCat.map(({ c, v }) => h('li', null,
          h('div', { class: 'bar-label' }, h('span', null, `${c.emoji} ${c.name}`), h('strong', null, formatMoney(v))),
          h('div', { class: 'bar-track', 'aria-hidden': 'true' }, h('div', { class: 'bar-fill', style: `width:${Math.max(3, (v / maxCat) * 100)}%;--c:${c.color}` })))))
        : h('p', { class: 'muted' }, 'Nessun dato disponibile.')),
    timed.length ? h('section', { class: 'card' },
      h('h2', { class: 'section-title' }, 'Impegni a termine'),
      h('p', { class: 'muted' }, `Residuo totale: ${formatMoney(residual)}`),
      h('ul', { class: 'bars' }, timed.map((i) => { const p = progress(i); return h('li', null,
        h('div', { class: 'bar-label' }, h('span', null, i.title), h('strong', null, remainingTotal(i) !== null ? formatMoney(remainingTotal(i)) : `rate: ${p.remaining}`)),
        h('div', { class: 'bar-track', 'aria-hidden': 'true' }, h('div', { class: 'bar-fill', style: `width:${p.pct}%;--c:var(--primary)` })),
        h('small', { class: 'muted' }, `rate rimanenti: ${p.remaining} · ultima rata: ${formatShort(lastOccurrence(i))}`)); }))) : null,
    h('section', { class: 'card' },
      h('h2', { class: 'section-title' }, 'Prossimi 12 mesi'),
      h('p', { class: 'muted' }, `Totale previsto: ${formatMoney(total12)}`),
      h('ul', { class: 'bars' }, months.map((m) => h('li', null,
        h('div', { class: 'bar-label' }, h('span', null, m.label), h('strong', null, m.v > 0 ? formatMoney(m.v) : '—')),
        h('div', { class: 'bar-track', 'aria-hidden': 'true' }, h('div', { class: 'bar-fill', style: `width:${m.v > 0 ? Math.max(3, (m.v / maxMonth) * 100) : 0}%;--c:var(--primary)` }))))))].filter(Boolean));
}

__exp.render = render;
});
__def('js/views/abbonamenti.js', function (__exp) {
const { h } = __req('js/ui.js');
const { getAll, getCategories } = __req('js/db.js');
const { formatShort } = __req('js/dates.js');
const { formatMoney, badgeOf, isSubscription, SUBSCRIPTION_CATEGORY_ID } = __req('js/model.js');
const { annualCost, monthsOf } = __req('js/recurrence.js');
const { TEMPLATES } = __req('js/templates.js');
const { catChip } = __req('js/views/row.js');
const { openItemDetail } = __req('js/views/item-detail.js');
const { openItemForm } = __req('js/views/item-form.js');
const NEW_SUB = { categoryId: SUBSCRIPTION_CATEGORY_ID, recurrence: { unit: 'month', every: 1 } };
// Vista Abbonamenti: solo voci della categoria Abbonamenti (con o senza pagamento automatico), totali mensili/annuali e prossimo addebito.
async function render(root) {
  const [items, cats] = await Promise.all([getAll('items'), getCategories()]);
  const catById = Object.fromEntries(cats.map((c) => [c.id, c]));
  const subs = items.filter(isSubscription);
  const active = subs.filter((i) => i.status === 'active' && !i.paused && !i.cancelledOn).sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.title.localeCompare(b.title, 'it')));
  const paused = subs.filter((i) => i.status === 'active' && i.paused);
  const cancelled = subs.filter((i) => (i.status === 'active' && i.cancelledOn) || (i.status === 'archived' && i.closedReason === 'cancelled'));
  // Totali: il costo annuo di una voce a termine copre solo le rate dei prossimi 12 mesi.
  const year = active.reduce((s, i) => s + annualCost(i), 0);
  const next = active[0];
  const row = (i) => {
    const m = monthsOf(i.recurrence);
    const b = badgeOf(i);
    const archived = i.status === 'archived';
    const sub = [
      i.payMethod || null,
      i.cancelledOn ? `Attivo fino al ${formatShort(i.cancelledOn)}` : archived ? null : `${i.autoPay ? 'Prossimo addebito' : 'Prossimo rinnovo'}: ${formatShort(i.dueDate)}`,
      i.amount > 0 && m ? `≈ ${formatMoney(i.amount / m)}/mese` : null,
    ].filter(Boolean).join(' · ');
    return h('li', { class: 'row' },
      h('button', { type: 'button', class: 'row-main', onclick: () => openItemDetail(i.id) },
        catChip(catById[i.categoryId]),
        h('span', { class: 'row-text' },
          h('span', { class: `badge badge-${archived ? 'far' : b.tone}` }, archived ? 'Disdetto' : [h('span', { 'aria-hidden': 'true' }, b.icon + ' '), b.text]),
          h('span', { class: 'row-title' }, i.title, i.amount > 0 ? ` · ${formatMoney(i.amount)}` : ''),
          h('span', { class: 'row-sub' }, sub))));
  };
  const section = (label, list) => (list.length
    ? h('section', { class: 'group' }, h('h2', { class: 'group-title' }, label, h('span', { class: 'count' }, list.length)), h('ul', { class: 'list' }, list.map(row)))
    : null);
  const empty = subs.length === 0
    ? h('div', { class: 'empty' },
      h('div', { class: 'empty-art', 'aria-hidden': 'true' }, '🔁'),
      h('h2', null, 'Nessun abbonamento'),
      h('p', { class: 'muted' }, 'Aggiungi i tuoi abbonamenti (streaming, software, palestra...): vedrai quanto spendi al mese e all\'anno e ti avvisiamo prima del rinnovo.'),
      h('div', { class: 'chips' }, TEMPLATES.filter((t) => t.categoryId === SUBSCRIPTION_CATEGORY_ID).slice(0, 8).map((t) =>
        h('button', { type: 'button', class: 'chip', onclick: () => openItemForm({ prefill: { ...t, recurrence: { ...t.recurrence } } }) }, t.title))))
    : null;
  root.replaceChildren(...[
    h('h1', { class: 'page-title', tabindex: '-1' }, 'Abbonamenti'),
    h('div', { class: 'summary two' },
      h('div', { class: 'stat' }, h('strong', null, formatMoney(year / 12)), h('span', null, 'al mese')),
      h('div', { class: 'stat' }, h('strong', null, formatMoney(year)), h('span', null, 'all\'anno'))),
    next ? h('p', { class: 'muted' }, `${next.autoPay ? 'Prossimo addebito' : 'Prossimo rinnovo'}: ${next.title}, ${formatShort(next.dueDate)}${next.amount > 0 ? ' · ' + formatMoney(next.amount) : ''}`) : null,
    empty,
    section('Attivi', active), section('In pausa', paused), section('Disdetti', cancelled),
    h('button', { type: 'button', class: 'fab', onclick: () => openItemForm({ prefill: { ...NEW_SUB, recurrence: { ...NEW_SUB.recurrence } } }) }, h('span', { 'aria-hidden': 'true' }, '＋'), ' Abbonamento'),
  ].filter(Boolean));
}

__exp.render = render;
});
__def('js/backup.js', function (__exp) {
const { isValidISO } = __req('js/dates.js');
const { getAll, getMeta, transact, DEFAULT_CATEGORIES } = __req('js/db.js');
const { getPref } = __req('js/theme.js');

const SCHEMA_VERSION = 2;

async function buildBackup() {
  const [items, history, categories] = await Promise.all([getAll('items'), getAll('history'), getAll('categories')]);
  return {
    app: 'scadense',
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    items, history, categories,
    meta: { theme: getPref() || (await getMeta('theme', 'auto')) },
  };
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const str = (x, max = 2000) => (typeof x === 'string' ? x.slice(0, max) : '');

// Validazione pura: ritorna {ok, errors, data, counts}.
function validateBackup(raw) {
  const errors = [];
  if (!isObj(raw)) return { ok: false, errors: ['Il file non contiene un backup valido.'] };
  if (raw.app !== 'scadense') errors.push('Il file non è un backup di Scadense.');
  if (typeof raw.version !== 'number' || raw.version < 1) errors.push('Versione del backup non riconosciuta.');
  else if (raw.version > SCHEMA_VERSION) errors.push('Il backup proviene da una versione più recente di Scadense.');
  for (const k of ['items', 'history', 'categories']) {
    if (!Array.isArray(raw[k])) errors.push(`Sezione "${k}" mancante o non valida.`);
  }
  if (errors.length) return { ok: false, errors };

  const categories = [];
  const catIds = new Set();
  raw.categories.forEach((c, i) => {
    if (!isObj(c) || typeof c.id !== 'string' || !c.id || typeof c.name !== 'string') { errors.push(`Categoria #${i + 1} non valida.`); return; }
    if (catIds.has(c.id)) return;
    catIds.add(c.id);
    categories.push({
      id: c.id, name: str(c.name, 40) || 'Senza nome', emoji: str(c.emoji, 8) || '📌',
      color: /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : '#64748b',
      defaultRemind: Number.isFinite(c.defaultRemind) ? Math.max(0, Math.min(365, Math.floor(c.defaultRemind))) : 7,
      order: Number.isFinite(c.order) ? c.order : categories.length,
    });
  });

  const items = [];
  const itemIds = new Set();
  raw.items.forEach((it, i) => {
    if (!isObj(it) || typeof it.id !== 'string' || !it.id) { errors.push(`Scadenza #${i + 1}: id mancante.`); return; }
    if (typeof it.title !== 'string' || !it.title.trim()) { errors.push(`Scadenza #${i + 1}: titolo mancante.`); return; }
    if (!isValidISO(it.dueDate)) { errors.push(`Scadenza "${it.title}": data non valida.`); return; }
    const rec = isObj(it.recurrence) && (it.recurrence.unit === 'month' || it.recurrence.unit === 'year') && it.recurrence.every >= 1
      ? { unit: it.recurrence.unit, every: Math.min(120, Math.floor(it.recurrence.every)) }
      : { unit: 'none', every: 0 };
    const status = it.status === 'archived' ? 'archived' : 'active';
    const recurring = rec.unit !== 'none';
    const endDate = recurring && isValidISO(it.endDate) ? it.endDate : null;
    if (status === 'active' && endDate && endDate < it.dueDate) { errors.push(`Scadenza "${it.title}": data di fine precedente alla scadenza.`); return; }
    itemIds.add(it.id);
    items.push({
      autoPay: it.autoPay === true, payMethod: str(it.payMethod, 60).trim(), endDate,
      paidCount: Number.isFinite(it.paidCount) && it.paidCount >= 0 ? Math.floor(it.paidCount) : 0,
      paused: it.paused === true, cancelledOn: isValidISO(it.cancelledOn) ? it.cancelledOn : null,
      closedReason: it.closedReason === 'concluded' || it.closedReason === 'cancelled' ? it.closedReason : null,
      id: it.id, title: str(it.title, 120).trim(),
      categoryId: typeof it.categoryId === 'string' ? it.categoryId : 'altro',
      dueDate: it.dueDate, recurrence: rec,
      amount: Number.isFinite(it.amount) && it.amount >= 0 ? it.amount : null,
      remindDays: Number.isFinite(it.remindDays) ? Math.max(0, Math.min(365, Math.floor(it.remindDays))) : 7,
      notes: str(it.notes, 4000), reference: str(it.reference, 200),
      status,
      createdAt: Number.isFinite(it.createdAt) ? it.createdAt : Date.now(),
      updatedAt: Number.isFinite(it.updatedAt) ? it.updatedAt : Date.now(),
    });
  });

  const history = [];
  raw.history.forEach((e, i) => {
    if (!isObj(e) || typeof e.id !== 'string' || typeof e.itemId !== 'string' || !isValidISO(e.doneOn)) { errors.push(`Voce di storico #${i + 1} non valida.`); return; }
    history.push({
      id: e.id, itemId: e.itemId, doneOn: e.doneOn, dueWas: isValidISO(e.dueWas) ? e.dueWas : e.doneOn,
      amount: Number.isFinite(e.amount) ? e.amount : null, note: str(e.note, 500), ...(e.auto === true ? { auto: true } : {}),
    });
  });

  if (errors.length) return { ok: false, errors };
  const theme = isObj(raw.meta) && ['auto', 'light', 'dark'].includes(raw.meta.theme) ? raw.meta.theme : null;
  return {
    ok: true, errors: [],
    data: { items, history, categories, theme },
    counts: { items: items.length, history: history.length, categories: categories.length },
  };
}

// mode: 'merge' | 'replace'
async function applyBackup(data, mode) {
  const existingCats = mode === 'replace' ? [] : await getAll('categories');
  const catSet = new Map(existingCats.map((c) => [c.id, c]));
  data.categories.forEach((c) => catSet.set(c.id, c));
  if (!catSet.has('altro')) catSet.set('altro', DEFAULT_CATEGORIES.find((c) => c.id === 'altro'));
  const items = data.items.map((i) => (catSet.has(i.categoryId) ? i : { ...i, categoryId: 'altro' }));
  // Replace: elimino per id (non clear()) così le cancellazioni arrivano all'outbox di sync.
  const stale = { items: [], history: [], categories: [] };
  if (mode === 'replace') {
    const [curItems, curHist, curCats] = await Promise.all([getAll('items'), getAll('history'), getAll('categories')]);
    const keep = { items: new Set(items.map((i) => i.id)), history: new Set(data.history.map((e) => e.id)), categories: new Set(catSet.keys()) };
    stale.items = curItems.filter((r) => !keep.items.has(r.id)).map((r) => r.id);
    stale.history = curHist.filter((r) => !keep.history.has(r.id)).map((r) => r.id);
    stale.categories = curCats.filter((r) => !keep.categories.has(r.id)).map((r) => r.id);
  }
  await transact(['items', 'history', 'categories', 'meta'], (s) => {
    stale.items.forEach((id) => s.items.delete(id));
    stale.history.forEach((id) => s.history.delete(id));
    stale.categories.forEach((id) => s.categories.delete(id));
    [...catSet.values()].forEach((c) => s.categories.put(c));
    items.forEach((i) => s.items.put(i));
    data.history.forEach((e) => s.history.put(e));
    s.meta.put({ key: 'seeded', value: true });
    s.meta.put({ key: 'schema', value: SCHEMA_VERSION });
  });
  return data.theme;
}

__exp.SCHEMA_VERSION = SCHEMA_VERSION;
__exp.buildBackup = buildBackup;
__exp.validateBackup = validateBackup;
__exp.applyBackup = applyBackup;
});
__def('js/views/account.js', function (__exp) {
// Card "Account e sincronizzazione" nella schermata Altro.
const { h, toast, confirmDialog } = __req('js/ui.js');
const { getMeta } = __req('js/db.js');
const { authAvailable, getSession, signOut } = __req('js/supabase.js');
const { onStatus, fullSync, uploadLocalData } = __req('js/sync.js');
const connectivity = __req('js/connectivity.js');
const { openAuthModal } = __req('js/views/auth.js');

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

function renderAccountCard() {
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

__exp.renderAccountCard = renderAccountCard;
});
__def('js/views/altro.js', function (__exp) {
const { h, modal, sheetHeader, field, setError, toast, notifyChanged, confirmDialog, downloadFile } = __req('js/ui.js');
const { getAll, getCategories, getMeta, setMeta, put, transact, uuid } = __req('js/db.js');
const { getPref, setTheme } = __req('js/theme.js');
const { buildBackup, validateBackup, applyBackup } = __req('js/backup.js');
const { buildICS } = __req('js/ics.js');
const { todayISO } = __req('js/dates.js');
const { notificationsSupported } = __req('js/reminders.js');
const { pickTemplate } = __req('js/templates.js');
const { openItemForm } = __req('js/views/item-form.js');
const { filters } = __req('js/views/prossime.js');
const { renderAccountCard } = __req('js/views/account.js');

const APP_VERSION = '1.2.0';

async function render(root) {
  const [cats, notify, items] = await Promise.all([getCategories(), getMeta('notify', false), getAll('items')]);
  const pref = getPref();

  const themeGroup = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Tema' },
    [['auto', 'Automatico'], ['light', 'Chiaro'], ['dark', 'Scuro']].map(([v, l]) =>
      h('button', {
        type: 'button', class: 'seg-btn', role: 'radio', 'aria-checked': String(pref === v),
        onclick: async () => { await setTheme(v); render(root); },
      }, l)));

  const notifyBtn = h('button', {
    type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(!!notify && notificationsSupported() && Notification.permission === 'granted'),
    'aria-labelledby': 'notify-label',
    onclick: async () => {
      if (!notificationsSupported()) { toast('Le notifiche non sono supportate su questo dispositivo'); return; }
      const on = notifyBtn.getAttribute('aria-checked') === 'true';
      if (on) { await setMeta('notify', false); notifyBtn.setAttribute('aria-checked', 'false'); return; }
      const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (perm === 'granted') { await setMeta('notify', true); notifyBtn.setAttribute('aria-checked', 'true'); toast('Notifiche attivate (solo ad app aperta)'); }
      else toast('Permesso notifiche non concesso');
    },
  }, h('span', { class: 'switch-knob' }));

  const catList = h('ul', { class: 'list cat-list' }, cats.map((c) => h('li', { class: 'row' },
    h('button', { type: 'button', class: 'row-main', 'aria-label': `Modifica categoria ${c.name}`, onclick: () => editCategory(c, cats) },
      h('span', { class: 'cat-dot', style: `--c:${c.color}`, 'aria-hidden': 'true' }, c.emoji),
      h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, c.name), h('span', { class: 'row-sub' }, `Preavviso predefinito: ${c.defaultRemind} giorni`))))));

  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, id: 'import-file', 'aria-label': 'File di backup da importare' });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (f) await importFlow(f);
  });

  root.replaceChildren(
    h('h1', { class: 'page-title', tabindex: '-1' }, 'Altro'),
    h('section', { class: 'card' }, h('h2', { class: 'section-title' }, 'Aspetto'), themeGroup),
    h('section', { class: 'card' }, h('h2', { class: 'section-title' }, 'Promemoria'),
      h('div', { class: 'switch-row' },
        h('div', null, h('div', { id: 'notify-label', class: 'row-title' }, 'Notifiche ad app aperta'),
          h('div', { class: 'row-sub' }, 'Nessun invio da server: compaiono solo quando apri Scadense.')),
        notifyBtn)),
    h('section', { class: 'card' }, h('h2', { class: 'section-title' }, 'Scadenze'),
      h('div', { class: 'btn-grid' },
        h('button', { type: 'button', class: 'btn', onclick: async () => { const t = await pickTemplate(); if (t) openItemForm({ prefill: { ...t, recurrence: { ...t.recurrence } } }); } }, '✨ Modelli rapidi'),
        h('button', { type: 'button', class: 'btn', onclick: () => { filters.status = 'archived'; filters.q = ''; filters.cat = ''; location.hash = '#/'; } }, '🗄️ Archivio'))),
    h('section', { class: 'card' }, h('h2', { class: 'section-title' }, 'Categorie'), catList,
      h('button', { type: 'button', class: 'btn btn-block', onclick: () => editCategory(null, cats) }, '＋ Nuova categoria')),
    renderAccountCard(),
    h('section', { class: 'card' }, h('h2', { class: 'section-title' }, 'Backup e calendario'),
      h('p', { class: 'muted' }, 'Senza account i dati restano solo su questo dispositivo: esporta un backup per non perderli. Con l\'account vengono anche sincronizzati sul cloud.'),
      h('div', { class: 'btn-grid' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: exportBackup }, '⬇ Esporta backup'),
        h('button', { type: 'button', class: 'btn', onclick: () => fileInput.click() }, '⬆ Importa backup'),
        h('button', { type: 'button', class: 'btn', onclick: () => {
          const act = items.filter((i) => i.status === 'active');
          if (!act.length) { toast('Nessuna scadenza attiva da esportare'); return; }
          downloadFile('scadense-scadenze.ics', buildICS(act, cats), 'text/calendar');
        } }, '📅 Esporta tutto (.ics)')),
      fileInput),
    h('section', { class: 'card' }, h('h2', { class: 'section-title' }, 'Info'),
      h('p', { class: 'muted' }, `Scadense ${APP_VERSION} · scadenziario personale, offline, con account facoltativo.`)));
}

async function exportBackup() {
  const data = await buildBackup();
  downloadFile(`scadense-backup-${todayISO()}.json`, JSON.stringify(data, null, 2), 'application/json');
  toast('Backup esportato');
}

async function importFlow(file) {
  let raw;
  try { raw = JSON.parse(await file.text()); } catch { toast('Il file non è un JSON valido'); return; }
  const v = validateBackup(raw);
  if (!v.ok) {
    await modal((close) => h('div', null,
      sheetHeader('Backup non valido', close),
      h('ul', { class: 'errors' }, v.errors.slice(0, 6).map((e) => h('li', null, e))),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => close() }, 'Chiudi'))), { label: 'Backup non valido' });
    return;
  }
  const mode = await modal((close) => {
    let sel = 'merge';
    const radio = (val, label, hint) => h('label', { class: 'radio' },
      h('input', { type: 'radio', name: 'mode', value: val, checked: val === 'merge', onchange: () => { sel = val; } }),
      h('span', null, h('strong', null, label), h('small', { class: 'hint' }, hint)));
    return h('div', null,
      sheetHeader('Importa backup', close),
      h('p', null, `Contiene ${v.counts.items} scadenze, ${v.counts.history} voci di cronologia e ${v.counts.categories} categorie.`),
      h('fieldset', { class: 'radios' }, h('legend', null, 'Come importare'),
        radio('merge', 'Unisci', 'Aggiunge i dati; in caso di stesso identificativo prevale il backup.'),
        radio('replace', 'Sostituisci', 'Cancella i dati attuali e usa solo il backup.')),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Annulla'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => close(sel) }, 'Importa')));
  }, { label: 'Importa backup' });
  if (!mode) return;
  if (mode === 'replace' && !(await confirmDialog({ title: 'Sostituire i dati?', message: 'I dati attuali verranno cancellati.', okLabel: 'Sostituisci', danger: true }))) return;
  try {
    const theme = await applyBackup(v.data, mode);
    if (theme) await setTheme(theme);
    notifyChanged();
    toast('Backup importato');
  } catch { toast('Importazione non riuscita'); }
}

function editCategory(cat, cats) {
  return modal((close) => {
    const name = h('input', { type: 'text', maxlength: '40', value: cat ? cat.name : '' });
    const emoji = h('input', { type: 'text', maxlength: '8', value: cat ? cat.emoji : '📌' });
    const color = h('input', { type: 'color', value: cat ? cat.color : '#4f46e5' });
    const remind = h('input', { type: 'number', min: '0', max: '365', inputmode: 'numeric', value: cat ? cat.defaultRemind : 7 });
    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const n = name.value.trim();
      const rd = Math.floor(Number(remind.value));
      setError(name, n ? '' : 'Inserisci un nome.');
      const rdOk = remind.value !== '' && rd >= 0 && rd <= 365;
      setError(remind, rdOk ? '' : 'Inserisci un numero tra 0 e 365.');
      if (!n || !rdOk) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
      await put('categories', {
        id: cat ? cat.id : uuid(), name: n, emoji: emoji.value.trim() || '📌', color: color.value, defaultRemind: rd,
        order: cat ? cat.order : Math.max(-1, ...cats.map((c) => c.order)) + 1,
      });
      notifyChanged();
      toast(cat ? 'Categoria aggiornata' : 'Categoria aggiunta');
      close(true);
    } },
      sheetHeader(cat ? 'Modifica categoria' : 'Nuova categoria', close),
      field('Nome', name), field('Icona (emoji)', emoji), field('Colore', color),
      field('Preavviso predefinito (giorni)', remind),
      h('div', { class: 'btn-row' },
        cat && cat.id !== 'altro' ? h('button', { type: 'button', class: 'btn btn-danger-ghost', onclick: () => removeCategory(cat, close) }, 'Elimina') : null,
        h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Annulla'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, 'Salva')));
    return form;
  }, { label: cat ? 'Modifica categoria' : 'Nuova categoria' });
}

async function removeCategory(cat, close) {
  const items = (await getAll('items')).filter((i) => i.categoryId === cat.id);
  const ok = await confirmDialog({
    title: 'Elimina categoria',
    message: items.length ? `${items.length} scadenze passeranno alla categoria "Altro".` : `Vuoi eliminare "${cat.name}"?`,
    okLabel: 'Elimina', danger: true,
  });
  if (!ok) return;
  await transact(['items', 'categories'], (s) => {
    items.forEach((i) => s.items.put({ ...i, categoryId: 'altro', updatedAt: Date.now() }));
    s.categories.delete(cat.id);
  });
  if (filters.cat === cat.id) filters.cat = '';
  notifyChanged();
  toast('Categoria eliminata');
  close(true);
}

__exp.APP_VERSION = APP_VERSION;
__exp.render = render;
});
__def('js/app.js', function (__exp) {
const { init } = __req('js/db.js');
const { initTheme, setTheme, getPref, resolveTheme } = __req('js/theme.js');
const { toast } = __req('js/ui.js');
const { startCloud } = __req('js/cloud.js');
const { runReminders } = __req('js/reminders.js');
const { runRollover } = __req('js/model.js');
const prossime = __req('js/views/prossime.js');
const calendario = __req('js/views/calendario.js');
const costi = __req('js/views/costi.js');
const abbonamenti = __req('js/views/abbonamenti.js');
const altro = __req('js/views/altro.js');

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


});
__req('js/app.js');
})();
