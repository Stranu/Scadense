import { setMeta } from './db.js';

const KEY = 'scadense-theme';
const COLORS = { light: '#f5f6fb', dark: '#0f1020' };

export const getPref = () => localStorage.getItem(KEY) || 'auto';

export function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(pref = getPref()) {
  const t = resolveTheme(pref);
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', COLORS[t]);
  return t;
}

export async function setTheme(pref) {
  localStorage.setItem(KEY, pref);
  applyTheme(pref);
  try { await setMeta('theme', pref); } catch { /* cache locale sufficiente */ }
}

export function initTheme() {
  applyTheme();
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', () => { if (getPref() === 'auto') applyTheme('auto'); });
}
