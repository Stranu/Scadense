import { h, modal, sheetHeader, downloadFile } from '../ui.js';
import { formatLong, formatShort } from '../dates.js';
import { get, getCategories, historyOf } from '../db.js';
import { badgeOf, formatMoney } from '../model.js';
import { describeRecurrence, hasEnd, progress, lastOccurrence, remainingTotal } from '../recurrence.js';
import { buildICS } from '../ics.js';
import { openItemForm } from './item-form.js';
import { doneFlow, postponeFlow, deleteFlow, restoreFlow, pauseFlow, cancelFlow } from './actions.js';
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scadenza';
export async function openItemDetail(id) {
  const item = await get('items', id);
  if (!item) return;
  const [cats, hist] = await Promise.all([getCategories(), historyOf(id)]);
  const cat = cats.find((c) => c.id === item.categoryId);
  const archived = item.status === 'archived';
  const archLabel = item.closedReason === 'concluded' ? 'Concluso' : item.closedReason === 'cancelled' ? 'Disdetto' : 'Archivio';
  const b = badgeOf(item);
  const pr = hasEnd(item) ? progress(item) : null;
  const residual = remainingTotal(item);
  const act = await modal((close) => {
    const dl = (k, v) => (v ? [h('dt', null, k), h('dd', null, v)] : null);
    const btn = (label, cls, key) => h('button', { type: 'button', class: `btn ${cls}`, onclick: () => close(key) }, label);
    const live = !archived;
    const doneBtn = live && !item.autoPay && !item.paused ? btn(hasEnd(item) ? '✓ Rata pagata' : '✓ Fatto / Rinnovato', 'btn-primary', 'done') : null;
    return h('div', null,
      sheetHeader(item.title, close),
      h('div', { class: 'detail-top' },
        h('span', { class: 'cat-pill', style: `--c:${cat ? cat.color : '#64748b'}` }, `${cat ? cat.emoji : '📌'} ${cat ? cat.name : 'Altro'}`),
        item.autoPay ? h('span', { class: 'auto-pill' }, `🔁 Automatico${item.payMethod ? ' · ' + item.payMethod : ''}`) : null,
        archived ? h('span', { class: 'badge badge-far' }, archLabel) : h('span', { class: `badge badge-${b.tone}` }, h('span', { 'aria-hidden': 'true' }, b.icon + ' '), b.text)),
      h('dl', { class: 'detail' },
        dl(archived && hasEnd(item) ? 'Ultima rata' : 'Scadenza', formatLong(item.dueDate)),
        dl('Ricorrenza', describeRecurrence(item.recurrence)),
        dl('Importo', item.amount > 0 ? formatMoney(item.amount) : ''),
        dl('Fine', hasEnd(item) ? formatLong(item.endDate) : ''),
        dl('Rate', pr ? `rate rimanenti: ${archived ? 0 : pr.remaining}${residual !== null && !archived ? ` · residuo: ${formatMoney(residual)}` : ''}` : ''),
        dl('Estinzione prevista', pr ? formatLong(lastOccurrence(item)) : ''),
        dl('Disdetta', item.cancelledOn ? `attivo fino al ${formatShort(item.cancelledOn)}` : ''),
        dl('Preavviso', `${item.remindDays} giorni prima`),
        dl('Riferimento', item.reference),
        dl('Note', item.notes)),
      pr ? h('div', { class: 'progress-wrap' },
        h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Avanzamento rate', 'aria-valuemin': '0', 'aria-valuemax': String(pr.total), 'aria-valuenow': String(archived ? pr.total : pr.paid) },
          h('div', { class: 'progress-fill', style: `width:${archived ? 100 : pr.pct}%` })),
        h('small', { class: 'muted' }, archived ? `${pr.total} rate su ${pr.total}` : `${pr.paid} pagate su ${pr.total}${pr.remaining ? ` · prossima: rata ${pr.paid + 1} di ${pr.total}` : ''}`)) : null,
      h('div', { class: 'btn-grid' },
        archived ? btn('Ripristina', 'btn-primary', 'restore') : doneBtn,
        live && item.autoPay ? btn(item.paused ? 'Riprendi' : 'Metti in pausa', item.paused ? 'btn-primary' : '', 'pause') : null,
        live && item.autoPay ? btn(item.cancelledOn ? 'Riattiva' : 'Disdici', '', 'cancel') : null,
        live ? btn('Posticipa', '', 'postpone') : null,
        btn('Modifica', '', 'edit'),
        btn('Aggiungi al calendario (.ics)', '', 'ics'),
        btn('Elimina', 'btn-danger-ghost', 'delete')),
      h('h3', { class: 'section-title' }, 'Cronologia'),
      hist.length
        ? h('ul', { class: 'history' }, hist.map((e) => h('li', null,
          h('span', null, `${e.auto ? 'Addebitato' : 'Fatto'} il ${formatShort(e.doneOn)}`),
          h('span', { class: 'muted' }, `scadenza ${formatShort(e.dueWas)}${e.amount != null ? ' · ' + formatMoney(e.amount) : ''}`))))
        : h('p', { class: 'muted' }, 'Nessun rinnovo registrato.'));
  }, { label: item.title });
  if (act === 'done') await doneFlow(item);
  else if (act === 'postpone') await postponeFlow(item);
  else if (act === 'pause') await pauseFlow(item);
  else if (act === 'cancel') await cancelFlow(item);
  else if (act === 'edit') await openItemForm({ item });
  else if (act === 'delete') await deleteFlow(item);
  else if (act === 'restore') await restoreFlow(item);
  else if (act === 'ics') downloadFile(`scadense-${slug(item.title)}.ics`, buildICS([item], cats), 'text/calendar');
}
