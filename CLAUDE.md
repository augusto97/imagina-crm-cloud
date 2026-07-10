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
- [ ] **F1 — Core dominio** (backend listo; falta front conectado):
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
- [ ] **F2 — Vistas + realtime** (en curso):
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
- [ ] **F3 — Automatizaciones + portal** (en curso):
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
  - [ ] Editor visual (drag&drop) del template del portal (front, F3+).
- [ ] **F4 — Comercial** (en curso):
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
        reactiva). Pendiente: planes editables en DB, detalle/impersonar empresa.
- [ ] **F5 — Hardening** (en curso):
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
  - [ ] PITR/WAL archiving en el gestor administrado.

## 6. Cómo trabajar con Claude Code en este repo

1. Leer este archivo + `STANDALONE.md` + `HANDOFF.md` antes de cualquier tarea.
2. Antes de implementar algo no cubierto por STANDALONE.md: proponerlo y
   actualizar el documento (ADR nuevo si es decisión de arquitectura).
3. Cada feature: schema Zod en shared → migración Drizzle (si aplica) →
   service+repo con tests → endpoint → frontend. En ese orden.
4. Marcar las fases del §5 al completarlas.
