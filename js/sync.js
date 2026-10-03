import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import * as store from './store.js';
import { nowIso, ts, ledgerId } from './util.js';

export const enabled = Boolean(SUPABASE_URL && SUPABASE_KEY);

const BATCH = 400;
const listeners = new Set();
let status = { state: enabled ? 'idle' : 'off', at: null, error: null };
let running = null;
let again = false;
const fullDone = new Set(); // cuentas con descarga completa en esta sesión

export const onStatus = (fn) => (listeners.add(fn), fn(status), () => listeners.delete(fn));
export const getStatus = () => status;
function setStatus(patch) {
  status = { ...status, ...patch };
  listeners.forEach((fn) => fn(status));
}

async function rpc(name, params) {
  if (!enabled) throw new Error('La sincronización no está configurada.');
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      msg = (await res.json()).message || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

const toWire = (e) => ({
  id: e.id,
  at: e.at,
  del: !!e.del,
  data: { amt: e.amt, note: e.note, cat: e.cat, date: e.date, by: e.by },
});

function fromWire(r) {
  const d = r.data || {};
  return {
    id: r.id,
    amt: Number.isInteger(d.amt) ? d.amt : 0,
    note: String(d.note ?? ''),
    cat: String(d.cat ?? ''),
    date: /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : r.at.slice(0, 10),
    by: String(d.by ?? ''),
    at: r.at,
    del: !!r.del,
  };
}

function applyMeta(acc, res) {
  if (!res.meta_at || acc.metaDirty || ts(res.meta_at) <= ts(acc.metaAt)) return;
  const m = res.meta || {};
  store.patchAccount(acc.id, {
    name: typeof m.name === 'string' && m.name ? m.name : acc.name,
    currency: typeof m.currency === 'string' ? m.currency : acc.currency,
    budget: Number.isInteger(m.budget) ? m.budget : null,
    cats: Array.isArray(m.cats) ? m.cats.filter((c) => typeof c === 'string') : acc.cats,
    metaAt: new Date(res.meta_at).toISOString(),
  });
}

async function syncAccount(acc) {
  const full = !fullDone.has(acc.id);
  const pending = store.getState().entries.filter((e) => e.acc === acc.id && e.dirty);
  let i = 0;
  do {
    const chunk = pending.slice(i, i + BATCH).map(toWire);
    const sendMeta = acc.metaDirty && i === 0;
    const metaAt = acc.metaAt;
    const res = await rpc('bs_sync', {
      p_ledger: acc.ledger,
      p_since: full && i === 0 ? 0 : acc.rev,
      p_meta: sendMeta ? store.metaOf(acc) : null,
      p_meta_at: sendMeta ? metaAt : null,
      p_entries: chunk,
      p_create: false,
    });

    if (!res.exists) {
      store.patchAccount(acc.id, { ledger: null, code: null, rev: 0, metaDirty: false });
      return { removed: true };
    }

    if (sendMeta && store.account(acc.id).metaAt === metaAt) store.patchAccount(acc.id, { metaDirty: false });
    applyMeta(store.account(acc.id), res);
    store.mergeEntries(acc.id, res.entries.map(fromWire), { fromServer: true });
    store.markClean(chunk);
    store.patchAccount(acc.id, { rev: Math.max(res.rev || 0, acc.rev), lastSync: nowIso() });
    acc = store.account(acc.id);
    i += BATCH;
  } while (i < pending.length);
  fullDone.add(acc.id);
  return { removed: false };
}

/** Sincroniza todas las cuentas compartidas. Llamadas concurrentes se agrupan. */
export function syncAll() {
  if (!enabled) return Promise.resolve([]);
  if (running) {
    again = true;
    return running;
  }
  const shared = store.accounts().filter((a) => a.ledger);
  if (!shared.length) {
    setStatus({ state: 'idle' });
    return Promise.resolve([]);
  }
  if (!navigator.onLine) {
    setStatus({ state: 'offline' });
    return Promise.resolve([]);
  }
  setStatus({ state: 'syncing', error: null });
  running = (async () => {
    const removed = [];
    try {
      for (const acc of shared) {
        const r = await syncAccount(acc);
        if (r.removed) removed.push(acc.name);
      }
      setStatus({ state: 'ok', at: nowIso() });
    } catch (err) {
      console.warn('Sync', err);
      setStatus({ state: navigator.onLine ? 'error' : 'offline', error: err.message });
    } finally {
      running = null;
    }
    if (again) {
      again = false;
      queueMicrotask(syncAll);
    }
    return removed;
  })();
  return running;
}

export const hasPending = () =>
  store.accounts().some((a) => a.ledger && (a.metaDirty || store.getState().entries.some((e) => e.acc === a.id && e.dirty)));

/** Comprueba si existe una cuenta con ese código (sin crearla). */
export async function probe(code) {
  const ledger = await ledgerId(code);
  const res = await rpc('bs_sync', { p_ledger: ledger, p_since: 0, p_entries: [], p_create: false });
  return { ledger, res };
}

/** Publica una cuenta local con un código nuevo. */
export async function share(accId, code) {
  const { ledger, res } = await probe(code);
  if (res.exists) return { taken: true };
  if (store.accountByLedger(ledger)) return { taken: true };
  const acc = store.account(accId);
  const created = await rpc('bs_sync', {
    p_ledger: ledger,
    p_since: 0,
    p_meta: store.metaOf(acc),
    p_meta_at: acc.metaAt,
    p_entries: [],
    p_create: true,
  });
  if (!created.created) return { taken: true };
  // Marca todo como pendiente para subir el historial existente.
  for (const e of store.getState().entries) if (e.acc === accId) e.dirty = true;
  store.patchAccount(accId, { ledger, code: formatCode(code), rev: 0, metaDirty: false });
  fullDone.delete(accId);
  await syncAll();
  return { taken: false };
}

/** Se une a una cuenta existente a partir de su código. */
export async function join(code) {
  const { ledger, res } = await probe(code);
  if (!res.exists) return { missing: true };
  const already = store.accountByLedger(ledger);
  if (already) {
    store.setCurrent(already.id);
    return { account: already, already: true };
  }
  const m = res.meta || {};
  const acc = store.addAccount(typeof m.name === 'string' && m.name ? m.name : 'Compartida', {
    currency: typeof m.currency === 'string' ? m.currency : 'EUR',
    budget: Number.isInteger(m.budget) ? m.budget : null,
    cats: Array.isArray(m.cats) ? m.cats : [],
    metaAt: res.meta_at ? new Date(res.meta_at).toISOString() : nowIso(),
    ledger,
    code: formatCode(code),
    rev: res.rev || 0,
    lastSync: nowIso(),
  });
  store.mergeEntries(acc.id, res.entries.map(fromWire), { fromServer: true });
  fullDone.add(acc.id);
  setStatus({ state: 'ok', at: nowIso() });
  return { account: acc };
}

/** Borra la cuenta del servidor para todos los dispositivos. */
export async function destroy(accId) {
  const acc = store.account(accId);
  if (acc?.ledger) await rpc('bs_delete', { p_ledger: acc.ledger });
}

export function unlink(accId) {
  store.patchAccount(accId, { ledger: null, code: null, rev: 0, metaDirty: false });
  fullDone.delete(accId);
}

export const formatCode = (code) => String(code).trim().toUpperCase().replace(/\s+/g, ' ');
