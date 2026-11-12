// Date come stringhe locali 'YYYY-MM-DD'; calcoli con Date a mezzogiorno locale.
export const pad = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(y, mo - 1, d, 12);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

export const isValidISO = (s) => typeof s === 'string' && parseISO(s) !== null;
export const todayISO = () => toISO(new Date());

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

// Somma mesi con clamp a fine mese (31 gen + 1 mese = 28/29 feb).
export function addMonths(iso, n) {
  const d = parseISO(iso);
  const day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1, 12);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0, 12).getDate();
  t.setDate(Math.min(day, last));
  return toISO(t);
}

// Giorni da a verso b (b - a).
export function diffDays(a, b) {
  const A = parseISO(a), B = parseISO(b);
  const ua = Date.UTC(A.getFullYear(), A.getMonth(), A.getDate());
  const ub = Date.UTC(B.getFullYear(), B.getMonth(), B.getDate());
  return Math.round((ub - ua) / 86400000);
}

export const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const DAYS_SHORT = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const DAYS_LONG = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

export function formatShort(iso) {
  const d = parseISO(iso);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatLong(iso) {
  const d = parseISO(iso);
  return `${DAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].toLowerCase()} ${d.getFullYear()}`;
}

export function formatDayShort(iso) {
  const d = parseISO(iso);
  return `${DAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

export const monthLabel = (y, m) => `${MONTHS[m]} ${y}`;
export const monthKey = (iso) => iso.slice(0, 7);
