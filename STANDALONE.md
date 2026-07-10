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

---

**Última actualización:** 2026-07-10
**Versión del documento:** 1.5.0 (listas públicas embebibles — ADR-S14)
