import { h, modal, sheetHeader, field, setError, toast, notifyChanged, confirmDialog, downloadFile } from '../ui.js';
import { getAll, getCategories, getMeta, setMeta, put, transact, uuid } from '../db.js';
import { getPref, setTheme } from '../theme.js';
import { buildBackup, validateBackup, applyBackup } from '../backup.js';
import { buildICS } from '../ics.js';
import { todayISO } from '../dates.js';
import { notificationsSupported } from '../reminders.js';
import { pickTemplate } from '../templates.js';
import { openItemForm } from './item-form.js';
import { filters } from './prossime.js';
import { renderAccountCard } from './account.js';

export const APP_VERSION = '1.2.0';

export async function render(root) {
  const [cats, notify, items] = await Promise.all([getCategories(), getMeta('notify', false), getAll('items')]);
  const pref = getPref();

  const themeGroup = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Tema' },
    [['auto', 'Automatico'], ['light', 'Chiaro'], ['dark', 'Scuro']].map(([v, l]) =>
      h('button', {
        type: 'button', class: 'seg-btn', role: 'radio', 'aria-checked': String(pref === v),
        onclick: async () => { await setTheme(v); render(root); },
      }, l)));

  const notifyBtn = h('button', {
    type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(!!notify && notificationsSupported() && Notification.permission === 'granted'),
    'aria-labelledby': 'notify-label',
    onclick: async () => {
      if (!notificationsSupported()) { toast('Le notifiche non sono supportate su questo dispositivo'); return; }
      const on = notifyBtn.getAttribute('aria-checked') === 'true';
      if (on) { await setMeta('notify', false); notifyBtn.setAttribute('aria-checked', 'false'); return; }
      const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (perm === 'granted') { await setMeta('notify', true); notifyBtn.setAttribute('aria-checked', 'true'); toast('Notifiche attivate (solo ad app aperta)'); }
      else toast('Permesso notifiche non concesso');
    },
  }, h('span', { class: 'switch-knob' }));

  const catList = h('ul', { class: 'list cat-list' }, cats.map((c) => h('li', { class: 'row' },
    h('button', { type: 'button', class: 'row-main', 'aria-label': `Modifica categoria ${c.name}`, onclick: () => editCategory(c, cats) },
      h('span', { class: 'cat-dot', style: `--c:${c.color}`, 'aria-hidden': 'true' }, c.emoji),
      h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, c.name), h('span', { class: 'row-sub' }, `Preavviso predefinito: ${c.defaultRemind} giorni`))))));

  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, id: 'import-file', 'aria-label': 'File di backup da importare' });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (f) await importFlow(f);
  });

  root.replaceChildren(
    h('h1', { class: 'page-title', tabindex: '-1' }, 'Altro'),
    h('section', { class: 'card' }, h('h2', { class: 'section-title' }, 'Aspetto'), themeGroup),
    h('section', { class: 'card' }, h('h2', { class: 'section-title' }, 'Promemoria'),
      h('div', { class: 'switch-row' },
        h('div', null, h('div', { id: 'notify-label', class: 'row-title' }, 'Notifiche ad app aperta'),
          h('div', { class: 'row-sub' }, 'Nessun invio da server: compaiono solo quando apri Scadense.')),
        notifyBtn)),
    h('section', { class: 'card' }, h('h2', { class: 'section-title' }, 'Scadenze'),
      h('div', { class: 'btn-grid' },
        h('button', { type: 'button', class: 'btn', onclick: async () => { const t = await pickTemplate(); if (t) openItemForm({ prefill: { ...t, recurrence: { ...t.recurrence } } }); } }, '✨ Modelli rapidi'),
        h('button', { type: 'button', class: 'btn', onclick: () => { filters.status = 'archived'; filters.q = ''; filters.cat = ''; location.hash = '#/'; } }, '🗄️ Archivio'))),
    h('section', { class: 'card' }, h('h2', { class: 'section-title' }, 'Categorie'), catList,
      h('button', { type: 'button', class: 'btn btn-block', onclick: () => editCategory(null, cats) }, '＋ Nuova categoria')),
    renderAccountCard(),
    h('section', { class: 'card' }, h('h2', { class: 'section-title' }, 'Backup e calendario'),
      h('p', { class: 'muted' }, 'Senza account i dati restano solo su questo dispositivo: esporta un backup per non perderli. Con l\'account vengono anche sincronizzati sul cloud.'),
      h('div', { class: 'btn-grid' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: exportBackup }, '⬇ Esporta backup'),
        h('button', { type: 'button', class: 'btn', onclick: () => fileInput.click() }, '⬆ Importa backup'),
        h('button', { type: 'button', class: 'btn', onclick: () => {
          const act = items.filter((i) => i.status === 'active');
          if (!act.length) { toast('Nessuna scadenza attiva da esportare'); return; }
          downloadFile('scadense-scadenze.ics', buildICS(act, cats), 'text/calendar');
        } }, '📅 Esporta tutto (.ics)')),
      fileInput),
    h('section', { class: 'card' }, h('h2', { class: 'section-title' }, 'Info'),
      h('p', { class: 'muted' }, `Scadense ${APP_VERSION} · scadenziario personale, offline, con account facoltativo.`)));
}

