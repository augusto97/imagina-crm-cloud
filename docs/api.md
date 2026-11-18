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

**La app de n8n** (v0.1.443, `integrations/n8n/`): cada servidor reparte el
paquete `n8n-nodes-imagina-base` de su misma versión. En un n8n propio:

```bash
cd ~/.n8n/nodes            # con Docker, el volumen de /home/node/.n8n
npm install https://TU-APP/api/v1/public/n8n/n8n-nodes-imagina-base.tgz
# y reiniciar n8n
```

`GET /api/v1/public/n8n` dice la versión y si el servidor la trae
(`available`, `download_url`). Trae:

- **Credencial**: dirección de la app + token («Test» llama a `/whoami`).
- **Acciones**: registro (crear, leer, buscar, cambiar, borrar), comentario
  (agregar, listar) y lista (listar). Los campos salen de la lista elegida;
  las opciones se escriben por su etiqueta y los números como en cada país.
- **Disparador**: al activar el flujo registra un webhook con la dirección de
  n8n (`source: 'api'`) y lo borra al desactivarlo; comprueba la firma.

Sin poder instalar apps (n8n en la nube, mientras no esté verificada): nodo
**HTTP Request** → Authentication **Generic Credential Type** → **Header
Auth** (`Authorization` = `Bearer <token>`), y el nodo **Webhook** con un
webhook de la sección siguiente. El documento OpenAPI también se importa en
Postman, Insomnia o un generador de clientes.

## Webhooks de eventos (v0.1.442)

El camino inverso: en vez de preguntar cada rato «¿hay algo nuevo?», el otro
programa recibe un **POST** en el momento en que pasa algo. Se crean en
**Ajustes → API → Webhooks** o por la API (`/webhooks`, con un token `full`;
la suscripción queda marcada «Lo registró un programa»).

- **Eventos**: `record.created`, `record.updated` (trae `changes` con el valor
  de antes y el de ahora), `record.deleted` (va a la papelera),
  `form.submitted` y `payment.received`. Se filtra por listas o todas las que
  ve quien lo creó.
- **Actúa como quien lo creó**: sólo viaja lo que esa persona puede ver (ACL
  por lista, alcance del rol, campos ocultos fuera). Si deja la empresa, pierde
  `use_api` o su cuenta se desactiva, el webhook se pausa solo.
- **Cuerpo**: `id` (único por aviso, se repite en los reintentos), `event`,
  `created_at`, `tenant`, `list`, `record` (como la API), `values` por
  slug, `fields` (`f{id}` → id, slug, nombre y tipo), y `changes`, `form` o
  `payment` según el evento.
- **Cabeceras**: `X-Webhook-Id`, `X-Webhook-Event`, `X-Webhook-Attempt` y
  `X-Webhook-Signature: t=<segundos>,v1=<hex>`, donde `v1` es el
  HMAC-SHA256 del secreto sobre `<t>.<cuerpo crudo>`. Comprobar la firma
  con comparación de tiempo constante y rechazar un `t` de más de 5 minutos.
  El secreto (`whsec_…`) se ve una vez al crear o rotar.
- **Reintentos**: si no responde 2xx en 10 s (red, 408, 429 o 5xx), se
  reintenta a 1 min, 5 min, 30 min, 2 h, 6 h y 12 h; un 4xx no se repite.
  **410** pausa el webhook (así se desuscribe n8n o Zapier). 20 intentos
  fallidos seguidos lo pausan y abren un Problema. Cada entrega queda en el
  historial 30 días, con «Volver a enviar».
- **Tope**: 25 webhooks por empresa. Las direcciones son https públicas (sin
  usuario y contraseña en la dirección; nunca la red interna).
- Migrar una empresa no lleva sus webhooks (como los tokens: son credenciales
  de esta instalación).

## Pendiente

- Publicar el paquete en npm (falta el secreto `NPM_TOKEN`) y pedir la
  verificación de n8n para que aparezca en n8n en la nube.
- Make y Zapier (piden cuentas de desarrollador y pasan revisión).
