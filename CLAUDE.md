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

- [ ] **F8 — Auditoría integral post-v0.1.112** (hallazgos de la revisión
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
        llegan al bundle de producción. 334 tests API en verde.
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

## 6. Cómo trabajar con Claude Code en este repo

1. Leer este archivo + `STANDALONE.md` + `HANDOFF.md` antes de cualquier tarea.
2. Antes de implementar algo no cubierto por STANDALONE.md: proponerlo y
   actualizar el documento (ADR nuevo si es decisión de arquitectura).
3. Cada feature: schema Zod en shared → migración Drizzle (si aplica) →
   service+repo con tests → endpoint → frontend. En ese orden.
4. Marcar las fases del §5 al completarlas.
