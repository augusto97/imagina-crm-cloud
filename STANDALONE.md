# Imagina Base — Aplicación SaaS Standalone

> **Imagina Base**: constructor de bases de datos flexibles como **aplicación
> SaaS multi-tenant**, desacoplado de WordPress. Nace del plugin Imagina CRM
> pero se reposiciona como herramienta de propósito general (Airtable /
> ClickUp / Notion-databases), no como CRM (ADR-S10). Una sola instalación
> operada por Imagina WP en infraestructura propia; cada cliente es un
> *workspace* (tenant) con suscripción.
>
> Este documento es para la app lo que `CLAUDE.md` es para el plugin: la
> fuente de verdad de arquitectura y decisiones. El plugin WP sigue vivo como
> producto hermano; ambos comparten el diseño de dominio (listas, campos
> dinámicos, slugs, vistas, automatizaciones) pero NO comparten código de
> backend.

---

## 1. Resumen

| | |
|---|---|
| **Producto** | Imagina Base (constructor de bases de datos flexibles) |
| **Modelo** | SaaS multi-tenant, suscripción por workspace |
| **Backend** | Node 22 + TypeScript + NestJS (adapter Fastify) |
| **Base de datos** | PostgreSQL 16 — schema compartido + `tenant_id` + RLS |
| **Datos dinámicos** | JSONB con índices GIN + índices por expresión (reemplaza tablas físicas del plugin — ver ADR-S02) |
| **Cache / colas** | Redis 7 + BullMQ |
| **Realtime** | WebSockets (invalidación push) — fase 2 |
| **Frontend** | El SPA React del plugin, adaptado (fork) |
| **Infra día 1** | 1 VPS (8 GB), Docker Compose, Caddy, backups a object storage |
| **Billing** | Stripe (evaluar dLocal/Wompi para LATAM) |

### Por qué existe (qué nos restringía WordPress)

1. **WP-Cron no confiable** → automatizaciones imprecisas. Cloud: workers + cron real.
2. **Sin WebSockets** → datos stale hasta recargar. Cloud: la UI se actualiza sola.
3. **Sin FTS decente** → índice BM25 casero sobre MySQL. Cloud: FTS nativo de Postgres.
4. **Bootstrap WP por request** (50–150 ms de overhead). Cloud: proceso persistente (1–5 ms).
5. **Una tabla MySQL por lista** — correcto para 1 sitio, inviable para miles de tenants.
6. **UI dentro de wp-admin** → hash router, prefijos CSS, bundle capado. Cloud: shell propio (referencia estética: dashboard de Cloudflare / Linear).

---

## 2. Stack tecnológico

### Backend
- **Node 22 LTS + TypeScript estricto** (`strict: true`, mismo estándar que el front).
- **NestJS con adapter Fastify** — módulos + DI por constructor: el mismo patrón
  Container/Service/Repository que ya usa el plugin, con tipos.
- **Drizzle ORM** para SQL tipado + fragmentos raw para las queries JSONB
  dinámicas (Prisma no encaja con SQL dinámico pesado).
- **Zod** para validación — **los mismos schemas se comparten con el frontend**
  vía package `shared/` del monorepo. Un shape, una definición, cero drift.
- **BullMQ** (Redis) para colas: automatizaciones, emails, exports, webhooks.
- **Socket.io** (`@nestjs/websockets`) para realtime.

### Frontend
- El SPA actual (React 18 + TanStack + Zustand + shadcn/Tailwind) **forkeado** al
  monorepo. Cambios:
  - `api.ts`: base URL + auth por token (adiós nonces).
  - `BrowserRouter` (adiós HashRouter).
  - Shell propio (login, selector de workspace, sidebar) — estética tipo
    panel Cloudflare, que era el objetivo original.
  - El prefijo `imcrm-` de Tailwind **se mantiene** por ahora (quitarlo toca
    cada archivo; no bloquea nada).
  - TanStack Query + persistencia IndexedDB → arranque instantáneo con
    revalidación en background.

### Monorepo
```
imagina-base/                    # dir del repo: imagina-crm-cloud (histórico)
├── apps/
│   ├── api/          # @imagina-base/api    — NestJS
│   └── web/          # @imagina-base/web    — SPA React (fork del plugin)
├── packages/
│   └── shared/       # @imagina-base/shared — Zod schemas + tipos front↔back
├── docker/           # compose files, Caddyfile
└── turbo.json        # pnpm workspaces + Turborepo
```

---

## 3. Modelo de datos (la decisión central)

### 3.1 JSONB en vez de tablas físicas

El ADR-001 del plugin (tabla MySQL real por lista) era correcto para una
instalación. En SaaS: miles de tenants × decenas de listas = cientos de miles
de tablas → backups lentos, migraciones imposibles, `information_schema`
degradada, DDL en runtime con locks.

**Reemplazo**: una tabla `records` universal con columna `data jsonb`.

```sql
CREATE TABLE records (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id   bigint NOT NULL REFERENCES tenants(id),
    list_id     bigint NOT NULL REFERENCES lists(id),
    data        jsonb  NOT NULL DEFAULT '{}',
    created_by  bigint NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);

CREATE INDEX idx_records_list    ON records (tenant_id, list_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_records_data    ON records USING gin (data jsonb_path_ops);
-- FTS sin columna extra (reemplaza el índice BM25 casero del plugin):
CREATE INDEX idx_records_fts     ON records USING gin (jsonb_to_tsvector('simple', data, '["string"]'));
```

### 3.2 Claves del JSONB: por field ID, nunca por slug

**Continuidad del ADR-008 del plugin** (doble identidad slug/físico): las
claves dentro de `data` son `"f{field_id}"` — inmutables. El slug del campo
sigue siendo editable y NUNCA toca los datos.

