import { addDays, parseISO } from './dates.js';
import { monthsOf, remainingCount, lastOccurrence } from './recurrence.js';

const compact = (iso) => iso.replace(/-/g, '');

export function icsEscape(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Piega le righe a 75 caratteri (continuazione con spazio).
export function fold(line) {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(' ' + line.slice(i, i + 74));
  return parts.join('\r\n');
}

function stamp(now) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}T${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`;
}

export function buildICS(items, categories = [], now = new Date()) {
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
