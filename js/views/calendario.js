import { h } from '../ui.js';
import { getAll, getCategories } from '../db.js';
import { todayISO, toISO, monthLabel, formatLong, pad } from '../dates.js';
import { sortByUrgency, isLive } from '../model.js';
import { itemRow } from './row.js';

const now = new Date();
let view = { y: now.getFullYear(), m: now.getMonth() };
let selected = todayISO();
const WEEK = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

export async function render(root) {
  const [items, cats] = await Promise.all([getAll('items'), getCategories()]);
  const catById = Object.fromEntries(cats.map((c) => [c.id, c]));
  const active = items.filter(isLive);
  const byDay = {};
  active.forEach((i) => { (byDay[i.dueDate] ||= []).push(i); });
  const today = todayISO();

  const shift = (n) => {
    const d = new Date(view.y, view.m + n, 1);
    view = { y: d.getFullYear(), m: d.getMonth() };
    render(root);
  };
  const nav = h('div', { class: 'cal-nav' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mese precedente', onclick: () => shift(-1) }, '‹'),
    h('h1', { class: 'cal-title', tabindex: '-1', 'aria-live': 'polite' }, monthLabel(view.y, view.m)),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mese successivo', onclick: () => shift(1) }, '›'));

  const first = new Date(view.y, view.m, 1, 12);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(h('div', { class: 'cal-cell empty', 'aria-hidden': 'true' }));
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${view.y}-${pad(view.m + 1)}-${pad(d)}`;
    const list = byDay[iso] || [];
    const late = list.length && iso < today;
    const dots = list.slice(0, 3).map((i) => h('i', { class: `dot${i.autoPay ? ' dot-auto' : ''}`, style: `--c:${(catById[i.categoryId] || {}).color || '#64748b'}` }));
    cells.push(h('button', {
      type: 'button',
      class: `cal-cell day${iso === today ? ' today' : ''}${iso === selected ? ' sel' : ''}${late ? ' late' : ''}`,
      'aria-pressed': String(iso === selected),
      'aria-label': `${formatLong(iso)}${list.length ? `, ${list.length} ${list.length === 1 ? 'scadenza' : 'scadenze'}` : ''}`,
      onclick: () => { selected = iso; render(root); },
    }, h('span', { class: 'num' }, d), h('span', { class: 'dots', 'aria-hidden': 'true' }, dots, list.length > 3 ? h('b', null, '+') : null)));
  }

  const dayList = byDay[selected] ? sortByUrgency(byDay[selected]) : [];
  const detail = h('section', { class: 'group', 'aria-live': 'polite' },
    h('h2', { class: 'group-title' }, formatLong(selected)),
    dayList.length
      ? h('ul', { class: 'list' }, dayList.map((i) => itemRow(i, catById[i.categoryId])))
      : h('p', { class: 'muted' }, 'Nessuna scadenza in questo giorno.'));

  root.replaceChildren(nav,
    h('div', { class: 'cal', role: 'group', 'aria-label': 'Calendario' },
      WEEK.map((w) => h('div', { class: 'cal-wd', 'aria-hidden': 'true' }, w)), cells),
    h('div', { class: 'btn-row start' },
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => { const t = new Date(); view = { y: t.getFullYear(), m: t.getMonth() }; selected = todayISO(); render(root); } }, 'Vai a oggi')),
    detail);
}
