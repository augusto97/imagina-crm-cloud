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
- Identidad: el token es de UNA persona en UN workspace, con el rol que ella
  tiene **en vivo** (sacarla del workspace o desactivar su cuenta mata el
  token al instante). Un token nunca amplía permisos.
- Alcance del token:
  - `read` — sólo herramientas de lectura (`list_lists`, `get_list_schema`,
    `query_records`, `aggregate_records`).
  - `full` — además las `propose_*` y `apply_proposal`.

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
  Se muestra una vez al crearlo.
- Tabla `personal_access_tokens` sin RLS a propósito (la búsqueda es por hash
  antes de conocer el tenant; mismo patrón que los webhooks entrantes). Todo
  lo que el token habilita corre dentro del scope del tenant resuelto.
- Vencimiento opcional (7/30/90/365 días o nunca) y revocación inmediata.
- Crear y revocar quedan en la bitácora del workspace (sin el secreto).
- Lo que devuelven las herramientas son **datos** del workspace (valores de
  registros recortados y marcados como tales), nunca instrucciones para el
  cliente.
- El rate limit por IP del API aplica también acá.

## Límites conocidos

- Sin estado: no hay `GET` (stream de notificaciones del servidor) ni
  sesiones MCP. Cada `POST` es independiente.
- Las propuestas viven en Redis 2 horas; después hay que volver a proponer.
- El MCP no consume la cuota IA del plan: el modelo lo aporta el cliente
  (Claude/Cursor); la app sólo ejecuta herramientas.
