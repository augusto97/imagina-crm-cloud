import { integrationDef, integrationScopes, type ConnectorAction } from '@imagina-base/shared';
import { describe, expect, it } from 'vitest';
import {
    buildIntegrationRequest,
    buildRfc2822,
    checkIntegrationResponse,
    compileIntegrationValues,
    emailList,
    eventWindow,
    identityLabel,
    parseVerify,
    sheetCell,
    spreadsheetId,
    TEST_MESSAGE,
    testSendRequest,
    verifyRequest,
    type IntegrationCreds,
} from '../src/connectors/integration-calls';

/**
 * v0.1.203 — las peticiones de las apps de la galería. Son puras: acá se
 * verifica la FORMA exacta que espera cada API, sin salir a la red.
 */
const creds = (over: Partial<IntegrationCreds> = {}): IntegrationCreds => ({
    secret: '',
    accessToken: 'ya29.token-de-prueba',
    fields: {},
    ...over,
});
const vals = (values: Record<string, string>, lines: Record<string, string[]> = {}) => ({ values, lines });
const actionOf = (key: string, action: string): ConnectorAction =>
    integrationDef(key)!.actions.find((a) => a.key === action)!;

describe('catálogo', () => {
    it('los scopes suman identidad + los de la app, con el separador del proveedor', () => {
        expect(integrationScopes(integrationDef('gmail')!)).toBe(
            'openid email https://www.googleapis.com/auth/gmail.send',
        );
        expect(integrationScopes(integrationDef('outlook')!)).toBe(
            'openid email offline_access User.Read Mail.Send Calendars.ReadWrite',
        );
        // Slack separa con comas.
        expect(integrationScopes(integrationDef('slack')!)).toBe('chat:write,chat:write.public');
    });

    it('toda acción del catálogo tiene al menos un dato y arma su petición', () => {
        for (const key of ['whatsapp', 'telegram', 'slack', 'gmail', 'google_calendar', 'google_sheets', 'outlook']) {
            const def = integrationDef(key)!;
            expect(def.actions.length).toBeGreaterThan(0);
            for (const a of def.actions) expect(a.params.length).toBeGreaterThan(0);
        }
    });
});

describe('compileIntegrationValues', () => {
    it('aplica defaults, marca obligatorios vacíos y mergea de a renglón', () => {
        const merge = (raw: unknown): string =>
            String(raw ?? '').replace(/\{\{(\w+)\}\}/g, (_m, k: string) =>
                ({ nombre: 'Ana', nota: 'línea 1\nlínea 2' })[k] ?? '',
            );
        const sheet = compileIntegrationValues(
            'google_sheets',
            actionOf('google_sheets', 'append_row'),
            { spreadsheet: 'x', values: '{{nombre}}\n\n{{nota}}\n\n' },
            merge,
        );
        // El renglón vacío del medio es una columna vacía; los del final, no.
        // Y un valor con saltos de línea NO se parte en dos celdas.
        expect(sheet.lines.values).toEqual(['Ana', '', 'línea 1\nlínea 2']);
        expect(sheet.missing).toEqual([]);

        const tg = compileIntegrationValues('telegram', actionOf('telegram', 'send_message'), {}, merge);
        expect(tg.missing).toEqual(['Chat, grupo o canal', 'Mensaje']);
        expect(tg.values.silent).toBe('false');
    });
});

