import { describe, expect, it } from 'vitest';

import type { AutomationEntity } from '@/types/automation';

import { onErrorBadge } from './automationMeta';
import {
    groupAutomations,
    lastRunHadErrors,
    matchesAutomationQuery,
    matchesStatus,
    moveFolder,
    sortAutomations,
    statusCounts,
} from './automationIndex';

function auto(id: number, over: Partial<AutomationEntity> = {}): AutomationEntity {
    return {
        id,
        list_id: 1,
        name: `Auto ${id}`,
        description: null,
        trigger_type: 'record_created',
        trigger_config: {},
        actions: [],
        is_active: true,
        folder: null,
        created_by: 1,
        created_at: `2026-11-0${id}T10:00:00Z`,
        updated_at: `2026-11-0${id}T10:00:00Z`,
        last_run: null,
        ...over,
    };
}

describe('índice de automatizaciones', () => {
    const list = [
        auto(1, { name: 'Bienvenida', folder: 'Ventas' }),
        auto(2, { name: 'Aviso de pago', is_active: false, folder: 'cobros', last_run: { status: 'failed', error: 'x', at: '2026-11-09T08:00:00Z' } }),
        auto(3, { name: 'Recordatorio', trigger_type: 'scheduled', last_run: { status: 'success', error: null, at: '2026-11-10T08:00:00Z' } }),
    ];

    it('cuenta por estado', () => {
        expect(statusCounts(list)).toEqual({ all: 3, active: 2, paused: 1, failed: 1 });
        expect(list.filter((a) => matchesStatus(a, 'failed')).map((a) => a.id)).toEqual([2]);
        expect(list.filter((a) => matchesStatus(a, 'paused')).map((a) => a.id)).toEqual([2]);
    });

    it('busca sin tildes por nombre, carpeta y lo que hace; todas las palabras', () => {
        expect(matchesAutomationQuery(list[0]!, 'BIENVENÍDA')).toBe(true);
        expect(matchesAutomationQuery(list[1]!, 'cobros')).toBe(true);
        expect(matchesAutomationQuery(list[2]!, 'envía correo', 'Cuando es lunes → Envía un correo')).toBe(true);
        expect(matchesAutomationQuery(list[2]!, 'envía whatsapp', 'Envía un correo')).toBe(false);
        expect(matchesAutomationQuery(list[2]!, '   ')).toBe(true);
    });

    it('ordena por nombre, recientes y última corrida (las que nunca corrieron al final)', () => {
        expect(sortAutomations(list, 'name').map((a) => a.id)).toEqual([2, 1, 3]);
        expect(sortAutomations(list, 'recent').map((a) => a.id)).toEqual([3, 2, 1]);
        expect(sortAutomations(list, 'last_run').map((a) => a.id)).toEqual([3, 2, 1]);
    });

    it('agrupa por carpeta en su orden, sin importar mayúsculas, con «Sin carpeta» al final', () => {
        const s = groupAutomations(list, 'folder', ['Cobros', 'Vacía', 'Ventas'], true);
        expect(s.map((x) => [x.key, x.name, x.items.map((a) => a.id)])).toEqual([
            ['folder:cobros', 'Cobros', [2]],
            ['folder:vacia', 'Vacía', []],
            ['folder:ventas', 'Ventas', [1]],
            ['none', '', [3]],
        ]);
        // Con filtro, las carpetas vacías no se muestran.
        expect(groupAutomations(list, 'folder', ['Cobros', 'Vacía', 'Ventas'], false).map((x) => x.key)).toEqual([
            'folder:cobros',
            'folder:ventas',
            'none',
        ]);
        // Una carpeta que la lista no conocía igual aparece.
        expect(groupAutomations(list, 'folder', [], false).map((x) => x.name)).toEqual(['Ventas', 'cobros', '']);
    });

    it('agrupa por disparador y sin agrupar', () => {
        expect(groupAutomations(list, 'trigger', [], true).map((x) => [x.name, x.items.length])).toEqual([
            ['record_created', 2],
            ['scheduled', 1],
        ]);
        expect(groupAutomations(list, 'none', [], true)).toHaveLength(1);
    });

    it('sube y baja carpetas', () => {
        expect(moveFolder(['A', 'B', 'C'], 'b', -1)).toEqual(['B', 'A', 'C']);
        expect(moveFolder(['A', 'B', 'C'], 'C', 1)).toEqual(['A', 'B', 'C']);
    });
});

describe('«con errores» y «Si este paso falla» (v0.1.460)', () => {
    it('una corrida «con errores» cuenta en «Con fallas» pero no es una falla', () => {
        const a = auto(1, { last_run: { status: 'with_errors', error: 'El webhook respondió 500', at: '2026-11-10T08:00:00Z' } });
        expect(lastRunHadErrors(a)).toBe(true);
        expect(matchesStatus(a, 'failed')).toBe(true);
        expect(statusCounts([a, auto(2)]).failed).toBe(1);
    });

    it('la etiqueta del paso dice qué hace si falla (y nada con lo de siempre)', () => {
        expect(onErrorBadge({ type: 'call_webhook', config: {} })).toBeNull();
        expect(onErrorBadge({ type: 'call_webhook', config: {}, on_error: { mode: 'stop' } })).toBeNull();
        expect(onErrorBadge({ type: 'call_webhook', config: {}, on_error: { mode: 'retry', retries: 2 } })).toBe('Reintenta 2');
        expect(onErrorBadge({ type: 'send_email', config: {}, on_error: { mode: 'continue' } })).toBe('Si falla, sigue');
        expect(onErrorBadge({ type: 'send_email', config: {}, on_error: { mode: 'steps', actions: [] } })).toBe('Pasos si falla');
    });
});