async function exportBackup() {
  const data = await buildBackup();
  downloadFile(`scadense-backup-${todayISO()}.json`, JSON.stringify(data, null, 2), 'application/json');
  toast('Backup esportato');
}

async function importFlow(file) {
  let raw;
  try { raw = JSON.parse(await file.text()); } catch { toast('Il file non è un JSON valido'); return; }
  const v = validateBackup(raw);
  if (!v.ok) {
    await modal((close) => h('div', null,
      sheetHeader('Backup non valido', close),
      h('ul', { class: 'errors' }, v.errors.slice(0, 6).map((e) => h('li', null, e))),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => close() }, 'Chiudi'))), { label: 'Backup non valido' });
    return;
  }
  const mode = await modal((close) => {
    let sel = 'merge';
    const radio = (val, label, hint) => h('label', { class: 'radio' },
      h('input', { type: 'radio', name: 'mode', value: val, checked: val === 'merge', onchange: () => { sel = val; } }),
      h('span', null, h('strong', null, label), h('small', { class: 'hint' }, hint)));
    return h('div', null,
      sheetHeader('Importa backup', close),
      h('p', null, `Contiene ${v.counts.items} scadenze, ${v.counts.history} voci di cronologia e ${v.counts.categories} categorie.`),
      h('fieldset', { class: 'radios' }, h('legend', null, 'Come importare'),
        radio('merge', 'Unisci', 'Aggiunge i dati; in caso di stesso identificativo prevale il backup.'),
        radio('replace', 'Sostituisci', 'Cancella i dati attuali e usa solo il backup.')),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Annulla'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => close(sel) }, 'Importa')));
  }, { label: 'Importa backup' });
  if (!mode) return;
  if (mode === 'replace' && !(await confirmDialog({ title: 'Sostituire i dati?', message: 'I dati attuali verranno cancellati.', okLabel: 'Sostituisci', danger: true }))) return;
  try {
    const theme = await applyBackup(v.data, mode);
    if (theme) await setTheme(theme);
    notifyChanged();
    toast('Backup importato');
  } catch { toast('Importazione non riuscita'); }
}

function editCategory(cat, cats) {
  return modal((close) => {
    const name = h('input', { type: 'text', maxlength: '40', value: cat ? cat.name : '' });
    const emoji = h('input', { type: 'text', maxlength: '8', value: cat ? cat.emoji : '📌' });
    const color = h('input', { type: 'color', value: cat ? cat.color : '#4f46e5' });
    const remind = h('input', { type: 'number', min: '0', max: '365', inputmode: 'numeric', value: cat ? cat.defaultRemind : 7 });
    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const n = name.value.trim();
      const rd = Math.floor(Number(remind.value));
      setError(name, n ? '' : 'Inserisci un nome.');
      const rdOk = remind.value !== '' && rd >= 0 && rd <= 365;
      setError(remind, rdOk ? '' : 'Inserisci un numero tra 0 e 365.');
      if (!n || !rdOk) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
      await put('categories', {
        id: cat ? cat.id : uuid(), name: n, emoji: emoji.value.trim() || '📌', color: color.value, defaultRemind: rd,
        order: cat ? cat.order : Math.max(-1, ...cats.map((c) => c.order)) + 1,
      });
      notifyChanged();
      toast(cat ? 'Categoria aggiornata' : 'Categoria aggiunta');
      close(true);
    } },
      sheetHeader(cat ? 'Modifica categoria' : 'Nuova categoria', close),
      field('Nome', name), field('Icona (emoji)', emoji), field('Colore', color),
      field('Preavviso predefinito (giorni)', remind),
      h('div', { class: 'btn-row' },
        cat && cat.id !== 'altro' ? h('button', { type: 'button', class: 'btn btn-danger-ghost', onclick: () => removeCategory(cat, close) }, 'Elimina') : null,
        h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Annulla'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, 'Salva')));
    return form;
  }, { label: cat ? 'Modifica categoria' : 'Nuova categoria' });
}

async function removeCategory(cat, close) {
  const items = (await getAll('items')).filter((i) => i.categoryId === cat.id);
  const ok = await confirmDialog({
    title: 'Elimina categoria',
    message: items.length ? `${items.length} scadenze passeranno alla categoria "Altro".` : `Vuoi eliminare "${cat.name}"?`,
    okLabel: 'Elimina', danger: true,
  });
  if (!ok) return;
  await transact(['items', 'categories'], (s) => {
    items.forEach((i) => s.items.put({ ...i, categoryId: 'altro', updatedAt: Date.now() }));
    s.categories.delete(cat.id);
  });
  if (filters.cat === cat.id) filters.cat = '';
  notifyChanged();
  toast('Categoria eliminata');
  close(true);
}
