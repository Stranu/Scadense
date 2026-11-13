// Test unitari senza DOM: node tools/test.mjs
import assert from 'node:assert/strict';
import { addMonths, addDays, diffDays, isValidISO } from '../js/dates.js';
import { nextDue, monthsOf, annualCost, occurrences, countOccurrences, endFromCount, remainingCount, lastOccurrence, remainingTotal, progress } from '../js/recurrence.js';
import { buildICS, icsEscape } from '../js/ics.js';
import { validateBackup, SCHEMA_VERSION } from '../js/backup.js';
import { groupOf, sortByUrgency, badgeOf, planRollover, isSubscription, canPauseCancel, costByCategory, SUBSCRIPTION_CATEGORY_ID } from '../js/model.js';
import { normalizeItem, ITEM_DEFAULTS, wrapWriteStores, DEFAULT_CATEGORIES } from '../js/db.js';
import { readFileSync } from 'node:fs';
import { TABLES, toMs, toIso, stampOf, chunk, decideRemote, backoffDelay } from '../js/sync-core.js';
import { createEngine } from '../js/sync.js';
import * as sbMod from '../js/supabase.js';
import { dueForReminder } from '../js/reminders.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const ta = async (name, fn) => { await fn(); n++; console.log('ok -', name); };

t('addMonths clamp fine mese', () => {
  assert.equal(addMonths('2025-01-31', 1), '2025-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2024-02-29', 12), '2025-02-28');
  assert.equal(addMonths('2025-11-30', 3), '2026-02-28');
  assert.equal(addMonths('2025-03-15', -3), '2024-12-15');
});
t('addDays/diffDays', () => {
  assert.equal(addDays('2025-12-31', 1), '2026-01-01');
  assert.equal(diffDays('2024-02-28', '2024-03-01'), 2);
  assert.equal(diffDays('2025-03-29', '2025-03-30'), 1); // cambio ora legale
  assert.equal(diffDays('2025-05-02', '2025-05-01'), -1);
});
t('isValidISO', () => {
  assert.ok(isValidISO('2024-02-29'));
  assert.ok(!isValidISO('2025-02-29'));
  assert.ok(!isValidISO('2025-13-01'));
  assert.ok(!isValidISO('abc'));
});
t('nextDue', () => {
  assert.equal(nextDue('2025-03-10', { unit: 'year', every: 1 }), '2026-03-10');
  assert.equal(nextDue('2025-03-10', { unit: 'month', every: 3 }), '2025-06-10');
  assert.equal(nextDue('2025-03-10', { unit: 'none', every: 0 }), null);
  assert.equal(nextDue('2020-03-10', { unit: 'year', every: 1 }, '2025-01-01'), '2025-03-10');
  assert.equal(nextDue('2025-03-10', { unit: 'month', every: 1 }, '2025-03-10'), '2025-04-10');
});
t('costi', () => {
  assert.equal(monthsOf({ unit: 'year', every: 2 }), 24);
  assert.equal(annualCost({ amount: 100, recurrence: { unit: 'year', every: 2 } }), 50);
  assert.equal(annualCost({ amount: 10, recurrence: { unit: 'month', every: 1 } }), 120);
  assert.equal(annualCost({ amount: 10, recurrence: { unit: 'none', every: 0 } }), 0);
  assert.equal(occurrences({ dueDate: '2025-01-15', recurrence: { unit: 'month', every: 6 } }, '2025-01-01', '2025-12-31').length, 2);
  assert.deepEqual(occurrences({ dueDate: '2020-01-15', recurrence: { unit: 'year', every: 1 } }, '2025-01-01', '2025-12-31'), ['2025-01-01', '2025-01-15']);
});
t('urgenza', () => {
  const it = (d) => ({ dueDate: d, title: d });
  assert.equal(groupOf(it('2025-04-30'), '2025-05-01'), 'scadute');
  assert.equal(groupOf(it('2025-05-08'), '2025-05-01'), 'settimana');
  assert.equal(groupOf(it('2025-05-31'), '2025-05-01'), 'mese');
  assert.equal(groupOf(it('2025-06-01'), '2025-05-01'), 'dopo');
  assert.deepEqual(sortByUrgency([it('2025-06-01'), it('2025-05-01')]).map((x) => x.dueDate), ['2025-05-01', '2025-06-01']);
  assert.equal(badgeOf(it('2025-05-01'), '2025-05-01').text, 'Oggi');
  assert.equal(badgeOf(it('2025-04-28'), '2025-05-01').text, 'Scaduta da 3 g');
});
t('ics', () => {
  const s = buildICS([{ id: 'a', title: 'Bollo, auto; "x"', dueDate: '2025-05-01', recurrence: { unit: 'year', every: 1 }, amount: 10, remindDays: 30, notes: 'riga1\nriga2', reference: '' }], [], new Date('2025-01-01T00:00:00Z'));
  assert.ok(s.startsWith('BEGIN:VCALENDAR'));
  assert.ok(s.includes('DTSTART;VALUE=DATE:20250501'));
  assert.ok(s.includes('DTEND;VALUE=DATE:20250502'));
  assert.ok(s.includes('RRULE:FREQ=YEARLY;INTERVAL=1'));
  assert.ok(s.includes('TRIGGER:-P30D'));
  assert.ok(s.includes('SUMMARY:Bollo\\, auto\\; "x"'));
  assert.equal(icsEscape('a\nb'), 'a\\nb');
  assert.ok(s.split('\r\n').every((l) => l.length <= 75));
});
t('validazione backup', () => {
  const ok = { app: 'scadense', version: 1, items: [{ id: '1', title: 'A', categoryId: 'altro', dueDate: '2025-05-01', recurrence: { unit: 'year', every: 1 }, amount: 5 }], history: [], categories: [{ id: 'altro', name: 'Altro', emoji: '📌', color: '#64748b', defaultRemind: 7, order: 0 }], meta: { theme: 'dark' } };
  const r = validateBackup(ok);
  assert.ok(r.ok);
  assert.equal(r.counts.items, 1);
  assert.equal(r.data.theme, 'dark');
  assert.ok(!validateBackup(null).ok);
  assert.ok(!validateBackup({ ...ok, app: 'altro' }).ok);
  assert.ok(!validateBackup({ ...ok, version: 99 }).ok);
  assert.ok(!validateBackup({ ...ok, items: [{ id: '1', title: 'A', dueDate: '2025-02-30' }] }).ok);
  assert.ok(!validateBackup({ ...ok, history: 'x' }).ok);
});

