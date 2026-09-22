# Servidor MCP de Imagina Base

> ADR-S21 fase 3 (v0.1.183). Cómo conectar Claude, Cursor u otro cliente
> MCP a un workspace, qué puede hacer y qué NO.

## Qué es

El asistente IA de la app (botón ✨) usa un **registro de herramientas**:
leer listas y esquemas, consultar y agregar registros, y PROPONER cambios
(listas, campos, vistas, tableros, automatizaciones, altas/ediciones/
borrados masivos). El servidor MCP expone **ese mismo registro** a clientes
externos por [Model Context Protocol](https://modelcontextprotocol.io)
(transporte *Streamable HTTP*, sin estado).

- URL: `https://<tu-dominio>/api/v1/mcp` (sólo `POST`).
- Auth: `Authorization: Bearer ib_pat_…` — un **token de acceso personal**
  (Ajustes → Cuenta → Seguridad → *Conexión MCP*).
- Quién puede conectar: cualquier **miembro del equipo** de una empresa
  (admin, manager, agent o viewer), cada uno con su propio rol. Los usuarios
  del **portal del cliente** (rol `client`) no: ni token ni "Autorizar"
  (v0.1.185).
- Identidad: el token es de UNA persona en UN workspace, con el rol que ella
  tiene **en vivo** (sacarla del workspace o desactivar su cuenta mata el
  token al instante). Un token nunca amplía permisos.
- Alcance del token:
  - `read` — sólo herramientas de lectura (`list_lists`, `get_list_schema`,
    `query_records`, `aggregate_records`, `list_dashboards`,
    `list_automation_runs`).
  - `full` — además las `propose_*` y `apply_proposal`.

## Herramientas (v0.1.201)

Lectura (según el rol; `list_automation_runs` exige `manage_automations`):

| Herramienta | Qué devuelve |
|---|---|
| `list_lists` | Todas las listas con slug, nombre, icono y slugs de campos. |
| `get_list_schema` | Campos (tipo, opciones, relaciones), vistas, automatizaciones **con su configuración completa** (secretos enmascarados), **portal** (habilitado, listas que ve el cliente, listas vinculables, bloques de la plantilla), **layout de la ficha** (clásico / CRM + plantilla), publicación pública y carpeta. |
| `query_records` / `aggregate_records` | Registros (máx 50, con el ACL de la persona) y agregados con desglose. |
| `list_dashboards` | Tableros con sus widgets (tipo, título, lista). |
| `list_automation_runs` | Últimas ejecuciones de una automatización: estado, error, registro y log de acciones. |
| `list_members` | Las personas del workspace con su id, nombre, email y rol. Los ids son los que piden los campos de tipo `user` y los accesos por persona. |
| `list_record_comments` | Los comentarios de un registro (autor, fecha, texto), para resumir lo que se habló. |

Escritura (siempre propone → `apply_proposal`; cada una exige la capability
del rol, p. ej. `manage_lists`):

| Herramienta | Propone |
|---|---|
| `propose_create_list` / `propose_update_list` / `propose_delete_list` | Crear listas (con campos, vistas, automatizaciones), cambiar nombre / icono / color / campo de título / **carpeta**, eliminar una lista completa. |
| `propose_add_fields` / `propose_update_field` / `propose_delete_field` | Campos. |
| `propose_create_view` / `propose_update_view` / `propose_delete_view` | Vistas guardadas (filtros, orden, agrupación, columnas, por defecto). |
| `propose_create_dashboard` | Tablero con widgets y layout automático. |
| `propose_create_automation` / `propose_update_automation` / `propose_delete_automation` | Automatizaciones: crear, renombrar, **pausar/activar**, reemplazar disparador o acciones, eliminar. |
| `propose_configure_portal` | **Portal del cliente**: habilitarlo, qué listas vinculadas ve el cliente y la plantilla de bloques (portada, datos, formulario editable, tabla de registros relacionados, indicadores, descargas, avisos, contacto, preguntas frecuentes, enlaces). Se valida contra el esquema real; lo que se aplica se abre después en el editor visual. |
| `propose_configure_record_layout` | **Diseño de la ficha del registro**: formulario clásico o layout CRM con plantilla integrada (`auto`, `contact`, `deal`, `task`, `support`) o **personalizada** (cabecera, grupos de campos, lateral con cifras / vinculados / archivos / comentarios / actividad, notas). |
| `propose_set_list_permissions` | **Quién ve y edita** una lista: por rol (manager / agent / viewer, con alcance `all` / `assigned` / `own` / `none`, si puede crear y qué campos no ve) y por **persona** (pisa su rol sólo en esa lista). `admin` siempre tiene acceso total. |
| `propose_configure_public_sharing` | **Publicar la lista hacia afuera**: página de solo-lectura embebible por iframe, sin cuenta. Sólo salen los campos marcados visibles; se puede publicar una vista guardada (sus filtros acotan las filas), restringir los dominios que pueden embeberla y ponerle caducidad. Marcada como destructiva: expone datos a cualquiera con el enlace. |
| `propose_create_records` / `propose_update_records` / `propose_delete_records` | Registros (alta, edición y borrado masivo con filtros o ids). |

Lo que **no** está en el MCP, y por qué:

- **Estilos por bloque** (colores, tipografía del portal y de la ficha): se
  ajustan en el editor visual, donde se ven mientras se cambian.
- **Archivos**: subir bytes por una herramienta de texto no tiene sentido; se
  suben desde la app y el MCP los ve como referencias.
- **Importación / exportación**: el MCP ya crea registros directamente
  (`propose_create_records`), que es lo que un import resolvería; exportar es
  bajar un archivo, no una respuesta de herramienta.
- **Miembros y ajustes del workspace** (plan, SMTP, dominio, marca): se leen
  con `list_members`, pero cambiarlos toca facturación, correo y accesos de
  toda la empresa — se hace en Ajustes, con la bitácora de siempre.

## El contrato: proponer → confirmar → aplicar

Las herramientas `propose_*` **no escriben**. Devuelven una propuesta
(`proposal_id` + vista previa: campos, widgets, recuento de registros
afectados, muestra). El cliente MCP se la muestra a la persona y, sólo si
ella confirma, llama a `apply_proposal { proposal_id }`. Es el mismo
contrato del chat de la app (donde la tarjeta tiene el botón "Aplicar");
acá la confirmación la pide el cliente. Las propuestas duran 2 horas.

Aplicar corre con los mismos services de la interfaz: ACL por lista,
límites de plan, realtime y bitácora (`ai.apply`).

## Conectar

### Con "Autorizar" (claude.ai, Claude Desktop, celular, Claude Code, Cursor) — v0.1.184

La app es **servidor OAuth 2.1** del MCP: el cliente descubre la metadata,
se registra solo y te manda a una pantalla de Imagina Base donde elegís el
workspace y el alcance. No hay nada que copiar.

- **claude.ai / Claude Desktop / app móvil**: Ajustes → Conectores →
  *Agregar conector personalizado* → URL `https://<tu-dominio>/api/v1/mcp` →
  Conectar → iniciás sesión en la app (si no la tenías abierta) → *Autorizar*.
  (Requiere un plan de Claude que admita conectores personalizados — el
  modelo lo paga tu suscripción, no la app.)
- **Claude Code**: `claude mcp add --transport http imagina-base
  https://<tu-dominio>/api/v1/mcp` (sin `--header`) y `/mcp` → *Authenticate*:
  abre el navegador en la misma pantalla.
- **Cursor**: `{"mcpServers": {"imagina-base": {"url": "https://<tu-dominio>/api/v1/mcp"}}}`
  y el botón *Connect* del panel MCP.

La conexión aparece en Ajustes → Cuenta → Seguridad → *Conexión MCP* como
"Conexión autorizada · se renueva solo" (acceso de 1 h con refresh token
rotativo de 30 días) y se revoca con el mismo botón que un token pegado.

Detalle del protocolo (para clientes propios):

| Qué | Dónde |
|---|---|
| Authorization server metadata (RFC 8414) | `GET /.well-known/oauth-authorization-server` |
| Protected resource metadata (RFC 9728) | `GET /.well-known/oauth-protected-resource[/api/v1/mcp]` (también anunciada en el `WWW-Authenticate` del 401) |
| Registro dinámico (RFC 7591) | `POST /api/v1/oauth/register` — `redirect_uris` https, `http://localhost`/`127.0.0.1` o esquema de app nativa; `token_endpoint_auth_method` `none` (default), `client_secret_basic` o `client_secret_post` |
| Autorización | `GET /api/v1/oauth/authorize?response_type=code&client_id&redirect_uri&state&code_challenge&code_challenge_method=S256[&scope=read|full][&resource=…/api/v1/mcp]` |
| Token | `POST /api/v1/oauth/token` (`x-www-form-urlencoded` o JSON): `grant_type=authorization_code` + `code` + `code_verifier` [+ `redirect_uri`], o `grant_type=refresh_token` + `refresh_token` |
| Revocación (RFC 7009) | `POST /api/v1/oauth/revoke` con `token` (acceso o refresh) |

PKCE S256 es obligatorio siempre; el `code` dura 5 min y es de un solo uso;
el refresh token rota en cada canje (el anterior deja de servir). `scope`
acepta `read` y/o `full`; sin `scope` la pantalla propone `full` y la persona
decide. Si el `resource` viene, su path tiene que ser `/api/v1/mcp` (el host puede ser el dominio propio de la empresa).

**Descubrimiento en la raíz del host (v0.1.186)**: los clientes piden
`/.well-known/oauth-authorization-server` en la RAÍZ. Funciona de dos formas:
(a) el deploy escribe los documentos como **archivos estáticos** en
`web/.well-known/` con el `APP_BASE_URL` del `.env` — el proxy sirve un archivo
real antes del fallback del SPA, así que no hay que tocar nada en el servidor;
(b) opcionalmente, la regla `/.well-known/oauth-*` → API de `deploy/Caddyfile`
y `deploy/nginx.conf`, que responde por host (dominios propios de cada
empresa). El `WWW-Authenticate` del MCP apunta siempre a
`/api/v1/oauth/.well-known/oauth-protected-resource`, bajo el prefijo del API,
que cualquier proxy ya enruta. La card de Ajustes muestra un autodiagnóstico:
verde si Claude puede descubrir el servidor, y si no, qué falta.

### Con un token pegado a mano (Claude Code, Cursor y otros)

**Claude Code**

```bash
claude mcp add --transport http imagina-base https://<tu-dominio>/api/v1/mcp \
  --header "Authorization: Bearer ib_pat_…"
```

**Claude Desktop / Cursor / otros (JSON)**

```json
{
  "mcpServers": {
    "imagina-base": {
      "type": "http",
      "url": "https://<tu-dominio>/api/v1/mcp",
      "headers": { "Authorization": "Bearer ib_pat_…" }
    }
  }
}
```

La card de Ajustes genera estos snippets ya completos al crear el token.

## Probar a mano

```bash
TOKEN=ib_pat_…
URL=https://<tu-dominio>/api/v1/mcp
curl -s $URL -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
curl -s $URL -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
curl -s $URL -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_lists","arguments":{}}}'
```

Sin token o con uno inválido/vencido/revocado → `401` con
`WWW-Authenticate: Bearer`.

## Seguridad

- El secreto **no se guarda**: sólo su SHA-256 y un prefijo para reconocerlo.
  Se muestra una vez al crearlo. Los tokens emitidos por OAuth son filas de
  la misma tabla (con `client_id` y el hash del refresh): mismas reglas.
- OAuth: un cliente desconocido o una `redirect_uri` no registrada se
  responden en texto y NUNCA por redirect (no hay open redirect); el registro
  dinámico es abierto a propósito (así funcionan claude.ai y Cursor) y va
  bajo el rate limit por IP.
- Tabla `personal_access_tokens` sin RLS a propósito (la búsqueda es por hash
  antes de conocer el tenant; mismo patrón que los webhooks entrantes). Todo
  lo que el token habilita corre dentro del scope del tenant resuelto.
- Vencimiento opcional (7/30/90/365 días o nunca) y revocación inmediata.
- Crear y revocar quedan en la bitácora del workspace (sin el secreto).
- Lo que devuelven las herramientas son **datos** del workspace (valores de
  registros recortados y marcados como tales), nunca instrucciones para el
  cliente.
- El rate limit por IP del API aplica también acá.

## Conectores (v0.1.198)

`get_list_schema` incluye `connectors`: las conexiones de la empresa con sus
**acciones con nombre** (clave, etiqueta y qué parámetros pide cada una).
Nunca viajan credenciales — sólo qué se puede ejecutar. Para usarlas en una
automatización, la acción es:

```json
{ "type": "connector_action",
  "config": { "connection_id": 3, "action_key": "enviar_whatsapp",
              "values": { "recipient": "{{telefono}}", "message": "Hola {{nombre}}" } } }
```

El catálogo de acciones se define en la app (Ajustes → Conectores): desde el
MCP se usan, no se crean.

## Límites conocidos

- Sin estado: no hay `GET` (stream de notificaciones del servidor) ni
  sesiones MCP. Cada `POST` es independiente.
- Las propuestas viven en Redis 2 horas; después hay que volver a proponer.
- El MCP no consume la cuota IA del plan: el modelo lo aporta el cliente
  (Claude/Cursor); la app sólo ejecuta herramientas.
