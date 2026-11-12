import { addMonths, addDays, todayISO } from './dates.js';
export const ITEM_END_LIMIT = 600;

export const PRESETS = [
  { id: 'none', label: 'Nessuna', unit: 'none', every: 0 },
  { id: 'm1', label: 'Ogni mese', unit: 'month', every: 1 },
  { id: 'm3', label: 'Ogni trimestre', unit: 'month', every: 3 },
  { id: 'm6', label: 'Ogni semestre', unit: 'month', every: 6 },
  { id: 'y1', label: 'Ogni anno', unit: 'year', every: 1 },
  { id: 'y2', label: 'Ogni 2 anni', unit: 'year', every: 2 },
];

export function monthsOf(rec) {
  if (!rec || (rec.unit !== 'month' && rec.unit !== 'year')) return 0;
  const n = Math.floor(Number(rec.every));
  if (!(n > 0)) return 0;
  return rec.unit === 'year' ? n * 12 : n;
}

export const isRecurring = (rec) => monthsOf(rec) > 0;

export function presetIdOf(rec) {
  if (!isRecurring(rec)) return 'none';
  const p = PRESETS.find((x) => x.unit === rec.unit && x.every === rec.every);
  return p ? p.id : 'custom';
}

export function describeRecurrence(rec) {
  if (!isRecurring(rec)) return 'Non ricorrente';
  const p = PRESETS.find((x) => x.unit === rec.unit && x.every === rec.every);
  if (p) return p.label;
  const n = rec.every;
  if (rec.unit === 'year') return n === 1 ? 'Ogni anno' : `Ogni ${n} anni`;
  return n === 1 ? 'Ogni mese' : `Ogni ${n} mesi`;
}

// Prossima scadenza dopo `dueISO`. Se `fromISO` è dato, salta le date precedenti.
// Se `endISO` è dato e la prossima data lo supera ritorna null (serie conclusa).
export function nextDue(dueISO, rec, fromISO, endISO) {
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
export const hasEnd = (item) => !!(item && item.endDate && isRecurring(item.recurrence));
// Voce attiva, non in pausa e non disdetta: genera scadenze, costi e promemoria.
export const isActiveSchedule = (item) => item.status === 'active' && !item.paused && !item.cancelledOn;
// Date da `dueISO` a `endISO` (inclusa) secondo la ricorrenza.
export function occurrenceDates(dueISO, rec, endISO, limit = ITEM_END_LIMIT) {
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
export const countOccurrences = (dueISO, rec, endISO) => occurrenceDates(dueISO, rec, endISO).length;
// Data dell'ultima rata dato il numero di rate (la prima è `dueISO`).
export function endFromCount(dueISO, rec, n) {
  return addMonths(dueISO, monthsOf(rec) * (Math.max(1, n) - 1));
}
export function remainingCount(item) {
  if (!hasEnd(item)) return null;
  return countOccurrences(item.dueDate, item.recurrence, item.endDate);
}
export function lastOccurrence(item) {
  if (!hasEnd(item)) return null;
  const l = occurrenceDates(item.dueDate, item.recurrence, item.endDate);
  return l.length ? l[l.length - 1] : item.dueDate;
}
export function remainingTotal(item) {
  const r = remainingCount(item);
  if (r === null || !(item.amount > 0)) return null;
  return r * item.amount;
}
// Rate già pagate / totali / percentuale (solo voci a termine).
export function progress(item) {
  const r = remainingCount(item);
  if (r === null) return null;
  const paid = Math.max(0, Math.floor(item.paidCount || 0));
  const total = paid + r;
  return { paid, total, remaining: r, pct: total ? Math.round((paid / total) * 100) : 0 };
}
// Costo annuo stimato (solo voci ricorrenti con importo, attive).
// Con data di fine: somma delle rate nei 12 mesi da `fromISO`.
export function annualCost(item, fromISO = todayISO()) {
  const m = monthsOf(item.recurrence);
  if (!m || !(item.amount > 0) || item.paused || item.cancelledOn) return 0;
  if (!item.endDate) return (item.amount * 12) / m;
  return occurrences(item, fromISO, addDays(addMonths(fromISO, 12), -1)).length * item.amount;
}
// Date delle occorrenze in [startISO, endISO]; le scadute contano come "oggi".
export function occurrences(item, startISO, endISO) {
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