```jsonc
// record.data
{
  "f101": "CC Fundadores",        // text
  "f102": 1000000,                // currency (number nativo JSON)
  "f103": "activo",               // select (value de la opción)
  "f104": ["web", "hosting"],     // multi_select
  "f105": "2026-05-31"            // date (ISO)
}
```

Renombrar un slug = un UPDATE en `fields`. Cero migración de datos. Igual que
el plugin, misma regla de oro: *el slug es etiqueta humana, el ID es la verdad*.

### 3.3 Campos "indexados" (el `is_indexed` del plugin, versión Postgres)

Cuando el usuario marca un campo como indexado, se crea un índice por
expresión **sin lock** (via cola, no en el request):

```sql
-- number/currency:
CREATE INDEX CONCURRENTLY idx_f102 ON records (((data->>'f102')::numeric))
    WHERE list_id = 42 AND deleted_at IS NULL;
-- select/text/date:
CREATE INDEX CONCURRENTLY idx_f103 ON records ((data->>'f103'))
    WHERE list_id = 42 AND deleted_at IS NULL;
```

El `QueryBuilder` conserva su diseño del plugin (slug → field → expresión SQL
con whitelist estricta) compilando a expresiones JSONB tipadas
(`(data->>'fN')::numeric`, `::date`, etc.).

### 3.4 Tablas del sistema

Mismas entidades que el plugin, con `tenant_id` en todas:

```
tenants(id, slug, name, plan, settings jsonb, ...)
users(id, email, password_hash, name, locale, ...)
memberships(user_id, tenant_id, role)          -- roles: admin/manager/agent/viewer/client
lists(id, tenant_id, slug, name, icon, color, settings jsonb, position, ...)
fields(id, tenant_id, list_id, slug, label, type, config jsonb, is_required,
       is_unique, is_indexed, position, ...)   -- sin column_name: ya no hay columnas físicas
records(...)                                    -- §3.1
relations(id, tenant_id, field_id, source_record_id, target_record_id)
saved_views / saved_filters / comments / activity / slug_history
automations / automation_runs
dashboards
attachments(id, tenant_id, record_id?, storage_key, mime, size, ...)
```

`slug_history` y los redirects se conservan tal cual (funcionan igual).

### 3.5 Escala prevista (para no repetir la historia de ClickUp)

- **Particionamiento declarativo** de `records` por `tenant_id` (hash) cuando
  la tabla supere ~50M filas — el camino está pavimentado desde el día 1, no
  requiere re-arquitectura.
- `pg_stat_statements` activo desde el día 1: toda query > presupuesto se
  detecta antes de que duela.
- Cursor pagination (keyset) en todos los listados — nunca OFFSET profundo.

---

## 4. Multi-tenancy

**Schema compartido + `tenant_id` + Row-Level Security.** (No DB-por-tenant:
esa necesidad venía de las tablas dinámicas; con JSONB desaparece.)

```sql
ALTER TABLE records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON records
    USING (tenant_id = current_setting('app.tenant_id')::bigint);
-- (idéntico en lists, fields, saved_views, comments, ...)
```

La app setea `SET LOCAL app.tenant_id = :id` al inicio de cada transacción
(interceptor NestJS). **Defensa en profundidad**: aunque un bug de aplicación
olvide el `WHERE tenant_id`, Postgres no devuelve filas de otro tenant.

- Resolución del tenant: subdominio (`acme.imaginacrm.com`) o header en API.
- Plan enterprise futuro: instancia dedicada (mismo código, otra DB) — se
  vende como premium, no complica el core.

---

## 5. Auth y roles

- **Sesiones opacas en Redis** (token httpOnly cookie para el SPA + Bearer
  para API pública futura). Sin JWT stateless: revocación instantánea > moda.
- Login email/password + magic links (el portal del plugin ya los usa) +
  2FA TOTP en fase 4.
- **Roles por membership** — los mismos 5 del plugin: `admin`, `manager`,
  `agent`, `viewer`, `client`. La matriz de capabilities del plugin (Fase 7)
  se porta conceptualmente igual.
- El **portal del cliente** es el mismo concepto: usuarios rol `client`
  vinculados a un record, con template configurable. Ya no necesita
  shortcode — es una ruta pública del SPA (`/portal/...`).

---

## 6. Contrato REST

**Hereda los shapes del plugin** (`imagina-crm/v1`) donde tenga sentido — es
lo que permite migrar el frontend módulo a módulo casi sin tocarlo:

```
/api/v1/lists · /lists/{idOrSlug} · /lists/{list}/fields · /lists/{list}/records
/api/v1/lists/{list}/records/grouped-bundle   (el batch endpoint se conserva)
/api/v1/lists/{list}/views · /slugs/check · /slugs/history
/api/v1/dashboards · /automations · /portal/me
+ nuevos: /auth/* · /workspaces/* · /billing/* · /admin/* (panel interno)
```

Cambios respecto al plugin:
- Auth por sesión/Bearer (no `X-WP-Nonce`).
- **Endpoint `GET /bootstrap`**: workspace + listas + fields + views + user en
  UN request → primer paint con 1 round-trip (hoy son 4-5).
- Cursor pagination: `?cursor=` en vez de `?page=` (el shape de respuesta
  incluye `meta.next_cursor`).
- Validación con los MISMOS Zod schemas que usa el front (package `shared/`).

---

## 7. Realtime (fase 2)

**Qué es**: la UI se actualiza sola, sin recargar. NO es co-edición de texto
tipo Google Docs (eso sería CRDT — fuera de alcance, no lo necesita el
producto).

**Diseño — "invalidación push"** (barato, 90% del valor):

1. Toda mutación exitosa publica `{tenant_id, topic: 'records', list_id}` en
   Redis pub/sub.
2. El gateway Socket.io lo reenvía a los sockets suscritos de ese tenant.
3. El frontend invalida la query de TanStack correspondiente → re-fetch
   automático → el Kanban/tabla/dashboard se actualiza solo.

