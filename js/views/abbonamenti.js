import { h } from '../ui.js';
import { getAll, getCategories } from '../db.js';
import { formatShort } from '../dates.js';
import { formatMoney, badgeOf } from '../model.js';
import { annualCost, monthsOf } from '../recurrence.js';
import { TEMPLATES } from '../templates.js';
import { catChip } from './row.js';
import { openItemDetail } from './item-detail.js';
import { openItemForm } from './item-form.js';
const NEW_SUB = { autoPay: true, categoryId: 'abbonamenti', recurrence: { unit: 'month', every: 1 } };
// Vista Abbonamenti: voci con pagamento automatico, totali mensili/annuali e prossimo addebito.
export async function render(root) {
  const [items, cats] = await Promise.all([getAll('items'), getCategories()]);
  const catById = Object.fromEntries(cats.map((c) => [c.id, c]));
  const subs = items.filter((i) => i.autoPay);
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
      i.cancelledOn ? `Attivo fino al ${formatShort(i.cancelledOn)}` : archived ? null : `Prossimo addebito: ${formatShort(i.dueDate)}`,
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
      h('p', { class: 'muted' }, 'Aggiungi i pagamenti che partono da soli: Scadense registra gli addebiti e ti avvisa prima.'),
      h('div', { class: 'chips' }, TEMPLATES.filter((t) => t.autoPay).slice(0, 8).map((t) =>
        h('button', { type: 'button', class: 'chip', onclick: () => openItemForm({ prefill: { ...t, recurrence: { ...t.recurrence } } }) }, t.title))))
    : null;
  root.replaceChildren(...[
    h('h1', { class: 'page-title', tabindex: '-1' }, 'Abbonamenti'),
    h('div', { class: 'summary two' },
      h('div', { class: 'stat' }, h('strong', null, formatMoney(year / 12)), h('span', null, 'al mese')),
      h('div', { class: 'stat' }, h('strong', null, formatMoney(year)), h('span', null, 'all\'anno'))),
    next ? h('p', { class: 'muted' }, `Prossimo addebito: ${next.title}, ${formatShort(next.dueDate)}${next.amount > 0 ? ' · ' + formatMoney(next.amount) : ''}`) : null,
    empty,
    section('Attivi', active), section('In pausa', paused), section('Disdetti', cancelled),
    h('button', { type: 'button', class: 'fab', onclick: () => openItemForm({ prefill: { ...NEW_SUB, recurrence: { ...NEW_SUB.recurrence } } }) }, h('span', { 'aria-hidden': 'true' }, '＋'), ' Abbonamento'),
  ].filter(Boolean));
}
