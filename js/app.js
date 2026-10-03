import * as store from './store.js';
import * as sync from './sync.js';
import {
  esc, money, number, currencySymbol, parseAmount, isoDate, monthKey, shiftMonth, daysInMonth,
  monthName, dayLabel, ago, generateCode, normalizeCode, MIN_CODE, debounce, download, haptic, ts,
} from './util.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'MXN', 'ARS', 'COP', 'CLP', 'PEN', 'UYU', 'BRL', 'JPY'];
const NO_CAT = 'Sin categoría';

const icon = {
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  back: '<svg viewBox="0 0 28 24" aria-hidden="true"><path d="M10 5h14v14H10l-7-7z"/><path d="M14 9l6 6M20 9l-6 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

const ui = {
  route: 'add',
  month: monthKey(),
  ledgerAcc: null, // null = cuenta actual, 'all' = todas
  ledgerCat: null,
  draft: { amount: '', note: '', cat: '', date: isoDate(), catTouched: false },
};

const view = $('#view');
const sheet = $('#sheet');
const toastEl = $('#toast');

/* =========================================================
   Utilidades de interfaz
   ========================================================= */

let toastTimer;
function toast(msg, action) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  const anchor = ui.route === 'add' && !sheet.open && $('#amount');
  toastEl.style.top = anchor ? `${anchor.getBoundingClientRect().top + 8}px` : '';
  toastEl.classList.add('is-on');
  if (action) {
    $('button', toastEl).onclick = () => {
      action.run();
      hideToast();
    };
  }
  toastTimer = setTimeout(hideToast, action ? 5000 : 2600);
}
const hideToast = () => toastEl.classList.remove('is-on');

function openSheet(html, mount) {
  sheet.innerHTML = `<div class="sheet-grip" aria-hidden="true"></div><div class="sheet-body">${html}</div>`;
  if (!sheet.open) sheet.showModal();
  sheet.scrollTop = 0;
  mount?.(sheet);
}
const closeSheet = () => sheet.open && sheet.close();
sheet.addEventListener('click', (e) => {
  if (e.target === sheet) closeSheet();
  if (e.target.closest('[data-close]')) closeSheet();
});

function confirmSheet({ title, text, ok = 'Confirmar', danger = false, alt }) {
  return new Promise((resolve) => {
    openSheet(
      `<h2 class="sheet-title">${esc(title)}</h2>
       ${text ? `<p class="sheet-text">${esc(text)}</p>` : ''}
       <div class="sheet-actions stack">
         <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-ink'}" data-r="ok">${esc(ok)}</button>
         ${alt ? `<button type="button" class="btn" data-r="alt">${esc(alt)}</button>` : ''}
         <button type="button" class="btn btn-ghost" data-r="no">Cancelar</button>
       </div>`,
      (el) => {
        const done = (r) => {
          sheet.removeEventListener('close', onClose);
          resolve(r);
        };
        const onClose = () => done('no');
        sheet.addEventListener('close', onClose);
        $$('[data-r]', el).forEach((b) => (b.onclick = () => {
          done(b.dataset.r);
          closeSheet();
        }));
      }
    );
  });
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado');
  } catch {
    toast('No se pudo copiar');
  }
}

const sumCents = (list) => list.reduce((s, e) => s + e.amt, 0);
const inMonth = (list, key) => list.filter((e) => e.date.startsWith(key));

/* =========================================================
   Router
   ========================================================= */

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('unirse/')) {
    const code = decodeURIComponent(h.slice(7));
    history.replaceState(null, '', '#/cuentas');
    ui.route = 'accounts';
    render();
    joinSheet(code);
    return;
  }
  ui.route = h === 'libro' ? 'ledger' : h === 'cuentas' ? 'accounts' : 'add';
  render();
}

function render() {
  if (document.body.dataset.route !== ui.route) hideToast();
  document.body.dataset.route = ui.route;
  $$('.nav a').forEach((a) => a.setAttribute('aria-current', a.dataset.view === ui.route ? 'page' : 'false'));
  if (ui.route === 'add') renderAdd();
  else if (ui.route === 'ledger') renderLedger();
  else renderAccounts();
}

/* =========================================================
   Anotar
   ========================================================= */

function renderAdd() {
  if (!$('.add', view)) {
    view.innerHTML = `
      <section class="add">
        <div class="tabs" id="accTabs" role="tablist" aria-label="Cuenta"></div>
        <div class="summary" id="summary"></div>
        <form class="entry" id="entryForm" autocomplete="off">
          <output class="amount" id="amount" aria-live="polite"></output>
          <div class="meta-row">
            <input class="concept" id="concept" placeholder="Concepto" maxlength="80"
                   list="conceptList" enterkeyhint="done" autocapitalize="sentences" aria-label="Concepto">
            <label class="date-pick">
              <span id="dateLabel">Hoy</span>
              <input type="date" id="dateInput" aria-label="Fecha">
            </label>
          </div>
          <datalist id="conceptList"></datalist>
          <div class="cats" id="cats" role="group" aria-label="Categoría"></div>
          <div class="keypad" id="keypad">
            ${['1', '2', '3']
              .map((k) => `<button type="button" data-k="${k}">${k}</button>`)
              .join('')}
            <button type="button" data-k="back" class="k-fn" aria-label="Borrar">${icon.back}</button>
            ${['4', '5', '6'].map((k) => `<button type="button" data-k="${k}">${k}</button>`).join('')}
            <button type="submit" class="k-ok" id="okKey">Anotar</button>
            ${['7', '8', '9'].map((k) => `<button type="button" data-k="${k}">${k}</button>`).join('')}
            <button type="button" data-k="0" class="k-zero">0</button>
            <button type="button" data-k="," aria-label="Coma decimal">,</button>
          </div>
        </form>
      </section>`;
    bindAdd();
  }
  paintAddMeta();
  paintAmount();
}

