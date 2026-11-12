import { h } from '../ui.js';
import { getAll, getCategories, getMeta, setMeta } from '../db.js';
import { todayISO, diffDays } from '../dates.js';
import { GROUPS, groupOf, sortByUrgency, isLive } from '../model.js';
import { dueForReminder, summaryText } from '../reminders.js';
import { TEMPLATES } from '../templates.js';
import { itemRow } from './row.js';
import { openItemForm } from './item-form.js';

// Stato dei filtri (persiste tra le schermate).
export const filters = { q: '', cat: '', status: 'active', auto: false };

export async function render(root) {
  const [items, cats, dismissed] = await Promise.all([getAll('items'), getCategories(), getMeta('bannerDismissed', '')]);
  const today = todayISO();
  const catById = Object.fromEntries(cats.map((c) => [c.id, c]));
  const active = items.filter((i) => i.status === 'active');
  const live = active.filter(isLive);
  const overdue = live.filter((i) => !i.autoPay && diffDays(today, i.dueDate) < 0).length;
  const soon = live.filter((i) => { const d = diffDays(today, i.dueDate); return d >= 0 && d <= 30; }).length;

  const head = h('h1', { class: 'page-title', tabindex: '-1' }, 'Prossime scadenze');
  const summary = h('div', { class: 'summary', role: 'group', 'aria-label': 'Riepilogo' },
    h('div', { class: `stat ${overdue ? 'stat-late' : ''}` }, h('strong', null, overdue), h('span', null, overdue === 1 ? 'scaduta' : 'scadute')),
    h('div', { class: 'stat' }, h('strong', null, soon), h('span', null, 'entro 30 giorni')),
    h('div', { class: 'stat' }, h('strong', null, active.length), h('span', null, 'attive')));

  const due = dueForReminder(items, today);
  let banner = null;
  if (due.length && dismissed !== today) {
    banner = h('div', { class: 'banner', role: 'status' },
      h('span', null, '🔔 ', h('strong', null, summaryText(due.length)), ': ', due.slice(0, 2).map((i) => i.title).join(', '), due.length > 2 ? '…' : ''),
      h('button', { type: 'button', class: 'btn btn-small', onclick: async () => { await setMeta('bannerDismissed', today); banner.remove(); } }, 'Nascondi'));
  }

  const q = h('input', { type: 'search', id: 'f-q', placeholder: 'Cerca…', value: filters.q, autocomplete: 'off', enterkeyhint: 'search' });
  const cat = h('select', { id: 'f-cat', 'aria-label': 'Filtra per categoria' },
    h('option', { value: '' }, 'Tutte le categorie'),
    cats.map((c) => h('option', { value: c.id, selected: c.id === filters.cat }, `${c.emoji} ${c.name}`)));
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Stato' },
    ['active', 'archived'].map((s) => h('button', {
      type: 'button', class: 'seg-btn', 'aria-pressed': String(filters.status === s),
      onclick: () => { filters.status = s; render(root); },
    }, s === 'active' ? 'Attive' : 'Archivio')));

  const autoBtn = h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(filters.auto),
    onclick: () => { filters.auto = !filters.auto; autoBtn.setAttribute('aria-pressed', String(filters.auto)); paint(); },
  }, '🔁 Automatici');
  const list = h('div', { id: 'list' });
  const paint = () => {
    filters.q = q.value; filters.cat = cat.value;
    const needle = q.value.trim().toLowerCase();
    let sel = items.filter((i) => i.status === filters.status);
    if (filters.cat) sel = sel.filter((i) => i.categoryId === filters.cat);
    if (filters.auto) sel = sel.filter((i) => i.autoPay);
    if (needle) sel = sel.filter((i) => [i.title, i.notes, i.reference].join(' ').toLowerCase().includes(needle));
    list.replaceChildren();
    if (!sel.length) {
      list.append(emptyState(items.length === 0, filters.status === 'archived' || needle || filters.cat || filters.auto, () => openItemForm()));
      return;
    }
    if (filters.status === 'archived') {
      sel.sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
      list.append(h('ul', { class: 'list' }, sel.map((i) => itemRow(i, catById[i.categoryId]))));
      return;
    }
    sel = sortByUrgency(sel);
    for (const g of GROUPS) {
      const part = sel.filter((i) => groupOf(i, today) === g.id);
      if (!part.length) continue;
      list.append(h('section', { class: 'group' },
        h('h2', { class: `group-title ${g.id === 'scadute' ? 'late' : ''}` }, g.label, h('span', { class: 'count' }, part.length)),
        h('ul', { class: 'list' }, part.map((i) => itemRow(i, catById[i.categoryId])))));
    }
  };
  q.addEventListener('input', paint);
  cat.addEventListener('change', paint);
  paint();

  const fab = h('button', { type: 'button', class: 'fab', onclick: () => openItemForm() }, h('span', { 'aria-hidden': 'true' }, '＋'), ' Nuova');
  root.replaceChildren(...[head, banner, summary,
    h('div', { class: 'filters' }, h('label', { for: 'f-q', class: 'sr-only' }, 'Cerca'), q, cat), seg, h('div', { class: 'chips start' }, autoBtn), list, fab].filter(Boolean));
}

function emptyState(noData, filtered, onNew) {
  if (noData) {
    return h('div', { class: 'empty' },
      h('div', { class: 'empty-art', 'aria-hidden': 'true' }, '🗓️'),
      h('h2', null, 'Nessuna scadenza, per ora'),
      h('p', { class: 'muted' }, 'Parti da un modello oppure creane una da zero.'),
      h('div', { class: 'chips' }, TEMPLATES.slice(0, 8).map((t) =>
        h('button', { type: 'button', class: 'chip', onclick: () => openItemForm({ prefill: { ...t, recurrence: { ...t.recurrence } } }) }, t.title))),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: onNew }, 'Crea da zero'));
  }
  return h('div', { class: 'empty' },
    h('h2', null, filtered ? 'Nessun risultato' : 'Tutto in ordine'),
    h('p', { class: 'muted' }, filtered ? 'Prova a cambiare ricerca o filtri.' : 'Non ci sono scadenze attive.'));
}
