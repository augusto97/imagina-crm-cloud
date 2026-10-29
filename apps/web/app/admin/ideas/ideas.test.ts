import { describe, expect, it } from 'vitest';

import { hasIllustration } from '@/admin/learn/illustrations/registry';
import { moduleById } from '@/admin/learn/content/registry';
import { LEARN_ICONS } from '@/admin/learn/LearnIcon';

import {
    buildIdeaAutomations,
    defaultRawAnswer,
    expandMessages,
    guessOption,
    suggestIdeaMapping,
    resolveAnswer,
    resolveAnswers,
    stripUnmappedRoles,
    suggestList,
    type AnswerEnv,
} from './activate';
import { IDEA_CATEGORIES, IDEAS } from './catalog';
import type { IdeaQuestion } from './types';

/** Opciones de ejemplo que contienen las palabras que las ideas adivinan. */
const SAMPLE_OPTIONS = [
    { value: 'pendiente', label: 'Pendiente' },
    { value: 'pagada', label: 'Pagada' },
    { value: 'ganada', label: 'Ganada' },
    { value: 'cerrado', label: 'Cerrado' },
    { value: 'hecha', label: 'Hecha' },
    { value: 'urgente', label: 'Urgente' },
    { value: 'bajo', label: 'Stock bajo' },
    { value: 'agotado', label: 'Agotado' },
];

const CONNECTIONS = [
    { id: 11, integration_key: 'whatsapp', name: 'WhatsApp' },
    { id: 12, integration_key: 'slack', name: 'Slack' },
    { id: 13, integration_key: 'mercadopago', name: 'Mercado Pago' },
    { id: 14, integration_key: 'google_sheets', name: 'Google' },
    { id: 15, integration_key: 'google_calendar', name: 'Google' },
    { id: 16, integration_key: 'sms_twilio', name: 'Twilio (SMS)' },
];

function envFor(roles: string[]): AnswerEnv {
    return {
        myEmail: 'yo@ejemplo.test',
        roleOptions: Object.fromEntries(roles.map((r) => [r, SAMPLE_OPTIONS])),
        mappedRoles: new Set(roles),
        connections: CONNECTIONS,
    };
}

const FORBIDDEN = ['imagina', 'podés', 'tenés', 'querés', 'sabés', 'acá', 'vos', 'hacé', 'tocá', 'slug', 'json', 'endpoint'];
const word = (w: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, 'u');