const M1 = { unit: 'month', every: 1 };
const Y1 = { unit: 'year', every: 1 };
const sub = (o = {}) => ({ id: 'x', title: 'Netflix', dueDate: '2025-01-31', recurrence: M1, amount: 10, autoPay: true, status: 'active', ...o });
t('rollover: catch-up con storico', () => {
  const p = planRollover(sub(), '2025-04-15');
  assert.deepEqual(p.entries.map((e) => e.dueWas), ['2025-01-31', '2025-02-28', '2025-03-28']);
  assert.ok(p.entries.every((e) => e.amount === 10 && e.auto === true && e.id === `auto-x-${e.dueWas}`));
  assert.equal(p.after.dueDate, '2025-04-28');
  assert.equal(p.after.paidCount, 3);
  assert.equal(p.after.status, 'active');
  assert.equal(planRollover(p.after, '2025-04-15'), null); // idempotente
  assert.equal(planRollover(sub({ dueDate: '2025-04-15' }), '2025-04-15'), null); // oggi: nessun addebito
  assert.equal(planRollover(sub({ autoPay: false }), '2025-04-15'), null);
  assert.equal(planRollover(sub({ paused: true }), '2025-04-15'), null);
  assert.equal(planRollover(sub({ cancelledOn: '2025-06-01' }), '2025-04-15'), null);
  assert.equal(planRollover(sub({ recurrence: Y1, dueDate: '2022-03-01' }), '2025-04-15').entries.length, 4);
  assert.equal(planRollover(sub({ recurrence: Y1, dueDate: '2022-06-01' }), '2025-04-15').entries.length, 3);
});
t('rollover: disdetta scaduta archivia', () => {
  const p = planRollover(sub({ cancelledOn: '2025-04-01' }), '2025-04-15');
  assert.equal(p.after.status, 'archived');
  assert.equal(p.after.closedReason, 'cancelled');
  assert.equal(p.entries.length, 0);
});
t('fine e rate', () => {
  assert.equal(endFromCount('2025-01-15', M1, 12), '2025-12-15');
  assert.equal(countOccurrences('2025-01-15', M1, '2025-12-31'), 12);
  assert.equal(countOccurrences('2025-01-15', M1, '2025-12-15'), 12);
  assert.equal(countOccurrences('2025-01-15', M1, '2025-01-15'), 1);
  assert.equal(countOccurrences('2025-01-15', M1, '2025-01-14'), 0);
  const f = { dueDate: '2025-01-31', recurrence: M1, amount: 100, endDate: '2025-03-31', paidCount: 2 };
  assert.equal(remainingCount(f), 3);
  assert.equal(remainingTotal(f), 300);
  assert.equal(lastOccurrence(f), '2025-03-31');
  assert.deepEqual(progress(f), { paid: 2, total: 5, remaining: 3, pct: 40 });
  assert.equal(remainingCount({ dueDate: '2025-01-31', recurrence: M1 }), null);
  assert.equal(remainingTotal({ ...f, amount: null }), null);
  assert.equal(nextDue('2025-03-31', M1, undefined, '2025-03-31'), null);
  assert.equal(nextDue('2025-02-28', M1, undefined, '2025-03-31'), '2025-03-28');
  assert.equal(nextDue('2025-03-10', M1), '2025-04-10');
});
t('rollover: raggiunge la fine e conclude (finanziamento automatico)', () => {
  const p = planRollover(sub({ dueDate: '2025-01-10', endDate: '2025-04-10', amount: 100 }), '2025-12-01');
  assert.deepEqual(p.entries.map((e) => e.dueWas), ['2025-01-10', '2025-02-10', '2025-03-10', '2025-04-10']);
  assert.equal(p.after.status, 'archived');
  assert.equal(p.after.closedReason, 'concluded');
  assert.equal(p.after.dueDate, '2025-04-10');
  assert.equal(p.after.paidCount, 4);
  assert.equal(planRollover(p.after, '2025-12-01'), null);
  const q = planRollover(sub({ dueDate: '2025-01-10', endDate: '2025-06-10', paidCount: 0 }), '2025-03-20');
  assert.equal(q.entries.length, 3);
  assert.equal(q.after.dueDate, '2025-04-10');
  assert.equal(remainingCount(q.after), 3);
  assert.equal(q.after.status, 'active');
});
t('proiezioni costi con data di fine', () => {
  const f = { dueDate: '2025-06-10', recurrence: M1, amount: 10, endDate: '2025-10-10' };
  assert.equal(annualCost(f, '2025-06-01'), 50);
  assert.equal(annualCost({ ...f, endDate: '2025-03-10', dueDate: '2025-01-10' }, '2025-06-01'), 0);
  assert.equal(annualCost({ ...f, endDate: undefined }, '2025-06-01'), 120);
  assert.equal(occurrences({ ...f, endDate: '2025-08-10' }, '2025-06-01', '2026-06-01').length, 3);
  assert.deepEqual(occurrences({ ...f, paused: true }, '2025-06-01', '2026-06-01'), []);
  assert.equal(annualCost({ ...f, cancelledOn: '2025-09-01' }, '2025-06-01'), 0);
});
t('Abbonamenti = solo categoria abbonamenti, indipendente da autoPay', () => {
  const it = (o) => ({ id: 'x', title: 'x', categoryId: 'casa', status: 'active', autoPay: false, ...o });
  assert.equal(SUBSCRIPTION_CATEGORY_ID, 'abbonamenti');
  assert.ok(DEFAULT_CATEGORIES.some((c) => c.id === SUBSCRIPTION_CATEGORY_ID));
  assert.equal(isSubscription(it({ categoryId: 'casa', autoPay: true })), false); // bolletta in addebito automatico
  assert.equal(isSubscription(it({ categoryId: 'altro', autoPay: true })), false); // finanziamento
  assert.equal(isSubscription(it({ categoryId: 'abbonamenti', autoPay: false })), true);
  assert.equal(isSubscription(it({ categoryId: 'abbonamenti', autoPay: true, paused: true })), true);
  assert.equal(isSubscription(it({ categoryId: 'abbonamenti', status: 'archived', closedReason: 'cancelled' })), true);
  assert.equal(isSubscription(it({ categoryId: 'abbonamenti', status: 'archived', closedReason: 'concluded' })), false);
  assert.equal(canPauseCancel(it({ autoPay: true })), true);
  assert.equal(canPauseCancel(it({ categoryId: 'abbonamenti' })), true);
  assert.equal(canPauseCancel(it({})), false);
});
t('costo mensile per categoria', () => {
  const cats = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'z', name: 'Z' }];
  const it = (categoryId, amount, o = {}) => ({ id: categoryId + amount, categoryId, amount, status: 'active', recurrence: { unit: 'month', every: 1 }, dueDate: '2025-06-10', ...o });
  const items = [it('a', 10), it('a', 100, { recurrence: { unit: 'year', every: 1 } }), it('b', 33.33, { recurrence: { unit: 'year', every: 1 } }), it('c', 7.77, { recurrence: { unit: 'year', every: 1 } }),
    it('z', 50, { paused: true }), it('z', 50, { cancelledOn: '2025-09-01' }), it('z', 50, { status: 'archived' }), it('z', 50, { recurrence: { unit: 'none', every: 0 } })];
  const annual = costByCategory(items, cats, 'annual');
  assert.deepEqual(annual.map((x) => [x.c.id, x.v]), [['a', 220], ['b', 33.33], ['c', 7.77]]);
  const monthly = costByCategory(items, cats, 'monthly');
  assert.deepEqual(monthly.map((x) => x.c.id), ['a', 'b', 'c']); // pausa/disdetta/archiviate/non ricorrenti escluse
  assert.equal(monthly[0].v, 18.33);
  const totalM = Math.round(annual.reduce((s, x) => s + x.v, 0) / 12 * 100);
  assert.equal(Math.round(monthly.reduce((s, x) => s + x.v * 100, 0)), totalM); // somma righe = totale mensile
  assert.deepEqual(costByCategory([], cats, 'monthly'), []);
});t('ics con UNTIL/COUNT', () => {
  const now = new Date('2025-01-01T00:00:00Z');
  const ics = (o) => buildICS([{ id: 'a', title: 'Mutuo', dueDate: '2025-01-15', recurrence: M1, amount: 5, remindDays: 3, ...o }], [], now);
  assert.ok(ics({ endDate: '2025-12-15' }).includes('RRULE:FREQ=MONTHLY;INTERVAL=1;UNTIL=20251215'));
  assert.ok(ics({ endDate: '2025-12-31' }).includes('UNTIL=20251215'));
  assert.ok(ics({ recurrence: Y1, endDate: '2027-02-01' }).includes('RRULE:FREQ=YEARLY;INTERVAL=1;UNTIL=20270115'));
  assert.ok(!ics({ endDate: '2025-01-15' }).includes('RRULE'));
  assert.ok(!ics({ paused: true }).includes('RRULE'));
  assert.ok(ics({}).includes('RRULE:FREQ=MONTHLY;INTERVAL=1\r\n'));
  const a = ics({ autoPay: true, payMethod: 'Visa', endDate: '2025-03-15' });
  assert.ok(a.includes('Addebito automatico: Visa') && a.includes('Rate rimanenti: 3'));
  assert.ok(a.split('\r\n').every((l) => l.length <= 75));
});
t('backup: migrazione schema v1 -> v2', () => {
  assert.equal(SCHEMA_VERSION, 2);
  const cat = [{ id: 'altro', name: 'Altro', emoji: '📌', color: '#64748b', defaultRemind: 7, order: 0 }];
  const it = { id: '1', title: 'A', categoryId: 'altro', dueDate: '2025-05-01', recurrence: M1, amount: 5 };
  const v1 = validateBackup({ app: 'scadense', version: 1, items: [it], history: [], categories: cat });
  assert.ok(v1.ok);
  const x = v1.data.items[0];
  for (const k of Object.keys(ITEM_DEFAULTS)) assert.deepEqual(x[k], ITEM_DEFAULTS[k], k);
  const v2 = validateBackup({ app: 'scadense', version: 2, categories: cat, items: [{ ...it, autoPay: true, payMethod: 'PayPal', endDate: '2025-09-01', paidCount: 2, paused: true, cancelledOn: '2025-08-01', closedReason: 'cancelled' }], history: [{ id: 'h', itemId: '1', doneOn: '2025-05-01', auto: true }] });
  assert.ok(v2.ok);
  const y = v2.data.items[0];
  assert.deepEqual([y.autoPay, y.payMethod, y.endDate, y.paidCount, y.paused, y.cancelledOn, y.closedReason], [true, 'PayPal', '2025-09-01', 2, true, '2025-08-01', 'cancelled']);
  assert.equal(v2.data.history[0].auto, true);
  assert.ok(!validateBackup({ app: 'scadense', version: 3, categories: cat, items: [], history: [] }).ok);
  const mk = (o) => validateBackup({ app: 'scadense', version: 2, categories: cat, history: [], items: [{ ...it, ...o }] });
  assert.equal(mk({ recurrence: { unit: 'none', every: 0 }, endDate: '2025-09-01' }).data.items[0].endDate, null);
  assert.equal(mk({ endDate: 'boh' }).data.items[0].endDate, null);
  assert.equal(mk({ closedReason: 'x' }).data.items[0].closedReason, null);
  assert.ok(!mk({ endDate: '2025-04-01' }).ok);
  assert.ok(mk({ endDate: '2025-04-01', status: 'archived' }).ok);
  const old = { id: 'o', dueDate: '2025-01-01' };
  assert.equal(normalizeItem(old).autoPay, false);
  assert.ok(!('autoPay' in old));
});
t('badge, gruppi e promemoria per pagamenti automatici', () => {
  const a = (d, o = {}) => ({ id: d, title: d, dueDate: d, status: 'active', autoPay: true, remindDays: 5, ...o });
  assert.equal(badgeOf(a('2025-05-06'), '2025-05-01').text, 'Addebito tra 5 g');
  assert.equal(badgeOf(a('2025-05-06'), '2025-05-01').tone, 'auto');
  assert.equal(badgeOf(a('2025-05-02'), '2025-05-01').text, 'Addebito domani');
  assert.equal(badgeOf(a('2025-05-06', { paused: true }), '2025-05-01').text, 'In pausa');
  assert.equal(groupOf(a('2025-05-02', { paused: true }), '2025-05-01'), 'dopo');
  assert.equal(groupOf(a('2025-04-01'), '2025-05-01'), 'settimana');
  const list = dueForReminder([a('2025-05-04'), a('2025-05-11'), a('2025-05-03', { paused: true }), a('2025-04-20'), a('2025-05-04', { autoPay: false, id: 'n' }), a('2025-04-20', { autoPay: false, id: 'late' })], '2025-05-01');
  assert.deepEqual(list.map((i) => i.id), ['late', '2025-05-04', 'n']);
});
// ====================== Sync / auth ======================
const UID = 'user-1';
const sess = (uid = UID) => ({ user: { id: uid, email: uid + '@example.com' } });
const fakeConn = () => { const c = { reach: 0, unreach: 0, markReachable() { c.reach++; }, markUnreachable() { c.unreach++; } }; return c; };

