import { zonedToday } from '@imagina-base/shared';
import { describe, expect, it } from 'vitest';
import { evaluateCondition } from '../src/automations/condition-evaluator';
import { coerceFieldValue } from '../src/automations/field-coercion';
import { applyMergeTags, regionalFormatterFor, singleTagToken } from '../src/automations/merge-tags';
import { buildWebhookRequest } from '../src/automations/webhook-request';
import { compileConnectorCall } from '../src/connectors/connector-actions';
import { errorText } from '../src/incidents/incident-hub';

/** Piezas puras de la auditoría de automatizaciones. */
describe('condiciones de automatización: misma semántica que el filtro de la tabla', () => {
    const rec: Record<string, unknown> = { tags: ['vip', 'promo'], activo: true, vence: '', cita: '' };
    const fv = (slug: string) => rec[slug];

    it('multi_select: «es» = incluye, «es alguno de» = alguno, «no es ninguno de»', () => {
        expect(evaluateCondition([{ field: 'tags', op: 'eq', value: 'vip' }], fv)).toBe(true);
        expect(evaluateCondition([{ field: 'tags', op: 'eq', value: 'otro' }], fv)).toBe(false);
        expect(evaluateCondition([{ field: 'tags', op: 'eq', value: ['promo', 'vip'] }], fv)).toBe(true); // mismo conjunto
        expect(evaluateCondition([{ field: 'tags', op: 'in', value: ['otro', 'promo'] }], fv)).toBe(true);
        expect(evaluateCondition([{ field: 'tags', op: 'nin', value: ['vip'] }], fv)).toBe(false);
        expect(evaluateCondition([{ field: 'tags', op: 'nin', value: ['otro'] }], fv)).toBe(true);
    });

    it('casilla: «1»/«sí» es marcada', () => {
        expect(evaluateCondition([{ field: 'activo', op: 'eq', value: '1' }], fv)).toBe(true);
        expect(evaluateCondition([{ field: 'activo', op: 'eq', value: 'no' }], fv)).toBe(false);
    });

    it('between_relative en la zona de la empresa (antes devolvía siempre falso)', () => {
        const tz = 'Pacific/Kiritimati';
        rec.vence = zonedToday(tz);
        expect(evaluateCondition([{ field: 'vence', op: 'between_relative', value: 'today' }], fv, { timeZone: tz })).toBe(true);
        expect(evaluateCondition([{ field: 'vence', op: 'between_relative', value: 'today' }], fv, { timeZone: 'Pacific/Pago_Pago' })).toBe(false);
        expect(evaluateCondition([{ field: 'vence', op: 'between_relative', value: 'this_month' }], fv, { timeZone: tz })).toBe(true);
        rec.cita = new Date().toISOString();
        expect(evaluateCondition([{ field: 'cita', op: 'between_relative', value: 'last_7_days' }], fv, { timeZone: 'America/Bogota' })).toBe(true);
        expect(evaluateCondition([{ field: 'cita', op: 'between_relative', value: { from: '2001-01-01', to: '2001-12-31' } }], fv)).toBe(false);
        expect(evaluateCondition([{ field: 'cita', op: 'between_relative', value: 'no-existe' }], fv)).toBe(false);
    });
});

describe('coerceFieldValue: lo que una automatización escribe en un campo', () => {
    const opts = { timeZone: 'America/Bogota', format: { number_format: 'dot_comma' as const, date_format: 'dmy' as const } };
    const sel = { type: 'multi_select', config: { options: [{ value: 'vip', label: 'VIP' }, { value: 'promo', label: 'Promo' }] } };

    it('números: tipeados en el formato de la empresa o de una variable', () => {
        expect(coerceFieldValue({ type: 'currency', config: {} }, '1.250.000', opts)).toEqual({ ok: true, value: 1250000 });
        expect(coerceFieldValue({ type: 'currency', config: {} }, '1250000.5', { ...opts, fromVariable: true })).toEqual({ ok: true, value: 1250000.5 });
        expect(coerceFieldValue({ type: 'number', config: {} }, '99,5', opts)).toEqual({ ok: true, value: 99.5 });
        expect(coerceFieldValue({ type: 'number', config: {} }, 'mucho', opts).ok).toBe(false);
    });

    it('opciones por value o etiqueta; una lista desde un texto con comas', () => {
        expect(coerceFieldValue(sel, 'vip, Promo', opts)).toEqual({ ok: true, value: ['vip', 'promo'] });
        expect(coerceFieldValue(sel, ['VIP'], opts)).toEqual({ ok: true, value: ['vip'] });
        expect(coerceFieldValue({ ...sel, type: 'select' }, 'Promo', opts)).toEqual({ ok: true, value: 'promo' });
        expect(coerceFieldValue({ ...sel, type: 'select' }, 'otra', opts).ok).toBe(false);
    });

    it('casilla: «0» y «no» son falso (antes «0» quedaba como texto, verdadero en JS)', () => {
        expect(coerceFieldValue({ type: 'checkbox', config: {} }, '0', opts)).toEqual({ ok: true, value: false });
        expect(coerceFieldValue({ type: 'checkbox', config: {} }, 'Sí', opts)).toEqual({ ok: true, value: true });
        expect(coerceFieldValue({ type: 'checkbox', config: {} }, 'quizás', opts).ok).toBe(false);
    });

    it('fechas: AAAA-MM-DD, DD/MM/AAAA de la empresa, instante con zona; «mañana» se rechaza', () => {
        expect(coerceFieldValue({ type: 'date', config: {} }, '31/10/2026', opts)).toEqual({ ok: true, value: '2026-10-31' });
        expect(coerceFieldValue({ type: 'date', config: {} }, '2026-10-22T03:00:00.000Z', opts)).toEqual({ ok: true, value: '2026-10-21' });
        expect(coerceFieldValue({ type: 'date', config: {} }, 'mañana', opts).ok).toBe(false);
        expect(coerceFieldValue({ type: 'date', config: {} }, '2026-02-30', opts).ok).toBe(false);
        expect(coerceFieldValue({ type: 'datetime', config: {} }, '2026-10-21 14:30', opts)).toEqual({ ok: true, value: '2026-10-21T19:30:00.000Z' });
        expect(coerceFieldValue({ type: 'datetime', config: {} }, '2026-10-21T14:30:00-05:00', opts)).toEqual({ ok: true, value: '2026-10-21T19:30:00.000Z' });
    });
});

