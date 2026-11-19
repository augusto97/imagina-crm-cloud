import {
    appendFieldOptionSchema,
    apiErrorSchema,
    batchCreateRecordsSchema,
    batchDeleteRecordsSchema,
    batchUpdateRecordsSchema,
    commentSchema,
    createWebhookSubscriptionSchema,
    createCommentSchema,
    createFieldSchema,
    createListSchema,
    createRecordSchema,
    fieldSchema,
    globalSearchHitSchema,
    listGroupSchema,
    listSchema,
    meUserSummarySchema,
    recordSchema,
    teamSchema,
    updateCommentSchema,
    updateFieldSchema,
    updateListSchema,
    updateRecordSchema,
    updateWebhookSubscriptionSchema,
    viewSchema,
    WEBHOOK_EVENTS,
} from '@imagina-base/shared';
import type { ZodType as ZodTypeAny } from 'zod';
import { zodToJson } from '../common/zod-json-schema';

/**
 * v0.1.441 (G1) — El documento OpenAPI 3.1 de la API pública: las MISMAS rutas
 * que deja usar un token (`API_TOKEN_ROUTES`; un test exige que coincidan) y
 * los MISMOS schemas Zod que validan los pedidos (regla de oro nº 2: un shape
 * no se escribe dos veces). Puro: lo arma el controlador con la dirección del
 * servidor y lo prueban los tests.
 */

type Json = Record<string, unknown>;

function schemaOf(schema: ZodTypeAny): Json {
    return zodToJson(schema, 'openapi-3.0');
}

const ref = (name: string): Json => ({ $ref: `#/components/schemas/${name}` });
const dataOf = (item: Json): Json => ({ type: 'object', required: ['data'], properties: { data: item } });
const listOf = (item: Json): Json => dataOf({ type: 'array', items: item });
const ok = (description: string, schema: Json): Json => ({ description, content: { 'application/json': { schema } } });
const body = (schema: Json): Json => ({ required: true, content: { 'application/json': { schema } } });
const noContent: Json = { description: 'Hecho (sin contenido).' };

const pathParam = (name: string, description: string, type: 'string' | 'integer' = 'string'): Json => ({
    name,
    in: 'path',
    required: true,
    description,
    schema: { type },
});
const queryParam = (name: string, description: string, schema: Json): Json => ({ name, in: 'query', required: false, description, schema });

const P = {
    list: pathParam('list', 'Id numérico de la lista (recomendado) o su slug.'),
    idOrSlug: pathParam('idOrSlug', 'Id numérico de la lista o su slug.'),
    field: pathParam('field', 'Id numérico del campo o su slug.'),
    id: pathParam('id', 'Id numérico.', 'integer'),
    recordId: pathParam('recordId', 'Id numérico del registro.', 'integer'),
    deliveryId: pathParam('deliveryId', 'Id numérico de la entrega.', 'integer'),
};

/** Errores comunes de toda ruta con token. */
const ERRORS: Json = {
    '400': { description: 'Datos inválidos.', content: { 'application/json': { schema: ref('Error') } } },
    '401': { description: 'Token inválido, vencido o revocado.', content: { 'application/json': { schema: ref('Error') } } },
    '403': {
        description: 'Sin permiso: el rol de la persona no alcanza, el token es de sólo lectura o la acción no está disponible por la API.',
        content: { 'application/json': { schema: ref('Error') } },
    },
    '404': { description: 'No existe (o la persona no lo puede ver).', content: { 'application/json': { schema: ref('Error') } } },
    '429': {
        description: 'Demasiados pedidos: espera los segundos de `Retry-After`.',
        headers: { 'Retry-After': { schema: { type: 'integer' }, description: 'Segundos hasta poder volver a pedir.' } },
        content: { 'application/json': { schema: ref('Error') } },
    },
};

function op(tag: string, summary: string, extra: Json, responses: Json): Json {
    return { tags: [tag], summary, ...extra, responses: { ...responses, ...ERRORS } };
}

export interface OpenApiInput {
    /** Dirección base de la API, p. ej. `https://base.imagina.cloud/api/v1`. */
    serverUrl: string;
    /** Versión de la app (VERSION). */
    version: string;
}

