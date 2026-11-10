import { describe, expect, it } from 'vitest';
import {
    carryConnectorValues,
    convertWasApiCall,
    guessMediaKind,
    readWasApiCall,
    swapAppsCompatible,
    swapConnectionInActions,
    wasApiSourceKey,
} from './connection-swap';

/** La llamada real que arman las automatizaciones viejas (v0.1.204). */
const DIRECT = {
    url: 'https://was.imagina.cloud/api/send/whatsapp',
    method: 'POST',
    content_type: 'form',
    connection_id: 1,
    body_params: [
        { key: 'account', value: 'abc123' },
        { key: 'recipient', value: '{{celular}}' },
        { key: 'message', value: 'Hola {{cliente}}' },
    ],
};

describe('swapAppsCompatible', () => {
    it('misma app o el par WAS ↔ Whats; nunca con la oficial de Meta', () => {
        expect(swapAppsCompatible('gmail', 'gmail')).toBe(true);
        expect(swapAppsCompatible('whatsapp', 'whatsapp_web')).toBe(true);
        expect(swapAppsCompatible('whatsapp_web', 'whatsapp')).toBe(true);
        expect(swapAppsCompatible('whatsapp', 'whatsapp_cloud')).toBe(false);
        expect(swapAppsCompatible('gmail', 'outlook')).toBe(false);
        expect(swapAppsCompatible(null, 'gmail')).toBe(false);
        expect(swapAppsCompatible('http', 'http')).toBe(false);
    });
});

describe('carryConnectorValues', () => {
    it('WAS → Whats: conserva número y mensaje; el tipo de archivo se quita con su nota', () => {
        const text = carryConnectorValues('whatsapp', 'whatsapp_web', 'send_text', { recipient: '{{celular}}', message: 'Hola' });
        expect(text).toEqual({ ok: true, action_key: 'send_text', values: { recipient: '{{celular}}', message: 'Hola' }, notes: [] });
        const media = carryConnectorValues('whatsapp', 'whatsapp_web', 'send_media', { recipient: '+57300', url: 'https://x/a.pdf', kind: 'document', caption: 'Tu factura' });
        expect(media.ok && media.values).toEqual({ recipient: '+57300', url: 'https://x/a.pdf', caption: 'Tu factura' });
        expect(media.ok && media.notes[0]).toMatch(/Whats lo reconoce/);
    });

    it('Whats → WAS: el tipo de archivo se deduce del enlace y se avisa', () => {
        const out = carryConnectorValues('whatsapp_web', 'whatsapp', 'send_media', { recipient: '+57300', url: '{{pdf.link}}' });
        expect(out.ok && out.values.kind).toBe('document');
        expect(out.ok && out.notes[0]).toMatch(/Documento PDF/);
    });

    it('sin un dato obligatorio no se pasa (quedaría una acción que falla siempre)', () => {
        expect(carryConnectorValues('whatsapp', 'whatsapp_web', 'send_text', { recipient: '+57300' })).toEqual({ ok: false, reason: 'Le falta «Mensaje».' });
        expect(carryConnectorValues('whatsapp', 'whatsapp_web', 'no_existe', {})).toMatchObject({ ok: false });
    });
});

describe('llamadas directas a la API de WAS', () => {
    it('reconoce la llamada (también relativa a la conexión) y la agrupa por servidor y cuenta', () => {
        const call = readWasApiCall(DIRECT);
        expect(call).toMatchObject({ host: 'was.imagina.cloud', account: 'abc123', unreadable: false });
        expect(wasApiSourceKey(call!)).toBe('was:was.imagina.cloud|abc123');
        expect(readWasApiCall({ ...DIRECT, url: '/api/send/whatsapp/' }, 'https://was.imagina.cloud')).toMatchObject({ host: 'was.imagina.cloud' });
        expect(readWasApiCall({ ...DIRECT, url: 'https://api.example.com/hook' })).toBeNull();
        expect(readWasApiCall({ ...DIRECT, url: '/api/send/whatsapp' })).toBeNull();
    });

    it('texto: número y mensaje; la cuenta y la clave salen de la conexión elegida', () => {
        const out = convertWasApiCall(readWasApiCall(DIRECT)!, DIRECT, 'whatsapp_web');
        expect(out).toEqual({
            ok: true,
            action_key: 'send_text',
            values: { recipient: '{{celular}}', message: 'Hola {{cliente}}' },
            notes: ['Sale del número de la conexión elegida: la cuenta escrita en la llamada ya no se usa.'],
        });
    });

    it('archivo y documento; cuerpo escrito a mano (urlencoded o JSON plano)', () => {
        const media = {
            ...DIRECT,
            body_params: [
                { key: 'recipient', value: '+57300' },
                { key: 'type', value: 'media' },
                { key: 'media_url', value: 'https://x/v.mp4' },
                { key: 'media_type', value: 'video' },
                { key: 'message', value: 'Mira' },
                { key: 'priority', value: '1' },
            ],
        };
        const toWhats = convertWasApiCall(readWasApiCall(media)!, media, 'whatsapp_web');
        expect(toWhats).toMatchObject({ ok: true, action_key: 'send_media', values: { recipient: '+57300', url: 'https://x/v.mp4', caption: 'Mira' } });
        expect(toWhats.ok && toWhats.notes.join(' ')).toMatch(/«priority»/);
        expect(convertWasApiCall(readWasApiCall(media)!, media, 'whatsapp')).toMatchObject({ ok: true, values: { kind: 'video' } });

        const doc = { url: DIRECT.url, body_template: 'recipient=%2B57300&type=document&document_url=https%3A%2F%2Fx%2Ff.pdf' };
        expect(convertWasApiCall(readWasApiCall(doc)!, doc, 'whatsapp')).toMatchObject({ ok: true, values: { url: 'https://x/f.pdf', kind: 'document' } });
        const json = { url: DIRECT.url, body_template: '{"recipient":"{{celular}}","message":"Hola"}' };
        expect(convertWasApiCall(readWasApiCall(json)!, json, 'whatsapp_web')).toMatchObject({ ok: true, values: { message: 'Hola' } });
    });

    it('no se pasa sola: sin número, sin mensaje, cuerpo ilegible o su respuesta usada después', () => {
        const noTo = { ...DIRECT, body_params: [{ key: 'message', value: 'x' }] };
        expect(convertWasApiCall(readWasApiCall(noTo)!, noTo, 'whatsapp_web')).toMatchObject({ ok: false, reason: /número de destino/ });
        const raw = { url: DIRECT.url, body_template: 'hola {{x}}' };
        expect(convertWasApiCall(readWasApiCall(raw)!, raw, 'whatsapp_web')).toMatchObject({ ok: false, reason: /escrito a mano/ });
        const named = { ...DIRECT, response_name: 'envio' };
        expect(convertWasApiCall(readWasApiCall(named)!, named, 'whatsapp_web')).toMatchObject({ ok: false, reason: /respuestas\.envio/ });
        expect(convertWasApiCall(readWasApiCall(DIRECT)!, DIRECT, 'gmail')).toMatchObject({ ok: false });
    });
});

