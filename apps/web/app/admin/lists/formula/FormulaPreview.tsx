import { useMemo, useState } from 'react';
import { Eye, Loader2 } from 'lucide-react';
import { evaluateFieldFormula, type FormulaEnv, type FormulaEvalField } from '@imagina-base/shared';

import { renderCellValue } from '@/admin/records/renderCellValue';
import { FormulaErrorBadge } from '@/components/fields/FormulaErrorBadge';
import { Select } from '@/components/ui/select';
import { useRecords } from '@/hooks/useRecords';
import { useMemberNames } from '@/hooks/useWpUsers';
import { isFormulaError } from '@/lib/formulaError';
import { __, sprintf } from '@/lib/i18n';
import { getTenantFormat, getTenantTimeZone } from '@/lib/tenantFormat';
import type { FieldEntity, FieldTypeSlug } from '@/types/field';
import type { RecordEntity } from '@/types/record';

/**
 * Fórmulas (A1) — vista previa EN VIVO contra un registro real de la lista:
 * el MISMO evaluador que corre el servidor en cada lectura (`packages/shared`),
 * con la zona horaria y el formato de la empresa. Así lo que se ve aquí es lo
 * que va a mostrar la columna.
 */
interface Props {
    listId?: number;
    fields: FieldEntity[];
    /** La fórmula en edición (guardada por id, lista para evaluar). */
    formula: FormulaEvalField | null;
    /** Cómo se muestra el resultado. */
    display: { type: FieldTypeSlug; config: Record<string, unknown> };
}

export function FormulaPreview({ listId, fields, formula, display }: Props): JSX.Element {
    const records = useRecords(listId, { per_page: 20 });
    const rows = useMemo<RecordEntity[]>(() => records.data?.data ?? [], [records.data]);
    const [chosen, setChosen] = useState<number | null>(null);
    const record = rows.find((r) => r.id === chosen) ?? rows[0] ?? null;

    const titleField = fields.find((f) => f.is_primary) ?? fields.find((f) => f.type === 'text');
    const nameOf = (r: RecordEntity): string => {
        const v = titleField ? r.fields[titleField.slug] : null;
        return typeof v === 'string' && v.trim() !== '' ? v : sprintf(__('Registro #%d'), r.id);
    };

    // Nombres de las personas del registro (campos persona, creado por…).
    const userIds = useMemo(() => {
        if (!record) return [];
        const ids: number[] = [];
        for (const f of fields) {
            if (!['user', 'created_by', 'updated_by'].includes(f.type)) continue;
            const v = Number(record.fields[f.slug]);
            if (Number.isInteger(v) && v > 0) ids.push(v);
        }
        return ids;
    }, [record, fields]);
    const names = useMemberNames(userIds);

    const result = useMemo(() => {
        if (!formula || !record) return null;
        const bySlug = new Map(fields.map((f) => [f.id, f.slug]));
        const evalFields = new Map<number, FormulaEvalField>(
            fields.map((f) => [f.id, { id: f.id, type: f.type, label: f.label, config: f.config }]),
        );
        evalFields.set(formula.id, formula);
        const format = getTenantFormat();
        const env: FormulaEnv = {
            now: new Date(),
            timeZone: getTenantTimeZone() ?? 'UTC',
            numberFormat: format.number_format,
            dateFormat: format.date_format,
            timeFormat: format.time_format,
            userName: (id) => (id === 0 ? __('Sistema') : names.data?.get(id) ?? null),
        };
        return evaluateFieldFormula(formula, {
            env,
            fields: evalFields,
            rawValue: (id) => {
                const slug = bySlug.get(id);
                if (!slug) return null;
                const v = record.fields[slug];
                return isFormulaError(v) ? null : v;
            },
            throughTarget: (id) => fields.find((f) => f.id === id)?.through?.target_field ?? null,
        });
    }, [formula, record, fields, names.data]);

    const shown = useMemo(
        () => ({ ...(fields[0] ?? ({} as FieldEntity)), id: formula?.id ?? -1, slug: '__preview', label: __('Vista previa'), type: display.type, config: display.config, through: null, formula: null }) as FieldEntity,
        [fields, formula?.id, display.type, display.config],
    );

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-2.5" data-formula-preview="">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-medium">
                    <Eye className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />
                    {__('Vista previa con')}
                </span>
                {rows.length > 0 && (
                    <Select
                        value={record?.id ?? ''}
                        onChange={(e) => setChosen(Number(e.target.value))}
                        className="imcrm-h-7 imcrm-min-w-0 imcrm-max-w-full imcrm-flex-1 imcrm-text-xs"
                        aria-label={__('Registro para la vista previa')}
                    >
                        {rows.map((r) => (
                            <option key={r.id} value={r.id}>
                                {nameOf(r)}
                            </option>
                        ))}
                    </Select>
                )}
            </div>
            <div className="imcrm-min-h-[28px] imcrm-text-sm" aria-live="polite">
                {records.isLoading ? (
                    <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" aria-hidden />
                        {__('Cargando registros…')}
                    </span>
                ) : !record ? (
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('La lista todavía no tiene registros para probar la fórmula.')}</span>
                ) : !formula ? (
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Escribe la fórmula para ver el resultado.')}</span>
                ) : result && !result.ok ? (
                    <FormulaErrorBadge message={result.error} detailed />
                ) : (
                    <span className="imcrm-font-medium" data-formula-preview-value="">
                        {renderCellValue(shown, result?.ok ? result.value : null)}
                    </span>
                )}
            </div>
        </div>
    );
}
