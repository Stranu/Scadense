import { h, modal, sheetHeader, field, setError, toast, notifyChanged } from '../ui.js';
import { isValidISO } from '../dates.js';
import { getCategories, put, uuid } from '../db.js';
import { PRESETS, presetIdOf, isRecurring, countOccurrences, endFromCount, remainingCount, ITEM_END_LIMIT } from '../recurrence.js';
import { pickTemplate } from '../templates.js';
// item: voce da modificare | null; prefill: valori iniziali per una nuova voce.
export async function openItemForm({ item = null, prefill = {} } = {}) {
  const cats = await getCategories();
  const base = item || { title: '', categoryId: cats[0]?.id, dueDate: '', recurrence: { unit: 'none', every: 0 }, amount: null, remindDays: null, notes: '', reference: '', autoPay: false, payMethod: '', endDate: null, paidCount: 0, ...prefill };
  const catById = (id) => cats.find((c) => c.id === id);
  const startCat = catById(base.categoryId) ? base.categoryId : (cats.find((c) => c.id === 'altro') || cats[0]).id;
  return modal((close) => {
    let remindTouched = !!item || base.remindDays != null;
    const title = h('input', { type: 'text', maxlength: '120', autocomplete: 'off', value: base.title });
    const category = h('select', null, cats.map((c) => h('option', { value: c.id, selected: c.id === startCat }, `${c.emoji} ${c.name}`)));
    const date = h('input', { type: 'date', value: base.dueDate });
    const preset = presetIdOf(base.recurrence);
    const rec = h('select', null,
      PRESETS.map((p) => h('option', { value: p.id, selected: p.id === preset }, p.label)),
      h('option', { value: 'custom', selected: preset === 'custom' }, 'Personalizzata…'));
    const every = h('input', { type: 'number', min: '1', max: '120', inputmode: 'numeric', 'aria-label': 'Intervallo personalizzato', value: isRecurring(base.recurrence) ? base.recurrence.every : 1 });
    const unit = h('select', { 'aria-label': 'Unità di tempo' },
      h('option', { value: 'month', selected: base.recurrence.unit !== 'year' }, 'mesi'),
      h('option', { value: 'year', selected: base.recurrence.unit === 'year' }, 'anni'));
    const customRow = h('div', { class: 'inline-row', hidden: preset !== 'custom' },
      h('span', null, 'Ogni'), every, unit);
    const amount = h('input', { type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: base.amount ?? '' });
    const initRemind = base.remindDays ?? catById(startCat)?.defaultRemind ?? 7;
    const remind = h('input', { type: 'number', min: '0', max: '365', inputmode: 'numeric', value: initRemind });
    const reference = h('input', { type: 'text', maxlength: '200', value: base.reference || '' });
    const notes = h('textarea', { rows: '3', maxlength: '4000' }, base.notes || '');
    // Pagamento automatico + metodo.
    const autoPay = h('input', { type: 'checkbox', checked: !!base.autoPay });
    const payMethod = h('input', { type: 'text', maxlength: '60', autocomplete: 'off', value: base.payMethod || '' });
    const methodField = field('Metodo di pagamento (carta, conto, PayPal…)', payMethod);
    methodField.hidden = !base.autoPay;
    autoPay.addEventListener('change', () => { methodField.hidden = !autoPay.checked; });
    const autoRow = h('label', { class: 'check' }, autoPay,
      h('span', null, h('strong', null, 'Pagamento automatico'), h('small', { class: 'hint' }, 'Scadense registra l\'addebito alla data e passa alla successiva.')));
    // Fine della serie: data di fine e numero di rate sono collegati (vale l'ultimo campo modificato).
    const endDate = h('input', { type: 'date', value: base.endDate || '' });
    const initRem = item && base.endDate ? remainingCount(base) : null;
    const count = h('input', { type: 'number', min: '1', max: String(ITEM_END_LIMIT), inputmode: 'numeric', value: initRem ?? '' });
    const paid = h('input', { type: 'number', min: '0', inputmode: 'numeric', value: base.paidCount || 0 });
    let source = base.endDate ? 'date' : null;
    const curRec = () => {
      if (rec.value === 'custom') {
        const n = Math.floor(Number(every.value));
        return n >= 1 && n <= 120 ? { unit: unit.value, every: n } : null;
      }
      const p = PRESETS.find((x) => x.id === rec.value);
      return p && p.unit !== 'none' ? { unit: p.unit, every: p.every } : null;
    };
    const syncEnd = () => {
      const r = curRec();
      if (!r || !isValidISO(date.value)) return;
      if (source === 'count') {
        const n = Math.floor(Number(count.value));
        if (n >= 1 && n <= ITEM_END_LIMIT) endDate.value = endFromCount(date.value, r, n);
      } else if (source === 'date') {
        if (isValidISO(endDate.value)) { const n = countOccurrences(date.value, r, endDate.value); count.value = n > 0 ? n : ''; }
        else count.value = '';
      }
    };
    endDate.addEventListener('input', () => { source = endDate.value ? 'date' : null; if (!endDate.value) count.value = ''; syncEnd(); });
    count.addEventListener('input', () => { source = count.value !== '' ? 'count' : null; if (count.value === '') endDate.value = ''; syncEnd(); });
    const endBox = h('div', { class: 'end-box' },
      h('p', { class: 'hint' }, 'Per finanziamenti e rate: indica la data dell\'ultimo pagamento oppure quante rate mancano.'),
      field('Data di fine (facoltativa)', endDate),
      field('Rate rimanenti (da questa scadenza)', count),
      field('Rate già pagate', paid));
    const toggleEnd = () => {
      endBox.hidden = rec.value === 'none';
      if (endBox.hidden) { endDate.value = ''; count.value = ''; source = null; }
    };
    toggleEnd();
    date.addEventListener('input', syncEnd);
    every.addEventListener('input', syncEnd);
    unit.addEventListener('change', syncEnd);
    rec.addEventListener('change', () => { customRow.hidden = rec.value !== 'custom'; toggleEnd(); syncEnd(); });
    remind.addEventListener('input', () => { remindTouched = true; });
    category.addEventListener('change', () => {
      if (!remindTouched) remind.value = catById(category.value)?.defaultRemind ?? 7;
    });
    const tplBtn = item ? null : h('button', {
      type: 'button', class: 'btn btn-ghost',
      onclick: async () => {
        const t = await pickTemplate();
        if (!t) return;
        title.value = t.title;
        if (catById(t.categoryId)) category.value = t.categoryId;
        const p = PRESETS.find((x) => x.unit === t.recurrence.unit && x.every === t.recurrence.every);
        rec.value = p ? p.id : 'none';
        customRow.hidden = true;
        toggleEnd();
        remind.value = t.remindDays;
        autoPay.checked = !!t.autoPay;
        methodField.hidden = !autoPay.checked;
        remindTouched = true;
        date.focus();
      },
    }, '✨ Usa un modello');
    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      let ok = true;
      const t = title.value.trim();
      setError(title, t ? '' : 'Inserisci un titolo.'); if (!t) ok = false;
      const dateOk = isValidISO(date.value);
      setError(date, dateOk ? '' : 'Scegli una data di scadenza.'); if (!dateOk) ok = false;
      let recurrence = { unit: 'none', every: 0 };
      if (rec.value === 'custom') {
        const n = Math.floor(Number(every.value));
        const evOk = n >= 1 && n <= 120;
        setError(every, evOk ? '' : 'Inserisci un numero tra 1 e 120.'); if (!evOk) ok = false; else recurrence = { unit: unit.value, every: n };
      } else {
        setError(every, '');
        const p = PRESETS.find((x) => x.id === rec.value);
        if (p) recurrence = { unit: p.unit, every: p.every };
      }
      const amt = amount.value === '' ? null : Number(amount.value);
      const amtOk = amt === null || (Number.isFinite(amt) && amt >= 0);
      setError(amount, amtOk ? '' : 'Importo non valido.'); if (!amtOk) ok = false;
      const rd = Math.floor(Number(remind.value));
      const rdOk = remind.value !== '' && rd >= 0 && rd <= 365;
      setError(remind, rdOk ? '' : 'Inserisci un numero tra 0 e 365.'); if (!rdOk) ok = false;
      // Fine serie: data di fine o numero di rate (ultimo campo modificato), solo con ricorrenza.
      let end = null;
      if (endDate.value || count.value !== '') {
        const r = curRec();
        if (!r) { setError(rec, 'Imposta una ricorrenza per usare data di fine o rate.'); ok = false; }
        else {
          setError(rec, '');
          const useCount = count.value !== '' && (source === 'count' || !endDate.value);
          if (useCount) {
            const n = Number(count.value);
            const nOk = Number.isInteger(n) && n >= 1 && n <= ITEM_END_LIMIT;
            setError(count, nOk ? '' : `Inserisci un numero di rate tra 1 e ${ITEM_END_LIMIT}.`); setError(endDate, '');
            if (!nOk) ok = false; else if (dateOk) end = endFromCount(date.value, r, n);
          } else {
            setError(count, '');
            const eOk = isValidISO(endDate.value) && (!dateOk || endDate.value >= date.value);
            setError(endDate, eOk ? '' : 'La data di fine non può precedere la prima scadenza.');
            if (!eOk) ok = false; else end = endDate.value;
          }
        }
      } else { setError(count, ''); setError(endDate, ''); }
      const paidN = paid.value === '' ? 0 : Number(paid.value);
      const paidOk = Number.isInteger(paidN) && paidN >= 0;
      setError(paid, paidOk ? '' : 'Inserisci un numero intero da 0 in su.'); if (!paidOk) ok = false;
      if (!ok) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
      const now = Date.now();
      const rec2 = {
        id: item ? item.id : uuid(), title: t, categoryId: category.value, dueDate: date.value, recurrence,
        amount: amt, remindDays: rd, notes: notes.value.trim(), reference: reference.value.trim(),
        autoPay: autoPay.checked, payMethod: autoPay.checked ? payMethod.value.trim() : '', endDate: end, paidCount: paidN,
        paused: item ? !!item.paused : false, cancelledOn: item ? item.cancelledOn || null : null, closedReason: item ? item.closedReason || null : null,
        status: item ? item.status : 'active', createdAt: item ? item.createdAt : now, updatedAt: now,
      };
      await put('items', rec2);
      notifyChanged();
      toast(item ? 'Scadenza aggiornata' : 'Scadenza aggiunta');
      close(rec2);
    } },
      sheetHeader(item ? 'Modifica scadenza' : 'Nuova scadenza', close),
      tplBtn,
      field('Titolo', title),
      field('Categoria', category),
      field('Data di scadenza', date),
      field('Ricorrenza', rec), customRow, endBox,
      field('Importo (€, facoltativo)', amount),
      autoRow, methodField,
      field('Preavviso (giorni prima)', remind, { hint: 'Quanti giorni prima iniziare a segnalarla.' }),
      field('Riferimento (n. polizza, targa…)', reference),
      field('Note', notes),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Annulla'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, 'Salva')));
    setTimeout(() => title.focus(), 50);
    return form;
  }, { label: item ? 'Modifica scadenza' : 'Nuova scadenza' });
}
