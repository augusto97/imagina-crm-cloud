import { describe, expect, it } from 'vitest';
import { automationConfigIssues } from './automation';
import {
    askAiVariables,
    describeAskAi,
    describeOnError,
    describeSwitch,
    onErrorFinal,
    parseAskAiAnswer,
    parseAiDate,
    parseAiNumber,
    pickSwitchCase,
    readAskAiConfig,
    readOnError,
    readSwitchConfig,
    switchCaseLabel,
    writeOnError,
} from './automation-control';
import { flowBranch, flowChildLists, flowNodeAt, flowPathDepth, mapFlowChildLists, parseFlowPath, walkFlowSteps } from './automation-flow';

const SWITCH = {
    type: 'switch',
    config: {
        source_field_id: 12,
        cases: [
            { label: 'Pagada', op: 'eq', value: 'pagada', actions: [{ type: 'notify_in_app', config: { title: 'Aviso', notify_user_ids: [1] } }] },
            { op: 'in', value: ['pendiente', 'vencida'], actions: [{ type: 'wait', config: { mode: 'duration', amount: 1, unit: 'days' } }] },
        ],
        default_actions: [{ type: 'send_email', config: { to: 'a@b.co' } }],
    },
    on_error: { mode: 'steps', actions: [{ type: 'notify_in_app', config: { title: 'Aviso', notify_user_ids: [1] } }] },
};

describe('ramas y rutas', () => {
    it('lee las ramas de «Según el valor de…» y la de «Si falla»', () => {
        expect(flowChildLists(SWITCH).map((k) => k.branch)).toEqual(['case0', 'case1', 'default', 'fail']);
        expect(flowBranch(SWITCH, 'case1')).toHaveLength(1);
        expect(flowBranch(SWITCH, 'default')[0]?.type).toBe('send_email');
        expect(flowBranch(SWITCH, 'fail')[0]?.type).toBe('notify_in_app');
        expect(flowBranch(SWITCH, 'case7')).toEqual([]);
    });

    it('una ruta entra a una rama de un switch y a «Si falla»', () => {
        const actions = [{ type: 'update_field', config: {} }, SWITCH];
        expect(parseFlowPath('1.case1.0')).toEqual([1, 'case1', 0]);
        expect(parseFlowPath('1.fail.0')).toEqual([1, 'fail', 0]);
        expect(parseFlowPath('1.caseX.0')).toBeNull();
        expect(flowNodeAt(actions, [1, 'case1', 0])?.type).toBe('wait');
        expect(flowNodeAt(actions, [1, 'default', 0])?.type).toBe('send_email');
        expect(flowPathDepth('1.case1.0.then.2')).toBe(2);
    });

    it('mapFlowChildLists reemplaza cada rama sin tocar el resto', () => {
        const next = mapFlowChildLists(SWITCH, (list) => list.map((a) => ({ ...(a as object), marked: true })));
        expect(flowBranch(next, 'case0')[0]).toMatchObject({ marked: true });
        expect(flowBranch(next, 'default')[0]).toMatchObject({ marked: true });
        expect(flowBranch(next, 'fail')[0]).toMatchObject({ marked: true });
        expect((next.config as { cases: Array<{ label: string }> }).cases[0]?.label).toBe('Pagada');
        // El original no cambia.
        expect(flowBranch(SWITCH, 'case0')[0]).not.toHaveProperty('marked');
    });

    it('walkFlowSteps recorre todo el árbol, ramas incluidas', () => {
        const seen: string[] = [];
        walkFlowSteps([SWITCH], (s) => seen.push(String(s.type)));
        expect(seen).toEqual(['switch', 'notify_in_app', 'wait', 'send_email', 'notify_in_app']);
    });
});