describe('WhatsApp (WAS)', () => {
    it('manda el formulario que espera el gateway, con la clave y la cuenta de la conexión', () => {
        const req = buildIntegrationRequest(
            'whatsapp',
            'send_text',
            vals({ recipient: '+57 (300) 111-2233', message: 'Hola Ana' }),
            creds({ secret: 'sk_abc123', fields: { account: 'acc-9' } }),
        );
        expect(req.url).toBe('https://was.imagina.cloud/api/send/whatsapp');
        expect(req.headers['content-type']).toBe('application/x-www-form-urlencoded');
        // Los MISMOS campos que la petición que ya funciona en producción
        // (webhook a mano contra WAS): sin `type`, WAS asume texto.
        expect(req.body).toBe('secret=sk_abc123&account=acc-9&recipient=%2B573001112233&message=Hola%20Ana');
    });

    it('un servidor propio reemplaza al por defecto; un documento viaja como document', () => {
        const req = buildIntegrationRequest(
            'whatsapp',
            'send_media',
            vals({ recipient: '+1', url: 'https://x.test/f/Factura%2012.pdf?t=1', kind: 'document', caption: '' }),
            creds({ secret: 's', fields: { account: 'a', server: 'https://wa.miempresa.com/' } }),
        );
        expect(req.url).toBe('https://wa.miempresa.com/api/send/whatsapp');
        const body = new URLSearchParams(req.body!);
        expect(body.get('type')).toBe('document');
        expect(body.get('document_name')).toBe('Factura 12.pdf');
        expect(body.has('message')).toBe(false);
        expect(() =>
            buildIntegrationRequest('whatsapp', 'send_media', vals({ url: 'ftp://x' }), creds()),
        ).toThrow(/https/);
    });

    it('un 200 con status de error adentro es un FALLO', () => {
        expect(checkIntegrationResponse('whatsapp', 200, '{"status":200,"message":"Queued"}')).toBeNull();
        expect(checkIntegrationResponse('whatsapp', 200, '{"status":400,"message":"Invalid Parameters!"}')).toMatch(
            /Invalid Parameters/,
        );
    });

    it('verificar lista las cuentas y reconoce la elegida; un formato desconocido NO bloquea', () => {
        const c = creds({ secret: 's', fields: { account: 'u2' } });
        expect(verifyRequest('whatsapp', c)!.url).toBe(
            'https://was.imagina.cloud/api/get/wa.accounts?secret=s&limit=50&page=1',
        );
        const ok = parseVerify(
            'whatsapp',
            200,
            JSON.stringify({ status: 200, data: [{ unique: 'u1', phone: '+5730011', status: 'connected' }, { unique: 'u2', phone: '+5730022' }] }),
            c,
        );
        expect(ok.options.account).toEqual([
            { value: 'u1', label: '+5730011 · connected' },
            { value: 'u2', label: '+5730022' },
        ]);
        expect(ok.label).toBe('+5730022');
        const unknown = parseVerify('whatsapp', 404, '<html>', c);
        expect(unknown.ok).toBe(true);
        expect(unknown.warning).toMatch(/a mano/);
    });

    it('el listado es una AYUDA: una clave sin permiso de listar NO se rechaza (v0.1.204)', () => {
        // Las claves de WAS/Zender tienen permisos por función: una clave de
        // envío recibe 403 al listar cuentas y manda perfecto.
        const c = creds({ secret: 's', fields: { account: 'u2' } });
        for (const [status, body] of [
            [403, '{"status":403,"message":"This API key has no permission for wa_accounts"}'],
            [200, '{"status":401,"message":"Invalid secret"}'],
            [401, ''],
        ] as const) {
            const out = parseVerify('whatsapp', status, body, c);
            expect(out.ok).toBe(true);
            expect(out.error).toBeNull();
            expect(out.warning).toMatch(/mensaje de prueba/);
        }
        // Lo que dijo WAS llega a la persona, textual.
        expect(parseVerify('whatsapp', 403, '{"status":403,"message":"Sin permiso"}', c).warning).toContain(
            '«Sin permiso»',
        );
    });

    it('el mensaje de prueba es un envío real con la misma función que el motor', () => {
        const req = testSendRequest('whatsapp', creds({ secret: 'k', fields: { account: 'acc-1' } }), ' +57 300 111 2233 ')!;
        expect(req.url).toBe('https://was.imagina.cloud/api/send/whatsapp');
        const body = new URLSearchParams(req.body!);
        expect(body.get('recipient')).toBe('+573001112233');
        expect(body.get('account')).toBe('acc-1');
        expect(body.get('message')).toBe(TEST_MESSAGE);
        const tg = testSendRequest('telegram', creds({ secret: '9:x' }), '@canal')!;
        expect(JSON.parse(tg.body!)).toMatchObject({ chat_id: '@canal', text: TEST_MESSAGE });
        expect(testSendRequest('slack', creds(), '#x')).toBeNull();
    });
});

