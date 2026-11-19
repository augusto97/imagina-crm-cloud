import {
    AIRTABLE_TARGET_LABELS,
    airtableDescribeContext,
    airtableFieldInfos,
    type AirtableFieldInfo,
    type AirtablePlan,
    type AirtablePlanField,
    type AirtableTableScan,
    type AirtableTableSchema,
    type AirtableTargetType,
} from '@imagina-base/shared';

/**
 * v0.1.458 — Cambios del plan desde la revisión (puros: se prueban aparte).
 * El plan habla por los ids de Airtable; la revisión recalcula lo que dice
 * de cada campo con las MISMAS reglas que el servidor.
 */

export function patchTable(plan: AirtablePlan, tableId: string, patch: { include?: boolean; name?: string }): AirtablePlan {
    return { ...plan, tables: plan.tables.map((t) => (t.table_id === tableId ? { ...t, ...patch } : t)) };
}

export function patchField(plan: AirtablePlan, tableId: string, fieldId: string, patch: Partial<Pick<AirtablePlanField, 'include' | 'label' | 'type'>>): AirtablePlan {
    return {
        ...plan,
        tables: plan.tables.map((t) => (t.table_id === tableId ? { ...t, fields: t.fields.map((f) => (f.field_id === fieldId ? { ...f, ...patch } : f)) } : t)),
    };
}

/** Bajar (o no) los adjuntos: al encenderlo, los campos de adjuntos vuelven a incluirse como archivos. */
export function setAttachments(plan: AirtablePlan, tables: readonly AirtableTableSchema[], on: boolean): AirtablePlan {
    const fileFields = new Set(tables.flatMap((t) => t.fields.filter((f) => f.type === 'multipleAttachments').map((f) => f.id)));
    return {
        ...plan,
        attachments: on,
        tables: plan.tables.map((t) => ({
            ...t,
            fields: t.fields.map((f) => (fileFields.has(f.field_id) ? { ...f, include: on, type: 'file' as const } : f)),
        })),
    };
}

/** Lo que dice la revisión de cada campo (tipo, alternativas, motivo) con el plan actual. */
export function reviewInfos(plan: AirtablePlan, tables: readonly AirtableTableSchema[], scan: readonly AirtableTableScan[]): Map<string, Map<string, AirtableFieldInfo>> {
    const ctx = airtableDescribeContext(
        tables,
        scan,
        plan.tables.filter((t) => t.include).map((t) => t.table_id),
        plan.attachments,
    );
    return new Map(tables.map((t) => [t.id, airtableFieldInfos(t, ctx)]));
}

export function targetLabel(type: AirtableTargetType): string {
    return AIRTABLE_TARGET_LABELS[type];
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('es')} KB`;
    return `${(bytes / (1024 * 1024)).toLocaleString('es', { maximumFractionDigits: 1 })} MB`;
}

/** «1 tabla» / «3 tablas», con los miles al estilo español. */
export function countOf(n: number, single: string, plural: string): string {
    return `${n.toLocaleString('es')} ${n === 1 ? single : plural}`;
}
