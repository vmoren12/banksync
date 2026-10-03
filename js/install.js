// Botón flotante para instalar la PWA.
// - Chrome, Edge, Samsung Internet (Android y escritorio): usa el diálogo nativo.
// - iOS / iPadOS: no hay diálogo nativo; explica cómo añadirla a la pantalla de inicio.
// - Desaparece en cuanto la app se instala o se abre ya instalada.

const DISMISS_KEY = 'banksync:install-dismissed';

const standalone = () =>
  matchMedia('(display-mode: standalone)').matches ||
  matchMedia('(display-mode: fullscreen)').matches ||
  navigator.standalone === true;

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const storage = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
    } catch {}
  },
};

let deferred = null;
let btn = null;
let opts = {};

function show(visible) {
  btn.hidden = !visible;
  if (visible) place();
}

/** En Anotar se coloca en el hueco libre junto al resumen; en el resto, en la esquina inferior. */
export function place() {
  if (!btn || btn.hidden) return;
  const anchor = opts.anchor?.();
  btn.classList.toggle('is-top', Boolean(anchor));
  btn.style.top = anchor ? `${anchor.getBoundingClientRect().top + 10}px` : '';
}

function iosSheet() {
  opts.openSheet(
    `<div class="sheet-head">
       <h2 class="sheet-title">Instalar Banksync</h2>
       <button type="button" class="icon-btn" data-close aria-label="Cerrar">
         <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
       </button>
     </div>
     <ol class="steps">
       <li>Pulsa el botón <b>Compartir</b>
         <svg class="inline-icon" viewBox="0 0 24 24" aria-label="icono Compartir"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5v10h14V11h-1"/></svg>
         en la barra del navegador. Si no lo ves, ábrelo desde el menú <b>···</b>.</li>
       <li>Elige <b>Añadir a pantalla de inicio</b>.</li>
       <li>Confirma con <b>Añadir</b>. Banksync se abrirá a pantalla completa, como una app.</li>
     </ol>
     <div class="sheet-actions">
       <button type="button" class="btn btn-ghost" data-dismiss>No mostrar más</button>
       <button type="button" class="btn btn-ink" data-close>Entendido</button>
     </div>`,
    (el) => {
      el.querySelector('[data-dismiss]').onclick = () => {
        storage.set(DISMISS_KEY, '1');
        show(false);
        opts.closeSheet();
      };
    }
  );
}

async function onClick() {
  if (deferred) {
    const prompt = deferred;
    deferred = null;
    prompt.prompt();
    show(false);
    // Si lo rechaza, el navegador volverá a emitir beforeinstallprompt más adelante
    // y el botón reaparecerá; si acepta, llega appinstalled.
    await prompt.userChoice;
    return;
  }
  if (isIos()) iosSheet();
}

export function initInstall(options) {
  opts = options;
  btn = document.getElementById('installBtn');
  if (!btn) return;
  btn.addEventListener('click', onClick);

  if (standalone()) return show(false);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    show(true);
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    show(false);
  });

  matchMedia('(display-mode: standalone)').addEventListener?.('change', (e) => e.matches && show(false));

  if (isIos() && !storage.get(DISMISS_KEY)) show(true);

  addEventListener('resize', place);
}
