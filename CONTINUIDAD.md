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
- En **español neutro, tuteando** ("haz", "toca", "fíjate") — igual que los
  textos de la UI. **NUNCA voseo ni modismos argentinos** ("hacé", "podés",
  "vos", "acá", "plata", "en criollo"): pedido explícito del usuario
  (2026-10-09, "nunca escribas con acento argentino, no me gusta"). Claro,
  sin jerga; si hay que explicar algo técnico, en lenguaje sencillo y con el
  "para qué".
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
   **2b. Novedad**: si la versión trae algo que quien USA la app va a notar,
   agregar su entrada al final de `packages/shared/src/whats-new/catalog.ts`
   (pasos en su `README.md`) y correr el test de shared (ADR-S73).
   **2c. Ayuda al día**: un botón o pantalla importante nueva lleva su
   `data-tour`; si cambia cómo se hace una tarea, actualizar su guía en
   `packages/shared/src/help/system-guides.ts` (y su recorrido en
   `apps/web/app/admin/help/tours/tours.ts`). Correr `tours/tours.test.ts`
   del front: falla si un recorrido apunta a un ancla que ya no existe (ADR-S74).
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

**CI** (`.github/workflows/ci.yml`): en cada PR corre `lint typecheck build`
de `shared` + `api` y las pruebas de `shared` en un job, y las pruebas de la
API (Postgres/Redis por Testcontainers) repartidas en **4 máquinas**
(`vitest --shard`); el job final **`ci`** junta el resultado (~5 min en total
desde v0.1.364; antes ~16). No corre al fusionar a main (el squash deja el
mismo árbol que ya pasó). El front (`apps/web`) NO está en el CI → correr a
mano `pnpm --filter @imagina-base/web typecheck lint test` y `build:cloud`
antes de publicar.

**Release** (`.github/workflows/release.yml`, al fusionar a main): compila una
vez, graba las capturas del centro de aprendizaje en **5 máquinas** a la vez y
un último job junta todo y publica (~10 min; antes ~20). Si una parte de las
capturas falla, la versión sale igual. Si el reparto de las capturas queda
desparejo (una parte tarda mucho más que las otras), refrescar los tiempos con
el log de un release: `node scripts/help-captures/timings.mjs <log>`
(ADR-S75, addendum v0.1.364).

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
- **Varias entregas en paralelo** (cada una en su worktree): `sh
  scripts/dev/slot.sh <n 1-9> up|restart|stop|status|env` levanta una instancia
  AISLADA — API en 3100+n, app en 5180+n, base `imagina_slot_<n>`, Redis DB n,
  logs en `/tmp/imagina-dev-slot-<n>` — sobre el Postgres/Redis del entorno
  principal. Para migrar la base del slot: `eval "$(sh scripts/dev/slot.sh <n>
  env)" && pnpm db:migrate`. Desde un slot NUNCA correr `up.sh`/`restart.sh`:
  matan los procesos de todos. La plantilla E2E lee `E2E_BASE`/`E2E_DB`.

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
  - `scripts/dev/fake-anthropic.mjs [puerto=4899]` — proveedor de IA
    (`/v1/models` + `/v1/messages` en streaming; para «Crear desde un archivo»
    arma una mejora a partir del resumen y guarda el último pedido en
    `/tmp/fake-anthropic-last.json`, así se verifica qué viajó). **OJO**: el
    contenedor trae `ANTHROPIC_BASE_URL=https://api.anthropic.com` en el
    entorno; para usar el doble hay que arrancar el API con
    `ANTHROPIC_BASE_URL=http://127.0.0.1:4899 sh scripts/dev/start-api.sh` y
    habilitar la IA de plataforma con una clave falsa `sk-ant-…` (PATCH
    `/platform/ai` como superadmin). Y no usar `pkill -f "node dist/main.js"`:
    también mata la shell que corre el comando (usar `kill $(pgrep -f "^node dist/main.js")`).
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
- En la tabla (v0.1.294) un click ELIGE y un segundo click sobre la celda ya
  elegida la EDITA: en un E2E, después de elegir no se vuelve a clickear para
  pegar (se usa el teclado). Los popovers de Radix van por portal pero sus
  eventos burbujean por el árbol de React: los handlers de la tabla ignoran lo
  que no está dentro de su contenedor.

---

## 10. Estado actual e hilos abiertos

**Estado**: todas las fases F0–F12 completas, y las fases 1-7 del estudio de
funcionalidades (ver `CLAUDE.md` §5). Última versión publicada: **v0.1.376**
(importar las suscripciones y los planes que ya están en Mercado Pago: vista
previa, lista nueva «Suscriptores · Mercado Pago» o vínculo por correo a una
lista de clientes, cobros y registro de cobros, y las nuevas que llegan solas,
addendum ADR-S96); antes v0.1.375
(las etiquetas de Google Ads, Google Analytics y el píxel de Meta se cargan
por ID en el ENLACE DIRECTO del formulario y de la agenda, encerradas por CSP
y COOP, con aviso de cookies, addendum ADR-S97); antes v0.1.374
(medir conversiones: el formulario y la agenda insertados en el sitio de la
empresa disparan la conversión EN EL SITIO —Tag Manager, Google Ads y Meta,
con valor e id único—, guardan de qué campaña vino cada registro y llevan a
una página de gracias con variables, también desde la agenda, ADR-S97); antes
v0.1.373
(suscripciones con débito automático también con PayPal: planes en dólares,
producto y plan creados una vez en la cuenta de la empresa, estado releído,
«En mora» al tercer fallo, pausar/reanudar/cancelar/cambiar el valor, y lo
público que dice a quién se le paga, addendum ADR-S96 —con ella queda COMPLETO
el pedido de suscripciones—; antes v0.1.372
PayPal como tercer proveedor de cobros de cada empresa: links de pago en
dólares desde la ficha, las automatizaciones, los formularios y el portal, con
link propio de la app que reusa o crea la orden, captura al volver el cliente,
aviso o «Verificar», webhook registrado solo con https y páginas con la marca
de la empresa, addendum ADR-S31; antes v0.1.371
el registro de cobros de las suscripciones: cada cobro como un registro de
otra lista vinculada al cliente, con su tablero, y cuatro herramientas del
asistente/MCP para leer suscripciones, armar planes, elegir columnas y
suscribir/pausar/cancelar, addendum ADR-S96; arregla las tablas de los
tableros que decían «1 vinculado» y la migración de empresa que no re-mapeaba
las columnas de cobros y suscripciones; antes v0.1.370
el chat del asistente rediseñado: respuestas con formato, hasta 50
conversaciones guardadas 30 días, los pasos a la vista, copiar/reintentar/
editar, panel ancho y sugerencias según la pantalla, addendum ADR-S21; arregla
«Detener», que no frenaba al modelo en el servidor, y la página del registro
que quedaba en blanco al aplicar una propuesta; antes v0.1.369
formularios «sin marco» al insertarlos en un sitio y logo por formulario,
addendum ADR-S95; arregla el marco insertado que nunca bajaba de 640 px; antes
v0.1.368 «Suscribir al enviar» en los formularios y las suscripciones del
cliente en el bloque «Pagos» del portal, addendum ADR-S96; arregla el portal de
los clientes cuyo registro llegó por un formulario; antes v0.1.367
suscripciones con débito automático de Mercado Pago para los clientes de cada
empresa: planes, suscribir desde la ficha, estado derivado con gracia, cobros,
columnas, disparador y acciones, ADR-S96 — primera de tres entregas; antes
v0.1.366 reuniones de Teams, Outlook y Google Calendar desde las automatizaciones:
crear con enlace, guardar el enlace y el id en el registro, reprogramar y
cancelar, addendum ADR-S22; antes v0.1.365 los cobros se ven: el link de pago queda en la columna que se elija, la ficha
siempre muestra «Cobros» y el botón trae el link para copiar, addendum ADR-S31;
antes v0.1.364 publicar más rápido: las pruebas de la API en 4 máquinas y las capturas del
centro de aprendizaje en 5, addendum ADR-S75; arregla 2 capturas rotas; antes
v0.1.363 conectar Teams y Outlook cuando la empresa pide un administrador de
Microsoft 365: el enlace de consentimiento del administrador, addendum ADR-S22;
antes v0.1.362 corrección: formularios en blanco en servidores sin
`NODE_ENV=production`, 15 fuentes dañadas y el `.env` que se completa solo;
antes v0.1.361
formularios: cobrar al enviar con el Mercado Pago o Wompi de la empresa,
addendum ADR-S39 —con ella queda COMPLETO el proyecto de formularios—; antes
v0.1.360 enlace para que un cliente actualice su registro, v0.1.359 plantillas, panel lateral, pantalla completa y código
QR, addendum ADR-S39 y ADR-S95, v0.1.358 estadísticas y guardar el avance,
v0.1.357 puntaje y cálculos, una pregunta por pantalla y bienvenida, v0.1.356 la lógica —varias reglas todas/alguna, saltos
entre páginas, pantallas finales según las respuestas y recordar respuestas con
`{{nombre}}`—, v0.1.355 más formas de preguntar
—escala/NPS, deslizador, Sí o No, firma, lista con buscador, ordenar, «Otro» y
matriz—, v0.1.354 la página de la agenda con el motor de temas, addendum ADR-S94,
v0.1.353 aprobación de citas y seguridad de la página, addendum ADR-S67,
v0.1.352 formularios y agenda insertados que aguantan mucho tráfico, ADR-S95,
y v0.1.351 formularios con tu diseño, ADR-S94), en `main`.

**Hilos abiertos (lo último que se habló)**
- 2026-11-05 — **Etiquetas en el enlace directo** — **v0.1.375 HECHA** (el
  usuario: «Sí, haz la v0.1.375»).
- 2026-11-05 — **Rediseño de los constructores de formularios y de la agenda**
  — **PEDIDO, PENDIENTE** (en el mismo mensaje que aprobó la v0.1.376). El
  usuario: "las interfaces están muy confusas… no se sabe dónde queda qué
  cosa porque la navegación es súper confusa con muchas opciones no
  correctamente organizadas, no se ve muy bonito ese editor… los elementos como
  logo, nombre y descripción así como todos los elementos del formulario
  deberían ser clickeables para no confundir al usuario de dónde puede ajustar,
  mover o desactivar algún elemento (ej. no sabría dónde ocultar los títulos de
  los formularios o de los agendamientos)… muchos ajustes están mezclados…
  también tener presente que se pueda ajustar y cambiar el color de todo
  porque vi elementos que no tenían ajuste de color". Es lo siguiente a hacer
  tras la v0.1.376: replantear FormBuilder y BookingBuilder (cada elemento de
  la vista previa seleccionable, con mostrar/ocultar, mover y color; navegación
  y ajustes reorganizados; color para todo).
- 2026-11-05 — **Importar las suscripciones y planes que ya están en Mercado
  Pago** — **v0.1.376 HECHA** (el usuario: «Sí, haz la v0.1.376»).
- 2026-11-05 — **«Al insertar los formularios por iframe está rechazando la
  conexión»** (formulario `5lS1AOGalrzn3gim8h8vIQhD`) — **RESPONDIDO**, sin
  bug. El usuario probaba en html.onlineviewer.net, que dibuja el HTML dentro
  de un marco con `sandbox` (origen opaco): ningún navegador deja cargar ahí
  una página de otro sitio, ni con `frame-ancestors *`. Además los dominios
  permitidos del formulario sólo tenían html.onlineviewer.net. Se le dijo que
  agregue su dominio real y pruebe en una página de verdad; en v0.1.375 se
  sumó la aclaración debajo de «Dominios permitidos» (formulario y agenda) y
  una pregunta frecuente en Aprende.
- 2026-11-05 — **Medir conversiones (Google Ads) en formularios y agenda
  insertados + página de gracias** — **v0.1.374 HECHA** (el usuario respondió
  «Si, hazlo»). Queda propuesta, sin aprobar, la **v0.1.375**: píxel de Google
  y de Meta por ID en el enlace directo (sin sitio), aislado. Preguntas del
  usuario: "¿cómo quedó lo de que los formularios consuman pocos recursos?
  creo que se subía un script a Cloudflare", "¿cómo medir las conversiones de
  llenadas de formulario o agendamientos de campañas de Google Ads? ¿se puede
  colocar el código de seguimiento?" y "¿se pueden manejar redirecciones a
  una página de gracias?". Respuesta: (1) rendimiento resuelto en v0.1.352 SIN
  Cloudflare (nada se subió allá; `docs/runbook-public-traffic.md` es una guía
  opcional); su servidor responde nginx directo, sin Cloudflare, y no lo
  necesita. (2) Hoy NO hay forma cómoda de medir: el marco manda
  `imb-form-submitted` sin decir cuál formulario y `embed.js` no lo convierte
  en nada que entienda Tag Manager; una etiqueta DENTRO del marco tampoco
  sirve (el `gclid` queda en el sitio del cliente y Safari/Firefox bloquean
  cookies en marcos de otro dominio). (3) La página de gracias YA existe en
  formularios (redirección general y por pantalla final; insertado navega la
  página entera) pero NO en la agenda, y la dirección es fija (sin variables).
  Propuesta: **v0.1.374 «Medir conversiones»** — `embed.js` publica en el sitio
  `dataLayer.push({event:'imagina_form_submit'|'imagina_booking', …})` + un
  evento del navegador (nombre, pantalla final, valor/moneda si cobra, id único
  para no contar dos veces; correo/teléfono para conversiones mejoradas sólo
  opt-in), ID y etiqueta de conversión de Google Ads por formulario para usar
  el `gtag` del sitio sin Tag Manager, captura de `gclid/gbraid/wbraid/fbclid/
  utm_*` y la página en columnas del registro (pasados al marco por mensaje,
  NO en la URL del iframe, para no romper el caché con cada clic), página de
  gracias en la agenda, variables en la dirección y guía en Aprende;
  **v0.1.375** — Google (AW/G) y Meta Pixel POR ID en el enlace directo
  (nunca código libre ni GTM: la página pública vive en el mismo dominio que la
  app y ese código correría con la sesión de quien del equipo la abra), con
  aislamiento; después, conversiones offline (Google Ads API pide developer
  token) y API de conversiones de Meta.
- 2026-11-05 — **Logo y «sin marco» en formularios + rediseño del chat de
  IA** (pedido del usuario: "en los formularios debería poderse cambiar el
  logo u ocultarse… un estilo más limpio para embeber… que no tenga espacios
  ni fondo… también mejora el chat de IA, rediséñalo, el contenido sale sin
  formato, como texto plano"). Lo partí en dos y **las dos están hechas**:
  **v0.1.369** (logo propio/ninguno + «Sin marco») y **v0.1.370** el chat del
  asistente rediseñado (Markdown seguro con títulos, listas, tablas, código
  con copiar y enlaces; historial de 50 conversaciones por 30 días con
  renombrar y borrar; los pasos de las herramientas a la vista; copiar,
  reintentar y editar el último pedido; modo ancho; sugerencias según la
  pantalla con el registro abierto; cuadro que crece). Las suscripciones
  siguieron con **v0.1.371**, **v0.1.372** (PayPal links) y **v0.1.373**
  (suscripciones con PayPal), hechas. Ideas que quedaron
  para el chat si el usuario las pide: adjuntar archivos al pedido, compartir
  una conversación con otra persona y elegir el modelo por conversación.
- 2026-11-05 — **Suscripciones y cobros recurrentes (Mercado Pago y PayPal)
  para los clientes de cada empresa** — HECHO (v0.1.367 a v0.1.373). El usuario respondió «hazlo
  todo como lo veas más recomendable»: decidí una suscripción viva por
  registro, el historial de cobros como lista espejo (en la segunda entrega),
  al vencer «marcar Vencida y avisar» por defecto (cancelar en Mercado Pago es
  opción del plan) y Wompi recurrente afuera. **v0.1.367 hecha** (Mercado Pago
  de punta a punta, ADR-S96) y **v0.1.368 hecha** (formulario «Suscribir al
  enviar» + bloque del portal; partí la segunda entrega para no hacer un
  release gigante) y **v0.1.371 hecha** (registro de cobros con su tablero +
  herramientas del asistente/MCP; al final NO es una lista espejo: es una
  lista común de la empresa donde la app escribe las columnas elegidas, así
  se pueden sumar columnas propias y borrar un cobro mal registrado — ver el
  addendum de ADR-S96) y **v0.1.372 hecha** (PayPal como conector de la
  empresa con links de pago en dólares; partí PayPal en dos: los links primero
  y las suscripciones después) y **v0.1.373 hecha** (suscripciones con PayPal:
  plan en dólares, suscribir desde la ficha/formulario/acción, estado, cobros,
  registro de cobros y asistente/MCP, igual que Mercado Pago — addendum de
  ADR-S96). Con eso el pedido quedó completo. **Límite**: todo se probó contra
  un Mercado Pago y un PayPal simulados con la forma de sus APIs; la prueba con
  cuentas reales de prueba (TEST- de Mercado Pago, app sandbox de PayPal) queda
  para el servidor del usuario. En el medio el
  usuario pidió logo/«sin marco» (v0.1.369) y el chat de IA (v0.1.370), ya
  publicados. Ideas que
  quedaron anotadas para más adelante: bloquear a mano las columnas de la
  suscripción (hoy se pueden editar y la siguiente relectura las pisa) y
  mostrar las fechas del panel en la zona de la empresa (hoy en la del
  navegador). Antes de la respuesta, la propuesta era: Hoy la
  empresa sólo crea links de pago únicos (ADR-S31); el `preapproval` de Mercado
  Pago existe pero sólo para cobrarle el plan a la empresa (ADR-S30), y PayPal
  sólo para eso mismo (no hay conector de PayPal para empresas). Propuesta
  enviada: (1) planes de suscripción de la empresa en la app; cada cliente =
  un `preapproval` SIN plan asociado con `status: pending` + `init_point` (el
  mismo camino que ya usa la plataforma: la tarjeta la toma Mercado Pago y el
  `external_reference` ata la suscripción al registro); (2) suscribirse desde
  la ficha, una automatización, un **formulario de suscripción** («Suscribir al
  enviar», como «Cobrar al enviar» de v0.1.361) y el portal; (3) estado propio
  por suscripción —por autorizar / al día / reintentando / en mora / vencida
  (pasó la gracia) / pausada / cancelada / terminada— con «pagado hasta» +
  gracia y qué hacer al vencer (avisar, marcar el servicio suspendido o
  cancelar en Mercado Pago), revisión diaria que no depende sólo de los avisos;
  (4) columnas de la suscripción en la lista que la empresa elija (como las de
  cobro de v0.1.365) + una **lista espejo «Cobros de suscripciones»** (una fila
  por cuota cobrada o fallida, vinculada al registro) para los reportes, o
  escribirlos en una lista de Facturas que ya exista; disparador «Cuando
  cambia una suscripción» (se cobró, falló, entró en mora, venció, se canceló)
  y tablero (ingreso recurrente, en mora, canceladas, cobrado vs. fallido por
  mes); (5) PayPal Subscriptions como conector de la empresa (USD; PayPal no
  maneja COP). Datos verificados de Mercado Pago: hasta 4 reintentos por cuota
  en ~10 días, la cuota queda «processed» con pago rechazado si fallan, y la
  suscripción se da de baja sola tras 3 cuotas rechazadas (leído en la
  documentación de Colombia); recurrencia sólo con tarjeta (PSE no es
  recurrente). Wompi no tiene suscripciones nativas (sólo fuentes de pago para
  cobros que dispara la app): quedó como fase opcional. Fases propuestas:
  v0.1.367 Mercado Pago de punta a punta, v0.1.368 formulario + portal + lista
  de cobros + tablero, v0.1.369 PayPal.
- 2026-11-05 — **Reuniones de Teams para Binapps (v0.1.366)**. El cliente
  Binapps (cuentas mayerli.castano@binapps.co y nestor@binapps.co) pidió por
  escrito crear, reprogramar y cancelar reuniones de Teams desde las
  automatizaciones, guardar el enlace y el id, y mandar el enlace por WhatsApp
  (hoy lo hacen con un puente de Power Automate). Quedó en v0.1.366. **Lo que
  tienen que hacer ellos**: en Ajustes → Integraciones, **Reconectar** Teams y
  aceptar el permiso del calendario (si su empresa pide aprobación del
  administrador, la ventana dice «Hace falta aprobar un permiso nuevo» y da el
  enlace para TI). La receta: disparador «Cuando se actualiza un registro» con
  la fecha de la demo en los campos que cambian → «Si / sino» con «Id del
  evento» vacío → «Crear reunión de Teams» guardando enlace e id → WhatsApp con
  `{{reunion.enlace}}`; si ya hay id, «Reprogramar…»; otra automatización
  cancela. La disponibilidad (su punto «opcional») ya existe: «Mi calendario»
  con Outlook en la agenda de citas. Queda esperando que lo prueben.
- 2026-11-05 — **Columnas de cobro por el MCP**: la sesión que configura por el
  MCP no veía la herramienta nueva `propose_configure_payment_columns` (la lista
  de herramientas de una sesión es fija). Opciones dadas: hacerlo en la app
  («Dónde queda el link» en la acción), pedírselo al asistente ✨, o una sesión
  nueva. También se ofreció quitar el paso «Actualizar campo» redundante de la
  automatización 116.
- 2026-11-04 — **Formularios mucho más potentes y personalizables**. El
  usuario aprobó el orden **«Formularios 1 → agenda (Recomendado)»** (diseño de
  formularios → entrega 3 de la agenda, que reusa el motor de temas →
  formularios 2 y 3) y **«Sí, como opción avanzada»** el CSS propio (sólo
  administradores, sin cargar nada de afuera). Pedido: "que la funcionalidad de
  formularios fuera más completa como hiciste con esta app de agendamiento…
  más personalizable, estilizable, se puedan controlar los tamaños de todo,
  bordes, colores, estilos, plantillas de diseño… revisa otras apps de
  formularios… bonito y eficiente en carga y rendimiento". Se revisaron
  Typeform, Tally, Fillout y Jotform. Hoy el formulario sólo deja elegir el
  color del botón y mostrar el logo (la página es una tarjeta fija de 660 px
  con la fuente del sistema), y su script de ~40 KB viaja sin minificar ni
  cachear en cada visita. Se propusieron TRES entregas:
  1. **Diseño**: un motor de temas COMÚN a las páginas públicas (formularios
     ahora, la página de la agenda después), con colores, modo
     claro/oscuro/automático, las 19 fuentes de ADR-S37, tamaños, espacios,
     bordes, esquinas y sombras. También estilos de campos, etiquetas,
     opciones (botones/tarjetas con imagen) y botón; fondo
     (degradado/imagen), portada, diseño dividido, ancho por pregunta (lado a
     lado), una galería de plantillas de diseño, «Mis temas» de la empresa y
     CSS propio opcional. En rendimiento: script y estilos cacheados y
     minificados, sólo la fuente elegida, la primera página dibujada en el
     HTML.
  2. **Preguntas y lógica**: firma, NPS/escala, sí/no, opciones con imagen,
     matriz, ranking, «Otro», lista con buscador, deslizador. Lógica con
     varias reglas Y/O, saltar a una página, varias pantallas finales,
     cálculos/puntaje, recordar respuestas («Hola {{nombre}}»), modo
     conversacional (una pregunta por pantalla) y bienvenida.
  3. **Medir, insertar y cobrar**: guardar el avance y continuar, estadísticas
     (visitas, empezados, enviados, dónde abandonan, de dónde llegan), formas
     de insertar (ventana emergente, panel, pantalla completa, QR), enlace para
     actualizar un registro existente, cobrar al enviar (Mercado Pago/Wompi de
     la empresa) y plantillas de formularios completos.
  Orden propuesto: formularios 1 → la entrega 3 de la agenda (que reusa el
  motor de temas) → formularios 2 y 3.
  **Estado**: entrega 1 **HECHA en v0.1.351** (ADR-S94). Lo que NO entró de
  ella, a propósito: dibujar la primera página en el HTML del servidor (el
  formulario lo arma el script inline; la medición dio ~335 ms de primera
  pintura en 4G lento, apenas 27 ms más que antes, así que no se justificó).
  La entrega 3 de la agenda quedó **HECHA** (v0.1.353 aprobación y seguridad,
  v0.1.354 la página con este mismo motor de temas). La entrega 2 se partió
  en dos: **preguntas HECHAS en v0.1.355** (escala/NPS, deslizador, Sí o No,
  firma, lista con buscador, ordenar, «Otro», matriz; las opciones con imagen
  ya estaban desde v0.1.351) y **lógica HECHA en v0.1.356** (reglas Y/O,
  saltar a una página, varias pantallas finales, recordar respuestas) y
  **puntaje, una pregunta por pantalla y bienvenida HECHOS en v0.1.357**: con
  eso la entrega 2 queda completa.
  La entrega 3 se partió en cuatro versiones: **estadísticas y guardar el
  avance HECHOS en v0.1.358**; **más formas de insertar (panel lateral,
  pantalla completa, QR) y plantillas de formularios HECHAS en v0.1.359**;
  **enlace firmado para que alguien actualice un registro que ya existe HECHO
  en v0.1.360** y **cobrar al enviar con el Mercado Pago o Wompi de la empresa
  HECHO en v0.1.361**.
  **Estado: las TRES entregas HECHAS — el proyecto de formularios queda
  completo.** SIGUIENTE: lo que el usuario pida (banco de ideas en
  `docs/ideas.md`).
- 2026-11-04 — **¿Aguantan mucho tráfico los formularios y la agenda
  insertados?** Pregunta del usuario: "si lo uso como formulario de contacto de
  una web con muchas visitas puede ponerme lenta la app… ¿cómo hacen cal.com,
  calendly o las plataformas de formularios para que el consumo de recursos sea
  el mínimo?". Se MIDIÓ con la v0.1.351 en modo producción (sandbox de 4
  núcleos, un proceso, autocannon): cargar un formulario ~300 por segundo
  (p50 33 ms con 10 conexiones; la parte de datos sola ~520/s, el piso del
  framework ~11.000/s), página de la agenda ~300/s, horarios de una semana
  12–16 ms. Cada carga hace 4–6 consultas a la base, nada se cachea
  (`Cache-Control: no-store` por el sello anti-robots de cada visita) y todo
  cae en el mismo proceso y la misma base que el equipo. La agenda topa en
  1.200 consultas de horarios por minuto por página. Ya bien: el iframe va con
  `loading="lazy"`, `embed.js` cacheado, cliente de 9 KB gz, lo ocupado de
  Google/Outlook cacheado 90 s. Se le explicó qué hacen las otras (iframe o
  script que crea el iframe, no HTML pegado; lo fijo desde una CDN y sólo lo
  variable al servidor; cargar al hacer clic; aislar lo público) y se PROPUSO
  una versión propia: (1) caché en memoria de la configuración del formulario y
  de la agenda, 30 s, invalidada al guardar; (2) sacar el sello del HTML para
  que la página sea cacheable y el script pase a archivo con versión servido
  por el proxy; (3) listo para poner Cloudflare delante; (4) horarios
  cacheados 30–60 s por servicio y semana, borrados al reservar/cancelar, y
  subir el tope por página; (5) tope de conexiones a la base propio para lo
  público; (6) adelantar los modos de inserción que cargan al hacer clic
  (botón flotante, ventana emergente). Se recomendó hacerlo ANTES de la entrega
  3 de la agenda. El usuario respondió **"Si, hazlo primero y luego la tercera
  entrega"** → **HECHO en v0.1.352** (ADR-S95). Cambio de decisión respecto de
  la propuesta, explicado al usuario: el script del formulario quedó EN LÍNEA
  (autorizado por su hash en la CSP) en vez de un archivo aparte, porque la
  página entera ya se cachea y un archivo aparte sólo suma un pedido.
  Después, la entrega 3 de la agenda (ver el hilo de abajo).
- 2026-11-04 — **Agenda de citas al nivel de Cal.com/Calendly** (addendum
  ADR-S67). Pedido del usuario: "la configuración de ese calendario o sistema de
  agendamientos está muy básica… seleccionar su asesor, diferentes franjas,
  cuánto duran las franjas, tiempo antes y después, límite de anticipación,
  límite de cupo, festivos en automático por país, que se sincronice con los
  calendarios de los agentes (Google u Outlook), que genere link de Meet o
  Teams, que alguien apruebe o rechace (configurable), más estilos (colores,
  logo, mostrar u ocultar)… investiga cómo lo hacen cal.com y calendly… por
  cierto, prioridad de que sea segura y no hackeable". Se propusieron TRES
  entregas y el usuario aprobó **«Ese orden»**:
  1. **v0.1.349 — HECHA**: reglas por servicio, varias duraciones, cupos
     grupales, topes por día/semana/mes y por cliente, festivos por país,
     vacaciones, asesores con foto y cargo, reparto por turno/carga/prioridad.
  2. **v0.1.350 — HECHA**: el calendario PROPIO de cada asesor (Ajustes →
     Cuenta → Mi calendario: conecta su Google Calendar u Outlook y elige en
     cuáles mira lo ocupado y en cuál crea las citas), enlace de **Meet o
     Teams** generado solo en cada cita (o un enlace fijo, en persona, por
     teléfono), y la **vuelta** (mover o borrar el evento en su calendario
     mueve o cancela la cita, revisado cada 3 minutos).
     **Para el operador**: en la pantalla de consentimiento de Google hay que
     sumar el permiso `calendar.calendarlist.readonly` (la guía de Plataforma
     → Integraciones ya lo lista con su justificación); sin él, «Mi
     calendario» de Google conecta pero no puede listar los calendarios (usa
     el principal). Microsoft no necesita nada nuevo.
  3. **Partida en dos**: **v0.1.353 — HECHA**: **aprobación** de citas
     configurable (todas o sólo la primera de cada cliente, regla por servicio,
     quién aprueba, plazo y qué pasa si nadie decide, panel en la ficha) y
     **seguridad reforzada** (código por correo, correos temporales
     bloqueados, frenos por correo, enlaces versionados: el del correo
     anterior ya no hace cambios) y **v0.1.354 — HECHA**: la página pública
     de la agenda con el motor de temas de los formularios (ADR-S94:
     plantillas, «Mis temas», colores, tipografía, portada, logo, mostrar u
     ocultar partes, distribución del calendario y los horarios, semana desde
     el domingo). **Con esto las tres entregas de la agenda quedan
     completas.** Siguiente: formularios entregas 2 (preguntas y lógica) y 3
     (medir, insertar, cobrar).
  Quedan fuera salvo que el usuario lo pida: cobrar al agendar y formularios de
  enrutamiento.
  **Nota de desarrollo**: el tenant 1 del entorno de dev está en plan `trial`
  con más de 500 registros; para las pruebas se subió a `enterprise` y se
  restauró al terminar.
- 2026-11-03 — **Conectar Outlook y Teams → v0.1.348** (addendum ADR-S22). El
  usuario estaba registrando la app de Microsoft y dijo: "la guía no está muy
  clara… no sé de dónde sacar los valores de abajo (Client ID y Client
  Secret)". Se le explicó paso a paso: el Client ID es el «Id. de aplicación
  (cliente)» en «Información general», y el secreto es la columna «Valor» (no
  el «Id. de secreto») de «Certificados y secretos». Después pidió dos cosas:
  1. **La indicación debajo de cada campo.** Hecho, con aviso si lo pegado
     tiene otra forma.
  2. **Cómo conectar el calendario de Outlook y Microsoft Teams**, porque
     creía que la integración era sólo de correo. El calendario de Outlook
     YA venía en la misma conexión de Outlook (acción «Crear evento en
     Outlook» y la agenda de citas). Teams no existía y se hizo:
     - mensajes a un canal (con «Elegir canal»);
     - mensaje directo a una persona;
     - mensaje a un chat de grupo;
     - «Agregar reunión de Teams» en los eventos de Outlook (y Meet en los de
       Google).

  **Pendiente del usuario**:
  - Terminar de cargar Client ID y Client Secret en Plataforma → Integraciones.
  - Para Teams, sumar en Entra los 5 permisos delegados: Team.ReadBasic.All,
    Channel.ReadBasic.All, ChannelMessage.Send, Chat.Create y
    ChatMessage.Send. No piden consentimiento del administrador.
  - Conectar Teams con una cuenta de trabajo de Microsoft 365.
