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
| **Datos dinámicos** | JSONB con índices fijos por lista, sin índices por campo (reemplaza tablas físicas del plugin — ver ADR-S02 y ADR-S32) |
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

### 3.3 Campos "indexados" — sin índices físicos por campo (ADR-S32)

Hasta v0.1.256, marcar un campo como indexado creaba uno o dos índices por
expresión sobre la tabla compartida `records` (parciales por `list_id`). Desde
v0.1.257 **no se crean índices por campo** y la migración 0064 borró los que
había: el flag `fields.is_indexed` se conserva por compatibilidad (API, MCP,
plantillas guardadas) pero no tiene efecto físico, y la interfaz ya no lo
ofrece. El motivo, con números, está en ADR-S32.

El rendimiento del listado sale de los índices FIJOS de la tabla —
`(tenant_id, list_id, id)` acota el recorrido a las filas de la lista— y del
`QueryBuilder`, que conserva su diseño del plugin (slug → field → expresión SQL
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

- Object storage S3-compatible (Hetzner Object Storage / Cloudflare R2) para
  la plataforma (`STORAGE_DRIVER=s3`), o disco local.
- Cada empresa puede guardar en SU bucket (ADR-S36): no cuenta para el plan y
  se descarga directo de ahí con un enlace prefirmado. Cada archivo recuerda
  dónde quedó (`attachments.storage_connection_id`).
- La subida pasa por el API (streaming); la descarga de un bucket, no.
- `attachments` guarda metadata; antivirus scan en cola (fase 4).

---

## 11. Billing y planes

- **Mercado Pago** (COP) + PayPal (USD) detrás de `PaymentGateway` (ADR-S12;
  Stripe no opera en Colombia). Dos formas de pagar (ADR-S30): N meses de una
  vez (PSE, Nequi, tarjeta, efectivo) o renovación automática con tarjeta.
  Cada pago aprobado extiende `paid_until`; vencido + 5 días de gracia →
  solo-lectura.
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

**Vista agrupada en UNA vuelta (v0.1.224).** `grouped-bundle` acepta
`expand=all` + `collapsed=[…]` (lista JSON): trae los grupos, las filas de
TODOS los abiertos y sus agregados en una sola request. Antes el front pedía
los grupos y, con la respuesta, las filas de los abiertos: cada búsqueda eran
dos vueltas en serie y los grupos que traía la búsqueda nueva se veían vacíos
entre medio (y además disparaban una request de filas y otra de agregados por
grupo). En el servidor sólo se arman los grupos presentes en la consulta, de a
3 en paralelo (tope 40 que se abren solos). Las claves de grupo viajan como
JSON porque la de un multi_select es un JSON con comas. En modo agrupado el
listado plano no se pide, y la tabla va memoizada con callbacks de identidad
estable: tipear en el buscador ya no re-dibuja todas las filas.

---

## 14. Seguridad

- RLS como segunda línea (§4) + whitelist de expresiones en QueryBuilder
  (herencia del plugin) + Zod en cada boundary.
- Rate limiting por tenant y por IP (Redis).
- **En qué proxy se cree** (`TRUST_PROXY`, v0.1.202): de `X-Forwarded-*` salen
  el IP del rate limit, el que ve la persona en "Dispositivos conectados" y el
  host del que se deriva el issuer OAuth del MCP (ADR-S21 fase 4). Por eso NO
  se confía en toda la cadena: el default es `loopback`, el proxy de esta misma
  máquina. Y el proxy **sobrescribe** `X-Forwarded-Host` en vez de dejar pasar
  la del cliente — sin eso, confiar en el proxy equivale a confiar en
  cualquiera. OJO: un número (hop-count) NO sirve; desde fastify 5.12 significa
  "no confiar en nadie" y rompería el proxy legítimo en silencio.
- **Egreso anti-SSRF** (`safeWebhookFetch`, SEC-03 → SEC-23 en v0.1.225): toda
  petición saliente con destino elegido por un tenant pasa por el guard. Se
  valida la IP por NÚMEROS, no por texto: el literal IPv6 viene con corchetes en
  `URL.hostname` (sin quitarlos, `[::ffff:a9fe:a9fe]` saltaba el control entero
  porque node no llama a `lookup` para IPs literales), y toda IPv6 que embebe
  una IPv4 (mapped, compatible, NAT64, 6to4) decide por esa IPv4. Sólo unicast
  global IPv6. El llamador no puede fijar `Host` ni cabeceras de framing, y hay
  tope de tiempo TOTAL además del de inactividad. El admin de Caddy va en un
  socket unix, no en `localhost:2019`.
- **Sesiones del portal** (SEC-24, v0.1.225): canjear un enlace del portal abre
  una sesión ATADA a la empresa del enlace (`portalTenantId`) que sólo sirve
  para `/portal/*`; el rol `client` no pasa por `TenantGuard`. El enlace no se
  emite para superadmins ni cuentas desactivadas, y a quien lo pide sólo se le
  devuelve si la cuenta es de su empresa (recién creada o ya cliente suya): una
  cuenta que existía por su cuenta lo recibe sólo por correo. La consola de
  plataforma exige una sesión abierta con contraseña (`via: 'password'`).
- **ACL por lista en TODA lectura** (SEC-25, v0.1.226): el scope de lectura
  del rol y sus campos ocultos no se aplican sólo al listado — también a los
  agregados (pie, grupos, tableros, asistente), al autocompletado de filtros, a
  la actividad, a los archivos y al orden/filtro/búsqueda (un campo oculto no se
  filtra ni se ordena: sería un oráculo). El export JSON completo es para
  `manage_lists`; el resto exporta CSV, que ya respetaba el ACL. Una vista
  pública que no se puede aplicar no muestra NADA (fail-closed).
- **Cuentas** (SEC-26, v0.1.226): un código TOTP vale una vez, hay tope de
  fallos de 2FA por usuario (no sólo por desafío), el reset de contraseña es de
  un solo uso atómico y revoca también los tokens de acceso, y el índice de
  sesiones de un usuario nunca se acorta.
- **SMTP de las empresas** (SEC-27, v0.1.226): sólo servidores públicos
  (`SMTP_ALLOW_PRIVATE_HOSTS` para un relay interno a propósito), validado al
  guardar y fijado a la IP al enviar; el diagnóstico tampoco toca la red
  interna.
- Las decisiones del rate limit se toman sobre el PATH, nunca sobre `req.url`
  (trae la query: `?/health` salteaba el límite, SEC-28).
- **Pagos** (SEC-29, v0.1.228): una orden de PayPal aprobada se CAPTURA antes
  de activar el plan; sólo una captura `COMPLETED` activa.
- **Importaciones** (SEC-30, v0.1.228): el archivo de una empresa no puede traer
  symlinks (se leerían archivos del servidor) y las cuentas NUEVAS no heredan
  contraseña/verificación/2FA del archivo salvo que el operador marque que
  viene de un servidor de confianza. El import CSV respeta el "puede crear" de
  la lista, los campos ocultos al rol y `manage_fields` para crear campos u
  opciones.
- **Automatizaciones e IA** (SEC-31, v0.1.228): la lista destino de "crear
  registro" tiene que ser de la empresa; el límite de registros del plan se
  aplica en `RecordsService.create` (vale para IA/MCP, "actualizar desde
  archivo", automatizaciones y recurrencias); una propuesta de IA se aplica
  una sola vez (candado); los accesos por persona que propone la IA se
  mezclan con los existentes; una automatización se lee/cambia/borra sólo
  desde su lista; y poner/ver recurrencias exige alcanzar la fila con el ACL.
- **Dominios y OAuth** (SEC-32, v0.1.228): dominio propio con prueba de
  propiedad por TXT (ver ADR-S17); el `authorize` del OAuth ya no redirige
  solo con un error (era un open redirect con registro abierto) y la pantalla
  "Autorizar" advierte cuando el destino no es Claude ni esta computadora.
- **Las cabeceras de seguridad no dependen del proxy** (v0.1.227): la
  auto-actualización no toca la config del proxy (es de root), así que lo que
  sólo vivía ahí no llegaba a los servidores ya instalados — y en un panel tipo
  ServerAvatar nunca estuvo. Ahora el API manda HSTS en producción sobre HTTPS,
  el HTML de los dos SPA trae su CSP en un `<meta>` (inyectado en el build) y el
  cliente se niega a montarse encuadrado por otro origen (`frame-ancestors` no
  se puede declarar en un `<meta>`). Las cabeceras del proxy siguen siendo la
  capa más fuerte y se recomiendan; la de la app es el piso garantizado.
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
Los **precios de checkout** viven en la misma tabla (`price_usd` / `price_cop`):
un plan custom se vende self-serve apenas el operador le pone precio.

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

**Propiedad del dominio (SEC-32, v0.1.228).** Pedir un dominio ya NO lo
activa: queda como pedido pendiente en `tenants.settings.domain_claim` (con un
código por empresa) y `tenants.custom_domain` sólo guarda dominios
VERIFICADOS. El cliente crea el TXT `_imagina-verify.<dominio>` =
`imagina-verify=<código>` y toca "Verificar propiedad": recién ahí el dominio
entra a `custom_domain` (certificado, marca y magic links). Si otra empresa lo
tenía, pasa a quien probó ser dueño del DNS. Así nadie "reserva" el dominio de
otra empresa (antes el UNIQUE lo bloqueaba para el dueño real). Los dominios ya
configurados antes de esta versión se conservan activos.

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
tabla y en los widgets ("clientes con deuda > 0"). **Desde v0.1.200 un lookup
también** (los pedidos "por la ciudad del cliente"): su expresión es un
`string_agg` de los valores vinculados, normalizado —distintos y ordenados,
por el mismo motivo que el set de un multi_select— así que se compara como
TEXTO aunque el destino sea numérico, y admite además los operadores de
subcadena. El único que queda afuera es el lookup hacia un `computed`: ése se
evalúa en JS sobre la fila del otro lado y no hay SQL que lo exprese, así que
no se ofrece para filtrar ni agrupar en vez de descartarlo en silencio. Lo que
no resuelve —relación borrada, config a medias— sale vacío en vez de tumbar el
listado. El **export CSV** (v0.1.200) lleva los derivados y la relación
resuelta al TÍTULO del vinculado: el archivo dice lo mismo que la pantalla.
El import no los toma de vuelta, y está bien: un valor derivado no se
escribe. No se encadenan (un lookup
no puede apuntar a otro lookup/rollup): obligaría a resolver grafos en cada
lectura. Un `computed` sí puede usar un rollup como entrada ("cobrado =
total − deuda"), porque los valores through se inyectan antes de evaluar.

**Computed numéricos en SQL (v0.1.229).** Un `computed` se evalúa en JS en
cada lectura, así que el motor de agregados, los filtros y el orden no lo
veían: un tablero que sumaba «valor = stock × costo» respondía «sum sólo
aplica a campos numéricos» (y, como el bundle del tablero evaluaba todo con un
`Promise.all`, un solo widget así tumbaba TODOS los del tablero). Las
operaciones aritméticas (`sum`, `product`, `subtract`, `divide`, `abs`) se
traducen a una expresión SQL sobre las entradas tipadas (`records/computed-sql.ts`,
misma semántica que el evaluador de shared: sum/product ignoran vacíos y dan
NULL si todos lo están, subtract propaga el vacío, divide por cero da NULL),
encadenables y con rollups numéricos como entrada; con eso el computed se
suma/promedia en widgets y pie, se filtra ("margen < 0"), se ordena y se
agrupa, exactamente como un rollup. Las de fecha y `concat` siguen sin
expresión. La expresión se arma sobre el mapa de campos YA recortado por el
ACL: si una entrada está oculta para el rol, el computed no se agrega ni se
filtra (sería un oráculo sobre la entrada oculta). Y el bundle del tablero
evalúa cada widget aislado: uno mal configurado devuelve su propio error
(`{ __error }`, visible en ese widget con el motivo) y el resto se dibuja.

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
re-mapeo de ids) es un problema distinto y tiene su propio ADR-S23.

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

**Fase 4 (v0.1.184) — OAuth 2.1: "Autorizar" en vez de pegar un token.**
La pregunta del usuario fue si la app podía usar SU suscripción de Claude.
No puede (Anthropic prohíbe los tokens OAuth de Free/Pro/Max en productos de
terceros desde febrero de 2026; el asistente ✨ sigue con API key), pero el
camino inverso sí: que Claude —pagado por la suscripción— se conecte a la
app. claude.ai, Claude Desktop y el celular sólo aceptan conectores remotos
por **OAuth** (no admiten una cabecera fija), así que Imagina Base es ahora
**servidor de autorización OAuth 2.1** del MCP: metadata de descubrimiento en
la raíz del host (`/.well-known/oauth-authorization-server` y
`/.well-known/oauth-protected-resource[/api/v1/mcp]`, RFC 8414/9728; el
proxy tiene que mandar `/.well-known/oauth-*` al API — regla nueva en
Caddyfile y nginx.conf), **registro dinámico de clientes** abierto (RFC 7591,
tabla `oauth_clients` sin RLS; redirect URIs sólo https, http en loopback o
esquema de app nativa; con o sin secreto), `authorize` que valida y manda a
la **pantalla "Autorizar" del SPA** (`/oauth/authorize?req=…`, fuera del
hash router como /reset y /verify: sin sesión aparece el login normal y
después la misma pantalla; ahí la persona elige **workspace y alcance**), y
`token`/`revoke` con **PKCE S256 obligatorio**, `resource` (RFC 8707) que
tiene que ser nuestro MCP, code de un solo uso (GETDEL) y refresh token
**rotativo** (la rotación se hace con `WHERE` del hash viejo: dos canjes
concurrentes → uno solo gana). **El token emitido es una fila de
`personal_access_tokens`** (columnas `client_id`, `refresh_token_hash`,
`refresh_expires_at`): acceso de 1 h + refresh de 30 días que se estira en
cada renovación; el MCP la resuelve igual que a un token personal (rol en
vivo, fail-closed), en Ajustes aparece como "Conexión autorizada · se renueva
solo" con el mismo botón Revocar (mata acceso Y refresh) y queda en la
bitácora (`token.create` con `via: oauth`). El issuer es el **origen de la
request** (`X-Forwarded-*` con `trustProxy`): cada dominio —plataforma o
dominio propio de una empresa (ADR-S17)— es su propio servidor OAuth y la
cookie de sesión de la pantalla es de ese mismo host. CORS `*` sólo en
`/.well-known/oauth-*`, `/api/v1/oauth/*` y `/api/v1/mcp` (auth por Bearer,
sin cookies → no expone la sesión) para clientes MCP que corren en el
navegador. Un cliente desconocido o una redirect no registrada se responden
en texto, NUNCA por redirect (open redirect). Los tokens pegados a mano
(fase 3) siguen valiendo para Claude Code y Cursor.
**v0.1.186 — descubrimiento sin tocar el proxy.** En producción la regla
`/.well-known/oauth-*` no estaba y la raíz devolvía el SPA (HTML 200): el
cliente MCP rompe ahí al parsear JSON y no prueba alternativas (verificado con
el SDK). Fix en tres capas: (a) `deploy.sh` genera los documentos como
**archivos estáticos** en `web/.well-known/` con `APP_BASE_URL`
(`deploy/oauth-discovery-static.sh`) — `try_files` los sirve antes del
fallback; (b) el `WWW-Authenticate` apunta a
`/api/v1/oauth/.well-known/oauth-protected-resource` (bajo el prefijo del
API, que todo proxy enruta) y el API sirve ahí también la metadata del
servidor; (c) `resource` (RFC 8707) se valida por PATH y no por host, porque
con el estático el issuer es el dominio de la plataforma aunque el MCP se use
por un dominio propio. La card de Ajustes autodiagnostica el descubrimiento.

### ADR-S22 — Conectores: la credencial se guarda una vez y se referencia (v0.1.196)

**Contexto.** Hasta acá una credencial de servicio externo se tipeaba DENTRO de
la acción que la usaba: el secreto de firma HMAC en `action.config.secret` y el
token en una cabecera `Authorization` de `action.config.headers`, ambos en
texto plano dentro de la columna `automations.actions` (jsonb). Con N
automatizaciones contra el mismo destino había N copias de la misma clave,
rotarla era editarlas una por una, y no había forma de saber qué dejaría de
funcionar al cambiarla. La evidencia más clara del error de diseño es v0.1.193:
hubo que escribir `redactSecrets` para que el MCP no expusiera esos secretos al
modelo, o sea enmascarar un dato que no debería haber estado ahí.

**Decisión.** Una **conexión** es un objeto de primera clase (`connections`,
migración 0052, RLS) con la credencial **cifrada** por el secret-box de SEC-20
(la misma `SECRETS_KEY` del SMTP por empresa y del secreto TOTP). Las acciones
la referencian por id (`config.connection_id`) y **nunca copian el secreto**.
Es el modelo de las credenciales de n8n y de los recursos de Retool.

- **Tipada y declarativa**: la conexión dice cómo se inyecta la credencial —
  `bearer`, cabecera propia, `basic`, parámetro de la URL o **campo del
  cuerpo** (muchas APIs de mensajería piden la clave como un campo más del
  formulario) — más una URL base, cabeceras fijas y un secreto de firma. Con
  eso alcanza para cualquier API HTTP sin escribir código nuevo.
- **La resolución es PURA** (`connectionParts`), igual que `buildWebhookRequest`:
  el motor, el probador de la acción y el botón "Probar conexión" inyectan la
  credencial con la misma función, así lo que se prueba es lo que se ejecuta.
  Las credenciales se le pasan al builder ya resueltas; hacer I/O adentro haría
  divergir al probador del motor.
- **Credenciales de la EMPRESA, no de la plataforma.** No hay conectores del
  operador compartidos entre clientes: para un gateway de WhatsApp o un CRM
  ajeno, la cuenta es de cada empresa. Alcance `workspace` por defecto, creado
  por el ADMIN (misma puerta que el SMTP, el dominio y los miembros, porque la
  credencial puede gastar plata en nombre de la empresa); alcance `private`
  (sólo su dueño) únicamente si el admin lo habilita.
- **El secreto no vuelve nunca**: sólo un hint de los últimos cuatro, y los
  tres estados del SMTP (`none` / `ok` / `unreadable`). Una conexión ilegible
  **hace fallar** la acción en vez de mandar la petición sin credencial: el
  fallo silencioso es lo que costó el release v0.1.150.
- **Borrar dice qué se rompe**: el ACL y el uso se calculan recorriendo las
  acciones (incluidas las ramas de `if_else`), y borrar una conexión en uso se
  rechaza con la lista de automatizaciones afectadas.

**Conversión de lo que ya existe.** `GET /connections/inline-secrets` detecta
las credenciales escritas dentro de las acciones y las agrupa por host **más la
huella de la credencial** (dos claves distintas en el mismo host son dos
conexiones: fusionarlas rompería una). `POST /connections/convert-inline` crea
la conexión cifrada y reescribe las acciones —también las anidadas— sacando el
secreto y dejando el `connection_id`. La URL se conserva ABSOLUTA a propósito:
la conexión aporta credenciales, no destino, y reescribirla cambiaría adónde
apunta una automatización que hoy funciona.

**Consecuencias.** El secreto de firma inline sigue funcionando mientras
convivan (el de la conexión manda), así que no hay migración forzada. Queda
para la fase 3 OAuth2 como CLIENTE, que es la pieza que falta para Google o
Slack: la app ya es servidor OAuth desde ADR-S21 fase 4.

**Fase 2 — acciones con NOMBRE (v0.1.198).** Una conexión sola deja el trabajo
a medias: quien arma una automatización todavía tiene que saber el método, la
ruta y el content-type del servicio. Una **acción con nombre** es un preset
guardado de una petición —"Enviar WhatsApp" con los campos *Destinatario* y
*Mensaje*— y es lo que hace usable un conector, igual que en Zapier o n8n.

- **Vive DENTRO de la conexión** (`connections.config.actions`, sin migración),
  no en un catálogo de la plataforma: el catálogo es del servicio que cada
  empresa conectó, así que **agregar una integración es configuración, no un
  release**. Ésa era la deuda que la fase 1 dejó anotada.
- **Se COMPILA a la misma config que `call_webhook`** (`compileConnectorCall`,
  puro) y sale por `buildWebhookRequest`: un solo motor de peticiones
  salientes, así lo que prueba el editor es literalmente lo que ejecuta la
  automatización.
- **El merge se aplica UNA vez**, en el compilador; el builder recibe una
  función identidad. Expandir dos veces re-interpretaría como plantilla el
  texto de un registro (alguien que escribió `{{algo}}` en un campo).
- **La clave de la acción es estable**: renombrar la etiqueta no rompe ninguna
  automatización guardada (regla de oro nº 1). Una clave que ya no existe
  **hace fallar** la acción con el nombre de la conexión, en vez de ejecutar
  otra cosa en silencio; un obligatorio vacío la saltea sin mandar nada.
- **El catálogo `/actions` deja de ser una constante**: devuelve los 5 tipos
  fijos más una entrada por acción con nombre de cada conexión visible, así el
  menú del editor ofrece "Enviar WhatsApp" en vez de preguntar "¿qué tipo de
  acción?". El asistente y el MCP las ven en `get_list_schema` (`connectors`),
  sin credenciales: sólo qué se puede ejecutar y qué datos pide.

**Fase 3 — OAuth 2.0 como CLIENTE (v0.1.199).** Las fases 1 y 2 asumen un
secreto ESTÁTICO que alguien pega. Para Google, Microsoft, Slack, GitHub,
HubSpot o Zoho eso no existe: la empresa **autoriza** la app una vez y el
proveedor entrega un token que caduca y se renueva solo. La app ya era
**servidor** OAuth desde ADR-S21 fase 4 (para que Claude se conecte al MCP);
esto es el lado inverso.

- **`auth_type: 'oauth2'`**, no un proveedor nuevo. La conexión guarda la app
  registrada (`config.oauth`: client_id, URLs, scopes, extra params) y el
  `client_secret` cifrado; los tokens del proveedor van en `secrets`, también
  cifrados, y **nunca vuelven al cliente ni enmascarados** — no son de la
  persona, son del proveedor.
- **PKCE siempre** (RFC 7636), aunque haya client secret: es barato y varios
  proveedores ya lo exigen. El `verifier` y el tenant viven en Redis contra el
  `state`, que se consume con `GETDEL` —de un solo uso, como el magic link del
  portal (SEC-15)— y sólo lo puede canjear la MISMA persona que lo pidió.
- **El refresh se escribe en su PROPIA transacción**, nunca en la del que lo
  pidió. Si la automatización falla después y revierte, un proveedor que ROTA
  el refresh token dejaría la conexión muerta para siempre: habríamos guardado
  uno que el proveedor ya invalidó. Y se toma un **lock corto en Redis**,
  porque dos acciones en paralelo canjeando el mismo refresh rotativo hacen que
  el segundo reciba `invalid_grant`; quien no lo consigue espera al token nuevo
  en vez de pedir otro.
- **Sin `expires_in` declarado no se renueva a ciegas**: hay proveedores cuyos
  tokens no caducan y un refresh de más consume cupo o rota uno que andaba.
- **UNA `redirect_uri` por instalación**
  (`{APP_BASE_URL}/api/v1/connections/oauth/callback`), porque hay que
  registrarla en la consola del proveedor y un dominio propio por empresa
  (ADR-S17) obligaría a registrar una por cliente. El panel la muestra lista
  para copiar. El callback va en un controller aparte: el navegador vuelve con
  la cookie de sesión pero SIN `X-Tenant-Id`, así que la empresa sale del
  `state` que emitimos nosotros.
- **Los presets de proveedor no son un tipo de conector**: rellenan dos URLs y,
  sobre todo, traen puestos los parámetros raros de cada uno —el
  `access_type=offline` de Google es el motivo nº 1 de "me autoricé y a la hora
  dejó de andar"—. Cualquier otro se configura a mano con los mismos campos.
- **El canje sale por `safeWebhookFetch`** (SEC-03) como cualquier petición
  saliente, y el error del proveedor se propaga TAL CUAL: `invalid_grant` es
  exactamente lo que hay que leer para entender que el refresh murió.

**Consecuencias.** Un token vencido sin refresh **hace fallar** la acción con
el motivo y el nombre de la conexión, en vez de mandar la petición sin
credencial (la lección de v0.1.150). Queda fuera la revocación en el proveedor
al desconectar: se borran los tokens locales y la app registrada sigue
autorizada del otro lado hasta que la persona la quite ahí — cada proveedor
tiene su propio endpoint de revocación y varios no lo tienen.

**Fase 4 — la galería de apps (v0.1.203).** Las fases 1-3 dejaron el motor
completo, pero la cara era una herramienta de desarrollador: para conectar
algo había que saber qué es una cabecera `Authorization`, un scope o una URL
de tokens, y en OAuth cada empresa tenía que registrar su propia app en la
consola de Google o Slack. Ningún producto de este tipo le pide eso a su
cliente. ClickUp puede ofrecer «Conectar» con un botón porque la parte
técnica la resolvió **una vez** el dueño de la plataforma: registró su app en
cada proveedor, y cada cliente sólo autoriza con SU cuenta.

- **Dos piezas separadas.** Los **proveedores OAuth** (`google`, `microsoft`,
  `slack`) los registra el OPERADOR en Plataforma → Integraciones: client id +
  secreto, cifrado con `SECRETS_KEY` en Redis `platform:integrations` (viaja
  solo en el snapshot de ADR-S20). Las **integraciones** son las tarjetas de la
  galería (`INTEGRATIONS` en shared): WhatsApp (Imagina WAS) y Telegram por
  clave; Slack, Gmail, Google Calendar, Google Sheets y Outlook por OAuth. Cada
  una declara cómo se conecta y qué ACCIONES trae ya armadas.
- **La decisión de la fase 1 se mantiene.** El client id identifica a la
  APP, no es una cuenta compartida: cada empresa conecta su propia cuenta de
  Google o Slack, y sus tokens quedan cifrados y separados en su conexión. Lo
  que cambia es quién registra la app: el operador, una vez, en vez de cada
  cliente.
- **Las acciones viven en el catálogo, no en la fila.** Una conexión de la
  galería guarda `provider = <clave de la app>` y trae sus acciones del
  catálogo: una mejora de la acción llega a todas las empresas con el release,
  sin migrar conexiones. Usan el shape de las acciones con nombre de la fase 2,
  así el editor las pinta con el MISMO formulario.
- **La petición la arma CÓDIGO, una función por acción** (`integration-calls.ts`,
  puro): una API real no se describe bien con filas clave/valor (Gmail quiere
  un RFC 2822 en base64, Sheets un arreglo de filas, Calendar objetos anidados
  con zona horaria). Lo que prueba el editor es lo que ejecuta el motor.
- **La RESPUESTA se revisa.** Slack, Telegram y WAS contestan 200 con el error
  adentro (`ok:false`): mirar sólo el status marcaría como exitoso un mensaje
  que no salió. Para las acciones de la galería un error es un run FALLIDO con
  el motivo legible («invitá la app al canal con /invite»).
- **La conexión nace AL VOLVER del proveedor**, no al tocar «Conectar»: si la
  persona cancela en Google no queda una conexión a medias. Al volver se lee
  con qué cuenta se conectó (correo de Google/Microsoft, espacio de Slack) y se
  muestra en la lista.
- **Una clave se prueba ANTES de guardarse** (Telegram `getMe`, las cuentas de
  WAS): si está mal se sabe en el diálogo, no a la primera automatización que
  falle. Si el servicio no contesta —un problema pasajero—, se guarda igual y
  se avisa que no se pudo comprobar.
- **Sin el proveedor configurado, la tarjeta no se le muestra a la empresa**
  (un botón que no puede funcionar es peor que no tenerlo); el operador sí la
  ve, con el atajo a configurarla.
- **La API personalizada sigue**, plegada bajo «Avanzado»: es la salida para
  un servicio que no está en la galería, no el camino de todos los días.

**Consecuencias.** El costo real se mueve al operador: Google exige
**verificar la app** para los permisos de Calendar, Sheets y Gmail, y mientras
no esté verificada sólo pueden conectarse los usuarios de prueba que se
agreguen en la pantalla de consentimiento (hasta 100), con un aviso de «app no
verificada». La verificación puede tardar semanas; Slack y Microsoft son más
rápidos, y las apps por clave no necesitan ningún registro.

**Addendum v0.1.247 — guías completas y páginas públicas.** La guía de cinco
pasos sólo dejaba la app «En prueba». En ese modo Google VENCE cada conexión a
los 7 días, y sin publicar ni verificar ninguna empresa real puede usarla bien.
Ahora cada proveedor tiene una guía por fases (`PROVIDER_GUIDES` en shared):
- **Google**: proyecto + APIs → pantalla de consentimiento (marca, dominios
  autorizados, permisos sensibles —ninguno restringido: sin auditoría CASA—)
  → cliente y prueba → **publicar** → **verificación** (Search Console, video,
  justificación por permiso).
- **Microsoft**: el secreto VENCE, el dominio y la verificación del publicador.
- **Slack**: la distribución pública.

Cada paso trae el enlace a la pantalla exacta y los valores ya resueltos para
copiar (redirect, dominio registrable, permisos, URLs legales, justificación
de cada permiso, guion del video).

Como Google exige una página principal PÚBLICA y una política de privacidad que
explique el uso de sus datos (con la cláusula de «uso limitado»), la plataforma
las sirve en `/api/v1/public/legal[/privacidad|/terminos]`:
- HTML servido por el API, no por el SPA: los revisores no ejecutan JavaScript.
- CSP cerrada.
- Texto sugerido editable, con marcadores que se completan solos.
- Ajustes en `platform:legal`, así viajan en el snapshot.

### ADR-S23 — Migrar UNA empresa entre instancias (v0.1.197)

**Contexto.** ADR-S20 mueve el SERVIDOR entero: sirve para cambiar de VPS o
restaurar a un instante, pero no para los tres casos que aparecen cuando el
negocio crece — partir un servidor en dos, venderle una empresa a otro
operador, o sacar a un cliente de la nube compartida a la suya. Para eso hace
falta un artefacto de UNA empresa, y el problema es que todos los ids de la app
son `bigint generated always as identity` sobre tablas COMPARTIDAS: al insertar
en el destino se regeneran. Una referencia que no se traduzca no falla
ruidosamente, **apunta a la fila de otra empresa**, que es la peor clase de bug
posible en un producto multi-tenant.

**Decisión.** Un **archivo portable por empresa** (`imagina-tenant-<slug>-<UTC>.tar`)
con `manifest.json`, una NDJSON por tabla y los bytes de los adjuntos; el
import lo inserta regenerando ids y **re-mapeando toda referencia**.

- **El re-mapeo vive en un módulo PURO y testeado aparte**
  (`tenant-transfer.remap.ts`). Cubre cuatro vocabularios distintos: las claves
  por convención (`*_field_id`, `*_field_ids`, `list_id`, `inputs`) más las que
  no siguen ninguna y hay que nombrar a mano (`connection_id`,
  `default_template_id`, `view_id`, `related_lists`); las CLAVES `f{field_id}`
  de `records.data` y del diff de actividad, con los tipos `file`/`user` cuyo
  VALOR también es un id; el árbol ProseMirror de la descripción
  (`mentionUser`, `mentionRecord`, `imageBlock`, `fileBlock`) a cualquier
  profundidad; y `lists.settings`, donde los ids de usuario son las CLAVES de
  `permissions.users`. Un id que no resuelve queda en `null` y la referencia se
  descarta: dejarlo con el número viejo se lo daría a otra persona.
- **Lo que NO viaja es tan importante como lo que viaja.** El dominio propio
  (único global, apunta al servidor anterior), el token público de cada lista y
  la URL de los webhooks entrantes son **credenciales de la instancia de
  origen**: el import emite unos nuevos y lo dice en los avisos. Los tokens
  personales y OAuth se guardan sólo hasheados, así que no hay nada que mover.
- **Los secretos viajan cifrados con una huella de la `SECRETS_KEY` del
  origen.** Si el destino tiene otra clave no se pueden descifrar, así que se
  **descartan** en vez de guardar basura que fallaría recién al mandar un
  correo (la lección de v0.1.150).
- **Las personas se deduplican por email.** Quien ya tiene cuenta en el destino
  se vincula (conserva su contraseña, su 2FA y sus otras empresas); quien no,
  se crea con el hash de argon2, que es portable.
- **Todo el import corre en UNA transacción** y los bytes escritos fuera de ella
  se borran si revierte: nunca queda una empresa a medio armar.
- **El orden es el de las dependencias**, y el único tramo no obvio está
  comentado: los adjuntos van ANTES que los registros (`data` los referencia),
  los registros se insertan en dos pasadas (el padre de una subtarea y las
  menciones de la descripción apuntan a registros que en la primera todavía no
  existen), la config de los campos derivados se reescribe cuando ya existen
  todos, y `lists.settings` se escribe AL FINAL porque referencia campos,
  vistas, plantillas, otras listas y personas.

**Consecuencias.** La empresa de origen queda intacta: migrar es copiar, y
darla de baja es una decisión aparte del operador (si el import fallara a
mitad, el cliente sigue operando donde estaba). El export es síncrono y el tar
se arma con otro nombre y se renombra al final, así una request cortada nunca
deja un archivo a medias en el listado. Queda pendiente el caso de la empresa
con cientos de miles de registros, donde conviene encolarlo como los snapshots.

### ADR-S24 — Sincronizar una tienda: la tienda es la fuente, la app es un espejo vivo (v0.1.206)

**Contexto.** Las acciones de WooCommerce (v0.1.205) escriben en la tienda,
pero lo que pide un comercio es lo inverso: ver sus pedidos, clientes y
productos DENTRO de la app —cuánto compró cada cliente, cuánto vendió cada
producto y cada talla— y automatizar sobre eso. Un conector que sólo manda no
alcanza; hace falta un motor que traiga y mantenga al día.

**Decisión.** Una sincronización por conexión (`connection_syncs`) que
materializa un **pack de listas vinculadas** con sus rollups y un tablero de
ventas, dentro de una carpeta propia, y las mantiene al día desde la tienda.
(Hasta v0.1.212 eran cinco listas; desde v0.1.213 son TRES —clientes,
productos, pedidos— con las variaciones y las líneas como SUBTAREAS: ver
«Rediseño» más abajo.)

- **Vínculo por id externo, fuera de los datos.** `sync_links` (RLS) guarda
  recurso + id de la tienda → registro. La app nunca identifica un registro
  de la tienda por un campo editable: la persona puede renombrar o borrar
  columnas sin romper la sincronización (regla de oro nº 1).
- **Todo es un registro común.** Lo que llega de la tienda se filtra, se
  agrupa, se suma en tableros y dispara automatizaciones como cualquier otro
  registro. Cuánto compró un cliente es un rollup sobre sus líneas, no un
  número copiado de la tienda: sale bien aunque el cliente compre como
  invitado.
- **Clientes invitados.** WooCommerce sólo lista los registrados, pero un
  pedido de invitado también es de alguien: se identifica por `email:x`, y el
  registrado por `id:N`. Las dos claves de una misma persona apuntan al MISMO
  registro (dos vínculos, un registro), en los dos sentidos: la cuenta que
  aparece adopta el registro de invitada, y la compra sin sesión de alguien
  con cuenta va a su registro.
- **Productos variables.** Cada variación (talla, color) es un registro propio
  vinculado al producto; una línea de pedido apunta al producto Y a la
  variación, así se suma por los dos.
- **Campos de otros plugins (`meta_data`).** Se DESCUBREN (clave, cuántos
  registros la tienen, un ejemplo y un tipo sugerido; las que empiezan con
  `_` se marcan internas) y la persona elige cuáles traer a una columna.
  Traer una relee ese recurso entero para rellenar lo existente. Un valor
  estructurado (ACF, datos serializados) se guarda como JSON en un texto: se
  ve y se busca, aunque no se edite como dato.
- **Incremental por fecha de modificación (keyset).** Productos y pedidos se
  piden con `orderby=modified` + `modified_after` desde un cursor (fecha + ids
  de ese segundo, porque la API compara por segundo y el filtro es
  exclusivo), guardado por página: una corrida cortada sigue donde quedó.
  Una tienda vieja que ignora el filtro se detecta y se pagina por número.
  Los clientes no admiten ese filtro: los nuevos se detectan por id
  descendente y los cambios llegan en un barrido completo diario, como el
  stock de las variaciones.
- **Una corrida a la vez.** Candado en Redis por sincronización (renovado en
  cada página) + `pg_advisory_xact_lock` en cada escritura: una corrida y un
  aviso que lleguen juntos no crean el mismo pedido dos veces.
- **Ni la importación inicial ni una resincronización completa disparan
  automatizaciones.** Son puestas al día, no novedades: nadie quiere 3.000
  WhatsApps de "pedido nuevo" al conectar la tienda.
- **Los límites del plan mandan.** Si la tienda trae más registros de los que
  el plan permite, la corrida se detiene con el motivo en pantalla; nada se
  borra ni se trunca a escondidas.
- **Los datos son de la empresa (ADR-S09).** Dejar de sincronizar o
  desconectar la tienda conserva las listas y todo lo traído.

**Fase 3 (v0.1.207) — tiempo real y edición en los dos sentidos.**

- **Avisos de la tienda (webhooks).** En modo tiempo real se registra en la
  tienda un aviso por tema (pedidos, productos y clientes: creado/actualizado/
  borrado/restaurado) apuntando a `POST /public/store-hooks/:token`. La tabla
  `store_hooks` (migración 0054, SIN RLS, como `automation_hooks`) guarda
  token → sincronización y el secreto de firma CIFRADO con `SECRETS_KEY`.
  Cada entrega se verifica con `base64(HMAC-SHA256)` sobre el cuerpo CRUDO en
  tiempo constante (firma mala → 401; token desconocido → 404 opaco, y la
  tienda apaga el aviso sola); el «ping» sin tema se contesta 200 porque sin
  eso WooCommerce no crea el aviso. La respuesta no espera a escribir: el
  aviso se encola (WooCommerce corta a los 5 s y desactiva el aviso tras
  varias entregas fallidas), y la ruta tiene un cupo de rate limit 10× el
  general porque los avisos llegan en ráfaga desde una sola IP.
- **Red de seguridad.** En tiempo real igual se sincroniza cada hora, y en esa
  vuelta los avisos que la tienda desactivó se reactivan y los que faltan se
  vuelven a crear. Si la tienda no acepta los avisos (clave de sólo lectura,
  la tienda no llega a este servidor), el modo NO cambia y se dice por qué;
  en el alta, cae a intervalos con el motivo a la vista.
- **Un borrado en la tienda no borra nada acá**: el registro queda con estado
  «trash» (ADR-S09); un borrado de algo que nunca se trajo no crea nada.
- **Edición en los dos sentidos (opt-in).** `RecordChangeHub` (módulo global)
  avisa en proceso cuando una PERSONA o una AUTOMATIZACIÓN cambia un
  registro; si vive en una lista de la tienda con la edición activada, se
  encola el envío. **Sólo viaja lo que cambió** (mandar el registro entero
  pisaría, por ejemplo, un stock que la tienda bajó con una venta que todavía
  no llegó) y los valores se leen al enviar (si la edición se revirtió, se
  manda lo que la tienda ya tenía: inocuo). Las columnas que viajan están en
  `STORE_WRITE_BACK_FIELDS` (shared) más la meta traída a columnas; totales,
  líneas e invitados son de sólo lectura. **Sin bucles por construcción**: el
  motor de sincronización escribe por su propio camino y nunca emite en el
  hub, así que lo que llega de la tienda no vuelve; y el aviso que la tienda
  manda tras recibir el cambio no encuentra diferencias.
- **Inventario (v0.1.208).** El stock es el dato más vivo de una tienda y el
  que peor se sincroniza por fecha: una venta baja el stock de una VARIACIÓN
  sin tocar la fecha de modificación del producto, así que el incremental por
  `modified_after` no la veía hasta el barrido. Por eso **cada pedido nuevo o
  modificado dispara un refresco del stock de lo que vendió** (un GET por
  lote con `include=`, ≤100 ids, para productos y por padre para
  variaciones), y una vez por día se barren TODOS los productos (plugins que
  cambian stock sin pasar por un pedido). El estado de inventario se DERIVA
  al mapear (agotado / bajo / en stock / por encargo / por variación / sin
  control) con el umbral del producto o, si no tiene, el general de la tienda
  (`/settings/products`, leído al conectar). Lo que exige cruzar listas
  (vendidas en 30 días, meses de cobertura, stock de las variaciones) son
  rollups y computed del pack: se recalculan solos en cada lectura. El pack
  trae además la vista «Para reponer», un kanban por estado y el tablero
  «Inventario».
- **Versión del pack.** `settings.pack_version`: las tiendas conectadas con un
  pack anterior se actualizan solas en su próxima corrida
  (`BlueprintService.extend`, bajo el lock de la sincronización — nunca en
  paralelo con una corrida) agregando SÓLO lo que falta: campos, vistas y
  tableros; nada existente se pisa ni se borra.
- **Reposición: órdenes de compra (v0.1.209 — RETIRADA en v0.1.213, ver
  «Rediseño»).** WooCommerce sólo acepta el
  stock ABSOLUTO (`stock_quantity`), así que sumar es leer–sumar–escribir: se
  hace un GET del producto o variación EN LA TIENDA y se escribe
  `antes + delta` — nunca sobre el número que tiene la app, que puede estar
  atrasado respecto de una venta. Una variación que hereda el stock del
  producto (`manage_stock: 'parent'`) se suma al padre, y un producto variable
  sin stock propio se rechaza (se pide por variación). El pack (versión 3)
  suma tres listas en la carpeta de la tienda —Proveedores, Órdenes de compra
  y Líneas de compra— y en productos/variaciones las columnas «Sumar al
  stock», «En camino» (rollup de lo pendiente de las líneas de órdenes
  enviadas o recibidas a medias) y «Último movimiento». Las órdenes son
  registros comunes y la lógica cuelga del `RecordChangeHub`: al pasar una
  orden a «Recibida» (o «Recibida parcial» con lo recibido por línea) cada
  línea suma la DIFERENCIA entre lo que corresponde y lo que ya aplicó
  (`aplicada`), así re-guardar el estado no suma dos veces y corregir una
  cantidad recibida ajusta sólo la diferencia. «Sumar al stock» es un ajuste
  suelto: la celda se vacía con una escritura condicional (sólo si sigue
  teniendo ese número) ANTES de tocar la tienda, así dos procesos no pueden
  aplicar el mismo ajuste. Todo corre bajo un lock por sincronización y las
  escrituras del propio servicio no emiten en el hub (sin bucles). La
  selección de «Para reponer» arma la orden con una cantidad SUGERIDA
  (`ventas 30 d + alerta − stock − en camino`, mínimo 1) y el costo de la
  última compra; el marcador `settings.store_sync {connection_id, role}` en
  cada lista le dice a la interfaz dónde ofrecerlo (no viaja al duplicar ni
  en plantillas). El listado de records ganó `ids=` (puntuales) y
  `related_to=<campo>:<registro>` (los que apuntan a un registro), que es lo
  que usa la sección «Vinculados» de la ficha y la resolución de títulos de
  los campos relation en la tabla (una query por columna y página).

- **Identificadores (v0.1.210, pack 4).** Cada registro de la tienda se puede
  reconocer y abrir del otro lado: «Editar en WooCommerce» en productos,
  variaciones (el enlace va al PRODUCTO padre: WordPress edita las
  variaciones adentro de su producto) y clientes registrados; el enlace
  público de la variación; y el SKU en la línea de compra, que se completa
  solo (al proveedor se le pide por SKU). La foto del producto se ve como
  MINIATURA (`config.display = 'image'` de un campo URL, elegible también en
  cualquier campo URL propio) y se pide por `GET /media/image?url=` — un
  proxy con sesión, por `safeWebhookFetch` (guard anti-SSRF, redirecciones
  re-validadas), sólo tipos de imagen sin script (SVG afuera) y hasta 5 MB.
  Es un proxy y no un `<img>` directo porque la CSP del SPA es
  `img-src 'self'`: abrirla exigiría tocar el proxy del servidor a mano (la
  auto-actualización no lo toca) y dejaría que el texto de un registro
  dispare pedidos del navegador a terceros.

**Rediseño (v0.1.213, pack 5) — la lista de la tienda es un ESPEJO, no una
segunda tienda.** Feedback del usuario: el pack confundía (productos en una
lista y sus variaciones en otra, líneas en una tercera; listas —proveedores,
órdenes de compra— que WooCommerce no tiene) y dejaba hacer cosas que la
tienda no acepta (crear un producto sin galería, pasar un variable a simple,
borrar variaciones) o que la próxima sincronización pisaría en silencio.

- **Tres listas; variaciones y líneas como subtareas.** Productos (con cada
  variación como subtarea de su producto) · Pedidos (con cada línea como
  subtarea de su pedido) · Clientes. Se reusa el modelo de subtareas de
  v0.1.132 (`records.parent_id`, un nivel): la tabla muestra el primer nivel y
  la flechita despliega lo de adentro. `settings.lists.variations` apunta a la
  lista de productos y `settings.fields.variations` a su mapa de campos (igual
  líneas → pedidos), así el motor sigue hablando de cinco RECURSOS aunque haya
  tres LISTAS. Una columna `tipo` dice qué es cada fila (simple / variable /
  variación / agrupado / externo; pedido / línea) y los tableros y rollups la
  filtran para no contar dos veces. El padre variable muestra el RESUMEN de sus
  variaciones (stock y valor sumados, estado más urgente), recalculado por el
  motor, y el pie de la tabla y los grupos cuentan sólo el primer nivel.
- **La tienda manda; la app no crea ni borra.** Una lista marcada
  (`settings.store_sync` v2: `{connection_id, role, store_name, store_url,
  write_back, fields: {slug del pack → id}, meta_fields}`) rechaza el alta, el
  borrado y la importación (403 `store_managed`) en TODOS los caminos: API,
  importador, automatizaciones (`create_record` se saltea con el motivo),
  asistente IA/MCP y recurrencias (no se clona; no se rueda una fecha de la
  tienda). La interfaz no ofrece esos botones y enlaza a «Crear en WooCommerce».
- **Qué se edita desde acá.** Sólo precios, stock y estados (publicación del
  producto, estado del pedido), y sólo con «Editar desde la app» activado —
  lo que la tienda acepta sin ambigüedad. Las reglas son PURAS y compartidas
  (`store-rules.ts` en shared: `storeCellAccess` + `storeValueError`), así el
  backend rechaza (403 `store_field_locked` / 400 `store_invalid_value`) con
  la MISMA función que la UI usa para dibujar el candado y el motivo antes de
  que alguien lo intente: un producto variable no tiene precio propio, un
  rebajado no puede superar al normal, el stock es entero, el estado de stock
  lo calcula WooCommerce si el stock está controlado, las líneas de un pedido
  no se tocan. Una automatización que intente otra cosa saltea ese campo con
  el motivo en el log, en vez de escribir algo que la tienda no aceptaría.
- **Columnas de la tienda vs. propias.** Una columna de la tienda sólo cambia
  de nombre, descripción e índice (ni tipo, ni opciones, ni se borra: la
  próxima sincronización la necesita tal cual); las columnas PROPIAS de la
  empresa son libres, se marcan «sólo en Imagina» y nunca viajan.
- **Se retiró la reposición** (proveedores, órdenes de compra, líneas de
  compra, «Sumar al stock», «En camino», «Último movimiento»): no es un
  concepto de WooCommerce y mezclaba un sistema de compras dentro del espejo.
- **Dejar de sincronizar quita la marca** (y borrar la conexión también): las
  listas quedan como listas comunes, editables sin restricciones. La migración
  0055 limpia las marcas huérfanas de desconexiones anteriores.
- **Migración automática (pack <5 → 5)** en la próxima corrida de cada tienda,
  bajo el lock de la sincronización: se borran los campos que el pack nuevo no
  tiene y se rearman los rollups; las variaciones y líneas viejas (registros
  de las listas separadas) se dan de baja junto con sus vínculos y se vuelven
  a traer como subtareas en una vuelta completa; se recrean los tableros; las
  listas de compras VACÍAS se borran y las que tienen datos de la empresa
  QUEDAN como listas comunes (sin la marca) — los datos nunca se pierden
  (ADR-S09). Queda en la bitácora (`store_sync.migrate`).

**Columnas editables elegibles + prueba contra un WooCommerce real
(v0.1.214).** El usuario preguntó si cada cliente podía elegir qué se edita
desde la app (el nombre de los productos, la categoría, las etiquetas). Se
convirtió la lista fija de v0.1.213 en un **catálogo** (`STORE_EDITABLE_CATALOG`
en shared) del que la empresa elige por lista:

- **Catálogo** — productos: precios, stock, control de stock, estado del stock,
  alerta de stock bajo y publicación (vienen prendidas: es lo de v0.1.213) +
  nombre, SKU, categorías y etiquetas; pedidos: estado (prendido) + nota del
  cliente, email y teléfono de facturación; clientes: nombre, email, teléfono,
  empresa y ciudad (sólo los que tienen CUENTA: un invitado no tiene a quién
  editar); y cualquier **campo de otro plugin** traído a columna (`meta:<id>`).
  Lo que NO está en el catálogo no se puede habilitar: datos que calcula la
  tienda (totales, líneas, estado de inventario) o sin forma segura de
  escribirse (la dirección armada, el país como código).
- **Dónde vive.** `connection_syncs.settings.editable[rol]` (sin clave = lo de
  por defecto, así una tienda ya conectada no cambia) y viaja a la marca de la
  lista (`store_sync.editable`), que es lo que leen `storeCellAccess` en el
  backend y en la interfaz: siguen siendo UNA función. Se elige desde la
  página de la tienda y desde Ajustes → Campos de cada lista (la misma
  elección vista desde dos lugares). Prender/apagar UNA columna viaja como
  `editable_toggle` y se aplica sobre lo guardado bajo el lock de la fila: si
  la pantalla mandara la lista entera, una caché vieja (otra pestaña, otra
  persona) pisaría la elección — lo atrapó el E2E.
- **Categorías y etiquetas** — la API de WooCommerce sólo acepta `[{id}]` (el
  nombre es de sólo lectura), así que el motor resuelve cada slug a su id y
  CREA el término que falte (con `term_exists` → se busca por nombre). La
  opción nueva se crea desde el selector con el slug que le va a dar WordPress
  (`wpTermSlug`), así al volver de la tienda es la misma opción y no una copia.
- **Un rechazo vuelve atrás.** Si la tienda rechaza un envío con 4xx (un SKU
  repetido, un email que no acepta), se relee el objeto y la app queda con el
  valor de la TIENDA; el motivo queda en «El último cambio no llegó a la
  tienda». Antes el valor quedaba distinto en los dos lados.
- **Renombrar un producto con variaciones relee sus variaciones** (su nombre
  lleva el del producto).
- **Crear una opción al vuelo** (`POST /lists/:l/fields/:f/options`) — el
  «Crear» del selector de opciones llamaba a un endpoint que la nube nunca
  implementó (el plugin lo tenía): crear una opción desde la tabla o la ficha
  fallaba en TODAS las listas. En una lista de la tienda sólo lo aceptan
  categorías y etiquetas habilitadas.

La prueba contra un **WooCommerce 11 real** (WordPress + WooCommerce en el
entorno, no la tienda simulada) encontró además: (a) el nombre del sitio se
perdía porque el índice `/wp-json/` de una tienda real pesa >1 MB y pasaba el
tope de lectura → se pide con `?_fields=name`; (b) WordPress sólo entrega
avisos a los puertos **80, 443 y 8080** (`wp_safe_remote_post`, error «A valid
URL was not provided» que queda sólo en el log de la tienda) → la app lo
detecta ANTES de registrar y dice por qué no puede ir en tiempo real, y la red
de seguridad horaria avisa si la tienda había DESACTIVADO avisos por fallas de
entrega; (c) borrar la CONEXIÓN (no sólo dejar de sincronizar) dejaba los
avisos registrados en la tienda llamando a una URL muerta → un hook previo al
borrado (`ConnectorsService.onBeforeRemove`) los saca mientras todavía hay
credenciales.

**Slug del producto (v0.1.215, pack 6).** Columna «Slug» en Productos (se
lee decodificado: WordPress guarda `caf%c3%a9`) y editable si la empresa la
habilita (`slug_url` en el catálogo; una variación no tiene dirección propia).
WordPress limpia el valor (acentos, espacios, mayúsculas) y lo hace único
(`-2`): lo que vuelve de la tienda es lo que queda en la app. Rechazado antes de
mandarlo: vacío o con `/`, `?` o `#`. Verificado contra WooCommerce real que la
dirección vieja responde 301 a la nueva (WordPress guarda `_wp_old_slug`).
**Upgrade liviano**: una tienda en el pack 5 sólo SUMA las columnas que le
faltan (`addMissingPackFields`: `extend` sin tableros, vistas ni registros) y
pide una vuelta de productos para llenarlas — re-correr la migración 5 entera
re-traería las variaciones y rehacería los tableros sin motivo. De paso:
`runJob` marcaba las listas con los ajustes leídos ANTES de actualizar el pack,
así que la marca quedaba vieja hasta la corrida siguiente (también en la
migración de v0.1.213); ahora relee después de actualizar.

**Edición masiva en la tienda (v0.1.217).** La edición masiva genérica
(ADR-S25) escribe columnas de la APP, y una tienda tiene mucho que la app no
refleja como columna (atributos, peso, medidas, clase de envío, visibilidad,
destacado, reservas, fechas de la rebaja). Para eso hay un módulo propio que
opera SOBRE WOOCOMMERCE: `POST /lists/:l/store-bulk/preview|apply`
(`bulk_actions`, sólo en la lista de Productos y con «Editar desde la app»
encendido). Reglas: (a) **se calcula sobre el objeto FRESCO de la tienda**,
no sobre la copia de la app (que puede venir atrasada por una venta), leído en
lotes de `include=` ≤100; (b) **los productos variables se editan por
variación** (`include_variations`, default sí): un precio o un stock se aplica
a cada variación, y el producto padre no tiene precio propio; (c) la escritura
va por la **API batch** (`/products/batch` y
`/products/{padre}/variations/batch`, 100 por pedido) — un producto rechazado
no tira a los demás y vuelve con su motivo; (d) **el plan es puro**
(`planBulkUpdate` en `woo-bulk.ts`): de las operaciones y el objeto sale el
cuerpo exacto, los cambios legibles y las notas (rebajado ≥ normal se
descarta, una variación que hereda el stock del padre se saltea); la vista
previa y la aplicación lo comparten; (e) **categorías y etiquetas** se agregan
o quitan sin pisar las demás (la API reemplaza la lista entera, así que se
manda la lista completa resultante); una que no existe se CREA en la tienda
sólo al aplicar — la vista previa la muestra como «(nueva)» con un id
provisorio negativo; (f) **atributos**: WooCommerce reemplaza el arreglo
entero, así que se arma completo; uno que usan las variaciones no se
reemplaza ni se quita (rompería las variaciones), sólo se le pueden sumar
opciones; (g) respeta el **catálogo de columnas editables**
(`BULK_OP_COLUMN`: si la empresa no habilitó «Nombre», no se renombra en
lote); (h) lo que devuelve la tienda se aplica a la app con
`engine.applyStoreObjects` (el mismo upsert de la sincronización, que sí
dispara automatizaciones — es un cambio real), recalculando los resúmenes de
los productos variables. Bitácora `store_sync.bulk_edit`. El cliente aplica en
tandas de 25 productos con avance.

**Consecuencias.** La sincronización corre en su propia cola de BullMQ con un
tick por minuto (cross-tenant por la conexión base, cada corrida dentro de su
tenant, como las recurrencias), más los trabajos `hook` (avisos) y `push`
(envíos a la tienda). La URL de los avisos se arma con `APP_BASE_URL`: la
tienda tiene que poder llegar a ese dominio. Migrar una empresa lleva la
sincronización con ids re-mapeados; los avisos NO viajan (son de la
instancia de origen) y se vuelven a registrar en la primera vuelta.


### ADR-S25 — Edición masiva: operaciones sobre el valor de cada fila, con vista previa (v0.1.216)

**Contexto.** La acción masiva sólo sabía «poner este valor en esta columna»
sobre las filas seleccionadas de la página. No servía para lo que de verdad se
hace en lote: subir los precios un 10 %, redondearlos a los terminados en 900,
sumar stock, agregar o quitar una etiqueta sin pisar las demás, correr una
fecha un mes, calcular una columna a partir de otra — ni para hacerlo sobre
TODO lo que coincide con un filtro y no sólo sobre lo visible.

**Decisión.**

- **Una edición es una lista ORDENADA de operaciones** (`bulkOperationSchema`,
  shared): `set`/`clear`, aritmética (`add`, `subtract`, `multiply`,
  `divide`, `percent`), `round` a una grilla `k × múltiplo + ajuste` en una
  dirección (hacia arriba nunca baja un precio: 11.000 → 11.900 con «terminar
  en 900»), `calc` (`A ± × ÷ B` con columnas o números), `copy` entre
  columnas con conversión de tipo, texto (prefijo, sufijo, buscar/reemplazar
  literal, mayúsculas, espacios), opciones (`add_options`/`remove_options`),
  checkbox (`toggle`), fechas (`shift_date` con fin de mes, `today`) y
  vínculos de relaciones (`add_links`/`remove_links`). Qué operación admite
  cada tipo lo define `BULK_OPS_BY_TYPE`: la UI arma su menú con eso y el
  motor lo exige.
- **Cada operación parte del valor ACTUAL de cada fila** y se encadenan (la
  segunda ve lo que dejó la primera). Una operación que no se puede hacer en
  una fila (un operando vacío, un valor que el campo no acepta, lo que la
  tienda no admite) deja la FILA ENTERA sin escribir y se reporta: aplicar
  medio cambio sería peor que no aplicarlo.
- **La vista previa y la escritura usan la MISMA función**
  (`applyBulkOperations`, pura, en shared). La vista previa resuelve todos los
  registros abarcados (selección o filtros + búsqueda de la vista, con el
  alcance de EDICIÓN del rol, tope 5.000) y devuelve los ids que cambian, un
  ejemplo de antes → después y los que no se pueden cambiar con el motivo. El
  cliente aplica esos ids en tandas de 200 (pedidos cortos, barra de avance;
  cada tanda recalcula sobre el valor del momento), y una fila que entró al
  filtro después de la vista previa no se cuela.
- **Escribir es `RecordsService.update`, fila por fila**: una edición masiva
  es exactamente N ediciones a mano — validación con el validador compartido,
  ACL por fila, bitácora, automatizaciones, recurrencias y, en una lista de
  tienda, las reglas de `store-rules` y el envío a WooCommerce. Un solo aviso
  de realtime por tanda.
- **Permisos**: editar la selección exige poder editar registros (el agente
  edita lo suyo); editar TODO lo de un filtro exige `bulk_actions`. Las
  columnas ocultas para el rol no se escriben ni se leen como operando, y las
  calculadas (computed/lookup/rollup) no se escriben.
- **Los números se tipean con los separadores de la empresa** (formato
  regional, v0.1.104): con punto de miles, «12.500» es doce mil quinientos.

**Consecuencias.** `POST /lists/:l/records/bulk-edit/preview` y
`POST /lists/:l/records/bulk-edit`. El viejo `POST .../records/bulk`
(borrar / poner un valor) se mantiene para duplicar y eliminar. La edición
masiva de una lista de tienda con los datos que la tienda tiene y la app no
(atributos, clase de envío, peso, visibilidad…) es otra pieza: la hace la tienda
en lote (ver la nota de ADR-S24 de v0.1.217).

**Deshacer (v0.1.218).** Cada edición masiva —de la app o de la tienda— queda
en un HISTORIAL (`bulk_edits` + `bulk_edit_items`, migración 0056, RLS) con,
por fila, el ANTES y el DESPUÉS de lo que cambió. Decisiones:

- **Una edición, aunque se aplique en tandas**: la primera tanda la abre y
  devuelve `edit_id`; las siguientes lo repiten (sólo la misma persona, la
  misma lista y el mismo tipo pueden colgarle filas).
- **El DESPUÉS es lo que quedó guardado**, no lo que se pidió (en la app, lo
  que devolvió `RecordsService.update` ya validado; en la tienda, lo que
  devolvió WooCommerce en el lote). Así «sigue igual» se compara bien.
- **Conflictos**: deshacer sólo vuelve atrás las filas que siguen en su
  después. Si alguien las tocó en el medio, pisarlas le borraría ese cambio:
  se muestran con qué cambió y sólo se revierten si la persona marca
  «Volverlos atrás igual». Los registros borrados se cuentan aparte.
- **Deshacer es otra edición común**: en la app pasa por `RecordsService.update`
  (ACL, bitácora, automatizaciones, reglas y envío de la tienda); en la tienda,
  por la misma API batch y el mismo upsert al espejo. Se aplica en tandas de
  100 con avance.
- **Quién**: la propia se deshace siempre; la de otra persona —y cualquiera de
  la tienda— exige `bulk_actions`.
- **30 días**: lo más viejo se purga al abrir una edición nueva. El historial
  no viaja al migrar una empresa (ADR-S23): es del servidor, no del cliente.
- La comparación es PURA (`sameBulkValue` en shared; `storeDrift` /
  `snapshotBody` en `woo-bulk.ts`), igual que los resúmenes en criollo del
  historial (`summarizeBulkOperations` / `summarizeStoreBulkOperations`).

**Actualizar desde un archivo (v0.1.219).** La edición masiva por ARCHIVO: un
CSV no crea filas, las EMPAREJA con registros que ya existen por una columna
clave —el ID de la app (la columna «ID» del export) o un campo de texto,
email, teléfono, enlace o número (SKU, email, documento)— y cambia sólo las
columnas mapeadas (`POST /lists/:l/import/update/preview` y `/update`,
`import_records`). Reglas:

- **Clave normalizada** igual en JS y en SQL: sin espacios ni mayúsculas; el
  teléfono, sólo dígitos; el número, como número. Los candidatos se buscan por
  la expresión normalizada y después se cargan con el alcance de EDICIÓN de la
  persona (lo que no puede editar no empareja).
- **Una fila, un registro**: una clave repetida en el archivo (se detecta en
  TODO el archivo, no sólo en el tramo) o que coincide con más de un registro
  es un error de fila, nunca una elección al azar.
- **Sólo lo que difiere** del valor actual se escribe (celda vacía = no tocar,
  salvo «una celda vacía vacía el campo»); opciones de select por etiqueta y,
  en listas comunes, las nuevas se agregan como en el import.
- **Vista previa y aplicación con la misma función**, aplicación en tramos de
  200 filas con avance, cada cambio por `RecordsService.update` y en el
  historial de ADR-S25 → un archivo equivocado se DESHACE.
- **En una lista de la tienda sí se puede** (a diferencia del import, que crea):
  cada cambio pasa por `store-rules` —la vista previa lo avisa por fila con
  `storeRuleError`, compartido con la edición masiva— y viaja a WooCommerce.
  Crear lo que falta (`upsert`) queda para las listas comunes.

**Estructura en lote: mover, duplicar, borrar y asignar (v0.1.220).** Las
acciones que cambian la FORMA de la lista, no los valores, con el mismo
contrato que la edición masiva: vista previa sobre la selección o todo lo que
coincide con la vista, aplicación en tandas de 200 y deshacer desde el
historial (`POST /lists/:l/records/bulk-structure/preview` y `/bulk-structure`;
capability según la acción —crear, editar o borrar— y `bulk_actions` para
actuar por filtro). Tres tipos nuevos en `bulk_edits.kind`, cada uno con su
reverter:

- **Mover como subtareas** (o sacarlas al primer nivel): mismas reglas que el
  alta de una subtarea — un solo nivel, el padre de primer nivel, y un
  registro con subtareas propias no baja. El historial guarda el padre
  anterior; si alguien lo movió de nuevo después, es conflicto.
- **Duplicar**, con o sin sus subtareas: se copian los campos escribibles (ni
  calculados, ni vínculos, ni archivos — mismo criterio que «Duplicar» de la
  fila). El límite del plan se consulta con el lote ENTERO (SEC-09). Deshacer
  borra las copias que nadie tocó después.
- **Borrar** (suave): el historial guarda las subtareas que se fueron con el
  registro y sus vínculos salientes, así deshacer lo trae entero
  (`RecordsService.restoreDeleted`, que sólo re-vincula destinos vivos).
- Una subtarea cuyo padre también está en el lote no se toca aparte: se va (o
  se copia) CON él — si no, se borraría o duplicaría dos veces.
- **Asignar** no es una acción nueva: es la edición masiva ya apuntada al campo
  de persona («poner»), con su vista previa y su deshacer.
- Las listas de la tienda no se reestructuran desde la app (`store_managed`).

**Edición en lote programada (v0.1.221).** Acción de automatización
`bulk_edit` (`{filter_tree?, operations[]}`, los MISMOS `BulkOperation` que la
edición a mano): edita todo lo que coincide con el filtro EN EL MOMENTO en que
corre, en la lista de la automatización. Pensada para el disparador «En un
horario» («cada lunes, subir 5 % los precios de X»), sirve con cualquiera.

- **Corre fuera de la transacción del motor**: el motor encola un job
  `bulk-edit` y registra «en curso». Si corriera adentro, sus escrituras (por
  `RecordsService`, otra conexión) esperarían los locks que la transacción del
  motor tiene tomados —p. ej. un «Actualizar campo» previo sobre el mismo
  registro— y la corrida quedaría colgada.
- El job (`AutomationBulkRunner`) usa `BulkEditService.runForAutomation`: la
  misma vista previa + tandas que usa una persona, como admin del sistema, así
  queda en el **historial de ediciones masivas con deshacer** (sin autor:
  `bulk_edits.user_id` null; sólo quien tiene `bulk_actions` la deshace) y deja
  una corrida propia de la automatización con el resultado.
- **No re-dispara automatizaciones** (`update(..., {noAutomations})`): una
  regla «al actualizar → editar en lote» se re-dispararía por cada fila.
- **Horarios de verdad**: la UI guardaba `frequency` y el scheduler sólo leía
  `cron` → una automatización programada desde el editor nunca corría.
  `scheduleCron` (shared) es la única traducción (frecuencia + hora + día →
  cron, con `tz` IANA del navegador de quien la guarda; un `cron` explícito
  manda) y al arrancar se re-registran los horarios de todas las activas.
- **Ejecutar ahora** (`POST /lists/:l/automations/:id/run`, sólo
  programadas): encola la misma corrida que el horario.

**Edición masiva desde el asistente y el MCP (v0.1.222).** Herramienta
`propose_bulk_edit` (capability `bulk_actions`) en el MISMO registro de
herramientas (ADR-S21): operaciones por SLUG en el vocabulario del modelo
(`translateBulkOps` las lleva a `BulkOperation`; opciones de select por value o
etiqueta), destino por filtros / búsqueda / ids —o `all_records: true`, que
tiene que pedirse explícitamente— y vista previa calculada con
`BulkEditService.preview` (la misma de la interfaz): la tarjeta muestra el
antes → después real de una muestra, cuántos ya estaban así y cuáles no se
pueden. Aplicar corre por `BulkEditService.apply` en tandas → queda en el
historial de la lista con **Deshacer**. Las automatizaciones que propone el
asistente aceptan la acción `bulk_edit` con `filters`/`operations` por slug
(`translateBulkEditActions`, también dentro de `if_else`); una
automatización dentro de una lista NUEVA (pack de `create_list`) no puede
llevarla porque sus campos todavía no tienen id.


**Tienda: precio desde el costo y variaciones en lote (v0.1.223).** Dos
operaciones de la edición masiva de la tienda (ADR-S24):

- **`price_from_field`** — precio normal o rebajado = `columna de la app ×
  factor + suma`, con el mismo redondeo a grilla. La columna es típicamente
  una propia «sólo en Imagina» (el costo) y se lee POR OBJETO: la de cada
  variación para las variaciones (cada talla puede costar distinto), vía
  `sync_links` → registro, con el alcance de la persona. Sin valor → ese objeto
  queda como está, con nota; una columna inexistente o no numérica es 400. El
  planificador sigue siendo puro (`BulkPlanContext.source`).
- **Crear variaciones** (`/store-bulk/variations/preview|apply`): atributos
  (global por id o propio por nombre) × valores → combinaciones
  (`variationCombos`, shared; tope 100 por producto). `planVariations` (puro)
  saltea las que ya existen —una variación sin ese atributo («cualquier Talla»)
  cubre todos sus valores— y suma los valores nuevos a los atributos del
  producto SIN quitar nada. Sólo productos variables. Escribe con
  `/variations/batch {create}` y el espejo se actualiza por `applyStoreObjects`.
  **Deshacer** es un kind propio del historial (`store_create`): borra las
  creadas (`{delete}`) salvo las que se modificaron después en la tienda
  (`date_modified_gmt`), y la app las saca al releer el producto.


### ADR-S26 — Plantillas v3 de la ficha: secciones, formas por tipo y datos vinculados (v0.1.230)

**Contexto.** La ficha "CRM" (plantilla v2) era un grid de bloques sueltos
con coordenadas `x/y/w/pos` y los campos referenciados por SLUG. No podía
expresar lo que se espera de una ficha moderna: pestañas, secciones con
columnas, cada campo mostrado de la forma que corresponde a su tipo y —sobre
todo— gráficos e indicadores de los registros VINCULADOS (las facturas de este
cliente por estado). El usuario lo calificó, con razón, de "mediocre".

**Decisión.** Modelo nuevo, `settings.record_layout_v3` (schema en
`packages/shared/src/schemas/record-layout.ts`):

```
{ v: 3, theme, header, pages: [{ id, name, sections: [{ columns: [8,4], blocks: [[…],[…]] }] }] }
```

- **Secciones con columnas que suman 12** y una PILA de bloques por columna —
  no hay coordenadas que se desalineen—. Se valida en el servidor al guardar
  (400 `invalid_record_layout`).
- **Todo por ID** (`field_id`, `list_id`): regla de oro nº 1.
- **Formas por tipo** (`FIELD_DISPLAYS`, shared): cada tipo declara cómo se
  puede mostrar (porcentaje → barra/anillo/medidor; fecha → relativa/cuenta
  regresiva/hoja de calendario; select → etiqueta/etapas…). Una forma que el
  tipo no admite cae a la primera (`resolveDisplay`): un campo que cambió de
  tipo no rompe la ficha.
- **Fuentes de datos** (`LayoutDataSource`): el registro, los vinculados por
  una relation (el sentido se DEDUCE: si el campo es de esta lista son sus
  destinos; si es de otra, los que apuntan acá; `direction` sólo para la
  relación de una lista consigo misma) o una lista entera.
- **Un bundle por ficha**: `POST /lists/:l/records/:id/layout-data` calcula en
  UN request los gráficos y tablas de vinculados (regla de oro nº 8), cada
  bloque AISLADO (`{ __error }` propio). Viaja la config de los bloques y no un
  id de plantilla para que el editor previsualice lo no guardado — por eso el
  servidor valida la fuente (la relación tiene que tocar la lista del
  registro), exige ver el registro base (404 si no) y calcula con el ACL de
  quien mira. El acotamiento es `relatedScopeSql` (records/related-scope.ts),
  que usan el motor de agregados y el listado de registros: los gráficos usan
  el MISMO motor que los tableros (`DashboardsService.computeLooseWidget`) y
  el front los dibuja con los MISMOS componentes (`WidgetDataOverrideContext`
  les inyecta los datos).
- **Compatibilidad**: nada se migra en la base. La ficha usa, en orden, la v3
  guardada → la v2 elegida (personalizada o integrada) convertida al vuelo
  (`migrateCrmV2ToV3`, pura, con tests) → la automática (`autoRecordLayout`,
  pura: cabecera con etapas y chips, cifras, detalles y una pestaña por
  relación con KPIs, dona por estado, evolución mensual y tabla).
- **Se guarda sola**, campo por campo (`useRecordAutosave`), sin botón.

**Consecuencias.** El editor (fase B) y el portal del cliente (fase C) escriben
y leen este mismo modelo. La v2 queda como formato de ENTRADA (conversión)
mientras exista el editor anterior.

**Fase B — el editor (v0.1.231).** El editor de la ficha (`/lists/:slug/
template-editor`) escribe v3 directamente; el editor por grid v2 de la ficha
se retiró (el del portal sigue en el shell viejo hasta la fase C). Decisiones:
- **El lienzo es la ficha REAL**: `LayoutBody` (cabecera + pestañas +
  secciones) se reusa con `renderHeader`/`renderSection` para envolver cada
  pieza con los controles del editor, y los bloques se dibujan con los mismos
  componentes, los mismos datos (`layout-data` con la plantilla EN EDICIÓN,
  sin guardar) y un registro de verdad elegible. Lo que se ve es lo que queda.
- **Operaciones puras** (`editor/layoutOps.ts`, con tests): insertar, mover
  (índice interpretado como lo ve quien arrastra), duplicar, columnas que
  siempre suman 12 (lo que sobra se junta en la última pila), secciones y
  pestañas. La interfaz nunca arma una plantilla inválida.
- **Historial de fotos** (60) con agrupación por clave de lo que se tipea (un
  título no es un paso de deshacer por letra). Atajos Ctrl+Z / Ctrl+Shift+Z /
  Ctrl+S / Ctrl+D / Supr.
- **Guardado explícito**, a diferencia de la ficha (que se guarda sola):
  diseñar no es cargar datos, se publica para todo el equipo cuando está
  listo. Salir con cambios pide confirmación.
- **Vista de celular por container queries**: las columnas, el `#id` y las
  fechas de la cabecera responden al ancho del CONTENEDOR (`.imcrm-lay-root`),
  así el marco de 390 px del editor se ve exactamente como el teléfono.
- **Catálogo en el vocabulario de quien diseña** (`blockCatalog.ts`): "Dona",
  "Tablero por estado", "Un campo destacado" crean el mismo tipo de bloque con
  otra configuración de arranque; los gráficos y vinculados nacen apuntando a
  la primera relación de la lista (o a la lista entera si no hay).

**Fase C, primera mitad — el asistente/MCP diseña en v3 (v0.1.232).**
`propose_configure_record_layout` escribe `record_layout_v3`: el modo
`design` describe la ficha completa por slug y por nombre de lista
(`buildRecordLayoutV3`, puro), el `custom` anterior se convierte con
`migrateCrmV2ToV3`, y elegir una plantilla integrada BORRA el v3 — la regla es
una sola: si hay v3 guardado, manda. `get_list_schema` expone el diseño v3 y
las listas vinculadas en los dos sentidos (`linked_lists`), que son las fuentes
válidas de los gráficos. Queda la segunda mitad: el portal del cliente sobre
este mismo modelo, con sus datos acotados por `portalScope`.

**Fase C, segunda mitad — el portal del cliente en v3 (v0.1.233).** El portal
usa el MISMO modelo y la MISMA vista que la ficha. `settings.portal_layout_v3`
manda; si no hay, la plantilla anterior (`portal_template`) se convierte al leer
(`migratePortalTemplateToV3`, puro, en shared) y si tampoco hay, sale un diseño
automático de sólo lectura. El servidor resuelve cuál vale (`resolveLayout`) y
lo usan tres caminos: lo que recibe el cliente (`GET /portal/me`), lo que abre
el editor (`GET /lists/:l/portal/layout`) y la whitelist de edición. Reglas:
- **Edición por bloque**: el cliente sólo edita los campos de los bloques
  `field`/`fields` marcados `editable` y de tipos escribibles
  (`portalEditableFieldIds`, `PORTAL_EDITABLE_TYPES`). Es la whitelist del
  `PATCH /portal/me`; sin bloques editables, nadie edita.
- **Datos acotados al cliente, no a un rol**: los gráficos y tablas se calculan
  con el mismo motor de la ficha (`RecordLayoutDataService.portal`), pero el
  alcance lo pone la FUENTE: una relación lleva a lo vinculado a su registro;
  una lista entera NO es toda la lista — es su relación hacia la lista del
  portal o, si no hay, su campo persona = el cliente; sin vínculo, falla
  cerrado. A una tabla sólo viajan las columnas del bloque (+ el título), sin
  relaciones ni personas, y los archivos como URLs firmadas.
- **Un solo request**: `GET /portal/me` trae el diseño, sus datos y las
  definiciones de los campos que usan (el portal siembra el cache: los
  componentes de los tableros pintan colores y etiquetas sin tocar la API del
  equipo).
- **Bloques que el portal no dibuja**: descripción, resumen interno y acceso al
  portal (`sanitizePortalLayout`). Ajustes de página en `layout.page`.
- **Editor**: el mismo de la ficha con `target: 'portal'` (biblioteca filtrada,
  interruptor «El cliente puede editarlo», ajustes de página, vista previa con el
  alcance del cliente del registro elegido vía `POST /lists/:l/portal/layout-data`).
  Se borró el editor anterior del portal y su renderer.
- **Asistente/MCP**: `propose_configure_portal` escribe `portal_layout_v3`
  (modo `design`, el mismo vocabulario de la ficha + `editable` y `page`; el
  vocabulario anterior se convierte).

**Pulido de composición y bloques (v0.1.234).** Tres reglas nuevas:
- **Las plantillas integradas (contacto, negocio, tarea, soporte) ya no se
  convierten desde su grilla v2** (3 · 6 · 3 con la actividad al medio): son
  variantes (`flavor`) de `autoRecordLayout`, que sólo cambian el ORDEN de los
  grupos. Sólo `custom` sigue pasando por `migrateCrmV2ToV3`.
- **El reparto de columnas se decide al dibujar con el ancho que hay**
  (`planSection`, puro): una columna sin bloques cede su ancho; si alguna
  quedaría más angosta de lo que su contenido necesita, la sección pasa a
  "de a dos" (piezas chicas), a "principal + lateral" 8 · 4 (tres o más
  columnas) o se apila. El diseño guardado no se toca.
- **Las propiedades se acomodan al ancho de su TARJETA** (container queries,
  `.imcrm-props` / `.imcrm-prop`): etiqueta y valor lado a lado con lugar, uno
  arriba del otro en una columna angosta. Antes la etiqueta fija de 200 px
  escondía el valor.

**Las plantillas integradas son composiciones distintas (v0.1.235).** El
"sólo cambia el ORDEN de los grupos" de v0.1.234 dejó a las cinco plantillas
casi idénticas: elegir otra en Apariencia no cambiaba nada visible. Ahora
cada `flavor` de `autoRecordLayout` es una composición propia con su tema:
**Automática** (cifras arriba, detalles 8 · lateral 4; tema `default`),
**Contacto** (sin cifras: datos a la izquierda 4 · notas y conversación a la
derecha 8; `fresh`, el email primero bajo el título), **Venta** (el monto en
grande, el vencimiento como cuenta regresiva y fechas clave al costado;
`corporate`), **Tarea** (plana y sin portada ni avatar, responsable como
primer chip, cuenta regresiva arriba del lateral; `minimal`) y **Soporte**
(la actividad primero, cliente y detalle al costado; `warm`). Siguen
generándose solas con los campos y relaciones de la lista y el editor
arranca desde la elegida.

**Cada plantilla es una ficha propia (v0.1.236).** Las cinco integradas
dejan de ser variaciones de la misma pila de tarjetas: cada una arma su
composición con los bloques y formas que lucen su caso — Resumen (banda de
indicadores + adelanto de lo vinculado), Perfil (botones de contacto,
datos de la persona, sus registros como tarjetas), Oportunidad (valor y
cierre en una banda, vinculados como tablero, historial a lo ancho), Tarea
(plana, conversación bajo el trabajo, panel lateral) y Ticket (franja de
SLA, conversación protagonista, historial del cliente). Las secciones
ganan `style.tone` (`accent` | `muted`): una banda que se mezcla con
transparencia sobre la superficie del tema, en vez de un hex fijo.

**Plantillas del portal del cliente (v0.1.237).** El portal tiene su propia
galería (`portalTemplateLayout`, `packages/shared/src/templates/
portal-templates.ts`): Mi cuenta, Estado de cuenta, Seguimiento de proyecto,
Mis solicitudes y Mi pedido — pensadas para el CLIENTE, no para el equipo.
Usan el color de la marca de la empresa (no fijan acento) y se distinguen por
composición y superficies. Reglas que cumplen por construcción: no muestran
personas, relaciones, calculados ni campos que suenan internos (costo,
margen, comisión, interno…); sólo los datos de contacto de «Mi cuenta» son
editables; las listas vinculadas son las que se ELIGEN en la galería con una
casilla (se ve qué columnas verá el cliente) y de entrada se marca sólo la
que cumple el papel de la plantilla. Elegir una arma el diseño en el editor
(se puede deshacer, no se guarda hasta tocar Guardar). El portal AUTOMÁTICO
pasa a ser «Mi cuenta» de sólo lectura, con las listas que el admin ya
habilitó en `settings.portal.related_lists` (fail-closed: sin habilitar, no
entra ninguna) y sin canal de mensajes.

**Correo de cuenta honesto + diagnóstico de plataforma (v0.1.238).** Los
correos de CUENTA (verificación del alta, recuperación de contraseña,
invitaciones) no tienen empresa, así que sólo pueden salir por el SMTP de
Plataforma (`platform:smtp`) o el del `.env`. Sin ninguno caían al transporte
`log`: la app respondía "enviado" y nada llegaba. Ahora
`MailService.accountMailStatus()` lo sabe y, en producción, "olvidé mi
contraseña", reenviar la verificación y el reset del operador responden **503
`mail_unavailable`** con un mensaje accionable (sin mirar si el email existe:
no filtra cuentas). Re-guardar el SMTP de Plataforma con la contraseña vacía
la CONSERVA (antes la borraba y el SMTP dejaba de autenticar). La cuenta sin
verificar se avisa en TODA la app (banner bajo la barra superior, con
Reenviar), no sólo en Ajustes → Seguridad.
**El pool de Postgres** ahora escucha `error`: un cliente ocioso que la base
corta (reinicio, `pg_terminate_backend`, idle timeout del proveedor) emitía un
`error` sin listener y **tumbaba el proceso del API** — eso era el "error
interno" intermitente del login mientras systemd lo levantaba otra vez. Se
suman `keepAlive`, `idleTimeoutMillis` y `connectionTimeoutMillis`, y el login
del front reintenta UNA vez ante un error transitorio (5xx genérico, 502 del
proxy o `fetch` caído; nunca credenciales, freno ni un 5xx con código propio).
**Plataforma → Diagnóstico** (superadmin, `GET/DELETE
/system/diagnostics`): estado del correo de cuenta, últimos correos (enviado /
no enviado / fallido, por qué vía y con el motivo) y últimos errores del
servidor agrupados (pedidos 5xx, base de datos, proceso). Vive en Redis
(`diag:mail`, `diag:errors`, 200 entradas, 14 días); el registro es de módulo
(lo usan el filtro global y el pool, que viven fuera de la DI), best-effort, y
nunca guarda la query string (puede traer tokens).

**Cuarta tanda de seguridad (v0.1.239).** SEC-33 a SEC-37, cada uno
verificado contra el código antes de tocarlo.
(SEC-33) **Correo**: la cuota mensual cuenta DESTINATARIOS distintos (to + cc
+ bcc), no mensajes; por el SMTP COMPARTIDO (plataforma o `.env`) una empresa
no elige la dirección remitente — conserva el nombre visible y su dirección
pasa a `Reply-To` (con SMTP propio manda la empresa); y el cuerpo HTML de
Gmail/Outlook escapa los valores interpolados igual que `send_email`
(`HTML_PARAMS` + `mergeHtml` obligatorio en `compileIntegrationValues`).
(SEC-34) **Solo-lectura fuera del HTTP**: `tenantIsReadOnly(tx, tenantId)`
corta las automatizaciones (eventos, programadas, por fecha, por webhook) y
las recurrencias de una empresa impaga/archivada — antes sólo el `TenantGuard`
lo aplicaba. El webhook entrante responde 403 `workspace_read_only` y tiene
tope POR TOKEN en Redis (60/min, 2.000/h; el rate limit general es por IP).
(SEC-35) **Sesiones y cuentas**: los sockets del realtime se re-validan cada
60 s (sesión viva sin deslizar su TTL — `SessionService.peek` —, cuenta
activa, sigue siendo miembro); freno de **login CSRF** por Fetch Metadata /
`Origin` para todo pedido que cambia algo (`common/cross-site.ts`; quedan
abiertas las superficies públicas pensadas para otros sitios: `/public/*`,
OAuth/MCP, webhooks de pagos); freno POR CUENTA (10 fallos / 15 min) a la
contraseña que piden cambiar contraseña, desactivar 2FA y borrar la cuenta;
`portal/request-access` responde sin esperar al SMTP (el tiempo de respuesta
revelaba quién es cliente de quién); y apagar el portal de una lista
(`portal.enabled: false`) corta al instante a los clientes con sesión.
(SEC-36) **ACL a través de relaciones**: un lookup/rollup hacia una lista que
el viewer no ve COMPLETA (sin acceso, sólo lo suyo/asignado, o el campo de
origen oculto) cuenta como campo oculto — no viaja, no filtra, no ordena, no
se agrega (`ThroughEngine.restrictedFor`); y un `computed` que usa como
entrada un campo oculto se oculta también (`withDependentComputed`).
(SEC-37) **Despliegue**: el `.env` de un snapshot restaurado descarta
variables que cambian cómo arranca el proceso (`NODE_OPTIONS`, `LD_*`,
`*_PROXY`, `PATH`…); el workflow de release firma el bundle con ed25519 si
existe el secreto `RELEASE_SIGNING_KEY` (el verificador del servidor existía
desde SEC-12 pero nada producía la firma) y `UPDATER_PUBLIC_KEY` acepta la
clave en una línea; y la CSP por `<meta>` deja de permitir scripts inline:
el build calcula el `sha256` de cada `<script>` inline y lo pone en
`script-src`. **Pendiente**: rol de Postgres no superusuario para la conexión
base (requiere `BYPASSRLS` + migrar instalaciones existentes por consola) y
quitar `'unsafe-inline'` de `style-src` (React escribe `style=""`; un estilo
no ejecuta código).

**Invitaciones al equipo (v0.1.240).** Sumar a alguien a una empresa ya no
exige que tenga cuenta: `AuthService.addToTenant(tenantId, {email, name?,
role})` suma la cuenta existente (con aviso por correo, best-effort) o la crea
por INVITACIÓN — contraseña aleatoria que nadie conoce + `users.invited_at`
(migración 0057) + el mismo token de un solo uso del reset pero con TTL de 7
días y textos de invitación (`/reset?token=…&invite=1`). Definir la contraseña
limpia `invited_at` y marca el email como verificado (el enlace llegó a su
casilla). Sin correo de cuenta disponible se corta ANTES de crear la cuenta
(una cuenta que no recibe el enlace no puede entrar). Reglas: el email de un
superadmin está reservado, una cuenta desactivada no se suma, un cliente del
portal de esa empresa tampoco (su acceso vive en la ficha), y reenviar una
invitación pendiente tiene tope de 3 por hora por persona. El panel de
Miembros (admin) lo aplica con el **límite de usuarios del plan**
(`max_users`, que existía desde F4 sin aplicarse en ningún lado; cuentan sólo
las personas del equipo, no los clientes del portal — también en el uso que
muestran Ajustes y la consola). La consola de plataforma reusa el MISMO
`MembersService` (guard rails de último admin y auto-baja) sin el límite del
plan: `POST/PATCH/DELETE /platform/tenants/:id/members[/:userId]`,
`…/resend-invite`, `GET /platform/users/:id/workspaces` y
`POST /platform/users/:id/resend-invite`; cada acción queda en la bitácora de
esa empresa con el operador como autor.

**Portal: varios accesos por persona y cuentas de varias empresas
(v0.1.241).** `portal_links` deja de ser único por (persona, empresa) y pasa a
único por (persona, **registro**) (migración 0058): dar acceso a otro registro
SUMA en vez de reemplazar (antes el cliente perdía su primera ficha en
silencio). Antes de dar un acceso nuevo, `GET /lists/:l/portal/access/check`
dice qué pasa con ese email EN ESA EMPRESA (`new`/`this_record`/
`other_records` con los títulos/`staff`) y la ficha avisa. Quitar un acceso
puede ser por registro (`?record_id=`); la membresía `client` y las sesiones
de esa empresa caen sólo cuando no le queda ninguno. **Sesión del portal**:
cookie PROPIA (`imbase_portal`, la de la app es `imbase_session`) — abrir un
portal ya no cierra la sesión de trabajo del mismo navegador, y `/portal/*`
sólo acepta sesiones del portal (las de contraseña o impersonación no). La
sesión guarda el acceso con el que entró (`portalLinkId`) y el portal elige
otro con `X-Portal-Account` (validado contra los vínculos de la persona EN LA
EMPRESA de la sesión: todo lo que el portal lee sigue acotado a ella).
**Cuentas de otras empresas**: la sesión trae `portalAccount` sólo si el
enlace llegó ÚNICAMENTE al correo (uno devuelto a la empresa jamás) y se abrió
en un host de la plataforma (un dominio propio lo controla una empresa);
con eso `GET /portal/accounts` lista también las de otras empresas y `POST
/portal/accounts/:id/switch` acuña un enlace de un solo uso (2 min) que abre
la sesión de esa empresa. Una sesión sin ese permiso puede pedirse por correo
el enlace de "todas mis cuentas" (`POST /portal/accounts/email-link`, a
`APP_BASE_URL`, tope 3/15 min). `request-access` manda un correo por empresa.
**Equipo de otra empresa**: alguien del equipo de A ya puede ser cliente del
portal de B (antes `portal_email_not_client`): la sesión del portal está
limitada a `/portal/*`, a B y a su cookie, y el enlace nunca se le devuelve a
B. Ser del equipo de LA MISMA empresa sigue rechazado (409
`portal_email_is_staff`).

---

**Acciones de conector bien identificadas (v0.1.242).** Todas las acciones de
un conector comparten el tipo `connector_action` y se distinguen por
`connection_id` + `action_key`. El selector "Tipo de acción" del editor usaba
el tipo como valor de la opción, así que una acción de conector cualquiera se
mostraba como la PRIMERA del catálogo (p. ej. «Enviar mensaje de WhatsApp»), y
elegir otra desde ese selector borraba la conexión. Ahora cada acción de
conector es su propia opción (`connector:<id>:<clave>`, `ActionTypeSelect`
compartido por el flujo, el lienzo y las ramas si/sino) y lo que el catálogo no
conoce se muestra tal cual. Del lado del asistente/MCP, una propuesta de
automatización valida el TIPO de cada acción (incluidas las ramas) y que una
`connector_action` apunte a una conexión y acción que existen, con sus datos
obligatorios y sin datos de más; la tarjeta nombra la acción real
(«Enviar mensaje de WhatsApp (WhatsApp)») y la descripción de la herramienta
deja claro que cambiar un campo de la app es `update_field`, nunca un conector.

---

### ADR-S27 — Sincronizar una lista desde SQL Server / Azure SQL (v0.1.243)

**Contexto.** Un cliente tiene su facturación en un ERP sobre SQL Server
(Azure SQL) y necesita verla en una lista de la app: traer cada hora o cada día
el resultado de una consulta o procedimiento almacenado y **actualizar por una
columna clave** (NIT, número de factura) en vez de duplicar. Es el mismo
problema que "actualizar desde un archivo" (ADR-S25), pero sin archivo y
programado.

**Decisión.**
- **Integración por clave** en la galería (`sqlserver`, categoría «Bases de
  datos»): servidor, base, usuario, contraseña cifrada (secret-box), puerto,
  cifrado y certificado. Conectar EJECUTA una consulta de verificación (login,
  base, versión y si el usuario puede escribir): si no conecta no se guarda, y
  un usuario con permisos de escritura se guarda con un aviso (se recomienda uno
  de sólo lectura).
- **Sólo lectura por construcción**: toda consulta corre dentro de una
  transacción que se **deshace siempre**, así que ni un `UPDATE` escrito por
  error ni un procedimiento con efectos colaterales deja cambios en la base del
  cliente. Sólo servidores públicos (`resolvePublicHost`, mismo criterio que el
  SMTP de las empresas, SEC-27); `SQL_ALLOW_PRIVATE_HOSTS=true` para una base
  en la red interna a propósito.
- **Una conexión, varias sincronizaciones** (`sql_syncs`, RLS): cada una es
  consulta o procedimiento (con parámetros), lista destino, columna clave →
  campo clave, columna → campo, y horario (cada 15 min a cada día, o diaria a
  una hora en una zona). Cola BullMQ propia (`sql-sync`) con tick por minuto y
  candado en Redis por sincronización: nunca dos corridas de la misma a la vez.
- **Emparejar, no duplicar**: la clave se normaliza igual que en "actualizar
  desde un archivo" (`normalizeKey`/`keyExpr`); si existe se actualiza SÓLO lo
  que cambió (`data || patch`), si no se crea (opcional). Cada celda pasa por el
  MISMO camino que una celda de CSV (`coerceCellValue` + `validateFieldValue`):
  una sola forma de interpretar números, sí/no y etiquetas de select. Las
  fechas `datetime` sin zona se interpretan en la zona elegida en la
  sincronización; `datetimeoffset` ya es un instante.
- **Lo que deja de aparecer** no se toca por defecto; opcionalmente se marca en
  una casilla («Está en SQL»), y sólo con un resultado completo (si se cortó por
  el tope de filas no se marca nada).
- **Automatizaciones**: la primera carga no dispara (cientos de correos de
  golpe); las siguientes sí, con el antes y el después, y quedan en la
  actividad del registro. El límite de registros del plan se respeta (las
  altas que no entran se saltean con aviso; las actualizaciones siguen).
- **Topes**: 50.000 filas por corrida, 60 s de consulta por defecto (máx 300),
  `@ultima_sincronizacion` (UTC, NULL la primera vez) para consultas
  incrementales. Empresa en solo-lectura (ADR-S09/SEC-34): no corre.
- **Driver**: `mssql` (tedious), cargado con `import()` la primera vez que se
  usa, detrás de la interfaz `SqlRunner` (los tests usan un runner falso).
  Ojo con el orden de eventos del streaming: ante un error llegan «error» y
  después «done», y el rollback sólo puede ir tras «done» (antes queda
  esperando para siempre); rollback y cierre llevan tope de tiempo igual.
- **Incremental excluye «marcar lo que falta»**: una fuente con
  `@ultima_sincronizacion` (fuera de comentarios) sólo trae lo que cambió, así
  que lo ausente no significa borrado; la combinación se rechaza al guardar.
- Las columnas sincronizadas se marcan en la lista (`settings.sql_sync`) pero
  **no se bloquean**: la base es la fuente, así que un valor editado a mano
  vuelve al de SQL en la próxima corrida.

### ADR-S28 — Portal del cliente white-label + dominio del portal aparte (v0.1.245)

**Contexto.** El portal del cliente es de CADA empresa: su cliente final no
tiene por qué saber qué herramienta usa. La marca ya llegaba al portal con
sesión (v0.1.58), pero lo que el cliente ve ANTES —la pantalla de entrar, el
enlace vencido, "cerraste sesión", la pestaña del navegador— y el correo con
el enlace mostraban la plataforma o el nombre de la LISTA. Y la empresa sólo
tenía un dominio (ADR-S17), cuya raíz abre el login del equipo.

**Decisión.**
- **Nada de la plataforma en lo que ve el cliente.** El HTML del portal es
  neutro ("Portal de clientes", ícono genérico) y al arrancar se pinta UNA
  marca vigente desde la raíz del SPA: la de la cuenta con sesión o, sin
  sesión, la del DOMINIO (`GET /public/boot` resuelve Host → empresa). En el
  dominio de la plataforma no hay empresa: portal neutro, sin marca de nadie.
  El nombre visible es `app_name` o, si no hay, el de la empresa (nunca el de
  la lista, que es interno).
- **Correo de acceso con la marca de la empresa**: asunto y nombre del
  remitente con su nombre, logo (URL absoluta firmada, 30 días) y color.
  Plantilla pura y testeada (`portal-email.ts`), todo escapado. Por el SMTP
  compartido la DIRECCIÓN sigue siendo la de la plataforma (SEC-33) y sólo el
  nombre visible es de la empresa (nodemailer `{name, address}`).
- **Dominio del portal APARTE** (`tenants.portal_domain`, único global): mismo
  ciclo que el del equipo (pedido → TXT → activo, SEC-32), nunca igual al
  dominio del equipo, y quien prueba ser dueño del DNS se lo lleva aunque otra
  empresa lo use en cualquiera de las dos columnas. `resolveHost` devuelve
  `surface: 'portal'` y la app del equipo redirige su raíz a `/portal` — así
  funciona igual detrás de Caddy o nginx sin reglas por dominio.
- **Los enlaces salen por un dominio sólo si RESPONDE**: verificado no
  alcanza (en nginx cada dominio se agrega a mano). `baseUrlFor` prueba
  `https://dominio/api/v1/public/boot` y exige que conteste esa misma empresa
  (caché en Redis 10 min / 2 min); si no, cae al siguiente: portal → equipo →
  plataforma. Un enlace a un host muerto deja al cliente afuera.
- **Pedir un enlace desde el dominio de una empresa** sólo reparte el de esa
  empresa (antes, uno por cada empresa donde el email tuviera acceso).

**Servidor.** Dos caminos documentados en `docs/runbook-custom-domains.md`:
Caddy con `on_demand_tls` gateado por el `ask` (cero pasos por empresa) o
alias por panel en ServerAvatar. La auto-actualización no toca el proxy.

**Addendum v0.1.246 — se elige ServerAvatar (alias a mano) mientras haya pocas
empresas con dominio.** Con ~10 clientes, un paso manual por dominio es más
barato que mantener Caddy por consola; Caddy queda para cuando la cantidad lo
justifique. Para que el paso manual no dependa de la memoria del operador:
- **Aviso por correo** a cada `PLATFORM_SUPERADMINS` cuando una empresa
  VERIFICA un dominio («Dominio para habilitar») y cuando quita uno ya activo
  («Dominio para quitar del servidor»), con los pasos de ServerAvatar y el
  enlace a la consola. Correo de cuenta (sin tenant, sin cuota), best-effort:
  si falla no rompe la verificación.
- **Plataforma → Dominios** (`GET /platform/domains`, superadmin con
  contraseña): para habilitar (verificados que todavía no responden), para
  quitar del servidor, funcionando y esperando verificación, cada uno con el
  estado del DNS y si responde; «Comprobar» re-prueba en vivo sin la caché.
- **Lista de retirados** (`platform:domains:retired` en Redis): un alias que
  queda en el servidor sin DNS hace fallar la renovación del certificado
  COMPARTIDO para todos, así que se recuerda hasta que el operador marca «Ya
  lo saqué». Si la empresa lo vuelve a verificar, sale solo de la lista.

### ADR-S29 — El correo de la empresa por su cuenta de Google o Microsoft (v0.1.249)

**Contexto.** Una empresa tenía dos formas de mandar sus correos
(automatizaciones, enlaces del portal, avisos): el correo de la plataforma (con
la cuota del plan, ADR-S18) o su propio SMTP (ADR-S11). Para quien usa Google
Workspace o Microsoft 365, el SMTP es la parte más difícil de la
configuración: Google exige contraseñas de aplicación que muchos admins
bloquean, y Microsoft ya retiró el SMTP con usuario y contraseña. Esas
empresas ya conectan Gmail u Outlook en Integraciones (ADR-S22) con permisos
de envío.

**Decisión.**
- **Tercera forma de envío**: la empresa elige una conexión de Gmail u Outlook
  (`tenants.settings.mail_account = { connection_id }`) y el `MailService` la
  usa **primero**, antes del SMTP propio y de la plataforma. Una sola forma
  activa: guardar un SMTP borra la elección. Sólo correos de la EMPRESA: los de
  cuenta (verificación, recuperación, invitaciones) siguen por la plataforma.
- **Por la API, no por SMTP con OAuth**: Gmail API (`users.messages.send` con el
  mensaje RFC 2822 armado acá, `multipart/alternative` con texto de respaldo) y
  Microsoft Graph (`/me/sendMail`, guardando en Enviados). El SMTP de Gmail con
  OAuth pide `https://mail.google.com/`, un permiso **restringido** que obliga a
  la auditoría CASA; `gmail.send` y `Mail.Send` son los que la conexión ya
  tiene. La petición la arma una función PURA (`mail-account-request.ts`).
- **El remitente es la cuenta conectada.** Un `from` distinto que pida una
  automatización pasa a `Reply-To`: Gmail lo reescribiría en silencio y Graph lo
  rechaza (`ErrorSendAsDenied`), así se comporta igual en los dos.
- **Falla ruidosa, nunca cambia de vía en silencio** (lección de v0.1.150): una
  conexión borrada, sin autorizar o con el acceso revocado hace FALLAR el envío
  con el motivo; el límite del proveedor es irrecuperable para la cola (Google y
  Microsoft bloquean hasta 24 h). La conexión elegida no se puede borrar ni
  desconectar (409) hasta elegir otra forma de envío, y tiene que ser del EQUIPO
  (una privada dejaría el correo de la empresa en manos de una conexión que los
  demás admins no ven).
- **Los límites a la vista, antes de elegir.** `MAIL_ACCOUNT_LIMITS` (shared)
  por tipo de cuenta, deducido de la dirección: Gmail personal ~500/día, Google
  Workspace 2.000/día, Outlook.com hasta 5.000/día (menos en cuentas nuevas),
  Microsoft 365 10.000 destinatarios/día y 30 por minuto. Se muestran con qué
  pasa si se pasan y las condiciones (remitente fijo, quedan en Enviados, no es
  para campañas, conviene una casilla compartida). Un contador de destinatarios
  por día en Redis (`mailacct:{tenant}:{día UTC}`) muestra "hoy van N de ~M" —
  aproximado y así se dice: el proveedor suma lo que la persona manda a mano.
- **Sin cuota de la plataforma**, igual que el SMTP propio (ADR-S18): no pasa
  por nuestra infraestructura. `own_smtp` del resumen de facturación pasa a
  significar "correo propio" (SMTP o cuenta).

**Alternativas descartadas.** SMTP con XOAUTH2 (permiso restringido + CASA);
dejar elegir cualquier remitente (Graph lo rechaza y Gmail lo cambia sin avisar);
cortar el envío cuando nuestro contador llega al límite (no vemos lo que la
persona manda a mano: el proveedor decide y nosotros mostramos su error).

---

### ADR-S30 — Cobro de planes por período pagado + renovación automática (v0.1.250)

**Contexto.** Hasta acá un pago aprobado dejaba a la empresa `active` SIN fecha:
pagaba una vez y quedaba activa para siempre. Además un pago pendiente (un PSE
en proceso, un pago en efectivo todavía no hecho) la pasaba a `past_due`, o sea
a solo-lectura, aunque tuviera meses pagados; y una empresa ya en solo-lectura
no podía pagar porque el `TenantGuard` le rechazaba el checkout. Las
credenciales de Mercado Pago sólo vivían en el `.env`.

**Decisión.**
- **Período pagado**: `tenants.paid_until`. Cada pago aprobado lo EXTIENDE desde
  donde termina (si todavía no venció) o desde hoy (si ya venció):
  `extendPaidUntil` en shared, con meses recortados al último día. Vencido el
  período + `BILLING_GRACE_DAYS` (5) → solo-lectura por `isEffectivelyReadOnly`
  (la misma función del guard, el resumen y la consola). `subscription_ends_at`
  sigue siendo el corte MANUAL del operador, exacto y sin gracia.
- **Dos formas de pagar**: N meses de una vez (1/3/6/12; Checkout Pro de Mercado
  Pago o PayPal) o **renovación automática** con tarjeta (suscripción
  `preapproval` de Mercado Pago, mensual, que arranca cuando vence lo ya pagado).
  Una renovación viva a la vez; una nueva autorizada cancela a la anterior.
- **Registro de pagos** `billing_payments` (RLS, único por proveedor + id del
  COBRO): es lo que hace idempotente el aviso. El cobro de una cuota llega por
  dos avisos (`payment` y `subscription_authorized_payment`) con el mismo id de
  pago → una fila, un mes. Pendiente/rechazado se registran sin tocar la empresa;
  un aviso viejo no deshace uno aprobado; un reembolso resta los meses. La
  empresa se bloquea (`FOR UPDATE`) al aplicar.
- **Avisos verificados y releídos**: firma `x-signature` (id en minúsculas, la
  parte que no viene se omite del manifest) y después se vuelve a leer el
  recurso con nuestro token. La referencia del período lleva el monto: un pago
  por menos se registra como rechazado. Un error al releer se relanza (500) para
  que el proveedor reintente.
- **Pagar en solo-lectura**: `@AllowReadOnly()` (metadata leída por el
  `TenantGuard`) en checkout y cancelar renovación.
- **Credenciales en la consola**: Plataforma → Cobros (Redis `platform:payments`,
  cifradas con `SECRETS_KEY`, viajan en el snapshot), con el `.env` de respaldo.
- **Avisos de vencimiento** por correo a los admins (vía de la plataforma) 3 días
  antes, al vencer y al cortar; una vez por período (Redis `SET NX`).
- **Sin comisión de plataforma** y Wompi sólo como conector de las empresas
  (decisiones del usuario; los conectores de cobro de las empresas son otra
  pieza).

**Alternativas descartadas.** Planes de suscripción (`preapproval_plan`) en
Mercado Pago (un plan por precio duplicaría la tabla `plans` en el proveedor;
el `preapproval` sin plan toma el monto del momento); dejar `past_due` al primer
rechazo (Mercado Pago reintenta la tarjeta durante la gracia); cambiar el
estado en el retorno del navegador (falsificable).

### ADR-S31 — Cobros de las empresas con Mercado Pago y Wompi (v0.1.251)

**Contexto.** Las empresas que usan la app para facturar (cartera, cuotas,
pedidos) le cobraban al cliente por fuera y marcaban «pagado» a mano. Pidieron
crear el link de pago desde el registro o una automatización y saber solo quién
ya pagó. Distinto de ADR-S30 (el operador cobrándole el plan a la empresa): acá
la plata va a la cuenta de **cada empresa**, sin comisión de la plataforma.

**Decisión.**
- **Dos integraciones por clave** en la galería (ADR-S22), categoría «Cobros y
  pagos»: Mercado Pago (Access Token) y Wompi (llave pública + privada +
  secreto de eventos). La credencial se **verifica antes de guardarse**
  (`/users/me` / `/merchants/{pub}`; las llaves de Wompi tienen que ser del
  MISMO ambiente) y queda cifrada. Un integración por clave ahora puede tener
  un **segundo secreto** (`secret_slot: 'signing_secret'`).
- **Link de pago = fila de `payment_links`** (RLS) atada a un registro: Checkout
  Pro (`/checkout/preferences`, referencia propia `ib_…` en
  `external_reference`) o Payment Link de Wompi (un solo uso, COP, mínimo
  $1.500). Lo crean el botón «Cobrar» de la ficha y la acción «Crear link de
  pago» de una automatización — el MISMO `createLinkInTx` — y la acción deja
  `{{pago.link}}` para la acción siguiente (WhatsApp, correo).
- **El estado nunca se le cree al aviso**: `POST /public/collections/:token`
  (tabla `collection_hooks` sin RLS, token por conexión) sólo toma el id del
  pago y lo **relee del proveedor con la credencial de la empresa**; Wompi
  además firma (SHA-256 de las propiedades + timestamp + secreto, comparado en
  tiempo constante). El pago se aplica sólo al link de ESA conexión. Mercado
  Pago recibe la URL por link (`notification_url`); en Wompi se pega una vez.
- **Reglas de estado** (`nextLinkState`, puro): un aprobado gana; un link
  pagado no se «despaga» con un intento rechazado de otro pago; el reembolso de
  ESE pago sí lo cambia; aprobado por otro monto o moneda → «Monto distinto».
  «Verificar» busca los pagos del link cuando el aviso no llegó; los pendientes
  con vencimiento pasan a «Vencido» (barrido cada 15 min, idempotente).
- **Columnas de cobro** (opt-in, «Agregar columnas»): link, estado (select con
  valores estables), fecha, monto y medio — `settings.collections.fields`. Cada
  cambio pasa por el validador del campo y deja actividad; dispara
  `record_updated` y, al quedar pagado, el disparador nuevo **«Cuando se recibe
  un pago»** (`payment_received`, con `{{pago.*}}`); en solo-lectura no corre.
- «Probar ahora» de la acción NO crea un link (sería un cobro real): muestra lo
  que se crearía.

**Alternativas descartadas.** Confiar en el cuerpo del aviso (falsificable);
una URL de avisos global (hay que saber de qué empresa es antes de leer nada);
cobrar con credenciales de la plataforma y repartir (comisión, regulación y
responsabilidad que el usuario no quiere); suscripciones recurrentes de las
empresas a sus clientes (otra pieza: hoy se arma con una recurrencia + la
acción «Crear link de pago»).


### ADR-S32 — Sin índices físicos por campo (v0.1.257)

**Contexto.** `is_indexed` (PERF-01) creaba 1-2 índices por expresión por campo
sobre `records`, la tabla que comparten todas las empresas. Las tiendas
WooCommerce marcaban varios por defecto (ID, SKU, número de pedido, email), así
que la cantidad crecía sola con cada tienda conectada.

**Medición (auditoría de pendientes, v0.1.257).** El planificador de Postgres
evalúa CADA índice de la tabla en CADA consulta, de cualquier empresa: con 890
índices por campo, planificar una consulta del listado tardaba **~70 ms**; sin
ellos, **0,6 ms**. Y no aceleraban lo que prometían: en una lista de 100k
registros un filtro por igualdad tardaba 33-34 ms con o sin el índice (el
planificador ni lo elegía, porque el índice `(tenant_id, list_id, id)` ya acota
el recorrido a la lista), y un filtro poco selectivo, 20 ms. El benchmark §13
sin índices por campo: GET con 2 filtros sobre 100k p95 **10,6 ms** (presupuesto
100), PATCH p95 **14 ms** (presupuesto 60).

**Decisión.** No se crean índices por campo. La migración 0064 borra los
existentes (`imcrm_ix_*`). `fields.is_indexed` queda como dato sin efecto (no se
rompe el API, el MCP ni las plantillas guardadas); la interfaz ya no lo muestra,
el tope de 8 por lista (v0.1.115) desaparece y los packs de WooCommerce dejan de
marcarlo. Decidido con el usuario.

**Alternativas descartadas.** Un tope global de índices (el costo vuelve a
crecer hasta el tope y una empresa consume el de las demás); frenar sólo los de
WooCommerce (arregla el origen más grande, no el problema); un índice trigram
global sobre todos los valores para el buscador (medido: una búsqueda específica
bajaba de 178 a 112 ms, pero un término presente en todos los registros subía de
127 a **483 ms** — el escaneo en paralelo de la lista es más rápido que el mapa
de bits del índice); particionar `records` por lista (cambio enorme para un
problema que se resuelve sin índices). Si alguna empresa llega a listas de
millones de registros, la respuesta es particionar, no volver a los índices por
campo.

### ADR-S33 — Zona horaria por empresa (v0.1.263)

**Contexto.** Un cliente en Colombia programó una automatización «todos los
días a las 8» y salió a las 3 de la mañana. No existía una zona horaria por
empresa: el editor guardaba la del navegador de quien la armaba, pero lo que
se creaba por el asistente, el MCP, la API o una plantilla quedaba SIN zona, y
el scheduler de BullMQ corría eso en UTC (8:00 UTC = 3:00 en Bogotá). Lo mismo
pasaba, más callado, con las fechas sin hora: un vencimiento «hoy» o una
recurrencia se evaluaban contra la medianoche de Greenwich, y «hoy» / «esta
semana» de filtros y tableros cambiaban de día a las 19:00 en Colombia.

**Decisión.** Cada empresa tiene UNA zona IANA en
`tenants.settings.format.timezone` (viaja con el formato regional, sin
migración; validada contra `Intl` y contra `pg_timezone_names` porque el SQL usa
`AT TIME ZONE`). La zona se RESUELVE en tiempo de ejecución, nunca se copia:
propia del horario → la de la empresa → UTC (`scheduleTimeZone` en shared).
Así los horarios guardados sin zona pasan a la de la empresa sin migrar datos,
y cambiar la zona de la empresa re-registra los schedulers de BullMQ de sus
automatizaciones (`TenantTimeZones.onChange`). La misma zona manda en: el
escaneo de `due_date_reached` y el tick de recurrencias (las fechas sin hora se
comparan contra la medianoche LOCAL), los rangos relativos del QueryBuilder
(`QueryClock`), los buckets temporales y deltas de los tableros, el merge tag
`{{date.today}}` y el «hoy» del asistente/MCP. Al entrar, un admin de una
empresa sin zona la ve propuesta desde su navegador (una vez por empresa); el
editor de automatizaciones muestra la zona efectiva y avisa si corre en UTC.

**Alternativas descartadas.** Guardar la zona en cada horario al crearlo (los
ya creados sin zona seguirían rotos, y cambiar la zona de la empresa obligaría
a reescribirlos todos); zona por usuario (dos personas de la misma empresa
verían «hoy» distinto en el mismo tablero, y una automatización no tiene
usuario); seguir en UTC y convertir sólo en la interfaz (el error real es del
servidor, que es el que dispara).

---

### ADR-S34 — Correos diseñados por bloques, compatibles con Gmail y Outlook (v0.1.265)

**Contexto.** La acción «Enviar email» de las automatizaciones era un cuadro de
texto con una casilla «Enviar como HTML». Para un correo con formato había que
escribir HTML a mano, y el HTML que se escribe "normal" (divs, flex, márgenes,
`<style>`) se rompe en Outlook de Windows (motor de Word) y Gmail descarta
parte de los estilos. La firma tampoco se veía: era un botón que pegaba el HTML
de la firma DENTRO del cuerpo (en modo texto salía con las etiquetas a la
vista) y el merge tag `{{signature}}` que prometía Ajustes nunca se resolvió.

**Decisión.** El cuerpo puede ser un DISEÑO por bloques
(`config.body_mode: 'design'` + `config.design`, schema `emailDesignSchema` en
shared): título, texto con formato (árbol ProseMirror, la misma whitelist que
la descripción del registro), botón, imagen, datos del registro, columnas,
separador, espacio, firma y HTML propio, más un tema (colores, tipografía del
sistema, ancho, esquinas). Se guarda el MODELO, nunca el HTML: el HTML lo arma
`renderEmailHtml` al enviar, y es la misma función que dibuja la vista previa
del editor (WYSIWYG por construcción). El renderizador usa sólo lo que funciona
en todos los clientes: tablas `role="presentation"`, estilos inline, ancho fijo
con condicional `<!--[if mso]>`, columnas híbridas (inline-block + tabla MSO,
se apilan solas en el celular), botones con `bgcolor` + padding en la celda,
imágenes con `width` en atributo, preheader oculto y la parte `text/plain`
(`renderEmailText`) del multipart. Todo lo que sale del diseño se escapa —
texto literal y valores de las variables— y las URLs se validan después de
resolver las variables. La FIRMA es una opción explícita de la acción
(`include_signature` + `signature_user_id`): la de una persona del EQUIPO
(un cliente del portal o una cuenta desactivada no firman), leída al enviar,
ubicable con el bloque «Firma» o al final; si no hay firma el correo sale igual
y el run lo dice. Las imágenes subidas usan una URL pública firmada de 5 años
(`POST /files/:id/public-url`, sólo PNG/JPG/GIF/WebP) con el dominio de la
plataforma: un correo se relee mucho después de enviado. «Enviarme una prueba»
(`POST /lists/:l/automations/test-email`) arma el correo con el MISMO
compositor del motor contra un registro real y lo manda SÓLO a la casilla de
quien prueba. Los modos texto y HTML de siempre siguen (las acciones viejas no
cambian: sin `body_mode`, `is_html` decide).

**Alternativas descartadas.** Guardar HTML generado por el editor (el diseño
quedaría congelado: cada mejora del renderizador sólo valdría para correos
nuevos, y editar sería re-parsear HTML); un editor de terceros tipo
Unlayer/GrapesJS (dependencia pesada, HTML propio que no controlamos y que no
conoce nuestras variables ni la firma); MJML en el servidor (otra toolchain y
otro lenguaje, cuando el subconjunto que necesitamos es chico y testeable a
mano); web fonts (no cargan en Outlook ni en Gmail).


**Addendum v0.1.270 — modo oscuro e imágenes fluidas.** (a) Las imágenes ya no
fijan el ancho de su tabla (`width="600"` hacía que el correo quedara más ancho
que la pantalla del teléfono, con scroll lateral): la tabla ocupa el 100% y la
imagen se achica con `width:100%;max-width:Wpx`, conservando el atributo
`width` para Outlook de Windows. (b) El tema gana `dark` (apagado por
defecto = lo de siempre, el correo se declara sólo-claro y cada programa decide).
Encendido: `color-scheme: light dark` y un bloque
`@media (prefers-color-scheme: dark)` (más los selectores `[data-ogsc]` /
`[data-ogsb]` de Outlook.com) que cambia SÓLO lo pintado con los colores del
tema, marcado con clases `ib-bg`/`ib-surface`/`ib-tx`/`ib-mu`/`ib-bd`; lo que
el autor coloreó a mano y las bandas de color conservan sus colores (texto claro
sobre una banda clara sería ilegible). Gmail no respeta `prefers-color-scheme`:
aplica su propio oscurecimiento — la vista previa del editor lo SIMULA
(inversión de los claros) cuando el tema no trae colores oscuros, y fuerza el
`@media` cuando sí los trae. Se descartó derivar los colores oscuros solos
(cada marca tiene su criterio y un acento oscuro sobre fondo oscuro se pierde).

---

### ADR-S35 — Documentos PDF desde los registros y las automatizaciones (v0.1.266)

**Contexto.** El usuario pidió generar documentos —cuentas de cobro, recibos,
proformas— con los datos de un registro, diseñarlos en un editor visual con
plantillas y mandarlos adjuntos por correo desde una automatización. La duda
era si eso saturaba la app (render pesado) o el disco (un PDF por envío).

**Decisión.** (a) **Modelo, no archivo**: una plantilla es un DISEÑO por bloques
(`document_templates`, por lista, RLS; schema `docDesignSchema` en shared):
encabezado (logo + datos de quien emite + título + número + fecha), título,
texto con formato, datos del registro, **tabla de ítems** (las filas son los
registros VINCULADOS por una relación, en cualquiera de los dos sentidos, con
el ACL de quien genera), **totales** (suma de una columna, un campo, porcentaje
de otra fila, suma con restas o texto; resultado disponible como
`{{totales.<id>}}`), imagen, separador, espacio, salto de página, firma y
columnas, más hoja (carta/A4/oficio, orientación, márgenes) y pie con
«Página x de y». El PDF se arma AL PEDIRLO con la MISMA función en la vista
previa del editor, el botón de la ficha y la automatización (WYSIWYG por
construcción). (b) **Render liviano en el proceso**: pdfmake (JS puro, fuentes
Roboto embebidas, sin red ni disco: `setUrlAccessPolicy`/`setLocalAccessPolicy`
cerrados, imágenes sólo PNG/JPG como data URL, validadas por magic bytes y
≤3 MB) — una cuenta de cobro pesa ~30 KB y tarda 100-450 ms. Se descartó
Chromium/Puppeteer (cientos de MB de RAM por instancia, otro proceso que
cuidar). Tope de 8 MB por PDF. (c) **El disco sólo se usa si se pide**: por
defecto el PDF se genera, se usa (descarga o adjunto) y se descarta; guardarlo
es explícito («Guardar en» un campo Archivo), cuenta contra `max_storage_mb` y
deja `{{pdf.link}}` (URL firmada absoluta de 30 días) para mandarlo por
WhatsApp. (d) **Variables legibles**: en un documento `{{campo}}` sale como se
lee en la ficha (montos con los separadores de la empresa, fechas en su
formato, etiquetas de opciones); `|value` da el crudo; `|letras`/`|pesos`
(«un millón de pesos», «con 50/100») y `|larga` («8 de octubre de 2026») son
modificadores nuevos que también valen en correos y webhooks. (e) **Adjuntos
de correo** (`MailMessage.attachments`, base64, hasta 5 y 15 MB): SMTP por
nodemailer, Gmail como `multipart/mixed` y Graph como `fileAttachment` — Graph
tiene un tope de 3 MB por pedido simple y se rechaza con el motivo en vez de
truncar. (f) En una automatización, la acción «Generar un PDF» corre DENTRO
del tx del run (ve lo que escribieron las acciones anteriores) y el correo
reusa el PDF ya generado de la misma plantilla. Borrar una plantilla que usa
una automatización se rechaza con la lista (409). La plantilla viaja en la
migración de empresa (ADR-S23) con sus ids re-mapeados.

**Alternativas descartadas.** Chromium headless con HTML→PDF (pesado; además
el HTML del editor de correos no sirve para papel: paginar, repetir cabeceras
de tabla y el pie de página son problemas propios); guardar cada PDF generado
(el disco crece con cada envío sin que nadie lo pidiera); reusar el diseño de
correos tal cual (los bloques de papel —ítems, totales, salto de página, firma—
no tienen sentido en un correo, y los del correo —botón, preheader— no en
papel). **No es factura electrónica**: una factura DIAN exige XML UBL firmado
y validación previa; el documento lo dice y la plantilla trae la nota de no
responsable de IVA.

**Fase 2 (v0.1.267) — consecutivo, QR y portal.** (g) **Numeración por
plantilla** (`design.numbering`: prefijo, dígitos, desde qué número, campo de
texto opcional donde guardarlo): un número por (plantilla, registro) en
`document_numbers` (migración 0068, RLS, únicos por registro y por número). Se
EMITE la primera vez que el documento se genera de verdad (ficha, automatización
o portal) bloqueando la fila de la plantilla (`SELECT … FOR UPDATE` sobre
`next_number`) y se REUSA después: regenerar no gasta otro. La vista previa sólo
mira el próximo. Como la emisión va en la transacción del que genera, si ésta
revierte el número queda libre: no hay huecos por fallas. El texto ya formateado
(«CC-0042») se guarda al emitir, así cambiar el prefijo no renumera lo emitido.
Se usa con `{{documento.numero}}` (y `{{pdf.numero}}` en las acciones que siguen
a «Generar un PDF»); guardado en un campo, el mismo PDF que lo emite ya lo
muestra y una acción posterior no lo pisa. (h) **Bloque QR** nativo de pdfmake
(vectorial, sin dependencias), con variables — el link de pago, la web, el
número —; configurado pero vacío para un registro no se dibuja, sin configurar
se ve el hueco. (i) **Descarga desde el portal**: la plantilla marcada
«Disponible en el portal» aparece en «Tus documentos» del cliente
(`GET /portal/me/documents/:id`); el servidor sólo recibe el id de la plantilla
y arma SIEMPRE el registro del acceso del cliente — una plantilla no publicada,
de otra lista o de otra empresa da 404. Bajarlo emite el número igual que
generarlo desde la ficha. `document_numbers`, `next_number` y `portal_visible`
viajan en la migración de empresa.

### ADR-S36 — Almacenamiento propio de cada empresa + enlace del PDF sin guardarlo (v0.1.268)

**Contexto.** El usuario preguntó cómo evitar que miles de PDF generados por
los clientes llenen el disco del servidor, y propuso que cada empresa pueda
guardar sus archivos en su propio Google Drive o almacenamiento S3-compatible
(Amazon S3, Backblaze, R2…) — y que eso NO cuente para el límite del plan.
Eligió hacer las dos cosas juntas: S3 primero, Drive después.

**Decisión.** (a) **El PDF no necesita archivo**: sin «Guardar en», la acción
«Generar un PDF» deja `{{pdf.link}}` como un enlace firmado de 30 días
(`/api/v1/public/documents/:plantilla/:registro?tenant&exp&sig`, HMAC con
`FILES_SIGNING_SECRET` y un scope propio `doc`, distinto del de archivos) que
ARMA el PDF al abrirlo — cero bytes en disco. Contrapartida aceptada: muestra
los datos del momento en que se abre (el número, una vez emitido, no cambia).
La ficha gana «Copiar enlace (30 días)» (exige poder ver el registro). Firma
alterada, vencido, otra empresa o un registro de otra lista: el mismo 404
opaco. (b) **Almacenamiento por empresa como integración**: «Almacenamiento
S3» es una app por clave de la galería (endpoint, región, bucket, clave de
acceso, carpeta, path-style) — una sola integración cubre AWS, Backblaze B2,
Cloudflare R2, Wasabi, DigitalOcean Spaces y MinIO. Conectar SUBE, LEE y
BORRA un archivo de prueba: una credencial que no sirve para guardar no se
guarda. La elección vive en `tenants.settings.storage = { connection_id }`
(mismo patrón que la cuenta de correo, ADR-S29) y sólo puede ser una conexión
del EQUIPO. (c) **Cada archivo recuerda dónde quedó**
(`attachments.storage_connection_id`, migración 0069, null = la plataforma):
cambiar de elección no rompe nada, lo viejo se sigue sirviendo desde donde
está. La mudanza es explícita y por tandas de 20 (leer → escribir en destino →
cambiar la fila de forma condicional → borrar el origen), en los dos sentidos;
volver al servidor respeta el espacio del plan. (d) **Fuera del plan**: el
cupo (`assertCanUpload`, el uso de Plan y uso y la consola) cuenta SÓLO lo
guardado en la plataforma. (e) **Descarga directa**: la URL propia firmada
(`/files/:id/signed`) sigue siendo la que viaja en la app, el portal y
`{{pdf.link}}`; para un archivo en el bucket responde 302 a un enlace
prefirmado de 15 minutos con el mismo tipo y disposición seguros de SEC-21 —
ni disco ni ancho de banda del servidor. Las lecturas internas (imágenes de un
PDF, exportar una empresa) leen por la conexión de cada fila. (f) **Nada se
pierde en silencio**: con un almacenamiento elegido que no responde, subir
FALLA con el motivo (503 `storage_unavailable`) en vez de caer al servidor y
comerse el cupo. La conexión elegida, o que todavía guarda archivos, no se
borra ni se desconecta (409), y con archivos no se le puede cambiar el bucket,
la dirección ni la carpeta (la clave sí se rota). Borrar una empresa NO toca
su bucket (son sus datos). Migrar una empresa trae los bytes al servidor de
destino y avisa que hay que volver a elegir el almacenamiento. (g) **SSRF**:
la dirección la escribe la empresa → https obligatorio, un literal IP privado
se rechaza y los nombres pasan por el `guardedLookup` del driver
(`STORAGE_ALLOW_PRIVATE_HOSTS=true` para un MinIO interno a propósito). (h)
Con un endpoint propio el SDK manda checksums sólo cuando la operación los
exige (`WHEN_REQUIRED`): desde la 3.729 los manda siempre y varios proveedores
compatibles los rechazan.

**Alternativas descartadas.** Subir directo del navegador al bucket con URLs
prefirmadas de PUT (cada proveedor exige configurar CORS en el bucket: un paso
más para el cliente y un error difícil de diagnosticar; los archivos de la app
son chicos y el servidor ya hace streaming); un solo bucket de la plataforma
con "carpetas por empresa" fuera del plan (lo paga el operador, que es justo lo
que se quería evitar); migrar automáticamente al elegir (miles de archivos en
una request: mejor explícito, por tandas y con progreso).

**Google Drive (v0.1.269).** Segundo proveedor, sobre la app de Google del
operador: integración `google_drive` con el permiso **`drive.file`** (NO
sensible: la app sólo ve los archivos que ella misma crea, nunca el resto del
Drive). Los archivos van a una carpeta «Imagina Base» que se busca o se crea la
primera vez y se recuerda en la conexión (`config.storage_folder_id`); si
alguien la borra desde el Drive, se crea de nuevo. Drive asigna su propio id,
así que la interfaz de storage ganó `writeKeyed` (el proveedor elige la clave:
`gdrive:<id>`) y en el Drive cada archivo se ve con su NOMBRE real. Drive no
tiene enlaces prefirmados: la descarga pasa por el servidor con el token de la
empresa (streaming, sin tocar el disco). Elegir un almacenamiento (Drive o S3)
sube, lee y borra un archivo de prueba antes de aceptarlo. Un Drive con
archivos no se re-autoriza con OTRA cuenta de Google (los archivos quedarían en
el Drive anterior). Errores de Google traducidos (token rechazado → reconectar;
Drive lleno; límite de pedidos). La guía de verificación de Google suma la
Drive API, la justificación de `drive.file` y el paso del video; la política
de privacidad sugerida lo menciona.

**Pendiente.** Retención opcional (borrar PDF guardados después de N días,
conservando número y datos).


### ADR-S37 — Estilo por bloque compartido por correos y PDF + tipografías incluidas (v0.1.272)

**Contexto.** El usuario pidió que el editor de correos tenga controles de
diseño "de verdad" —tamaño, margen y relleno, borde, grosor de letra, varias
tipografías, esquinas y sombras de los botones— en casi todos los bloques, y
que se revisara qué es compatible con los programas de correo y con el
generador de PDF.

**Decisión.** (a) **Una sola capa de estilo** (`design-style.ts` en shared,
`blockStyleSchema`) para los dos editores: tipografía (familia, tamaño, peso
400/600/700/800, itálica, interlineado, espaciado entre letras, mayúsculas),
margen arriba/abajo, relleno por lado, borde (grosor, tipo, color, lados),
esquinas y sombra, y en el correo si el fondo es banda o recuadro. Todo
OPCIONAL: un bloque sin `style` sale exactamente como antes. Lo propio de un
elemento va aparte (`elementStyleSchema`: el botón —relleno, ancho fijo,
borde, esquinas, sombra— y el marco de la imagen). Cada bloque suma lo que le
corresponde (espacio entre párrafos, tipo/largo de línea del separador,
colores y ancho de nombres de «Datos del registro», proporción/separación/
alineación y "no apilar" de las columnas, recuadro por columna) y el tema gana
fuente de títulos, tamaño base, interlineado, color de títulos y enlaces,
márgenes de la hoja, y borde/sombra de la hoja.
(b) **Lo que un medio no sabe dibujar no se ofrece** (`STYLE_SUPPORT`): el PDF
no tiene esquinas redondeadas ni sombras (pdfmake), así que su editor no las
muestra; lo que se ve distinto en algún programa de correo lleva su aviso
(`STYLE_CAVEATS`: Outlook de Windows dibuja esquinas rectas y no muestra
sombras; Outlook y el PDF sólo distinguen normal y negrita).
(c) **Correo compatible**: borde, fondo, relleno y esquinas en la CELDA
(`border-collapse:separate`, que Outlook respeta), el relleno del botón en la
celda (`mso-padding-alt`), interlineado en px con `mso-line-height-rule`, y
los títulos con tamaño propio ≥26 px se achican en el celular con una clase
generada. **Fuentes**: del sistema (se ven igual en todos lados) y **web**
(Google Fonts: Apple Mail, iPhone, Outlook de Mac, Samsung y Thunderbird las
cargan; Gmail y Outlook de Windows muestran la de respaldo). El `<link>` va
dentro de `<!--[if !mso]>` y Outlook de Windows recibe una regla que fuerza la
de respaldo por clase (`ib-wf-*`): sin eso cae a Times New Roman.
(d) **Tipografías incluidas en el repo** (`scripts/vendor-fonts.mjs` desde
`@fontsource/*`, licencias OFL/Apache): WOFF en `apps/api/assets/fonts` para
el PDF —fontkit NO abre WOFF2— y WOFF2 en `apps/web/public/email-fonts` para la
vista previa del editor, que reemplaza el `<link>` de Google por esas mismas
fuentes (`localizeGoogleFonts`) porque la CSP de la app no deja cargar fuentes
de otro dominio. En el PDF TODAS se embeben: las del sistema con su
equivalente libre de mismas medidas (Arial→Arimo, Times→Tinos,
Courier→Cousine, Georgia→Gelasio), así el texto ocupa lo mismo que en el
correo. El release copia `apps/api/assets` al bundle.
(e) **Interfaz** (`components/design/DesignStyleControls.tsx`): números
tipeables con su unidad (px en el correo, pt en el PDF; vacío = automático con
el valor por defecto como pista; ↑/↓ y Shift), selector de tipografía con cada
fuente escrita en sí misma, secciones plegables con "restablecer", relleno con
candado de 4 lados, y **copiar/pegar diseño** entre bloques (también entre el
correo y el PDF: es el mismo formato).

**Alternativas descartadas.** Fuentes web propias servidas desde nuestro
dominio en los correos (los programas de correo no las cargan sin CORS y
Gmail las ignora igual); un `<style>` con clases por bloque en vez de estilos
en línea (Gmail recorta `<style>` en varios casos y Outlook ignora la mitad);
ofrecer esquinas y sombras en el PDF dibujándolas con canvas (pdfmake no lo
soporta en tablas y el resultado no se imprime bien).

**Addendum v0.1.273 — UX de los editores (correo y PDF).** Con la capa de
estilo de arriba los paneles quedaron con controles repetidos (el «Tamaño»
Grande/Mediano/Chico del bloque y el tamaño numérico de «Tipografía»; el
«Espacio arriba y abajo» del bloque y los márgenes exactos; el color de fondo en
una sección y la banda/recuadro en otra). Regla desde acá: **cada ajuste
aparece una sola vez**. Los valores rápidos que viven en el bloque (`level`,
`size`, `padding`) se muestran como **atajo en la misma fila que el valor
exacto** del estilo; el atajo se marca sólo si no hay un exacto que lo pise, y
elegirlo **borra el exacto en el mismo cambio** (un solo paso de deshacer). Sin
migración: el modelo no cambia, sólo dónde se edita. El panel del bloque se
divide en **Contenido** y **Estilo** (pestaña recordada entre bloques; un
bloque que tiene sólo una de las dos no muestra pestañas), y el esquema del
documento pasa a una pestaña propia **Estructura** (antes vivía debajo de la
paleta de bloques y se confundía con ella). Las secciones del panel Estilo son
piezas componibles de `DesignStyleControls` (`TypographySection`,
`BackgroundSection`, `SpacingSection`, `BorderSection`, `ElementSection`) que
los dos inspectores ordenan según el bloque; los atajos del correo son
funciones puras con tests (`inspectorPresets.ts`). Descartado: un único panel
largo con todo abierto (era el problema) y fusionar el nivel del título con el
tamaño numérico en el modelo (rompería los diseños guardados y el `<h1>`/`<h2>`
que el correo necesita).

### ADR-S38 — Auditoría de dependencias de producción en cero, con excepciones explícitas (v0.1.274)

**Contexto.** Los releases de dependencias (v0.1.113, v0.1.202, v0.1.244)
cerraban avisos de a tandas, pero no había regla para el caso en que un aviso
NO tiene versión arreglada, ni para las herramientas de compilación que se
colaban en el árbol de producción (`tailwindcss-animate` estaba en
`dependencies` del front y arrastraba a Tailwind y sus dependencias).

**Decisión.** (a) `pnpm audit --prod` tiene que salir en 0 en cada release de
dependencias. (b) Lo que sólo corre al compilar o testear va en
`devDependencies` (los plugins de Tailwind, de PostCSS o de vite incluidos):
así el árbol de producción es lo que de verdad llega al servidor o al bundle.
(c) Un aviso sin versión arreglada se acepta SÓLO si se verificó en el código
que no es explotable en nuestro uso, y se declara por id en
`pnpm.auditConfig.ignoreGhsas` del `package.json` raíz — nunca ignorando
paquetes enteros ni severidades, así cualquier aviso NUEVO del mismo paquete
vuelve a saltar. Cada excepción se anota en `CONTINUIDAD.md` con el motivo y
la condición para sacarla. Primera excepción: `GHSA-hp3w-g68c-fv3c`
(`sprintf-js`, vía mssql→tedious): el DoS necesita controlar el string de
formato y tedious sólo lo llama con formatos literales.

**Alternativas descartadas.** Reemplazar `sprintf-js` por un shim propio con
un override de pnpm (habría que reimplementar los especificadores de formato
que usa tedious en sus mensajes y volcados de paquetes, para un riesgo que no
existe en nuestro uso); bajar a una versión de tedious sin `sprintf-js` (no
hay: todas lo usan).

### ADR-S39 — Formularios públicos que crean registros (v0.1.275)

**Contexto.** El pedido más común de quien arma una base de datos de clientes,
solicitudes o inscripciones es "que la gente lo llene sola". Hasta acá había
dos caminos y ninguno servía a una persona normal: el webhook entrante
(v0.1.110, exige otro sistema que lo llame) o la lista pública (ADR-S14, sólo
lectura). Airtable, ClickUp, Notion y SmartSuite tienen formularios nativos.

**Decisión.**
1. **Un formulario es de UNA lista** (tabla `forms`, RLS) y guarda un modelo
   propio validado con Zod (`formConfigSchema` en shared): ítems ordenados
   (pregunta = campo de la lista por id, título de sección, texto) con
   etiqueta/ayuda/obligatorio/oculto/forma de mostrar y una **condición** de
   visibilidad sobre una pregunta ANTERIOR; más los ajustes (títulos, botón,
   gracias o redirección https, cierre por fecha o cupo, color, logo, prefill,
   dominios para insertar). Las preguntas apuntan a campos por ID, nunca por
   slug (regla de oro nº 1). Se preguntan los tipos que una persona de afuera
   puede contestar; personas del equipo, relaciones y calculados no.
2. **La página pública la sirve el API** (`/api/v1/public/f/:token`), no el
   SPA: el proxy fija `frame-ancestors 'self'` para la app y una
   actualización no puede cambiarlo, y un formulario se inserta en sitios
   ajenos. La página trae su propia CSP (script con nonce, `connect-src
   'self'`, `frame-ancestors` desde los dominios permitidos o `*`) y arma el
   DOM sólo con `textContent`/`createElement`. El **token** es la credencial
   (como las listas públicas): desconocido, despublicado o de una empresa
   archivada → el mismo 404 opaco; regenerarlo invalida el anterior.
3. **El servidor no le cree al navegador**: `collect()` toma SÓLO los valores
   de preguntas del formulario que deben verse según las condiciones (o las
   ocultas con prefill), revalida obligatorios y cada valor con
   `validateFieldValue`, y crea el registro con `RecordsService.create` (actor
   de sistema, mismas reglas, límite del plan, actividad, realtime). Errores
   por pregunta (400 `form_invalid`).
4. **Anti-abuso sin captchas de terceros**: campo trampa (se "acepta" en
   silencio y no se guarda nada), sello firmado con HMAC que exige ≥2,5 s
   entre cargar y enviar (y <24 h), límites en Redis por IP y por
   formulario, y archivos subidos atados al formulario con un token firmado
   de 6 h; los que nadie envió se borran solos.
5. **Cerrado** cuando la empresa está en solo-lectura (ADR-S09), pasó la
   fecha de cierre o se llenó el cupo: la página lo dice y el envío rebota.
   Las listas que llena una tienda (ADR-S24) no admiten formularios.
6. **Constructor WYSIWYG**: la vista previa ES la página pública
   (`/public/f/preview`), alimentada por `postMessage` con la misma función
   compartida (`buildPublicFormItems`) que usa el servidor — lo que se diseña
   es lo que se publica.
7. **Automatizaciones**: disparador `form_submitted` (opcionalmente un
   formulario puntual) con `{{formulario.nombre}}`. El asistente/MCP ve los
   formularios en `get_list_schema` y puede usar el disparador.
8. Los formularios viajan en la migración de empresa (con dirección NUEVA,
   avisado) y se borran con ella.

**Consecuencias.** Un formulario tapa casi todos los "que se inscriban solos"
sin integraciones. Queda fuera: varias páginas/pasos, lógica que salta
secciones, pagos dentro del formulario y editar una respuesta enviada.

### ADR-S40 — «Mi trabajo» + bandeja de avisos (v0.1.276)

**Contexto.** Una persona del equipo no tenía dónde ver lo SUYO: lo asignado
estaba repartido en N listas y la campana sólo mostraba menciones, con el
"leído" guardado en el navegador (un dispositivo no sabía del otro). Es lo
que tienen como base ClickUp («Mi trabajo» + Inbox), Monday y Airtable
(notificaciones + "My tasks").

**Decisión.**
1. **Aviso = fila por destinatario** (`notifications`, RLS): tipo
   (mención/asignación/comentario/cambio/recordatorio), registro, quién, una
   frase ya armada (si después se renombra el registro, el aviso sigue
   contando lo que pasó) y `read_at` en el servidor.
2. **Lo genera el servidor escuchando**, sin acoplar módulos: comentarios y
   menciones de la descripción por `NotifyHub`, cambios de campos por el
   `RecordChangeHub` existente (ahora con `actorId`). Cada destinatario pasa
   por el ACL del registro (nadie se entera de lo que no puede ver), nunca se
   avisa a alguien de lo que hizo él mismo, y el rol `client` no recibe nada.
   Las menciones de la descripción avisan sólo las NUEVAS (el autoguardado
   reescribe las menciones a cada rato). Los «cambió» sin leer del mismo
   registro se juntan durante 30 min (una sesión de edición = un aviso).
3. **Seguir** (`record_follows`, RLS): se sigue solo lo que se crea, se
   comenta o se tiene asignado; además a mano. «Asignado» = un campo Persona
   que pasa a valer esa persona.
4. **Recordatorios personales** (`reminders`, RLS) de un registro o sueltos,
   en la hora de la persona; un scheduler de BullMQ por minuto los dispara con
   `UPDATE … RETURNING` sobre filas sin disparar (una sola vez aunque haya
   varios nodos).
5. **Correo**: por persona y empresa (`memberships.settings.notifications`)
   se elige qué tipo llega también por correo (menciones, asignaciones y
   recordatorios encendidos por defecto) con tope de 10 por hora; y un
   **resumen diario** opcional (apagado por defecto, para no sorprender a
   nadie ni gastar la cuota de correo de la empresa) a la hora y días elegidos
   en la zona de la empresa (ADR-S33), sólo si hay algo que contar. Usa el
   transporte de la empresa (SMTP o cuenta propia, ADR-S29) y su cuota.
6. **«Mi trabajo»** (`GET /me/work`, un request): lo asignado en todas las
   listas con un campo Persona —leído con `RecordsService.list` y el ACL de
   cada lista—, sin lo que está en un estado "terminado" (se deduce por la
   etiqueta de la opción), agrupado por vencimiento (el campo de fecha que lo
   dice en el nombre, o el primero); sus recordatorios y lo que sigue.
7. **Realtime por persona**: sala `user:{tenant}:{user}` y tema
   `notifications`; la campana se refresca al instante.

**Consecuencias.** La campana deja de ser sólo menciones y pasa a ser la
bandeja. Quedan fuera: avisos push del navegador/celular, «posponer» un aviso
y reglas de aviso por lista.

### ADR-S41 — Campos con IA (v0.1.277)

**Contexto.** Tercera idea elegida por el usuario: que la IA trabaje DENTRO
de los registros, no sólo en el chat del asistente — resumir una nota larga,
clasificar un ticket, sacar el NIT de una factura en PDF, traducir. Es el
"AI field" de Airtable/ClickUp/Notion.

**Decisión.**
1. **Un tipo de campo más, `ai`**, que vive en `records.data` como texto (se
   filtra, ordena, busca y exporta como cualquier texto) pero que **nadie
   escribe a mano**: `isUserWritableType` lo deja afuera del import, la
   edición masiva, el portal, las automatizaciones y los formularios, y un
   PATCH que trae su valor lo ignora (un formulario que lo reenvía sin cambios
   no rompe el guardado).
2. **Config** (`aiFieldConfigSchema`): qué hace (`summarize`, `classify` con
   opciones, `extract` con qué dato, `translate` con idioma, `custom` con
   instrucciones), de qué campos lee (`inputs`, hasta 10, de la MISMA lista),
   largo, calidad y si se recalcula solo. `inputs` sigue la convención de
   nombres: plantillas y migración de empresa lo re-mapean solos.
3. **Se recalcula cuando cambian sus fuentes**: escucha el `RecordChangeHub`
   y encola un job de BullMQ con id por (registro, campo) y 4 s de espera — el
   autoguardado escribe varias veces y no se paga un pedido por tecla. El
   resultado se escribe por un camino que **no vuelve a emitir cambios**: un
   campo con IA nunca dispara otro en cadena.
4. **El pedido**: el contenido del registro va dentro de etiquetas y el
   sistema dice que son DATOS, no instrucciones; el modelo no tiene
   herramientas, así que un texto malicioso a lo sumo ensucia su propio campo.
   Al clasificar, la respuesta se valida contra las opciones (una que no está
   no se guarda). Los campos Archivo pasan PDF e imágenes tal cual (hasta 3, de
   5 MB). Sin nada que leer, el campo queda vacío sin gastar un pedido.
5. **Clave y cuota**: la misma de ADR-S21 — clave propia de la empresa o la
   compartida de la plataforma contra `max_ai_requests_month`. Calidad
   «rápida» (default) usa Haiku 4.5; «el del asistente», el modelo elegido por
   la empresa. «Completar los vacíos» / «Recalcular todos» encola hasta 500 y,
   con la clave compartida, no más de lo que queda de la cuota.
6. **Errores a la vista**: «Recalcular» en la ficha responde con el motivo
   (IA desactivada, cuota, clave rechazada, proveedor saturado); en segundo
   plano el último error queda por campo y se muestra en su configuración.

**Consecuencias.** La IA llena columnas sin integraciones ni automatizaciones.
Queda fuera: encadenar campos con IA, campos con IA que escriben números o
fechas tipados, y un historial de pedidos por registro.

---

**Versión del documento:** 1.76.0 (campos con IA — ADR-S41)
