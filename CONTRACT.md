# CONTRACT — Especificación funcional heredada del plugin

> Este documento captura el **comportamiento exacto** del backend del plugin
> que **Imagina Base** (la app) debe replicar (adaptado a Postgres/JSONB donde
> aplique). Es la capa que ni STANDALONE.md (arquitectura) ni el frontend
> forkeado (consumidor del API) cubren por sí solos.
>
> **Fuente de máxima fidelidad**: el repo nuevo incluye
> `reference/plugin-backend/` (el `src/` PHP del plugin, solo lectura).
> Ante cualquier duda de comportamiento no cubierta acá, LEER ese código
> antes de re-inventar. El frontend en `apps/web/` también codifica el
> contrato desde el lado consumidor (`app/types/*.ts`, `app/hooks/*.ts`,
> `app/lib/schemas.ts`).

---

## 1. Superficie REST (namespace del plugin: `imagina-crm/v1`)

Controllers existentes en el plugin (cada uno → módulo NestJS equivalente):

| Controller | Recursos |
|---|---|
| Lists | CRUD listas, resolución id-o-slug, settings (record_layout, portal_template, crm_template_custom) |
| Fields | CRUD campos por lista, reorder, is_indexed toggle |
| Records | CRUD + bulk + grouped-bundle (batch de vista agrupada) |
| Views | Saved views CRUD (type: table/kanban/calendar/cards) |
| SavedFilters | Sets de filtros nombrados por lista |
| Aggregates | Agregaciones de footer por columna |
| Comments | Comentarios por record, threading, metadata (kind: note/call/email/meeting + extras) |
| Activity | Log de actividad por record/lista con diffs |
| Automations | CRUD + runs con logs |
| Dashboards | CRUD + widget data evaluator |
| Recurrences | Reglas de recurrencia sobre campos date/datetime + batch endpoint |
| Slugs | check (unicidad/formato) + history |
| Import/Export | CSV import con mapeo; export async via cola |
| Portal | /portal/me (boot del portal cliente), magic links |
| Permissions | Matriz por lista |
| System | field-types, me |

Reglas transversales:
- URLs aceptan **id numérico o slug** para listas y campos; slugs viejos se
  resuelven vía `slug_history` (header `X-Imagina-CRM-Slug-Renamed`).
- Errores: `{ code, message, data: { status, errors? } }` — `errors` es mapa
  `campo → mensaje` para validación.
- Respuestas de listado: `{ data: [...], meta: { total, page, per_page } }`
  (en la app: `meta.next_cursor` reemplaza a page).

## 2. Slugs (reglas exactas)

- Formato: `^[a-z][a-z0-9_]{0,62}$` (snake_case, arranca con letra).
- Unicidad: lista → global por tenant; campo → dentro de su lista.
- **Reservados de lista**: `lists, fields, views, records, comments,
  activity, relations, automations, settings, me, admin, system, api, auth,
  licensing, slug-history, slug_history, field-types, field_types, import,
  export, webhook, webhooks`.
- **Reservados de campo**: `id, created_at, updated_at, deleted_at,
  created_by` + palabras reservadas SQL (lista completa en
  `reference/plugin-backend/Lists/SlugManager.php::MYSQL_RESERVED` — adaptar
  a reservadas de Postgres).
- Todo rename inserta en `slug_history`; los redirects consultan ahí. Si un
  slug viejo fue reutilizado → 409 Conflict.
- Generación automática: slugify del label, colisión → sufijo `_2`, `_3`…

## 3. Tipos de campo (16 en el plugin actual)

`text, long_text, number, currency, select, multi_select, date, datetime,
checkbox, url, email, user, relation, file, computed` (+ `AbstractFieldType`
como contrato). Cada tipo define: validación, serialización, config schema
(ej. `options[{value,label,color}]` en select, `max_length` en text,
`precision` en number, moneda en config de currency — nunca por fila).

- Colores de opciones: presets nombrados (`gray, rose, red, orange, amber,
  yellow, lime, green, emerald, teal, cyan, sky, blue, indigo, violet,
  fuchsia, pink, slate`) o hex custom. **El color de la opción es la fuente
  de verdad visual en TODA la app** (chips, kanban, charts).
- `relation`: sin valor propio — vive en la tabla `relations`
  (field_id, source_record_id, target_record_id).
- `computed`: solo lectura, se evalúa server-side.
- `user`: referencia a usuario del sistema.
- Fechas SIEMPRE UTC en storage; el cliente formatea.

## 4. Filtros (QueryBuilder)

Operadores escalares: `eq, neq, gt, gte, lt, lte, contains, not_contains,
starts_with, ends_with, in, nin, is_null, is_not_null, between_relative`.

- `between_relative`: solo date/datetime; el valor es el slug de un preset
  (`today, yesterday, this_week, last_week, this_month, last_month,
  last_7_days, last_30_days, this_year…` — lista completa en
  `apps/web/app/admin/records/dateRangePresets.ts`) y se resuelve contra
  `now()` EN CADA QUERY (nunca se persiste como fecha fija).
