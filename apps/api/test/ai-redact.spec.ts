import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src/ai/tools/structure-tools';

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
});
