# Banksync

Anota tus gastos en segundos, desde el móvil, en una o varias cuentas. Comparte una cuenta con otras personas usando un código, sin registro.

**App: <https://vmoren12.github.io/banksync/>**

- **Teclado propio**: abres la app, tecleas el importe, pulsas *Anotar*. El concepto, la categoría y la fecha son opcionales.
- **Varias cuentas**: solo con un nombre (Personal, Casa, Viaje…). No se piden datos bancarios.
- **Categorías**: opcionales. Si repites un concepto, Banksync recuerda su categoría.
- **Presupuesto mensual** por cuenta, con una marca del ritmo de gasto esperado para el día del mes.
- **Libro mensual**: total, gasto diario, desglose por categoría y movimientos agrupados por día.
- **Cuentas compartidas**: un código, generado o elegido, o un enlace para enviar por mensaje.
- **Sin registro, local primero**: todo vive en el navegador y funciona sin conexión. Solo las cuentas compartidas se sincronizan.
- **Exportar e importar** en JSON (copia completa) y exportación a CSV para hojas de cálculo.
- **Instalable** como app (PWA) y con modo oscuro automático.

## Cómo funciona

```
navegador (localStorage)  ──  cuenta local: nunca sale del dispositivo
          │
          └── cuenta compartida ──►  Supabase  (función bs_sync)
                                     identificada por SHA-256(código)
```

- Los importes se guardan en céntimos enteros, así no hay errores de redondeo.
- Cada movimiento lleva su marca de tiempo. Al sincronizar gana la versión más reciente, y los borrados se propagan como lápidas.
- La sincronización es automática: al anotar, al volver a la app, al recuperar la conexión y cada 30 s mientras está abierta. El punto junto al logotipo indica el estado (relleno: al día; hueco: pendiente; latiendo: sincronizando; rojo: error). Pulsa el logotipo para sincronizar en ese momento.

### Seguridad

- El servidor nunca ve el código, solo su hash SHA-256. Sin el código no se puede leer, listar ni modificar nada.
- Las tablas no son accesibles desde la API. Todo pasa por dos funciones (`bs_sync`, `bs_delete`) que exigen el hash.
- **Quien tenga el código tiene acceso completo a esa cuenta.** Los códigos automáticos (`XXXX-XXXX-XXXX`, unos 59 bits de entropía) son prácticamente imposibles de adivinar. Si eliges un código propio, que sea largo.
- La clave de Supabase que hay en `js/config.js` es pública por diseño. Con ella solo se pueden ejecutar esas dos funciones.

## Puesta en marcha del backend (Supabase)

Solo hace falta para compartir cuentas. Sin backend, la app funciona en local.

1. Crea una cuenta gratuita en <https://supabase.com> y pulsa **New project**.
   - Nombre: `banksync`. Región: la más cercana (por ejemplo, *West EU*).
   - Pon una contraseña de base de datos y guárdala, aunque Banksync no la usa.
2. Cuando el proyecto esté listo, ve a **SQL Editor → New query**, pega el contenido de [`supabase/schema.sql`](supabase/schema.sql) y pulsa **Run**. Debe salir *Success. No rows returned*.
3. Ve a **Project Settings → API Keys** y copia:
   - la **Project URL** (`https://xxxxxxxx.supabase.co`), que también aparece en *Project Settings → Data API*;
   - la **publishable key** (`sb_publishable_…`). En proyectos antiguos se llama **anon public**. Cualquiera de las dos sirve.
   - **No uses nunca** la `secret` / `service_role` key.
4. Edita [`js/config.js`](js/config.js) con esos dos valores:
   ```js
   export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
   export const SUPABASE_KEY = 'sb_publishable_xxxxxxxxxxxx';
   ```
5. Haz commit y push. GitHub Pages publicará la nueva versión en uno o dos minutos.

> En el plan gratuito, Supabase pausa los proyectos que pasan 7 días sin actividad. Si ocurre, entra en el panel y pulsa **Restore**. Tus datos locales no se ven afectados.

## Publicación en GitHub Pages

1. En el repositorio: **Settings → Pages → Build and deployment**.
2. *Source*: **Deploy from a branch**. *Branch*: `main` y carpeta `/ (root)`. Guarda.
3. En la portada del repositorio, pulsa el engranaje de **About** y pega `https://vmoren12.github.io/banksync/` en *Website*.

## Desarrollo

No hay dependencias ni paso de compilación: HTML, CSS y módulos ES.

```sh
# cualquier servidor estático sirve
npx serve .
# o
python -m http.server 8000
```

Abre `http://localhost:8000`. `crypto.subtle`, necesario para compartir, solo funciona en `localhost` o con HTTPS.

```
index.html              estructura
css/styles.css          sistema visual (tokens claro/oscuro)
js/app.js               vistas, navegación e interacción
js/store.js             estado local, persistencia, importación y exportación
js/sync.js              cliente de sincronización con Supabase
js/util.js              dinero, fechas, códigos y hash
js/config.js            URL y clave pública de Supabase
sw.js                   service worker (uso sin conexión)
supabase/schema.sql     tablas y funciones del backend
```

### Formato de exportación

```json
{
  "app": "banksync",
  "format": 1,
  "accounts": [{ "id": "…", "name": "Casa", "currency": "EUR", "budget": 60000, "cats": ["Comida"], "code": "…" }],
  "entries": [{ "id": "…", "acc": "…", "amt": 1240, "note": "Mercado", "cat": "Comida", "date": "2026-10-03" }]
}
```

Al importar se fusiona con lo que ya hay: no se duplican movimientos y, si un movimiento existe en los dos lados, gana la versión más reciente. Las cuentas compartidas importadas vuelven a sincronizarse solas.

## Licencia

[MIT](LICENSE). Tipografías [Archivo](https://github.com/Omnibus-Type/Archivo) y [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono), ambas bajo SIL Open Font License.