- 2026-11-03 — **Barra de abajo personalizable → v0.1.347** (ADR-S93). Pedido
  del usuario: "permite que el menú de celular o de PWA sea personalizable,
  definir cuántos botones va a tener y qué botones o secciones; a algunos
  usuarios no les será importante Mi trabajo y les importará más los
  dashboards". Cada persona elige de 3 a 6 botones (con «Más», que va siempre
  al final) y cuáles: secciones, acciones (Buscar, Escanear, Asistente) o una
  lista o un tablero puntual. Se guarda en su cuenta por empresa, el admin
  puede dejar una barra del equipo y «Más» muestra lo que no está en la barra.
  Editor en **Más → Barra de abajo** y en **Ajustes → Cuenta → Apariencia**.
  **Pendiente del usuario**: probarlo en el teléfono tras la actualización.
- 2026-11-02 — **Franja blanca abajo en modo oscuro → v0.1.346** (addendum
  ADR-S79). Reporte del usuario con captura tras v0.1.345: "en el modo oscuro
  quedó una barra blanca abajo en la app debajo del menú". Era la barra de
  navegación de Android: Chrome la pinta con el `theme_color` del manifiesto en
  los dos modos (verificado en Chromium), y el neutro era #ffffff. Ahora el
  manifiesto no lleva `theme_color` salvo que la empresa elija un color, y la
  barra sigue el modo del teléfono. **Pendiente del usuario**: la app instalada
  se actualiza sola en uno o dos días; para verlo ya, quitarla y volver a
  instalarla.
