import { describe, expect, it } from 'vitest';
import { buildWebhookRequest } from '../src/automations/webhook-request';

/**
 * v0.1.155 — el constructor de la petición de `call_webhook`. Es puro a
 * propósito: el probador de la UI y el motor arman EXACTAMENTE lo mismo, así
 * que lo que se prueba es lo que después se ejecuta.
 */
const merge = (raw: unknown): string =>
    String(raw ?? '').replace(/\{\{(\w+)\}\}/g, (_m, k: string) =>
        ({ telefono: '+573001112233', nombre: 'Ana' })[k] ?? '',
    );
const fallback = { recordId: 7, listId: 3 };

describe('buildWebhookRequest', () => {
    it('form-urlencoded: arma el cuerpo que espera una API tipo gateway de WhatsApp', () => {
        const req = buildWebhookRequest(
            {
                url: 'https://was.example.com/api/send/whatsapp',
                method: 'POST',
                content_type: 'form',
                body_params: [
                    { key: 'secret', value: 'abc123' },
                    { key: 'recipient', value: '{{telefono}}' },
                    { key: 'message', value: 'Hola {{nombre}}, tu licencia venció' },
                ],
            },
            merge,
            fallback,
        );
        expect(req.method).toBe('POST');
        expect(req.headers['content-type']).toBe('application/x-www-form-urlencoded');
        // Las variables ya resueltas y todo escapado para la URL.
        expect(req.body).toBe(
            'secret=abc123&recipient=%2B573001112233&message=Hola%20Ana%2C%20tu%20licencia%20venci%C3%B3',
        );
    });

    it('json: las mismas filas producen un objeto', () => {
        const req = buildWebhookRequest(
            {
                url: 'https://api.example.com/hook',
                body_params: [{ key: 'to', value: '{{telefono}}' }],
            },
            merge,
            fallback,
        );
        expect(req.headers['content-type']).toBe('application/json');
        expect(JSON.parse(req.body!)).toEqual({ to: '+573001112233' });
    });

    it('cabeceras y parámetros de la URL, con variables', () => {
        const req = buildWebhookRequest(
            {
                url: 'https://api.example.com/hook?ya=1',
                headers: [{ key: 'Authorization', value: 'Bearer tok' }],
                query_params: [{ key: 'nombre', value: '{{nombre}}' }],
                body_params: [{ key: 'x', value: '1' }],
            },
            merge,
            fallback,
        );
        expect(req.url).toBe('https://api.example.com/hook?ya=1&nombre=Ana');
        expect(req.headers.authorization).toBe('Bearer tok');
    });

    it('sin filas usa la plantilla cruda; sin nada, el payload por defecto', () => {
        const raw = buildWebhookRequest(
            { url: 'https://x.test/h', body_template: '{"n": "{{nombre}}"}' },
            merge,
            fallback,
        );
        expect(raw.body).toBe('{"n": "Ana"}');

        const none = buildWebhookRequest({ url: 'https://x.test/h' }, merge, fallback);
        expect(JSON.parse(none.body!)).toEqual({ record_id: 7, list_id: 3 });
    });

    it('GET no lleva cuerpo y el secreto firma lo que se manda', () => {
        const get = buildWebhookRequest(
            { url: 'https://x.test/h', method: 'GET', body_params: [{ key: 'a', value: '1' }] },
            merge,
            fallback,
        );
        expect(get.body).toBeUndefined();

        const signed = buildWebhookRequest(
            { url: 'https://x.test/h', secret: 's3cr3t', body_params: [{ key: 'a', value: '1' }] },
            merge,
            fallback,
        );
        expect(signed.headers['x-imagina-signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('acepta el shape viejo de headers (objeto plano) sin romper automatizaciones guardadas', () => {
        const req = buildWebhookRequest(
            { url: 'https://x.test/h', headers: { 'X-Api-Key': 'k' } },
            merge,
            fallback,
        );
        expect(req.headers['x-api-key']).toBe('k');
    });
});
