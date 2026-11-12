import { isValidISO } from './dates.js';
import { getAll, getMeta, transact, DEFAULT_CATEGORIES } from './db.js';
import { getPref } from './theme.js';

export const SCHEMA_VERSION = 2;

export async function buildBackup() {
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
export function validateBackup(raw) {
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
export async function applyBackup(data, mode) {
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
