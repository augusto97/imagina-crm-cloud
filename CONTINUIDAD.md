# CONTINUIDAD — el salvavidas del proyecto

> **Para qué existe este archivo.** Si la conversación de desarrollo con Claude
> Code se pierde (error, contexto agotado, sesión borrada), una sesión NUEVA lee
> esto y sigue trabajando como si nada: cómo trabajamos, cómo se publica, cómo
> llegan las actualizaciones a los servidores, cómo es el servidor, qué está
> configurado, qué decisiones se tomaron y qué quedó pendiente.
>
> **Regla permanente:** este archivo se actualiza EN CADA RELEASE (sección §11
> «Bitácora» y, si cambia, §10 «Estado actual» / «Hilos abiertos»). Es parte del
> ritual de release (§4), igual que `VERSION` y el bullet de `CLAUDE.md` §5.

---

## 0. Cómo arrancar una sesión nueva (copiar y pegar)

1. Abrí Claude Code (web: claude.ai/code) sobre el repo
   **`augusto97/imagina-crm-cloud`**. Si podés, elegí el **mismo entorno** de
   siempre (red «Personalizado», ver §6.1).
2. Pegale este mensaje como primer pedido:

```
Seguimos con el desarrollo de Imagina Base. Antes de hacer nada leé, en este
orden: CONTINUIDAD.md (completo), CLAUDE.md (sobre todo §3, §4 y las últimas
entradas de §5), y STANDALONE.md por encima (los ADR-S20 en adelante). Después
levantá el entorno con `sh scripts/dev/up.sh` y decime en qué versión estamos,
qué quedó pendiente según CONTINUIDAD.md §10 y si el último PR quedó mergeado.
No cambies nada todavía.
```

3. Cuando conteste, seguí normal ("ahora quiero…"). La sesión nueva no recuerda
   la conversación, pero TODO lo que importa está en estos archivos.

---

## 1. El proyecto en un minuto

- **Imagina Base**: SaaS multi-tenant tipo Airtable/ClickUp (listas con campos,
  vistas, tableros, automatizaciones, portal del cliente, integraciones). NO es
  un CRM: un CRM es un caso de uso que el cliente arma. Repo histórico
  `imagina-crm-cloud` (ADR-S10).
- Nació como **evolución del plugin WordPress `imagina-crm`**: el frontend
  (`apps/web/`) es un fork del `app/` del plugin; el backend es propio (NestJS).
  El plugin ya NO se desarrolla en este repo; queda como referencia:
  `HANDOFF.md` (lecciones caras del plugin), `CONTRACT.md` (especificación
  funcional heredada), `reference/plugin-backend/` (PHP original, solo lectura).
  Todo lo WP-only ya se eliminó del fork (v0.1.47–48).
- **Stack**: Node 22 + TypeScript estricto · NestJS (Fastify) · Drizzle ·
  PostgreSQL 16 con RLS · Redis 7 + BullMQ · Zod compartido en
  `packages/shared` · React 18 + TanStack Query/Table + Zustand + Tailwind
  (prefijo `imcrm-`) · pnpm workspaces + Turborepo.
- **Versión actual**: ver `VERSION` (al escribir esto: **0.1.251**).
- **Documentos** (todos en la raíz salvo runbooks):
  | Archivo | Qué es |
  |---|---|
  | `CONTINUIDAD.md` | ESTE: cómo trabajamos, publicamos, servidor, estado, bitácora |
  | `CLAUDE.md` | Reglas de oro + historial detallado de CADA versión (§5) |
  | `STANDALONE.md` | Arquitectura y ADRs (fuente de verdad técnica) |
  | `HANDOFF.md` / `CONTRACT.md` | Herencia del plugin |
  | `docs/runbook-*.md` | Operación: deploy, ServerAvatar, updates, backups, PITR, migración, dominios, pagos |
  | `docs/mcp.md` | El servidor MCP de la app (conectar Claude/Cursor) |

---

## 2. Con quién trabajás y cómo le gusta trabajar

El usuario (`augusto97` en GitHub) es el **dueño del producto y operador** de
la plataforma, con clientes en Colombia. Escribe en español, desde la compu o
**desde el celular** (a veces publica desde el teléfono). No programa el día a
día: describe lo que quiere, manda **capturas**, prueba en su servidor y
reporta. Ya tiene clientes reales (~10 empresas).