describe('Telegram', () => {
    it('el token va en la ruta y el mensaje en JSON', () => {
        const req = buildIntegrationRequest(
            'telegram',
            'send_message',
            vals({ chat_id: ' @avisos ', text: 'Nuevo pedido', silent: 'true' }),
            creds({ secret: '123:ABC' }),
        );
        expect(req.url).toBe('https://api.telegram.org/bot123:ABC/sendMessage');
        expect(JSON.parse(req.body!)).toEqual({ chat_id: '@avisos', text: 'Nuevo pedido', disable_notification: true });
    });

    it('lee el error de adentro y el bot del getMe', () => {
        expect(
            checkIntegrationResponse('telegram', 400, '{"ok":false,"description":"Bad Request: chat not found"}'),
        ).toMatch(/No encontramos ese chat/);
        expect(parseVerify('telegram', 200, '{"ok":true,"result":{"username":"acme_bot"}}', creds()).label).toBe(
            '@acme_bot',
        );
        expect(parseVerify('telegram', 401, '{"ok":false}', creds()).ok).toBe(false);
        // Un intermediario que contesta en lugar de Telegram NO pasa en silencio.
        const proxy = parseVerify('telegram', 403, 'Host not in allowlist', creds());
        expect(proxy.ok).toBe(true);
        expect(proxy.warning).toMatch(/No pudimos comprobar/);
    });
});

describe('Slack', () => {
    it('postea con el token del bot y detecta el ok:false de un 200', () => {
        const req = buildIntegrationRequest('slack', 'send_message', vals({ channel: '#ventas', text: 'Hola' }), creds());
        expect(req.url).toBe('https://slack.com/api/chat.postMessage');
        expect(req.headers.authorization).toBe('Bearer ya29.token-de-prueba');
        expect(JSON.parse(req.body!)).toEqual({ channel: '#ventas', text: 'Hola' });
        expect(checkIntegrationResponse('slack', 200, '{"ok":true}')).toBeNull();
        expect(checkIntegrationResponse('slack', 200, '{"ok":false,"error":"not_in_channel"}')).toMatch(/invitala/);
        expect(identityLabel('slack', '{"ok":true,"team":"Acme"}')).toBe('Acme');
    });
});

describe('Gmail', () => {
    it('arma un RFC 2822 válido, codifica el asunto y no deja inyectar cabeceras', () => {
        const mime = buildRfc2822({
            to: ['a@b.co'],
            cc: [],
            bcc: ['x@y.co'],
            subject: 'Factura\r\nBcc: robo@malo.test ñ',
            body: 'Hola',
            html: false,
        });
        const [head] = mime.split('\r\n\r\n');
        expect(head).toContain('To: a@b.co');
        expect(head).toContain('Bcc: x@y.co');
        // El salto de línea del asunto NO abre una cabecera nueva.
        expect(head).not.toMatch(/\r\nBcc: robo/);
        expect(head).toMatch(/Subject: =\?UTF-8\?B\?/);

        const req = buildIntegrationRequest(
            'gmail',
            'send_email',
            vals({ to: 'Ana@Acme.co, no-es-correo', subject: 'Hola', body: '<b>x</b>', html: 'true' }),
            creds(),
        );
        const raw = Buffer.from(JSON.parse(req.body!).raw as string, 'base64url').toString('utf8');
        expect(raw).toContain('To: ana@acme.co\r\n');
        expect(raw).toContain('Content-Type: text/html');
        expect(() => buildIntegrationRequest('gmail', 'send_email', vals({ to: 'nadie' }), creds())).toThrow(
            /no es un correo válido/,
        );
    });

    it('capa los destinatarios (SEC-08)', () => {
        const many = Array.from({ length: 40 }, (_, i) => `u${i}@x.co`).join(',');
        expect(emailList(many)).toHaveLength(25);
    });
});