export function buildOpenApiDocument(input: OpenApiInput): Json {
    const recordsQuery = [
        queryParam('limit', 'Cuántos registros por página (1-200, 50 por defecto).', { type: 'integer', minimum: 1, maximum: 200 }),
        queryParam('cursor', 'El `meta.next_cursor` de la página anterior, para recorrer todo.', { type: 'string' }),
        queryParam('sort_dir', 'Orden por id: `asc` (más viejo primero) o `desc`.', { type: 'string', enum: ['asc', 'desc'] }),
        queryParam('sort', 'Orden por campos: `field_{id}:asc` (varios separados por coma).', { type: 'string' }),
        queryParam('search', 'Texto a buscar en los campos de texto, correo, enlace y teléfono.', { type: 'string' }),
        queryParam('filter_tree', 'Filtros como JSON (el mismo árbol que guarda una vista). Ver la guía.', { type: 'string' }),
        queryParam('parent', 'Sólo las subtareas de este registro.', { type: 'integer' }),
        queryParam('include_subtasks', 'Incluir las subtareas en el listado (por defecto sólo el primer nivel).', { type: 'boolean' }),
        queryParam('page', 'Paginar por número de página (trae `meta.total`).', { type: 'integer', minimum: 1 }),
        queryParam('with_total', 'Contar el total sin cambiar la paginación.', { type: 'boolean' }),
        queryParam('ids', 'Sólo estos registros (ids separados por coma, hasta 200).', { type: 'string' }),
        queryParam('related_to', 'Registros vinculados a otro: `<id del campo relación>:<id del registro>`.', { type: 'string' }),
    ];
    const recordsPage: Json = {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
            data: { type: 'array', items: ref('Record') },
            meta: {
                type: 'object',
                properties: {
                    next_cursor: { type: ['string', 'null'], description: 'Para pedir la página siguiente; `null` = no hay más.' },
                    total: { type: 'integer' },
                    page: { type: 'integer' },
                    per_page: { type: 'integer' },
                    total_pages: { type: 'integer' },
                },
            },
        },
    };

    const paths: Record<string, Json> = {
        '/whoami': {
            get: op('Cuenta', 'Quién usa el token', {}, {
                '200': ok('La persona, la empresa y el token.', ref('WhoAmI')),
            }),
        },
        '/lists': {
            get: op('Listas', 'Listas que la persona puede ver', {}, { '200': ok('Las listas.', listOf(ref('List'))) }),
            post: op('Listas', 'Crear una lista', { requestBody: body(ref('CreateList')) }, { '201': ok('La lista creada.', ref('List')) }),
        },
        '/lists/{idOrSlug}': {
            get: op('Listas', 'Una lista', { parameters: [P.idOrSlug] }, { '200': ok('La lista.', ref('List')) }),
            patch: op('Listas', 'Cambiar una lista', { parameters: [P.idOrSlug], requestBody: body(ref('UpdateList')) }, { '200': ok('La lista cambiada.', ref('List')) }),
        },
        '/list-groups': {
            get: op('Listas', 'Carpetas de listas', {}, { '200': ok('Las carpetas.', listOf(ref('ListGroup'))) }),
        },
        '/lists/{list}/fields': {
            get: op('Campos', 'Campos de una lista', { parameters: [P.list] }, { '200': ok('Los campos, en orden.', listOf(ref('Field'))) }),
            post: op('Campos', 'Crear un campo', { parameters: [P.list], requestBody: body(ref('CreateField')) }, { '201': ok('El campo creado.', ref('Field')) }),
        },
        '/lists/{list}/fields/{field}': {
            get: op('Campos', 'Un campo', { parameters: [P.list, P.field] }, { '200': ok('El campo.', ref('Field')) }),
            patch: op('Campos', 'Cambiar un campo', { parameters: [P.list, P.field], requestBody: body(ref('UpdateField')) }, { '200': ok('El campo cambiado.', ref('Field')) }),
        },
        '/lists/{list}/fields/{field}/options': {
            post: op('Campos', 'Agregar una opción a una selección', { parameters: [P.list, P.field], requestBody: body(ref('AppendFieldOption')) }, {
                '201': ok('El campo con la opción nueva.', ref('Field')),
            }),
        },
        '/lists/{list}/fields/{field}/values': {
            get: op('Campos', 'Valores distintos de un campo (con cuántas veces aparece cada uno)', {
                parameters: [P.list, P.field, queryParam('search', 'Filtrar por texto.', { type: 'string' })],
            }, {
                '200': ok('Los valores.', listOf({ type: 'object', properties: { value: { type: 'string' }, count: { type: 'integer' } } })),
            }),
        },
        '/lists/{list}/views': {
            get: op('Vistas', 'Vistas guardadas de una lista', { parameters: [P.list] }, { '200': ok('Las vistas.', listOf(ref('View'))) }),
        },
        '/lists/{list}/views/{id}': {
            get: op('Vistas', 'Una vista guardada', { parameters: [P.list, P.id] }, { '200': ok('La vista.', ref('View')) }),
        },
        '/lists/{list}/records': {
            get: op('Registros', 'Registros de una lista', { parameters: [P.list, ...recordsQuery] }, { '200': ok('Una página de registros.', recordsPage) }),
            post: op('Registros', 'Crear un registro', { parameters: [P.list], requestBody: body(ref('CreateRecord')) }, { '201': ok('El registro creado.', ref('Record')) }),
        },
        '/lists/{list}/records/batch': {
            post: op('Registros', 'Crear varios registros (hasta 500)', { parameters: [P.list], requestBody: body(ref('BatchCreateRecords')) }, {
                '200': ok('Los creados y los que no se pudieron crear.', ref('BatchCreateResult')),
            }),
            patch: op('Registros', 'Cambiar varios registros con valores distintos (hasta 500)', { parameters: [P.list], requestBody: body(ref('BatchUpdateRecords')) }, {
                '200': ok('Los cambiados, las filas que no y las celdas con error.', ref('BatchUpdateResult')),
            }),
        },
        '/lists/{list}/records/batch-delete': {
            post: op('Registros', 'Mandar varios registros a la papelera (hasta 500)', { parameters: [P.list], requestBody: body(ref('BatchDeleteRecords')) }, {
                '200': ok('Los borrados y los que no.', ref('BatchDeleteResult')),
            }),
        },
        '/lists/{list}/records/{id}': {
            get: op('Registros', 'Un registro', { parameters: [P.list, P.id] }, { '200': ok('El registro.', ref('Record')) }),
            patch: op('Registros', 'Cambiar un registro (sólo los campos que mandas)', { parameters: [P.list, P.id], requestBody: body(ref('UpdateRecord')) }, {
                '200': ok('El registro cambiado.', ref('Record')),
            }),
            delete: op('Registros', 'Mandar un registro a la papelera', { parameters: [P.list, P.id] }, { '204': noContent }),
        },
        '/lists/{list}/records/{id}/description': {
            get: op('Registros', 'Descripción del registro (documento con formato)', { parameters: [P.list, P.id] }, {
                '200': ok('La descripción (`null` si no tiene).', { type: 'object', properties: { description: { type: ['object', 'null'] } } }),
            }),
            patch: op('Registros', 'Cambiar la descripción', {
                parameters: [P.list, P.id],
                requestBody: body({ type: 'object', required: ['description'], properties: { description: { type: ['object', 'null'], description: 'Documento ProseMirror (ver la guía).' } } }),
            }, {
                '200': ok('La descripción guardada.', { type: 'object', properties: { description: { type: ['object', 'null'] } } }),
            }),
        },
        '/lists/{list}/records/{recordId}/comments': {
            get: op('Comentarios', 'Comentarios de un registro', { parameters: [P.list, P.recordId] }, { '200': ok('Los comentarios.', listOf(ref('Comment'))) }),
            post: op('Comentarios', 'Comentar un registro', { parameters: [P.list, P.recordId], requestBody: body(ref('CreateComment')) }, {
                '201': ok('El comentario.', ref('Comment')),
            }),
        },
        '/lists/{list}/records/{recordId}/comments/{id}': {
            patch: op('Comentarios', 'Cambiar un comentario propio', { parameters: [P.list, P.recordId, P.id], requestBody: body(ref('UpdateComment')) }, {
                '200': ok('El comentario cambiado.', ref('Comment')),
            }),
            delete: op('Comentarios', 'Borrar un comentario', { parameters: [P.list, P.recordId, P.id] }, { '204': noContent }),
        },
        '/search': {
            get: op('Búsqueda', 'Buscar registros en todas las listas', {
                parameters: [
                    { name: 'q', in: 'query', required: true, description: 'Texto a buscar (en el título del registro).', schema: { type: 'string' } },
                    queryParam('limit', 'Cuántos resultados (máximo 50).', { type: 'integer' }),
                ],
            }, { '200': ok('Los registros encontrados.', { type: 'array', items: ref('SearchHit') }) }),
        },
        '/files': {
            get: op('Archivos', 'Datos de varios archivos', {
                parameters: [{ name: 'ids', in: 'query', required: true, description: 'Ids separados por coma (los que guarda un campo Archivo).', schema: { type: 'string' } }],
            }, { '200': ok('Los archivos.', listOf(ref('Attachment'))) }),
            post: op('Archivos', 'Subir un archivo', {
                description: 'Sube el archivo como `multipart/form-data` (campo `file`). Devuelve su id: para adjuntarlo a un registro, ponlo en el campo Archivo (`{"f12": [id]}`).',
                requestBody: {
                    required: true,
                    content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } } },
                },
            }, { '201': ok('El archivo subido.', ref('Attachment')) }),
        },
        '/files/{id}/download': {
            get: op('Archivos', 'Descargar un archivo', { parameters: [P.id] }, {
                '200': { description: 'Los bytes del archivo.', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
            }),
        },
        '/me/users-search': {
            get: op('Personas', 'Buscar personas del equipo (para un campo Persona)', {
                parameters: [queryParam('q', 'Nombre o correo.', { type: 'string' }), queryParam('limit', 'Cuántas.', { type: 'integer' })],
            }, { '200': ok('Las personas.', listOf(ref('User'))) }),
        },
        '/me/users': {
            get: op('Personas', 'Varias personas por id', {
                parameters: [{ name: 'ids', in: 'query', required: true, description: 'Ids separados por coma.', schema: { type: 'string' } }],
            }, { '200': ok('Las personas.', listOf(ref('User'))) }),
        },
        '/me/users/{id}': {
            get: op('Personas', 'Una persona por id', { parameters: [P.id] }, { '200': ok('La persona.', ref('User')) }),
        },
        '/teams': {
            get: op('Personas', 'Equipos (para un campo Equipo)', {}, { '200': ok('Los equipos.', listOf(ref('Team'))) }),
        },
        '/teams/{id}': {
            get: op('Personas', 'Un equipo', { parameters: [P.id] }, { '200': ok('El equipo.', dataOf(ref('Team'))) }),
        },
        // v0.1.442 — webhooks de eventos: n8n, Make o Zapier registran su dirección y se enteran en el momento.
        '/webhooks': {
            get: op('Webhooks', 'Webhooks de eventos (los tuyos; un administrador ve todos)', {}, { '200': ok('Los webhooks.', listOf(ref('Webhook'))) }),
            post: op('Webhooks', 'Registrar un webhook (el secreto de firma viaja sólo en esta respuesta)', { requestBody: body(ref('CreateWebhook')) }, {
                '201': ok('El webhook con su secreto.', ref('CreatedWebhook')),
            }),
        },
        '/webhooks/{id}': {
            get: op('Webhooks', 'Un webhook', { parameters: [P.id] }, { '200': ok('El webhook.', ref('Webhook')) }),
            patch: op('Webhooks', 'Cambiar, pausar o encender un webhook', { parameters: [P.id], requestBody: body(ref('UpdateWebhook')) }, {
                '200': ok('El webhook.', ref('Webhook')),
            }),
            delete: op('Webhooks', 'Borrar un webhook (deja de avisar al instante)', { parameters: [P.id] }, { '204': noContent }),
        },
        '/webhooks/{id}/test': {
            post: op('Webhooks', 'Mandar un aviso de prueba (`ping`) firmado', { parameters: [P.id] }, { '200': ok('Qué respondió la dirección.', ref('WebhookTestResult')) }),
        },
        '/webhooks/{id}/rotate-secret': {
            post: op('Webhooks', 'Cambiar el secreto de firma (el nuevo viaja sólo en esta respuesta)', { parameters: [P.id] }, {
                '200': ok('El webhook con el secreto nuevo.', ref('CreatedWebhook')),
            }),
        },
        '/webhooks/{id}/deliveries': {
            get: op('Webhooks', 'Las últimas entregas de un webhook', {
                parameters: [P.id, queryParam('limit', 'Cuántas (1-100, 30 por defecto).', { type: 'integer' }), queryParam('before', 'Las anteriores a esta entrega (id).', { type: 'integer' })],
            }, { '200': ok('Las entregas, de la más nueva a la más vieja.', listOf(ref('WebhookDelivery'))) }),
        },
        '/webhooks/{id}/deliveries/{deliveryId}/redeliver': {
            post: op('Webhooks', 'Volver a mandar una entrega (mismo id de evento y mismo contenido)', { parameters: [P.id, P.deliveryId] }, {
                '200': ok('La entrega, otra vez en espera.', ref('WebhookDelivery')),
            }),
        },
    };

    const webhookProps: Json = {
        id: { type: 'integer' },
        name: { type: 'string' },
        url: { type: 'string' },
        events: { type: 'array', items: { type: 'string', enum: [...WEBHOOK_EVENTS] } },
        list_ids: { type: ['array', 'null'], items: { type: 'integer' }, description: '`null` = todas las listas que ve quien lo creó.' },
        active: { type: 'boolean' },
        disabled_reason: { type: ['string', 'null'] },
        secret_hint: { type: 'string', description: 'Los últimos 4 caracteres del secreto.' },
        created_by: { type: 'integer' },
        created_by_name: { type: ['string', 'null'] },
        source: { type: 'string', enum: ['app', 'api'] },
        consecutive_failures: { type: 'integer' },
        last_delivery_at: { type: ['string', 'null'] },
        last_status: { type: ['string', 'null'] },
        created_at: { type: 'string' },
        updated_at: { type: 'string' },
    };

    const batchRowError: Json = {
        type: 'object',
        properties: { id: { type: 'integer' }, code: { type: 'string' }, message: { type: 'string' }, changed: { type: 'array', items: { type: 'string' } } },
    };

    return {
        openapi: '3.1.0',
        info: {
            title: 'API',
            version: input.version,
            description: [
                'Lee y escribe las listas, los campos y los registros de tu empresa desde otros programas (n8n, Make, Zapier, tus propios scripts).',
                '',
                '**Cómo entrar**: crea un token en Ajustes → API y mándalo en cada pedido con la cabecera `Authorization: Bearer <token>`.',
                'El token actúa como la persona que lo creó, en su empresa: ve y cambia sólo lo que esa persona puede ver y cambiar.',
                '',
                '**Valores de los registros**: van en `data` con la clave `f{id del campo}` (por ejemplo `{"f12": "Acme"}`). El id de cada campo sale de `GET /lists/{list}/fields`. Las claves no cambian aunque renombres el campo.',
                '',
                '**Límite**: 300 pedidos por minuto por token (cabeceras `X-RateLimit-Limit` y `X-RateLimit-Remaining`); pasado el límite, `429` con `Retry-After`.',
                '',
                '**Webhooks de eventos**: registra una dirección (`POST /webhooks`) y te avisamos con un `POST` cuando se crea, cambia o borra un registro, se envía un formulario o entra un pago. Cada aviso trae `X-Webhook-Signature: t=<segundos>,v1=<firma>`, donde la firma es HMAC-SHA256 en hexadecimal de `<t>.<cuerpo>` con el secreto del webhook; compárala y descarta avisos de más de 5 minutos. Responde 2xx rápido: un error o un timeout se reintenta (hasta siete intentos en unas 21 horas) y un `410` borra la suscripción. Un mismo aviso puede llegar dos veces: usa `X-Webhook-Id` para no procesarlo de nuevo.',
            ].join('\n'),
        },
        servers: [{ url: input.serverUrl }],
        security: [{ bearer: [] }],
        tags: [
            { name: 'Cuenta' },
            { name: 'Listas' },
            { name: 'Campos' },
            { name: 'Vistas' },
            { name: 'Registros' },
            { name: 'Comentarios' },
            { name: 'Búsqueda' },
            { name: 'Archivos' },
            { name: 'Personas' },
            { name: 'Webhooks' },
        ],
        paths,
        components: {
            securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'Token de la API (`ib_pat_…`) creado en Ajustes → API.' } },
            schemas: {
                Error: schemaOf(apiErrorSchema),
                WhoAmI: {
                    type: 'object',
                    properties: {
                        user: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, email: { type: 'string' } } },
                        tenant: { type: 'object', properties: { id: { type: 'integer' }, slug: { type: 'string' }, name: { type: 'string' } } },
                        role: { type: 'string' },
                        token: {
                            type: ['object', 'null'],
                            properties: { id: { type: 'integer' }, scope: { type: 'string', enum: ['read', 'full'] } },
                        },
                    },
                },
                List: schemaOf(listSchema),
                CreateList: schemaOf(createListSchema),
                UpdateList: schemaOf(updateListSchema),
                ListGroup: schemaOf(listGroupSchema),
                Field: schemaOf(fieldSchema),
                CreateField: schemaOf(createFieldSchema),
                UpdateField: schemaOf(updateFieldSchema),
                AppendFieldOption: schemaOf(appendFieldOptionSchema),
                View: schemaOf(viewSchema),
                Record: schemaOf(recordSchema),
                CreateRecord: schemaOf(createRecordSchema),
                UpdateRecord: schemaOf(updateRecordSchema),
                BatchCreateRecords: schemaOf(batchCreateRecordsSchema),
                BatchUpdateRecords: schemaOf(batchUpdateRecordsSchema),
                BatchDeleteRecords: schemaOf(batchDeleteRecordsSchema),
                BatchCreateResult: {
                    type: 'object',
                    properties: {
                        created: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, record: ref('Record') } } },
                        failed: {
                            type: 'array',
                            items: { type: 'object', properties: { index: { type: 'integer' }, code: { type: 'string' }, message: { type: 'string' }, errors: { type: 'object' } } },
                        },
                    },
                },
                BatchUpdateResult: {
                    type: 'object',
                    properties: {
                        updated: { type: 'array', items: ref('Record') },
                        failed: { type: 'array', items: batchRowError },
                        cell_errors: {
                            type: 'array',
                            items: { type: 'object', properties: { id: { type: 'integer' }, key: { type: 'string' }, message: { type: 'string' } } },
                        },
                    },
                },
                BatchDeleteResult: {
                    type: 'object',
                    properties: { deleted: { type: 'array', items: { type: 'integer' } }, failed: { type: 'array', items: batchRowError } },
                },
                Comment: schemaOf(commentSchema),
                CreateComment: schemaOf(createCommentSchema),
                UpdateComment: schemaOf(updateCommentSchema),
                SearchHit: schemaOf(globalSearchHitSchema),
                Attachment: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer' },
                        url: { type: 'string' },
                        thumb_url: { type: 'string' },
                        title: { type: 'string' },
                        mime_type: { type: 'string' },
                        size_bytes: { type: 'integer' },
                        created_at: { type: 'string' },
                    },
                },
                User: schemaOf(meUserSummarySchema),
                Team: schemaOf(teamSchema),
                Webhook: { type: 'object', properties: webhookProps },
                CreatedWebhook: {
                    type: 'object',
                    properties: { ...webhookProps, secret: { type: 'string', description: 'Guárdalo: no se vuelve a mostrar. Sirve para verificar la firma.' } },
                },
                CreateWebhook: schemaOf(createWebhookSubscriptionSchema),
                UpdateWebhook: schemaOf(updateWebhookSubscriptionSchema),
                WebhookTestResult: {
                    type: 'object',
                    properties: {
                        ok: { type: 'boolean' },
                        status: { type: ['integer', 'null'] },
                        body: { type: ['string', 'null'] },
                        error: { type: ['string', 'null'] },
                        duration_ms: { type: 'integer' },
                    },
                },
                WebhookDelivery: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer' },
                        event_id: { type: 'string' },
                        event: { type: 'string' },
                        record_id: { type: ['integer', 'null'] },
                        list_id: { type: ['integer', 'null'] },
                        status: { type: 'string', enum: ['pending', 'success', 'failed', 'skipped'] },
                        attempts: { type: 'integer' },
                        response_status: { type: ['integer', 'null'] },
                        response_body: { type: ['string', 'null'] },
                        error: { type: ['string', 'null'] },
                        created_at: { type: 'string' },
                        delivered_at: { type: ['string', 'null'] },
                        next_attempt_at: { type: ['string', 'null'] },
                    },
                },
            },
        },
    };
}

/** `/api/v1/lists/:list/records` → `/lists/{list}/records` (la forma de OpenAPI). */
export function openApiPathOf(route: string): string {
    return route.replace(/^\/api\/v1/, '').replace(/:([A-Za-z]+)/g, '{$1}');
}