**Cómo responderle**
- En **español**, con **voseo** ("hacé", "tocá", "fijate") — igual que los
  textos de la UI. Claro, sin jerga; si hay que explicar algo técnico, en
  criollo y con el "para qué".
- Al terminar: qué se hizo, **qué tiene que probar él** y los **límites
  honestos** (qué no se pudo verificar y por qué). Nunca decir "listo" sin
  haberlo verificado; si algo falló, decirlo.
- Cuando pregunta "¿se puede…?" o "analizá qué podemos hacer": analizar
  opciones (mirando cómo lo hacen ClickUp/Airtable/Zapier/n8n), recomendar UNA
  y esperar su OK. Cuando dice **"hacelo todo" / "has todas las fases" / "has
  todo lo faltante"**: implementar TODO sin volver a preguntar, en uno o varios
  releases seguidos.
- Si preguntó algo puntual, contestar eso (no aprovechar para cambiar código).

**Lo que valora (aprendido a los golpes)**
- **ClickUp es la referencia de UX** casi siempre. Manda capturas de ClickUp y
  espera la misma FORMA, no un parecido cosmético (v0.1.59 → v0.1.60).
- **Simple para un usuario común.** Nada de pedirle a un cliente datos técnicos
  (v0.1.203: la sección de conectores era "para desarrolladores" y se rehízo
  como galería de apps). Si algo se puede elegir, que se elija, no se tipee
  (v0.1.191).
- **Que se vea premium/bonito**, no "a medio camino" (v0.1.234–236). Si un
  diseño se ve básico o repetido, lo va a decir.
- **Celular siempre**: todo cambio de UI se verifica también a 390 px de ancho
  (v0.1.165, v0.1.169).
- **NO tocar lo que no pidió.** Incidente real (v0.1.162–163): se pidió cambiar
  el administrador de campos y se modificó también el panel de "agregar campo";
  se enojó con razón. Acotar el cambio a lo pedido.
- **Nada de pasos manuales en el servidor** si se puede evitar: prefiere que la
  corrección viaje en un release (v0.1.186, v0.1.227). Si algo DEBE hacerse a
  mano, darle los pasos exactos y explicar por qué.
- Rendimiento: nota cuando algo se siente lento; medir, no suponer (v0.1.224).
- Seguridad: pidió auditorías integrales; se hicieron 4 tandas (SEC-21…37).

---

## 3. Reglas técnicas que no se negocian

Están en `CLAUDE.md` §3 y §4; las más importantes:
1. El **ID** es la verdad; el slug es etiqueta editable. Datos JSONB en
   `records.data` con claves `"f{field_id}"`.
2. Todo shape en `packages/shared` (Zod) — mismo schema front y back.
3. `tenant_id` + **RLS** en toda tabla de datos; toda query en `withTenant`
   (`SET LOCAL app.tenant_id`). Tabla nueva ⇒ test de RLS.
4. QueryBuilder con whitelist: jamás interpolar input en SQL.
5. Monolito modular (nada de microservicios).
6. queryKeys de TanStack: identificador en el índice 1; invalidar con
   `invalidateForList` (id **y** slug). Es la clase de bug más repetida
   (v0.1.68, 81, 83, 85, 105, 149).
7. Batch endpoints, nada de N+1.
8. Los datos del cliente nunca se secuestran: impago = solo-lectura + export.
9. **Fallar en voz alta**: nunca degradar en silencio a "enviado/ok" (lección
   v0.1.150). Secretos cifrados con `SECRETS_KEY`, nunca vuelven al cliente
   (sólo un hint `…1234`).

Orden de trabajo de una feature: **schema Zod en shared → migración Drizzle →
service + repo con tests → endpoint → frontend → E2E en navegador**.

---

## 4. Ritual de release (cómo publicamos en GitHub)

Cada cambio entregable es una **versión** `0.1.N` (se incrementa de a una).

**Rama**: se desarrolla en la rama asignada a la sesión. Hasta ahora fue siempre
`claude/f0-monorepo-nestjs-setup-5f5ij3`. Si una sesión nueva tiene OTRA rama
asignada en sus instrucciones, usar ésa (mismo flujo).