describe('swapConnectionInActions', () => {
    const conns = new Map([
        [1, { app: null, baseUrl: 'https://was.imagina.cloud' }],
        [2, { app: 'whatsapp', baseUrl: null }],
        [9, { app: 'whatsapp_web', baseUrl: null }],
        [5, { app: 'gmail', baseUrl: null }],
    ]);
    const target = { id: 9, app: 'whatsapp_web' };
    const flow = [
        { type: 'connector_action', config: { connection_id: 2, action_key: 'send_text', values: { recipient: '{{celular}}', message: 'A' } }, condition: [{ slug: 'estado', op: 'eq', value: 'x' }] },
        {
            type: 'if_else',
            config: {
                condition: [],
                then_actions: [{ type: 'call_webhook', config: DIRECT }],
                else_actions: [{ type: 'connector_action', config: { connection_id: 5, action_key: 'send_email', values: {} } }],
            },
        },
        { type: 'for_each_linked', config: { relation_field_id: 3, actions: [{ type: 'connector_action', config: { connection_id: 2, action_key: 'send_text', values: { recipient: '{{item.tel}}', message: 'B' } } }] } },
        { type: 'connector_action', config: { connection_id: 9, action_key: 'send_text', values: { recipient: 'x', message: 'y' } } },
    ];

    it('encuentra lo que se puede pasar, en las ramas y en «Repetir por cada vinculado», sin tocar nada', () => {
        const { actions, findings } = swapConnectionInActions(flow, target, conns);
        expect(findings.map((f) => [f.path, f.source, f.ok])).toEqual([
            ['0', 'conn:2', true],
            ['1.then.0', 'was:was.imagina.cloud|abc123', true],
            ['2.each.0', 'conn:2', true],
        ]);
        expect(actions).toEqual(flow);
    });

    it('aplica sólo los orígenes elegidos y conserva la condición de cada acción', () => {
        const { actions } = swapConnectionInActions(flow, target, conns, new Set(['was:was.imagina.cloud|abc123']));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- se navega el árbol de acciones en las aserciones
        const out = actions as Array<Record<string, any>>;
        expect(out[0]).toEqual(flow[0]);
        expect(out[1]!.config.then_actions[0]).toEqual({
            type: 'connector_action',
            config: { connection_id: 9, action_key: 'send_text', values: { recipient: '{{celular}}', message: 'Hola {{cliente}}' } },
        });
        expect(out[1]!.config.else_actions).toEqual(flow[1]!.config.else_actions);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ídem
        const all = swapConnectionInActions(flow, target, conns, new Set(['conn:2', 'was:was.imagina.cloud|abc123'])).actions as Array<Record<string, any>>;
        expect(all[0]).toEqual({ ...flow[0], config: { connection_id: 9, action_key: 'send_text', values: { recipient: '{{celular}}', message: 'A' } } });
        expect(all[0]!.condition).toEqual(flow[0]!.condition);
        expect(all[2]!.config.actions[0].config.connection_id).toBe(9);
        expect(all[2]!.config.relation_field_id).toBe(3);
    });

    it('adivina el tipo de archivo por el enlace', () => {
        expect(guessMediaKind('https://x/a.PDF?v=1')).toBe('document');
        expect(guessMediaKind('{{pdf.link}}')).toBe('document');
        expect(guessMediaKind('https://x/a.mp3')).toBe('audio');
        expect(guessMediaKind('https://x/a.mp4')).toBe('video');
        expect(guessMediaKind('https://x/a.png')).toBe('image');
    });
});