Casos que habilita: dos agentes viendo el mismo tablero se ven mover cards;
una automatización cambia un estado y la lista abierta lo refleja; el cliente
edita en el portal y el admin lo ve al instante.

Un **sync engine** completo (estilo Linear: replicación local + mutaciones
offline) queda explícitamente fuera del MVP — solo se considera si el producto
lo exige (ADR-S06).

---

## 8. Automatizaciones

El motor del plugin (triggers/actions/runs) se porta conceptualmente igual,
sobre infraestructura real:

- **BullMQ**: cada trigger encola un job; workers dedicados los procesan con
  retries + backoff + dead letter queue.
- `scheduled` y `due_date_reached` usan **repeatable jobs** de BullMQ — por fin
  precisos al minuto (adiós WP-Cron).
- `automation_runs` con logs, igual que el plugin.
- Webhooks salientes con firma HMAC + retries.

---

## 9. Búsqueda

- **Fase 1**: Postgres FTS (`jsonb_to_tsvector`, índice del §3.1) +
  `pg_trgm` para fuzzy. Reemplaza el motor BM25 casero del plugin.
- **Upgrade opcional** (si un tenant grande lo exige): Meilisearch self-hosted
  en el mismo VPS — indexación via cola, sin cambiar la API del front.

---

## 10. Archivos

- Object storage S3-compatible (Hetzner Object Storage / Cloudflare R2).
- Upload directo browser → storage con URLs prefirmadas (el API nunca
  proxy-ea bytes).
- `attachments` guarda metadata; antivirus scan en cola (fase 4).

---

## 11. Billing y planes

- **Stripe** + webhooks (evaluar dLocal/Wompi si el mercado CO/LATAM lo pide).
- Suscripción por workspace; límites por plan (nº de records, usuarios,
  automatizaciones/mes, storage) aplicados por un `PlanGuard` central.
- Trial 14 días sin tarjeta. El workspace nunca se borra al impagar: se
  degrada a solo-lectura (misma filosofía que ADR-007 del plugin: los datos
  del cliente son del cliente).

---

## 12. Infraestructura

### Día 1 (1 VPS 8 GB, ~€15/mes)
```
Caddy (TLS automático, wildcard *.imaginacrm.com)
 ├─ apps/api  (Node, stateless, ×1)
 ├─ apps/web  (estáticos servidos por Caddy)
 ├─ worker    (BullMQ, mismo build de api con flag)
 ├─ PostgreSQL 16
 └─ Redis 7
Backups: pg_dump diario + WAL → object storage (retención 30 días)
Monitoreo: Sentry (front+back) · uptime externo · pg_stat_statements
```

### Reglas para poder escalar sin re-arquitectura
1. **API stateless** (sesiones en Redis, archivos en object storage) — escalar
   = agregar contenedores tras un LB.
2. **Monolito modular** — módulos NestJS bien separados, UN deploy. Nada de
   microservicios (ADR-S05).
3. Socket.io con Redis adapter desde el día 1 (multi-nodo listo).
4. Migraciones siempre backward-compatible (deploy sin downtime).

---

## 13. Contratos de rendimiento (herencia endurecida del plugin §11)

| Métrica | Objetivo |
|---|---|
| GET /records, 100k filas, 2 filtros, cursor 50 | p95 ≤ 100 ms |
| GET /bootstrap (primer paint) | p95 ≤ 150 ms, 1 round-trip |
| Mutación record (PATCH) | p95 ≤ 60 ms |
| Push realtime mutación → UI de otro usuario | ≤ 1 s |
| Bundle JS inicial (gzip) | ≤ 250 KB |
| Cold start de la app con cache IndexedDB | contenido visible < 200 ms |
| Búsqueda FTS, 1M records por tenant | p95 ≤ 200 ms |

Presupuestos = contrato: CI corre benchmarks contra un dataset seed de 100k
records y falla el build si se rompen.

---

## 14. Seguridad

- RLS como segunda línea (§4) + whitelist de expresiones en QueryBuilder
  (herencia del plugin) + Zod en cada boundary.
- Rate limiting por tenant y por IP (Redis).
- Secrets fuera del repo (env / SOPS). CSP estricta. Cookies httpOnly+secure.
- Auditoría: `activity` registra todo (ya existe el diseño en el plugin).
- Backups cifrados; restore drill mensual.

---

## 15. Roadmap

| Fase | Semanas | Contenido |
|---|---|---|
| **F0 — Fundaciones** | 1 | Monorepo, CI, Docker, esqueleto NestJS+Drizzle, auth básica, tenancy+RLS, `shared/` con primeros Zod schemas |
| **F1 — Core dominio** | 3–4 | lists/fields/records/views/slugs+history, QueryBuilder JSONB, endpoint bootstrap, front conectado (tabla + filtros + drawer funcionando) |
| **F2 — Vistas + realtime** | 2 | Kanban/Cards/Calendar/agrupada, dashboards, comments/activity, invalidación push |
| **F3 — Automatizaciones + portal** | 2 | Motor sobre BullMQ, editor visual (se reutiliza), portal del cliente, editor de plantillas (se reutiliza) |
| **F4 — Comercial** | 1–2 | Stripe, onboarding, límites por plan, panel admin interno, emails transaccionales |
| **F5 — Hardening** | 1 | Backups+restore drill, monitoreo, benchmarks CI, beta con 2–3 clientes reales |

**Total MVP: ~10–12 semanas.**

---

## 16. Puente plugin ↔ app

Sin clientes del plugin en producción hoy → **no se construye herramienta de
migración en el MVP**. Se protege el futuro barato:

- El formato de export del plugin (JSON: listas + fields + records + views) se
  documenta como **formato de intercambio**.