Pasos (en este orden):
1. Implementar + tests + typecheck + lint + E2E (ver §7).
2. `VERSION` → `0.1.N`.
3. `CLAUDE.md` §5: agregar el bullet `- [x] **Título (v0.1.N, contexto/reporte
   del usuario)**: …` al final de la fase en curso (mismo estilo de los
   anteriores: qué, por qué, cómo, bugs encontrados, tests y E2E).
4. Si es decisión de arquitectura: ADR nuevo en `STANDALONE.md` (`ADR-S32`, …)
   y subir «Versión del documento» al final del archivo.
5. **`CONTINUIDAD.md`**: entrada en §11 (Bitácora) y actualizar §10 si cambió
   el estado o los pendientes.
6. Commit (conventional commits en español: `feat(área): …`, `fix(área): …`).
   El mensaje termina con las líneas de atribución que indique la sesión
   (hasta ahora: `Co-Authored-By: …` + `Claude-Session: …`). **Nunca** poner el
   nombre/ID del modelo en commits, PRs ni código.
   Lo usamos así: `git -c core.hooksPath=/dev/null commit -q -F mensaje.txt`.
7. `git push -u origin <rama>` (reintentar con backoff si falla la red).
8. Crear el PR contra `main` con las herramientas MCP de GitHub (no hay `gh`
   CLI completo). Título = título del commit; cuerpo con resumen + pruebas,
   terminado en `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
9. Suscribirse al PR (`subscribe_pr_activity`) y esperar el check **`ci`**.
10. Con `ci` en verde: **squash merge** con título `<título> (#PR)` y
    `expectedHeadSha` = sha del head. Desuscribirse.
11. Volver la rama a main:
    `git fetch origin main && git checkout -B <rama> origin/main && git push --force-with-lease origin <rama>`
    (un PR mergeado no se reutiliza; la próxima versión arranca limpia).
12. Si `ci` falla: diagnosticar, arreglar, push, esperar de nuevo.

**CI** (`.github/workflows/ci.yml`): en cada PR corre `lint typecheck build
test` de `shared` + `api` (Postgres/Redis por Testcontainers). El front
(`apps/web`) NO está en el CI → correr a mano `pnpm --filter @imagina-base/web
typecheck lint test` y `build:cloud` antes de publicar.

---

## 5. Cómo llegan las actualizaciones a los servidores (ADR-S13)

1. **Mergear a `main` publica solo**: `.github/workflows/release.yml` corre en
   cada push a main y, si `v$(cat VERSION)` todavía no existe como GitHub
   Release, compila (shared → api → web), arma un **bundle autocontenido**
   (`imagina-base-<v>.zip`: API compilado + node_modules de prod + SPA +
   migraciones + scripts de `deploy/` y `scripts/`) + su `.sha256` y publica el
   Release `v<versión>`. (Por eso **subir `VERSION` es lo que dispara un
   release**; un merge sin cambiar VERSION no publica nada.)
2. **Cada servidor detecta** el release nuevo cada hora (o con «Buscar») en
   **Plataforma → Actualizaciones** (sólo superadmin).
3. El superadmin toca **«Actualizar»**: descarga, verifica el sha256, extrae en
   `releases/<ts>_<v>`, corre migraciones, flip atómico del symlink `current`,
   reinicio por `finalize.sh` con health-check y **rollback automático** si
   falla. Detalle: `docs/runbook-updates.md`.
4. **Lo que la auto-actualización NO toca**: la config del proxy (nginx /
   ServerAvatar / Caddy), el `.env.production`, systemd. Por eso las
   correcciones se diseñan para viajar DENTRO de la app (v0.1.186 estáticos
   OAuth generados por `deploy.sh`; v0.1.227 HSTS/CSP desde el API/HTML).
5. **Firma de releases (SEC-37)**: soportada pero **NO configurada** — el
   usuario decidió dejarla así (publica a veces desde el celular). Sin el
   secreto `RELEASE_SIGNING_KEY` los releases salen sin `.sig` y los servidores
   sin `UPDATER_PUBLIC_KEY` los aceptan (sólo sha256).

---

## 6. Servidores

### 6.1 Producción del usuario
- **URL**: `https://base.imagina.cloud` (la instancia del usuario, con sus
  clientes).
- **Hosting**: VPS Ubuntu administrado con **ServerAvatar** — stack **Nginx +
  Node.js**, app tipo "Static HTML" con document root
  `/opt/imagina-base/current/web`, `location`s de `/api` y `/socket.io` al API
  (3001). **PostgreSQL 16 en Docker**, **Redis del stack** de ServerAvatar.
  Paso a paso completo: `docs/runbook-serveravatar.md`.
- **Layout**: `/opt/imagina-base/{releases/,shared/,current -> releases/…}`;
  config en `/opt/imagina-base/shared/.env.production`; servicio systemd
  `imagina-api`; uploads en `shared/uploads`.
- **Superadmin de plataforma**: los emails de `PLATFORM_SUPERADMINS` (el del
  usuario). La consola está en el riel → «Plataforma».
- **Acceso**: Claude NO tiene SSH al servidor. El usuario entra por la consola
  web de ServerAvatar cuando hace falta. Para diagnosticar datos reales hay un
  **conector MCP "Imagina Base"** (el MCP de la propia app, ADR-S21) que el
  usuario conectó a claude.ai: si está disponible en la sesión
  (`mcp__Imagina_Base_*`), sirve para LEER esquemas, automatizaciones y
  registros de producción (así se diagnosticaron v0.1.204 y v0.1.229). Las
  herramientas `propose_*`/`apply_proposal` escriben en producción: usarlas
  sólo si el usuario lo pide.
- **Dominios propios de las empresas** (ADR-S17/S28): por **ServerAvatar**
  (decisión del usuario, v0.1.246 — Caddy con certificados automáticos queda
  para cuando haya muchos clientes). La app avisa por correo al superadmin y
  lista en Plataforma → Dominios qué alias agregar/quitar a mano.
- **Backups**: Plataforma → Copias de seguridad (snapshots diarios
  automáticos, ADR-S20). Migración de servidor: `docs/runbook-migration.md`.

### 6.2 Configuración externa ya hecha / en curso (estado conocido)
- **Google OAuth** (Integraciones de Gmail/Calendar/Sheets): app registrada en
  Google Cloud por el usuario, en estado **«En prueba»** (hasta 100 usuarios;
  las conexiones vencen a los 7 días hasta publicar). Le faltaba **el video**
  para la verificación (v0.1.247 trae la guía y el guion). Páginas legales
  públicas en `/api/v1/public/legal[/privacidad|/terminos]`.
- **WhatsApp**: integración con **was.imagina.cloud** (app propia del usuario,
  API estilo Zender: `/api/send/whatsapp`, `/api/get/wa.accounts`). La clave
  de envío puede no tener permiso para listar cuentas (v0.1.204).
- **Mercado Pago / Wompi / PayPal**: código listo (v0.1.250–251) pero **sin
  prueba con credenciales reales** — proveedores simulados en el sandbox.
- **Correo**: SMTP de plataforma se configura en Plataforma → Correo; sin él,
  en producción los correos de cuenta responden 503 con el motivo (v0.1.238).

---

## 7. Entorno de desarrollo (Claude Code en la nube)

### 7.1 Red del entorno
El entorno de Claude Code del usuario usa la política de red
**«Personalizado»** (se configuró en v0.1.214 para poder bajar WordPress,
paquetes, imágenes Docker). Si una sesión nueva no puede hacer `pnpm install`,
`docker pull` o bajar algo: es la red del entorno — el usuario la cambia en la
configuración del entorno de claude.ai/code (usar la herramienta
`read_documentation` topic `environment.network` para darle los pasos).
Dominios que suelen estar bloqueados igual: pse.com.co, algunos sitios de
proveedores.

### 7.2 Levantar todo (contenedor nuevo)
```bash
sh scripts/dev/up.sh       # dockerd + Postgres/Redis + install + build + migrate + API + vite + superadmin
```
- App: http://localhost:5174 (vite, proxy `/api` → 3001) · API: http://localhost:3001
- Usuario de pruebas (superadmin, tenant 1): **`e2e@test.local` / `Superadmin-pass-1`**
- Logs: `/tmp/imagina-dev/{api,vite,dockerd}.log`
- Después de cambiar el API: `pnpm --filter @imagina-base/api build && sh scripts/dev/restart.sh`
- Después de tocar `packages/shared`: `pnpm --filter @imagina-base/shared build`
  para el **API** (usa el `dist`) y reiniciarlo. El **front** lo lee del
  fuente desde v0.1.256 (alias en `vite.cloud.config.ts`): vite lo recarga
  solo, ya no hace falta borrar `.vite` (la trampa de v0.1.167/176/198).
- **El API NO migra al arrancar**: tras una migración nueva, `pnpm db:migrate`.
- Base de dev: `docker exec -it imagina-base-postgres-1 psql -U imagina -d imagina_base`.
- El tenant de dev arranca en plan `trial` (500 registros): para pruebas
  grandes, subirlo a mano (`update tenants set plan='pro' where id=1`).

### 7.3 Tests
- API: `pnpm --filter @imagina-base/api test` (Vitest + Testcontainers: levanta
  su propio Postgres/Redis; Docker tiene que estar corriendo). ~970 tests,
  ~6-8 min. Un spec puntual: `pnpm --filter @imagina-base/api exec vitest run test/x.spec.ts`.
- Front: `pnpm --filter @imagina-base/web test` (~226). Shared: `… shared test` (~129).
- Typecheck/lint: `pnpm --filter <pkg> typecheck` / `lint`.
- **OJO al crear specs**: no sobrescribir un spec existente (pasó con
  `safe-fetch.spec.ts`, v0.1.157). Señal: el total de tests BAJA.

### 7.4 E2E en navegador (así se verificó cada release)
- Chromium preinstalado en `/opt/pw-browsers/chromium` (no correr
  `playwright install`). Plantilla: `scripts/dev/e2e-template.mjs` (instrucciones
  adentro). Las pruebas imprimen `✓/✗` y un total `N/N`; se reporta ese número
  en el bullet del release. Siempre: escritorio + celular (390×844) y, si
  aplica, modo oscuro. Capturas con `page.screenshot` y mirarlas.
- **Dobles de prueba** (servidores falsos con la forma real de cada API):
  - `scripts/dev/fake-woo.mjs [puerto=9911]` — tienda WooCommerce (wc/v3,
    pedidos, variaciones, meta, paginación, webhooks). `FAKE_WOO_STRIP_AUTH=1`
    simula hosting que tira `Authorization`.
  - `scripts/dev/fake-collect.mjs` (puerto 4898) — Mercado Pago + Wompi
    (`start-api.sh` ya apunta `MERCADOPAGO_API_URL`/`WOMPI_*` ahí).
  - `scripts/dev/serve-prod.mjs <dist-cloud> [5180]` — sirve el BUILD de
    producción como nginx (para probar CSP, HSTS, OAuth estáticos).
- `DEV_ALLOW_PRIVATE_EGRESS=1` (ya en `start-api.sh`) deja que webhooks/
  integraciones lleguen a esos servidores locales; en producción se ignora.
- Pruebas contra servicios REALES que se hicieron alguna vez (no quedaron en el
  repo, se rearman si hace falta): WordPress + WooCommerce 11 con PHP/MariaDB
  locales (v0.1.214+), SQL Server 2022 en Docker (v0.1.243), servidor SMTP
  local (v0.1.150, 249).

---

## 8. Mapa del código

- `packages/shared/src/schemas/` — TODOS los shapes Zod (+ lógica pura
  compartida: validador de valores, reglas de la tienda, edición masiva,
  plantillas, guías de proveedores…). Se compila (`build`) y lo consumen api y web.
- `apps/api/src/<módulo>/` — un módulo Nest por dominio: `lists fields records
  views automations dashboards aggregate tenancy auth members workspaces
  platform billing payments collections connectors sync (WooCommerce) sql-sync
  ai (asistente + MCP + OAuth) portal public-lists domains mail files import
  export templates update (auto-update) …`. Controller delgado → Service →
  Repository (Drizzle).
- `apps/api/src/db/schema/` + `apps/api/src/db/migrations/NNNN_*.sql` +
  `meta/_journal.json` (al agregar una migración a mano, sumar la entrada al
  journal con `idx` y `when` crecientes). Última: **0062_collections**.
- `apps/api/test/*.spec.ts` — integración con Postgres/Redis reales.
- `apps/web/app/` — `admin/` (UI heredada del plugin, la principal), `cloud/`
  (shell cloud: sesión, páginas de Ajustes/Plataforma/Integraciones),
  `cloud-portal/` + `portal/` (SPA del portal del cliente), `lib/api.ts`
  (adaptador del fork al API), `lib/cloud/client.ts` (cliente tipado).
- `deploy/` (nginx, Caddy, systemd, deploy.sh, finalize.sh) · `scripts/`
  (backups, snapshots, PITR, bootstrap de servidor) · `scripts/dev/` (entorno
  de desarrollo y pruebas).

---

## 9. Trampas conocidas (resumen; detalle en CLAUDE.md §5)

- `parseListQuery` es whitelist: un query param nuevo hay que copiarlo a mano
  (v0.1.68, 132, 187).
- Zod descarta claves desconocidas EN SILENCIO (v0.1.69, 85, 87).
- Nest responde 201 a todo POST; Fastify ya trae parser urlencoded (v0.1.184).
- `text-overflow` no aplica en contenedores flex (v0.1.144).
- `position: sticky` se pega al scroll container más cercano (v0.1.192–193).
- Un `transform` crea contexto de apilado (v0.1.146).
- Nunca `+ 'Z'` a ciegas en fechas: `parseUtcDate` (v0.1.210).
- `TRUST_PROXY` con número falla cerrado en fastify ≥5.12 (v0.1.202).
- `.env` se lee con `load_env_file`, no `source` (v0.1.180).
- Los guardias SSRF bloquean loopback: en dev usar `DEV_ALLOW_PRIVATE_EGRESS`.

---

## 10. Estado actual e hilos abiertos

**Estado**: todas las fases F0–F11 completas (ver `CLAUDE.md` §5). Última
versión publicada: **v0.1.260** (menú contextual completo de las vistas), en `main`.

**Hilos abiertos (lo último que se habló)**
- Probar Mercado Pago / Wompi con cuentas de prueba reales (TEST- / pub_test_)
  en el servidor.
- Google OAuth: grabar el video y enviar a verificación.

**Pendientes de la auditoría v0.1.252 (por valor)**
- Servidor: un contexto por request (hoy se re-leen lista/campos en varias
  transacciones). Baja prioridad desde v0.1.257: con la planificación en
  ~1 ms, cada transacción extra cuesta poco. (El índice del buscador se midió
  y se descartó — ver ADR-S32.)

**Pendientes técnicos conocidos (no urgentes)**
- Rol de Postgres no superusuario para la conexión base (necesita BYPASSRLS y
  migrar cada instalación por consola).
- `style-src 'unsafe-inline'` en la CSP (React escribe `style=""`).
- Revocar en el proveedor al desconectar una integración OAuth.
- Dominios propios por Caddy (on_demand_tls) cuando haya muchos clientes.
- Firma de releases (si el usuario algún día la quiere: `docs/runbook-updates.md`).

---

## 11. Bitácora (lo más nuevo arriba)

> Una entrada por release o por decisión importante. Formato: fecha · versión ·
> qué se hizo · decisiones/pedidos del usuario · qué queda. El detalle técnico
> completo de cada versión vive en `CLAUDE.md` §5.

- **2026-10-07 · v0.1.260** — Pedido del usuario con captura de ClickUp: el
  menú de las vistas tiene muchas más opciones allá. Ahora: favorito (aparece
  en Favoritos y abre la lista en esa vista), copiar vínculo (`?view=` en la
  URL — antes el enlace abría la vista por defecto), personalizar, color e
  ícono, vista privada, proteger vista, guardar automáticamente, por defecto,
  exportar, duplicar y «Uso compartido y permisos». No se copiaron «Fijar
  vista» ni «Modo de carga rápida» (sin equivalente) ni «Plantillas» (son por
  lista).
- **2026-10-07 · v0.1.259** — Dos reportes del usuario: «las listas y
  agrupaciones cargan mucho más lento» y «las pestañas de vistas no permiten
  cambiar nombre, icono ni reordenarse». La lentitud se MIDIÓ con una réplica
  de su «Anualidades LIC» (2.173 registros, leída por el MCP) contra el build de
  v0.1.255: el servidor contesta en 20-60 ms y todo el costo era del navegador
  (v0.1.255 ya era lenta; la agrupada de v0.1.256 sumó). Arreglado: ventana de
  filas desde el primer render y sin medir fila por fila, popovers de celda que
  se montan al primer click y una mutación por tabla → «Todos» 1,1 s → 0,35 s y
  agrupada 1,2 s → 0,66 s en escritorio (con CPU de celular 4,7 → 1,9 s y 4,6 →
  3,0 s). Pestañas: doble click renombra, click derecho/«···» con «Color e
  ícono», arrastrar para reordenar (migración 0065, conserva el orden que se
  veía). Ojo: la réplica de prueba tiene un panel lateral de ~300 listas que
  infla el layout; en la instancia del usuario (12 listas) debería sentirse
  todavía mejor.
- **2026-10-07 · v0.1.258** — Cuarta y última entrega de los pendientes de la
  auditoría: el registro en celular es pantalla completa con pestañas Detalles /
  Comentarios / Actividad (antes la Actividad apilada le robaba media pantalla y
  Guardar quedaba en el medio); el alta también a pantalla completa y las filas
  de campos con la etiqueta arriba bajo 640 px. Queda sólo el «contexto por
  request» del servidor, de baja prioridad.
- **2026-10-07 · v0.1.257** — Tercera entrega de la auditoría (servidor).
  Midiendo apareció lo importante: los índices por campo («Indexar» y los que
  marcaban las tiendas WooCommerce) hacían que CADA consulta de `records`, de
  todas las empresas, tardara ~70 ms en planificarse (890 índices en dev) sin
  acelerar los filtros. Se le preguntó al usuario y eligió **dejar de crearlos**
  (ADR-S32): migración 0064, flag sin efecto, fuera de la interfaz. Además: tick
  de recurrencias en una consulta y `findById` sin la descripción. El índice
  global del buscador se midió y se descartó (empeoraba 4× los términos comunes).
  Queda la 4.ª entrega: modal del registro y alta en celular.
- **2026-10-06 · v0.1.256** — Segunda entrega de los pendientes de la auditoría:
  rendimiento del front. `shared` desde el fuente (tree-shaking), la app y las
  rutas/diálogos/calendario a pedido → el login baja ~217 KB gz (antes ~630) y
  entrar a una lista ~430. Vista agrupada virtualizada (600 filas → ~150
  dibujadas). Se encontró y arregló un bucle de recargas infinito si un chunk
  falla al arrancar. Nota de desarrollo: el front ya NO necesita recompilar
  `shared` ni borrar `.vite`; el API sí sigue usando su `dist`.
- **2026-10-06 · v0.1.255** — El usuario pidió seguir con los pendientes de la
  auditoría. Plan en cuatro entregas: (1) fallas chicas, (2) rendimiento del
  front (bundle inicial + virtualizar la agrupada), (3) rendimiento del
  servidor, (4) modal del registro en celular. Esta es la (1): el import ya no
  deja opciones colgadas de filas rechazadas (y «actualizar desde archivo» exige
  `manage_fields` para crear opciones), Actividad legible (%, duración,
  calificación, teléfono y nombre de la persona), conversiones de tipo a texto
  con lo que la persona leía, y HTML sin `<main>` ni `<button>` anidados.
- **2026-10-06 · conversación** — El usuario confirmó que la impersonación ya
  funciona (v0.1.254) y **descartó el PSE propio** (ACH Colombia): "ya no lo
  planeo implementar". Se quitó de los hilos abiertos; los pagos por PSE siguen
  disponibles a través de Mercado Pago y Wompi (v0.1.250 / v0.1.251).
- **2026-10-06 · v0.1.254** — Reporte del usuario: "impersonar me cierra la
  sesión y al volver a entrar dice demasiados intentos". Causa (regresión de
  SEC-24, v0.1.225): el guard de la consola chequeaba "¿sesión abierta con
  contraseña?" ANTES de "¿es superadmin?", y la sesión impersonada no lo es →
  `reauth_required` → la app, al sondear si mostrar Plataforma, hacía logout y
  recargaba: la impersonación moría al nacer. Fix: impersonada → 403 (no
  reauth), primero quién es y después cómo entró; la app ni sondea la consola
  mientras se impersona; y **cerrar sesión impersonando devuelve al operador**
  a su sesión (antes lo dejaba afuera). Los "demasiados intentos": el freno por
  cuenta (10 contraseñas mal en 15 min) o el de IP (15 logins/min); el mensaje
  proponía "restablecé tu contraseña" pero el reset NO levantaba el freno —
  ahora sí. Verificado E2E (impersonar → app del agente con banner → logout
  vuelve al operador con la consola).
