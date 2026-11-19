import { describe, expect, it } from 'vitest';

import { AUTOMATION_AI_DRAFT_MAX_CHARS, automationAiDraftRequestSchema } from './automation-ai-draft';

describe('«Describir con IA»: el pedido (v0.1.463)', () => {
    it('acepta lo que se escribe (sin espacios de más) y, opcional, la automatización actual', () => {
        const r = automationAiDraftRequestSchema.parse({ description: '  avisa al responsable  ' });
        expect(r.description).toBe('avisa al responsable');
        const c = automationAiDraftRequestSchema.parse({
            description: 'si falla, sigue',
            current: { trigger_type: 'record_created', actions: [{ type: 'wait', config: {} }] },
        });
        expect(c.current).toMatchObject({ name: '', trigger_config: {}, actions: [{ type: 'wait' }] });
    });

    it('rechaza lo vacío, lo demasiado largo, una automatización sin disparador y claves de más', () => {
        expect(automationAiDraftRequestSchema.safeParse({ description: ' a ' }).success).toBe(false);
        expect(automationAiDraftRequestSchema.safeParse({ description: 'x'.repeat(AUTOMATION_AI_DRAFT_MAX_CHARS + 1) }).success).toBe(false);
        expect(
            automationAiDraftRequestSchema.safeParse({ description: 'hola mundo', current: { trigger_type: '' } }).success,
        ).toBe(false);
        expect(automationAiDraftRequestSchema.safeParse({ description: 'hola mundo', model: 'x' }).success).toBe(false);
    });
});
