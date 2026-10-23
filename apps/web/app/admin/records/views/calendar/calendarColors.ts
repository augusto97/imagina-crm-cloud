import type { CalendarSettings, CalendarSource, ViewColorRule } from '@imagina-base/shared';

import { colorVar, type OptionColor } from '@/components/ui/color-picker';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { activeColorRules, evaluateRowColors, ROW_COLOR_HEX } from '../../grid/colorRules';

/** Color de respaldo: el primario del tema (se ve en claro y en oscuro). */
export const CALENDAR_PRIMARY = 'hsl(var(--imcrm-primary))';

/** Cómo se pinta cada evento, ya resuelto (`auto` decidido). */
export type ResolvedColorBy = 'source' | 'field' | 'none';

/**
 * `auto`: con varias fuentes prendidas, el color de cada fuente (para
 * distinguir «Vencimiento» de «Próximo contacto»); con una sola, el del
 * primer campo de selección de la lista (lo de siempre, v0.1.125); sin
 * ninguno, el primario.
 */
export function resolveColorBy(
    settings: Pick<CalendarSettings, 'colorBy' | 'colorFieldId'>,
    fields: readonly FieldEntity[],
    enabledSources: number,
): { by: ResolvedColorBy; field: FieldEntity | null } {
    if (settings.colorBy === 'source') return { by: 'source', field: null };
    if (settings.colorBy === 'none') return { by: 'none', field: null };
    if (settings.colorBy === 'field') {
        const f = fields.find((x) => x.id === settings.colorFieldId && x.type === 'select') ?? null;
        return f ? { by: 'field', field: f } : { by: 'none', field: null };
    }
    if (enabledSources > 1) return { by: 'source', field: null };
    const first = fields.find((f) => f.type === 'select') ?? null;
    return first ? { by: 'field', field: first } : { by: 'none', field: null };
}

/** El color de la opción elegida en un select (o undefined). */
export function optionColorOf(field: FieldEntity, record: RecordEntity): string | undefined {
    const value = record.fields[field.slug];
    if (typeof value !== 'string' || value === '') return undefined;
    const options = (field.config as { options?: Array<{ value: string; color?: string }> }).options;
    const opt = Array.isArray(options) ? options.find((o) => o.value === value) : undefined;
    return colorVar(opt?.color as OptionColor | undefined);
}

/**
 * El color de un evento: gana una regla de color de la vista (las MISMAS de
 * la tabla, evaluadas con `evaluateFilterCondition`); si ninguna lo pinta,
 * el de su fuente, el de la opción del select elegido o el primario.
 */
export function calendarColorResolver(opts: {
    settings: Pick<CalendarSettings, 'colorBy' | 'colorFieldId'>;
    fields: readonly FieldEntity[];
    fieldsById: ReadonlyMap<number, FieldEntity>;
    colorRules: readonly ViewColorRule[] | undefined;
    timeZone: string;
    enabledSources: number;
    now?: Date;
}): (record: RecordEntity, source: CalendarSource) => string {
    const rules = activeColorRules(opts.colorRules, opts.fieldsById);
    const { by, field } = resolveColorBy(opts.settings, opts.fields, opts.enabledSources);
    return (record, source) => {
        if (rules.length > 0) {
            const hit = evaluateRowColors(rules, record, opts.fieldsById, { timeZone: opts.timeZone, now: opts.now });
            const color = hit.row ?? hit.cells.get(source.startFieldId) ?? null;
            if (color) return ROW_COLOR_HEX[color];
        }
        if (by === 'source') return ROW_COLOR_HEX[source.color];
        if (by === 'field' && field) return optionColorOf(field, record) ?? CALENDAR_PRIMARY;
        return CALENDAR_PRIMARY;
    };
}

/**
 * Estilo de un evento: fondo suave mezclado con la superficie del tema (se
 * lee en claro y en oscuro), borde izquierdo con el color pleno y el texto
 * del tema.
 */
export function eventStyle(color: string, opts: { solid?: boolean } = {}): React.CSSProperties {
    return {
        backgroundColor: `color-mix(in srgb, ${color} ${opts.solid ? 30 : 18}%, hsl(var(--imcrm-card)))`,
        borderLeftColor: color,
        color: 'hsl(var(--imcrm-foreground))',
    };
}