- **Filter tree** (forma canónica): grupos AND/OR anidados de
  `{type:'condition', field_id, op, value}` / `{type:'group', logic,
  children}`. Máx 5 niveles. Coexiste con forma legacy plana
  `{field_<id>: {op: value}}` — la app nueva puede soportar SOLO el tree.
- Tipos no filtrables por columna: `relation`. Búsqueda de texto libre sobre:
  `text, long_text, email, url`.
- Multi_select: `eq/contains/neq` operan sobre pertenencia al array JSON.
- Whitelist SIEMPRE: slug → field de la lista → expresión tipada. Valor
  jamás interpolado.

## 5. Agregaciones (footer + widgets)

`count, count_unique, count_empty, sum, avg, min, max, count_true,
count_false`. Restricciones por tipo: sum/avg solo number/currency;
count_true/false solo checkbox; min/max también date/datetime (devuelven
string ISO — los charts deben tolerar valor string).

## 6. Roles y capabilities

Roles: `crm_admin, crm_manager, crm_agent, crm_viewer, crm_client`.

Capabilities (prefijo del plugin `imcrm_` — en la app renombrar sin prefijo):
`access_admin; manage_lists; manage_fields; manage_views;
manage_automations; manage_dashboards; view_records; view_own_records;
create_records; edit_records; edit_own_records; delete_records;
delete_own_records; import_records; export_records; bulk_actions;
access_portal`.

- Las variantes `*_own_*` limitan al `created_by` (o al record vinculado, en
  clients). La matriz rol→caps exacta: `reference/plugin-backend/` (Fase 7).
- El backend SIEMPRE valida; el frontend solo oculta botones (`useCan`).

## 7. Saved views

`type: table | kanban | calendar | cards`. Config por tipo (todo por
field_id, jamás slug):
- table: `visible_field_ids, column_order, column_sizing, sort, filters/
  filter_tree, group_by_field_id, collapsed_groups, footer_aggregates`
- kanban: `group_by_field_id` (select), `kanban_title_field_id`,
  `kanban_meta_field_ids`
- calendar: `date_field_id`
- cards: `card_field_ids, card_cover_field_id, card_size
  (compact|comfortable|spacious)`
- `is_default` por lista: al abrir la lista se aplica ANTES del primer fetch
  de records (lección HANDOFF §2.2).

## 8. Automatizaciones

- Triggers: `record_created, record_updated, field_changed (con field_id +
  old/new opcionales), due_date_reached (field_id + offset), scheduled
  (cron-like)`.
- Actions: `send_email (template + merge tags {{field_slug}}), call_webhook
  (URL + firma HMAC + retries), update_field, create_record`.
- Cada ejecución → `automation_runs` con status/logs/duración. Retries con
  backoff. Condiciones opcionales (mismo filter tree) antes de ejecutar.

## 9. Portal del cliente

- Usuario rol client vinculado a UN record (el "cliente").
- Boot: `GET /portal/me` → record + fields meta + template de bloques.
- Template de bloques (JSON en list.settings): tipos `static_text,
  client_data, related_records_table, editable_form, external_link,
  kpi_widget, activity_timeline, download_files, comments_thread, heading,
  hero, stats_grid, quick_actions, notice, divider, faq, contact_card,
  nested_section` — el editor y renderer YA están en el frontend forkeado.
- Magic links: token firmado de un solo uso → sesión del client. Envío por
  email desde la ficha del record.
- `editable_form` del portal: el client solo puede escribir los campos
  explícitamente permitidos en el config del bloque.

## 10. Dashboards

- Widgets: `kpi, stat_delta, chart_bar, chart_pie, chart_line, chart_area,
  table, funnel`. Config: métrica (§5) + `metric_field_id` +
  `group_by_field_id`/`date_field_id` + `time_bucket
  (day|week|month|quarter|year)` + `period {field_id, preset}` + filter_tree
  + toggles de presentación.
- `funnel` = mismos datos que chart_bar; el front ordena por el orden de las
  opciones del select.
- Layout: grid 12 cols, rowHeight 64, defaults por tipo (KPI 3×2, chart 4×4,
  line 6×4, table 6×5).
- Dashboards privados (user_id) o compartidos (null).

## 11. Import / Export

- Export: JSON completo (listas + fields + records + views) — **este es el
  formato de intercambio plugin↔app** (STANDALONE §16). También CSV por
  lista. Async via cola con notificación.
- Import: CSV con mapeo columna→campo + validación por tipo, y el JSON de
  intercambio.

## 12. Recurrencias

Campos date/datetime pueden tener regla de recurrencia (estilo ClickUp:
diaria/semanal/mensual/anual con intervalos). Al completarse/avanzar, la
fecha rota a la siguiente ocurrencia. Endpoint batch para hidratar N records
en una query (lección anti-N+1).

## 13. Qué NO portar del plugin

- LicenseManager / UpdaterClient (reemplazados por suscripción).
- Integración wp-admin, shortcodes, nonces, PublicAssets.
- El motor de búsqueda BM25 casero (reemplazado por FTS de Postgres).
- Action Scheduler (reemplazado por BullMQ).
- Los workarounds de WP-Cron.
