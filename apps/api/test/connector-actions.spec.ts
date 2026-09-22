import { connectorActionSchema, type ConnectorAction } from '@imagina-base/shared';
import { describe, expect, it } from 'vitest';
import {
    compileConnectorCall,
    findConnectorAction,
    readConnectorActions,
} from '../src/connectors/connector-actions';
import { connectionParts } from '../src/connectors/connection-parts';
import { buildWebhookRequest } from '../src/automations/webhook-request';

/**
 * v0.1.198 (ADR-S22 fase 2) — acciones con NOMBRE de un conector.
 *
 * El compilador es puro y es la pieza donde un descuido manda el dato al lugar
 * equivocado (el cuerpo en vez de la URL, un obligatorio vacío que sale igual,
 * un merge tag expandido dos veces). Por eso se prueba solo, y además contra
 * `buildWebhookRequest` — que es quien de verdad ejecuta.
 */

/** El `over` va SIN tipar a propósito: `parse` aplica los defaults del
 *  schema, que es exactamente lo que hace la app al leer del jsonb. */
function action(over: Record<string, unknown> = {}): ConnectorAction {
    return connectorActionSchema.parse({
        key: 'enviar_whatsapp',
        label: 'Enviar WhatsApp',
        method: 'POST',
        path: '/send',
        content_type: 'form',
        params: [
            { key: 'recipient', label: 'Destinatario', required: true },
            { key: 'message', label: 'Mensaje', type: 'long_text', required: true },
            { key: 'nota', label: 'Nota interna' },
        ],
        ...over,
    });
}

/** Merge de prueba: `{{nombre}}` → "Ana". */
const merge = (raw: unknown): string =>
    String(raw ?? '').replace(/\{\{(\w+)\}\}/g, (_w, k: string) =>
        k === 'nombre' ? 'Ana' : k === 'tel' ? '+573001112233' : '',
    );

describe('readConnectorActions', () => {
    it('descarta las acciones mal formadas sin perder las buenas', () => {
        const out = readConnectorActions([
            { key: 'ok', label: 'Buena' },
            { key: 'MAYUSCULAS', label: 'Clave inválida' },
            { label: 'Sin clave' },
            'basura',
        ]);
        expect(out.map((a) => a.key)).toEqual(['ok']);
        // Los defaults del schema se aplican al leer.
        expect(out[0]).toMatchObject({ method: 'POST', content_type: 'json', params: [] });
    });

    it('un config sin acciones devuelve lista vacía (conexiones pre-v0.1.198)', () => {
        expect(readConnectorActions(undefined)).toEqual([]);
        expect(readConnectorActions({})).toEqual([]);
    });
});

describe('findConnectorAction', () => {
    it('busca por clave exacta y devuelve null si ya no existe', () => {
        const actions = [action()];
        expect(findConnectorAction(actions, 'enviar_whatsapp')?.label).toBe('Enviar WhatsApp');
        expect(findConnectorAction(actions, 'borrada')).toBeNull();
        expect(findConnectorAction(actions, '')).toBeNull();
        expect(findConnectorAction(undefined, 'enviar_whatsapp')).toBeNull();
    });
});

