import { uuid, nowIso, ts, isoDate } from './util.js';

const KEY = 'banksync:v1';
const DEFAULT_CATS = ['Comida', 'Casa', 'Transporte', 'Ocio', 'Salud', 'Otros'];

const listeners = new Set();
let state = load();

function blank() {
  const acc = makeAccount('Personal');
  return { v: 1, accounts: [acc], entries: [], current: acc.id, settings: { by: '' } };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.accounts) && Array.isArray(s.entries)) {
        s.settings ??= { by: '' };
        if (!s.accounts.length) s.accounts.push(makeAccount('Personal'));
        if (!s.accounts.some((a) => a.id === s.current)) s.current = s.accounts[0].id;
        return s;
      }
    }
  } catch (err) {
    console.error('No se pudo leer el almacenamiento local', err);
  }
  return blank();
}

let saveQueued = false;
function commit() {
  if (!saveQueued) {
    saveQueued = true;
    queueMicrotask(() => {
      saveQueued = false;
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch (err) {
        console.error('No se pudo guardar', err);
      }
    });
  }
  listeners.forEach((fn) => fn(state));
}

export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const getState = () => state;

/* ---------- cuentas ---------- */

function makeAccount(name, extra = {}) {
  return {
    id: uuid(),
    name,
    currency: 'EUR',
    budget: null,
    cats: [...DEFAULT_CATS],
    metaAt: nowIso(),
    metaDirty: false,
    code: null,
    ledger: null,
    rev: 0,
    lastSync: null,
    createdAt: nowIso(),
    ...extra,
  };
}

export const accounts = () => state.accounts;
export const account = (id) => state.accounts.find((a) => a.id === id);
export const currentAccount = () => account(state.current) || state.accounts[0];
export const accountByLedger = (ledger) => state.accounts.find((a) => a.ledger === ledger);

export function setCurrent(id) {
  if (state.current === id) return;
  state.current = id;
  commit();
}

export function addAccount(name, extra) {
  const acc = makeAccount(name.trim() || 'Cuenta', extra);
  state.accounts.push(acc);
  state.current = acc.id;
  commit();
  return acc;
}

export const metaOf = (acc) => ({ name: acc.name, currency: acc.currency, budget: acc.budget, cats: acc.cats });

/** Cambios que se comparten (nombre, moneda, presupuesto, categorías). */
export function updateMeta(id, patch) {
  const acc = account(id);
  if (!acc) return;
  Object.assign(acc, patch, { metaAt: nowIso(), metaDirty: true });
  commit();
}

/** Cambios internos (sincronización, vinculación). */
export function patchAccount(id, patch) {
  const acc = account(id);
  if (!acc) return;
  Object.assign(acc, patch);
  commit();
}

export function removeAccount(id) {
  state.accounts = state.accounts.filter((a) => a.id !== id);
  state.entries = state.entries.filter((e) => e.acc !== id);
  if (!state.accounts.length) state.accounts.push(makeAccount('Personal'));
  if (state.current === id) state.current = state.accounts[0].id;
  commit();
}

export function addCategory(id, name) {
  const acc = account(id);
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 24);
  if (!acc || !clean) return null;
  const existing = acc.cats.find((c) => c.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  updateMeta(id, { cats: [...acc.cats, clean] });
  return clean;
}

/* ---------- movimientos ---------- */

export const entriesOf = (accId) => state.entries.filter((e) => e.acc === accId && !e.del);
export const allEntries = () => state.entries.filter((e) => !e.del);
export const entry = (id) => state.entries.find((e) => e.id === id);

export function addEntry({ acc, amt, note = '', cat = '', date = isoDate() }) {
  const e = {
    id: uuid(),
    acc,
    amt,
    note: note.trim().slice(0, 80),
    cat,
    date,
    by: state.settings.by || '',
    at: nowIso(),
    del: false,
    dirty: true,
  };
  state.entries.push(e);
  commit();
  return e;
}

export function updateEntry(id, patch) {
  const e = entry(id);
  if (!e) return;
  Object.assign(e, patch, { at: nowIso(), dirty: true });
  commit();
}

/** Borrado lógico: necesario para propagar el borrado a otros dispositivos. */
export const deleteEntry = (id) => updateEntry(id, { del: true });
export const restoreEntry = (id) => updateEntry(id, { del: false });

