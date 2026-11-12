import { h } from '../ui.js';
import { formatShort } from '../dates.js';
import { badgeOf, formatMoney } from '../model.js';
import { hasEnd, remainingCount } from '../recurrence.js';
import { openItemDetail } from './item-detail.js';
import { doneFlow } from './actions.js';
export function catChip(cat) {
  const c = cat || { emoji: '📌', color: '#64748b' };
  return h('span', { class: 'cat-dot', style: `--c:${c.color}`, 'aria-hidden': 'true' }, c.emoji);
}
export function itemRow(item, cat) {
  const b = badgeOf(item);
  const archived = item.status === 'archived';
  const archLabel = item.closedReason === 'concluded' ? 'Concluso' : item.closedReason === 'cancelled' ? 'Disdetto' : 'Archivio';
  const sub = [
    cat ? cat.name : 'Altro',
    item.autoPay ? ['🔁', item.payMethod].filter(Boolean).join(' ') : null,
    formatShort(item.dueDate),
    item.amount > 0 ? formatMoney(item.amount) : null,
    !archived && hasEnd(item) ? `${remainingCount(item)} rate rimanenti` : null,
  ].filter(Boolean).join(' · ');
  return h('li', { class: 'row' },
    h('button', { type: 'button', class: 'row-main', onclick: () => openItemDetail(item.id) },
      catChip(cat),
      h('span', { class: 'row-text' },
        archived
          ? h('span', { class: 'badge badge-far' }, archLabel)
          : h('span', { class: `badge badge-${b.tone}` }, h('span', { 'aria-hidden': 'true' }, b.icon + ' '), b.text),
        h('span', { class: 'row-title' }, item.title),
        h('span', { class: 'row-sub' }, sub))),
    archived || item.autoPay || item.paused ? null : h('button', {
      type: 'button', class: 'row-done', 'aria-label': `Segna come fatto: ${item.title}`, title: 'Fatto',
      onclick: () => doneFlow(item),
    }, '✓'));
}
