import { describe, expect, it } from 'vitest';
import {
    describeRelativeDate,
    isTemplateValueType,
    portableTemplateContent,
    readTemplateContent,
    relativeFromAbsolute,
    remapTemplateContent,
    resolveRelativeDate,
    resolveTemplateValues,
    templateContentFromPortable,
    templateRefs,
    type RecordTemplateContent,
} from './record-template';

const TZ = 'America/Bogota';
// Viernes 30 de octubre de 2026, 10:00 en Bogotá.
const NOW = new Date('2026-10-30T15:00:00Z');

describe('C6 — plantillas de registro (puro)', () => {
    it('qué campos admiten un valor de plantilla', () => {
        expect(isTemplateValueType('text')).toBe(true);
        expect(isTemplateValueType('user')).toBe(true);
        expect(isTemplateValueType('date')).toBe(true);
        for (const t of ['autonumber', 'created_at', 'computed', 'formula', 'lookup', 'rollup', 'button', 'file', 'relation', 'checklist_progress'] as const) {
            expect(isTemplateValueType(t)).toBe(false);
        }
    });

    it('fechas relativas: días corridos, días hábiles con festivos de Colombia y hora en la zona de la empresa', () => {
        const base = { now: NOW, timeZone: TZ, data: {}, withTime: false };
        expect(resolveRelativeDate({ days: 1, from_field_id: null, business_days: false, time: null }, base)).toBe('2026-10-31');
        // +1 hábil desde el viernes: el lunes 2 de noviembre es festivo (Todos los Santos).
        expect(resolveRelativeDate({ days: 1, from_field_id: null, business_days: true, time: null }, base)).toBe('2026-11-03');
        // Desde un campo fecha, a una hora fija → instante UTC (14:30 de Bogotá).
        expect(
            resolveRelativeDate(
                { days: 2, from_field_id: 7, business_days: false, time: '14:30' },
                { now: NOW, timeZone: TZ, data: { f7: '2026-12-31' }, withTime: true },
            ),
        ).toBe('2027-01-02T19:30:00.000Z');
        // «Hoy» es el día de la EMPRESA: a las 22:00 de Bogotá en UTC ya es mañana.
        expect(resolveRelativeDate({ days: 0, from_field_id: null, business_days: false, time: null }, { ...base, now: new Date('2026-10-31T03:00:00Z') })).toBe(
            '2026-10-30',
        );
        // Origen vacío → null.
        expect(resolveRelativeDate({ days: 1, from_field_id: 9, business_days: false, time: null }, base)).toBeNull();
    });

    it('valores: fijos primero, después fechas y personas que leen al registro (lo del alta pisa)', () => {
        const fields = [
            { id: 1, type: 'text', label: 'Nombre' },
            { id: 2, type: 'date', label: 'Inicio' },
            { id: 3, type: 'date', label: 'Entrega' },
            { id: 4, type: 'user', label: 'Responsable' },
            { id: 5, type: 'user', label: 'Revisor' },
            { id: 6, type: 'formula', label: 'Cálculo' },
        ];
        const out = resolveTemplateValues(
            {
                f1: { mode: 'fixed', value: 'Proyecto' },
                f3: { mode: 'relative_date', date: { days: 5, from_field_id: 2, business_days: true, time: null } },
                f4: { mode: 'person', person: { kind: 'creator' } },
                f5: { mode: 'person', person: { kind: 'field', field_id: 4 } },
                f6: { mode: 'fixed', value: 'no' },
                f99: { mode: 'fixed', value: 'campo borrado' },
            },
            fields,
            { now: NOW, timeZone: TZ, creatorId: 42, base: { f2: '2026-11-13' } },
        );
        // 13-nov (viernes) + 5 hábiles: el 16 es festivo → 17, 18, 19, 20, 23.
        expect(out.data).toEqual({ f1: 'Proyecto', f3: '2026-11-23', f4: 42, f5: 42 });
        expect(out.warnings).toHaveLength(1);
    });

    it('guardar como plantilla: una fecha absoluta pasa a relativa respecto de hoy', () => {
        expect(relativeFromAbsolute('2026-11-06', { now: NOW, timeZone: TZ })).toEqual({ days: 7, from_field_id: null, business_days: false, time: null });
        expect(relativeFromAbsolute('2026-10-29T20:15:00.000Z', { now: NOW, timeZone: TZ })).toEqual({ days: -1, from_field_id: null, business_days: false, time: '15:15' });
        expect(relativeFromAbsolute('no es fecha', { now: NOW, timeZone: TZ })).toBeNull();
        expect(describeRelativeDate({ days: 3, from_field_id: 2, business_days: true, time: '09:00' }, () => 'Inicio')).toBe('+3 días hábiles desde «Inicio» a las 09:00');
    });

    const content: RecordTemplateContent = readTemplateContent({
        values: {
            f1: { mode: 'fixed', value: 'X' },
            f3: { mode: 'relative_date', date: { days: 1, from_field_id: 2 } },
            f4: { mode: 'person', person: { kind: 'user', user_id: 7 } },
        },
        subtasks: [{ title: 'Kickoff', values: { f4: { mode: 'person', person: { kind: 'field', field_id: 5 } } } }],
        checklists: [{ name: 'Alta', items: [{ text: 'Contrato', assignee: { kind: 'user', user_id: 8 }, due: { days: 2, from_field_id: null } }] }],
    });

    it('referencias y re-mapeo de ids (migrar empresa): lo que no viajó se descarta', () => {
        const refs = templateRefs(content);
        expect([...refs.fieldIds].sort()).toEqual([1, 2, 3, 4, 5]);
        expect([...refs.userIds].sort()).toEqual([7, 8]);
        const out = remapTemplateContent(content, {
            field: (id) => (id === 5 ? null : id + 100),
            user: (id) => (id === 8 ? null : id + 1000),
        });
        expect(Object.keys(out.values).sort()).toEqual(['f101', 'f103', 'f104']);
        expect(out.values.f103).toEqual({ mode: 'relative_date', date: { days: 1, from_field_id: 102, business_days: false, time: null } });
        expect(out.values.f104).toEqual({ mode: 'person', person: { kind: 'user', user_id: 1007 } });
        expect(out.subtasks[0]!.values).toEqual({});
        expect(out.checklists[0]!.items[0]!.assignee).toBeNull();
    });

    it('formato portable (blueprint): ida y vuelta por slug', () => {
        const slugs: Record<number, string> = { 1: 'nombre', 2: 'inicio', 3: 'entrega', 4: 'responsable', 5: 'revisor' };
        const ids = Object.fromEntries(Object.entries(slugs).map(([id, s]) => [s, Number(id) + 500]));
        const portable = portableTemplateContent(content, (id) => slugs[id]);
        expect(JSON.stringify(portable)).not.toContain('"f1"');
        const back = templateContentFromPortable(JSON.parse(JSON.stringify(portable)), (s) => ids[s]);
        expect(back.values.f503).toEqual({ mode: 'relative_date', date: { days: 1, from_field_id: 502, business_days: false, time: null } });
        expect(back.subtasks[0]!.values.f504).toEqual({ mode: 'person', person: { kind: 'field', field_id: 505 } });
        expect(back.checklists[0]!.items[0]!.due).toEqual({ days: 2, from_field_id: null, business_days: false, time: null });
    });
});
