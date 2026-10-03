export const LOCALE = 'es-ES';

export const uuid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
      );

export const nowIso = () => new Date().toISOString();
export const ts = (iso) => (iso ? Date.parse(iso) : 0);

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ---------- dinero (siempre en céntimos enteros) ---------- */

const fmtCache = new Map();
function moneyFmt(currency, compact) {
  const k = currency + compact;
  if (!fmtCache.has(k)) {
    fmtCache.set(
      k,
      new Intl.NumberFormat(LOCALE, {
        style: 'currency',
        currency,
        minimumFractionDigits: compact ? 0 : 2,
        maximumFractionDigits: compact ? 0 : 2,
      })
    );
  }
  return fmtCache.get(k);
}

export const money = (cents, currency = 'EUR', compact = false) =>
  moneyFmt(currency, compact).format((cents || 0) / 100);

export const number = (cents) =>
  new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((cents || 0) / 100);

export function currencySymbol(currency) {
  const part = moneyFmt(currency, true).formatToParts(0).find((p) => p.type === 'currency');
  return part ? part.value : currency;
}

/** "12,4" | "12.40" | "1.234,50" -> 1240 (céntimos) o null */
export function parseAmount(str) {
  let s = String(str ?? '').trim().replace(/\s|€|\$|£/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else {
    s = s.replace(',', '.');
  }
  if (!/^\d*\.?\d{0,2}$/.test(s) || s === '.') return null;
  const n = Math.round(parseFloat(s) * 100);
  return Number.isFinite(n) ? n : null;
}

/* ---------- fechas (YYYY-MM-DD en hora local) ---------- */

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const fromIsoDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
};
export const shiftMonth = (key, delta) => {
  const d = fromIsoDate(key + '-01');
  d.setMonth(d.getMonth() + delta);
  return monthKey(d);
};
export const daysInMonth = (key) => {
  const d = fromIsoDate(key + '-01');
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
};

export const monthName = (key, withYear = true) => {
  const s = fromIsoDate(key + '-01').toLocaleDateString(LOCALE, { month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1) + (withYear ? ' ' + key.slice(0, 4) : '');
};

export function dayLabel(iso) {
  const today = isoDate();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (iso === today) return 'Hoy';
  if (iso === isoDate(y)) return 'Ayer';
  const s = fromIsoDate(iso).toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/\./g, '');
}

export function ago(iso) {
  const s = Math.round((Date.now() - ts(iso)) / 1000);
  if (s < 45) return 'ahora';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

/* ---------- códigos de cuenta compartida ---------- */

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // sin 0/O, 1/I/L

export function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const raw = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return raw.match(/.{4}/g).join('-');
}

export const normalizeCode = (code) => String(code ?? '').toUpperCase().replace(/[\s\-_.·]/g, '');

export const MIN_CODE = 8;

export async function ledgerId(code) {
  const data = new TextEncoder().encode('banksync:v1:' + normalizeCode(code));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- varios ---------- */

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const haptic = (ms = 8) => {
  if (navigator.vibrate) navigator.vibrate(ms);
};