- **2026-10-06 · (pregunta)** — "¿Cómo hacen admin y agente para ver todo de
  una lista?": admin siempre ve todo; al agente se le abre por lista en
  Ajustes → Permisos → tarjeta Agente → «Colaborar» (o «Control total»), o a
  una persona puntual en Compartir → Con tu equipo → Personas con acceso.
- **2026-10-06 · v0.1.253** — Reporte de un cliente: "un agente crea
  registros y después no los ve; el admin sí". Con la configuración por
  defecto ("Solo lo suyo") funcionaba (verificado por API y en navegador); el
  fallo aparecía con el ajuste fino: (1) **«Los que tiene asignados»** — el
  registro que el agente creaba sin ponerse de responsable desaparecía al
  instante, y sin campo de responsable elegido no veía NADA; (2) **«Ver: nada»
  + «Crear: sí»** — creaba a ciegas. Regla nueva: **quien crea un registro
  siempre lo ve** (assigned = asignados O creados; create con view none →
  own). Además los **archivos** del agente siguen ahora el acceso de cada
  lista (antes sólo veía lo que subió o lo de registros que creó: con
  «Colaborar» veía el registro pero el adjunto daba 404). No se pudo ver la
  config real del cliente (el MCP conectado es el workspace del usuario):
  si el cliente sigue con el problema, pedir captura de Ajustes de la lista →
  Permisos.