- 2026-11-02 — **Apertura de la app y estudio del ícono → v0.1.345** (addendum
  ADR-S91). Reporte del usuario: el color de fondo de la primera pantalla no se
  aplicaba ("queda en un cuadrado, con fondo blanco o negro"), los ajustes eran
  confusos ("no sé si se seleccionó un color, un degradado o una imagen, se
  mezclan secciones") y con el celular en modo oscuro veía negro en vez del
  color de la vista previa. Diagnóstico: su servidor ya mandaba `#00a7cd` en los
  dos modos. **En modo oscuro Android usa su propio fondo para abrir la app
  instalada y no se puede cambiar desde la web** (verificado en el código de
  Chromium). Se rehízo el estudio en tres pasos, con la vista previa fiel del
  modo oscuro. **Pendiente del usuario**: probar con el teléfono en modo claro.
  Si en claro tampoco sale el color, la app instalada no tomó el cambio y hay
  que quitarla y volver a instalarla.
- 2026-11-02 — **QR de los registros → v0.1.344** (ADR-S92). Pregunta del
  usuario: "lo de los códigos qr, ¿cómo funciona? no entiendo qué hacen, solo
  pusiste un icono que escanea qr pero ni idea cómo usarlo o su utilidad". Le
  expliqué el escáner (busca por el campo «Código» de la lista, escaneo
  continuo, crear con el código puesto) y reconocí el hueco: la app no generaba
  códigos y no lo explicaba. Le propuse tres mejoras y respondió **"sí, hazlas
  las tres"**:
  1. QR por registro y etiquetas en PDF.
  2. El QR en correos, WhatsApp y PDF.
  3. Una explicación del escáner la primera vez.

  **Hecho**: las tres. **Decisión mía, avisada**: el QR guarda por defecto el
  ENLACE a la ficha (sirve en cualquier lista sin configurar nada). El código
  del campo es opcional para quien ya tiene SKU o serial. **Queda abierto**:
  que lo pruebe con etiquetas reales. Si usa otra marca de etiquetas que no
  coincide con los formatos de carta, A4 o rollo, se agrega su medida.
- 2026-11-02 — **Ícono de la app y pantalla de apertura → v0.1.343**
  (ADR-S91). Pedido del usuario: "la primera pantalla de la PWA, el fondo con
  sólo el logo y un círculo alrededor, se ve feo; el fondo del ícono de la app
  instalada tampoco me gusta; necesito que se vea bonito y premium". Diagnóstico
  (miré lo que sirve su servidor): su logo es un emblema redondo (degradado
  azul-cian con una montaña blanca) y la app lo reducía al 60 % sobre blanco →
  plato blanco con un círculo más pequeño adentro. **Hecho**: «estudio del
  ícono» en Plataforma → Marca; la app sugiere sola un ícono de app (fondo con
  los colores del logo de borde a borde + sólo la marca blanca), vistas previas
  en vivo (inicio en círculo y cuadrado, iPhone, apertura clara y oscura,
  computador y pestaña), y la apertura de Android elegible: sobre el fondo de
  la app (default, barras neutras) o con el color del ícono a pantalla
  completa (avisa que en algunos teléfonos la barra de abajo toma ese color).
  **Para el usuario**: actualizar, entrar a Plataforma → Marca, tocar «Ver el
  ícono sugerido» (o subir de nuevo el ícono), guardar, y quitar y volver a
  instalar la app del teléfono. **Queda abierto**: que lo vea en su teléfono y
  diga si prefiere la apertura con el color del ícono; la primera pantalla la
  sigue dibujando Android (no se puede quitar).
- 2026-11-02 — **Navegación → v0.1.342** (ADR-S90). Pedido del usuario:
  "revisa la navegación y los menús… en celular el menú aparece como un
  desplegable o puede ser confuso… en la PWA debería tener un menú fijo o
  flotante como las apps… que sea súper fácil para casi cualquier usuario".
  Diagnóstico que le di: en el teléfono todo estaba detrás de una hamburguesa
  que abría el menú del escritorio como cajón; Ajustes y Plataforma usaban un
  desplegable nativo; la barra de arriba tenía seis botones; las listas
  ocupaban media pantalla cada una; Ajustes era una lista plana de 15
  secciones. **Hecho**: barra de pestañas abajo (Listas · Mi trabajo · Buscar ·
  Avisos · Más), «Más» con todo lo demás, avisos a pantalla completa, Ajustes y
  Plataforma con índice táctil y «‹ Volver», agrupados por tema (también en el
  escritorio), listas en filas con Recientes y Favoritos arriba, alto real en
  iPhone. **Decisión mía, avisada**: «Más» dice «Tableros» como el riel (la
  página sigue titulada «Dashboards»). **Queda abierto**: nada; sugerencia
  para más adelante si el usuario la pide: unificar «Dashboards»/«Tableros» en
  toda la app.
- 2026-10-31 — **Sugerencias por lista → v0.1.341** (ADR-S89). Pedido del
  usuario: recomendaciones de automatizaciones, tableros, etc. basadas en la lista
  concreta (las de hoy eran genéricas), sin un motor que gaste tokens todo el
  tiempo, útiles para listas con datos y recién creadas, y que se puedan apagar.
  Le propuse dos capas (reglas gratis + IA sólo al tocar el botón) y respondió
  **"5 por mes, solo admin y gerente, las dos juntas"**. **Decisiones**: cupo de IA
  para esto aparte del asistente (`list_suggest_ai_monthly`, default **5 por
  empresa y mes**, se cambia en Plataforma → Asistente IA; con clave propia, sin
  límite; si falla, no se descuenta); lo ven **sólo administradores y gerentes**;
  la IA ve estructura y números, **nunca** textos de registros, correos,
  teléfonos ni personas; sólo propone vistas, tableros, campos y
  automatizaciones internas (nada que llame afuera); si la lista no cambió,
  volver a analizar espera 30 días; nada se crea solo. Apagado: por persona
  (aviso de la cabecera) y por empresa (con IA / sólo reglas / apagadas, sólo el
  admin). Sin migración (Redis + `settings`). **Pregunta del usuario después**:
  "si la IA no lee los registros, ¿cómo entiende de qué trata la lista?" — le
  expliqué qué viaja (nombres de campos, opciones con conteos, números, fechas
  vencidas, vinculadas, lo que ya existe, el propósito) y lo que no ve (el texto
  libre), y ofrecí una casilla opcional de ejemplos enmascarados → **"sí,
  agrega la casilla de ejemplos de texto"**: entró en la misma versión
  (apagada por defecto). **Queda abierto**: nada.
- 2026-10-31 — **Duplicar en un clic → v0.1.340**. Reporte del usuario: "si un
  registro no tiene subtareas igual pregunta si quiero duplicar subtareas, al
  final sale «registro duplicado» y tengo que hacer clic para aceptar… son 3
  clics; sólo debería decir si falló y cuál es el error, y si todo está correcto
  mostrar que se duplicó y cerrarse solo". Hecho: sin diálogo en el menú de la
  fila ni en la barra de selección; aviso que se cierra solo con «Deshacer»; en
  rojo con el motivo si falla. **Decisión**: la barra copia con subtareas (lo
  dice el aviso); el menú de la fila, si el registro tiene subtareas, ofrece
  «con» y «sin» como dos opciones de un clic. **Regla para el futuro** (pedido
  implícito): acciones rápidas y reversibles → sin confirmación ni diálogo de
  resultado; aviso que se cierra solo + «Deshacer», y el error con su motivo.
- 2026-10-31 — **Crear una lista desde un archivo → v0.1.339** (ADR-S88). Pedido
  del usuario: "que al subir un Excel la IA decida el tipo de cada campo, mapee
  las columnas sola, pregunte qué columnas descartar y al final recomiende el
  tablero, las automatizaciones o los ajustes, para aprobarlos". Le propuse el
  diseño (reglas primero sobre todo el archivo, IA opcional con resumen
  protegido, consentimiento en línea, cupo propio, varias hojas → listas
  vinculadas, limpieza de datos, recomendaciones que se aprueban) y respondió
  "sí, hazlo con las dos entregas juntas". **Decisiones**: la IA nunca ve correos,
  teléfonos, documentos ni nombres (sí las categorías); cupo de IA para esto
  aparte del asistente (`import_ai_monthly`, default **3 por empresa y mes**, se
  cambia en Plataforma → Asistente IA; con clave propia, sin límite); nada de lo
  recomendado se crea solo. **Queda abierto**: la oferta de guardar la skill
  «landing-kit» dentro del repo (`.claude/skills/`) sigue sin respuesta.
- 2026-10-30 — **Skill «landing-kit» para otros proyectos** (pedido del usuario:
  "créame una skill para descargar, para usarla en otros proyectos, de lo que hiciste
  para pasarme todo lo de la landing… imágenes, videos, motion graphics y textos muy
  completos"). Hecha y entregada como `landing-kit.zip` (sin release, fuera del repo):
  `SKILL.md` con el procedimiento en 10 fases y 8 reglas que no se negocian;
  `references/` (descubrimiento, competencia, SEO, datos de ejemplo, capturas, motion,
  textos, prompt de diseño, empaquetado); scripts **generalizados y probados**:
  - `shoot.mjs`: capturas en escritorio, oscuro y celular desde un JSON, con login por
    configuración y `${ENV:…}` para la contraseña.
  - `record_clips.mjs`: clips con cursor por screencast de CDP.
  - `record_animation.mjs`: motion graphics cuadro a cuadro con el reloj de WAAPI, en
    loop exacto.
  - `fetch_pages.mjs` + `page_audit.py`: la competencia.
  - `autocomplete.py`: el autocompletado de Google por país.
  - `brand_colors.py`, `contact_sheet.sh`, `compress_media.sh` (WebP, AVIF, videos
    livianos y OG).
  - `check_kit.py`: archivos citados, marcadores, conteo de title y meta, y voseo.

  Además trae `templates/` (configuración, tomas, escenas, una escena de motion en
  HTML/CSS y esqueletos de los 7 documentos) y `ejemplo/` (los documentos del kit de
  Imagina Base + muestras de capturas y de una animación). Si pide cambios en otra
  sesión, el scratchpad ya no existe: pedirle el zip o rehacerla con esta descripción.
- 2026-10-30 — **Prueba configurable y sin plan gratis → v0.1.338** (ADR-S87).
  Pedido del usuario: "permíteme ajustar el trial: qué se le permite, cuántos
  usuarios… limitarlo, ej. 15 días, y después se le deshabilita todo hasta que
  contrate; los que no renuevan, tras unos días de gracia, pasan al plan trial.
  No quiero cuentas free: con pocos clientes, muchos usuarios gratis me harían
  cambiar de servidor sin que paguen". **Valores por defecto** (todo editable en
  Plataforma → Planes → «Prueba y vencimientos»): 15 días de prueba, al terminar
  **la cuenta se pausa** (sólo elegir plan, pagar y descargar datos), 5 días de
  gracia, y pasada la gracia **pasa al plan de prueba con 0 días** (pausada al
  instante). Lo que incluye la prueba (usuarios, registros, módulos) se edita en
  el plan **«Trial»**. **Ojo, decisión pendiente del usuario**: las empresas que
  YA estaban en prueba siguen SIN fecha de fin — la tarjeta las cuenta y ofrece
  «Darles 15 días desde hoy» (nunca toca la del superadmin); no se aplicó solo
  para no pausar a nadie por sorpresa. **Quedó fuera**: el white-label (marca de
  la empresa) como módulo vendible (se lee en ~14 lugares: pasada aparte si lo
  pide) y la configuración del portal guardada por el PATCH genérico de la lista.
  **Ideas para sugerir**: borrar automáticamente (tras N días y con aviso) las
  pruebas abandonadas que nunca pagaron, para no acumular datos en el servidor;
  y un aviso al operador cuando una prueba termina sin pagar (para hacer
  seguimiento comercial). Sin novedad en el catálogo: es una función del
  operador (las empresas ven los avisos de días y la pantalla de pausa).
- 2026-10-29 — **Kit de landing actualizado con SMS y WordPress** (pedido del
  usuario: "actualiza la información… y las capturas para hacer la landing con lo
  de sms y wordpress; no sé si tengas algo más para añadir"). Hecho sin release
  (sólo `docs/landing/`): bloques 12-A (WordPress) y 12-B (SMS), pestaña 7
  «Tu sitio WordPress», marquee, comparativa, 7.ª tarjeta de Latam (Ley 2300),
  FAQ 16-20, grupos F (WordPress/SEO) y G (SMS) de palabras clave sacados del
  autocompletado real (CO y MX: la Ley 2300 se busca como **«ley dejen de
  fregar»**; «wordpress bulk edit» se busca en inglés), 7 páginas nuevas (16-22,
  con dos herramientas gratis: contador de SMS y revisor de título/descripción),
  2 ideas de motion, sección «Ideas para sumar a la landing» en el LEEME.
  Capturas nuevas (fuera del repo, en el .zip): 15 de escritorio (28-41 + 30b),
  3 oscuro, 3 celular, 14-integraciones rehecha, y 2 clips (`sms-desde-la-ficha`,
  `wordpress-editar-palabra-clave`). **Cómo se armó la demo** (por si hay que
  repetirla): WordPress real en el puerto 8092 + **también en el 80** con
  `127.0.0.1 distribuidoraandina.co` en `/etc/hosts` (la conexión 12 de la
  empresa 22 apunta a `http://distribuidoraandina.co`); contenido Andina
  (blog, páginas, CPT «Recetas» con ACF y «Calorías» como campo nuevo para el
  aviso de novedades), Rank Math, el complemento instalado desde el zip de la
  app; SMS con `scripts/dev/fake-sms.mjs 4897` y el API arrancado con
  `SMS_*_API_URL` apuntando al doble (conexiones 13 Onurix y 14 Twilio). Los
  scripts quedaron en el scratchpad de la sesión (se pierden con el contenedor).
  **Detalle encontrado (para una versión del complemento):** la página
  Herramientas → Imagina Base dice «2 enviados · **1 pendientes**» — el texto no
  hace plural/singular (`class-ibc-hooks.php`, «%3$d pendientes»). **Ojo en la
  landing:** no prometer «actualizaciones firmadas» del complemento mientras no
  esté el secreto `RELEASE_SIGNING_KEY` en GitHub.
- 2026-10-29 — **RESUELTO** (el usuario: "listo, ya me liberó mucho espacio. sí,
  hazlo en la próxima versión para que no vuelva a pasar") → **v0.1.337**
  (ADR-S86). Detalle del diagnóstico abajo. Queda del lado del usuario, OPCIONAL:
  recrear el contenedor de Postgres una vez (runbook-disk §4) para tener el
  `entrypoint` y el comando comprimido; sin eso la app repara el permiso,
  comprime el archivo cada 15 min y avisa si algo se traba.
- 2026-10-29 — **Servidor de producción sin espacio: no instala v0.1.336**
  (captura de Plataforma → Disco): 927 MB libres de 57,7 GB (el actualizador
  pide 1 GB). Lo que la app mide de sí misma es ~0,8 GB (versiones 755 MB,
  copias 16 MB, archivos 2 MB); los **56,1 GB** están en «Base de datos,
  sistema y otros» = todo lo demás del disco, que el API (usuario `deploy`) no
  puede medir. Sospecha principal: **WAL de Postgres** en los volúmenes Docker.
  OJO con el `archive_command`: `test ! -f /wal_archive/%f && cp …` — si un
  `cp` quedó a medias (disco lleno), ese archivo existe y el archivado falla
  para siempre → Postgres guarda TODO en `pg_wal` (~4,5 GB/día con
  `archive_timeout=300`) y la poda (`find -mmin +4320`) nunca corre. Si es eso,
  con 927 MB Postgres se cae en horas. **Diagnóstico confirmado** (salida del
  usuario): `/var/lib/docker/volumes` 46 GB, pgdata **45,8 GB**,
  `/wal_archive` **vacío (4 KB)**, `pg_stat_archiver`: archived_count **0**,
  failed_count **86.256** (≈20 días: desde que se recreó el contenedor el
  2026-10-09), last_failed_wal `…0A`. **Causa raíz** (reproducida aquí con el
  `docker-compose.prod.yml` tal cual): el volumen nombrado `walarchive` se
  monta en `/wal_archive`, que no existe en la imagen, y Docker lo crea
  **root:root 755** → Postgres (uid 70) recibe `cp: can't create …: Permission
  denied` y NUNCA archivó nada; todo el WAL quedó en `pg_wal`. Afecta a toda
  instalación con ese compose (también `install.sh`). Pruebas: (1) dar permiso
  primero dispara el backlog a ~700 MB por segundo en el archivo (disco lleno);
  (2) un symlink a /dev/null no sirve (el `cp` de busybox dice «File exists»);
  (3) **lo que sí**: como usuario postgres renombrar `archive_status/*.ready` →
  `.done` + `CHECKPOINT` → pg_wal baja a ~1 GB (max_wal_size) sin copiar nada,
  y DESPUÉS `chown postgres:postgres /wal_archive` → lo nuevo se archiva bien.
  Se le pasaron esos 3 pasos + comprobación; **esperando que confirme** el
  espacio libre y que instale v0.1.336. A su ritmo (~2,3 GB/día de WAL) el
  archivo con poda a 3 días quedará en ~7 GB. **Para el próximo release**
  (propuesto, sin aprobar): compose con entrypoint que haga `mkdir -p
  /wal_archive && chown postgres` antes de arrancar; segmentos comprimidos con
  gzip en el `archive_command` (un segmento forzado por `archive_timeout` es
  casi todo ceros: 16 MB → KB) con `pitr-restore.sh` que los descomprima;
  tarjeta Disco que mida base/`pg_wal`/archivo vía SQL (la conexión base es
  superusuario: `pg_ls_waldir()`, `pg_stat_archiver`, `pg_database_size`) y
  abra un **Problema** (ADR-S44) si el archivado falla; y que «Liberar
  espacio» marque los pendientes y haga el checkpoint por SQL (`COPY … TO
  PROGRAM` corre como postgres dentro del contenedor). El `chown` necesita
  root: por `docker exec` sólo si el usuario del API está en el grupo docker.
- 2026-10-29 — **Pregunta del usuario sobre el sitio conectado** (después de
  v0.1.335): (a) si el cliente crea en WordPress un campo personalizado o un
  tipo de contenido nuevo, ¿cómo se suma a la app? → YA existe: «Traer otra
  columna» y «Traer otro tipo de contenido» en la página del sitio consultan el
  sitio EN VIVO al abrirse (caché de 1 min en el navegador; el complemento
  refresca su lista de meta suelta cada 15 min). Límites dichos: un tipo de
  contenido sin `show_in_rest` no aparece; sin el complemento, un campo sólo se
  ve si la API lo expone y si alguna de las 20 entradas más recientes lo tiene;
  no hay aviso de «hay cosas nuevas». (b) **Pedido**: lo que se borró del todo
  en el sitio o en la tienda (p. ej. una colección de prendas que no vuelve)
  queda en la app marcado «Papelera» para siempre, ocupando registros del plan y
  estorbando, y en una lista espejo no se puede borrar (403 `store_managed`).
  **HECHO en v0.1.336** (el usuario aprobó: «Sí, hazlo así, con el aviso de
  novedades también»). Lo que se le había recomendado: permitir quitar de la app los registros
  que la fuente YA tiene borrados (uno, varios o «Quitar los N borrados» desde el
  aviso de la lista → van a la papelera de la app 30 días y dejan de contar para
  el plan), un ajuste por sincronización «cuando algo se borra allá: conservarlo
  marcado / quitarlo de la app solo», y que si vuelve a aparecer en la fuente
  (se restauró en WordPress) reaparezca. Los que siguen vivos en la fuente no se
  pueden quitar (volverían). Sumar de paso un aviso «hay columnas o tipos nuevos
  en tu sitio» en la página del sitio.
- 2026-10-29 — **El usuario preguntó si el complemento de WordPress tenía
  pruebas de seguridad y rendimiento** («no quiero que lo ponga lento, que
  choque con otros plugins ni que sea una puerta de hackeo»). Se le contestó con
  honestidad que no se habían hecho a fondo y se hizo la auditoría completa →
  **v0.1.335** (complemento 1.1.0, addendum de ADR-S84): cero consultas en las
  páginas públicas, avisos sólo de las columnas que se traen, índice de «dónde
  se usa» en segundo plano, permisos campo por campo, Editor sin poder desviar
  avisos, origen de actualizaciones como datos y **actualizaciones firmadas**.
  **Para el usuario**: (1) **configurar el secreto `RELEASE_SIGNING_KEY` en
  GitHub** (pasos en `docs/runbook-updates.md`): hasta entonces el complemento
  sale SIN firma y las actualizaciones sólo verifican que la versión sea más
  nueva —el release de v0.1.334 también salió sin `.sig`, o sea que tampoco se
  firma el bundle de la app—. La primera versión firmada que reciba un sitio se
  acepta sin verificar (no tiene contra qué comparar) y desde ahí se exigen
  firmas; (2) recomendar a cada cliente conectar un usuario **Editor creado
  sólo para la app**; (3) con **Wordfence** hay que dejar activas las
  contraseñas de aplicación (la app da los pasos). Sin probar en real: JetEngine
  (comercial) y multisitio (sólo revisión de código). Entorno de la prueba:
  `sh scripts/dev/wordpress-up.sh 8091 up` (sitio de carga) + PHP 7.4 en Docker.
- SMS (v0.1.332): verificado sólo contra dobles. Con la primera cuenta real de
  cada proveedor, revisar los SUPUESTOS de ADR-S82 (BulkGate sin `country`,
  LabsMobile `long`/`credits`/valores de `status`, Infobip saldo, Onurix `id` y
  estados). La URL de avisos de BulkGate hay que pegarla en su portal.
- 2026-10-29 — **Dos integraciones nuevas pedidas por el usuario: SMS y
  WordPress.** (1) SMS con proveedores económicos + Twilio (lo usan muchas
  plataformas) + BulkGate. (2) Conectar sitios WordPress «como WooCommerce»:
  traer páginas, entradas, CPT, categorías y meta/ACF, y editar campos elegidos
  —sobre todo el SEO de Rank Math—, SIN traer el contenido completo, y pudiendo
  traer sólo un CPT con ciertos campos. Se le mandó una propuesta (SMS: catálogo
  por clave + acción «Enviar SMS» + contador de segmentos/tildes + estado de
  entrega + horario de la Ley 2300; WordPress: conexión de un clic con
  «Autorizar aplicación» del propio WordPress, asistente que elige tipo de
  contenido y columnas, el motor de sincronización de la tienda generalizado, y
  un complemento propio porque Rank Math no expone sus campos por REST). **Respuesta del
  usuario**: «hazlo todo como recomiendas» salvo **crear páginas o entradas
  desde la app** (lo nuevo se crea en WordPress; se mira si un cliente lo pide).
  Plan: v0.1.332 SMS (publicada), v0.1.333 WordPress sin complemento
  (publicada), v0.1.334 el complemento «Imagina Base Connector» (publicada). **Pedido
  completo.** Pendientes: publicar el zip del complemento como asset de GitHub
  desde una versión posterior (los servidores anteriores a v0.1.334 eligen «el
  primer .zip»), JetEngine sin prueba real, «dónde se usa» no ve Elementor/Divi,
  y probar en un hosting real con plugins de seguridad (Wordfence) y multisitio.
  Para probar contra un WordPress real: `sh scripts/dev/wordpress-up.sh 8090 up`. El vencimiento de la
  prueba de 15 días quedó **para después** (lo dijo el usuario).
- 2026-10-29 — **Landing para SEO** (ADR-S81). Decidido con el usuario: NO un
  home dentro de la app (SPA, white-label, releases) ni imaginawp.com; un sitio
  propio en WordPress en **`imagina.cloud/base`** (imagina.cloud = marca paraguas
  de sus apps; la raíz presenta la marca y enlaza a /base). v0.1.331 deja la app
  lista. **Para el usuario**: actualizar; en Plataforma → Marca poner «Sitio del
  producto» = `https://imagina.cloud/base`; en el sitio, el botón de registro a
  `https://base.imagina.cloud/registro?utm_source=sitio&utm_campaign=<página>`;
  revisar `PUBLIC_BASE_DOMAIN` del `.env` (si es la raíz con un comodín
  `*.imagina.cloud`, podría chocar).
  **Hecho (mismo día, a pedido del usuario): kit de landing para Claude Design.**
  El usuario lo pasa a Claude Design para diseñar la landing. Los textos viven en
  el repo en **`docs/landing/`** (prompt para pegar + 7 de seguimiento, textos
  sección por sección con 13 preguntas frecuentes, SEO con palabras clave /
  título / meta / JSON-LD / arquitectura y primeras 15 páginas, motion con 15
  ideas, estudio de 14 competidores, índice de capturas). Las capturas (27
  escritorio + 6 oscuro + 8 celular), las 18 animaciones de Aprende grabadas
  cuadro por cuadro y 8 clips de la app en uso NO están en el repo (pesan
  ~37 MB): se armaron con la empresa de ejemplo «Distribuidora Andina» (tenant
  de desarrollo, laura@andina.test) y se le entregaron en un .zip + una página
  de revisión (artifact privado). **Decisiones del usuario (mismo día), ya en los
  textos**: prueba gratis de **15 días** sin tarjeta; precios Starter $59.000 /
  Pro $199.000 COP al mes por empresa (los va a cambiar él); **asistente IA y
  soporte en español SOLO en los planes de pago**; el importador de Excel (casi
  automático) es el camino principal de «Cómo empiezas»; imagina.cloud es un
  WordPress recién instalado **cerrado a los buscadores a propósito** (sin
  contenido; el 403 que se vio era eso, no un riesgo) — checklist del día de
  lanzamiento en `docs/landing/03-SEO.md` §6; WordPress está en la raíz, así que
  /base/ es una página madre del mismo sitio. Quedan [CONFIRMAR]: medios de pago
  activos y redes sociales. **Ojo, dos cosas de la APP que no coinciden con lo
  decidido** (avisadas al usuario, esperan su respuesta): (1) **la app no hace
  vencer la prueba a los 15 días** — `isEffectivelyReadOnly` sólo mira
  status/archived_at/subscription_ends_at/paid_until y el alta no fija ninguno;
  propuesta: días de prueba configurables por plan (default 15), avisos antes de
  vencer y solo-lectura + export al vencer (ADR-S09) hasta pagar; (2) la semilla
  del plan Trial trae 20 pedidos de IA/mes: para «IA sólo en pago» hay que
  ponerlo en 0 en Plataforma → Planes, y entonces «Cuéntanos de tu negocio» de
  la bienvenida queda deshabilitada durante la prueba (plantillas y Excel
  siguen). Ideas
  que salieron del estudio y quedan para cuando las pida: que `/registro`
  acepte `?plantilla=crm` (la página de cada plantilla abre la app con esa
  plantilla), publicar el manual «Aprende» y las 39 ideas como páginas del
  sitio, e insignia «Hecho con Imagina Base» en formularios/agendas públicas
  de planes sin marca blanca.
- 2026-10-28 — **Un cliente con la sincronización SQL que falla y se arregla
  sola** («Failed to connect to sqlserver-erpbinapps.database.windows.net:1433
  in 15000ms», 3 veces en 3 días, cada una resuelta sola en la corrida
  siguiente). Ese texto es el timeout del driver: la base NO contestó nada en
  15 s — no es un error de la consulta ni de la app. Probable: Azure SQL en
  pausa (serverless) o saturada, o un corte de red. v0.1.330 reintenta, espera
  30 s y explica en qué paso se cortó. **Para el usuario**: actualizar; si
  vuelve a pasar, el mensaje dirá si el puerto abría (→ base) o no (→ red).
- 2026-10-27 — **No le gusta cómo abre la app instalada** (logo en el centro
  dentro de un círculo de color). Se le mostraron maquetas (hoy / A logo limpio
  sin salto / B la app se arma) y eligió **B**. v0.1.329: la primera pantalla
  es de Android (ícono en círculo, no se puede quitar) → el ícono pasa a tener
  el fondo de la app (sin disco); la segunda pasa a ser el esqueleto de la app.
  **Para el usuario**: actualizar; en Plataforma → Marca tocar «Actualizar
  ícono»; quitar y volver a instalar la app del teléfono. Queda verificar en su
  teléfono.
- 2026-10-27 — **Barra de abajo blanca en modo oscuro + ícono raro en la app
  instalada** (reporte del usuario con capturas tras v0.1.327). La barra de
  Android sale del `background_color` del manifiesto (no de la meta): v0.1.328
  la hace seguir el tema del dispositivo. El ícono: el usuario subió el logo
  pero no el ícono, así que salía el genérico; v0.1.328 usa un logo cuadrado
  como ícono. **Para el usuario**: actualizar, en Plataforma → Marca tocar
  «Usar el logo como ícono» (o subir de nuevo el logo original, mejor calidad)
  y guardar; en el teléfono quitar la app y volver a instalarla. Queda
  verificar en su teléfono.
- 2026-10-27 — **Barra de abajo con el color de marca + logo inventado + login
  y arranque feos** (reporte del usuario tras v0.1.326). La barra: el servidor
  ya entrega todo neutro (verificado en base.imagina.cloud); el teléfono guarda
  los colores de cuando se instaló la app → quitarla y volver a instalarla (o
  esperar a que Android la actualice). El logo: era un ícono de fábrica (una
  chispa) — se quitó; ahora el operador sube **su** logo e ícono en
  **Plataforma → Marca** (v0.1.327). Pendiente: que el usuario suba su logo y,
  si quiere, nos pase el archivo para dejarlo como el de fábrica; ícono propio
  de la app instalada por empresa (en su dominio) queda para otra versión.
- 2026-10-27 — **PWA: barras del teléfono y ofrecer instalación** (pedido del
  usuario: "toma los colores de la marca arriba y abajo y se ve muy raro…
  deberían poderse ajustar, por defecto blancos o negros… y la primera vez en
  un dispositivo debería ofrecer la instalación"). Hecho en v0.1.326: neutras
  por defecto, ajuste en Ajustes → Marca, ofrecimiento automático. Queda
  verificar en un teléfono real (el navegador sin interfaz del entorno simula
  el aviso de instalación).
- 2026-10-27 — **«La ayuda es muy básica y poco ilustrativa»** (feedback del
  usuario sobre la fase 7: "esos tours no me gustaron… en ClickUp las novedades
  traen imágenes o una pequeña animación… lo que hiciste es muy básico, muy
  poco ilustrativo, muy corto"). Eligió **las dos cosas** (animaciones +
  capturas reales que se regeneran solas) y **la ayuda completa primero**.
  Plan en cuatro versiones: **v0.1.322** centro de aprendizaje (HECHA);
  **v0.1.323** galería de ideas y recetas que se activan con un clic (HECHA);
  **v0.1.324** recorridos rediseñados (visuales e interactivos) (HECHA); **v0.1.325**
  novedades con imagen o animación (también las ya publicadas, carrusel estilo
  ClickUp) (HECHA — el plan quedó completo). Pendientes menores que salieron al escribir el manual: no hay
  pantalla para cambiar el nombre o el correo propio; el export JSON de una
  lista (`exportList`) no tiene botón; la cuenta de cobro en PDF no muestra el
  nombre del cliente cuando el campo es una relación y el diálogo «Cobrar» toma
  la moneda del registro aunque la cuenta de Mercado Pago sea en COP; la
  carpeta de Google Drive se sigue llamando con el nombre del producto.
- 2026-10-26 — **Fase 7 completa: «hacer la app súper fácil de entender»**
  ("por el momento me interesa el «empezar fácil»… tutoriales, guías
  interactivas, un paso a paso… dándole un tour al usuario y guiando por toda
  la app… que los usuarios sepan de las novedades… y de las funcionalidades
  nuevas que acabo de implementar… tutoriales de acceso rápido"). Del resto de
  la propuesta (automatizaciones completas, duplicados, IA en el día a día,
  calendario en dos sentidos) no eligió nada por ahora: sigue en
  `docs/ideas.md`. Tres entregas en paralelo sobre el contrato común
  `apps/web/app/admin/help/helpBus.ts` (commit `ff47cbe`): (1) **Empezar
  fácil** (F7: «Cuéntanos de tu negocio» con IA + por tipo de negocio + datos
  de ejemplo borrables + «Primeros pasos» que se detectan solos; slot 1,
  `imagina_slot_7a`); (2) **Guías y recorridos** (I7 ampliada: motor de
  recorridos propio, recorrido de bienvenida por rol, recorridos por tarea,
  panel «Ayuda» con 35-50 guías «¿Cómo hago…?», guías en Ctrl+K y Plataforma →
  Ayuda con contacto de soporte, video por guía y guías propias del operador;
  slot 2, `imagina_slot_7b`); (3) **Novedades** (catálogo en código que viaja
  con cada versión + entradas del operador en Plataforma → Novedades, panel,
  destacadas y franja de avisos, I9; migración 0092; slot 3,
  `imagina_slot_7c`). Decisiones tomadas por defecto (se pueden cambiar): el
  armado con IA cuenta como UN pedido de la cuota y lleva consentimiento en
  línea (no activa el asistente de la empresa); los videos los pega el
  operador (YouTube/Vimeo/Loom) porque no se pueden producir aquí; ningún
  texto de ayuda dice «Imagina Base» (white-label). Al integrar: **regla nueva
  del ritual** — cada versión con cambios visibles agrega su novedad al
  catálogo, y las guías/recorridos se mantienen al día (un test detecta anclas
  rotas). Briefs en la carpeta temporal de la sesión (`brief-f7-*-full.md`).
  **Avance**: el contenedor se reinició a mitad de camino; el trabajo estaba en
  disco (se respaldó con commits `wip` en cada worktree) y las tres entregas se
  retomaron. **Empezar fácil publicada en v0.1.318** (sin migración, ADR-S72)
  y **Novedades en v0.1.319** (migración 0092, ADR-S73) y **guías,
  recorridos y centro de ayuda en v0.1.320** (sin migración, ADR-S74). Al
  integrar Novedades se le agregó la novedad de «Primeros pasos» al catálogo, y
  su spec pasó a calcular del catálogo cuántas ve cada rol (contaba a mano y se
  rompía con cada entrada nueva). Al integrar las guías: el ofrecimiento del
  recorrido sube por encima del botón «Primeros pasos» (los dos estaban abajo a
  la derecha y se tapaban) y se verificaron las tres piezas juntas (21/21).
  **Queda fuera** (anotado en `docs/ideas.md` §5): editar el texto de las
  guías del sistema (el operador sólo las oculta o les pone video), recorridos
  dentro del constructor de formularios y del acceso al portal, guías en otros
  idiomas, métricas de qué guías se usan y que el asistente IA consulte las
  guías. **Esperando al usuario**: decidir qué sigue (el banco de ideas tiene
  las opciones que no eligió).
- 2026-10-26 — **Fase 4: sólo la agenda de citas.** De la fase 4 propuesta
  («Hacia afuera»: API pública + n8n/Make/Zapier, firma electrónica,
  facturación DIAN y agenda de citas) el usuario eligió SÓLO la **agenda de
  citas pública estilo Calendly (D5)**: "lo otro puedes ponerlo en un documento
  de ideas para retomar después si surge la necesidad". **Publicada en
  v0.1.313** (migración 0087); con eso la fase 4 queda completa. El resto quedó en **`docs/ideas.md`**, el banco de
  ideas: todo lo no descartado (pospuestos de la fase 4, oleadas 5-6, el resto
  del estudio por área, lo que quedó afuera de cada versión, pendientes
  técnicos, lo no recomendado y lo descartado). **Cuando el usuario pida ideas,
  partir de ahí** (regla 7 de `CLAUDE.md` §6).
- 2026-10-26 — **Fase 5 aprobada sin «De documento a registro»** ("de esta fase
  5 quitaría lo de «De documento a registro» y lo dejaría en ideas, de resto en
  esa fase haría todo"). Entregas: (1) **PWA + notificaciones push + escáner de
  códigos** (H1+H3); (2) **mesa de ayuda por correo + SLA** (D2+E5), con los
  correos entrantes leídos del buzón de la empresa por **IMAP** (lo recomendado:
  sin costo extra; leer Gmail por su API exige un permiso restringido con
  auditoría paga, descartado como camino); (3) **WhatsApp oficial (Meta Cloud
  API)** con plantillas aprobadas y disparador «llega un mensaje», guardando
  sólo el último mensaje, el estado y un resumen opcional (cada empresa conecta
  su propia cuenta de WhatsApp Business). Orden: (1) primero, (2) después y (3)
  al final. Se arranca cuando estén publicadas las tres entregas en curso
  (Equipos, Roles e invitados, Agenda). F3 quedó en `docs/ideas.md`.
  **Avance**: (1) publicada en v0.1.314 (migración 0088). (3) WhatsApp terminó
  antes que (2) y se publicó primero, en **v0.1.315** (migración 0089); la mesa
  de ayuda salió en **v0.1.316** (migración 0090) y con ella la **fase 5 queda
  completa**. Para no romper el orden de
  Drizzle (no aplica una migración con `when` menor que la última aplicada),
  los números se reasignaron al integrar: WhatsApp 0089 (…230), mesa de ayuda
  0090 (…240), agentes de IA 0091 (…250).
- 2026-10-26 — **Fase 6: sólo «Agentes de IA» (E6)** ("por el momento solo me
  interesaría la de Agentes de IA, los otros por el momento ponlos en ideas").
  Un agente con nombre y tarea que corre cuando pasa algo, con herramientas
  limitadas, cada paso en la actividad y aprobación opcional antes de cambiar
  algo (reusa las aprobaciones de la fase 3); tope de consumo de IA por agente.
  Idioma inglés/portugués, modo agencia, importadores y Google Sheets en dos
  sentidos quedaron en `docs/ideas.md` con sus decisiones pendientes. Va
  después de la fase 5. **Publicada en v0.1.317** (migración 0091); con ella
  la **fase 6 queda completa**. Decisiones tomadas por defecto (se pueden
  cambiar): un agente no tiene disparadores propios —trabaja cuando una
  automatización usa «Pedirle a un agente», así sirve con cualquier
  disparador—; el modo por defecto es «propone y una persona aprueba»; corre
  con el acceso vigente de quien lo configuró; el aviso `agent` llega a la
  campana con correo y push apagados.
- 2026-10-26 — **Fase 3 del estudio en marcha («arranca la siguiente fase
  completa de una»).** El usuario no respondió las tres preguntas pendientes,
  así que se tomaron decisiones por defecto (se le informan; se pueden cambiar):
  (1) los **invitados NO ocupan usuario del plan** y tienen su propio tope por
  plan, `max_guests` (trial 5, starter 20, pro 100, enterprise ilimitado,
  editable en Plataforma → Planes); (2) **admin queda fijo**, manager/agent/
  viewer siguen como roles base no editables y un **rol propio se crea
  partiendo de uno base** y hereda de él el ACL por lista y el alcance; (3)
  **aprobadores**: una o varias personas, un rol, un equipo o el campo Persona
  del registro, con «cualquiera» o «todos» por paso y pasos en serie;
  aprobar desde el correo LLEVA A LA APP (nunca con un token suelto).
  Cuatro agentes en paralelo, cada uno en su worktree y su slot:
  **Equipos + roles personalizados + invitados** (C1+C2+C3, slot 1, en dos
  grupos de commits publicables por separado), **Plantillas de registro +
  checklist** (C6+A9, slot 3), **Carga de trabajo** (B2, slot 4) y
  **Aprobaciones** (C5 + disparador/acción/espera, slot 5). Briefs en la carpeta
  temporal de la sesión (`brief-f3-*-full.md`). Al integrar: conectar los
  aprobadores por equipo (si Aprobaciones termina antes que Equipos) y el
  filtro por equipo de la Carga de trabajo. También falta que el usuario
  pruebe lo de las fases 1 y 2.
  **Avance**: Carga de trabajo publicada (v0.1.307); el enchufe para el filtro
  por equipo es el parámetro `users` del bundle y `workload_user_ids` en la
  vista (falta traducir «equipo → ids» cuando entre Equipos). Los otros tres
  agentes siguen. Los avisos de dependencias que encontró el agente se cerraron
  en v0.1.308 (queda planificada la migración a Zod 4, ver «Pendientes
  técnicos»). Aprobaciones publicada (v0.1.309, migración 0083). **Al juntarla
  con Equipos**: en el arranque del módulo de equipos llamar a
  `ApprovalsService.setTeamMembersResolver((tx, tenantId, teamId) => …memberIds)`,
  habilitar «Un equipo» (con su selector) en `ApprovalFlowsPanel` y agregar su
  test; con los roles propios, decidir si el aprobador «rol» los acepta (hoy,
  sólo los base de `APPROVER_ROLES`). Queda fuera de Aprobaciones: verlas en el
  portal del cliente, delegar/escalar por plazo y campos por paso.
  Checklists + plantillas de registro publicadas (v0.1.310, migración 0084).
  Equipos publicada (v0.1.311, migración 0085, ya conectada con Aprobaciones y
  Carga de trabajo) y Roles propios + invitados (v0.1.312, 0086): **fase 3
  completa**. Quedó afuera a propósito: invitados en el portal del cliente
  (mundos separados), roles propios basados en admin (fijo), aprobador «por rol
  propio» con nombre, y kanban/calendario/Gantt para invitados (sólo tabla).
  **Regla nueva para todo código**: capacidades con `can()` y actor con
  `aclOf(req)`; endpoints nuevos cerrados a invitados salvo `@AllowGuest()`
  revisado (hay tests que lo auditan).
- 2026-10-26 — **Hilos abiertos que dejó la fase 3** (no urgentes):
  (a) **eco del realtime**: la ventana de 2,5 s que ignora el eco de una edición
  propia (v0.1.253) también se come el aviso de una automatización que dispara
  esa misma edición (p. ej. completar un checklist pide una aprobación y la
  ficha abierta no la muestra hasta recargar). Es general a cualquier
  `record_updated`; el arreglo es llenar el `origin` que `RtInvalidate` ya tiene
  y nadie usa. (b) «Crear subtarea» del menú de fila (`RecordRowMenu`) abre el
  alta desde un menú y podría perder el foco del título como el bug que se
  corrigió en «Nuevo registro ▾». (c) Checklists en el portal (sólo lectura) y
  mover un ítem a otro checklist desde la interfaz (la API ya lo permite).
- 2026-10-23 — **El usuario aprobó las fases 1 y 2 del estudio «de una»**
  ("ya cuando termines y probemos seguimos con las otras fases"). Se trabajan
  en paralelo en copias aisladas (worktrees), cada una con su instancia de
  desarrollo propia (`scripts/dev/slot.sh <n>`: API 3100+n, app 5180+n, base
  `imagina_slot_<n>`), y se publican de a una, en el orden en que terminan.
  **Tanda 1**: Papelera A2 (slot 1), Campos A3+A4+A6 (slot 2), Datos
  personales I10 (slot 3), Excel G6 (slot 4), Kanban de ventas B5 (slot 5).
  **Tanda 2** (cuando la 1 esté integrada, porque comparten tipos de campo):
  Botón A5 (slot 6), Fórmulas A1 (slot 7), Dependencias + Gantt A8+B1 (slot 8),
  Calendario completo B4 (slot 9). Decisiones dadas al usuario: papelera de
  30 días para todos los planes, restaura quien borró o un admin; el prefijo
  del ID automático se sugiere del nombre de la lista. Al terminar las dos
  fases: el usuario prueba y después se sigue con las fases 3-6.
  **Avance**: Papelera (v0.1.296), Kanban de ventas (v0.1.297) y Datos
  personales (v0.1.298), Excel (v0.1.299) y Campos (v0.1.300) publicados:
  **la tanda 1 está completa**. De la tanda 2 ya salieron Calendario
  (v0.1.301), Dependencias + Gantt (v0.1.302), Botón (v0.1.303) y Fórmulas
  (v0.1.304): **las fases 1 y 2 están completas. Esperando que el usuario
  pruebe para seguir con las fases 3-6.** El contenedor se reinició varias veces durante la tanda 2 y una
  vez se cortó por el límite de uso: el avance de cada agente quedó en commits
  de su rama (`wip-gantt`, `wip-calendario` y las ramas de cada worktree) y se
  retomó. Gantt + dependencias (slot 8)
  arrancó sobre la rama local `integ-base` (lo integrado y todavía no
  publicado). Botón (slot 6) y Fórmulas (slot 7) arrancaron sobre
  `integ-base` con Campos incluido. Los
  documentos de cada entrega toman el siguiente ADR libre (Papelera S52,
  Kanban S53…) y la migración de cada una se renumera a la siguiente libre al
  integrarla.
- 2026-10-22 — **Pedido del usuario: estudio de funcionalidades frente a la
  competencia** (premium y open source: Airtable, ClickUp, Notion, monday,
  SmartSuite, Smartsheet, Fibery, Attio, Kommo, NocoDB, Baserow, Teable,
  Grist, NocoBase, Twenty, Odoo). Entregado en
  `docs/estudio-funcionalidades-2026-10.md`: ~90 opciones con código (A1…J3),
  valor/esfuerzo, paquetes por tipo de negocio y seis oleadas propuestas.
  **Esperando que el usuario elija.** Lo más destacado: fórmulas de verdad
  (A1), papelera (A2), autonumérico + campos de sistema + valores por defecto
  (A3/A4/A6), botón (A5), Gantt + dependencias (B1/A8), calendario completo
  (B4), kanban de ventas (B5), equipos/roles/invitados (C1-C3), aprobaciones
  (C5), plantillas de registro (C6), API pública + n8n/Make (G1/G2), Excel
  (G6), DIAN vía proveedor (G8), firma electrónica (D6), agenda de citas (D5),
  WhatsApp oficial sin guardar el hilo (D3), PWA + push (H1), consentimiento
  Ley 1581 (I10), inglés/portugués (I1) y modo agencia (I3). No recomendados:
  chat interno, pizarras, correo masivo (ADR-S18), apps generadas con código.
- 2026-10-21 — **El usuario respondió «hazlo todo»** a la lista de carencias de
  la auditoría II, y dejó a mi criterio los pendientes de PDF y del cliente de
  Google. Plan: seis entregas trabajadas en paralelo en copias aisladas y
  publicadas en el orden en que terminan — **tabla** (hecha, v0.1.287),
  **automatizaciones** (hecha, v0.1.288: esperar, repetir por vinculados, probar paso a paso,
  respuesta de webhook, programado por registro, duplicar, versiones), **ficha**
  (hecha, v0.1.291: historial por campo con restaurar, reacciones e hilos, vista previa de
  adjuntos, registro de tiempo), **portal y formularios** (hecha, v0.1.289: varias páginas, captcha,
  confirmación por correo, contraseña del portal, pagar desde el portal),
  **tableros** (hecha, v0.1.292: barras apiladas, enlace público, exportar
  widget, envío programado, tabla dinámica) y **PDF** (hecha, v0.1.290: cotización/factura con IVA y descuento, ítems
  editables en la ficha, congelar al emitir). Decisión sobre el cliente de
  Google de las copias: se queda el de código de dispositivo como única vía
  (addendum de ADR-S43). **Las seis entregas están publicadas: el «hazlo todo»
  quedó completo con v0.1.292.** Lo que quedó afuera a propósito, por si se
  pide: que el asistente/MCP publique un tablero o programe envíos, y un enlace
  para que un destinatario externo de un envío programado se dé de baja solo. **Ojo al integrar**: el migrador de drizzle salta una
  migración cuyo `when` sea menor que el de la última aplicada, así que al
  publicar fuera de orden se renumera la migración de cada entrega a la
  siguiente libre.
- 2026-10-21 — **Pedido del usuario: auditoría PROFUNDA de toda la app**
  ("creía que la app ya tenía todo bien pero cada vez hay cosas con errores").
  Hecho en **v0.1.286** (ADR-S45): 8 relevamientos en paralelo + 7 equipos de
  corrección en copias aisladas, integrados y re-verificados con un segundo
  recorrido en el navegador. **Carencias propuestas** (el usuario pidió
  hacerlas todas — ver el hilo de arriba): automatizaciones — paso «esperar N días», bucle sobre
  registros vinculados, prueba paso a paso con un registro, usar la respuesta
  de un webhook en los pasos siguientes, programado «para cada registro que
  cumpla», duplicar con un clic, historial de versiones; portal/formularios —
  formularios de varias páginas, captcha, correo de confirmación de un clic,
  entrar al portal con contraseña, pagar desde el portal; tableros — segunda
  dimensión (barras apiladas), enlace público, exportar widget, envío
  programado por correo, tabla dinámica; ficha — historial por campo con
  restaurar, reacciones e hilos en comentarios, vista previa de adjuntos,
  seguimiento de tiempo; tabla — copiar/pegar celdas y rellenar hacia abajo,
  deshacer una edición, congelar columnas, colores condicionales, agrupar por
  dos campos.
- 2026-10-21 — **Reporte de los clientes: "no se avisa cuando algo falla"**
  (conexiones, APIs, conectores, correos de automatizaciones, cosas que no se
  generan). Confirmado: ninguna falla en segundo plano avisaba a nadie.
  Resuelto en **v0.1.285** (ADR-S44): Problemas con aviso en campana y correo,
  pastilla en la barra, sección en Ajustes y cierre automático. Queda para
  después, si se pide: aviso por un canal externo (Slack/WhatsApp) y push del
  navegador.
- 2026-10-19 — **Pregunta del usuario sobre PDF/facturas**: ¿cómo se agregan
  los ítems, cómo se calcula, IVA y descuentos? Se le explicó: los ítems son
  registros de otra lista vinculados por relación; cálculos por línea con
  campos calculados y totales con filas (suma de columna, %, sumas y restas);
  IVA de una tarifa directo en Totales, tarifas mezcladas con un campo por
  línea; dos límites (los valores NO quedan congelados al regenerar — guardar
  el PDF en un campo Archivo — y NO es factura electrónica DIAN: para eso, un
  sistema habilitado integrado). Se le ofreció: (1) plantilla «Cotización /
  Factura con IVA y descuento» que arme las dos listas, la relación y los
  calculados solos; (2) editar los ítems como tablita en la ficha; (3) «Congelar
  al emitir». **Respondido el 2026-10-21: «hazlo como mejor te parezca» → se
  hacen las tres** (entrega de PDF del plan «hazlo todo»).
- 2026-10-18 — **Pregunta del usuario sobre F12**: «¿hay que crear otro
  cliente de Google para el backup si ya tenemos la integración de Google en
  Ajustes?». Respuesta: sí es OAuth, pero el de las copias usa el tipo «TV y
  dispositivos de entrada limitada» (código de dispositivo) porque tiene que
  funcionar en un servidor RECIÉN instalado, sin dominio ni HTTPS, y la
  integración web exige una URI de redirección registrada. No hace falta otro
  proyecto: es otro cliente en el MISMO proyecto de Google Cloud. Se le
  propuso: en el servidor que ya funciona, conectar el Drive de las copias con
  la app web de Plataforma → Integraciones (un botón «Autorizar», sin cliente
  extra) y dejar el código de dispositivo sólo para restaurar en un servidor
  sin dominio. **Respondido el 2026-10-21 («hazlo como mejor te parezca»):
  se queda el código de dispositivo como única vía** — ver el addendum de
  ADR-S43.
- 2026-10-18 — **Recuperar el servidor desde Google Drive** (ADR-S43, pedido
  del usuario: en un VPS limpio correr unos comandos, conectar el Drive, elegir
  la copia y restaurar). Plan acordado: «Las tres» entregas y «Los dos»
  servidores web (el instalador pregunta Caddy automático o ServerAvatar, que
  sólo imprime lo que hay que pegar). **Las tres hechas (F12 completa)**:
  v0.1.282 copias cifradas al Drive + kit; v0.1.283 instalador de un comando +
  `/recuperar` + `imagina-restore`; v0.1.284 mover una empresa por el Drive.
  Pendiente del lado del usuario: crear el cliente de Google tipo «TV y
  dispositivos de entrada limitada», publicar la app y probar el instalador en
  un VPS real (aquí sólo se probó en un contenedor Debian con Docker/systemd/
  GitHub simulados). En producción el
  operador todavía tiene que crear el cliente de Google tipo «TV y
  dispositivos de entrada limitada» y publicar la app (si no, la conexión
  vence a los 7 días).
- 2026-10-09 — **"disco lleno" en producción = SIN INODOS**: la actualización
  a v0.1.276 falló con `checkdir error: cannot create … No space left on
  device`, pero el usuario mostró el panel de ServerAvatar con **26,66 GB
  libres** (53,8 % usado) → lo que se acabó son los inodos (cantidad de
  archivos; cada versión trae ~36.000). Preguntó si no se podía arreglar
  sólo con una versión nueva: **no**, porque el instalador que corre es el
  de la versión vieja y falla al descomprimir antes de ejecutar nada nuevo
  (y el rollback de finalize.sh restaura el último dump → no sirve como
  atajo). Se le pidió UNA vez por consola: `df -i /`, `sudo du --inodes -x
  -d 3 / | sort -n | tail -25` y los pasos a/b/e del runbook-disk §3; queda
  esperando que pase esos números para saber qué los llenó (sospecha:
  carpetas de releases viejas o cortadas; si `du --inodes` señala otra cosa
  fuera de /opt/imagina-base, es de otro lado del servidor). v0.1.278 ya
  mide inodos (chequeo previo, mensaje y tarjeta Disco) para que no vuelva a
  pasar a ciegas. Pendiente además: recrear el contenedor de Postgres una
  vez para activar la poda del WAL (runbook §4).
  **Confirmado** (consola del usuario): `df -i /` = 3.850.240 inodos, 100 %
  usados, y **173 carpetas de versiones** (activa 0.1.274). Causa de fondo:
  la poda de `finalize.sh` corre después de `systemctl restart`, que la mata
  con el API (KillMode=control-group) → nunca se borró nada. v0.1.278 poda al
  arrancar. Se le pasaron los pasos 2-4 (zips/carpetas cortadas, dejar la
  activa + 2, docker prune, journal); falta que confirme el `df -i` después.
  Opcional para él: `KillMode=process` en la unidad (runbook-disk §6) para
  que también corra el health-check con rollback de finalize.sh, que por la
  misma causa nunca corrió.
  **Resuelto (16:30 UTC)**: tras la limpieza quedan 4 carpetas de versiones e
  inodos al **9 %**. Postgres se había caído por falta de inodos y el
  `docker system prune` borró su contenedor detenido y la red (los volúmenes
  NO: pgdata intacto, la app carga todo); se recreó con `docker compose up
  -d`. Datos del servidor que conviene recordar: (a) **Redis es el del HOST**
  (127.0.0.1:6379, de ServerAvatar) — el contenedor redis del compose no
  levanta por puerto ocupado y no hace falta (health `redis: true`); (b) el
  volumen `walarchive` NO existía (se creó recién): el contenedor viejo
  archivaba el WAL dentro de su propia capa, que se fue con el prune → la
  ventana de PITR arranca hoy; (c) el compose levantado es el de 0.1.274 (sin
  la poda del WAL): tras instalar v0.1.278, recrear postgres una vez
  (runbook-disk §4). Lección: no recomendar `docker system prune` sin mirar
  antes `docker ps -a` — borra contenedores detenidos de la app.
  **CERRADO**: el usuario instaló v0.1.278 desde el panel y recreó postgres
  (poda del WAL activa). Queda sólo lo opcional: `KillMode=process` en la
  unidad systemd (runbook-disk §6), sin pedir — ofrecido, no aplicado.
- 2026-10-09 — ronda de ideas (Airtable/ClickUp/Notion/Monday/SmartSuite).
  El usuario eligió **las tres primeras recomendadas** y las pidió todas
  ("hacé todos los que diste de recomendación final"), cada una en su release:
  v0.1.275 formularios públicos (HECHO), v0.1.276 «Mi trabajo» + bandeja de
  avisos (HECHO) y v0.1.277 campos con IA (HECHO) (resumir/clasificar/extraer/
  traducir, leer un PDF o foto, recalcular al cambiar lo que usan, consumen
  la cuota de IA). **WhatsApp de ida y vuelta en la ficha queda para
  DESPUÉS** a pedido del usuario: le preocupa que se vuelva una app de chat
  y llene la base con conversaciones de clientes (si se retoma: guardar sólo
  el último mensaje/estado por registro, o un resumen, no el hilo entero).
  Ideas que siguen en la lista: facturación electrónica DIAN vía proveedor,
  papelera/versiones, búsqueda de registros en la paleta, Gantt +
  dependencias, informes programados por correo, agenda de citas pública,
  registro de horas, aprobaciones, importadores desde Airtable/Notion/
  ClickUp, API pública documentada, PWA con escáner.
- v0.1.277 (campos con IA): en el servidor, con la IA activada, crear un
  campo «Clasificar» sobre una lista real y mirar la calidad de las
  respuestas (en el sandbox el proveedor fue simulado); y un «Extraer» que lea
  un PDF de factura.
- v0.1.276 (avisos): en el servidor, prender el resumen diario a una hora
  cercana y confirmar que llega por el correo de la empresa; y que un
  recordatorio suene a su hora (el scheduler corre cada minuto).
- v0.1.275 (formularios): probar en el servidor un formulario insertado en
  un sitio real (WordPress) con y sin «dominios permitidos», y que el correo
  de una automatización «Cuando se envía un formulario» llegue.
- v0.1.273 (UX de los editores): que el usuario recorra el editor de correos y
  el de PDF y diga si la separación Contenido/Estilo y la pestaña
  «Estructura» se entienden; si algún ajuste sigue sintiéndose repetido,
  anotar cuál.
- v0.1.272 (diseño por bloque): mandarse un correo con una fuente WEB
  (p. ej. Montserrat) y esquinas/sombra, y abrirlo en Apple Mail o el iPhone
  (se ve la fuente) y en Gmail y Outlook de Windows (se ve la de respaldo,
  esquinas rectas en Outlook). En el sandbox el correo sale por el transporte
  de log.
- v0.1.270 (editor de correos): mandarse una prueba con «Modo oscuro»
  encendido y abrirla en Apple Mail / Outlook con el sistema en oscuro (los
  colores propios) y en Gmail del celular (su propio oscurecimiento). El
  arrastre DENTRO de la vista previa se probó con eventos de arrastre del
  navegador (el driver de mouse de Playwright se cuelga si el arrastre arranca
  en un iframe); confirmar a mano en el navegador del usuario.
- **Almacenamiento propio**: S3 (v0.1.268) y Google Drive (v0.1.269) hechos
  (ADR-S36). Opcional y sin pedir todavía: retención de PDF guardados.
- v0.1.269: para que las empresas conecten Drive, el operador tiene que
  **habilitar la Drive API** en el proyecto de Google y sumar el permiso
  `drive.file` en la pantalla de consentimiento (la guía de Plataforma →
  Integraciones ya lo dice). Si la app ya estaba en verificación, agregar el
  permiso nuevo la vuelve a revisar (drive.file es no sensible).
- v0.1.268: probar en el servidor con un bucket real (Backblaze B2 o R2):
  conectar, elegir, mover y bajar un archivo — en el sandbox se probó contra
  moto (emulador de S3).
- Probar Mercado Pago / Wompi con cuentas de prueba reales (TEST- / pub_test_)
  en el servidor.
- Google OAuth: grabar el video y enviar a verificación.
- v0.1.265: mandarse una prueba del correo diseñado desde el servidor y
  abrirla en Gmail (web y celular) y Outlook (Windows) — en el sandbox el
  correo sale por el transporte de log.
- v0.1.266/267: generar una cuenta de cobro real desde el servidor y abrir el
  PDF adjunto en Gmail (web y celular) y Outlook; escanear el QR con el
  teléfono; bajar una plantilla publicada desde el portal de un cliente real.
  Ideas que quedaron afuera de la fase 2 (si el usuario las pide): numeración
  que reinicia por año (`CC-2026-0001`), anular/re-emitir un número, y QR que
  apunte a una versión pública verificable del documento.
- v0.1.263: el cliente de Colombia con la automatización de las 8 → 3 am
  queda arreglado SOLO apenas un admin de su empresa entre a la app (la zona
  se propone desde su navegador y el horario sin zona la sigue). Si nadie
  entra, ponerla a mano en Ajustes → Formato regional de esa empresa.

**Pendientes de la auditoría v0.1.252 (por valor)**
- Servidor: un contexto por request (hoy se re-leen lista/campos en varias
  transacciones). Baja prioridad desde v0.1.257: con la planificación en
  ~1 ms, cada transacción extra cuesta poco. (El índice del buscador se midió
  y se descartó — ver ADR-S32.)

**Pendientes técnicos conocidos (no urgentes)**
- Dependencias de DESARROLLO (`pnpm audit` sin `--prod`): quedan avisos en
  herramientas que no llegan al bundle — `vite`/`vitest` (el arreglo exige
  subir de versión mayor: migración aparte), `undici`/`@grpc/grpc-js` vía
  Testcontainers, `js-yaml` vía ESLint, `browserslist` vía babel. Un release
  de "tooling" cuando haya ventana; no afectan a producción.
- Excepciones de auditoría vigentes (ADR-S38), en `pnpm.auditConfig.ignoreGhsas`:
  - `GHSA-hp3w-g68c-fv3c` (`sprintf-js`, vía mssql→tedious, sin versión
    arreglada; tedious sólo usa formatos fijos). Sacarla el día que tedious la
    reemplace o salga un parche.
  - `GHSA-xcx6-jx8p-x3h5` (`@azure/msal-node` <7.1.0, vía mssql→tedious→
    `@azure/identity`; sólo afecta al flujo `auth_code` y el conector SQL usa
    usuario y contraseña). Sacarla cuando `@azure/identity` acepte msal-node 7.1.
  - `GHSA-mrhx-c7xc-m3w5` (`zod` <4.6.6; el parche sólo corta arrays con
    `.max()`). Cerrado en la entrada con el tope de 100.000 elementos de array
    por cuerpo (413 `too_many_items`, v0.1.308). Sacarla con la **migración a
    Zod 4** (~100 archivos), planificada para después de integrar la fase 3.
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

- **2026-11-05 · v0.1.376** — **Importar las suscripciones de Mercado Pago**
  (el usuario: «Sí, haz la v0.1.376»). En **Cobros** de la conexión de Mercado
  Pago, **Importar desde Mercado Pago**: una vista previa (cuántas hay por
  estado, cuántas ya están, cuántas encuentran su cliente por correo, los
  planes y 25 de ejemplo) y después la importación en segundo plano con
  progreso. Destino: una **lista nueva común** «Suscriptores · Mercado Pago»
  (una fila por suscripción, columnas ya puestas, vistas Por estado y Para
  revisar) o **vincular por correo** a una lista de clientes (creando o no los
  que no aparecen). Los planes llegan como planes, los cobros al registro de
  cobros (con tablero si se pide) y las nuevas que se crean en Mercado Pago
  **llegan solas** (avisos + revisión cada 30 min, apagable). **Decisiones**:
  no es lista espejo (el estado vive en `subscriptions` y se relee, el
  registro es de la empresa); sin duplicados por construcción (la fila de la
  suscripción se inserta primero con `onConflictDoNothing`); la importación no
  dispara automatizaciones ni avisos, lo que llega después sí; nunca se
  importa una suscripción creada por la app (`ibs_…`); PayPal no tiene listado
  de suscripciones y queda fuera. De paso: `/lists/:slug` ahora redirige a sus
  registros (los enlaces «Ver la lista» de varias pantallas caían en el índice).
  Tests: `subscriptions-import.spec` 5/5 + suscripciones 28/28; E2E 28/28 en
  escritorio y en celular oscuro contra el Mercado Pago simulado. Queda: el
  rediseño de los constructores de formularios y agenda (pedido en el mismo
  mensaje).
- **2026-11-05 · v0.1.375** — **Las etiquetas en el enlace directo** (el
  usuario: «Sí, haz la v0.1.375»). Si el anuncio lleva directo al enlace del
  formulario o de la agenda, sin el sitio de por medio, **Medir conversiones →
  Cargar mis etiquetas en el enlace directo** carga por ID la etiqueta de
  Google Ads (sale de la de conversión ya pegada), Google Analytics (G-…) y el
  píxel de Meta, y al enviar o agendar dispara la conversión con el mismo id
  único, `generate_lead` y Lead/Schedule; la página de gracias espera a las
  etiquetas. Aviso de cookies opcional al pie. **Decisiones**: sólo los
  scripts oficiales por ID, nunca código pegado ni Tag Manager; como la página
  vive en el origen de la app, quedan encerrados — la CSP sólo deja hablar con
  `/api/v1/public/` (no con el API privado), sin marcos de la app, sin service
  workers, COOP same-origin, cookies de Google en la ruta pública y la
  dirección limpia de todo salvo la campaña; nunca insertada, en la vista
  previa, en el enlace para actualizar un registro ni en la página de la cita.
  Verificado en un navegador real con scripts falsos en los dominios de Google
  y Meta que intentan escapar (fetch al API privado, marco de la app, service
  worker, `window.open`): los cuatro bloqueados. E2E 48/48 en escritorio y en
  celular oscuro. De paso: aclaración de los probadores de HTML en línea bajo
  «Dominios permitidos» (por el reporte del iframe). Queda: la propuesta de
  importar las suscripciones de Mercado Pago (v0.1.376), sin aprobar.
- **2026-11-05 · v0.1.374** — **Medir conversiones de formularios y agendas
  insertados** (preguntas del usuario sobre Google Ads, el código de
  seguimiento y la página de gracias → «Si, hazlo»). Insertados en el sitio de
  la empresa, cada envío y cada cita se vuelven un evento DEL SITIO, que es
  donde Google atribuye la conversión: `dataLayer` (`imagina_form_submit` /
  `imagina_booking`, con `transaction_id`, valor y moneda), `gtag` con la
  etiqueta de Google Ads que se pega en **Ajustes → Medir conversiones** (la app
  reconoce el «send_to» aunque se pegue el fragmento entero), `fbq` Lead /
  Schedule y un evento del navegador. Valor fijo, de lo cobrado, de un cálculo
  o el precio del servicio; conversiones mejoradas opcionales. **De dónde vino
  cada registro**: utm, ids de clic, página y sitio de origen en columnas
  elegidas o creadas con un botón (las columnas del origen ya no se ofrecen
  como pregunta). **Página de gracias** también en la agenda, con variables
  (`{{envio.id}}`, `{{valor}}`, `{{cita.servicio}}`…), espera opcional y nunca
  el correo ni el teléfono en la dirección. **Decisiones**: el código de
  seguimiento NUNCA se pega dentro de nuestras páginas (viven en el origen de
  la app); el origen viaja al marco por mensaje y no en su dirección (para no
  romper la caché de v0.1.352); el script de inserción recuerda la campaña de
  la primera página de la visita, así que conviene pegarlo en todas las
  páginas del sitio. **Bug encontrado al probar**: la página de gracias sólo
  resolvía las respuestas que también aparecían en un texto del formulario.
  E2E 48/48 en escritorio y en celular oscuro contra un sitio de OTRO origen
  con GTM, gtag y fbq simulados (insertado, panel lateral tras navegar,
  enlace directo y agenda). Runbook de Cloudflare: ignorar los parámetros de
  campaña en la caché. Queda: v0.1.375 propuesta (píxel por ID en el enlace
  directo), sin aprobar.
- **2026-11-05 · v0.1.373** — **Suscripciones con débito automático también
  con PayPal** (última parte de «hazlo todo como lo veas más recomendable»: el
  pedido de suscripciones queda completo). Planes en dólares (u otra moneda de
  PayPal; COP rechazado) en Cobros de la conexión de PayPal; suscribir desde la
  ficha, la acción de automatización, el asistente/MCP o un formulario; el
  cliente aprueba en PayPal con su cuenta o tarjeta y la ficha pasa sola a «Al
  día»; cobros pagados y rechazados con el motivo en palabras; pausar,
  reanudar, cambiar el valor y cancelar llegan a PayPal; el registro de cobros,
  el portal y el disparador funcionan igual. **Decisiones**: la app crea sola
  en la cuenta de la empresa el producto y el plan de PayPal (una vez, con
  clave de idempotencia, guardados en el plan, migración 0106); el valor de
  cada cliente va en línea en su suscripción (no hace falta un plan por
  valor); el estado se relee siempre de PayPal (suscripción + transacciones +
  el último cobro fallido, que PayPal informa aparte); al tercer cobro fallido
  PayPal suspende y aquí se ve «En mora», no «Pausada»; una suscripción que
  nunca se aprobó se cancela aquí (PayPal no lo permite). Lo público dice a
  quién se le paga (formulario, página de vuelta, portal) y volver de PayPal
  sin aprobar muestra «No se completó la suscripción» con «Volver a PayPal».
  **Mejora de paso**: recién vuelto del proveedor el estado se consulta
  enseguida (antes esperaba hasta 15 s). E2E 41/41 en escritorio y 41/41 en
  celular oscuro contra el PayPal simulado (plan, suscribir, aprobar, cobro
  rechazado, pausar, reanudar, cambiar el valor, cancelar, arrepentirse,
  formulario de punta a punta). **Límite**: sin credenciales reales de PayPal;
  la prueba con una app sandbox queda para el servidor. Queda: nada de este
  pedido; ideas anotadas en §10.
- **2026-11-05 · v0.1.372** — **PayPal para los cobros de cada empresa**
  (cuarta parte de «hazlo todo como lo veas más recomendable»; decidí partir
  PayPal en dos: links ahora, suscripciones en v0.1.373). Integraciones →
  PayPal con Client ID + Secret (detecta solo si es de producción o de
  prueba); «Cobrar» en la ficha, la acción «Crear link de pago», «Cobrar al
  enviar» y el bloque «Pagos» del portal cobran en dólares (u otra moneda de
  PayPal). **Decisiones**: el link es de la app (`/public/pay/<ref>`) y no de
  PayPal, porque una orden sin aprobar vence: cada visita reusa la orden de la
  última hora o crea otra; aprobar no es pagar, así que la app captura al
  volver el cliente, al llegar el aviso o con «Verificar» (idempotente); el
  webhook se registra solo cuando la instalación tiene https (si no, la página
  de Cobros da la URL para pegarla) y se borra al eliminar la conexión; PayPal
  no cobra en pesos colombianos y la app lo dice en cada lugar. Páginas
  propias (pagado, cancelaste, rechazado, vencido…) con el nombre de la
  empresa y «Volver a intentar». **De paso**: el proveedor simulado de dev se
  caía con cuerpos de formulario (el token de PayPal). E2E 38/38 en escritorio
  y en celular oscuro contra el PayPal simulado (conectar, link en USD,
  aprobar → «¡Pago recibido!» y la ficha en «Pagado», cancelar y reintentar con
  la misma orden, «Verificar», COP rechazado en la ficha y el formulario).
  **Límite**: sin credenciales reales de PayPal; la prueba con una app sandbox
  queda para el servidor. Queda: **v0.1.373 suscripciones con PayPal**.
- **2026-11-05 · v0.1.371** — **Cada cobro de las suscripciones en su propia
  lista, con tablero, y el asistente/MCP para suscripciones** (tercera parte
  del pedido «hazlo todo como lo veas más recomendable»). En la ficha,
  Suscripción → Columnas → **Registro de cobros**: crear la lista «Cobros de
  suscripciones» (con un tablero de lo cobrado por mes, rechazos y por plan) o
  usar una lista propia eligiendo la columna de cada dato; cada cobro
  (pagado, rechazado, reembolsado) queda como un registro vinculado al
  cliente, la carga inicial no dispara automatizaciones, un reembolso
  actualiza el mismo registro y lo que se borra no vuelve. **Decisión**: no
  es lista espejo (se había anotado así): es de la empresa. Asistente y MCP:
  `list_subscriptions`, `propose_configure_subscription_plan`,
  `propose_configure_subscription_columns` y `propose_manage_subscription`.
  **Bugs de paso**: migrar una empresa no re-mapeaba los mapas de columnas de
  cobros y suscripciones; las tablas de los tableros decían «1 vinculado» en
  vez del nombre. E2E 26/26 en escritorio y 27/27 en celular oscuro contra el
  Mercado Pago simulado, más el MCP real por HTTP. Queda: **v0.1.372 PayPal**.
- **2026-11-05 · v0.1.370** — **El chat del asistente, rediseñado** (segunda
  mitad del pedido: "mejora el chat de IA, rediséñalo; el contenido sale sin
  formato, como texto plano"). Las respuestas se ven con formato (títulos,
  listas, tablas, código con «Copiar», enlaces que llevan a la pantalla de la
  app), dibujado con React a partir de un árbol (nunca HTML del modelo). Tus
  conversaciones quedan guardadas (hasta 50, 30 días) con buscador, renombrar
  y borrar; los pasos que dio el asistente se ven en vivo y quedan como
  «N pasos»; se puede copiar, reintentar la última respuesta y editar el
  último pedido; panel ancho en escritorio con el historial al costado; el
  estado vacío sugiere según la pantalla (en la ficha, «Resume este
  registro», con el registro viajando en el pedido). **Bugs reales
  encontrados**: «Detener» no frenaba al modelo en el servidor (seguía
  generando y gastando hasta el final); al detener se perdía lo escrito; los
  textos de dos vueltas salían pegados; y aplicar una propuesta en la página
  de un registro dejaba la app en blanco (`RecordDataConsentLine` recibía el
  sobre `{data}` y no el arreglo). E2E 57/57 contra el simulador de IA.
  Queda: v0.1.371 y v0.1.372 de suscripciones (ver §10).
- **2026-11-05 · v0.1.369** — **Formularios «sin marco» al insertarlos y
  logo por formulario** (pedido del usuario: cambiar u ocultar el logo, y un
  estilo sin fondo ni espacio para que el formulario ocupe exactamente el
  lugar del formulario de contacto de un sitio). «Sin marco» vive en el tema
  (Diseño → Página y Compartir → Insertar en tu sitio → En la página) y sólo
  aplica dentro de un iframe; en la ventana/panel de `embed.js` y en el enlace
  directo se ve con su tarjeta. Vista previa «En tu sitio». Logo: el de la
  empresa, otro (sólo imágenes de la empresa) o ninguno, también en los
  correos del formulario. **Bug viejo encontrado**: el marco insertado nunca
  bajaba de 640 px (720 la agenda) — un formulario corto dejaba espacio en
  blanco; ahora el alto es el del contenido. Para la prueba hubo que servir
  el sitio de ejemplo desde un servidor real en 127.0.0.1 (un sitio «público»
  simulado no puede llamar a localhost: Private Network Access). E2E 31/31 +
  agenda insertada. Queda: v0.1.370 (chat de IA) y las suscripciones (ver §10).
- **2026-11-05 · v0.1.368** — **Suscribir al enviar un formulario y las
  suscripciones en el portal** (segunda entrega del pedido de suscripciones,
  partida: lo que falta pasa a v0.1.369 y PayPal a v0.1.370). Ajustes del
  formulario → «Suscribir al enviar»: planes de Mercado Pago del equipo que se
  ofrecen (hasta 6), título de la elección y qué pasa al enviar; exige la
  pregunta del correo y excluye «Cobrar al enviar». La persona elige el plan
  en tarjetas, autoriza su tarjeta en Mercado Pago y al volver la página le
  dice si quedó activa (pregunta sola cada 4 s). Con confirmación por correo,
  la suscripción espera a confirmar (migración 0103). En el portal, el bloque
  «Pagos» muestra sus suscripciones con estado, próximo cobro y pagos.
  **Bug real encontrado en el E2E** (viejo): un registro creado por un
  formulario, una automatización o la mesa de ayuda tiene `created_by = 0` y
  el esquema compartido exigía un número positivo → el portal de ese cliente
  mostraba «Entrar a tu portal» en vez de su portal. Arreglado en
  `recordSchema` (y `comment.user_id`), con test. De paso: la vuelta fallida de
  una confirmación perdía la pantalla final elegida. E2E 48/48 contra el
  Mercado Pago simulado (escritorio, celular y portal). Queda: v0.1.369 y
  v0.1.370 (ver §10).
- **2026-11-05 · v0.1.367** — **Suscripciones con débito automático de
  Mercado Pago** (pedido del usuario: "¿cómo se manejan las suscripciones o
  cobros recurrentes de Mercado Pago?… reportar los pagos recurrentes que sí se
  hicieron y cuáles no… a quién hay que cancelarle el servicio"; después:
  "hazlo todo como lo veas más recomendable"). Planes de la conexión de
  Mercado Pago (valor, cada cuánto, cuotas, días gratis, días de gracia, qué
  hacer al vencer), «Suscribir» en la ficha (link `init_point` para que el
  cliente autorice su tarjeta), estado derivado (por autorizar / al día /
  reintentando / en mora / vencida / pausada / cancelada / terminada) que se
  relee SIEMPRE de Mercado Pago (avisos por la misma URL de cobros + revisión
  cada 5 min), cobros con su motivo de rechazo y sin duplicar, columnas
  elegibles, disparador «Cuando cambia una suscripción», acciones «Crear
  suscripción» y «Pausar/reanudar/cancelar/cambiar el valor», aviso en la
  campana, pausar/reanudar/cambiar el valor/cancelar desde la ficha. ADR-S96.
  De paso: «Probar ahora» de los links de pago (desde v0.1.251) se veía en
  rojo como «No se pudo conectar» aunque fuera sólo una vista previa — ahora
  es «Sin enviar»; y las estadísticas de un formulario BORRADO se reintentaban
  para siempre cada 2 min (el error de la FK venía envuelto por drizzle y no se
  reconocía) — ahora se descartan, con test. E2E 45/45 contra un Mercado Pago
  simulado (`scripts/dev/fake-collect.mjs` ganó `preapproval`,
  `authorized_payments` y `/__patch`), escritorio, celular y oscuro. Queda:
  v0.1.368 y v0.1.369 (ver §10).
- **2026-11-05 · v0.1.366** — **Reuniones desde las automatizaciones**
  (pedido del cliente Binapps, reenviado por el usuario: agendar las demos
  comerciales sin el puente de Power Automate). Teams gana «Crear reunión de
  Teams» y Teams, Outlook y Google Calendar ganan **Reprogramar** y
  **Cancelar** por id; crear suma fin, lugar e invitados opcionales (`,` o
  `;`). La reunión deja `{{reunion.enlace|id|web}}` y se puede guardar en dos
  campos del registro (cancelar los vacía) sin re-disparar automatizaciones.
  Permiso nuevo `Calendars.ReadWrite` en Teams (no hizo falta
  `OnlineMeetings.ReadWrite`): las conexiones de antes siguen mandando
  mensajes porque la renovación pide sólo los permisos ya concedidos, y las
  reuniones piden reconectar antes de llamar a Microsoft (aviso en el editor,
  en Integraciones y en la ventana del administrador). «Probar ahora» crea sin
  invitados y borra, y en reprogramar/cancelar sólo muestra la petición.
  Disponibilidad: ya estaba en «Mi calendario» (v0.1.350). Queda: que Binapps
  reconecte Teams y lo pruebe.
- **2026-11-05 · v0.1.365** — **Los cobros se ven** (reporte del usuario:
  "creé un botón de generar link de pago en mi lista de anualidades… crea el
  link pero no veo ningún link generado; la automatización no creaba ningún
  campo para mostrar el link. Creo que no pensaste bien la integración"). Tenía
  razón; revisé su lista por el MCP: los dos links SÍ estaban creados (en
  `payment_links`), pero la lista no tenía columnas de cobro elegidas (eran
  opt-in detrás de «Agregar columnas», escondido en la ficha), su ficha es
  diseñada/automática y ese panel sólo salía en la clásica, y su paso
  «Actualizar campo» con `{{respuestas.pago.url}}` quedaba vacío (la acción no
  guardaba la respuesta con nombre y el log decía «ya tenían esos valores»).
  Ahora: **elegir columnas** por dato (una existente como su «Link de pago», una
  nueva o ninguna) desde la ficha («Elegir columnas»/«Columnas») y dentro de la
  acción («Dónde queda el link»); «Cobros» en toda ficha; el aviso del botón trae
  «Link de pago listo» + «Copiar link»; `{{respuestas.pago.url}}` funciona; el
  log dice dónde quedó el link; una variable vacía se nombra; la fecha de pago
  en una columna de sólo fecha toma el día de la empresa. **Le conté cómo
  dejarlo**: en la acción, «Dónde queda el link» → Link de pago = su columna
  «Link de pago», y si quiere, Fecha de pago = «Pagos recientes» (así su
  automatización de renovación se dispara sola cuando Mercado Pago confirma el
  pago). Los dos links ya creados aparecen en «Cobros» de la ficha.
  También confirmé los tiempos de v0.1.364: pruebas del PR 5 min 14 s y
  publicación 7 min 27 s (antes ~16 + ~20).
- **2026-11-04 · v0.1.364** — **Publicar más rápido** (pregunta del usuario:
  "¿por qué se demoran tanto las versiones en publicar? … tarda más de media
  hora"). Medí los tiempos de GitHub Actions: no es el tamaño de la app (armar
  el bundle tarda 12 s) sino ~16 min de pruebas de la API (cada archivo con su
  Postgres y Redis, en serie) + ~17 min de capturas del centro de aprendizaje
  grabadas una detrás de otra. Le propuse repartirlo en varias máquinas y dijo
  "sí, eso aceleraría bastante la publicación". Ahora: pruebas en 4 máquinas
  (job final `ci`, mismo nombre de check), capturas en 5 con un reparto por
  archivo pesado con lo que tardó cada demo (`scripts/help-captures/
  timings.json`; si una parte queda mucho más lenta que las otras, refrescarlo
  con `node scripts/help-captures/timings.mjs <log del release>`), y la CI ya
  no corre al fusionar a main. De paso arreglé dos capturas de formularios
  que fallaban («Publicar»: la página pública salía en blanco en el entorno
  de las capturas; «Crear»: buscaba un botón que ya no existe) y la de la
  campana, que perdía 2 minutos esperando. Esperado:
  ~5 min de pruebas + ~10 de publicación. Medido con esta misma versión:
  pruebas 5 min 14 s y publicación 7 min 27 s.
- **2026-11-04 · v0.1.363** — **Conectar Teams y Outlook cuando la empresa
  pide un administrador** (reporte del usuario con captura: a un cliente,
  cristian.bucuru@binapps.co, Microsoft le mostró «Se necesita la aprobación
  del administrador · Imagina Base, sin comprobar» al conectar Teams). Le
  expliqué que no es un error de la app: su empresa no deja que cada persona
  apruebe apps; las salidas son que un administrador de Microsoft 365 apruebe
  (enlace de consentimiento del administrador) o que el operador verifique el
  publicador en Partner Center. El usuario pidió «Sí, hazlo» al botón «Enlace
  para tu administrador».
  - **Qué hace**: en Integraciones (tarjeta de Teams u Outlook) y en Mi
    calendario, «¿Tu empresa pide aprobación del administrador?» abre un
    diálogo que crea el enlace de `/organizations/v2.0/adminconsent` con los
    permisos exactos, lo copia con un mensaje listo para TI, lista los
    permisos en palabras y se entera solo cuando el administrador aprueba. El
    administrador vuelve a una página del servidor SIN sesión (sólo los
    `state` `ac_…` pasan sin sesión; no traen código ni tokens). Si la persona
    vuelve de Microsoft con el error, el aviso ofrece el enlace ahí mismo.
  - **Para el cliente del usuario**: tiene que actualizar a v0.1.363, tocar el
    enlace en la tarjeta de Teams y mandárselo a su administrador de Microsoft
    365 de binapps (rol global, de aplicaciones o de aplicaciones en la nube).
  - **Pendiente del operador** (no bloquea): verificar el publicador de la app
    de Microsoft en Partner Center quita el «sin comprobar».
  - Tests: `ms-admin-consent.spec` 8/8, shared 727, front 795, specs de
    OAuth/integraciones 63/63, E2E navegador 30/30.
  - **Bug real que encontró el cliente** al reintentar con la cuenta de
    administrador (aprobó los permisos y la app respondió «El proveedor
    devolvió algo que no es JSON: {"token_type":"Bearer","scope":…»): la app
    leía la respuesta de tokens con un tope de 8 KB y la de una cuenta de
    trabajo de Microsoft 365 pesa más → llegaba cortada. Toda cuenta de
    empresa de Microsoft fallaba al conectar, con o sin administrador. Va en
    el MISMO v0.1.363: el canje lee hasta 256 KB, el error ya no muestra
    nada de la respuesta (trae los tokens) y el evento de Outlook con Teams
    de la agenda tampoco se corta. **Para el cliente**: con v0.1.363 basta
    volver a tocar «Conectar»; el consentimiento que dio el administrador ya
    quedó registrado en Microsoft (se da en la pantalla de permisos, antes
    del canje que fallaba).

- **2026-11-04 · v0.1.362** — **Corrección: formularios en blanco, fuentes
  dañadas y servidor en modo desarrollo** (reporte del usuario con captura: el
  constructor de formularios en blanco y la consola con «Failed to load module
  script: … MIME type text/html» y ~26 «Failed to decode downloaded font»).
  - **Causa 1 — el servidor no corría en modo producción.** Verificado desde
    afuera contra `base.imagina.cloud`: la vista previa del formulario traía el
    `<script type="module" src="/app/public-form/main.ts">` de DESARROLLO (y la
    CSP con `ws: wss:`), `/api/v1/metrics` respondía 200 y no salía HSTS. El
    `.env` se armó con la «config mínima» de `docs/runbook-serveravatar.md`,
    que NO pedía `NODE_ENV=production` ni `SECRETS_KEY`/`FILES_SIGNING_SECRET`
    (bug nuestro de documentación). Desde v0.1.351 los formularios (y desde
    v0.1.292 los tableros públicos) decidían «build o vite» sólo por
    `NODE_ENV`.
  - **Arreglo**: `common/web-build.ts` — `runningFromRelease()` (existe
    `<release>/web/cloud/index.html`) y `useWebBuild(env)`: formularios y
    tableros públicos usan el build si corren desde un release aunque falte
    `NODE_ENV`. **`deploy/env-heal.sh`** (lo llama `deploy.sh` en cada
    actualización, best-effort, viaja en el bundle): si faltan o están vacíos
    genera `SECRETS_KEY` y `FILES_SIGNING_SECRET` (96 hex; seguro porque sin
    clave nada se cifró y `decryptSecret` lee el texto plano heredado) y
    DESPUÉS agrega `NODE_ENV=production` (en producción el API no arranca sin
    los secretos). Respeta un `NODE_ENV` puesto a mano, nunca imprime un
    secreto y conserva dueño y permisos. **Plataforma → Diagnóstico →
    «Configuración del servidor»** (`serverConfigStatus`: modo producción, las
    dos claves, cookies seguras, `APP_BASE_URL` con https) con las líneas a
    agregar si la actualización no pudo escribir el archivo. Runbook de
    ServerAvatar corregido.
  - **Qué cambia al pasar a producción** (avisado al usuario): HSTS, `/metrics`
    cerrado sin `METRICS_TOKEN`, las credenciales nuevas se guardan cifradas,
    los enlaces firmados (logo, QR, archivos del portal) dejan de cambiar en
    cada reinicio, y los correos de cuenta sin SMTP de plataforma responden
    503 con el motivo en vez de irse al registro en silencio.
  - **Causa 2 — 15 fuentes dañadas** desde v0.1.300 (commit b710ffc): un
    reemplazo de texto «vX» → «v0.1.300» pasó también por binarios y les metió
    6 bytes (6 WOFF2 del navegador —Inter negrita, Montserrat, Open Sans,
    Raleway, Roboto negrita— y 9 WOFF del PDF). Restauradas desde 442b82f
    (idénticas a `@fontsource` 5.3.0) y **test nuevo** `font-integrity.spec`:
    firma + largo declarado en la cabecera = tamaño real, para las 102 fuentes.
    Lección: un reemplazo masivo de texto NUNCA sobre binarios (usar
    `git grep -I`).
  - El aviso «Banner not shown: beforeinstallpromptevent.preventDefault()» de
    la consola es normal: la app guarda el aviso de instalación para su propio
    botón «Instalar la app» (ADR-S68).
  - Tests: `env-heal.spec` (11: config mínima, secretos vacíos sin duplicar,
    NODE_ENV a mano respetado, archivo completo intacto, CRLF/sin salto final,
    sin archivo, diagnóstico, build desde un release) y `font-integrity.spec`
    (102; falla con las 15 fuentes viejas); specs de formularios, tableros
    públicos, correo de cuenta y documentos 167/167. E2E 7/7 reproduciendo el
    servidor del usuario: build de producción servido como nginx + API en
    `NODE_ENV=development` corriendo desde un release simulado → la vista previa
    dibuja el formulario, la página pública también, las fuentes cargan, el
    Diagnóstico muestra el modo en rojo con la línea a agregar, y la consola
    queda sin errores de módulo, fuentes ni CSP.
- **2026-11-04 · v0.1.361** — **Formularios: cobrar al enviar** (addendum
  ADR-S39; cuarta y última versión de la entrega 3: con ella queda COMPLETO el
  proyecto de formularios —diseño, preguntas y lógica, medir, insertar y
  cobrar—).
  - **Configurarlo**: en los ajustes del formulario, **Cobrar al enviar**
    (`settings.payment`, sin migración para la config): la conexión de cobro
    DEL EQUIPO (Mercado Pago o Wompi, ADR-S31; una privada se rechaza con 400
    `form_payment_connection`), el concepto (admite `{{nombre}}`), cuánto se
    cobra —**monto fijo**, **según un cálculo** (el de «Cálculos y puntaje») o
    **lo escribe la persona** en una pregunta de número o moneda con mínimo y
    máximo—, moneda (Wompi fuerza COP), días del link (1-30) y qué pasa al
    enviar (**llevar directo a pagar** o **mostrar el botón** en la pantalla
    de gracias, con su texto).
  - **El monto lo decide el servidor** (`formPaymentAmount`, puro en
    `form-logic.ts`) con las respuestas guardadas; fuera del mínimo o del
    máximo es un error de esa pregunta; cero = no se cobra. La página muestra
    **Total a pagar** en vivo con la misma función y el botón dice «Enviar y
    pagar».
  - **El link**: `CollectionsService.createForForm` lo arma tras crear el
    registro, con una referencia propia aleatoria y el formulario
    (`payment_links.reference` única + `payment_links.form_id`, migración
    0101) y la vuelta del checkout a `?pago=<ref>`. Aparece en la sección
    Cobros de la ficha y su estado lo ponen los avisos del proveedor.
  - **La vuelta**: `GET /public/forms/:token/payment/:ref` (por referencia Y
    formulario; consulta al proveedor si lleva más de 15 s pendiente) → la
    página dice «Estamos confirmando tu pago» y pasa sola a «¡Pago
    recibido!» o ofrece reintentar; limpia la dirección y no cuenta como
    visita.
  - **Si no se puede preparar el pago** la respuesta igual se guarda, la
    persona lee que la contactarán y se abre un Problema
    (`form-payment:<id>`) que se cierra solo. Con confirmación por correo se
    cobra al confirmar (la página de confirmación muestra el total y el
    botón). Los enlaces para actualizar un registro nunca cobran. Insertado en
    un sitio, el pago abre en otra pestaña.
  - Asistente/MCP: `get_list_schema` dice qué formularios cobran y cómo.
  - Ayuda: artículo «Cobrar al enviar el formulario» en Aprende → Formularios
    con la ilustración `form-payment`, guía `form-payment`, paso nuevo en el
    recorrido de formularios y novedad con carrusel. El script de la página
    pública sube 1,4 KB gz (21,2 → 22,6).
  - Tests: 7 de integración (`forms-payment.spec`: monto fijo con concepto
    recordado, `back_urls` y referencia, pendiente → pagado con la consulta
    cada 15 s, referencia de otro formulario, cálculo y monto cero, pregunta
    con mínimo/máximo, conexión privada rechazada y Problema, confirmación
    por correo, enlaces de actualizar sin cobro), 4 de shared (723 en verde),
    front 795; specs de formularios y cobros 52/52. E2E navegador 31/31 en
    escritorio y 23/23 en celular oscuro contra un Mercado Pago simulado
    (constructor, total en vivo 30.000 → 80.000, salto al checkout con una
    sola preferencia de 80.000 y el concepto «Inscripción de Ana Gómez»,
    vuelta pendiente → aprobado sola, referencia desconocida, botón «Pagar mi
    aporte» con el mínimo, cero errores de CSP o JS).
  - **Siguiente**: lo que el usuario pida; el proyecto de formularios está
    completo.
- **2026-11-04 · v0.1.360** — **Formularios: enlace para que un cliente
  actualice su registro** (addendum ADR-S39; tercera de las versiones de la
  entrega 3).
  - **Encenderlo**: en los ajustes del formulario, **Actualizar un registro**
    (`settings.edit_links {enabled, days, version, message}`): días que sirve
    cada enlace (1-365, 30 por defecto), el mensaje al guardar, la variable para
    automatizaciones con «Copiar» e **«Invalidar los enlaces ya enviados»**
    (sube la versión). Sin migración.
  - **El enlace**: `?editar=<registro>.<vence>.<firma>`, firma HMAC (scope
    `formedit`) que ata empresa, formulario, registro, vencimiento (redondeado
    a la hora) y versión; nada se guarda por enlace.
  - **Mandarlo**: ícono **«Enlace para actualizar»** en la ficha (modal y
    página; sólo si un formulario de la lista lo permite y quien mira puede
    editar ESE registro, con el ACL de la lista) que crea y copia el enlace; o
    la variable **`{{formulario.<id>.enlace}}`** en un correo, WhatsApp o SMS
    (`configureFormEditRuntime` + `editLinkMaker` en el motor; aparece en el
    selector de variables).
  - **La página**: abre con los datos del registro ya puestos (también fecha y
    hora local, condiciones y «Ya tienes: contrato.pdf» en archivos), dice
    «Estás actualizando tus datos», el botón es «Guardar cambios» y saca el
    código de la barra de direcciones (queda en la pestaña, así recargar sigue
    funcionando). Guarda SÓLO lo que el formulario pregunta en el camino de la
    persona: una pregunta vacía vacía el campo, un archivo sin cambio se
    conserva, lo oculto y lo de páginas saltadas no se toca. Actualiza por
    `RecordsService.update` → dispara «Cuando se actualiza un registro».
  - **Sin** captcha, cupo, estadísticas, confirmación por correo ni guardar el
    avance; la autorización de datos sí se registra. Enlace roto, vencido, de
    otra versión, de otro registro o en la papelera → «ya no sirve» (410);
    cerrado por fecha o solo lectura → 403.
  - Asistente/MCP: `get_list_schema` muestra los días y la variable de cada
    formulario con enlaces.
  - Ayuda: artículo «Enlace para que un cliente actualice sus datos» en Aprende
    → Formularios con la ilustración `form-edit-link`, guía `form-edit-link`,
    paso nuevo en el recorrido de formularios y novedad con carrusel. El script
    de la página pública sube 0,9 KB gz (20,3 → 21,2).
  - Tests: 6 de integración (`forms-edit.spec`: armar/cargar/guardar,
    enlace alterado/otro registro/vencido/versión/papelera/apagado, ACL y 409,
    cerrado por fecha, archivo obligatorio, variable del motor), shared 719,
    front 795; specs de formularios y automatizaciones 90/90. E2E navegador
    28/28 en escritorio y 26/26 en celular oscuro (constructor y variable,
    ícono en página y modal, enlace copiado, página prellenada con fecha y hora
    local y la condición del NIT, recargar conserva el modo, guardado sin crear
    otro registro, correo vaciado, NIT conservado, notas internas intactas,
    enlace alterado «ya no sirve», cero errores de CSP o JS).
  - **Siguiente**: v0.1.361 (cobrar al enviar con el Mercado Pago o Wompi de la
    empresa).
- **2026-11-04 · v0.1.359** — **Formularios: plantillas, panel lateral,
  pantalla completa y código QR** (addendum ADR-S39 y ADR-S95; segunda de las
  versiones de la entrega 3, que se partió en cuatro: el enlace para actualizar
  un registro pasa a v0.1.360 y cobrar al enviar a v0.1.361).
  - **Plantillas de formularios** (`packages/shared/src/templates/
    form-templates.ts`, puras): 9 —contacto, cotización en dos pasos con NIT
    sólo para empresas, encuesta NPS conversacional, inscripción a un evento,
    soporte, postulación, datos del cliente, test con puntaje y pedido— que
    hablan de ROLES, no de campos. «Nuevo formulario» abre una galería
    (plantilla por defecto, o «Con los campos de la lista») y por cada rol
    propone un campo existente (`suggestRoleMapping`), crear uno nuevo (con
    `manage_fields`) o saltear los opcionales. `buildFormFromTemplate` mapea las
    opciones por etiqueta, reescribe `{{rol}}` al slug elegido, renombra un
    cálculo que choca con un slug y toma el diseño de las plantillas de tema
    con el color de la marca; el servidor lo valida con el `sanitizeConfig` de
    siempre.
  - **Cómo se abre** (embed.js): además de la ventana al centro, **panel
    lateral** (480 px desde la derecha o la izquierda, a todo el ancho en el
    celular, con su animación que respeta «reducir movimiento») y **pantalla
    completa**, en la ventana al hacer clic, el botón propio y el botón
    flotante (`data-imagina-open` / `data-imagina-side`). Cada estilo tiene su
    marco y no se recarga al reabrir.
  - **Código QR** del formulario y de la agenda en Compartir (dibujado en el
    navegador, `qrcode` a pedido; descarga PNG 1024 px y SVG para imprenta por
    Blob) con `utm_source=qr`: las estadísticas lo cuentan como «Código QR».
  - **De paso**: en el celular el panel de Compartir del constructor era más
    alto que la pantalla y no scrolleaba (los botones de descarga quedaban
    afuera): ahora scrollea en el formulario y en la agenda.
  - Ayuda: guías `forms` y `embed-site`, recorrido de formularios, Aprende
    («Empezar desde una plantilla», «Cómo se abre», «El código QR») con las
    ilustraciones `form-templates` y `form-embed-side`, y novedad con carrusel.
  - Tests: 6 de plantillas en shared (718 en verde), 2 de `embedCode` en el
    front (795), specs de formularios de la API 87/87; E2E navegador:
    administración 18/18 en escritorio y en celular (galería, mapeo sugerido,
    sólo los campos que faltan, regla mapeada, diseño, QR y descargas) e
    inserción en un sitio de otro origen con CSP estricta 10/10 en escritorio y
    en celular (panel derecho/izquierdo, pantalla completa, ventana igual que
    antes, reabrir sin otro marco, cero violaciones de CSP).
  - **Siguiente**: v0.1.360 (enlace firmado para actualizar un registro).
- **2026-11-04 · v0.1.358** — **Formularios: estadísticas y guardar el avance**
  (addendum ADR-S39; primera de las tres versiones de la entrega 3).
  - **Estadísticas por formulario** (ícono en la lista de formularios y en el
    constructor): visitas, empezaron, enviaron, tiempo promedio, gráfica día
    por día, hasta dónde llegan (por página), dónde lo dejan (la última
    pregunta que tocaron), de dónde llegan (utm_source, el sitio anterior o
    directo) y dispositivo, en 7/30/90 días en la zona de la empresa.
  - **Sin cargar la base**: la página manda eventos en lote (sendBeacon) a
    `POST /public/forms/:token/events`; se suman en un hash de Redis por
    formulario y día (tope de 400 contadores, freno de 60 lotes por IP y
    minuto) y cada 2 min se vuelcan a `form_stats` con un UPSERT que suma
    (migración 0100). Los envíos se cuentan en el servidor. Son contadores:
    nunca la IP ni nada de la persona.
  - **Guardar el avance** (`settings.save_progress`, apagado por defecto):
    «Recordar lo que van respondiendo en ese dispositivo» (localStorage 30
    días, aviso «Continuar / Empezar de nuevo») y el botón «Guardar y seguir
    después» (enlace al correo, `form_drafts` con el token hasheado, 30 días,
    se actualiza el mismo sin otro correo, se borra al enviar; archivos y
    firma no se guardan).
  - Ni las estadísticas ni los avances viajan al migrar una empresa; borrarla
    los limpia. El cliente de la página no carga zod (la lógica de los
    contadores vive en `form-stats-logic.ts`): 20,3 KB gz.
  - **De paso**: el test «freno por IP» de formularios fallaba si caía justo en
    el cambio de minuto (ventana fija); ahora espera a estar lejos del borde.
  - Tests: 6 de shared, 5 de la API, 3 del front; E2E navegador: página
    pública 24/24 y 25/25 en celular oscuro, administración 12/12 y 11/11 en
    celular.
  - **Siguiente**: v0.1.359 (insertar en panel, pantalla completa y QR;
    plantillas de formularios).
- **2026-11-04 · v0.1.357** — **Formularios: puntaje, una pregunta por pantalla
  y bienvenida** (addendum ADR-S39; con esto la entrega 2 queda completa).
  - **Cálculos y puntaje** (hasta 5 por formulario): puntos por opción, Sí/No,
    calificación o varias opciones (se suman), o un número por un factor; sólo
    cuentan las respuestas del camino de la persona. Se recuerda con
    `{{puntaje}}` y se puede guardar en un campo número, moneda o porcentaje
    que el formulario no pregunta.
  - **Reglas por puntaje** en saltos y pantallas finales («si el puntaje es
    mayor que 70, a «Excelente»»). Los puntos no viajan a la página salvo que
    un salto o un texto visible los necesite: si no, el servidor calcula y
    devuelve el resultado al enviar.
  - **Una pregunta por pantalla** (elegir una opción, una escala o Sí/No pasa
    sola a la siguiente; Enter en el resto) y **pantalla de bienvenida** con
    título, mensaje, imagen, botón y «Toma unos N minutos».
  - **Constructor**: «Cálculos y puntaje» en Lógica; «Cómo se responde» y
    «Bienvenida» en Ajustes, con «Ver la bienvenida» en la vista previa.
  - **Atrapado en el E2E**: tras «Empezar» el foco no iba a la respuesta y el
    «Toma 1 minuto» quedaba pegado al botón.
  - Sin migración. Tests: 6 de shared, 5 de la API + 1 de re-mapeo, 4 del
    front; E2E navegador: página pública 27/27 y 26/26 en celular oscuro
    (también con el build de producción y su CSP), constructor 26/26 y 25/25.
  - **Siguiente**: entrega 3 de formularios (medir, insertar, cobrar).
- **2026-11-04 · v0.1.356** — **Formularios: la lógica** (addendum ADR-S39;
  segunda mitad de la entrega 2, primera parte).
  - **Varias reglas** en una condición, que se cumplan **todas** o **alguna**,
    en «Mostrar sólo si…», saltos y pantallas finales (una sola regla se
    guarda como antes).
  - **Saltos entre páginas**: por página, el primero que se cumple lleva a una
    página de más adelante, a terminar o a una pantalla final; nunca hacia
    atrás. Un solo motor del camino (`formFlow`) para la página, la vista
    previa y el servidor: lo de una página saltada no se pide ni se guarda.
  - **Pantallas finales** según las respuestas (también al confirmar el correo:
    migración 0099) y **recordar respuestas** con `{{nombre}}` /
    `{{nombre|amigo}}` en todos los textos.
  - **Constructor**: pestaña **Lógica** (mapa a la izquierda, editor a la
    derecha; en el celular dentro de «Preguntas»), «Ver» cada pantalla final,
    «Agregar una respuesta» debajo de cada texto, aviso de regla sin valor.
  - **Atrapado en las pruebas**: una pantalla final con la dirección a medio
    escribir se habría perdido en silencio al guardar (las listas de saltos y
    pantallas descartan lo roto) — ahora no deja guardar y dice cuál; la tira
    de pestañas de la izquierda desbordaba con «Lógica».
  - Tests: 12 de shared, 5 de la API + 1 de re-mapeo al migrar, 7 del front;
    E2E navegador: página pública 22/22 y 23/23 en celular oscuro (también con
    el build de producción y su CSP), constructor 24/24 y 22/22 en celular.
  - **Siguiente**: v0.1.357 (puntaje y cálculos, modo conversacional y
    bienvenida).
- **2026-11-04 · v0.1.355** — **Formularios: más formas de preguntar**
  (addendum ADR-S39; primera mitad de la entrega 2 aprobada por el usuario).
  - **«Cómo se pregunta»** en cada pregunta, según el tipo de campo: escala de
    botones como el NPS (ejemplos 0-10, 1-5, 1-10, acuerdo), deslizador, botones
    «Sí» y «No» (el «No» cuenta como respuesta), firma con el dedo o el mouse,
    lista con buscador y ordenar opciones (en varias opciones o en un texto con
    opciones propias).
  - **«Otro» con un espacio para escribir** en una selección (lo escrito va a
    un campo de texto) y **matriz** para calificar varios aspectos en una tabla
    (cada fila guarda en su propio campo; una pregunta puede depender de una
    fila).
  - El servidor valida cada forma con lo mismo que se le mostró al visitante
    (una sola función en shared para la página, la vista previa y la
    validación). Cada campo se pregunta una sola vez.
  - **Bug atrapado en el E2E**: en el celular, agregar una matriz no mostraba
    su panel; ahora pasa a «Ajustes».
  - Sin migración. Tests: 12 de shared, 6 de integración de la API, 4 del
    front; E2E navegador: página pública 29/29 (escritorio) y 31/31 (celular
    oscuro), constructor 17/17 y 18/18 (celular).
  - **Siguiente**: la lógica de los formularios (v0.1.356+).
- **2026-11-04 · v0.1.354** — **La agenda de citas con tu diseño** (addendum
  ADR-S94; segunda mitad de la entrega 3 de la agenda: con esto las tres
  entregas aprobadas quedan completas).
  - La página pública de la agenda usa el MISMO motor de temas de los
    formularios: sección **Diseño** del constructor con plantillas, «Mis
    temas», colores, tipografía, tamaños, portada, fondo y CSS propio (sólo
    admin). Sin tema, el de siempre (ninguna agenda cambia sola).
  - **Mostrar u ocultar**: lugar, duración/descripción y precio de cada
    servicio, foto y cargo de quien atiende. **Distribución**: calendario al
    lado o arriba de los horarios, horarios en cuadrícula o lista, semana
    desde el lunes o el domingo.
  - Vale también para la página donde el cliente cambia o cancela su cita; el
    color del diseño va en los correos. Las agendas nuevas nacen con el tema
    por defecto de «Mis temas» (que pasa a valer para formularios y agendas).
  - Asistente/MCP: `design` (plantilla, color y qué se muestra).
  - **Bug encontrado y arreglado**: en el celular, volver a la pestaña «Vista
    previa» del constructor de la agenda o del de formularios la dejaba sin lo
    que se editaba.
  - Sin migración. Tests: 2 de integración + 1 del asistente, 2 de shared, 3
    del front; E2E navegador: constructor 19/19 (escritorio y celular oscuro),
    página pública 14/14 y 15/15 en celular oscuro sin violaciones de CSP,
    reserva y página de la cita con el diseño 9/9.
  - **Siguiente**: formularios entrega 2 (preguntas y lógica).
- **2026-11-04 · v0.1.353** — **Agenda: aprobación de las citas y seguridad de
  la página** (addendum ADR-S67; primera mitad de la entrega 3 aprobada por el
  usuario, después de v0.1.352).
  - **Aprobación configurable** en «Aprobación y seguridad»: se confirman solas,
    alguien las aprueba, o sólo la primera cita de cada cliente; regla propia
    por servicio; quién aprueba (quien atiende + personas elegidas; siempre
    quien administra la lista), plazo (2 h a una semana) y si al vencer se
    rechaza o se confirma.
  - **Por confirmar**: el horario queda apartado, sin evento, videollamada ni
    recordatorios hasta aprobar; correo «Recibimos tu solicitud». Panel «Cita
    por confirmar» en la ficha (modal, página y diseñada) con Aprobar y
    Rechazar con motivo; cambiar el estado del registro también decide.
    Estados nuevos Por confirmar y Rechazada, eventos nuevos del disparador
    (las automatizaciones viejas no cambian).
  - **Seguridad**: código de 6 números por correo (opcional), correos
    temporales rechazados (por defecto), frenos por correo compartidos entre
    servidores y enlaces de la cita versionados.
  - Migración 0098 (el CHECK del estado no aceptaba los dos valores nuevos: lo
    encontró el E2E con un 503).
  - Tests: 4 de integración de la API, 4 de shared; E2E navegador: página
    pública 13/13 en escritorio y celular, ficha 9/9 al aprobar y 10/10 al
    rechazar, constructor 17/17 en escritorio y en celular oscuro.
  - **Siguiente**: v0.1.354, la página pública de la agenda con el motor de
    temas (ADR-S94).

- **2026-11-04 · v0.1.352** — **Formularios y agenda insertados que aguantan
  mucho tráfico** (ADR-S95). Respuesta a la pregunta del usuario sobre usar un
  formulario como contacto de una web con muchas visitas; aprobado con "Si,
  hazlo primero y luego la tercera entrega".
  - **La página pública se arma una vez y se reusa**: sello anti-robots aparte
    (se pide al interactuar), CSP por hash del script en línea, caché en
    memoria de 30 s con single-flight, precomprimida con ETag/304 y
    `Cache-Control` público, invalidación por Redis entre servidores y un tope
    de armados (`PUBLIC_DB_CONCURRENCY`, 8) con «Hay muchas visitas».
  - **Horarios de la agenda** cacheados 30 s con versión por empresa; reservar o
    cambiar algo los borra al instante y la reserva re-chequea en el candado.
  - **Tres formas de insertar**: en la página, ventana al hacer clic (también
    con un botón propio del sitio) y botón flotante; el `embed.js` nuevo no
    carga nada hasta que alguien pasa el mouse o toca.
  - **Medido**: la página del formulario de ~300 a ~3.300-3.700 por segundo
    (~11 veces), ~0,2 ms de CPU por visita; agenda ~3.000/s; horarios ~2,5 ms
    desde caché y ~2.950/s sin 429.
  - **Cambio de decisión explicado al usuario**: el script quedó en línea
    (autorizado por su hash), no en un archivo aparte como se había propuesto.
  - **Bugs atrapados**: mover el iframe en el DOM lo recargaba (la precarga se
    perdía); el código insertado llevaba el nombre interno del formulario; un
    test de la mesa de ayuda era una bomba de tiempo (fechas fijas).
  - Guía del operador: `docs/runbook-public-traffic.md` (Cloudflare y el tope).
  - **Sigue**: la entrega 3 de la agenda (aprobación de citas, rediseño con el
    motor de temas, seguridad reforzada), después formularios 2 y 3.
- **2026-11-04 · v0.1.351** — **Formularios con tu diseño** (ADR-S94; primera
  de tres entregas del pedido «formularios más potentes», ver §10).
  - **Motor de temas común a las páginas públicas** (`publicThemeSchema` en
    shared): modo claro/oscuro/automático con paleta oscura calculada,
    colores, 19 fuentes, tamaños, página, fondo (color, degradado, imagen,
    patrón), portada, dividido, tarjeta, campos, opciones, botón y CSS propio.
    `settings.theme = null` = el diseño de siempre (nadie ve cambios al
    actualizar).
  - **13 plantillas** con el color de la marca, **«Mis temas»** de la empresa
    (con el tema por defecto de los formularios nuevos) y **diseño por
    pregunta** (mitad/tercio, ocultar etiqueta, botones o tarjetas con una
    imagen por opción, bloque Imagen).
  - **Seguridad**: imágenes sólo de la empresa y sin SVG, por URL firmada; el
    CSS propio lo cambia sólo un admin y se limpia al guardar y al servir
    (escapes decodificados primero), con la CSP que no deja cargar nada.
  - **Rendimiento**: cliente de la página en TS servido inline (25 kB / 9 kB
    gz), sólo las fuentes usadas con preload. En 4G lento: el clásico abre en
    ~335 ms y queda listo en ~420 ms (igual que antes); con todo el diseño,
    ~380 ms el texto y ~610 ms todo cargado.
  - **Bugs atrapados**: cinco plantillas redondeadas perdían en silencio el
    botón y las opciones (esquinas de 999 sobre un tope de 40), y migrar una
    empresa no re-mapeaba el logo de la marca.
  - Editor hecho por un agente en paralelo (pestaña **Diseño** del
    constructor) e integrado; ayuda (Aprende, guía, recorrido, novedad).
  - Tests: API 1871 + 1 omitido, front 768, shared 670; E2E 27/27 escritorio y
    7/7 constructor en celular claro/oscuro.

- **2026-11-04 · v0.1.350** — **Agenda: el calendario de cada asesor, Meet o
  Teams en cada cita y la vuelta desde el calendario** (addendum ADR-S67;
  segunda de tres entregas, ver §10).
  - **Mi calendario** (Ajustes → Cuenta): conexión OAuth privada con
    `purpose = 'agenda'`, prefs en `memberships.settings.agenda_calendar`
    (calendarios para lo ocupado y para crear); Google suma
    `calendar.calendarlist.readonly`.
  - **Quién atiende → Su calendario**: «El suyo» (sólo una conexión privada del
    propio asesor) o «Una conexión de la empresa» con sus calendarios; enlace
    de videollamada fijo de respaldo.
  - **Dónde es** por servicio: videollamada (Meet/Teams), en persona, por
    teléfono, enlace fijo o lo de la página. El enlace va a la confirmación,
    el correo, el `.ics`, la página de la cita, `{{cita.enlace_reunion}}` y un
    campo mapeado (migración 0097). No se publica si alguien no puede crearla.
  - **La vuelta**: scheduler cada 3 min (Google por `updatedMin`, Outlook por
    `$batch`), compara contra lo que escribió la app; mover → Reprogramada,
    borrar → Cancelada; Problema si no se puede leer.
  - **Bugs**: enlace `http://` escondido trababa el guardado («Datos
    inválidos»: ahora se limpia y el error dice dónde); casillas de «Mi
    calendario» que no se movían (valor fijado en el evento); aviso con
    «Persona del equipo» en vez del nombre.
  - Tests: API 13 nuevos (`booking-calendars.spec`) + suites relacionadas
    216/216, shared 660, front 747; E2E con Google/Graph simulados: Mi
    calendario 12/12 y 11/11 celular oscuro, constructor 21/21, reserva con
    Meet 12/12, la vuelta (mover y borrar) verificada.

- **2026-11-04 · v0.1.349** — **Agenda de citas: reglas, cupos, festivos por
  país y asesores con foto** (addendum ADR-S67; primera de tres entregas, ver
  §10).
  - **Servicio**: varias duraciones, cupos por horario (sesiones grupales),
    horario propio y reglas propias.
  - **Quién atiende**: foto (URL firmada), cargo, descripción y prioridad;
    reparto por turno, carga o prioridad.
  - **Festivos por país**: iCal oficial de Google para 33 países, caché en
    Redis, respaldo de Colombia; vacaciones como rangos.
  - **Reglas**: días corridos/hábiles o entre dos fechas, «lo que dura la
    cita», topes por día/semana/mes y por cliente.
  - **Seguridad**: tope por cliente y sesión duplicada chequeados dentro de los
    candados; duración y foto validadas en el servidor.
  - **Bug**: los eventos que la app crea en el calendario externo ya no
    cuentan como ocupado.
  - Sin migración. Tests: shared 654, API 1851, front 743; E2E 21/21
    constructor y 14/14 página pública (escritorio y celular).

- **2026-11-03 · v0.1.348** — **Microsoft Teams + ayuda debajo de cada
  credencial** (addendum ADR-S22; pedido del usuario, ver §10).
  - **Credenciales**: `PROVIDER_GUIDES[*].credentials` dice dónde está y cómo
    se ve cada valor, y va debajo del Client ID y del Client Secret en
    Plataforma → Integraciones. `credentialWarning` avisa, sin bloquear, si lo
    pegado tiene otra forma (el «Id. de secreto» en lugar del «Valor», un
    secreto tapado, el Client ID como secreto). La tarjeta del proveedor dice
    qué habilita cada app («Outlook (correo y calendario…)»).
  - **Teams** (`teams`, misma app de Microsoft, 5 permisos delegados sin
    consentimiento del administrador, sólo cuentas de trabajo):
    - Acciones: mensaje a un canal (con «Elegir canal»:
      `GET /connections/:id/teams/channels`), mensaje directo a una persona y
      mensaje a un chat de grupo por vínculo.
    - Los vínculos se leen con `teams-links.ts` (shared).
    - Los pasos previos del mensaje directo viven en `integration-prepare.ts`,
      que comparten el motor y «Probar ahora».
    - Los errores de Graph se traducen.
  - **Eventos**: «Agregar reunión de Teams» en Outlook y «Agregar videollamada
    de Google Meet» en Google Calendar.
  - **Tests**: shared (teams-links 5, provider-guides +3), API
    (integration-calls +7, integrations.spec +1 de punta a punta); E2E
    navegador 29/29 con un Graph simulado (consola con ayuda y avisos, galería,
    elegir canal, «Probar ahora» que publica, mensaje directo, Outlook con
    reunión, celular oscuro).
- **2026-11-03 · v0.1.347** — **La barra de abajo del celular, personalizable**
  (ADR-S93; pedido del usuario, ver §10).
  - **Qué**: de 3 a 6 botones (con «Más» fijo al final), elegidos entre
    secciones, acciones y una lista o un tablero puntual (por ID); orden,
    nombres sí/no; se ve al instante y se guarda solo. Barra del equipo para el
    admin (bitácora). «Más» ofrece lo que no está en la barra. La pantalla de
    arranque dibuja la misma cantidad de pestañas.
  - **Dónde**: `memberships.settings.mobile_nav` y `tenants.settings.mobile_nav`
    (sin migración); `GET/PUT/DELETE /me/mobile-nav` y `/me/mobile-nav/team`
    (admin); `mobile-nav.ts` en shared; `mobileNav.ts`, `MobileTabBar`,
    `MobileNavEditor`, `/menu/barra`.
  - **De paso**: cada pantalla nueva arranca arriba (el `<main>` no se
    reseteaba al navegar).
  - **Ayuda**: guía nueva, paso nuevo del recorrido en el celular, Aprende con
    animación `barra-personalizable` y novedad.
  - **Tests**: API `mobile-nav.spec` (6), shared (3), front (`mobileNav.test`
    11); E2E navegador 38/38 (celular claro y oscuro, escritorio) y 5/5 del
    recorrido.
- **2026-11-02 · v0.1.346** — **La barra de abajo de la app instalada sigue el
  modo oscuro** (addendum ADR-S79; reporte del usuario, ver §10).
  - **Causa real**: con `WebAppNavigationBarThemeColor` (activa por defecto)
    Chrome pinta la barra de navegación de Android con el `theme_color` del
    manifiesto guardado en la app instalada, el mismo en los dos modos. La
    nota de v0.1.328 (que salía del `background_color`) estaba mal.
  - **Arreglo**: sin `theme_color` cuando las barras son neutras
    (`chosenAppBarColor` en shared); con un color elegido se usa en los dos
    modos y Ajustes → Marca lo dice. Novedad en el catálogo.
  - **Tests**: manifiesto y `chosenAppBarColor` (shared 630, front en verde).
  - **Queda**: que el usuario reinstale la app (o espere la actualización
    automática) y confirme.
- **2026-11-02 · v0.1.345** — **La apertura en modo oscuro y un estudio del
  ícono que se entiende** (addendum ADR-S91; reporte del usuario, ver §10).
  - **Causa**: en modo oscuro la app instalada de Android abre con su propio
    fondo oscuro (`dark_background_color` del WebAPK). Chrome ya no lee ningún
    campo del manifiesto que lo cambie. El manifiesto del usuario estaba bien.
  - **Vista previa fiel**: la apertura en oscuro se dibuja con el fondo de
    Android (`#202020`) y se explica en el panel, en Aprende y en el pie de la
    tarjeta.
  - **Tres pasos numerados** con su vista previa: qué lleva encima, el fondo
    («Un color» / «Degradado» / «Sin fondo») y la apertura. Lo elegido lleva un
    check y hay un resumen «Elegido: …».
  - **Lo elegido es lo que se dibuja**: antes un degradado quedaba guardado sin
    dibujarse si la app abría con el color del ícono. Ahora cada cruce entre el
    fondo y la apertura se avisa.
  - **Tests**: 7 nuevos del front (734 en verde) y E2E 32/32 con el ícono real
    del usuario.
  - **Queda**: que el usuario pruebe con el teléfono en modo claro (y, si hace
    falta, reinstale la app).
- **2026-11-02 · v0.1.344** — **El QR de cada registro** (ADR-S92; pregunta
  del usuario, ver §10).
  - **Botón «Código QR»** en el modal, la página y el menú de la fila. Muestra
    la imagen y qué hace al escanearla, y deja descargarla, imprimir su
    etiqueta o copiar. Guarda el enlace a la ficha, o el valor del campo
    «Código» si se elige.
  - **Imagen pública firmada** (`/api/v1/public/qr/<token>.png`), sin sesión
    para Gmail, Outlook y WhatsApp. No vence y un token falso da 404.
  - **Etiquetas en PDF** desde la selección, desde Personalizar vista o desde
    el escáner. Formatos carta, A4 y rollo; nombre, código y hasta dos datos;
    se puede empezar en una etiqueta ya usada; respeta el acceso de quien
    imprime.
  - **Variables** `{{registro.enlace}}`, `{{registro.qr}}` y `{{campo|qr}}`
    en correos, WhatsApp, SMS y PDF, con un botón en cada editor.
  - **El escáner se explica** la primera vez y no pide la cámara antes de
    tiempo.
  - **Bug atrapado en el E2E**: el QR de un enlace largo respondía 414. Fastify
    corta los parámetros a 100 caracteres; la ruta pasó a comodín.
  - **Ayuda**: guía, artículo en Aprende con su ilustración, y novedad con
    carrusel.
  - **Tests**: shared 630 (6 nuevos), front 727, API `record-qr.spec` 5/5 y
    los specs de automatizaciones, documentos, SMS y WhatsApp en verde.
  - **E2E en el navegador**: 41/41. Los QR del PDF y de la imagen descargada
    se decodificaron con zxing.
- **2026-11-02 · v0.1.343** — **El ícono de la app como ícono de app**
  (ADR-S91; pedido del usuario, ver §10). Plataforma → Marca arma el ícono con
  fondo de borde a borde (degradado o sólido, sugerido de los colores del logo)
  y el dibujo centrado en la zona que no recorta ningún teléfono; de un emblema
  separa la marca blanca (el color pasa a ser el fondo). Sugerencia automática
  por forma y tono, vistas previas en vivo, apertura de Android sobre el fondo
  de la app o con el color del ícono (el manifiesto usa ese color y el ícono
  queda sólido). Nada se sube hasta guardar. Artículo nuevo en Aprende →
  Consola de la plataforma con su ilustración. Sin novedad en el catálogo (es
  una función del operador). Tests: 9 del motor del ícono (front 727) + 1 de
  API (manifiesto y guardado) + E2E navegador 23/23 con el logo real del
  usuario (sugerencia, guardado, manifiesto, fondo al borde, esquinas
  transparentes en el computador, apertura con el color del ícono en claro y
  oscuro, cambio de dibujo y tamaño, estilo de antes, un símbolo de un color,
  celular en oscuro).
- **2026-11-02 · v0.1.342** — **Navegación del celular** (ADR-S90; pedido del
  usuario, ver §10). Barra de pestañas fija abajo en el teléfono y la app
  instalada (Listas · Mi trabajo · Buscar · Avisos con el número sin leer ·
  Más con un punto si hay novedades), sin hamburguesa ni cajón; barra de arriba
  con el logo y el nombre de la empresa (cambia de empresa); página **Más**
  (`/menu`) con cuenta, empresas, accesos, tema, instalar, ayuda y cerrar
  sesión; **Avisos** a pantalla completa (`/avisos`, la bandeja se extrajo de
  la campana); **Ajustes y Plataforma** con índice táctil en el teléfono y
  «‹ Volver», reagrupados por tema (Empresa · Personas · Conexiones · Clientes ·
  Mantenimiento · Cuenta; Clientes · La app · Servidor); listas en filas con
  Recientes y Favoritos arriba; `100dvh` y zonas seguras. Recorridos con los
  pasos del celular sobre las pestañas, guía nueva, pantallas de ayuda
  `inbox`/`menu`, ilustración `celular-pestanas`, Aprende y novedad. Tests: 6
  front + 2 shared nuevos (front 718, shared 624); E2E navegador 78/78 en
  celular claro/oscuro y escritorio.

- **2026-10-31 · v0.1.341** — **Sugerencias para cada lista** (ADR-S89; pedido
  del usuario, ver §10). Botón **Sugerencias** en la cabecera de la lista (con el
  número de nuevas) y en **Personalizar vista**: panel con (a) **sugerencias por
  reglas, gratis** — tablero por estado (con el total del monto), calendario,
  vista «Vencidos» (preset nuevo `before_today`), Gantt, carga de trabajo, un
  tablero con los números, convertir un texto en selección, repetidos, campos
  vacíos y un formulario — cada una con su porqué en los datos («6 registros…»),
  más hasta 2 ideas del catálogo que encajan; y (b) **«Analizar con IA»** a
  pedido: mini bucle con 5 herramientas del asistente filtradas por rol, perfil
  sin valores de registros (con la casilla opcional «Incluir ejemplos de texto»,
  hasta 5 ejemplos por campo de texto con correos, números largos, enlaces y
  nombres propios tapados, nunca de campos de personas), hasta 6 ideas, cupo de 5 por empresa y mes con
  devolución si falla, huella que evita repetir el análisis si la lista no
  cambió. Aplicar re-ejecuta la herramienta y aplica la propuesta (mismos
  caminos que el asistente); descartadas no vuelven, aplicadas quedan con su
  enlace. Ajustes: aviso de la cabecera por persona y modo de la empresa (con
  IA / sólo reglas / apagadas). Cupo editable en Plataforma → Asistente IA.
  **Bug atrapado en el E2E**: los controles del pie del panel eran controlados por
  la respuesta del servidor y no se movían al tocarlos (otra vez la lección de
  v0.1.207); ahora son optimistas. Ilustración `sugerencias-lista`, artículo de
  Aprende, guía de ayuda y novedad. Tests: 12 shared, 6 API (`list-suggestions.spec`; suite completa 1823 + 1 omitido),
  2 front; E2E navegador 26/26 contra un proveedor de IA simulado (reglas con
  evidencia, aplicar kanban/tablero/convertir, descartar y restaurar, IA con cupo
  5→4 sin valores de registros, automatización aplicada, ocultar por persona,
  sólo reglas, celular en oscuro).

- **2026-10-31 · v0.1.340** — **Duplicar un registro en un clic** (reporte del
  usuario, ver §10). El menú de la fila (clic derecho) y la barra de selección
  duplican al instante por el endpoint de estructura (`bulk-structure`, sin vista
  previa): aviso que se cierra solo («Registro duplicado», «Con sus N
  subtareas», «N registros duplicados»), con «Deshacer» (borra las copias que
  nadie editó; si alguien editó una, lo dice), y en rojo con el motivo si falla
  (límite del plan, registro borrado). Con subtareas, el menú ofrece «Duplicar con
  sus subtareas» / «sin subtareas». Bugs viejos que se fueron con esto: el menú de
  la fila copiaba sólo las columnas visibles en la vista agrupada, una subtarea
  duplicada quedaba en el primer nivel y no había «Deshacer»; y los avisos se
  salían ~10 px por la izquierda en el celular. Ilustración nueva
  `duplicar-rapido`, artículo de Aprende al día y novedad. Tests: 10 front;
  E2E navegador 29/29 (menú, barra, subtareas, deshacer, borrado, límite del
  plan, celular en oscuro).

- **2026-10-31 · v0.1.339** — **Crear una lista desde un archivo** (ADR-S88).
  Pedido del usuario (ver §10): subir un Excel o CSV y que la lista se arme
  sola. «Nueva lista → Desde un archivo» y «Subir un Excel o CSV» en la
  bienvenida: tipos por los valores, descartes con motivo, lo repetido (el
  cliente con su correo y teléfono) como lista aparte vinculada, varias hojas →
  varias listas conectadas, opciones con sus variantes juntas, aviso del límite
  del plan antes de crear, «Mejorar con IA» opcional (resumen protegido,
  consentimiento, cupo propio de 3 al mes, lo editado a mano se respeta) y al
  final recomendaciones que se aprueban con un clic (kanban, calendario,
  tablero, ideas de la categoría de los datos). Bugs atrapados en el E2E: montos
  con miles agrupados leídos como teléfono, «Tarea 1» leído como número, la IA
  pisando lo renombrado a mano, y «Primeros pasos» tapando el botón «Crear».
  Nuevo doble de prueba `scripts/dev/fake-anthropic.mjs` (ver §7). Tests: 14
  shared, 8 API, 8 front; E2E navegador 37/37.

- **2026-10-30 · sin versión** — Skill **«landing-kit»** (descargable, para otros
  proyectos) con el método del kit de landing: procedimiento, guías, scripts probados
  (capturas, clips con cursor, motion graphics en loop exacto, competencia,
  autocompletado, control final), plantillas y el kit de Imagina Base como ejemplo.
  Detalle en §10.

- **2026-10-30 · v0.1.338** — **Prueba con fecha de fin, cuenta pausada y
  módulos por plan** (ADR-S87). Pedido del usuario (ver §10): prueba limitada
  (default 15 días), al terminar la cuenta queda **pausada** hasta que contrate
  (o en solo lectura, a elección), los planes que no se renuevan pasan al plan
  de prueba tras la gracia (default 5 días, antes una constante), y **qué
  incluye cada plan** con 15 módulos que se marcan por plan (automatizaciones,
  IA, integraciones, WooCommerce, WordPress, SQL, portal, formularios, agenda,
  mesa de ayuda, documentos, compartir hacia afuera, API, dominio propio, roles
  propios). Sin plan gratis. La cuenta pausada siempre puede pagar y descargar
  sus datos (ADR-S09). Las pruebas de antes no se tocaron (acción en lote en la
  consola). Las puertas por módulo del servidor las hizo un agente en paralelo
  (controllers, webhooks públicos, barridos y acciones de automatización); una
  app conectada cuenta según su integración. Bug atrapado en el E2E: la ficha de
  la empresa en la consola no se refrescaba tras extender la prueba. Quedó
  fuera: white-label como módulo. Tests: `trial-access.spec` 12,
  `plan-modules.spec` 8, `plan-access.test` 11 en shared, `portal.spec`
  ajustado; E2E navegador 42/42.

- **2026-10-29 · sin versión** — Kit de landing (`docs/landing/`) actualizado con
  SMS (v0.1.332) y WordPress (v0.1.333-336): textos, SEO con autocompletado real,
  prompt de Claude Design, competencia, motion, índice de capturas y LEEME con
  ideas para sumar; capturas y clips nuevos entregados en el .zip (detalle en §10).
- **2026-10-29 · v0.1.337** — **El WAL de Postgres, vigilado, comprimido y con
  su carpeta en orden** (ADR-S86). Reporte del usuario con captura: no podía
  instalar v0.1.336 — 927 MB libres de 57,7 GB y la app ocupaba <1 GB. Se le
  pidieron comandos de sólo lectura: **45,8 GB de `pg_wal`**, `/wal_archive`
  vacío, `pg_stat_archiver` 0 archivados / 86.256 fallidos (≈20 días, desde que
  se recreó el contenedor el 2026-10-09). Causa reproducida con el compose tal
  cual: el volumen nombrado se monta en una ruta que la imagen no trae y Docker
  la crea `root:root 755` → Postgres nunca pudo archivar. Se destrabó por
  consola EN ORDEN (`.ready`→`.done` + `CHECKPOINT` + recién después `chown`:
  al revés copia el atraso de golpe —700 MB/s— y llena el disco); el usuario
  liberó el espacio y pidió que no vuelva a pasar. Hecho: compose con
  `entrypoint` que da la carpeta a postgres + `archive_command` comprimido
  (16 MB → ~16 KB), atómico (`.tmp`+`mv`) e idempotente; servicio que mide por
  SQL (base, WAL, archivo, pendientes, motivo «sin permiso» probado por el
  propio postgres) en la tarjeta Disco con «Liberar y reparar»; revisión cada
  15 min que repara el permiso sola si el atraso entra en el disco, comprime el
  archivo de los contenedores viejos y avisa por correo a los superadmins
  (archivado trabado / disco bajo de max(2 GB, 5 %) / sin inodos); PITR
  restore/poda con `.gz`; y `pitr-drill.sh` ahora prueba el compose real (con
  el viejo falla con el motivo — antes usaba su propio contenedor en 777 y por
  eso nunca lo vio). De paso: los enlaces de los correos al operador (copia a
  Drive, dominios) no llevaban el `#` del router. **Lección**: un simulacro que
  no corre la configuración de producción no prueba nada; y el bug estuvo
  desde F5 — cada servidor instalado tiene el mismo problema hasta actualizar.
  Tests: `postgres-wal.spec` 13/13 con Postgres real (API 1790 en verde),
  drill ✅/❌, E2E 22/22.
- **2026-10-29 · v0.1.336** — **Lo que la fuente borra sale de la app +
  novedades del sitio** (ADR-S85). Pedido del usuario (aprobado tal como se
  propuso): (1) **quitar de la app** lo que WordPress o WooCommerce ya borró —uno
  por el menú de la fila o la ficha, varios o todos con la barra «N registros ya
  se borraron en … · Quitarlos de la app»—: va a la papelera de la app 30 días,
  se puede restaurar y deja de contar para el plan; lo vivo en la fuente no se
  quita. (2) Modo **«Quitarlo de la app»** por sincronización (alta y página del
  sitio o la tienda): lo que se borra sale solo, y elegirlo quita lo ya marcado
  (con confirmación). (3) **Sin lápidas**: nunca se crea algo que ya llega
  borrado, y si vuelve vivo en la fuente vuelve el MISMO registro. (4) La tienda
  por **intervalos** ahora detecta su papelera (pasada `status=trash`) y lo
  borrado del todo (barrido diario). (5) **Novedades del sitio**: tipos de
  contenido y columnas nuevas en WordPress se avisan en la página del sitio y en
  la lista, con Traer / Ya lo vi / Buscar novedades ahora. (6) La papelera de la
  app ahora muestra lo quitado de listas espejo (antes las excluía), y el
  asistente/MCP sólo propone quitar lo ya borrado. Ayuda: dos guías, dos
  artículos de Aprende, tres ilustraciones y novedad. Tests: API 1777 (suite
  completa en verde), front 692, shared 587; E2E 49/49 contra WordPress real + tienda
  falsa, celular oscuro. **Pendiente**: nada de este hilo; de antes, cargar
  `RELEASE_SIGNING_KEY` para firmar el complemento.

- **2026-10-29 · v0.1.335** — **El complemento para WordPress, auditado**
  (addendum de ADR-S84, complemento 1.1.0). Pregunta del usuario: si tenía
  pruebas de seguridad y rendimiento. Contra un WordPress real con 20.000
  entradas, 3.000 medios y 400.000 metas, en PHP 8.3 y 7.4, junto a WooCommerce,
  Elementor, Wordfence, WP Super Cache, Yoast y Query Monitor: (1) **0
  consultas** del complemento en las páginas públicas (1.0.0 hacía hasta 2 por
  visita con un contador de visitas); (2) avisos sólo de las columnas que trae
  la app (`fields`/`watch_hash`) y como mucho un despertar cada 15 s; (3)
  «dónde se usa» con tabla propia armada en segundo plano: 100 medios de 36,5 s
  a 0,1 s, 100 entradas de 0,93 s a 0,08 s, schema en caché; (4) permisos por
  campo (`edit_post_meta`), claves secretas nunca expuestas, sólo tipos
  públicos; (5) un Editor puede activar «Al instante» pero sólo hacia la app de
  la que bajó el complemento y sin pisar a un administrador; (6) el origen de
  actualizaciones es JSON, no PHP; (7) **actualizaciones firmadas** con
  Ed25519 si el CI tiene `RELEASE_SIGNING_KEY`, verificadas por la versión
  instalada (firma, cada archivo, sin accesos directos, nunca para atrás);
  (8) migración de opciones de 1.0.0 y desinstalación limpia también en red;
  (9) Wordfence detectado con los pasos exactos, y «revocaron la contraseña» vs
  «se apagaron las contraseñas de aplicación». App: «Al instante» con Editor,
  textos que recomiendan un Editor exclusivo, «Actualizaciones verificadas» en
  la tarjeta, artículo de Aprende con «Seguro y liviano para tu sitio» y
  novedad. Tests: suite de seguridad 35/35 (8.3 y 7.4), paquete 13/13,
  actualización real (alterada rechazada, firmada instalada), Plugin Check
  limpio; API 1763 (site-plugin + site-sync 34/34), front 691, shared 583.
  **Pendiente**: el usuario tiene que cargar `RELEASE_SIGNING_KEY` para que la
  firma se active; JetEngine y multisitio sin prueba real.

- **2026-10-29 · v0.1.334** — **El complemento para WordPress** (ADR-S84).
  Segunda mitad del conector de WordPress. (1) Plugin propio «Imagina Base
  Connector» en `integrations/wordpress-plugin/` (GPL, PHP 7.4+): rutas
  `imagina-base/v1` con la misma contraseña de aplicación; SEO normalizado de
  Rank Math, Yoast, SEOPress y AIOSEO (editable + lo que ve Google); ACF
  completo, Meta Box, JetEngine y meta con su tipo; palabras; medios con dónde
  se usa; lectura/escritura en lote; avisos firmados con cola y reintentos sin
  frenar el guardado; desinstalar limpia. (2) La app lo reparte desde su
  servidor y WordPress lo actualiza desde ahí. (3) Página del sitio: detecta el
  complemento y ofrece instalarlo, modo «Al instante» con revisión cada hora,
  columnas por origen, medios, kits de auditoría SEO y texto alternativo con IA
  (que mira la imagen). Sin el complemento las columnas quedan bloqueadas con lo
  último. (4) El actualizador elige el bundle por nombre. Sin migración. Tests
  API 1760, front 691, shared 583; E2E 59/59 contra WordPress real (los 4 SEO).
  **Pendiente**: publicar el zip del complemento como asset de GitHub (recién
  cuando todos los servidores tengan el actualizador nuevo); JetEngine sin
  prueba real (es comercial); «dónde se usa» no ve constructores que guardan
  en meta (Elementor); sin contenido ni bloques a propósito.

- **2026-10-29 · v0.1.333** — **Sitio WordPress en listas** (ADR-S83). Pedido
  del usuario: un conector de WordPress que traiga páginas, entradas y tipos de
  contenido (con ACF) y que se puedan editar desde la app; sigue la v0.1.334 (complemento
  propio «Imagina Base Connector»: SEO, campos personalizados, medios, tiempo
  real); crear páginas o entradas desde la app quedó fuera por decisión suya.
  (1) Conectar en un clic con «Autorizar aplicación» del propio WordPress
  (contraseña de aplicación; la que llega en la URL se rota) o pegando una a
  mano, con diagnóstico claro. (2) «Sincronizar sitio»: tipos, columnas
  (incluidos ACF y campos personalizados) y cuáles se editan; carpeta + una
  lista por tipo; cada 5 min a 1 día. (3) Lista espejo generalizada (tienda |
  sitio) en `mirror-list.ts`: sin crear/borrar/importar, candados, aviso,
  columnas propias; WooCommerce sin cambios. (4) Motor incremental por fecha de
  modificación + barrido diario; edición que viaja sólo con lo cambiado,
  términos nuevos creados en WordPress, rechazo que vuelve al valor del sitio,
  lote + deshacer. (5) Contraseña revocada → Problema + conexión marcada →
  volver a conectar; borrar la conexión borra su contraseña en WordPress.
  Migración 0095. Entorno: `scripts/dev/wordpress-up.sh` (WordPress real con
  ACF). Tests API 1746, front 688, shared 577; E2E 43/43 contra WordPress 6.8
  real. **Pendiente**: tiempo real, SEO, campos personalizados sin `show_in_rest` y medios =
  v0.1.334 (complemento
  propio, la siguiente entrega); metas sin `show_in_rest` no se
  escriben; no probado contra plugins de seguridad reales ni multisitio.

- **2026-10-29 · v0.1.332** — **SMS con la cuenta de cada empresa**
  (ADR-S82). Cinco proveedores por clave en Integraciones → «Mensajes de texto
  (SMS)»: Twilio, BulkGate, Infobip, LabsMobile y Onurix (para otro, «API
  personalizada»). La clave se verifica antes de guardarse y queda cifrada.
  (1) Contador de SMS compartido (GSM-7 160/153, UCS-2 70/67) con «Quitar
  tildes», la misma función que el envío. (2) Acción «Enviar SMS» en las
  automatizaciones, con «Respetar el horario… (Ley 2300 de 2023)» (lun-vie
  7-19, sáb 8-15, sin domingos ni festivos, zona de la empresa → si no, queda
  programado), «Probar ahora» (no envía) y «Enviarme una prueba». (3) «Enviar
  SMS» en la ficha y a una selección (hasta 500, con revisión y resultado por
  fila). (4) Recordatorios de citas por SMS en la agenda. (5) Estado de
  entrega en `sms_messages` (migración 0094) que nunca retrocede: avisos de
  Twilio firmados, de los demás por un token de la conexión, Onurix por
  consulta; columnas «Último SMS» / «Estado del último SMS»; la actividad anota
  el hecho sin el texto. (6) Problemas por credencial, asistente/MCP, migrar y
  borrar empresa, ideas, guía, Aprende y novedad. Tests: shared 14, API 14 +
  agenda + borrado, front 3 + E2E navegador 79/79. Queda: probar con cuentas
  reales de cada proveedor (los supuestos de API están en el ADR).

- **2026-10-29 · v0.1.331** — **La app lista para la landing** (ADR-S81). El
  usuario preguntó si hacerle un home a la app o una landing aparte para SEO;
  se decidió un sitio propio en WordPress en `imagina.cloud/base`. (1) La app no
  se indexa: `X-Robots-Tag: noindex, nofollow` en todo el API, meta robots en
  los HTML, `robots.txt` que deja rastrear (para que se lea el noindex).
  (2) «Sitio del producto» en Plataforma → Marca → «Conoce …» en el pie del
  login (nunca en el dominio de una empresa). (3) `/registro` abre el alta.
  (4) Origen de cada alta (`utm_*`, `ref`, sitio anterior; recordado 30 días en
  el dispositivo) guardado en `tenants.settings.signup`, visible en Empresas y
  contado por origen en el KPI de altas. Sin novedad en el catálogo (lo nuevo
  es del operador). Tests: shared 4, front 4, API 2 + E2E navegador 16/16.
- **2026-10-28 · v0.1.330** — **Diagnóstico claro de una conexión SQL que
  falla** (addendum ADR-S27). Reporte del usuario con captura: un cliente veía
  «No se pudo conectar… (Failed to connect … in 15000ms)» y no se sabía si
  había respondido la base o si fallaba la app. (1) Reintentos de la conexión
  ante lo pasajero (3 intentos, 2 s y 5 s; nunca credenciales/firewall/
  certificado), espera de 30 s por intento. (2) Al fallar: qué IP resolvió, si
  el puerto abre (prueba TCP), intentos, «Respuesta del servidor: ninguna» o la
  de SQL Server literal con su número, la IP de este servidor y la conclusión
  (red / puerto / base). (3) Errores de Azure en pausa (40613…) explicados como
  del lado de la base. Mensajes en varios renglones en Problemas, la
  sincronización y el diálogo de conexión. Tests: 6 nuevos (driver falso +
  sockets reales) y verificado con el driver real contra un puerto mudo, una IP
  que descarta y un puerto cerrado.
- **2026-10-27 · v0.1.329** — **La app abre con su contorno, no con el logo**
  (addendum ADR-S80). Reporte del usuario: al abrir la app instalada se ve el
  logo en el centro dentro de un círculo de color y no le gusta. Maquetas →
  eligió «B · La app se arma». (1) Pantalla de arranque del HTML: esqueleto del
  shell (riel, panel, barra superior, filas que laten) con línea de carga
  arriba, con las medidas reales y los colores reales del riel y del primario
  recordados por tema; sólo si la última apertura fue con sesión. (2) Ícono:
  fondo «Igual al de la app» por defecto (blanco / #121212) + juego maskable
  oscuro para el manifiesto `?scheme=dark` → Android muestra el logo solo, sin
  disco; «Actualizar ícono» regenera un juego viejo en un clic; vista previa
  «Al abrir». Tests: 2 de API + 2 del front; E2E navegador 17/17 y 6/6 contra el
  build de producción (CSP sin violaciones).
- **2026-10-27 · v0.1.328** — **Barra de abajo según el tema + ícono desde el
  logo** (addendum ADR-S80). Reporte del usuario: en modo oscuro la barra de
  abajo de la app instalada seguía blanca, y la app instalada mostraba un ícono
  raro (el genérico: subió el logo pero no el ícono). (1) En Android esa barra
  sale del `background_color` del manifiesto: el manifiesto acepta
  `?scheme=dark` y el enlace lleva el tema del dispositivo (pre-pintado del
  HTML + `applyManifestScheme` al cambiar de tema). (2) Un logo casi cuadrado
  pasa a ser también el ícono si no hay uno; «Usar el logo como ícono» para los
  ya subidos; el logo se guarda hasta 512 px; la vista previa muestra el
  genérico real. Tests: 1 de API (manifiesto oscuro) + 2 del front + E2E
  navegador 15/15.
- **2026-10-27 · v0.1.327** — **Marca de la plataforma, login nuevo y pantalla
  de arranque** (ADR-S80). Reporte del usuario: la barra de abajo de la app
  instalada seguía con el color de la marca, el login "no me gusta", un logo
  "que te inventaste" que no es el de su marca, y el arranque "muy feo". (1) La
  barra: el servidor ya era neutro; el teléfono guarda los colores de cuando se
  instaló — se explica en Ajustes → Marca y Plataforma → Marca (quitar y volver
  a instalar). (2) **Plataforma → Marca**: nombre, logo (claro y oscuro) e
  ícono; el navegador los convierte a PNG y genera los siete tamaños; el
  manifiesto, la pestaña, el riel, el login y la tarjeta de instalar los usan
  en el dominio de la plataforma (en el de una empresa, nunca). Se quitó la
  chispa: sin nada subido, iniciales del nombre y un ícono neutro. (3) **Login
  rediseñado** con ilustraciones animadas a la derecha. (4) **Pantalla de
  arranque** en el HTML con el logo o nombre recordado, que se desvanece al
  aparecer el login o la app. Tests: 5 de API (PNG por bytes, subida/guardado/
  borrado de imágenes, lectura tolerante, boot, manifiesto), 7 del front +
  E2E navegador 26/26 (login, Marca con SVG convertido, manifiesto con los
  tamaños reales sin sesión, arranque con el logo recordado, celular oscuro) y
  10/10 contra el build de producción (CSP con el script nuevo hasheado, cero
  violaciones).
- **2026-10-27 · v0.1.326** — **Barras del teléfono neutras + ofrecer la
  instalación** (ADR-S79). Pedido del usuario: las barras del sistema de la app
  instalada (la de la hora y la de abajo en Android) se pintaban con el primario
  y con colores vivos se veía rara. Ahora salen **blancas en claro y #121212 en
  oscuro** (el fondo de la barra superior de la app) y en **Ajustes → Marca →
  Barras del teléfono** se elige «Neutras» (recomendado), «Color de la marca» u
  «Otro color», con vista previa de un teléfono (`branding.app_bar_color`, sin
  migración; manifiesto, meta y boot público). Y la **primera vez en cada
  dispositivo** la app ofrece instalarse sola (con la ventana del navegador o
  con los pasos en iPhone/Android/Mac; no insiste en Chrome/Edge sin aviso, y
  una segunda vez a los 30 días si se descartó). Tests: shared, front (reglas
  del ofrecimiento y del color, 18 en el spec de PWA), API (manifiesto, boot y
  branding) + E2E navegador 24/24 (escritorio con la ventana simulada, oscuro,
  Marca con las tres opciones, Chrome sin aviso, iPhone con los pasos).
- **2026-10-27 · v0.1.325** — **Novedades con animaciones** (ADR-S78), última
  de las cuatro versiones del pedido "la ayuda es muy básica" ("en ClickUp las
  novedades traen imágenes o una pequeña animación"). Cada novedad puede traer
  una **ilustración animada** de la app (con los colores de la empresa, claro y
  oscuro), una **captura real** paso a paso o un **carrusel** de hasta 6
  diapositivas (flechas, puntos, ← →, deslizar en el celular, avance solo cada
  7 s). **Las 21 ya publicadas** tienen la suya —12 como carrusel— y la
  sincronización se la pone en cada servidor, incluso a las que el operador
  editó antes (sin tocar su texto). Consola: «Animación y carrusel» en el editor
  con vista previa en vivo. Migración 0093 (`whats_new_entries.media`). Tests de
  shared (todas con algo visual, lectura tolerante), del front (cada clave
  existe), de la API (sincronización y relleno, imagen de diapositiva que no se
  borra mientras se usa; 19/19) + E2E navegador 19/19 (destacada con carrusel,
  avance solo, panel, página, consola, celular oscuro con deslizar). Con esto
  queda completo el plan de cuatro versiones.

- **2026-10-27 · v0.1.324** — **Recorridos rediseñados** (ADR-S77), tercera de
  las cuatro versiones del pedido "la ayuda es muy básica" ("esos tours no me
  gustaron, casi no se ven bonitos, no son muy interactivos o visuales"). Cada
  recorrido empieza con una **portada** (ilustración animada, minutos, pasos y
  «Vas a ver») y termina con un **cierre** (papel picado, «Lo que viste», el
  recorrido que sigue y la guía de Aprende). Los pasos traen una **animación**
  del centro de aprendizaje, un consejo, una flecha hacia lo resaltado y puntos
  de avance; donde conviene, **lo hace la persona**: abrir un registro, abrir
  «+ Vista», escribir en el buscador (lo resaltado late, una mano lo señala, y
  el globo celebra al escribir). Dos recorridos nuevos (**Tu día a día**,
  **Aprende, ideas y novedades**; 17 en total) y una **galería** por tema en
  Aprende (`#recorridos`) con «Hecho». Bug encontrado en la prueba: con la
  ficha abierta, su diálogo le robaba el foco a la portada (Enter caía en un
  botón de la ficha). E2E navegador 38/38 (escritorio claro, celular oscuro).
  Queda: v0.1.325 (novedades con imagen o animación).

- **2026-10-27 · v0.1.323** — **Galería «Ideas para tu negocio»** (ADR-S76),
  segunda de las cuatro versiones del pedido "la ayuda es muy básica". 39 casos
  de uso en ocho categorías (ventas, cobros, clientes y soporte, proyectos,
  agenda, tienda, equipo, conectar apps), cada uno con su ilustración, el
  problema que resuelve, cómo funciona y un panel **«Actívala»**: la lista se
  sugiere por nombre, los campos por nombre y tipo, y las preguntas traen
  valores por defecto, así el caso común es un clic y la automatización queda
  guardada y funcionando (o se abre antes en el editor). También crea listas y
  tableros desde plantillas, o lleva a configurar formularios, agenda, portal y
  agentes. Con el tope de automatizaciones activas del plan lleno, ofrece
  guardarla en pausa (lo atrapó el E2E: el tenant de prueba es trial). Al
  probar con datos reales salió otro detalle: el rol «Teléfono» se sugería con
  el campo «Ciudad» por ser el primer texto — ahora un texto de respaldo exige
  que el nombre se parezca, y el «título» usa el campo de título de la lista.
  Aparece en Aprende (panel y banner), Ayuda, Ctrl+K, las automatizaciones de
  cada lista («Ideas para esta lista») y el artículo de recetas. Sin backend
  nuevo. Tests: 14 de las ideas (cada una se arma y valida con el schema del
  servidor) + E2E navegador 28/28 (galería, búsqueda, categorías, activar con
  lista preseleccionada, guardar en pausa, opción que falta marcada, activa con
  plan con lugar, aviso de duplicado, app sin conectar, ideas por lista,
  plantilla de lista, tablero, celular). Sigue: v0.1.324 (recorridos
  rediseñados).
- **2026-10-27 · v0.1.322** — **Centro de aprendizaje «Aprende»** (ADR-S75).
  Feedback del usuario: la ayuda de la fase 7 era "muy básica, muy poco
  ilustrativa, muy corta… casi no se explica nada ni cómo usar tantas cosas";
  pidió imágenes o animaciones como ClickUp y eligió animaciones + capturas
  reales que se regeneren solas. Ítem «Aprende» en el riel (índice del manual
  en el panel), botón en Ayuda y resultados en Ctrl+K. **27 módulos, 191
  artículos (~120.000 palabras)**: cada pantalla con TODOS sus ajustes en
  tablas «Ajuste · Qué hace», pasos, ejemplos de negocios latinoamericanos,
  avisos, preguntas frecuentes y botones para ir; **207 ilustraciones
  animadas** (React + CSS con los tokens del tema: toman la marca y el modo
  oscuro, con «reducir movimiento» se ve la escena quieta) y **110 capturas
  reales** paso a paso con cursor animado y zoom, grabadas en el release por
  `scripts/help-captures/ci.sh` sobre la empresa de ejemplo «Café Aurora» (si
  fallan, la versión sale igual y cada artículo muestra su animación). Escrito
  por seis agentes en paralelo con una guía de redacción
  (`docs/learn-authoring.md`) y un test que hace de editor (referencias,
  español neutro con tildes, sin el nombre del producto ni jerga). Bugs reales
  que destapó y se arreglaron: las variables y condiciones de automatizaciones
  no veían búsquedas/resúmenes/calculados; un ticket creado a mano salía «Sin
  cliente por correo» y «Hola ,»; «Nuevo formulario» a veces no abría el
  editor; textos con el nombre del producto (columnas de la tienda, invitación,
  pasos de WooCommerce/Mercado Pago/IMAP) y jerga («slug», «workspace»,
  `text`/`phone` en el importador, «POST con JSON»); la portada de Aprende con
  ancho cero; «Guardar» de la vista cortado; fechas de la ficha partidas; el
  recordatorio de pago del editor de correos con guiones en vez de variables;
  código en línea en el formato sencillo; aviso de privacidad del asistente
  IA al día. Sigue: v0.1.323 (galería de ideas y recetas).
- **2026-10-27 · v0.1.321** — **«Instalar la app» siempre visible** (addendum
  de ADR-S68). Pregunta del usuario: "¿cómo se activa lo del PWA? No hay ningún
  lado que lo indique". Se verificó `base.imagina.cloud` con Chromium: manifiesto,
  íconos y service worker correctos, cero errores de instalabilidad; el problema
  era sólo de interfaz: la opción del menú dependía de `beforeinstallprompt`,
  que Firefox y Safari nunca disparan y Chrome/Edge dejan de disparar si se
  cerró el aviso o ya está instalada. Ahora está siempre en el menú y en la
  tarjeta nueva **«App en este dispositivo»** (Ajustes → Cuenta → Avisos, arriba
  de las notificaciones): con el aviso del navegador, un clic; sin él, los pasos
  para Chrome/Edge/Safari en el Mac/Android/iPhone (Firefox: no instala, sugiere
  otro), con selector para ver los de otro dispositivo; ya instalada, lo dice.
  «Primeros pasos → Instala la app» abre lo mismo (antes llevaba a Seguridad).
  Guía y recorrido «Instalar la app» corregidos (el recorrido apunta a la
  tarjeta), novedad en el catálogo. 6 tests nuevos del front + E2E navegador
  23/23 (Chrome con y sin aviso, Firefox, iPhone oscuro, ya instalada).
  El CI atrapó que `whats-new.spec` tenía cableada la destacada de cada rol:
  la novedad nueva sacó a la de v0.1.314 de las seis anunciadas. Ahora la
  esperada se calcula del catálogo (como el «sin ver») y la prueba de «se
  presenta una sola vez» usa una destacada propia — sumar novedades ya no la
  rompe.
- **2026-10-27 · v0.1.320** — **Guías, recorridos interactivos y centro de
  ayuda** (ADR-S74, opción I7 ampliada; tercera y última entrega de la fase 7).
  Recorridos con motor propio: «welcome» adaptado al rol (13 pasos para un
  admin, 11 para el resto, 10 en el celular) y 14 de tareas; se ofrece una vez
  por persona y empresa («¿Te muestro la app en 2 minutos?»), no a invitados,
  al impersonar, con otro diálogo abierto ni cuando manda «Empezar fácil» (que
  arranca el recorrido al terminar). Botón **Ayuda** a la derecha de la campana
  (en el celular, en el menú) con 50 guías «¿Cómo hago…?» como datos en shared,
  búsqueda sin acentos, «En esta pantalla», Ctrl+K y enlaces «¿Cómo funciona?».
  **Plataforma → Ayuda**: contacto de soporte, video por guía, ocultar guías y
  guías propias por rol y pantalla (Redis `platform:help`, viaja en el
  snapshot). Progreso en `memberships.settings.guides` (`/me/guides`, PATCH
  que mezcla). Sin migración ni dependencias nuevas. Al integrar: el
  ofrecimiento sube por encima de «Primeros pasos», novedad «Ayuda dentro de
  la app» en el catálogo, «Haz clic en una lista» (decía «Click en…») y se
  corrigió `CLAUDE.md` (las notificaciones del dispositivo están en Ajustes →
  Cuenta → **Avisos**, no en Seguridad). **Regla nueva del ritual** (§4 paso 2c
  y regla 9 de `CLAUDE.md` §6): anclas `data-tour` y guías al día. De paso, en
  el PR de v0.1.319 el CI cortó un test de shared que comprimía 60 MB (la
  «bomba de compresión» del lector de Excel) y pasaba de los 5 s en el runner:
  ahora usa 16 MB y tope de 30 s. Verificación: shared 545, front 626, specs
  del área 117/117 y E2E 75/75 + 21/21 con las tres piezas juntas. En el CI
  de este PR falló al azar un test del portal: el `created_at` de una fila
  terminó en `.900Z` y la prueba buscaba `'900'` (el valor oculto) en el JSON;
  ahora usa valores de seis dígitos, que no pueden aparecer en una hora.
- **2026-10-27 · v0.1.319** — **Novedades** (ADR-S73, segunda entrega de la
  fase 7, con los avisos de plataforma de I9). Megáfono «Novedades» junto a la
  campana, con panel, página `/novedades`, destacadas en un diálogo y avisos en
  una franja. Las novedades de cada versión viajan en el código
  (`packages/shared/src/whats-new/catalog.ts`) y el API las sincroniza al
  arrancar; lo nuevo cuenta desde que LLEGA al servidor y sólo para quien ya
  tenía cuenta (6 la primera vez y como mucho 8 por actualización). El operador
  publica las suyas, oculta o edita las de versión y ve estadísticas en
  Plataforma → Novedades. Migración 0092. **Regla nueva del ritual** (§4 paso
  2b y regla 8 de `CLAUDE.md` §6): cada versión con algo visible agrega su
  novedad. **Convención para las otras piezas de ayuda**: un recorrido o una
  bienvenida en curso marcan su capa con `data-help-overlay` (o son
  `role="dialog"`) para que la destacada espere.
- **2026-10-27 · v0.1.318** — **Empezar fácil** (ADR-S72, opción F7; primera
  entrega de la fase 7). Una empresa sin listas ve «Armemos tu espacio»: la IA
  arma una propuesta con el blueprint de las plantillas, que se revisa y edita
  antes de crear (lo que depende de algo quitado cae solo, con la misma función
  en el navegador y el servidor); o se combinan plantillas por tipo de negocio;
  o se empieza en blanco. Los datos de ejemplo se borran con un clic (papelera
  + Deshacer). «Primeros pasos» se marca solo con datos reales, por persona. Es
  UN pedido de IA con consentimiento en línea (no activa el asistente de la
  empresa). Sin migración. Pendientes: la migración de empresa no lleva el
  registro de ejemplos (ids nuevos) y los toasts tapan el botón flotante
  mientras se ven.
- **2026-10-26 · v0.1.317** — **Agentes de IA** (ADR-S71, opción E6; única
  entrega de la fase 6 → **fase 6 completa**). Agentes con instrucciones,
  listas, herramientas curadas y modo «propone» (por defecto) o «hace».
  Trabajan cuando una automatización usa «Pedirle a un agente», así que sirven
  con cualquier disparador (incluidos los de la agenda, WhatsApp y la mesa de
  ayuda). Corren con el acceso vigente de su dueño (se pausan y abren un
  Problema si lo pierde o pasa a invitado o cliente), con la resolución de IA
  del asistente y topes por agente (pasos por corrida, corridas por día, tokens
  por mes). Tienen historial, «Probar» en simulación, versiones (últimas 30),
  propuestas en la ficha, en «Mi trabajo» y en la campana (aviso `agent`,
  correo y push apagados) y `propose_create_ai_agent` para el asistente y el
  MCP. Migran en pausa al mover una empresa. Migración 0091. Al integrar con la
  mesa de ayuda apareció un `break` faltante en el texto del aviso `sla`, que
  caía al del agente. API 1642, front 574 y shared 511 en verde; E2E 45/45 con
  un proveedor de IA simulado. **OJO en dev**: una base que ya tenga la 0091
  aplicada no recibe 0087-0090 con `pnpm db:migrate` (drizzle compara por
  `when`): aplicarlas a mano con psql. **Anotado en `docs/ideas.md`**: botón
  «Pedir al agente» en la ficha, corridas en lote sobre registros existentes,
  memoria entre corridas y modelo por agente.
- **2026-10-26 · v0.1.316** — **Mesa de ayuda por correo + SLA y
  escalamiento** (ADR-S70, opciones D2 y E5; tercera entrega → **fase 5
  completa**). Un buzón de soporte por lista leído por IMAP (Ajustes de la
  lista → «Correo entrante»: presets Gmail/Outlook/Zoho con contraseña de
  aplicación, «Probar conexión» que dice en qué paso falla). Cada correo nuevo
  crea un ticket y las respuestas del cliente se suman por In-Reply-To o por el
  número del asunto; el equipo contesta desde la ficha con respuestas guardadas
  y firma, por el correo de la empresa. SLA en horas hábiles (festivos de
  Colombia, zona de la empresa) con pausas, columnas guardadas que nadie edita a
  mano, avisos «en riesgo» y «vencido» una vez por objetivo (aviso `sla` por
  campana, correo y push) y escalamiento. Disparadores «Cuando llega un correo»
  y «Cuando un SLA está en riesgo o se vence», acción «Responder por correo al
  hilo» y plantilla «Mesa de ayuda / Tickets». Migración 0090; dependencias
  nuevas `imapflow` y `mailparser` (audit de producción sin avisos nuevos).
  Decisiones: lectura en sólo lectura (EXAMINE) y desde que se conecta (los
  correos viejos no crean tickets); columnas del SLA guardadas, no derivadas; el
  acuse automático no cuenta como primera respuesta; con el límite del plan o en
  solo-lectura el correo espera en el buzón y se abre un Problema; el buzón no
  viaja en plantillas ni duplicados y migra sin contraseña. API 1625 en verde y
  E2E 57/57 + 9/9 contra un IMAP y un SMTP de prueba. **Anotado en
  `docs/ideas.md`**: OAuth para IMAP, horario por equipo, Problemas que no miran
  la papelera, la lista fija de tipos de aviso por correo y el PATCH de
  `settings` que reemplaza el objeto entero.
- **2026-10-26 · v0.1.315** — **WhatsApp Business oficial** (ADR-S69, opción
  D3; segunda entrega de la fase 5, publicada antes que la mesa de ayuda porque
  terminó primero). Cada empresa conecta SU cuenta de la Cloud API de Meta
  (token, número, cuenta y clave de la app, cifrados y verificados antes de
  guardar). Avisos firmados con cola y dedup; el contacto se encuentra o crea
  por teléfono con el último mensaje y su estado, y corre «Cuando llega un
  mensaje de WhatsApp». Plantillas sincronizadas (cada 6 h y a pedido) que se
  envían desde la ficha o con la acción «Enviar plantilla de WhatsApp»; el
  texto libre sólo dentro de la ventana de 24 h. **No es un chat**: no guarda
  la conversación ni medios y la actividad no lleva el texto (pedido del
  usuario). Migración 0089 (`whatsapp_hooks` sin RLS, `whatsapp_templates` y
  `whatsapp_contacts` con RLS). Bug atrapado al integrar con roles: «Probar
  ahora» sin registro elegido tomaba el último de la lista sin mirar el acceso
  (las variables de un registro ajeno podían verse); ahora es el último que la
  persona alcanza. API 1603 en verde y E2E 48/48 contra una Graph API
  simulada. **Pendiente**: probar con una cuenta real de Meta en el servidor
  (el sandbox no llega a graph.facebook.com) y suscribir el webhook desde la
  guía de la conexión.
- **2026-10-26 · v0.1.314** — **App instalable + notificaciones push +
  escáner** (ADR-S68, opciones H1 y H3; primera entrega de la fase 5).
  Manifiesto por Host (en el dominio de una empresa, su nombre y su color),
  service worker propio (HTML a la red, assets con hash en caché, «Sin
  conexión» con Reintentar, borra el caché viejo en cada despliegue) e
  «Instalar la app» en el menú (pasos de Safari en iPhone). Push con Web Push
  propio (aes128gcm + VAPID con `node:crypto`, llaves en `platform:push`),
  canal «Push» por tipo de aviso con los mismos destinatarios que la campana
  (nunca invitados ni clientes), atado a la sesión, tope de 20 por hora.
  Escáner QR/barras (nativo o zxing a pedido) en la búsqueda global, la barra
  de la lista (con modo continuo) y el campo «Código»; `GET /search/code` con
  el ACL de la búsqueda global. Migración 0088. Bug atrapado en el E2E: tras un
  410 el navegador seguía devolviendo la suscripción muerta y la
  re-vinculación la resucitaba. Decisiones: íconos genéricos en los dominios de
  empresa; el portal no es instalable (todavía). E2E 21/21, 23/23 y 27/27.
  **Al desplegar no hay nada que tocar en el proxy** (todo es del mismo
  origen); con `APP_BASE_URL` sin https, el «subject» VAPID cae al `mailto:` de
  `MAIL_FROM`.
- **2026-10-26 · v0.1.313** — **Agenda de citas pública estilo Calendly**
  (ADR-S67, opción D5; la fase 4 era sólo esto → **fase 4 completa**). Páginas
  de agenda por lista (Ajustes de la lista → Agenda) con constructor a pantalla
  completa y la página pública real como vista previa; cada cita es un registro
  «Confirmada»; horarios calculados en el servidor con un motor puro de shared
  (zona de la empresa, festivos, márgenes, aviso mínimo, tope diario, lo ocupado
  en la lista y en Google Calendar/Outlook) y candado por persona (dos reservas
  a la vez → una gana); correo con `.ics`, enlaces firmados para cambiar o
  cancelar, recordatorios de una sola vez y disparador «Cuando se agenda,
  reprograma o cancela una cita» con `{{cita.*}}`. Migración 0087. Decisiones:
  las opciones de servicio/recurso/estado se crean al publicar; un recordatorio
  cuyo momento ya pasó al reservar se da por cumplido; atienden sólo miembros
  que pueden editar la lista (nunca clientes ni invitados). Bugs atrapados en
  el E2E: sitios permitidos en varias líneas, vista previa en un paso viejo,
  calendario gigante en escritorio, la persona al reprogramar, agendas en la
  papelera que seguían ocupando y un invitado como «quién atiende». E2E
  123/123. Pendiente (en `docs/ideas.md`): atender por equipo, cobrar al
  agendar, citas grupales, sincronización inversa del calendario y ver las
  citas desde el portal.
- **2026-10-26 · v0.1.312** — **Roles propios + invitados externos** (ADR-S66,
  opciones C2 + C3; última entrega de la fase 3). Roles «Basado en…» con
  capacidades por módulo (todo chequeo pasa por `can()`) y rol `guest` para
  gente de afuera (una lista o un registro compartido, fail-closed por
  `@AllowGuest()`, tope `max_guests` por plan). Migración 0086. Los roles base
  no cambian. Corregido de paso: avisos, resumen diario y tableros publicados
  ignoraban el acceso del rol propio; un invitado podía recibir un tablero por
  correo o figurar como aprobador. `slot.sh` acepta `IMAGINA_SLOT_DB`. E2E 74/74
  y 31/31. **Fase 3 completa.**
- **2026-10-26 · v0.1.311** — **Equipos** (ADR-S65, opción C1; cuarta entrega de
  la fase 3). Equipos con color, icono y líder (Ajustes → Equipos); campo
  «Equipo»; acceso por equipo en las listas (persona > equipo > rol, lo más
  permisivo entre equipos); @equipo en comentarios y descripción; «De mis
  equipos» en Mi trabajo; aviso `team_assigned` (correo apagado por defecto);
  aprobador «Un equipo» y filtro «Equipo» en la carga de trabajo. Migración
  0085. Al integrar se corrigió que Checklists y Plantillas armaban el actor sin
  equipos, y que la migración de empresa no re-mapeaba el equipo de un paso de
  aprobación. La entrega vino junto con «Roles propios + invitados» (v0.1.312),
  publicada aparte. E2E 26/26 y 15/15.
- **2026-10-26 · conversación** — Fase 4: el usuario eligió sólo la agenda de
  citas pública (D5) y pidió un documento con todas las ideas no descartadas
  para retomarlas cuando vuelva a pedir ideas → `docs/ideas.md` (regla 7 de
  `CLAUDE.md` §6). Pospuestos: API pública + n8n/Make/Zapier, firma
  electrónica y facturación DIAN.
- **2026-10-26 · v0.1.310** — **Checklists dentro del registro + plantillas de
  registro** (ADR-S64, opciones A9 + C6; tercera entrega de la fase 3).
  Checklists con nombre por registro (casilla, responsable, fecha, orden) en la
  ficha (modal, página y bloque de la ficha diseñada), «☑ 3/8» en tabla,
  agrupada y kanban, campo «Progreso del checklist», ítems asignados en «Mi
  trabajo» con aviso al asignar. Plantillas de registro (valores, fechas
  relativas en días hábiles, personas, subtareas, checklists) y de checklist en
  Ajustes de la lista → «Plantillas», «Guardar como plantilla», alta «Desde una
  plantilla» en una transacción, plantilla en formularios y en «Crear un
  registro», acción «Crear subtareas desde una plantilla» y disparador «Cuando
  se completa un checklist». Migración 0084. Asistente/MCP:
  `propose_create_record_template` y `template` en `propose_create_records`. El
  agente rebasó su trabajo sobre Aprobaciones (chocaba en ~30 archivos) y
  verificó los dos juntos (E2E combinado 34/34). Tests: API 1497, front 534,
  shared 437; E2E 40/40. Hilos abiertos en §10 (eco del realtime, foco del
  menú de fila, checklists en el portal).
- **2026-10-26 · v0.1.309** — **Aprobaciones** (ADR-S63, opción C5 del
  estudio + su disparador y su acción; segunda entrega de la fase 3). Flujos por
  lista con pasos en serie (campo Persona, rol o personas; «cualquiera» o
  «todos»), qué se pone al aprobar o rechazar, y pedir otra vez tras un rechazo.
  Se pide desde la ficha o una automatización; se decide en la ficha, en Mi
  trabajo → Aprobaciones o desde el correo, cuyos botones llevan a la app y
  confirman con sesión (sin token, nunca en un GET). El aprobador se resuelve en
  vivo, quien pide no aprueba lo suyo y el ACL se re-chequea en cada decisión;
  las decisiones son concurrentes-seguras. Campo derivado «Aprobación» para
  filtrar, agrupar y ordenar, con indicador en la fila. Disparador «Cuando se
  aprueba o se rechaza», «Pedir aprobación» y «Esperar aprobación» (espera
  durable con tope de días → «vencida»). La papelera cancela las pendientes y
  restaurar no las revive. El asistente/MCP configura flujos y lee solicitudes,
  pero no decide. Migración 0083 (era 0086 en la copia del agente). Al integrar
  sobre v0.1.308 sólo chocó la lista de acciones de la bitácora, y el lint atrapó
  un comentario entre dos `case` (no-fallthrough). E2E 54/54. Queda: equipos
  como aprobador (gancho listo), aprobaciones en el portal y escalado por plazo.
- **2026-10-26 · v0.1.308** — **Dependencias de producción otra vez en 0 +
  freno de arrays en el cuerpo** (addendum de ADR-S38). El agente de Carga de
  trabajo encontró 10 avisos nuevos en `pnpm audit --prod`. `nodemailer`
  10.2.1 (tres avisos del parser de direcciones) y, por override,
  `body-parser` ≥2.4.0 y `fast-uri` ≥4.2.3 (vía el SDK de MCP). Dos
  excepciones nuevas, verificadas: `@azure/msal-node` (sólo el flujo
  `auth_code`, que el conector SQL no usa; `@azure/identity` todavía no acepta
  la versión arreglada) y `zod`. Para zod se midió que un cuerpo de 2 MB con un
  millón de ceros ocupa ~300 MB y 1,5 s de CPU al validar, y que el parche
  (4.6.6) sólo corta los arrays con `.max()` —sin tope, la 4.6.7 consume lo
  mismo—. Se cerró en la entrada: todo cuerpo con más de 100.000 elementos de
  array responde 413 `too_many_items` antes de validar (verificado en vivo: 48
  ms). Migración a Zod 4 pendiente para después de la fase 3. Verificado: tests
  de correo, MCP, OAuth y entrada 107/107, y MCP real por HTTP.
- **2026-10-26 · v0.1.307** — **Carga de trabajo por persona** (ADR-S62,
  opción B2 del estudio, primera entrega de la fase 3). Vista nueva `workload`:
  personas × días/semanas/meses sobre un campo Persona y las fechas del
  registro, con tres medidas —registros, esfuerzo estimado repartido en días
  hábiles y tiempo registrado— calculadas en el servidor
  (`/records/workload-bundle`, tres consultas) con filtros, búsqueda, ACL,
  campos ocultos y la zona de la empresa. Capacidad por persona en
  `memberships.settings.capacity` (admin/manager, bitácora `workload.capacity`)
  con verde/ámbar/rojo; reasignar arrastrando o con «Reasignar a…», con
  Deshacer y Ctrl+Z que no pisan un cambio ajeno; tarjetas en el celular.
  Asistente/MCP, plantillas y migración de empresa al día. Sin migración. E2E
  38/38 contra SQL. Queda fuera: arrastrar en el tiempo (para eso está el
  Gantt), capacidad por día puntual (vacaciones) y recurrencias proyectadas.
  Para Equipos: el bundle ya acepta `users` y la vista `workload_user_ids`.
- **2026-10-26 · v0.1.306** — **Nivel de esfuerzo del asistente** (ADR-S61).
  Pedido del usuario tras preguntar si la API tiene nivel de esfuerzo:
  "implementalo; en el caso de la empresa sólo lo puede cambiar si usa su propia
  API". La plataforma fija el nivel (default Medio, el de antes) para todas las
  empresas que usan su clave; una empresa elige el suyo sólo con clave propia
  (sin ella, deshabilitado en la interfaz y 400 por API; si quita la clave,
  vuelve el de la plataforma). Sólo se ofrecen los niveles que el modelo
  declara; uno que no tiene se ajusta al más cercano con aviso. El tope de
  salida crece con el esfuerzo. Los campos con IA siguen en Bajo. E2E 20/20
  contra un Anthropic simulado. **Ojo en dev**: el entorno trae
  `ANTHROPIC_BASE_URL` apuntando al proveedor real; para el simulado hay que
  forzarla al arrancar la API. En la misma sesión se lanzó la fase 3 del estudio
  con cuatro agentes (ver §10).
- **2026-10-26 · v0.1.305** — **El asistente detecta solo los modelos
  nuevos** (ADR-S60). Pedido del usuario: "en la sección de asistente de IA no
  están los modelos actualizados; debería detectarlos y no tener que pedirte que
  actualices las versiones". La lista fija de tres modelos se reemplazó por el
  catálogo que devuelve la API de Anthropic con la clave en uso (cache 12 h en
  Redis, por hash de la clave). Se elige «el más reciente» de una familia (se
  actualiza solo; default para todos, incluidas las instalaciones existentes) o
  una versión fija, que si se retira pasa a la más reciente de su familia y lo
  avisa. El pensamiento y el esfuerzo se arman por las capacidades que declara
  el modelo (los actuales rechazan el presupuesto fijo). La conversación ya no
  reenvía el pensamiento de turnos terminados: los modelos actuales lo atan al
  prefijo exacto y en cuentas nuevas eso era un 400. Campos con IA: el modelo
  rápido también sale del catálogo, con margen de tokens para el pensamiento.
  Sin migración. **Para el usuario**: al actualizar, el asistente pasa solo al
  modelo más nuevo de la familia que tenía elegida; en Plataforma → Asistente IA
  puede ver la lista, actualizarla o fijar una versión. **Límite de la
  verificación**: el proveedor real no alcanza el entorno; se probó contra un
  Anthropic simulado con la misma forma de la API (lista paginada, capacidades
  por modelo y streaming).
- **2026-10-23 · v0.1.304** — **Campo «Fórmula»** (opción A1 del estudio,
  ADR-S59). Lenguaje en español con 49 funciones (festivos de Colombia),
  referencias guardadas por id y mostradas por nombre, un evaluador único en
  shared (navegador y servidor) y compilación a SQL sólo cuando el resultado es
  idéntico (filtra, ordena, agrupa y suma); lo que no compila se muestra igual
  y dice por qué. Editor con autocompletado, error con posición, vista previa y
  referencia. Al integrarlo con Botón, una fórmula no puede usar un campo
  Botón. Arreglada de paso otra variante del «—» hasta recargar en la columna
  de un campo nuevo. Sin migración. **Con esto quedan completas las fases 1 y
  2.** Pendiente: operadores propios de fórmula en las condiciones de las
  automatizaciones; el test de `portal.spec` «la actividad sólo muestra
  cambios de campos que el cliente ve» es inestable (`not.toContain('900')`
  puede coincidir con un id o un timestamp).
- **2026-10-23 · v0.1.303** — **Campo «Botón»** (opción A5 del estudio,
  ADR-S58). Se presiona en la tabla, la agrupada, la ficha y (si se elige) el
  portal; abre enlaces con variables (WhatsApp, llamar, correo, mapa), cambia
  campos, corre automatizaciones con el disparador «Al presionar el botón» o
  genera un PDF. El servidor re-chequea rol, edición, condición, ACL y tienda;
  en lote corre en tandas con el resultado por fila; el portal tiene reglas
  propias y oculta el botón que ahí no funciona. Sin migración. Al integrarlo
  con el Gantt, el botón quedó fuera de las columnas del panel y del orden.
  Pendiente: botones en kanban y tarjetas.
- **2026-10-23 · v0.1.302** — **Dependencias entre registros + vista Gantt**
  (opciones A8 y B1 del estudio, ADR-S57). Un registro bloquea a otro de la
  misma lista (sin ciclos, desfase en días), con el aviso «¿Cerrar igual?» y un
  candado en la fila y la tarjeta; reprogramación en cadena opcional por lista.
  La vista Gantt trae arrastrar con deshacer, flechas, crear dependencias
  tirando, zoom, línea base, PDF, «Sin programar», grupos y subtareas; en el
  celular es de lectura. El asistente/MCP maneja dependencias y vistas gantt.
  Migración 0082. Al integrarlo con el Calendario (que se publicó antes),
  `color_by`/`color_field` del asistente pasaron a ser UNA clave compartida y
  cada vista valida sus valores. Pendiente: dependencias entre listas en la
  interfaz (la API está lista), ruta crítica y reprogramación que respete el
  desfase.
- **2026-10-23 · v0.1.301** — **Calendario completo** (opción B4 del estudio,
  ADR-S56). Mes, Semana, Día y Agenda sobre un bundle por rango en UNA consulta
  (total real por día y por fuente, tope de 100 días y 4.000 filas), arrastrar
  y estirar con deshacer que no pisa cambios ajenos, crear con clic o arrastre,
  varias fuentes de fecha con color, horas en la zona de la empresa y versión
  para el celular. Configuración en la vista, sin migración; asistente/MCP,
  plantillas y migración de empresa al día. Mes sobre 100.000 registros: p50
  ~200 ms. Pendiente: ocurrencias proyectadas de las recurrencias. **Aviso
  para quien siga**: el adaptador `lib/api.ts` desenvuelve cualquier `{data}`
  de primer nivel, así que la respuesta de un endpoint nuevo nunca debe
  llamarse `data`.
- **2026-10-23 · v0.1.300** — **ID automático, columnas de sistema, valores por
  defecto y validaciones** (opciones A3+A4+A6 del estudio, ADR-S55). Tipo «ID
  automático» asignado por un trigger de Postgres con contador atómico por campo
  y año (todos los caminos de alta, sin repetidos ni huecos; numera lo
  existente al agregarlo; en la papelera no numera y al volver completa lo
  creado mientras tanto). Cuatro columnas de sistema (creación, modificación,
  creado por, modificado por; `records.updated_by` nuevo, 0 = Sistema). Valor
  por defecto y validaciones por campo (rango, largo, NIT/cédula/placa, regex
  con anti-ReDoS, «obligatorio si») con la misma lógica de shared en el
  navegador y el servidor. Fixes: 500 del pie agrupado por una columna de
  sistema, carrera del mapa de claves al crear un derivado, «Marcada por
  defecto» de las casillas que nunca se guardaba. Migración 0081 (trigger +
  `autonumber_counters` + `records.updated_by`): cada escritura en `records`
  suma ~0,06 ms (0,27 con ID automático), §13 en presupuesto. **Con esto la
  tanda 1 de las fases 1 y 2 queda completa.**
- **2026-10-23 · v0.1.299** — **Excel (.xlsx)** (opción G6 del estudio,
  addendum de ADR-S38). Exportar la vista con tipos reales (montos, fechas en la
  zona de la empresa, duraciones, etiquetas, nombres), encabezado inmovilizado y
  con filtro, subtareas y el ID opcional; streaming con tope de 100.000. Importar
  y «Actualizar desde un archivo» aceptan .xlsx eligiendo la hoja; se lee en el
  navegador y el servidor lo interpreta con el formato y la zona de la empresa.
  Lector y escritor propios sobre fflate (sin ExcelJS ni SheetJS). De paso:
  crear campos teléfono/calificación/porcentaje/duración desde el import, campos
  ocultos fuera del export, y avisos de dependencias de producción otra vez en 0
  (SDK de MCP, fastify, dompurify, hono, ip-address). **Regla del entorno**: la
  carpeta temporal de la sesión es compartida entre agentes, así que cada uno
  usa nombres de archivo propios.
- **2026-10-23 · v0.1.298** — **Autorización de datos personales (Ley 1581)**
  (opción I10 del estudio, ADR-S54). Ajustes → Datos personales con plantilla
  sugerida editable (con el aviso de que la revise un abogado), versiones con
  huella SHA-256 y evidencia de cada autorización (versión, origen, IP,
  navegador). Casilla obligatoria en los formularios públicos (también la exige
  el servidor; se apaga por formulario) y en la primera entrada al portal (y en
  cada versión nueva). Retiro por enlace firmado en el correo o desde el portal,
  con aviso a los admins; los datos no se borran solos. Migración 0080 (dos
  tablas con RLS + `form_pending_submissions.consent`). **Al subirlo**: nada
  cambia hasta que el admin active la autorización; desde ese momento los
  formularios publicados empiezan a pedir la casilla (se apaga por formulario).
- **2026-10-23 · v0.1.297** — **Kanban para ventas** (opción B5 del estudio,
  ADR-S53). El tablero contaba en el navegador sobre los primeros 200 registros:
  con más, las cantidades mentían y no había totales. Ahora sale de un pedido
  propio (`kanban-bundle`) con la cantidad y la suma (o el promedio) de un campo
  por columna, carril y celda calculados en el servidor sobre todo lo filtrado,
  y el total del embudo. Además: carriles por un segundo campo (arrastrar entre
  carriles cambia los dos), límite por columna que avisa, reglas al mover («al
  pasar a Perdido pedir el motivo»), tarjetas con campos/portada/tamaño,
  columnas plegables y ocultables, «Mostrar más» por celda y «Mover a…» en el
  teléfono. Sin migración (todo en la vista). Fuera: orden manual dentro de una
  columna, columnas por multi_select o fecha, montos abreviados («2,1 M»).
- **2026-10-23 · v0.1.296** — **Papelera** (opción A2 del estudio, primera
  entrega de las fases 1 y 2 que el usuario aprobó «de una»; ADR-S52). Todo
  borrado de registros, listas, campos, vistas, automatizaciones y tableros va
  a la papelera 30 días (`TRASH_RETENTION_DAYS`) y vuelve tal cual: aviso
  «Deshacer» tras cada borrado, Ajustes → Papelera y «Registros borrados» en
  Personalizar vista; purga diaria a las 04:17 UTC. Migración 0079 (columnas
  `deleted_at`/`deleted_by`, índices parciales, policy RLS con `app.trash`):
  sin reescritura de datos, pero el índice de `records` se construye en la
  migración (bloquea escrituras mientras pasa una vez por la tabla).
  **Al desplegar**: los registros ya borrados de forma lógica aparecen en la
  papelera («Lo borró —») y los de más de 30 días se purgan en la primera
  corrida diaria (antes quedaban guardados para siempre). **Cambio de
  comportamiento**: una lista sincronizada con una tienda ya no se puede borrar
  sin dejar de sincronizarla (409 `store_managed`). Pendiente: retención por
  plan; restaurar una lista no chequea el máximo de automatizaciones del plan;
  comentarios, formularios, plantillas de documento, carpetas y conexiones
  siguen borrándose para siempre; restaurar desde el asistente/MCP. Regla: una
  lectura por la conexión base (`@Inject(DRIZZLE)`) no pasa por la RLS y debe
  filtrar `deleted_at IS NULL`; lo que necesita ver lo borrado usa
  `enterTrashMode`/`inTrashMode` (`trash/trash-ops.ts`).
- **2026-10-22 · v0.1.295** — **Selección visible con el menú + «Editar con
  un click» por vista** (pedidos del usuario con capturas: "déjalo
  configurable" y "al dar click derecho se pierde la selección"). El menú se
  lleva el foco y la tabla dejaba de pintar el rango; ahora se sostiene
  mientras el menú está abierto (rango, celda activa y barra con la suma). Y en
  Personalizar → Mostrar, «Editar con un click» devuelve, en esa vista, el
  click que edita de antes; apagado (default) sigue el modelo de hoja de
  cálculo. Para elegir sin editar en ese modo: Mayús + clic, arrastrar o click
  derecho.
- **2026-10-22 · v0.1.294** — **La tabla como hoja de cálculo, rehecha**
  (ADR-S51; reporte del usuario: copiar y pegar "no se entiende", no había
  menú que dijera que se puede copiar o cortar, y en algunos campos daba error
  sin validación). Causa: desde v0.1.74 un click abría el editor, así que
  Ctrl+C/V caían adentro del input. **Cambio de modelo**: un click ELIGE la
  celda; se edita con un segundo click, doble click, Enter/F2 o escribiendo
  (como Excel, Sheets y ClickUp). Menú de click derecho con Cortar/Copiar/
  Pegar/Borrar/Rellenar/Deshacer y sus atajos; cortar con borde punteado;
  copiar legible (etiquetas, fechas y números de la empresa, nombres); pegar
  se revisa antes de escribir (qué no entra y por qué, crear opciones que
  faltan, crear registros con las filas sobrantes — Ctrl+Z los borra);
  rellenar continúa series; números en el formato de la empresa con aviso en
  la celda si no son válidos; barra con suma y promedio de lo elegido; atajos
  en la ayuda «?». **«Sin repetidos» nunca se validaba en el servidor**: ahora
  sí (alta, edición e import). De paso: la columna fija dejaba ver lo de abajo
  en la fila con el mouse encima (en celular, siempre), y un `?view=` a una
  vista creada hace un momento se descartaba. **Para el usuario**: si prefiere que un
  click vuelva a editar directo, se puede hacer configurable por vista.
- **2026-10-22 · v0.1.293** — **Un superadmin puede volver a tener empresa**
  (reporte del usuario: tiene 2 superadmins, le borró la empresa a uno para
  sumarlo a otra y ya no podía ni crearle una ni invitarlo). El correo de un
  superadmin estaba reservado en todos los caminos, y sin empresa la app no
  abre —tampoco la consola de Plataforma, que vive adentro—, así que quedaba
  afuera de todo. Ahora la consola lo suma a una empresa o le crea una, y la
  pantalla «sin empresa» de un superadmin le deja crearse una o sumarse a una
  existente. Siguen bloqueados el registro público y las invitaciones de los
  admins de las empresas. **Para el usuario**: tras actualizar, el superadmin
  afectado entra con su contraseña y elige ahí mismo; o el otro superadmin lo
  suma desde Plataforma → Usuarios → Editar → «Agregar a una empresa».
- **2026-10-22 · v0.1.292** — **Tableros hacia afuera + análisis** (ADR-S50),
  sexta y última entrega del «hazlo todo». Barras apiladas («Desglosar por» en
  barras, área y línea; al 100 % o lado a lado, con «Otros») y tabla dinámica
  (filas × columnas, totales, mapa de calor); descargar un widget como PNG o
  CSV; enlace público de sólo lectura (vencimiento, período opcional, dominios
  para insertar) calculado con el acceso actual de quien publicó; envío
  programado por correo (diario/semanal/mensual en la zona de la empresa, hasta
  25 destinatarios, PDF opcional, cuota del plan, Problema si falla). Botón
  «Compartir» en el tablero. Migración 0078. De paso: los textos de los gráficos
  en los PDF usan la fuente embebida; y el CI destapó que restaurar una copia
  fallaba con un `pg_restore` más nuevo que el Postgres 16 (`transaction_timeout`)
  — ahora se restaura como SQL en ese caso. La entrega se cortó por el límite semanal
  de uso y se retomó al día siguiente. **Con esto el «hazlo todo» queda
  completo.** Queda afuera: asistente/MCP para publicar o programar, y baja
  automática del destinatario externo.
- **2026-10-21 · v0.1.291** — **Ficha del registro** (ADR-S49), quinta entrega
  del «hazlo todo». Historial de un campo con «Restaurar este valor»;
  reacciones y respuestas en los comentarios (la respuesta hereda la
  visibilidad del comentario raíz, aviso «respondió»); visor de adjuntos a
  pantalla completa (imagen, PDF, video, audio, texto) servido por el API para
  no abrir la CSP; registro de tiempo con cronómetro (uno por persona), cargas a
  mano, chip en la barra superior y el campo derivado «Tiempo registrado» que
  filtra, ordena y suma. Migración 0077 (era la 0075 en la rama del trabajo). De
  paso: la tarjeta de acceso al portal ya no se muestra (ni falla con 403) a
  quien no tiene `manage_lists`. Queda: tableros (última entrega del plan).
- **2026-10-21 · v0.1.290** — **Cotización y factura con IVA, ítems editables
  en la ficha y documentos congelados** (addendum ADR-S35), cuarta entrega del
  «hazlo todo» y los tres pendientes de PDF que el usuario dejó a mi criterio.
  Plantillas «Cotización» y «Factura (no electrónica)» con columnas calculadas
  declarativas (descuento por línea y global, base, IVA o «no responsable»,
  «Son: … PESOS»); «Tabla editable» de los ítems vinculados en las dos fichas
  con totales del servidor; «Congelar al emitir» (migración 0076, era la 0079
  en la rama del trabajo): el PDF de la primera emisión queda guardado y es el
  que se entrega siempre; «Anular y emitir de nuevo» para admin. De paso: la
  prueba de correo de una automatización emitía números reales. Sigue sin ser
  factura electrónica DIAN.
- **2026-10-21 · v0.1.289** — **Portal y formularios** (ADR-S48), tercera
  entrega del «hazlo todo». Formularios por páginas con validación por paso;
  captcha (Turnstile/hCaptcha/reCAPTCHA v2) con llaves de la plataforma o de la
  empresa (Ajustes → Portal y formularios, sección nueva); confirmación del
  correo con un clic (la respuesta espera 48 h y recién al confirmar se crea el
  registro) y copia de las respuestas; entrar al portal con contraseña POR
  EMPRESA (no es la de la cuenta, enlace de entrada `?empresa=`); bloque «Pagos»
  del portal con «Pagar mi saldo» por el monto que lee el servidor. Migración
  0075 (era 0077 en la rama del trabajo). Pendiente del lado del usuario: cargar
  las llaves de captcha (guía `docs/runbook-captcha.md`) cuando quiera usarlo.
- **2026-10-21 · v0.1.288** — **Automatizaciones con pasos de verdad**
  (ADR-S47), segunda entrega del «hazlo todo». «Esperar» minutos/horas/días o
  hasta una fecha del registro, durable en Postgres (migración 0074) con un
  reloj por minuto; «Repetir por cada registro vinculado» con `{{item.…}}`;
  respuestas de webhook usables en los pasos siguientes
  (`{{webhook.body.…}}`, `{{respuestas.<nombre>…}}`); «Probar» paso a paso con
  el mismo motor en simulación; horarios «para cada registro que cumpla…»;
  duplicar; e historial de versiones con restaurar. Decisión: pausar cancela
  las esperas y no se retoman al reactivar (el editor lo avisa). La migración
  del agente era la 0076 y se renumeró a 0074 al integrar (el migrador de
  drizzle salta una migración con `when` menor a la última aplicada). Queda: el
  resto de las entregas del plan (ver §10).
- **2026-10-21 · v0.1.287** — **La tabla como hoja de cálculo** (ADR-S46),
  primera entrega del «hazlo todo» del usuario sobre las carencias de la
  auditoría II. Rango de celdas (Mayús+clic, Mayús+flechas, arrastrar, Ctrl+A),
  copiar en texto legible y pegar bloques de Excel/Sheets con la conversión del
  import (ahora en shared), rellenar hacia abajo (Ctrl+D y el asa), Supr,
  deshacer/rehacer de 50 pasos que no pisa cambios ajenos (`expect` → 409),
  columnas fijas, colores condicionales por fila o celda y agrupar por dos
  campos. Endpoint nuevo `PATCH /lists/:l/records/batch` (cada fila por
  `RecordsService.update`). El motor de agregados gana el agrupado en dos
  niveles como capacidad general (también para tableros). Sin migración. Un
  clic sigue abriendo el editor de la celda. Además se decidió que las copias
  en Drive siguen con el cliente de código de dispositivo (addendum ADR-S43).
  Queda: el resto de las entregas del plan (ver §10).
- **2026-10-21 · v0.1.286** — **Auditoría integral II** (ADR-S45). Pedido
  del usuario: auditar a fondo toda la app porque seguían apareciendo errores.
  Ocho relevamientos en paralelo reprodujeron decenas de fallas reales; siete
  equipos de corrección las arreglaron en copias aisladas y se integraron en la
  rama. Lo más grave: el **portal** mostraba al cliente comentarios internos y
  campos ocultos (ahora comentarios internos/visibles para el cliente y el
  portal sólo recibe lo que el diseño muestra); **ediciones simultáneas** se
  pisaban (toda escritura bloquea la fila); «Actualizar un campo» guardaba
  valores sin validar y un solo valor basura tumbaba la lista con 500 (valida,
  escribe sólo lo que cambia, casts tolerantes); las automatizaciones **por
  vencimiento** se disparaban por fechas de hace meses; un webhook con error
  quedaba como éxito; no se podía **adjuntar archivos** desde la ficha; no había
  forma de **cambiar de empresa**; los tableros no se refrescaban y fallaban en
  solo-lectura. Además: búsqueda global de registros (Ctrl+K), registro en la
  URL, ficha con un solo pedido, subtareas y anterior/siguiente en la ficha,
  filtros de tablero (incluido «Yo»), filtro por relaciones, teclado en la
  tabla, vista agrupada ~5× más rápida, el cliente crea registros desde el
  portal, formularios blindados contra abuso de subidas. En la verificación
  final apareció y se corrigió una falla que tumbaba el proceso si Postgres
  cortaba una conexión dentro de una transacción. Verificado: 1212 pruebas del
  servidor, 352 del front, 202 de shared, y un segundo recorrido en el navegador
  (claro, oscuro, celular) con 0 errores de consola, 0 pedidos fallidos y 0
  desbordes. Migración 0073 (visibilidad de comentarios y subidas de
  formularios). Variables nuevas opcionales: `DB_STATEMENT_TIMEOUT_MS`,
  `DB_IDLE_IN_TX_TIMEOUT_MS`, `DB_JIT`, `REDIS_COMMAND_TIMEOUT_MS`. Conductas que
  cambian a propósito: tableros cuentan el primer nivel, automatizaciones
  incompletas o por encima del plan nacen pausadas, las de vencimiento no
  disparan por fechas anteriores a su alta. Queda: la lista de carencias
  propuestas en §10.
- **2026-10-21 · v0.1.285** — **Problemas: lo que corre solo y falla, a la
  vista** (ADR-S44). Reporte de los clientes: no se avisaba cuando algo fallaba
  (conectores, APIs, correos de automatizaciones). Confirmado con un
  relevamiento: ninguna falla en segundo plano avisaba a nadie. Ahora cada falla
  abre un problema (uno por cosa que falla, las repeticiones se suman), avisa
  en la campana y por correo (por el correo de la plataforma) a los admins y a
  quien lo creó, muestra «N problemas» en la barra superior y vive en Ajustes →
  Problemas con «Ir a arreglarlo»; se cierra solo al volver a funcionar. Cubre
  automatizaciones, correo de la empresa, conectores (OAuth vencido, clave
  ilegible), sincronizaciones SQL y de tienda, campos con IA, formularios,
  recurrencias y avisos de pago. Además: cada acción de una automatización en
  su savepoint (un error de la base ya no borra la corrida) y tope de 3
  reintentos por vencimiento. Verificado: 12 tests nuevos + E2E 26/26.
- **2026-10-18 · v0.1.284** — Tercera y última entrega de ADR-S43 (F12
  completa): **mover una empresa entre servidores por Google Drive**. En
  Plataforma → Migrar empresas, «Subir a Drive» sube el archivo de la empresa
  cifrado (contraseña de recuperación de ese servidor) a «Empresas
  exportadas». En el otro servidor, conectado al mismo Drive, aparece en «En
  Google Drive»: «Traer a este servidor» pide la contraseña del origen (se
  verifica antes de bajar) y lo deja listo para «Importar aquí». Verificado:
  4 tests con dos servidores y un Google falso + E2E navegador 11/11.
- **2026-10-18 · v0.1.283** — Segunda entrega de ADR-S43: **servidor nuevo
  en un comando**. `install.sh` se publica en cada release y se corre con
  `curl -fsSL https://github.com/augusto97/imagina-crm-cloud/releases/latest/download/install.sh | sudo bash`.
  Pregunta dominio, correo de operador y servidor web (Caddy automático o
  ServerAvatar, que sólo imprime qué pegar). Instala Docker, Node, Postgres/
  Redis, la app, el servicio y un `.env` con secretos nuevos, y muestra un
  código. En `https://<dominio>/recuperar`: código → «Restaurar una copia de
  Google Drive» (cliente del kit, conectar, elegir copia, contraseña, avance
  por pasos) o «Empezar de cero». Sin dominio: `sudo imagina-restore` por
  consola. **Dos bugs atrapados en el camino**: (1) el modo recuperación
  pensado como "base sin usuarios" no se activaba NUNCA, porque el API crea al
  arrancar la cuenta del superadmin (SEC-04): ahora es "sin empresas"; (2) el
  stack de ServerAvatar trae su propio Redis en el 6379 y el del instalador
  habría chocado: el compose acepta `POSTGRES_PORT`/`REDIS_PORT`, el
  instalador elige libres y la restauración conserva los puertos de este
  servidor. Verificado: 8 tests nuevos, E2E navegador 19/19, la CLI contra el
  Google falso y el instalador completo en un contenedor Debian limpio con
  Docker/systemd/GitHub simulados. Falta probarlo en un VPS real (lo hace el
  usuario) y la v0.1.284 (mover una empresa por el Drive).
- **2026-10-18 · v0.1.282** — Pedido del usuario: «como ya tenemos Google
  Drive, quiero integrar a nivel servidor los backups, migraciones y
  restauraciones: en un VPS limpio correr unos comandos, vincular el Drive,
  que detecte las copias y yo sólo elija y restaure». Se propuso un plan en
  tres entregas (ADR-S43) y el usuario eligió «Las tres» y, para el servidor
  web del instalador, «Los dos» (Caddy o ServerAvatar). Primera entrega:
  **copia del servidor en Google Drive**. Cada copia (manual o automática) se
  sube CIFRADA con una contraseña de recuperación (GPG AES-256, formato
  abierto) a `Imagina Base · Copias del servidor / <servidor>`, conservando
  las N más nuevas. Conexión por código de dispositivo (google.com/device, sin
  dominio ni HTTPS: sirve en un servidor recién instalado), permiso
  `drive.file`, subida reanudable por partes de 8 MiB alimentada por el cifrado
  en curso, verificador scrypt en las propiedades de cada archivo, aviso por
  correo a los superadmins si una subida falla (uno cada 12 h), botón para
  subir una copia que ya estaba en el servidor, listado de las copias del Drive
  (de todos los servidores) y **kit de recuperación** (cliente de Google,
  carpeta y pasos; nunca la contraseña). `snapshot-restore.sh` acepta el
  `.tar.gpg` (pide la contraseña o la lee de `SNAPSHOT_PASSPHRASE_FILE`). La
  config viaja en el snapshot: el servidor restaurado sigue subiendo solo.
  Verificado: 12 tests nuevos con un Google falso (conexión respetando el
  intervalo, subida con una parte caída que se retoma, el archivo bajado y
  descifrado es idéntico, retención sin tocar otro servidor, autorización
  revocada → fallo + un solo correo, kit sin contraseña) + E2E navegador 19/19.
  Siguen v0.1.283 (instalador + asistente) y v0.1.284 (mover una empresa).
- **2026-10-16 · v0.1.281** — Pregunta del usuario: «¿el MCP también puede
  crear los correos y PDF en el nuevo editor con sus bloques y hacer buenos
  diseños?» → no podía (sólo correos de texto/HTML y usar plantillas de PDF ya
  existentes) → «sí, hazlos que puedan usar el editor visual en el MCP». Ahora
  el asistente ✨ y el MCP diseñan: `send_email` acepta `design` (el modelo de
  bloques del editor de correos) y hay `propose_create/update/delete_document_
  template` + `get_document_template` para las plantillas de PDF. El modelo
  escribe los textos en formato sencillo (`**negrita**`, `- viñeta`) que se
  convierte al árbol del editor (`markdown-lite.ts` en shared, ida y vuelta),
  la tabla de ítems dice `from` = slug de la lista vinculada, y todo se valida
  contra la lista real (slugs, variables, columnas, totales). Acento por
  defecto = color de la marca; descripciones de las herramientas con el
  vocabulario completo + una guía de buen diseño; regla 16 del prompt. La
  propuesta del PDF deja un enlace que abre la plantilla en el editor
  (`?doc=`). Verificado: 6 tests nuevos + suites del asistente/MCP en verde y
  E2E por el MCP REAL (HTTP + token) 12/12: el correo y la cuenta de cobro que
  armó el MCP se abren y se ven en los editores visuales (PDF con la tabla de
  la lista vinculada, total y «dos millones… pesos»).
- **2026-10-16 · v0.1.280** — Reporte del usuario: el selector de fecha se
  abría y se cerraba solo al primer click (en los registros). Regresión de
  v0.1.259 (montar el popover recién al primer click desmontaba el botón con
  el foco; dentro de un diálogo el foco saltaba al diálogo y el popover se
  cerraba). Arreglado en fechas y en selectores de opciones. Lección: cuando
  un componente se "arma" reemplazando su disparador, devolverle el foco en el
  mismo commit — si no, cualquier Radix con FocusScope alrededor lo pierde.

- **2026-10-09 · v0.1.279** — Pedido del usuario: "la app tiene todo un
  acento argentino; nunca escribas con acento argentino, escribe todo en
  español neutro, a lo mucho tutea". Toda la interfaz, los errores, los
  correos, las páginas públicas, las plantillas y el asistente pasaron a
  tuteo neutro (ADR-S42). La regla queda fija en §1 «Cómo responderle» y en
  CLAUDE.md §6: también las respuestas en el chat van en tuteo neutro.
  Después (sin release propio, viaja en el próximo): a pedido del usuario se
  pasaron también a español neutro las guías de `docs/`, los comentarios de
  `deploy/` y los mensajes de los scripts de operación (`scripts/`).

- **2026-10-09 · v0.1.278** — Reporte del usuario: «Actualizar» falló con
  «No space left on device». El actualizador ahora mira el espacio antes,
  limpia lo que sobra (y lo que deja un deploy cortado), guarda 3 versiones y
  5 copias previas, y Plataforma → Diagnóstico muestra el disco con «Liberar
  espacio». El WAL de Postgres se poda solo tras recrear su contenedor una
  vez (runbook-disk). Para esta vez, comandos a mano en la consola. El
  mismo release suma los INODOS (el servidor tenía 26 GB libres: lo que se
  acabó es la cantidad de archivos) al chequeo previo, al mensaje de error y
  a la tarjeta Disco (runbook-disk §5). Y la causa de fondo: el servidor
  tenía 173 versiones porque systemd mataba a `finalize.sh` (y su poda) al
  reiniciar el API; ahora la versión nueva poda al arrancar (runbook §6).
- **2026-10-09 · v0.1.277** — Campos con IA (ADR-S41), la tercera de las
  ideas elegidas: resumir, clasificar, extraer, traducir o instrucciones
  propias a partir de otros campos (también PDF e imágenes), recalculados
  solos al cambiar sus fuentes, con la clave y la cuota de ADR-S21. Con esto
  quedan hechas las tres ideas pedidas; WhatsApp de ida y vuelta sigue para
  después por decisión del usuario.
- **2026-10-09 · v0.1.276** — «Mi trabajo» + bandeja de avisos (ADR-S40),
  la segunda de las tres ideas elegidas. La campana pasa a ser la bandeja
  (menciones, asignaciones, comentarios y cambios en lo que se sigue,
  recordatorios) con "sin leer" en el servidor y realtime por persona;
  «Seguir» y «Recordarme» en la ficha; página «Mi trabajo» con lo asignado en
  todas las listas agrupado por vencimiento; Ajustes → Avisos con qué llega
  por correo y el resumen diario (apagado por defecto: decisión para no
  mandar correos nuevos a todos al actualizar ni gastar la cuota de la
  empresa). Sigue v0.1.277: campos con IA.
- **2026-10-09 · v0.1.275** — Formularios públicos que crean registros
  (ADR-S39), la primera de las tres ideas que eligió el usuario. Ajustes de
  la lista → Formularios: constructor a pantalla completa con la página real
  como vista previa, preguntas condicionales, prefill por la dirección,
  cierre por fecha/cupo, enlace e inserción por iframe (página servida por el
  API con su propia CSP), anti-abuso sin captcha (trampa, sello de tiempo,
  límites por IP y formulario) y disparador «Cuando se envía un formulario».
  Encontrado en el E2E: un número escrito «1.500.000» con el formato
  coma-punto daba "Escribí un número" → el lector del formulario quedó
  tolerante (varios separadores iguales = miles). Decisión del usuario:
  WhatsApp de ida y vuelta queda para después. Sigue v0.1.276 «Mi trabajo».
- **2026-10-09 · v0.1.274** — El usuario aprobó el release de dependencias
  que quedó pendiente ("sí, hacé el release de dependencias"). `pnpm audit
  --prod` daba 4 avisos (2 high): (a) `@modelcontextprotocol/sdk` 1.30 → 1.31
  (el aviso es del cliente OAuth del SDK; usamos el servidor, pero se sube
  igual) — tests del MCP y OAuth 48/48 y prueba en vivo por HTTP;
  (b) `tailwindcss-animate` estaba en `dependencies` del front siendo un
  plugin de COMPILACIÓN → pasó a `devDependencies` y con eso `braces` y
  `postcss-selector-parser` dejaron de figurar en producción (el CSS sigue
  trayendo las animaciones); (c) `sprintf-js` (vía mssql→tedious) no tiene
  versión arreglada y tedious lo llama sólo con formatos fijos → excepción
  explícita en `pnpm.auditConfig.ignoreGhsas` (ADR-S38: excepciones sólo sin
  parche y no explotables, revisadas en cada release de dependencias).
  `pnpm audit --prod` sale en 0. De paso, los dos pins propios de
  `brace-expansion` (v0.1.114) habían quedado vulnerables (sólo ESLint/
  Testcontainers): 1.1.20 y 2.1.6.
- **2026-10-09 · v0.1.273** — Feedback del usuario sobre v0.1.272: "algunos
  ajustes quedaron dobles, como los de tipografía; la experiencia de ese editor
  es confusa y el visor de jerarquía está debajo de los bloques". Hecho (correo
  y PDF, que comparten el patrón): el panel del bloque se parte en
  **Contenido** (lo que dice) y **Estilo** (cómo se ve), recordando la pestaña
  al cambiar de bloque; cada ajuste vive en UN lugar — el tamaño rápido
  (Grande/Mediano/Chico) y el exacto en la misma fila (elegir el atajo borra el
  exacto), el color del texto y la alineación dentro de «Texto», el fondo y si
  es banda o recuadro juntos en «Fondo», el espacio rápido y los márgenes
  exactos juntos en «Espaciado», y el botón/la imagen con su propio borde (sin
  un segundo «Borde» del bloque). El árbol pasó a su propia pestaña
  **Estructura** (con contador); un bloque dentro de columnas muestra el
  camino para volver a ellas; separador y espacio no muestran pestañas; un
  único control de color (con colores rápidos) en todos lados; «Estilo
  general» en secciones plegables. Arreglos del entorno encontrados al
  reconstruirlo: `.env.example` traía `MAIL_FROM` sin comillas (el script de
  desarrollo no arrancaba el API) y `scripts/dev/create-superadmin.sh` usaba
  el alta pública, que rechaza emails de superadmin (SEC-04) → ahora crea el
  usuario directo en la base. Trampa del sandbox: Docker Hub responde 429; las
  imágenes salen de `mirror.gcr.io/library/…` y se re-etiquetan.
- **2026-10-08 · v0.1.272** — Pedido del usuario con captura del editor de
  correos: "le faltan muchas opciones: tipografía con campos numéricos
  (tamaño, margin y padding), borde, grosor de la letra, varias tipografías, a
  los botones radio y sombra… revisá qué campos debería tener cada bloque, que
  sean compatibles con los correos y con el PDF, y qué más le podés poner".
  Hecho: capa de estilo común a los dos editores (ADR-S37) con números
  tipeables; forma del botón, marco de la imagen, columnas con proporción y
  recuadro por columna, separador con tipo/largo, «Datos del registro» con
  colores; estilo general con fuente de títulos, tamaño base, interlineado y
  hoja con borde/sombra; 19 tipografías (8 del sistema + 11 de Google Fonts)
  incluidas en el repo para que el PDF las embeba y la vista previa las
  muestre sin tocar la CSP. Lo que el PDF no dibuja (esquinas, sombras) no se
  ofrece ahí, y lo que Outlook/Gmail muestran distinto lleva su aviso. Sumado
  por iniciativa: copiar/pegar el diseño entre bloques. Trampa de dev: el API
  de desarrollo corre `dist/` — tras tocar el render del PDF hay que hacer
  `npm run build` en `apps/api` antes de `scripts/dev/restart.sh` (si no, sale
  con Roboto).
- **2026-10-08 · v0.1.271** — Reporte del usuario con captura: el menú de
  tipos de acción del lienzo se abría hacia arriba y su parte superior quedaba
  fuera de la pantalla. Causa: un `max-h-[70vh]` propio que pisaba el tope de
  «espacio disponible» del menú compartido; ahora es el menor de los dos (y lo
  mismo en columnas, agrupar y «+ Bloque» de la ficha). E2E 9/9 en tres
  tamaños; el código anterior daba 3/9.
  En el mismo release, aclaración del usuario sobre v0.1.270: "del modo
  oscuro no me refería al correo sino a la interfaz de la app" — el sol/luna
  de la cabecera del editor oscurecía la vista previa del correo. Ahora es el
  botón claro/oscuro de la APP (`components/ThemeToggle.tsx`, el mismo de la
  barra superior) y está en los tres editores a pantalla completa (correos,
  PDF, ficha/portal), que tapan la barra. La simulación del correo oscuro quedó
  en Estilo general → Modo oscuro. E2E 18/18.
- **2026-10-08 · v0.1.270** — Pedido del usuario: "el editor de correos no
  es drag and drop, la vista responsive no funciona y no hay cómo ver modo
  oscuro; hacele una revisión completa". (1) **Arrastrar y soltar** de verdad:
  del panel a la vista previa (línea que marca dónde cae), reordenar en la
  vista previa y en el esquema, meter/sacar bloques de las columnas (las
  columnas sólo aceptan bloques simples; "Datos del registro" cae al primer
  nivel). (2) **Vista de celular rota**: no era el editor sino el correo — la
  imagen fijaba su tabla a 600 px y el correo REAL quedaba más ancho que el
  teléfono; ahora es fluida (afecta a todos los correos enviados, para bien), el
  marco es de 375 px reales y los títulos se achican en el teléfono. (3) **Modo
  oscuro**: botón sol/luna en el editor (simula Gmail/Outlook si no hay colores
  propios) + «Modo oscuro» en Estilo general con colores propios que respetan
  Apple Mail y Outlook. (4) Revisión: barra flotante del bloque elegido, atajos
  (Supr, Ctrl+D, Alt+↑↓, Esc) que ahora también andan con el foco DENTRO de la
  vista previa (antes Ctrl+Z dejaba de andar después de tocar un bloque),
  enlace en un popover en vez de `prompt()`, esquema con resumen de cada
  bloque y columnas, subir/bajar deshabilitados en los bordes. Tests: 17 front
  + 4 shared nuevos, E2E 23/23.
- **2026-10-08 · v0.1.269** — Segunda mitad de "S3 primero y después
  Drive": integración Google Drive (permiso `drive.file`, no sensible) como
  almacenamiento de la empresa — carpeta «Imagina Base» con los nombres reales,
  fuera del plan, descarga por el servidor (Drive no tiene enlaces
  prefirmados). Elegir cualquier almacenamiento ahora prueba subir/leer/borrar
  antes de aceptarlo; un Drive con archivos no se re-autoriza con otra cuenta.
  Guía de Google y política de privacidad actualizadas. **Para el operador**:
  habilitar la Drive API y sumar `drive.file` en la pantalla de consentimiento.
  5 tests nuevos + E2E 12/12 contra un Drive falso.
- **2026-10-08 · v0.1.268** — Pregunta del usuario: "que estos PDF no gasten
  espacio en el servidor… Google Drive o S3, y ahí no cuenten para el plan" →
  propuesta en 4 piezas → "Hacé las dos juntas, S3 primero y después Drive".
  Hecho (ADR-S36): (1) `{{pdf.link}}` y «Copiar enlace (30 días)» arman el PDF
  al abrirlo, sin archivo; (2) integración «Almacenamiento S3» (AWS/B2/R2/
  Wasabi/DO/MinIO) + Ajustes → Almacenamiento: lo que se sube va al bucket de
  la empresa, no cuenta para el plan, se baja directo del bucket (302 a un
  enlace prefirmado) y se puede mudar por tandas en los dos sentidos.
  Migración 0069 (`attachments.storage_connection_id`). Env nuevo
  `STORAGE_ALLOW_PRIVATE_HOSTS` (opcional). Nada en silencio: bucket caído →
  la subida falla con el motivo; la conexión con archivos no se borra. E2E
  24/24 contra moto. Queda: Google Drive (v0.1.269).
- **2026-10-08 · v0.1.267** — "Continúa con lo que falta" → fase 2 de los
  PDF (ADR-S35): (1) **consecutivo por plantilla** — prefijo/dígitos/desde,
  un número por registro emitido al generar de verdad (ficha, automatización o
  portal) con bloqueo de la plantilla, reusado al regenerar, la vista previa
  no lo consume y un rollback lo libera; opcionalmente guardado en un campo de
  texto (el mismo PDF ya lo muestra y una acción posterior no lo pisa).
  `{{documento.numero}}` en el documento y `{{pdf.numero}}` en la
  automatización; la cuenta de cobro de la galería lo trae encendido salvo que
  la lista ya tenga su propio campo de número. (2) **Bloque QR** con
  variables. (3) **«Tus documentos» en el portal del cliente** para las
  plantillas marcadas «Disponible en el portal» — el cliente sólo elige la
  plantilla, el registro es siempre el suyo. Insignias «Próximo CC-0100» y
  «Portal» en el panel de plantillas. Migración 0068 (`document_numbers` +
  `next_number`/`portal_visible`), viaja en la migración de empresa. **Bug
  atrapado en el E2E**: con el número guardado en un campo que el documento
  también muestra, el PRIMER PDF salía sin número (el registro se leía antes de
  emitirlo); arreglado y con test. 5 tests de integración nuevos (12 en el spec
  de documentos) + 1 del front; E2E navegador 18/18 (editor, ficha, portal,
  404 de plantilla no publicada, 401 sin sesión, celular).
- **2026-10-08 · v0.1.266** — Pedido del usuario: "una opción en
  automatizaciones para crear un PDF y enviarlo adjunto… con editor y
  plantillas" → recomendación aceptada ("Dale, arrancá con la fase 1, primero
  cuenta de cobro"). Hecho (ADR-S35): plantillas de documento por lista con
  editor visual y el PDF REAL de vista previa; arranques «Cuenta de cobro» y
  «con detalle» (ítems de una lista vinculada, total en letras); botón
  «Generar PDF» en la ficha (descargar o guardar en un campo Archivo);
  acción «Generar un PDF» (`{{pdf.link}}`) y «Adjuntar PDF» en «Enviar email».
  Render con pdfmake en el proceso (nada de Chromium): ~30 KB y <0,5 s por
  documento; el disco sólo se usa si se elige guardar. Decisiones: no es
  factura electrónica DIAN (lo dice la plantilla); variables legibles por
  defecto con `|value` para el crudo. Queda: probar el PDF adjunto real en
  Gmail/Outlook desde el servidor y decidir la fase 2.
- **2026-10-08 · v0.1.265** — Pedido del usuario: "en la acción enviar email
  quiero un editor de correos, el actual es un campo de texto muy básico;
  diseños más elaborados y editables, totalmente compatibles con Gmail y
  Outlook; y no vi dónde incluir la firma". Hecho (ADR-S34): contenido en tres
  formatos (Diseño visual / Texto / HTML); editor a pantalla completa por
  bloques con vista previa real, datos de un registro, plantillas, celular;
  HTML de tablas + estilos inline + condicionales de Outlook + texto plano; la
  firma es una casilla visible de la acción («Firma de» una persona del
  equipo) y se edita en visual en Ajustes; «Enviarme una prueba» a la propia
  casilla. Bug de paso: dos versiones de prosemirror-model en el lockfile
  (override). Queda: probar el correo real en Gmail y Outlook desde el
  servidor (en el sandbox el correo sale por el transporte de log).
- **2026-10-07 · v0.1.264** — Feedback del usuario con captura: la vista
  previa de Formato regional mostraba un ejemplo fijo (31/12/2026 · 2:30 p. m.)
  y confundía, parecía la hora actual. Ahora muestra la fecha y la hora REALES
  de la zona elegida, rotuladas. Y «arreglá también eso»: el filtro de los
  rollups ya usa la zona de la empresa (era el pendiente de v0.1.263).
- **2026-10-07 · v0.1.263** — Reporte del usuario: un cliente en Colombia
  programó una automatización para las 8 am y salió a las 3 am. Causa: no había
  zona horaria por empresa y los horarios creados sin zona (asistente, MCP,
  API, plantillas) corrían en UTC. Decisión aprobada por el usuario ("Sí,
  hazlo así"): zona por empresa en Ajustes → Formato regional, propuesta sola
  desde el navegador del admin; se usa como respaldo en todo lo que no tenga
  zona (automatizaciones, vencimientos, recurrencias, «hoy» de filtros y
  tableros, asistente); el editor muestra la zona real y avisa si corre en UTC;
  los horarios existentes sin zona siguen a la de la empresa sin migrar nada.
  ADR-S33.
- **2026-10-07 · v0.1.262** — Reporte del usuario: en celular, al DESLIZAR la
  tira de pestañas de vistas se abría el menú de alguna pestaña sin haberla
  mantenido presionada. Causa: el «···» de Radix abre en `pointerdown`, que en
  táctil es el inicio de cualquier gesto (y la pestaña `draggable` encima
  peleaba con el scroll). Arreglado para TODOS los menús «···» de la app (en
  táctil abren con el tap, que no existe si el gesto fue scroll), el
  mantener-presionado de la pestaña exige dedo quieto 450 ms, y en táctil las
  pestañas no se arrastran: se reordenan con «Mover a la izquierda/derecha»
  del menú. Mouse y escritorio sin cambios.
- **2026-10-07 · v0.1.261** — Pedido del usuario con capturas de ClickUp: el
  «+» de columna era una columna casi vacía que desperdiciaba espacio → ahora
  flota sobre la cabecera con degradado, y el área de trabajo ya no tiene ancho
  máximo (la tabla usa toda la ventana).
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