describe('«Según el valor de…»', () => {
    it('gana la primera rama que coincide; sin ninguna, «En otro caso»', () => {
        const cfg = readSwitchConfig(SWITCH.config);
        expect(pickSwitchCase(cfg.cases, 'pagada').index).toBe(0);
        expect(pickSwitchCase(cfg.cases, 'vencida').index).toBe(1);
        const none = pickSwitchCase(cfg.cases, 'anulada');
        expect(none.index).toBe(-1);
        expect(none.checks.map((c) => c.ok)).toEqual([false, false]);
    });

    it('números y vacío con el mismo vocabulario de las condiciones', () => {
        const cases = readSwitchConfig({
            cases: [
                { op: 'is_null', actions: [] },
                { op: 'gte', value: 1000000, actions: [] },
            ],
        }).cases;
        expect(pickSwitchCase(cases, '').index).toBe(0);
        expect(pickSwitchCase(cases, 2500000).index).toBe(1);
        expect(pickSwitchCase(cases, 10).index).toBe(-1);
    });

    it('nombra las ramas y avisa lo que falta al guardar', () => {
        const cfg = readSwitchConfig(SWITCH.config);
        expect(switchCaseLabel(cfg.cases[1]!, 1, (v) => v.toUpperCase())).toBe('es alguno de PENDIENTE, VENCIDA');
        expect(describeSwitch(SWITCH.config, 'Estado')).toBe('Según «Estado»: 2 ramas y «En otro caso»');
        expect(describeSwitch({ source_variable: '{{respuestas.ia.valor}}', cases: [{ value: 'x' }] })).toBe('Según {{respuestas.ia.valor}}: 1 rama');
        const issues = automationConfigIssues({ actions: [{ type: 'switch', config: { cases: [{ op: 'eq', value: '' }] } }] });
        expect(issues.map((i) => i.path)).toEqual(['actions.0.config.source_field_id', 'actions.0.config.cases.0.value']);
    });

    it('una espera dentro de una rama del switch es válida; dentro de «Si falla», no', () => {
        expect(automationConfigIssues({ actions: [SWITCH] })).toEqual([]);
        const bad = automationConfigIssues({
            actions: [{ type: 'call_webhook', config: { url: 'https://x.co' }, on_error: { mode: 'steps', actions: [{ type: 'wait', config: { mode: 'duration', amount: 1 } }] } }],
        });
        expect(bad.some((i) => i.path === 'actions.0.on_error.actions.0.type')).toBe(true);
    });
});

describe('«Si este paso falla»', () => {
    it('sin nada (o algo raro) = detener', () => {
        expect(readOnError(undefined).mode).toBe('stop');
        expect(readOnError({ mode: 'raro' }).mode).toBe('stop');
        expect(writeOnError(readOnError(undefined))).toBeUndefined();
    });

    it('reintentar: entre 1 y 3 veces y qué hacer si sigue fallando', () => {
        const c = readOnError({ mode: 'retry', retries: 9, if_still_fails: 'continue' });
        expect(c.retries).toBe(3);
        expect(onErrorFinal(c)).toBe('continue');
        expect(describeOnError({ mode: 'retry', retries: 2, if_still_fails: 'continue' })).toBe(
            'Si falla: lo reintenta hasta 2 veces; si sigue fallando, sigue con el resto',
        );
        expect(describeOnError({ mode: 'steps', actions: [{}], after_steps: 'continue' })).toBe('Si falla: hace 1 paso y sigue con el resto');
    });

    it('reintentar sólo se ofrece para pasos que llaman afuera', () => {
        const issues = automationConfigIssues({ actions: [{ type: 'update_field', config: { values: { a: 1 } }, on_error: { mode: 'retry' } }] });
        expect(issues[0]?.path).toBe('actions.0.on_error.mode');
        expect(automationConfigIssues({ actions: [{ type: 'call_webhook', config: { url: 'https://x.co' }, on_error: { mode: 'retry' } }] })).toEqual([]);
        const empty = automationConfigIssues({ actions: [{ type: 'call_webhook', config: { url: 'https://x.co' }, on_error: { mode: 'steps' } }] });
        expect(empty[0]?.path).toBe('actions.0.on_error.actions');
    });
});

