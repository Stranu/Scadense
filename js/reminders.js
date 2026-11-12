import { diffDays, todayISO } from './dates.js';
import { getAll, getMeta, setMeta } from './db.js';
import { sortByUrgency, isLive } from './model.js';

// Voci attive scadute o entro il loro periodo di preavviso.
export function dueForReminder(items, today = todayISO()) {
  return sortByUrgency(items.filter((i) => {
    if (!isLive(i)) return false;
    const d = diffDays(today, i.dueDate);
    // Pagamenti automatici: solo avviso pre-addebito, mai "scaduti".
    return i.autoPay ? d >= 0 && d <= (i.remindDays || 0) : d <= (i.remindDays || 0);
  }));
}

export function summaryText(n) {
  return n === 1 ? '1 scadenza richiede attenzione' : `${n} scadenze richiedono attenzione`;
}

export const notificationsSupported = () => 'Notification' in window;

// All'apertura: badge e (se abilitata) notifica una volta al giorno. Fallback silenzioso.
export async function runReminders() {
  try {
    const list = dueForReminder(await getAll('items'));
    if (navigator.setAppBadge) {
      if (list.length) await navigator.setAppBadge(list.length); else await navigator.clearAppBadge();
    }
    const enabled = await getMeta('notify', false);
    const today = todayISO();
    if (!enabled || !list.length || !notificationsSupported() || Notification.permission !== 'granted') return;
    if ((await getMeta('lastReminder', '')) === today) return;
    await setMeta('lastReminder', today);
    const opts = { body: list.slice(0, 3).map((i) => i.title).join(', '), icon: 'icons/icon-192.png', tag: 'scadense-reminder' };
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg && reg.showNotification) await reg.showNotification(summaryText(list.length), opts);
    else new Notification(summaryText(list.length), opts);
  } catch { /* nessun errore visibile */ }
}
