import { describe, expect, it } from 'vitest';
import { buildWebhookRequest } from '../src/automations/webhook-request';
import {
    connectionParts,
    joinUrl,
    maskHeaders,
    maskSecret,
    redactValues,
    secretHint,
} from '../src/connectors/connection-parts';
import {
    credentialFingerprint,
    detectInlineCredential,
    hostOf,
    originOf,
    rewriteActionConfig,
    walkActions,
} from '../src/connectors/inline-scan';

/**
 * v0.1.196 — piezas PURAS de los conectores. Son las que garantizan que el
 * motor, el probador de la acción y el botón "Probar conexión" armen
 * exactamente la misma petición: si divergen, volvemos al problema que el
 * conector viene a resolver.
 */

const NO_MERGE = (raw: unknown): string => (typeof raw === 'string' ? raw : String(raw ?? ''));

function partsFor(over: Partial<Parameters<typeof connectionParts>[0]>, secrets = { token: 'abcd1234efgh' }) {
    return connectionParts(
        { baseUrl: 'https://was.example.com', authType: 'none', authKey: '', headers: [], queryParams: [], ...over },
        secrets,
    );
}

describe('connectionParts — inyección de la credencial', () => {
    it('bearer, cabecera propia, basic, query y cuerpo', () => {
        expect(partsFor({ authType: 'bearer' }).headers['authorization']).toBe('Bearer abcd1234efgh');
        expect(partsFor({ authType: 'header', authKey: 'X-Api-Key' }).headers['x-api-key']).toBe('abcd1234efgh');
        const basic = partsFor({ authType: 'basic' }, { username: 'ana', password: 's3creto' } as never);
        expect(basic.headers['authorization']).toBe('Basic ' + Buffer.from('ana:s3creto').toString('base64'));
        expect(partsFor({ authType: 'query', authKey: 'api_key' }).query).toEqual([
            { key: 'api_key', value: 'abcd1234efgh' },
        ]);
        expect(partsFor({ authType: 'body', authKey: 'secret' }).body).toEqual([
            { key: 'secret', value: 'abcd1234efgh' },
        ]);
    });

    it('sin nombre de cabecera no inventa una: se omite en vez de romper la petición', () => {
        expect(partsFor({ authType: 'header', authKey: '' }).headers).toEqual({});
    });

    it('expone los valores a tapar para que una prueba no vuelva a filtrarlos', () => {
        const parts = partsFor({ authType: 'bearer' });
        expect(parts.redact).toContain('abcd1234efgh');
        expect(redactValues('token=abcd1234efgh&x=1', parts.redact)).toBe('token=••••efgh&x=1');
    });
});

describe('joinUrl', () => {
    it('une base y path sin duplicar barras', () => {
        expect(joinUrl('https://a.com/api/', '/send')).toBe('https://a.com/api/send');
        expect(joinUrl('https://a.com', 'send')).toBe('https://a.com/send');
        expect(joinUrl('https://a.com', '')).toBe('https://a.com');
    });

    it('una URL absoluta gana: la conexión aporta credenciales, no destino', () => {
        expect(joinUrl('https://a.com', 'https://otro.com/x')).toBe('https://otro.com/x');
    });
});

describe('enmascarado', () => {
    it('deja ver el esquema y los últimos cuatro, nada más', () => {
        expect(maskSecret('Bearer abcd1234efgh')).toBe('Bearer ••••efgh');
        expect(maskSecret('corto')).toBe('••••orto');
        expect(maskHeaders({ authorization: 'Bearer abcd1234efgh', 'x-otro': 'visible' })).toEqual({
            authorization: 'Bearer ••••efgh',
            'x-otro': 'visible',
        });
        expect(secretHint('abcd1234efgh')).toBe('••••efgh');
        expect(secretHint('')).toBeNull();
    });
});

describe('buildWebhookRequest con conexión', () => {
    it('usa la base para un path relativo y suma cabeceras y query de la conexión', () => {
        const parts = partsFor({ authType: 'bearer', queryParams: [{ key: 'v', value: '2' }] });
        const req = buildWebhookRequest({ url: '/send', method: 'POST' }, NO_MERGE, { recordId: 1, listId: 2 }, parts);
        expect(req.url).toBe('https://was.example.com/send?v=2');
        expect(req.headers['authorization']).toBe('Bearer abcd1234efgh');
    });

    it('la cabecera de la acción pisa la de la conexión', () => {
        const parts = partsFor({ headers: [{ key: 'X-Modo', value: 'prod' }] });
        const req = buildWebhookRequest(
            { url: 'https://a.com/x', headers: [{ key: 'X-Modo', value: 'test' }] },
            NO_MERGE,
            { recordId: 1, listId: 2 },
            parts,
        );
        expect(req.headers['x-modo']).toBe('test');
    });

    it('auth de cuerpo: el campo entra con las filas clave/valor', () => {
        const parts = partsFor({ authType: 'body', authKey: 'secret' });
        const req = buildWebhookRequest(
            { url: 'https://a.com/x', content_type: 'form', body_params: [{ key: 'msg', value: 'hola' }] },
            NO_MERGE,
            { recordId: 1, listId: 2 },
            parts,
        );
        expect(req.body).toBe('secret=abcd1234efgh&msg=hola');
    });

    it('con un cuerpo escrito a mano NO se le reescribe el JSON al usuario', () => {
        const parts = partsFor({ authType: 'body', authKey: 'secret' });
        const req = buildWebhookRequest(
            { url: 'https://a.com/x', body_template: '{"a":1}' },
            NO_MERGE,
            { recordId: 1, listId: 2 },
            parts,
        );
        expect(req.body).toBe('{"a":1}');
    });

    it('el secreto de firma de la conexión manda sobre el escrito en la acción', () => {
        const withConn = buildWebhookRequest(
            { url: 'https://a.com/x', secret: 'viejo' },
            NO_MERGE,
            { recordId: 1, listId: 2 },
            partsFor({}, { signing_secret: 'nuevo' } as never),
        );
        const withoutConn = buildWebhookRequest({ url: 'https://a.com/x', secret: 'viejo' }, NO_MERGE, {
            recordId: 1,
            listId: 2,
        });
        expect(withConn.headers['x-imagina-signature']).toBeDefined();
        expect(withConn.headers['x-imagina-signature']).not.toBe(withoutConn.headers['x-imagina-signature']);
    });

    it('sin conexión se comporta exactamente como antes', () => {
        const req = buildWebhookRequest({ url: 'https://a.com/x', method: 'GET' }, NO_MERGE, {
            recordId: 1,
            listId: 2,
        });
        expect(req.url).toBe('https://a.com/x');
        expect(req.body).toBeUndefined();
    });
});

