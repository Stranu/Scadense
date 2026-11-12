// Motore di sincronizzazione Scadense <-> Supabase. Dipendenze iniettabili (testabili senza rete né IndexedDB).
// Senza sessione NON fa nessuna chiamata di rete. Non lancia mai verso la UI. Non importa viste.
import * as db from './db.js';
import * as sb from './supabase.js';
import * as conn from './connectivity.js';
import { TABLES, TABLE_ORDER, toMs, toIso, chunk, decideRemote, backoffDelay } from './sync-core.js';

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
export function createEngine(deps) {
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
export const engine = createEngine({
  store: {
    getAll: db.getAll, get: db.get, applyRaw: db.applyRaw, outboxAll: db.outboxAll, outboxRemove: db.outboxRemove,
    enqueueAll: db.enqueueAll, getMeta: db.getMeta, setMeta: db.setMeta, clearSynced: db.clearSynced, onChange: db.onChange,
  },
  getClient: sb.getClient,
  getSession: sb.getSession,
  connectivity: conn,
});

export const start = () => engine.start();
export const stop = () => engine.stop();
export const fullSync = (s) => engine.fullSync(s);
export const push = () => engine.push();
export const pull = () => engine.pull();
export const uploadLocalData = (s) => engine.uploadLocalData(s);
export const switchAccount = (uid) => engine.switchAccount(uid);
export const onStatus = (cb) => engine.onStatus(cb);
export const getStatus = () => engine.getStatus();
export const pendingCount = () => engine.pendingCount();
