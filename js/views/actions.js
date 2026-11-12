// Azioni condivise tra elenco, dettaglio e calendario.
import { h, modal, sheetHeader, field, toast, notifyChanged, confirmDialog, setError } from '../ui.js';
import { todayISO, formatShort, isValidISO } from '../dates.js';
import { markDone, undoDone, setDueDate, postponeTarget, setPaused, setCancelled, restoreItem } from '../model.js';
import { isRecurring, hasEnd, remainingCount } from '../recurrence.js';
import { transact, historyOf } from '../db.js';

export async function doneFlow(item) {
  const res = await modal((close) => {
    const date = h('input', { type: 'date', value: todayISO(), required: true });
    const amount = h('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', value: item.amount ?? '' });
    const note = h('input', { type: 'text', maxlength: '200' });
    const rec = isRecurring(item.recurrence);
    const form = h('form', { novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      if (!isValidISO(date.value)) { setError(date, 'Inserisci una data valida.'); return; }
      const a = amount.value === '' ? null : Number(amount.value);
      if (a !== null && !(a >= 0)) { setError(amount, 'Importo non valido.'); return; }
      close({ doneOn: date.value, amount: a, note: note.value.trim() });
    } },
      sheetHeader(hasEnd(item) ? 'Rata pagata' : rec ? 'Rinnovata' : 'Fatto', close),
      h('p', { class: 'muted' }, `${item.title}: ${hasEnd(item)
        ? (remainingCount(item) <= 1 ? 'ultima rata, la voce verrà conclusa.' : `rata registrata, ne restano ${remainingCount(item) - 1}.`)
        : rec ? 'verrà impostata la prossima scadenza.' : 'verrà spostata in archivio.'}`),
      field('Data in cui l\'hai fatto', date),
      field('Importo pagato (€)', amount),
      field('Nota (facoltativa)', note),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Annulla'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, 'Conferma')));
    return form;
  }, { label: 'Segna come fatto' });
  if (!res) return false;
  const r = await markDone(item, res);
  notifyChanged();
  const msg = r.after.closedReason === 'concluded'
    ? 'Ultima rata pagata: voce conclusa'
    : isRecurring(item.recurrence)
    ? `Rinnovata. Prossima scadenza: ${formatShort(r.after.dueDate)}`
    : 'Completata e spostata in archivio';
  toast(msg, { label: 'Annulla', fn: async () => { await undoDone(r); notifyChanged(); toast('Azione annullata'); } });
  return true;
}

export async function postponeFlow(item) {
  const choice = await modal((close) => {
    const date = h('input', { type: 'date', value: item.dueDate });
    const opt = (kind, label) => h('button', { type: 'button', class: 'btn', onclick: () => close({ date: postponeTarget(item, kind) }) }, label);
    return h('div', null,
      sheetHeader('Posticipa', close),
      h('p', { class: 'muted' }, `${item.title}: scadenza attuale ${formatShort(item.dueDate)}.`),
      h('div', { class: 'btn-grid' }, opt('day', '+1 giorno'), opt('week', '+1 settimana'), opt('month', '+1 mese')),
      h('form', { novalidate: true, onsubmit: (e) => {
        e.preventDefault();
        if (!isValidISO(date.value)) { setError(date, 'Inserisci una data valida.'); return; }
        close({ date: date.value });
      } },
        field('Oppure scegli una data', date),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Annulla'),
          h('button', { type: 'submit', class: 'btn btn-primary' }, 'Applica'))));
  }, { label: 'Posticipa' });
  if (!choice) return false;
  const r = await setDueDate(item, choice.date);
  notifyChanged();
  toast(`Posticipata al ${formatShort(choice.date)}`, {
    label: 'Annulla',
    fn: async () => { await transact(['items'], (s) => s.items.put(r.before)); notifyChanged(); toast('Azione annullata'); },
  });
  return true;
}

export async function deleteFlow(item) {
  const ok = await confirmDialog({
    title: 'Elimina scadenza', message: `Vuoi eliminare "${item.title}" e il suo storico?`, okLabel: 'Elimina', danger: true,
  });
  if (!ok) return false;
  const hist = await historyOf(item.id);
  await transact(['items', 'history'], (s) => {
    s.items.delete(item.id);
    hist.forEach((e) => s.history.delete(e.id));
  });
  notifyChanged();
  toast('Scadenza eliminata', {
    label: 'Annulla',
    fn: async () => {
      await transact(['items', 'history'], (s) => { s.items.put(item); hist.forEach((e) => s.history.put(e)); });
      notifyChanged();
      toast('Scadenza ripristinata');
    },
  });
  return true;
}

export async function restoreFlow(item) {
  await restoreItem(item);
  notifyChanged();
  toast('Scadenza riportata tra le attive');
}
const undoPatch = (r) => async () => { await transact(['items'], (s) => s.items.put(r.before)); notifyChanged(); toast('Azione annullata'); };
const dateModal = (label, intro, fieldLabel, okLabel, def, danger) => modal((close) => {
  const date = h('input', { type: 'date', value: def, required: true });
  return h('form', { novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    if (!isValidISO(date.value)) { setError(date, 'Inserisci una data valida.'); return; }
    close(date.value);
  } },
    sheetHeader(label, close),
    h('p', { class: 'muted' }, intro),
    field(fieldLabel, date),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Annulla'),
      h('button', { type: 'submit', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}` }, okLabel)));
}, { label });
// Pausa / ripresa di un abbonamento.
export async function pauseFlow(item) {
  if (!item.paused) {
    const ok = await confirmDialog({ title: 'Metti in pausa', message: `"${item.title}" non verrà più addebitata né conteggiata nei costi finché non la riprendi.`, okLabel: 'Metti in pausa' });
    if (!ok) return false;
    const r = await setPaused(item, true);
    notifyChanged();
    toast('Messa in pausa', { label: 'Annulla', fn: undoPatch(r) });
    return true;
  }
  const today = todayISO();
  const res = await dateModal('Riprendi', `${item.title}: scegli la data del prossimo addebito.`, 'Prossimo addebito', 'Riprendi', item.dueDate > today ? item.dueDate : today, false);
  if (!res) return false;
  const r = await setPaused(item, false, res);
  notifyChanged();
  toast('Ripresa', { label: 'Annulla', fn: undoPatch(r) });
  return true;
}
// Disdetta con data "attivo fino al" / riattivazione.
export async function cancelFlow(item) {
  if (item.cancelledOn) {
    const r = await setCancelled(item, null);
    notifyChanged();
    toast('Disdetta annullata', { label: 'Annulla', fn: undoPatch(r) });
    return true;
  }
  const today = todayISO();
  const res = await dateModal('Disdici', `${item.title}: dopo questa data non ci saranno più addebiti e la voce passerà in archivio come Disdetto. Lo storico resta.`, 'Attivo fino al', 'Disdici', item.dueDate > today ? item.dueDate : today, true);
  if (!res) return false;
  const r = await setCancelled(item, res);
  notifyChanged();
  toast(`Disdetta: attiva fino al ${formatShort(res)}`, { label: 'Annulla', fn: undoPatch(r) });
  return true;
}
