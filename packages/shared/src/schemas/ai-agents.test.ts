import { describe, expect, it } from 'vitest';
import {
    AI_AGENT_TEMPLATES,
    AI_AGENT_TOOLS,
    AI_AGENT_TOOL_META,
    AI_AGENT_WRITE_TOOLS,
    agentDayStart,
    agentIdsInActions,
    agentToolsOffered,
    createAiAgentSchema,
    isManagedAgentAutomation,
    readAgentActivity,
    readAskAgentConfig,
    updateAiAgentSchema,
} from './ai-agents';
import { automationConfigIssues } from './automation';
import { CAPABILITIES_BY_ROLE, CAPABILITY_GROUPS, effectiveCapabilities } from './membership';

describe('Agentes de IA (E6) — piezas puras', () => {
    it('cada plantilla es un agente válido con herramientas conocidas', () => {
        expect(AI_AGENT_TEMPLATES.map((t) => t.key)).toEqual([
            'classify_tickets',
            'summarize_on_close',
            'fill_missing',
            'suggest_reply',
            'assign_by_topic',
        ]);
        for (const t of AI_AGENT_TEMPLATES) {
            const parsed = createAiAgentSchema.safeParse({ ...t, list_ids: [1], template_key: t.key });
            expect(parsed.success, t.key).toBe(true);
            for (const tool of t.tools) expect(AI_AGENT_TOOLS).toContain(tool);
            // Ninguna plantilla manda correos: esa herramienta se enciende a mano.
            expect(t.tools).not.toContain('send_email');
        }
    });

    it('un agente nuevo propone por defecto y trae topes', () => {
        const a = createAiAgentSchema.parse({ name: 'X', instructions: 'Haz algo', list_ids: [3], tools: ['read_record'] });
        expect(a.mode).toBe('propose');
        expect(a.max_steps).toBe(8);
        expect(a.monthly_token_budget).toBe(2_000_000);
        expect(a.settings).toEqual({ client_comments: false, reviewer_user_ids: [] });
        expect(createAiAgentSchema.safeParse({ name: 'X', instructions: 'a', list_ids: [], tools: ['read_record'] }).success).toBe(false);
        expect(createAiAgentSchema.safeParse({ name: 'X', instructions: 'a', list_ids: [1], tools: ['borrar_todo'] }).success).toBe(false);
        expect(createAiAgentSchema.safeParse({ name: 'X', instructions: 'a', list_ids: [1], tools: ['read_record'], max_steps: 50 }).success).toBe(false);
        expect(updateAiAgentSchema.safeParse({}).success).toBe(false);
    });

    it('las herramientas que escriben están marcadas y sólo se ofrecen las que el dueño puede usar', () => {
        for (const t of AI_AGENT_WRITE_TOOLS) expect(AI_AGENT_TOOL_META[t].writes).toBe(true);
        expect(AI_AGENT_TOOL_META.read_record.writes).toBe(false);
        expect(AI_AGENT_TOOL_META.send_email.risky).toBe(true);
        expect(agentToolsOffered(['read_record', 'update_fields', 'send_email'], (t) => t !== 'send_email')).toEqual(['read_record', 'update_fields']);
        // El orden es el del catálogo, no el de la config.
        expect(agentToolsOffered(['comment', 'read_record'], () => true)).toEqual(['read_record', 'comment']);
    });

    it('la acción «Pedirle a un agente» se lee tolerante y se valida al guardar', () => {
        expect(readAskAgentConfig({ agent_id: '4', instruction: 'Hola {{nombre}}' })).toEqual({ agent_id: 4, instruction: 'Hola {{nombre}}' });
        expect(readAskAgentConfig(null)).toEqual({ agent_id: null, instruction: '' });
        expect(readAskAgentConfig({ agent_id: -1 }).agent_id).toBeNull();
        const issues = automationConfigIssues({ trigger_type: 'record_created', actions: [{ type: 'ask_agent', config: {} }] });
        expect(issues.map((i) => i.path)).toEqual(['actions.0.config.agent_id']);
        expect(automationConfigIssues({ trigger_type: 'record_created', actions: [{ type: 'ask_agent', config: { agent_id: 2 } }] })).toEqual([]);
    });

    it('reconoce las automatizaciones que mantiene el editor del agente y los agentes que nombra una automatización', () => {
        const managed = [{ type: 'ask_agent', config: { agent_id: 7, instruction: '' } }];
        expect(isManagedAgentAutomation(managed, 7)).toBe(true);
        expect(isManagedAgentAutomation(managed, 8)).toBe(false);
        expect(isManagedAgentAutomation([...managed, { type: 'send_email', config: {} }], 7)).toBe(false);
        expect(isManagedAgentAutomation([{ ...managed[0], condition: [{ field: 'x', op: 'eq', value: 1 }] }], 7)).toBe(false);
        const nested = [
            { type: 'if_else', config: { then_actions: [{ type: 'ask_agent', config: { agent_id: 3 } }], else_actions: [] } },
            { type: 'for_each_linked', config: { actions: [{ type: 'ask_agent', config: { agent_id: 9 } }] } },
            { type: 'ask_agent', config: { agent_id: 3 } },
        ];
        expect(agentIdsInActions(nested).sort()).toEqual([3, 9]);
    });

    it('lee el diff de la actividad de un agente y descarta lo roto', () => {
        expect(readAgentActivity({ agent: { event: 'note', agent_id: 2, agent_name: 'Clasificador', visibility: 'internal', excerpt: 'Hola' } })).toEqual({
            event: 'note',
            agent_id: 2,
            agent_name: 'Clasificador',
            visibility: 'internal',
            excerpt: 'Hola',
        });
        expect(readAgentActivity({ agent: { event: 'otra', agent_name: 'x' } })).toBeNull();
        expect(readAgentActivity({ f12: { from: 1, to: 2 } })).toBeNull();
        expect(readAgentActivity(null)).toBeNull();
    });

    it('el día de hoy empieza a la medianoche de la zona de la empresa', () => {
        // 2026-10-26 03:30 UTC = 2026-10-25 22:30 en Bogotá (UTC-5).
        const now = new Date('2026-10-26T03:30:00Z');
        expect(agentDayStart(now, 'America/Bogota').toISOString()).toBe('2026-10-25T05:00:00.000Z');
        expect(agentDayStart(now, 'UTC').toISOString()).toBe('2026-10-26T00:00:00.000Z');
    });

    it('gestionar agentes es sólo del admin de base y se puede dar a un rol propio (nunca a un invitado)', () => {
        expect(CAPABILITIES_BY_ROLE.admin).toContain('manage_ai_agents');
        for (const role of ['manager', 'agent', 'viewer', 'client', 'guest'] as const) {
            expect(CAPABILITIES_BY_ROLE[role]).not.toContain('manage_ai_agents');
        }
        expect(effectiveCapabilities('manager', ['manage_ai_agents'])).toContain('manage_ai_agents');
        expect(effectiveCapabilities('guest', ['manage_ai_agents'])).not.toContain('manage_ai_agents');
        expect(CAPABILITY_GROUPS.flatMap((g) => g.items.map((i) => i.capability))).toContain('manage_ai_agents');
    });
});