function paintAddMeta() {
  const acc = store.currentAccount();
  const accs = store.accounts();

  $('#accTabs').innerHTML =
    accs
      .map(
        (a) => `<button type="button" role="tab" class="tab${a.ledger ? ' is-shared' : ''}"
          aria-selected="${a.id === acc.id}" data-acc="${a.id}">${esc(a.name)}</button>`
      )
      .join('') + `<button type="button" class="tab tab-add" data-new aria-label="Nueva cuenta">${icon.plus}</button>`;
  $('#accTabs [aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  // resumen del mes
  const key = monthKey();
  const list = store.entriesOf(acc.id);
  const spent = sumCents(inMonth(list, key));
  const day = new Date().getDate();
  const prevKey = shiftMonth(key, -1);
  const prevCut = `${prevKey}-${String(Math.min(day, daysInMonth(prevKey))).padStart(2, '0')}`;
  const prevSoFar = sumCents(list.filter((e) => e.date.startsWith(prevKey) && e.date <= prevCut));
  const recent = [...list].sort((a, b) => ts(b.at) - ts(a.at)).slice(0, 8);
  const cur = acc.currency;

  let budget = '';
  if (acc.budget) {
    const p = spent / acc.budget;
    const left = acc.budget - spent;
    const expected = day / daysInMonth(key);
    budget = `
      <div class="budget${p > 1 ? ' is-over' : ''}" style="--p:${Math.min(p, 1)};--t:${expected}" role="img"
           aria-label="${Math.round(p * 100)}% del presupuesto">
        <span class="budget-fill"></span><span class="budget-tick"></span>
      </div>
      <p class="summary-line">${
        left >= 0
          ? `Quedan <b>${money(left, cur)}</b> de ${money(acc.budget, cur, true)}`
          : `Te pasas <b>${money(-left, cur)}</b> de ${money(acc.budget, cur, true)}`
      }</p>`;
  }

  $('#summary').innerHTML = `
    <p class="eyebrow">${esc(monthName(key, false))} <span class="sep"></span> gastado</p>
    <p class="total">${money(spent, cur)}</p>
    ${budget}
    ${
      prevSoFar || spent
        ? `<p class="summary-line muted">${monthName(prevKey, false)} a día ${day}: ${money(prevSoFar, cur)}</p>`
        : `<p class="summary-line muted">Teclea un importe y pulsa Anotar.</p>`
    }
    ${
      recent.length
        ? `<ul class="recent" aria-label="Últimos movimientos">
            ${recent
              .map(
                (e) => `<li><button type="button" data-edit="${e.id}">
                  <span class="recent-note">${esc(e.note || e.cat || 'Gasto')}</span>
                  <span class="recent-when">${e.date === isoDate() ? esc(ago(e.at)) : esc(dayLabel(e.date))}</span>
                  <span class="recent-amt">${money(e.amt, cur)}</span>
                </button></li>`
              )
              .join('')}
          </ul>`
        : ''
    }`;

  // categorías
  const d = ui.draft;
  if (d.cat && !acc.cats.includes(d.cat)) d.cat = '';
  $('#cats').innerHTML =
    acc.cats
      .map((c) => `<button type="button" class="chip" aria-pressed="${c === d.cat}" data-cat="${esc(c)}">${esc(c)}</button>`)
      .join('') + `<button type="button" class="chip chip-add" data-cat-new>${icon.plus}<span>Categoría</span></button>`;

  // sugerencias de concepto (más frecuentes primero)
  const freq = new Map();
  for (const e of list) if (e.note) freq.set(e.note, (freq.get(e.note) || 0) + 1);
  $('#conceptList').innerHTML = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([n]) => `<option value="${esc(n)}"></option>`)
    .join('');

  if (document.activeElement !== $('#concept')) $('#concept').value = d.note;
  $('#dateInput').value = d.date;
  $('#dateInput').max = isoDate();
  $('#dateLabel').textContent = dayLabel(d.date);
  $('#dateLabel').parentElement.classList.toggle('is-set', d.date !== isoDate());
}

function paintAmount() {
  const acc = store.currentAccount();
  const s = ui.draft.amount;
  const [int, dec] = s.split(',');
  const hasInt = int !== undefined && int !== '';
  const intTxt = hasInt ? Number(int).toLocaleString('es-ES') : '0';
  const ghost = dec === undefined ? ',00' : dec.length === 0 ? '00' : dec.length === 1 ? '0' : '';
  const caret = '<i class="caret" aria-hidden="true"></i>';
  const digits = s
    ? `<span>${intTxt}</span>${dec !== undefined ? `<span>,${dec}</span>` : ''}${caret}<span class="ghost">${ghost}</span>`
    : `${caret}<span class="ghost">0,00</span>`;
  $('#amount').innerHTML = `<span class="amount-num">${digits}</span><span class="amount-cur">${esc(currencySymbol(acc.currency))}</span>`;
  $('#amount').classList.toggle('is-empty', !s);
  $('#okKey').disabled = !(parseAmount(s) > 0);
}

function press(k) {
  const d = ui.draft;
  let s = d.amount;
  if (k === 'back') s = s.slice(0, -1);
  else if (k === 'clear') s = '';
  else if (k === ',') {
    if (!s.includes(',')) s = (s || '0') + ',';
  } else if (/^\d$/.test(k)) {
    const [int, dec] = s.split(',');
    if (dec !== undefined) {
      if (dec.length < 2) s += k;
    } else if (int === '0') s = k;
    else if (int.length < 7) s += k;
  }
  if (s !== d.amount) {
    d.amount = s;
    paintAmount();
  }
}