describe('Calendario', () => {
    it('fecha sola = todo el día; con hora escrita = local; con hora del campo = UTC', () => {
        expect(eventWindow('2026-07-30', '', '')).toEqual({
            allDay: true,
            startDate: '2026-07-30',
            endDate: '2026-07-31',
        });
        expect(eventWindow('31/12/2026', '', '')).toMatchObject({ startDate: '2026-12-31', endDate: '2027-01-01' });
        expect(eventWindow('2026-07-30', '9:30', '90')).toEqual({
            allDay: false,
            utc: false,
            start: '2026-07-30T09:30:00',
            end: '2026-07-30T11:00:00',
        });
        expect(eventWindow('2026-07-30 23:30:00', '', '60')).toEqual({
            allDay: false,
            utc: true,
            start: '2026-07-30T23:30:00',
            end: '2026-07-31T00:30:00',
        });
        expect(() => eventWindow('2026-02-30', '', '')).toThrow(/no existe/);
        expect(() => eventWindow('mañana', '', '')).toThrow(/AAAA-MM-DD/);
        expect(() => eventWindow('2026-07-30', '25:00', '')).toThrow(/hora/);
    });

    it('Google: zona elegida en hora local, invitados con aviso', () => {
        const req = buildIntegrationRequest(
            'google_calendar',
            'create_event',
            vals({
                title: 'Visita',
                date: '2026-07-30',
                time: '09:00',
                duration: '30',
                timezone: 'America/Bogota',
                attendees: 'ana@acme.co',
            }),
            creds(),
        );
        expect(req.url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all');
        const body = JSON.parse(req.body!);
        expect(body.start).toEqual({ dateTime: '2026-07-30T09:00:00', timeZone: 'America/Bogota' });
        expect(body.end).toEqual({ dateTime: '2026-07-30T09:30:00', timeZone: 'America/Bogota' });
        expect(body.attendees).toEqual([{ email: 'ana@acme.co' }]);
    });

    it('Outlook: todo el día con isAllDay', () => {
        const req = buildIntegrationRequest(
            'outlook',
            'create_event',
            vals({ title: 'Vence', date: '2026-07-30', timezone: 'America/Bogota' }),
            creds(),
        );
        const body = JSON.parse(req.body!);
        expect(body.isAllDay).toBe(true);
        expect(body.start).toEqual({ dateTime: '2026-07-30T00:00:00', timeZone: 'America/Bogota' });
        expect(body.end.dateTime).toBe('2026-07-31T00:00:00');
    });
});

describe('Google Sheets', () => {
    it('toma el ID del enlace, la pestaña y protege las celdas de fórmulas', () => {
        expect(spreadsheetId('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit#gid=0')).toBe(
            '1AbCdEfGhIjKlMnOpQrStUvWx',
        );
        expect(() => spreadsheetId('mi planilla')).toThrow(/enlace completo/);
        expect(sheetCell('=IMPORTXML("http://malo")')).toBe(`'=IMPORTXML("http://malo")`);
        expect(sheetCell('+573001112233')).toBe(`'+573001112233`);
        expect(sheetCell('-15.5')).toBe('-15.5');
        expect(sheetCell('-texto')).toBe(`'-texto`);

        const req = buildIntegrationRequest(
            'google_sheets',
            'append_row',
            vals(
                { spreadsheet: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit', sheet: "Ventas '26" },
                { values: ['Ana', '4200', '=1+1'] },
            ),
            creds(),
        );
        // La comilla del nombre de la pestaña se duplica (escape de Sheets).
        expect(req.url).toBe(
            'https://sheets.googleapis.com/v4/spreadsheets/1AbCdEfGhIjKlMnOpQrStUvWx/values/' +
                `${encodeURIComponent("'Ventas ''26'!A1")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        );
        expect(JSON.parse(req.body!)).toEqual({ values: [['Ana', '4200', "'=1+1"]] });
    });
});

describe('respuestas de Google / Microsoft', () => {
    it('401 pide reconectar; 4xx trae el mensaje del proveedor', () => {
        expect(checkIntegrationResponse('gmail', 401, '')).toMatch(/reconectá/);
        expect(
            checkIntegrationResponse('google_sheets', 404, '{"error":{"code":404,"message":"Requested entity was not found."}}'),
        ).toMatch(/Requested entity was not found/);
        expect(checkIntegrationResponse('outlook', 202, '')).toBeNull();
        expect(identityLabel('microsoft', '{"mail":null,"userPrincipalName":"ana@acme.onmicrosoft.com"}')).toBe(
            'ana@acme.onmicrosoft.com',
        );
        expect(identityLabel('google', '{"email":"ana@acme.co"}')).toBe('ana@acme.co');
    });
});
