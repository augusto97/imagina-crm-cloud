import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src/ai/tools/structure-tools';
import { restoreRedactedSecrets } from '../src/automations/automation-secrets';

describe('redactSecrets (v0.1.193) — lo que lee el asistente/MCP no lleva credenciales', () => {
    it('enmascara claves que huelen a secreto a cualquier profundidad', () => {
        const actions = [
            {
                type: 'call_webhook',
                config: {
                    url: 'https://api.example.com/hook',
                    secret: 'hmac-super-secreto',
                    headers: [{ key: 'Authorization', value: 'Bearer abc' }, { key: 'X-Trace', value: '1' }],
                    body_rows: [{ key: 'message', value: 'Hola {{nombre}}' }],
                },
            },
            { type: 'send_email', config: { to: 'x@y.com', subject: 'Hi', password: 'p' } },
        ];
        const out = redactSecrets(actions) as Array<{ config: Record<string, unknown> }>;
        const hook = out[0]!.config as { secret: string; url: string; headers: Array<{ key: string; value: string }>; body_rows: Array<{ key: string; value: string }> };
        expect(hook.secret).toBe('[oculto]');
        expect(hook.url).toBe('https://api.example.com/hook');
        // El VALOR de una cabecera "Authorization" no se toca por la clave
        // `value` (no huele a secreto): lo que se enmascara son claves.
        expect(hook.headers[0]!.key).toBe('Authorization');
        expect(hook.body_rows[0]!.value).toBe('Hola {{nombre}}');
        expect(out[1]!.config.password).toBe('[oculto]');
        expect(out[1]!.config.to).toBe('x@y.com');
        // No muta el original.
        expect(actions[0]!.config.secret).toBe('hmac-super-secreto');
    });

    it('trigger_config: el token del webhook entrante se oculta, el resto viaja', () => {
        const cfg = { webhook_token: 'abc123', due_field: 'vence', offset_minutes: 28800, field_filters: [{ slug: 'estado', op: 'eq', value: 'pendiente' }] };
        const out = redactSecrets(cfg);
        expect(out.webhook_token).toBe('[oculto]');
        expect(out.due_field).toBe('vence');
        expect(out.field_filters).toEqual(cfg.field_filters);
    });

    it('valores vacíos y escalares pasan tal cual', () => {
        expect(redactSecrets({ secret: '', token: null })).toEqual({ secret: '', token: null });
        expect(redactSecrets('texto')).toBe('texto');
        expect(redactSecrets(42)).toBe(42);
    });

    it('filas clave/valor, URL y Bearer escrito a mano: el editor guarda las cabeceras como filas', () => {
        const cfg = {
            url: 'https://usuario:Cl4ve-Url@x.test/h?api_key=S3CRET-C&page=2&token={{token_campo}}',
            headers: [
                { key: 'Authorization', value: 'Bearer S3CRET-A' },
                { key: 'X-Api-Key', value: 'S3CRET-K' },
                { key: 'X-Trace', value: 'visible' },
            ],
            body_params: [
                { key: 'secret', value: 'S3CRET-B' },
                { key: 'message', value: 'Hola {{nombre}}' },
            ],
            query_params: [{ name: 'access_token', value: 'S3CRET-D' }],
            body_template: '{"auth":"Bearer abc123.def456.ghi789","texto":"Bearer de buenas noticias"}',
        };
        const out = redactSecrets(cfg);
        const json = JSON.stringify(out);
        for (const secret of ['S3CRET-A', 'S3CRET-B', 'S3CRET-C', 'S3CRET-D', 'S3CRET-K', 'Cl4ve-Url', 'abc123.def456.ghi789']) {
            expect(json).not.toContain(secret);
        }
        // Lo que no es secreto viaja: sirve para explicar y recrear la acción.
        expect(out.url).toBe('https://usuario:[oculto]@x.test/h?api_key=[oculto]&page=2&token={{token_campo}}');
        expect(out.headers[2]).toEqual({ key: 'X-Trace', value: 'visible' });
        expect(out.headers[0]).toEqual({ key: 'Authorization', value: '[oculto]' });
        expect(out.body_params[1]!.value).toBe('Hola {{nombre}}');
        expect(out.body_template).toContain('Bearer de buenas noticias');
        // No muta el original.
        expect(cfg.headers[0]!.value).toBe('Bearer S3CRET-A');
    });

    it('al guardar lo leído, lo tapado vuelve a su valor actual (también dentro de una URL)', () => {
        const current = {
            actions: [
                {
                    type: 'call_webhook',
                    config: {
                        url: 'https://x.test/h?api_key=S3CRET-C',
                        headers: [{ key: 'Authorization', value: 'Bearer S3CRET-A' }],
                        body_params: [{ key: 'secret', value: 'S3CRET-B' }, { key: 'message', value: 'viejo' }],
                    },
                },
            ],
            triggerConfig: {},
        };
        const read = redactSecrets(current.actions) as typeof current.actions;
        read[0]!.config.body_params[1]!.value = 'nuevo';
        const restored = restoreRedactedSecrets({ actions: read }, current) as { actions: typeof current.actions };
        expect(restored.actions[0]!.config).toEqual({
            url: 'https://x.test/h?api_key=S3CRET-C',
            headers: [{ key: 'Authorization', value: 'Bearer S3CRET-A' }],
            body_params: [{ key: 'secret', value: 'S3CRET-B' }, { key: 'message', value: 'nuevo' }],
        });
    });
});