function submitDraft() {
  const d = ui.draft;
  const amt = parseAmount(d.amount);
  if (!(amt > 0)) return;
  const acc = store.currentAccount();
  const e = store.addEntry({ acc: acc.id, amt, note: d.note, cat: d.cat, date: d.date });
  haptic(14);
  ui.draft = { amount: '', note: '', cat: '', date: isoDate(), catTouched: false };
  paintAddMeta();
  paintAmount();
  $('#amount').classList.remove('is-done');
  void $('#amount').offsetWidth;
  $('#amount').classList.add('is-done');
  toast(`${money(amt, acc.currency)} en ${acc.name}`, { label: 'Deshacer', run: () => store.deleteEntry(e.id) });
}

function bindAdd() {
  const form = $('#entryForm');
  const concept = $('#concept');

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (document.activeElement === concept) {
      concept.blur();
      return;
    }
    submitDraft();
  });

  $('#keypad').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-k]');
    if (!b) return;
    haptic();
    press(b.dataset.k);
  });

  // mantener pulsado el borrado = vaciar
  const back = $('[data-k="back"]');
  let hold;
  back.addEventListener('pointerdown', () => {
    hold = setTimeout(() => {
      press('clear');
      haptic(20);
    }, 450);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => back.addEventListener(t, () => clearTimeout(hold)));

  concept.addEventListener('input', () => {
    const d = ui.draft;
    d.note = concept.value;
    if (d.catTouched) return;
    // autocompleta la categoría con la última usada para ese concepto
    const q = concept.value.trim().toLowerCase();
    const match = q && store.entriesOf(store.currentAccount().id)
      .filter((e) => e.note.toLowerCase() === q && e.cat)
      .sort((a, b) => ts(b.at) - ts(a.at))[0];
    const next = match ? match.cat : '';
    if (next !== d.cat) {
      d.cat = next;
      $$('#cats [data-cat]').forEach((c) => c.setAttribute('aria-pressed', c.dataset.cat === next));
    }
  });
  concept.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      concept.blur();
    }
  });
  concept.addEventListener('focus', () => document.body.classList.add('is-typing'));
  concept.addEventListener('blur', () => setTimeout(() => document.body.classList.remove('is-typing'), 60));

  $('#dateInput').addEventListener('change', (ev) => {
    ui.draft.date = ev.target.value || isoDate();
    paintAddMeta();
  });
  $('.date-pick').addEventListener('click', (ev) => {
    const input = $('#dateInput');
    if (!input.showPicker) return;
    try {
      input.showPicker();
      ev.preventDefault();
    } catch {}
  });

  $('#cats').addEventListener('click', (ev) => {
    const add = ev.target.closest('[data-cat-new]');
    if (add) return newCategoryInline(add);
    const c = ev.target.closest('[data-cat]');
    if (!c) return;
    haptic();
    const d = ui.draft;
    d.cat = d.cat === c.dataset.cat ? '' : c.dataset.cat;
    d.catTouched = true;
    $$('#cats [data-cat]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.cat === d.cat));
  });

  $('#accTabs').addEventListener('click', (ev) => {
    if (ev.target.closest('[data-new]')) return newAccountSheet();
    const t = ev.target.closest('[data-acc]');
    if (!t) return;
    haptic();
    store.setCurrent(t.dataset.acc);
  });

  $('#summary').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-edit]');
    if (b) entrySheet(b.dataset.edit);
  });
}

function newCategoryInline(btn) {
  const input = document.createElement('input');
  input.className = 'chip chip-input';
  input.placeholder = 'Nueva';
  input.maxLength = 24;
  input.enterKeyHint = 'done';
  input.setAttribute('aria-label', 'Nueva categoría');
  btn.replaceWith(input);
  input.focus();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (name) {
      const created = store.addCategory(store.currentAccount().id, name);
      ui.draft.cat = created;
      ui.draft.catTouched = true;
    }
    paintAddMeta();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    }
    if (e.key === 'Escape') {
      input.value = '';
      input.blur();
    }
  });
  input.addEventListener('blur', finish);
}

document.addEventListener('keydown', (e) => {
  if (ui.route !== 'add' || sheet.open || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.matches('input, textarea, select')) return;
  if (/^\d$/.test(e.key)) press(e.key);
  else if (e.key === ',' || e.key === '.') press(',');
  else if (e.key === 'Backspace') press('back');
  else if (e.key === 'Escape') press('clear');
  else if (e.key === 'Enter') {
    e.preventDefault();
    submitDraft();
  } else return;
  e.preventDefault();
});

/* =========================================================
   Libro
   ========================================================= */

function ledgerScope() {
  const accs = store.accounts();
  if (ui.ledgerAcc === 'all' && accs.length > 1) return accs;
  const a = store.account(ui.ledgerAcc) || store.currentAccount();
  return [a];
}

