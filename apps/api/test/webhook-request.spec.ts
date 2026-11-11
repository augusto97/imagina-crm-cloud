import { describe, expect, it } from 'vitest';
import { buildWebhookRequest, mergeUrl, type MergeFn } from '../src/automations/webhook-request';
import { connectionParts, redactValues } from '../src/connectors/connection-parts';
import { applyMergeTags } from '../src/automations/merge-tags';

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

    it('multipart arma partes de texto con boundary coherente', () => {
        const req = buildWebhookRequest(
            {
                url: 'https://x.test/h',
                content_type: 'multipart',
                body_params: [{ key: 'recipient', value: '{{telefono}}' }],
            },
            merge,
            fallback,
        );
        const boundary = /boundary=(.+)$/.exec(req.headers['content-type']!)?.[1];
        expect(boundary).toBeTruthy();
        expect(req.body).toContain(`--${boundary}\r\nContent-Disposition: form-data; name="recipient"`);
        expect(req.body!.endsWith(`--${boundary}--\r\n`)).toBe(true);
    });

    it('text/xml/html mandan el cuerpo TAL CUAL, con su mime', () => {
        const xml = buildWebhookRequest(
            {
                url: 'https://x.test/h',
                content_type: 'xml',
                body_template: '<msg to="{{telefono}}"/>',
                // Las filas se ignoran: en XML no aplica "una fila por dato".
                body_params: [{ key: 'a', value: '1' }],
            },
            merge,
            fallback,
        );
        expect(xml.headers['content-type']).toBe('application/xml');
        expect(xml.body).toBe('<msg to="+573001112233"/>');

        const txt = buildWebhookRequest(
            { url: 'https://x.test/h', content_type: 'text', body_template: 'hola {{nombre}}' },
            merge,
            fallback,
        );
        expect(txt.headers['content-type']).toBe('text/plain; charset=utf-8');
        expect(txt.body).toBe('hola Ana');
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

/**
 * La credencial de una conexión sólo viaja a SU servidor: antes una acción con
 * URL absoluta (o una variable en el host) se la llevaba a cualquier lado.
 */
describe('buildWebhookRequest — la credencial de la conexión sólo va a su servidor', () => {
    const values: Record<string, unknown> = { host: 'evil.test', url: 'https://evil.test/collect', ruta: 'send' };
    const tagMerge: MergeFn = (raw, esc) => applyMergeTags(typeof raw === 'string' ? raw : '', (slug) => values[slug], 7, esc);
    const bearer = () => ({
        ...connectionParts(
            { baseUrl: 'https://api.vendor.test/v1', authType: 'bearer', authKey: '', headers: [], queryParams: [] },
            { token: 'S3CRET99token' },
        ),
        name: 'Proveedor',
    });

    it('URL absoluta a OTRO servidor: falla y no arma la petición', () => {
        expect(() => buildWebhookRequest({ url: 'https://other.test/x' }, tagMerge, fallback, bearer())).toThrow(/sólo envía su credencial a https:\/\/api\.vendor\.test/);
        // Mismo host con otro esquema u otro puerto tampoco es el mismo servidor.
        expect(() => buildWebhookRequest({ url: 'http://api.vendor.test/x' }, tagMerge, fallback, bearer())).toThrow(/sólo envía/);
        expect(() => buildWebhookRequest({ url: 'https://api.vendor.test:8443/x' }, tagMerge, fallback, bearer())).toThrow(/sólo envía/);
        // Un host «parecido» y el truco del usuario en la dirección.
        expect(() => buildWebhookRequest({ url: 'https://api.vendor.test.evil.test/x' }, tagMerge, fallback, bearer())).toThrow(/sólo envía/);
        expect(() => buildWebhookRequest({ url: 'https://api.vendor.test@evil.test/x' }, tagMerge, fallback, bearer())).toThrow(/sólo envía/);
    });

    it('la misma dirección (absoluta o relativa) sigue llevando la credencial', () => {
        const abs = buildWebhookRequest({ url: 'https://API.vendor.test/otra/ruta' }, tagMerge, fallback, bearer());
        expect(abs.headers.authorization).toBe('Bearer S3CRET99token');
        const rel = buildWebhookRequest({ url: '/{{ruta}}' }, tagMerge, fallback, bearer());
        expect(rel.url).toBe('https://api.vendor.test/v1/send');
        expect(rel.headers.authorization).toBe('Bearer S3CRET99token');
    });

    it('una variable no puede mover el destino', () => {
        expect(() => buildWebhookRequest({ url: '{{url}}' }, tagMerge, fallback, bearer())).toThrow(/sólo envía/);
        expect(() => buildWebhookRequest({ url: 'https://{{host}}/x' }, tagMerge, fallback, bearer())).toThrow(/sólo envía/);
    });

    it('credencial en la URL, en el cuerpo y la firma: la misma regla', () => {
        const query = connectionParts({ baseUrl: 'https://api.vendor.test', authType: 'query', authKey: 'api_key', headers: [], queryParams: [] }, { token: 'S3CRET99token' });
        const body = connectionParts({ baseUrl: 'https://api.vendor.test', authType: 'body', authKey: 'secret', headers: [], queryParams: [] }, { token: 'S3CRET99token' });
        const sign = connectionParts({ baseUrl: 'https://api.vendor.test', authType: 'none', authKey: '', headers: [], queryParams: [] }, { signing_secret: 'firma-secreta' });
        for (const parts of [query, body, sign]) {
            expect(() => buildWebhookRequest({ url: 'https://other.test/x', content_type: 'form', body_params: [{ key: 'a', value: '1' }] }, tagMerge, fallback, parts)).toThrow(/sólo envía/);
        }
    });

    it('una conexión con credencial y SIN dirección no la envía: pide completarla', () => {
        const noBase = connectionParts({ baseUrl: '', authType: 'bearer', authKey: '', headers: [], queryParams: [] }, { token: 'S3CRET99token' });
        expect(() => buildWebhookRequest({ url: 'https://api.vendor.test/x' }, tagMerge, fallback, noBase)).toThrow(/no tiene una dirección/);
        // Sin nada que aportar (ni credencial ni cabeceras), la conexión no restringe.
        const empty = connectionParts({ baseUrl: '', authType: 'none', authKey: '', headers: [], queryParams: [] }, {});
        expect(buildWebhookRequest({ url: 'https://libre.test/x' }, tagMerge, fallback, empty).url).toBe('https://libre.test/x');
    });

    it('lo que se tapa incluye la credencial como VIAJA (Basic en base64, token codificado)', () => {
        const basic = connectionParts({ baseUrl: 'https://api.vendor.test', authType: 'basic', authKey: '', headers: [], queryParams: [] }, { username: 'ana', password: 'cl@ve secreta' });
        const b64 = Buffer.from('ana:cl@ve secreta').toString('base64');
        const echo = `{"authorization":"Basic ${b64}","q":"${encodeURIComponent('cl@ve secreta')}"}`;
        const shown = redactValues(echo, basic.redact);
        expect(shown).not.toContain(b64);
        expect(shown).not.toContain(encodeURIComponent('cl@ve secreta'));
    });
});

/** Los valores de las variables en la URL se codifican según dónde caen. */
describe('mergeUrl — un valor del registro no cambia la forma de la URL', () => {
    const values: Record<string, unknown> = {
        n: 'x&role=admin#',
        sub: 'evil.test/',
        url: 'https://sitio.test/a?b=1&c=2',
        ruta: 'clientes/42',
        sube: '../../admin',
        ya: 'a%20b',
        nombre: 'Ana María',
    };
    const tagMerge: MergeFn = (raw, esc) => applyMergeTags(typeof raw === 'string' ? raw : '', (slug) => values[slug], 7, esc);

    it('en la consulta: no agrega parámetros ni corta con #', () => {
        expect(mergeUrl('https://api.vendor.test/c?name={{n}}', tagMerge)).toBe('https://api.vendor.test/c?name=x%26role%3Dadmin%23');
        expect(mergeUrl('https://api.vendor.test/c?q={{nombre}}&fijo=a%20b', tagMerge)).toBe('https://api.vendor.test/c?q=Ana%20Mar%C3%ADa&fijo=a%20b');
    });

    it('una variable al principio es la dirección entera y va tal cual', () => {
        expect(mergeUrl('{{url}}', tagMerge)).toBe('https://sitio.test/a?b=1&c=2');
        expect(mergeUrl('  {{url}}&d={{n}}', tagMerge)).toBe('  https://sitio.test/a?b=1&c=2&d=x%26role%3Dadmin%23');
    });

    it('en el servidor: no puede terminar el host', () => {
        const out = mergeUrl('https://{{sub}}.vendor.test/h', tagMerge);
        // La barra del valor va codificada: no hay forma de leer `evil.test`
        // como servidor (la URL queda inválida y la petición no sale).
        expect(out).toBe('https://evil.test%2F.vendor.test/h');
        let host: string | null = null;
        try {
            host = new URL(out).hostname;
        } catch {
            host = null;
        }
        expect(host).not.toBe('evil.test');
    });

    it('en la ruta: conserva las barras, no deja subir de carpeta y respeta lo ya codificado', () => {
        expect(mergeUrl('https://api.vendor.test/v1/{{ruta}}/notas', tagMerge)).toBe('https://api.vendor.test/v1/clientes/42/notas');
        expect(mergeUrl('https://api.vendor.test/v1/{{sube}}', tagMerge)).toBe('https://api.vendor.test/v1/..%2F..%2Fadmin');
        expect(mergeUrl('https://api.vendor.test/v1/{{ya}}/{{n}}', tagMerge)).toBe('https://api.vendor.test/v1/a%20b/x%26role%3Dadmin%23');
        expect(mergeUrl('/send/{{record.id}}', tagMerge)).toBe('/send/7');
    });

    it('sin variables la URL queda igual, y una función identidad (acciones ya compiladas) no se toca', () => {
        expect(mergeUrl('https://api.vendor.test/a b?x=ñ', tagMerge)).toBe('https://api.vendor.test/a b?x=ñ');
        expect(mergeUrl('https://api.vendor.test/{{n}}', (raw) => String(raw ?? ''))).toBe('https://api.vendor.test/{{n}}');
    });
});