- **2026-10-06 · v0.1.252** — Auditoría integral pedida por el usuario
  ("rendimiento, módulos, campos, que todo funcione, velocidad y muy
  importante la estética"). Se corrieron 4 auditorías en paralelo (servidor,
  front, UX con capturas, QA funcional de los 22 tipos de campo) y se
  arreglaron: fecha y hora que NO se guardaba (bloqueante), rate limit en 500,
  resize de columnas, archivos que no se abrían en ningún lado (ahora URL
  firmada), selección sin valor interno, orden por lookup y orden de texto
  (ICU), filtro por relación, nombres de personas en tableros y CSV legible
  (con import de vuelta) + índices/consultas/virtualización + UI (formato
  regional en toda la app, voseo, Inter, tarjetas, tablero, Plataforma,
  celular). Detalle en `CLAUDE.md` §5; lo que quedó, en §10.
- **2026-10-05 · (sin versión)** — Se creó este archivo y `scripts/dev/`
  (up/start/restart, usuario de pruebas, plantilla E2E, dobles de WooCommerce,
  Mercado Pago/Wompi y del build de producción). Pedido del usuario: tener un
  salvavidas por si se pierde la conversación y **mantenerlo actualizado
  siempre** (regla agregada en `CLAUDE.md`).
- **2026-10-03 · conversación** — Pregunta sobre PSE propio (ACH Colombia); descartado el 2026-10-06.
- **2026-10-03 · v0.1.251** — Cobros de las empresas con Mercado Pago y Wompi
  (ADR-S31): links de pago desde la ficha y desde automatizaciones, avisos
  verificados releyendo el pago, estado en columnas de la lista, disparador
  «Cuando se recibe un pago». Decisión del usuario: «las dos [formas de cobrar
  planes], sin comisión, Wompi sólo como conector». PR #257.
- **2026-10-03 · v0.1.250** — Cobro de planes: período pagado + renovación
  automática con Mercado Pago, 5 días de gracia, pagar en solo-lectura,
  Plataforma → Cobros (ADR-S30). PR #256.
- **2026-10-02 · v0.1.249** — Correo de la empresa por su cuenta de Google o
  Microsoft (Gmail API / Graph) con límites visibles (ADR-S29).
- **2026-10-02 · v0.1.243–248** — Conector SQL Server, avisos de dependencias,
  portal white-label + dominio del portal, dominios por ServerAvatar (decisión:
  ServerAvatar ahora, Caddy después), guías de Google/Microsoft/Slack + páginas
  legales, selector de acción con estilo.
- **Antes** — Todo el historial (v0.1.0 → v0.1.242) está en `CLAUDE.md` §5,
  versión por versión.