function renderLedger() {
  const accs = store.accounts();
  const scope = ledgerScope();
  const ids = new Set(scope.map((a) => a.id));
  const byId = new Map(accs.map((a) => [a.id, a]));
  const key = ui.month;
  const isNow = key === monthKey();
  const monthList = store.allEntries().filter((e) => ids.has(e.acc) && e.date.startsWith(key));
  const currencies = [...new Set(scope.map((a) => a.currency))];
  const single = currencies.length === 1;
  const cur = currencies[0];

  // totales por moneda
  const totals = new Map();
  for (const e of monthList) {
    const c = byId.get(e.acc).currency;
    totals.set(c, (totals.get(c) || 0) + e.amt);
  }
  const totalTxt = currencies.length
    ? [...(totals.size ? totals : new Map([[cur, 0]]))].map(([c, v]) => money(v, c)).join(' · ')
    : money(0);

  // desglose por categoría
  const cats = new Map();
  for (const e of monthList) {
    const c = e.cat || NO_CAT;
    cats.set(c, (cats.get(c) || 0) + e.amt);
  }
  const total = sumCents(monthList);
  const catRows = [...cats.entries()].sort((a, b) => b[1] - a[1]);
  if (ui.ledgerCat && !cats.has(ui.ledgerCat)) ui.ledgerCat = null;

  // barras diarias
  const nDays = daysInMonth(key);
  const perDay = Array(nDays).fill(0);
  for (const e of monthList) perDay[Number(e.date.slice(8, 10)) - 1] += e.amt;
  const maxDay = Math.max(...perDay, 1);
  const elapsed = isNow ? new Date().getDate() : nDays;
  const today = isNow ? new Date().getDate() : 0;

  // agrupar por día
  const visible = monthList
    .filter((e) => !ui.ledgerCat || (e.cat || NO_CAT) === ui.ledgerCat)
    .sort((a, b) => (a.date === b.date ? ts(b.at) - ts(a.at) : a.date < b.date ? 1 : -1));
  const days = new Map();
  for (const e of visible) {
    if (!days.has(e.date)) days.set(e.date, []);
    days.get(e.date).push(e);
  }
  const showAcc = scope.length > 1;

  view.innerHTML = `
    <section class="ledger">
      <header class="ledger-head">
        <button type="button" class="icon-btn" data-month="-1" aria-label="Mes anterior">${icon.left}</button>
        <h1>${esc(monthName(key))}</h1>
        <button type="button" class="icon-btn" data-month="1" aria-label="Mes siguiente" ${isNow ? 'disabled' : ''}>${icon.right}</button>
      </header>

      ${
        accs.length > 1
          ? `<div class="filter" role="tablist" aria-label="Cuenta">
              <button type="button" role="tab" data-scope="all" aria-selected="${showAcc}">Todas</button>
              ${accs
                .map((a) => `<button type="button" role="tab" data-scope="${a.id}" aria-selected="${!showAcc && a.id === scope[0].id}">${esc(a.name)}</button>`)
                .join('')}
            </div>`
          : ''
      }

      <div class="ledger-total">
        <p class="total">${totalTxt}</p>
        <p class="summary-line muted">${monthList.length} ${monthList.length === 1 ? 'movimiento' : 'movimientos'}${
          single && total ? ` <span class="sep"></span> ${money(Math.round(total / elapsed), cur)} al día` : ''
        }</p>
      </div>

      ${
        monthList.length
          ? `<div class="days-chart" role="img" aria-label="Gasto diario">
              ${perDay
                .map(
                  (v, i) =>
                    `<span class="${i + 1 === today ? 'is-today' : ''}${i + 1 > elapsed ? ' is-future' : ''}" style="--h:${v / maxDay}"></span>`
                )
                .join('')}
            </div>
            <div class="days-axis"><span>1</span><span>${Math.ceil(nDays / 2)}</span><span>${nDays}</span></div>`
          : ''
      }

      ${
        catRows.length && single
          ? `<ol class="breakdown">
              ${catRows
                .map(
                  ([c, v]) => `<li><button type="button" data-cat="${esc(c)}" aria-pressed="${ui.ledgerCat === c}" style="--p:${v / total}">
                    <span class="bd-name">${esc(c)}</span>
                    <span class="bd-pct">${Math.round((v / total) * 100)}%</span>
                    <span class="bd-amt">${money(v, cur)}</span>
                    <span class="bd-bar" aria-hidden="true"></span>
                  </button></li>`
                )
                .join('')}
            </ol>`
          : ''
      }

      ${ui.ledgerCat ? `<button type="button" class="filter-note" data-cat-clear>Solo ${esc(ui.ledgerCat)} ${icon.close}</button>` : ''}

      <div class="days">
        ${
          days.size
            ? [...days.entries()]
                .map(
                  ([date, list]) => `
              <section class="day">
                <h3><span>${esc(dayLabel(date))}</span>${single ? `<span>${money(sumCents(list), cur)}</span>` : ''}</h3>
                <ul>
                  ${list
                    .map((e) => {
                      const a = byId.get(e.acc);
                      const meta = [e.note ? e.cat : '', showAcc ? a.name : '', a.ledger && e.by ? e.by : ''].filter(Boolean);
                      return `<li><button type="button" class="row" data-edit="${e.id}">
                        <span class="row-note">${esc(e.note || e.cat || 'Gasto')}</span>
                        ${meta.length ? `<span class="row-meta">${meta.map(esc).join(' · ')}</span>` : ''}
                        <span class="row-amt">${money(e.amt, a.currency)}</span>
                      </button></li>`;
                    })
                    .join('')}
                </ul>
              </section>`
                )
                .join('')
            : `<p class="empty">Nada anotado en ${esc(monthName(key, false).toLowerCase())}.${
                isNow ? ` <a href="#/">Anotar un gasto</a>` : ''
              }</p>`
        }
      </div>
    </section>`;
}

