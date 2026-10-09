# Imagina Base — Instrucciones de trabajo

> Este es el documento de trabajo de **Imagina Base**, la app SaaS (repo
> `imagina-crm-cloud` en GitHub — nombre histórico; el producto se llama
> Imagina Base, ver ADR-S10). Leélo SIEMPRE antes de cualquier tarea, junto
> con:
>
> - **`STANDALONE.md`** — la arquitectura completa y los ADRs. Es la fuente
>   de verdad de TODAS las decisiones técnicas. No contradecirlo sin
>   proponer un ADR nuevo.
> - **`HANDOFF.md`** — lecciones aprendidas durante el desarrollo del plugin
>   WordPress hermano (bugs reales que costaron días). Evitan repetir
>   errores ya pagados.
> - **`CONTINUIDAD.md`** — el **salvavidas**: cómo trabajamos con el usuario,
>   ritual de release, cómo llegan las actualizaciones a los servidores, el
>   servidor de producción, el entorno de desarrollo (`scripts/dev/up.sh`),
>   estado actual, hilos abiertos y bitácora. **Se actualiza en cada release.**
> - **`CONTRACT.md`** — especificación funcional exacta heredada del plugin:
>   operadores de filtros, reglas de slugs, capabilities, tipos de campo,
>   shapes de vistas/automatizaciones/portal. Ante dudas más finas:
>   `reference/plugin-backend/` (el PHP original, solo lectura).

---

## 1. Qué es este proyecto

**Imagina Base**: SaaS multi-tenant para construir bases de datos flexibles
—listas dinámicas, registros, vistas y automatizaciones (tipo Airtable /
ClickUp / Notion-databases). NO es un CRM: un CRM es apenas uno de los casos
de uso que un cliente puede *armar* con la herramienta. Evolución del plugin
WordPress `imagina-crm` — comparte el diseño de dominio y el frontend React,
pero con backend propio y posicionamiento de producto propio (ADR-S10).

**Origen del frontend**: el directorio `apps/web/` es un fork del `app/` del
plugin. Todo el trabajo de UX ya invertido ahí (editor de plantillas,
dashboards, Kanban, tabla, portal) se conserva y evoluciona acá.

## 2. Stack (resumen — detalle en STANDALONE.md)

- **Backend**: Node 22 + TypeScript estricto + NestJS (Fastify) + Drizzle ORM.
- **DB**: PostgreSQL 16. Datos dinámicos en JSONB con claves `"f{field_id}"`
  inmutables. RLS activo en toda tabla con `tenant_id`.
- **Cache/colas**: Redis 7 + BullMQ.
- **Validación**: Zod en `packages/shared/` — LOS MISMOS schemas para front
  y back. Nunca definir un shape dos veces.
- **Frontend**: React 18 + TanStack Query/Table + Zustand + shadcn/Tailwind.
- **Monorepo**: pnpm workspaces + Turborepo. Packages con scope
  `@imagina-base/*` (`@imagina-base/api`, `@imagina-base/web`,
  `@imagina-base/shared`).

## 3. Reglas de oro (no negociables)

1. **El slug es etiqueta humana editable; el ID es la verdad.** Claves JSONB
   por `f{field_id}`, referencias internas por ID, slug solo entrada/salida.
   (Herencia directa del plugin — ADR-008 / ADR-S02.)
2. **Todo shape pasa por `packages/shared/`** (Zod). El backend valida con el
   mismo schema que tipa al frontend.
3. **`tenant_id` + RLS en toda tabla de datos.** Toda query corre dentro de
   una transacción con `SET LOCAL app.tenant_id`.
4. **QueryBuilder con whitelist estricta**: slug → field → expresión JSONB
   tipada. Jamás interpolar input del usuario en SQL.
5. **Presupuestos de performance como contrato** (STANDALONE.md §13). Si una
   feature los toca, el PR incluye benchmark.
6. **Monolito modular.** Prohibido proponer microservicios (ADR-S05).
7. **Un solo identificador canónico en queryKeys de TanStack**: el ID
   numérico. El slug se resuelve ANTES de armar la key. (Lección cara del
   plugin — ver HANDOFF.md §2.)
8. **Batch endpoints por diseño**: si una vista necesita N recursos, se crea
   un endpoint bundle. N+1 y waterfalls prohibidos.
9. **Los datos del cliente nunca se secuestran** (ADR-S09): impago =
   solo-lectura + export.

## 4. Estándares de código

### TypeScript (back y front)
- `strict: true`, `noUncheckedIndexedAccess: true`. No `any` salvo justificado.
- Backend: módulos NestJS por dominio (`lists/`, `fields/`, `records/`,
  `views/`, `automations/`, `tenancy/`, `auth/`, `billing/`). Controller
  delgado → Service → Repository (Drizzle). Nunca lógica en controllers.
- Frontend: mismas convenciones que el plugin (`PascalCase.tsx`,
  `useCamelCase.ts`, un componente por archivo, TanStack Query para server
  state).

### Commits
- Conventional commits. `feat(records): ...`, `fix(tenancy): ...`.

### Tests
- Backend: Vitest + Testcontainers (Postgres real, no mocks de DB) ≥ 70% en
  services. Los tests de RLS son obligatorios para toda tabla nueva.
- Frontend: Vitest ≥ 60% en hooks/lógica.
- Benchmarks de los contratos §13 en CI contra seed de 100k records.

## 5. Estado de fases (actualizar al avanzar)

- [x] **F0 — Fundaciones**: monorepo pnpm+Turborepo, CI, Docker (PG16+Redis7),
      esqueleto NestJS+Drizzle, auth por sesión opaca en Redis, tenancy+RLS
      (rol `imagina_app`), primeros schemas Zod en shared/. Tests de RLS y
      auth con Testcontainers en verde.
- [x] **F1 — Core dominio**:
  - [x] `lists` — CRUD, slugs, id-o-slug, capabilities.
  - [x] `fields` — 14 tipos, validador de valores compartido, config por
        tipo, reorder, toggle is_indexed.
  - [x] `records` + QueryBuilder JSONB — CRUD, validación de data, filter
        tree (whitelist tipada), cursor pagination keyset, own-scoping.
  - [x] `views` — saved views table/kanban/calendar/cards, default único.
  - [x] `bootstrap` — workspace+user+lists+fields+views+caps en 1 request.
  - [x] `slugs/check` — formato/reservado/unicidad.
  - [x] Front conectado: CloudClient tipado + shell propio cloud
        (login/register, workspace switcher, sidebar de listas, tabla de
        records con alta de campos/registros, FilterBar AND) contra el nuevo
        API, verificado end-to-end en navegador (Playwright). BrowserRouter,
        auth por cookie de sesión.
  - [x] **UI real del fork conectada (Etapa 1)**: el bundle desplegado ahora
        monta `app/admin` (la UI pulida heredada del plugin: AdminShell,
        índice de listas, tabla de records con columnas/badges) en vez del
        shell mínimo. Gate de sesión (`AdminCloudApp`) + adaptador en
        `lib/api.ts` que reapunta la capa de datos del fork al backend NestJS
        (envelope, `data`↔`fields` por slug↔f{id}, timestamps naive-UTC,
        `X-Tenant-Id`, cursor→página). List DTO ahora expone created_at/
        updated_at. Verificado E2E (login→listas→records CRUD) en navegador.
        Pendiente (etapas siguientes): dashboards, footer de agregados,
        editor de plantillas/portal, automatizaciones, menciones.
  - [x] **Permisos por lista (ACL por rol)**: `settings.permissions` por rol
        configurable (manager/agent/viewer) con scopes view/edit/delete
        (all/assigned/own/none) + create + `fields_hidden`. Enforcement en
        `records.service` (scope SQL + strip de campos ocultos); endpoints
        `GET/PATCH /lists/:id/permissions` (`manage_lists`) + panel del List
        Builder. Tests de ACL. Reconstrucción de ajustes de lista para la nube
        (se quitaron paneles vestigiales de WordPress: mantenimiento,
        visibilidad-shortcode; alta de campos por catálogo cliente).
  - [x] **Listas públicas embebibles (ADR-S14)**: una lista se publica de
        solo-lectura por **token opaco** y se embebe por `<iframe>` con
        **restricción por dominio** (CSP `frame-ancestors`). Backend:
        tabla `public_lists` sin RLS (índice token→lista), `settings.public`
        (campos visibles/orden/búsqueda/dominios), endpoints públicos sin auth
        (`/public/lists/:token/meta` + `/records` + página HTML autocontenida
        `/public/l/:token`) y admin (`GET/PATCH /lists/:id/public`,
        `manage_lists`). Sólo llegan los campos marcados visibles; búsqueda/orden
        acotados a ese subconjunto. Front: panel "Lista pública" del List Builder
        (campos visibles, orden, dominios, enlace + snippet de iframe). 12 tests;
        verificado E2E contra el build de producción (meta/records/HTML+CSP,
        campos ocultos nunca se filtran, disable→404).
- [x] **F2 — Vistas + realtime**:
  - [x] Realtime por invalidación push — gateway Socket.io (auth por cookie,
        rooms por tenant) + Redis adapter multi-nodo; los services emiten al
        mutar y el front invalida TanStack. Verificado entre pestañas.
  - [x] `comments` — CRUD por record, kind, threading, autoría, realtime.
  - [x] `activity` — log append-only con diffs, escrito en el tx de la
        mutación; endpoints por lista/record.
  - [x] `aggregate` — motor de agregaciones (§5): count/sum/avg/min/max/
        unique/empty/true/false + group_by + filter tree (footer + dashboards).
  - [x] Front: switcher Tabla/Kanban/Tarjetas/Calendario/Dashboard + record
        drawer (edición + comments + activity + emisión de magic link),
        consumiendo el API con realtime. Los 4 tipos de vista del CONTRACT §7
        renderizados; FilterBar compartido (filter_tree server-side).
        Fixes de vistas en la nube (verificado E2E en navegador): (a) Kanban
        renderiza columnas DINÁMICAS por valor presente en los registros
        —no sólo por las opciones predefinidas del campo— así también agrupa
        por campos de texto/estado (antes: tablero vacío); (b) el adaptador
        traduce `per_page → limit` (máx 200) para el listado de records, así
        Kanban/Tarjetas/Calendario traen hasta 200 (antes se cortaban en 50);
        (c) fix de loop de render infinito ("Maximum update depth") en
        SaveViewDialog y DashboardCreateDialog: el objeto de mutación de
        react-query estaba en las deps del useEffect → `create.reset()` en
        cada render → loop; ahora depende sólo de `open`. Afectaba a toda
        página con esos diálogos montados (records, dashboards).
- [x] **F3 — Automatizaciones + portal**:
  - [x] Motor de automatizaciones sobre BullMQ: triggers (record_created/
        updated dispatch), condiciones (filter tree), actions (update_field,
        create_record, call_webhook con HMAC, send_email simulado), runs con
        logs. CRUD + runs endpoint. Worker in-process con Redis.
  - [x] **Paridad total con el editor del plugin (form + diagrama)**: se
        reescribió el modelo del backend al shape FLEXIBLE del plugin —
        `trigger_type` (slug) + `trigger_config` (field_filters + changed_fields
        + claves del trigger) + `actions[]` (ActionSpec con condición POR ACCIÓN
        + `if_else` recursivo con ramas then/else). Motor nuevo: condition
        evaluator (array rico `[{field,op,value}]` por slug, todos los operadores)
        + merge tags (`{{slug}}`, `{{record.id}}`) + acciones ricas (send_email
        con is_html/cc/bcc/from, call_webhook con method/body_template/headers/
        HMAC, update_field multi-campo, create_record). Endpoints de catálogo
        `/triggers` + `/actions` y `/automations/:id/runs`. Migración 0014
        (trigger/condition → trigger_type/trigger_config; runs → actions_log/
        error/started_at/finished_at). MailMessage extendido (cc/bcc/from).
        Verificado E2E en navegador (Formulario + Diagrama React-Flow) y en vivo:
        crear record → run success con log `send_email → if_else → update_field`,
        la rama then seteó el campo. 140 tests de la API en verde.
  - [x] Portal del cliente — magic links de un solo uso (Redis), usuario rol
        client vinculado a un record, POST /portal/consume abre sesión,
        GET /portal/me devuelve record + fields + template de bloques.
  - [x] Scheduling: triggers `scheduled` (cron) y `due_date_reached` (escaneo
        periódico con dedup por automation_runs) vía job schedulers de BullMQ
        (persisten en Redis → sobreviven reinicios sin re-enumerar).
  - [x] Front automatizaciones: se monta el EDITOR REAL del plugin
        (`AutomationsPage` + `AutomationDialog`) en la nube, con sus dos modos
        **Formulario** y **Diagrama** (builder visual React-Flow con ramas
        Sí/No), merge-tag chips, email rico (From/Cc/Bcc/HTML/firma), condición
        por acción y "disparar solo si cambian estos campos". Funciona porque el
        backend ahora habla el shape del plugin (ver arriba) + los endpoints de
        catálogo. Se eliminó el panel/side-sheet nativo mínimo anterior.
        Verificado E2E en navegador (form + diagrama renderizan; alta→persistido→
        ejecuta).
  - [x] Front portal: SPA del cliente (build `portal` aparte) — `/portal/acceso`
        canjea el magic link y `/portal` renderiza record + campos + template
        (bloques heading/notice/static_text); admin emite el link desde el
        record drawer.
  - [x] **Editor visual (drag&drop) del template del portal**: el editor ya
        existía (shell `TemplateEditorShell` compartido con el CRM + `portalRegistry`
        de ~22 tipos de bloque + `PortalRenderer` en el portal SPA + entrada desde
        el List Builder), pero el template DISEÑADO no llegaba al cliente: el editor
        persiste `settings.portal_template` como `{ blocks: [...] }` y el backend
        `portal.me` hacía `Array.isArray(portal_template)` → como es objeto, devolvía
        template vacío. Fix: `extractPortalBlocks` normaliza `{blocks}`→array (y acepta
        el array plano legacy). Ahora el loop completo funciona (diseñar→guardar→el
        cliente lo ve). Test del shape `{blocks}` + E2E en navegador (editor carga +
        el portal renderiza heading/client_data del template).
- [x] **F4 — Comercial**:
  - [x] Límites por plan (PlanService: max records/users/automations) +
        enforcement en create de records. Degradación a solo-lectura por
        impago en el TenantGuard (ADR-S09: los datos nunca se secuestran).
  - [x] Billing summary (plan+estado+uso+límites) + webhook stand-in de
        Stripe (gateado por secret) para cambiar plan/estado.
  - [x] Export JSON de intercambio (STANDALONE §16): GET /lists/:list/export
        (list+fields+views+records, keyset). Disponible en solo-lectura
        (completa la promesa de ADR-S09: impago = solo-lectura + export).
  - [x] Import de filas a una lista (mapeo columna→campo, validación por
        tipo con el validador compartido, errores por fila, límite de plan).
  - [x] Front comercial: página de Ajustes (plan, estado, barras de uso vs.
        límites) + export/import (JSON download, import CSV con auto-mapeo)
        en el toolbar de la lista.
  - [x] Onboarding guiado: wizard de primer uso con plantillas de arranque
        (crea lista+campos en cadena) en el estado vacío del workspace.
  - [x] Panel admin de miembros (full-stack): alta por email / cambio de rol /
        baja bajo /workspaces/current/members (rol admin), guard rails
        (último admin, auto-baja, duplicado, usuario inexistente), tests RLS.
  - [x] Emails transaccionales (ADR-S11): MailModule con transporte
        intercambiable (log/smtp nodemailer), encolado en BullMQ; acción
        `send_email` real + magic link del portal por email. Config SMTP de
        plataforma editable desde Ajustes (panel superadmin): PlatformSettings
        en Redis (`platform:smtp`), el MailService la toma en el próximo envío
        sin reiniciar (fallback al transporte por env), GET sin password,
        botón de correo de prueba. Tests.
  - [x] Pagos (ADR-S12): PayPal (USD) + Mercado Pago (COP) detrás de una
        interfaz `PaymentGateway` (Stripe no opera en Colombia). Checkout por
        proveedor, webhooks firmados por proveedor (HMAC MP / verify-webhook
        PayPal) → setBilling; front en Ajustes (admin) con planes/precios.
        Tests de firmas, mapeos y service. Falta prueba en sandbox con creds.
  - [x] **Consola de plataforma / operador (ADR-S15) — Fase 1 (clientes +
        stats)**: el superadmin de plataforma (allowlist `PLATFORM_SUPERADMINS`)
        ahora tiene gestión real de CLIENTES, separada de la app por-tenant.
        Endpoints `/platform/*` (`SuperadminGuard`) sobre la conexión base
        (superusuario → bypass RLS): `GET /stats` (empresas por estado/plan,
        impagas, usuarios, records, altas 30d), `GET /tenants` (todas con plan/
        estado/uso/owner) y `PATCH /tenants/:id` (cambiar plan / suspender-
        reactivar → solo-lectura, reusa BillingService). Front: sección
        "Operador → Plataforma" en el sidebar (visible sólo si el probe no da
        403) con dashboard + grilla de empresas editable. 5 tests + E2E en
        navegador (login superadmin → nav → 54 empresas → cambio de plan).
  - [x] **Consola de plataforma — Fase 2 (usuarios)**: gestión del ciclo de vida
        de cuentas. `GET/POST /platform/users` (listar todos + nº de workspaces/
        flags; alta con email de invitación → link para definir contraseña),
        `PATCH /platform/users/:id` (desactivar/reactivar) y `.../reset-password`.
        Desactivar (`users.disabled_at`) BLOQUEA el login (403) y REVOCA todas
        las sesiones al instante (índice inverso `usess:{id}` en Redis); guard
        rail: no se puede desactivar a un superadmin. Front: card "Usuarios" en
        la consola (alta + grilla con reset/desactivar; superadmin sin botón de
        desactivar). 12 tests + E2E en navegador (alta→invita→desactiva→
        reactiva).
  - [x] **Consola de plataforma — Fase 3 (planes editables en DB)**: los planes
        dejan de ser una constante y viven en la tabla `plans` (editable). El
        `plan` de un tenant es un slug dinámico (`planSchema`=string; los 4
        built-in quedan como semilla/fallback). `PlansService` (billing, @Global)
        sirve los límites con cache 30s (hot path de `assertCanCreateRecord`) y
        `BillingService` los consume. `GET/POST /platform/plans` +
        `PATCH/DELETE /platform/plans/:slug`; `updateTenant` valida el plan;
        borrar un plan en uso se rechaza. Front: card "Planes" (edición inline de
        límites + alta/baja) y el select de plan de cada empresa se puebla
        dinámicamente. 4 tests + E2E en navegador (editar límite→persiste, crear
        plan→aparece en el dropdown de la empresa).
  - [x] **Precios de checkout por plan (ADR-S12 + ADR-S15 F3)**: los precios
        dejan de estar cableados (sólo starter/pro) — viven en la tabla `plans`
        (`price_usd`/`price_cop`, migración 0019, seed de los built-in). Un plan
        **custom** se vende self-serve apenas el operador le pone precio. El
        checkout resuelve el monto desde la DB (`PlansService.priceFor`) y
        rechaza (`plan_not_sellable`) si el plan no tiene precio en la moneda del
        proveedor; `config` expone la lista DINÁMICA de planes vendibles (por eso
        `createCheckoutSchema.plan` pasó de enum a slug). Front: la card "Planes"
        de la consola edita USD/COP por fila; el panel de Suscripción de la
        empresa lista los planes con precio (y sólo el proveedor cuya moneda
        aplica). 6 tests nuevos (unit del service + persistencia en la consola).
  - [x] **Consola de plataforma — Fase 4 (alta + detalle de empresa)**: el
        operador da de alta una empresa nueva + su admin en UN paso (`POST
        /platform/tenants`; si el email ya existe lo suma como admin, si no crea
        + invita; reusa el patrón RLS de register). `GET /platform/tenants/:id`
        devuelve el detalle (datos + miembros + límites del plan). Front: botón
        "Nueva empresa" + formulario, y fila expandible por empresa con miembros
        y uso vs límite. 4 tests + E2E en navegador (alta→aparece en grilla,
        detalle muestra admin + uso/límite del plan). Pendiente (opcional):
        impersonar empresa para soporte (diseño de auditoría aparte).
- [x] **F5 — Hardening**:
  - [x] Benchmarks §13: harness `pnpm bench` (seed 100k) para GET /records
        (2 filtros, cursor 50, ≤100 ms) y PATCH (≤60 ms); PASS/FAIL en tabla,
        enforcement opt-in BENCH_STRICT. Ambos holgadamente en presupuesto.
  - [x] Monitoreo: probes /health/live y /health/ready (503 si deps caen) +
        /metrics (contadores + p50/p95/p99) e interceptor que loguea lentas.
  - [x] Backups+restore drill: scripts pg_dump/restore + drill end-to-end
        (verifica restaurabilidad) + runbook (RPO/RTO, cadencia, cifrado).
  - [x] Despliegue en VPS: Caddy (HTTPS) + systemd + Postgres/Redis en Docker,
        artefactos en `deploy/` + runbook. Verificado E2E en navegador (Playwright).
  - [x] Auto-actualización desde GitHub Releases (ADR-S13): CI empaqueta bundle
        + .sha256 → detect horario → panel superadmin instala con flip de symlink
        atómico + health-check + rollback. Tests de orquestación (fake deployer).
  - [x] Resiliencia de Redis: todo cliente ioredis y worker/cola BullMQ lleva
        listener `error` (`guardRedis`) → un fallo de conexión (NOAUTH,
        ECONNREFUSED) se loguea y el proceso SOBREVIVE en vez de caerse por
        "Unhandled 'error' event"; `/health/ready` sigue reportando 503.
        `unhandledRejection` global de red de seguridad. Además el arranque es
        resiliente: los `onModuleInit` del módulo update ya NO awaitan Redis de
        forma bloqueante (self-heal best-effort + registro de scheduler sin
        bloquear), así el API BOOTEA y escucha aunque Redis esté caído y se
        auto-recupera al volver. Tests de regresión (guard + boot).
  - [x] Perf del camino caliente (WAN + por-request): (a) compresión de
        respuestas del API (`@fastify/compress` br/gzip) — una lista de 50
        records baja de ~16 KB a <1 KB en el cable (~94%); (b) el scope de RLS
        de cada transacción (`SET LOCAL ROLE` + `set_config('app.*')`) se hace
        en UN solo `SELECT` en vez de 2-3 round-trips secuenciales; (c) el path
        de records ya no re-resuelve la lista dos veces (`fields.listByListId`
        con el id ya resuelto) → una transacción con scope menos por request;
        (d) nginx de despliegue: `gzip_proxied` + keepalive al upstream Node
        (reusa TCP por request). RLS y 138 tests en verde.
  - [x] CSS base reconstruido para la nube: el fork asumía el reset + chrome
        de wp-admin (y un reset inline por PHP que no existe acá), con
        Tailwind `preflight` apagado → los elementos caían al default del
        navegador (body serif/blanco, inputs/botones/enlaces sin estilo). Se
        reconstruyó un reset moderno propio + tema en la raíz (`#root`, no sólo
        el inexistente `#imcrm-root`) + normalización de form/enlaces/listas +
        prosa (`.imcrm-prose*` para markdown/portal, reemplaza al typography
        plugin ausente). Se removió el CSS muerto de wp-admin (#wpadminbar…).
  - [x] CSS del portal + listas públicas reconstruido: ~150 clases BEM
        `imcrm-portal-*` / `imcrm-public-list__*` (hero/kpi/notice/faq/
        downloads/contact/cta/stats/data-list/comments/activity/divider/form +
        tabla pública con filtros/paginación/orden y layout mobile) vivían en
        la hoja del front del plugin que nunca se copió → el portal salía sin
        estilo. Reconstruidas sobre los tokens del tema (`portal-components.css`),
        light/dark. Verificado E2E en navegador (admin + portal).
  - [x] **PITR / WAL archiving (STANDALONE §14/§17)**: archivado continuo de
        WAL en producción (`deploy/docker-compose.prod.yml`: `archive_mode=on`
        → volumen `walarchive` separado de `pgdata`, `archive_timeout=300` →
        RPO ≤ 5 min). Base backup físico diario (`scripts/basebackup.sh`:
        `pg_basebackup -Ft -z -Xs` dentro del contenedor + GPG/retención + poda
        de WAL con `pg_archivecleanup`). Restore a un instante elegido
        (`scripts/pitr-restore.sh --target-time` → replay del WAL + promote, en
        un data-dir NUEVO, sin tocar el pgdata de prod). Drill end-to-end
        (`scripts/pitr-drill.sh`, PASS: restaura a T1 → trae A y no B). Runbook
        `docs/runbook-pitr.md` (RPO/RTO, off-site del WAL, promoción, límites).
        Con esto F5 queda completa.
  - [x] **Auditoría integral post-portado (sin vestigios de WordPress)**: se
        eliminó todo lo WP-only del fork — `@wordpress/i18n` (reemplazado por
        `lib/i18n.ts` propio), entradas/`vite.config.ts` del build del plugin
        (`build`/`dev` ahora apuntan al build cloud), el shell cloud viejo
        (~15 archivos muertos), la Settings page del plugin (License/Webhooks/
        CustomRoles). Se cablearon los últimos endpoints que la UI llamaba en
        vacío: `GET /me/users-search` + `/me/users/:id` (pickers de usuario),
        `GET/PATCH /me/email-signature` (migración 0022; card montada en
        Ajustes), `POST /lists/:l/import/preview|run` (ImportDialog completo:
        CSV parser propio, sugerencia de mapping/tipos, campos on-the-fly,
        auto-expansión de opciones de select, warnings de pérdida de datos),
        `GET /lists/:l/fields/:f/values` (autocomplete de filtros) y
        `GET /lists/:l/export?format=csv` (CSV con campos/delimiter/BOM/filtro
        respetando ACL). Realtime reconectado al fork (el hook quedó montado en
        `AdminCloudApp` invalidando las queryKeys reales). Gates cloud para
        media de WP (attachments/FileItem) y recurrencias; fix del path de
        `automationRuns`. Hardening: CORS del WebSocket ya no refleja cualquier
        Origin (same-origin por defecto, `WS_ALLOWED_ORIGINS` opt-in). Lint del
        front en 0 errores (hooks condicionales y hooks tras early-return
        corregidos). 242 tests API + 13 nuevos en verde; verificado E2E.
  - [x] **Limpieza final del modo dual (v0.1.48)**: el fork corría con
        ramas `if (!cloud)` para el build WordPress que ya no existe — se
        eliminaron por completo. `lib/boot.ts` sin `window.IMAGINA_CRM_BOOT`
        ni `restNonce/adminUrl/cloud` (runtime puro, restRoot `/api/v1`);
        `lib/api.ts` siempre-cloud; ExportButton sin branch async de WP;
        Topbar sin "Ver WP" ni logout a wp-login; `useAttachments` inerte
        (sin media library aún — interfaz conservada); FileValueItem único
        (URL→link); cap interna `manage_options` renombrada a
        `workspace_admin`. Portal: bloques y `portal/api.ts` sin
        `X-WP-Nonce`; `DownloadFilesBlock` renderiza URLs del field sin
        `/wp-json` (los bloques con endpoints aún no implementados —
        comments/activity/aggregates/records del portal— sólo corren en el
        preview mock del editor; documentado en `portal/api.ts`). Barrido de
        alcanzabilidad (madge): 4 huérfanos borrados (PortalRenderer,
        PortalBlockPreview legacy, PropertiesSidebar, visually-hidden).
        `isCloud()` eliminado; `moduleEnabled` lee sólo CLOUD_WIRED.
        Typecheck/lint 0 errores, build OK, verificado E2E en navegador.

- [x] **F6 — Paridad total con el plugin** (brechas detectadas en la auditoría
      v0.1.47/48; orden: relations → portal completo → búsqueda → menciones →
      media → recurrencias → computed):
  - [x] **Campos `relation` (v0.1.49)**: tabla `relations` (migración 0023,
        RLS + unique por vínculo, FKs en cascada), `RelationsRepository`
        (sync reemplaza-set, batchTargets 1-query por página, validación de
        targets vivos en la lista destino del propio tenant). `records.service`
        separa los valores relation del JSONB (create/update/bulk), sincroniza
        en el mismo tx, adjunta `relations` (`f{id}` → ids, prefill `[]`) en
        get/list/update, respeta ACL de campos ocultos y limpia vínculos
        salientes al borrar (targets soft-borrados se filtran al leer). El
        adapter del front traduce las claves a slug (la UI lee
        `record.relations[slug]`). 3 tests nuevos (245 en verde) + E2E.
  - [x] **Portal del cliente completo (v0.1.50)**: el portal del cliente
        renderiza los ~18 tipos de bloque del editor (se restauró
        `PortalRenderer` como componente presentacional puro, montado en el
        SPA con el record traducido a slugs). Endpoints nuevos del portal
        (SessionGuard + vínculo `portal_links`, JAMÁS ids del cliente):
        `GET/POST /portal/me/comments`, `GET /portal/me/activity`,
        `PATCH /portal/me` (whitelist de slugs desde los bloques
        `editable_form` del template — sin template nadie edita; slug fuera
        → 403 explícito), `GET /portal/lists/:slug/records` y
        `.../aggregates` — ambos bajo el **scope del portal** (paridad
        `PortalScopeService`): lista del portal → solo su record; campo
        `user` → filas suyas; campo `relation` hacia la lista del portal →
        filas vinculadas; si no → `false` (fail-closed). Campos ocultos por
        ACL (rol client) filtrados en records y aggregates. `portal/me`
        expone `list_slug`/`user_id` para el boot de los bloques. Fechas de
        los bloques aceptan ISO-Z. 4 tests nuevos (aislamiento por relation,
        whitelist, fail-closed) + E2E en navegador con template completo.
  - [x] **Búsqueda de records server-side (v0.1.51)**: `?search=` en el
        listado de records (`listRecordsQuerySchema`) — OR de ILIKE bindeado
        y escapado sobre los campos searchables (text/long_text/email/url),
        AND con filter_tree y scope ACL; sin campos searchables → `false`.
        En la vista agrupada la búsqueda se compone como subtree `OR
        contains` del filter tree → aplica coherente a buckets, filas y
        agregados. La UI ya era híbrida (client-side si la lista cabe en una
        página; server-side con debounce si no) — solo faltaba el backend.
        Test de search (substring case-insensitive, AND con filtros, escape
        de metacaracteres LIKE).
  - [x] **Menciones (v0.1.52)**: tabla `mentions` (migración 0024, RLS,
        cascada por comment/record/list, índice por usuario). Al crear un
        comentario se extraen los tokens `@login` del body y se matchean
        contra los emails de MIEMBROS del workspace (case-insensitive, sin
        auto-mención, dedupe) → una fila por mencionado con snippet, en el
        mismo tx. `GET /me/mentions?limit=` (SessionGuard+TenantGuard)
        devuelve el shape estilo activity que consume el NotificationBell
        (`changes.snippet` + `created_at`; el "no leído" es client-side por
        localStorage). `CLOUD_WIRED.mentions=true` → la campana aparece y el
        stub del adapter se apaga solo. Test (extracción, self/desconocido
        excluidos, feed por usuario) + E2E por API.
  - [x] **Módulo de archivos propio (v0.1.53, ADR-S16)**: metadata en
        `attachments` (migración 0025, RLS) y bytes detrás de la interfaz
        `FileStorage` con driver local (`UPLOADS_DIR`, claves opacas por
        tenant, guard de path traversal); upgrade S3-prefirmado previsto sin
        tocar callers. Endpoints: `POST /files` (multipart, 20MB default,
        cleanup si truncado), `GET /files?ids=` (batch para tarjetas/
        galerías), `GET /files/:id/download` (stream con tenant check,
        nosniff) y `DELETE /files/:id`. Front: `useAttachments` real,
        `FileFieldControl` (upload + archivo resuelto con link + Quitar) en
        el form completo y el compacto, `FileValueItem` resuelve IDs, covers
        de tarjetas funcionan. Portal: sigue con URLs planas (servir a rol
        client requerirá URLs firmadas — pendiente explícito del ADR).
        3 tests (round-trip, saneo, aislamiento) + E2E API y navegador.
  - [x] **Recurrencias (v0.1.54)**: tabla `recurrences` (migración 0026,
        RLS, unique por record+campo fecha), `DateRoller` port puro (daily/
        weekly/monthly con same_day/first_day/last_day/weekday, yearly con
        29-feb, days_after con seed=now; parse por componentes + Date.UTC,
        preserva hora/formato), CRUD del contrato del fork (GET por record +
        batch `?ids=`, POST upsert, DELETE). Triggers: `status_change`
        (hook post-update de records, @Optional → los specs no se rompen) y
        `schedule` (job repeatable global `recurrences-tick` cada 5 min en
        la cola BullMQ existente; enumeración cross-tenant por conexión base
        y toda lectura/mutación dentro de withTenant). `fire` idempotente
        (last_fired_at), corte por repeat_until, acciones update/clone a
        bajo nivel (tx + activity + realtime + dispatch de automatizaciones,
        sin ciclo de DI). `CLOUD_WIRED.recurrences=true` → la UI del
        DateCellEditor aparece. 14 tests + smoke real.
  - [x] **Campos `computed` (v0.1.54)**: evaluación lazy en CADA lectura
        (create/get/list/update inyectan `data[f{id}]` — jamás se persiste),
        usando el evaluador compartido de `packages/shared` (el mismo que
        puede usar el preview del editor). El FieldConfigEditor del fork ya
        emitía `{operation, inputs, separator}` — ahora el schema del tipo
        lo valida de verdad. Escribirle al computed → 400. Test de
        integración (sum + concat encadenado, re-lectura tras update).

        **Con esto F6 queda completa: paridad funcional total con el
        plugin, más todo lo cloud-only (multi-tenant, billing, plataforma,
        listas públicas, PITR, auto-update).**
  - [x] **Mejoras de archivos (v0.1.55, cierra los pendientes de ADR-S16)**:
        (a) **driver S3-compatible** (`STORAGE_DRIVER=s3` + `S3_*` por env,
        Hetzner/R2/MinIO): `S3FileStorage` con upload multipart streameado
        (`@aws-sdk/lib-storage`) y read lazy — los callers no cambian; test
        real contra MinIO en Testcontainers (skip si la imagen no está).
        (b) **URLs firmadas para el portal**: `GET /files/:id/signed?tenant&
        exp&sig` (HMAC-SHA256 con `FILES_SIGNING_SECRET`, timingSafeEqual,
        404 opaco, TTL 1h) SIN sesión; `portal.me` y el listado de records
        del portal traducen los IDs de campos file a URLs firmadas — el rol
        client ya descarga archivos (pendiente explícito del v0.1.53).
        (c) **Cuota de storage por plan** (`max_storage_mb`, migración 0027,
        null=ilimitado): `assertCanUpload` post-upload con revert (403
        `storage_limit_reached`), uso en `billing summary` (`storage_bytes`)
        y en la consola (columna Storage en Planes editable, fila Storage en
        el detalle de empresa, barra "Almacenamiento" en Ajustes). 7 tests
        nuevos (272 total) + E2E curl (firma válida/mala/expirada/tenant
        ajeno, cuota 0 rebota y revierte) y navegador (3 pantallas).
  - [x] **Pasada premium de UI (v0.1.56, estilo Cloudflare)**: rediseño
        visual sistémico del admin — primary teal profundo (`191 85% 32%`,
        antes cyan neón; dark mode alineado, era índigo), escala de radios
        nítida (sm 3→ 2xl 10px), borders hairline definidos, y se eliminó
        el "confeti": StatTile/Avatar/EmptyState y todos los chips de icono
        de headers ahora NEUTROS (muted+ring; el color queda SOLO para
        semántica: rose/amber en tiles, estados, barras de uso), avatares
        sin hash de colores, logo del sidebar flat (sin gradiente radial),
        títulos de página contenidos (text-2xl→text-xl en las ~12 páginas).
        Sin cambios de backend. Verificado E2E en navegador (login, listas,
        records, Ajustes, Plataforma).
  - [x] **Branding white-label por tenant + permisos finos de dashboards
        (v0.1.57)**: (a) cada empresa personaliza color primario (hex),
        logo (attachment propio, módulo de archivos) y nombre de la app —
        vive en `tenants.settings.branding` (sin migración), GET/PATCH
        `/workspaces/current/branding` (PATCH sólo admin), card "Marca" en
        Ajustes, y el boot del front convierte hex→HSL y re-pinta los
        tokens (`--imcrm-primary`/ring/sidebar-accent) + logo/nombre del
        sidebar; (b) visibilidad POR dashboard (migración 0028):
        `workspace` (default) / `private` (sólo creador) / `roles`
        (lista de roles) — enforcement server-side en list/get/widgets
        (404 opaco) y mutación sólo creador/admin (403); UI: selector en
        crear/editar + badge candado en la grilla (se quitó el checkbox
        vestigial "compartir"). 4 tests nuevos (274 en verde) + E2E en
        navegador (branding aplicado al bootear, card Marca, badge y
        selector).
  - [x] **White-label en portal + listas públicas (v0.1.58)**: el branding
        del tenant llega a las superficies SIN sesión de miembro —
        `portal.me` y `GET /public/lists/:token/meta` exponen `branding`
        (color + app_name + **logo por URL firmada** HMAC, porque ni el rol
        client ni el visitante anónimo pueden usar la descarga con sesión).
        El SPA del portal re-pinta `--imcrm-primary`/ring y muestra
        logo+nombre en el header; la página HTML embebible setea `--accent`
        y muestra el logo junto al título. 2 tests nuevos (275 en verde) +
        E2E navegador (portal y página pública con la marca del tenant).

  - [x] **Pasada ClickUp — Fase 1 (v0.1.59)**: el usuario prefirió el look
        ClickUp sobre el Cloudflare-minimal → (a) sidebar OSCURO en el color
        de marca (teal-tinta, texto claro, activo con velo blanco; el
        white-label re-tiñe el riel con el hue del tenant desde useBranding);
        (b) chips de select/multi_select SÓLIDOS saturados con texto de
        contraste calculado (blanco / tinta en presets claros) — el color
        fuerte vive en los datos; (c) registro abierto estilo tarea ClickUp
        (page + drawer): título grande = campo primario, grilla de metadatos
        con iconos, sección "Campos" colapsable con icono por tipo (mapa
        compartido fieldTypeIcons) y panel derecho de Comentarios/Actividad.
        Layout CRM por template intacto. **Fase 2 (mismo release)**:
        dashboards estilo ClickUp (WidgetHeader compartido con subtítulo
        métrica·lista, "Promedio: N" + línea de referencia punteada en
        bar/line/area, callouts del pie, KPI 26px bold) y Ajustes en DOS
        PANELES (nav izquierda por grupos con gates de rol intactos,
        sección activa en ?s= linkeable, select en mobile).

  - [x] **Rediseño ESTRUCTURAL ClickUp (v0.1.60)**: feedback del usuario —
        la pasada v0.1.59 fue cosmética; lo que define a ClickUp es la
        FORMA. (a) Shell de DOBLE SIDEBAR: riel oscuro de 68px (iconos+
        etiqueta, marca con logo del branding, gates intactos) + panel
        interno claro de 240px con el workspace y el árbol (listas/
        dashboards); el colapso cierra el panel y deja el riel
        (localStorage). (b) Página de records en 3 filas: breadcrumb
        (Listas / nombre + acciones secundarias compactas), TAB BAR de
        vistas guardadas (subrayado primary, "+ Vista") y toolbar (chip de
        vista activa + filtros/columnas/agrupar | búsqueda + Nuevo).
        (c) Tabla agrupada: header de grupo con CHIP del valor (color real
        de la opción) + contador, subtotales por bucket del server,
        add-inline por grupo con PREFILL del valor agrupado
        (RecordCreateDialog.initialValues), y fechas vencidas en rojo
        OPT-IN (`config.highlight_overdue` en date/datetime — schema
        compartido + checkbox en el FieldConfigEditor). Verificado lado a
        lado contra las capturas de ClickUp del usuario.

  - [x] **Refinamiento ClickUp (v0.1.61, feedback directo del usuario)**:
        (a) riel de marca VIVO — el tinte a L=13% era imperceptible; ahora
        branded a L=30% (sat clamp 70) y default teal 26% (el riel ES el
        color del tema, como ClickUp); (b) panel lateral CONTEXTUAL — el
        segundo sidebar cambia según el item del riel (Inicio→listas,
        Dashboards→tableros, Ajustes→secciones vía settingsSections
        compartido con SettingsPage que pierde su nav interna,
        Plataforma→tabs vía ?tab=); (c) área de trabajo PLANA — la tabla
        (plana y agrupada) sin card contenedora, width 100% sin vacío a la
        derecha, headers compactos, hover por fila; (d) registro flotante
        como MODAL GRANDE centrado (min(1150px,94vw)×88vh) de dos columnas
        (contenido + aside 380px de Comentarios/Actividad con composer).
        Verificado en navegador con branding verde aplicado (riel teñido).

  - [x] **Ajuste ClickUp final (v0.1.62)**: fondos INTERCAMBIADOS — panel
        del menú gris claro (canvas, activo blanco+ring) y área de trabajo
        BLANCA (los fondos sticky de las tablas la siguen), como ClickUp; y
        cabecera de records compactada a ~118px (breadcrumb 36px, tabs h-9
        con icono por view_type a 14px, toolbar h-8 con búsqueda que crece
        en focus, acciones secundarias ghost h-7).

  - [x] **Refinamiento ClickUp II (v0.1.63)**: (a) padding del área de
        trabajo a 0.5rem/1rem y topbar+header del panel a 48px (h-12);
        (b) modal del registro con la ESTRUCTURA exacta de la tarea
        ClickUp — barra superior full-width (breadcrumb lista/registro +
        fecha + X al extremo derecho), chip "Registro", Campos SIN caja
        (filas planas con hairlines) y aside de Actividad COLAPSABLE
        (persistido); (c) "Nuevo registro" usa EL MISMO modal (barra +
        chip + filas con icono por tipo + footer Crear), conservando
        prefill por grupo y validación; (d) fix: los widgets del
        dashboard vuelven a ARRASTRARSE/redimensionarse — un wrapper
        imcrm-no-drag cubría toda la tarjeta; ahora el header del widget
        es el asa (draggableHandle) y se agregó el define de
        process.env.NODE_ENV en vite (react-draggable moría con "process
        is not defined"). Verificado E2E (drag real movió el widget).

  - [x] **Recarga automática tras deploy (v0.1.64)**: una pestaña abierta
        durante una auto-actualización pedía chunks con hash viejo → 404
        "Failed to fetch dynamically imported module" (reportado por el
        usuario en Automatizaciones). Ambos SPAs (admin + portal) escuchan
        `vite:preloadError` y recargan UNA vez (guard en sessionStorage,
        rearmado al bootear OK). Los ERR_NETWORK_CHANGED/502 de socket.io
        del mismo reporte eran red del cliente + reinicio del deploy
        (benignos, reconectan solos).

  - [x] **SMTP por empresa + ajustes globales a Plataforma (v0.1.65)**:
        (a) cada workspace puede configurar SU SMTP (white-label de correo):
        vive en `tenants.settings.smtp` con la contraseña cifrada en reposo
        (secret-box SEC-20), endpoints GET/PATCH/DELETE
        `/workspaces/current/smtp` + POST test (solo admin), y MailService
        resuelve el transporte POR MENSAJE: SMTP del tenant → SMTP de
        plataforma → env (cache por hash). El magic link del portal y
        send_email de automatizaciones emiten con tenantId; los correos de
        cuenta (reset/invitaciones de plataforma) siguen por el global.
        Card "Correo (SMTP)" en Ajustes→Workspace. 3 tests (roundtrip sin
        exponer password, cifrado verificado en la fila cruda, pass vacío
        conserva, clear→fallback). (b) Los ajustes GLOBALES (SMTP de
        plataforma y Actualizaciones) se MUDARON de Ajustes a pestañas de
        la consola Plataforma (?tab=correo|updates) — Ajustes queda solo
        con Workspace y Cuenta. E2E curl + navegador en ambas ubicaciones.

  - [x] **Registros DNS del SMTP propio (v0.1.66)**: al habilitar SMTP de
        empresa, el panel le indica al cliente los registros EXACTOS que debe
        crear en su DNS (SPF/DKIM/DMARC) y los VERIFICA en vivo.
        `SmtpDnsService` (mail): catálogo de 7 proveedores conocidos (Google,
        M365, Brevo, SES, Mailgun, SendGrid, Zoho → include SPF + selectores/
        tipo DKIM + guía), `deriveDnsRecords` PURO (SPF exacto o `a:host`
        genérico, DKIM guiado —la clave la genera el proveedor—, DMARC de
        arranque p=none) + verificación contra 1.1.1.1/8.8.8.8 (timeout 2 s,
        1 intento, checks en paralelo; fallo de red = `unknown`, distinto de
        `missing`; DKIM prueba selectores TXT y CNAME Easy-DKIM). Endpoint
        `GET /workspaces/current/smtp/dns` (admin; 404 sin SMTP propio).
        Front: sección "Registros DNS" en el panel SMTP (badges de estado
        ok/parcial/falta/desconocido, host relativo + FQDN, valor copiable,
        "Encontrado: …" para diagnóstico). Schema compartido
        `smtpDnsReportSchema`. 7 tests unitarios (285 en verde) + E2E curl y
        navegador.

  - [x] **Dominio personalizado por tenant (v0.1.67, ADR-S17)**: cierre del
        white-label — cada empresa entra por SU dominio. Dos niveles: (a)
        subdominio automático `slug.PUBLIC_BASE_DOMAIN` (nuevo env; requiere
        DNS wildcard) y (b) dominio propio en `tenants.custom_domain`
        (migración 0029, UNIQUE global). `DomainsModule`: `resolveHost`
        (Host→tenant, sin sesión, ignora archivados), `GET /public/boot`
        (marca del tenant del Host — color/logo firmado/app_name — para
        pintar el LOGIN antes de autenticarse), `GET /public/domains/check`
        (el `ask` del `on_demand_tls` de Caddy: solo emite certs de dominios
        registrados), `GET/PATCH/DELETE /workspaces/current/domain` +
        `/domain/dns` (verificación CNAME en vivo; apex sin CNAME → compara
        A/IPs; mismo patrón unknown≠missing del SMTP), y `baseUrlFor` → los
        magic links del portal salen por el dominio del tenant. Reservados:
        la base y sus subdominios (400) + unicidad (409). Caddyfile
        reescrito: snippet común + bloque `https://` con `tls on_demand`
        gateado por el ask. Front: boot pre-login (publicBoot pinta tokens +
        logo/nombre en Login, workspace fijado al tenant del dominio) + card
        "Dominio personalizado" en Ajustes→Marca (subdominio copiable,
        CNAME exacto + verificación con badges). ADR-S17 en STANDALONE.md.
        7 tests nuevos + E2E curl (boot por dominio/subdominio, ask 200/404,
        reservados) y navegador.

  - [x] **Fix triple de filtros/vistas + scroll único (v0.1.68, reporte
        del usuario)**: (1) **los filtros de la tabla NO filtraban
        server-side**: el listado de records leía el árbol del query param
        `filter` mientras el front (y grouped-bundle/aggregates) usan
        `filter_tree` → se descartaba en silencio; además el front mandaba
        los árboles AND planos en formato WP `filter[field][op]` que el
        API tampoco entiende. Fix: el controller acepta `filter_tree`
        (+alias `filter`) y `buildRecordsQuery`/GroupedTableView mandan
        SIEMPRE `filter_tree` JSON. (2) **"Cambios sin guardar" eterno**
        en vistas guardadas: la comparación dirty usaba JSON.stringify
        crudo (JSONB reordena claves → dirty perpetuo con cualquier
        filtro) y omitía column_order/collapsed_groups/footer_aggregates
        del lado guardado. Fix: canonicalización por round-trip
        (config→estado→config) + stringify de claves ordenadas.
        (3) **doble scrollbar vertical**: la tabla usaba
        `max-h-[calc(100vh-220px)]` aproximado → barra de la tabla + barra
        del main. Fix: layout de alto exacto (wrapper del Outlet h-full,
        página h-full flex-col, contenedor de tabla flex-1 min-h-0) — UNA
        sola barra, paginación fija abajo; kanban/cards/calendario
        conservan scroll de página. Primeros tests del front (vitest.config
        + 5 specs de savedViewMapping) + 4 specs de parseListQuery.
        Verificado E2E en navegador (vista aplicada 11/67 filas, filtro en
        vivo 2/67, dirty se limpia al guardar y tras reload, main sin
        scroll).

  - [x] **Fix: columnas ocultas/anchos/búsqueda no persistían en vistas
        (v0.1.69, reporte del usuario)**: `tableViewConfigSchema` en shared
        whitelisteaba el shape del shell cloud VIEJO (`visible_field_ids`,
        `column_sizing`, `column_order` numérico) → Zod descartaba en
        silencio las claves que el fork realmente guarda (`hidden_columns`,
        `column_widths`, `search`, `filters`, column ids string de TanStack):
        ocultar columnas funcionaba en vivo pero se perdía al guardar la
        vista. Fix: `viewStateCommon` con el shape real (column ids string;
        coerce para column_order numérico legacy) mergeado en los 4 schemas
        de vista (table/kanban/calendar/cards conservan filtros+búsqueda+
        columnas; claves legacy conservadas). 3 tests de `parseViewConfig`
        + E2E navegador (ocultar Ciudad → guardar → reload → sigue oculta,
        dirty limpio).

  - [x] **Scroll de página única (v0.1.70, pedido del usuario)**: el capado
        tipo ClickUp de v0.1.68 (tabla con scroll vertical propio) no era lo
        que el usuario quería — pidió UNA sola barra, la del borde derecho
        de la ventana. Ahora la tabla (plana y agrupada) crece a su alto
        natural y el único scroll vertical es el del `<main>` del shell;
        dentro del wrapper de la tabla queda SOLO el horizontal
        (`overflow-x-auto`). Se revirtieron los `h-full`/`flex-1`/`min-h-0`
        de RecordsPage/TableView/GroupedTableView/AdminShell. E2E navegador:
        auditoría de scrollers = solo `imcrm-main`, scroll hasta la última
        fila + footer.

  - [x] **Selects de la tabla estilo ClickUp (v0.1.71, reporte del
        usuario)**: (1) chips de select/multi_select SIN el punto de color
        a la izquierda (el chip sólido ya ES el color — el punto duplicaba
        y desperdiciaba ancho); (2) select/multi_select en la celda son
        ahora POPOVER DIRECTO — un solo click abre las opciones (antes:
        doble click); (3) se eliminó el modo edición "encajonado" para
        selects (el input con borde que quedaba PEGADO si cerrabas el
        popover sin elegir y solo se iba recargando) — ya no existe ese
        estado; (4) multi_select deja marcar VARIAS opciones: el popover
        queda abierto entre toggles (antes el commit desmontaba el editor
        y se cerraba tras la 1ª). `OptionPicker` ganó `variant="cell"`
        (trigger plano estilo celda, stopPropagation para no abrir el
        modal del registro) y `EditableCell` lo monta en modo lectura para
        esos tipos. Verificado E2E en navegador (8 checks: click único,
        chips sin dot, sin caja residual, multi 2 opciones sin cerrar,
        persistencia tras reload).

  - [x] **Selects de celda sin × (v0.1.73, feedback del usuario)**: la ×
        de limpiar a la derecha del chip robaba ancho de celda — se quitó
        en `variant="cell"` (en forms se conserva). Para limpiar, clickear
        la opción YA seleccionada en el popover la des-selecciona (toggle,
        estilo ClickUp). E2E navegador (sin ×, toggle-off limpia,
        re-selección OK, form conserva la ×).

  - [x] **Campos ClickUp-style + picker con entrada manual (v0.1.74,
        feedback del usuario con capturas)**: (a) el date picker gana un
        INPUT MANUAL arriba del calendario (AAAA-MM-DD / DD/MM/AAAA /
        DD/MM/AA, Enter commitea, inválida = borde rojo) y se arregló el
        popover de 445px fijos que RECORTABA la flecha de "mes siguiente"
        (ahora w-auto); (b) los campos se CREAN SIN SALIR de la tabla:
        `FieldCreateDialog` de dos pasos (catálogo de tipos buscable con
        icono+descripción estilo ClickUp → form con FieldConfigEditor +
        Obligatorio), abierto por "+ Agregar columna"; (c) menú contextual
        por columna (`FieldHeaderMenu`, tabla plana y agrupada, gate
        manage_lists): Modificar / Cambiar el nombre / Duplicar / Copiar
        ID de campo / Eliminar ("Convertir" tipo queda fuera — migración
        de datos); (d) UN click para editar CUALQUIER tipo inline (antes
        doble click; fechas/selects ya lo tenían); (e) la × de limpiar se
        quitó de TODAS las superficies del OptionPicker — el toggle de la
        opción seleccionada en el popover la reemplaza; (f) fix: el header
        de columnas angostas desbordaba y el menú quedaba bajo el th
        vecino (min-w-0 + truncate). E2E navegador (crear campo Número →
        renombrar → eliminar por menú, click único en texto, cero ×,
        input manual de fecha, chevrons visibles). Tipos nuevos (teléfono/
        progreso/calificación…) quedan como candidato a release aparte.

  - [x] **Acceso al portal en el layout lista + fix de comentarios
        (v0.1.77, reporte del usuario)**: el `PortalAccessButton` (emisión
        de magic link al cliente) solo se montaba en el layout CRM por
        plantilla — en la vista individual y el modal del registro con
        apariencia de lista había desaparecido. Se monta bajo la sección
        Campos en `RecordPage` y `RecordDetailDrawer` (auto-oculto si la
        lista no tiene portal habilitado). De paso: un comentario con body
        indefinido tiraba TypeError y volteaba la página completa del
        registro — `CommentContent` blindado. E2E navegador (botón visible
        en página y modal, 0 crashes).

  - [x] **Sort server-side + menú por click derecho (v0.1.76, reporte
        del usuario)**: (a) ordenar por columna POR FIN funciona — el
        listado de records ignoraba `sort=field_{id}:{dir}` (solo ordenaba
        por id; el front lo mandaba desde siempre). Ahora: ORDER BY con
        expresiones JSONB tipadas whitelisted (regla de oro nº 4), NULLS
        LAST, multi-columna por coma, id tiebreaker; con sort por campo la
        paginación pasa a OFFSET (el cursor se reinterpreta, opaco para el
        cliente). (b) click DERECHO sobre el header abre el menú contextual
        de la columna (dispara pointerdown — Radix no abre con click
        programático), en plana y agrupada. (c) fix: el header agrupado
        desbordaba en columnas angostas y el chevron quedaba solapado con
        el "+" (overflow-hidden + min-w-0/truncate). 2 tests de
        integración del sort + E2E navegador (asc 100 / desc 6000, click
        derecho en ambas vistas, chevron sin overlap).

  - [x] **Scrollbar horizontal fija + paridad del agrupado (v0.1.75,
        reporte del usuario)**: (a) `StickyHScrollbar` compartido — barra
        espejo `sticky bottom-0` sincronizada bidireccional con el
        scroller real: el scroll horizontal queda SIEMPRE visible al
        fondo de la PANTALLA (estilo ClickUp), no al fondo de la tabla;
        montada en tabla plana y agrupada. (b) Vista agrupada: RESIZE de
        columnas por drag del borde del th (ancho compartido entre
        grupos, persiste en la vista) y "+ Agregar columna" en TODOS los
        grupos. El menú contextual del header ya estaba en ambas vistas
        (v0.1.74) — el reporte "no quedó" era bundle previo al update.
        E2E navegador (barra visible en viewport y sincronizada, resize
        70→188px, 3 botones "+", 24 triggers de menú en agrupada).

  - [x] **Date picker + recurrencias en TODAS las superficies (v0.1.72,
        reporte del usuario)**: el `DateCellEditor` (calendario ClickUp +
        atajos + sección "Recurrente") solo vivía en las celdas de la
        tabla — el modal del registro, la página del registro, el layout
        CRM y el form de creación usaban `<input type=date>` nativo.
        Ahora `recordId` es OPCIONAL en DateCellEditor (sin record —
        creación — se oculta solo la sección de recurrencia) y los campos
        date/datetime de `CompactFieldRow` (control inline, un click) y
        `RecordFieldsForm` (trigger estilo input) montan el picker,
        con `recordId` roscado desde drawer/página/BlockRenderer (el
        diálogo de creación no lo pasa). Los casos nativos muertos se
        eliminaron. Verificado E2E en navegador (modal: calendario +
        "Hacer recurrente"; creación: calendario sin recurrencia).

  - [x] **Decimales configurados respetados en campos de valor (v0.1.78,
        reporte del usuario)**: los campos currency/number mostraban
        "1,032,000.00" aunque el usuario configurara 0 decimales — la clave
        canónica es `config.precision` (la que escribe el FieldConfigEditor y
        valida el schema compartido) pero cada superficie leía
        `config.decimals` (que Zod ni deja persistir) o cableaba 2. Fix:
        helper compartido `lib/fieldNumberFormat` (`fieldPrecision` con
        defaults currency 2 / number 0 + `formatFieldNumber`: currency con
        decimales FIJOS, number hasta `precision` sin ceros de relleno)
        aplicado en renderCellValue (tabla/kanban/tarjetas — number además
        gana separador de miles), FieldValueDisplay (modal/página/CRM),
        RightRail (stats), FooterAggregateCell (counts SIEMPRE enteros; sum/
        min/max/range con la precisión del campo, avg hasta 2 extra),
        TableWidget del dashboard y ClientDataBlock del portal. 6 tests
        unitarios del helper (front) + E2E navegador (currency precision 0 →
        "1,032,000" sin decimales en tabla y modal).

  - [x] **Facturación recurrente robusta (v0.1.79, caso de uso del usuario:
        CRM de facturación)**: (a) la recurrencia con acción **clone** ahora
        RE-ANCLA la recurrencia al clon (el que tiene la fecha rodada) — antes
        disparaba una vez y la serie moría (el original quedaba dormido y el
        clon nacía sin recurrencia); test de cadena (2 fires → 3 records).
        (b) La acción **create_record** del motor quedó de primera clase:
        resuelve slugs contra la lista DESTINO (antes contra la del trigger —
        cross-list roto salvo con f{id}), valida/coerciona cada valor con
        `validateFieldValue` compartido ("{{monto}}" → número real; inválidos
        se saltan con nota en el log, tolerante), soporta campos **relation**
        (`{{record.id}}` vincula la factura al cliente; targets verificados
        vivos con existingInList, sync en el mismo tx) y saltea computed.
        (c) Editor VISUAL de "Crear un registro" en el AutomationDialog
        (Formulario y Diagrama): selector de lista destino + filas campo→valor
        con MergeTagInput del trigger y dropdown de opciones para selects —
        reemplaza el JSON crudo. Receta documentada: lista Clientes con fecha
        recurrente mensual (action update) + automatización record_updated
        (changed_fields: fecha) → create_record en Facturas con estado
        pendiente. 302 tests API + E2E completo (tick real de recurrencias
        rodó la fecha, la automatización creó la factura pendiente vinculada,
        editor verificado en navegador).

  - [x] **Merge tag `{{before.slug}}` — el período de la factura (v0.1.80,
        pregunta del usuario)**: al dispararse la automatización de
        facturación, la fecha del cliente YA rodó al mes siguiente →
        `{{proximo_cobro}}` daba el período equivocado. El accessor del motor
        ahora resuelve `{{before.slug}}` (valor ANTERIOR al cambio, del
        `ctx.before` de los triggers de update) — mapear un campo "período"
        de Facturas a `{{before.proximo_cobro}}` estampa la fecha exacta que
        venció. Además `{{date.now}}`/`{{date.today}}` se resuelven de verdad
        (naive UTC; antes eran tags del picker que el backend ignoraba → '')
        y se removieron del picker los tags de sistema MUERTOS
        (record.created_at/updated_at/created_by, user.*, signature — jamás
        se resolvieron); sección nueva "Valor anterior" con `before.{slug}`
        por campo. Test (before + date.today en create_record) + verificación
        en vivo (roll de fecha → factura con periodo = fecha anterior).

  - [x] **Importar a una lista SIN campos (v0.1.81, reporte del usuario)**:
        crear una lista desde un Excel/CSV estaba bloqueado — el botón
        Importar estaba `disabled` sin campos y, peor, el `ImportDialog` solo
        se montaba en la rama "hay campos" (el empty state no lo renderizaba
        → click sin efecto), pese a que el diálogo YA crea campos on-the-fly.
        Fix: (a) ImportDialog montado incondicionalmente + botón Importar sin
        gate (desktop y mobile); (b) el empty state ofrece "Importar CSV /
        Excel" como acción primaria junto a "Configurar campos"; (c) con
        lista vacía, el paso de mapeo PRE-MARCA todas las columnas como
        "Crear campo nuevo" (label = cabecera, tipo = detectado) — antes
        había que elegirlo columna por columna; (d) fix de invalidación:
        el import invalidaba `fieldsKeys.forList(listId)` pero RecordsPage
        monta `useFields(listSlug)` → el empty state quedaba congelado tras
        importar; ahora usa `invalidateForList` (id↔slug, regla de oro nº 7).
        E2E navegador (lista vacía → CSV 4 columnas → 4 campos + 3 registros
        → tabla renderiza al toque).

  - [x] **Fix doble scrollbar horizontal (v0.1.82, reporte del usuario)**:
        al llegar al fondo de la tabla se veían DOS barras horizontales
        apiladas — la StickyHScrollbar (espejo fijo de v0.1.75) MÁS la
        nativa del wrapper `overflow-x-auto`, que entra al viewport justo
        al final de la tabla (mismo thumb, sincronizadas). Fix: clase
        `imcrm-native-hscroll-hidden` (`scrollbar-width: none` +
        `::-webkit-scrollbar { display: none }`) en los scrollers de
        TableView y GroupedTableView — el espejo queda como ÚNICA barra;
        rueda/trackpad/touch siguen scrolleando igual. E2E navegador
        (overflow real, nativa oculta, 1 solo espejo sticky, sync
        espejo→tabla).

  - [x] **Recurrencias en vivo: icono + "No repetir" (v0.1.83, reporte del
        usuario)**: el icono de recurrente solo aparecía tras RECARGAR y no
        se veía cómo quitar la recurrencia. Causa raíz única: las mutaciones
        (`useUpsertRecurrence`/`useDeleteRecurrence`) invalidaban solo la
        query individual `forRecord`, pero las celdas de la tabla leen del
        BATCH (`RecurrencesBatchProvider`) que nunca se invalidaba → icono
        congelado, y al reabrir el popover el panel creía que no había
        recurrencia (mostraba "Hacer recurrente"/Cancelar en vez del resumen
        + el botón "No repetir", que ya existía). Fix: prefijo
        `keys.forList(listId)` en la invalidación (cubre forRecord + todas
        las batch de la lista). E2E navegador (guardar → icono aparece SIN
        reload → reabrir muestra resumen + "No repetir" → quitar → icono
        desaparece sin reload).

  - [x] **Variables en campos numéricos/fecha del mapeo de automatizaciones
        (v0.1.84, reporte del usuario)**: en "Crear un registro" (y
        "Actualizar campo") no se podían mapear variables a campos
        moneda/número ni fecha — `FieldValueInput` renderizaba inputs
        TIPADOS (`type=number` "0.00", `type=date` dd/mm/aaaa) que no
        aceptan ni muestran merge tags → imposible `monto =
        {{monto_mensual}}` o `periodo = {{before.proximo_cobro}}` (el caso
        central de la facturación). Fix: date/datetime/number/currency usan
        `MergeTagInput` con placeholder del formato esperado ("AAAA-MM-DD o
        {{campo}}", "0 o {{campo}}"); un valor fijo se tipea a mano y el
        backend valida/coerciona con el schema del campo destino. E2E
        navegador (la automatización sembrada muestra {{monto_mensual}} y
        {{before.proximo_cobro}} en sus filas — antes esos inputs se veían
        vacíos).

  - [x] **Lote de 7 reportes del usuario (v0.1.85)**: (1) **conversión de
        tipo de campo** — el FieldDialog del List Builder siempre mandó
        `type` pero `updateFieldSchema` lo descartaba en silencio ("guardo y
        guardo y queda igual"); ahora el schema lo acepta y `FieldsService`
        convierte con MIGRACIÓN de datos por lotes en la misma tx (puente de
        coerción + `validateFieldValue` del tipo destino; inválidos se
        limpian; a select/multi_select sin options se AUTO-GENERAN de los
        valores distintos; computed/relation/file → 400; índices de
        expresión recreados). (2) **500 al eliminar listas** — `records.
        list_id` y `public_lists.list_id` eran los únicos FKs sin ON DELETE
        CASCADE (migración 0030). (3) **dropdown de filtros se cerraba en
        ms** — el AutocompleteInput usaba un Popover de Radix ANIDADO dentro
        del popover del panel de Filtros (capas que se auto-descartan);
        ahora es un div absoluto sin portal. (4) **la página de
        automatizaciones no refrescaba sin recargar** — `automationsKeys.
        forList` tenía un segmento 'list' extra (id en índice 2;
        `invalidateForList` matchea índice 1 — misma clase de bug que
        fieldsKeys). (5) **logo white-label roto** — el branding devolvía
        `/files/:id/download` (exige header X-Tenant-Id que un `<img>` no
        manda); ahora URL FIRMADA (TTL 24h). (6) riel "Inicio" → "Listas".
        (7) **layout del mapeo de "Crear un registro"/"Actualizar campo"** —
        filas en tarjeta (selector+eliminar arriba, valor a ancho completo
        abajo) en vez del flex en línea que se desarmaba en el panel del
        Diagrama. Tests: conversión (options auto + coerción + 400),
        cascade del delete, branding firmado. E2E navegador consolidado.

  - [x] **Aritmética de fechas en merge tags (v0.1.86, caso del usuario:
        períodos anticipado/vencido)**: clientes que pagan mes ANTICIPADO
        (16/07→15/08) y mes VENCIDO (16/06→15/07) en la misma facturación.
        `applyMergeTags` acepta modificadores encadenables de fecha —
        `{{campo|+1m|-1d}}` (unidades d/m/y; meses con CLAMP al último día:
        31/01+1m→28/02; cruces de año; datetime preserva la hora; valores
        no-fecha los ignoran). Receta: campo `modalidad` (select) en
        Clientes + UNA automatización con DOS acciones create_record
        condicionadas POR ACCIÓN (feature existente): anticipado ⇒ desde
        `{{before.proximo_cobro}}` hasta `{{before.proximo_cobro|+1m|-1d}}`;
        vencido ⇒ desde `{{before.proximo_cobro|-1m}}` hasta
        `{{before.proximo_cobro|-1d}}`. 4 tests unitarios (merge-tags.spec)
        + tip de sintaxis en el editor de "Crear un registro".

  - [x] **Fix "Datos inválidos" al guardar condiciones de automatización
        (v0.1.87, reporte del usuario)**: la receta anticipado/vencido no se
        podía guardar — `conditionRuleSchema` exigía `field` pero el
        `ConditionEditor` del fork emite `{slug, op, value}` (el evaluador
        del motor acepta AMBOS desde siempre; solo la capa Zod del
        controller rechazaba con 400). Fix: el schema acepta `field` O
        `slug` (refine: al menos uno no vacío). Además el diálogo ahora
        muestra el DETALLE de los errores Zod en el banner — los paths
        anidados (`actions.0.condition.0`) no matchean ningún FieldGroup y
        el usuario solo veía "Datos inválidos" sin saber qué corregir.
        3 asserts de schema + test del motor (condición por acción en shape
        slug filtra de verdad) + E2E navegador (agregar condición desde la
        UI → guardar sin 400).

  - [x] **Condición visible al reabrir + uploads persistentes (v0.1.88,
        reportes del usuario)**: (1) la condición por acción se guardaba
        (v0.1.87) pero al REABRIR el diálogo aparecía vacía — `fromAutomation`
        reconstruía las actions solo con `{type, config}`, descartando
        `condition` (y un re-guardado la BORRABA de la DB en silencio); el
        round-trip del backend estaba intacto (verificado por API). (2) El
        logo del white-label "se rompe en cada actualización": el default de
        `UPLOADS_DIR` (`./data/uploads`) es RELATIVO al release activo
        (`current/apps/api`) → cada auto-update dejaba los archivos subidos
        atrás y la poda de releases los borraba; encima, los bytes perdidos
        colgaban la request hasta el 504 del proxy (stream que falla tras
        los headers). Fix: `deploy.sh` crea `shared/uploads` + RESCATE
        best-effort de uploads en releases anteriores + symlink
        `data/uploads → shared/uploads` en cada release (self-heal en el
        próximo update, sin tocar el env); `FileStorage.probe` (stat) → 404
        opaco RÁPIDO cuando faltan los bytes; `streamFile` con guard
        (destroy de la conexión si el stream falla a mitad de respuesta).
        Tests (bytes perdidos → 404) + E2E navegador (condición visible al
        reabrir, logo firmado 200, bytes borrados → 404 en ms).

  - [x] **Secuencia de mora por fecha límite (v0.1.89, caso del usuario:
        correos a los 0/20/45/70 días si la factura sigue pendiente)**: tres
        gaps del trigger `due_date_reached`: (a) `resolveDateFieldId` no leía
        `due_field` — la clave que escribe el `DueDateConfig` de la UI — así
        que una automatización configurada desde la interfaz JAMÁS disparaba;
        (b) `runDueDate` no evaluaba los `field_filters` del trigger al
        disparar (solo `process()` los chequeaba) → imposible "recordar SI
        sigue pendiente"; ahora se evalúan por record en el scan, y un record
        filtrado NO registra run (si vuelve a cumplir, dispara); (c) el
        offset personalizado de la UI pasó de minutos a DÍAS (20/45/70).
        Test del flujo exacto (due_field por slug + offset 20d + filtro
        estado: impaga dispara, pagada no y sin run, reciente fuera de
        ventana). Receta: 4 automatizaciones en Facturas — record_created →
        email de emisión; due_date_reached sobre fecha de emisión con
        offsets 20/45/70 días + filtro estado=pendiente → recordatorios.

  - [x] **Rediseño premium del módulo de automatizaciones (v0.1.90, pedido
        del usuario)**: se ELIMINÓ el modal `AutomationDialog` y el canvas
        React Flow (`AutomationVisualBuilder`, dep `@xyflow/react` fuera del
        bundle) — el usuario reportó doble scroll, selección obsoleta y que
        el modo visual no aportaba si todo se editaba en el sidebar. Ahora:
        (a) **editor a página completa** (`/lists/:slug/automations/new|:id`,
        `AutomationEditorPage`) con nombre/descripción inline en el header,
        toggle Activa/Pausada tipo switch, Historial (runs drawer) y Guardar
        con detalle de errores Zod + aviso beforeunload si hay cambios; (b)
        **flujo VERTICAL estilo Zapier**: tarjeta "Cuando" (trigger) →
        conector con "+" para insertar en posición → una tarjeta por acción,
        cada una editable EN EL LUGAR (colapsada = resumen en lenguaje humano,
        expandida = su config), con subir/bajar/duplicar/eliminar y badge de
        condiciones; menú de tipos de acción con icono+descripción; un solo
        scroll (el de la página); (c) **lenguaje humano** (`automationMeta`):
        resúmenes tipo "Cuando cambia «Próximo cobro»" / "Crea un registro en
        «Facturas» · 5 valores" en editor e índice; (d) **índice premium**:
        tarjetas con el flujo resumido (chips trigger → acciones), switch de
        estado, historial y eliminar; crear/editar navega a la página. Los
        editores de config se extrajeron a `config-editors.tsx` (mismos
        merge tags, condición por acción, if_else anidado — round-trip
        intacto). E2E navegador 19/19 (índice, editor sin modal, expansión
        in-place, condición previa visible, scroll único, alta end-to-end
        persistida por API).

  - [x] **Lienzo visual de automatizaciones estilo n8n/Make (v0.1.91,
        feedback del usuario)**: el flujo vertical de v0.1.90 escondía las
        ramas — segunda vista "Lienzo" del editor (toggle Flujo/Lienzo en el
        header, persistido en localStorage, code-split). Canvas PROPIO sin
        React Flow: **auto-layout de árbol** (`buildLayout` recursivo — un
        `if_else` abre columnas Sí/No en PARALELO con etiquetas de rama,
        anidable hasta 4 niveles, y las ramas CONVERGEN en el siguiente paso,
        fiel al motor), sin nodos que arrastrar ni desalinear; **pan** (drag/
        rueda) + **zoom** (Ctrl+rueda hacia el cursor, botones ±/fit, %
        visible) — cero scroll anidado; **"+" sobre cada conexión** inserta
        una acción en esa posición exacta (incluidas ramas; ghost "Añadir" en
        ramas vacías y al final); click en un nodo → **Sheet lateral** con SU
        config (trigger completo; if_else = solo la condición, las ramas se
        editan en el lienzo; resto = ActionConfigEditor); toolbar hover
        (duplicar/eliminar); la selección se limpia si el nodo desaparece
        (fix del "selección obsoleta" del canvas viejo). `actionsTree.ts`:
        helpers inmutables de paths anidados (`[2,'then',0]`) con 5 tests.
        `ActionTypeMenu` extraído y compartido con el flujo vertical. E2E
        navegador 18/18 (ramas en paralelo con Sí/No, añadir a rama vacía,
        editar condición por panel, round-trip API intacto, modo persistido).

  - [x] **Fix bloqueos del panel del lienzo (v0.1.92, reporte del
        usuario)**: en el canvas v0.1.91 los botones del panel de nodo
        (cerrar, chips de variables, popover "+N", algunos selects) no
        respondían. Causa: el Sheet vivía DENTRO del contenedor del lienzo
        en el árbol de React — los portales de Radix mueven el DOM pero los
        eventos burbujean por el ÁRBOL DE COMPONENTES, así que cada
        pointerdown dentro del panel llegaba al handler de paneo, cuyo
        `setPointerCapture` sobre el contenedor le robaba el pointerup al
        botón (el click jamás se completaba; los menús "+" se salvaban por
        el stopPropagation de sus wrappers). Fix doble: el Sheet es HERMANO
        del contenedor (fragment) y el handler de paneo ignora eventos cuyo
        target no está contenido en el DOM del contenedor. E2E 12/12 (chips
        insertan, popover abre/inserta, select cambia tipo, X cierra, body
        sin pointer-events residual, pan +100px exacto, reapertura).

  - [x] **Editores de plantilla nivel page-builder (v0.1.93, pedido del
        usuario: "solo edita bordecitos, se siente capado")**: capa de
        ESTILO universal para los dos editores (ficha del registro +
        portal del cliente). (a) `lib/blockStyle.ts` — `config.style`
        declarativo por bloque (fondo/texto/borde hex, relleno, esquinas,
        sombra, alineación; defaults amables: fondo sin padding elegido →
        md) interpretado por LA MISMA función en el canvas del editor, la
        ficha real (`RecordCrmLayout`) y el portal (`PortalRenderer`,
        top-level y anidados) — WYSIWYG por construcción; (b) sección
        **"Diseño"** en el inspector para CUALQUIER bloque de ambos
        registries (`BlockStyleEditor` en el core: swatches curados + hex
        libre + segmentados + alineación + restablecer); (c) **fondo de
        sección y de columna** (`secBg`/`colBg`, mismo mecanismo que el
        spacing) editable desde el popover de estilo de sección/columna
        del canvas y aplicado en las 3 superficies; (d) **bloque IMAGEN**
        en ambos editores (`ImageBlockForm` compartido: subir al módulo
        de archivos o URL externa, alt, alto, ajuste cover/contain,
        enlace): en el admin se sirve por la descarga con sesión (mismo
        camino que los covers), y en el portal `portal.me` inyecta la
        **URL FIRMADA** (TTL 24h) recorriendo el template incluso dentro
        de `nested_section` (el rol client no puede usar la descarga).
        Tests: 4 unit de blockStyle (front 20 en verde) + spec del portal
        con firma de imágenes anidadas (API 312 en verde). E2E navegador
        9/9 (imagen por URL renderiza en canvas, fondo aplicado EN VIVO,
        persistencia con style.bg, y la ficha real del registro renderiza
        la imagen con su fondo — WYSIWYG verificado).

  - [x] **Page-builder completo (v0.1.94, "haslos todos")**: los 5
        pendientes del análisis v0.1.93. (a) **Tipografía por bloque** —
        `style.size` (12-28px) + `style.weight` en la capa de estilo,
        segmentados A⁻…A³ y Fino…Bold en el panel Diseño; (b) **ajustes de
        página del portal** — popover "Página" en la toolbar del editor
        (fondo, ancho máximo, tipografía global con stacks de sistema),
        persisten en `portal_template.page`, `portal.me` los expone como
        `template_page` y el SPA los aplica (fondo del body, max-width del
        contenido, font-family); (c) **presets de estilo de marca** —
        `tenants.settings.style_presets` con GET/PATCH
        `/workspaces/current/style-presets` (PATCH admin/manager, schema en
        shared), fila "Presets" en el panel Diseño (5 built-ins + guardar
        el estilo actual con nombre + borrar; chips pintados con su propio
        estilo); (d) **bloques espaciador y galería** en AMBOS editores
        (forms compartidos en el core; galería 2-4 columnas con
        subir/URL por imagen; el portal firma cada imagen subida de la
        galería igual que el bloque imagen); (e) **duplicar sección
        completa** — botón en el header de sección del canvas (columnas +
        bloques con ids nuevos, insertada debajo). Tests: 2 unit nuevos de
        blockStyle (front 22), spec de presets + spec de galería/página en
        portal (API 314 en verde). E2E navegador 11/11.

  - [x] **Fix estilos en bloques con tarjeta (v0.1.95, reporte del
        usuario con captura)**: el fondo del panel Diseño dejaba la
        TARJETA BLANCA propia del bloque encima (client_data, texto, etc.
        pintan con `hsl(var(--imcrm-card))`) y la tipografía no hacía nada
        (los bloques traen tamaños en px). Fix: (a) `blockStyleCss`
        RE-TIÑE los tokens del tema localmente — `--imcrm-card`/`--imcrm-
        muted`/`--imcrm-border` con el fondo elegido (hex→HSL; sin borde
        explícito los hairlines se funden) y los foregrounds con el color
        de texto → la tarjeta del bloque ADOPTA el color en las 3
        superficies; (b) clases `imcrm-style-fs`/`imcrm-style-fw` en el
        wrapper + reglas CSS `:where(...) !important` que fuerzan la
        herencia tipográfica conservando jerarquía relativa (h1 1.7em,
        títulos 1.2em, labels 0.78em, cifras KPI 1.9em) — OJO: el selector
        NO incluye al wrapper mismo (se pisaba su propio font-size inline).
        3 tests unit nuevos (front 24) + E2E navegador (client_data azul
        sin tarjeta blanca, título blanco 26.4px).

  - [x] **Preview del editor sin chrome de edición (v0.1.96, reporte del
        usuario con captura)**: el modo Preview mostraba "líneas y bordes
        que no aparecen en el panel real" — la tarjeta con borde de cada
        sección, el borde PUNTEADO de cada columna, el ring hairline +
        fondo de tarjeta de cada bloque, el label "Sub-sección" (visible
        incluso en preview) y el tinte del lienzo eran chrome del EDITOR
        que seguía dibujándose. Ahora en preview: sección y columna usan
        el MISMO `wrapperStyleCss` que la ficha real y el portal (solo
        fondo/spacing elegidos), los bloques se renderizan sin
        ring/tarjeta, el nested_section pierde header y punteados, y el
        lienzo aplica los AJUSTES DE PÁGINA del portal (fondo, ancho
        máximo centrado, tipografía — prop `previewPage` del shell) que
        antes solo se veían en el portal publicado. E2E navegador 6/6
        (editor con chrome=control, preview cero dashed/labels/bordes,
        fondo de página aplicado).

- [x] **F7 — Dashboards premium** (plan acordado con el usuario: motor
      honesto → look premium → widgets nuevos → interactividad; el grid
      sigue en react-grid-layout — física correcta para tableros — y se
      COMPARTEN las piezas del editor de plantillas: blockStyle/presets/
      bloques de contenido/preview):
  - [x] **Fase 1 — Motor honesto de widgets (v0.1.97)**: cuatro funciones
        que la UI del fork ofrecía pero el backend cloud nunca implementó
        (mostraban datos INCORRECTOS): (a) el **período relativo** del
        widget (`config.period {field_id, preset}`) ahora filtra de
        verdad — se inyecta como condición `between_relative` en AND con
        el filter_tree en cada evaluación (preset inválido se ignora, no
        rompe el bundle); (b) **stat_delta real**: `AggregateService.
        runDelta` evalúa la métrica sobre dos ventanas consecutivas de
        `period_days` días ancladas a hoy (naive-UTC) sobre el campo de
        fecha → value/previous/delta_pct reales (antes: previous=value,
        delta=0 cableado); (c) el **widget de tabla** devuelve
        columns/rows REALES vía `RecordsService.list` (ACL del viewer:
        scope por rol + campos ocultos stripped), columnas visibles
        configuradas (o todas, cap 8), orden `field_{id}:{dir}`, límite
        1-50, filas `f{id}`→slug (antes: `{columns:[],rows:[]}` stub);
        (d) **bucketing temporal**: `time_bucket` (day/week/month/
        quarter/year, schema compartido nuevo) agrupa charts de fecha
        por `date_trunc` con labels ordenables (`2026-07`, `2026-W30`,
        `2026-Q3`) — line/area defaultean month (antes: un punto por
        fecha cruda). 5 tests de integración nuevos (324 en verde) +
        E2E API 8/8 contra datos reales.

  - [x] **Fase 2 — Look premium de dashboards (v0.1.98)**: (a) **capa de
        estilo por widget** — `config.style` (la MISMA de los editores de
        plantillas: fondo/texto/borde/relleno/esquinas/sombra/tipografía +
        presets de marca + re-tinte de tokens v0.1.95) aplicada al card por
        `DashboardPage` y editable en la sección "Diseño" del
        WidgetFormDialog (todos los tipos); sin estilo, la tarjeta default
        no cambia; (b) **bloques de CONTENIDO** (heading con subtítulo,
        texto multilínea, imagen — `ImageBlockForm` compartido con
        upload/URL/fit/link —, separador, espaciador): `list_id: 0`, el
        backend los salta (`CONTENT_WIDGET_TYPES`, bundle devuelve `{}`),
        chromeless sin estilo propio, el diálogo oculta Lista/período/
        filtros; (c) **ajustes de página del dashboard** — columna
        `settings` jsonb (migración 0031), popover "Página" (mismo
        componente del portal: fondo/ancho máximo/tipografía) y el
        contenedor los aplica; (d) **duplicar** widget (botón hover, copia
        al final) y dashboard completo (icono en la grilla del índice,
        widgets con ids nuevos + settings). 2 tests API nuevos (321 en
        verde) + E2E navegador 13/13 (heading tinta, KPI azul re-teñido,
        default intacta, chromeless, fondo de página, duplicar, diálogo).

  - [x] **Fase 3 — KPI premium + medidor (v0.1.99)**: (a) el KPI gana
        **icono** (set curado de 12, `config.icon` por nombre, tolerante),
        **prefijo/sufijo** ($/%), **meta** (`config.goal`) con barra de
        progreso y COLOR CONDICIONAL (verde al alcanzarla / ámbar por
        debajo; sin meta el color no cambia) y **mini-tendencia**
        (`config.spark_field_id` → el backend agrega la MISMA métrica por
        día sobre los últimos 30 días y devuelve `spark[]`; un spark
        inválido no rompe el KPI); (b) widget nuevo **gauge** (medidor
        semicircular vs meta): evalúa como KPI, arco con dasharray, color
        por tramo (<50% rose / <100% amber / ≥100% emerald), % + valor/
        meta; (c) diálogo: fila premium (icono/meta/prefijo/sufijo) para
        kpi+gauge + selector de mini-tendencia. El pie NO necesitó donut
        (ya lo era, con total al centro + leyenda clicable). 1 test API
        nuevo (322 en verde) + E2E navegador 12/12 (prefijo, barra, ámbar,
        sparkline, gauge 100% 4/4, opciones del diálogo).

  - [x] **Fase 4 — Interactividad (v0.1.100)**: (a) **período GLOBAL del
        tablero** — selector en el header (presets de rango relativo,
        persistido por dashboard en localStorage); viaja como
        `period_preset` en el body del bundle y el backend lo aplica
        pisando el período propio de cada widget (sobre `period.field_id`
        o, si no tiene, `date_field_id`; widgets sin campo de fecha quedan
        intactos; preset inválido se ignora). Contexto React
        (`DashboardGlobalPeriodContext`) → el queryKey del bundle incluye
        el preset. (b) **Click-through**: click en una barra / sector del
        donut / etapa del embudo → abre la lista filtrada a ese valor
        (`useSegmentNav` navega con `?gf=<field>&gv=<valor>`; no navegable
        si el grupo es fecha bucketeada). `RecordsPage` traduce el
        deep-link a un filtro eq (gv vacío → is_null) POR ENCIMA de la
        vista default y limpia los params. (c) **Modo presentación** —
        botón "Presentar": fullscreen del tablero + auto-refresh del
        bundle cada 60 s mientras dura. 1 test API nuevo (323 en verde) +
        E2E navegador 8/8 (override en el wire, KPI 3→0 con "Hoy",
        persistencia, navegación con filter_tree eq).

        **Con esto F7 queda completa: motor honesto, look premium,
        widgets nuevos e interactividad.**

  - [x] **Charts responsive en celular (v0.1.101, reporte del usuario con
        captura móvil)**: los donuts se rompían en el teléfono — callouts
        externos recortados en los bordes del card, leyenda lateral
        aplastada (nombres truncados a una letra) y labels JSON crudo de
        multi_select (`["hosting_2gb"]`). Fixes: (a) el grid del dashboard
        APILA en una columna bajo 640px de contenedor (orden visual y→x,
        alto equivalente al del grid, sin drag/resize y SIN persistir — el
        layout desktop queda intacto); (b) el donut se reacomoda por el
        ancho REAL de su card (`useContainerWidth`, ResizeObserver): bajo
        420px → aro compacto arriba + leyenda debajo a lo ancho, callouts
        apagados; (c) `prettyGroupLabel` (solo display) convierte los
        grupos multi_select a texto legible (`vip, promo`) en leyenda/
        labels/tooltips de pie/bar/funnel — el valor crudo sigue siendo la
        clave del dato (click-through intacto) y el color matchea la
        opción; (d) leyenda del donut ordenada por valor DESC (antes las
        primeras 8 podían ser todas 0 y el segmento grande quedaba en
        "+N más"). E2E navegador 10/10 en viewport 390×844 + desktop
        (apilado, sin RGL, sin callouts, leyenda a lo ancho, sin overflow,
        multi legible; desktop conserva grid y callouts).

  - [x] **Lote móvil + reportes de dashboards (v0.1.102, reportes del
        usuario)**: (a) el apilado móvil de v0.1.101 recupera el RESIZE de
        ALTO — grid RGL de 1 columna con handle inferior táctil que al
        soltar persiste SOLO `h` (x/y/w del layout desktop intactos, jamás
        se persiste el acomodo mobile); (b) **"Ocultar grupos en cero"**
        (`config.hide_zero_groups`, toggle en Mostrar para pie/bar/funnel):
        condición sobre el RESULTADO del chart — los grupos cuya métrica da
        0 no se dibujan ni aparecen en la leyenda (si TODO es 0 se muestran
        igual). El reporte "el filtro > 0 no filtra" se investigó a fondo:
        el motor de filtros por registro FUNCIONA end-to-end (repro por UI:
        crear con filtro gt → persiste filter_tree → data 65→11; editar →
        reaparece → re-guardar conserva) — lo que el usuario esperaba era
        esta condición sobre el resultado; (c) **hex tipeable** en el panel
        Diseño y en "Página": los inputs eran controlados por el valor YA
        validado (tipear "#25" no pasaba la regex → el value nunca cambiaba
        → parecían bloqueados) — `HexInput` nuevo con borrador local que
        commitea al hex válido (o vacío), montado en ColorRow y
        PortalPageSettings. 2 tests unit front (26 en verde) + E2E
        navegador 8/8 (leyenda reducida, handle sur, h 4→6 persistido con
        x/y/w intactos, hex tipeado carácter a carácter → style.bg).

  - [x] **Donut desktop sin callouts + click-through multi_select
        (v0.1.103, reportes del usuario con captura)**: (a) los labels
        externos con línea del donut se ELIMINARON — a cualquier tamaño
        real de card terminaban superpuestos o cortados en los bordes;
        ahora el % vive DENTRO del aro (slices ≥7%, blanco bold) y el
        detalle completo en leyenda/tooltip; el aro llena el SVG (viewBox
        único 100), max-h 260 y la leyenda desktop pasa de `flex-1` (un
        océano entre nombre y valor) a ancho acotado 320px con el par
        aro+leyenda centrado; (b) **click-through de multi_select daba "no
        se encontraron registros"**: el grupo es el JSON crudo del set
        (`["a","b"]`) y el filtro `eq` comparaba esa CADENA contra los
        elementos → nunca matcheaba. `useSegmentNav` detecta multi_select
        y navega con `gvs=[valores]`; RecordsPage arma un AND de
        `contains` por valor. "(sin valor)" → is_null (cubre set vacío).
        E2E navegador 8/8 (cero polylines, % en el aro, leyenda 297px de
        un card de 574, sin overflow, click en combo `["vip","promo"]` →
        contains vip AND contains promo → 1 registro; click en "(sin
        valor)" → is_null → 66).

  - [x] **Formato regional por empresa (v0.1.104, pedido del usuario: "en
        Latinoamérica usamos punto para miles y no coma")**: cada workspace
        configura cómo se muestran números, fechas y horas. Shared:
        `tenantFormatSchema` (`number_format` comma_dot/dot_comma/space_comma,
        `date_format` ymd/dmy/mdy, `time_format` h24/h12; defaults = el
        comportamiento histórico). Vive en `tenants.settings.format` (sin
        migración) y VIAJA dentro del branding (que todo miembro ya trae al
        bootear — cero requests extra); endpoints GET/PATCH
        `/workspaces/current/format` (PATCH admin) y el portal lo recibe en
        `portal.me` (el cliente ve los montos igual que la empresa). Front:
        `lib/tenantFormat.ts` — estado de módulo (los helpers son funciones
        puras llamadas en render) con `formatNumber` (base en-US + mapeo de
        separadores → no depende del locale del navegador), `formatDateStr`
        (sin parsear Date: cero shift de zona), `formatDateTimeStr` (naive-UTC
        → local) y `numberFormatLocale` (para Intl con símbolo de moneda);
        aplicado en TODAS las superficies: tabla (celdas, updated_at, labels
        de grupo, footer de agregados), ficha/modal (FieldValueDisplay,
        RightRail), dashboards (KPI/gauge/delta/charts/tabla) y portal
        (ClientDataBlock). Card "Formato regional" en Ajustes (solo admin,
        3 selects + vista previa en vivo, con guard anti-race: la
        hidratación del query no pisa una selección ya tocada). 9 tests
        front (35 en verde) + 1 test API (325) + E2E navegador 8/8 (cambiar
        a punto-miles + DD/MM → preview en vivo, guardado, la tabla muestra
        "1.032.000" y "31/12/2026" — también el updated_at "23/07/2026
        14:45" —, reset vuelve al histórico).

  - [x] **Lote de reportes de dashboards + realtime (v0.1.105)**: (1)
        **widget de título sin recorte** — los bloques de contenido con
        estilo usaban p-4 y en alturas de 1 fila el texto quedaba cortado
        (ahora py-1.5 + centrado); (2) **donut**: la cifra del centro se
        AUTOESCALA al agujero (con 6+ dígitos se montaba sobre el aro), el
        "+N más" de la leyenda ahora EXPANDE la lista completa (y "Ver
        menos" la contrae), y la etiqueta "Total" es editable por widget
        (`config.center_label`, input en el diálogo); (3) **período
        personalizado** con fecha inicio/fin: el `between_relative` acepta
        un rango fijo `{from,to}` (query-builder, con clamp de extremos
        invertidos y 23:59:59 para datetime), el override global viaja como
        `custom:from:to`, el selector del tablero gana "Personalizado…"
        (dos date inputs, persistido) y el PeriodPicker del widget también
        (preset `custom` + from/to en config); (4) **modo Presentar
        limpio**: en fullscreen se oculta TODO el chrome de edición
        (Editar/Eliminar/Añadir/Página/lápiz/botones de widget) y queda el
        período + botón "Salir" que restaura el modo normal; (5) **realtime
        id↔slug**: `useRealtime` invalidaba por id numérico pero
        RecordsPage registra sus queries por SLUG → los cambios de
        ajustes/campos hechos en otra pestaña (u otro usuario) jamás
        refrescaban la lista abierta; ahora usa `invalidateForList` (id+
        slug) y el PATCH de permisos también refresca records/fields (el
        ACL cambia qué devuelven). 1 test API nuevo (326) + E2E navegador
        14/14 (heading, autoescala+Cartera, leyenda expandible, wire
        `custom:from:to` + KPI 10→3, Presentar sin chrome + Salir, campo
        renombrado en pestaña B aparece en A sin recargar).

  - [x] **Fix: título del dashboard con letra grande recortado (v0.1.106,
        reporte del usuario con captura)**: el fix de v0.1.105 (py-1.5) no
        alcanzaba porque al elegir FONDO la capa de estilo mete
        `padding: 16px` INLINE (default md) que pisa la clase, y con
        tipografía 2xl (28px → h2 a 33.6px) el texto no entra en 64−32 px.
        Ahora los bloques de CONTENIDO sin pad ELEGIDO capan el padding
        vertical inline a 6px (el horizontal se conserva; un pad explícito
        del panel Diseño sigue mandando), el h2 usa leading-none y el
        subtítulo pasa a `<small>` — queda FUERA del selector de herencia
        tipográfica (`.imcrm-style-fs :where(p, div, …)`) que lo inflaba a
        28px y lo desbordaba. Verificado en navegador con la config exacta
        de la captura (2xl+bold+fondo oscuro, con subtítulo, y pad lg
        explícito respetado).

  - [x] **Favoritos + reorden del menú y de opciones (v0.1.107, pedidos del
        usuario)**: (a) el icono del riel "Listas" deja de ser una casa
        (Home → List de lucide); (b) **Favoritos**: el usuario ancla listas
        y dashboards con una estrella al hover de cada item del panel — la
        sección "Favoritos" (mixta) aparece arriba en los paneles de Listas
        y Dashboards. Per-usuario+workspace: migración 0032
        (`memberships.settings` jsonb), GET/PATCH `/me/favorites`
        (SessionGuard+TenantGuard, PATCH parcial), hook `useFavorites` con
        toggle optimista; (c) **reordenar las listas del menú** por drag &
        drop (HTML5, gate manage_lists, orden compartido del workspace):
        `PATCH /lists/reorder` valida ids únicos y propios → `position` por
        índice (el listado ya ordenaba por position), mutación optimista;
        (d) **reordenar opciones de select/multi_select**: flechas
        subir/bajar por fila en el editor de opciones (el orden del array ES
        el orden en popovers, chips y kanban — solo faltaba la UI).
        2 tests API nuevos (327 en verde) + E2E navegador 11/11 (icono,
        anclar lista y dashboard persistidos, drag "Clientes" → posición 3
        con reload, meses reordenados enero/febrero/marzo persistidos).

  - [x] **Favoritos como menú propio del riel (v0.1.108, feedback del
        usuario)**: los favoritos dejan de ser secciones embebidas en los
        paneles de Listas/Dashboards — ahora hay un item **"Favoritos"**
        (estrella) en el riel con su ruta `/favorites`: panel lateral
        dedicado con SOLO los anclados (mixto, con icono por tipo y
        desanclar) y página de tarjetas navegables con estado vacío que
        explica el anclaje. Las estrellas de anclar siguen al hover en los
        árboles de Listas y Dashboards. E2E navegador 6/6 (item del riel,
        paneles sin sección embebida, anclado visible en panel+página,
        desanclar → vacío con hint).

  - [x] **Pin neutro en favoritos (v0.1.109, feedback del usuario: "esa
        estrellita amarilla resalta demasiado")**: la estrella ámbar con
        relleno se reemplaza por un **pin outline neutro** (lucide `Pin`,
        sin fill) en TODAS las superficies — riel, botones de anclar al
        hover de los árboles (anclado = visible fijo en tinta suave, sin
        anclar = aparece al hover en muted), tarjetas de la página
        Favoritos y estado vacío; los textos dicen "pin" en vez de
        "estrella". E2E navegador 5/5 (icono pin en riel/botones/tarjeta,
        cero clases ámbar/fill, round-trip anclar-desanclar intacto).

  - [x] **Trigger de webhook entrante (v0.1.110, pedido del usuario: disparar
        automatizaciones desde un formulario u otra plataforma)**: trigger
        nuevo `incoming_webhook` — cada automatización que lo usa recibe una
        **URL pública única** `POST /public/hooks/:token` (sin sesión: el
        token opaco ES la credencial, mismo criterio que las listas públicas
        ADR-S14; token desconocido → 404 opaco; body JSON cap 64KB, arrays/
        escalares se envuelven; responde 202 y el run se ENCOLA en BullMQ).
        Tabla `automation_hooks` sin RLS (migración 0033, token→tenant+
        automation, UNIQUE por automation). `syncHook` en el save: genera el
        token (base64url 24 bytes) si no hay uno válido y lo persiste en
        `trigger_config.webhook_token`; guardar SIN token (Regenerar) rota la
        URL revocando la anterior (delete-first por el unique). Motor:
        `runWebhook` mapea las claves del payload que coinciden con SLUGS de
        la lista a `data` (condiciones `field_filters` y `{{slug}}` funcionan
        directo) y el accessor resuelve `{{payload.x.y}}` (paths anidados) +
        fallback slug→payload. Editor: tarjeta del trigger muestra la URL
        copiable + "Regenerar URL" + hint de merge tags; `cleanTriggerConfig`
        conserva `webhook_token`; el guardado refresca el token en caliente.
        1 test de integración (13/13 del spec, 328 API en verde) + E2E
        navegador 9/9 (URL en el editor, POST externo sin sesión → 202 →
        registro creado con `{{nombre}}` y `{{payload.contacto.email}}`, run
        success, token inválido → 404).

  - [x] **Probar el webhook entrante (v0.1.111, pedido del usuario: "botón de
        test o preview para ver qué llega y mapearlo a los campos")**: panel
        "Probar el webhook" en la tarjeta del trigger `incoming_webhook`
        (estilo test-trigger de Zapier). Backend: cada POST a
        `/public/hooks/:token` guarda una **captura** en Redis
        (`hookcap:{tenant}:{automation}`, últimas 5, TTL 24h, best-effort —
        no rompe la recepción) y `GET /automations/:id/hook-captures`
        (`manage_automations`, 404 si la automatización no es del tenant) las
        devuelve; `HookCaptureStore` es un subconjunto tipado de ioredis para
        poder testear con un fake en memoria. Front: botón **"Escuchar datos
        de prueba"** (sondeo cada 3.5 s → el payload aparece apenas llega,
        sin recargar), payload APLANADO clave por clave (paths anidados
        `contacto.email`, cap 40 filas) con preview del valor, badge
        `campo «Label»` cuando la clave top-level coincide con un slug de la
        lista, y **merge tag copiable por fila** (`{{slug}}` /
        `{{payload.path}}` → click = clipboard + "¡Copiado!"). Contexto nuevo
        `AutomationEditorAutomationContext` (id de la automatización) — el
        panel también funciona en el Sheet del Lienzo. Schema compartido
        `hookCaptureSchema`. Asserts nuevos en el spec (cap 5 + guard de
        tenant; 13/13, 328 API en verde) + E2E navegador 12/12 (vacío →
        Escuchar → POST externo → filas sin recargar, match de campo, tag
        anidado copiado al portapapeles, endpoint directo).

  - [x] **Modo oscuro en toda la app (v0.1.112, pedido del usuario)**: los
        tokens dark existían desde el plugin (`[data-imcrm-theme="dark"]`, el
        mismo selector del `darkMode` de Tailwind) pero NADIE los activaba —
        faltaba el conmutador y el bloque estaba incompleto. Ahora:
        (a) `lib/theme.ts` — modo `light|dark|system` persistido en
        localStorage (`imcrm:theme`; `system` BORRA la clave), resuelto contra
        `prefers-color-scheme` con listener en vivo, pintado como atributo en
        `<html>` (no en `#root`: así el tema alcanza los flotantes de Radix,
        que portalean a `<body>`), expuesto con `useSyncExternalStore`;
        (b) **pre-paint** inline en `cloud/index.html` — el atributo se pinta
        ANTES de montar React (cero flash blanco; verificado en el build de
        producción, que emite el HTML desde `dist-cloud/cloud/`);
        (c) **tokens dark completados** — faltaban 32, el grave era
        `--imcrm-canvas` (el ÁREA DE TRABAJO entera quedaba gris claro):
        canvas hundido, semánticos success/warning/info re-lightados con tinta
        encima, tones de los StatTiles un punto más claros; las **sombras**
        pasaron de literales en `tailwind.config` a variables del tema
        (`--imcrm-shadow-*`) porque un navy al 4% es INVISIBLE sobre oscuro →
        en dark son negras y más opacas;
        (d) **branding white-label consciente del tema** (`brandVars`): en
        claro el color del tenant va tal cual; en oscuro se sube a la banda
        52-70% de lightness (el `primary-foreground` dark es TINTA — un teal
        hondo daría texto negro sobre casi-negro) y el riel se HUNDE (13%) en
        vez de encenderse (30%);
        (e) **botón sol/luna en el topbar** (toggle claro⇄oscuro) + sección
        **Ajustes → Cuenta → Apariencia** con el tri-estado (Claro / Oscuro /
        Seguir al sistema — el único lugar donde se vuelve a "sistema"). Es
        preferencia POR DISPOSITIVO: no viaja al backend a propósito.
        El portal del cliente y las listas públicas quedan en claro: son
        superficies DISEÑADAS por el tenant (fondo de página y estilos por
        bloque del page-builder) — forzarles un tema rompería el WYSIWYG del
        editor. 6 tests unitarios nuevos (front 41 en verde) + E2E navegador
        16/16 con auditoría de luminancia (cero superficies grandes claras en
        listas/records/dashboards/ajustes, modal portaleado oscuro,
        persistencia tras reload, vuelta a claro) y revisión visual de
        dashboards con charts, editor de automatizaciones, ficha de registro
        y login.

- [x] **F8 — Auditoría integral post-v0.1.112** (hallazgos de la revisión
      completa pedida por el usuario; orden acordado: seguridad → robustez →
      escala):
  - [x] **Release de seguridad (v0.1.113)**:
        (a) **SEC-21 — XSS almacenado en el módulo de archivos** (verificado
        con PoC antes y después): la descarga devolvía el `content-type` que
        eligió QUIEN SUBIÓ el archivo (`part.mimetype`) con
        `content-disposition: inline` → cualquier miembro con permiso de
        editar registros subía un `.html`/`.svg` y obtenía una URL en el
        MISMO origen que ejecutaba su JavaScript (peor por `/files/:id/signed`,
        que no pide sesión y sirve para pasarle el link a cualquiera, incluido
        el cliente del portal). `nosniff` no alcanza: sólo impide ADIVINAR el
        tipo, no respetar un `text/html` explícito. Fix: `safe-content-type.ts`
        — whitelist de tipos que se sirven inline (png/jpeg/gif/webp/avif/bmp/
        ico/pdf; SVG queda FUERA a propósito), todo lo demás baja como
        `application/octet-stream` + `attachment`, más
        `Content-Security-Policy: sandbox` en la respuesta y un
        `content-disposition` a prueba de inyección de cabeceras (con
        `filename*` RFC 5987 para conservar acentos). Aplicado a los DOS
        caminos (sesión y firmado). 5 tests unitarios.
        (b) **SEC-22 — el reset de contraseña no cerraba las sesiones**:
        `resetPassword` cambiaba el hash y nada más, así que con TTL de 30 días
        deslizantes quien hubiera robado una sesión seguía dentro después de
        que la víctima "recuperaba" la cuenta. Ahora llama a
        `destroyAllForUser`. Test de integración (dos sesiones vivas → reset →
        ambas muertas → la contraseña nueva es la que vale).
        (c) **Secretos que degradaban en SILENCIO**: `SECRETS_KEY` vacío hacía
        que `encryptSecret` devolviera texto plano (contraseñas SMTP de cada
        empresa SIN CIFRAR en la DB) y `FILES_SIGNING_SECRET` vacío caía a un
        secreto aleatorio por proceso (URLs firmadas rotas en cada reinicio y
        distintas entre nodos). Ahora `loadEnv` FALLA el arranque en producción
        con un mensaje accionable (y avisa por consola en desarrollo), y ambas
        variables están documentadas en `.env.example`.
        (d) **CSP** en los dos proxies (Caddy + nginx). OJO: acotado al SPA,
        NUNCA a `/api/*` — la lista pública embebible (ADR-S14) manda su propio
        `frame-ancestors` por dominio y un segundo CSP con `frame-ancestors
        'self'` lo bloquearía (el navegador aplica la INTERSECCIÓN de ambas
        políticas). Por el mismo motivo `X-Frame-Options` también se movió a
        los `location`/matcher del SPA.
        (e) **Dependencias con CVE de runtime** cerradas por override:
        `fast-uri` ≥3.1.4 (high, vía Fastify), `find-my-way` ≥9.7.0 (high, DoS
        HTTP/2 del router), `dompurify` ≥3.4.12 (bypass del sanitizador),
        `postcss` ≥8.5.23, `brace-expansion` ≥2.1.2. Quedan pendientes y
        DOCUMENTADAS: `react-router` (el arreglo sólo existe en la major v7 —
        migración aparte, riesgo real sobre 62k líneas de front) y las de
        `vite`/`vitest`/`esbuild`, que son del servidor de desarrollo y no
        llegan al bundle de producción. 334 tests API en verde. (react-router
        se migró en v0.1.119; el resto de los avisos de producción se cerró en
        v0.1.202, que los dejó en cero.)
  - [x] **Robustez (v0.1.114)**:
        (a) **Tests reales del front donde más duele** — el adaptador
        `lib/api.ts` y las queryKeys no tenían NI UN test, y son justo la capa
        que produjo la clase de bug más cara del proyecto (v0.1.68 filtros,
        v0.1.81 import, v0.1.83 recurrencias, v0.1.85 automatizaciones,
        v0.1.105 realtime: todas invalidaciones que no matcheaban por el par
        id↔slug). Se exportaron los helpers PUROS del adaptador (sin cambiar
        comportamiento) y se cubrieron: traducción `f{id}`↔slug de data y
        relations, `Z` de los timestamps naive-UTC, claves huérfanas que no se
        pierden, body de create/update, `per_page`→`limit` con cap 200,
        reconocimiento de paths. Más un spec del CONTRATO de las queryKeys:
        todas las familias ponen el identificador en el índice 1, y
        `invalidateForList` matchea la query registrada por slug cuando el
        evento trae el id (y viceversa) sin cruzar listas ni namespaces.
        26 tests nuevos (front 41 → 67). El primero encontró un bug latente:
        `buildFieldMap` reventaba con una entrada nula en la respuesta y
        dejaba la lista SIN traducción de claves (tabla vacía) — endurecido.
        (b) **Bitácora de acciones administrativas** (migración 0034,
        `audit_log` con RLS): `activity` sólo registra cambios de REGISTROS y
        cuelga de una lista con cascada — o sea que borrar una lista borraba
        justo la evidencia de quién la borró, y las acciones de workspace
        (miembros, plan, SMTP, dominio) no dejaban rastro alguno. Tabla propia
        append-only + `AuditService` (@Global, best-effort: si la bitácora
        falla, la operación del usuario sigue). Registra: crear/borrar lista,
        cambiar permisos por rol, publicar/despublicar al mundo, borrar campo,
        convertir tipo de campo, alta/cambio de rol/baja de miembros, y cambios
        de SMTP y dominio. El `target_label` guarda el NOMBRE al momento de la
        acción, así la entrada sigue siendo legible cuando el objeto ya no
        existe. `GET /workspaces/current/audit` (admin, cursor) + sección
        "Registro de actividad" en Ajustes → Workspace, con las acciones
        destructivas marcadas. Nunca se guardan contraseñas en el meta.
        5 tests (aislamiento por empresa, orden, cursor, resistencia a fallos)
        — 339 API en verde.
        (c) De paso: el override de `brace-expansion` de v0.1.113 tuvo que
        acotarse POR LÍNEA de versión (`@1` y `@2`) — el `>=2.1.2` global
        empujaba a los consumidores de la v1 (minimatch@3 → ESLint) a la 5.x,
        cuya API cambió, y ESLint no arrancaba ("expand is not a function").
  - [x] **Escala (v0.1.115)**:
        (a) **Consola de plataforma paginada**: `/platform/tenants` traía TODAS
        las empresas y encima corría CUATRO `GROUP BY` de tabla completa
        (records, memberships, automations, attachments) en cada carga — con 54
        empresas andaba, pero a escala cada visita escaneaba la tabla de
        records entera. Ahora pagina primero (`limit` máx 200 / `offset` / `q`
        por nombre o slug, con `meta.total`) y los agregados se acotan a los
        ids de la página (`WHERE tenant_id IN (...)`, lookup por índice). El
        front pasa a búsqueda server-side con debounce + controles
        Anterior/Siguiente.
        (b) **Techo de campos indexados por lista** (8): cada campo con
        `is_indexed` crea 1-2 índices de expresión sobre la tabla COMPARTIDA
        `records`; sin tope, N empresas × M campos terminan en miles de índices
        en una sola tabla y cada INSERT/UPDATE los actualiza todos. Se valida
        al crear y al encender el flag (re-guardar uno ya indexado no rebota).
        (c) **Realtime en acciones masivas**: `bulk` emitía un evento POR FILA
        → 500 registros = 500 broadcasts al workspace y cada pestaña abierta
        refetcheando 500 veces. `update`/`remove` aceptan `{silent}` y `bulk`
        emite UNA sola vez al final. (El import ya lo hacía bien.)
        (d) **Vendor chunks estables** en el build cloud: React, TanStack y
        Radix viajaban DENTRO del bundle de la app, así que cada
        auto-actualización invalidaba ~330 KB gzip de cache aunque las
        dependencias no cambiaran. Separados: el chunk de la app baja de 210 a
        161 KB gz y 104 KB pasan a chunks que sobreviven a los deploys.
        4 tests nuevos (343 API en verde).

        **Pendientes conocidos de la auditoría** (no entraron en estos tres
        releases, por orden de valor): migrar `react-router` a la v7 (única
        versión con el arreglo del open-redirect), 2FA + gestión de sesiones
        activas por usuario, verificación de email en el alta pública,
        rate-limit por cuenta además de por IP (hoy es en memoria por nodo),
        `slug_history` para que renombrar una lista no rompa los enlaces
        viejos, y export/borrado de datos por usuario (GDPR).
  - [x] **Seguridad de cuenta (v0.1.116)** — tres de los pendientes de la
        auditoría:
        (a) **Cambiar la contraseña estando adentro**: antes SÓLO existía el
        flujo de "olvidé mi contraseña" (había que pasar por el email para
        cambiarla). `POST /auth/change-password` verifica la actual y cierra
        las sesiones de los OTROS dispositivos — la actual sigue viva (quien
        cambia la clave no tiene por qué quedar afuera).
        (b) **Sesiones activas por usuario** ("Dispositivos conectados"):
        `GET/DELETE /auth/sessions` + `DELETE /auth/sessions/:id`. El id
        público es un **hash del token** — el token es la credencial y no sale
        nunca del servidor (verificado en el test y en el E2E). El
        `last_seen` se DERIVA del TTL restante (el TTL es deslizante), así no
        hay que escribir en Redis en cada request. El listado va en UN
        pipeline: una cuenta con cientos de sesiones abiertas hacía 2
        round-trips por sesión (lo detectó el propio E2E, con 198 sesiones
        acumuladas de las corridas previas).
        (c) **Freno de fuerza bruta POR CUENTA**: el rate limit de `main.ts`
        es por IP y en MEMORIA de cada nodo — mil IPs contra el mismo email
        pasaban limpio y con dos nodos el cupo se duplicaba. Ahora hay un
        contador en Redis por email (10 fallos / 15 min, compartido entre
        nodos) que se chequea ANTES de verificar el hash (argon2 es caro a
        propósito) y se limpia con un login bueno.
        Front: sección **Ajustes → Cuenta → Seguridad** (form de contraseña
        con validación de coincidencia + lista de dispositivos con navegador/
        SO/IP/última actividad, "este dispositivo" marcado, cerrar una o
        "Cerrar las demás"). 4 tests API nuevos (347 en verde) + E2E navegador
        11/11.
  - [x] **Historial de slugs (v0.1.117)** — cierra el `TODO(F1-slugs)` que
        quedaba en `lists.service.ts`: el slug es etiqueta HUMANA editable
        (regla de oro nº 1), así que al renombrar una lista todo enlace o
        marcador guardado con el slug viejo daba 404. Tabla
        `list_slug_history` (migración 0035, RLS, único por tenant+slug): al
        renombrar se registra el slug abandonado, y `resolve` cae al historial
        SÓLO si el slug vivo no existe (el camino normal no paga nada).
        Encadenar renombres conserva todos los alias previos. Un slug VIVO
        siempre gana al histórico: si otra lista reclama el slug liberado, la
        fila vieja queda sombreada (y se borra la del historial al reusarlo).
        2 tests (cadena de renombres, lo vivo gana + el historial no cruza
        empresas) — 349 API en verde.

  - [x] **Verificación de email en el alta pública (v0.1.118)** — el registro
        abierto creaba la cuenta y listo: cualquiera daba de alta cuentas con
        emails ajenos o inexistentes, y el email es la identidad que usan los
        magic links, las invitaciones y el reset de contraseña. Ahora
        `users.email_verified_at` (migración 0036, con **backfill**: las cuentas
        que ya existían se dan por verificadas, si no todo usuario en producción
        vería un aviso por un correo que nunca recibió). El alta manda el correo
        con un token de 48 h en Redis SIN bloquear la respuesta (la activación no
        se paga con latencia) y `POST /auth/verify-email` lo canjea con `GETDEL`
        —un solo uso atómico, mismo criterio que el magic link del portal
        (SEC-15)—; `POST /auth/verify-email/resend` (con sesión) remanda y es
        silencioso si ya está verificado. Decisión de producto: **no se bloquea
        el uso de la app sin verificar** (eso mata la activación), se marca la
        cuenta —`email_verified` viaja en la sesión y en el bootstrap— y se avisa
        en la interfaz. Front: página `/verify?token=` fuera del router (igual
        que el reset, con guard de un solo canje por token — el token es de un
        uso y StrictMode montaba el efecto dos veces) y banner con botón
        "Reenviar" en Ajustes → Cuenta → Seguridad. 2 tests de integración +
        1 de plataforma endurecido (el correo del alta llega en background y
        ensuciaba una aserción) — 351 API y 67 front en verde; E2E por API
        (alta → token del correo → verificar → reuso rechazado) y navegador 8/8.

  - [x] **react-router v7 (v0.1.119)** — el último pendiente de dependencias de
        la auditoría: `react-router-dom@6` arrastraba dos avisos sin parche en
        su línea (open redirect por backslash en `<Link>`/`useNavigate` —bypass
        de CVE-2025-68470— e inyección de constructor en `deserializeErrors`);
        el arreglo existe **sólo** desde 7.18.0. Se migró a `react-router@7.18.1`
        (la v8, ya publicada, exige React ≥19 y la app va con 18). En v7 los dos
        paquetes se fusionaron: se quitó `react-router-dom` y los 30 archivos
        importan de `react-router` — la API que usa el fork (Link, NavLink,
        Routes/Route, Navigate, Outlet, useNavigate/useParams/useSearchParams/
        useLocation, Hash y BrowserRouter) es idéntica, así que no hubo cambios
        de código más allá del import. `react-router` pasa además al chunk
        `vendor-react` (sobrevive a los deploys, como el resto de vendors desde
        v0.1.115). Typecheck/lint 0 errores, 67 tests front en verde, build OK y
        E2E de navegación en navegador 9/10 —el único ✗ es el 401 esperado del
        sondeo de sesión al bootear— cubriendo Link del panel, useParams,
        `?s=` de Ajustes, dashboards/favoritos, botón atrás y el `<Navigate>`
        de ruta desconocida. (`uuid` y `brace-expansion` siguen con avisos pero
        cuelgan sólo de Testcontainers y ESLint: no llegan al runtime.)

  - [x] **Verificación en dos pasos / 2FA (v0.1.120)** — la contraseña dejaba
        de ser suficiente sólo si el atacante fallaba 10 veces (freno de
        v0.1.116); ahora cada usuario puede exigir además un código de su
        teléfono. **TOTP propio** (`src/auth/totp.ts`, RFC 4226/6238 con
        `node:crypto`, sin dependencias): HMAC-SHA1, 6 dígitos, ventanas de
        30 s con ±1 de tolerancia, base32 RFC 4648 y URI `otpauth://` — los
        **vectores de prueba de los RFC** están en los tests, que es la única
        garantía real de que Google Authenticator y compañía hablen con
        nosotros. Migración 0037: el secreto se guarda **cifrado** (secret-box
        AES-256-GCM, `SECRETS_KEY` obligatoria en producción desde v0.1.113) y
        los 10 códigos de respaldo **hasheados** (SHA-256; son aleatorios de 50
        bits, no hace falta un KDF lento) — quien lea la tabla no puede generar
        ni usar códigos. El alta es de dos pasos a propósito: el secreto
        propuesto vive en Redis (10 min) y sólo se persiste cuando el usuario
        confirma un código, así un QR mal escaneado no deja a nadie encerrado
        afuera. En el login la contraseña correcta ya NO abre sesión: devuelve
        un **desafío** de un solo uso (Redis, 5 min, 5 intentos) que se canjea
        con el código de la app o con un código de respaldo (se consume, con
        comparación en tiempo constante). Desactivar exige la **contraseña**
        —con la sesión abierta sola, quien roba un equipo desarmaría el
        factor—. Front: card "Verificación en dos pasos" en Ajustes → Cuenta →
        Seguridad (QR dibujado en el cliente con `qrcode` cargado de forma
        diferida —chunk aparte de 24 KB—, clave copiable para carga manual,
        respaldos que se muestran UNA vez, regenerar y desactivar) y segundo
        paso en la pantalla de login. 12 tests nuevos (7 unitarios con los
        vectores del RFC + 5 de integración: alta en dos pasos, cifrado real
        verificado en la fila cruda, desafío de un solo uso, respaldo que se
        consume, desactivación) — 364 API en verde. E2E navegador 13/13 (alta
        con QR, código malo rechazado, activación, login en dos pasos, entrada
        con respaldo, contador 10→9, desactivación).

  - [x] **Tus datos: descarga y borrado (v0.1.121, GDPR art. 15 y 17)** — el
        último pendiente de la auditoría. `GET /me/data-export` arma un JSON
        con la cuenta (sin secretos: ni hash, ni secreto TOTP, ni códigos de
        respaldo) y, **empresa por empresa dentro de su scope de tenant**, lo
        que la persona escribió ahí: comentarios, actividad, menciones
        recibidas, filtros guardados y archivos subidos — recorrer con
        `withTenant` es lo que garantiza que el export no pueda filtrar datos
        de una empresa a la que ya no pertenece (hay test). El shape vive en
        `packages/shared` (`accountExportSchema`), así el front valida lo mismo
        que arma el backend. `POST /me/delete-account` **anonimiza**: se borran
        email, nombre, contraseña (hash de un secreto aleatorio), segundo
        factor, firma, membresías, filtros y menciones, y se revocan todas las
        sesiones al instante; el contenido que la persona produjo DENTRO de una
        empresa **queda**, atribuido a "Usuario eliminado". Es una decisión de
        producto explícita: los registros y comentarios son datos del CLIENTE
        (el responsable del tratamiento), no del empleado que los tipeó —
        borrarlos sería destruirle la operación a la empresa. Guard rails:
        exige la **contraseña** (no alcanza la sesión abierta para algo
        irreversible) y rechaza con 409 + la lista si la persona es el **único
        admin** de alguna empresa; `GET /me/deletion-blockers` deja que la UI lo
        avise ANTES de pedir la contraseña. Front: sección "Tus datos" en
        Ajustes → Cuenta (descarga del JSON con nombre fechado + borrado con
        confirmación, y el aviso de qué se conserva). 5 tests nuevos (369 API
        en verde) + E2E navegador 7/7 del panel y 6/6 del borrado real
        (bloqueo por único admin, contraseña equivocada que no borra,
        anonimización verificada en la DB, vuelta al login).

        **Con esto quedan cerrados TODOS los pendientes de la auditoría F8.**

  - [x] **Colores del page-builder legibles en los DOS temas (v0.1.122,
        reporte del usuario con captura del dashboard en oscuro)** — los
        títulos y el texto de la tabla no se veían. Causa única: los colores
        del panel Diseño (`config.style`) se eligen en UN tema y la capa de
        estilo sólo pintaba el FONDO; la tinta seguía saliendo de los tokens
        del tema. En oscuro eso daba texto claro sobre un fondo claro elegido
        antes (KPIs, headings, tabla) y tinta oscura sobre superficie oscura
        (los headings con color propio). Ahora `blockStyleCss` resuelve la
        tinta contra la SUPERFICIE REAL: (a) con fondo propio y sin texto
        elegido, la tinta se deriva de la luminancia del fondo — el resultado
        es idéntico en claro y en oscuro; (b) con fondo Y texto elegidos se
        respetan los dos (el autor eligió el par, es estable); (c) con texto
        elegido y sin fondo, el bloque se apoya en la superficie del tema, así
        que una tinta que no contrasta se lleva a una franja legible
        CONSERVANDO el tono. Y la superficie no siempre es el tema: manda el
        fondo de PÁGINA del tablero/portal si lo tiene, por eso `surfaceDark`
        se calcula en cada caller (dashboards, ficha, canvas del editor) y el
        editor del portal lo fija en claro — el cliente nunca ve modo oscuro.
        Además el fondo del bloque re-tiñe también `--imcrm-canvas`/
        `--imcrm-background`/`--imcrm-popover` (el header sticky de la tabla
        del widget quedaba como una banda del TEMA dentro de una tarjeta con
        color propio) y `--imcrm-accent` un escalón corrido para que el hover
        de fila siga notándose. De paso: las iniciales del avatar del registro
        pasan a tinta oscura sobre los tonos claros de su paleta (ámbar/verde
        daban ~2:1 con blanco, en ambos temas). 3 tests unitarios nuevos
        (front 70 en verde) + **auditoría de contraste automatizada en el
        navegador** (recorre cada nodo de texto y calcula la relación WCAG
        contra su fondo efectivo) sobre 13 pantallas en oscuro y 2 en claro:
        16/16.

  - [x] **Fix de la regresión de v0.1.122 en modo claro (v0.1.123, reporte
        del usuario con captura)**: al arreglar el oscuro se rompió el claro en
        los tableros con **fondo de página oscuro** — la barra de acciones
        (Editar/Presentar/Página) quedó con texto claro sobre su propio fondo
        claro, y los widgets sin estilo propio (tarjeta del tema) igual.
        Causa: v0.1.122 aplicaba la tinta de la página al CONTENEDOR
        (`--imcrm-foreground` y compañía), y eso se hereda hacia TODO lo de
        adentro, incluidos los controles y tarjetas que pintan su propio fondo
        con los tokens del tema — ahí la tinta correcta es la del tema, no la
        de la página. Ahora: (a) el fondo elegido pinta el TABLERO, no el
        chrome de la app (el header queda sobre la superficie del tema, siempre
        legible, elija el color que elija el usuario); (b) `pageStyleCss` sólo
        devuelve superficie y layout — la tinta se aplica POR ELEMENTO con
        `surfaceInkCss`, y sólo a lo que se apoya de verdad en esa superficie
        (los bloques de contenido sin tarjeta). El agujero de la verificación
        también se tapó: la auditoría de contraste sólo probaba fondo de página
        CLARO; ahora cubre el caso del reporte (fondo oscuro en tema claro) y su
        simétrico. 1 test de regresión (71 front en verde) + auditoría 19/19
        sobre 15 pantallas en oscuro y 4 en claro.

  - [x] **Barrita de scroll fantasma en la tira de vistas (v0.1.124, reporte
        del usuario con captura)**: en la página de registros aparecía una
        barra vertical diminuta en el borde derecho, a la altura de la fila de
        pestañas (justo encima de "Nuevo registro"). No era una función: es el
        clásico traspié de `overflow-x-auto`. CSS NO deja el otro eje en
        `visible` cuando uno de los dos deja de serlo — lo convierte a `auto`.
        La tira de pestañas mide 36px de caja y su contenido 37 (el subrayado
        de 2px que pisa el borde inferior con `-mb-px`), así que el navegador
        dibujaba una barra vertical de un pixel de recorrido. Fix: declarar
        `overflow-y: hidden` en la tira (mismo criterio que ya usaba
        `StickyHScrollbar`) — sólo scrollea en horizontal, el subrayado activo
        se conserva (el recorte real es de 0,5px, verificado midiendo el nodo)
        y el scroll horizontal de las pestañas sigue funcionando. Barrido en
        el navegador de las 7 pantallas con tiras horizontales: ningún otro
        contenedor tiene una barra vertical accidental.

  - [x] **Pasada de vistas: tarjetas, kanban, agrupada y calendario
        (v0.1.125, 4 pedidos del usuario)**: (a) **la portada de las tarjetas
        no llegaba de lado a lado** — se veía "un cuadrado dentro de la caja".
        Causa: la tarjeta es un `<button>` y el reset propio (v0.1.55) no
        anulaba el padding NATIVO del navegador (`1px 6px` en Chromium; el
        preflight de Tailwind sí lo hace). Se agregó `padding: 0` al reset de
        button/input/select/textarea — los componentes ya ponen el suyo con
        utilities. (b) **Kanban con identidad de color por columna**: el
        encabezado pasa de un puntito a la ETIQUETA SÓLIDA con el color de la
        opción (el mismo chip que la tabla usa para ese valor) y la columna
        lleva franja superior de 3px + velo del color al 8% (`color-mix`); sin
        color, chip neutro. El color se sigue editando donde vive: el catálogo
        de opciones del campo por el que se agrupa (una sola fuente de verdad).
        (c) **El resumen de la vista agrupada** ("N grupos · M registros") se
        movió al FINAL — arriba le comía altura a la tabla sin aportar nada al
        escanear. (d) **Calendario rediseñado**: tarjeta contenedora con borde
        y sombra, banda de días de la semana, HOY como disco primary, fines de
        semana y días de otro mes atenuados, hover por celda, eventos como
        chips con el COLOR del primer campo select del registro (antes todos
        del mismo tono), "+N más" que ahora despliega el día de verdad,
        navegación agrupada, contador de registros del mes, mes/días en
        ESPAÑOL (usaban el locale del navegador → "July 2026", "MON") y la
        grilla con 5 o 6 semanas según el mes (antes siempre 42 celdas → una
        fila entera de relleno). Verificado en navegador vista por vista.

  - [x] **Ajustes de lista reconstruidos (v0.1.126, pedido del usuario:
        "está recargado con muchas opciones")**: la página era UN scroll con
        SEIS tarjetas abiertas a la vez (general + campos + apariencia +
        portal + permisos + lista pública), cada una con su propio botón de
        guardar, y el botón de ELIMINAR la lista arriba a la derecha, pegado
        a "Ver registros". Ahora: (a) **una sección por vez** con tira de
        pestañas (Campos · General · Apariencia · Permisos · Compartir — el
        mismo patrón de las vistas guardadas), sección activa en `?s=`
        linkeable, título + una línea que explica en criollo qué se hace
        ahí, y pistas de estado en la pestaña (nº de campos, punto verde si
        la lista está publicada). (b) **Campos**: fila con el icono de su
        tipo y el tipo en lenguaje humano (se fue el slug en monospace, el
        tipo EN MAYÚSCULAS y el `col:` interno), buscador cuando hay muchos,
        **reordenar arrastrando** (el endpoint existía desde F1 y no tenía
        UI), la fila entera abre la edición y el borrado usa el confirm
        in-app. (c) **Permisos**: se reemplazó la matriz rol × operación
        (4 selects por fila + una segunda tabla de campos ocultos) por una
        tarjeta por rol con **niveles listos para usar** —Sin acceso / Solo
        mirar / Solo lo suyo / Colaborar / Control total— y un "Ajuste fino"
        plegado con los 4 ejes y los campos que ese rol no debe ver; una
        combinación fuera del catálogo (p. ej. scope "asignados") se muestra
        como personalizada en vez de mentir con un chip marcado. (d)
        **Compartir**: portal y página pública juntos, con badge de estado y
        el enlace público ARRIBA (es el premio, antes estaba al final).
        (e) **General**: se fue el bloque "Sufijo de tabla" (jerga del
        plugin) y la zona de peligro quedó al final de la sección. 6 tests
        unitarios nuevos (77 front en verde) + E2E navegador 31/31
        (pestañas, deep link, drag&drop persistido, niveles traducidos al
        ajuste fino, un solo scroll, modo oscuro).

  - [x] **Densidad del chrome + panel "Personalizar vista" (v0.1.127, dos
        pedidos del usuario)**: (a) **más compacto** — la barra superior de
        la app y la cabecera del panel lateral bajan de 48 a 40 px (van en la
        misma línea visual: se mueven juntas o se desalinean), el encabezado
        de la lista pasa de 36 a 28 px (la altura real de sus botones ghost),
        las pestañas de vistas de 36 a 32 px y el ritmo vertical de la página
        de registros de 0.5 a 0.3 rem. Se hizo cambiando la clase del
        COMPONENTE, no redefiniendo las utilidades de Tailwind (`.imcrm-h-12`,
        `.imcrm-gap-2` las usan decenas de pantallas — redefinirlas habría
        apretado toda la app, que es justo lo que el usuario pidió evitar);
        el margen negativo que proponía para pegar la cabecera se reemplazó
        por bajar su `min-height`, que no puede recortar contenido.
        (b) **Un botón con todos los ajustes de la vista**, como ClickUp:
        `ViewSettingsSheet` ("Personalizar") reúne en un panel lateral lo que
        estaba repartido entre tres botones de la toolbar y el breadcrumb —
        Campos (con su "N en pantalla" y el diálogo de orden/visibilidad),
        Filtro (el mismo editor, embebido), Agrupar por, y las acciones de la
        vista (por defecto, copiar enlace, eliminar) y de la lista (exportar,
        importar, automatizaciones, configurar). Filtrar se queda en la
        toolbar: es lo único de ahí que se usa a diario. (c) **"Ajustar
        texto"** de verdad (`wrap_text` en el estado común de las vistas —
        shared, mapeo y ambas tablas por contexto): las celdas dejan de
        recortar con elipsis y muestran el contenido completo; se guarda en
        la vista como cualquier otra preferencia. 2 tests nuevos (79 en el
        front) + E2E navegador 12/12 del panel y 12/12 de las medidas
        (barra 40 px alineada con el panel, pestañas 32, gap 4.8 px, sin
        desborde, resto de las pantallas intactas).

  - [x] **Línea por fila, riel flotante y diálogo de Compartir (v0.1.128,
        tres pedidos del usuario con capturas de ClickUp)**: (a) **la línea
        divisoria de cada fila** existía en el DOM pero estaba al 50% de
        opacidad — sobre blanco daba ~#F2F3F5, o sea nada. Ahora usa el color
        de borde completo en la tabla plana y en la agrupada, que es el ritmo
        de lectura que tiene ClickUp. (b) **El riel del menú FLOTA**: en
        escritorio lleva esquinas redondeadas y 6 px de aire contra los bordes
        de la ventana y contra el panel; en mobile sigue pegado y sin
        redondear, porque ahí es un drawer a pantalla completa. (c)
        **Compartir de verdad**: botón en la cabecera de la lista que abre un
        diálogo con los dos niveles bien separados —el enlace del equipo (lo
        abre quien tiene cuenta y permiso) y la publicación hacia afuera— y en
        el segundo, además de lo que ya existía (publicar, enlace, insertar
        por iframe, campos visibles, dominios), dos funciones nuevas de
        backend: **publicar UNA vista guardada**, cuyos filtros acotan lo que
        ve el visitante (se compila con el mismo query builder whitelisteado
        de la app — los campos expuestos siguen siendo los marcados: filtrar
        no es mostrar), y **caducidad del enlace**, que vencido responde 404
        opaco, igual que un token desconocido. **Bug encontrado en el
        camino**: el mapeo token→lista tiene UNIQUE por lista, así que si la
        fila había quedado con un token viejo el `onConflictDoNothing` no la
        tocaba nunca y la app mostraba un enlace público que devolvía 404 para
        siempre; ahora el token de `settings` manda y el mapeo se
        re-sincroniza al guardar. 3 tests nuevos (16 del spec de listas
        públicas) + E2E navegador 12/12 (línea visible, riel a 6 px con
        esquinas de 8, publicar una vista → 11 filas filtradas en la página
        pública, vencer → 404).

  - [x] **Menú contextual del registro (v0.1.129, captura del usuario)**:
        click DERECHO sobre una fila (tabla plana y agrupada) abre el menú del
        registro — Abrir, Copiar enlace, Copiar ID, Duplicar, Agregar una
        columna y Eliminar (con confirmación in-app). Sólo entraron las
        acciones que existen de verdad: el menú de ClickUp trae seguir la
        tarea, recordatorios, combinar, convertir y tipo de tarea, que acá no
        tienen equivalente, y ponerlas apagadas sería peor que no ponerlas.
        Duplicar copia los campos ESCRIBIBLES: los `computed` los calcula el
        backend en cada lectura y los `file`/`relation` apuntan a otras
        entidades — copiarlos a ciegas crearía vínculos compartidos que nadie
        pidió. El menú se ancla a un trigger de 0×0 en las coordenadas del
        click para reusar el posicionamiento, el teclado y el cierre de Radix.
        Gates por capability (duplicar exige crear, eliminar exige borrar).
        E2E navegador 7/7 (menú, ID al portapapeles, duplicar 72→73,
        confirmación, borrar 73→72).

  - [x] **Carpetas de listas (v0.1.130, pedido del usuario mirando ClickUp)**:
        con muchas listas el menú era una lista plana imposible de escanear.
        Tabla `list_groups` (migración 0038, RLS) + `lists.group_id` nullable
        con **ON DELETE SET NULL**: borrar una carpeta NUNCA se lleva las
        listas puestas, vuelven a la raíz. UN solo nivel a propósito — la
        jerarquía espacio → carpeta → lista de ClickUp agrega dos niveles de
        navegación para el mismo resultado. Endpoints `/list-groups`
        (GET con sesión; POST/PATCH/DELETE con `manage_lists`) y `group_id`
        en el PATCH de lista, que valida que la carpeta sea del MISMO tenant
        (id ajeno → 404, no una FK violation con 500). Front: `ListsTree` en
        el panel — carpetas colapsables (persistido en localStorage) con
        contador, alta con "+", renombrar y eliminar desde su menú, y
        **arrastrar una lista sobre el encabezado de una carpeta la mueve
        ahí**, sobre la raíz la saca, y sobre otra lista la reordena (el
        gesto de v0.1.107 sigue igual porque el destino es distinto).
        5 tests de backend (aislamiento entre empresas incluido) + E2E
        navegador 10/10 (crear, mover con persistencia tras recargar,
        colapsar, sacar, borrar con confirmación y las listas intactas).

  - [x] **Casillas de selección al pasar el mouse (v0.1.131, captura del
        usuario)**: la casilla de cada fila estaba siempre visible y ocupaba
        una columna de ruido permanente. Ahora aparece **al pasar el mouse por
        la fila** (estilo ClickUp) y queda fija cuando la fila está marcada o
        cuando hay una selección en curso — escondérsela a alguien que está
        seleccionando es sacarle la forma de desmarcar. Igual el "seleccionar
        todos" del encabezado (aparece al pasar por la cabecera, o si hay algo
        marcado). Se aplicó a la tabla plana y a la agrupada, con la casilla
        compacta (14px, esquinas suaves, color primary) en vez del control por
        defecto del navegador. E2E navegador 10/10 (oculta en reposo, aparece
        por fila sin afectar a las vecinas, persiste marcada y con selección
        activa, vuelve a ocultarse al desmarcar, y el encabezado igual).

  - [x] **Subtareas (v0.1.132, pedido del usuario)**: un registro puede colgar
        de otro. `records.parent_id` (migración 0039, FK a la propia tabla con
        ON DELETE CASCADE + índice parcial) y **UN solo nivel**: una subtarea
        no puede tener subtareas (400 `subtask_depth`) — el mismo criterio que
        las carpetas de v0.1.130, porque la profundidad ilimitada obliga a
        resolver árboles en cada listado y no compra nada. El listado devuelve
        SÓLO el primer nivel y trae `subtask_count` por fila (una query
        agrupada por página, regla de oro nº 8); `?parent=<id>` trae las hijas
        de un registro y `?include_subtasks=1` devuelve todo plano (lo que
        necesitan export y aggregates). Borrar un padre se lleva sus subtareas
        en el mismo tx. **OJO**: `parseListQuery` es un whitelist — los dos
        parámetros nuevos hubo que copiarlos explícitamente (fue exactamente
        el bug de v0.1.68 con `filter_tree`, y acá volvió a aparecer: sin eso
        expandir un padre duplicaba la tabla entera). Front: chevron en la
        primera columna de la tabla que despliega las hijas ANIDADAS (TanStack
        `getSubRows` + `getExpandedRowModel`, sangría por profundidad; las
        hijas se piden sólo al expandir), "Crear subtarea" en el menú de click
        derecho (oculto si la fila ya es una subtarea) y el mismo modal de alta
        con el padre pre-cargado.
        **Excel/CSV** (la duda del usuario): la jerarquía viaja en el archivo.
        El export CSV incluye SIEMPRE las subtareas —si no, el archivo perdería
        filas en silencio— y antepone dos columnas, `ID` y `Subtarea de`, sólo
        cuando la lista tiene alguna (una lista sin subtareas exporta igual que
        antes). El import las reconoce solas por la cabecera y las mapea a dos
        destinos especiales del diálogo (`__id` / `__parent`, que no pueden
        chocar con un slug real porque todo slug empieza con letra): segunda
        pasada tras el bulk insert que resuelve cada referencia contra el `ID`
        de otra fila **del mismo archivo** o contra el id real de un registro
        que ya existe en la lista. Lo que no resuelve NO se pierde: la fila
        entra al primer nivel y queda reportada (padre inexistente, o un tercer
        nivel que se aplana). El JSON de intercambio ya llevaba `parent_id`.
        11 tests nuevos (6 de subtareas, 4 del CSV jerárquico, 1 del export;
        389 API en verde) + E2E navegador 9/9 y round-trip real por API
        (exportar → importar en una lista nueva → el padre queda con su
        subtarea).

  - [x] **Descripción del registro: editor de bloques estilo ClickUp/Notion
        (v0.1.133, pedido del usuario con capturas del menú «/»)**: cada
        registro gana un CUERPO tipo documento, arriba de los campos, igual
        que una tarea de ClickUp. Se escribe con atajos markdown (`## `, `- `,
        `1. `, `> `, ```` ``` ````), el menú **«/»** inserta bloques (texto,
        títulos 1-3, listas con viñetas/numeradas/de control, cita, bloque de
        código, divisor, tabla) con búsqueda sin acentos y navegación por
        teclado, y al seleccionar texto aparece la **barra flotante** (negrita,
        cursiva, subrayado, tachado, código, color de texto, resaltado, enlace,
        borrar formato). **Guarda solo** (autosave con debounce + flush al
        salir) con aviso "Guardando…/Guardado".
        Motor: **TipTap 3** (ProseMirror) en un chunk aparte de carga diferida
        —150 KB gz que sólo se bajan al abrir una ficha, la tabla no los paga—
        y con el set de extensiones acotado a lo que el backend sabe guardar.
        Persistencia: columna `records.description` jsonb (migración 0040) con
        el ÁRBOL del documento, no HTML: `sanitizeRichDoc` (packages/shared)
        es la única puerta de entrada — whitelist de nodos/marcas/atributos,
        `href` con esquemas seguros (un `javascript:` se cae solo), techos de
        nodos/profundidad/tamaño (512 KB) — así el render nunca tiene que
        confiar en el contenido. El documento **NO viaja en el listado** (una
        página de 50 filas con documentos completos pesaría de más): el
        listado trae `has_description` calculado en SQL (icono en la fila,
        como ClickUp) y el contenido se pide/guarda por endpoints propios
        (`GET/PATCH /lists/:l/records/:id/description`, ACL de ver/editar la
        fila). **Bug atrapado en el E2E antes de salir**: abrir una ficha
        disparaba `PATCH {description:null}` —el editor emite un cambio propio
        al montar (párrafo final, atributos por defecto)— y eso habría BORRADO
        descripciones con sólo entrar a mirarlas; ahora un cambio sólo cuenta
        si el editor tiene el foco (edición real) y además se compara la firma
        del documento ignorando los párrafos vacíos del final. 4 tests API +
        5 unitarios del front (16 nuevos entre ambos: 393 API y 84 front en
        verde) + E2E navegador 17/17 (menú por grupos, filtrado, atajo `## `,
        lista de control, negrita por barra flotante, autoguardado, icono en
        la fila y persistencia tras recargar) y verificación aparte de que
        abrir/cerrar un registro CON descripción no manda ni un PATCH.
        Pendiente (fase 2, cuando se pida): bloques "vivos" del menú de
        ClickUp — mención de persona/registro, subtarea inline, imagen y
        adjuntos del módulo de archivos, embeds (YouTube/Figma/Loom/Drive),
        columnas, índice y botones.

  - [x] **Bloques vivos de la descripción — fase 2, primera mitad (v0.1.134)**:
        el documento del registro deja de ser sólo texto y empieza a apuntar a
        ENTIDADES de la app. Cuatro nodos nuevos, cada uno con su entrada en la
        whitelist compartida (si no, el backend los descartaría al guardar):
        **mención de persona** (`@` abre el buscador de miembros; se inserta un
        chip con el ID, así renombrar a alguien no rompe el vínculo — misma
        regla que las claves `f{field_id}`), **mención de registro** (comando
        `/`, buscador que cruza listas y usa la búsqueda del servidor → respeta
        el ACL: nadie menciona lo que no puede ver; el chip es un enlace que
        abre esa ficha), **imagen** y **adjunto** (suben al módulo de archivos
        propio — ADR-S16 — y se resuelven por id en cada render, así la URL
        nunca queda cableada en el documento).
        Las menciones son de verdad: llegan a la campana. `mentions.comment_id`
        pasa a nullable + columna `source` (migración 0041) porque una mención
        escrita en la descripción no cuelga de ningún comentario; se
        **re-escriben en cada guardado** (borrar la mención del texto la saca
        también del feed), se validan contra los miembros del workspace (un id
        ajeno no notifica a nadie) y no hay auto-mención.
        **Dos bugs atrapados en el E2E**: (a) el menú `/` se abría al CARGAR un
        documento que terminaba en "/" —y su capa de "click afuera" bloqueaba
        media pantalla—; ahora los menús exigen que el editor tenga el foco,
        igual que el guard del autosave de v0.1.133; (b) el layout CRM por
        plantilla no montaba la descripción, así que una lista con diseño
        propio se quedaba sin el cuerpo del registro. 2 tests de API nuevos
        (mención que notifica y se retira, bloques de archivo que conservan su
        referencia y se descartan sin ella) — 395 API y 84 front en verde —
        + E2E navegador 12/12 (menú con los grupos nuevos, `@`, chip de
        persona, buscador de registros, enlace navegable, subida de adjunto y
        persistencia de los tres tras recargar).
        Pendiente de la fase 2 (segunda mitad): embeds (YouTube/Loom/Figma/
        Drive), columnas, índice y subtarea inline.

  - [x] **Bloques vivos — fase 2, segunda mitad (v0.1.135)**: cierra el menú
        «/» con lo que faltaba del de ClickUp.
        (a) **Embeds**: se pega el enlace y queda el contenido embebido —
        YouTube, Vimeo, Loom, Figma y Google Drive/Docs/Sheets/Slides. Un
        iframe corre código de OTRO origen dentro de nuestra página, así que
        la puerta se abre por dominio conocido: `resolveEmbed` (shared, puro)
        reconoce las formas de URL de cada proveedor y devuelve la URL
        embebible; lo que no está en la lista NO genera iframe (queda como
        enlace y se avisa). Se persiste la URL ORIGINAL + el proveedor y la de
        embed se deriva en cada render (si un proveedor cambia su forma de
        embeber, no hay que migrar documentos). La CSP de los dos proxies
        (Caddy + nginx) suma `frame-src` con esos hosts — la lista vive en
        `EMBED_FRAME_HOSTS` para que el código y el deploy no se separen.
        (b) **Columnas** (2-4, apiladas bajo 640px), (c) **índice** que se
        DERIVA de los títulos en cada render (no se guarda una copia que
        quedaría desactualizada) y navega al hacer click, y (d) **subtarea
        inline**: crea un REGISTRO hijo de verdad (el modelo de v0.1.132 —
        aparece en la tabla, se filtra, se exporta) y deja su chip enlazado en
        el documento.
        **Tres bugs atrapados en el E2E**: (1) al insertar un bloque desde un
        diálogo el editor no tenía el foco y el autosave lo descartaba como
        "no lo escribió nadie" — la subtarea recién creada se perdía al
        recargar; ahora las inserciones de la propia UI se marcan explícitas
        (`applyUiEdit`). (2) La respuesta del autosave anterior RE-SEMBRABA el
        documento y deshacía lo insertado: el contenido externo ahora se
        siembra UNA vez por registro (el editor se remonta con `key` al
        cambiar de ficha). (3) `POST /lists/:l/records` comparte path con el
        listado y el adaptador lo normalizaba como página vacía → el id del
        registro recién creado llegaba `undefined` (por eso el chip de la
        subtarea salía sin destino); ahora el método decide. De yapa: zona
        clicable al final del editor — con un embed o el índice abajo, el
        click "en el editor" caía sobre ese bloque (el iframe hasta se come el
        evento) y el cursor no entraba al documento.
        5 tests unitarios nuevos en shared (formas de YouTube/Vimeo/Loom/Figma/
        Drive, `youtube.com.evil.com` rechazado, `javascript:` rechazado,
        columnas e índice sobreviven al saneo) — 395 API, 84 front y 39 shared
        en verde — + E2E navegador 15/15.

        **Con esto la fase 2 del editor queda completa.**

  - [x] **Título del registro editable + campo de título elegible (v0.1.136,
        reporte del usuario con capturas)**: el título de la ficha no se podía
        editar (había que bajar a "Campos" a cambiar el mismo valor) y el alta
        mostraba un cartel fijo "Nuevo registro". La duda de fondo —"creo que
        toma el primer campo como título, no sé si eso es correcto"— tenía dos
        respuestas: el patrón SÍ es el correcto (ClickUp/Airtable: el título es
        el campo primario, no un campo aparte), pero estaba mal implementado —
        `is_primary` NUNCA lo mandaba el backend, así que la UI caía siempre al
        primer campo de texto por posición. Ahora: (a) el campo de título vive
        en `settings.title_field_id` de la lista y el backend lo DERIVA en cada
        respuesta de campos (`resolveTitleFieldId` en shared, con el mismo
        fallback al primer texto) — `/fields`, `bootstrap` y `portal.me` marcan
        `is_primary`; el PATCH de la lista valida que sea un campo de TEXTO de
        esa lista (400 `invalid_title_field`); (b) acción **"Usar como título"**
        en el menú de cada campo de Ajustes → Campos (sólo text/long_text, y no
        en el que ya lo es), con el badge "Título" en la fila; (c) el título es
        un INPUT en las cuatro superficies: modal del registro, página del
        registro, alta (escribir ahí llena el campo, ya no es un cartel) y el
        header de las plantillas CRM (`RecordHeader` recibe `edit` opcional —
        sin él, la preview del editor de plantillas sigue de sólo lectura); de
        paso, si la plantilla no eligió campo de título, ahora cae al de la
        lista en vez de mostrar "Registro #N" con el registro ya nombrado.
        (d) **Interlineado del editor de descripción** (reporte aparte): usaba
        `.imcrm-prose`, calibrado para PROSA larga (1.65 de interlineado, 0.75em
        entre párrafos) — en una ficha de tarea se leía suelto comparado con
        ClickUp. Apretado SÓLO dentro del editor (15px, 1.5, párrafos a 0.2em →
        el renglón pasa de ~38px de paso a 25,5px); el resto de la app conserva
        su prosa. 7 tests nuevos (4 shared + 4 front; 395 API, 88 front, 43
        shared en verde) + E2E navegador 11/11 (elegir título, persistencia,
        rechazo del campo numérico, edición y guardado en modal/alta) y 3/3 del
        header por plantilla.

  - [x] **Lote de tabla, subtareas y listas (v0.1.137, 6 reportes del
        usuario)**: (a) **las líneas de fila no existían** — estaban puestas
        como `border-t` en el `<tr>` y el navegador las IGNORA: la tabla
        necesita `border-collapse: separate` (con `collapse` los headers y las
        columnas sticky pierden el borde al scrollear) y en ese modo los bordes
        del `<tr>` no se pintan. Por eso v0.1.128 "subió la opacidad" de algo
        que nunca se dibujó. Ahora la línea vive en las CELDAS, por una regla
        de `globals.css` que cubre cuerpo/cabecera/pie de las DOS tablas.
        (b) **El header no tiene bordes** (ClickUp tampoco): lo que se veía
        como separador de columna era el asa de resize pintada siempre —
        ahora aparece al pasar el mouse. (c) **"Ajustar texto" manda sobre
        select/multi_select**: los chips envolvían SIEMPRE; sin ajuste van en
        una línea recortada por el ancho de la columna, con ajuste en varias
        y la fila crece. (d) **Subtareas en TODAS las tablas**: la vista
        agrupada no las tenía porque el `grouped-bundle` armaba un DTO
        recortado que se comía `subtask_count`, `parent_id`,
        `has_description` y `relations` (los campos relation también salían en
        blanco); ahora devuelve lo mismo que el listado plano y la primera
        columna es un componente compartido (`RecordNameCell`) — el chevron,
        el icono de descripción y el menú "Crear subtarea" salen en las dos
        vistas por construcción. La fila de subtarea cambia el punto de 4px
        por el codo de sangría. (e) **Modo "Hoja de cálculo"** (toggle en
        Personalizar, persistido en la vista): numera las filas —el número
        ocupa el lugar de la casilla y le cede el paso al hover—, dibuja la
        cuadrícula vertical y NO agrupa, como la vista Tabla de ClickUp.
        (f) **Iconos por lista**: `lists.icon`/`color` existían desde F1 sin
        interfaz (el menú pintaba el mismo punto para todas); catálogo curado
        de 36 iconos + 10 colores, selector en Ajustes → General y render en
        el árbol del panel. 1 test de API (399) + E2E navegador 8/8 de la
        tabla y 8/8 de agrupada/iconos/chips.
  - [x] **Compartir una lista con una persona puntual (v0.1.138)**: cierra
        el último reporte del lote anterior. Hasta acá el acceso a una lista
        se decidía SÓLO por rol, así que para sumar a alguien había que
        cambiarle el rol en TODO el workspace — justo lo que nadie quiere
        hacer. El ACL de la lista (`settings.permissions`, sin migración)
        gana un mapa `users` (id → permisos) que **pisa** el acceso del rol
        para ESA lista: puede dar más (un agent que ve todo) o menos (alguien
        que sólo mira y con campos ocultos). `admin` queda afuera a propósito
        (siempre tiene acceso total) y el rol del workspace no se toca.
        `effectivePermissions/scopeFor/hiddenFieldsFor` reciben el `userId`
        y los cuatro caminos de `records.service` (crear, listar, leer fila,
        campos ocultos) lo pasan. Guard rail: sólo se puede compartir con
        **miembros de la empresa** — un id cualquiera se rechaza con 400
        `not_a_member`, si no quedaría un acceso guardado para alguien que no
        pertenece. `GET /lists/:l/permissions` devuelve los accesos con
        nombre y correo resueltos contra los miembros VIVOS (quien se fue no
        aparece). Front: sección "Personas con acceso" dentro de Compartir →
        Con tu equipo (buscador de miembros, nivel por persona con el mismo
        catálogo de niveles de v0.1.126, cambio y quitar). 4 tests nuevos
        (403 API en verde) + E2E navegador 8/8 (buscar, compartir, persistir,
        cambiar el nivel, quitar).

  - [x] **Repaso del lote anterior (v0.1.139, 5 correcciones del usuario)**:
        (a) **doble línea en la cabecera** — la tabla quedaba con una raya
        arriba (el `border-t` del contenedor de cada bucket) y otra abajo (el
        `border-bottom` que v0.1.137 le puso al `th`): la cabecera encajonada.
        Ahora la cabecera NO lleva línea propia en la vista de lista —como
        ClickUp, donde la primera raya es la que separa la primera fila— y sí
        la lleva en la hoja de cálculo, donde ES parte de la grilla.
        (b) **los chips cortan, no parten**: `OptionChipDisplay` no tenía
        `whitespace-nowrap`, así que "VPS en Hetzner" se rompía en dos
        renglones DENTRO del chip; ahora los dos chips (lectura y edición)
        truncan con elipsis y comparten la clase `imcrm-opt-chip`.
        (c) **el chevron de subtareas ya no corre el texto**: el hueco se
        reserva SIEMPRE (ancho fijo), así todas las filas arrancan en la misma
        x —antes sólo la fila con subtareas tenía el chevron y descuadraba la
        columna— y la subtarea se distingue por la sangría, sin el codo extra.
        (d) **la hoja de cálculo es una VISTA, no un ajuste**: aparece como
        tipo propio en "+ Vista" ("Hoja de cálculo (estilo Excel)" — por
        dentro sigue siendo una vista `table` con `config.spreadsheet`, sin
        tipo nuevo en el backend), tiene su icono en la pestaña, y sobre todo
        DENSIDAD real: 12,5px de tipografía, 2px de padding vertical,
        anulación de los `min-h` de los editores inline (fila de 29 → 25px),
        cabecera compacta sin mayúsculas y cuadrícula completa.
        (e) **icono por defecto en todas las listas**: el puntito gris
        desapareció; la lista que no eligió icono muestra el genérico.
        2 tests nuevos del round-trip de la vista (90 front en verde) + E2E
        navegador 13/13 (medición de líneas, chip de una sola línea con
        elipsis, misma x en todas las filas, densidad y numeración de la
        grilla, cero puntitos en el menú).

  - [x] **Ajuste fino de la tabla + densidad elegible (v0.1.140, 5 reportes
        del usuario)**: (a) **la línea de abajo seguía doble** — la última
        fila trae su raya y el `tfoot` sumaba un `border-top` justo debajo;
        el pie ya no dibuja línea propia. (b) **Los chips cortan con "…" al
        FINAL de la celda** (antes cada chip truncaba por su cuenta y se veían
        dos elipsis, o uno partido al medio): sin "Ajustar texto" el
        contenedor deja de ser flex y pasa a ser un BLOQUE de línea única, y
        ahí el navegador sí aplica `text-overflow: ellipsis` sobre los chips
        —que son inline-flex—; `text-overflow` no aplica a hijos de un
        contenedor flex, por eso antes no había forma. (c) **Menos aire a la
        izquierda**: la columna de la casilla pasa de 40 a 32px (padding 12→8)
        y las celdas de 12 a 8px — el nombre arranca ~20px antes. (d) **La
        casilla, centrada**: un `<input>` inline se apoya en la línea base y
        quedaba 2px sobre el centro en la vista agrupada; ahora va dentro de
        una caja flex centrada en las DOS tablas. (e) **Densidad elegible**
        (`density` en el estado común de las vistas — shared, mapeo y las dos
        tablas): Compacta / Normal / Cómoda en el panel Personalizar,
        persistida en la vista; la hoja de cálculo arranca en compacta y la
        lista en normal, pero cualquiera puede cambiarlas (25 / 37 / 49px de
        alto de fila). 2 tests nuevos (92 front en verde) + E2E navegador 9/9
        con medición de bordes, elipsis, gutter, centrado y las tres alturas.

  - [x] **Vuelta atrás de dos cambios de v0.1.140 + tamaño de letra
        (v0.1.141)**: (a) **los chips del multi_select vuelven a verse
        TODOS**. La v0.1.140 puso el contenedor en bloque con
        `text-overflow` del CONJUNTO y el resultado fue que se veía una sola
        opción y las demás desaparecían tras "…" — no es lo que hace ClickUp
        ni lo que se había pedido. Vuelve el flex de una línea: los chips se
        encogen y cada uno corta SU texto con elipsis, que es la forma en que
        el usuario lo había aprobado en v0.1.139. (b) **El codo de sangría de
        la subtarea vuelve**: lo que descuadraba la vista era el hueco del
        chevron en la fila CERRADA (ya resuelto reservándolo siempre), no el
        icono — que además gustaba. (c) **Tamaño de letra por vista**
        (`font_size` en el estado común: shared, mapeo y las dos tablas):
        Chica / Normal / Grande (12,5 / 14 / 15,5px) junto al selector de
        densidad en Personalizar, persistido igual. La hoja de cálculo
        arranca en chica y la lista en normal; la grilla ya no cablea su
        tipografía. 2 tests nuevos (94 front en verde) + E2E navegador 7/7
        (los dos chips visibles con elipsis propia, icono de subtarea
        presente, filas de primer nivel alineadas en una sola x, y la letra
        cambiando de 12,5 a 15,5px con la elección persistida).

  - [x] **Casilla clavada + panel Personalizar por tipo de vista (v0.1.142,
        2 reportes del usuario)**: (a) **la columna de la casilla seguía
        ancha** aunque en v0.1.140 se le pidieran 32px: con
        `table-layout: fixed` + `width: 100%` el navegador reparte el espacio
        sobrante ENTRE TODAS las columnas, así que la casilla terminaba en
        ~44px (el usuario lo mostró con el inspector). Se agregó un
        `<colgroup>` en las dos tablas: la casilla queda clavada en **28px**
        y el sobrante se lo lleva la última columna. (b) **El panel
        "Personalizar vista" mostraba TODO en todas las vistas** — densidad,
        letra, ajustar texto, hoja de cálculo y columnas no significan nada
        en kanban, calendario ni tarjetas, y ver controles que no hacen nada
        confunde. Ahora el panel recibe el `viewType`: los ajustes de tabla
        sólo salen en la tabla (incluida la agrupada), la hoja de cálculo
        además desaparece cuando hay agrupación (son excluyentes), y en las
        otras vistas quedan sólo Filtro + las acciones de la vista y de la
        lista. E2E navegador 14/14 (ancho real de la casilla, y el panel
        abierto en tabla, kanban, calendario, tarjetas y agrupada).

  - [x] **Los paneles laterales se pueden cerrar en el teléfono (v0.1.143,
        reporte del usuario)**: "Personalizar vista" no tenía salida en
        celular. El contenedor compartido de los paneles (`SheetContent`) no
        dibujaba ninguna X — cada panel tenía que acordarse de poner la suya
        en su cabecera, y tres no lo hacían (Personalizar vista, Mencionar
        registro, Nueva subtarea). En escritorio no se notaba porque queda
        velo alrededor para tocar afuera y está la tecla Escape; en el
        teléfono el panel ocupa TODA la pantalla, así que sin X no hay forma
        de volver. En vez de agregarla panel por panel —que es justo lo que
        se venía olvidando— ahora la pone el contenedor: cada
        `SheetCloseButton` que un panel dibuje en su cabecera se anuncia,
        y la de respaldo se monta sólo si no hubo ninguna (los efectos de
        los hijos corren antes que el del contenedor, así que no hay un
        fotograma con dos X). Objetivo táctil de 36px. E2E navegador 9/9 en
        390×844 y escritorio (una sola X, dentro de pantalla, cierra, no se
        monta sobre el título), 3/3 de no-duplicación (modal del registro,
        historial de automatizaciones, panel de empresa de la consola) y 3/3
        de los paneles del editor de descripción.

  - [x] **Los chips cortan con "…" de verdad (v0.1.144, reporte del usuario
        con captura)**: desde v0.1.139 el chip llevaba la elipsis puesta,
        pero el navegador la IGNORABA y el texto salía cortado a cuchillo.
        Causa: `text-overflow` **no aplica a un contenedor flex**, y el chip
        es `inline-flex` (lo necesita para alinear su contenido) — el texto
        queda como ítem anónimo del flex, no como línea de un bloque, así que
        no hay dónde dibujar los tres puntos. Verificado en el navegador con
        una página mínima: mismo chip en `inline-flex` → corte seco; con el
        texto en un span interno → "Gestión si…". Fix: el label va en un
        `<span class="truncate">` propio dentro del chip, en las DOS
        superficies (`OptionChip` de la tabla y `OptionChipDisplay` del
        OptionPicker). Lo aprobado en v0.1.141 se conserva: se ven TODAS las
        opciones, cada una se achica y corta su propio texto; con "Ajustar
        texto" siguen envolviendo completas. E2E navegador 7/7 con las
        etiquetas exactas del reporte (dos chips de 90 y 83 px, ambos con
        elipsis pintada, select simple igual, wrap intacto).

  - [x] **Menú flotante al pasar el mouse + 3 ajustes de chrome (v0.1.145,
        4 pedidos del usuario con capturas de ClickUp)**: (a) **hover en el
        riel → el contenido de esa sección aparece FLOTANDO** sobre el área
        de trabajo, sin navegar ni abrir el panel (retardo de 120 ms para
        abrir y 180 para cerrar, así no parpadea al cruzar el riel; se va al
        navegar Y al clickear adentro —clickear el item en el que ya estás no
        cambia la ruta y el panel quedaba tapando el contenido—). Sólo flota
        lo que NO estás viendo ya acoplado. El contenido del panel se extrajo
        a UNA función que usan las dos superficies, así lo que se agregue sale
        en ambas por construcción. (b) **Los toggles se mudaron a donde se los
        busca**: con el panel cerrado, el botón de abrirlo va ARRIBA del riel
        (bajo el logo, con hairline); con el panel abierto, el de cerrarlo va
        en la CABECERA del panel — antes ambos vivían al fondo del riel.
        (c) **Los dashboards del menú llevan icono**, no el puntito genérico:
        el que elija quien lo crea (fila "Icono" nueva en la configuración del
        dashboard, MISMO catálogo que las listas —un solo vocabulario de
        iconos en la app— guardado en `settings.icon/color`, que es un record
        permisivo: cero backend) o el genérico de tablero. La página y el
        panel de Favoritos también muestran el icono real de cada anclado.
        (d) **"Personalizar" pasa a ser sólo el icono y se mudó a la derecha,
        después del buscador**: es un ajuste ocasional y no tiene por qué
        competir con Filtrar, que sí se usa a diario. E2E navegador 21/21
        (flotante aparece/cierra/no duplica al activo, botones arriba y en la
        cabecera, iconos sin puntos, botón icon-only a la derecha del
        buscador y antes de "Nuevo registro") + 2/2 del picker de icono
        (elegir → persiste con su color tras recargar).

  - [x] **Fix: el menú flotante quedaba DEBAJO del contenido (v0.1.146,
        reporte del usuario con captura)**: las tarjetas y botones de la
        página se dibujaban encima del panel flotante de v0.1.145. No era el
        z-index: el contenedor del sidebar lleva `translate-x` (el drawer de
        mobile) y **un transform crea un contexto de apilado**, así que el
        `z-40` del flotante sólo competía DENTRO del sidebar; hacia afuera el
        sidebar se apila por orden de DOM, y como viene antes que el
        contenido, cualquier elemento posicionado del área de trabajo le
        quedaba encima. Fix: el flotante se monta por **portal al `<body>`**,
        fuera de ese contexto (mismo camino que usan los diálogos de Radix,
        que sí aparecían bien). E2E navegador 9/9 en Plataforma, Registros y
        Dashboards: barrido de 40 puntos por pantalla verificando que ningún
        elemento del contenido pinta sobre el panel, y que cuelga del body.
        Modo oscuro comprobado: el flotante y el panel acoplado comparten
        fondo (`rgb(13,14,18)`) — el portal no se queda sin los tokens del
        tema porque viven en `:root`.

  - [x] **Barras de scroll propias (v0.1.147, pedido del usuario mirando
        ClickUp)**: las del sistema son anchas, cuadradas y con flechas; en una
        app densa (tabla ancha + panel + área de trabajo) comen espacio y
        ensucian. Ahora son finas (10px de riel, thumb de 6px por el truco de
        `border: 2px solid transparent` + `background-clip: padding-box`, que
        deja el área de agarre cómoda), redondeadas, con pista transparente y
        thumb que se marca al pasar el mouse y al arrastrar. El tinte sale de
        `--imcrm-muted-foreground`, así que el **modo oscuro se resuelve solo**;
        el riel de la marca (oscuro por diseño en tema claro) lleva su propia
        clase `imcrm-scroll-on-dark` con blanco translúcido. **OJO con mezclar
        las dos APIs**: en Chrome moderno declarar `scrollbar-width` DESACTIVA
        los `::-webkit-scrollbar` (la propiedad estándar gana), así que las
        estándar van dentro de `@supports not selector(::-webkit-scrollbar)` —
        o sea, sólo Firefox. Se conservan la barra espejo del fondo (v0.1.75) y
        el ocultamiento de la nativa del wrapper (v0.1.82): sigue habiendo UNA
        sola barra horizontal. **Límite de la verificación**: el Chromium
        headless del entorno NO pinta scrollbars personalizados (un thumb rojo
        de prueba sale blanco y el riel no reserva ancho), así que el aspecto
        final se comprueba en el navegador del usuario; acá se verificó lo
        verificable (reglas aplicadas, `@supports` correctamente inerte en
        Chrome, riel con su tinte, espejo intacto, nativa en 0px).

  - [x] **Fondo del modo oscuro a #121212 (v0.1.148, pedido del usuario)**:
        el fondo era `224 16% 8%` = **#111318**, un navy muy apagado heredado
        del bloque dark del plugin. Ahora es el **gris neutro #121212**
        (`0 0% 7%`). Las superficies vecinas se neutralizan CON él —tarjeta,
        popover, canvas, riel por defecto, muted/accent/borde/input y las
        tintas de texto—: un fondo gris puro con tarjetas azuladas se lee como
        un error de color, no como una decisión. Se conservan EXACTAS las
        distancias de luminancia de la escala (canvas #0d0d0d < fondo #121212
        < tarjeta #171717 < muted #262626 < borde #2b2b2b), así la jerarquía y
        el contraste no cambian: sólo el tinte. Lo que NO se toca es el color
        con significado —primary, éxito/aviso/info, los tones de los tiles y
        los chips de opciones— ni el riel cuando el tenant tiene white-label
        (ese lo re-tiñe `brandVars` con su hue, como siempre). Verificado en
        el navegador: `--imcrm-background` = #121212 exacto, las cinco
        superficies del tema con R=G=B, la jerarquía intacta y una auditoría
        de contraste WCAG sobre la tabla sin un solo texto por debajo de
        4.5:1 (5/5).

  - [x] **Actividad del registro detallada, estilo ClickUp (v0.1.149,
        reporte del usuario)**: el feed decía sólo `record_updated · por
        usuario #2`. La causa era otra vez un desencuentro de shapes: la UI
        seguía esperando el del plugin (`record.updated` + `changes.fields`
        por slug) mientras el backend escribe `record_updated` + `diff` por
        clave `f{id}` — así que ni el verbo ni el detalle matcheaban y el
        diff, que SIEMPRE estuvo guardado, no se mostraba. Ahora: (a) el DTO
        trae `user_name` (leftJoin en la misma query, como la bitácora — no
        una request por entrada); el portal del cliente lo manda en `null` a
        propósito: nombrar al empleado ante el cliente es otra decisión.
        (b) `activityText.ts` traduce el log a lenguaje humano —resuelve
        `f101`→«Estado» contra el catálogo de campos (sin catálogo cae a la
        clave cruda: mejor "cambió f101" que esconder el cambio), distingue
        **estableció / cambió / vació**, y formatea cada valor como en la
        ficha (fechas y números con el formato regional de la empresa,
        opciones con su ETIQUETA, checkbox Sí/No)—. (c) El panel se reescribió:
        avatar de iniciales, frase por cambio ("SF cambió Razón social de
        ~~Acme, S.A.~~ a E2E título 75014"), chips con el color real de la
        opción, valor anterior tachado y hora relativa con la exacta en el
        title; el timeline del layout CRM usa el mismo formateador en una
        línea. (d) De paso, `activityKeys` tenía el segmento 'list' de más que
        rompió las automatizaciones en v0.1.85 → el feed no se refrescaba
        nunca al editar; el id vuelve al índice 1 y las mutaciones de record
        lo invalidan. 8 tests unitarios del formateador + 2 del contrato de
        keys (103 front) + assert del `user_name` en el spec de la API. E2E
        navegador 7/7 (cero "record_updated", cero "por usuario #N", nombre,
        campo, valores y hora relativa).

  - [x] **Auditoría del envío de correo — el SMTP ya no falla en silencio
        (v0.1.150, reporte del usuario: "configuro SMTP y no envía")**: el
        camino feliz funcionaba (verificado con un servidor SMTP de prueba:
        botón de prueba, magic link y automatización entregaron), pero **todo
        fallo degradaba a un "enviado" mentiroso**. Reproducido exacto: con la
        contraseña guardada cifrada con OTRA `SECRETS_KEY` (la clave cambió
        entre el guardado y hoy), `getForSend` capturaba el error, se caía al
        SMTP de plataforma y de ahí al transporte `log` → el botón "Probar
        envío" respondía `{"ok":true}` y el correo moría en el logger. Además
        `GET /workspaces/current/smtp` tiraba 500 y el panel del front **se
        oculta ante cualquier error**, así que la tarjeta de SMTP desaparecía
        de Ajustes; y guardar sin reescribir la contraseña también 500 → no
        había forma de recuperarse desde la UI. Arreglos: (a) los dos niveles
        (empresa y plataforma) distinguen **no configurado** de **configurado
        pero inusable**, y el segundo **LANZA** en vez de degradar — un SMTP
        configurado nunca cae al `log`; (b) el GET informa
        `password_unreadable` y el panel lo dice ("tus correos no se están
        enviando… escribí la contraseña de nuevo") en vez de desaparecer;
        guardar con contraseña vacía en ese estado se rechaza con
        `smtp_password_required`; (c) `send_email` de automatizaciones y el
        magic link del portal pasan a **envío en el acto**: el motor ya corre
        en su propio worker, así que no se pierde resiliencia y a cambio el
        error queda donde el usuario lo busca — el run figura `failed` con el
        motivo del SMTP, y el botón de acceso al portal avisa "el enlace se
        generó, pero el correo no salió: …" (antes decía "enviado" siempre por
        un `.catch(() => undefined)`); (d) el transporte `log` avisa con WARN
        en producción que el correo NO salió por falta de SMTP; (e) timeouts
        de nodemailer (10s conexión / 20s socket) — sin ellos un host mal
        escrito colgaba el botón de prueba dos minutos y bloqueaba el worker.
        7 tests del SMTP por empresa (incluida la recuperación completa) + 1
        del run fallido de automatización — 408 API y 103 front en verde; E2E
        contra un servidor SMTP real: config rota → error accionable en las 3
        superficies, reescribir contraseña → entrega verificada en el servidor.

  - [x] **Diagnóstico de conexión SMTP (v0.1.151, reporte del usuario: "le
        coloco los datos y responde con Connection timeout")**: ese mensaje ya
        es el error REAL del servidor —no logra abrir el TCP contra el SMTP—,
        pero no le sirve a nadie: no distingue host mal escrito de puerto
        equivocado, de TLS mal elegido, o de que el proveedor del VPS bloquee el
        correo saliente (Hetzner, DigitalOcean, Oracle, Google Cloud y AWS lo
        hacen por defecto: es la causa nº 1). Ahora hay un botón **"Diagnosticar
        conexión"** que prueba DESDE EL SERVIDOR —la única máquina cuya
        conectividad importa— los cuatro puertos SMTP (25/465/587/2525) más el
        configurado, lee el saludo (`220 …`) y devuelve un veredicto con
        consejos accionables: `ok` / `tls_mismatch` (conecta pero la casilla de
        seguridad no corresponde al puerto) / `port_closed` (ese no, pero otro
        sí → sugiere cuál) / `all_blocked` (nadie responde → apunta al bloqueo
        del proveedor y a pedir el desbloqueo o usar el 2525) / `dns_failed`
        (con la ayuda de "sacá el http://" y "eso es un email, no un host").
        Se diagnostica lo que hay en el FORMULARIO —no hace falta guardar una
        config rota primero— vía `POST /workspaces/current/smtp/diagnose`
        (admin). Alcance acotado a propósito: sólo esos puertos y nunca contra
        direcciones link-local (169.254.0.0/16, fe80::/10 — donde viven los
        endpoints de metadata de las nubes); las privadas SÍ se prueban porque
        un relay interno es legítimo y el envío real también llega ahí. Además:
        (a) el **puerto y la casilla "Conexión segura" se sincronizan solos**
        (465 → TLS implícito ON; 25/587/2525 → STARTTLS OFF) con aviso inline
        si el usuario los descasa a mano — la mezcla es la causa clásica del
        timeout; (b) el error del botón "Probar envío" se traduce a algo
        accionable (timeout → "tocá Diagnosticar"; 535 → credenciales; 550 →
        remitente), conservando el texto original. 10 tests de API (veredictos
        puros + sockets reales + link-local) y 8 del front (418 API, 111 front
        en verde) + E2E navegador 14/14 y por curl contra un SMTP local (sink
        alcanzable, puerto equivocado, TLS cruzado, host inexistente, metadata
        bloqueada).

  - [x] **Cuota mensual de correos por plan (v0.1.152, ADR-S18, pedido del
        usuario: "que no usen mi app como plataforma de mailing")**: los correos
        que un cliente manda SIN SMTP propio salen por el servidor de la
        PLATAFORMA — los paga el operador, y peor: queman la reputación del
        dominio remitente compartido. Ahora cada plan tiene `max_emails_month`
        (columna nueva en `plans`, NULL = ilimitado, editable desde la consola;
        semilla trial 100 / starter 1.000 / pro 10.000 / enterprise ∞) y el
        contador vive en `email_usage` (tenant + período `YYYY-MM` en UTC, RLS,
        migración 0042). **Con SMTP propio configurado no hay cuota ni
        contador**: esos correos no pasan por nuestra infraestructura, así que
        el límite es la palanca comercial —"si necesitás más, configurá tu
        servidor"— en vez de un muro. El chequeo corre ANTES de entregar (el
        correo que excede no se manda) y el contador se suma DESPUÉS del envío
        exitoso (un correo que no salió no se cobra); en la cola de BullMQ el
        fallo se marca `UnrecoverableError` —el mes no cambia en dos segundos,
        reintentar es desperdicio— y el error llega a donde el usuario lo
        busca: el run de la automatización queda `failed` con el motivo y el
        botón de acceso al portal lo muestra. Los correos de **cuenta** (reset
        de contraseña, verificación de email, invitaciones de plataforma) no
        tienen tenant y NUNCA se limitan: frenarlos dejaría a alguien afuera de
        su propia cuenta. Superficies: barra "Correos este mes" en Ajustes →
        Plan y uso (con la salida por SMTP propio explicada), columna
        "Correos/mes" editable en la card Planes de la consola y fila en el
        detalle de cada empresa. 6 tests nuevos (424 API en verde), incluido
        uno con un **SMTP real levantado en el test** que prueba que el correo
        por servidor propio sale y no consume cuota; E2E por curl (segundo
        envío rebotado con el mensaje accionable) y navegador 9/9.

  - [x] **Portal del cliente: acceso visible y "todo lo relacionado a mí"
        (v0.1.153, reporte del usuario: "coloco un correo pero no veo que quede
        registrado… ¿cómo se relacionan los clientes de las listas?")**. Dos
        huecos distintos:
        (a) **El acceso SÍ quedaba guardado** (`portal_links` desde F3, un
        cliente = un registro por empresa), pero la ficha no lo mostraba: había
        que re-tipear el email en cada envío sin saber si el cliente ya tenía
        acceso ni si llegó a entrar. Ahora la tarjeta lista **quién tiene
        acceso**, con "Última entrada" (columna `portal_links.last_access_at`,
        migración 0043, que se estampa al canjear el enlace) o "Todavía no
        entró" — que es justo lo que hay que saber cuando el cliente dice que
        no le llegó. Botones **Reenviar enlace** (sin re-escribir nada) y
        **Quitar acceso** (borra el vínculo, la membresía `client` y **revoca
        sus sesiones al instante**). El input de email sólo aparece la primera
        vez. Endpoints `GET /lists/:l/portal/access?record_id=` y
        `DELETE /lists/:l/portal/access/:userId` (`manage_lists`).
        (b) **Cross-list**: el motor ya sabía acotar OTRAS listas al cliente
        (`portalScope`: campo `relation` hacia su registro, o campo `user`),
        pero sólo se llegaba diseñando bloques en la plantilla. Ahora el panel
        del portal tiene **"Qué más ve el cliente"**: el backend DETECTA las
        listas vinculadas (`GET /lists/:l/portal/related-options`, mismo
        criterio que el scope — si no aparece ahí, no habría forma de saber qué
        filas le pertenecen) y el admin marca cuáles mostrar
        (`settings.portal.related_lists`). **Opt-in, fail-closed**: sin
        elección explícita el cliente no ve ninguna otra lista — una lista
        interna que apunte al cliente (comisiones, costos) no tiene por qué
        serle visible. `portal.me` devuelve `related_lists` y el SPA renderiza
        una sección por lista con SUS registros (el listado del portal ya
        filtraba por scope y quitaba los campos ocultos del rol `client`; ahora
        además devuelve las etiquetas de las columnas visibles). 3 tests de API
        nuevos (427 en verde) + E2E navegador 10/10 en el admin (detección,
        persistencia de la elección, alta de acceso que queda listada y
        sobrevive al reload) y 4/4 en el portal real (magic link → ficha +
        "Tareas Portal" con las 2 tareas del cliente y ninguna ajena).

  - [x] **El cliente vuelve a entrar solo (v0.1.154, pregunta del usuario:
        "¿cómo ingresa después si el link dura 24 h?")**: el magic link vence a
        las **24 h** y es de un solo uso, pero al canjearlo abre una **sesión de
        30 días DESLIZANTES** (`getex` renueva el TTL en cada request) — o sea
        que un cliente que entra cada tanto no necesita nada más. Faltaba el
        caso borde: 30 días sin entrar, cerró sesión, cambió de dispositivo o le
        revocaron y volvieron a dar acceso. Antes eso era un cartel muerto
        ("pedí uno nuevo") que obligaba a llamar a la empresa. Ahora la pantalla
        del portal sin sesión **es un formulario**: el cliente escribe su correo
        y `POST /portal/request-access` (público) le manda un enlace nuevo.
        Reglas: **nunca crea accesos** —sólo re-emite para quien la empresa ya
        autorizó (`portal_links`)—, la respuesta es **siempre la misma** exista o
        no el email (no sirve como directorio de "quién es cliente de quién"),
        se saltea usuarios desactivados, y hay freno por email en Redis (3 cada
        15 min, compartido entre nodos) además del rate limit por IP. Un email
        con portal en varias empresas recibe un enlace por cada una (cap 3), con
        el nombre en el asunto. La emisión se extrajo a `sendMagicLink` — el
        botón del admin y el auto-servicio comparten el MISMO camino (incluida
        la cuota de correo de ADR-S18 y el SMTP propio del tenant). 1 test de
        integración (email sin acceso no manda nada, con acceso manda y el
        enlace abre sesión, y el freno corta el 3.º) — 428 API y 111 front en
        verde — + E2E navegador 6/6 contra un SMTP real (pantalla, envío,
        entrega verificada en el servidor, el enlace entra y la sesión persiste
        al volver).

  - [x] **Constructor y probador de webhooks + fix del "Personalizado…"
        (v0.1.155, 3 reportes del usuario)**:
        (a) **"Personalizado…" del trigger `due_date_reached` no hacía nada** al
        clickearlo. El `<select>` está CONTROLADO por `offset_minutes`, así que
        al elegir esa opción el handler no cambiaba nada y el valor volvía solo
        al preset anterior — el input de días nunca aparecía. Ahora la elección
        manual vive en su propio estado (y arranca encendida si el offset
        guardado no coincide con ningún preset).
        (b) **Constructor de webhooks salientes**: la acción `call_webhook` era
        una URL + un cuadro de texto para escribir el cuerpo a mano, y el
        content-type estaba cableado en `application/json` — imposible pegarle a
        una API que pide `x-www-form-urlencoded` (el caso del usuario: un
        gateway de WhatsApp con `secret`, `account`, `recipient`, `message`).
        Ahora hay **tipo de contenido** (JSON o formulario) y **filas
        clave/valor** para cuerpo, **cabeceras** y **parámetros de la URL**, con
        merge tags en cada valor; el cuerpo crudo queda como opción avanzada y
        el secreto de firma HMAC pasa a la sección plegada. La petición la arma
        `buildWebhookRequest` (PURO): lo que se prueba es literalmente lo que
        después ejecuta el motor. Configs viejas siguen andando (headers como
        objeto plano, `body_template`).
        (c) **Probador ("Probar ahora")**: `POST /lists/:l/automations/
        test-webhook` (`manage_automations`) resuelve las variables contra un
        registro REAL de la lista (el indicado o el último), ejecuta la petición
        con el guard anti-SSRF de SEC-03 y devuelve **lo que se envió y lo que
        contestaron** (status + cuerpo, capado a 4 KB — `safeWebhookFetch` ganó
        `captureBody`). Un destino bloqueado o caído es un RESULTADO con su
        motivo, no un 500: el usuario lee "SSRF: destino de red interna
        bloqueado" o el timeout en la misma tarjeta.
        (d) De paso, el portal: `/portal/acceso` **sin token o con uno vencido**
        terminaba en un cartel muerto; ahora cae en la misma pantalla de
        auto-servicio de v0.1.154 (el cliente se manda un enlace nuevo).
        7 tests nuevos (6 unitarios del builder —form/JSON/headers/query/firma/
        shape legacy— y 1 de integración del probador con registro de muestra y
        destino bloqueado): 435 API y 111 front en verde. E2E navegador 13/13
        (Personalizado abre el input y persiste, constructor completo, prueba
        real con el cuerpo `{"recipient":"+57…"}` y el motivo del bloqueo).

  - [x] **Cajas de texto que crecen en las automatizaciones (v0.1.156,
        reporte del usuario: "¿y si el campo que quiero enviar es un texto
        largo? un renglón casi no es útil")**: el valor de cada fila del
        constructor de webhooks era un `<input>` de una línea — un mensaje de
        WhatsApp con variables no se podía ni leer ni revisar. `MergeTagInput`
        gana `autoGrow`: el textarea **crece con el contenido** (recalculado en
        cada cambio y AL MONTAR, así una automatización guardada se abre con el
        mensaje entero a la vista), con tope de 320px —a partir de ahí
        scrollea— y `resize-y` para agrandarlo a mano. Aplicado a: las filas
        clave/valor del webhook (cuerpo, cabeceras, query), el cuerpo crudo, y
        el mapeo de `create_record`/`update_field` cuando el campo destino es
        `text`/`long_text`. Los valores cortos (URL, asunto, número, fecha)
        siguen en una línea: crecer ahí sería ruido. E2E navegador 4/4 (es
        textarea, crece 80→96→196px al escribir, se ve el texto completo sin
        scroll interno, y se puede arrastrar).

  - [x] **Fix del 411 en webhooks salientes + tipos de contenido completos
        (v0.1.157, reporte del usuario con la respuesta cruda del servidor)**:
        (a) **BUG REAL nuestro**: `safeWebhookFetch` escribía el cuerpo sin
        `Content-Length`, y node:http entonces manda `Transfer-Encoding:
        chunked` — Apache/PHP y varios gateways de WhatsApp/SMS contestan
        **411 Length Required** sin leer el body. Reproducido con un servidor
        local (`{te:'chunked', cl:null}` sin la cabecera; `{te:null, cl:'7'}`
        con ella). `withContentLength` (puro, exportado) la agrega SIEMPRE que
        hay cuerpo, con `Buffer.byteLength` —bytes, no caracteres: `a=ñ` son 4
        y contar caracteres cortaría el cuerpo— y respeta la del llamador.
        (b) **Tipos de contenido**: eran 2 (JSON y urlencoded) y ahora son 6,
        alineados con lo que ofrecen las herramientas de automatización —
        JSON, **x-www-form-urlencoded**, **multipart/form-data** (boundary
        armado acá; SÓLO campos de texto: subir archivos por webhook no está
        soportado y ofrecerlo a medias sería peor), **text/plain**,
        **application/xml** y **text/html**. Los tres últimos se escriben a
        mano (en un XML no aplica "una fila por dato"), así que el editor
        cambia solo a cuerpo crudo y esconde el toggle de filas.
        5 tests nuevos (bytes vs caracteres, GET/HEAD sin cabecera, no pisar la
        del llamador, chunked verificado contra un servidor real, multipart y
        text/xml) — 440 API y 111 front en verde; E2E navegador 6/6 del
        selector. **OJO al restaurar specs**: `safe-fetch.spec.ts` YA existía
        (los tests del guard SSRF de SEC-03) y se sobrescribió por accidente;
        se recuperó con `git checkout` y los nuevos se APENDIERON. El síntoma
        fue el contador de tests BAJANDO (436 → 433) con el mismo número de
        archivos.

  - [x] **Cuatro tipos de campo que faltaban (v0.1.158, reporte del usuario:
        "no hay campo teléfono… revisá si se nos pasó alguno")**: se auditó el
        catálogo contra ClickUp y Airtable. Faltaban cuatro que están en las
        dos, y ahora existen end-to-end (shared → API → las ~15 superficies
        del front):
        (a) **Teléfono** con **indicativo de país** — el valor se guarda en UNA
        cadena canónica E.164 (`+573001112233`), no en dos columnas: así es
        comparable, buscable y sale listo para `tel:`, WhatsApp y webhooks sin
        re-armarlo (el caso del propio usuario). El indicativo se DERIVA del
        valor (`splitPhone`, gana el prefijo más largo: `+1809` es Dominicana,
        `+1` EE.UU.), así que cambiarle el país por defecto al campo no
        invalida lo ya guardado. `normalizePhone` limpia la puntuación humana,
        traduce `00`→`+` y a un número local le pone el indicativo del país
        configurado (quitando el 0 de tronco); **sin país configurado no
        inventa uno**: guarda los dígitos tal cual, porque atribuirle un país
        equivocado al dato de un cliente es peor que dejarlo incompleto.
        Catálogo curado de 58 países (América completa, Europa occidental,
        destinos frecuentes) en `shared` — un país que no esté igual se escribe
        con `+`. En la tabla el número NO es un enlace entero (si lo fuera, el
        click de la celda lo comería y el teléfono sería el único campo que no
        se puede corregir en línea): texto plano + icono de llamar al hover,
        como ClickUp; en la ficha y el portal sí es enlace `tel:`.
        (b) **Calificación** (estrellas / corazones / llamas, 1-10),
        (c) **Porcentaje** (0-100 con barra de avance) y (d) **Duración**
        (`1h 30m`, `1:30` o `90` — se guarda en MINUTOS). Los tres son
        NÚMEROS a propósito: filtran, ordenan y se agregan con el motor
        numérico que ya existía (si fueran texto, `'9' > '10'` y el filtro
        mentiría en silencio) — de ahí que sumar horas de un proyecto o
        promediar la satisfacción salgan gratis en el pie de la tabla y en
        los widgets.
        Backend: QueryBuilder (`::numeric`), índices de expresión (btree para
        los tres + trgm para el teléfono), **búsqueda server-side incluye
        `phone`** (buscar por teléfono es LO que se hace en un CRM), agregados,
        detección de tipo al importar (exige `+`/`00` o separadores: un número
        pelado de 10 dígitos es indistinguible de una cifra y ahí gana
        `number`), conversión de tipo que escribe **lo que la persona LEÍA**
        (`duration`→texto da `1h 30m`, no `90`) y CSV export igual.
        Front: catálogo del modal de creación, iconos por tipo, editores de
        config, celda editable (la calificación se pone con UN click en la
        estrella, como select), ficha/modal, formulario de alta, filtros,
        edición masiva, mapeo de automatizaciones, tabla de dashboards y
        portal del cliente. 17 tests nuevos en shared + 5 de integración en la
        API (445 en verde) + E2E navegador 17/17.
        **Lo que NO entró, y por qué**: *ubicación/dirección* (sin geocoder es
        un texto y con geocoder es una integración aparte), *código de barras*
        y *botón* (nichos), *autonumérico* (el registro ya tiene su ID) y
        *creado por / fecha de creación* (ya son metadata de la fila, se ven
        en la tabla). El hueco real que queda es **rollup / lookup / count**
        —traer o agregar un valor a través de un campo `relation`—: es una
        feature propia (necesita resolver la relación en el motor de lectura),
        no un tipo más, y merece su release.

  - [x] **Selector de país del teléfono, estilo ClickUp (v0.1.159, reporte del
        usuario con captura)**: la v0.1.158 puso un `<select>` nativo y tenía
        tres problemas, todos reales: (a) **era imposible cambiar el país** —
        al abrir el desplegable el navegador le saca el foco al input, y el
        `onBlur` de la celda cerraba el modo edición, así que se cerraba solo;
        (b) **clickear el valor abría la app de llamadas** en vez de editar,
        porque el número entero era un `<a href="tel:">` (en la ficha del
        registro seguía siéndolo); (c) ocupaba **104 px** de ancho.
        Ahora es lo que hace ClickUp: **una bandera de 28 px** que abre un
        popover con **buscador**, y el número al lado. El foco se maneja para
        TODO el control (`onBlur` en el contenedor, con guard de "el popover
        está abierto" y chequeo de `relatedTarget`) — el popover está
        portaleado al `<body>`, así que sin eso elegir el país cancelaba la
        edición. El valor sigue siendo la MISMA cadena canónica: la bandera y
        el número son dos controles de un solo dato.
        En lectura: bandera + número nacional (el país ya lo dice la bandera,
        así ocupa menos) y el `tel:` se mudó a un **icono aparte** que aparece
        al pasar el mouse — nadie llama sin querer y la celda se puede editar
        como cualquier otra. El portal del cliente (sólo lectura) conserva el
        número entero como enlace.
        De paso el catálogo pasó de 58 países curados a los **233** con
        indicativo asignado (con buscador, una lista larga no molesta, y
        cortarla obligaba a escribir el `+` a mano justo a quien tenía el
        cliente en el país que faltaba): banderas DERIVADAS del ISO2 (los
        indicadores regionales son las letras desplazadas — cero emojis que
        mantener), búsqueda por nombre sin acentos, por ISO2 y por indicativo,
        y el país actual primero con su check. Los indicativos compartidos
        (+1 EE.UU./Canadá, +44 Reino Unido/Jersey/Man) tienen dueño canónico
        explícito: antes lo decidía el orden alfabético de la lista.
        6 tests nuevos en shared (66) + E2E navegador 15/15 del control
        (incluido "no se disparó ninguna llamada" y "elegir el país no cierra
        la edición") y 16/16 de los cuatro tipos.

  - [x] **Gestión de campos estilo ClickUp (v0.1.160, pedido del usuario con
        capturas)**: cinco cosas que ClickUp tiene en la interfaz de la lista
        y nosotros teníamos a medias o repartidas en otras pantallas.
        (a) El **"+" de agregar columna queda FIJO** a la derecha del header
        (sticky) en la tabla plana y en la agrupada: con muchas columnas
        estaba al final del scroll horizontal y había que arrastrar para
        encontrarlo.
        (b) **Panel lateral "Campos"** (`FieldsPanel`) para el alta: buscador,
        tipos agrupados en **Populares** y **Todos**, y —lo que de verdad
        resuelve la duda— una **vista previa** de cómo se verá la celda
        (`FieldTypePreview`, una maqueta por tipo: chips de colores, estrellas,
        barra de avance, bandera + número…) junto a la descripción, al pasar
        el mouse. Al elegir el tipo, el mismo panel muestra la preview y el
        form. El engranaje abre el **administrador de campos**.
        La pestaña **"Copiar de otra lista"** es nuestro equivalente honesto al
        "Agregar existente" de ClickUp: allá un campo es una entidad del
        workspace que vive en varias listas; acá un campo pertenece a UNA
        lista (`fields.list_id`), así que compartir la entidad sería otro
        modelo de datos — copiar la definición (tipo + config + opciones) da
        el resultado que la gente busca sin mentir sobre lo que hay debajo.
        (c) **Menú de la columna completo**, y cada item cablea a algo que YA
        existía pero sólo se alcanzaba desde otra pantalla: ordenar
        ascendente/descendente (con un handler propio — el click en el header
        CICLA asc→desc→sin orden, el menú fija la dirección pedida),
        modificar, cambiar el nombre, privacidad y permisos, mover al inicio /
        al final (reordena `position`, persistente para toda la lista, y
        sincroniza el `columnOrder` de la vista), **calcular** (abre el
        selector de agregado de ESA columna en el pie, vía `openSignal`),
        automatizar, ocultar columna, duplicar, copiar ID y eliminar.
        **OJO**: el id de columna de TanStack es el **slug** del campo, no
        `field_{id}` (que es el formato del sort del backend) — mezclar los
        dos dejaba "Ocultar columna" sin efecto.
        (d) **Administrador de campos** (Ajustes → Campos): filtro por tipo y
        **agrupar por tipo** (como el "Administrador de campos personalizados"
        de ClickUp), y `?field=<id>` abre ese campo directo.
        (e) El cuadro de edición del campo gana un **botón "Ajustes
        avanzados"** (era un link de texto chico) que lleva al administrador
        con ese campo abierto; de paso el diálogo quedó SÓLO para editar —el
        alta se mudó al panel— y se eliminó su paso de catálogo, que había
        quedado inalcanzable. E2E navegador 28/28 (sticky real medido al
        scrollear, panel, preview al hover, alta end-to-end, los 12 items del
        menú, ocultar columna, filtro/agrupado del administrador y el deep
        link) + 4/4 del cuadro de edición y su botón.

  - [x] **Repaso de v0.1.160 (v0.1.161, 3 reportes del usuario)**:
        (a) **la vista previa del tipo de campo no se veía**: era una tarjeta
        posicionada en absoluto DENTRO del panel lateral, así que el
        `overflow` del panel la recortaba y su velo la tapaba. Ahora es un
        `Popover` de Radix portaleado al `<body>` (el mismo camino que usan
        los diálogos, que sí se veían), anclado a la izquierda del ítem, sin
        capturar el puntero. Medido en el navegador: `240×115` visible y
        `elementFromPoint` sobre su centro devuelve la propia preview.
        (b) **"Automatizar" llevaba al editor vacío**, con el trigger por
        defecto y nada más — "entonces no tiene sentido". Ahora navega con el
        campo en la URL (`?action=update_field&field=<id>`) y el editor
        arranca NOMBRADO («Establecer «Satisfacción»») y con la acción
        "Actualizar un campo" ya cargada para esa columna y ABIERTA, como el
        "Establecer campo personalizado" de ClickUp. **OJO**: el estado
        inicial del editor se fija una sola vez (`useState` + `key`), así que
        el catálogo de campos entró en la espera de carga — montar con los
        campos a medio traer dejaba la automatización vacía para siempre.
        (c) **El administrador de campos era una lista con filtros**: ahora es
        una TABLA con columnas alineadas (Nombre · Tipo · Propiedades ·
        Creado), badges de obligatorio/sin repetidos/indexado, resumen arriba
        ("9 campos · 2 obligatorios") y el editor en panel lateral. Y de paso
        salió un hueco real: la columna "Creado" no podía llenarse nunca
        porque `created_at` está en la tabla `fields` desde F1 pero el DTO
        jamás la emitía — se agregó al schema compartido y a los tres
        constructores (`fields`, `bootstrap`, `portal.me`). E2E navegador
        19/19.

  - [x] **Campos: modales flotantes multi-columna + fix del aviso de slug
        (v0.1.162, 4 reportes del usuario)**:
        (a) **La vista previa salía DOBLE**: v0.1.161 la puso en un popover
        POR ÍTEM, y el mismo tipo aparece en «Populares» y en «Todos» — un
        solo `hovered` abría las DOS instancias a la vez. Además a varios
        tipos no se les veía. Se eliminó el popover: la preview es ahora una
        **región fija** del modal (panel derecho) alimentada por el tipo bajo
        el mouse (o el elegido) — no puede duplicarse ni salirse de lugar, y
        cubre los 18 tipos por construcción.
        (b) **El selector de campos pasa a MODAL FLOTANTE AL CENTRO y
        multi-columna** (900px): catálogo de tipos en dos columnas a la
        izquierda + panel de vista previa con descripción a la derecha. El
        panel lateral angosto de v0.1.160 obligaba a scrollear para ver el
        catálogo.
        (c) **El editor de campo del administrador también** (880px, dos
        columnas: Identidad —nombre, tipo, nombre interno— y Configuración
        —config del tipo + obligatorio/sin repetidos/indexar—). El usuario
        pidió explícitamente la interfaz de ClickUp, flotante y a varias
        columnas, en vez del panel lateral de v0.1.161.
        (d) **"Error verificando el slug" al abrir CUALQUIER campo**: dos
        bugs encadenados. `useSlugCheck` esperaba `{slug, available, errors}`
        —el shape del plugin WordPress— pero la nube responde
        `{available, reason}`; con un slug NO disponible, el
        `Object.values(undefined)` explotaba dentro del `.then` y el `.catch`
        mostraba el error genérico: **el motivo real (ocupado / reservado /
        formato) no se veía NUNCA**. Y `FieldDialog` no le pasaba
        `currentSlug`, así que al editar se consultaba el slug PROPIO del
        campo → "ocupado" → el aviso aparecía con sólo abrirlo, sin tocar
        nada. Ahora el hook habla el shape real, con mensajes accionables, y
        en edición el slug propio no se consulta. E2E navegador 12/12
        (ambos modales centrados y medidos, los 18 tipos con preview, cero
        popovers, sin aviso al abrir, y los motivos reales al tipear un
        nombre interno ocupado o reservado).

  - [x] **Administrador de campos multi-columna (v0.1.163, corrección de
        rumbo del usuario)**: la v0.1.162 se pasó de alcance — convirtió a
        modal el panel de **agregar campo**, que no había que tocar ("ese no
        te pedí tocarlo"). Vuelve a ser el panel lateral de v0.1.160, con la
        preview arreglada: UNA sola región fija al pie del panel (el popover
        por ítem duplicaba porque el mismo tipo está en «Populares» y en
        «Todos»). Lo que sí se rehízo es el **administrador de campos**
        (Ajustes → Campos), que era una tabla con filtros y ahora es la
        interfaz de TRES COLUMNAS de ClickUp: (a) **navegación** a la
        izquierda —todos los campos, por tipo con contador, y las otras
        listas del workspace (se salta de un administrador a otro sin volver
        al menú)—; (b) **tabla agrupada por tipo** al centro, con chip y
        contador por grupo, columnas alineadas que se caen solas cuando no
        hay ancho, menú por fila (modificar / renombrar / usar como título /
        duplicar / copiar ID / eliminar) y una fila **"+ Crear campo de
        <tipo>"** en cada grupo; (c) **panel de ajustes** a la derecha con
        TODO lo del campo, que es lo que el usuario echaba en falta ("cada
        campo tiene más opciones"): nombre, **descripción** (columna nueva
        `fields.description`, migración 0044 — se muestra como ayuda bajo el
        campo en los formularios), tipo con conversión y su aviso de riesgo,
        nombre interno, configuración del tipo, obligatorio / sin repetidos /
        indexar / usar como título, y **qué roles NO lo ven** (escribe en
        `settings.permissions[rol].fields_hidden` — el MISMO ACL que aplica
        el backend, visto desde el campo en vez de desde el rol). La sección
        Campos pasa a ancho completo (el resto de Ajustes sigue contenido:
        son formularios). E2E navegador 18/18.

  - [x] **La vista previa del tipo vuelve a estar junto al tipo (v0.1.164,
        reporte del usuario)**: la franja al PIE del panel que dejó v0.1.163
        confundía — cambiaba sola, lejos del ítem señalado y sin
        diferenciarse del contenido, así que no se entendía qué la
        disparaba. Ahora es una **tarjeta flotante anclada a la altura de la
        fila** bajo el mouse, a la izquierda del panel (el panel vive pegado
        al borde derecho), con borde y sombra propios: se lee como un
        flotante, no como contenido. Va por **portal al `<body>`** —dentro
        del panel el `overflow` la recorta, que fue el bug de v0.1.161— y es
        un div presentacional, NO un Popover de Radix: un popover se llevaba
        el primer Escape y había que apretarlo dos veces para cerrar el
        panel. Una sola tarjeta por definición (un estado, un nodo), así que
        tampoco puede duplicarse cuando el mismo tipo está en «Populares» y
        en «Todos». E2E navegador 10/10 (posición medida contra la fila y
        contra el borde del panel, `position: fixed` + sombra + borde, cuelga
        del body, desaparece al salir, un solo Escape cierra, y los 8 tipos
        probados con exactamente una tarjeta).

  - [x] **La gestión de campos, en celular (v0.1.165, reporte del usuario)**:
        las tres últimas versiones se diseñaron mirando el escritorio y en
        pantalla angosta quedaban rotas — medido en un viewport de 390px:
        (a) la tarjeta de vista previa se dibujaba ENCIMA del panel (que en
        celular ocupa todo el ancho, así que no hay costado libre) y además
        el hover no existe en táctil; (b) en el administrador de campos la
        navegación por tipo (`hidden lg:flex`) y la columna de ajustes
        (`hidden xl:block`) simplemente no se renderizaban, así que sólo se
        veía la tabla y **tocar una fila no hacía nada**: no había forma de
        editar un campo desde el teléfono.
        Ahora: la **descripción del tipo va en la propia fila** bajo `sm` (y
        el flotante sólo aparece cuando hay lugar al costado), el **filtro
        por tipo se vuelve una tira de chips** horizontal, y **tocar una
        fila abre el MISMO panel de ajustes en un sheet** a pantalla
        completa. Hook nuevo `useMediaQuery` (`useSyncExternalStore`, sin
        parpadeo en el primer paint) porque acá la diferencia no es de
        estilo sino de ESTRUCTURA: con clases responsive solas el sheet
        quedaría montado e invisible robándose el foco. E2E navegador 14/14
        (10 en 390×844 + 4 confirmando que el escritorio conserva sus tres
        columnas y no abre sheet).

  - [x] **Duplicar listas + galería de plantillas (v0.1.166, pedido del
        usuario mirando ClickUp)**: dos funciones que ClickUp resuelve con
        "Duplicate" y el "Template Center", y Airtable con "duplicate base" +
        su galería — acá salen de UN solo motor. **Blueprint** (shared,
        `listBlueprintSchema` v1): la descripción portable de una o varias
        listas —campos, vistas, automatizaciones, ajustes y hasta 500
        registros de muestra— donde toda referencia por id se **tokeniza**
        (`{"$field": slug}` para cualquier clave `*_field_id`/`*_field_ids`
        y los `inputs` de los computed; `{"$list": key}` para
        `list_id`/`target_list_id`) y se **re-resuelve** al materializar:
        por eso un kanban agrupado, un computed o una relation entre dos
        listas del pack apuntan a los ids NUEVOS, no a los viejos. Lo que
        NUNCA viaja: la publicación pública (`settings.public`, el token es
        de esa lista) y el token del webhook entrante (la copia recibe su
        propia URL por `syncHook`); los archivos tampoco (apuntan a
        attachments ajenos). `BlueprintService.serialize/materialize` +
        `TemplatesService`: `POST /lists/:l/duplicate` (nombre, `include`
        de vistas/automatizaciones/ajustes/registros; conserva la carpeta),
        `GET/POST/DELETE /list-templates` (galería = plantillas del
        **workspace** en la tabla `list_templates` —migración 0045, RLS— +
        **8 del sistema** en código con ids `sys:*`: CRM de clientes,
        Pipeline de ventas, Facturación —pack de DOS listas con relation y
        aviso `due_date_reached`—, Proyectos y tareas —con subtareas de
        muestra—, Soporte, Inventario, Reclutamiento, Eventos) y
        `POST /list-templates/:id/apply` (con o sin registros de ejemplo).
        Todo bajo `manage_lists`, con bitácora (`list.duplicate`,
        `template.*`); una automatización que no valide en destino se salta
        y llega como **warning**, no como fallo de toda la operación. Front:
        "Nueva lista" pasa a tener TRES caminos —En blanco / **Plantilla**
        (galería de dos columnas con buscador, chips de categoría y "Mis
        plantillas", vista previa con icono por tipo de campo, vistas,
        automatizaciones y registros de muestra; en celular apila y
        scrollea como un solo bloque) / **Duplicar** (selector de origen +
        qué incluir)— y en Ajustes → General de cada lista la card
        "Duplicar o guardar como plantilla" (nombre, descripción, categoría,
        qué incluir). 9 tests de API (tokens puros, catálogo válido,
        re-mapeo de ids/computed/vistas/ACL, webhook con token nuevo,
        `settings.public` que no viaja, galería round-trip con aislamiento
        por empresa, pack de dos listas con relación y registros, subtareas
        que conservan su padre) — 454 API, 111 front y 66 shared en verde —
        + E2E navegador 31/31 (galería → Facturación crea 2 listas
        vinculadas con datos y automatización; duplicar desde Ajustes y
        desde "Nueva lista"; guardar como plantilla → aparece con "Mis
        plantillas" → borrar; móvil sin desborde).

  - [x] **Plantillas de dashboards y de automatizaciones + más plantillas de
        listas (v0.1.167, pedido del usuario)**: la diferencia de fondo con
        las plantillas de lista es que un tablero o una automatización se
        aplican SOBRE una lista que ya existe, con sus propios campos. Por eso
        estas plantillas no hablan de campos concretos sino de **roles**
        ("el estado: un select", "el monto: moneda o número", "la fecha de
        vencimiento") y al usarlas se elige la lista y qué campo cumple cada
        rol —lo que ClickUp pregunta al usar una plantilla de dashboard: "¿en
        qué ubicación?"—, con sugerencia automática por nombre y tipo
        (`suggestRoleMapping`: mismo slug > etiqueta parecida > mismo tipo,
        sin repetir campo) y selects que sólo ofrecen campos COMPATIBLES.
        (a) **Dashboards**: `dashboardTemplateSchema` (roles por lista +
        widgets con `{ $field: rol }`, los mismos tokens del blueprint);
        `POST /dashboard-templates/:id/apply` valida el mapeo (lista del
        tenant, campo de esa lista y de un tipo aceptado — si no, aviso y no
        se asigna) y OMITE con aviso sólo los widgets que dependen de un rol
        obligatorio sin mapear; 7 del sistema (Resumen por estado, Embudo de
        ventas, Cartera y cobros, Carga de trabajo, Actividad en el tiempo,
        Satisfacción, Inventario) + **"Guardar como plantilla"** desde el
        header del dashboard (los roles se EXTRAEN de los campos que usan
        sus widgets, con su tipo). "Nuevo dashboard" gana la pestaña
        Plantilla (galería + mapeo + visibilidad). (b) **Automatizaciones**:
        recetas con roles cuyo cuerpo usa la key del rol como si fuera el
        slug; se aplican EN EL CLIENTE — `remapAutomationSlugs` (shared, puro)
        re-escribe condiciones, `changed_fields`, `due_field`, las claves de
        `values` y los merge tags `{{x}}`/`{{before.x}}`/`{{x|+1m}}` (los de
        sistema con punto no se tocan; `if_else` anidado incluido) y el
        editor abre PRE-CARGADO por el state de la navegación para revisar
        destinatarios y valores antes de guardar (una receta trae `to` o el
        valor de estado VACÍOS a propósito: inventarlos sería peor). 11 del
        sistema en `shared` (bienvenida, aviso al equipo, cambio de estado,
        encuesta al cerrar, recordatorio 3 días antes —offset negativo—,
        recordatorio de pago a 20 días, escalar prioridad al vencer, próximo
        contacto a 7 días, avance 100 % al cerrar, webhook al cambiar estado,
        WhatsApp al crear) + "Guardar como plantilla" en cada tarjeta del
        índice (`collectAutomationSlugs` saca los roles; el token del webhook
        entrante no viaja) + botón "Desde plantilla". (c) **Listas**: el
        blueprint gana `dashboards[]` (widgets con `{ $list }` + `{ $field }`
        resueltos contra la lista del propio widget al materializar) y el
        catálogo pasa de 8 a **17** —Control de gastos, Contratos y
        suscripciones, Calendario de contenidos, Incidencias/Bugs, Activos y
        equipos, Proveedores y compras (pack de 2 con relation), Inmobiliaria,
        Agenda de citas (con recordatorio por correo la víspera) y OKR—, y 9
        packs traen su TABLERO (Ventas, Cartera, Avance del proyecto, Salud
        del soporte, Stock, Gastos, Contratos, Incidencias, Compras,
        Portafolio, OKRs). Storage: la tabla `list_templates` pasa a
        `templates` con `kind` (migración 0046; RLS e índice viajan con el
        rename).
        **Bug atrapado**: en dev, `vite --strictPort` con un vite viejo vivo
        (cuya cmdline `vite.js --config` no matcheaba el pkill) seguía
        sirviendo el `@imagina-base/shared` pre-bundleado ANTES de la
        rebuild → `remapAutomationSlugs is not a function` en el navegador;
        el script de arranque ahora usa `--force`. 6 tests de API nuevos
        (remap/collect puros, catálogos válidos, pack con tablero apunta a
        ids nuevos, apply con rol faltante/tipo incompatible, guardar
        dashboard → roles → aplicar en otra lista + aislamiento, guardar
        automatización sin token) — 460 API, 111 front, 66 shared en verde —
        + E2E navegador 28/28 (OKR crea lista + tablero con el medidor sobre
        Avance; Cartera sobre Facturas con roles sugeridos y donut por
        Estado; guardar/borrar plantilla de dashboard; receta sin campo
        compatible bloqueada; receta → editor pre-cargado → guardada con
        `changed_fields` y merge tags re-escritos; guardar/borrar plantilla
        de automatización; móvil).

  - [x] **Galerías unificadas + la plantilla primero (v0.1.168, feedback del
        usuario con capturas)**: le gustó la galería de LISTAS (dos columnas,
        icono con color, buscador + chips) y no las de dashboards y
        automatizaciones de v0.1.167, a UNA columna y planas. Ahora las tres
        comparten el formato: `TemplateCard` (icono con color —el del
        catálogo de listas para los dashboards, que ganan `icon`/`color` en
        el summary y en las 7 del sistema; el icono del disparador con color
        por categoría para las recetas—, nombre a dos líneas, categoría,
        descripción y conteos), buscador, chips y grilla de dos columnas con
        el panel de detalle/mapeo a 22rem. Y **la plantilla es la primera
        opción y la que se abre por defecto** en "Nueva lista" (Plantilla ·
        En blanco · Duplicar) y "Nuevo dashboard" (Plantilla · En blanco); en
        Automatizaciones "Desde plantilla" pasa a botón principal y "En
        blanco" a secundario. E2E navegador 28/28 + 30/31 (el ✗ es un dato
        viejo del entorno: `find` por nombre agarra la Facturas de la corrida
        anterior, que ya tiene 2 automatizaciones).

  - [x] **Menú de celular que se puede usar (v0.1.169, reporte del usuario:
        "abre listas y se cierra de una sin poder seleccionar ninguna")**: en
        el drawer móvil el riel envolvía sus enlaces en un `<nav
        onClick={onClose}>` y `AdminShell` además cierra al cambiar la ruta —
        tocar "Listas" o "Dashboards" navegaba Y cerraba el drawer en el
        mismo gesto, así que el árbol nunca llegaba a verse; y el panel
        también cerraba con CUALQUIER toque (plegar carpeta, anclar,
        "Nueva carpeta"). Ahora, sólo con el drawer abierto en viewport
        angosto (`useMediaQuery`, así ensanchar la ventana con el drawer
        abierto devuelve el riel navegable): (a) tocar un item del riel
        **cambia el panel** (estado local `mobileSection`, `preventDefault`)
        sin navegar ni cerrar, y el panel gana "Todas las listas" / "Página de
        favoritos" porque el riel ya no lleva ahí; (b) el drawer se cierra
        **sólo al activar un enlace** del panel (`closest('a[href]')` — cubre
        también los que sólo cambian `?s=`/`?tab=`), con la X, Escape o el
        velo; al cerrarse el panel vuelve a seguir la ruta. (c) Forma: el
        drawer ocupa `min(88vw, 380px)` con riel de 84px (etiquetas a 11px
        sin truncar) y panel a todo el resto; filas de 40px/14px, pins y menú
        de carpeta visibles tenues (en táctil no hay hover) y con 32px de
        objetivo; X de cierre de 36px en la cabecera del panel; la barra
        superior muestra logo + nombre del workspace (antes, sólo la
        hamburguesa). Escritorio intacto (medidas `lg:`). E2E navegador 33/33
        en 390×844 táctil + escritorio.

  - [x] **Campos `lookup` y `rollup` a través de una relación (v0.1.170,
        ADR-S19, pedido del usuario)**: el hueco que quedaba desde v0.1.158
        —traer o agregar un valor cruzando un campo `relation`, como en
        Airtable/ClickUp—. `lookup` muestra un campo de los registros
        vinculados (lista de valores) y `rollup` los cuenta/suma/promedia/
        mín/máx con **filtro opcional sobre la otra lista** ("deuda = suma de
        las facturas pendientes"). La relación sirve **en las dos
        direcciones** y el backend deduce cuál (hacia afuera: la relation
        vive acá; hacia adentro: vive en la otra lista y apunta acá — así
        Clientes resume Facturas sin duplicar la relación). Nada se persiste:
        motor `ThroughEngine` (`records/through-fields.ts`) que resuelve
        planes y adjunta valores en batch por página (1 query por relación
        para lookups, tope 50 vinculados/registro; 1 query agregada por
        rollup) — los rollups **nunca cargan en memoria** el otro lado: se
        compilan a SQL con el QueryBuilder whitelisteado contra el alias
        `rr` (el builder ganó `dataRef`), y la misma agregación como
        subconsulta correlacionada hace que un rollup **filtre, ordene y se
        sume en el pie/widgets** (`FilterableField.expr`). Un `computed`
        puede usar un rollup como entrada. Validación al guardar (relación
        que toca la lista, destino de la lista del otro lado, tipo
        compatible con la operación; config a medias se acepta y sale
        vacía), `GET /lists/:l/fields/relation-paths` (caminos disponibles)
        y el DTO de campos adjunta `through` (relación resuelta + campo
        destino con config) para que la UI formatee sin otra request. Front:
        catálogo/iconos/preview, editores de config (selector de relación en
        ambas direcciones, campo destino filtrado por compatibilidad,
        operación, filtro EMBEBIDO con el mismo `FilterGroupView` sobre la
        otra lista), celda y ficha de solo lectura pintadas con el tipo del
        destino (moneda, chips, teléfono, fecha), operadores numéricos del
        rollup en filtros, el alta no los pide. **Dos bugs atrapados en el
        E2E**: drizzle serializa un array JS como JSON (no como array de
        Postgres) → `= ANY($n)` rompía, ahora `IN (…)` bindeado; y crear un
        campo derivado dejaba la columna en "—" hasta recargar (los records
        seguían en cache) → invalidación + evento realtime de records al
        crear computed/lookup/rollup. (El export CSV de los derivados y la
        agrupación por ellos llegaron en v0.1.200.) 5 tests de integración (465 API en verde, 111
        front, 66 shared) + E2E navegador 23/23 (alta por UI de rollup y
        lookup, formato, filtro "Deuda > 0", orden, ficha, alta sin
        derivados, cambio en Facturas reflejado en Clientes).

  - [x] **Las plantillas usan lookup y rollup donde aportan (v0.1.171, pedido
        del usuario)**: un lookup/rollup necesita una RELACIÓN, así que sólo
        tiene sentido en los packs de dos listas — el resto del catálogo queda
        igual a propósito. El blueprint aprendió a llevar esas referencias:
        un campo de Clientes apunta a campos de Facturas, o sea CRUZA la
        lista, y el token de un solo slug no alcanzaba. Ahora hay un token
        **calificado** `{$field, $list}` (`tokenizeFieldRefs` recibe el mapa
        de las otras listas del pack; `resolveFieldRefs` resuelve contra
        `slugMaps`) y la materialización de campos pasa a dos pasadas
        GLOBALES: primero todos los campos de TODAS las listas, después la
        config de los derivados — antes la segunda pasada corría por lista y
        un rollup de la primera no encontraba los campos de la segunda. Una
        referencia que no resuelve se limpia (`dropDeadListRefs` ahora
        también quita los `*_field_id` en null): el campo nace a medias y
        sale vacío, en vez de rebotar con 400.
        Dónde se pusieron: **Facturación** (Clientes gana Facturas, Total
        facturado, Saldo pendiente —suma filtrada por estado pendiente o
        vencida— y Última factura; Facturas gana el email y el NIT del
        cliente, para emitir sin abrir su ficha; el KPI del tablero "Clientes
        con saldo" **filtra por el rollup**), **Proveedores y compras**
        (Órdenes, Total comprado, Pendiente de pago, Última compra; la orden
        muestra el email y la categoría del proveedor) y dos plantillas que
        se REDISEÑARON como pack porque el rollup es su razón de ser:
        **Reclutamiento** (Vacantes ← Candidatos: candidatos, en proceso,
        contratados y evaluación media por vacante; el candidato ve el área y
        el salario de su vacante) y **Eventos e invitados** (Eventos ←
        Invitados: invitados, confirmados, acompañantes y un CALCULADO sobre
        dos rollups —"personas esperadas"—; el invitado ve fecha y lugar),
        ambas con tablero propio. Los roles numéricos de las plantillas de
        dashboard aceptan `rollup` como métrica.
        **Bug real atrapado por el test**: el operador `in`/`nin` compilaba a
        `= ANY($n)` con un array JS — drizzle lo expande como lista de
        placeholders y ANY exige un array de Postgres, así que la condición
        reventaba al reusarse dentro de la subconsulta de un rollup (el
        filtro "estado in [pendiente, vencida]"). Ahora es `IN (…)` con un
        parámetro por valor y `?| ARRAY[…]::text[]` en multi_select; el
        operador no tenía NI UN test y ahora lo tiene. 466 tests API en verde
        + E2E navegador 21/21 (las tres plantillas aplicadas calculan solas
        con sus registros de muestra, el lookup trae el dato del otro lado, el
        computed suma dos rollups y el KPI filtra por el saldo).

  - [x] **Menú contextual del panel lateral (v0.1.172, pedido del usuario
        con captura del menú de ClickUp)**: cada lista y cada dashboard del
        panel gana un menú "…" (aparece al hover; en táctil, visible tenue)
        que también se abre con **click derecho** sobre la fila. Sólo entran
        acciones que existen de verdad, cada una cableada a lo que YA hacía
        en otra pantalla: **listas** → anclar/quitar de favoritos, cambiar el
        nombre **inline** (la fila se vuelve input; Enter guarda, Escape
        cancela), copiar vínculo, **color e ícono ›** (submenú con el MISMO
        catálogo del selector de Ajustes; elegir aplica al instante y el menú
        queda abierto para elegir color y después icono), **mover a carpeta ›**
        (las carpetas de v0.1.130 + "Sin carpeta"), nuevo registro e importar
        (deep links `?new=1` / `?import=1` que la página de registros consume
        y limpia), compartir (el mismo `ShareDialog` de la cabecera), campos,
        automatizaciones, uso compartido y permisos, ajustes, duplicar,
        guardar como plantilla y eliminar (confirmación; si estabas parado en
        esa lista, vuelve al índice). **Dashboards** → anclar, renombrar
        inline, vínculo, color e ícono, duplicar (el `useDuplicateDashboard`
        se extrajo del índice y lo comparten), configuración (el diálogo del
        lápiz) y eliminar. Lo de ClickUp sin equivalente (ClickApps, estados,
        etiquetas, archivar, ocultar) no aparece: un item apagado es peor que
        ninguno. Los favoritos usan las mismas filas, así el menú sale ahí
        también. Gates por capability (`manage_lists`, `manage_automations`,
        `create/import_records`, `manage_dashboards`). Dos cuidados: (a) los
        diálogos se montan SÓLO mientras están abiertos — `ShareDialog` trae
        sus propias queries y montarlo por fila sería N requests por abrir el
        panel; (b) el **flotante del riel** (v0.1.145) se cerraba al entrar
        al menú (va por portal: en el DOM el mouse "sale" del flotante) y al
        clickear un item (burbujea por el árbol de React) — ahora un menú o
        un diálogo abierto DESDE el flotante lo **sostiene** (`PeekHoldContext`)
        y al soltarlo el flotante se va. E2E navegador 27/27 (15 acciones,
        vínculo al portapapeles, click derecho, rename persistido, color e
        icono persistidos y pintados, mover a carpeta, compartir, alta por
        deep link, duplicar, menú del dashboard con rename/duplicar/eliminar,
        el flotante sostenido con menú y diálogo, eliminar la lista abierta
        redirige, y mobile con "…" visible sin cerrar el drawer).

  - [x] **Carpetas con icono, color y menú contextual (v0.1.173, reporte del
        usuario con capturas de ClickUp)**: faltaba el menú de la carpeta y
        el icono. (a) **Icono y color por carpeta** — `list_groups.icon` /
        `color` (migración 0047, mismo catálogo y reglas que las listas:
        clave del icono, hex del color, nullable), en el schema compartido, el
        service (select/create/update) y el DTO del front. La cabecera dibuja
        un **cuadrado de color con el icono** que **al pasar el mouse se
        convierte en el chevron** de plegar (lo que hace ClickUp con los
        espacios; en táctil no hay hover, queda el icono y el toque pliega
        igual); sin elección, icono de carpeta neutro. (b) **Menú contextual
        de la carpeta** ("…" al hover y **click derecho**; en táctil visible
        tenue): cambiar el nombre (inline), color e ícono › (el mismo
        submenú de las listas), nueva lista en esta carpeta, nueva carpeta,
        plegar/desplegar y eliminar (confirmación que avisa que las listas
        vuelven al nivel de arriba). Más un **"+" al hover** que crea una
        lista adentro. (c) **Nacer dentro de la carpeta**: `createListSchema`
        gana `group_id` (validado contra el tenant con el mismo `assertGroup`
        del PATCH → 404, no FK violation) y `ListCreateDialog` recibe
        `groupId`/`groupName` — el título dice «Nueva lista en «X»» y las
        TRES rutas lo respetan: en blanco (`group_id` en el POST), plantilla
        (el `group_id` que `apply` ya aceptaba) y duplicar (mueve la copia si
        el origen estaba en otra carpeta). El flotante del riel se sostiene
        con el menú o el diálogo de la carpeta abiertos, igual que las filas.
        2 tests de API nuevos (icono/color alta-cambio-limpieza; nacer en
        carpeta propia y rechazo de la ajena) + E2E navegador 22/22 (cuadrado
        de 20px, icono→chevron medido por `display`, menú de 6 acciones,
        rename, color e icono persistidos y pintados, alta en blanco con
        `group_id`, "+", plegar/desplegar, flotante sostenido, borrar con la
        lista de vuelta a la raíz, mobile con icono en color y "…"/"+"
        visibles) y el E2E de v0.1.172 re-verificado 27/27. **OJO en dev**:
        el API no aplica migraciones al arrancar — tras una migración nueva
        hay que correr `pnpm db:migrate` en `apps/api` (el E2E lo detectó:
        columnas ausentes con el API ya reiniciado).

  - [x] **Iconos SÓLIDOS para listas, carpetas y dashboards (v0.1.174,
        reporte del usuario con capturas de ClickUp: "iconos muy delgados que
        casi ni se entiende qué son")**: el catálogo de `listIcons` usaba los
        iconos de trazo de lucide (1.5px de línea) y a 14px en el menú apenas
        se distinguían; ClickUp usa glifos macizos justamente por eso. El
        catálogo pasa a **heroicons 20/solid** (dependencia nueva
        `@heroicons/react`, MIT, tree-shakeable — sólo entran los 37 que se
        importan) con las MISMAS 36 claves (`briefcase`, `receipt`,
        `rocket`…): lo guardado en `lists.icon`, `list_groups.icon` y
        `dashboards.settings.icon` sigue valiendo, sólo cambia el dibujo.
        `ListIconComponent` (`ComponentType<SVGProps>`) reemplaza a
        `LucideIcon` en las props del panel, `TemplateCard` y `dashboardIcon`,
        así conviven sólidos del catálogo y trazos de lucide donde haga
        falta. Fallbacks también sólidos: lista sin icono → `ListBullet`,
        carpeta → `Folder`, dashboard → `ChartBar`. El glifo de las filas
        sube de 14 a 16px (como ClickUp); el de la carpeta sigue a 12px
        dentro del cuadrado de color. Aplica en el panel (acoplado y
        flotante), favoritos, galerías de plantillas, el selector de Ajustes
        y el submenú "Color e ícono". El resto de la UI (riel, botones,
        tipos de campo) conserva lucide a propósito: son iconos de acción a
        16-20px sobre fondo claro, donde el trazo se lee bien. Verificado en
        navegador en claro y oscuro (`fill="currentColor"`, un path por
        glifo) + E2E de v0.1.172 (27/27) y v0.1.173 (22/22) re-verificados.

  - [x] **Catálogo de 324 iconos sólidos + selector con buscador (v0.1.175,
        feedback del usuario: "siguen sin convencerme… son muy poquitos,
        ClickUp tiene muchos más y se ven mejor")**: heroicons (v0.1.174) se
        quedaba corto en cantidad (36) y en dibujo. Ahora el catálogo son los
        glifos **fill de Phosphor** (el estilo macizo y redondeado que usa
        ClickUp), **324** organizados en 8 categorías (Trabajo, Personas,
        Finanzas, Comunicación, Tiempo, Objetos, Tecnología, Lugares, Formas).
        Cómo se empaqueta: `scripts/gen-list-icons.mjs` lee los SVG de
        `@phosphor-icons/core` (devDependency, MIT) y **extrae sólo el
        `path`** de cada uno a `listIconPaths.generated.ts`; `listIcons.ts`
        arma un componente por entrada (`<svg viewBox="0 0 256 256"
        fill="currentColor"><path d/>`). Cero librería de iconos en runtime:
        `@phosphor-icons/react` mete los seis pesos de cada icono en cada
        módulo, y `@heroicons/react` se quitó. El catálogo va en su propio
        chunk `icon-catalog` (44 KB gz, cambia mucho menos que la app →
        sobrevive a los deploys como los vendors). Las **36 claves
        históricas se conservan** con el mismo nombre; las nuevas usan el
        nombre de Phosphor. `IconCatalogPicker` compartido (popover de Ajustes
        y submenú "Color e ícono" del panel, 340px): fila de colores,
        **buscador sin acentos** (por etiqueta o clave, con `stopPropagation`
        del teclado porque el submenú de Radix se lo roba), grilla de 8
        columnas agrupada por categoría con cabeceras sticky y "Quitar el
        icono". Fallbacks del propio catálogo (`list`, `folder`, `chart_bar`).
        Regenerar tras editar el catálogo: `node scripts/gen-list-icons.mjs`
        (falla en voz alta si un nombre de Phosphor no existe). Verificado en
        navegador (claro/oscuro, picker con categorías y búsqueda) + E2E de
        v0.1.172 (27/27) y v0.1.173 (22/22) re-verificados.

  - [x] **Color de la barra lateral independiente del primario (v0.1.176,
        pedido del usuario con captura: "primario verde pero el riel gris")**:
        hasta acá el riel del menú se TEÑÍA siempre con el hue del color
        primario (v0.1.59/v0.1.112) — no había forma de tener acentos verdes
        y un menú gris. Ahora `branding.sidebar_color` (shared + PATCH
        `/workspaces/current/branding`, sin migración: vive en
        `tenants.settings.branding`) es un color de fondo PROPIO del riel;
        `null` = sigue al primario como siempre. En el front `sidebarVars`
        pinta el riel con ese color **tal cual en los dos temas** (es una
        elección explícita, no una derivación — a diferencia del riel que
        sigue al primario, que en oscuro se hunde) y deriva TODO lo que va
        encima: borde y velo de hover un escalón más claros u oscuros según el
        fondo, y la tinta por **luminancia WCAG** (no por la L de HSL: un
        amarillo al 50% es claro, un azul al 50% es oscuro) — gris claro →
        texto oscuro, carbón → texto claro. Para que eso funcione hubo que
        sacar el `text-white`/`bg-white/10` CABLEADO del riel (logo, item
        activo, hover, separador, thumb del scroll y el cuadrado de marca del
        topbar móvil): ahora salen de `--imcrm-sidebar-foreground` /
        `--imcrm-sidebar-accent-foreground` (el dark pasa de teal a blanco en
        ese token, que estaba sin uso — el look por defecto no cambia). Card
        Marca: fila "Color de la barra lateral" (picker + hex + "Quitar" para
        volver a seguir al primario, con explicación), validación propia y
        PATCH parcial sólo si cambió. 1 test de API (round-trip, PATCH parcial
        no pisa, null vuelve) + 5 unitarios del front (116 front en verde) +
        E2E navegador 24/24 (verde+gris → riel `#e5e7eb` con tinta oscura y
        contraste 9.1:1, persistencia, oscuro respeta el gris y sube el
        primario, carbón → tinta clara, hex inválido rebota, Quitar limpia las
        variables de tinta y el riel vuelve al hue del primario, topbar móvil).
        **OJO en dev**: tras `pnpm build` de shared hay que reiniciar vite —
        el pre-bundle viejo hizo que el schema del cliente DESCARTARA la clave
        nueva en silencio (mismo síntoma que v0.1.167).

  - [x] **Favicon + título de pestaña con la marca (v0.1.177, reporte del
        usuario: "la app no tiene favicon")**: los dos SPAs (admin y portal)
        no declaraban ningún `<link rel=icon>` — la pestaña salía con el
        globo genérico del navegador. (a) **Favicon por defecto**: `public/
        favicon.svg` (cuadrado redondeado en el teal del tema con la chispa
        del logo del riel) + PNG de respaldo rasterizados desde ese SVG
        (`favicon-32.png`, `apple-touch-icon.png` 180, `favicon-192.png`) —
        Safari no lee favicons SVG. Vite copia `public/` a la raíz de
        `dist-cloud`, y los dos proxies ya sirven archivos de la raíz antes
        del fallback SPA (`try_files {path} /cloud/index.html`), así que no
        hubo que tocar el deploy. (b) **White-label**: `lib/favicon.ts`
        (`applyFavicon` / `applyDocumentTitle`, DOM puro) pisa el favicon con
        el LOGO del tenant y el título con su `app_name` — como el icono de
        workspace de ClickUp/Notion. El logo ya viaja por URL FIRMADA (v0.1.85)
        justo porque un `<link>`/`<img>` no manda sesión ni `X-Tenant-Id`.
        Lo llama `useBranding` (admin: pre-login el tenant del dominio, con
        sesión el workspace activo; sin logo restaura el default para no
        arrastrar el logo del workspace anterior) y `PortalContent` (portal:
        "Portal — Acme"). Los links del HTML llevan `data-imcrm-default` y
        los de marca `data-imcrm-brand`: el helper sabe cuáles quitar y
        nunca acumula `<link>`. 5 tests con jsdom (`@vitest-environment` por
        archivo — la suite sigue en `node`) → 121 front en verde; E2E
        navegador 14/14 (login con el default y los 3 archivos en 200, subir
        logo desde Marca → un solo icon al logo firmado que descarga 200 sin
        sesión + apple-touch + título, persiste al recargar, quitar logo →
        default sin recargar, quitar nombre → "Imagina Base"); build de
        producción con los 4 archivos en la raíz.

  - [x] **Etiqueta en vez de value en gráficos y merge tags (v0.1.178,
        reporte del usuario con capturas de donuts: "aparece el value y no
        el label… me gustaría poder decidir")**: dos frentes.
        (a) **Gráficos**: el backend agrupa por el VALUE crudo de la columna
        (`gestion_sitio_web`, y en multi_select el JSON del set) y el front
        lo pintaba tal cual. `useChartColors` gana `useGroupOptions` (las
        opciones del campo agrupado indexadas por value Y por etiqueta) y
        `displayGroupLabel(raw, labelMap)`: donut, barras y embudo muestran
        la ETIQUETA ("Gestión sitio web, VPS en Hetzner" para un combo de
        multi_select; una opción borrada cae al value crudo, nunca se
        pierde). La CLAVE del dato sigue siendo el value: click-through
        (`gv=pendiente`), ocultar categorías y colores no cambian. De paso
        salió un bug latente: el mapa de colores estaba indexado SÓLO por
        etiqueta, así que toda opción cuyo value no coincidía con su label
        salía con el color de la paleta en vez del suyo (por eso el donut
        del reporte tenía naranja/azul genéricos) — ahora usa el color real
        de la opción.
        (b) **Automatizaciones**: modificador **`{{campo|label}}`** en
        `applyMergeTags` (encadenable con los de fecha; `|value` explícito
        también existe): select → etiqueta, multi_select → etiquetas unidas
        por coma, checkbox → Sí/No, `before.campo|label` igual; tipos sin
        opciones pasan intactos y un llamador sin catálogo no rompe el
        template. **El default sigue siendo el value a propósito**: es lo que
        otro sistema espera como clave y lo que `create_record`/
        `update_field` necesita para escribir en un select destino — el
        autor decide por tag. `RunContext` lleva `fieldsBySlug` (misma query
        que `slugToKey`, ahora `fieldMaps`) y `labelResolverFor` lo sirve al
        motor y al probador de webhooks (lo que se prueba es lo que sale).
        Editor: sección **"Etiqueta de la opción (texto legible)"** en el
        picker de variables con un chip por campo con opciones, y el botón
        del picker ("Más variables") aparece SIEMPRE — antes sólo con más de
        5 campos, así que en listas chicas los valores anteriores y los tags
        de sistema eran inalcanzables. (c) De paso, el E2E atrapó que en un
        widget de 6 columnas (≈458px) la LEYENDA del donut quedaba sin
        espacio y los nombres se recortaban hasta desaparecer (el aro iba
        fijo a 260px y se llevaba todo): ahora el aro se acota por el ancho
        real del card reservando ~250px para la leyenda, la leyenda toma el
        espacio libre (hasta 320px) y el nombre completo va en el tooltip
        para los combos largos. 4 tests de API (8 en el spec, 15 en el de
        automatizaciones) + 1 front (122 en verde) + E2E navegador 17/17
        (tablero sin values, combo traducido, swatch con el color de la
        opción, nombres de la leyenda legibles en 6 columnas, click-through
        por value con 2 filas, probador con `{{estado}}`=pendiente y
        `{{estado|label}}`="Pendiente de pago", picker con 3 chips e
        inserción de `{{servicio|label}}`).

- [x] **F9 — Copias de seguridad y migración** (pedido del usuario: "migrar
      un cliente o toda la app de servidor, o restaurar a una versión
      anterior, de forma robusta, eficiente y fácil"):
  - [x] **Snapshot completo + restauración + migración de servidor (v0.1.179,
        ADR-S20)**: el backup lógico de F5 sólo guardaba la BASE — para
        levantar la app en otro servidor faltaban los archivos subidos, los
        ajustes de plataforma de Redis (`platform:*`, el SMTP) y, sobre todo,
        los secretos del `.env` (sin `SECRETS_KEY` las contraseñas SMTP y los
        secretos 2FA del dump son ilegibles; sin `FILES_SIGNING_SECRET` no
        valida ninguna URL firmada). Ahora UN artefacto,
        `imagina-snapshot-<UTC>-v<versión>.tar[.gpg]` (manifest con versión y
        nº de migraciones + `db.dump` **con privilegios** — los GRANT al rol
        `imagina_app` viajan; el `backup.sh` viejo usaba `--no-privileges` y un
        restore dejaba al API sin permisos — + `uploads.tar.gz` +
        `redis-platform.json` + `env.production` + checksums), y tres scripts
        que viajan en cada release y son la ÚNICA implementación:
        `snapshot.sh` (retención por cantidad, GPG opcional, `pg_dump` del
        host o por `docker exec`; Redis va por `redis-kv.mjs`, un cliente
        RESP propio en Node sin dependencias — lo atrapó el CI: el runner no
        tiene `redis-cli` y el snapshot salía SIN las claves de plataforma,
        lo mismo que le pasaría a un VPS sin el CLI), `snapshot-restore.sh`
        (verifica checksums; **rechaza un snapshot más nuevo que el código**
        —esquema con migraciones desconocidas— y acepta uno más viejo aplicando
        las pendientes al final; copia previa de la base actual; `DROP SCHEMA`
        + `pg_restore` en vez de `--clean` objeto por objeto para que un
        snapshot viejo sobre código nuevo no deje tablas huérfanas; uploads
        apartados en `.pre-restore-<ts>`; Redis; el `.env` se instala en
        servidor nuevo y NUNCA se pisa en silencio en uno existente si los
        secretos difieren; `--dry-run`, confirmación escrita RESTAURAR) y
        `bootstrap-server.sh` (servidor nuevo en un comando: layout, `.env`
        del snapshot, bundle de la MISMA versión desde GitHub Releases con
        sha256 verificado, restore, `--install-service`). Consola →
        **Plataforma → Copias de seguridad**: crear ahora (job en la cola del
        updater: una operación a la vez, nunca un snapshot pisando un deploy),
        **copias automáticas** diarias a una hora UTC con N conservadas (tick
        horario; si el servidor estaba apagado a esa hora sale en el próximo
        tick del día; ajustes en `platform:backups` → viajan en el snapshot),
        listado con manifest leído del tar (versión, migraciones, contenido,
        cifrada), descarga por enlace (`content-encoding: identity` para que
        el compress no se coma el content-length), **restaurar** con
        confirmación escrita (detached como `finalize.sh`: el script detiene
        y rearranca el API; al bootear el service reconcilia el run) y
        borrar. Nombres estrictos (sin traversal) y restore por panel sólo
        con layout de releases (en dev: 409 con la instrucción por CLI).
        Docs: `docs/runbook-migration.md` (los 3 escenarios paso a paso),
        nota en `runbook-backups.md`, ADR-S20 en STANDALONE, CI copia los
        scripts al bundle. 8 tests de API — 3 puros (parse de nombres,
        `isSnapshotDue`, `nextRunAt`) + 5 de integración con Postgres y Redis
        REALES en contenedores: `createSnapshot` produce el tar con manifest
        (sesiones NO viajan), `snapshot-restore.sh` deja base/uploads/Redis
        iguales en una base scratch (grants y policies incluidos), snapshot
        más nuevo rechazado con código 3, settings y tick, traversal/borrado —
        481 API y 122 front en verde; verificación manual del ciclo completo
        contra la base de desarrollo (68 listas, 527 campos, 141 registros
        idénticos tras restaurar) y E2E navegador 19/19 (crear → Listo con
        nombre → fila con contenido → descarga con bytes exactos → traversal
        404 → Restaurar deshabilitado + 409 → ajustes persistidos + próxima
        automática → eliminar → sección de migración → link en el panel).
        **Pendiente (siguiente release)**: exportar/importar UNA empresa entre
        instancias con re-mapeo de ids (escenario 3 del runbook).

  - [x] **Simulacro de migración real + fix del `.env` (v0.1.180, pregunta del
        usuario: "¿entonces ya se puede migrar fácil y sin errores?")**: en vez
        de contestar de memoria se corrió el escenario 2 del runbook DE VERDAD
        en el sandbox — snapshot de la base de desarrollo con versión 0.1.179
        (68 listas / 527 campos / 141 registros, 1 archivo, claves `platform:*`,
        `.env` con secretos), directorio vacío como "servidor nuevo",
        `bootstrap-server.sh --snapshot … --yes` descargando el bundle REAL del
        release v0.1.179 desde GitHub (sha256 verificado), restore, migraciones,
        y el API arrancado desde `current/apps/api` con el env de `shared/` como
        lo haría systemd: `/health/ready` 200, login, 68 listas, registros,
        descarga del adjunto (200, 6.422 bytes), panel de copias leyendo los
        ajustes de Redis; base migrada IDÉNTICA (mismo md5 de los 141 registros,
        23 policies, 120 grants a `imagina_app`, 48 migraciones).
        **Bug real atrapado a la primera**: los cuatro scripts de operación
        (`snapshot.sh`, `snapshot-restore.sh`, `deploy/deploy.sh` y
        `deploy/finalize.sh`) cargaban el `.env` con `source`, y un valor SIN
        comillas con espacios o `<>` — exactamente `MAIL_FROM=Imagina Base
        <no-reply@…>`, como lo trae `deploy/.env.production.example` — bash lo
        lee como comando + redirección y aborta con "syntax error near
        unexpected token newline". O sea: el restore moría a mitad de camino y,
        peor, el `deploy.sh` de la **auto-actualización** también habría
        fallado en cualquier servidor que copió el ejemplo tal cual (a los que
        ya andan no les pasó porque tienen ese valor entre comillas). Ahora los
        cuatro usan `load_env_file`, un lector estilo dotenv (sin comillas con
        espacios/`<>`, comillas simples o dobles, `export KEY=`, comentarios,
        CRLF; `finalize.sh` sólo extrae `DATABASE_URL`), el ejemplo lleva el
        valor entre comillas y `bootstrap-server.sh` prefiere el restore que
        está JUNTO a él (mismo origen que la persona eligió) antes que el del
        bundle. El otro tropiezo del simulacro no fue bug: el `.env` de dev
        tiene `SECRETS_KEY`/`FILES_SIGNING_SECRET` vacíos y el release de
        producción se negó a migrar (v0.1.113) — con secretos reales pasó.
        Test de regresión (restore `--dry-run` tomando `DATABASE_URL` de un env
        con el `MAIL_FROM` sin comillas; verificado que el script viejo falla y
        el nuevo pasa) — 9/9 del spec, 482 API en verde.

  - [x] **Migrar UNA empresa entre instancias (v0.1.197, ADR-S23)**: el
        snapshot de ADR-S20 mueve el SERVIDOR entero; esto mueve un CLIENTE —
        lo que hace falta para partir un servidor en dos, venderle una empresa
        a otro operador o sacar a un cliente de la nube compartida a la suya.
        **Plataforma → Migrar empresas**: exportar deja un
        `imagina-tenant-<slug>-<UTC>.tar` (manifest + una NDJSON por tabla +
        los bytes de los adjuntos; NDJSON y no un JSON gigante porque una
        empresa con 200k registros no entra en memoria como una cadena), y el
        import lo trae a este servidor. El problema real no es copiar filas: es
        que **todos los ids son `bigint identity` sobre tablas COMPARTIDAS**,
        así que al insertar se regeneran y una referencia sin traducir no falla
        ruidosamente — **apunta a la fila de otra empresa**. Por eso el
        re-mapeo vive en un módulo PURO y testeado aparte
        (`tenant-transfer.remap.ts`) que cubre los cuatro vocabularios:
        (a) las claves por convención (`*_field_id`, `*_field_ids`, `list_id`,
        `inputs`) más las que no siguen ninguna y hay que nombrar a mano
        (`connection_id`, `default_template_id`, `view_id`, `related_lists`);
        (b) las CLAVES `f{field_id}` de `records.data` —con los tipos `file` y
        `user`, cuyo VALOR también es un id— y el diff de `activity`, donde el
        valor es `{from,to}` y traducirlo lo rompería; (c) el árbol ProseMirror
        de la descripción (`mentionUser`/`mentionRecord`/`imageBlock`/
        `fileBlock`) a cualquier profundidad; (d) `lists.settings`, donde los
        ids de usuario son las CLAVES de `permissions.users`. Un id que no
        resuelve queda en `null` y la referencia se descarta: dejarlo con el
        número viejo se lo daría a OTRA persona. **Lo que NO viaja es tan
        importante como lo que viaja**: el dominio propio (único global), el
        token público de cada lista y la URL de los webhooks entrantes son
        credenciales de la instancia de origen — el import emite unos nuevos y
        lo dice en los avisos. Los **secretos** viajan cifrados con una huella
        de la `SECRETS_KEY` del origen: si el destino tiene otra clave se
        **descartan** en vez de guardar basura que fallaría recién al mandar un
        correo (lección de v0.1.150). Las **personas se deduplican por email**
        (quien ya tiene cuenta acá se vincula y conserva contraseña, 2FA y sus
        otras empresas; el resto se crea con el hash de argon2, que es
        portable). Todo el import corre en **una transacción** y los bytes
        escritos fuera de ella se borran si revierte. El orden es el de las
        dependencias y el único tramo no obvio está comentado: adjuntos ANTES
        que los registros, registros en dos pasadas (el padre de una subtarea y
        las menciones de la descripción apuntan a registros que en la primera
        no existen), la config de los campos derivados en una segunda pasada, y
        `lists.settings` AL FINAL. La empresa de origen **queda intacta**:
        migrar es copiar, y darla de baja es otra decisión.
        **Bug real encontrado en el camino** (y arreglado acá porque es
        justo el paso siguiente del operador): **borrar una empresa desde la
        consola devolvía 500**. `deleteTenant` es una lista EXPLÍCITA de tablas
        (no hay cascada desde `tenants`) y se quedó en las que existían cuando
        se escribió: faltaban adjuntos, conexiones, plantillas, carpetas,
        historial de slugs, menciones, recurrencias, relaciones, hooks de
        webhook, bitácora, uso mensual y tokens personales — o sea que
        cualquier empresa con un archivo subido o una conexión era
        **imborrable**. Ahora se borran todas en orden FK-safe y también los
        **bytes** de los adjuntos (si no, el operador pide borrar la empresa y
        sus archivos quedan ocupando disco para siempre). El test viejo sólo
        sembraba listas/records/automatizaciones: por eso la regresión pasó
        desapercibida, y el nuevo siembra las tablas que llegaron después.
        11 tests unitarios del re-mapeo + 5 de integración con Postgres real
        (round-trip completo: se importa en la MISMA base, así los ids nuevos
        caen en otro rango y cualquier referencia sin traducir apuntaría a la
        empresa original, que sigue ahí) + 1 de regresión del borrado — 595
        API y 150 front en verde — y E2E en navegador 26/26 (exportar desde la
        consola, manifest leído del propio tar, descarga con bytes exactos,
        traversal rechazado, importar, la vista kanban de la empresa importada
        apuntando al campo NUEVO, la tabla renderizando el registro, la empresa
        de origen intacta, borrar el archivo).

      **Con esto F9 queda completa: copias del servidor, restauración,
      migración de servidor y migración por empresa.**

- [x] **F10 — Asistente IA** (pedido del usuario: "que un cliente le pueda
      pedir a la app una lista, un tablero o una automatización en lenguaje
      natural"; plan acordado en tres fases: estructura → datos → MCP; el
      usuario sumó la decisión comercial: clave global con restricciones Y/O
      claves propias por cliente desde el inicio):
  - [x] **Fase 1 — Asistente de ESTRUCTURA (v0.1.181, ADR-S21)**: un chat
        dentro de la app (botón ✨ en el Topbar → drawer a la derecha) que
        convierte pedidos en lenguaje natural en propuestas sobre listas,
        campos, vistas, tableros y automatizaciones — con vista previa y un
        botón "Aplicar". **El modelo nunca escribe**: las diez herramientas
        (`apps/api/src/ai/tools/`: `list_lists`, `get_list_schema` y ocho
        `propose_*`) validan el pedido contra el esquema real (slugs, tipos y
        config con los schemas compartidos; slugs inexistentes vuelven al
        modelo como error corregible con la lista de válidos), lo resuelven a
        ids y lo guardan como PROPUESTA en Redis (2 h); `POST
        /ai/proposals/:id/apply` ejecuta el payload ya validado llamando a los
        MISMOS services de la interfaz (`BlueprintService.materialize` para
        listas —incluidos packs con relation entre sí—, Fields/Views/
        Dashboards/Automations) con su ACL, límites de plan, realtime y
        bitácora (`ai.apply`). Cada herramienta declara la **capability** que
        exige: al modelo sólo se le ofrecen las del rol de la persona
        (un manager no ve `propose_create_list`) y aplicar la re-chequea
        (403 si el rol bajó). Un solo registro de herramientas, pensado para
        que el MCP de la fase 3 lo consuma igual. Motor: SDK oficial,
        `messages.stream` con pensamiento adaptativo + `effort medium`,
        `cache_control` en system y tools, hasta 8 vueltas por mensaje,
        conversación en Redis por usuario+empresa (24 h; el historial se
        recorta sin partir pares tool_use/tool_result), SSE por
        `reply.hijack()`; el cliente inyectable (`AI_CLIENT_FACTORY`) permite
        testear el bucle con un modelo falso con guion.
        **Clave y cuenta (lo que pidió el usuario)**: dos niveles, mismo
        patrón que el SMTP. Plataforma → pestaña **"Asistente IA"** (superadmin):
        interruptor general, clave cifrada con `SECRETS_KEY` (`platform:ai`;
        respaldo `AI_API_KEY` por env), modelo por defecto (Opus 5 / Sonnet 5 /
        Haiku 4.5), **"Compartir la clave"** (las empresas la usan con la cuota
        mensual de su plan: columna "IA/mes" en Planes, `max_ai_requests_month`
        —semilla trial 20 / starter 100 / pro 500 / enterprise ∞—, contador
        `ai_usage` por tenant+período con tokens reales; migración 0048) y
        **"Permitir claves propias"** (BYOK). Ajustes → **Asistente IA** (admin
        de la empresa): **opt-in explícito** (se explica qué viaja al
        proveedor: la estructura, no los registros), modelo, clave propia
        cifrada en `tenants.settings.ai` (nunca vuelve; hint …1234; ilegible
        con otra SECRETS_KEY se avisa como el SMTP) → sin cuota. Sin acceso,
        el panel dice exactamente qué falta y linkea a la config. Uso visible
        en Plan y uso, en el detalle de empresa de la consola y en la grilla.
        Front: `AssistantPanel` (streaming, indicador de herramienta en
        curso, tarjetas `ProposalCard` con preview por tipo, confirmación
        reforzada en destructivas, links al resultado, recupera la
        conversación al reabrir, "Nueva conversación", Stop), parser SSE
        propio (`lib/sse.ts`, 3 tests). 15 tests de API (unitarios + Postgres
        y Redis reales con modelo falso: cifrado y política de claves, bucle
        completo propone→aplica con bitácora y cuota, error corregible,
        campos/opciones/vista/automatización sobre lista existente, slug
        inválido rechazado, tablero con layout automático, capability por rol
        y 403 al aplicar, borrado destructivo, cuota que corta y BYOK que no
        cuenta) — 497 API, 125 front y 66 shared en verde — + E2E navegador
        41/41 (panel, chat SSE
        con error legible, transcript recuperado, no-disponible → link →
        activar desde la card, BYOK hint/sin exponer/quitar, tarjeta de
        propuesta → Aplicar → la lista existe con sus campos y kanban → link
        a la lista, 409 al re-aplicar, consola con políticas y "Probar",
        columna IA/mes, móvil).
  - [x] **Fase 2 — Asistente de DATOS (v0.1.182)**: cinco herramientas más
        en el MISMO registro (`apps/api/src/ai/tools/data-tools.ts`), así el
        asistente responde preguntas sobre los registros y propone cambios
        masivos con el mismo contrato propone→aplica. Lectura:
        `query_records` (máx 50 filas; filtros AND, búsqueda, orden y columnas
        por slug; los selects viajan con su etiqueta) pasa por
        `RecordsService.list` → **el ACL y el own-scoping de la persona se
        aplican solos** (un agente sólo ve lo suyo); `aggregate_records`
        (count/sum/avg/min/max, desglose por campo o por período) exige
        `view_records` porque el motor de agregados no acota por fila.
        Escritura: `propose_create_records` (hasta 50, valida requeridos y
        tipos), `propose_update_records` y `propose_delete_records` — por
        filtros o por ids exactos (los de query_records), tope 500, y **nunca
        toda la lista sin filtro**; los afectados se resuelven al proponer CON
        el ACL de la persona, la tarjeta muestra el recuento y una muestra de
        filas (edición ≥10 registros y todo borrado = confirmación reforzada),
        y aplicar corre por `RecordsService.bulk`, que re-aplica capabilities
        fila por fila (`bulk_actions` para masivas, `create_records` para
        altas). Los valores pasan por `validateFieldValue` (el validador
        compartido del import y del motor) y los selects aceptan el value o la
        etiqueta ("Pagada" → `pagada`), también en los filtros.
        **Inyección**: lo que sale de un registro es texto de usuarios — se
        recorta a 300 chars por celda, viaja envuelto en un objeto con una
        nota explícita de "DATOS, no instrucciones", y el prompt (reglas 10 y
        11) lo refuerza; como escribir exige una propuesta que sólo la persona
        aplica, un registro malicioso no ejecuta nada por sí mismo. La
        tarjeta gana el recuento de afectados y la tabla de muestra; el
        `ProposalsService` despacha por tipo a StructureTools o DataTools.
        9 tests de API nuevos (Postgres+Redis reales: filtros/orden/etiquetas/
        recorte, ACL del agente, agregados con desglose, edición masiva por
        etiqueta aplicada con bulk, rechazo sin filtro / valor inválido / slug
        desconocido / sin coincidencias, alta con requeridos, borrado por ids
        destructivo, capability por rol) — 506 API en verde — + E2E navegador
        12/12 (tarjeta "Edición masiva" con recuento, muestra y cambio,
        Aplicar → los registros cambian en la API y la tabla abierta se
        refresca sola, 409 al re-aplicar).
  - [x] **Fase 3 — Servidor MCP + tokens de acceso personal (v0.1.183)**:
        el mismo registro de herramientas, para Claude/Cursor/cualquier
        cliente MCP. `POST /api/v1/mcp` (Streamable HTTP **sin estado**: un
        `McpServer` por request sobre `reply.hijack()`; GET/DELETE → 405) con
        `Authorization: Bearer ib_pat_…`. **Tokens** (`personal_access_tokens`,
        migración 0049, sin RLS como los webhooks entrantes — la búsqueda es
        por hash antes de conocer el tenant): de UNA persona en UN workspace,
        secreto de 32 bytes mostrado UNA vez y guardado sólo como SHA-256 +
        prefijo, vencimiento 7/30/90/365/nunca, revocación inmediata, y el
        **rol se resuelve en vivo** contra `memberships` en cada uso (sacar a
        la persona, desactivar su cuenta o cambiarle el rol se refleja al
        instante — test). Alcances: `read` (list_lists, get_list_schema,
        query_records, aggregate_records) y `full` (además las `propose_*` del
        rol + `apply_proposal`, porque acá no hay tarjeta: el cliente muestra
        la propuesta y la aplica por id cuando la persona confirma — el
        contrato propone→aplica no cambia y el token nunca amplía permisos: un
        viewer con `full` sigue sin `propose_*`). Endpoints `GET/POST /me/
        tokens`, `DELETE /me/tokens/:id` con bitácora `token.create`/
        `token.revoke` (sin el secreto). Front: sección **"Conexión MCP"** en
        Ajustes → Cuenta → Seguridad (crear con nombre/alcance/vencimiento →
        secreto una vez + snippets listos de Claude Code y JSON para Claude
        Desktop/Cursor con la URL real, lista con prefijo/último uso/
        vencimiento, revocar). `docs/mcp.md` (conexión, contrato, prueba con
        curl, seguridad, límites). **OJO SDK**: `registerTool` con un shape
        Zod dinámico dispara "Type instantiation is excessively deep" — se
        castea (`as never`); el registro valida el input con su propio
        schema al ejecutar. 4 tests de API (tokens: secreto/hash/listado/
        revocación, vencido/desactivado/sin membresía/cambio de rol; MCP con
        el `Client` del SDK por transporte en memoria: herramientas por
        scope y rol, propose→apply crea la lista, re-aplicar e id inválido
        como isError) — 510 API en verde — + E2E (card: crear → secreto y
        snippets → fila sin secreto → revocar; HTTP real: initialize sin
        sesión, tools/list por scope, list_lists/query_records, propose →
        apply crea la lista, 401 sin/mal token, 405 GET, token revocado →
        401 al instante, bitácora).

        **Con esto F10 queda completa: asistente de estructura, de datos y
        acceso MCP externo, con la clave/cuenta como decisión del operador
        (compartida con cuota por plan y/o propia por empresa).**

  - [x] **Fase 4 — OAuth 2.1 para el MCP: "Autorizar" en vez de pegar un token
        (v0.1.184, pregunta del usuario: "¿puedo conectar directamente mi
        suscripción de Claude, como en VS Code?")**: la app NO puede usar la
        suscripción (Anthropic prohíbe los tokens OAuth de Free/Pro/Max en
        productos de terceros desde febrero de 2026 — el asistente ✨ sigue con
        API key), pero el camino inverso sí: que Claude, pagado por la
        suscripción, se conecte a la app. claude.ai, Claude Desktop y el
        celular sólo admiten conectores remotos por **OAuth** (no una cabecera
        fija), así que Imagina Base es ahora **servidor de autorización OAuth
        2.1** del MCP (ADR-S21 fase 4). Backend (`ai/oauth.*`,
        `well-known.controller`): metadata RFC 8414/9728 en la RAÍZ del host
        (`/.well-known/oauth-authorization-server`,
        `/.well-known/oauth-protected-resource[/api/v1/mcp]`, excluidas del
        prefijo `/api/v1`; el 401 del MCP anuncia `resource_metadata`),
        **registro dinámico** abierto (RFC 7591, tabla `oauth_clients`,
        migración 0050; redirect URIs sólo https / http en loopback / esquema
        de app nativa; `none` o secreto hasheado), `GET /api/v1/oauth/
        authorize` que valida (cliente y redirect desconocidos → 400 en TEXTO,
        nunca redirect) y manda a la **pantalla "Autorizar"** del SPA
        (`/oauth/authorize?req=…`, fuera del hash router como /reset y
        /verify: sin sesión aparece el login y después la MISMA pantalla;
        elige workspace de sus membresías —verificado en el backend— y
        alcance read/full), `approve`/`deny` con sesión (GETDEL: el pedido se
        consume), `POST /oauth/token` (form-urlencoded o JSON; **PKCE S256
        obligatorio**, `resource` RFC 8707 = nuestro MCP, code de un solo uso
        que se quema aunque el PKCE falle, `redirect_uri` igual a la del
        pedido) y `POST /oauth/revoke` (RFC 7009). **El token emitido es una
        fila de `personal_access_tokens`** (`client_id`, `refresh_token_hash`,
        `refresh_expires_at`): acceso 1 h + **refresh rotativo** de 30 días
        (rotación con `WHERE` del hash viejo → dos canjes concurrentes, uno
        gana; el par viejo muere), resuelto por el MCP igual que un token
        pegado (rol en vivo, fail-closed), listado en Ajustes como "Conexión
        autorizada · se renueva solo" con el MISMO Revocar (mata acceso y
        refresh) y en la bitácora (`token.create`, `via: oauth`). Issuer =
        origen de la request (`X-Forwarded-*`; vite en dev pasa `xfwd`): cada
        dominio propio (ADR-S17) es su propio servidor OAuth. CORS `*`
        acotado a `/.well-known/oauth-*`, `/api/v1/oauth/*` y `/api/v1/mcp`
        (Bearer, sin cookies). **Proxies**: regla nueva `/.well-known/oauth-*`
        → API en Caddyfile y nginx.conf — la auto-actualización NO toca el
        proxy, en un servidor existente se agrega a mano (runbooks
        actualizados). Card de tokens: bloque "Conectar desde claude.ai…"
        con la URL a pegar; los tokens pegados a mano siguen valiendo.
        **Dos tropiezos**: Nest responde 201 a todo POST → el token endpoint
        fija 200 (OAuth lo exige); y `@nestjs/platform-fastify` YA registra
        el parser de `x-www-form-urlencoded` (agregar otro tumba el boot con
        FST_ERR_CTP_ALREADY_PRESENT). 12 tests (5 puros de redirect/PKCE/
        scope/resource/credenciales + 7 con Postgres y Redis reales: metadata,
        DCR, authorize con cada error, approve/deny, canje con code quemado y
        cliente intruso, refresh rotativo + revocación, cliente confidencial
        con Basic) — 522 API, 125 front y 66 shared en verde — + E2E 27/27
        (descubrimiento por el host público, DCR, authorize → login → consent
        → code+state en un callback loopback real, canje form-urlencoded,
        replay rechazado, MCP con el token, refresh, fila en la card, revocar,
        cancelar, pedido vencido, cliente desconocido sin redirect).
        **Límite de la verificación**: claude.ai no alcanza el sandbox; el
        flujo se probó con un cliente OAuth propio que sigue las mismas RFC
        que usa Claude (DCR + PKCE + resource); la prueba con el conector
        real queda para el servidor del usuario.

  - [x] **El rol `client` no conecta asistentes (v0.1.185, salió de la
        pregunta del usuario "¿cada cliente puede hacer esto o sólo el
        admin?")**: la respuesta era "cualquier miembro del equipo con su
        rol", pero al revisarla apareció un hueco: el usuario del PORTAL
        (rol `client`, "solo portal" por definición) tiene sesión y
        membresía, y nada le impedía crear un token (`POST /me/tokens`) ni
        aprobar un conector OAuth — y como `list_lists` / `get_list_schema`
        no filtran por rol (el ACL vive en records), habría visto nombres y
        campos de TODAS las listas de la empresa. Cierre en tres capas:
        `assertNotClient` al crear el token (el controller pasa el rol del
        TenantGuard) y al aprobar en OAuth (se lee el rol de la membresía),
        y `resolve` devuelve `null` para una fila cuyo rol EN VIVO sea
        client (cubre el caso "le bajaron el rol después de emitir"). La
        pantalla "Autorizar" filtra las membresías client y, si no queda
        ninguna, explica que la cuenta sólo tiene acceso al portal. 1 test de
        integración (approve 403, create 403, fila colada no resuelve) —
        523 API en verde; `docs/mcp.md` aclara quién puede conectar.

  - [x] **Descubrimiento OAuth sin tocar el proxy (v0.1.186, reporte del
        usuario con captura: "Failed to start MCP authorization" en la app
        de Claude, y `/.well-known/oauth-authorization-server` lo mandaba al
        login)**: el proxy de producción sirve `/api/*` al API y TODO lo
        demás al SPA con fallback a `index.html`, así que la metadata OAuth
        en la raíz del host devolvía un 200 con HTML. Leyendo el SDK del
        cliente MCP: ante un 200 intenta `response.json()`, revienta y NO
        prueba las URLs alternativas (sólo sigue con 4xx) — o sea, sin regla
        de proxy no había forma de que Claude descubriera el servidor, y el
        usuario pidió con razón que se corrigiera desde un release, no a
        mano. Tres capas: (a) **archivos estáticos** — `deploy.sh` (que la
        auto-actualización SÍ ejecuta) corre `deploy/oauth-discovery-static.sh`
        y deja `web/.well-known/oauth-authorization-server`,
        `openid-configuration` y `oauth-protected-resource/api/v1/mcp` (forma
        path-aware, por eso ése es directorio) con el `APP_BASE_URL` del
        `.env` — `try_files` sirve un archivo real antes del fallback; sin
        `APP_BASE_URL` válido avisa y el deploy sigue. (b) El
        `WWW-Authenticate` del MCP apunta a
        `/api/v1/oauth/.well-known/oauth-protected-resource` (bajo el prefijo
        del API, que cualquier proxy enruta) y el API sirve también ahí
        `oauth-authorization-server` y `openid-configuration`; la raíz gana
        `openid-configuration`. (c) `resource` (RFC 8707) se valida por PATH
        (`/api/v1/mcp`) y no por host: con el estático el issuer es el
        dominio de la plataforma aunque una empresa use el MCP por su dominio
        propio. La card de Ajustes gana un **autodiagnóstico** (prueba desde
        el navegador `/api/v1/oauth/.well-known/…` y la raíz: verde si Claude
        puede conectarse; si no, dice si falta actualizar o si el proxy sirve
        la app en vez del JSON). Runbooks y `docs/mcp.md`: la regla de proxy
        pasa a OPCIONAL (responde por host). 2 tests del generador (bash real
        en tmp: los tres documentos con issuer sin barra final; sin
        `APP_BASE_URL` no escribe nada) + expectativas actualizadas — 525 API
        en verde; E2E navegador 29/29 y **simulación del proxy de producción
        con el SDK MCP real** 6/6: sin estáticos falla igual que Claude, con
        los archivos del deploy descubre PRM + servidor, el 401 lleva a /api,
        y con la regla de proxy responde por host.

  - [x] **Paginación real del listado (v0.1.187, reporte del usuario: "un
        CSV de más de 2.000 registros sólo me importa 200")**: el importador
        NO era el problema — inserta hasta 5.000 filas por corrida y el
        resultado lo decía ("2.500 registros importados"). Lo que mentía era
        la TABLA: el adaptador del front descartaba `page` ("la paginación
        por cursor completa llega en una etapa posterior", que nunca llegó),
        capaba `limit` a 200 y devolvía `total = filas recibidas` con
        `total_pages = 1` — así que la lista mostraba la primera tanda de
        200, decía "200 registros" y no ofrecía ninguna página siguiente.
        Fix end-to-end: (a) el listado acepta `page` (offset
        `(page-1)*limit`, también sin sort por campo) y devuelve
        `meta.total`/`page`/`per_page`/`total_pages`, contado con el MISMO
        where (filtros, búsqueda, scope ACL, subtareas) en una query aparte
        — el camino por cursor de los clientes de API no cambia ni cuenta
        nada (`with_total` lo pide sin paginar); `parseListQuery` copia los
        dos parámetros (es whitelist: la trampa de v0.1.68 y v0.1.132);
        (b) `cloudRecordsQuery` deja viajar `page` y `cloudRecordsMeta`
        arma la meta de la UI desde el total real (sin `page` —subtareas,
        pickers— la tanda sigue siendo una sola página); (c) con eso la
        `Pagination` existente funciona ("1–200 de 2500 · Página 1 de 13"),
        el buscador pasa a server-side cuando la lista supera una página
        (antes creía que TODA lista era chica) y kanban/tarjetas/calendario
        avisan "Mostrando 200 de 2500 registros — usá filtros" en vez de
        callar. Tests: 1 de integración (páginas sin solapar, total con
        búsqueda, página vacía más allá del final, cursor intacto) + 2 del
        whitelist + 4 del adaptador (528 API, 129 front en verde) y E2E
        navegador 13/13 con un CSV REAL de 2.500 filas (import completo,
        páginas 1→2→1 con las filas correctas, búsqueda, aviso en kanban).
        OJO: en el entorno de dev el tenant 1 está en plan `trial` (500
        registros) y el import de 2.500 rebota con `plan_limit_reached` —
        comportamiento correcto (SEC-09): para la prueba se subió el plan a
        mano y se restauró al terminar.

  - [x] **El buscador de registros busca también en la DESCRIPCIÓN
        (v0.1.188, reporte del usuario: "el buscador no está buscando en el
        campo descripción")**: el cuerpo del registro (el documento
        ProseMirror de v0.1.133) no era un campo, así que ni el ILIKE del
        servidor ni el filtro in-memory del navegador lo miraban — lo escrito
        ahí era invisible para la búsqueda. (a) **Columna generada**
        `records.description_text` (migración 0051): Postgres concatena
        todos los nodos de texto del árbol a cualquier profundidad
        (`jsonb_path_query_array(doc, 'strict $.**.text')` — títulos,
        columnas, listas, tablas) y la mantiene SOLO en cada escritura; el
        código de la app nunca la toca y los registros existentes se
        rellenan al aplicar la migración (la tabla se reescribe una vez:
        segundos con cientos de miles de filas). Índice trigram, el mismo
        que usan los campos de texto indexados. (b) `compileSearch` suma el
        `ILIKE` sobre esa columna al OR de los campos searchables, y para la
        **vista agrupada** —que compone la búsqueda como filter tree— hay un
        pseudo-campo con id RESERVADO negativo (`DESCRIPTION_SEARCH_FIELD_ID`,
        sólo operadores de texto) inyectado en el whitelist del listado y del
        motor de agregados: buckets, filas y pie lo ven igual; un cliente no
        puede colarlo porque Zod exige `field_id` positivo. (c) **Front**: la
        búsqueda in-memory de las listas chicas no ve el documento (a
        propósito no viaja en el listado), así que si alguna fila trae
        `has_description` la búsqueda va al servidor aunque la lista sea
        chica (`canSearchClientSide`); una lista sin descripciones sigue
        filtrando en el navegador sin round-trip. De paso el filtro
        in-memory suma `phone`, como el servidor desde v0.1.158. Tests: 1 de
        integración (plana: match por el cuerpo anidado en columnas, el
        título sigue, borrar la descripción la saca; agrupada: buckets +
        filas) + 3 unitarios del front (529 API, 132 front en verde) y E2E
        navegador 14/14 (lista chica con descripción busca en el servidor y
        encuentra por cuerpo/columna/título, agrupada 1 grupo · 1 registro,
        lista sin descripciones filtra en el navegador con cero requests).

  - [x] **Agrupar por multi_select: un grupo por OPCIÓN, con sus filas,
        etiqueta y color (v0.1.189, reporte del usuario con captura: grupos
        `["astra_pro", "starter_templates"]` sin color, con contador pero
        sin registros, y la casilla del grupo marcada)**: tres bugs de una
        misma causa. El motor de agregados agrupaba un multi_select por el
        JSON crudo del set (`data->>'fN'`), así que cada COMBINACIÓN era un
        bucket; el front, en cambio, ya estaba escrito para un valor por
        grupo (`formatBucketLabel` busca UNA opción, `filterOpForBucket` usa
        `contains`) — y el propio bundle pedía las filas del grupo con `eq`
        contra ese JSON, que en multi_select compila a `@>` con el set
        entero como elemento: cero filas. La casilla marcada era `every`
        sobre cero filas. Ahora: (a) `AggregateService.run` gana la opción
        `multiSelect: 'each'` — desanida el array con `LEFT JOIN LATERAL
        jsonb_array_elements_text` (SQL crudo dentro del tx del tenant): un
        bucket por opción, el registro cuenta en cada una de las suyas (como
        las etiquetas de ClickUp) y los sin opciones caen al bucket null;
        los dashboards conservan el bucket por combinación a propósito
        (v0.1.103/v0.1.178 —click-through con `gvs`, etiquetas compuestas—
        lo dan por hecho). (b) `RecordsGroupedService` la usa para los
        buckets, filtra cada grupo con `contains` y el resumen "N grupos ·
        M registros" cuenta registros DISTINTOS (la suma de los grupos
        repetiría los que tienen varias opciones). (c) La casilla del grupo
        sólo se marca con filas, y el resumen pluraliza de verdad ("1 grupo
        · 1 registro", antes "1 grupos · 1 registros"). Con el valor por
        opción, el chip del grupo toma solo la etiqueta y el color reales.
        2 tests de integración (aggregate: combo vs each con null; bundle:
        buckets, el mismo registro en dos grupos, null, total distinto —
        531 API, 132 front en verde) + E2E navegador 11/11
        (etiquetas sin JSON, contadores por opción, "(Sin valor)", resumen
        4 · 4, Cliente A en dos grupos, chip con el color de la opción,
        casillas sin marcar, búsqueda en agrupada).

  - [x] **Corrección de rumbo: agrupar por multi_select es por COMBINACIÓN,
        como ClickUp (v0.1.190, feedback del usuario con captura: "¿por qué
        aparece en 2 grupos? se pierde el sentido de agrupar")**: la v0.1.189
        eligió "un grupo por opción" y eso DUPLICA registros; ClickUp agrupa
        por el conjunto exacto de etiquetas (63 con «Elementor pro + Astra
        pro + Starter Templates», 1 con «Greenshift + Pixelavo + HT Easy
        GA4»), cada registro en un solo grupo y el encabezado con TODOS los
        chips del combo, cada uno con su color. Ahora: (a) el motor de
        agregados agrupa un multi_select por el set **normalizado**
        (`jsonb_agg(e ORDER BY e)::text` → `["a", "b"]`; `["b","a"]` es el
        mismo grupo; sin opciones → null) — se quitó el modo por opción de
        v0.1.189; (b) `eq`/`neq` de multi_select con un ARRAY compilan a
        igualdad de conjunto (`@>` y `<@`, sin importar orden ni
        duplicados; con escalar siguen siendo "contiene"), y el bundle pide
        las filas del grupo así — los grupos son disjuntos, la suma vuelve a
        ser el total; (c) front: `lib/multiBucket` parsea la clave del
        bucket y ordena las opciones como el catálogo; el encabezado dibuja
        UN chip por opción con su color, la etiqueta accesible une las
        opciones con «+», el filtro de la página 2 usa `eq` con el array y
        "+ Agregar" dentro del grupo pre-carga TODAS las opciones del combo.
        Los dashboards ya agrupaban por combinación: ahora su clave también
        viene normalizada (`prettyGroupLabel`/`gvs` parsean JSON, no
        cambian). 2 tests de integración reescritos (aggregate: mismo set
        en distinto orden = un grupo, null; bundle: filas exactas —"Solo
        VIP" no entra al grupo de dos—, nadie repetido, total = suma) + 2
        unitarios del front (531 API, 134 front en verde) + E2E navegador
        11/11 (grupo «Astra Pro + Starter Templates» con Cliente A, «Astra
        Pro» sólo con B, cada registro UNA vez, dos chips con sus colores,
        alta desde el grupo con las dos opciones, búsqueda).

  - [x] **Filtros que se ELIGEN, no se tipean (v0.1.191, reporte del usuario
        con captura: "es alguno de" pedía escribir `al_dia, vencido` a mano)**:
        regla nueva del lado "valor" de un filtro — donde el campo YA sabe
        cuáles son sus valores posibles, el usuario elige; tipear queda para
        texto, números y fechas. `FilterOptionPicker` (nuevo): dropdown con
        buscador, casillas y los chips con el COLOR de cada opción, en modo
        simple (`es`/`no es`) o múltiple (`es alguno de`/`no es ninguno de`,
        queda abierto para marcar varias; × por chip). Es un div absoluto
        SIN portal, como el autocompletado de v0.1.85: un Popover de Radix
        dentro del panel de Filtros se auto-descarta; y Escape cierra sólo el
        picker — el panel escucha Escape en el `document` en fase de captura,
        así que el picker lo intercepta en `window` (que captura antes).
        Aplica a: **select y multi_select** (todos los operadores; el
        multi_select ahora dice "incluye / incluye alguno de", porque `eq`
        escalar compila a "contiene", no a igualdad del set), **usuario**
        (`FilterUserPicker`: se busca por nombre con el endpoint del picker de
        asignación, acceso directo "Yo (mi usuario)" y los ids elegidos se
        resuelven a nombre — antes era un `<input type=number>` donde había
        que saber el ID interno), **calificación** (las estrellas del
        `RatingControl`, también para ≥/≤) y **archivos**, que pierden
        `eq/in` contra un número (nunca matcheaban: el valor es una lista de
        ids) y quedan con "tiene archivos / sin archivos" — el backend
        compila ambos por PRESENCIA del array (`[]`, `null` JSON y clave
        ausente cuentan como vacío; `(data->>'fN') IS NULL` daba falso con
        `[]`). `valueForOperator` (puro, con tests): al cambiar de operador
        el valor cambia de forma conservando lo elegido (`pendiente` →
        `[pendiente]`, `[a, b]` → `a`; antes el string suelto quedaba pegado
        a un `in` y el backend lo descartaba). Mismos pickers en la
        **edición masiva** ("Actualizar campo": el multi_select pedía "opt1,
        opt2" tipeado) y en las condiciones de **automatizaciones**
        (`ConditionEditor` comparte `FilterValueInput`). 1 test de API
        (file: is_null/is_not_null por presencia, `eq` descartado) + 8
        unitarios del front (532 API, 142 front en verde) + E2E navegador
        26/26 (picker con 3 chips de color, multi que no se cierra, request
        con `"op":"in","value":["al_dia","vencido"]`, Escape sólo cierra el
        picker, "es" conserva la primera opción, usuario por nombre y "Yo",
        estrellas ≥ 3, archivos tiene/sin, edición masiva con picker y
        persistida).

  - [x] **Fecha del picker en el formato de la empresa + cabeceras fijas al
        scrollear (v0.1.192, dos reportes del usuario con capturas)**:
        (a) **El picker de fecha hablaba otro idioma que la tabla**: la celda
        decía `30/07/2026` (formato regional dmy, v0.1.104) y el cuadro
        "escribir fecha" del picker `2026-07-30`, con el calendario en
        "September 2026 / su mo tu" — y encima abría en el mes de HOY, no en
        el de la fecha del registro (la captura del usuario: 30/07 en la celda
        y septiembre en el calendario). Ahora el cuadro muestra y LEE la fecha
        en el formato de la empresa (`manualDate.ts`, puro y con tests:
        `formatManualDate` / `parseManualDate(text, format)` — con `mdy`,
        `07/30/2026` es el 30 de julio y `30/07/2026` es inválida en vez de
        adivinar; el ISO se acepta siempre; placeholder `DD/MM/AAAA` /
        `MM/DD/AAAA` / `AAAA-MM-DD`), el calendario va en español
        (`locale={es}` de react-day-picker, semana desde el lunes como la
        vista Calendario) y abre en el mes de la fecha elegida
        (`defaultMonth`); los atajos ("Hoy vie", "26 sept") también fuerzan
        `es` en vez del locale del navegador.
        (b) **Cabeceras fijas, como ClickUp**: al scrollear la lista se
        quedan arriba las tres filas de cabecera de la página (breadcrumb,
        pestañas de vistas y toolbar — `position: sticky` con `-top-2` para
        pegarse al borde del área de trabajo, no 8px abajo por el padding del
        `<main>`, y una línea inferior sólo mientras está pegada, por un
        centinela con IntersectionObserver), la **cabecera de columnas** de
        la tabla y, en la agrupada, el **encabezado del grupo** que se está
        recorriendo con su cabecera de columnas debajo — y al terminar el
        grupo se va con su sección y lo reemplaza el del siguiente. El
        `<thead sticky>` que había desde F1 nunca funcionó: `position:
        sticky` se pega al scroll container MÁS CERCANO, y el wrapper
        `overflow-x-auto` de la tabla lo es aunque sólo scrollee en
        horizontal (el vertical es el del `<main>`, v0.1.70) — se pegaba a
        un contenedor que no scrollea en vertical, o sea, a nada. Partir la
        tabla (thead afuera) rompía la alineación de columnas y hacer que
        el main scrollee en horizontal se llevaba el chrome de la página;
        el hook `usePinToTop` DESPLAZA el elemento con `transform:
        translateY` contra el scroll del main lo justo para quedar bajo la
        cabecera fija (`[data-imcrm-sticky-top]`) mientras su caja (la
        tabla / la sección del grupo) siga en pantalla, con lecturas de
        layout primero y una sola escritura de transform por frame (es
        propiedad compuesta: no invalida el layout). La primera columna
        sigue sticky-left dentro del wrapper y el contenido del encabezado
        del grupo va `sticky left-0` para no irse al scrollear en
        horizontal. Sigue habiendo UN solo scroll vertical (el del main).
        4 tests unitarios (146 front en verde) + E2E navegador 24/24
        (cuadro `30/07/2026` con dmy y `07/30/2026` con mdy, guardado
        correcto en ambos, "julio 2026 / lu ma mi", scroll 900 → cabecera
        pegada al borde del main y thead pegado justo debajo con
        `data-pinned` y tapando las filas; agrupada: encabezado del grupo 1
        y su thead pegados, al pasar al grupo 2 se pega el suyo y el 1 se
        va con su sección sin superponerse; el único scroller del área de
        trabajo sigue siendo el main).

  - [x] **Cabeceras fijas con sticky NATIVO + el MCP lee las automatizaciones
        completas (v0.1.193, dos reportes del usuario)**:
        (a) **"Los headings de las agrupaciones se superponen sobre todo y al
        hacer scroll rebotan"**: la v0.1.192 pegaba las cabeceras por
        JavaScript (`transform: translateY` recalculado en cada evento
        `scroll`), y eso llega UN CUADRO TARDE respecto del scroll del
        compositor — en el navegador real se ve como un rebote en cada
        rueda; el E2E con `scrollTo` instantáneo no lo mostraba. Y el
        encabezado del grupo que se iba tenía el mismo `z-30` que la
        cabecera de la página y venía después en el DOM, así que pintaba
        ENCIMA de ella. Se tiró `usePinToTop` y ahora todo es `position:
        sticky` nativo (cero JS en el camino del scroll): la **tabla se
        parte en dos** — el `<thead>` vive en su propia `<table>` dentro de
        un wrapper sticky (con un `overflow: hidden` interno cuyo
        `scrollLeft` se copia del scroller del cuerpo), y el cuerpo queda en
        el `overflow-x-auto`; las dos tablas comparten `colgroup`,
        `table-layout: fixed` y `minWidth`, así las columnas quedan
        alineadas al pixel. Por eso funciona: el sticky se pega al scroll
        container MÁS CERCANO, y sacando la cabecera del wrapper horizontal
        su contenedor pasa a ser el `<main>`. En la agrupada cada grupo tiene
        su scroller de cuerpo y su cabecera, sincronizados por un registro
        compartido (`HScrollSyncContext`) y la barra espejo del fondo se
        re-apunta al primer grupo montado (`retargetKey`). `stickyTop.ts`:
        `PageStickyTopContext` (RecordsPage mide su bloque fijo y descuenta
        el padding del main), `useElementHeight` y `useStuckSentinel` toman
        el ELEMENTO de un callback ref con `useState` — con un RefObject el
        efecto corría una vez con el ref vacío, porque la cabecera se monta
        después de que carga la lista. Pila de capas explícita: bloque de la
        página `z-[35]` > encabezado de grupo `z-30` > cabecera de columnas
        `z-20` > celdas sticky-left. La línea de separación se dibuja sólo
        mientras hay contenido pasando por debajo (centinela con
        IntersectionObserver).
        (b) **"Desde el MCP en un chat normal me dice que sólo puede ver
        que la automatización existe, no su configuración"**: era un hueco,
        no una decisión — `get_list_schema` devolvía de cada automatización
        sólo id, nombre, trigger y si está activa. Ahora viaja la
        configuración COMPLETA (`trigger_config` y `actions`, con `if_else`
        anidado) pasada por `redactSecrets`: cualquier clave que parezca un
        secreto (secret/token/password/api_key/authorization) sale como
        `[oculto]` — el token del webhook entrante y el secreto HMAC no se
        filtran por el MCP, lo demás sí. Copiar una automatización de una
        lista a otra desde Claude ahora funciona (leer → `propose_create_
        automation` con la misma config). 3 tests unitarios del enmascarado
        (146 front, API completa en verde) + E2E navegador 29/29 (cabeceras
        `position: sticky` sin transform, columnas alineadas entre la tabla
        de cabecera y la del cuerpo, cabecera de la página SIEMPRE encima
        por `elementFromPoint`, el encabezado del grupo 1 se va con su
        sección y entra el del 2, scroll horizontal sincronizado entre
        grupos, un solo scroller vertical).

  - [x] **Scroll horizontal táctil sin "pelea" (v0.1.194, reporte del
        usuario: "en celular el scroll horizontal avanza muy poquito, se
        siente como arrastrar con fuerza y a cuadros pegados, peor en las
        agrupadas")**: dos causas, las dos nacidas con la tabla partida de
        v0.1.193. (a) **El eco de las copias pisaba al dedo**: el cuerpo que
        la persona arrastra copiaba su `scrollLeft` a la barra espejo y, en
        la agrupada, a los otros cuerpos y cabeceras; el evento `scroll` de
        cada copiado llega UN CUADRO DESPUÉS, cuando el dedo ya movió el
        original unos px más, y como la barra espejo (desde v0.1.75) y el
        registro de grupos sincronizaban en los DOS sentidos, ese eco traía
        el valor viejo y lo escribía de vuelta sobre el scroller que se
        estaba arrastrando — el guard `!==` no ayuda porque el valor es
        distinto justamente por el retraso. En táctil el compositor va
        adelante del hilo principal, así que el eco es sistemático: por eso
        no se sentía con el mouse, y en la agrupada (N cuerpos + N cabeceras
        + la barra devolviendo ecos) era peor. Fix: `hscrollGroup.ts` — un
        grupo de scrollers donde cada escritura programática se RECUERDA (el
        valor se lee tras asignar, por si el navegador lo recortó) y el
        evento que llega con exactamente ese valor se ignora como eco; el
        que trae otro valor lo movió la persona y se propaga. Cuerpo,
        cabecera partida, cada grupo de la agrupada y la barra espejo son
        miembros del MISMO grupo (la barra deja de tener su sincronía
        propia: arrastrarla mueve a todos). (b) **Cabeceras repintadas en
        cada cuadro**: el wrapper de la cabecera era `overflow: hidden`
        movido por JS, y eso NO se compone como capa en móvil (Chrome sólo
        compone los scrollers que el usuario puede scrollear) → cada cuadro
        repintaba la tabla de cabecera (una por grupo) en el hilo principal
        — los "frames pegados". Ahora las cabeceras son `overflow-x: auto`
        con la barra nativa oculta + `will-change: scroll-position`, y de
        yapa en táctil la cabecera pegada TAMBIÉN se arrastra para mover
        las columnas. 4 tests unitarios del grupo (jsdom, reproducen el eco
        tardío exacto: `a→100`, el dedo sigue a 105, llega el eco de `b` con
        100 y `a` se queda en 105) — 150 front en verde — + E2E navegador
        20/20 en 390×844 táctil con arrastres reales por CDP (250 px de
        dedo → 253 px de scroll sin un solo retroceso en las muestras ni en
        los eventos, tres cuerpos + cabeceras + barra alineados, arrastrar
        otro grupo o la cabecera mueve a todos, columnas alineadas) y
        escritorio con rueda horizontal. **Límite de la verificación**: el
        Chromium headless del sandbox NO reproduce el retraso compositor/
        hilo principal del teléfono — con el código viejo el mismo E2E daba
        19/20 (sólo falló "arrastrar la cabecera"), así que la prueba del
        eco es el unitario y la del repintado es el razonamiento; el
        resultado final se comprueba en el celular del usuario.

  - [x] **El MCP/asistente configura el portal del cliente y la ficha del
        registro + auditoría de brechas (v0.1.195, pregunta del usuario "¿en
        el MCP se puede crear portal de cliente y vista CRM?" → "hacé las 2
        bien hechas y revisá qué más le falta")**. La auditoría (registro de
        herramientas vs. todos los controllers) dio la causa de fondo: todo
        lo que vive en `list.settings` —portal, plantilla del portal, layout
        de la ficha, ACL, publicación— era a la vez INVISIBLE para el modelo
        (`get_list_schema` no devolvía `settings`) e INESCRIBIBLE (la única
        clave que `propose_update_list` tocaba era `title_field_id`), y
        además ninguna de esas claves tenía schema Zod: los editores
        visuales las escribían a ciegas.
        (a) **Schema compartido** `list-config.ts`: `portalSettingsSchema`,
        `portalTemplateSchema` (los 21 tipos de bloque del editor con
        `config` passthrough — un bloque guardado trae claves de estilo que
        no se enumeran), `recordLayoutSchema` (classic/crm),
        `crmTemplateIdSchema` (auto/contact/deal/task/support/custom) y
        `crmCustomConfigSchema` (V2: grid de 12 columnas, header + blocks) +
        lectores tolerantes `readPortalConfig`/`readRecordLayout` que nunca
        lanzan.
        (b) **`propose_configure_portal`** (`manage_lists`): habilitar,
        listas que ve el cliente (por slug, validadas contra el MISMO
        criterio del scope del portal —relation hacia la lista o campo
        user— con una sola query sobre `fields`) y la plantilla como lista
        de bloques en el vocabulario del modelo (hero, heading, notice,
        static_text, client_data, editable_form, related_records_table,
        kpi_widget, download_files, comments_thread, activity_timeline,
        external_link, contact_card, faq, quick_actions, divider, spacer).
        `buildPortalTemplate` (PURO, `tools/list-config.ts`) valida slugs
        por lista, tipos (file para descargas, numérico para sum/avg, nada
        computado en el formulario editable), enlaces (https/mailto/tel),
        arma el `config` exacto que lee el portal público y ubica en el grid
        (a lo ancho; KPIs/enlaces/contacto comparten fila mientras quepan).
        Una tabla de registros vinculados SUMA sola esa lista a
        `related_lists` (si no, el bloque quedaría vacío por el fail-closed
        del scope). (c) **`propose_configure_record_layout`**
        (`manage_lists`): clásico, o CRM con plantilla integrada o `custom`
        → `buildCrmCustomConfig` genera el V2 con el mismo esqueleto que las
        integradas (header 12 cols; columna principal de 8 con grupos —icono
        adivinado por el nombre del grupo— y notas; lateral de 4 con cifras,
        vinculados, archivos, comentarios y actividad); los campos sin grupo
        van a "Otros datos" salvo `include_remaining_fields: false`.
        (d) **Aplicar mezcla en `settings` RELEYENDO la lista** y pisando
        sólo las claves de esa propuesta — una propuesta armada contra un
        snapshot no borra lo que otra persona cambió entre medio (hay test).
        (e) **`get_list_schema`** ahora expone `portal` (habilitado,
        relacionadas, VINCULABLES, resumen de bloques), `record_layout`,
        `public_sharing` y la carpeta. (f) **Brechas de la auditoría que
        entraron**: `propose_update_automation` (renombrar, PAUSAR/activar,
        reemplazar disparador o acciones con la misma validación de slugs
        que el alta), `propose_delete_automation`, `propose_update_view`
        (nombre, por defecto, config con el mismo builder del alta),
        `propose_delete_view`, `propose_delete_list` (destructiva, describe
        registros/campos/vistas/automatizaciones que se lleva), `folder` en
        `propose_update_list` (mover a carpeta por nombre), y dos lecturas:
        `list_dashboards` y `list_automation_runs` (log con secretos
        enmascarados). La tarjeta de propuesta dibuja la lista de bloques
        (`preview.blocks`) y el prompt ganó la regla 12. (Permisos por rol,
        publicación pública, comentarios y miembros llegaron en v0.1.201; lo
        que queda afuera está razonado en `docs/mcp.md`.) 6 tests unitarios de los constructores + 8
        de integración (Postgres+Redis con el `Client` del SDK MCP: schema
        expuesto, portal con validación/merge/deshabilitar, layout integrado
        → custom → clásico conservando lo del portal, automatizaciones
        pausar/reemplazar/borrar/runs, vistas, carpeta, tableros, borrar
        lista, scope read) — 549 API y 150 front en verde — + E2E 23/23 por el
        MCP REAL (HTTP + token personal: proponer → aplicar) y navegador (el
        editor del portal carga la plantilla propuesta con "Hola, Ana García",
        la ficha del registro renderiza el layout CRM propuesto —cabecera
        compacta con estado, grupo Contacto, nota, cifras, archivos,
        comentarios— y Compartir muestra Facturas marcada).

- [x] **F11 — Conectores e integraciones** (pedido del usuario: "conectar una
      app una vez y usarla en varios lados", con su propia app
      `was.imagina.cloud` como caso; decisiones tomadas con él: alcance por
      workspace con opción privada si el admin la habilita, credenciales de
      CADA EMPRESA —nada de cuentas del operador compartidas entre clientes— y
      conversión automática de lo que ya está escrito adentro):
  - [x] **Fase 1 — la conexión como objeto (v0.1.196, ADR-S22)**: hasta acá la
        credencial de un servicio externo se tipeaba DENTRO de la acción que la
        usaba —el secreto de firma en `config.secret` y el token en una cabecera
        `Authorization`, ambos en TEXTO PLANO dentro de `automations.actions`
        (jsonb)—. Con cinco automatizaciones contra el mismo gateway había cinco
        copias de la misma clave y rotarla era editarlas a mano; la prueba más
        clara de que estaban en el lugar equivocado es que en v0.1.193 hubo que
        escribir `redactSecrets` para que el MCP no las mostrara.
        (a) **Tabla `connections`** (migración 0052, RLS, único por nombre) con
        los secretos cifrados por el secret-box de SEC-20 —la misma
        `SECRETS_KEY` del SMTP por empresa— y lo no secreto (base URL, nombre
        de la cabecera, cabeceras fijas) en claro para poder mostrarlo.
        (b) **Un solo proveedor genérico, "API HTTP"**, con cinco formas de
        inyectar la credencial: `bearer`, cabecera propia, `basic`, parámetro
        de la URL y **campo del cuerpo** —éste último porque el gateway del
        propio usuario pide el `secret` como un campo más del formulario, y sin
        eso el caso que motivó el release no entraba—. Más secreto de firma
        HMAC opcional.
        (c) **La resolución es PURA** (`connectionParts`), igual que
        `buildWebhookRequest`: el motor, el probador de la acción y el botón
        "Probar conexión" inyectan la credencial con la MISMA función. Las
        partes ya resueltas se le pasan al builder como argumento; hacer I/O
        adentro haría divergir al probador del motor, que es justo el problema
        que el conector viene a resolver. En el motor se resuelve DENTRO de la
        transacción que ya está abierta (abrir otra tomaría una segunda
        conexión del pool por acción).
        (d) **Permisos**: la conexión del EQUIPO la crea el admin —misma puerta
        que el SMTP, el dominio y los miembros, porque la credencial puede
        gastar plata en nombre de la empresa— y la PRIVADA (sólo su dueño)
        existe si el admin la habilita. Ver el inventario y elegir una exige
        `manage_automations`. Una conexión privada usada en una automatización
        compartida sigue funcionando para todo el equipo, como en n8n: quién
        puede EDITARLA es otra pregunta y esa sí se filtra.
        (e) **El secreto no vuelve nunca**: sólo un hint de los últimos cuatro y
        los tres estados del SMTP (`none`/`ok`/`unreadable`). Una conexión
        ilegible o borrada **hace FALLAR** la acción con el motivo, en vez de
        mandar la petición sin credencial: el fallo silencioso es lo que costó
        el release v0.1.150. También se cubrió el borde de `SECRETS_KEY` vacía:
        `decryptSecret` devuelve el texto cifrado tal cual, así que se detecta
        y se reporta en vez de mandar esa basura como credencial.
        (f) **Borrar dice qué se rompe**: el uso se calcula recorriendo las
        acciones (incluidas las ramas de `if_else`) y borrar una conexión en uso
        se rechaza con la lista de automatizaciones; `GET /connections/:id/usage`
        la detalla.
        (g) **Conversión de lo que ya existe**: `GET /connections/inline-secrets`
        detecta las credenciales escritas adentro y las agrupa por host **más la
        huella de la credencial** —dos claves distintas en el mismo host son DOS
        conexiones: fusionarlas rompería una—, sin exponer el secreto (sólo el
        hint). `POST /connections/convert-inline` crea la conexión cifrada y
        reescribe las acciones, también las anidadas, sacando el secreto y
        dejando el `connection_id`. La URL se conserva ABSOLUTA a propósito: la
        conexión aporta credenciales, no destino. Con bitácora
        (`connection.create/update/delete/convert`, nunca el secreto).
        (h) **Front**: sección "Conectores" en Ajustes (inventario con estado,
        uso y credencial enmascarada; alta/edición con "Probar conexión" que
        pega a la API real y muestra lo enviado con el secreto tapado; toggle de
        conexiones privadas para el admin) y **selector de conexión** en la
        acción "Llamar webhook externo", que al elegir una esconde los campos de
        secreto de la acción. La tarjeta de conversión va arriba de todo con el
        nombre ya propuesto: convertir es un click.
        29 tests nuevos (19 unitarios de las piezas puras + 10 de integración
        con Postgres real: cifrado verificado en la fila cruda, aislamiento
        entre empresas, permisos, rotación, credencial ilegible, borrado en uso,
        conversión con acción anidada, dos credenciales en el mismo host, y una
        prueba de CABLE que manda la petición por un socket real y verifica la
        cabecera que llega) — 577 API, 150 front en verde — + E2E navegador
        36/36 (automatización con el secreto adentro → candidato → conversión →
        la acción queda limpia y apuntando a la conexión → el motor la resuelve
        al ejecutar → el panel y el selector del editor lo muestran).
        **Límite de la verificación**: el guard anti-SSRF de SEC-03 bloquea
        loopback, así que en el sandbox la petición del motor no llega a un
        servidor local; que la credencial viaje entera se prueba sobre un socket
        real en el test de integración, y el E2E comprueba que el motor la
        RESUELVE (el log del run distingue "destino bloqueado" de "la conexión
        ya no existe").

  - [x] **Fase 2 — acciones con NOMBRE por conector (v0.1.198)**: la fase 1
        guardó la credencial una sola vez, pero quien armaba una automatización
        todavía tenía que saber el método, la ruta y el content-type del
        servicio. Ahora una conexión declara sus **acciones con nombre** —
        "Enviar WhatsApp" con los campos *Destinatario* y *Mensaje*— y eso es
        lo que aparece en el menú del editor. Es lo que hace usable un
        conector, y es lo que hacen Zapier y n8n.
        (a) **Viven DENTRO de la conexión** (`connections.config.actions`, sin
        migración): el catálogo no es de la plataforma sino del servicio que
        cada empresa conectó, así que **agregar una integración es
        configuración, no un release** — que era exactamente la deuda anotada
        en la fase 1 ("agregar un tipo de acción toca seis lugares").
        (b) **Se COMPILAN a la misma config que `call_webhook`**
        (`compileConnectorCall`, PURO) y salen por `buildWebhookRequest`: un
        solo motor de peticiones salientes, así lo que prueba el editor es
        literalmente lo que ejecuta la automatización. Cada parámetro declara
        dónde viaja (cuerpo / URL / cabecera / `{clave}` de la ruta), si es
        obligatorio, su tipo y su valor por defecto.
        (c) **El merge se aplica UNA vez**, en el compilador; al builder se le
        pasa una función identidad. Expandir dos veces re-interpretaría como
        plantilla el texto de un registro (alguien que escribió `{{algo}}` en
        un campo) — hay test.
        (d) **La clave de la acción es estable**: renombrar la etiqueta NO
        rompe ninguna automatización guardada (regla de oro nº 1; el editor
        propone la clave del nombre sólo mientras la acción es nueva). Una
        clave que ya no existe **hace fallar** la acción nombrando la conexión
        —y el editor lo dice en la tarjeta— en vez de ejecutar otra cosa en
        silencio; un obligatorio vacío la saltea sin mandar nada, y un opcional
        vacío no viaja (mandar `nota=` le cambia el significado al pedido para
        muchas APIs).
        (e) **El catálogo `/actions` deja de ser una constante**: devuelve los
        5 tipos fijos más una entrada por acción de cada conexión visible, así
        el menú ofrece "Enviar WhatsApp" bajo una sección **Conectores** en vez
        de preguntar "¿qué tipo de acción?". Elegirla inserta la acción ya
        apuntada; el formulario se DERIVA de la definición (etiquetas,
        obligatorios, ayuda, listas de opciones con escape a variable) y trae
        **"Probar ahora"**, que resuelve contra un registro real con la
        credencial de la conexión (misma ruta que el probador de webhooks).
        (f) **El asistente y el MCP las ven**: `get_list_schema` devuelve
        `connectors` con qué se puede ejecutar y qué datos pide cada acción —
        nunca credenciales—, y el prompt documenta
        `connector_action {connection_id, action_key, values}`.
        14 tests nuevos (11 unitarios del compilador —ubicaciones, defaults,
        obligatorios por etiqueta, `{clave}` en ruta y cuerpo crudo, y el
        compilado real contra `buildWebhookRequest` con la credencial en el
        cuerpo— y 3 de integración con Postgres: round-trip del catálogo,
        renombrar sin perder la clave, un PATCH de otra cosa que no borra las
        acciones, y la petición completa por el probador) — 609 API, 150 front
        y 66 shared en verde — + E2E navegador 22/22 (definir la acción en
        Ajustes, que aparezca por su nombre en el menú, formulario derivado,
        prueba con la URL de la conexión y el secreto tapado, guardar y
        reabrir, renombrar la etiqueta sin desconectar, y borrarla → la
        tarjeta avisa). **OJO en dev**: tras tocar `packages/shared` hay que
        borrar `apps/web/node_modules/.vite` y reiniciar vite — el `--force`
        solo no alcanzó y las constantes nuevas llegaban `undefined` al
        navegador (misma trampa de v0.1.167 y v0.1.176, un escalón peor).

  - [x] **Fase 3 — OAuth2 como CLIENTE (v0.1.199, ADR-S22 fase 3)**: cierra F11.
        Las fases 1 y 2 asumen un secreto ESTÁTICO que alguien pega; para Google,
        Microsoft, Slack, GitHub, HubSpot o Zoho eso no existe — la empresa
        **autoriza** la app una vez y el proveedor entrega un token que caduca y
        se renueva solo. La app ya era **servidor** OAuth desde v0.1.184 (para que
        Claude se conecte al MCP); esto es el lado inverso. `auth_type: 'oauth2'`
        (no un proveedor nuevo): la conexión guarda la app registrada
        (`config.oauth`: client_id, URLs, scopes, extra params) y el
        `client_secret` cifrado; los tokens van en `secrets`, también cifrados, y
        **no vuelven al cliente ni enmascarados** — no son de la persona, son del
        proveedor. Las piezas del protocolo son PURAS (`oauth-client.ts`:
        `createPkce`, `buildAuthorizeUrl`, `buildTokenExchangeBody`,
        `buildRefreshBody`, `parseTokenResponse`, `needsRefresh`), por el mismo
        motivo que `connectionParts` y `compileConnectorCall`: se prueban contra
        el protocolo y no pueden divergir de lo que ejecuta el service.
        Decisiones que no son opcionales: (a) **PKCE siempre** (RFC 7636) aunque
        haya client secret; el `verifier` y el tenant viven en Redis contra el
        `state`, que se consume con `GETDEL` —de un solo uso, como el magic link
        del portal (SEC-15)— y sólo lo canjea la MISMA persona que lo pidió;
        (b) **el refresh se escribe en su PROPIA transacción**, nunca en la del que
        lo pidió: si la automatización falla después y revierte, un proveedor que
        ROTA el refresh token dejaría la conexión muerta para siempre (habríamos
        guardado uno que el proveedor ya invalidó); (c) **lock corto en Redis**,
        porque dos acciones en paralelo canjeando el mismo refresh rotativo hacen
        que el segundo reciba `invalid_grant` — quien no lo consigue espera al
        token nuevo en vez de pedir otro; (d) **sin `expires_in` declarado no se
        renueva a ciegas** (hay proveedores cuyos tokens no caducan y un refresh
        de más consume cupo); (e) **UNA `redirect_uri` por instalación**
        (`{APP_BASE_URL}/api/v1/connections/oauth/callback`) porque hay que
        registrarla en la consola del proveedor y un dominio propio por empresa
        (ADR-S17) obligaría a registrar una por cliente — el panel la muestra
        lista para copiar; el callback va en un controller APARTE porque el
        navegador vuelve con la cookie de sesión pero SIN `X-Tenant-Id`, así que
        la empresa sale del `state` que emitimos nosotros. El canje sale por
        `safeWebhookFetch` (SEC-03) y el error del proveedor se propaga TAL CUAL
        (`invalid_grant` es el diagnóstico). Un token vencido sin refresh **hace
        fallar** la acción con el motivo y el nombre de la conexión, en vez de
        mandar la petición sin credencial (lección de v0.1.150). Front: sección
        OAuth en el formulario (presets de 6 proveedores que traen puestos los
        parámetros raros de cada uno —el `access_type=offline` de Google es el
        motivo nº 1 de "me autoricé y a la hora dejó de andar"—, URI de
        redirección copiable) y botones Autorizar / Reautorizar / Desconectar con
        badge de estado en la fila. **Bug real encontrado en el E2E**: el
        `spaFallback` del dev server de vite corre ANTES del proxy y reescribía
        **cualquier navegación** del navegador sin extensión a `/cloud/index.html`
        — o sea que ir a un endpoint del API desde la barra de direcciones (el
        callback de OAuth, la página de una lista pública) devolvía el SPA en vez
        de la respuesta del backend; ahora `/api/`, `/.well-known/` y
        `/socket.io/` quedan fuera del fallback (en producción no pasaba: nginx y
        Caddy enrutan `/api/` primero). Queda fuera la revocación en el proveedor
        al desconectar: se borran los tokens locales y la app sigue autorizada del
        otro lado hasta que la persona la quite ahí — cada proveedor tiene su
        propio endpoint y varios no lo tienen. 13 tests unitarios del protocolo
        (vectores de PKCE, presets, canje sin `client_secret` vacío, JSON y
        urlencoded, `invalid_grant` propagado, margen de renovación) + 6 de
        integración con Postgres real (PKCE y state al arrancar, config
        incompleta, state ajeno/desconocido/reusado, Bearer inyectado con el
        access token cifrado en reposo, vencido sin refresh, lock ocupado,
        desconectar con bitácora) — 629 API, 150 front en verde — + E2E navegador
        24/24 (preset, URI copiada al portapapeles, guardar, badge, navegación al
        proveedor con PKCE y el `redirect_uri` exacto, vuelta del callback con el
        motivo y los parámetros limpiados, un solo uso del state, el secreto que
        no aparece en ninguna pantalla).

        **Con esto F11 queda completa: conexiones reutilizables, acciones con
        nombre y OAuth2 como cliente.**

  - [x] **Los campos derivados dejan de ser de segunda (v0.1.200)**: cierra los
        dos pendientes que quedaban anotados desde v0.1.170. Los tres eran la
        misma causa: un `lookup` no tenía expresión SQL y el CSV sólo exportaba
        lo que vive en `data`.
        (a) **Un lookup ya FILTRA, ORDENA y AGRUPA** ("los pedidos por la ciudad
        del cliente", "las facturas cuyo cliente contiene «medell»"). Su
        expresión es un `string_agg` de los valores vinculados, NORMALIZADO
        —distintos y ordenados— por el mismo motivo que el set de un
        multi_select en v0.1.190: si no, «Bogotá, Medellín» y «Medellín,
        Bogotá» serían dos grupos para el mismo conjunto (con un solo
        vinculado, el caso normal, es idéntico a lo que muestra la celda). Se
        compara como TEXTO aunque el destino sea numérico —`string_agg` lo es—
        y por eso `compileOverride` ganó los operadores de subcadena, que son
        los que se usan de verdad. **Queda fuera, y se dice**: el lookup hacia
        un `computed` se evalúa en JS sobre la fila del otro lado y no hay SQL
        que lo exprese — no aparece en el selector de filtros ni en el de
        agrupar, en vez de ofrecer algo que el backend descartaría en silencio.
        De paso el whitelist del query-builder dejó de preguntar por `rollup`
        para preguntar por "¿tiene expresión inyectada?", que es la condición
        real (lo detectó el test: el filtro por lookup devolvía TODO porque la
        condición se caía entera).
        (b) **Agrupar por un derivado**: el motor de agregados usa esa misma
        subconsulta correlacionada como expresión de grupo; sin ella (config a
        medias, relación borrada) **rechaza con el motivo** en vez de devolver
        un único bucket vacío. El encabezado del grupo formatea con el campo
        del OTRO lado —la etiqueta de la opción, la moneda con sus decimales,
        la fecha en el formato de la empresa—, igual que la celda.
        (c) **El CSV exporta lo que se VE en la tabla**: antes `isDataField`
        dejaba afuera los computed, los lookup, los rollup y las relaciones —
        una lista de Facturas se exportaba **sin el cliente y sin el total**.
        Ahora salen las cuatro, y la relación sale con el **TÍTULO** del
        vinculado (una query por lista destino y por página, con cache entre
        páginas: en facturación el mismo cliente se repite muchísimo), no con
        su id. El import no los toma de vuelta y está bien: un valor derivado
        no se escribe.
        De paso se pusieron al día tres textos vencidos de STANDALONE.md (los
        precios de checkout por plan custom y la migración por empresa ya
        estaban hechos; ADR-S19 decía que un lookup no filtra ni ordena).
        6 tests nuevos (3 de integración del motor —filtrar/agrupar/ordenar por
        lookup, agrupar por rollup con el bucket trayendo SUS filas, el lookup
        hacia computed rechazado— 1 del CSV con las cuatro columnas derivadas y
        4 unitarios del front de los operadores) — 633 API y 154 front en
        verde — + E2E navegador 13/13 (el panel ofrece el lookup, dos buckets
        por ciudad con sus filas, buckets por total del rollup, la tabla
        agrupada muestra «Bogotá» y no `bogota`, filtro por subcadena, y el CSV
        con Cliente=«Acme» y Total=350).

  - [x] **Últimas brechas del MCP: permisos, publicación, miembros y
        comentarios (v0.1.201)**: cierra la lista de "quedan fuera" que dejó
        anotada la auditoría de v0.1.195. Cuatro herramientas nuevas en el
        MISMO registro, así que salen a la vez por el asistente ✨ y por el MCP:
        (a) **`list_members`** (lectura) — las personas del workspace con su
        id, nombre, email y rol. Sin esto dos cosas eran IMPOSIBLES desde el
        MCP aunque las herramientas existieran: asignarle un registro a alguien
        (un campo `user` guarda el ID, no el nombre) y compartir una lista con
        una persona puntual.
        (b) **`list_record_comments`** (lectura) — lo que se habló en un
        registro, para resumir el historial con un cliente. Viaja con la misma
        nota que el listado de registros: son DATOS escritos por personas, no
        instrucciones. El DTO del comentario trae el id del autor, así que el
        nombre se resuelve con UNA query de miembros, no una por comentario.
        (c) **`propose_set_list_permissions`** — quién ve y edita una lista,
        por ROL (manager/agent/viewer con alcance all/assigned/own/none, si
        puede crear y qué campos no ve) y por PERSONA (pisa su rol sólo en esa
        lista). Valida de verdad: un campo que no existe en `fields_hidden`, el
        alcance `assigned` sin un campo de tipo user, o un id que no es miembro
        de la empresa vuelven al modelo como error corregible. Dejar a un rol
        sin acceso marca la propuesta como **destructiva**: saca gente de golpe.
        (d) **`propose_configure_public_sharing`** — publicar una lista de
        solo-lectura hacia afuera (la página embebible de ADR-S14) o dejar de
        publicarla, con los campos visibles, la vista cuyos filtros acotan las
        filas, los dominios que pueden embeberla y la caducidad. **Publicar es
        siempre destructivo** en el sentido de la tarjeta —expone esos datos a
        cualquiera con el enlace— y publicar sin campos visibles se rechaza: una
        página vacía no es lo que nadie pidió. Al aplicar reusa
        `PublicListsService.updateAdmin`, o sea el mismo camino de la interfaz
        (token, mapeo sin RLS, todo).
        Lo que **sigue afuera ahora está razonado** en `docs/mcp.md` en vez de
        enumerado: estilos por bloque (se ajustan en el editor, donde se ven),
        archivos (subir bytes por una herramienta de texto no tiene sentido),
        import/export (el MCP ya crea registros; exportar es bajar un archivo)
        y cambiar los ajustes del workspace (tocan facturación, correo y
        accesos de toda la empresa). El prompt del asistente ganó las reglas 13
        y 14. **El scope `read` del MCP no hubo que tocarlo**: es "todo lo que
        no propone", así que las dos lecturas nuevas entraron solas — los tests
        de scope lo confirmaron al fallar con la lista vieja.
        3 tests de integración nuevos (11 en el spec de config: validaciones
        reales de ACL, publicar sin campos / con campo o vista inexistente, el
        round-trip completo hasta `settings`) — 637 API y 154 front en verde —
        + E2E por el MCP REAL (HTTP + token personal: las 4 herramientas en
        `tools/list`, `list_members` con su nota, proponer→aplicar la
        publicación y el `meta` público respondiendo 200 SIN sesión).

  - [x] **Release de seguridad: 17 avisos en dependencias de PRODUCCIÓN y el
        proxy en el que se cree (v0.1.202)**: revisando los pendientes de
        dependencias que v0.1.113 dejó anotados (`vite`/`vitest`/`esbuild`, de
        desarrollo) apareció algo que nadie estaba mirando: `pnpm audit --prod`
        daba **17 avisos que SÍ llegan a producción**, 10 de ellos high. Se
        cerraron TODOS (queda en 0) bumpeando lo directo y overrideando lo
        transitivo: `fastify` 5.8.5→5.12.5 (dos avisos, ver abajo), `fast-uri`
        →4.2.1 (SSRF y confusión de host, vía Fastify), `nodemailer`
        9.0.3→9.1.1 (**bypass de validación del dominio destinatario**: un
        `send_email` de automatización podía entregar a un dominio del
        atacante), `socket.io-parser` →4.2.7 (agotamiento de memoria del
        realtime), `nanoid` →6.0.1, `dompurify` →3.4.15, `@tiptap/core`
        3.29→3.31 (ReDoS cuadrático en los atributos markdown del editor de
        descripción) y `react-router` 7.18.1→7.18.2.
        **Y lo que el aviso de fastify destapó, que era lo importante**: el API
        arrancaba con `trustProxy: true`, o sea "creerle `X-Forwarded-*` a
        quien sea". Verificado contra el API real: un
        `X-Forwarded-Host: atacante.test` de un cliente DIRECTO se volvía el
        **issuer OAuth del MCP**; de la misma cabecera salen el IP del rate
        limit y el que se le muestra a la persona en "Dispositivos conectados".
        Ahora `TRUST_PROXY` es en QUÉ proxy se cree, con default `loopback`
        —el Caddy/nginx de la misma máquina, que es el despliegue de este
        repo—, y admite direcciones o rangos si hay otra capa por delante.
        **Ojo con la trampa**: lo natural es poner un hop-count (`1`, "tengo un
        proxy"), pero desde fastify 5.12 —el mismo release que cierra el
        aviso— un número **falla cerrado** y no le cree a NADIE: el proxy
        legítimo deja de funcionar en silencio y el issuer por dominio propio
        (ADR-S17) se rompe. Lo detectó la verificación en vivo, no el
        typecheck; ahora un número avisa por consola y cae al default.
        **Segundo agujero, en el despliegue**: `nginx.conf` nunca fijaba
        `X-Forwarded-Host`, así que la del cliente pasaba INTACTA — y confiar
        en el proxy equivale a confiar en cualquiera si el proxy no
        sobrescribe. Se agregó `proxy_set_header X-Forwarded-Host $host` en los
        tres `location` que van al API, y el mismo `header_up` explícito en el
        Caddyfile (Caddy ya lo hacía, pero conviene que se lea).
        4 tests del parseo de `TRUST_PROXY` (incluido el número que avisa) —
        640 API y 154 front en verde — + E2E navegador 9/9 contra los saltos de
        versión más riesgosos (el editor de descripción monta con TipTap 3.31,
        escribe, los atajos markdown y el menú «/» andan, el autoguardado
        persiste, cero errores de JS) y verificación en vivo del issuer con el
        proxy real y con un cliente falseando la cabecera.
        **Límite de la verificación**: en el sandbox TODO es loopback, así que
        el caso "cliente de internet falseando" no se puede reproducir acá —
        lo que sí se verificó es el mecanismo (con `true` la cabecera del
        cliente mandaba; con `loopback` manda la del proxy) y que el camino
        legítimo sigue funcionando.

  - [x] **Integraciones estilo ClickUp: la galería de apps (v0.1.203, ADR-S22
        fase 4, pregunta del usuario: "¿estás seguro de que ésa es la mejor
        manera? es difícil y confusa para un usuario normal; ClickUp no pide
        algo así")**. Tenía razón: la sección Conectores pedía URL base, tipo de
        autenticación (Bearer/cabecera/Basic), nombre de la cabecera, secreto de
        firma, y en OAuth Client ID, Client Secret, scopes, URL de tokens y una
        URI para registrar en el proveedor — una herramienta de desarrollador.
        ClickUp ofrece «Conectar» con un botón porque la parte técnica la
        resolvió UNA vez el dueño de la plataforma. Ahora es igual:
        (a) **Ajustes → Integraciones** (el id `conectores` se conserva: es la
        ruta del callback) es una **galería de apps con logo** —WhatsApp (Imagina
        WAS) y Telegram por clave; Slack, Gmail, Google Calendar, Google Sheets y
        Outlook por OAuth— con «Conectar», la lista de **Conectadas** («Slack ·
        Acme», «Gmail · ana@acme.co»), Reconectar/Actualizar clave y
        Desconectar (avisa cuántas automatizaciones la usan). Sin jerga a la
        vista: lo técnico quedó plegado bajo **«Avanzado: API personalizada»**
        (el panel de siempre, sólo con las conexiones propias).
        (b) **Plataforma → Integraciones** (superadmin): el operador registra
        UNA vez la app de Google, Microsoft y Slack —pasos numerados, botón a la
        consola del proveedor, URI de redirección copiable, permisos a habilitar
        y el aviso de verificación de Google— en Redis `platform:integrations`
        con el secreto cifrado (`SECRETS_KEY`, jamás vuelve; viaja en el
        snapshot de ADR-S20). La decisión de F11 se mantiene: el client id
        identifica a la APP, no es una cuenta; cada empresa conecta SU cuenta y
        sus tokens quedan cifrados y separados. Sin el proveedor configurado la
        tarjeta no se le muestra a la empresa (el operador sí la ve, con
        «Configurar en Plataforma»).
        (c) **Acciones ya armadas** por app, en el catálogo (`INTEGRATIONS` en
        shared, mismo shape que las acciones con nombre de v0.1.198, así el
        editor las pinta con el mismo formulario): enviar WhatsApp (texto y
        archivo), mensaje de Telegram, mensaje a un canal de Slack, correo con
        Gmail y con Outlook, evento en Google Calendar y en Outlook (todo el día,
        hora local en la zona elegida, o el instante UTC de un campo datetime),
        y **fila en Google Sheets** (un valor por renglón, pegando el ENLACE de
        la planilla). La petición la arma CÓDIGO, una función pura por acción
        (`integration-calls.ts`): Gmail es un RFC 2822 en base64 (con el asunto
        codificado y los saltos de línea de cabeceras neutralizados), Sheets
        protege las celdas que empiezan con `=`/`@`/`+` para que un registro no
        inyecte fórmulas (y un teléfono no pierda el `+`), destinatarios capados
        a 25 como SEC-08. Las acciones viven en el catálogo, no en la fila: una
        mejora llega a todas las empresas con el release.
        (d) **La respuesta se revisa**: Slack, Telegram y WAS contestan 200 con
        el error adentro (`ok:false`), así que un 200 ya no es «éxito» — el run
        queda FALLIDO con el motivo legible («la app no está en ese canal:
        invitala con /invite»), en el motor y en «Probar ahora».
        (e) **La conexión OAuth nace AL VOLVER** del proveedor (cancelar no deja
        filas a medias) y se lee con qué cuenta se conectó; una **clave se
        prueba antes de guardarse** (Telegram `getMe`; en WAS «Buscar mis
        cuentas» lista los números para elegir) — si el servicio no contesta,
        se guarda igual y se avisa que no se pudo comprobar. Microsoft recibe los
        scopes también en el canje y la renovación (los exige).
        (f) En el **editor de automatizaciones** el menú de acciones tiene la
        sección «Apps conectadas» con el logo de cada app y el atajo **«Conectar
        otra app»** (abre Ajustes en otra pestaña para no perder lo armado; el
        catálogo se refresca al volver). El selector de conexión de «Llamar
        webhook» sólo ofrece APIs personalizadas. El MCP recibe `app` en cada
        conexión. **Bug de paso**: el uso de una conexión sólo contaba los
        webhooks, así que borrar una conexión usada por una acción con nombre
        («Enviar WhatsApp») no avisaba — ahora cuenta las dos.
        Logos embebidos sin dependencias (Simple Icons CC0 y Phosphor MIT; Slack y
        Outlook salieron de Simple Icons a pedido de las marcas). 17 tests
        unitarios de las peticiones + 7 de integración con Postgres real y la red
        simulada en el borde (`safeWebhookFetch`): app del operador cifrada, viaje
        OAuth con PKCE, la conexión nace al volver con la cuenta, reconectar no
        duplica, renovación de Outlook con la app de la plataforma y los scopes,
        clave de Telegram rechazada que NO se guarda, cuentas de WAS, y el 200 con
        error de Slack como run fallido en el motor y el probador — 664 API, 154
        front y 66 shared en verde — + E2E navegador 23/23 (galería con 7 logos y sin jerga,
        «Configurar en Plataforma», registrar Slack con el secreto que no vuelve,
        «Conectar» que lleva a slack.com con la app, los permisos y PKCE,
        Telegram por clave con sus pasos, «Apps conectadas» en el editor, la
        acción en criollo, «Avanzado» y el celular sin desborde).
        **Supuesto a confirmar**: la integración de WAS habla la API estilo
        Zender (`/api/send/whatsapp` con `secret`/`account`/`recipient`/`type`/
        `message` —los mismos campos que el usuario ya usaba— y
        `/api/get/wa.accounts` para listar cuentas); si el listado no existe, el
        diálogo deja escribir la cuenta a mano. **Límite de la verificación**:
        los proveedores reales no alcanzan el sandbox; el viaje OAuth completo
        se probó con sus respuestas simuladas, y la conexión real con cada uno
        queda para cuando el operador registre las apps.

  - [x] **Fix de la integración de WhatsApp (WAS/Zender) — una clave de envío ya
        no se rechaza (v0.1.204, reporte del usuario con captura: "WAS no reconoce
        esa clave de API", con la MISMA clave que su automatización usa y
        funciona)**: el conector de v0.1.203 validaba la clave pidiendo el
        listado de cuentas (`/api/get/wa.accounts`) y tomaba un 401/403 como
        "clave inválida" — pero las claves de Zender tienen **permisos por
        función**, y una clave creada para ENVIAR recibe 403 al listar aunque
        mande perfecto. O sea: se bloqueaba justo la clave que ya funciona en
        producción. Se confirmó leyendo por el MCP la automatización real del
        usuario (webhook a mano con `account`/`recipient`/`message` y el
        `secret` inyectado por su conexión). Arreglos: (a) el **listado es una
        ayuda, nunca una puerta** — si WAS no lo permite, se guarda igual y se
        muestra lo que WAS respondió, textual, con la indicación de escribir la
        cuenta a mano; (b) **"Enviar prueba"**: la verificación que vale es un
        mensaje REAL (`test_to` en `verifyIntegrationSchema`) armado con la
        MISMA función que usa el motor (`testSendRequest` →
        `buildIntegrationRequest`) y leído con `checkIntegrationResponse` —
        el 200 con error adentro de WAS se reporta con su motivo; también para
        Telegram (ID del chat); (c) el envío de texto manda **exactamente** los
        campos de la petición que funciona (se quitó `type=text`, que WAS asume);
        (d) los pasos del diálogo explican la cuenta a mano y el mensaje de
        prueba, y "Clave válida" sólo aparece cuando de verdad se comprobó algo.
        3 tests unitarios + 1 de integración que reproduce el caso exacto
        (listado 403 → guarda; prueba sale con los campos correctos; un 200 con
        error de WAS se dice; sin cuenta no se manda nada) — 667 API, 154 front
        y 66 shared en verde — + E2E navegador 9/9. **Límite de la
        verificación**: el sandbox no llega a `was.imagina.cloud` (el proxy de
        salida devuelve 403), así que el envío real se prueba en el servidor.

  - [x] **WooCommerce — fase 1: conectar la tienda + acciones de escritura
        (v0.1.205, pedido del usuario: "un conector para WooCommerce que traiga
        casi todo")**. Primera de tres entregas (la 2 sincroniza, la 3 agrega
        tiempo real y edición en los dos sentidos). WooCommerce entra a la
        galería (categoría "Tiendas online") como app **por clave**: la persona
        pega la dirección de la tienda, la clave del cliente (`ck_…`) y la
        secreta (`cs_…`, cifrada), con los pasos para generarla en WooCommerce →
        Ajustes → Avanzado → API REST. Lo técnico se DESCUBRE al conectar y
        queda en campos ocultos (`hidden`, nuevo en `IntegrationFieldDef`: los
        completa el servidor, el diálogo ni los muestra ni los manda):
        `wooVerifyPlan` prueba cabecera `Authorization: Basic` y, si el hosting
        la tira (PHP por CGI/FastCGI: WooCommerce ve un pedido anónimo), la
        clave en la URL; y `/wp-json/…` o `?rest_route=` para tiendas sin enlaces
        permanentes. A diferencia de las apps de mensajería, una tienda que no
        responde NO se guarda (casi siempre es la dirección mal escrita) y sin
        HTTPS se rechaza con el motivo (WooCommerce no acepta la clave sin
        conexión segura). La conexión se nombra con el nombre del sitio.
        **Acciones** (módulo puro `woocommerce/wc-api.ts`, el mismo que usará
        la sincronización): actualizar producto —precio normal/rebajado ("quitar"
        la saca), stock (activa la gestión de inventario), estado de inventario,
        publicación y **campos de otros plugins** (`meta_data`, "clave=valor"
        por renglón: ACF, Yoast…)— también de UNA **variación**
        (`/products/{padre}/variations/{id}`); cambiar el estado de un pedido;
        nota al pedido (interna o al cliente); y crear cupón (tipo, valor,
        vencimiento, usos, correos permitidos, compra mínima). Sólo viajan los
        datos completados; los errores de WooCommerce se traducen (sin permiso
        de escritura, clave rechazada, 404 con el mensaje de la tienda, un 200
        con HTML de un modo mantenimiento). **Bug atrapado en el E2E**: un precio
        tipeado "26.000" (punto de miles, como se escribe en Latinoamérica)
        viajaba como 26; `wooPrice` ahora lee los grupos de a tres como miles y
        el último separador como decimal cuando hay dos. `IntegrationRequest`
        gana `PUT`/`DELETE`, `IntegrationInputError` se mudó a su propio módulo
        (`integration-errors.ts`) para no crear un import circular, y
        `safeWebhookFetch` gana `maxCaptureBytes` + cabeceras de la respuesta
        (lo necesita la sincronización para leer páginas de 100 pedidos).
        **Interruptor de desarrollo** `DEV_ALLOW_PRIVATE_EGRESS=1`: deja salir
        a direcciones privadas y `http://` para probar contra una tienda falsa
        local; en producción se IGNORA (y se avisa al arrancar). 12 tests
        unitarios nuevos (URLs y autenticación en sus cuatro combinaciones,
        cuerpos de cada acción, variación, meta, precios latinos, traducción de
        errores) + 1 de integración (descubre la clave en la URL, clave mala y
        sin HTTPS no se guardan, la acción sale por la combinación descubierta y
        el probador tapa la clave de la URL) — 680 API, 154 front y 66 shared en
        verde — + E2E navegador 17/17 contra una **tienda WooCommerce falsa**
        (API wc/v3 con la forma real: 250 pedidos, producto variable con 3
        variaciones, meta de plugins, paginación con `X-WP-TotalPages`) en sus
        dos modos: normal y hosting que tira la cabecera.

  - [x] **WooCommerce — fase 2: la tienda sincronizada (v0.1.206, ADR-S24,
        pedido del usuario: "traer pedidos, usuarios, compras por usuario y por
        producto… ¿cómo harías con productos variables y los meta fields de
        otros plugins?")**: la fase 1 (v0.1.205) sólo ESCRIBÍA en la tienda;
        ahora la tienda se TRAE y se mantiene al día. Desde Integraciones →
        «Sincronizar tienda» (página `/settings/stores/:id`) se elige qué traer
        (clientes / productos / pedidos, pedidos desde una fecha para ahorrar
        registros del plan) y la frecuencia (5 min a 1 día), y se crea una
        CARPETA con un **pack de cinco listas vinculadas** —Clientes, Productos,
        Variaciones, Pedidos y Líneas de pedido— más el tablero «Ventas ·
        tienda» (KPIs, ventas en el tiempo, estados, top clientes y productos).
        Todo es un registro común: se filtra, se agrupa, se suma y dispara
        automatizaciones. Cuánto compró cada cliente, su ticket promedio, las
        unidades e ingresos de cada producto y de CADA variación son rollups
        sobre las líneas (no números copiados), así cuadran solos. La moneda,
        los decimales y el país salen de los ajustes de la tienda.
        (a) **Vínculo por id de la tienda FUERA de los datos**: `sync_links`
        (migración 0053, RLS; `connection_syncs` guarda ajustes y estado) —
        renombrar o borrar columnas no rompe nada (regla de oro nº 1).
        (b) **Productos variables**: cada variación (talla, color) es un
        registro propio vinculado al producto («Camiseta — Rojo / M»); la línea
        de pedido apunta al producto Y a la variación.
        (c) **Clientes invitados**: WooCommerce sólo lista registrados; el
        invitado se identifica por `email:x` y el registrado por `id:N`, y las
        DOS claves de una persona apuntan al mismo registro en los dos sentidos
        (la cuenta que aparece adopta el registro de invitada; la compra sin
        sesión de alguien con cuenta va a su registro). **Bug atrapado por el
        test**: la primera versión RENOMBRABA el vínculo `email:x`→`id:N`, y la
        siguiente vuelta completa volvía a crear a la invitada desde sus
        pedidos viejos (que siguen diciendo `email:x`) — ahora se conservan las
        dos claves y el contador cuenta registros distintos, no vínculos.
        (d) **Campos de otros plugins** (`meta_data`): se descubren por recurso
        con cuántos registros los tienen, un ejemplo y un tipo sugerido (los
        que empiezan con `_` se marcan internos y van plegados); «Traer como
        columna» crea el campo y relee ese recurso para rellenar lo existente;
        los valores estructurados (ACF) van como JSON en un texto largo.
        (e) **Incremental por keyset**: productos y pedidos con
        `orderby=modified` + `modified_after` desde un cursor (fecha + ids de
        ese segundo: la API compara por segundo y el filtro es exclusivo)
        guardado por página; una tienda que ignora el filtro se detecta y se
        pagina por número; clientes nuevos por id descendente + barrido
        completo diario (igual que el stock de variaciones). Las líneas que un
        pedido ya no tiene se borran.
        (f) **Una corrida a la vez** (candado en Redis renovado por página +
        `pg_advisory_xact_lock` por escritura), cola BullMQ propia con tick por
        minuto, reintentos con espera ante 5xx/429 de la tienda.
        (g) **Ni la importación inicial ni «Recorrer todo de nuevo» disparan
        automatizaciones** (nadie quiere 3.000 WhatsApps al conectar); los
        cambios posteriores sí, con el antes y el después.
        (h) **El plan manda**: si la tienda excede los registros del plan, la
        corrida se detiene con el motivo en pantalla. Dejar de sincronizar o
        desconectar conserva todo (ADR-S09). Migrar una empresa lleva la
        sincronización re-mapeada y borrar una empresa limpia sus tablas.
        Front: estado en vivo («En cola…» / «Trayendo pedidos…» con barra de
        avance / «Al día»), tarjetas por recurso que abren su lista, pausar/
        reanudar, frecuencia, avisos por dato que no se pudo guardar y la
        sección «Campos de otros plugins» por pestaña. **Bug atrapado en el
        E2E**: tras «Sincronizar ahora» la respuesta aún dice «no corre» (el
        worker no la tomó) y la pantalla volvía a preguntar cada 30 s — ahora
        recuerda el pedido y consulta cada 2 s hasta que la corrida arranca.
        21 tests nuevos (10 unitarios del mapeo/pack/lectores/re-mapeo + 11 de
        integración con Postgres y Redis reales y la tienda simulada en el
        borde de red: alta, importación paginada de 230 pedidos, re-correr sin
        duplicar, incremental con evento antes/después, tienda sin
        `modified_after`, adopción de invitada en los dos sentidos, meta a
        columna, pausa y tick, RLS, límite del plan, baja conservando datos) —
        701 API, 154 front y 66 shared en verde — + E2E navegador 25/25 contra una tienda falsa (250 pedidos, 292 líneas,
        meta mapeada rellenada, incremental, móvil sin desborde).
        Sigue la fase 3: avisos en tiempo real (webhooks de la tienda) y
        edición en los dos sentidos.

  - [x] **WooCommerce — fase 3: tiempo real + editar en los dos sentidos
        (v0.1.207, ADR-S24 fase 3)**: cierra el pedido del usuario ("hacé todas
        las fases, con los dos modos de sincronización").
        (a) **Modo «En tiempo real» (recomendado, ahora el default del alta)**:
        se registra en la tienda un aviso por tema (pedidos/productos:
        creado/actualizado/borrado/restaurado; clientes: creado/actualizado)
        hacia `POST /public/store-hooks/:token`. Tabla `store_hooks` (migración
        0054, SIN RLS como `automation_hooks`): token → sincronización + secreto
        de firma CIFRADO. Cada entrega se verifica con `base64(HMAC-SHA256)`
        sobre el cuerpo CRUDO en tiempo constante (firma mala → 401, token
        desconocido → 404 opaco); el «ping» sin tema se contesta 200 (sin eso
        WooCommerce no crea el aviso). La respuesta no espera a escribir: el
        aviso va a la cola (`hook`), porque WooCommerce corta a los 5 s y APAGA
        el aviso tras varias fallas; la ruta tiene 10× el rate limit general
        (ráfagas de una sola IP). Una variación llega como `product.updated` y
        se reconoce por su forma; un producto variable relee sus variaciones;
        un borrado deja el registro en estado «trash» (nunca se borra nada) y
        un borrado de algo que nunca se trajo no crea nada.
        (b) **Red de seguridad**: en tiempo real igual se sincroniza cada hora
        y esa vuelta reactiva los avisos que la tienda desactivó y recrea los
        que faltan. Si la tienda no los acepta (clave de sólo lectura, tienda
        que no llega a `APP_BASE_URL`) el modo NO cambia y se dice por qué; en
        el alta cae a intervalos con el motivo a la vista. Volver a intervalos
        borra los avisos de la tienda y el token deja de valer.
        (c) **«Editar desde la app» (opt-in)**: `RecordChangeHub` (módulo
        global, `@Optional` en RecordsService y en el motor de
        automatizaciones) avisa cuando una persona o una automatización cambia
        un registro; si vive en una lista de la tienda con la edición activada,
        se encola un envío (`push`). **Sólo viaja lo que cambió** —mandar el
        registro entero pisaría un stock que la tienda bajó con una venta que
        todavía no llegó— y los valores se leen al enviar. Columnas que viajan
        (`STORE_WRITE_BACK_FIELDS` en shared): productos (nombre, SKU, precios,
        stock, estado de stock, estado), variaciones (lo mismo sin nombre),
        pedidos (estado, nota del cliente), clientes registrados (email y datos
        de facturación) + los campos de plugins traídos a columnas (sí/no con
        la convención que ya usaba la tienda: `yes/no` o `1/0`; JSON como
        objeto). Totales, líneas e invitados son de sólo lectura. **Sin bucles
        por construcción**: el motor de sincronización nunca emite en el hub, y
        el aviso que la tienda manda de vuelta no encuentra diferencias. Un
        envío rechazado queda contado con el motivo en la pantalla.
        Front: elección de modo en el alta y en la tienda (tarjetas con el
        estado «Escuchando a la tienda · N avisos», avisos recibidos y último),
        sección «Editar desde la app» con interruptor optimista, las columnas
        que viajan y el contador de envíos/fallas. **Bug atrapado en el E2E**:
        el interruptor era controlado por la respuesta del servidor y no se
        movía al tocarlo — ahora es optimista. 15 tests nuevos (6 unitarios de
        temas/firma/ping/variación/armado del envío/meta + 9 de integración con
        Postgres y Redis reales: clave de sólo lectura no cambia el modo,
        registro de 10 avisos con secreto cifrado, ping/404/401 sin escribir
        nada, pedido por aviso con evento antes/después, variación y borrado a
        la papelera, red de seguridad, envío SÓLO del campo cambiado sin
        rebote, variación/cliente/invitado y falla visible, volver a
        intervalos) + E2E navegador 23/23 contra la tienda falsa (10 pings en
        200, pedido nuevo llega sin «Sincronizar ahora», firma falsa 401,
        precio editado en la app llega a la tienda con un solo envío, volver a
        intervalos borra los avisos, móvil sin desborde).

  - [x] **Inventario de la tienda (v0.1.208, ADR-S24, pedido del usuario:
        "es muy importante el tema de inventarios")**: la sincronización ya
        traía el stock, pero no servía para GESTIONAR inventario — y tenía un
        hueco real. (a) **El hueco**: una venta baja el stock de una
        VARIACIÓN sin tocar la fecha de modificación del producto, así que el
        incremental por `modified_after` no la veía hasta el barrido. Ahora
        cada pedido nuevo o modificado **refresca el stock de lo que vendió**
        (`refreshStock`: un GET por lote con `include=` —≤100 ids— a
        `/products` y a `/products/{padre}/variations`), también cuando el
        pedido llega por aviso en tiempo real; y una vez por día se barren
        TODOS los productos (plugins que cambian stock sin pasar por un
        pedido). (b) **Estado de inventario derivado** al mapear: agotado /
        bajo / en stock / por encargo (stock ≤ 0 con reservas permitidas) /
        **por variación** (producto variable sin stock propio — antes decía
        "sin control", que era falso) / sin control. El umbral de "bajo" es el
        del producto o, si no tiene, el general de la tienda
        (`/settings/products`, leído al conectar; default 2). Columnas nuevas
        en productos y variaciones: Controla stock, Alerta de stock bajo,
        Estado de inventario, **Valor en stock** (cantidad × precio), y por
        rollup/computed **Vendidas (30 días)** (líneas de pedidos pagados del
        último mes) y **Meses de cobertura** (stock ÷ vendidas); el producto
        variable además suma el stock y el valor de sus variaciones.
        (c) **Vista «Para reponer»** (bajo + agotado, ordenada por stock),
        kanban «Por inventario» y **tablero «Inventario · Tienda»** (11
        widgets: agotados, bajos, por encargo, sin control, unidades, valor,
        vendidas; reparto por estado; y dos tablas de lo que hay que reponer),
        con botón «Inventario» en la pantalla de la tienda. (d) **Editar
        desde la app** gana Controla stock y Alerta de stock bajo (vacío =
        vuelve al umbral de la tienda). Receta nueva de automatización
        **«Stock bajo»**: aviso por correo cuando el estado pasa a bajo o
        agotado. (e) **Versión del pack**: las tiendas ya conectadas se
        actualizan SOLAS en la próxima corrida (`BlueprintService.extend`,
        bajo el lock de la sincronización) agregando sólo lo que falta, y se
        dispara un barrido completo de productos para llenar las columnas.
        **Tres bugs atrapados en el camino**: (1) la vista con un
        `filter_tree` cuya raíz era una condición suelta NO validaba y el pack
        la salteaba en silencio — la raíz tiene que ser un grupo (ahora el
        test del alta exige que las vistas existan); (2) las tablas del
        tablero de Ventas de v0.1.206 usaban `columns`, clave que el widget
        ignora (la real es `visible_field_ids`) → salían con columnas por
        defecto; corregido en el pack y **reparado** en los tableros ya
        creados por la actualización; (3) el mapeo se llamaba como
        `rows.map(mapProduct)` y le pasaba el ÍNDICE como opciones. 8 tests
        nuevos (puros de estado/umbral/valor + integración: una venta baja el
        stock sin tocar la fecha del producto → vendidas 1, cobertura 2; la
        actualización del pack agrega campos/vistas/tablero, repara las
        tablas y es idempotente) — 725 API, 154 front, 66 shared en verde —
        + E2E navegador 18/18 contra la tienda falsa (estados, valor, «Para
        reponer», tablero, venta que baja el stock en vivo) y regresión de
        tiempo real 23/23 y sincronización 25/25.

  - [x] **Reposición con órdenes de compra (v0.1.209, ADR-S24, pedido del
        usuario: "hacé la reposición completa con órdenes de compra")**: el
        inventario de v0.1.208 decía QUÉ faltaba; ahora se REPONE desde la app
        y las unidades llegan solas al stock de WooCommerce.
        (a) **Tres listas nuevas en la carpeta de la tienda** (pack versión 3):
        Proveedores (contacto, días de entrega, nº de órdenes y última),
        Órdenes de compra (número OC-0001 automático, estado borrador →
        enviada → recibida parcial / recibida / cancelada, fecha y entrega
        estimada por los días del proveedor, y rollups de líneas, unidades,
        total y «por recibir»; vista kanban por estado) y Líneas de compra
        (artículo, cantidad pedida y recibida, costo, subtotal, lo ya sumado y
        lo pendiente). En productos y variaciones: **«En camino»** (rollup de lo
        pendiente de órdenes enviadas), **«Sumar al stock»** y **«Último
        movimiento»**. Las tiendas ya conectadas se actualizan solas en la
        próxima corrida (`extend` ahora también CREA listas, dentro de la
        carpeta de la tienda) y las tablas del tablero de inventario ganan la
        columna «En camino».
        (b) **Crear la orden desde la selección**: en Productos o Variaciones
        (típicamente en «Para reponer») se marcan filas y la barra de acciones
        ofrece **«Orden de compra»**: un diálogo con la cantidad SUGERIDA por
        artículo (un mes de venta + la alerta de stock − lo que hay − lo que
        viene en camino, mínimo 1), el costo de la última compra, proveedor
        (existente o nuevo por nombre), estado y fecha. Los costos aceptan el
        punto de miles latinoamericano ("12.500"). Un producto variable se
        bloquea con el motivo: se pide por variación. Endpoints
        `POST /connections/:id/purchasing/preview|orders` (`create_records`).
        (c) **Recibir suma sobre el stock REAL de la tienda**: WooCommerce sólo
        acepta el stock absoluto, así que se lee el producto EN LA TIENDA y se
        escribe `antes + delta` (el número de la app puede estar atrasado por
        una venta). Cada línea recuerda cuánto ya aplicó, así que re-guardar
        «Recibida» no suma dos veces y corregir lo recibido ajusta sólo la
        diferencia; «Recibida parcial» suma lo recibido por línea. Una
        variación que hereda el stock del producto se suma al padre (y se
        anota). La orden deja escrito el resultado ("Se sumaron 11 unidades…")
        o los problemas por línea, y cada artículo su movimiento
        ("+10 por OC-0001 → stock 10").
        (d) **«Sumar al stock»** para ajustes sueltos (devolución, conteo): se
        escribe el número en la columna (-3 resta), se suma a lo que la tienda
        tenga en ese momento y la celda se vacía sola — con una escritura
        condicional ANTES de tocar la tienda, así un ajuste no se aplica dos
        veces.
        (e) **Selector de registros para las relaciones** (hallazgo de la
        prueba): los campos `relation` se editaban TIPEANDO IDS separados por
        coma en el alta y en la ficha, y ni siquiera aparecían como columna en
        la tabla. Ahora `RelationPicker` (chips con el TÍTULO del vinculado +
        buscador del servidor sobre la lista destino, que respeta el ACL) en
        el alta, la ficha, el layout CRM y la celda de la tabla, y las
        relaciones son columnas visibles/ocultables en la tabla plana y la
        agrupada. Los títulos se resuelven en lote con `?ids=` —una query por
        columna y página, nunca una por celda— y la columna no ofrece ordenar
        (el backend no ordena por relación).
        (f) **«Vinculados» en la ficha**: los registros de OTRAS listas que
        apuntan a éste (las líneas de una orden, los pedidos de un cliente),
        con sus columnas y **«Agregar»** que abre el alta con la relación ya
        cargada. El listado de records ganó `related_to=<campo>:<registro>`
        (400 si el campo no es una relación de esa lista) e `ids=`.
        (g) Pantalla de la tienda: sección **«Reponer stock»** con el paso a
        paso y accesos a Órdenes de compra, Proveedores y «Para reponer».
        **Dos bugs atrapados en el E2E**: (1) el servicio cachea 30 s qué
        listas son de compras y una tienda recién armada quedaba afuera — la
        orden no se recibía hasta que vencía el caché; ahora una lista
        desconocida fuerza una recarga (a lo sumo cada 2 s). (2) El
        interruptor «Editar desde la app» de v0.1.207 no era optimista de
        verdad: el estado de la mutación llega un tick después y el checkbox
        controlado volvía a su valor hasta la respuesta; ahora el valor se
        fija en el evento. 11 tests de API nuevos (puros de recibir/pendiente/
        sugerencia/numeración/actualización del pack + integración: orden
        desde variaciones, recibir con stock real e idempotencia, recepción
        parcial con stock heredado del padre, «Sumar al stock», `ids`/
        `related_to`, actualización 2→3) — 736 API — y 7 del front (costos,
        helpers de relación; 161) + E2E navegador 24/24 contra la tienda falsa
        (diálogo con sugerencias → OC-0001 → «En camino» 10 → «Vinculados» →
        recibir 0 → 10 en la tienda → re-guardar no suma → «Sumar al stock»
        8 → 11 → alta de línea con el selector → columna Proveedor con el
        nombre → celular) y regresiones de sincronización 25/25, tiempo real
        23/23 e inventario 18/18.

  - [x] **Identificar cada cosa de la tienda (v0.1.210, ADR-S24, pregunta del
        usuario: "¿trae los id o sku? ¿el link del producto y cosas así?" →
        "sí, hacelo todo")**: ya traía ID de WooCommerce y SKU en productos,
        variaciones y líneas de pedido, y «Ver en WooCommerce» sólo en
        pedidos. Faltaba lo que se usa para reconocer y abrir cada cosa:
        (a) **«Editar en WooCommerce»** en productos, variaciones y clientes
        registrados (el de la variación abre su PRODUCTO: WordPress edita las
        variaciones adentro del padre); (b) el **enlace público de cada
        variación** (WooCommerce lo manda y no se guardaba); (c) el **SKU en la
        línea de la orden de compra**, que se completa solo desde la variación
        o el producto (al proveedor se le pide por SKU); (d) la **foto como
        miniatura** en la tabla, la ficha y como portada de Tarjetas, pegada al
        nombre en las tiendas nuevas. La miniatura es una opción de cualquier
        campo URL («Mostrar como: Imagen», `config.display = 'image'`).
        **Por qué un proxy de imágenes** (`GET /media/image?url=`, con sesión):
        la CSP del SPA es `img-src 'self'`, así que en producción el navegador
        BLOQUEA una foto de otro dominio — en desarrollo no se nota (no hay
        CSP). Abrir la CSP exigía tocar el proxy del servidor a mano (la
        auto-actualización no lo toca) y dejaría que el texto de un registro
        dispare pedidos a terceros. El proxy pide por `safeWebhookFetch` (guard
        anti-SSRF; ganó `binary` para devolver bytes), sigue hasta 3
        redirecciones re-validando cada una, sirve SÓLO tipos de imagen que no
        ejecutan nada (SVG afuera: ejecuta script) hasta 5 MB, con `nosniff`,
        `CSP: sandbox` y cache privada de un día; cualquier cosa rara → 404
        opaco y la UI cae al enlace de texto.
        **Actualización automática (pack 4)**: `packAddition` ahora sabe qué
        listas EXISTEN (una tienda que no sincroniza clientes no gana una lista
        de Clientes vacía), las columnas «Imagen» existentes pasan a miniatura,
        las líneas de compra ya hechas reciben su SKU con un solo UPDATE, y se
        re-leen productos y clientes para llenar los enlaces.
        **Cuatro bugs encontrados en el camino**: (1) en la respuesta anterior
        le dije al usuario que la imagen «sí se puede usar de portada» en
        Tarjetas — no era cierto: la portada sólo aceptaba campos Archivo (en
        el panel de la vista Y en la página, que la descartaba de nuevo);
        ahora también un enlace de imagen. (2) Toda fecha-hora que llega en
        ISO completo (`…T12:04:00Z`, lo que escribe la sincronización y la
        API) se mostraba CRUDA en la ficha: `DateDisplay` le sumaba otra `Z`
        (`…ZZ` → fecha inválida). El mismo `+ 'Z'` a ciegas estaba en 11
        lugares más (tabla, calendario, cabecera CRM, comentarios, campana,
        historial…); ahora todos usan `parseUtcDate` (`lib/utcDate`), y
        «Creado/Actualizado» de la ficha respetan el formato regional. (3) El
        `loading="lazy"` de la miniatura nunca disparaba dentro del scroller
        propio de la app (el `<main>`, no la ventana): la imagen no se pedía;
        se quitó. (4) La columna de imagen nacía con ancho de URL (220 px);
        ahora 90. 7 tests de API (pack 3→4 y enlaces puros, proxy: URLs,
        tipos, redirecciones, SVG/HTML/truncado/destino interno → 404, bytes
        reales por socket, e integración de la actualización con el SKU
        rellenado y los enlaces de la vuelta completa) — 743 API — y 4 del
        front (proxy y fechas; 165) + E2E navegador 18/18 contra la tienda
        falsa (que ahora sirve imágenes de verdad: la miniatura CARGA por el
        proxy, SVG → 404, sin sesión → 401, enlaces exactos, SKU en la orden,
        portada de Tarjetas, «Mostrar como: Imagen») y regresiones de
        reposición 24/24 e inventario 18/18.

  - [x] **Índice de listas y Favoritos agrupados por carpeta (v0.1.211,
        pedido del usuario con captura: "sólo hay un menú donde se ven todas;
        sería bueno agruparlas por espacio de trabajo, y Favoritos también")**:
        la página de Listas era una grilla plana de TODAS las listas (con 308
        listas, ilegible) aunque el menú lateral ya las ordenaba por carpeta
        desde v0.1.130. Ahora: (a) **Listas agrupadas por carpeta** — las
        mismas del panel ("Espacio de trabajo"), en el mismo orden, con su
        cuadrado de icono y color; cada sección se pliega (persistido por
        dispositivo) con su contador y **"Nueva lista aquí"** (el alta nace en
        esa carpeta, v0.1.173); "Sin carpeta" va al final. Selector **Por
        carpeta / Todas** (en "Todas" cada tarjeta muestra el chip de su
        carpeta), **buscador** sin acentos por nombre, slug, descripción o
        nombre de la carpeta (buscando, las carpetas plegadas se abren: esconder
        un resultado detrás de una sección cerrada confunde) y **pin para
        anclar** a favoritos desde la tarjeta. La tarjeta muestra el icono y
        color REALES de la lista (antes, el mismo icono genérico para todas) y
        la fecha en el formato regional de la empresa. Los tiles "Documentadas"
        y "Slug ocupados" (que no decían nada útil) pasan a **Carpetas** (con
        cuántas listas están sueltas) y **Ancladas**. (b) **Favoritos por
        carpeta o por tipo**, en la página Y en su panel lateral: por carpeta =
        una sección por carpeta con las listas ancladas, después las sueltas y
        al final los dashboards (no viven en carpetas); por tipo = Listas /
        Dashboards. La elección es UNA sola compartida entre página y panel
        (`usePersistedChoice`: store externo sobre localStorage con
        `useSyncExternalStore` — cambiarla en un lado repinta el otro al
        instante). Piezas puras compartidas y testeadas: `sectionsByFolder`
        (orden por `position`, carpetas vacías fuera, una carpeta desconocida
        cae a "sin carpeta" en vez de hacer desaparecer la lista),
        `matchesListQuery` y `favoriteSections` (respeta el orden en que se
        anclaron y descarta ids borrados); `ViewSwitch` (control segmentado) e
        `IconSquare`/`FolderSquare` reusables. Sin cambios de backend. 6 tests
        unitarios (171 front en verde) + E2E navegador 28/28 (secciones en
        orden con el color de la carpeta y de la lista, plegar persiste,
        búsqueda por lista y por carpeta, alta desde la carpeta, "Todas" con
        chip y persistencia, anclar desde la tarjeta, favoritos por carpeta con
        dashboards al final, por tipo, página y panel sincronizados en los dos
        sentidos, celular sin desborde y con el pin visible sin hover).

  - [x] **Cada carpeta es un espacio (v0.1.212, pedido del usuario: "al darle
        click a cada carpeta en el menú, ver de una un espacio con solo esas
        listas")**: la cabecera de carpeta del menú tenía UN solo blanco
        (plegar/desplegar). Ahora tiene dos, como ClickUp: el **cuadrado de
        color** (chevron al hover) sigue plegando —con objetivo táctil de 32px
        en celular— y el **nombre abre la carpeta** en `/folders/:id`
        (`FolderPage`): breadcrumb Listas › carpeta, el icono y color de la
        carpeta, "N listas · M actualizadas esta semana", buscador (con más de
        3 listas), las MISMAS tarjetas del índice (`ListCard` extraído y
        compartido: icono y color reales, pin a favoritos) y **"Nueva lista"**
        que nace adentro. Abrirla también la despliega en el menú y la marca
        como activa; en el drawer de celular el nombre navega y cierra, el
        icono pliega sin cerrar. En el índice de Listas cada sección gana un
        botón **"Abrir"**. Estados propios: carpeta vacía (explica que se puede
        crear o arrastrar una lista hasta el nombre) y carpeta inexistente
        (salida a Listas). El enlace del nombre es `draggable={false}`: el
        destino de arrastre de listas sigue siendo la fila entera. Sin cambios
        de backend. E2E navegador 22/22 (plegar no navega, el nombre abre el
        espacio y lo despliega, activa en el menú, sólo sus listas, resumen,
        color, buscador, pin, alta en la carpeta, abrir lista, "Abrir" desde el
        índice, vacía, inexistente, celular) + regresión de v0.1.211 28/28.

  - [x] **Rediseño de la integración WooCommerce: la lista de la tienda es un
        ESPEJO (v0.1.213, ADR-S24 pack 5, reporte del usuario: "es confuso…
        productos en una lista y sus variaciones en otra… veo campos que no
        deberían poderse editar… órdenes de compra, proveedores, todo eso no es
        de WooCommerce")**. Decisiones tomadas con él: variaciones Y líneas como
        subtareas; sólo precios, stock y estados editables; columnas propias
        permitidas y marcadas.
        (a) **Tres listas en vez de cinco (más tres de compras)**: Productos
        con cada **variación como SUBTAREA** de su producto, Pedidos con cada
        **línea como subtarea** de su pedido, y Clientes — el modelo de
        subtareas de v0.1.132, así la tabla muestra el primer nivel y la
        flechita despliega lo de adentro, con todo el ancho de la tabla (la
        ficha flotante quedaba chica para ver variaciones). Una columna `tipo`
        dice qué es cada fila y los tableros/rollups la filtran para no contar
        dos veces; el producto variable muestra el RESUMEN de sus variaciones
        (stock y valor sumados, estado más urgente) y el pie y los grupos
        cuentan sólo el primer nivel (`AggregateService.run` ganó `rootsOnly`).
        El motor sigue hablando de cinco recursos: `settings.lists.variations`
        apunta a Productos y `line_items` a Pedidos.
        (b) **La tienda manda**: en una lista marcada no se crean, borran ni
        importan registros — rechazado en el API (403 `store_managed`), el
        importador, las automatizaciones (`create_record` se saltea con el
        motivo en el log), el asistente IA/MCP y las recurrencias (no se clona
        ni se rueda una fecha de la tienda); la interfaz no ofrece esos
        botones (toolbar, menú lateral, «Vinculados», menú contextual, edición
        masiva) y el banner enlaza a «Crear en WooCommerce».
        (c) **Qué se edita**: sólo precios, stock y estados (publicación,
        estado del pedido) y sólo con «Editar desde la app». Las reglas son
        PURAS en shared (`store-rules.ts`: `storeCellAccess` +
        `storeValueError`), así el backend rechaza (403 `store_field_locked` /
        400 `store_invalid_value`) con la MISMA función con la que la UI dibuja
        el **candado y el motivo** en celdas, ficha, modal y layout CRM: un
        variable no tiene precio propio, el rebajado no supera al normal, el
        stock es entero, el estado de stock lo calcula WooCommerce si el stock
        está controlado, las líneas no se tocan. Una automatización que intente
        otra cosa saltea ESE campo con el motivo.
        (d) **Columnas**: cada encabezado lleva su marca — candado (viene de la
        tienda), flechas (se cambia acá y viaja) o lápiz (**sólo en Imagina**,
        propia de la empresa, libre y nunca viaja). Una columna de la tienda
        sólo cambia de nombre/descripción/índice (ni tipo, ni opciones, ni se
        borra) en el menú del encabezado, el cuadro de edición y el
        administrador de campos (badge «WooCommerce»); el backend tolera que un
        formulario reenvíe los MISMOS valores (config comparada con claves
        ordenadas: JSONB las reordena).
        (e) **Banner** en cada lista de la tienda: de dónde viene, qué se puede
        cambiar (según la lista y el interruptor) y un «¿Qué puedo cambiar?»
        con la leyenda de las marcas.
        (f) **Se retiró la reposición** de v0.1.209 (proveedores, órdenes y
        líneas de compra, «Sumar al stock», «En camino»): no es de WooCommerce.
        (g) **Migración automática** de las tiendas conectadas en su próxima
        corrida (pack <5 → 5): campos que sobran fuera, rollups rearmados,
        variaciones y líneas viejas dadas de baja y re-traídas como subtareas,
        tableros recreados; las listas de compras VACÍAS se borran y las que
        tienen datos QUEDAN como listas comunes. Bitácora `store_sync.migrate`.
        (h) **Bug encontrado en el camino**: dejar de sincronizar (o borrar la
        conexión) NUNCA quitaba la marca de las listas — con los bloqueos de
        esta versión habrían quedado trabadas para siempre. Ahora se quita en
        los dos caminos (`stripStoreMarkers`), la migración 0055 limpia las
        huérfanas (144 en el entorno de desarrollo) y el cambio de «Editar
        desde la app» o la desconexión avisan por realtime a las pestañas
        abiertas (antes la marca vieja quedaba en caché). De paso se quitó la
        vista «Todos» del pack, que duplicaba la pestaña «Todos» fija.
        Tests: 7 de reglas en shared, 2 de la UI, 25 del mapeo y 24 de
        integración de la sincronización (subtareas, pie y grupos, bloqueos,
        edición que viaja, automatización que respeta las reglas, migración,
        desconexión que deja las listas libres) + E2E navegador 30/30 contra la
        tienda falsa (tres listas, flechita de variaciones y de líneas,
        candados, sin «Nuevo registro», precio que llega a WooCommerce, nombre
        rechazado, columna propia, administrador de campos, desconectar,
        celular). **Límite de la verificación**: la prueba contra un
        WooCommerce REAL sigue bloqueada por la política de red del entorno
        (wordpress.org/GitHub 403, Docker Hub 429).

  - [x] **Columnas editables elegibles + prueba contra un WooCommerce REAL
        (v0.1.214, ADR-S24, pregunta del usuario: "¿puedo elegir qué campos se
        editan? un cliente quizás quiera cambiarle el nombre a los productos, la
        categoría o añadir una etiqueta")**. La lista fija de v0.1.213 (precios,
        stock y estados) pasa a ser un **catálogo** del que cada empresa elige
        por lista (`STORE_EDITABLE_CATALOG` en shared): productos gana nombre,
        SKU, categorías y etiquetas; pedidos, nota del cliente, email y
        teléfono; clientes con cuenta, nombre, email, teléfono, empresa y
        ciudad; y cualquier campo de otro plugin traído a columna. Lo de
        v0.1.213 viene prendido (una tienda conectada no cambia). Se elige en la
        página de la tienda y en **Ajustes → Campos** de cada lista; vive en
        `settings.editable` y viaja a la marca de la lista, así la MISMA
        `storeCellAccess` decide en el backend y en la interfaz (candado con
        «habilitala en…»). Prender/apagar una columna viaja como
        `editable_toggle` y se aplica sobre lo guardado (una caché vieja no pisa
        la elección — lo atrapó el E2E). **Categorías y etiquetas**: la API sólo
        acepta ids, así que se resuelven por slug y la que falta se CREA en la
        tienda; la opción nueva nace con el slug que le va a dar WordPress. **Un
        rechazo vuelve atrás**: si WooCommerce rechaza un envío (SKU repetido)
        se relee el objeto y la app queda con el valor de la tienda, con el
        motivo a la vista. Renombrar un producto variable relee sus variaciones.
        **Bug latente de paso**: el «Crear» del selector de opciones llamaba a
        `POST …/fields/:f/options`, que la nube nunca implementó — crear una
        opción al vuelo fallaba en TODAS las listas; ahora existe.
        **Prueba contra un WooCommerce 11.1.2 real** (WordPress + WooCommerce
        levantados en el entorno con PHP y MariaDB, al habilitarse la red
        «Personalizado»): encontró tres bugs que la tienda simulada no podía
        mostrar — (a) el nombre del sitio se perdía (el índice `/wp-json/` de
        una tienda real pesa >1 MB) → `?_fields=name`; (b) WordPress sólo
        entrega avisos a los puertos 80/443/8080 y el error queda sólo en su
        log → la app lo detecta antes de registrar y avisa si la tienda
        DESACTIVÓ avisos por fallas; (c) borrar la conexión dejaba los avisos
        registrados llamando a una URL muerta → se sacan antes de borrar.
        E2E 34/34 contra la tienda real (conectar, tiempo real con 10 avisos,
        variaciones y líneas como subtareas, precio/stock/estado que viajan,
        pedido y precio que llegan solos, nombre, etiqueta nueva creada en
        WooCommerce, categoría, SKU repetido que vuelve atrás, teléfono de la
        clienta, invitado bloqueado, elección desde la tienda y desde la lista,
        banner, borrar la conexión sin dejar avisos). Tests: 7 de reglas en
        shared, 5 del envío puro, 2 de integración (elección + envío completo;
        borrar conexión) y 1 del endpoint de opciones — 739 API, 169 front y
        76 shared en verde.

  - [x] **Slug del producto editable (v0.1.215, ADR-S24 pack 6, pregunta del
        usuario: "¿y si algún cliente quiere editar el slug del producto?")**:
        el slug NI SE TRAÍA. Ahora Productos tiene la columna «Slug» (leída
        decodificada: WordPress guarda `caf%c3%a9`) y se suma al catálogo de
        columnas editables (apagada por defecto; una variación no tiene
        dirección propia → candado con el motivo). Se rechaza antes de mandarlo
        vacío o con `/`, `?`, `#`; WordPress limpia el resto (acentos, espacios,
        mayúsculas → `taza-cafe-grande`) y lo hace único (`libreta-2`), y la
        app queda con lo que devolvió la tienda, «Enlace» incluido.
        **Upgrade liviano del pack**: las tiendas en el pack 5 sólo suman las
        columnas que les faltan (sin rehacer tableros ni re-traer variaciones)
        y una vuelta de productos las llena. **Bug de paso**: tras actualizar
        el pack, `runJob` re-marcaba las listas con los ajustes leídos ANTES de
        la actualización, así que la marca (candados, qué viaja) quedaba vieja
        hasta la corrida siguiente — también pasaba en la migración de
        v0.1.213; ahora relee. Tests: reglas en shared, mapeo/envío puros, envío
        con limpieza y unicidad y upgrade 5→6 que no rehace nada (741 API, 169
        front, 77 shared en verde) + E2E 45/45 contra un **WooCommerce real**:
        el slug llega, se cambia, llega a la tienda con su enlace nuevo, **la
        dirección vieja responde 301 a la nueva**, WordPress limpia acentos y
        espacios, lo hace único si ya existe, y la variación queda bloqueada.

  - [x] **Edición masiva de verdad (v0.1.216, ADR-S25, pedido del usuario:
        "edición masiva con sumas, restas, cálculos…")**: la acción masiva sólo
        sabía «poner este valor» sobre la selección de la página. Ahora
        **«Editar en lote»** (barra de selección, y «Edición masiva» en
        Personalizar vista para TODO lo que coincide con los filtros y la
        búsqueda, hasta 5.000) abre un diálogo con una lista ORDENADA de cambios
        —cada uno parte del valor de CADA registro y ve el resultado del
        anterior—: poner/vaciar; **sumar, restar, multiplicar, dividir, subir o
        bajar un %**; **redondear** a una grilla `k × múltiplo + ajuste` en una
        dirección (presets «terminar en 900», «a miles», «terminar en ,99»;
        hacia arriba NUNCA baja un precio: 11.000 → 11.900); **calcular** una
        columna con otras (`Precio = Costo × 1,3`); copiar entre columnas con
        conversión de tipo; texto (prefijo, sufijo, buscar/reemplazar literal,
        mayúsculas, espacios); **agregar/quitar opciones** de un multi_select sin
        pisar las demás; invertir un checkbox; **correr fechas** (días a años,
        con fin de mes); poner hoy; vincular/desvincular registros. Operaciones
        por tipo en `BULK_OPS_BY_TYPE` (shared): la UI arma el menú con eso y el
        motor lo exige. **Vista previa** con antes → después, cuántos cambian,
        cuántos ya estaban así y cuáles no se pueden cambiar con el motivo
        (operando vacío, valor que el campo no acepta, lo que la tienda no
        admite) — una fila con error NO se escribe a medias. La vista previa y la
        escritura usan la MISMA función pura (`applyBulkOperations`); se aplica
        en tandas de 200 con barra de avance y cada escritura es un
        `RecordsService.update` (validación, ACL por fila, bitácora,
        automatizaciones, reglas y envío de la tienda). Editar por filtro exige
        `bulk_actions`; la selección, poder editar. Los números se tipean con
        los separadores de la empresa («12.500» con punto de miles).
        Endpoints `POST /lists/:l/records/bulk-edit/preview` y `/bulk-edit`.
        **Encontrado en el E2E**: el primer diseño del redondeo era
        «redondear y después sumar el ajuste», y con «terminar en 900» un
        11.000 quedaba en 10.900 — bajaba el precio; ahora se ajusta a la
        grilla en la dirección pedida. 14 tests del motor en shared + 5 del
        diálogo en el front + 5 de integración con Postgres (por selección, por
        filtro abarcando más que la página, filas con error, alcance de edición
        del agente, columnas calculadas) + E2E navegador 21/21 (230 registros:
        tres cambios encadenados, 230 por filtro en dos tandas con avance,
        errores listados, punto de miles, celular).

  - [x] **Edición masiva de la tienda WooCommerce (v0.1.217, ADR-S24, segunda
        mitad del pedido: "en productos quiero todo lo que se puede hacer en
        lote: precios, categorías, etiquetas, atributos y más")**: la edición
        de v0.1.216 escribe columnas de la APP; la tienda tiene mucho que la app
        no refleja (atributos, peso, medidas, clase de envío, visibilidad,
        destacado, reservas, fechas de la rebaja). Módulo propio que opera
        SOBRE WOOCOMMERCE: **«Editar en la tienda»** (barra de selección, y en
        Personalizar vista para todo lo que coincide con los filtros) en la
        lista de Productos con «Editar desde la app» encendido. Operaciones
        agrupadas como en el panel de WooCommerce: **precios** (normal y
        rebajado: poner, sumar, restar, subir/bajar %, con el mismo redondeo a
        la grilla de v0.1.216; rebaja como % de descuento sobre el normal o
        quitarla; programar la rebaja desde/hasta), **inventario** (stock
        poner/sumar/restar, controlar stock, estado del stock, reservas, alerta
        de stock bajo), **publicación** (estado, visibilidad en el catálogo,
        destacado), **organización** (categorías y etiquetas agregar/quitar/
        reemplazar sin pisar las demás —la que no existe se CREA en la tienda al
        aplicar—, **atributos** globales o propios con sus valores, nombre con
        prefijo/sufijo/buscar-reemplazar), **envío e impuestos** (peso, medidas,
        clase de envío, estado y clase de impuesto) y **campos de otros
        plugins** (`meta_data` por clave). Reglas: se calcula sobre el objeto
        FRESCO de la tienda (no la copia de la app, que puede venir atrasada por
        una venta); los productos variables se editan **por variación**
        (opcional, default sí); la escritura va por la **API batch** (100 por
        pedido — un producto rechazado vuelve con su motivo y no tira a los
        demás); un atributo que usan las variaciones no se reemplaza ni se
        quita (rompería las variaciones); un rebajado ≥ normal se descarta con
        nota; una variación que hereda el stock del padre se saltea; y respeta
        el catálogo de columnas editables de v0.1.214 (una operación sobre una
        columna no habilitada aparece deshabilitada con el motivo). Vista previa
        con antes → después y notas por producto/variación, aplicación en
        tandas de 25 con avance, y lo que devuelve la tienda se refleja en la
        app con el mismo upsert de la sincronización (dispara automatizaciones:
        es un cambio real). Bitácora `store_sync.bulk_edit`. El plan es PURO
        (`planBulkUpdate`, `woo-bulk.ts`) y lo comparten vista previa y
        aplicación. 9 tests unitarios del plan + 1 de integración con la tienda
        simulada (precio ±% redondeado, categoría nueva creada, atributo,
        destacado) — 756 API, 178 front y 91 shared en verde — + E2E navegador
        25/25 contra un **WooCommerce 11.1.2 real** (precios ±% redondeados por
        variación, stock +3, categoría nueva creada conservando las existentes,
        atributo global Material, destacado, rebaja de 25 % programada en las
        variaciones, atributo de variación protegido, alcance «todos los de la
        vista» que toca un producto no seleccionado, celular).

  - [x] **Deshacer una edición masiva (v0.1.218, ADR-S25, primera de las
        mejoras de edición masiva pedidas: "sí, hacé todo")**: un «subir 10 %»
        equivocado sobre 5.000 registros sólo se arreglaba a mano. Ahora cada
        edición masiva —de la app o de la tienda— queda en un **historial**
        (`bulk_edits` + `bulk_edit_items`, migración 0056, RLS) con el ANTES y
        el DESPUÉS de lo que cambió en cada fila, y se puede **deshacer**:
        desde el resultado de la edición (botón «Deshacer») o desde
        Personalizar vista → **Historial de ediciones masivas** (qué se hizo en
        criollo —«Precio: subir 10 % · Stock: sumar 5»—, quién, cuándo,
        cuántos, y si ya se deshizo del todo o en parte). Reglas: (a) una
        edición es UNA aunque se aplique en tandas (la primera devuelve
        `edit_id`, las siguientes lo repiten; nadie le cuelga filas a la
        edición de otro); (b) el DESPUÉS guardado es lo que quedó de verdad
        (validado por la app o devuelto por WooCommerce), así «sigue igual» se
        compara bien; (c) **conflictos**: si alguien tocó una fila después, no
        se pisa — la vista previa la lista con qué cambió («Precio cambió
        después: ahora es 1») y sólo se revierte si se marca «Volverlos atrás
        igual»; los borrados se cuentan aparte; (d) deshacer es una edición
        común (ACL, bitácora, automatizaciones, reglas y envío de la tienda) en
        tandas de 100 con avance, con bitácora `bulk_edit.revert`; (e) la
        propia se deshace siempre, la de otro y las de la tienda exigen
        `bulk_actions`; (f) se conserva 30 días. En la tienda el antes/después
        va en la forma de la API (`snapshotBody`) y la comparación normaliza
        lo que WooCommerce reescribe (ids de categorías como conjunto,
        atributos por nombre y valores, precios como número). 3 tests unitarios
        en shared (94) + 3 de integración (dos tandas, conflicto respetado y
        forzado, permisos y `edit_id` ajeno rechazado; deshacer de la tienda
        con variación tocada después) — 759 API, 178 front y 94 shared en
        verde — + E2E navegador 21/21 (220 registros en
        dos tandas, historial, 219 vuelven y 1 respetado, forzar, deshacer
        desde el resultado con etiquetas de opción, celular) y **17/17 contra
        un WooCommerce 11.1.2 real** (precio, stock, destacado, categorías y
        atributo de vuelta; la variación cambiada después, respetada).

  - [x] **Actualizar registros desde un archivo (v0.1.219, ADR-S25)**: «la
        lista de precios del proveedor», «el stock que mandó el depósito». Un
        CSV ya no sólo crea filas: **empareja** cada fila con un registro que
        existe por una columna clave —el **ID** de la app (la columna del
        export) o un campo único de texto, email, teléfono, enlace o número
        (SKU, email, documento)— y cambia sólo las columnas elegidas.
        Diálogo propio «Actualizar desde un archivo» (Personalizar vista, y
        un enlace desde «Importar»): elegir la columna clave (se sugiere sola
        la del ID o un SKU/código/email), qué columna actualiza qué campo,
        «una celda vacía vacía el campo» y «crear los que no existen»
        (upsert). **Vista previa** con cuántos cambian, cuántos ya estaban
        así, las filas sin registro (con su clave) y los errores por fila —
        clave repetida en el archivo («ya aparece en la fila 3») o que
        coincide con varios registros, valor que el campo no acepta— y un
        ejemplo antes → después con las etiquetas de las opciones. Se aplica
        en tramos de 200 filas con avance y queda en el **historial de
        ediciones masivas**: un archivo equivocado se **deshace** entero
        desde el resultado. La clave se compara normalizada igual en JS y en
        SQL (sin espacios ni mayúsculas; teléfono por dígitos; número como
        número) y sólo empareja lo que la persona puede editar. **Funciona en
        la lista de productos de una tienda** —donde el import no se permite—:
        cada cambio pasa por las reglas de lo que la tienda acepta (la vista
        previa lo avisa por fila con `storeRuleError`, ahora compartido) y
        viaja a WooCommerce; crear queda para las listas comunes. 4 tests de
        integración (SKU con mayúsculas/espacios en dos tramos + deshacer, por
        ID con vaciar, upsert con la clave guardada, clave inválida y valor
        que el campo no acepta) — 763 API, 178 front y 94 shared en verde —
        + E2E navegador 20/20 (260 productos, 250
        filas del proveedor, 3 sin registro, 1 repetida, avance, deshacer,
        upsert, celular) y **12/12 contra un WooCommerce 11.1.2 real**
        (precios por SKU —uno con espacios y en minúsculas— llegan a la
        tienda; el producto variable avisa que no tiene precio propio; crear
        se rechaza; deshacer devuelve los precios en WooCommerce).

  - [x] **Estructura en lote: mover, duplicar, borrar y asignar (v0.1.220,
        ADR-S25, tercera entrega del pedido "hacé todo")**: la barra de
        selección sólo sabía editar valores; duplicar corría registro por
        registro DESDE EL NAVEGADOR (y copiaba los calculados, así que fallaba
        en cualquier lista con uno) y borrar usaba el `confirm()` nativo sin
        vuelta atrás. Ahora son acciones de verdad, con el mismo contrato que
        la edición masiva: vista previa, tandas de 200 con avance y
        **Deshacer** desde el resultado o el historial.
        (a) **Mover como subtareas** de otro registro (buscador del padre) o
        **sacarlas al primer nivel**, con las reglas de siempre (un solo
        nivel; un registro con subtareas propias no baja — se lista con el
        motivo en la vista previa). Deshacer devuelve cada uno a su padre
        anterior y respeta al que alguien movió después.
        (b) **Duplicar**, con o sin sus subtareas: copia los campos que se
        escriben a mano (no calculados, vínculos ni archivos) y consulta el
        límite del plan con el lote ENTERO. Deshacer borra las copias que
        nadie tocó.
        (c) **Eliminar** la selección o **todo lo que coincide** con la vista
        (nuevo item en Personalizar vista): las subtareas se van con su
        registro y deshacer los trae enteros, con subtareas y vínculos
        (`restoreDeleted`, que sólo re-vincula destinos vivos).
        (d) **Asignar**: atajo en la barra que abre la edición masiva ya
        apuntada al campo de persona («Asignar «Responsable»»).
        Una subtarea cuyo padre también está en el lote no se toca aparte (se
        iría o se copiaría dos veces). Endpoints `POST /lists/:l/records/
        bulk-structure/preview` y `/bulk-structure`; tres tipos nuevos en el
        historial (`move`/`duplicate`/`delete`, con su icono). La barra en el
        teléfono deja sólo los iconos y scrollea si no entra. Las listas de la
        tienda no se reestructuran desde la app. 4 tests de integración
        (mover con conflicto al deshacer, borrar por filtro y recuperar con
        vínculos, duplicar con subtareas + límite del plan + copia editada
        respetada, permisos y tienda) — 767 API, 178 front y 94 shared en
        verde — + E2E navegador 24/24 (asignar, mover y deshacer, duplicar con
        subtarea, borrar por búsqueda y deshacer, historial y celular).

  - [x] **Edición en lote programada desde automatizaciones (v0.1.221,
        ADR-S25, cuarta entrega del pedido "hacé todo")**: acción nueva
        **«Editar en lote»** en el editor de automatizaciones — qué registros
        (todos, o los que cumplan un filtro evaluado CUANDO corre) y qué
        cambios, con el mismo editor de operaciones que la edición masiva a
        mano (sumar, porcentajes, redondeos, poner valores…). El caso: «cada
        lunes a las 7:30, subir 5 % los precios de la categoría X», «cada
        noche, pasar a Vencida lo pendiente con fecha pasada». El motor encola
        un job aparte (corriendo adentro de su transacción se colgaba esperando
        sus propios locks), el resultado queda en el **historial de ediciones
        masivas con Deshacer** —autor «Automatización»— y como una corrida más
        de la automatización («Cambió 4 de 4 registros.»), y esos cambios **no
        re-disparan** otras automatizaciones.
        **Bug real encontrado en el camino**: el trigger «De forma programada»
        del editor guardaba una FRECUENCIA (`frequency`, el shape del plugin)
        pero el scheduler del backend sólo leía `cron` → **ninguna
        automatización programada desde la interfaz corría nunca** (y re-guardar
        una creada por API le borraba el cron). Ahora `scheduleCron` (shared,
        con tests) es la única traducción; el editor gana **hora, día de la
        semana o del mes y zona horaria** (la del navegador de quien la guarda)
        más un cron avanzado opcional, el resumen dice «cada martes a las
        07:30», y **al arrancar se re-registran** los horarios de todas las
        activas (las guardadas antes de este fix empiezan a correr solas).
        Botón **«Ejecutar ahora»** en el editor de una programada (no hay que
        esperar al lunes para probarla). 4 tests de integración (encolar →
        editar lo filtrado → historial deshacible sin autor → sin re-disparo;
        config rota falla con motivo; el horario del editor se registra con su
        zona y el resync lo re-registra; «Ejecutar ahora» sólo para
        programadas), 2 de `scheduleCron` y el round-trip operación↔editor —
        769 API, 179 front y 96 shared en verde — + E2E navegador 19/19 (reabrir
        con filtro y operación, guardar dos cambios, ejecutar ahora → 4
        registros cambiados y 2 intactos, corrida con el resultado, historial
        «Automatización», deshacer, y el horario semanal guardado con día, hora
        y zona).

  - [x] **Edición masiva desde el asistente ✨ y el MCP (v0.1.222, ADR-S25 +
        ADR-S21, quinta entrega del pedido "hacé todo")**: herramienta nueva
        **`propose_bulk_edit`** en el mismo registro de herramientas — sale a la
        vez por el asistente de la app y por Claude/Cursor vía MCP. Hasta acá
        el asistente sólo sabía poner un valor FIJO (`propose_update_records`);
        ahora arma las mismas operaciones que la edición masiva a mano, por
        slug y con las opciones por etiqueta: «subí 10 % los precios de las
        tazas y redondeá a terminar en 900», «agregá la etiqueta VIP sin pisar
        las demás», «corré 7 días los vencimientos de lo pendiente», «calculá
        precio = costo × 1,3». La vista previa es la REAL (`BulkEditService.
        preview`, la misma del diálogo): la tarjeta muestra el antes → después
        de una muestra, cuántos ya estaban así y cuáles no se pueden con el
        motivo; aplicar corre en tandas y queda en el **historial de la lista
        con Deshacer**. Destino por filtros, búsqueda o ids; tocar TODA la
        lista exige `all_records: true` explícito. Las automatizaciones que
        propone el asistente aceptan la acción **`bulk_edit`** (con `filters` y
        `operations` por slug, traducidos a ids al proponer, también dentro de
        un `if_else`) con horario programado, así «bajá 5 % las libretas el
        primero de cada mes» sale en una sola propuesta. Regla 15 del prompt
        (cuándo usar cada herramienta) y `docs/mcp.md` al día. 2 tests de
        integración (propuesta con muestra real → aplica → historial deshacible;
        sin acotar, slug desconocido, operación incompleta y rol sin permiso
        rebotan; traducción de la acción de automatización; automatización
        programada con `bulk_edit` guardada con ids y horario) — 771 API, 179
        front en verde — + E2E por el MCP REAL 11/11 (HTTP + token personal:
        `tools/list`, proponer → aplicar con los valores exactos, historial,
        automatización mensual propuesta y guardada con ids, «Ejecutar ahora»
        y la libreta bajó 5 %).

  - [x] **Tienda: precio desde el costo y crear variaciones en lote (v0.1.223,
        ADR-S24, última entrega del pedido "hacé todo")**: (a) operación nueva
        en «Editar en la tienda»: **«Precio según una columna (costo ×
        margen)»** — precio normal o rebajado = columna × factor + suma, con el
        mismo redondeo a terminar en 900. La columna suele ser una propia
        («Costo», sólo en Imagina) y se toma la de CADA variación, así cada
        talla se calcula con su costo; lo que no tiene costo queda igual y se
        dice. (b) **«Crear variaciones»** (barra de selección y Personalizar
        vista en la lista de productos): se eligen atributos —globales de la
        tienda o propios del producto— y sus valores (Color: Rojo, Azul ×
        Talla: M, L, XL), precio, stock inicial y estado; cada producto
        variable recibe SÓLO las combinaciones que le faltan (una variación
        «cualquier talla» cuenta como existente), los valores nuevos se suman a
        sus atributos sin quitar nada, se escribe por lote y las variaciones
        llegan solas a la app como subtareas. Se **deshace** desde el resultado
        o el historial: borra las creadas en WooCommerce salvo las que alguien
        tocó después. 2 tests puros del planificador (costo × margen con
        redondeo, sin costo, rebajado, variable/columna bloqueada;
        combinaciones, existentes, «cualquiera», simple, tope) + 1 de
        integración con la tienda simulada (costos por objeto, columna no
        numérica, crear sólo lo que falta, repetir no duplica, deshacer) + 1
        del front — 774 API, 180 front y 96 shared en verde — + E2E 16/16
        contra un **WooCommerce 11.1.2 real** (taza 18.000 × 1,35 → 24.900,
        variación con costo 27.900 y sin costo intacta; Color × Talla con XL
        crea 3 de 6 con precio y stock, el producto gana la talla, llegan como
        subtareas, y deshacer las borra de la tienda y de la app).
  - [x] **Búsqueda en la vista agrupada sin grupos vacíos ni esperas (v0.1.224,
        reporte del usuario: "carga los resultados agrupados pero siguen
        viéndose las agrupaciones vacías y a los segundos se oculta lo
        vacío")**. Reproducido con 3.000 registros y latencia simulada: al
        cambiar de búsqueda los grupos nuevos se veían VACÍOS ≈500 ms. Cuatro
        causas, todas corregidas:
        (a) **Dos vueltas en serie**: el front pedía los grupos y, con esa
        respuesta, recién las filas de los abiertos — cada búsqueda costaba
        dos requests seguidas, y entre medio los grupos nuevos no tenían
        filas, así que además cada uno disparaba su propia request de filas
        y otra de agregados (14 de más). Ahora `grouped-bundle` acepta
        `expand=all` + `collapsed=[…]`: UNA request trae grupos, filas y pie
        de todos los abiertos; mientras llega la nueva, la anterior se ve
        atenuada en vez de vaciarse.
        (b) **El servidor armaba los grupos de a uno**: dos viajes a la base
        por grupo, en fila, incluso para grupos que la búsqueda ya había
        dejado sin filas. Ahora sólo los presentes en la consulta, de a 3 en
        paralelo (tope de 40 que se abren solos).
        (c) **Requests de más**: en modo agrupado la página pedía igual el
        listado PLANO (con y sin búsqueda) y encima esperaba su respuesta
        para montar la vista — la primera carga iba en serie. Ya no se pide;
        el total de "todos los que coinciden" (acciones masivas) y el
        spinner del buscador los informa el bundle. La tabla plana tampoco
        se monta un instante antes de aplicar la vista guardada (disparaba
        sus agregados).
        (d) **Tipear trababa la pantalla**: cada letra re-dibujaba todas las
        filas de todos los grupos (7 letras = 3 s de hilo principal
        bloqueado en desarrollo). La vista agrupada va memoizada con
        callbacks de identidad estable (`useEventCallback`), y la sincronía
        del scroll horizontal ya no fuerza un recálculo de layout por cada
        grupo que se monta (era lo más caro del perfil).
        **Dos bugs de paso**: la clave de un grupo multi_select es un JSON con
        comas (`["promo", "vip"]`) y viajaba separada por comas, así que esos
        grupos NUNCA llegaban con sus filas en el bundle (ahora las claves
        van como lista JSON); y un multi_select VACIADO queda como `null` JSON,
        que el filtro "está vacío" no contemplaba — el grupo "(Sin valor)"
        contaba el registro pero no lo mostraba.
        Medido con el build de producción y 150 ms de latencia: antes 2
        bundles + 14 requests por grupo, grupos vacíos ≈500 ms y el
        resultado completo ≈900 ms después de dejar de tipear; ahora 1
        request, nunca vacío y ≈580 ms (localmente el endpoint con 14 grupos
        abiertos bajó de ≈250 a ≈60 ms). Tests: bundle en una vuelta con
        multi_select y "(Sin valor)" vaciado, claves JSON del query, y la
        sincronía de scroll sin tocar layout — 778 API y 181 front en verde —
        + E2E navegador 15/15 (una sola request al cargar, plegar/desplegar,
        búsqueda sin grupos vacíos, total de la edición masiva, abrir un
        registro, multi_select) y la vista plana sin cambios.

  - [x] **Release de seguridad: SSRF por IPv6 y toma de cuentas por el portal
        (v0.1.225, auditoría integral pedida por el usuario)**: siete revisiones
        en paralelo por frente (auth, tenancy/ACL, inyección, egreso, archivos y
        endpoints públicos, secretos/despliegue, portal/IA/automatizaciones) y
        cada hallazgo verificado a mano antes de tocar código. Este release trae
        los TRES críticos; el resto va en los siguientes.
        (a) **SEC-24 — cualquiera se logueaba como el superadmin** (reproducido
        de punta a punta contra la API local): registrarse (quien se registra es
        admin de su empresa), crear una lista y un registro, pedir un enlace del
        portal para el email del superadmin → la respuesta DEVOLVÍA el token →
        canjearlo abría una sesión normal de esa cuenta → `/platform/*` entero
        (copias con los secretos del servidor, impersonar, restaurar). El guard
        de SEC-01 sólo rechazaba cuentas con membresía de equipo, y el
        superadmin no tiene ninguna; lo mismo valía para usuarios sin workspace
        y para el cliente de OTRA empresa (que además quedaba viendo el portal
        de cualquiera de las dos: `WHERE user_id LIMIT 1`). Arreglo en capas:
        el enlace no se emite para superadmins ni cuentas desactivadas; a quien
        lo pide sólo se le DEVUELVE si la cuenta es de su empresa (recién creada
        o ya cliente suya) — si existía por su cuenta le llega sólo por correo;
        canjearlo abre una sesión ATADA a la empresa del enlace
        (`portalTenantId`) que `SessionGuard` limita a `/portal/*` + logout;
        `requireLink` busca el vínculo en ESA empresa (una sesión vieja con dos
        vínculos es ambigua → 404, no "el primero"); quitar el acceso cierra
        sólo las sesiones del portal de esa empresa; `TenantGuard` rechaza el
        rol `client` (antes leía listas, campos, vistas y la config del portal
        con sólo mandar `X-Tenant-Id`); y la consola de plataforma exige una
        sesión abierta CON CONTRASEÑA (`via: 'password'`), así cualquier sesión
        acuñada por el agujero antes de actualizar queda afuera (el operador
        vuelve a entrar una vez).
        (b) **SEC-23 — el guard anti-SSRF no miraba los literales IPv6**:
        `URL.hostname` trae el IPv6 CON corchetes, `isIP('[::1]')` da 0 y node
        no llama a `lookup` para IPs literales → `http://[::ffff:a9fe:a9fe]/`
        llegaba a la metadata del cloud y `http://[::ffff:7f00:1]:2019/` al
        admin de Caddy (reescribir el proxy de TODOS los tenants), con el cuerpo
        de la respuesta visible en el probador de webhooks. Ahora la IP se
        valida por NÚMEROS (`ipv6Hextets`: mapped en hex o sin comprimir,
        IPv4-compatible, NAT64, 6to4 deciden por la IPv4 embebida; Teredo,
        documentación, discard y todo lo que no sea unicast global afuera) +
        rangos IPv4 que faltaban (198.18/15, 198.51.100/24, 203.0.113/24,
        192.88.99/24); el llamador no puede fijar `Host` ni las cabeceras de
        framing; tope de tiempo TOTAL (el de node es de inactividad: un servidor
        que gotea un byte retenía al worker); y el admin de Caddy pasa a un
        socket unix. (c) **SEC-28 — `?/health` salteaba el rate limit**: el
        allowList de los probes miraba `req.url` entero (con query), así que
        `POST /auth/register?/health` o `/auth/forgot-password?/health` corrían
        sin límite; ahora todo se decide sobre el path.
        Tests: 7 nuevos del guard (18 en el spec) + 5 de SEC-24 en el spec del
        portal (superadmin rechazado, token que no vuelve para una cuenta ajena,
        cliente de dos empresas con cada sesión en la suya, revocar en A no saca
        de B, cuenta desactivada) + verificación en vivo del ataque completo:
        el enlace para el superadmin rebota 403, la sesión robada ANTES del fix
        recibe `reauth_required`, el login real entra, y una sesión de portal
        contra la API de la app responde `portal_session_scope` — 788 API en
        verde.

  - [x] **Release de seguridad II: ACL por lista en todas las lecturas,
        cuentas y SMTP de las empresas (v0.1.226, segunda tanda de la
        auditoría)**: (a) **SEC-25 — el ACL por lista se salteaba por los
        costados**. El listado de registros respetaba el scope del rol ("sólo
        lo suyo") y los campos ocultos, pero casi todo lo demás leía la lista
        ENTERA: un agente agrupaba por un campo oculto (`POST
        /lists/:l/aggregate`) y los NOMBRES de los grupos eran los valores
        ocultos de todos los registros; una suma daba el total de la lista; el
        autocompletado de filtros devolvía todos los valores con su
        frecuencia; la actividad traía el diff de TODOS los registros (el alta
        guarda todos sus valores); el export JSON mandaba todo, `settings`
        incluidos; y filtrar/ordenar/buscar por un campo oculto funcionaba
        como oráculo aunque la respuesta lo quitara. Ahora el motor de
        agregados recibe a quien pregunta (`viewer`: scope + campos ocultos
        fuera de métrica, agrupación y filtro) desde el pie, la vista
        agrupada, los tableros (y la tabla del widget sin columnas ocultas) y
        el asistente; `distinctValues`, la actividad (sólo sus registros, diff
        sin claves ocultas) y el listado/edición en lote lo aplican también; el
        export JSON pasa a `manage_lists` (el resto exporta CSV, que ya
        respetaba el ACL). Además: **archivos** — los ids son secuenciales y un
        agente bajaba y BORRABA adjuntos ajenos (y el logo) recorriéndolos;
        quien ve sólo lo suyo baja lo que subió o lo de sus registros, y borrar
        uno ajeno exige `edit_records`; **CSV** neutraliza fórmulas (`=`, `+`,
        `-`, `@`… sin tocar números ni teléfonos); `/bootstrap` ya no manda los
        `settings` crudos de la empresa (config SMTP, clave de IA cifrada) a
        todo miembro; el **MCP** respeta el solo-lectura por impago (ADR-S09:
        el token vale como `read`); el **realtime** no acepta al rol `client`
        ni sesiones del portal; la **vista pública** que no se puede aplicar
        (borrada, filtro roto, condición sobre lookup/rollup) no muestra NADA
        en vez de la lista entera; y `/metrics` en producción sin
        `METRICS_TOKEN` responde 403. (b) **SEC-26 — cuentas**: un código TOTP
        vale UNA vez (antes ~90 s), tope de 10 fallos de 2FA por USUARIO (el de
        5 era por desafío y cada login con la contraseña correcta emitía otro),
        códigos de respaldo consumidos con UPDATE condicional (dos requests en
        paralelo usaban el mismo), reset de contraseña con `GETDEL` que además
        revoca los TOKENS de acceso (un token del MCP creado con la sesión
        robada sobrevivía a la recuperación), el índice de sesiones de un
        usuario ya no se acorta (la impersonación lo bajaba a 1 h y "cerrar
        todas"/reset/desactivar dejaban sesiones vivas) y freno por cuenta a
        los correos de reset y de verificación. (c) **SEC-27 — SMTP de las
        empresas**: podía apuntar a `127.0.0.1:25` (relay sin auth por el MTA
        local → spam desde la IP de la plataforma) y el botón Diagnosticar
        escaneaba puertos de la red interna con banner. Ahora sólo servidores
        públicos (`resolvePublicHost`, el mismo criterio del guard SSRF),
        validado al guardar y FIJADO a la IP al enviar (TLS contra el nombre);
        `SMTP_ALLOW_PRIVATE_HOSTS=true` para un relay interno a propósito.
        (d) Deploy: HSTS en nginx, `connect-src 'self'` en los dos proxies y
        el `.env` de ejemplo con los secretos obligatorios y las variables
        nuevas. Tests: ACL (agregados, autocompletado, filtros/orden,
        actividad), archivos, 2FA (reuso y bloqueo por usuario), reset (tokens
        revocados, un solo uso), SMTP (host interno rechazado, diagnóstico sin
        red interna), CSV, MCP en solo-lectura y vista pública fail-closed —
        804 API en verde. **Quedan para la próxima tanda**: PayPal (el plan se
        activa al APROBAR el pago y nunca se captura), la importación de una
        empresa (symlinks del tar y usuarios con hash elegido), la
        verificación de propiedad de los dominios propios, integridad de
        automatizaciones/IA (lista destino, límite del plan, doble aplicación),
        cuota de correo por destinatario, límite por token del webhook
        entrante, y endurecimientos de despliegue (rol de Postgres no
        superusuario, firma de los releases, CSP sin `unsafe-inline`).

  - [x] **Seguridad sin tocar el servidor (v0.1.227, pregunta del usuario:
        "¿no lo podés ajustar vos para no tener que entrar a la consola?")**:
        de los tres pasos manuales que dejó v0.1.226, dos eran cosas del PROXY
        (cabeceras en nginx/Caddy) que la auto-actualización no puede tocar —
        la config es de root— y en ServerAvatar, donde sólo se pegan los
        `location`, nunca habían llegado. Ahora viajan en la app: (a) **HSTS
        desde el API** (hook `onSend`, sólo en producción y sobre HTTPS —sin `includeSubDomains`: si la app vive en el dominio raíz forzaría HTTPS en todos los subdominios del operador— según
        el `X-Forwarded-Proto` del proxy de confianza; el navegador lo guarda
        para todo el host sin importar qué respuesta lo trajo, y la SPA pide
        al API apenas carga); (b) **CSP en un `<meta>`** inyectado en el build
        de los DOS SPA (plugin `cspMeta` de vite, sólo en build; `frame-src`
        sale de `EMBED_FRAME_HOSTS` de shared; `img-src https:` porque los
        bloques de imagen del page-builder aceptan URLs externas); (c)
        **anti-encuadre en el cliente** (`lib/frameGuard.ts`): `frame-ancestors`
        no se puede poner en un `<meta>`, así que encuadrada por OTRO origen la
        app no se monta y ofrece abrirse en su pestaña (el mismo origen sí
        puede, como `SAMEORIGIN`). El tercer paso no era de consola: la
        re-autenticación de la consola de Plataforma ya cerraba la sesión y
        volvía al login sola, y `METRICS_TOKEN` es opcional (sólo si hay un
        scraper; la app no lo usa). **Encontrado en la verificación**: el
        superadmin de desarrollo había quedado SÓLO con el acceso de portal que
        le creó la reproducción del ataque de SEC-24, y la app abría esa
        empresa con todo en 403 (el TenantGuard rechaza al rol client). Los
        accesos de portal ya no se listan como workspaces de la app de equipo,
        y una cuenta sin ninguna empresa ve una pantalla que lo explica (con
        el enlace al portal y "Cerrar sesión") en vez de una ruedita girando
        para siempre. Runbooks: las cabeceras del proxy pasan a recomendadas,
        no obligatorias. 4 tests del guard de encuadre + 1 de memberships sin
        portal + E2E navegador 12/12 contra el BUILD DE PRODUCCIÓN con el API en
        `NODE_ENV=production` (CSP en el HTML, login, tabla de 700 filas,
        WebSocket del realtime abierto, cero violaciones de CSP ni errores de
        JS en app y portal, encuadre del mismo origen permitido, encuadre desde
        otro sitio bloqueado en app y portal) y HSTS por curl (sale con
        `X-Forwarded-Proto: https`, no sale por HTTP).

  - [x] **Release de seguridad III: pagos, importaciones, automatizaciones/IA,
        dominios y OAuth (v0.1.228, tercera tanda de la auditoría)**: cada
        hallazgo verificado en el código antes de tocarlo.
        (a) **SEC-29 — PayPal activaba el plan sin cobrar**: con `intent:
        CAPTURE` una orden APROBADA todavía no mueve plata; el webhook
        `CHECKOUT.ORDER.APPROVED` activaba el plan y nadie capturaba nunca la
        orden. Ahora la aprobación dispara la CAPTURA (idempotente con
        `PayPal-Request-Id`, y si otro reintento ya la capturó se consulta la
        orden) y el plan se activa sólo con `COMPLETED`; una captura PENDING
        tampoco activa. El runbook marca ese evento como obligatorio.
        (b) **SEC-30 — importaciones**: un archivo de empresa armado a mano
        podía traer un **symlink** (`files/x → .env`) y el import lo seguía al
        leer los bytes del adjunto — un archivo del SERVIDOR quedaba como
        adjunto descargable. Ahora lo extraído se recorre con `lstat` y
        cualquier cosa que no sea carpeta o archivo común rechaza el archivo.
        Y las cuentas **nuevas** heredaban del archivo la contraseña (hash), el
        email verificado y el 2FA: quien arma el archivo elegía la contraseña
        de un email ajeno que todavía no existía acá — y cuando otra empresa
        invitaba a esa persona, la invitación caía en su cuenta. Por defecto
        nacen sin contraseña utilizable ni verificación (entran por "olvidé mi
        contraseña"); el operador puede marcar en la consola que el archivo
        viene de un servidor de confianza. El **import CSV** ahora respeta el
        "puede crear" de la lista, ignora con aviso las columnas mapeadas a
        campos ocultos para ese rol, y crear campos u OPCIONES exige
        `manage_fields` (un manager tenía `import_records` y con eso tocaba el
        esquema); el diálogo ya no ofrece "Crear campo nuevo" a quien no puede.
        (c) **SEC-31 — automatizaciones e IA**: "crear registro" aceptaba el id
        de una lista de OTRA empresa (`records.list_id` referencia la tabla
        compartida sin mirar el tenant) — ahora la lista destino se busca en la
        empresa y si no está el run falla con el motivo. El **límite de
        registros del plan** se mudó a `RecordsService.create`: el asistente
        IA/MCP, "actualizar desde archivo", las automatizaciones y los clones
        de recurrencias creaban sin tope. Aplicar una **propuesta de IA** dos
        veces en paralelo la ejecutaba dos veces (candado `SET NX` + relectura
        adentro). `propose_set_list_permissions` REEMPLAZABA el mapa de accesos
        por persona: "dale acceso a Ana" le sacaba el acceso a todos los demás
        — ahora `users` agrega/cambia, `remove_users` quita, y se mezcla contra
        lo guardado al aplicar. Una automatización se lee/cambia/borra sólo
        desde SU lista. Y las **recurrencias** sólo miraban la capability: un
        agente (`edit_own_records`) programaba cambios o clones sobre registros
        ajenos — ahora poner/ver/quitar exige alcanzar la fila con el ACL.
        (d) **SEC-32 — dominios y OAuth**: un dominio propio quedaba activo
        apenas se escribía, y como es único cualquier empresa podía "reservar"
        el dominio de otra. Ahora pedirlo lo deja PENDIENTE
        (`settings.domain_claim`, con un código por empresa) y se activa recién
        cuando aparece el TXT `_imagina-verify.<dominio>`; si otra empresa lo
        tenía, pasa a quien probó ser dueño del DNS. Los dominios ya
        configurados se conservan. Card de Ajustes → Marca en dos pasos
        (verificar propiedad + apuntar). En el **OAuth del MCP**, `authorize`
        redirigía SOLO con un error a la redirect_uri del cliente — con
        registro abierto (DCR), un open redirect con nuestro dominio adelante;
        ahora el error se muestra en texto y al cliente sólo se vuelve tras
        Autorizar/Cancelar. La pantalla "Autorizar" **advierte** cuando el
        destino no es Claude (claude.ai/claude.com) ni esta computadora
        (loopback): el nombre del cliente lo elige quien lo registra, el
        destino es lo que identifica a quién se le da el acceso.
        (e) De paso: el mensaje del límite del plan decía "El import supera…"
        también fuera del import. Tests: PayPal (5), import de empresa
        (symlink, credenciales con y sin confianza), CSV (manager sin campos/
        opciones/ocultos/crear), automatizaciones (lista ajena, alcance por
        lista), IA (merge de accesos, doble aplicación en paralelo),
        recurrencias (agente sobre fila ajena), dominios (reescritos: pendiente
        → mismatch → verificado → transferencia) y OAuth (destinos conocidos) +
        E2E navegador 11/11 (dominio pendiente con su TXT, Caddy no emite
        certificado sin verificar, authorize con error → 400 sin redirect,
        advertencia en el consentimiento, casilla de confianza destildada).
        **Queda para la cuarta tanda**: cuota de correo por destinatario y
        remitente del SMTP de plataforma, escape HTML de Gmail/Outlook, límite
        por token del webhook entrante y solo-lectura, desconectar el realtime
        al revocar, CSRF de login, límites por cuenta en cambio de contraseña/
        borrado/2FA, `portal/request-access`, fuga por relation/lookup, y
        endurecimientos de despliegue (lista blanca del `.env` en el restore,
        firma de releases, rol de Postgres no superusuario, CSP sin
        `unsafe-inline`).

  - [x] **Tableros: campos calculados que se suman + un widget roto no tumba
        al resto (v0.1.229, reporte del usuario con captura: "dañaste los
        dashboards, todo sale en Error")**: no era una regresión de los
        releases de seguridad. El tablero «Inventario de fajas» (armado por el
        asistente) sumaba «Valor en inventario», un campo **calculado** (stock
        × costo), y el motor de agregados no sabía sumar calculados — se
        confirmó contra la instancia del usuario por el MCP («sum sólo aplica a
        campos numéricos»). Y como el bundle del tablero evaluaba todos los
        widgets con un `Promise.all`, ese único widget tumbaba a los diez.
        Arreglos: (a) **los calculados aritméticos se traducen a SQL**
        (`records/computed-sql.ts`: sum, product, subtract, divide, abs, con la
        misma semántica de vacíos que el evaluador de shared, encadenables y
        con rollups numéricos como entrada) → se **suman, promedian, filtran,
        ordenan y agrupan** en widgets, pie, listado y edición masiva, igual
        que un rollup; los de fecha y `concat` siguen sin sumarse, con el
        motivo; (b) la expresión se arma sobre los campos YA recortados por el
        ACL: si una entrada del cálculo está oculta para el rol, el calculado
        no se agrega ni filtra (sería un oráculo); (c) **cada widget se evalúa
        aislado**: uno mal configurado devuelve `{ __error }` y SÓLO ese
        widget muestra «No se pudo calcular» con el motivo a la vista (antes
        todos decían «Error» y el mensaje estaba escondido en un tooltip); los
        errores internos se loguean y salen genéricos; (d) el diálogo del
        widget ofrece los calculados numéricos como métrica sumable, y el
        asistente/MCP ya no propone sumar un calculado de fecha o texto.
        6 tests de integración (paridad con el evaluador JS incluida la fila
        sin costo, filtro, agrupado, orden, entrada oculta, bundle aislado) + 1
        del front + E2E navegador 9/9 con un tablero como el del reporte (KPI
        24.400 sumando el calculado, el widget roto con su motivo y el resto
        intacto, barras por proveedor, tabla ordenada por el calculado).

  - [x] **Ficha del registro rediseñada — fase A: modelo v3, formas por tipo y
        datos vinculados (v0.1.230, ADR-S26, pedido del usuario: "los diseños
        que se hacen con el editor son muy básicos… reconstruilo")**. Primera
        de tres entregas (B: editor nuevo; C: portal del cliente + asistente).
        (a) **Modelo v3** (`settings.record_layout_v3`, shared): páginas
        (pestañas) → secciones con columnas que suman 12 → una pila de bloques
        por columna, todo referenciado por ID; validado en el servidor al
        guardar. 20 tipos de bloque: campo, propiedades, etapas, descripción,
        archivos, resumen, **vinculados**, **gráfico**, comentarios, actividad,
        título, texto, aviso, imagen, galería, botón, insertado, divisor,
        espacio y acceso al portal. (b) **Formas de mostrar cada tipo**
        (`FIELD_DISPLAYS`): un porcentaje como barra, anillo o medidor; una
        fecha como relativa, cuenta regresiva o hoja de calendario; un importe
        como cifra grande o barra hacia una meta; un select como etapas… y una
        forma que el tipo no admite cae a la de siempre. (c) **Gráficos de los
        registros VINCULADOS**: `POST /lists/:l/records/:id/layout-data`
        calcula en UN request los gráficos y tablas de la ficha acotados a lo
        vinculado a ESE registro, en los dos sentidos de la relación
        (`relatedScopeSql`, ahora en el motor de agregados y en el listado),
        con el ACL de quien mira y cada bloque aislado; los dibujan los MISMOS
        componentes de los tableros (`WidgetDataOverrideContext` les inyecta
        los datos; el renderer se extrajo a `WidgetRenderer.tsx`). Los
        vinculados se ven como tabla, lista, tarjetas, tablero por estado,
        línea de tiempo o galería, con "Agregar" que nace vinculado. (d) **La
        ficha nueva** (`RecordLayoutView`, reemplaza a `RecordCrmLayout`):
        portada con el acento, avatar, título editable, línea de contexto,
        propiedades clave como chips editables, **etapas clickeables**,
        pestañas en la URL (`?tab=`), secciones que se apilan en el celular,
        5 temas (default/minimal/corporate/fresh/warm) y **guardado automático
        campo por campo** (sin botón; un cambio pendiente no lo pisa la
        respuesta del servidor). (e) **Nadie pierde su diseño**: sin v3
        guardada, la plantilla v2 elegida (personalizada o integrada) se
        CONVIERTE al vuelo (`migrateCrmV2ToV3`) y la "Automática" pasa a ser
        un generador nuevo (`autoRecordLayout`): cifras destacadas, detalles y
        una pestaña por cada lista vinculada con total, suma, dona por estado,
        evolución mensual y la tabla. Tests: 5 de shared (conversión, ficha
        automática, validación) + 3 del front + 5 de integración del endpoint
        (dos sentidos, orden/total, bloques aislados, campos ocultos del rol,
        registro base fuera de alcance, validación al guardar) + E2E navegador
        22/22 (cabecera, etapas que guardan, edición que guarda sola, pestaña
        de facturas con KPIs/dona/área/tabla, plantilla v3 guardada con cuenta
        regresiva/medidor/aviso/tablero/tarjetas/barras, integrada convertida,
        modo oscuro y celular sin desborde).

  - [x] **Ficha del registro rediseñada — fase B: el editor nuevo (v0.1.231,
        ADR-S26)**: el editor de la ficha (`Diseñar ficha`) se rehízo sobre el
        modelo v3 y reemplaza al editor por grid v2 (el del portal sigue en el
        shell viejo hasta la fase C). Tres paneles: **biblioteca** a la
        izquierda (33 bloques en el vocabulario de quien diseña —"Dona",
        "Tablero por estado", "Un campo destacado"— con buscador; se arrastran al lienzo o se agregan
        con un clic debajo de lo elegido) y una pestaña **Estructura** (pestañas
        de la ficha: crear, renombrar, ordenar, borrar; y el esquema de la
        página para elegir cualquier pieza); en el centro **la ficha REAL** —los
        mismos componentes, los datos de un registro de verdad elegible desde la
        barra y los gráficos/vinculados calculados con la plantilla EN EDICIÓN,
        sin guardar—, con los controles del editor alrededor (etiqueta y barra
        por bloque: subir/bajar/duplicar/borrar; por sección: columnas en 7
        repartos, subir/bajar/duplicar/borrar; zonas de soltar entre bloques;
        "+ Bloque" por columna y "Agregar una sección" con miniaturas); a la
        derecha el **inspector** de lo elegido: por bloque, Datos y
        Visualización (un campo con sus formas por tipo, meta y prefijos;
        propiedades con orden, lista/grilla y plegado; gráficos con fuente
        —vinculados en cualquier sentido o la lista entera—, métrica, campo,
        agrupación, fechas y período, filtro con el mismo editor de la tabla,
        9 tipos en mosaico y extras por tipo; vinculados con 6 vistas, columnas,
        orden, límite, filtro y el campo de tablero/fecha/imagen; títulos,
        textos, avisos, botones, insertados, imagen, galería, espacio) + el
        panel **Diseño** compartido con los tableros; por sección, título,
        columnas y fondo; la **cabecera** (título, línea bajo el título, chips,
        etapas, portada degradé/color/imagen y avatar); y sin selección, el
        **tema** (5 estilos, acento, esquinas, aire, superficie).
        Deshacer/rehacer con historial (lo que se tipea se agrupa), atajos
        (Ctrl+Z/Shift+Z/S/D, Supr, Esc), **vista de celular** en un marco de
        390 px que se ve igual que el teléfono (las columnas, el `#id` y las
        fechas de la cabecera pasaron a container queries), editor a pantalla
        completa, guardado explícito con aviso al salir con cambios, y
        "Automático" para volver al diseño generado. Apariencia reconoce el
        diseño guardado ("Editar diseño"; elegir otra plantilla pide confirmar
        antes de descartarlo). Las operaciones son puras (`layoutOps`, con
        tests) y cada bloque del catálogo nace válido contra el schema (test).
        De paso: el encabezado "Actividad del registro" ya no se parte en tres
        renglones en columnas angostas. 9 tests del editor (front 195 en verde)
        + E2E navegador 30/30 (biblioteca por clic y por arrastre, dona con
        datos reales y título, columnas con deshacer/rehacer, tema, celular con
        columnas apiladas, Supr y deshacer, pestaña nueva vacía, aviso al
        salir, guardado → la ficha real lo muestra, Apariencia) y la ficha de
        la fase A sin regresiones (22/22); modo oscuro y teléfono revisados.

  - [x] **El asistente y el MCP diseñan la ficha v3 (v0.1.232, ADR-S26 fase
        C, primera mitad)**: con el editor nuevo, el diseño v3 guardado MANDA
        sobre la plantilla — y `propose_configure_record_layout` seguía
        escribiendo SÓLO el formato anterior (`crm_template_id` /
        `crm_template_custom`), así que en una lista con diseño propio lo que
        aplicaba el asistente no cambiaba nada. Ahora la herramienta habla v3:
        (a) **modo `design`** — la ficha completa en el vocabulario del modelo
        (pestañas → secciones con columnas → bloques por SLUG): un campo con la
        forma que mejor lo muestra (cifra grande, anillo, medidor, cuenta
        regresiva, etapas…; una forma que el tipo no admite se avisa),
        propiedades editables, etapas, archivos, actividad, títulos, textos,
        avisos, botones (destino `https:`/`mailto:`/`tel:` o un campo del
        registro), y **gráficos y tablas/tableros/tarjetas de los registros
        VINCULADOS** con `from` = slug de la lista vinculada (en cualquiera de
        los dos sentidos; `via` sólo si hay dos relaciones con la misma lista;
        `"all"` compara con toda la lista). `buildRecordLayoutV3`
        (`ai/tools/record-layout-design.ts`, PURO) valida cada slug contra los
        campos de la lista correcta, exige lo que cada gráfico necesita
        (`group_by` en barras/dona/embudo, `metric_field` en sumas), reparte
        las columnas en partes iguales si no se indica el ancho y devuelve
        EXACTAMENTE lo que guarda el editor visual — se sigue retocando ahí;
        (b) el `custom` del formato anterior se convierte a v3 al guardar
        (`migrateCrmV2ToV3`), y elegir una plantilla integrada **saca** el
        diseño v3 (si no, seguiría mandando); pisar un diseño hecho a mano se
        marca como destructivo en la tarjeta; (c) `get_list_schema` devuelve
        el diseño v3 resumido por pestaña y **`linked_lists`** — las listas
        vinculadas en los DOS sentidos, que es lo que el modelo necesita para
        `from` (antes sólo veía las relaciones propias); (d) la regla 12 del
        asistente explica cómo armar una buena ficha (lo más mirado arriba con
        una forma que lo luzca, una pestaña por lista vinculada con
        indicadores, un gráfico por estado y la tabla). De paso se descartó un
        supuesto hueco del relevamiento: `portal.me` NO filtra campos ocultos
        porque el rol `client` no tiene campos ocultos configurables — el
        portal muestra lo que diseña la empresa. 1 test de integración nuevo
        por el `Client` del SDK MCP (ficha de dos pestañas con KPI de suma
        sobre la relación inversa, tabla ordenada, errores corregibles: lista
        no vinculada, dona sin `group_by`, campo inexistente; volver a una
        integrada borra el v3) + 3 unitarios del constructor (columnas,
        forma no admitida, `via` obligatorio con dos relaciones, botón
        `javascript:` rechazado) + el test del `custom` actualizado — 833 API
        en verde — + E2E por el MCP REAL 12/12 (HTTP + token: esquema con las
        vinculadas, proponer → aplicar, la ficha muestra cifra grande, cuenta
        regresiva, aviso y etapas; la pestaña Facturación suma 9.350.000, la
        dona y el tablero por estado; el editor abre el diseño propuesto).

  - [x] **El portal del cliente en v3 (v0.1.233, ADR-S26 fase C, segunda
        mitad — cierra el rediseño de la ficha y del portal)**: el portal usa el
        MISMO modelo y la MISMA vista que la ficha del equipo — pestañas,
        secciones con columnas, cada campo con la forma que le corresponde,
        gráficos y tablas de lo vinculado al cliente — y se diseña con el MISMO
        editor. (a) **Nadie pierde su portal**: `settings.portal_layout_v3`
        manda; si no hay, la plantilla anterior se convierte al leerla
        (`migratePortalTemplateToV3`, shared: portada→título con fondo, datos y
        formulario editable→propiedades, tabla de otra lista→vinculados por la
        relación que la une al cliente, cifras de un grid→columnas, preguntas/
        contacto→texto, enlaces→botones, la página con su fondo/ancho/
        tipografía) y si tampoco, un portal automático de sólo lectura. El
        servidor decide cuál vale (`resolveLayout`) y lo usan los tres caminos:
        lo que ve el cliente, lo que abre el editor (`GET /lists/:l/portal/
        layout`) y la whitelist de edición. (b) **Qué edita el cliente**: sólo
        los campos de los bloques marcados «El cliente puede editarlo» y de
        tipos escribibles (`portalEditableFieldIds`) — el `PATCH /portal/me`
        usa esa función como whitelist (sin bloques editables, nadie edita); lo
        demás se ve como dato, sin candados; se guarda solo, como la ficha.
        (c) **Datos acotados al cliente, no a un rol**: los gráficos y tablas
        salen del mismo motor de la ficha (`RecordLayoutDataService.portal`),
        pero el alcance lo pone la FUENTE — una relación lleva a lo vinculado a
        su registro; «toda la lista» no existe: se vuelve su relación hacia la
        lista del portal o su campo persona = él, y sin vínculo el bloque falla
        cerrado. A una tabla sólo viajan las columnas del bloque y el título (la
        columna interna de costos de esa lista no sale del servidor), sin
        relaciones ni personas, y los archivos como URLs firmadas. (d) **Un
        request**: `GET /portal/me` trae diseño + datos + las definiciones de
        los campos que usan, y el portal siembra el cache — los componentes de
        los tableros pintan colores y etiquetas sin tocar la API del equipo (el
        E2E lo verifica: cero llamadas a `/api/v1/lists`). (e) **Editor**:
        `target: 'portal'` — biblioteca sin descripción/resumen interno/acceso
        al portal, interruptor «El cliente puede editarlo», fuentes «lo suyo en
        otra lista (por persona)», ajustes de PÁGINA (fondo, ancho, tipografía),
        cabecera que se puede ocultar, y vista previa con el alcance del cliente
        del registro elegido (`POST /lists/:l/portal/layout-data`); «Automático»
        vuelve al portal de sólo lectura. Se borró el editor anterior del
        portal, su renderer y 16 bloques viejos (sólo quedan comentarios y
        actividad, que el portal sigue usando). (f) **Asistente/MCP**:
        `propose_configure_portal` gana `design` (el vocabulario de la ficha +
        `editable` + `page`) y escribe `portal_layout_v3`; el vocabulario
        anterior se acepta y se convierte; `get_list_schema` describe el diseño.
        De paso: el canje del enlace del portal corría dos veces en StrictMode
        (el segundo daba 404). Tests: 4 unitarios en shared (conversión,
        editables, automático) + 4 de integración del portal (conversión con
        datos acotados y columnas recortadas, v3 que manda con fuentes que
        fallan cerrado y whitelist nueva, lista por campo persona y vista
        previa, diseño inválido) + 1 del MCP con `design` + 2 del front —
        shared 105, front 197 en verde — y E2E navegador 23/23 (portal
        convertido, sólo sus cuotas, sin la columna interna, el cliente corrige
        su email, el editor abre convertido, guarda un indicador que suma SÓLO
        lo suyo, el cliente lo ve, celular sin desborde) + regresiones de la
        ficha 22/22, del editor 30/30 y del MCP 12/12.

        **Con esto la fase C de ADR-S26 queda completa: la ficha y el portal
        del cliente comparten modelo, vista y editor.**

  - [x] **Ficha: composición, columnas y bloques rehechos (v0.1.234, reporte
        del usuario con captura: "se ve como una app a medio camino")**. La
        captura era la plantilla integrada «Soporte» convertida de su grilla
        v2 (3 · 6 · 3 con la actividad al medio) y además ESCONDÍA datos: en
        las columnas de 3/12 la etiqueta fija de 200px dejaba al valor sin
        lugar — «Vencimiento» y «Detalle» tenían dato y no se veían.
        (a) **Composición**: las integradas (contacto, negocio, tarea,
        soporte) ya no se convierten de la grilla vieja; son variantes
        (`flavor`) del generador automático que sólo cambian el ORDEN de los
        grupos (los nombres son neutros: «Ticket» no tiene sentido en una
        lista de clientes). El generador pone el dinero primero en las
        cifras, sube etiquetas a la cabecera, junta las fechas con el resto
        si son pocas (varias tarjetas de 1-2 campos fragmentaban la ficha),
        reconoce WhatsApp/teléfono como contacto y ya no agrega el
        «Resumen» de contadores. `custom` sigue convirtiéndose igual.
        (b) **Reparto de columnas al dibujar** (`planSection`, puro, con
        tests): una columna vacía cede su ancho; si alguna quedaría más
        angosta de lo que necesita su contenido, la sección pasa a "de a dos"
        (cifras), a "principal + lateral" 8 · 4 (un 3 · 6 · 3 deja la columna
        ancha a la izquierda y junta las demás a la derecha) o se apila. El
        diseño guardado no se toca. (c) **Propiedades**: la fila se acomoda
        al ancho de su TARJETA (container queries): lado a lado con lugar,
        etiqueta arriba en una columna angosta; selects, persona y relación
        planos (sin caja); el texto largo se lee entero; las fechas no se
        parten en dos renglones. (d) **Cabecera**: portada más baja y suave,
        avatar montado sobre ella, línea de contacto con iconos, y las
        propiedades clave como "etiqueta arriba, valor abajo" (antes,
        cajitas con borde), con «Agregar» en las vacías. (e) **Actividad**
        reescrita (`ActivityFeed`): composer plegado en una línea que se abre
        al escribir, hilo por día ("Hoy", "Ayer"), las ediciones seguidas de
        una persona en UNA entrada ("cambió Status: activo → sin factura"),
        8 entradas y «Ver más» (antes se estiraba hasta el final de la
        página). (f) **Resumen** sin cajas dentro de la caja: una fila de
        cifras ("Hace 3 días", "Hoy"). (g) Marco de bloque coherente: título
        con icono, márgenes iguales, la cifra destacada con la etiqueta chica
        adentro. **Bug real de paso**: los comentarios desde la ficha y el
        panel lateral nunca funcionaron en la nube — el front mandaba
        `content` y el API espera `body` (400 "body Required"), y los que
        existían se veían SIN texto (el arreglo de v0.1.77 sólo evitaba el
        crash). Traducción en `useComments` (un solo lugar para todas las
        pantallas), con test. Se borraron `RecordTimeline` y `RightRail`
        (sin uso). Tests: 5 de `planSection`, 3 del feed, 2 de comentarios,
        1 de shared (variantes) — 207 front, 106 shared en verde — + E2E
        navegador 21/21 sobre una réplica de la lista del usuario (valores
        visibles, ninguna fila aplastada, edición de cabecera/etapas/
        propiedades que se guarda sola, feed con «Ver más», comentar con
        nombre, celular) y regresiones de ficha 22/22, editor 30/30 y portal
        23/23.

  - [x] **Las plantillas de la ficha vuelven a ser distintas (v0.1.235,
        reporte del usuario: "le doy de una a otra y sigue saliendo la
        misma")**: regresión de v0.1.234 — al pasar las integradas a
        variantes del generador automático que sólo cambiaban el ORDEN de
        los grupos, las cinco quedaron casi iguales y elegir otra en
        Apariencia no cambiaba nada visible (el guardado sí funcionaba).
        Ahora cada una es una composición propia con su estilo:
        **Automática** (cifras arriba, detalles + lateral), **Contacto**
        (sin cifras: datos de la persona en una columna a la izquierda y
        notas + conversación a la derecha; verde, el email primero bajo el
        título), **Venta / Oportunidad** (el monto en grande, el vencimiento
        como cuenta regresiva y «Fechas clave» al costado; azul corporativo
        con bordes), **Tarea** (plana, sin portada ni avatar, el responsable
        como primer chip y la entrega contando los días arriba del lateral)
        y **Soporte** (la conversación primero y el cliente y el detalle al
        costado; naranja). Siguen armándose solas con los campos y
        relaciones de cada lista, y el editor arranca desde la elegida.
        Apariencia muestra una **miniatura** de cada composición en su
        color y una línea que dice en qué se diferencia. 1 test de shared
        reescrito (cinco firmas de secciones y cinco temas distintos, lo
        propio de cada una) — 106 shared y 207 front en verde — + E2E
        navegador 5/5 cambiando de plantilla DESDE Apariencia (cinco fichas
        distintas, tarea sin portada, soporte con la actividad primero, cero
        errores) y regresiones de la ficha 21/21 y 22/22, editor 30/30 y
        portal 23/23.

  - [x] **Cada plantilla de la ficha es una ficha distinta, pensada para
        su caso (v0.1.236, feedback del usuario: "se ven muy básicas, casi
        iguales; lo único llamativo es el bloque principal")**: la v0.1.235
        cambió el orden y el color pero las cinco seguían siendo la misma
        pila de tarjetas blancas con propiedades. Ahora cada una usa los
        bloques y las formas por tipo que ya existían y nadie aprovechaba:
        **Resumen** (banda de indicadores con la forma que luce cada número
        —cifra grande, anillo, estrellas, cuenta regresiva— y un adelanto de
        lo vinculado: dona por estado + los últimos), **Perfil** (contacto:
        botones de escribir/llamar/abrir a lo ancho de la columna de la
        persona, sus datos y fechas, y lo que tiene con la empresa como
        TARJETAS, notas como cita y la conversación), **Oportunidad** (banda
        con el valor del negocio en grande y el cierre que cuenta los días,
        portada sólida, seguimiento en dos columnas, fechas como hoja de
        calendario, lo vinculado como TABLERO por estado y el historial a lo
        ancho), **Tarea** (plana como Linear: la conversación debajo del
        trabajo, la entrega y el avance como barra en el panel lateral) y
        **Ticket** (franja de SLA gris con prioridad/vencimiento/estado, lo
        que reportó como cita, la conversación protagonista y el historial
        del cliente). Cada una con su nombre de pestaña. Renderer: secciones
        con **banda** (`style.tone`: color de la ficha o gris, mezclados con
        transparencia → se ven bien en claro y en oscuro; un hex claro fijo
        encendería la ficha en oscuro), elegible en el editor junto al
        fondo; los botones de acción sin dato no se dibujan ni dejan hueco.
        Apariencia: miniaturas nuevas que dibujan la composición real (banda,
        tarjetas, tablero, panel) y una línea por plantilla. Los textos
        largos siguen editables en el lugar en Resumen y Tarea (la primera
        versión los había pasado a cita y lo atrapó la regresión de la
        ficha). 1 test de shared reescrito (cinco fichas distintas con lo
        propio de cada una) — 106 shared y 207 front en verde — + E2E
        navegador 5/5 cambiando desde Apariencia y regresiones de la ficha
        21/21 y 22/22, editor 30/30 y portal 23/23; revisado en claro,
        oscuro y celular.

  - [x] **Plantillas del portal del cliente (v0.1.237, pedido del usuario:
        "hacé las plantillas para portal cliente")**: las cinco de la ficha
        están pensadas para el equipo; el portal ahora tiene su propia
        galería, pensada para el CLIENTE (`portal-templates.ts` en shared):
        **Mi cuenta** (sus cifras y cuántos registros tiene en cada lista en
        una banda, lo que tiene con la empresa como tarjetas a lo ancho, sus
        datos de contacto —los únicos editables— y «Escribinos»), **Estado
        de cuenta** (saldo pendiente / pagado / facturado filtrando por las
        opciones del estado que suenan a pendiente o pagado, cuenta regresiva
        al próximo vencimiento, dona por estado, barras por mes y la tabla de
        facturas con su comprobante), **Seguimiento de proyecto** (etapas de
        sólo lectura en la cabecera, avance en anillo, entrega contando los
        días y el trabajo como tablero por estado), **Mis solicitudes**
        (abiertas = no cerradas / resueltas / total en una franja gris y los
        casos por estado; si el registro ES el caso, su prioridad, estado y
        plazo) y **Mi pedido** (estado como etapas, total, entrega estimada y
        lo que pidió con cantidades; o, si el registro es el cliente, sus
        pedidos). Todas usan el color de la MARCA de la empresa (no fijan
        acento) y se distinguen por composición y superficie. Reglas por
        construcción: nada de personas, relaciones, calculados ni campos que
        suenan internos (costo, margen, comisión, interno…), ni del registro
        ni como columna de otra lista. **Galería** en el editor del portal
        (botón «Plantillas», y «Elegir plantilla» en Compartir → Portal que
        la abre sola): miniatura por plantilla, qué incluye, y **qué listas
        vinculadas ve el cliente con una casilla por lista** y las columnas
        que va a ver; de entrada se marca sólo la que cumple el papel de la
        plantilla (unas facturas no son "solicitudes"; pedidos y líneas se
        reconocen por el nombre), y si a la lista le falta algo la plantilla
        lo dice y no se aplica. Aplicar arma el diseño en el editor (Ctrl+Z
        lo deshace; se guarda con Guardar). **El portal automático** deja de
        ser una tarjeta con todos los campos: es «Mi cuenta» de sólo lectura,
        sin canal de mensajes y con las listas que el admin ya habilitó en
        "Qué más ve el cliente" (fail-closed), resueltas en el servidor
        (`autoLinked`). 7 tests de shared + 1 de integración del portal (113
        shared, 207 front, 26 del portal en verde) + E2E navegador 29/29
        (automático con y sin listas habilitadas, galería desde Compartir,
        preselección, columnas sin el costo interno, estado de cuenta con el
        alcance del cliente —430.000 pendiente, sin la factura ajena—,
        deshacer, guardar, el cliente lo ve, celular sin desborde, las otras
        cuatro en el editor) y regresión del portal 23/23.

  - [x] **Correos de cuenta que llegan (o dicen por qué no) + login que no se
        cae (v0.1.238, reporte del usuario: "la verificación nunca llega, el
        login a veces da error interno y no sé si llegan los de
        recuperación")**: tres causas, todas reales.
        (a) **El API se caía**: el pool de Postgres no escuchaba `error`, y
        cuando la base corta una conexión ociosa (reinicio, idle timeout del
        proveedor, `pg_terminate_backend`) ese evento sin listener **mataba
        el proceso**; mientras systemd lo levantaba, el login daba "error
        interno" y había que reintentar. Reproducido con `pg_terminate_backend`
        y con `docker restart` de Postgres: antes el API moría, ahora sigue
        vivo y el login entra al toque. Pool con `keepAlive` y timeouts, y el
        login del front reintenta UNA vez solo ante un error transitorio (5xx
        genérico, 502 del proxy, `fetch` caído — nunca credenciales malas, el
        freno por intentos ni un 5xx con código propio).
        (b) **Correos de cuenta**: verificación, recuperación e invitaciones no
        son de ninguna empresa, así que sólo salen por el SMTP de Plataforma o
        el del `.env`; sin ninguno se iban al registro del servidor y la app
        decía "enviado". Ahora en producción responden **503 con el motivo**
        ("este servidor todavía no tiene un correo configurado…") y el panel
        Plataforma → Correo avisa qué depende de ese SMTP. **Bug de paso**:
        re-guardar el SMTP de Plataforma con la contraseña vacía (para cambiar
        el remitente) BORRABA la contraseña y el servidor dejaba de autenticar
        — ahora la conserva, como prometía el panel.
        (c) **"Confirmá tu correo" en toda la app**: la cuenta sin verificar
        sólo se avisaba en Ajustes → Seguridad, así que nadie se enteraba del
        enlace. Ahora hay un aviso bajo la barra superior con el email, qué
        hacer, **Reenviar** (si no se puede mandar, lo dice) y cerrar hasta la
        próxima sesión del navegador.
        (d) **Plataforma → Diagnóstico** (superadmin): estado del correo de
        cuenta, los últimos correos con su resultado (enviado / no enviado /
        fallido, por qué vía y el error del SMTP) y los últimos errores del
        servidor agrupados (pedidos, base de datos, proceso) — lo que antes
        exigía entrar a leer el journal. En Redis, 200 entradas, 14 días, sin
        query strings (pueden traer tokens). 5 tests de API (contraseña
        conservada, 503 en producción sin SMTP, SMTP del `.env` y desarrollo,
        registro de enviados/no enviados/fallidos, errores sin query string) +
        3 del front (reintento) + E2E navegador 9/9 (500 en el login absorbido
        por el reintento, avisos, diagnóstico con el correo de recuperación y
        los cortes de Postgres) y 12/12 del aviso de verificación (alta →
        aviso → reenviar → cerrar → verificar con el enlace real → ya no
        aparece; celular).

  - [x] **Cuarta tanda de seguridad (v0.1.239)** — los pendientes que dejó
        v0.1.228, cada uno verificado en el código antes de tocarlo:
        (a) **SEC-33 — correo**: la cuota mensual de correos contaba UN correo
        aunque llevara 25 en `to` + 25 en `cc` + 25 en `bcc` (la cuota del
        plan se multiplicaba por 75); ahora cuenta destinatarios distintos.
        Por el SMTP COMPARTIDO (el de la plataforma o el del `.env`) una
        empresa ya no elige la dirección remitente — una automatización
        mandaba "de" `soporte@banco.com` con la IP y la reputación del
        operador —: se conserva el nombre visible y su dirección pasa a
        `Reply-To` (las respuestas le siguen llegando); con SMTP propio manda
        la empresa. Y el cuerpo HTML de Gmail/Outlook (integraciones) metía
        los valores del registro SIN escapar — texto que puede escribir un
        cliente desde el portal o un formulario por webhook terminaba como
        enlaces/botones dentro de un correo legítimo de la empresa —: ahora se
        escapan igual que en `send_email`.
        (b) **SEC-34 — solo-lectura fuera del HTTP**: una empresa impaga o
        archivada seguía corriendo automatizaciones programadas, por fecha y
        por webhook entrante, y recurrencias (creando registros y mandando
        correos), porque el solo-lectura de ADR-S09 sólo lo aplicaba el guard
        de las peticiones de personas. Ahora el motor y las recurrencias lo
        chequean, y el webhook entrante responde 403. Además tiene **tope por
        token** (60 por minuto, 2.000 por hora, en Redis): el token vive en el
        HTML de un formulario público y el rate limit general es por IP.
        (c) **SEC-35 — sesiones y cuentas**: el realtime sólo miraba la sesión
        al CONECTAR — cerrar sesión, recuperar la contraseña, desactivar la
        cuenta o sacar a alguien de la empresa no cortaba su socket. Ahora se
        re-valida cada minuto (sin estirar la vida de la sesión). **Login
        CSRF**: un formulario oculto en otro sitio podía loguear a la víctima
        en la cuenta del ATACANTE (la cookie `SameSite=Lax` no lo impide);
        ahora todo pedido que cambia algo y viene de otro sitio se rechaza
        (Fetch Metadata / `Origin`), salvo lo público pensado para eso
        (webhooks entrantes, listas públicas, OAuth/MCP, pagos). **Freno por
        cuenta** a la contraseña que piden cambiar contraseña, desactivar 2FA
        y borrar la cuenta (con una sesión robada se podían probar sin
        límite). **Portal**: "pedir un enlace nuevo" respondía más lento sólo
        si el email era cliente de alguien (esperaba al SMTP) — ahora contesta
        al toque y envía después; y apagar el portal de una lista corta al
        instante a los clientes con sesión abierta (antes seguían 30 días).
        (d) **SEC-36 — permisos a través de relaciones**: un agente sin acceso
        a "Facturas" leía los montos por un lookup en "Clientes" y los sumaba
        con un rollup (y filtraba por ellos). Ahora un lookup/rollup hacia una
        lista que la persona no ve completa —o cuyo campo de origen le está
        oculto— cuenta como campo oculto: no viaja, no filtra, no ordena, no se
        agrega. Y un `computed` que usa un campo oculto se oculta también
        (`ganancia = precio − costo` despejaba el costo).
        (e) **SEC-37 — despliegue**: restaurar un snapshot ajeno ya no puede
        meter `NODE_OPTIONS`, `LD_PRELOAD`, proxies, etc. en el `.env` (se
        descartan avisando); el workflow de release **firma** el bundle con
        ed25519 cuando existe el secreto `RELEASE_SIGNING_KEY` (el servidor
        sabía verificar firmas desde SEC-12, pero nada las producía — pasos en
        `docs/runbook-updates.md`); y la CSP del SPA deja de permitir scripts
        inline: el build calcula el hash de cada uno (el pre-pintado del tema)
        y sólo esos corren.
        **Queda pendiente, a propósito**: rol de Postgres no superusuario para
        la conexión base (necesita `BYPASSRLS` y migrar cada instalación por
        consola) y `'unsafe-inline'` en `style-src` (React escribe `style=""`
        en cientos de nodos; un estilo no ejecuta código).
        Tests: 27 nuevos o extendidos (destinatarios y remitente, escape
        Gmail/Outlook, webhook en solo-lectura, sockets re-validados, CSRF,
        freno por cuenta, portal apagado y respuesta sin esperar al SMTP,
        lookup/rollup/computed ocultos, `.env` envenenado en un snapshot real,
        firma openssl ↔ verificador) + verificación en vivo en modo producción
        contra el build: CSRF por curl (form cross-site 403, Origin ajeno 403,
        mismo origen 200, sin Origin 200, webhook público 404 por token) y CSP
        con hash: login, listas, tabla, WebSocket y portal con cero violaciones.

  - [x] **Invitar al equipo por email + miembros desde la consola (v0.1.240,
        pregunta del usuario: "¿ya funciona asociar a alguien a una empresa?
        no veo dónde se añaden usuarios")**: funcionaba a medias. El admin de
        una empresa sólo podía sumar a quien YA tenía cuenta ("pedile que cree
        su cuenta primero") y si esa persona se registraba sola, el registro
        le armaba una empresa propia vacía; y en la consola los miembros de una
        empresa eran de sólo lectura. Ahora: (a) **invitar por email** — si la
        persona no tiene cuenta se crea (contraseña aleatoria + `users.
        invited_at`, migración 0057), queda ya dentro de la empresa con su rol
        y le llega un correo «Te invitaron a «Acme»» para definir su
        contraseña; el enlace dura **7 días** (no los 30 minutos del reset) y
        la pantalla dice «Definí tu contraseña». Definirla cierra la invitación
        y verifica el email (el enlace llegó a su casilla: sin el aviso de
        «Confirmá tu correo»). Si ya tenía cuenta, se suma al toque y se le
        avisa. Sin correo de cuenta en el servidor, se corta ANTES de crear la
        cuenta. (b) **Ajustes → Miembros**: formulario de invitación (email,
        nombre opcional, rol), «Invitación pendiente» con **Reenviar** (tope 3
        por hora), cambiar rol y quitar con confirmación; los clientes del
        portal salen de esta lista (se manejan desde la ficha). (c) **Límite de
        usuarios del plan** aplicado por primera vez (`max_users` existía desde
        F4 y nada lo usaba): el 4º en un trial rebota con el motivo; los
        clientes del portal no ocupan lugar, tampoco en el uso que muestran
        Ajustes y la consola. (d) **Consola → detalle de empresa**: invitar,
        cambiar rol, reenviar, quitar e impersonar desde la misma fila, con los
        mismos guard rails (no dejar a la empresa sin admin) y SIN el límite
        del plan (decide el operador); cada acción queda en la bitácora de la
        empresa con el operador como autor. (e) **Consola → Usuarios →
        Editar**: las empresas de esa persona con su rol (editable), quitarla
        de una y **«Agregar a una empresa»** con buscador; estado «Invitación
        pendiente» en la grilla y «Reenviar invitación» en su menú. Las piezas
        de la interfaz (`MemberControls`) son las mismas en Ajustes y en la
        consola. 14 tests de miembros (invitación, cuenta existente, reservados/
        desactivados/clientes, producción sin correo, límite del plan, reenvío
        con freno, rol y bajas) + 2 de la consola — 40 en esos dos specs — y
        E2E navegador 28/28 (invitar → pendiente → reenviar → la invitada
        define su contraseña y entra SÓLO a esa empresa, sin empresa propia;
        límite del plan; consola: invitar por encima del límite, rol, último
        admin protegido, sumar a otra empresa desde Usuarios, bitácora).

  - [x] **Portal: varios accesos por persona, selector de cuenta y empresa,
        aviso al dar acceso y equipo de otra empresa como cliente (v0.1.241,
        pregunta del usuario: "¿cómo se maneja si un usuario tiene acceso al
        portal desde varias listas o varios workspaces?" → "hazlos todos")**.
        (a) **Dar acceso a otro registro SUMA**: el vínculo era único por
        (persona, empresa) y un segundo acceso REEMPLAZABA el primero en
        silencio — el cliente dejaba de ver su ficha sin que nadie se
        enterara. Ahora es único por (persona, registro) (migración 0058) y
        antes de dar un acceso nuevo la ficha pregunta al servidor qué pasa con
        ese email EN ESTA EMPRESA (`GET /lists/:l/portal/access/check`, nunca
        mira otras): si ya tiene otros, un aviso dice cuáles y que SUMA; si es
        del equipo, no se da y se explica por qué. "Dar acceso a otra persona"
        en un registro que ya tiene una, y quitar acceso por registro (la
        membresía y las sesiones caen sólo cuando no le queda ninguno).
        (b) **Selector de cuenta en el portal**: menú arriba a la derecha con
        las cuentas de la persona (una por registro, agrupadas por empresa), la
        elegida viaja en `?cuenta=` (recargar la conserva) y en
        `X-Portal-Account` — el servidor la valida contra SUS vínculos en la
        empresa de la sesión; un id ajeno es 404. Más **Salir**.
        (c) **Empresas distintas sin otro email**: la sesión ve las cuentas de
        otras empresas sólo si la abrió un enlace que llegó ÚNICAMENTE a su
        correo (uno que se le devolvió a la empresa, jamás) y en un host de la
        plataforma (un dominio propio lo controla una empresa). Cambiar de
        empresa acuña un enlace de un solo uso de 2 min. Si la sesión no tiene
        ese permiso, "¿Sos cliente de otra empresa?" le manda a su correo el
        enlace de "todas mis cuentas". Pedir un enlace nuevo desde la pantalla
        de entrar manda UNO por empresa (antes, uno por vínculo).
        (d) **Equipo de una empresa, cliente de otra**: antes se rechazaba
        (`portal_email_not_client`, de cuando una sesión del portal valía como
        la cuenta entera). Ahora la sesión del portal tiene **cookie propia**
        (`imbase_portal`): abrir un portal ya no cierra la sesión de trabajo
        del mismo navegador, y `/portal/*` no acepta sesiones de contraseña ni
        de impersonación. Ser del equipo de LA MISMA empresa sigue rechazado
        (409 `portal_email_is_staff`). 6 tests de integración nuevos (33 en el
        spec del portal, incluido el guard con las dos cookies) + E2E navegador
        33/33 (aviso al segundo registro, el primero conservado, equipo
        rechazado, cookie propia sin cerrar la sesión del admin en el mismo
        navegador, menú con las dos cuentas y cambio con `?cuenta=`, empresa B
        con enlace sólo por correo, "todas mis cuentas" → las dos empresas
        agrupadas y cambio entre ellas, la dueña de B como cliente de A con su
        app intacta, quitar un acceso conserva el otro, salir, celular).

  - [x] **Automatizaciones: cada acción de conector se ve como ella misma
        (v0.1.242, reporte del usuario: "con el MCP a veces crea mal las
        automatizaciones: iba a cambiar un campo y aparece el conector de
        WhatsApp")**. Dos causas. (a) **Editor**: todas las acciones de un
        conector tienen el mismo tipo (`connector_action`) y el selector "Tipo
        de acción" usaba el TIPO como valor de cada opción (con claves de React
        repetidas), así que cualquier acción de conector —«Cambiar el estado de
        un pedido» de WooCommerce, por ejemplo— se mostraba como la primera del
        catálogo, «Enviar mensaje de WhatsApp»; el panel del lienzo hacía lo
        mismo con su título, y elegir otra acción de conector desde ese
        selector la dejaba SIN conexión. Ahora `ActionTypeSelect` (compartido
        por el flujo, el lienzo y las ramas si/sino) da una opción por acción
        de conector (`connector:<id>:<clave>`, agrupadas en «Apps
        conectadas»), elegirla conserva la conexión y la clave, y un tipo que
        el catálogo no conoce se muestra tal cual en vez de caer en la primera
        opción. (b) **Asistente/MCP**: la propuesta no validaba las acciones —un
        tipo inventado o un conector mal armado se guardaban y la tarjeta decía
        apenas «Conector: send_text». Ahora valida el tipo de cada acción
        (también dentro de un si/sino), que la conexión y la acción existan,
        los datos obligatorios y que no sobren; el error le dice al modelo
        cuáles hay y que cambiar un campo es `update_field`. La tarjeta muestra
        el nombre real («Enviar mensaje de WhatsApp (WhatsApp)»), y la
        descripción de la herramienta aclara que `connector_action` es sólo
        para un servicio externo pedido explícitamente. Renombrar o pausar una
        automatización cuya conexión ya no existe sigue funcionando. 1 test de
        integración (tipo inventado, conexión/acción inexistentes, datos de
        más y de menos, rama si/sino, tarjeta con el nombre real, renombrar sin
        conexión) + 4 unitarios del selector — 214 front en verde — + E2E
        navegador 10/10 (update_field, WooCommerce y WhatsApp se ven como
        ellos mismos, cambiar de acción de conector conserva la conexión y se
        guarda, el lienzo titula con la acción real).

  - [x] **Conector SQL Server / Azure SQL (v0.1.243, ADR-S27, pedido de un
        cliente: "guardar la conexión, ejecutar una consulta o procedimiento
        programado y cargar el resultado en una lista actualizando por NIT o
        número de factura en vez de duplicar")**. (a) **Integración por clave**
        en la galería (categoría «Bases de datos»): servidor (acepta
        `tcp:host,1433`, `host:puerto` y `host\INSTANCIA`), base, usuario,
        contraseña cifrada, puerto, cifrado y certificado. Conectar EJECUTA una
        verificación —si no conecta no se guarda, con el motivo traducido
        (usuario/contraseña, firewall de Azure, base inexistente, permiso,
        timeout, TLS)— y avisa si el usuario puede ESCRIBIR (se recomienda uno
        de sólo lectura). (b) **Sólo lectura por construcción**: toda consulta
        corre en una transacción que se deshace SIEMPRE; sólo servidores
        públicos (`SQL_ALLOW_PRIVATE_HOSTS` para la red interna). (c) **Varias
        sincronizaciones por conexión** (`sql_syncs`, migración 0059, RLS) desde
        el botón «Sincronizaciones» de la conexión: consulta o procedimiento con
        parámetros, «Probar» con vista previa (columnas, tipo SQL, 50 filas),
        lista destino, columna clave → campo (sugerida por nombre y SÓLO entre
        las que no se repiten en la muestra: en una tabla de facturas el NIT se
        repite por cliente y usarlo de clave fusionaría facturas), columna →
        campo existente o **campo nuevo con el tipo sugerido** (money→moneda,
        bit→sí/no, date→fecha…), y horario (cada 15 min a cada día, o diaria a
        una hora en una zona). (d) **Motor**: empareja por la clave normalizada
        (la misma de "actualizar desde un archivo"), actualiza SÓLO lo que
        cambió, crea lo nuevo (opcional), NULL vacía el campo (opcional), cada
        celda pasa por el mismo validador que el import, las fechas sin zona se
        leen en la zona elegida, `@ultima_sincronizacion` para traer sólo lo
        que cambió, 50.000 filas y 60 s (máx 300) por corrida. Lo que deja de
        aparecer no se toca, u opcionalmente se marca en «Está en SQL» (sólo con
        un resultado completo). La primera carga NO dispara automatizaciones;
        las siguientes sí, con antes y después, y dejan actividad. Respeta el
        límite de registros del plan y el solo-lectura por impago. Cola BullMQ
        propia con tick por minuto y candado por sincronización. Tarjeta con
        estado en vivo, resultado (leídas/creadas/actualizadas/sin cambios/ya
        no están), errores por fila, **Vista previa** de la próxima corrida sin
        escribir nada, Sincronizar ahora, Pausar y Borrar. Desconectar borra
        sus sincronizaciones (los registros quedan); migrar una empresa las
        lleva re-mapeadas. (e) De paso: los campos de las integraciones por
        clave ganan tipo sí/no y número. **Bug atrapado en el E2E**: tocar
        «Probar» y DESPUÉS elegir la lista vaciaba el mapeo y no se creaba
        ningún campo; ahora las sugerencias se recalculan al elegir la lista o
        cambiar la columna clave. Tests: 14 de integración del motor (Postgres
        + Redis reales y un runner SQL falso: crear/actualizar sin duplicar,
        sólo lo que cambió, NULL, «ya no está», primera carga sin
        automatizaciones, límite del plan, candado, tick, permisos, borrado de
        la conexión), 9 de valores/errores, 7 de shared y 6 del editor — E2E
        navegador 19/19 contra un driver simulado (conectar con contraseña mala
        y buena, error de sintaxis, vista previa, clave sugerida, campos
        creados con su tipo, segunda corrida con 1 nuevo/1 cambiado/1 marcado,
        vista previa sin escribir, celular). **Prueba contra un SQL Server 2022
        REAL** (driver `mssql` 12.7 + tedious, contenedor con una base de
        facturas, un usuario de sólo lectura y uno con escritura): 24/24 del
        runner (verificación y aviso de escritura, contraseña/base/certificado,
        money/bit/date/datetime2/NULL/ñ, procedimiento con `@desde` incremental,
        el INSERT dentro de la consulta deshecho, permiso denegado, tope de
        filas, timeout a los 2 s, varios resultados) y E2E navegador 23/23
        de punta a punta. Encontró tres cosas que el driver simulado no podía
        mostrar: (1) **una consulta con error COLGABA la sincronización** — el
        driver emite «error» y DESPUÉS «done», y deshacer la transacción en el
        medio deja al rollback esperando para siempre; ahora el error se
        informa en «done» y rollback/cierre llevan tope de tiempo (test de
        regresión que falla con el código anterior); (2) un certificado
        autofirmado se explicaba como «no se pudo conectar, revisá el
        firewall» — llega como ESOCKET y el caso TLS se evaluaba después;
        (3) **consulta incremental + «marcar lo que falta» marcaría como
        borrado todo lo que no cambió**: la combinación se rechaza con el
        motivo y el editor deshabilita la opción (`sqlSourceIsIncremental`
        en shared, que ignora comentarios — la consulta de ejemplo menciona
        el parámetro en uno).

  - [x] **Avisos de dependencias de producción a cero, otra vez (v0.1.244)**:
        `pnpm audit --prod` volvió a dar 8 avisos (4 high) publicados después
        de v0.1.202, todos en código que corre en el servidor o en el
        navegador. (a) **`nodemailer` 9.1.1 → 10.0.13** (major): el más
        relevante para nosotros es el de la **caché DNS global que reusaba el
        `servername` TLS entre transportes** — o sea, entre los SMTP propios
        de distintas EMPRESAS (fijamos el host a la IP y pasamos el
        `servername` por empresa desde SEC-27); más dos DoS por backtracking
        del parser de direcciones, uno por arrays anidados de destinatarios y
        un sobre mal formado con local-part entre comillas. El único cambio
        que rompe de la v10 es exigir Node ≥20 (usamos 22); trae sus propios
        tipos, compatibles con `@types/nodemailer`. (b) **`engine.io`
        6.6.9 → 6.6.11** (DoS por versión de protocolo del realtime): llega
        por `@nestjs/platform-socket.io`, que fija `socket.io` exacto, así que
        va por override. (c) **`@nestjs/*` 11.1.27 → 11.2.7** (el aviso es de
        `platform-fastify`: un request-target ABSOLUTO —`GET http://otro/…`—
        salteaba el middleware con path; se subieron los cinco paquetes juntos
        para no mezclar versiones). La 11.2 agregó un `logger` protegido a
        `IoAdapter`, que chocaba con el privado de nuestro `RedisIoAdapter`
        → renombrado a `redisLogger`. (d) **`dompurify` 3.4.15 → 3.4.16**
        (XSS con hooks `IN_PLACE`; no lo usamos así, pero el override sube el
        piso). Verificación: tipos y lint en 0, toda la suite de la API y 220
        tests del front en verde, y en vivo contra el API real 12/12 — correo
        de prueba del SMTP de la empresa entregado a un servidor SMTP local
        con AUTH (asunto y remitente correctos), socket por websocket que se
        une a la empresa y recibe el aviso al crear un registro, y un
        request-target absoluto sin sesión que responde 401 — más el front en
        el navegador 11/11 (login, tabla, editor de descripción con
        autoguardado, cero errores de JS, y el `sanitizeHtml` del bundle
        quitando `onerror`/`javascript:`/`<script>` sin tocar el formato).

  - [x] **Portal del cliente white-label + dominio del portal aparte
        (v0.1.245, ADR-S28, pedido del usuario: "que en el portal no salgan
        textos de mi aplicación, que cada empresa ponga su logo… y un dominio
        o subdominio para completar el white label")**. Lo que el cliente
        veía ANTES de entrar —pantalla de entrar, enlace vencido, "cerraste
        sesión", la pestaña— y el correo con el enlace mostraban la
        plataforma ("Portal — Imagina Base", su ícono y color) o el nombre de
        la LISTA. (a) **Nada de la plataforma**: el HTML del portal es neutro
        («Portal de clientes», ícono genérico) y la raíz del SPA pinta UNA
        marca vigente (`portalBrand.ts`): la de la cuenta con sesión o, sin
        sesión, la del dominio (`GET /public/boot`); en el dominio de la
        plataforma, neutro. Las pantallas sin sesión muestran logo y «Entrar
        al portal de Acme»; el encabezado usa el nombre de la empresa cuando
        no hay nombre de app (antes, el de la lista). (b) **Correo de acceso
        con su marca** (`portal-email.ts`, puro): asunto «Tu acceso al portal
        de Acme», remitente con su nombre (por el SMTP compartido la dirección
        sigue siendo la de la plataforma, SEC-33 — `smtp.transport` ahora
        manda `{name, address}`; con SMTP PROPIO el nombre es sólo una
        sugerencia —`fromNameSoft`— y manda el remitente que la empresa
        configuró), logo por URL absoluta firmada de 30 días,
        botón con su color y tinta legible, todo escapado. (c) **Dominio del
        portal aparte** (`tenants.portal_domain`, migración 0060): card nueva
        en Ajustes → Marca con el mismo ciclo que el del equipo (pedido → TXT
        → activo), nunca igual al dominio del equipo, transferible a quien
        prueba ser dueño aunque otra empresa lo use en cualquiera de las dos
        columnas. Su raíz lleva directo al portal (`surface: 'portal'` en el
        boot → la app del equipo redirige) y el cliente nunca ve el login del
        equipo. (d) **Los enlaces salen por un dominio sólo si RESPONDE**:
        verificado no alcanza (en nginx cada dominio se agrega a mano), así
        que `baseUrlFor` pide `https://dominio/api/v1/public/boot` y exige
        que conteste esa empresa (caché en Redis), y cae al siguiente: portal
        → equipo → plataforma; «Comprobar apuntamiento» dice si ya responde.
        El «copiar enlace» de la ficha usa el enlace que arma el servidor (no
        el dominio desde donde mira el admin). (e) **Pedir un enlace desde el
        dominio de una empresa** sólo manda el de ESA empresa. (f) Guía del
        servidor con los dos caminos (`docs/runbook-custom-domains.md`): Caddy
        con certificados automáticos gateados por el `ask` (una vez por
        consola) o alias por panel en ServerAvatar (sin consola, uno por
        empresa) — el usuario decide cuando tenga el primer cliente con
        dominio. Migrar una empresa avisa que el dominio del portal no viaja.
        Tests: 6 unitarios del correo + 4 de dominios (ciclo del portal,
        surface, enlaces que exigen respuesta, transferencia entre columnas) +
        4 del portal (correo con marca y sin «Imagina», nombre de la empresa
        sin app_name, enlace por el dominio del portal sólo si responde,
        pedido acotado al dominio) + 1 del remitente sugerido + 4 del front
        (marca neutra/empresa/salir) —
        E2E 30/30 contra el build de producción con el dominio simulado en el
        navegador (card y TXT, correo real por SMTP con asunto/remitente/logo/
        color, portal neutro en la plataforma, raíz → portal con la marca
        antes de entrar, sesión y salir con la marca, celular).

  - [x] **Dominios propios por ServerAvatar: consola + avisos al operador
        (v0.1.246, ADR-S28 addendum, decisión del usuario: "por el momento el
        camino de ServerAvatar; con 10 clientes Caddy no hace falta")**: en
        ServerAvatar cada dominio verificado se agrega A MANO como alias de la
        app y se re-emite el certificado — y hasta acá el operador no tenía
        cómo enterarse de que una empresa verificó uno, ni de cuáles faltaban.
        (a) **Aviso por correo** a cada superadmin cuando una empresa verifica
        un dominio (equipo o portal) — «Dominio para habilitar: X (Empresa)»
        con los pasos de ServerAvatar, el CNAME esperado y el enlace a la
        consola — y cuando quita uno que ya estaba activo («Dominio para quitar
        del servidor»). Plantilla pura (`domain-notice.ts`); correo de cuenta,
        sin cuota; best-effort (si falla, la verificación sigue). Quitar un
        pedido sin verificar no avisa nada.
        (b) **Plataforma → Dominios** (`GET /platform/domains`,
        `POST /platform/domains/check`, `DELETE /platform/domains/retired/:d`;
        superadmin con contraseña): la guía de 4 pasos con el destino del
        CNAME, **Para habilitar** (verificados que todavía no responden, con
        «Copiar todos» para pegarlos de una en el panel), **Para quitar del
        servidor**, **Funcionando** y **Esperando verificación**; cada fila con
        empresa, tipo (Equipo / Portal de clientes), estado del DNS («Apunta
        acá» / a otro lado / sin apuntar), si responde, copiar y «Comprobar»
        (re-prueba en vivo saltando la caché de `baseUrlFor`). Las consultas de
        DNS y la prueba corren de a 5 en paralelo; las empresas archivadas no
        aparecen.
        (c) **Retirados** (`platform:domains:retired` en Redis): los alias
        comparten UN certificado de Let's Encrypt, y uno que queda en el
        servidor sin DNS hace fallar la renovación para TODOS — por eso el
        dominio que una empresa deja se recuerda hasta que el operador toca
        «Ya lo saqué»; si la empresa lo vuelve a verificar sale solo. Viaja en
        el snapshot de ADR-S20 (prefijo `platform:`).
        (d) Docs: `runbook-serveravatar.md` §8 (el flujo completo) y
        `runbook-custom-domains.md` marca ServerAvatar como el camino de hoy.
        Tests: 2 de integración con Redis real (aviso al verificar, listado por
        estado, comprobar tras apuntar, quitar → aviso + retirado, re-verificar
        lo saca, descartar, pedido sin verificar sin aviso, archivadas fuera) +
        1 de la plantilla — 13/13 en el spec de dominios — + E2E navegador 17/17
        (pestaña, guía, para habilitar con «No responde», pendiente del portal,
        retirado, Comprobar, Copiar todos, Ya lo saqué borra en Redis, 401 sin
        sesión, celular sin desborde).

  - [x] **Guías completas para registrar Google/Microsoft/Slack + páginas
        públicas (v0.1.247, ADR-S22 addendum, reporte del usuario con captura:
        "las instrucciones están incompletas, no dicen nada de publicar la app
        ni de que la pantalla aparezca como segura")**: la guía de v0.1.203
        eran cinco pasos técnicos que dejaban la app de Google «En prueba» —
        sólo 100 usuarios de prueba, aviso de «app no verificada» y, lo peor,
        **cada conexión vencida a los 7 días** — y no decía nada de publicar ni
        verificar. Ahora: (a) **guías por fases** (`PROVIDER_GUIDES` en shared,
        reemplaza `steps`/`review_note`): Google en 5 (proyecto y APIs con
        enlace directo a cada una → pantalla de consentimiento en Google Auth
        Platform: marca, dominios autorizados y permisos —los tres son
        «sensibles», ninguno «restringido», así que no hace falta la auditoría
        CASA— → cliente OAuth y prueba con el aviso de los 7 días → **Publicar
        app** → **verificación**: dominio en Search Console con la misma cuenta,
        página principal y privacidad, video en YouTube no listado con el
        client_id visible, formulario del Centro de verificación); Microsoft en
        4 (multiinquilino + personales, permisos delegados, **el secreto
        VENCE** —máx. 24 meses— y cómo renovarlo, dominio y **verificación del
        publicador** con Partner Center, por qué sin ella las empresas con
        Microsoft 365 piden aprobación del administrador); Slack en 3 (Token
        Rotation apagado, **Activate Public Distribution**, Marketplace
        opcional). Cada paso con el enlace a la pantalla EXACTA y los valores ya
        resueltos para copiar: URI de redirección, dominio registrable
        (`registrableDomain`, con com.co/co.uk), permisos uno por línea, URLs
        legales, correo de asistencia, **justificación de cada permiso** y
        **guion del video** escritos para lo que hace la app. Cada fase se
        pliega, tiene «Hecho» recordado en el navegador y abre sola la primera
        pendiente. (b) **Páginas públicas** que pide la verificación: inicio,
        política de privacidad y condiciones servidas por el API en
        `/api/v1/public/legal[/privacidad|/terminos]`. Son HTML del servidor y
        no del SPA, porque los revisores no ejecutan JS. CSP cerrada, todo
        escapado y enlaces sólo https/mailto. La política sugerida explica qué
        se hace con los datos de Google/Microsoft/Slack e incluye la cláusula de
        **uso limitado** de Google (en español y la frase exacta en inglés), y la
        página principal SIEMPRE enlaza a ella. Card «Páginas públicas» en
        Plataforma → Integraciones: empresa responsable, correo, sitio,
        descripción y textos editables con marcadores (`{{company}}`…);
        guardar el sugerido tal cual vuelve a «sugerido» para recibir sus
        mejoras. Vive en `platform:legal` y viaja en el snapshot.
        Tests: 9 en shared (fases, enlaces https, justificación por cada
        permiso de Google, dominio registrable, plantillas) y 4 de la API
        (escape y enlaces, URLs, render con la empresa y sin marcadores, texto
        propio, valor corrupto). E2E navegador 29/29: guía por fases,
        7 días, publicar, verificación con justificación y guion, valores
        copiados, progreso recordado al recargar, páginas públicas sin sesión y
        sin errores de CSP, condiciones propias publicadas, celular.

  - [x] **Selector de acción con estilo (v0.1.248, reporte del usuario con
        captura: "el campo donde se selecciona la acción no parece tener
        estilos")**: el «Tipo de acción» de las automatizaciones era un
        `<select>` nativo y en Safari se veía crudo, sin íconos ni logos. Ahora
        `ActionTypeSelect` es un botón con la forma de los demás campos: ícono
        de la acción o logo de la app, nombre, una línea de descripción (o el
        nombre de la conexión) y chevron. Abre el MISMO menú que el «+» de
        agregar acción (`ActionTypeMenu`, que ganó `selectedValue` con check en
        la elegida, `align` y el ancho del disparador). Las tres superficies lo
        heredan: flujo, panel del lienzo y ramas si/sino. Una acción guardada
        que ya no existe se muestra con el aviso en rojo, no como otra. Se
        conservan las reglas de v0.1.242: cada acción de conector es su propia
        opción y elegirla mantiene la conexión. E2E navegador 14/14 (botón y no
        `<select>`, menú con la actual marcada, cambiar a otra acción de
        conector, guardado con la conexión correcta, título del lienzo); 224
        tests del front en verde.

  - [x] **El correo de la empresa por su cuenta de Google o Microsoft
        (v0.1.249, ADR-S29, pedido del usuario: "¿la conexión de Google sirve
        para el SMTP de la empresa?" → "implementalo y mostrá los límites")**:
        tercera forma de envío junto al correo de la plataforma y el SMTP
        propio. La empresa elige una conexión de **Gmail u Outlook** de
        Integraciones (`tenants.settings.mail_account`) y sus correos
        —automatizaciones, enlaces del portal, avisos— salen por la **API de
        Gmail o de Microsoft Graph**, sin host, puerto ni contraseña de
        aplicación (en Microsoft 365 el SMTP con contraseña ya no existe). Por
        la API y no por SMTP+OAuth a propósito: eso pediría
        `https://mail.google.com/`, permiso RESTRINGIDO con auditoría CASA;
        `gmail.send`/`Mail.Send` ya los tiene la conexión. (a) **Motor**: el
        `MailService` la mira PRIMERO (vía la interfaz `MAIL_ACCOUNT_SENDER`,
        que provee el módulo de conectores sin acoplar el correo a ellos);
        `mail-account-request.ts` (puro) arma el RFC 2822 de Gmail
        (`multipart/alternative` con texto de respaldo, sin inyección de
        cabeceras) y el mensaje de Graph (guardado en Enviados); el remitente es
        SIEMPRE la cuenta y un `from` distinto pasa a Reply-To. Una conexión
        borrada/sin autorizar/revocada hace FALLAR el envío con el motivo —nunca
        cae a otra vía en silencio— y el límite del proveedor es irrecuperable
        para la cola. Los errores de Google/Microsoft se traducen (límite
        diario, autorización vencida, permiso faltante, buzón sin correo).
        (b) **Reglas**: sólo una conexión del EQUIPO y autorizada; guardar un
        SMTP la reemplaza (una forma activa); la conexión en uso no se borra ni
        se desconecta (409 con el motivo); no consume la cuota de correos del
        plan (ADR-S18) y `own_smtp` pasa a significar "correo propio". Los
        correos de cuenta (verificación, recuperación, invitaciones) siguen por
        la plataforma. (c) **Los límites, a la vista y ANTES de elegir**
        (`MAIL_ACCOUNT_LIMITS` en shared, por tipo de cuenta deducido de la
        dirección): Gmail personal ~500/día, Google Workspace 2.000/día,
        Outlook.com hasta 5.000 (menos en cuentas nuevas), Microsoft 365 10.000
        destinatarios/día y 30/minuto; por correo, qué pasa si se pasa (bloqueo
        hasta 24 h) y las condiciones (remitente fijo, quedan en Enviados, no es
        para campañas, conviene una casilla compartida). Contador de
        destinatarios del día en Redis → barra «Enviados hoy: 1.520 de ~2.000»
        (aclarado como aproximado: el proveedor suma lo que la persona manda a
        mano). (d) **Ajustes → Correo** rehecho: tres tarjetas (plataforma /
        cuenta de Google o Microsoft —recomendada— / servidor SMTP) con la que
        está **En uso**; elegir cuenta con radio y el motivo de las que no se
        pueden (privada, sin autorizar), «Probar envío», «Cambiar de cuenta» y
        «Dejar de usarla»; sin conexiones, botones a Integraciones. Endpoints
        `GET /workspaces/current/mail`, `PUT|DELETE …/mail/account` (admin, con
        bitácora `workspace.mail_account_change`); el diagnóstico de Plataforma
        registra la vía `tenant_account`. 14 tests (6 puros del armado/errores/
        límites + 8 con Postgres real y la red simulada: sale por Gmail y por
        Graph sin tocar la plataforma, cuenta destinatarios, privada/sin
        autorizar/ajena rechazadas, límite que no cae a otra vía, conexión
        borrada ruidosa, borrar/desconectar bloqueados, SMTP que la reemplaza,
        volver a la plataforma) — 224 front y 129 shared en verde — + E2E
        navegador 22/22 con la llamada REAL a Google (token falso → 401 →
        «reconectala», no «enviado»), celular y modo oscuro.

  - [x] **Cobro de planes: período pagado + renovación automática (v0.1.250,
        ADR-S30, pedido del usuario: "vincular Mercado Pago para cobrar los
        planes" → "las dos formas, sin comisión")**. Hasta acá un pago aprobado
        dejaba a la empresa activa PARA SIEMPRE (no había vencimiento), un pago
        pendiente —un PSE en proceso— la mandaba a solo-lectura aunque tuviera
        meses pagados, y una empresa en solo-lectura ni siquiera podía pagar (el
        `TenantGuard` le rechazaba el checkout justamente por estar vencida).
        (a) **Período pagado** (`tenants.paid_until`, migración 0061): cada pago
        aprobado lo EXTIENDE desde donde termina —pagar antes no pierde días— o
        desde hoy si ya venció; meses recortados al último día (31-ene + 1 =
        28-feb). Vencido + **5 días de gracia** → solo-lectura, por la MISMA
        `isEffectivelyReadOnly` del guard, el resumen y la consola.
        (b) **Dos formas de pagar** en Ajustes → Suscripción: **N meses** de una
        vez (1/3/6/12; Checkout Pro de Mercado Pago con PSE, Nequi, tarjeta o
        efectivo, o PayPal) y **renovación automática** con tarjeta (suscripción
        `preapproval` mensual de Mercado Pago que arranca cuando vence lo ya
        pagado: nadie paga dos veces el mismo mes). Panel nuevo con el estado
        ("Pagado hasta… quedan N días" / "venció, tenés hasta…" / "solo-lectura"),
        la renovación (pendiente con "Terminar en Mercado Pago", activa con su
        próximo cobro, cancelar) y el **historial de pagos** con medio, monto y
        hasta cuándo dejó pagado cada uno.
        (c) **Registro de pagos** (`billing_payments`, RLS, único por proveedor
        + id del cobro): es lo que hace idempotente el aviso — los reintentos y
        el cobro de una cuota que llega por DOS avisos (`payment` y
        `subscription_authorized_payment`, con el mismo id de pago) extienden
        UNA vez. Pendiente/rechazado se registran sin tocar la empresa; un aviso
        viejo no deshace uno aprobado; un reembolso resta esos meses. Los avisos
        se verifican con la firma y el pago se RELEE de la API (nunca se le cree
        al cuerpo); la referencia lleva el monto y un pago por menos se rechaza.
        (d) **Pagar en solo-lectura**: `@AllowReadOnly()` (metadata que lee el
        `TenantGuard`) en el checkout y en cancelar la renovación.
        (e) **Plataforma → Cobros**: las credenciales de Mercado Pago se cargan
        desde la consola (cifradas, `platform:payments`, viajan en el snapshot;
        el `.env` queda de respaldo, el token nunca vuelve: `••••abcd`), con los
        pasos y la URL de avisos para copiar, modo prueba/producción y los
        **pagos recientes** de todas las empresas.
        (f) **Avisos de vencimiento** por correo a los admins: 3 días antes, al
        vencer y al pasar a solo-lectura (con renovación activa sólo el corte);
        una vez por período (Redis `SET NX`), cola BullMQ propia.
        Sin comisión de plataforma, y Wompi queda SOLO como conector de las
        empresas (próximas versiones). 39 tests en el spec de pagos (referencia,
        período y gracia, firma, la pasarela de Mercado Pago contra la red
        simulada, PayPal, avisos, y el registro con Postgres real: extender una
        vez, pendiente que no toca, reembolso, renovación con la cuota por dos
        caminos, reemplazo y cancelación, RLS) — 955 API y 224 front en verde —
        + E2E navegador 34/34 contra un Mercado Pago simulado (consola cifrada,
        pago de 3 meses por PSE con aviso pendiente y aprobado, reintento sin
        duplicar, firma falsa ignorada, renovación con arranque al vencimiento y
        cancelación, gracia, solo-lectura que deja pagar y se reactiva al
        instante, pagos recientes, celular). **Límite de la verificación**: sin
        credenciales reales de Mercado Pago el proveedor se simuló con la forma
        de su API; la prueba con la cuenta de prueba queda para el servidor.

  - [x] **Cobros de las empresas: Mercado Pago y Wompi (v0.1.251, ADR-S31,
        pedido del usuario: "un conector que se pueda vincular a las tablas y
        saber si un cliente ya pagó" — incluye lo que iba a ser v0.1.252,
        Wompi)**: la plata va a la cuenta de CADA empresa, sin comisión.
        (a) **Dos apps por clave** en la galería («Cobros y pagos»): Mercado
        Pago (Access Token) y Wompi (llave pública + privada + secreto de
        eventos). La credencial se verifica ANTES de guardarse (Wompi: las
        llaves del mismo ambiente) y queda cifrada; una integración por clave
        puede tener ahora un segundo secreto (`secret_slot: 'signing_secret'`,
        va a `secrets.signing_secret`). (b) **«Cobrar» en la ficha** (panel
        «Cobros» en la clásica y bloque «Cobros» en la diseñada): concepto,
        monto y correo sugeridos del registro, montos latinos («150.000»),
        vencimiento en días; el link queda copiado. Tabla `payment_links`
        (migración 0062, RLS) y «Agregar columnas» crea link / estado (select
        con colores) / fecha / monto / medio en la lista
        (`settings.collections.fields`) para filtrar quién debe. (c) **Avisos
        que no se creen**: `POST /public/collections/:token` (tabla
        `collection_hooks` sin RLS) sólo toma el id del pago y lo RELEE del
        proveedor con la credencial de la empresa; Wompi además se verifica por
        firma. Un pago sólo toca un link de ESA conexión; un pagado no se
        despaga con un rechazo posterior; el reembolso sí; otro monto → «Monto
        distinto»; «Verificar» consulta a mano y los vencidos pasan a
        «Vencido» solos. (d) **Automatizaciones**: acción «Crear link de pago»
        (deja `{{pago.link}}`/`{{pago.monto}}` para el WhatsApp siguiente; su
        «Probar ahora» NO crea un cobro real) y disparador **«Cuando se recibe
        un pago»** con `{{pago.monto_pagado}}`, `{{pago.metodo}}`… (sección
        nueva en el selector de variables; el asistente/MCP lo conoce).
        (e) **Integraciones → Cobros** por conexión: URL de eventos para pegar
        en Wompi, último aviso, pendientes/pagados/cobrado y los últimos links.
        Borrar una empresa limpia las tablas nuevas; migrarla avisa que el
        historial de links no viaja. **Bug atrapado en el E2E**: el título
        sugerido salía «Registro #N» porque los campos se leían sin orden y el
        «Medio de pago» (texto) quedaba primero. 10 tests de integración
        (conectar/cifrar, crear desde el registro, aviso releído, monto
        distinto, Verificar + reembolso, Wompi con firma, acción con
        `{{pago.link}}`, disparador, aislamiento entre empresas, agente sin
        alcance, vencimiento) + 2 del front — 965 API y 226 front en verde — +
        E2E navegador 33/33 contra un Mercado Pago y un Wompi simulados.
        **Límite de la verificación**: sin credenciales reales los proveedores
        se simularon con la forma de sus APIs; la prueba con cuentas de prueba
        (TEST- / pub_test_) queda para el servidor.

  - [x] **Auditoría integral: rendimiento, fallas funcionales y UI/UX
        (v0.1.252, pedido del usuario: "audita la app — rendimiento, módulos,
        campos, que todo funcione, velocidad y la estética")**. Tres frentes
        auditados en paralelo (servidor, front, UX con capturas en claro/oscuro/
        celular) más un QA funcional que recorrió los 22 tipos de campo, vistas,
        ficha, automatizaciones, tableros y portal. Cada hallazgo se verificó
        antes de tocarlo.
        **Fallas reales arregladas**: (a) **BLOQUEANTE — los campos «Fecha y
        hora» no se podían guardar desde ninguna pantalla**: el editor mandaba
        la hora local sin zona (`2026-10-20T09:30`) y el backend la exige; ahora
        viaja el instante UTC (`formatDateValue`, con tests) y se muestra en la
        hora local de quien mira. (b) **El límite de pedidos respondía 500
        «Error interno»** (y cada rechazo quedaba como error del servidor en
        Diagnóstico): el filtro de excepciones respeta los 4xx de Fastify
        (429/413/415) con mensaje en criollo. (c) **Arrastrar el borde de una
        columna no la ensanchaba en la tabla plana** (y la vista guardaba 0):
        el `<th>` draggable arrancaba un drag HTML5 que se tragaba los
        mousemove, y además el ancho nuevo de TanStack se calcula dentro de un
        updater que React evaluaba tarde — ahora `columnSizingInfo` se controla
        con evaluación inmediata y el `<th>` no arrastra mientras se redimensiona.
        (d) **Los archivos no se podían abrir desde la tabla, la ficha ni el
        portal**: la celda mostraba «17» (el id), la ficha «#17», el portal la
        URL firmada como texto, y la descarga con sesión exige `X-Tenant-Id`, que
        un `<a>`/`<img>` nunca manda (400). `GET /files?ids=` devuelve ahora una
        URL FIRMADA (ya pasó el ACL; vencimiento redondeado a la hora para que el
        navegador la cachee) y la celda muestra el nombre con enlace, resuelto en
        lote (cargador estilo DataLoader: todas las celdas de un tick → un
        request). (e) **Crear un campo Selección fallaba** si se completaba sólo
        la etiqueta: el valor interno se genera solo desde la etiqueta. (f)
        **Ordenar por un lookup no hacía nada** (el menú lo ofrecía) y **el
        orden de texto ponía las mayúsculas antes y los acentos al final**
        (Postgres Alpine/musl ordena `en_US.utf8` como C): `COLLATE "und-x-icu"`
        en los tipos de texto. (g) **Filtrar por una relación se ignoraba** (sin
        vínculos devolvía todo — por API, MCP o automatizaciones): `EXISTS` sobre
        `relations` (tiene / no tiene / vinculado a), sin contar vínculos a
        registros borrados; agrupar por relación o archivo se rechaza con el
        motivo y su pie sólo cuenta. (h) **Tableros agrupados por persona
        mostraban el id**: `GET /me/users?ids=` (lote) + etiquetas con el nombre.
        (i) **El CSV exportaba valores internos** (id de usuario, `[17]`,
        `vip`, `0/1`): ahora etiqueta, nombre, nombre del archivo y «Sí/No», y el
        import lee el nombre o el email de una persona (el ida y vuelta cierra).
        (j) Menores: la casilla se marca con UN click, una URL sin `https://`
        se completa sola, el historial de una automatización se refresca tras
        «Ejecutar ahora», la línea de tiempo ya no dibuja «(sin valor)» como un
        mes, «papelera» inexistente, «Calendar/Cards» y «1 registros».
        **Rendimiento**: índices en todas las FKs que borraban por escaneo
        (comments, mentions, portal_links, bulk_edit_items, records.parent_id,
        relations/recurrences/payment_links reordenados), índice parcial del
        listado (Index Only Scan, 0,29 ms), los `is_indexed` acotados a SU lista
        (antes indexaban la tabla compartida entera) y fuera dos GIN muertos
        (migración 0063); el pie de una lista calcula cada rollup UNA vez por
        fila (antes una subconsulta por métrica); tope de 300 grupos en la vista
        agrupada (agrupar por un campo casi único devolvía 20k grupos); tableros
        con concurrencia acotada; `due_date_reached` por lotes keyset (el LIMIT
        500 podía trabarse); el límite del plan se consulta UNA vez por lote;
        export CSV con backpressure; pool configurable (`DB_POOL_MAX`). Front:
        la tabla se VIRTUALIZA de verdad contra el scroller del `<main>` (antes
        nunca se activaba), cero prefetch de página siguiente, el eco realtime de
        una edición propia no recarga la lista, diálogos montados sólo al
        abrirse, formatters de número cacheados, panel lateral sin re-renders por
        ruta.
        **UI/UX**: fechas y números de TODA la app en el formato de la empresa
        (`formatDate`/`formatDateTime`/`formatLongDate` — chau «October 6,
        2026»), textos al voseo y sin jerga («merge tags», «Setea», «OWNER»),
        chips de opción con tinta por contraste WCAG real, **Inter** servida por
        la app (`@fontsource-variable/inter`, antes se declaraba y nunca se
        cargaba), cabeceras de tabla sin mayúsculas y el ID al final, **tarjetas**
        con datos reales (avatar chico + campos) en vez del bloque de color con
        iniciales, tablero con las acciones ocasionales en un «…» y valores de
        barra que ya no se cortan, Plataforma sin pestañas duplicadas en
        escritorio ni métricas repetidas, y en **celular**: «Nuevo registro»,
        «Guardar» de automatizaciones y el pie del modal ya no se salen de la
        pantalla, formulario de alta con lugar para los controles e
        integraciones legibles. Tests: 973 API en verde (nuevos: filtro de excepciones,
        lote de usuarios, orden ICU, lookup que ordena, filtro por relación, CSV
        legible, archivos firmados), 232 front, 129 shared — E2E navegador sobre
        la lista de QA (fecha y hora guarda con `Z`, casilla 1 click, archivo
        con enlace firmado que descarga sin sesión, resize 130→220 px, tablero
        con «E2E Tester», tarjetas, celular sin desborde) y 640 pedidos → 600
        normales + 40 × 429.
        **Queda (anotado en CONTINUIDAD)**: import que crea opciones de filas
        rechazadas, virtualizar la vista agrupada, bundle inicial (shared en
        CJS, rutas eager), contexto por request en el servidor, `search_text`
        indexado, `next_fire_at` en recurrencias, el modal del registro en
        celular (formulario largo) y los textos de Actividad para porcentaje y
        duración.

  - [x] **El agente ve lo que crea (v0.1.253, reporte de un cliente: "un
        agente crea registros en una lista y después no los ve; el admin
        sí")**. Con el acceso por defecto del agente («Solo lo suyo» = los
        que creó) funcionaba —verificado por API y en navegador, con alta
        desde la interfaz—; el fallo aparecía con el **ajuste fino** del
        panel de Permisos: (a) **«Los que tiene asignados»** filtraba SÓLO
        por el campo responsable, así que el registro que el agente cargaba
        sin ponerse de responsable desaparecía en el acto (tampoco podía
        abrirlo ni corregirlo), y si no se había elegido el campo responsable
        el agente no veía NADA; (b) **«Ver: nada» con «Crear: sí»** se podía
        guardar y el agente creaba a ciegas. Regla nueva en `list-acl.ts`,
        que usan TODOS los caminos (listado, ficha, editar/borrar, agrupada,
        pie, tableros, actividad, autocompletado, recurrencias, cobros):
        **quien crea un registro siempre lo ve** — `assigned` = asignados a
        la persona **o** creados por ella (sin campo responsable queda en
        "los que creó", no en nada) y `create` con `view: none` se lee como
        `own` (el panel también lo corrige al tocarlo). El selector dice ahora
        «Los asignados a la persona (y los que creó)». De paso, **archivos**:
        la regla de SEC-25 miraba el rol GLOBAL (el agente sólo bajaba lo que
        subió o lo de registros que creó), así que con «Colaborar» en una
        lista —o un registro asignado— veía el registro pero el adjunto daba
        404. Ahora sigue el ACL de CADA lista: lo que subió, los campos de
        archivo NO ocultos de los registros que alcanza, los bloques de la
        descripción, las imágenes del diseño de las listas que ve y las de los
        tableros que puede abrir; una lista sin acceso o un campo oculto
        siguen cerrados. 3 tests de ACL (fallan con el código anterior) + 1 de
        archivos (contrato ajeno visible, nómina oculta y otra lista cerradas,
        imagen del diseño y adjunto de la descripción visibles) — 977 API en
        verde — y verificación en vivo con un agente real («Los asignados»:
        crea sin asignarse → lo ve, lo abre y lo edita; el registro ajeno
        sigue oculto).

  - [x] **La impersonación del superadmin vuelve a funcionar (v0.1.254,
        reporte del usuario: "impersonar me cierra la sesión, y al volver a
        entrar dice demasiados intentos")**. Regresión de SEC-24 (v0.1.225):
        el `SuperadminGuard` chequeaba "¿sesión abierta con contraseña?" ANTES
        de "¿es superadmin?", y una sesión IMPERSONADA no se abre con
        contraseña → respondía `reauth_required`; la app, al sondear
        `/platform/stats` para decidir si mostrar Plataforma, interpreta ese
        código como "cerrá la sesión y volvé al login" — la impersonación
        moría apenas empezaba (reproducido en el navegador: impersonate 200 →
        stats 401 reauth → logout → login). Ahora: (a) una sesión impersonada
        recibe 403 (no hay consola para quien mira como otro) y el guard
        pregunta primero QUIÉN es y después CÓMO entró — `reauth_required`
        sólo se lo lleva un superadmin de verdad; (b) la app ni sondea la
        consola mientras se impersona; (c) **cerrar sesión impersonando
        devuelve al operador a su propia sesión** (antes destruía todo y lo
        dejaba en el login). Y los "demasiados intentos": el mensaje del freno
        por cuenta (10 contraseñas mal en 15 min) ofrecía "restablecé tu
        contraseña" pero el reset NO levantaba el contador — ahora lo limpia
        (también el de la contraseña en la sesión). 2 tests (el del guard falla
        con el código anterior; reset que desbloquea el login) — 63 en los
        specs de auth y plataforma — + E2E navegador 8/9 (impersonar → app del
        agente con banner y sus registros, sin reauth ni logout, sin
        Plataforma; cerrar sesión → vuelve el operador con la consola; la ✗ es
        la URL `/login` que conserva el path de la recarga, la app está
        adentro).

  - [x] **Fallas chicas de la auditoría v0.1.252 (v0.1.255)**: cuatro
        pendientes funcionales. (a) **El import creaba opciones de select de
        filas que después se rechazaban**: `expandSelectOptions` agregaba al
        campo toda etiqueta nueva del ARCHIVO entero (incluidas las filas
        inválidas por otro campo y las que pasaban el tope de 5.000) antes de
        validar nada, así que un CSV con errores dejaba opciones colgadas para
        siempre. Ahora se PLANIFICAN en memoria (`planOptionExpansions`, puro),
        las filas se validan contra el campo ya ampliado y recién después del
        chequeo del plan se guardan SÓLO las opciones que usa alguna fila que
        entra (`persistUsedOptions`); si no entra ninguna, el campo no se toca.
        «Actualizar desde un archivo» además agregaba opciones sin
        `manage_fields`: ahora exige el permiso, igual que el import. (b)
        **Actividad legible**: porcentaje, duración, calificación y teléfono
        salían crudos («Avance en 100») — ahora «100 %», «1h 30m», «4 de 5» y
        el teléfono formateado; un campo persona muestra el NOMBRE (antes
        «Usuario #3»). (c) **Conversión de tipo a texto**: escribía el valor
        guardado en vez de lo que la persona leía — persona → texto daba el
        id, casilla → texto «true/false» y select → texto el value interno
        (`pendiente_pago`). Ahora escribe nombre, «Sí/No» y la etiqueta; a
        select/multi_select las opciones nacen de ese mismo texto, y entre
        selects se conservan las opciones (con etiquetas y colores) en vez de
        regenerarlas de los valores. (d) **HTML inválido**: dos `<main>`
        anidados en la página del registro (el del shell y otro de la página)
        y la × de quitar del selector de usuario era un `<button>` dentro del
        disparador `<button>` (el navegador lo re-anida y el click podía abrir
        el popover en vez de quitar): la × pasa al lado del disparador. Tests:
        1 de integración del import (fila rechazada sin opción colgada, campo
        intacto si no entra ninguna), 1 de conversiones (nombre, Sí/No,
        etiqueta, opciones de select desde Sí/No) y 1 unitario de Actividad —
        y E2E navegador 17/17 (import, Actividad con los cuatro tipos y el
        nombre, un solo `<main>`, cero botones anidados, la × quita sin abrir
        el popover, conversiones por API, cero avisos de anidamiento).

  - [x] **Carga inicial más liviana + vista agrupada virtualizada (v0.1.256,
        pendientes de rendimiento de la auditoría v0.1.252)**: medido sobre el
        build de producción. (a) **`packages/shared` desde el FUENTE**: el
        front lo consumía compilado a CommonJS (el `dist` que usa NestJS), sin
        tree-shaking — viajaban enteros los catálogos de plantillas, guías de
        integraciones, etc. (~560 KB sin minificar). Ahora vite lo resuelve
        con un alias a `packages/shared/src/index.ts` (ESM): el chunk común
        baja de 233 a 65 KB gz junto con lo de abajo, y en desarrollo un
        cambio en shared se ve sin recompilarlo ni borrar el pre-bundle de
        vite (la trampa de v0.1.167/v0.1.176/v0.1.198 deja de existir para el
        front; el API sigue usando el `dist`). (b) **La app se carga después
        del gate de sesión**: el login, el reset y la verificación ya no bajan
        el shell, la tabla ni socket.io — el chunk se pide en paralelo con
        `/auth/me`, así quien ya tiene sesión no espera un viaje de más; el
        realtime pasó al componente `App`. (c) **Rutas a pedido**: la página
        del registro (motor de la ficha + gráficos), carpetas, favoritos y
        ajustes. (d) **Diálogos a pedido**: importar, compartir, edición
        masiva, estructura, actualizar desde archivo, edición/variaciones de la
        tienda e historial — se montaban sólo abiertos pero viajaban en la
        carga inicial (~250 KB sin minificar); cada uno con su `<Suspense>`
        local (la nota de 0.57.11 sobre lazy + vistas sigue vigente: las
        VISTAS quedan eager). (e) **Calendario a pedido**: react-day-picker +
        date-fns (~300 KB sin minificar) en `CalendarPicker`, precargado
        cuando la pestaña queda libre. Resultado: el login baja ~217 KB gz (antes
        ~630) y la entrada a una lista ~430 KB gz. (f) **Vista agrupada
        virtualizada**: con 40 grupos abiertos de 50 filas dibujaba 2.000
        filas; ahora cada grupo tiene su virtualizer contra el scroll del
        `<main>` (`useMainVirtualRows`, `scrollMargin` re-medido cuando el
        contenido cambia de alto) — con 600 registros en 12 grupos se dibujan
        ~150 filas y el alto total se conserva. **Bug encontrado en la prueba**:
        si un chunk que se pide al arrancar no llega (deploy viejo, red caída),
        la página entraba en un **bucle de recargas infinito** — el guard de
        `vite:preloadError` se rearmaba en el evento `load`, que dispara en cada
        recarga. Ahora se rearma tras 15 s sanos (app y portal). E2E contra el
        build de producción 18/18 (login sin el chunk de la app, HTML crítico
        sin la app, 600 filas → ~150 dibujadas arriba y al fondo, calendario,
        diálogos a pedido, rutas, cero errores) + portal sin errores.

  - [x] **Servidor: sin índices por campo + recurrencias en una consulta +
        lecturas sin la descripción (v0.1.257, ADR-S32, tercera entrega de los
        pendientes de la auditoría v0.1.252)**. (a) **Índices por campo
        eliminados** (decisión del usuario con los números a la vista): cada
        campo con «Indexar» —y las tiendas WooCommerce marcaban varios por
        defecto— sumaba 1-2 índices por expresión a la tabla COMPARTIDA
        `records`, y el planificador los evalúa a todos en cada consulta de
        cualquier empresa: con 890, planificar el listado tardaba ~70 ms (0,6
        sin ellos), mientras que un filtro en una lista de 100k tardaba lo mismo
        con o sin índice (33 ms; el de `(tenant_id, list_id, id)` ya acota a la
        lista). Migración 0064 borra los `imcrm_ix_*`; `fields.is_indexed` queda
        como dato sin efecto (API/MCP/plantillas no se rompen), la interfaz ya
        no lo ofrece, se fue el tope de 8 por lista y los packs de WooCommerce
        dejaron de marcarlo. Benchmark §13 sin índices: GET con 2 filtros sobre
        100k p95 10,6 ms (presupuesto 100) y PATCH p95 14 ms (60). (b) **Tick de
        recurrencias en UNA consulta**: traía TODAS las recurrencias programadas
        y abría una transacción por cada una para leer la fecha; ahora
        `dueScheduled` hace el JOIN contra el valor real del registro y devuelve
        sólo las vencidas (misma normalización que `comparableDate`). Sin
        columna `next_fire_at` que mantener: la fecha del registro sigue siendo
        la única verdad. (c) **`findById` sin la descripción**: se llama en cada
        edición, automatización, recurrencia y comentario y traía el documento
        completo (hasta 512 KB); ahora usa las columnas del listado y la
        descripción se pide aparte sólo donde hace falta. **Descartado con
        medición**: un índice trigram global para el buscador — una búsqueda
        específica bajaba de 178 a 112 ms pero un término presente en todos los
        registros subía de 127 a 483 ms. Tests: tick (vencida, futura,
        borrada), `is_indexed` sin índice físico y sin tope, pack sin la marca —
        y suites API/front en verde.

  - [x] **El registro y el alta en celular (v0.1.258, última entrega de los
        pendientes de la auditoría v0.1.252)**: en un teléfono el modal del
        registro flotaba con márgenes y apilaba tres cosas en 844 px — los
        datos en una franja que scrolleaba por dentro, los botones de guardar
        en el MEDIO y el panel de Comentarios/Actividad en la mitad de abajo
        (dos scrolls). Ahora, bajo 1024 px, el registro usa **una vista por
        vez** con pestañas **Detalles · Comentarios · Actividad**
        (`useMediaQuery`; el aside de escritorio no se monta) y en celular
        ocupa **toda la pantalla** (`100dvh`), con Guardar fijo abajo sólo en
        Detalles. El **alta** también va a pantalla completa en celular, y las
        filas de campos (`CompactFieldRow`, compartidas por el alta, el modal y
        la página) ponen la **etiqueta arriba del valor** bajo 640 px: al lado
        le dejaban ~160 px al control y los selects y el selector de persona se
        partían en dos renglones. Escritorio sin cambios. E2E navegador 12/13
        en 390×844 táctil y 1400×950 (pantalla completa, tres pestañas, Guardar
        sólo en Detalles, cero aside apilado, composer en Comentarios, etiqueta
        arriba en celular y al lado en escritorio, modal flotante en escritorio;
        el ✗ es un registro de prueba sin historial, que muestra el estado
        vacío).

        **Con esto quedan cerrados los pendientes de la auditoría v0.1.252.**

  - [x] **Vistas más rápidas + pestañas de vistas editables (v0.1.259,
        reporte del usuario: "las listas y agrupaciones cargan mucho más lento"
        y "las pestañas no permiten cambiar nombre, icono ni reordenarse")**.
        (a) **Lentitud — medida, no supuesta**: réplica de su lista «Anualidades
        LIC» (2.173 registros, mismos 15 campos y vistas) servida con el build
        de v0.1.255 y el actual lado a lado. El servidor contestaba en 20-60 ms;
        el tiempo se iba en el NAVEGADOR, y v0.1.255 ya era lenta (la agrupada
        de v0.1.256 sumó encima). Tres causas: el virtualizador dibujaba TODAS
        las filas en el primer render (la ventana se activaba recién en el
        layout effect) y después medía CADA `<tr>` con `getBoundingClientRect`
        —un layout forzado por fila—; cada celda de fecha o selección montaba
        su popover completo (Radix, ~10 componentes) y sus consultas aunque
        sólo se mirara; y cada celda creaba su propia mutación. Ahora
        `useMainVirtualRows` es el hook ÚNICO de la tabla plana y la agrupada:
        el primer render ya es una ventana (30 filas), y sin «Ajustar texto»
        se mide UNA fila (alto fijo); `OptionPicker` y `DateCellEditor`
        montan el popover recién en el primer click (el disparador se ve
        igual); y una sola mutación por tabla (`RecordUpdaterProvider`).
        Medido: «Todos» 1,1-1,3 s → 0,3-0,4 s en escritorio y 4,6 → 1,9 s con
        CPU de celular; agrupada 1,0-1,3 s → 0,66 s y 4,4-4,9 → 2,7-3,3 s.
        (b) **Pestañas de vistas** (estilo ClickUp): **doble click** en el
        nombre lo cambia en el lugar (Enter guarda, Escape cancela), **click
        derecho** o «···» (al pasar el mouse) abre el menú de CUALQUIER
        pestaña —cambiar el nombre, **Color e ícono** (el mismo catálogo de 324
        iconos de las listas), editar configuración, por defecto y eliminar con
        confirmación de la app (antes `confirm()` nativo)— y se **reordenan
        arrastrando** (marca de dónde cae, optimista, `PATCH
        /lists/:l/views/reorder` con ids de ESA lista). Migración 0065:
        `saved_views.icon`/`color` (columnas propias, no en `config`: guardar
        los cambios de la vista reemplaza el config entero) y la posición pasa
        a mandar sola — se fijó como posición el orden que se veía (la por
        defecto primero), así nadie ve sus pestañas moverse. Icono y color
        viajan en plantillas, duplicar y migrar empresa. 2 tests de API (10 del
        spec de vistas) + E2E navegador 15/15 de celdas (un click abre
        selección/multi/fecha y guardan, ventana al fondo, agrupada) y 13/13
        de pestañas (doble click, Escape, click derecho, icono, arrastrar,
        persistencia tras recargar, eliminar con confirmación).

  - [x] **Menú contextual completo de las vistas (v0.1.260, pedido del usuario
        con captura del menú de ClickUp)**: el menú de cada pestaña (click
        derecho o «···») pasa a tener todo lo que tiene sentido acá:
        **marcar como favorito** (la vista aparece en Favoritos —página y
        panel— y abre la lista directamente en ella; `favorites.views` +
        `GET /me/favorites/views`, que resuelve nombre, icono y lista en UN
        request y nunca devuelve privadas ajenas), **copiar vínculo a la
        vista** (la URL ahora lleva `?view=<id>` y la refleja siempre — antes
        «Copiar enlace» copiaba la lista y abría la vista por defecto; un
        `?view=` que llega de afuera se aplica aunque la lista ya esté
        abierta), **personalizar vista** (abre el panel sobre esa vista),
        **color e ícono**, **vista privada** (sólo la ve quien la creó;
        nunca puede ser la por defecto), **proteger vista** (sólo su autor o
        un admin la cambia o borra; a los demás la barra les dice «tus cambios
        no se guardan» y ofrece guardarlos como vista nueva), **guardar
        automáticamente** (los cambios de filtros/orden/columnas se guardan
        solos a los ~0,8 s), **vista por defecto**, **exportar vista** (con
        sus filtros), **duplicar** (la copia nace en modo renombrar) y el
        botón **Uso compartido y permisos**. Los interruptores no cierran el
        menú, como en ClickUp, y la pestaña muestra candado (privada) o escudo
        (protegida). Migración 0066: `saved_views.created_by`/`is_private`/
        `is_locked`/`autosave`; las reglas viven en `ViewsService` (viewer
        opcional: sin viewer —plantillas, export, duplicar lista— las privadas
        no existen) y el front las espeja en `viewAccess.ts`. Bootstrap, el
        asistente/MCP y migrar empresa respetan la privacidad (una privada
        cuyo autor no viajó vuelve a ser compartida). Quedan fuera, a
        propósito, «Fijar vista» y «Modo de carga rápida» (sin equivalente) y
        «Plantillas» (las plantillas son por lista). 3 tests de API nuevos
        (privada, protegida, favoritas) + E2E navegador 20/20.

  - [x] **«+» de columna flotante + área de trabajo sin tope (v0.1.261,
        pedido del usuario con capturas de ClickUp)**: (a) el «+» de agregar
        columna dejó de ser una columna de 48px con celda de fondo en CADA
        fila (un carril casi vacío que le comía ancho a la tabla): ahora es un
        botón redondo que FLOTA sobre el borde derecho de la cabecera sticky,
        con un degradado que funde lo que pasa por debajo
        (`FloatingAddColumn`, tabla plana y cada grupo de la agrupada); en su
        lugar queda una columna de relleno invisible que sólo toma el ancho
        sobrante (con overflow mide 0). (b) Desvanecido del borde derecho
        mientras haya más columnas por scrollear (`useOverflowsRight` +
        `RightEdgeFade`); al llegar al final desaparece. (c) El `<main>` ya no
        tiene `max-w-screen-2xl`: la tabla usa todo el ancho de la ventana;
        las páginas de formularios (Ajustes, sincronizaciones) mantienen su
        propio tope. E2E navegador 9/9 a 1900px (ancho completo, «+» pegado
        al borde, degradado, cero celdas sticky vacías, fade que aparece y se
        va, el «+» abre el alta de campo, agrupada).

  - [x] **Deslizar las pestañas de vistas en celular ya no abre menús
        (v0.1.262, reporte del usuario: "cuando sólo estoy deslizando las
        vistas se abre el menú contextual de la pestaña, sin haberlo
        sostenido")**. Reproducido con toques reales por CDP en 390×844
        táctil: con el código anterior 5 de 6 deslizamientos abrían un menú y,
        si el dedo arrancaba sobre un «···», la tira ni siquiera scrolleaba.
        Tres causas: (a) **el trigger de Radix abre en `pointerdown`** —con
        mouse es lo correcto, pero en táctil es el INICIO de cualquier gesto—;
        el wrapper `DropdownMenu`/`DropdownMenuTrigger` (`components/ui`) ahora
        lleva el estado y, para punteros que no son mouse, anula esa apertura
        (`preventDefault`, que `composeEventHandlers` respeta) y abre en
        `click`, que el navegador no dispara si el gesto terminó en scroll; si
        el menú estaba abierto, el toque afuera ya lo cerró y no se reabre.
        Vale para TODOS los «···» de la app (panel lateral en el drawer,
        cabeceras, tarjetas); mouse y teclado sin cambios. (b) **El
        mantener-presionado** de la pestaña sólo abre el menú si el dedo quedó
        quieto (≤8 px, sin `pointercancel`) 450 ms. (c) **En táctil la pestaña
        no es `draggable`** (`(hover: none) and (pointer: coarse)`): el drag
        HTML5 por long-press peleaba con el deslizamiento; ahí se reordena con
        **«Mover a la izquierda / a la derecha»** en su menú (mismo endpoint de
        reorden). E2E 14/14 en celular emulado (deslizar desde «···» y sobre
        pestañas sin menús, la tira se mueve, long-press corto no abre y uno
        real sí, tap abre, mover persiste tras recargar) + regresión de
        escritorio 20/20 del menú de vistas y arrastre con mouse.

  - [x] **Zona horaria por empresa (v0.1.263, ADR-S33, reporte de un cliente
        en Colombia: "programé una automatización para las 8am y se envió a las
        3am")**. No había zona por empresa: el editor guardaba la del navegador,
        pero lo creado por el asistente, el MCP, la API o una plantilla quedaba
        SIN zona y BullMQ lo corría en UTC (8:00 UTC = 3:00 en Bogotá). Ahora
        (a) cada empresa tiene su zona en **Ajustes → Formato regional**
        (`tenants.settings.format.timezone`, sin migración; validada contra
        `Intl` y `pg_timezone_names`, 400 `invalid_timezone`), con «Usar la de
        este equipo» y la hora actual en esa zona; un admin de una empresa sin
        zona la ve **propuesta sola desde su navegador** al entrar (una vez por
        empresa, nunca impersonando ni con UTC). (b) La zona se **resuelve al
        ejecutar**, nunca se copia: propia del horario → la de la empresa → UTC
        explícito (`scheduleTimeZone` en shared) — los horarios ya guardados sin
        zona pasan a la de la empresa sin migrar datos, y cambiar la zona de la
        empresa **re-registra los schedulers** de sus automatizaciones
        (`TenantTimeZones`, global, cache 30 s + listeners). (c) La misma zona
        manda en: vencimientos (`due_date_reached` compara una fecha sin hora
        contra la medianoche LOCAL), el tick de recurrencias, «hoy/esta semana/
        este mes» de filtros, vistas públicas y tableros (`QueryClock` en el
        QueryBuilder; los rangos de fecha-hora se convierten a instantes de esa
        zona), los buckets por día/mes y los deltas de los tableros,
        `{{date.today}}` del motor y del probador, la semilla de `days_after`, y
        el «hoy» del asistente/MCP (el prompt le dice la zona de la empresa, o
        que pregunte si no hay). (d) Editor: el horario dice «Corre a la hora de
        Colombia (Bogotá)», el selector ofrece «La de la empresa (…)» como
        primera opción (guardar NO le pega una zona propia: sigue a la empresa)
        y, sin zona, avisa que corre en UTC con el enlace a Ajustes.
        **Bug latente de paso**: en el tick de recurrencias la regex de
        `regexp_replace` estaba dentro de un template `sql` (tagged template) de JS y `\d` se
        "cocinaba" a `d` — nunca matcheaba; ahora va con la barra doblada.
        5 tests de integración (horario sin zona sigue a la empresa y se
        re-registra al cambiarla, vencimiento por medianoche local, recurrencia
        con fecha sin hora, «hoy» relativo en Kiritimati vs Pago Pago, zona
        inválida rechazada) + 5 de shared — 233 front y 134 shared en verde — +
        994 API en verde — E2E navegador 16/16 (sin zona → Redis en UTC y aviso en el editor; al
        entrar el admin la empresa toma Bogotá y el horario pasa a Bogotá en
        Redis; zona propia y vuelta a la de la empresa; cambiarla en Ajustes
        mueve el horario; zona inválida → 400).

  - [x] **Vista previa con la hora REAL + filtro de rollups en la zona de la
        empresa (v0.1.264, feedback del usuario con captura)**: (a) la vista
        previa de Ajustes → Formato regional mostraba un ejemplo FIJO
        («1.234.567,89 · 31/12/2026 · 2:30 p. m.») debajo de la zona elegida, y
        se leía como si fuera la fecha y hora actuales. Ahora dice «Vista
        previa · ahora en Colombia (Bogotá)» y muestra **la fecha de hoy y la
        hora actual de esa zona** (`formatZonedNow`, se refresca cada 15 s y
        cambia en vivo al elegir otra zona), cada dato con su etiqueta, y el
        número queda rotulado como ejemplo; se quitó el «Ahora son las…» suelto
        (con un reloj distinto al de la vista previa). (b) El pendiente que dejó
        v0.1.263: el **filtro de un rollup** («cuántas tareas vencen hoy»)
        calculaba «hoy» en UTC; ahora usa la zona de la empresa (el plan del
        rollup la lee una vez por lista y sólo si algún rollup filtra). 1 test
        de integración (rollup con «hoy» en Kiritimati vs Pago Pago) + 3
        unitarios — 235 front en verde — + E2E navegador 13/13 (navegador en
        Madrid y la vista previa con la fecha y hora de Bogotá, cambio de zona
        en vivo, claro/oscuro, celular sin desborde).

  - [x] **Editor de correos + firma visible (v0.1.265, ADR-S34, pedido del
        usuario: "el email es un campo de texto muy básico; quiero diseños más
        elaborados, totalmente compatibles con Gmail y Outlook, y no vi dónde
        incluir la firma")**. (a) **Diseño visual por bloques** en la acción
        «Enviar email»: el contenido pasa a tener tres formatos —**Diseño
        visual** (recomendado), Texto y HTML— y el diseño se arma en un editor a
        pantalla completa: bloques a la izquierda (título, texto con formato,
        botón, imagen, datos del registro, columnas, separador, espacio, firma,
        HTML propio) más el **estilo general** (colores, tipografía del sistema,
        ancho, esquinas); al centro **el correo real** —el mismo HTML que sale—
        en escritorio o celular, con las variables como pastillas o **resueltas
        contra un registro de la lista** («Ver con datos de un registro»); a la
        derecha los ajustes del bloque elegido (click en la vista previa lo
        selecciona). Deshacer/rehacer, 7 plantillas de arranque (simple, aviso
        con botón, notificación con datos, recordatorio de pago con
        `{{pago.link}}`, bienvenida, novedades) que adoptan el color de la
        marca, y en celular pestañas Bloques/Vista previa/Editar. El texto se
        escribe como en Gmail (negrita, cursiva, subrayado, listas, cita,
        enlaces, color) con un botón «Variable». El bloque **Datos del
        registro** muestra los campos elegidos con el valor como se lee en la
        ficha (montos con los separadores de la empresa, fechas en su formato y
        zona, etiquetas de opciones, Sí/No, nombres de personas). (b)
        **Compatibilidad** (`renderEmailHtml`, shared, misma función en la
        vista previa y en el envío): tablas `role="presentation"`, estilos
        inline, ancho fijo con condicional `<!--[if mso]>` para Outlook,
        columnas híbridas que se apilan solas en el teléfono, botones con
        `bgcolor` en la celda, fuentes del sistema, preheader oculto y la parte
        de **texto plano** del multipart (`renderEmailText`). Todo se escapa
        (texto y valores) y las URLs se validan después de resolver las
        variables. Se guarda el MODELO, no el HTML; un diseño inválido se
        rechaza al guardar (400 `invalid_email_design`). (c) **Firma visible**:
        casilla «Agregar la firma al final del correo» + «Firma de» (cualquier
        persona del equipo; leída al enviar, así si la cambia se actualiza), con
        su vista previa y el enlace para editarla; en diseño se ubica con el
        bloque «Firma». Si la persona ya no es del equipo o no tiene firma, el
        correo sale igual y el run lo dice. Se fue el botón que pegaba HTML en
        el cuerpo. (d) **La firma se edita en VISUAL** en Ajustes → Firma de
        email (negrita, color, enlaces, imagen/logo), con modo HTML para quien
        la tenía armada a mano (una firma con tablas abre directo en HTML para
        no simplificarla). (e) **Enviarme una prueba**: el correo armado con el
        mismo compositor del motor y el último registro de la lista llega a la
        casilla de quien prueba (sólo a esa). (f) Imágenes subidas con **URL
        pública de 5 años** (`POST /files/:id/public-url`, sólo PNG/JPG/GIF/
        WebP): un correo se relee mucho después. (g) Plantillas de
        automatizaciones y migrar una empresa traducen los campos del bloque
        de datos y la persona de la firma. **Bug de paso**: el lockfile tenía
        DOS `prosemirror-model` (1.25.11 y 1.25.12, desde v0.1.202 vía
        prosemirror-view) y el editor de texto tiraba "multiple versions of
        prosemirror-model were loaded" al escribir; override a una sola versión.
        13 tests en shared (escape, URLs, estructura Outlook/Gmail, texto plano,
        firma limpia, formato regional, plantillas), 5 del editor y 2 de
        integración del motor (correo diseñado con datos/firma/texto; diseño
        inválido, prueba sin enviar, firma de alguien que no es del equipo) +
        E2E navegador 24/24 (galería, vista en vivo, click para elegir,
        deshacer, negrita, tipografía, celular, datos reales, firma, guardado,
        prueba enviada, firma visual en Ajustes, teléfono sin desborde).

  - [x] **Documentos PDF: cuentas de cobro desde la ficha y las
        automatizaciones (v0.1.266, ADR-S35, pedido del usuario: "crear PDF en
        automatizaciones y enviarlo adjunto por correo… con editor y plantillas
        — arrancá con la fase 1, primero cuenta de cobro")**. (a) **Plantillas
        por lista** (`document_templates`, migración 0067, RLS) con un modelo
        por bloques (`docDesignSchema` en shared): encabezado con logo y datos
        de quien cobra, título, texto con formato, datos del registro, **tabla
        de ítems** (las filas son los registros VINCULADOS por una relación, en
        cualquier sentido y con el ACL de quien genera), **totales** (suma de
        una columna, un campo, porcentaje de otra fila, suma con restas o texto
        — cada fila queda como `{{totales.<id>}}`), imagen, separador, espacio,
        salto de página, firma y columnas; hoja carta/A4/oficio, márgenes y pie
        con «Página x de y». (b) **Render en el servidor con pdfmake** (JS puro,
        sin Chromium, sin red ni disco; imágenes PNG/JPG ≤3 MB validadas por
        magic bytes; tope 8 MB): una cuenta de cobro pesa ~30 KB y tarda
        100-450 ms. La MISMA función arma la vista previa, el botón de la ficha
        y la automatización. (c) **Editor visual** a pantalla completa
        (Ajustes de la lista → **Documentos**): bloques a la izquierda, **el
        PDF real** al centro (pdf.js a canvas, con zonas clickeables que
        seleccionan el bloque), inspector a la derecha, datos de un registro
        elegible o las variables a la vista, deshacer/rehacer, «Abrir PDF» y
        celular por pestañas. (d) **Plantillas de arranque**: «Cuenta de cobro»
        y «Cuenta de cobro con detalle» (ítems de una lista vinculada) — se
        eligen los campos por rol (cliente, NIT, concepto, valor…) con
        sugerencia automática, y los datos de quien cobra (documento, banco,
        cuenta, ciudad) se recuerdan; traen «Son: … PESOS M/CTE.», forma de
        pago, la nota de no responsable de IVA y la firma. Lo que no se mapea
        queda visible como «[Nombre del cliente]». (e) **Variables legibles**
        por defecto (montos con los separadores de la empresa, fechas en su
        formato, etiquetas de opción) y modificadores nuevos `|letras`,
        `|pesos` («un millón doscientos cincuenta mil pesos», «con 50/100»),
        `|larga` («8 de octubre de 2026») y `|mayusculas`, que también valen en
        correos y webhooks. (f) **Automatizaciones**: acción **«Generar un
        PDF»** (plantilla, guardarlo opcional en un campo Archivo —cuenta
        contra el almacenamiento del plan— y `{{pdf.link}}`/`{{pdf.nombre}}`
        para el paso siguiente, p. ej. un WhatsApp) y **«Adjuntar PDF»** en
        «Enviar email» (hasta 5; si una acción anterior ya generó esa
        plantilla, se reusa); «Enviarme una prueba» manda el correo con los
        adjuntos. Los adjuntos salen por SMTP, Gmail (multipart/mixed) y
        Microsoft Graph (fileAttachment, con tope de 3 MB que se avisa en vez
        de truncar). (g) **«Generar PDF» en la ficha** (página y modal): por
        plantilla, descargar o «Guardar en «Documento»». (h) Borrar una
        plantilla que usa una automatización → 409 con la lista; la plantilla
        viaja en la migración de empresa; el asistente/MCP las ve en
        `get_list_schema` y conoce la acción. **Fixes en el camino**: el
        sistema no podía guardar un archivo (`attachments.created_by` era NOT
        NULL con FK a users y el motor no tiene usuario); la zona del último
        bloque en la vista previa se estiraba hasta el pie de la hoja (marca de
        fin de alto cero); el worker de pdf.js sale como `.js` porque nginx no
        conoce `.mjs`; y pdf.js va en la 6.3 (la 5.7 tenía un aviso high de
        ejecución de JS al abrir un PDF malicioso). **No es factura electrónica DIAN** (eso exige XML UBL
        firmado). Tests: 20 de números en letras + 4 de plantillas en shared,
        8 de documentos en la API (variables, totales con porcentajes/restas/
        ciclos, RLS, vista previa con ítems sólo de esa cuenta, guardar en un
        campo, motor con adjunto y `{{pdf.link}}`, 409) + 1 de adjuntos en
        Gmail/Graph — 1002 API, 240 front y 171 shared en verde — + E2E
        navegador 17/17 (galería → mapeo sugerido → editor con el PDF real →
        click en la tabla → guardar → descargar y guardar desde la ficha →
        acción y adjunto en el editor de automatizaciones → celular) y la vista
        previa contra el build de producción sin violaciones de CSP.
        Fase 2: consecutivo atómico, QR y descarga desde el portal.

  - [x] **Documentos PDF — fase 2: consecutivo, QR y portal (v0.1.267,
        ADR-S35, "continuá con lo que falta")**: (a) **numeración por
        plantilla** («Hoja y estilo» → Numeración: prefijo, dígitos, desde qué
        número y un campo de texto opcional donde guardarlo). Un número por
        (plantilla, registro) en `document_numbers` (migración 0068, RLS,
        únicos por registro y por número): se EMITE la primera vez que el
        documento se genera de verdad —ficha, automatización o portal—
        bloqueando la plantilla (`FOR UPDATE` sobre `next_number`) y se REUSA
        al regenerar; la vista previa sólo mira el próximo (`template_id` en
        el preview) y si la transacción revierte el número queda libre. El
        texto formateado («CC-0042») se guarda al emitir. Variables
        `{{documento.numero}}` (documento) y `{{pdf.numero}}` (acciones que
        siguen a «Generar un PDF»); la cuenta de cobro de la galería lo trae
        encendido salvo que la lista ya tenga su campo de número. Guardado en
        un campo: el MISMO PDF que lo emite ya lo muestra (bug atrapado en el
        E2E: el registro se leía antes de emitir) y el motor lo refleja en su
        copia del registro para que una acción posterior no lo pise. (b)
        **Bloque QR** nativo de pdfmake con variables (link de pago, web,
        número): configurado pero vacío para un registro no se dibuja, sin
        configurar se ve el hueco. (c) **«Tus documentos» en el portal del
        cliente**: casilla «Disponible en el portal del cliente» por plantilla;
        `portal.me` lista las publicadas y `GET /portal/me/documents/:id` arma
        el PDF SIEMPRE con el registro del acceso (no publicada, de otra lista
        o de otra empresa → 404; sin sesión de portal → 401); bajarlo emite el
        número igual que la ficha. (d) Insignias «Próximo CC-0100» y «Portal»
        en el panel de plantillas, aviso con el número al generar desde la
        ficha, `get_list_schema` del asistente/MCP muestra `in_portal` y el
        próximo número, y `document_numbers`/`next_number`/`portal_visible`
        viajan en la migración de empresa (y se borran con ella). 5 tests de
        integración nuevos (numeración con concurrencia y rollback,
        automatización numerada, QR, portal) + 1 del front + E2E navegador
        18/18.

  - [x] **Almacenamiento propio por empresa + enlace del PDF sin guardarlo
        (v0.1.268, ADR-S36, pedido del usuario: "que estos PDF no gasten
        espacio en el servidor… que se guarden en Google Drive o algún S3 y
        ahí no cuenten para el plan" → "hacé las dos juntas, S3 primero y
        después Drive")**: (a) **`{{pdf.link}}` sin archivo**: sin «Guardar
        en», la acción «Generar un PDF» deja un enlace firmado de 30 días
        (`/api/v1/public/documents/:plantilla/:registro`, HMAC con scope
        `doc`) que ARMA el PDF al abrirlo — cero bytes en disco; muestra los
        datos del momento (el número emitido no cambia). La ficha gana
        **«Copiar enlace (30 días)»** en el menú «Generar PDF». Firma
        alterada, vencido, otra empresa o registro de otra lista → el mismo
        404 opaco. (b) **«Almacenamiento S3»** en la galería de
        Integraciones (una sola integración para AWS, Backblaze B2, Cloudflare
        R2, Wasabi, DigitalOcean Spaces, MinIO): conectar sube, lee y borra
        un archivo de prueba — una credencial que no sirve no se guarda.
        (c) **Ajustes → Almacenamiento** (admin): servidor de la plataforma
        o el bucket propio (conexión del EQUIPO; `tenants.settings.storage`),
        uso por lugar, y **mudanza por tandas** en los dos sentidos con
        progreso (volver al servidor respeta el espacio del plan; lo que
        falla queda donde estaba y se lista). (d) **Cada archivo recuerda
        dónde quedó** (`attachments.storage_connection_id`, migración 0069):
        cambiar de elección no rompe nada; la URL firmada propia redirige
        (302) a un enlace prefirmado de 15 min del bucket — ni disco ni ancho
        de banda del servidor; las lecturas internas (imágenes del PDF,
        exportar empresa) van por la conexión de cada fila. (e) **Fuera del
        plan**: cupo, Plan y uso y la consola cuentan sólo lo de la
        plataforma. (f) **Nada en silencio**: bucket caído → la subida FALLA
        (503) en vez de caer al servidor; la conexión elegida o con archivos
        no se borra ni desconecta (409) y no se le cambia bucket/dirección/
        carpeta; borrar la empresa no toca su bucket; migrar la empresa trae
        los bytes y avisa. (g) SSRF: https obligatorio, literal privado
        rechazado y `guardedLookup` (`STORAGE_ALLOW_PRIVATE_HOSTS` para un
        MinIO interno); checksums del SDK sólo `WHEN_REQUIRED` (Backblaze y
        otros rechazan los CRC32 por defecto desde la 3.729). **Bugs de paso**:
        `deleteTenant` borraba conexiones antes que adjuntos (la FK nueva lo
        habría trabado) y el estado del panel se quedaba cacheado tras
        conectar el bucket en otra pantalla (lo atrapó el E2E). 7 tests
        (1 puro + 6 de integración contra un S3 en proceso: en CI no hay
        MinIO) + 1 del enlace en documentos + 2 del front, y E2E navegador 24/24 contra
        **moto** (emulador real de la API de S3): conectar, bucket inexistente
        rechazado, elegir, mover 15 archivos al bucket, PDF guardado en el
        bucket y bajado sin sesión por redirección, logo servido desde el
        bucket, «Copiar enlace» sin archivo, desconectar rechazado, volver al
        servidor y borrar, celular.

  - [x] **Google Drive como almacenamiento propio (v0.1.269, ADR-S36, segunda
        mitad del pedido "S3 primero y después Drive")**: integración
        **Google Drive** en la galería (OAuth con la app de Google del
        operador, permiso **`drive.file`** — no sensible: la app sólo ve los
        archivos que ella crea). Se elige en Ajustes → Almacenamiento como el
        bucket: los archivos van a una carpeta **«Imagina Base»** del Drive de
        la empresa (se busca o se crea y se recuerda en la conexión; si la
        borran, se crea de nuevo), con su **nombre real** (no la clave
        interna), y no cuentan para el plan. Como Drive no tiene enlaces
        prefirmados, la descarga pasa por el servidor con el token de la
        empresa (streaming). La interfaz de storage ganó `writeKeyed` (Drive
        asigna su propio id: clave `gdrive:<id>`) y la mudanza reescribe la
        clave al pasar entre lugares. **Elegir un almacenamiento ahora sube,
        lee y borra un archivo de prueba** (Drive o S3) antes de aceptarlo.
        Un Drive con archivos **no se re-autoriza con otra cuenta de Google**
        (quedarían en el Drive anterior). Errores de Google en criollo (token
        rechazado → reconectar, Drive lleno, límite de pedidos). La guía de
        verificación de Google suma la Drive API, la justificación de
        `drive.file` y el paso del video; la política de privacidad sugerida
        lo menciona. Env `GOOGLE_DRIVE_API_URL` (sólo para tests). 5 tests de
        integración contra un Drive falso en proceso (token rechazado, carpeta
        creada y recordada, subida/descarga con nombre real, carpeta borrada
        que se recrea, Drive lleno, mudanza en los dos sentidos, borrar y
        desconectar bloqueados) + E2E navegador 12/12 contra un Drive falso
        (la conexión real con Google no alcanza el sandbox).

  - [x] **Editor de correos revisado: arrastrar y soltar, celular y modo oscuro
        (v0.1.270, reporte del usuario: "no es drag and drop, la vista
        responsive no funciona, no hay cómo ver el modo oscuro; revisalo
        completo")**. (a) **Arrastrar y soltar**: los bloques del panel se
        sueltan donde se quiera en la vista previa (una línea marca dónde caen)
        o en el esquema; los bloques se reordenan arrastrándolos en cualquiera
        de los dos, y entran/salen de las columnas (sólo los simples:
        «Datos del registro», firma o HTML sobre una columna caen al primer
        nivel). Operaciones puras con tests (`insertAt`/`moveTo`/`canDrop`/
        `isNoopDrop` — el índice se cuenta sobre la lista original, como lo
        muestra la línea) y la resolución de la posición también pura
        (`emailDnd.resolveDrop`, por las cajas de los bloques y las columnas,
        que el renderizador marca con `data-ib-col` sólo en la vista previa).
        Los listeners viven en la app y se re-ponen tras cada escritura del
        iframe (que no ejecuta scripts). En el teléfono sigue el tocar para
        agregar. (b) **La vista de celular no funcionaba porque el CORREO no
        era responsive**: la imagen fijaba su tabla con `width="600"` y en un
        teléfono el correo quedaba más ancho que la pantalla — también los
        correos reales. Ahora la imagen es fluida (`width:100%;max-width`,
        conservando el `width` del atributo para Outlook de Windows), el marco
        del celular mide 375 px reales y los títulos se achican en pantallas
        chicas. (c) **Modo oscuro**: botón sol/luna en el editor; el tema gana
        `dark` (apagado = lo de siempre) y, encendido, el correo declara
        `light dark` y un `@media (prefers-color-scheme: dark)` (+ los
        selectores de Outlook.com) cambia sólo lo pintado con los colores del
        tema — lo coloreado a mano y las bandas conservan sus colores. Sin
        colores propios, la vista previa simula lo que hacen Gmail/Outlook
        (invierten los claros) con un aviso; con colores propios los muestra.
        Addendum de ADR-S34. (d) **Revisión**: barra flotante del bloque
        elegido en la vista previa (subir/bajar/duplicar/eliminar), atajos
        Supr / Ctrl+D / Alt+↑↓ / Esc / Ctrl+Y, y **los atajos andan con el foco
        dentro de la vista previa** (es otro documento: antes Ctrl+Z dejaba de
        funcionar después de tocar un bloque); el enlace del texto se edita en
        un popover (antes `window.prompt`); el esquema muestra un resumen de
        cada bloque y las columnas con su contenido; subir/bajar se deshabilitan
        en los bordes; ayuda de atajos en el panel vacío. Tests: 17 del front
        (operaciones, resolución de la posición, modo oscuro de la vista
        previa) y 4 de shared (imagen fluida, modo oscuro con bandas y colores
        propios, diseño viejo sin `dark`, marcas de columna sólo en la vista
        previa) — 255 front y 176 shared en verde — + E2E navegador 23/23
        (soltar del panel debajo del título, reordenar en la vista previa y en
        el esquema, columnas, «Datos del registro» que no entra en una columna,
        barra flotante, Supr y Ctrl+Z con el foco en la vista previa, celular
        375 px sin scroll lateral con columnas apiladas, simulación y colores
        propios de modo oscuro, enlace por popover, guardado y editor en un
        teléfono). **Límite de la verificación**: el driver de mouse de
        Playwright se cuelga si el arrastre arranca DENTRO de un iframe, así
        que ese caso se probó con eventos de arrastre del navegador; del panel
        al iframe y en el esquema se arrastró con el mouse.

  - [x] **El menú de acciones ya no se sale de la pantalla (v0.1.271, reporte
        del usuario con captura: "el selector de automatizaciones se sale de la
        pantalla y arriba no hay cómo seleccionar las opciones que no se
        ven")**. El menú compartido (`DropdownMenuContent`) ya se limitaba al
        espacio que Radix calcula como disponible
        (`--radix-dropdown-menu-content-available-height`), pero el menú de
        tipos de acción le pasaba un `max-h-[70vh]` propio que lo PISABA: con
        el disparador abajo en la pantalla (el «+ Añadir» del lienzo) el menú
        se abría hacia arriba más alto que el espacio que había y su parte
        superior quedaba fuera de la ventana, sin forma de alcanzarla. Ahora el
        tope es el MENOR de los dos (`min(70vh, var(--…available-height))`) en
        el menú de acciones, su selector, el menú de columnas, el de agrupar y
        el «+ Bloque» del editor de la ficha (el mismo patrón). E2E navegador
        9/9 en 1047×939 (la captura), 1280×640 y 390×844 táctil: el menú entra
        entero, la primera opción se ve y se puede tocar, la última se alcanza
        scrolleando — y con el código anterior el mismo E2E daba 3/9 (el menú
        arrancaba 99 px por encima del borde, exactamente la captura).
        **En el mismo release, corrección de rumbo del usuario** ("del modo
        oscuro no me refería al correo sino a la interfaz de la app"): el
        sol/luna que v0.1.270 puso en la cabecera del editor de correos
        oscurecía la VISTA PREVIA del correo, y lo que faltaba era el modo
        claro/oscuro de la APP — los editores a pantalla completa tapan la
        barra superior, así que para ver el editor en el otro modo había que
        salir. Ahora `components/ThemeToggle.tsx` (el mismo botón de la barra
        superior, que también lo usa) va en la cabecera del editor de
        correos, del de documentos PDF y del de la ficha/portal. La simulación
        del correo en modo oscuro (y los colores propios para Apple Mail /
        Outlook) queda donde corresponde: Estilo general → Modo oscuro, con
        «Ver cómo lo oscurecen Gmail y Outlook» y «Volver a la vista normal»
        en el aviso. E2E navegador 18/18 (el botón está en los tres editores,
        pasa la app a oscuro sin salir, la interfaz queda oscura y el correo
        conserva su tono, la simulación del correo es independiente del tema
        de la app).

  - [x] **Diseño por bloque en correos y PDF: tipografía, espaciado, bordes y
        fuentes (v0.1.272, ADR-S37, pedido del usuario: "al editor de correos le
        faltan opciones de tipografía con campos numéricos, margin y padding,
        borde, grosor de letra, varias tipografías, radio y sombra en los
        botones… revisá qué es compatible con los correos y con el PDF")**.
        (a) **Una capa de estilo común** a los dos editores (`blockStyleSchema`
        en shared): fuente, tamaño, peso (normal/semi/negrita/extra), itálica,
        interlineado, espaciado entre letras y mayúsculas; margen arriba/abajo y
        relleno por lado; borde con grosor, tipo (continua/rayada/punteada),
        color y lados; esquinas y sombra; y en el correo si el fondo es banda de
        borde a borde o recuadro. Opcional: un bloque sin estilo sale igual que
        antes. (b) **Por bloque**: el botón gana su forma (relleno, ancho fijo,
        esquinas, borde, sombra), la imagen su marco, el texto el espacio entre
        párrafos, el separador tipo y largo de línea con alineación, «Datos del
        registro» colores y ancho de los nombres y línea entre filas, y las
        columnas proporción (1:2, 2:1, 1:3…), separación, alineación vertical,
        "no apilar en el celular" y fondo/recuadro por columna. (c) **Estilo
        general**: fuente del texto y de los títulos, tamaño base, interlineado,
        color de títulos y enlaces, margen lateral, aire alrededor, y borde y
        sombra de la hoja; en el PDF, fuente del documento y de títulos +
        interlineado. (d) **Compatibilidad, revisada control por control**: lo
        que el medio no dibuja no se ofrece (el PDF no tiene esquinas
        redondeadas ni sombras) y lo que se ve distinto lleva su aviso en el
        panel (Outlook de Windows: esquinas rectas, sin sombra, seminegrita como
        negrita). En el correo todo va en estilos en línea sobre la celda,
        interlineado en px para Outlook y títulos grandes que se achican en el
        teléfono. (e) **19 tipografías**: 8 del sistema (se ven igual en todos
        lados) y 11 web de Google Fonts (Inter, Roboto, Open Sans, Lato,
        Montserrat, Poppins, Nunito, Raleway, Playfair, Merriweather, Lora) —
        Apple Mail, iPhone, Outlook de Mac, Samsung y Thunderbird las cargan;
        Gmail y Outlook de Windows muestran la de respaldo (forzada para Outlook,
        que si no cae a Times). **Van incluidas en el repo**
        (`scripts/vendor-fonts.mjs`, licencias libres): WOFF para el PDF —que
        las EMBEBE todas, las del sistema con su equivalente de mismas medidas
        (Arial→Arimo, Times→Tinos…)— y WOFF2 para la vista previa del editor,
        que muestra exactamente la fuente que verá quien lo reciba sin tocar la
        CSP. (f) **Interfaz** compartida (`components/design/
        DesignStyleControls.tsx`): números tipeables con unidad (px en el
        correo, pt en el PDF; vacío = automático, ↑/↓), selector de fuentes con
        cada una escrita en sí misma, secciones plegables con "restablecer",
        relleno con candado de 4 lados, y **copiar/pegar el diseño** de un
        bloque a otro (también entre correo y PDF). El release copia las fuentes
        del PDF al bundle. Tests: 14 en shared (schema, caja, borde por lado,
        tipografía, fuente web con respaldo de Outlook, columnas, tema), 4 del
        PDF (fuentes embebidas, caja/columnas, proporciones) y 2 del front —
        190 shared y 257 front en verde — + E2E navegador 23/23 del correo (también
        contra el build de producción con su CSP: fuente cargada, cero
        violaciones), 10/10 del PDF y 4/4 en el celular.

  - [x] **Editores de correo y PDF más claros (v0.1.273, feedback del usuario:
        "algunos ajustes quedaron dobles, como los de tipografía; la
        experiencia es confusa y el visor de jerarquía está debajo de los
        bloques")**: (a) **un ajuste, un lugar** (addendum ADR-S37): el tamaño
        rápido (Grande/Mediano/Chico del título, Chica/Normal/Grande del texto)
        y el exacto en px/pt comparten fila dentro de «Texto» — el atajo se
        marca sólo sin exacto y elegirlo lo borra en el mismo cambio —; el
        color del texto y la alineación pasaron a «Texto»; el color de fondo y
        «banda o recuadro» juntos en «Fondo»; el «Espacio arriba y abajo» y los
        márgenes/relleno exactos juntos en «Espaciado» (en el PDF, «Relleno con
        el fondo»); el botón y la imagen con su borde en su propia sección (el
        «Borde» del bloque se oculta salvo que ya se haya usado). Se fueron
        «Fondo y espacio» y «Recuadro». (b) **Contenido / Estilo**: el panel
        del bloque se parte en dos pestañas que se recuerdan al cambiar de
        bloque; un bloque nuevo abre en Contenido; separador (todo estilo) y
        espacio/salto (todo contenido) no muestran pestañas; un bloque dentro
        de columnas muestra «Columnas · columna N» para volver. (c) **Estructura
        en su pestaña**: Agregar · Estructura (con contador) · Estilo general
        (en el PDF, Hoja y estilo); el árbol ya no vive debajo de la paleta,
        explica qué es y tiene estado vacío. (d) **Un solo control de color**
        (`ColorField` con colores rápidos, «Otro color…» y «Sin color»; sin
        color propio muestra el heredado punteado) en los dos editores, y
        «Estilo general» en secciones plegables (Colores · Texto · Hoja · Modo
        oscuro). Las secciones son piezas componibles de `DesignStyleControls`
        y los atajos, funciones puras (`inspectorPresets.ts`). (e) Entorno de
        desarrollo: `.env.example` con `MAIL_FROM` entre comillas (el script
        lo carga con `.` y no arrancaba el API) y `create-superadmin.sh` crea
        el usuario directo en la base (el alta pública rechaza emails de
        superadmin, SEC-04). 7 tests nuevos (264 front en verde) + E2E
        navegador 28/28 del correo, 15/15 del PDF y 4/4 en el celular.

  - [x] **Dependencias de producción en cero, otra vez (v0.1.274, ADR-S38)**:
        `pnpm audit --prod` daba 4 avisos (2 high) publicados después de
        v0.1.244. (a) **`@modelcontextprotocol/sdk` 1.30 → 1.31** (el aviso es
        del CLIENTE OAuth del SDK, que podía mandar credenciales a un servidor
        de autorización elegido por el servidor MCP; nosotros usamos el
        servidor, pero se sube igual). (b) **`tailwindcss-animate` pasa a
        `devDependencies`**: es un plugin de compilación y, estando en
        `dependencies`, arrastraba a Tailwind al árbol de producción con
        `braces` (DoS sin parche) y `postcss-selector-parser`; el CSS del build
        sigue trayendo las animaciones. (c) **`sprintf-js`** (vía
        mssql→tedious) no tiene versión arreglada y tedious lo llama sólo con
        formatos LITERALES (el DoS necesita controlar el formato) → excepción
        por id en `pnpm.auditConfig.ignoreGhsas`, con la regla nueva de
        ADR-S38: producción en 0, herramientas de build/test en dev, y
        excepciones sólo sin parche, verificadas como no explotables, por id y
        anotadas en CONTINUIDAD con la condición para sacarlas. De paso, los
        dos pins propios de `brace-expansion` (v0.1.114) habían quedado ellos
        mismos vulnerables (sólo ESLint/Testcontainers): 1.1.20 y 2.1.6.
        Verificación: lint y tipos en 0, build del front con las animaciones en
        el CSS, suite completa de la API en verde, specs de MCP/OAuth 48/48 con
        el SDK nuevo y MCP en vivo por HTTP (initialize, las 8 herramientas de
        lectura, `list_lists`, 401 sin token y 405 por GET). Quedan avisos sólo
        en herramientas de desarrollo (vite/vitest exigen versión mayor).

  - [x] **Formularios públicos que crean registros (v0.1.275, ADR-S39,
        primera de las tres ideas elegidas por el usuario de la ronda de
        "qué más le podemos hacer")**: cada lista puede tener formularios
        (Ajustes de la lista → **Formularios**) que cualquiera llena desde un
        enlace —o insertado en un sitio— y cada respuesta llega como un
        registro. (a) **Modelo** (`formConfigSchema` en shared, tabla `forms`
        con RLS, migración 0070): preguntas que apuntan a campos por ID (16
        tipos: texto, número, moneda, selección —botones o lista según la
        cantidad—, varias opciones, fecha, casilla, email, enlace, teléfono,
        calificación, porcentaje, duración y archivos), títulos de sección y
        textos; por pregunta etiqueta, ayuda, ejemplo, obligatoria, oculta
        (se completa desde la dirección: `?nombre=Ana`) y **condición** sobre
        una pregunta anterior (es/no es/alguno de/contiene/mayor/menor/vacía),
        que se encadena. Ajustes: título, descripción, botón, gracias o
        redirección https, "enviar otra", cierre por fecha o por cupo, color,
        logo de la marca, prefill y dominios donde se puede insertar.
        (b) **Página pública servida por el API** (`/api/v1/public/f/:token`)
        y no por el SPA —el proxy prohíbe encuadrar la app y un formulario se
        inserta en sitios ajenos—, con su propia CSP (script con nonce,
        `frame-ancestors` desde los dominios elegidos), DOM armado sólo con
        `textContent`, números leídos con el formato de la empresa (y
        tolerante: «1.500.000» es un millón y medio en cualquier formato),
        subida de archivos y pantalla de gracias. El token es la credencial:
        desconocido/despublicado/empresa archivada → el mismo 404 opaco.
        (c) **El servidor no le cree al navegador**: toma sólo las preguntas
        que deben verse según las condiciones, revalida obligatorios y cada
        valor con el validador compartido, y crea el registro por
        `RecordsService.create` (límite del plan, actividad, realtime);
        errores por pregunta. (d) **Anti-abuso sin captcha**: campo trampa,
        sello HMAC con mínimo 2,5 s entre cargar y enviar, límites en Redis por
        IP y por formulario, y archivos atados al formulario por un token de
        6 h (los no enviados se borran solos). Cerrado en solo-lectura
        (ADR-S09), por fecha o por cupo; las listas de una tienda no tienen
        formularios. (e) **Constructor a pantalla completa**: preguntas a la
        izquierda (agregar campos, títulos y textos; reordenar arrastrando),
        **la página real** al centro como vista previa (alimentada por
        postMessage con la misma función que usa el servidor; muestra
        atenuadas las condicionales y ocultas; click elige la pregunta),
        inspector a la derecha, deshacer/rehacer, aviso de campos que la lista
        exige y el formulario no pide, Publicar con el panel de enlace y
        código para insertar, modo claro/oscuro y celular por pestañas.
        (f) **Automatizaciones**: disparador «Cuando se envía un formulario»
        (cualquiera o uno puntual) con `{{formulario.nombre}}`; el
        asistente/MCP ve los formularios en `get_list_schema`. (g) Bitácora
        (publicar/despublicar/nuevo enlace/borrar), migración de empresa con
        dirección nueva avisada, y borrado de empresa. 15 tests de API
        (condiciones y visibilidad en cascada, saneo de la config, CSP y
        escape, envío con registro + automatización + contador, errores por
        pregunta, trampa y sello, límite por IP, cierre por cupo/fecha/
        solo-lectura, archivos y su limpieza, tienda, RLS, filtro por
        formulario en el motor) + 7 del front (operaciones del constructor) —
        1038 API, 271 front en verde — + E2E navegador 28/28 (crear, la
        vista previa refleja los cambios, condición, publicar, enlace e
        inserción, página pública sin sesión en celular con CSP y prefill,
        la condición muestra el NIT al elegir Empresa, error por pregunta,
        «1.500.000» guardado como 1500000, contador de respuestas, el
        disparador con su selector de formulario, constructor en celular).

  - [x] **«Mi trabajo» + bandeja de avisos (v0.1.276, ADR-S40, segunda de
        las tres ideas elegidas por el usuario)**: (a) **la campana es la
        bandeja**: avisos por destinatario en la tabla `notifications`
        (migración 0071, RLS, con `record_follows` y `reminders`) —te mencionan
        (comentario o descripción), te asignan un registro (un campo Persona
        pasa a valerte), comentan o cambian un registro que seguís, tus
        recordatorios—; "sin leer" en el servidor (antes, un timestamp en el
        localStorage de cada dispositivo), Todos/Sin leer, marcar todo, click
        lleva al registro, y llega al instante por una sala de realtime POR
        PERSONA (`user:{tenant}:{user}`, tema `notifications`). (b) **Cómo se
        generan**: el servidor escucha — comentarios y menciones de la
        descripción por `NotifyHub` (nuevo), cambios de campos por el
        `RecordChangeHub` (que ahora lleva `actorId`). Cada destinatario pasa
        por el ACL del registro, nadie recibe lo que hizo él, el rol `client`
        nada; de la descripción sólo avisan las menciones NUEVAS (el
        autoguardado las reescribe), y varios «cambió» sin leer del mismo
        registro se juntan en uno durante 30 min («Estado: Pendiente → En
        curso»). (c) **Seguir**: se sigue solo lo que se crea, se comenta o se
        tiene asignado, y con el botón «Seguir» de la ficha. (d)
        **Recordatorios** de un registro («Recordarme»: en 1 hora, hoy 17:00,
        mañana, en 3 días, el lunes u otra fecha, con nota) o sueltos; un
        scheduler de BullMQ por minuto los dispara una sola vez aunque haya
        varios nodos. (e) **«Mi trabajo»** (riel, `/my-work`, `GET /me/work` en
        un request): lo asignado en todas las listas con el ACL de cada una,
        sin lo terminado (por la etiqueta de la opción), agrupado en Vencido /
        Hoy / Próximos 7 días / Más adelante / Sin fecha con «hoy» en la zona de
        la empresa; pestañas Recordatorios y Siguiendo. (f) **Ajustes → Cuenta
        → Avisos**: qué llega también por correo (menciones, asignaciones y
        recordatorios encendidos por defecto; tope 10 por hora) y el **resumen
        diario** (apagado por defecto) a la hora y días elegidos en la zona de
        la empresa, sólo si hay algo — por el correo de la empresa y su cuota.
        Borrar la empresa o la cuenta limpia las tres tablas. **Bug atrapado en
        el E2E**: el interruptor del resumen era controlado por la respuesta
        del servidor y no se movía al tocarlo (otra vez la lección de
        v0.1.207) — la preferencia ahora es optimista. 14 tests de API
        (títulos, resumen de cambios, asignaciones, prefs, correos escapados +
        integración con Postgres y Redis: asignar avisa y manda correo, cambio
        a seguidores con detalle y agrupado, comentarios sin filtrar a quien no
        ve el registro ni al cliente, bandeja y aislamiento, preferencias y
        tope de correos, recordatorios de un solo disparo, «Mi trabajo»
        ordenado y sin lo terminado, resumen a su hora una vez por día) + 2 del
        front — API_COUNT API, 273 front y 190 shared en verde — + E2E
        navegador 20/20 (contador, comentario por realtime sin recargar, abrir
        el aviso lleva al registro y lo marca leído, «Siguiendo», recordatorio
        desde la ficha, grupos de «Mi trabajo», preferencias persistidas,
        marcar todo leído, celular).

## 6. Cómo trabajar con Claude Code en este repo

1. Leer este archivo + `STANDALONE.md` + `HANDOFF.md` antes de cualquier tarea.
2. Antes de implementar algo no cubierto por STANDALONE.md: proponerlo y
   actualizar el documento (ADR nuevo si es decisión de arquitectura).
3. Cada feature: schema Zod en shared → migración Drizzle (si aplica) →
   service+repo con tests → endpoint → frontend. En ese orden.
4. Marcar las fases del §5 al completarlas.
5. **Mantener `CONTINUIDAD.md` al día SIEMPRE** (pedido explícito del usuario,
   2026-10-05): en cada release, una entrada en su §11 «Bitácora» y, si
   cambia, su §10 «Estado actual / hilos abiertos». También anotar ahí las
   decisiones y pedidos importantes de la conversación aunque no generen
   release (ej. una pregunta que quedó esperando respuesta). Es el respaldo
   por si la conversación se pierde: lo que no esté escrito ahí, se pierde.