// Object store finto (Map) con la stessa superficie usata da wrapWriteStores.
function fakeOS(map, key) {
  return {
    put: (v) => { map.set(v[key], { ...v }); return {}; },
    delete: (k) => { map.delete(k); return {}; },
    get: (k) => map.get(k), getAll: () => [...map.values()],
  };
}

// Dispositivo in memoria: store adapter + scritture "da app" tramite wrapWriteStores reale.
function makeDevice(nowRef) {
  const data = { items: new Map(), history: new Map(), categories: new Map() };
  const outbox = new Map();
  const meta = new Map();
  const dev = {
    data, outbox, meta, applyRawCalls: 0,
    tx(fn) {
      const m = { items: fakeOS(data.items, 'id'), history: fakeOS(data.history, 'id'), categories: fakeOS(data.categories, 'id'), outbox: fakeOS(outbox, 'tid') };
      fn(wrapWriteStores(m, () => nowRef.t));
      if (dev.onChangeCb) dev.onChangeCb();
    },
    store: {
      getAll: async (s) => [...data[s].values()].map((r) => ({ ...r })),
      get: async (s, k) => (data[s].has(k) ? { ...data[s].get(k) } : undefined),
      applyRaw: async ({ puts = [], dels = [], dropOutbox = [] }) => {
        dev.applyRawCalls++;
        puts.forEach(({ store, row }) => data[store].set(row.id, { ...row }));
        dels.forEach(({ store, id }) => data[store].delete(id));
        dropOutbox.forEach((tid) => outbox.delete(tid));
      },
      outboxAll: async () => [...outbox.values()].map((e) => ({ ...e })),
      outboxRemove: async (entries) => { entries.forEach((e) => { const c = outbox.get(e.tid); if (c && c.at === e.at) outbox.delete(e.tid); }); },
      enqueueAll: async () => { for (const s of Object.keys(data)) data[s].forEach((r) => outbox.set(s + ':' + r.id, { tid: s + ':' + r.id, store: s, id: r.id, op: 'put', at: nowRef.t })); },
      getMeta: async (k, d = null) => (meta.has(k) && meta.get(k) !== null ? meta.get(k) : d),
      setMeta: async (k, v) => { meta.set(k, v); },
      clearSynced: async () => { Object.values(data).forEach((m) => m.clear()); outbox.clear(); DEFAULT_CATEGORIES.forEach((c) => data.categories.set(c.id, { ...c })); },
      onChange: (cb) => { dev.onChangeCb = cb; },
    },
  };
  return dev;
}

