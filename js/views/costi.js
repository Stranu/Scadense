import { h } from '../ui.js';
import { getAll, getCategories } from '../db.js';
import { todayISO, addMonths, monthKey, MONTHS, formatShort } from '../dates.js';
import { annualCost, isRecurring, occurrences, hasEnd, progress, remainingTotal, lastOccurrence } from '../recurrence.js';
import { formatMoney, isLive } from '../model.js';

export async function render(root) {
  const [items, cats] = await Promise.all([getAll('items'), getCategories()]);
  const active = items.filter(isLive);
  const rec = active.filter((i) => isRecurring(i.recurrence) && i.amount > 0);
  const annual = rec.reduce((s, i) => s + annualCost(i), 0);

  const byCat = cats.map((c) => ({ c, v: rec.filter((i) => i.categoryId === c.id).reduce((s, i) => s + annualCost(i), 0) }))
    .filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
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
      h('h2', { class: 'section-title' }, 'Per categoria (annuo)'),
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