describe('variables: formato regional y valor crudo', () => {
    const fields = new Map([
        ['monto', { type: 'currency', config: { currency: 'USD', precision: 2 } }],
        ['vence', { type: 'date', config: {} }],
    ]);
    const fmt = regionalFormatterFor(fields, { number_format: 'dot_comma', date_format: 'dmy', time_format: 'h12' }, 'America/Bogota');
    const values: Record<string, unknown> = { monto: 1234.5, vence: '2026-10-31', 'date.now': '2026-10-21 19:30:00' };
    const merge = (t: string) => applyMergeTags(t, (s) => values[s], 7, undefined, undefined, fmt);

    it('|moneda, |numero, |fecha, |fechahora; sin modificador, el crudo', () => {
        expect(merge('{{monto|moneda}}')).toBe('USD 1.234,50');
        expect(merge('{{monto|numero}}')).toBe('1.234,50'); // con los decimales del campo
        expect(merge('{{vence|fecha}}')).toBe('31/10/2026');
        expect(merge('{{vence|+1m|fecha}}')).toBe('30/11/2026');
        expect(merge('{{date.now|fechahora}}')).toBe('21/10/2026 2:30 p. m.');
        expect(merge('{{monto}}')).toBe('1234.5');
    });

    it('una variable sola se reconoce (pasa cruda al escribir un campo)', () => {
        expect(singleTagToken(' {{tags}} ')).toBe('tags');
        expect(singleTagToken('{{tags|label}}')).toBeNull();
        expect(singleTagToken('Hola {{nombre}}')).toBeNull();
    });
});

describe('cuerpos crudos: los valores se escapan según el formato', () => {
    const evil = 'x","admin":true,"y":"</a><script>';
    const merge = (raw: unknown, esc?: (s: string) => string) => String(raw ?? '').replace('{{nombre}}', esc ? esc(evil) : evil);

    it('JSON: string escapado (no se inyectan claves); XML: entidades', () => {
        const json = buildWebhookRequest({ url: 'https://x.test', content_type: 'json', body_template: '{"nombre":"{{nombre}}"}' }, merge, { recordId: 1, listId: 1 });
        expect(JSON.parse(json.body!)).toEqual({ nombre: evil });
        const xml = buildWebhookRequest({ url: 'https://x.test', content_type: 'xml', body_template: '<n>{{nombre}}</n>' }, merge, { recordId: 1, listId: 1 });
        expect(xml.body).toBe('<n>x&quot;,&quot;admin&quot;:true,&quot;y&quot;:&quot;&lt;/a&gt;&lt;script&gt;</n>');
        // Texto plano: tal cual.
        const text = buildWebhookRequest({ url: 'https://x.test', content_type: 'text', body_template: '{{nombre}}' }, merge, { recordId: 1, listId: 1 });
        expect(text.body).toBe(evil);
    });

    it('acción de conector con cuerpo JSON: el `{clave}` también se escapa', () => {
        const call = compileConnectorCall(
            {
                key: 'send',
                label: 'Enviar',
                method: 'POST',
                path: '/send',
                content_type: 'json',
                body_template: '{"msg":"{mensaje}"}',
                params: [{ key: 'mensaje', label: 'Mensaje', location: 'body', required: false, type: 'text', default: '' }],
            } as never,
            { mensaje: evil },
            (raw) => String(raw ?? ''),
        );
        expect(JSON.parse(String(call.cfg.body_template))).toEqual({ msg: evil });
    });
});

describe('errores de Postgres en español', () => {
    it('fecha inválida, duplicado, conexión', () => {
        const err = Object.assign(new Error('invalid input syntax for type date: "mañana"'), { code: '22007' });
        expect(errorText(err)).toBe('Hay una fecha guardada que no es válida (valor: «mañana»). Corrígela en el registro o en la acción que la escribe.');
        expect(errorText(Object.assign(new Error('duplicate key'), { code: '23505' }))).toMatch(/único/);
        expect(errorText(Object.assign(new Error('x'), { code: '08006' }))).toMatch(/conexión/);
        expect(errorText(Object.assign(new Error('boom'), { code: 'P0001' }))).toBe('boom');
    });
});