view.addEventListener('click', (ev) => {
  if (ui.route !== 'ledger') return;
  const t = ev.target;
  const m = t.closest('[data-month]');
  if (m) {
    ui.month = shiftMonth(ui.month, Number(m.dataset.month));
    ui.ledgerCat = null;
    return renderLedger();
  }
  const s = t.closest('[data-scope]');
  if (s) {
    ui.ledgerAcc = s.dataset.scope;
    ui.ledgerCat = null;
    if (s.dataset.scope !== 'all') store.setCurrent(s.dataset.scope);
    return renderLedger();
  }
  const c = t.closest('[data-cat]');
  if (c) {
    ui.ledgerCat = ui.ledgerCat === c.dataset.cat ? null : c.dataset.cat;
    return renderLedger();
  }
  if (t.closest('[data-cat-clear]')) {
    ui.ledgerCat = null;
    return renderLedger();
  }
  const r = t.closest('[data-edit]');
  if (r) entrySheet(r.dataset.edit);
});

/* =========================================================
   Editar movimiento
   ========================================================= */

function entrySheet(id) {
  const e = store.entry(id);
  if (!e) return;
  const acc = store.account(e.acc);
  let cat = e.cat;
  const cats = acc.cats.includes(e.cat) || !e.cat ? acc.cats : [...acc.cats, e.cat];
  openSheet(
    `<form class="form" id="editForm" autocomplete="off">
      <div class="sheet-head">
        <h2 class="sheet-title">Movimiento</h2>
        <button type="button" class="icon-btn" data-close aria-label="Cerrar">${icon.close}</button>
      </div>
      <label class="field field-amount">
        <span class="field-label">Importe · ${esc(acc.name)}</span>
        <span class="field-amount-row">
          <input name="amt" inputmode="decimal" value="${esc(number(e.amt))}" required aria-label="Importe">
          <span>${esc(currencySymbol(acc.currency))}</span>
        </span>
      </label>
      <label class="field"><span class="field-label">Concepto</span>
        <input name="note" value="${esc(e.note)}" maxlength="80" autocapitalize="sentences"></label>
      <div class="field"><span class="field-label">Categoría</span>
        <div class="cats cats-wrap" id="editCats">
          ${cats.map((c) => `<button type="button" class="chip" aria-pressed="${c === cat}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
        </div>
      </div>
      <label class="field"><span class="field-label">Fecha</span>
        <input type="date" name="date" value="${e.date}" required></label>
      ${
        acc.ledger
          ? `<p class="sheet-text muted">${e.by ? `Anotado por ${esc(e.by)} · ` : ''}modificado ${esc(ago(e.at))}</p>`
          : ''
      }
      <div class="sheet-actions">
        <button type="button" class="btn btn-ghost btn-danger-text" data-del>Eliminar</button>
        <button type="submit" class="btn btn-ink">Guardar</button>
      </div>
    </form>`,
    (el) => {
      $('#editCats', el).addEventListener('click', (ev) => {
        const c = ev.target.closest('[data-cat]');
        if (!c) return;
        cat = cat === c.dataset.cat ? '' : c.dataset.cat;
        $$('#editCats [data-cat]', el).forEach((x) => x.setAttribute('aria-pressed', x.dataset.cat === cat));
      });
      $('#editForm', el).addEventListener('submit', (ev) => {
        ev.preventDefault();
        const f = ev.target;
        const amt = parseAmount(f.amt.value);
        if (!(amt > 0)) {
          f.amt.focus();
          return toast('Importe no válido');
        }
        const patch = { amt, note: f.note.value.trim(), cat, date: f.date.value || e.date };
        if (patch.amt !== e.amt || patch.note !== e.note || patch.cat !== e.cat || patch.date !== e.date) {
          store.updateEntry(id, patch);
        }
        closeSheet();
      });
      $('[data-del]', el).addEventListener('click', () => {
        store.deleteEntry(id);
        closeSheet();
        toast('Movimiento eliminado', { label: 'Deshacer', run: () => store.restoreEntry(id) });
      });
    }
  );
}

/* =========================================================
   Cuentas
   ========================================================= */

function renderAccounts() {
  const accs = store.accounts();
  const key = monthKey();
  const st = sync.getStatus();
  const by = store.settings().by;

  view.innerHTML = `
    <section class="accounts">
      <h1 class="page-title">Cuentas</h1>
      <ul class="acc-list">
        ${accs
          .map((a) => {
            const spent = sumCents(inMonth(store.entriesOf(a.id), key));
            return `<li><button type="button" class="acc-row" data-acc="${a.id}">
              <span class="acc-name">${esc(a.name)}</span>
              <span class="acc-sub">${a.ledger ? `<span class="code-inline">${esc(a.code)}</span>` : 'Solo en este dispositivo'}</span>
              <span class="acc-amt">${money(spent, a.currency)}</span>
            </button></li>`;
          })
          .join('')}
      </ul>
      <div class="row-actions">
        <button type="button" class="btn btn-ink" data-action="new">Nueva cuenta</button>
        <button type="button" class="btn" data-action="join">Unirme con código</button>
      </div>

      <h2 class="section-title">Este dispositivo</h2>
      <label class="field">
        <span class="field-label">Tu nombre en cuentas compartidas</span>
        <input id="byInput" value="${esc(by)}" maxlength="24" placeholder="Opcional" autocapitalize="words">
      </label>
      <div class="sync-line">
        <span class="sync-state" data-state="${st.state}">${esc(syncText(st))}</span>
        ${sync.enabled && accs.some((a) => a.ledger) ? `<button type="button" class="link" data-action="sync">Sincronizar ahora</button>` : ''}
      </div>

      <h2 class="section-title">Copia de seguridad</h2>
      <div class="row-actions">
        <button type="button" class="btn" data-action="export">Exportar</button>
        <button type="button" class="btn" data-action="csv">CSV</button>
        <button type="button" class="btn" data-action="import">Importar</button>
      </div>
      <input type="file" id="importFile" accept="application/json,.json" hidden>
      <p class="note">Todo se guarda en este navegador. Exporta de vez en cuando: si borras los datos del navegador, solo se recupera lo compartido.</p>
      <p class="note mono">Banksync · <a href="https://github.com/vmoren12/banksync" target="_blank" rel="noopener">código fuente</a></p>
    </section>`;
}

function syncText(st) {
  if (!sync.enabled) return 'Sincronización no configurada';
  if (!store.accounts().some((a) => a.ledger)) return 'Sin cuentas compartidas';
  switch (st.state) {
    case 'syncing':
      return 'Sincronizando…';
    case 'offline':
      return 'Sin conexión · se enviará al volver';
    case 'error':
      return `Error al sincronizar${st.error ? ': ' + st.error : ''}`;
    case 'ok':
      return sync.hasPending() ? 'Cambios pendientes' : `Sincronizado ${ago(st.at)}`;
    default:
      return 'Pendiente';
  }
}

view.addEventListener('click', async (ev) => {
  if (ui.route !== 'accounts') return;
  const a = ev.target.closest('[data-acc]');
  if (a) return accountSheet(a.dataset.acc);
  const act = ev.target.closest('[data-action]')?.dataset.action;
  if (act === 'new') newAccountSheet();
  else if (act === 'join') joinSheet();
  else if (act === 'sync') {
    await sync.syncAll();
    toast(syncText(sync.getStatus()));
  } else if (act === 'export') exportJson();
  else if (act === 'csv') exportCsv();
  else if (act === 'import') $('#importFile').click();
});

view.addEventListener('change', async (ev) => {
  if (ev.target.id === 'byInput') {
    store.setSetting('by', ev.target.value.trim());
    toast('Guardado');
  }
  if (ev.target.id === 'importFile') {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const r = store.importData(JSON.parse(await file.text()));
      toast(`Importado: ${r.accounts} cuentas nuevas, ${r.entries} movimientos`);
      sync.syncAll();
    } catch (err) {
      toast(err instanceof SyntaxError ? 'El archivo no es válido' : err.message);
    }
  }
});

function exportJson() {
  download(`banksync-${isoDate()}.json`, JSON.stringify(store.exportData(), null, 2), 'application/json');
}

function exportCsv() {
  const accs = new Map(store.accounts().map((a) => [a.id, a]));
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = store
    .allEntries()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((e) => {
      const a = accs.get(e.acc);
      return [e.date, q(a?.name ?? ''), q(e.cat), q(e.note), number(e.amt).replace(/\./g, ''), a?.currency ?? '', q(e.by)].join(';');
    });
  const csv = '﻿' + ['fecha;cuenta;categoria;concepto;importe;moneda;anotado_por', ...rows].join('\r\n');
  download(`banksync-${isoDate()}.csv`, csv, 'text/csv;charset=utf-8');
}

/* ---------- hojas de cuentas ---------- */

function newAccountSheet() {
  openSheet(
    `<form class="form" id="newAcc" autocomplete="off">
      <div class="sheet-head">
        <h2 class="sheet-title">Nueva cuenta</h2>
        <button type="button" class="icon-btn" data-close aria-label="Cerrar">${icon.close}</button>
      </div>
      <label class="field"><span class="field-label">Nombre</span>
        <input name="name" maxlength="32" placeholder="Casa, Viaje, Tarjeta…" required autocapitalize="sentences"></label>
      <div class="sheet-actions">
        <button type="button" class="btn btn-ghost" data-join>Tengo un código</button>
        <button type="submit" class="btn btn-ink">Crear</button>
      </div>
    </form>`,
    (el) => {
      const f = $('#newAcc', el);
      setTimeout(() => f.name.focus(), 50);
      f.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const acc = store.addAccount(f.name.value);
        closeSheet();
        toast(`Cuenta ${acc.name} creada`);
      });
      $('[data-join]', el).onclick = () => joinSheet();
    }
  );
}

function joinSheet(prefill = '') {
  if (!sync.enabled) {
    return openSheet(`<h2 class="sheet-title">Unirme con código</h2>
      <p class="sheet-text">La sincronización aún no está configurada en esta instalación de Banksync.</p>
      <div class="sheet-actions"><button type="button" class="btn btn-ink" data-close>Entendido</button></div>`);
  }
  openSheet(
    `<form class="form" id="joinForm" autocomplete="off">
      <div class="sheet-head">
        <h2 class="sheet-title">Unirme con código</h2>
        <button type="button" class="icon-btn" data-close aria-label="Cerrar">${icon.close}</button>
      </div>
      <p class="sheet-text">Introduce el código que te han pasado. Verás y anotarás en la misma cuenta.</p>
      <label class="field"><span class="field-label">Código</span>
        <input name="code" class="code-input" value="${esc(prefill)}" required autocapitalize="characters"
               spellcheck="false" placeholder="XXXX-XXXX-XXXX"></label>
      <p class="form-error" aria-live="polite"></p>
      <div class="sheet-actions"><button type="submit" class="btn btn-ink">Unirme</button></div>
    </form>`,
    (el) => {
      const f = $('#joinForm', el);
      if (!prefill) setTimeout(() => f.code.focus(), 50);
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const err = $('.form-error', el);
        const btn = $('[type=submit]', f);
        if (normalizeCode(f.code.value).length < MIN_CODE) return (err.textContent = `El código tiene al menos ${MIN_CODE} caracteres.`);
        btn.disabled = true;
        btn.textContent = 'Buscando…';
        try {
          const r = await sync.join(f.code.value);
          if (r.missing) {
            err.textContent = 'No existe ninguna cuenta con ese código.';
          } else {
            closeSheet();
            toast(r.already ? `Ya tienes ${r.account.name}` : `Unido a ${r.account.name}`);
            location.hash = '#/';
          }
        } catch (e) {
          err.textContent = navigator.onLine ? e.message : 'Sin conexión.';
        } finally {
          btn.disabled = false;
          btn.textContent = 'Unirme';
        }
      });
    }
  );
}

function accountSheet(id) {
  const acc = store.account(id);
  if (!acc) return;
  const shareLink = acc.code ? `${location.origin}${location.pathname}#/unirse/${encodeURIComponent(acc.code)}` : '';
  let auto = generateCode();

  openSheet(
    `<div class="form" id="accForm">
      <div class="sheet-head">
        <h2 class="sheet-title">${esc(acc.name)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Cerrar">${icon.close}</button>
      </div>
      <label class="field"><span class="field-label">Nombre</span>
        <input name="name" value="${esc(acc.name)}" maxlength="32" autocapitalize="sentences"></label>
      <div class="field-pair">
        <label class="field"><span class="field-label">Moneda</span>
          <select name="currency">${[...new Set([acc.currency, ...CURRENCIES])]
            .map((c) => `<option ${c === acc.currency ? 'selected' : ''}>${c}</option>`)
            .join('')}</select></label>
        <label class="field"><span class="field-label">Presupuesto mensual</span>
          <input name="budget" inputmode="decimal" value="${acc.budget ? esc(number(acc.budget)) : ''}" placeholder="Sin límite"></label>
      </div>
      <div class="field"><span class="field-label">Categorías</span>
        <div class="cats cats-wrap" id="catEdit">
          ${acc.cats
            .map((c) => `<span class="chip chip-edit">${esc(c)}<button type="button" data-rm="${esc(c)}" aria-label="Quitar ${esc(c)}">${icon.close}</button></span>`)
            .join('')}
          <input class="chip chip-input" id="catNew" placeholder="Añadir" maxlength="24" enterkeyhint="done" aria-label="Añadir categoría">
        </div>
      </div>

      <section class="share">
        <h3 class="section-title">Compartir</h3>
        ${
          acc.ledger
            ? `<p class="code-big" aria-label="Código">${esc(acc.code)}</p>
               <p class="sheet-text muted">Quien tenga este código puede ver y anotar en esta cuenta.</p>
               <div class="row-actions">
                 <button type="button" class="btn btn-ink" data-share-link>Enviar enlace</button>
                 <button type="button" class="btn" data-copy-code>Copiar código</button>
               </div>`
            : sync.enabled
              ? `<p class="sheet-text muted">Genera un código para anotar en esta cuenta desde otros móviles.</p>
                 <div class="seg" role="radiogroup">
                   <label><input type="radio" name="mode" value="auto" checked><span>Automático</span></label>
                   <label><input type="radio" name="mode" value="manual"><span>Elegir código</span></label>
                 </div>
                 <div class="code-row">
                   <input class="code-input" id="codeInput" value="${auto}" readonly spellcheck="false" autocapitalize="characters" aria-label="Código">
                   <button type="button" class="icon-btn" data-regen aria-label="Generar otro">
                     <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4"/></svg>
                   </button>
                 </div>
                 <p class="form-error" aria-live="polite"></p>
                 <button type="button" class="btn btn-ink btn-block" data-share>Compartir cuenta</button>`
              : `<p class="sheet-text muted">Para compartir, configura la sincronización (ver README del proyecto).</p>`
        }
      </section>

      <div class="danger-zone">
        ${acc.ledger ? `<button type="button" class="link" data-unlink>Dejar de sincronizar en este dispositivo</button>` : ''}
        <button type="button" class="link link-danger" data-remove>Eliminar cuenta</button>
      </div>
    </div>`,
    (el) => {
      const form = $('#accForm', el);
      const val = (n) => $(`[name="${n}"]`, form);

      val('name').addEventListener('change', (e) => {
        const name = e.target.value.trim();
        if (name && name !== acc.name) {
          store.updateMeta(id, { name });
          $('.sheet-title', el).textContent = name;
        }
      });
      val('currency').addEventListener('change', (e) => store.updateMeta(id, { currency: e.target.value }));
      val('budget').addEventListener('change', (e) => {
        const raw = e.target.value.trim();
        const b = raw ? parseAmount(raw) : null;
        if (raw && !(b > 0)) return toast('Presupuesto no válido');
        store.updateMeta(id, { budget: b });
        e.target.value = b ? number(b) : '';
      });

      const catBox = $('#catEdit', el);
      const paintCats = () => {
        const a = store.account(id);
        $$('.chip-edit', catBox).forEach((n) => n.remove());
        catBox.insertAdjacentHTML(
          'afterbegin',
          a.cats
            .map((c) => `<span class="chip chip-edit">${esc(c)}<button type="button" data-rm="${esc(c)}" aria-label="Quitar ${esc(c)}">${icon.close}</button></span>`)
            .join('')
        );
      };
      catBox.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-rm]');
        if (!rm) return;
        store.updateMeta(id, { cats: store.account(id).cats.filter((c) => c !== rm.dataset.rm) });
        paintCats();
      });
      $('#catNew', el).addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (store.addCategory(id, e.target.value)) paintCats();
        e.target.value = '';
      });
      $('#catNew', el).addEventListener('blur', (e) => {
        if (e.target.value.trim() && store.addCategory(id, e.target.value)) paintCats();
        e.target.value = '';
      });

      // compartir
      const codeInput = $('#codeInput', el);
      $$('[name="mode"]', el).forEach((r) =>
        r.addEventListener('change', () => {
          const manual = r.value === 'manual' && r.checked;
          codeInput.readOnly = !manual;
          codeInput.value = manual ? '' : auto;
          $('[data-regen]', el).hidden = manual;
          if (manual) {
            codeInput.placeholder = `Mínimo ${MIN_CODE} caracteres`;
            codeInput.focus();
          }
        })
      );
      $('[data-regen]', el)?.addEventListener('click', () => {
        auto = generateCode();
        codeInput.value = auto;
        haptic();
      });
      $('[data-share]', el)?.addEventListener('click', async (e) => {
        const err = $('.form-error', el);
        const code = codeInput.value.trim();
        if (normalizeCode(code).length < MIN_CODE) return (err.textContent = `Usa al menos ${MIN_CODE} letras o números.`);
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Compartiendo…';
        try {
          const r = await sync.share(id, code);
          if (r.taken) {
            err.textContent = 'Ese código ya está en uso. Elige otro.';
          } else {
            toast('Cuenta compartida');
            accountSheet(id);
            return;
          }
        } catch (ex) {
          err.textContent = navigator.onLine ? ex.message : 'Sin conexión.';
        }
        btn.disabled = false;
        btn.textContent = 'Compartir cuenta';
      });
      $('[data-copy-code]', el)?.addEventListener('click', () => copy(acc.code));
      $('[data-share-link]', el)?.addEventListener('click', async () => {
        const text = `Únete a «${store.account(id).name}» en Banksync. Código: ${acc.code}`;
        if (navigator.share) {
          try {
            await navigator.share({ title: 'Banksync', text, url: shareLink });
          } catch {}
        } else copy(`${text}\n${shareLink}`);
      });

      $('[data-unlink]', el)?.addEventListener('click', async () => {
        const r = await confirmSheet({
          title: 'Dejar de sincronizar',
          text: 'La cuenta y sus movimientos se quedan en este dispositivo, pero dejarán de actualizarse. Podrás volver a unirte con el código.',
          ok: 'Dejar de sincronizar',
        });
        if (r === 'ok') {
          sync.unlink(id);
          toast('Ya no se sincroniza');
        }
      });
      $('[data-remove]', el).addEventListener('click', async () => {
        const a = store.account(id);
        const r = await confirmSheet(
          a.ledger
            ? {
                title: `Eliminar ${a.name}`,
                text: 'Puedes quitarla solo de este dispositivo o borrarla del servidor para todas las personas que la comparten.',
                ok: 'Solo de este dispositivo',
                alt: 'Borrar para todos',
                danger: true,
              }
            : { title: `Eliminar ${a.name}`, text: 'Se borrarán la cuenta y todos sus movimientos de este dispositivo.', ok: 'Eliminar', danger: true }
        );
        if (r === 'no') return;
        if (r === 'alt') {
          try {
            await sync.destroy(id);
          } catch (ex) {
            return toast(navigator.onLine ? ex.message : 'Sin conexión. No se ha borrado nada.');
          }
        }
        store.removeAccount(id);
        toast('Cuenta eliminada');
      });
    }
  );
}