// Supabase finto: PK (user_id,id), trigger "scrittura obsoleta" (tiene i dati, aggiorna synced_at).
function makeRemote() {
  const tables = new Map();
  let clock = Date.UTC(2025, 0, 1);
  const calls = [];
  const r = { calls, failUpsert: null, failSelect: null, hook: null };
  const tbl = (nm) => { if (!tables.has(nm)) tables.set(nm, new Map()); return tables.get(nm); };
  const tick = () => new Date((clock += 1000)).toISOString();
  r.rows = (nm) => [...tbl(nm).values()];
  r.seed = (nm, rows) => rows.forEach((x) => tbl(nm).set(x.user_id + '|' + x.id, { deleted: false, ...x }));
  r.client = {
    from: (nm) => ({
      upsert(rows, opts) {
        calls.push({ op: 'upsert', table: nm, rows, opts });
        if (r.hook) r.hook(nm, rows);
        if (r.failUpsert) return Promise.resolve({ error: r.failUpsert });
        for (const x of rows) {
          const k = x.user_id + '|' + x.id;
          const old = tbl(nm).get(k);
          if (!old) tbl(nm).set(k, { deleted: false, ...x, synced_at: tick() });
          else if (Date.parse(x.updated_at) < Date.parse(old.updated_at)) tbl(nm).set(k, { ...old, synced_at: tick() });
          else tbl(nm).set(k, { ...old, ...x, synced_at: tick() });
        }
        return Promise.resolve({ error: null });
      },
      select() {
        const q = { uid: null, gte: null, range: [0, Infinity] };
        const b = {
          eq(c, v) { q.uid = v; return b; }, gte(c, v) { q.gte = v; return b; }, order() { return b; },
          range(a, z) { q.range = [a, z]; return b; },
          then(res, rej) {
            calls.push({ op: 'select', table: nm, range: q.range, gte: q.gte });
            if (r.failSelect) return Promise.resolve({ data: null, error: r.failSelect }).then(res, rej);
            const rows = [...tbl(nm).values()].filter((x) => x.user_id === q.uid && (!q.gte || Date.parse(x.synced_at) >= Date.parse(q.gte)));
            rows.sort((a, c) => Date.parse(a.synced_at) - Date.parse(c.synced_at) || (a.id < c.id ? -1 : 1));
            return Promise.resolve({ data: rows.slice(q.range[0], q.range[1] + 1), error: null }).then(res, rej);
          },
        };
        return b;
      },
    }),
  };
  return r;
}

function makeEngine(dev, remote, { session = sess(), nowRef = { t: 1700000000000 }, conn = fakeConn() } = {}) {
  const tasks = [];
  const sessionRef = { s: session };
  const engine = createEngine({
    store: dev.store,
    getClient: () => remote.client,
    getSession: async () => { if (sessionRef.throws) throw new Error('boom'); return sessionRef.s; },
    connectivity: conn, now: () => nowRef.t,
    schedule: (fn, ms) => { const task = { fn, ms, cancelled: false }; tasks.push(task); return () => { task.cancelled = true; }; },
  });
  return { engine, tasks, conn, sessionRef };
}