describe('catálogo de ideas', () => {
    it('ids únicos, categorías e íconos que existen', () => {
        const ids = IDEAS.map((i) => i.id);
        expect(new Set(ids).size).toBe(ids.length);
        const cats = new Set(IDEA_CATEGORIES.map((c) => c.id));
        for (const idea of IDEAS) {
            expect(cats.has(idea.category), idea.id).toBe(true);
            expect(LEARN_ICONS[idea.icon], `${idea.id}: ícono ${idea.icon}`).toBeDefined();
            expect(idea.steps.length, idea.id).toBeGreaterThanOrEqual(3);
        }
        for (const c of IDEA_CATEGORIES) {
            expect(LEARN_ICONS[c.icon], c.id).toBeDefined();
            expect(IDEAS.some((i) => i.category === c.id), `categoría vacía: ${c.id}`).toBe(true);
        }
    });

    it('cada ilustración y cada artículo del manual existen', () => {
        for (const idea of IDEAS) {
            expect(hasIllustration(idea.illustration), `${idea.id}: ${idea.illustration}`).toBe(true);
            if (idea.learn) {
                const [mod, art] = idea.learn.split('/');
                const m = moduleById(mod ?? '');
                expect(m, `${idea.id}: módulo ${mod}`).toBeDefined();
                expect(m?.articles.some((a) => a.id === art), `${idea.id}: artículo ${idea.learn}`).toBe(true);
            }
        }
    });

    it('texto en español neutro y sin el nombre del producto', () => {
        for (const idea of IDEAS) {
            // Sólo lo que la persona lee (la estructura de las automatizaciones usa `slug` por dentro).
            const visible = [idea.title, idea.summary, idea.problem, ...idea.steps];
            if (idea.plan.kind === 'automations') {
                for (const qq of idea.plan.questions) visible.push(qq.label, qq.help ?? '', qq.kind === 'text' ? qq.default : '');
                for (const a of idea.plan.automations) {
                    visible.push(a.name, a.description);
                    for (const act of a.actions) for (const k of ['subject', 'body', 'text']) if (typeof act.config[k] === 'string') visible.push(act.config[k] as string);
                }
            }
            if (idea.plan.kind === 'go') visible.push(idea.plan.label);
            const text = visible.join(' ').toLowerCase();
            for (const w of FORBIDDEN) expect(word(w).test(text), `${idea.id}: «${w}»`).toBe(false);
        }
    });

    it('cada idea de automatizaciones se arma válida con los valores por defecto', () => {
        for (const idea of IDEAS) {
            if (idea.plan.kind !== 'automations') continue;
            const roles = idea.plan.roles.map((r) => r.key);
            const env = envFor(roles);
            const raw: Record<string, string | string[]> = {};
            for (const qq of idea.plan.questions) {
                raw[qq.key] = qq.kind === 'url' ? 'https://ejemplo.test/recibe' : defaultRawAnswer(qq, env);
            }
            const built = buildIdeaAutomations(idea.plan.automations, idea.plan.roles, {
                roleToSlug: Object.fromEntries(roles.map((r) => [r, `f_${r}`])),
                answers: resolveAnswers(idea.plan.questions, raw),
                connectionApps: Object.fromEntries(CONNECTIONS.map((c) => [c.id, c.integration_key])),
            });
            expect(built.problems, idea.id).toEqual([]);
            expect(built.automations).toHaveLength(idea.plan.automations.length);
            // Ningún rol quedó sin traducir ni ninguna pregunta sin responder.
            const json = JSON.stringify(built.automations);
            expect(json.includes('$q'), idea.id).toBe(false);
            expect(json.includes('[[q:'), idea.id).toBe(false);
            expect(json.includes('$message'), idea.id).toBe(false);
            for (const r of roles) expect(new RegExp(`\\{\\{(before\\.)?${r}[}.|]`).test(json), `${idea.id}: {{${r}}}`).toBe(false);
        }
    });

    it('las ideas de plantillas apuntan a plantillas del sistema', () => {
        for (const idea of IDEAS) {
            if (idea.plan.kind === 'list' || idea.plan.kind === 'dashboard') expect(idea.plan.template.startsWith('sys:'), idea.id).toBe(true);
            if (idea.plan.kind === 'go') expect(idea.plan.to.startsWith('/') || idea.plan.to.startsWith('list:'), idea.id).toBe(true);
        }
    });
});

