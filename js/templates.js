import { h, modal, sheetHeader } from './ui.js';

const y = (every) => ({ unit: 'year', every });
const m = (every) => ({ unit: 'month', every });
const none = { unit: 'none', every: 0 };

export const TEMPLATES = [
  { title: 'Bollo auto', categoryId: 'veicoli', recurrence: y(1), remindDays: 30 },
  { title: 'Assicurazione RC auto', categoryId: 'veicoli', recurrence: y(1), remindDays: 30 },
  { title: 'Revisione auto', categoryId: 'veicoli', recurrence: y(2), remindDays: 45 },
  { title: 'Tagliando auto', categoryId: 'veicoli', recurrence: y(1), remindDays: 30 },
  { title: 'Carta d\'identità', categoryId: 'documenti', recurrence: none, remindDays: 90 },
  { title: 'Passaporto', categoryId: 'documenti', recurrence: none, remindDays: 90 },
  { title: 'Patente di guida', categoryId: 'documenti', recurrence: none, remindDays: 60 },
  { title: 'Bolletta luce', categoryId: 'casa', recurrence: m(2), remindDays: 7 },
  { title: 'Bolletta gas', categoryId: 'casa', recurrence: m(2), remindDays: 7 },
  { title: 'Canone TV', categoryId: 'casa', recurrence: y(1), remindDays: 15 },
  { title: 'Abbonamento streaming', categoryId: 'abbonamenti', recurrence: m(1), remindDays: 3, autoPay: true },
  { title: 'Rinnovo dominio o hosting', categoryId: 'abbonamenti', recurrence: y(1), remindDays: 30 },
  { title: 'Visita medica di controllo', categoryId: 'salute', recurrence: y(1), remindDays: 14 },
  { title: 'Visita dentista', categoryId: 'salute', recurrence: m(6), remindDays: 14 },
  { title: 'Dichiarazione dei redditi', categoryId: 'tasse', recurrence: y(1), remindDays: 30 },
  { title: 'Garanzia elettrodomestico', categoryId: 'garanzie', recurrence: none, remindDays: 30 },
  // Abbonamenti (categoria Abbonamenti) e rata finanziamento (altro), tutti con addebito automatico; nessun prezzo: lo inserisci tu.
  ...['Netflix', 'Spotify', 'Amazon Prime', 'Disney+', 'YouTube Premium', 'iCloud / Google One', 'Abbonamento palestra']
    .map((title) => ({ title, categoryId: 'abbonamenti', recurrence: m(1), remindDays: 3, autoPay: true })),
  { title: 'Software in abbonamento (es. Microsoft 365)', categoryId: 'abbonamenti', recurrence: y(1), remindDays: 7, autoPay: true },
  { title: 'Rata finanziamento', categoryId: 'altro', recurrence: m(1), remindDays: 3, autoPay: true },
];

// Mostra l'elenco dei modelli; ritorna il modello scelto o undefined.
export function pickTemplate() {
  return modal((close) => h('div', null,
    sheetHeader('Modelli rapidi', close),
    h('p', { class: 'muted' }, 'Scegli un modello: dovrai solo indicare la data.'),
    h('ul', { class: 'tpl-list' }, TEMPLATES.map((t) =>
      h('li', null, h('button', { type: 'button', class: 'tpl-btn', onclick: () => close(t) }, t.title))))),
  { label: 'Modelli rapidi' });
}