describe('«Preguntarle a la IA»', () => {
    it('lee la config con defaults y valida lo imprescindible', () => {
        const c = readAskAiConfig({ instruction: 'Clasifica', output: 'choice', choices: 'Alta\nMedia\nBaja\nMedia' });
        expect(c.choices).toEqual(['Alta', 'Media', 'Baja']);
        expect(c.responseName).toBe('ia');
        expect(c.includeRecord).toBe(true);
        const issues = automationConfigIssues({ actions: [{ type: 'ask_ai', config: { output: 'fields', items: [{ key: 'valor' }, { key: 'Monto' }] } }] });
        expect(issues.map((i) => i.path)).toEqual([
            'actions.0.config.instruction',
            'actions.0.config.items.0.key',
            'actions.0.config.items.1.key',
        ]);
        expect(describeAskAi({ output: 'number', save_field_id: 4 }, 'Monto')).toBe('Le pregunta a la IA (un número) y la guarda en «Monto»');
        expect(askAiVariables({ output: 'choice', response_name: 'prioridad' }).map((v) => v.key)).toEqual([
            'respuestas.prioridad.texto',
            'respuestas.prioridad.valor',
        ]);
    });

    it('dos pasos no pueden dejar su respuesta con el mismo nombre', () => {
        const issues = automationConfigIssues({
            actions: [
                { type: 'ask_ai', config: { instruction: 'a' } },
                { type: 'ask_ai', config: { instruction: 'b' } },
            ],
        });
        expect(issues).toEqual([{ path: 'actions.1.config.response_name', message: 'Ya hay otro paso que guarda su resultado como «ia»: usa otro nombre.' }]);
    });

    it('lee cada tipo de respuesta y rechaza lo que no encaja', () => {
        const ch = readAskAiConfig({ output: 'choice', choices: ['Alta', 'Media', 'Baja'] });
        expect(parseAskAiAnswer(ch, ' «media». ')).toMatchObject({ ok: true, value: 'Media' });
        expect(parseAskAiAnswer(ch, 'Urgente')).toMatchObject({ ok: false, error: 'La IA respondió «Urgente», que no es una de las opciones.' });
        expect(parseAskAiAnswer(ch, '(ninguna)').ok).toBe(false);

        const num = readAskAiConfig({ output: 'number' });
        expect(parseAskAiAnswer(num, '$ 1.500.000')).toMatchObject({ ok: true, value: 1500000 });
        expect(parseAskAiAnswer(num, '(sin dato)')).toMatchObject({ ok: true, value: null });
        expect(parseAskAiAnswer(num, 'unos mil').ok).toBe(false);

        expect(parseAskAiAnswer(readAskAiConfig({ output: 'boolean' }), 'Sí.')).toMatchObject({ ok: true, value: true, text: 'Sí' });
        expect(parseAskAiAnswer(readAskAiConfig({ output: 'boolean' }), 'tal vez').ok).toBe(false);
        expect(parseAskAiAnswer(readAskAiConfig({ output: 'date' }), '2026-02-30').ok).toBe(false);
        expect(parseAskAiAnswer(readAskAiConfig({ output: 'date' }), '15/03/2027')).toMatchObject({ ok: true, value: '2027-03-15' });

        const ex = readAskAiConfig({
            output: 'fields',
            items: [
                { key: 'empresa', type: 'text' },
                { key: 'monto', type: 'number', label: 'Monto' },
                { key: 'fecha', type: 'date' },
            ],
        });
        const good = parseAskAiAnswer(ex, '```json\n{"empresa": "Acme", "monto": "2.300", "fecha": null}\n```');
        expect(good).toMatchObject({ ok: true, fields: { empresa: 'Acme', monto: 2300, fecha: null } });
        expect(parseAskAiAnswer(ex, '{"monto": "muchos"}')).toMatchObject({ ok: false, error: '«Monto»: la IA respondió «muchos», que no se puede leer como un número.' });
        expect(parseAskAiAnswer(ex, 'no sé').ok).toBe(false);
    });

    it('números y fechas en los formatos de la región', () => {
        expect(parseAiNumber('1.234,5')).toBe(1234.5);
        expect(parseAiNumber('1,234.5')).toBe(1234.5);
        expect(parseAiNumber('COP 2.000')).toBe(2000);
        expect(parseAiNumber('versión 2 de 3')).toBeNull();
        // Un solo número dentro del texto se toma; dos o más es ambiguo.
        expect(parseAiNumber('Aproximadamente 1.250.000 pesos.')).toBe(1250000);
        expect(parseAiNumber('entre 1.000 y 2.000')).toBeNull();
        expect(parseAiDate('Vence el 2026-12-24.')).toBe('2026-12-24');
        expect(parseAiDate('del 2026-12-01 al 2026-12-24')).toBeNull();
        expect(parseAiDate('2026-12-31')).toBe('2026-12-31');
        expect(parseAiDate('mañana')).toBeNull();
    });
});