- La app tendrá import genérico (CSV + ese JSON) en F4. Si mañana un cliente
  del plugin quiere pasarse, el camino existe sin haberlo pagado por
  adelantado.

---

## 17. ADRs

**ADR-S01 — SaaS multi-tenant, no self-hosted distribuible.**
Una instalación operada por nosotros. El soporte de N entornos heterogéneos
(la carga del modelo plugin) no escala para el equipo.

**ADR-S02 — Postgres + JSONB reemplaza tablas físicas dinámicas.**
*Supersede al ADR-001 del plugin (solo para la app).* Schema estable, cero DDL
en runtime, particionable, FTS nativo, RLS. Las claves de `data` son
`"f{field_id}"` inmutables — el espíritu del ADR-008 (slug editable /
identidad física inmutable) se conserva intacto.

**ADR-S03 — TypeScript end-to-end (NestJS + Drizzle + Zod).**
Un solo lenguaje en todo el stack; schemas de validación compartidos
front↔back. El costo (reescribir la lógica PHP en TS, ~2-3 semanas) se paga
una vez; la unificación se cobra en cada feature futura.

**ADR-S04 — Schema compartido + tenant_id + RLS, no DB-por-tenant.**
Una migración, un backup, RLS como garantía de aislamiento. Instancia
dedicada solo como plan enterprise futuro.

**ADR-S05 — Monolito modular. Prohibidos los microservicios en esta etapa.**
Un deploy, módulos NestJS separados. La complejidad distribuida no se paga
hasta que exista el problema que la justifique.

**ADR-S06 — Realtime = invalidación push, no sync engine.**
WebSocket que invalida caches del cliente. CRDT/replicación local fuera de
alcance salvo demanda real del producto.

**ADR-S07 — El contrato REST hereda los shapes del plugin.**
Mismos JSON shapes donde aplique → el frontend se migra módulo a módulo con
cambios mínimos.

**ADR-S08 — Frontend compartido por fork, no por paquete.**
Copiar el SPA al monorepo y divergir. Un paquete compartido plugin↔app
agregaría fricción de versionado prematura; se re-evalúa si ambos productos
conviven a largo plazo.

**ADR-S09 — Los datos nunca se secuestran.**
*Herencia del ADR-007.* Impago → workspace solo-lectura + export disponible.
Jamás borrado ni bloqueo de lectura.

**ADR-S10 — El producto se llama "Imagina Base" y NO es un CRM.**
El plugin origen (`imagina-crm`) resuelve un caso de uso (gestión de
clientes), pero la app cloud es un **constructor de bases de datos flexibles**
de propósito general: listas dinámicas, campos configurables, vistas
(tabla/Kanban/calendario/cards), dashboards y automatizaciones. Un CRM es solo
una de las plantillas que un cliente puede armar. Consecuencias concretas:
- Marca del producto: **Imagina Base**. Scope npm `@imagina-base/*`, DB
  `imagina_base`, cookie de sesión `imbase_session`.
- El repositorio en GitHub conserva el nombre histórico `imagina-crm-cloud`
  (renombrarlo rompería remotes/CI; no aporta valor). El *dir* y la marca son
  "Imagina Base".
- El plugin hermano sigue siendo `imagina-crm` y su namespace REST heredado
  `imagina-crm/v1` se cita como origen del contrato (no se renombra: es otro
  producto).
- El copy de la UI y el material comercial hablan de "bases", "tablas",
  "registros" y "vistas" — nunca de "leads/oportunidades" salvo dentro de una
  plantilla CRM concreta.

**ADR-S11 — Correo por transporte intercambiable, encolado en BullMQ.**
El envío de emails (transaccionales y de automatizaciones) pasa por un
`MailService` que encola en BullMQ (STANDALONE §5) y un worker envía con un
`MailTransport` inyectado. Dos transportes seleccionables por env
(`MAIL_TRANSPORT`): `log` (default — escribe el correo al logger; dev/tests/
degradación) y `smtp` (nodemailer contra un SMTP real). El dominio nunca
conoce el proveedor: enchufar SES/Postmark/Resend es un transporte nuevo, sin
tocar services. Si `smtp` está pedido pero falta `SMTP_HOST`, o si no hay
Redis, degrada sin romper (log / envío directo). URLs absolutas en emails vía
`APP_BASE_URL`. Primer uso: magic link del portal + acción `send_email`.

**ADR-S12 — Pagos por proveedor intercambiable (PayPal + Mercado Pago), no Stripe.**
Stripe no opera en Colombia, así que el cobro va por proveedores locales/
regionales detrás de una interfaz común `PaymentGateway` (mismo patrón que los
transportes de correo, ADR-S11): PayPal (Orders API v2, USD) y Mercado Pago
(Checkout Pro, COP). El dominio (billing) no conoce el proveedor: elige el
gateway, arma el checkout con una referencia opaca `tenantId:plan`, y aplica el
evento del webhook a `tenants.plan/status`. Cada gateway se auto-deshabilita si
faltan credenciales. La autenticidad del webhook la verifica cada gateway sobre
el **cuerpo crudo** (`rawBody`): Mercado Pago con HMAC de `x-signature`; PayPal
con su API oficial `verify-webhook-signature`. Los webhooks son públicos, uno
por proveedor: `POST /api/v1/billing/webhook/{paypal|mercadopago}`. Enchufar
otro medio (PSE, Nequi vía un agregador) es un adapter nuevo, sin tocar billing.
El `setBilling` sigue siendo la única puerta a `tenants.plan/status`, así que
la degradación a solo-lectura por impago (ADR-S09) se mantiene intacta.