describe('detectInlineCredential — lo que hoy está escrito en las acciones', () => {
    it('reconoce Bearer, Basic, cabecera propia, query, cuerpo y el secreto de firma', () => {
        const bearer = detectInlineCredential({ headers: [{ key: 'Authorization', value: 'Bearer tok-123456' }] });
        expect(bearer?.authType).toBe('bearer');
        expect(bearer?.token).toBe('tok-123456');

        const basic = detectInlineCredential({
            headers: [{ key: 'Authorization', value: 'Basic ' + Buffer.from('ana:clave').toString('base64') }],
        });
        expect(basic?.authType).toBe('basic');
        expect(basic?.username).toBe('ana');
        expect(basic?.password).toBe('clave');

        expect(detectInlineCredential({ headers: { 'X-Api-Key': 'clave-larga-1' } })?.authType).toBe('header');
        expect(detectInlineCredential({ query_params: [{ key: 'access_token', value: 'abcdefgh' }] })?.authType).toBe(
            'query',
        );
        expect(detectInlineCredential({ body_params: [{ key: 'secret', value: 'abcdefgh' }] })?.authType).toBe('body');

        const signing = detectInlineCredential({ secret: 'firma-compartida' });
        expect(signing?.signingSecret).toBe('firma-compartida');
        expect(signing?.found).toEqual(['signing_secret']);
    });

    it('un valor con merge tags NO es una credencial: sale del registro', () => {
        expect(detectInlineCredential({ headers: [{ key: 'X-Api-Key', value: '{{token_del_cliente}}' }] })).toBeNull();
    });

    it('sin nada que mover devuelve null', () => {
        expect(detectInlineCredential({ url: 'https://a.com', headers: [{ key: 'Accept', value: 'application/json' }] })).toBeNull();
    });

    it('credenciales distintas en el mismo host tienen huellas distintas', () => {
        const a = detectInlineCredential({ headers: [{ key: 'Authorization', value: 'Bearer aaa11111' }] })!;
        const b = detectInlineCredential({ headers: [{ key: 'Authorization', value: 'Bearer bbb22222' }] })!;
        expect(credentialFingerprint(a)).not.toBe(credentialFingerprint(b));
    });
});

describe('rewriteActionConfig', () => {
    it('saca el secreto y la cabecera de auth, y deja la URL absoluta intacta', () => {
        const cfg = {
            url: 'https://was.example.com/send',
            secret: 'firma',
            headers: [
                { key: 'Authorization', value: 'Bearer tok-123456' },
                { key: 'Accept', value: 'application/json' },
            ],
        };
        const detected = detectInlineCredential(cfg)!;
        const next = rewriteActionConfig(cfg, 7, detected);
        expect(next.connection_id).toBe(7);
        expect(next.secret).toBeUndefined();
        expect(next.headers).toEqual([{ key: 'Accept', value: 'application/json' }]);
        // La URL NO se toca: reescribirla sería cambiarle el destino a una
        // automatización que hoy funciona.
        expect(next.url).toBe('https://was.example.com/send');
    });
});

describe('walkActions', () => {
    it('entra a las ramas then/else de if_else', () => {
        const actions = [
            { type: 'call_webhook', config: { url: 'https://a.com' } },
            {
                type: 'if_else',
                config: {
                    then_actions: [{ type: 'call_webhook', config: { url: 'https://b.com' } }],
                    else_actions: [
                        { type: 'if_else', config: { then_actions: [{ type: 'call_webhook', config: { url: 'https://c.com' } }] } },
                    ],
                },
            },
        ];
        const urls: string[] = [];
        walkActions(actions, (a) => {
            if (a.type === 'call_webhook') urls.push(String((a.config as Record<string, unknown>).url));
        });
        expect(urls).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
    });
});

describe('hostOf / originOf', () => {
    it('no agrupa lo que no se puede saber (URL con merge tags)', () => {
        expect(hostOf('https://{{host}}/x')).toBeNull();
        expect(hostOf('https://a.com/x')).toBe('a.com');
        expect(originOf('https://a.com/api/send')).toBe('https://a.com');
    });
});