describe('compileConnectorCall', () => {
    it('resuelve merge tags y reparte por ubicación', () => {
        const a = action({
            params: [
                { key: 'recipient', label: 'Para', required: true, location: 'body' },
                { key: 'message', label: 'Mensaje', required: true, location: 'body' },
                { key: 'lang', label: 'Idioma', location: 'query', default: 'es' },
                { key: 'X-Trace', label: 'Traza', location: 'header', default: 'imagina' },
            ],
        });
        const { cfg, missing } = compileConnectorCall(
            a,
            { recipient: '{{tel}}', message: 'Hola {{nombre}}' },
            merge,
        );
        expect(missing).toEqual([]);
        expect(cfg.body_params).toEqual([
            { key: 'recipient', value: '+573001112233' },
            { key: 'message', value: 'Hola Ana' },
        ]);
        // El default se usa cuando la automatización no escribió nada.
        expect(cfg.query_params).toEqual([{ key: 'lang', value: 'es' }]);
        expect(cfg.headers).toEqual([{ key: 'X-Trace', value: 'imagina' }]);
        expect(cfg.method).toBe('POST');
        expect(cfg.content_type).toBe('form');
    });

    it('reporta los obligatorios vacíos por su ETIQUETA y no por la clave', () => {
        const { missing } = compileConnectorCall(action(), { message: 'Hola' }, merge);
        expect(missing).toEqual(['Destinatario']);
    });

    it('un opcional vacío NO viaja (mandar `nota=` cambia el pedido)', () => {
        const { cfg } = compileConnectorCall(
            action(),
            { recipient: '+57', message: 'Hola' },
            merge,
        );
        expect(cfg.body_params).toEqual([
            { key: 'recipient', value: '+57' },
            { key: 'message', value: 'Hola' },
        ]);
    });

    it('sustituye {clave} en la ruta, escapando el valor', () => {
        const a = action({
            path: '/chats/{chat}/messages',
            params: [{ key: 'chat', label: 'Chat', required: true, location: 'path' }],
        });
        const { cfg } = compileConnectorCall(a, { chat: 'a/b c' }, merge);
        expect(cfg.url).toBe('/chats/a%2Fb%20c/messages');
        // Un param `path` no se duplica en el cuerpo.
        expect(cfg.body_params).toEqual([]);
    });

    it('deja intacto un {placeholder} que no corresponde a ningún parámetro', () => {
        const a = action({ path: '/v1/{version}/send', params: [] });
        const { cfg } = compileConnectorCall(a, {}, merge);
        expect(cfg.url).toBe('/v1/{version}/send');
    });

    it('sustituye en el cuerpo crudo SIN escapar (xml/text/html)', () => {
        const a = action({
            content_type: 'xml',
            body_template: '<msg to="{recipient}">{message}</msg>',
            params: [
                { key: 'recipient', label: 'Para', required: true },
                { key: 'message', label: 'Mensaje', required: true },
            ],
        });
        const { cfg } = compileConnectorCall(
            a,
            { recipient: '{{tel}}', message: 'Hola {{nombre}}' },
            merge,
        );
        expect(cfg.body_template).toBe('<msg to="+573001112233">Hola Ana</msg>');
    });
});

describe('compilado + buildWebhookRequest (lo que de verdad sale)', () => {
    it('arma la petición completa con la credencial del conector', () => {
        const parts = connectionParts(
            {
                baseUrl: 'https://was.example.test/api',
                authType: 'body',
                authKey: 'secret',
                headers: [],
                queryParams: [],
            },
            { token: 'clave-del-gateway' },
        );
        const { cfg } = compileConnectorCall(
            action(),
            { recipient: '{{tel}}', message: 'Hola {{nombre}}' },
            merge,
        );
        // Identidad: los valores YA pasaron por merge en el compilador; volver
        // a expandir re-interpretaría como plantilla el texto de un registro.
        const req = buildWebhookRequest(cfg, (raw) => String(raw ?? ''), { recordId: 7, listId: 1 }, parts);

        expect(req.method).toBe('POST');
        expect(req.url).toBe('https://was.example.test/api/send');
        expect(req.headers['content-type']).toBe('application/x-www-form-urlencoded');
        // La credencial va en el cuerpo (auth_type `body`) y los valores de la
        // acción después.
        expect(req.body).toBe(
            'secret=clave-del-gateway&recipient=%2B573001112233&message=Hola%20Ana',
        );
    });

    it('con merge identidad, un valor que contiene {{…}} NO se re-expande', () => {
        const { cfg } = compileConnectorCall(
            action(),
            // El registro trae literalmente esto escrito por una persona.
            { recipient: '+57', message: 'Escribí {{nombre}} en el formulario' },
            (raw) => String(raw ?? ''),
        );
        const req = buildWebhookRequest(
            cfg,
            (raw) => String(raw ?? ''),
            { recordId: 1, listId: 1 },
            null,
        );
        expect(req.body).toContain(encodeURIComponent('Escribí {{nombre}} en el formulario'));
    });
});