**ADR-S13 — Auto-actualización desde GitHub Releases con deploy atómico.**
El servidor se actualiza sin SSH: CI empaqueta cada tag `vX.Y.Z` como un ZIP
autocontenido (API + `node_modules` de prod + SPA + migraciones + `VERSION`) con
su `.sha256` y lo publica como asset del Release. La app lo detecta (job horario
BullMQ → `app_releases`) y un **superadmin de plataforma** (allowlist por env
`PLATFORM_SUPERADMINS`, distinto del admin de workspace) lo instala desde el
panel. Layout de releases atómicos (`releases/ + shared/ + current->`): el nuevo
release se arma AL LADO del vivo y sólo se cambia el symlink `current` (flip
atómico; rollback = repuntar el symlink + restore del dump). Como las colas
BullMQ corren in-process, el job que actualiza vive en el proceso a reiniciar:
se marca el resultado en Redis (compartido, sobrevive al flip) **antes** de
delegar el reinicio+health-check+rollback a `finalize.sh` desacoplado; la app
reconcilia el estado final al bootear. Fail-closed en el checksum; lock + marker
`done` para re-entrancia; auto-sanación de runs colgados. Detalle en
`docs/runbook-updates.md`.

**ADR-S14 — Listas públicas embebibles por token opaco + restricción por dominio.**
Una lista puede exponerse de **solo-lectura** en una URL propia y embeberse por
`<iframe>` en sitios externos, gobernada por un **token opaco** (no filtra ids/
slug internos). El mapeo `token → (tenant, list)` vive en una tabla auxiliar
`public_lists` **SIN RLS** (es un índice público que se consulta *antes* de
resolver tenant); una vez resuelto el tenant, TODA lectura de datos corre dentro
del scope RLS normal (`withTenant`). Sólo se exponen los campos que el admin marca
como visibles (`settings.public.visible_field_slugs`) — la búsqueda y el orden
sólo alcanzan ese subconjunto, nunca un campo oculto. La **restricción por
dominio** del embed se implementa con la cabecera CSP `frame-ancestors` de la
página HTML servida (`GET /public/l/:token`): vacío = cualquiera puede embeber;
con dominios = sólo esos (+`'self'`). La página es HTML autocontenido (CSS+JS
inline) que consume los endpoints JSON públicos (`/public/lists/:token/meta` y
`/records`), así el embed no depende del bundle del admin. Config admin en
`PATCH /lists/:id/public` (`manage_lists`).

**ADR-S15 — Consola de plataforma (operador SaaS) separada de la app de cliente.**
El **operador** (superadmin de plataforma, allowlist `PLATFORM_SUPERADMINS`)
tiene una consola propia para gestionar el negocio, distinta de la app por-tenant.
A diferencia de todo el resto del API —acotado a un tenant por RLS— estos
endpoints (`/platform/*`, `SuperadminGuard`) ven **todas las empresas**: corren
sobre la conexión **base** (rol dueño/superusuario, que hace *bypass* de RLS,
igual que el DDL de índices y las migraciones), nunca dentro de `withTenant`.
Da: `GET /platform/stats` (foto del negocio — empresas por estado/plan, impagas,
usuarios, records, altas 30d), `GET /platform/tenants` (todas las empresas con
plan/estado/uso/owner=primer admin) y `PATCH /platform/tenants/:id` (cambiar
plan / suspender-reactivar, reusa `BillingService.setBilling` → la suspensión es
solo-lectura, ADR-S09). El front monta una sección "Operador → Plataforma" en el
sidebar del admin, visible sólo si el probe del endpoint no da 403 (mismo patrón
que el panel de auto-update).

**Fase 2 — usuarios.** El operador gestiona el ciclo de vida de las cuentas:
`GET /platform/users` (todos + nº de workspaces + flags), `POST /platform/users`
(alta + email de invitación con link para definir contraseña — reusa el token de
reset), `PATCH /platform/users/:id` (desactivar/reactivar) y
`POST /platform/users/:id/reset-password`. La **desactivación** (`users.disabled_at`)
bloquea el login (403 `account_disabled`) y **revoca todas las sesiones** del
usuario al instante (índice inverso `usess:{userId}` en Redis). Guard rail: no se
puede desactivar a un superadmin de plataforma.

**Fase 3 — planes editables en DB.** Los planes dejan de ser una constante y
viven en la tabla `plans` (slug, nombre, límites nullable, activo), editable por
el operador. El `plan` de un tenant pasa a ser un **slug dinámico** (`planSchema`
= string; los 4 built-in quedan como semilla + fallback en `PLAN_LIMITS`).
`PlansService` (en billing, @Global) sirve los límites con **cache de 30s** para
no pegarle a la DB en el hot path (`assertCanCreateRecord`) y `BillingService`
los consume de ahí. Endpoints `GET/POST /platform/plans` y
`PATCH/DELETE /platform/plans/:slug`; `updateTenant` valida que el plan exista;
borrar un plan en uso se rechaza. Front: card "Planes" con edición inline de
límites + alta/baja, y el select de plan de cada empresa se puebla dinámicamente.
Pendiente: precios de checkout por plan custom.

**Fase 4 — alta + detalle de empresa.** El operador da de alta una empresa
nueva + su admin en **un paso** (`POST /platform/tenants`, reusa el patrón RLS
de `register`: si el email ya existe lo suma como admin, si no crea la cuenta +
invita). `GET /platform/tenants/:id` devuelve el **detalle** (datos + miembros +
límites del plan). Front: botón "Nueva empresa" con formulario (empresa + email/
nombre del admin + plan) y fila expandible por empresa con sus miembros y uso vs
límite.

**Fase 5 — impersonación de soporte (con auditoría).** El operador puede entrar
como un usuario de un cliente para dar soporte. Recaudos: (1) **auditoría**
append-only (`impersonation_log`: quién→a quién, inicio/expiración/fin), visible
en la consola; (2) **vida corta** con tope duro (1 h — `SessionData.expiresAt`
mata la sesión aunque el TTL de Redis se renueve); (3) **banner** persistente
"Modo soporte" con opción de salir; (4) no se puede impersonar a un superadmin ni
a una cuenta desactivada. `POST /platform/impersonate` cambia la cookie por una
de impersonación (guarda el token original del operador); `POST /auth/stop-
impersonating` la restaura; `GET /auth/me` expone `impersonating` para el banner.
Con esto la consola de operador (F1-F5) queda completa.