/* =========================================================
   Sincronización y arranque
   ========================================================= */

const dot = $('#syncDot');
sync.onStatus((st) => {
  const shared = store.accounts().some((a) => a.ledger);
  dot.dataset.state = !sync.enabled || !shared ? 'off' : sync.hasPending() && st.state !== 'syncing' ? 'pending' : st.state;
  dot.title = syncText(st);
  if (ui.route === 'accounts' && !sheet.open) {
    const el = $('.sync-state');
    if (el) {
      el.textContent = syncText(st);
      el.dataset.state = st.state;
    }
  }
});

const scheduleSync = debounce(() => sync.syncAll(), 1200);
let lastRemoved = [];

store.subscribe(() => {
  if (ui.route === 'add') {
    if ($('.add', view) && !$('.chip-input', view)) paintAddMeta();
    paintAmount();
  } else if (ui.route === 'accounts') {
    if (!view.contains(document.activeElement) || document.activeElement === document.body) renderAccounts();
  } else render();
  if (sync.hasPending()) {
    dot.dataset.state = navigator.onLine ? 'pending' : 'offline';
    scheduleSync();
  }
});

async function syncNow() {
  const removed = (await sync.syncAll()) || [];
  const notify = removed.length > 0 && removed.join() !== lastRemoved.join();
  if (notify) toast(`${removed.join(', ')} ya no existe en el servidor. Se conserva en local.`);
  lastRemoved = removed;
  return notify;
}

$('#brand').addEventListener('click', () => {
  if (!sync.enabled || !store.accounts().some((a) => a.ledger)) return (location.hash = '#/');
  syncNow().then((notified) => notified || toast(syncText(sync.getStatus())));
});

window.addEventListener('hashchange', route);
window.addEventListener('online', syncNow);
window.addEventListener('offline', () => sync.syncAll());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (ui.draft.date !== isoDate() && !ui.draft.amount) ui.draft.date = isoDate();
    syncNow();
    render();
  }
});
setInterval(() => document.visibilityState === 'visible' && syncNow(), 30000);
setInterval(() => ui.route === 'add' && document.visibilityState === 'visible' && $('.add', view) && paintAddMeta(), 60000);

// Pedir almacenamiento persistente para que el navegador no purgue los datos.
navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // Si se instala una versión nueva, recarga para usarla (salvo que haya un importe a medias).
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !ui.draft.amount && !sheet.open) location.reload();
  });
  navigator.serviceWorker
    .register('./sw.js', { updateViaCache: 'none' })
    .then((reg) => document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update()))
    .catch((err) => console.warn('SW', err));
}

store.compact();
route();
syncNow();
