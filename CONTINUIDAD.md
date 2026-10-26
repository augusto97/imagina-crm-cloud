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

**Estado**: todas las fases F0–F12 completas (ver `CLAUDE.md` §5). Última
versión publicada: **v0.1.310** (checklists y plantillas de registro), en `main`.

**Hilos abiertos (lo último que se habló)**
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
  Sólo falta **Equipos + roles + invitados** (migración 0085), que además
  conecta los equipos con Aprobaciones y con Carga de trabajo.
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