---

**Última actualización:** 2026-07-10
**ADR-S16 — Archivos: storage local detrás de interfaz, S3 prefirmado como upgrade.**
El §10 preveía object storage S3-compatible con URLs prefirmadas desde el día 1.
En la infra actual (1 VPS, sin bucket contratado) eso agrega una dependencia
externa y credenciales que no existen en dev/test. Decisión: metadata en la
tabla `attachments` (RLS) y bytes detrás de la interfaz `FileStorage`, con un
driver LOCAL en disco (`UPLOADS_DIR`, claves opacas por tenant, guard de path
traversal). El API sube (multipart, `MAX_UPLOAD_BYTES`) y sirve (stream con
check de sesión + tenant) — a la escala actual proxear bytes es aceptable y
queda medido por /metrics. El driver S3-compatible YA existe
(`STORAGE_DRIVER=s3` + credenciales por env; streams multipart vía SDK,
probado contra MinIO) — el API sigue en el data path; URLs prefirmadas
NATIVAS del bucket quedan como optimización cuando haya bucket productivo.
Los campos `file` guardan el ID del attachment como valor. El portal del
cliente descarga por **URLs firmadas HMAC de vida corta**
(`/files/:id/signed?tenant&exp&sig`, secreto `FILES_SIGNING_SECRET`, 404
opaco): el rol client accede solo a los archivos de SU record, sin sesión de
records. Cuota de storage por plan (`plans.max_storage_mb`, NULL=ilimitado,
enforcement post-upload con rollback) editable desde la consola del operador
y visible en Ajustes.

---

**ADR-S17 — Dominio personalizado por tenant (white-label completo).**
El white-label de marca (ADR de branding, v0.1.57/58) quedaba incompleto si el
cliente entra por el dominio de la plataforma. Decisión: dos niveles de entrada
white-label, ambos resueltos por el header `Host` SIN sesión. (a) **Subdominio
automático** `slug.PUBLIC_BASE_DOMAIN` — si el operador configura la base y su
DNS wildcard, cada workspace ya tiene su URL sin tocar nada. (b) **Dominio
propio** (`crm.acme.com`): vive en `tenants.custom_domain` (UNIQUE global,
migración 0029); el cliente crea un CNAME hacia la plataforma (apex sin CNAME:
registro A, la verificación en vivo compara IPs — mismo patrón resolver que el
DNS del SMTP: timeout 2 s, `unknown` ≠ `missing`) y Caddy emite el certificado
**on-demand** la primera vez que alguien visita el dominio, gateado por
`GET /public/domains/check` (`ask`): solo dominios/subdominios registrados —
nunca certs arbitrarios. `GET /public/boot` devuelve la marca del tenant del
Host (logo por URL firmada) para pintar el login ANTES de autenticarse, y el
front bloquea el workspace al tenant del dominio (un dominio = una empresa).
Los magic links del portal salen por el dominio del tenant
(`DomainsService.baseUrlFor`); los correos de cuenta (reset) siguen por
`APP_BASE_URL`. La cookie de sesión es por-dominio (sin cambios: mismo origen).
Se rechazan como dominio propio la base y sus subdominios (reservados para el
nivel a). Gestión en Ajustes → Marca (solo admin), con verificación en vivo.

---

**ADR-S18 — Cuota mensual de correo por el SMTP de la plataforma.**
El SMTP por empresa (v0.1.65) es opcional: sin él los correos de un tenant
—automatizaciones, accesos al portal— salen por el SMTP de la PLATAFORMA. Eso
deja dos costos del lado del operador: el envío en sí y, sobre todo, la
**reputación del dominio remitente compartido** (un cliente usando la app como
plataforma de mailing quema la entregabilidad de todos). Decisión: cuota
**mensual por plan** (`plans.max_emails_month`, NULL = ilimitado, editable
desde la consola) que cuenta **sólo** los correos enviados por el SMTP de la
plataforma. Con SMTP propio configurado no hay límite ni contador: esos correos
no pasan por nuestra infraestructura, así que el límite es también la palanca
comercial —"si necesitás más, configurá tu servidor"— en vez de un muro.

Contador en `email_usage` (tenant + período `YYYY-MM` en UTC, RLS; migración
0042): se incrementa **después** de un envío exitoso —un correo que no salió no
consume cuota— y el chequeo corre **antes** de entregar, así el mensaje que
excede no se manda. El error es explícito y llega a donde el usuario lo busca:
el run de la automatización queda `failed` con el motivo y el botón de acceso al
portal lo muestra; en la cola de BullMQ se marca `UnrecoverableError` (el mes no
cambia en dos segundos: reintentar es desperdicio). Los correos de **cuenta**
(reset de contraseña, verificación de email, invitaciones de plataforma) no
tienen tenant y por eso nunca se limitan: frenarlos dejaría a una persona
afuera de su propia cuenta. El consumo se ve en Ajustes → Plan y uso (barra
"Correos este mes", con la salida por SMTP propio explicada) y en la consola de
operador (columna por plan + fila en el detalle de cada empresa).

---