const itemRow = (o = {}) => ({ id: 'a', title: 'Bollo', categoryId: 'casa', dueDate: '2025-05-01', recurrence: { unit: 'year', every: 1 }, amount: 12.5, remindDays: 30, notes: 'n', reference: 'r', status: 'active', autoPay: true, payMethod: 'Visa', endDate: '2027-05-01', paidCount: 2, paused: false, cancelledOn: null, closedReason: null, createdAt: 1700000000000, updatedAt: 1700000005000, ...o });

await ta('sync-core: mappatura round-trip e coalescing dei null', () => {
  const it = itemRow();
  const rem = TABLES.items.toRemote(it);
  assert.equal(rem.category_id, 'casa'); assert.equal(rem.auto_pay, true); assert.equal(rem.created_at, toIso(1700000000000)); assert.equal(rem.updated_at, toIso(1700000005000));
  assert.deepEqual(TABLES.items.toLocal(rem), it);
  const h = { id: 'auto-a-2025-01-01', itemId: 'a', doneOn: '2025-01-01', dueWas: '2025-01-01', amount: 5, note: '', auto: true, updatedAt: 1700000001000 };
  assert.deepEqual(TABLES.history.toLocal(TABLES.history.toRemote(h)), h);
  const h2 = { id: 'h', itemId: 'a', doneOn: '2025-01-01', dueWas: '2025-01-01', amount: null, note: 'x', updatedAt: 5 };
  assert.deepEqual(TABLES.history.toLocal(TABLES.history.toRemote(h2)), h2);
  const c = { id: 'casa', name: 'Casa', emoji: '🏠', color: '#d97706', defaultRemind: 7, order: 2, updatedAt: 9 };
  assert.deepEqual(TABLES.categories.toLocal(TABLES.categories.toRemote(c)), c);
  assert.equal(TABLES.categories.toRemote(c).sort_order, 2);
  // Riga remota con null ovunque: default coerenti
  const bare = TABLES.items.toLocal({ id: 'z', title: null, due_date: '2025-01-01', recurrence: null, remind_days: null, auto_pay: null, paid_count: null, updated_at: toIso(1000), user_id: 'u', synced_at: 'x', deleted: false });
  assert.equal(bare.remindDays, 7); assert.equal(bare.autoPay, false); assert.equal(bare.paidCount, 0); assert.deepEqual(bare.recurrence, { unit: 'none', every: 0 });
  assert.ok(!('user_id' in bare) && !('synced_at' in bare) && !('deleted' in bare));
  assert.equal(bare.categoryId, 'altro'); assert.equal(bare.updatedAt, 1000);
  // riga seed senza updatedAt/createdAt => epoch
  assert.equal(TABLES.categories.toRemote({ id: 'x', name: 'X' }).updated_at, toIso(0));
});
await ta('sync-core: tempi, chunk, backoff', () => {
  assert.equal(toMs(toIso(1234567890123)), 1234567890123);
  assert.equal(toMs('2025-01-01T00:00:00Z'), toMs('2025-01-01T00:00:00.000+00:00'));
  assert.equal(toMs('boh'), 0);
  assert.equal(stampOf({ updatedAt: 5, createdAt: 3 }), 5); assert.equal(stampOf({ createdAt: 3 }), 3); assert.equal(stampOf({}), 0); assert.equal(stampOf(undefined), 0);
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]); assert.deepEqual(chunk([], 3), []);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map(backoffDelay), [5000, 15000, 45000, 120000, 300000, 300000, 300000]);
});
await ta('sync-core: decideRemote (tabella di verità)', () => {
  const rem = (ms, deleted = false) => ({ updated_at: toIso(ms), deleted });
  const loc = (ms) => ({ id: 'a', updatedAt: ms });
  assert.equal(decideRemote({ remote: rem(100) }), 'apply');
  assert.equal(decideRemote({ local: loc(100), remote: rem(200) }), 'apply');
  assert.equal(decideRemote({ local: loc(200), remote: rem(100) }), 'skip');
  assert.equal(decideRemote({ local: loc(100), remote: rem(100) }), 'skip');
  assert.equal(decideRemote({ local: loc(100), pending: { op: 'put', at: 300 }, remote: rem(200) }), 'skip');
  assert.equal(decideRemote({ local: loc(100), pending: { op: 'put', at: 150 }, remote: rem(200) }), 'apply');
  assert.equal(decideRemote({ remote: rem(100), pending: { op: 'del', at: 200 } }), 'skip');
  assert.equal(decideRemote({ remote: rem(300), pending: { op: 'del', at: 200 } }), 'apply');
  assert.equal(decideRemote({ local: loc(100), remote: rem(200, true) }), 'delete-local');
  assert.equal(decideRemote({ local: loc(200), remote: rem(200, true) }), 'delete-local');
  assert.equal(decideRemote({ local: loc(300), remote: rem(200, true) }), 'skip');
  assert.equal(decideRemote({ local: loc(100), pending: { op: 'put', at: 400 }, remote: rem(200, true) }), 'skip');
  assert.equal(decideRemote({ remote: rem(200, true) }), 'skip');
});
await ta('db.wrapWriteStores: stamp, outbox, coalescing, clear vietato, meta intatto', () => {
  const clock = { t: 1000 };
  const dev = makeDevice(clock);
  const metaMap = new Map();
  const m = { items: fakeOS(dev.data.items, 'id'), history: fakeOS(dev.data.history, 'id'), categories: fakeOS(dev.data.categories, 'id'), outbox: fakeOS(dev.outbox, 'tid'), meta: fakeOS(metaMap, 'key') };
  const w = wrapWriteStores(m, () => clock.t);
  const orig = { id: 'a', title: 'T' };
  w.items.put(orig);
  assert.equal(orig.updatedAt, undefined); // copia, non muta l'input
  assert.equal(dev.data.items.get('a').updatedAt, 1000);
  assert.deepEqual(dev.outbox.get('items:a'), { tid: 'items:a', store: 'items', id: 'a', op: 'put', at: 1000 });
  clock.t = 2000; w.items.delete('a');
  assert.deepEqual(dev.outbox.get('items:a'), { tid: 'items:a', store: 'items', id: 'a', op: 'del', at: 2000 });
  clock.t = 3000; w.items.put({ id: 'a', title: 'T2' });
  assert.equal(dev.outbox.get('items:a').op, 'put'); assert.equal(dev.outbox.get('items:a').at, 3000); assert.equal(dev.outbox.size, 1);
  w.history.put({ id: 'h' }); w.categories.put({ id: 'c' });
  assert.ok(dev.outbox.has('history:h') && dev.outbox.has('categories:c'));
  assert.throws(() => w.items.clear(), /clear/);
  w.meta.put({ key: 'theme', value: 'dark' });
  assert.deepEqual(metaMap.get('theme'), { key: 'theme', value: 'dark' });
  assert.equal(dev.outbox.size, 3); // meta non accoda
  assert.equal(w.meta, m.meta);
});

