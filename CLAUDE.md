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

- [ ] **F6 — Paridad total con el plugin** (brechas detectadas en la auditoría
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

- [ ] **F7 — Dashboards premium** (plan acordado con el usuario: motor
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

## 6. Cómo trabajar con Claude Code en este repo

1. Leer este archivo + `STANDALONE.md` + `HANDOFF.md` antes de cualquier tarea.
2. Antes de implementar algo no cubierto por STANDALONE.md: proponerlo y
   actualizar el documento (ADR nuevo si es decisión de arquitectura).
3. Cada feature: schema Zod en shared → migración Drizzle (si aplica) →
   service+repo con tests → endpoint → frontend. En ese orden.
4. Marcar las fases del §5 al completarlas.
