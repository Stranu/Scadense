// Helper UI: creazione DOM sicura (testo mai come HTML), toast, dialog.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return e;
}

let uid = 0;
export const nextId = (p = 'id') => `${p}-${++uid}`;

export function notifyChanged() {
  window.dispatchEvent(new CustomEvent('scadense:changed'));
}

// ---- Toast ----
let toastTimer = null;
export function toast(message, action) {
  const box = document.getElementById('toast');
  if (!box) return;
  clearTimeout(toastTimer);
  box.replaceChildren();
  const inner = h('div', { class: 'toast' }, h('span', null, message));
  if (action) {
    inner.append(h('button', {
      type: 'button', class: 'toast-action',
      onclick: () => { box.replaceChildren(); clearTimeout(toastTimer); action.fn(); },
    }, action.label));
  }
  box.append(inner);
  toastTimer = setTimeout(() => box.replaceChildren(), action ? 8000 : 4000);
}

// ---- Dialog modale ----
let openCount = 0;
// build(close) ritorna il contenuto; la promise si risolve col valore passato a close().
export function modal(build, { label } = {}) {
  return new Promise((resolve) => {
    let result;
    const dlg = h('dialog', { class: 'sheet', 'aria-label': label || null });
    const close = (v) => { result = v; dlg.close(); };
    dlg.addEventListener('close', () => {
      dlg.remove();
      openCount--;
      if (openCount <= 0) document.body.classList.remove('modal-open');
      resolve(result);
    });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.append(h('div', { class: 'sheet-body' }, build(close)));
    document.body.append(dlg);
    openCount++;
    document.body.classList.add('modal-open');
    dlg.showModal();
  });
}

export function sheetHeader(title, close) {
  return h('div', { class: 'sheet-head' },
    h('h2', { class: 'sheet-title' }, title),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Chiudi', onclick: () => close() }, '✕'));
}

export function confirmDialog({ title, message, okLabel = 'Conferma', danger = false }) {
  return modal((close) => h('div', null,
    sheetHeader(title, close),
    h('p', { class: 'muted' }, message),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', onclick: () => close(false) }, 'Annulla'),
      h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => close(true) }, okLabel)),
  ), { label: title }).then((v) => v === true);
}

// Campo etichettato: ritorna {wrap, input}
export function field(label, input, { hint, error } = {}) {
  const id = nextId('f');
  input.id = id;
  const wrap = h('div', { class: 'field' },
    h('label', { for: id }, label),
    input,
    hint ? h('small', { class: 'hint' }, hint) : null,
    h('small', { class: 'err', role: 'alert', id: id + '-err' }, error || ''));
  return wrap;
}

export function setError(input, msg) {
  const err = document.getElementById(input.id + '-err');
  if (err) err.textContent = msg || '';
  if (msg) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', input.id + '-err'); }
  else { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
}

export function downloadFile(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