describe('activar una idea', () => {
    it('sin elegir el campo de un rol obligatorio, lo pide', () => {
        const idea = IDEAS.find((i) => i.id === 'recordatorio-de-pago')!;
        if (idea.plan.kind !== 'automations') throw new Error('tipo');
        const built = buildIdeaAutomations(idea.plan.automations, idea.plan.roles, { roleToSlug: {}, answers: {}, connectionApps: {} });
        expect(built.problems.some((p) => p.includes('Fecha de vencimiento'))).toBe(true);
    });

    it('los días antes llegan en minutos y negativos', () => {
        const q: IdeaQuestion = { kind: 'days', key: 'antes', label: 'x', default: 3, unit: 'minutes', before: true };
        expect(resolveAnswer(q, '3')).toBe(-3 * 1440);
        expect(resolveAnswer({ ...q, before: false, unit: 'days' }, '7')).toBe(7);
        expect(resolveAnswer(q, 'abc')).toBe(-0);
    });

    it('«al responsable» se traduce al campo persona elegido', () => {
        const idea = IDEAS.find((i) => i.id === 'aviso-antes-de-vencer')!;
        if (idea.plan.kind !== 'automations') throw new Error('tipo');
        const env = envFor(['vence', 'estado', 'responsable', 'titulo']);
        const q = idea.plan.questions.find((x) => x.key === 'avisar')!;
        expect(defaultRawAnswer(q, env)).toBe('{{responsable.email}}');
        expect(defaultRawAnswer(q, { ...env, mappedRoles: new Set(['vence']) })).toBe('yo@ejemplo.test');
        const raw = Object.fromEntries(idea.plan.questions.map((x) => [x.key, defaultRawAnswer(x, env)]));
        const built = buildIdeaAutomations(idea.plan.automations, idea.plan.roles, {
            roleToSlug: { vence: 'entrega', estado: 'estado_tarea', responsable: 'quien', titulo: 'tarea' },
            answers: resolveAnswers(idea.plan.questions, raw),
            connectionApps: {},
        });
        const action = built.automations[0]!.actions[0]!;
        expect(action.config.to).toBe('{{quien.email}}');
        expect(built.automations[0]!.trigger_config).toMatchObject({ due_field: 'entrega', offset_minutes: -2 * 1440 });
    });

    it('un mensaje sale por la app de la conexión elegida', () => {
        const problems: string[] = [];
        const base = [{ type: '$message', config: { connection: 11, to: '{{tel}}', text: 'hola' } }];
        expect(expandMessages(base, { 11: 'whatsapp' }, problems)[0]).toEqual({
            type: 'connector_action',
            config: { connection_id: 11, action_key: 'send_text', values: { recipient: '{{tel}}', message: 'hola' } },
        });
        expect(expandMessages(base, { 11: 'telegram' }, problems)[0]!.config).toMatchObject({ action_key: 'send_message', values: { chat_id: '{{tel}}', text: 'hola' } });
        expect(expandMessages(base, { 11: 'slack' }, problems)[0]!.config).toMatchObject({ values: { channel: '{{tel}}' } });
        expect(expandMessages(base, { 11: 'sms_onurix' }, problems)[0]!.config).toMatchObject({ action_key: 'send_sms', values: { to: '{{tel}}', message: 'hola' } });
        expect(problems).toEqual([]);
        expandMessages(base, { 11: 'mercadopago' }, problems);
        expect(problems).toHaveLength(1);
    });

    it('las variables de roles opcionales sin campo desaparecen del texto', () => {
        const out = stripUnmappedRoles({ body: 'Hola {{nombre}}, tu {{monto|moneda}} de {{titulo}}' }, ['nombre', 'monto']);
        expect(out).toEqual({ body: 'Hola , tu de {{titulo}}' });
    });

    it('adivina la opción por la etiqueta, sin acentos', () => {
        const opts = [
            { value: 'a', label: 'En revisión' },
            { value: 'b', label: 'Pagado ✓' },
        ];
        expect(guessOption(opts, ['pagad'])).toBe('b');
        expect(guessOption(opts, ['revision'])).toBe('a');
        expect(guessOption(opts, ['nada'])).toBeUndefined();
    });

    it('un teléfono no se sugiere en un texto cualquiera', () => {
        const roles = [
            { key: 'telefono', label: 'Teléfono', types: ['phone', 'text'], required: true },
            { key: 'nombre', label: 'Nombre del contacto', types: ['text'], required: false },
        ] as Parameters<typeof suggestIdeaMapping>[0];
        const fields = [
            { id: 1, label: 'Ciudad', slug: 'ciudad', type: 'text' },
            { id: 2, label: 'Nombre', slug: 'nombre', type: 'text' },
        ];
        expect(suggestIdeaMapping(roles, fields)).toEqual({ nombre: 2 });
        expect(suggestIdeaMapping(roles, [...fields, { id: 3, label: 'Celular', slug: 'celular', type: 'text' }])).toMatchObject({ telefono: 3 });
        expect(suggestIdeaMapping(roles, [...fields, { id: 4, label: 'Contacto', slug: 'contacto', type: 'phone' }])).toMatchObject({ telefono: 4 });
    });

    it('el título usa el campo de título de la lista', () => {
        const roles = [{ key: 'titulo', label: 'Nombre o título', types: ['text'], required: false }] as Parameters<typeof suggestIdeaMapping>[0];
        const fields = [
            { id: 1, label: 'Ciudad', slug: 'ciudad', type: 'text' },
            { id: 2, label: 'Razón social', slug: 'razon_social', type: 'text', is_primary: true },
        ];
        expect(suggestIdeaMapping(roles, fields)).toEqual({ titulo: 2 });
    });

    it('sugiere la lista por su nombre', () => {
        const idea = IDEAS.find((i) => i.id === 'recordatorio-de-pago')!;
        const lists = [
            { id: 1, name: 'Clientes', slug: 'clientes' },
            { id: 2, name: 'Facturas 2026', slug: 'facturas-2026' },
        ];
        expect(suggestList(idea, lists)?.id).toBe(2);
        expect(suggestList(idea, [lists[0]!])).toBeUndefined();
    });
});
