// IndexedDB promisificato: scadense-db v3 (v3 = store 'outbox' per la sincronizzazione cloud)
const DB_NAME = 'scadense-db';
const VERSION = 3;
export const STORES = ['items', 'history', 'categories', 'meta'];
// Store sincronizzati col cloud; 'meta' e 'outbox' restano per-dispositivo.
export const SYNCED_STORES = ['items', 'history', 'categories'];

export const DEFAULT_CATEGORIES = [
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
export const ITEM_DEFAULTS = {
  autoPay: false, payMethod: '', endDate: null, paidCount: 0, paused: false, cancelledOn: null, closedReason: null,
};
export const normalizeItem = (item) => ({ ...ITEM_DEFAULTS, ...item });
let dbPromise = null;

export function openDB() {
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
export function onChange(cb) { changeCb = typeof cb === 'function' ? cb : null; }

// Puro: avvolge gli object store sincronizzati di `map` ({nome: objectStore}, con 'outbox').
// put() imposta updatedAt = now() su una copia e accoda {op:'put'}; delete() accoda {op:'del'};
// clear() è vietato (usare delete per id, così le cancellazioni arrivano all'outbox).
export function wrapWriteStores(map, now = Date.now) {
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
export async function transact(stores, fn, mode = 'readwrite', opts = {}) {
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
export const outboxAll = () => getAll('outbox');

// Rimuove solo le voci il cui `at` è invariato rispetto allo snapshot (scritture arrivate durante il push restano).
export async function outboxRemove(entries) {
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
export async function enqueueAll() {
  const at = Date.now();
  const lists = await Promise.all(SYNCED_STORES.map((n) => getAll(n)));
  await transact(['outbox'], (s) => {
    SYNCED_STORES.forEach((n, i) => lists[i].forEach((r) => s.outbox.put({ tid: n + ':' + r.id, store: n, id: r.id, op: 'put', at })));
  }, 'readwrite', { raw: true });
}

// Applica righe remote in un'unica transazione atomica: niente stamp, niente outbox, niente onChange.
export async function applyRaw({ puts = [], dels = [], dropOutbox = [] } = {}) {
  if (!puts.length && !dels.length && !dropOutbox.length) return;
  await transact([...SYNCED_STORES, 'outbox'], (s) => {
    puts.forEach(({ store, row }) => s[store].put(row));
    dels.forEach(({ store, id }) => s[store].delete(id));
    dropOutbox.forEach((tid) => s.outbox.delete(tid));
  }, 'readwrite', { raw: true });
}

// Cambio account: svuota i dati sincronizzati e l'outbox, poi ripristina le categorie predefinite (raw).
export async function clearSynced() {
  await transact([...SYNCED_STORES, 'outbox'], (s) => {
    SYNCED_STORES.forEach((n) => s[n].clear());
    s.outbox.clear();
    DEFAULT_CATEGORIES.forEach((c) => s.categories.put(c));
  }, 'readwrite', { raw: true });
}

export async function countLocalData() {
  const [items, history, categories] = await Promise.all(SYNCED_STORES.map((n) => getAll(n)));
  return { items: items.length, history: history.length, categories: categories.length };
}

export async function getAll(store) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).getAll());
}
export async function get(store, key) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).get(key));
}
export const put = (store, value) => transact([store], (s) => { s[store].put(value); });
export const del = (store, key) => transact([store], (s) => { s[store].delete(key); });

export async function historyOf(itemId) {
  const db = await openDB();
  const list = await wrap(db.transaction('history').objectStore('history').index('itemId').getAll(itemId));
  return list.sort((a, b) => (a.doneOn < b.doneOn ? 1 : a.doneOn > b.doneOn ? -1 : 0));
}

export async function getMeta(key, def = null) {
  const r = await get('meta', key);
  return r ? r.value : def;
}
export const setMeta = (key, value) => put('meta', { key, value });

export async function getCategories() {
  const list = await getAll('categories');
  return list.sort((a, b) => a.order - b.order);
}

export function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// Prima apertura: categorie predefinite.
export async function init() {
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
