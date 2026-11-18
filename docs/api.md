# API pública (REST)

> v0.1.441 (G1, addendum de ADR-S21). Cómo conecta otro programa —n8n,
> Make, Zapier, un script, un ERP— con las listas y los registros de una
> empresa, qué puede hacer y qué NO.

## Qué es

La misma API que usa la app, abierta a un **token de la API**. No hay una API
paralela: las rutas, la validación (schemas de `packages/shared`), el ACL por
lista, la actividad y las automatizaciones son los de siempre. El token sólo
abre una **lista blanca de rutas** (`API_TOKEN_ROUTES` en
`apps/api/src/auth/api-token.ts`).

- Dirección: `https://<tu-dominio>/api/v1`.
- Documento: `GET /api/v1/openapi.json` (OpenAPI 3.1, público, sin datos).
  Se arma de los schemas de `packages/shared` y un test exige que cubra
  exactamente las rutas de la lista blanca.
- Auth: `Authorization: Bearer ib_pat_…` — un token creado en **Ajustes →
  API** (`use = 'api'`). Los tokens de **Seguridad → Conexión MCP**
  (`use = 'mcp'`) no sirven para la API ni al revés.
- Empresa: la fija el token. `X-Tenant-Id` es opcional y, si viene (id o
  slug), tiene que ser la del token (403 `api_token_tenant_mismatch`).

## Quién puede crear un token

- Capacidad **`use_api`**: la tienen los administradores; un rol propio
  puede sumarla (Ajustes → Roles). El rol `client` (portal) y los invitados
  nunca.
- El plan tiene que incluir el módulo **`api`** (el mismo del MCP). Sin él
  los tokens se conservan pero no resuelven.
- El token actúa como la persona: su rol, su rol propio, sus equipos, el ACL
  de cada lista y los campos ocultos, **leídos en vivo** en cada pedido.
  Sacarla de la empresa, desactivar su cuenta o quitarle `use_api` apaga el
  token al instante. Lo que crea o cambia queda en la actividad a su nombre y
  dispara las automatizaciones.

## Alcances

| Alcance | Métodos |
|---|---|
| `read` («Sólo leer») | `GET`, `HEAD` |
| `full` («Leer y escribir») | además `POST`, `PATCH`, `DELETE` de la lista blanca |

Una ruta fuera de la lista blanca, o un método que el alcance no permite,
responde **403** (`api_route_not_allowed` / `api_read_only`) antes de llegar
al controller.

## Rutas

| Ruta | Métodos |
|---|---|
| `/whoami` | GET — la persona, la empresa, el rol y el token |
| `/lists` | GET, POST |
| `/lists/{list}` | GET, PATCH |
| `/list-groups` | GET |
| `/lists/{list}/fields` | GET, POST |
| `/lists/{list}/fields/{field}` | GET, PATCH |
| `/lists/{list}/fields/{field}/options` | POST |
| `/lists/{list}/fields/{field}/values` | GET |
| `/lists/{list}/views`, `/lists/{list}/views/{id}` | GET |
| `/lists/{list}/records` | GET, POST |
| `/lists/{list}/records/batch` | POST (alta en lote), PATCH (cambios en lote) |
| `/lists/{list}/records/batch-delete` | POST |
| `/lists/{list}/records/{id}` | GET, PATCH, DELETE |
| `/lists/{list}/records/{id}/description` | GET, PATCH |
| `/lists/{list}/records/{recordId}/comments` | GET, POST |
| `/lists/{list}/records/{recordId}/comments/{id}` | PATCH, DELETE |
| `/search` | GET |
| `/files` | GET (`?ids=`), POST (multipart, campo `file`) |
| `/files/{id}/download` | GET |
| `/me/users-search`, `/me/users`, `/me/users/{id}` | GET |
| `/teams`, `/teams/{id}` | GET |

`{list}` acepta el id o el slug. Lo que **no** está: borrar listas o campos,
miembros, ajustes de la empresa, automatizaciones, formularios, cobros,
plataforma. Borrar un registro lo manda a la papelera (ADR-S52).

## Valores de los registros

Van en `data` con la clave `f{id del campo}`:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"data":{"f12":"Ana Gómez","f13":"ana@ejemplo.com"}}' \
  https://<tu-dominio>/api/v1/lists/clientes/records
```

Los ids salen de `GET /lists/{list}/fields`. La clave no cambia al renombrar
un campo (regla de oro nº 1). `PATCH` cambia sólo lo que se manda. Una
selección va con el **valor** de la opción (no la etiqueta), una persona con
su id, un archivo con la lista de ids que devuelve `POST /files`.

El listado (`GET /lists/{list}/records`) pagina por cursor (`limit` hasta
200, `cursor`) o por página (`page`, `with_total`), y acepta `search`,
`sort`, `sort_dir`, `filter_tree` (JSON), `parent`, `include_subtasks`, `ids`
y `related_to`; todo está en el documento OpenAPI.

## Límites

- **300 pedidos por minuto por token** y **1.200 por empresa** (Redis,
  `apibud:t:` / `apibud:w:`). Cada respuesta trae `X-RateLimit-Limit`,
  `X-RateLimit-Remaining` y `X-RateLimit-Reset`; al pasarse, **429**
  (`api_rate_limited`) con `Retry-After`. Si Redis no responde, no se frena.
- El límite general por IP del servidor sigue corriendo antes.
- CSRF: los pedidos sin `Origin` ni `Sec-Fetch-Site` (programas) pasan; un
  navegador de otro sitio sigue rechazado.

## Errores

`{ "code": "…", "message": "…", "data": { "status": N } }`. Los más comunes:
`api_token_invalid` (401: vencido, revocado, de otro uso o de una empresa sin
el módulo), `api_route_not_allowed` / `api_read_only` (403),
`api_token_tenant_mismatch` (403), `api_rate_limited` (429), y los de
validación de siempre (400 con el detalle por campo).

## n8n

Nodo **HTTP Request** → Authentication **Generic Credential Type** → **Header
Auth** (`Authorization` = `Bearer <token>`). El documento OpenAPI también se
importa en Postman, Insomnia o un generador de clientes.

## Pendiente

- v0.1.442: webhooks de eventos (registro creado/cambiado/borrado, formulario
  enviado, pago recibido) firmados y con reintentos.
- v0.1.443: la app de n8n (disparadores y acciones).