**ADR-S19 — Campos a través de una relación: `lookup` y `rollup`.**
Un campo `relation` vincula dos filas pero la fila no "sabe" nada del otro
lado: para ver el teléfono del cliente desde la factura, o cuánto debe un
cliente, había que abrir la otra ficha. Decisión: dos tipos de campo que se
resuelven **en cada lectura** cruzando la tabla `relations` (nunca se
persisten — misma regla que `computed`): `lookup` trae un campo de los
registros vinculados (una lista de valores, uno por vínculo) y `rollup` los
cuenta o agrega (`count`/`sum`/`avg`/`min`/`max`) con un **filtro opcional
sobre la otra lista** ("deuda = suma del monto de las facturas con estado
pendiente"). Son el Lookup/Rollup de Airtable y el Relationship+Rollup de
ClickUp.

La relación sirve **en las dos direcciones**, y el backend deduce cuál: si
el campo `relation` vive en esta lista es "hacia afuera" (ancla
`source_record_id`); si vive en otra lista y apunta a esta, "hacia adentro"
(ancla `target_record_id`) — así Clientes resume Facturas sin tener que
duplicar la relación del otro lado. La config guarda ids
(`relation_field_id`, `target_field_id` — nombres que el blueprint de
plantillas tokeniza solo) y el DTO de campos adjunta la relación
**resuelta** (`through`: dirección, lista del otro lado y el campo destino
con su config) para que la UI formatee el valor sin otra request.

Costo por página (regla de oro nº 8): UNA query por relación para los
lookups —con tope de 50 vinculados por registro, porque una relación inversa
no tiene límite natural— y UNA query agregada por rollup, ambas con la lista
de ids de la página. Los rollups **nunca cargan en memoria** los registros
del otro lado: la agregación y su filtro se compilan a SQL con el MISMO
QueryBuilder whitelisteado de la app (regla de oro nº 4), contra el alias
`rr`. Y como la misma agregación se expresa como subconsulta correlacionada
con `records.id`, un rollup **filtra, ordena y se suma en el pie** de la
tabla y en los widgets ("clientes con deuda > 0"). Un lookup no filtra ni
ordena (es una lista). Lo que no resuelve —relación borrada, config a
medias— sale vacío en vez de tumbar el listado. No se encadenan (un lookup
no puede apuntar a otro lookup/rollup): obligaría a resolver grafos en cada
lectura. Un `computed` sí puede usar un rollup como entrada ("cobrado =
total − deuda"), porque los valores through se inyectan antes de evaluar.

### ADR-S20 — Copias completas, restauración y migración de servidor (v0.1.179)

**Contexto.** El backup lógico (§14, `scripts/backup.sh`) y el PITR protegen
la BASE. Pero levantar la app en otro servidor, o volver a un estado anterior
tras una falla, necesita más que la base: los **archivos subidos** (logos,
adjuntos — `shared/uploads`), los **ajustes de plataforma** que viven en Redis
(`platform:*`: SMTP de plataforma) y, sobre todo, los **secretos del `.env`**
(`SECRETS_KEY`, `FILES_SIGNING_SECRET`): sin ellos las contraseñas SMTP y los
secretos 2FA del dump son ilegibles y las URLs firmadas no validan. Y el
restore tiene que respetar la relación código↔esquema (migraciones
forward-only, ADR-S13).

**Decisión.** Un único artefacto, el **snapshot completo**
(`imagina-snapshot-<UTC>-v<versión>.tar[.gpg]`): `manifest.json` (versión,
migraciones aplicadas, partes con sha256) + `db.dump` (pg_dump custom **con**
privilegios) + `uploads.tar.gz` + `redis-platform.json` + `env.production` +
`checksums.sha256`. Tres scripts que viajan en cada release y son la ÚNICA
implementación (la consola los orquesta, no los duplica):

- `snapshot.sh` — lo produce; retención por cantidad; GPG opcional; usa
  `pg_dump` del host o por `docker exec`, y para Redis un cliente RESP
  propio en Node (`redis-kv.mjs`, sin dependencias) — `redis-cli` no está
  en todos los hosts y el único requisito real de la app es Node.
- `snapshot-restore.sh` — verifica checksums, **rechaza un snapshot más nuevo
  que el código** (esquema con migraciones desconocidas; uno más viejo es
  normal: las pendientes se aplican al final), guarda una copia previa de la
  base actual, `DROP SCHEMA` + `pg_restore` (no `--clean` objeto por objeto,
  así un snapshot viejo sobre código nuevo no deja tablas huérfanas que choquen
  con las migraciones), uploads, Redis, `.env` (en servidor nuevo se instala;
  en uno existente NUNCA se pisa en silencio si los secretos difieren),
  migraciones, arranque y health-check.
- `bootstrap-server.sh` — servidor nuevo en un comando: layout de releases,
  `.env` del snapshot, bundle de la MISMA versión desde GitHub Releases
  (sha256 verificado), restore y (opcional) systemd.

La consola (Plataforma → Copias de seguridad) crea, programa (diaria a una
hora UTC, N conservadas, tick horario en la cola del updater — una operación
a la vez), descarga, restaura (confirmación escrita; el restore corre
desacoplado como el `finalize.sh` del updater porque reinicia el API) y borra.
Los ajustes viven en `platform:backups` → viajan en el snapshot.

**Consecuencias.** RTO de migración de servidor: minutos, sin pasos manuales
de base/archivos/secretos. Las sesiones (Redis) no viajan a propósito: son
efímeras y re-crearlas es un login. Con `STORAGE_DRIVER=s3` los archivos no
viajan (el bucket es la fuente). Un snapshot incluye secretos: se guarda como
tal (permisos 600) o cifrado. Migrar UNA empresa entre instancias (con
re-mapeo de ids) es un problema distinto y queda para un release aparte.

### ADR-S21 — Asistente IA de estructura: propone, la persona aplica (v0.1.181)

**Contexto.** La app ya ofrece todo lo que un cliente necesita para armar su
base (listas, campos, vistas, tableros, automatizaciones, plantillas), pero
cada pieza exige conocer la interfaz. El pedido del usuario fue poder decirle
a la app, en lenguaje natural, "armame una lista de proveedores con…" o "un
tablero de esta lista" y que salga hecho — sin que eso sea una puerta trasera
que se salte permisos, límites de plan o la bitácora, y sin que el operador
pague la cuenta de IA de todos sus clientes sin control.

**Decisión.** Un asistente DENTRO de la app con tres reglas de arquitectura:

1. **Un solo registro de herramientas, dos transportes.** Cada herramienta
   (`apps/api/src/ai/tools/`) declara su schema Zod (→ JSON Schema para el
   modelo), la **capability** que exige y su ejecución. El chat de la app
   (fase 1) y el servidor MCP (fase 3) consumen el MISMO registro: no hay una
   segunda lista de "cosas que la IA puede hacer". Al modelo sólo se le
   ofrecen las herramientas que el rol de la persona puede usar, y cada
   ejecución las re-chequea.
2. **El modelo PROPONE; la persona APLICA.** Ninguna herramienta escribe.
   Las `propose_*` validan el pedido contra el esquema real (slugs, tipos,
   config con los schemas compartidos), lo resuelven a ids y lo guardan como
   **propuesta** en Redis (`aiprop:*`, 2 h) con una vista previa declarativa.
   `POST /ai/proposals/:id/apply` ejecuta el payload YA validado llamando a
   los mismos services que usa la interfaz (`BlueprintService.materialize`,
   `FieldsService`, `ViewsService`, `DashboardsService`, `AutomationsService`)
   — con su ACL, sus límites de plan, su realtime y su bitácora (`ai.apply`).
   El cliente nunca manda el payload: dibuja la preview y aplica por id.
3. **La clave y la cuenta son una decisión comercial del operador.** Dos
   niveles, mismo patrón que el SMTP (ADR-S11/S18): la PLATAFORMA carga su
   clave (cifrada con `SECRETS_KEY`, `platform:ai` en Redis) y decide si la
   **comparte** con las empresas —entonces rige la cuota mensual del plan
   (`plans.max_ai_requests_month`, contador `ai_usage` por tenant y período,
   con tokens reales para conocer el costo)— y/o si **permite claves propias**
   (BYOK en `tenants.settings.ai`, cifrada; sin cuota porque no pasa por la
   cuenta del operador). Cada empresa además hace **opt-in** explícito: sus
   esquemas viajan a un proveedor externo. Sin acceso, la UI dice exactamente
   qué falta (`AiUnavailableError.reason`).

Implementación: SDK oficial `@anthropic-ai/sdk`, `messages.stream` con
pensamiento adaptativo y `effort: medium`, system prompt + definiciones de
herramientas con `cache_control`, bucle de hasta 8 vueltas por mensaje,
conversación en Redis por usuario y empresa (24 h) con historial para el
modelo y transcript para la UI. SSE por `reply.hijack()` de Fastify. El
modelo se elige por plataforma con override por empresa (Opus 5 default;
Sonnet/Haiku como palanca de costo).

**Consecuencias.** El asistente no puede hacer NADA que la persona no pueda
hacer desde la interfaz, y todo lo que hace queda como una acción de esa
persona. Las propuestas expiran: no hay estado a medias. Lo que devuelven las
herramientas es DATO del workspace, nunca instrucciones (regla en el prompt).

**Fase 2 (v0.1.182) — datos.** Cinco herramientas más sobre el mismo
registro: `query_records` (máx 50 filas, filtros/búsqueda/orden por slug,
pasa por `RecordsService.list` → el ACL y el own-scoping de la persona se
aplican solos), `aggregate_records` (count/sum/avg/min/max con desglose,
exige `view_records` porque el motor de agregados no acota por fila),
`propose_create_records`, `propose_update_records` y `propose_delete_records`
(por filtros o ids exactos, tope 500, NUNCA toda la lista sin filtro). Las de
escritura resuelven los afectados CON el ACL de la persona al proponer, la
tarjeta muestra recuento + muestra de filas, y al aplicar corren por
`RecordsService.bulk`, que re-aplica capabilities fila por fila. Los valores
pasan por `validateFieldValue` (el mismo validador del import y del motor) y
los selects aceptan la etiqueta. **Inyección**: lo que sale de un registro es
texto de usuarios — se recorta (300 chars por celda), viaja envuelto en un
objeto con una nota explícita de "datos, no instrucciones", y el prompt lo
refuerza; y como escribir exige una propuesta que sólo la persona aplica, un
registro malicioso no puede ejecutar nada por sí mismo.

**Fase 3 (v0.1.183) — MCP.** El MISMO registro se expone a clientes externos
(Claude, Cursor…) por Model Context Protocol, transporte Streamable HTTP
**sin estado** (`POST /api/v1/mcp`, un servidor por request; no hay sesiones
MCP que sincronizar entre nodos). La credencial es un **token de acceso
personal** (`ib_pat_…`): de UNA persona en UN workspace, con el rol resuelto
EN VIVO contra `memberships` en cada uso (sacarla del workspace o desactivar
su cuenta lo mata al instante), con vencimiento opcional y revocación
inmediata; el secreto se muestra una vez y sólo se guarda su SHA-256 (tabla
`personal_access_tokens`, sin RLS como los webhooks entrantes: la búsqueda
es por hash antes de conocer el tenant). Dos alcances: `read` (sólo lectura)
y `full` (además `propose_*` + `apply_proposal`): como acá no hay tarjeta, el
cliente MCP muestra la propuesta y, cuando la persona confirma, la aplica
por id — el contrato propone→aplica no cambia y un token nunca amplía
permisos. Crear/revocar quedan en la bitácora. El MCP no consume la cuota
IA del plan: el modelo lo aporta el cliente. Docs: `docs/mcp.md`.

---

**Versión del documento:** 1.15.2 (asistente IA: servidor MCP + tokens personales — ADR-S21 fase 3)
