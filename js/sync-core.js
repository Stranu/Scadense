// Logica PURA della sincronizzazione (nessun I/O): mappatura locale <-> remoto, LWW, utilità.
import { normalizeItem } from './db.js';

export const toMs = (iso) => {
  const n = typeof iso === 'number' ? iso : Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
};
export const toIso = (ms) => new Date(Number.isFinite(ms) ? ms : 0).toISOString();

// Orologio LWW di una riga locale: updatedAt, poi createdAt, poi epoch (deterministico tra dispositivi).
export function stampOf(row) {
  if (!row) return 0;
  if (Number.isFinite(row.updatedAt)) return row.updatedAt;
  if (Number.isFinite(row.createdAt)) return row.createdAt;
  return 0;
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const NO_REC = () => ({ unit: 'none', every: 0 });

const items = {
  store: 'items', remote: 'scadense_items',
  toRemote(r) {
    const it = normalizeItem(r);
    const stamp = stampOf(it);
    return {
      id: it.id, title: it.title ?? null, category_id: it.categoryId ?? null, due_date: it.dueDate ?? null,
      recurrence: it.recurrence ?? null, amount: it.amount ?? null, remind_days: it.remindDays ?? null,
      notes: it.notes ?? null, reference: it.reference ?? null, status: it.status ?? null,
      auto_pay: it.autoPay === true, pay_method: it.payMethod ?? null, end_date: it.endDate ?? null,
      paid_count: it.paidCount ?? 0, paused: it.paused === true, cancelled_on: it.cancelledOn ?? null,
      closed_reason: it.closedReason ?? null,
      created_at: toIso(Number.isFinite(it.createdAt) ? it.createdAt : stamp),
      updated_at: toIso(stamp),
    };
  },
  toLocal(x) {
    const updatedAt = toMs(x.updated_at);
    return normalizeItem({
      id: x.id, title: x.title ?? '', categoryId: x.category_id ?? 'altro', dueDate: x.due_date,
      recurrence: x.recurrence ?? NO_REC(), amount: x.amount ?? null, remindDays: x.remind_days ?? 7,
      notes: x.notes ?? '', reference: x.reference ?? '', status: x.status ?? 'active',
      autoPay: x.auto_pay ?? false, payMethod: x.pay_method ?? '', endDate: x.end_date ?? null,
      paidCount: x.paid_count ?? 0, paused: x.paused ?? false, cancelledOn: x.cancelled_on ?? null,
      closedReason: x.closed_reason ?? null,
      createdAt: x.created_at ? toMs(x.created_at) : updatedAt, updatedAt,
    });
  },
};

const history = {
  store: 'history', remote: 'scadense_history',
  toRemote(r) {
    return {
      id: r.id, item_id: r.itemId ?? null, done_on: r.doneOn ?? null, due_was: r.dueWas ?? null,
      amount: r.amount ?? null, note: r.note ?? null, auto: r.auto === true, updated_at: toIso(stampOf(r)),
    };
  },
  toLocal(x) {
    return {
      id: x.id, itemId: x.item_id, doneOn: x.done_on, dueWas: x.due_was ?? x.done_on,
      amount: x.amount ?? null, note: x.note ?? '', ...(x.auto === true ? { auto: true } : {}),
      updatedAt: toMs(x.updated_at),
    };
  },
};

const categories = {
  store: 'categories', remote: 'scadense_categories',
  toRemote(r) {
    return {
      id: r.id, name: r.name ?? null, emoji: r.emoji ?? null, color: r.color ?? null,
      default_remind: r.defaultRemind ?? null, sort_order: r.order ?? null, updated_at: toIso(stampOf(r)),
    };
  },
  toLocal(x) {
    return {
      id: x.id, name: x.name ?? '', emoji: x.emoji ?? '📌', color: x.color ?? '#64748b',
      defaultRemind: x.default_remind ?? 7, order: x.sort_order ?? 0, updatedAt: toMs(x.updated_at),
    };
  },
};

// Registro per nome dello store locale. Ordine di push/pull: categories, items, history.
export const TABLES = { categories, items, history };
export const TABLE_ORDER = ['categories', 'items', 'history'];

// Decide cosa fare con una riga remota. local = riga locale o undefined; pending = voce outbox o undefined;
// remote = riga remota ({deleted, updated_at, ...}). Ritorna 'apply' | 'skip' | 'delete-local'.
export function decideRemote({ local, pending, remote }) {
  const remoteStamp = toMs(remote.updated_at);
  const pendingAt = pending && Number.isFinite(pending.at) ? pending.at : -Infinity;
  if (remote.deleted === true) {
    if (!local) return 'skip';
    return remoteStamp >= Math.max(stampOf(local), pendingAt) ? 'delete-local' : 'skip';
  }
  if (!local) {
    // Cancellazione locale in coda più recente della riga remota: vince la cancellazione.
    if (pending && pending.op === 'del' && pendingAt >= remoteStamp) return 'skip';
    return 'apply';
  }
  return remoteStamp > Math.max(stampOf(local), pendingAt) ? 'apply' : 'skip';
}

// Ritardo di retry dopo il n-esimo fallimento consecutivo (1-based): 5 s, 15 s, 45 s, 120 s, poi 300 s.
const BACKOFF = [5000, 15000, 45000, 120000, 300000];
export function backoffDelay(attempt) {
  const i = Math.max(0, Math.floor(attempt || 1) - 1);
  return BACKOFF[Math.min(i, BACKOFF.length - 1)];
}
