import { diffDays, todayISO, addDays, addMonths, formatShort } from './dates.js';
import { isRecurring, nextDue, isActiveSchedule, hasEnd, remainingCount, endFromCount, ITEM_END_LIMIT } from './recurrence.js';
import { transact, uuid, getAll, normalizeItem } from './db.js';

export const GROUPS = [
  { id: 'scadute', label: 'Scadute' },
  { id: 'settimana', label: 'Questa settimana' },
  { id: 'mese', label: 'Questo mese' },
  { id: 'dopo', label: 'Più avanti' },
];

export function daysLeft(item, today = todayISO()) {
  return diffDays(today, item.dueDate);
}

export const isLive = isActiveSchedule;
export function groupOf(item, today = todayISO()) {
  if (item.paused || item.cancelledOn) return 'dopo';
  let d = daysLeft(item, today);
  if (item.autoPay && d < 0) d = 0;
  if (d < 0) return 'scadute';
  if (d <= 7) return 'settimana';
  if (d <= 30) return 'mese';
  return 'dopo';
}

export function sortByUrgency(list) {
  return [...list].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.title.localeCompare(b.title, 'it')));
}

// Testo + tono del badge giorni rimanenti.
export function badgeOf(item, today = todayISO()) {
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
export async function markDone(item, { doneOn = todayISO(), amount = null, note = '' } = {}) {
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
export function planRollover(raw, today = todayISO()) {
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
export function runRollover(today = todayISO()) {
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
export async function undoDone({ before, entry }) {
  await transact(['items', 'history'], (s) => {
    s.items.put(before);
    s.history.delete(entry.id);
  });
}

export async function setDueDate(item, dueDate) {
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
export const setPaused = (item, paused, nextDate) => patchItem(item, paused ? { paused: true } : { paused: false, dueDate: nextDate || item.dueDate });
export const setCancelled = (item, dateOrNull) => patchItem(item, { cancelledOn: dateOrNull || null });
export const restoreItem = (item) => patchItem(item, { status: 'active', closedReason: null, cancelledOn: null });

export function postponeTarget(item, kind, today = todayISO()) {
  const base = item.dueDate > today ? item.dueDate : today;
  if (kind === 'day') return addDays(base, 1);
  if (kind === 'week') return addDays(base, 7);
  return addMonths(base, 1);
}

export const formatMoney = (n) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n || 0);

export { formatShort };