/** Fusiona movimientos remotos o importados. Gana el más reciente. */
export function mergeEntries(accId, incoming, { fromServer = false } = {}) {
  const byId = new Map(state.entries.map((e) => [e.id, e]));
  let changed = false;
  for (const r of incoming) {
    const local = byId.get(r.id);
    const at = new Date(r.at).toISOString();
    if (!local) {
      const e = { ...r, acc: accId, at, dirty: !fromServer };
      state.entries.push(e);
      byId.set(e.id, e);
      changed = true;
    } else if (local.acc === accId && ts(at) > ts(local.at)) {
      Object.assign(local, r, { acc: accId, at, dirty: !fromServer });
      changed = true;
    }
  }
  if (changed) commit();
  return changed;
}

export function markClean(sent) {
  for (const s of sent) {
    const e = entry(s.id);
    if (e && e.at === s.at) e.dirty = false;
  }
  commit();
}

/** Purga movimientos borrados ya sincronizados (o locales) de hace más de 60 días. */
export function compact() {
  const limit = Date.now() - 60 * 86400e3;
  const before = state.entries.length;
  state.entries = state.entries.filter((e) => !(e.del && !e.dirty && ts(e.at) < limit));
  if (state.entries.length !== before) commit();
}

/* ---------- ajustes ---------- */

export const settings = () => state.settings;
export function setSetting(k, v) {
  state.settings[k] = v;
  commit();
}

/* ---------- exportar / importar ---------- */

export function exportData() {
  return {
    app: 'banksync',
    format: 1,
    exportedAt: nowIso(),
    accounts: state.accounts.map(({ metaDirty, rev, lastSync, ...a }) => a),
    entries: state.entries.filter((e) => !e.del).map(({ dirty, ...e }) => e),
  };
}

export function importData(data) {
  if (!data || data.app !== 'banksync' || !Array.isArray(data.accounts) || !Array.isArray(data.entries)) {
    throw new Error('El archivo no es una copia de Banksync.');
  }
  // Un dispositivo recién estrenado solo tiene la cuenta vacía por defecto: se sustituye.
  const pristine =
    state.accounts.length === 1 && !state.accounts[0].ledger && !state.entries.some((e) => e.acc === state.accounts[0].id)
      ? state.accounts[0]
      : null;
  let accs = 0;
  const idMap = new Map();
  for (const a of data.accounts) {
    if (!a || typeof a.id !== 'string' || typeof a.name !== 'string') continue;
    const existing = account(a.id) || (a.ledger && accountByLedger(a.ledger));
    if (existing) {
      idMap.set(a.id, existing.id);
      if (ts(a.metaAt) > ts(existing.metaAt)) {
        Object.assign(existing, { name: a.name, currency: a.currency, budget: a.budget, cats: a.cats, metaAt: a.metaAt, metaDirty: !!existing.ledger });
      }
    } else {
      const acc = makeAccount(a.name, {
        ...a,
        cats: Array.isArray(a.cats) ? a.cats : [...DEFAULT_CATS],
        rev: 0,
        lastSync: null,
        metaDirty: !!a.ledger,
      });
      state.accounts.push(acc);
      idMap.set(a.id, acc.id);
      accs++;
    }
  }
  let ents = 0;
  const groups = new Map();
  for (const e of data.entries) {
    const acc = idMap.get(e?.acc);
    if (!acc || typeof e.id !== 'string' || !Number.isInteger(e.amt) || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue;
    if (!groups.has(acc)) groups.set(acc, []);
    groups.get(acc).push({
      id: e.id,
      amt: e.amt,
      note: String(e.note ?? ''),
      cat: String(e.cat ?? ''),
      date: e.date,
      by: String(e.by ?? ''),
      at: e.at || nowIso(),
      del: false,
    });
  }
  for (const [acc, list] of groups) {
    const before = state.entries.length;
    mergeEntries(acc, list);
    ents += state.entries.length - before;
  }
  if (pristine && accs > 0 && ![...idMap.values()].includes(pristine.id)) {
    state.accounts = state.accounts.filter((a) => a !== pristine);
    if (state.current === pristine.id) state.current = state.accounts[0].id;
  }
  commit();
  return { accounts: accs, entries: ents };
}