await ta('engine: senza sessione zero chiamate di rete e nessun throw', async () => {
  const remote = makeRemote(); const dev = makeDevice({ t: 1 });
  dev.tx((s) => s.items.put(itemRow()));
  const { engine, sessionRef } = makeEngine(dev, remote, { session: null });
  for (const op of ['fullSync', 'push', 'pull', 'uploadLocalData']) {
    const r = await engine[op]();
    assert.equal(r.ok, false); assert.equal(r.reason, 'no-session');
  }
  assert.equal(remote.calls.length, 0);
  assert.equal(engine.getStatus().state, 'guest');
  assert.equal((await engine.pendingCount()), 1); // la coda resta
  sessionRef.throws = true; // getSession che lancia = nessuna sessione
  assert.equal((await engine.fullSync()).reason, 'no-session');
  assert.equal(remote.calls.length, 0);
});
await ta('engine push: batch live/tombstone separati, chunk da 200, ordine tabelle', async () => {
  const remote = makeRemote(); const clock = { t: 5000 }; const dev = makeDevice(clock);
  dev.tx((s) => { s.categories.put({ id: 'casa', name: 'Casa' }); for (let i = 0; i < 450; i++) s.items.put(itemRow({ id: 'i' + i })); s.history.put({ id: 'h1', itemId: 'i0', doneOn: '2025-01-01' }); });
  clock.t = 6000; dev.tx((s) => { s.items.delete('i449'); s.items.delete('i448'); });
  const { engine, conn } = makeEngine(dev, remote, { nowRef: clock });
  const r = await engine.push();
  assert.equal(r.ok, true);
  const ups = remote.calls.filter((c) => c.op === 'upsert');
  assert.deepEqual(ups.map((c) => c.table), ['scadense_categories', 'scadense_items', 'scadense_items', 'scadense_items', 'scadense_items', 'scadense_history']);
  assert.deepEqual(ups.filter((c) => c.table === 'scadense_items').map((c) => c.rows.length), [200, 200, 48, 2]);
  assert.ok(ups.every((c) => c.opts.onConflict === 'user_id,id'));
  const tomb = ups.filter((c) => c.table === 'scadense_items').pop().rows;
  assert.ok(tomb.every((x) => x.deleted === true && x.user_id === UID && Object.keys(x).sort().join() === 'deleted,id,updated_at,user_id'));
  assert.ok(ups[1].rows.every((x) => x.deleted === false && x.user_id === UID));
  assert.equal(remote.rows('scadense_items').length, 450);
  assert.equal(dev.outbox.size, 0);
  assert.equal(conn.reach > 0, true);
  assert.equal(engine.getStatus().state, 'idle');
  const before = remote.calls.length;
  await engine.push(); // niente da inviare: nessuna chiamata
  assert.equal(remote.calls.length, before);
});
await ta('engine push: errore mantiene la coda, retry con backoff, voce cambiata durante il push resta', async () => {
  const remote = makeRemote(); const clock = { t: 5000 }; const dev = makeDevice(clock);
  dev.tx((s) => s.items.put(itemRow({ id: 'a' })));
  const { engine, tasks, conn } = makeEngine(dev, remote, { nowRef: clock });
  remote.failUpsert = { message: 'TypeError: Failed to fetch' };
  let r = await engine.push();
  assert.equal(r.ok, false); assert.equal(dev.outbox.size, 1);
  assert.equal(conn.unreach, 1); assert.equal(engine.getStatus().state, 'offline');
  assert.equal(tasks.length, 1); assert.equal(tasks[0].ms, 5000);
  r = await engine.push();
  assert.equal(tasks.filter((x) => !x.cancelled).length, 1); // un solo retry attivo
  assert.equal(tasks.at(-1).ms, 15000);
  remote.failUpsert = null;
  r = await engine.fullSync(); // successo: azzera il retry
  assert.equal(r.ok, true); assert.equal(dev.outbox.size, 0);
  assert.ok(tasks.every((x) => x.cancelled));
  // voce modificata durante il push non viene rimossa
  clock.t = 7000; dev.tx((s) => s.items.put(itemRow({ id: 'b' })));
  remote.hook = (nm) => { if (nm === 'scadense_items') { clock.t = 8000; dev.tx((s) => s.items.put(itemRow({ id: 'b', title: 'Nuovo' }))); remote.hook = null; } };
  await engine.push();
  assert.equal(dev.outbox.size, 1); assert.equal(dev.outbox.get('items:b').at, 8000);
  await engine.push();
  assert.equal(dev.outbox.size, 0);
  assert.equal(remote.rows('scadense_items').find((x) => x.id === 'b').title, 'Nuovo');
  // tabelle mancanti: stato errore con messaggio dedicato, nessun retry
  const tasksBefore = tasks.length;
  clock.t = 9000; dev.tx((s) => s.items.put(itemRow({ id: 'c' })));
  remote.failUpsert = { code: 'PGRST205', message: 'not found' };
  await engine.push();
  assert.equal(engine.getStatus().state, 'error'); assert.match(engine.getStatus().message, /supabase-scadense\.sql/);
  assert.equal(tasks.length, tasksBefore);
});
await ta('engine pull: paginazione 1000+, cursore avanzato una volta, non su errore', async () => {
  const remote = makeRemote(); const dev = makeDevice({ t: 1 });
  const base = Date.UTC(2025, 1, 1);
  const rows = [];
  for (let i = 0; i < 2500; i++) rows.push({ user_id: UID, id: 'r' + String(i).padStart(4, '0'), title: 'T' + i, due_date: '2025-06-01', updated_at: toIso(base + i), synced_at: toIso(base + i * 1000) });
  remote.seed('scadense_items', rows);
  remote.seed('scadense_items', [{ user_id: 'altro-utente', id: 'x', title: 'no', due_date: '2025-06-01', updated_at: toIso(base), synced_at: toIso(base) }]);
  const { engine, conn } = makeEngine(dev, remote);
  remote.failSelect = { message: 'TypeError: Failed to fetch' };
  let r = await engine.pull();
  assert.equal(r.ok, false); assert.equal(dev.meta.has(`sync.pull.${UID}.scadense_items`), false); assert.equal(dev.data.items.size, 0);
  remote.failSelect = null; remote.calls.length = 0;
  r = await engine.pull();
  assert.equal(r.ok, true); assert.equal(r.applied, 2500); assert.equal(dev.data.items.size, 2500);
  assert.deepEqual(remote.calls.filter((c) => c.table === 'scadense_items').map((c) => c.range), [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.equal(dev.meta.get(`sync.pull.${UID}.scadense_items`), toIso(base + 2499 * 1000));
  assert.equal(dev.outbox.size, 0); // applyRaw: nessun eco in outbox
  assert.equal(dev.data.items.get('r0001').updatedAt, base + 1); assert.equal(dev.data.items.get('r0001').autoPay, false);
  assert.ok(conn.reach > 0);
  remote.calls.length = 0;
  r = await engine.pull(); // cursore con gte: rilegge solo l'ultima riga, già uguale
  assert.equal(r.applied, 0); assert.equal(remote.calls.filter((c) => c.table === 'scadense_items' && c.op === 'select').length, 1);
  assert.equal(remote.calls.find((c) => c.table === 'scadense_items').gte, toIso(base + 2499 * 1000));
});
await ta('engine pull: tombstone remoti, modifica locale in coda più recente sopravvive', async () => {
  const remote = makeRemote(); const clock = { t: 10000 }; const dev = makeDevice(clock);
  dev.tx((s) => { s.items.put(itemRow({ id: 'del' })); s.items.put(itemRow({ id: 'keep' })); });
  await dev.store.outboxRemove([...dev.outbox.values()]); // come se fossero già inviate
  clock.t = 20000; dev.tx((s) => s.items.put(itemRow({ id: 'keep', title: 'Locale recente' })));
  remote.seed('scadense_items', [
    { user_id: UID, id: 'del', deleted: true, updated_at: toIso(15000), synced_at: toIso(1e12) },
    { user_id: UID, id: 'keep', deleted: true, updated_at: toIso(15000), synced_at: toIso(1e12 + 1000) },
  ]);
  const { engine } = makeEngine(dev, remote, { nowRef: clock });
  const r = await engine.pull();
  assert.equal(r.applied, 1);
  assert.equal(dev.data.items.has('del'), false);
  assert.equal(dev.data.items.get('keep').title, 'Locale recente');
  assert.equal(dev.outbox.size, 1); // la put pendente di 'keep' è ancora lì e risusciterà la riga
  await engine.push();
  const keep = remote.rows('scadense_items').find((x) => x.id === 'keep');
  assert.equal(keep.deleted, false); assert.equal(keep.title, 'Locale recente');
});
await ta('engine: primo accesso, baseline prima del pull; remoto vuoto non cancella; seconda volta no-op', async () => {
  const remote = makeRemote(); const clock = { t: 30000 }; const dev = makeDevice(clock);
  DEFAULT_CATEGORIES.forEach((c) => dev.data.categories.set(c.id, { ...c })); // seed grezzo, senza outbox
  dev.tx((s) => { s.items.put(itemRow({ id: 'a' })); s.items.put(itemRow({ id: 'b' })); s.history.put({ id: 'h', itemId: 'a', doneOn: '2025-01-01', dueWas: '2025-01-01', amount: null, note: '' }); });
  const { engine } = makeEngine(dev, remote, { nowRef: clock });
  const r = await engine.uploadLocalData();
  assert.equal(r.ok, true);
  assert.equal(dev.meta.get(`sync.migrated.${UID}`), 'done');
  const firstSelect = remote.calls.findIndex((c) => c.op === 'select');
  const lastUpsert = remote.calls.map((c) => c.op).lastIndexOf('upsert');
  assert.ok(lastUpsert < firstSelect, 'tutti gli upsert precedono il primo select');
  assert.equal(remote.rows('scadense_items').length, 2); assert.equal(remote.rows('scadense_history').length, 1); assert.equal(remote.rows('scadense_categories').length, DEFAULT_CATEGORIES.length);
  assert.equal(dev.data.items.size, 2); assert.equal(dev.outbox.size, 0);
  const n = remote.rows('scadense_items').length;
  const r2 = await engine.uploadLocalData(); // seconda esecuzione: stessi dati, nessun duplicato
  assert.equal(r2.ok, true); assert.equal(remote.rows('scadense_items').length, n); assert.equal(dev.data.items.size, 2);
  // percorso "Non ora": solo pull+push, dati locali preservati, niente baseline
  const dev2 = makeDevice(clock); dev2.tx((s) => s.items.put(itemRow({ id: 'solo-locale' })));
  await dev2.store.outboxRemove([...dev2.outbox.values()]);
  const remote2 = makeRemote();
  const e2 = makeEngine(dev2, remote2, { nowRef: clock }).engine;
  await e2.fullSync();
  assert.equal(dev2.data.items.has('solo-locale'), true); assert.equal(remote2.rows('scadense_items').length, 0);
  assert.equal(dev2.meta.has(`sync.migrated.${UID}`), false);
});
await ta('engine: cambio account svuota dati e outbox e ripristina le categorie', async () => {
  const remote = makeRemote(); const dev = makeDevice({ t: 40000 });
  dev.tx((s) => { s.items.put(itemRow({ id: 'a' })); s.history.put({ id: 'h' }); s.categories.put({ id: 'custom', name: 'C' }); });
  const { engine } = makeEngine(dev, remote);
  await engine.switchAccount('user-2');
  assert.equal(dev.data.items.size, 0); assert.equal(dev.data.history.size, 0); assert.equal(dev.outbox.size, 0);
  assert.deepEqual([...dev.data.categories.keys()].sort(), DEFAULT_CATEGORIES.map((c) => c.id).sort());
  assert.equal(dev.meta.get('sync.lastUser'), 'user-2');
  assert.equal(remote.calls.length, 0);
});
await ta('engine: start() debounce dopo scrittura locale', async () => {
  const remote = makeRemote(); const clock = { t: 50000 }; const dev = makeDevice(clock);
  const { engine, tasks } = makeEngine(dev, remote, { nowRef: clock });
  engine.start();
  dev.tx((s) => s.items.put(itemRow({ id: 'a' })));
  dev.tx((s) => s.items.put(itemRow({ id: 'b' })));
  const active = tasks.filter((x) => !x.cancelled);
  assert.equal(active.length, 1); assert.equal(active[0].ms, 1500);
  await active[0].fn();
  await engine.fullSync(); // serializza dopo il push innescato
  assert.equal(remote.rows('scadense_items').length, 2);
  engine.stop();
});

await ta('supabase.js: storageKey scadense-auth, isolamento, libreria assente', async () => {
  assert.equal(sbMod.AUTH_STORAGE_KEY, 'scadense-auth');
  assert.equal(typeof window, 'undefined'); // l'import non ha toccato window
  // libreria assente
  sbMod._resetClientForTests();
  assert.equal(sbMod.authAvailable(), false); assert.equal(sbMod.getClient(), null);
  const e = await sbMod.signIn('a@b.it', 'x');
  assert.equal(e.data, null); assert.match(e.error.message, /libreria non caricata/);
  assert.equal(await sbMod.getSession(), null);
  assert.match(sbMod.authErrorMessage(e.error), /libreria non caricata/);
  assert.doesNotThrow(() => sbMod.onAuthStateChange(() => {}).data.subscription.unsubscribe());
  // libreria presente (spia)
  const created = [];
  globalThis.window = { supabase: { createClient: (url, key, opts) => { created.push({ url, key, opts }); return { auth: { getSession: async () => ({ data: { session: sess() } }) } }; } } };
  try {
    sbMod._resetClientForTests();
    assert.equal(sbMod.authAvailable(), true);
    const c1 = sbMod.getClient(), c2 = sbMod.getClient();
    assert.equal(c1, c2); assert.equal(created.length, 1);
    assert.equal(created[0].opts.auth.storageKey, 'scadense-auth');
    assert.deepEqual([created[0].opts.auth.persistSession, created[0].opts.auth.autoRefreshToken, created[0].opts.auth.detectSessionInUrl], [true, true, true]);
    assert.equal(created[0].url, sbMod.SUPABASE_URL); assert.equal(created[0].key, sbMod.SUPABASE_ANON_KEY);
    const gymDefault = `sb-${new URL(sbMod.SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
    assert.notEqual(created[0].opts.auth.storageKey, gymDefault);
    assert.notEqual(created[0].opts.auth.storageKey, 'indispesabile-auth');
    assert.equal((await sbMod.getSession()).user.id, UID);
    // un metodo che lancia diventa un errore, non un'eccezione
    const r = await sbMod.signOut();
    assert.ok(r.error);
  } finally { delete globalThis.window; sbMod._resetClientForTests(); }
  assert.match(sbMod.authErrorMessage({ message: 'Invalid login credentials' }), /non corrette/);
  assert.match(sbMod.authErrorMessage({ message: 'TypeError: Failed to fetch' }), /Connessione assente/);
  // stesso progetto di GymBro (sola lettura del file sorella)
  try {
    const g = readFileSync(new URL('../../GymBro/js/supabase.js', import.meta.url), 'utf8');
    assert.equal(/SUPABASE_URL\s*=\s*'([^']+)'/.exec(g)[1], sbMod.SUPABASE_URL);
  } catch (err) { if (err.code !== 'ENOENT') throw err; }
});

await ta('ROLLOVER: due dispositivi convergono (una sola riga per id auto-<id>-<scadenza>), idempotente', async () => {
  const remote = makeRemote();
  const ca = { t: 1700000000000 }, cb = { t: 1700000000000 };
  const A = makeDevice(ca), B = makeDevice(cb);
  const ea = makeEngine(A, remote, { nowRef: ca }).engine, eb = makeEngine(B, remote, { nowRef: cb }).engine;
  const today = '2025-04-15';
  A.tx((s) => s.items.put({ id: 'x', title: 'Netflix', categoryId: 'abbonamenti', dueDate: '2025-01-31', recurrence: M1, amount: 10, autoPay: true, status: 'active', remindDays: 7, notes: '', reference: '', createdAt: ca.t }));
  await ea.fullSync(); await eb.fullSync();
  assert.equal(B.data.items.size, 1);
  const rollover = async (dev, clock) => {
    const plans = [...dev.data.items.values()].map((i) => planRollover(i, today)).filter(Boolean);
    if (plans.length) dev.tx((s) => plans.forEach((p) => { s.items.put(p.after); p.entries.forEach((e) => s.history.put(e)); }));
    return plans.length;
  };
  ca.t += 60000; cb.t += 90000; // B esegue il rollover dopo A
  assert.equal(await rollover(A), 1); assert.equal(await rollover(B), 1);
  await ea.fullSync(); await eb.fullSync(); await ea.fullSync(); await eb.fullSync();
  const hist = remote.rows('scadense_history');
  assert.deepEqual(hist.map((h) => h.id).sort(), ['auto-x-2025-01-31', 'auto-x-2025-02-28', 'auto-x-2025-03-28']);
  assert.equal(remote.rows('scadense_items').length, 1);
  assert.equal(remote.rows('scadense_items')[0].paid_count, 3); assert.equal(remote.rows('scadense_items')[0].due_date, '2025-04-28');
  const snap = (d) => JSON.stringify({ i: [...d.data.items.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), h: [...d.data.history.values()].sort((a, b) => (a.id < b.id ? -1 : 1)) });
  assert.equal(snap(A), snap(B));
  assert.equal(A.data.history.size, 3); assert.equal(A.data.items.get('x').paidCount, 3);
  assert.equal(A.outbox.size, 0); assert.equal(B.outbox.size, 0);
  // secondo giro: nulla di nuovo
  const upsertsBefore = remote.calls.filter((c) => c.op === 'upsert').length;
  assert.equal(await rollover(A), 0); assert.equal(await rollover(B), 0);
  await ea.fullSync(); await eb.fullSync();
  assert.equal(remote.calls.filter((c) => c.op === 'upsert').length, upsertsBefore);
  assert.equal(remote.rows('scadense_history').length, 3); assert.equal(snap(A), snap(B));
  assert.equal(A.outbox.size + B.outbox.size, 0);
});
console.log(`\n${n} gruppi di test superati`);
