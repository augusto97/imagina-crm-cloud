import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { bulkOperationSchema, type BulkOperation } from '@imagina-base/shared';

import { FilterGroupView } from '@/admin/records/FilterGroupView';
import { OperationRow } from '@/admin/records/bulk/BulkEditDialog';
import { bulkEditableFields, draftToOperation, newDraft, operationToDraft, type BulkDraft } from '@/admin/records/bulk/bulkOpMeta';
import { emptyTree } from '@/admin/records/filterTree';
import { __ } from '@/lib/i18n';
import type { FilterTree } from '@/types/record';

import type { ActionConfigEditorProps } from './config-editors';

/**
 * v0.1.221 — Editor de la acción «Editar en lote»: qué registros (todos o los
 * que cumplen un filtro, evaluado CUANDO corre) y qué cambios, con el mismo
 * editor de operaciones que la edición masiva a mano. Pensada para el
 * disparador «En un horario»: «cada lunes, subir 5 % los precios de la
 * categoría X», «cada noche, pasar a Vencida lo pendiente con fecha pasada».
 */
export function BulkEditActionConfig({ spec, onChange, fields }: ActionConfigEditorProps): JSX.Element {
    const [drafts, setDrafts] = useState<BulkDraft[]>(() => {
        const raw = Array.isArray(spec.config.operations) ? spec.config.operations : [];
        const ops = raw.map((o) => bulkOperationSchema.safeParse(o)).flatMap((p) => (p.success ? [p.data] : []));
        return ops.length > 0 ? ops.map(operationToDraft) : [newDraft()];
    });
    const editable = useMemo(() => bulkEditableFields(fields), [fields]);
    const byId = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
    const filter = (spec.config.filter_tree as FilterTree | null | undefined) ?? null;
    const listId = fields[0]?.list_id;

    const commit = (next: BulkDraft[]): void => {
        setDrafts(next);
        const operations: BulkOperation[] = [];
        for (const d of next) {
            const r = draftToOperation(d, undefined, d.field_id ? byId.get(d.field_id)?.type : undefined);
            if (r.ok) operations.push(r.operation);
        }
        onChange({ ...spec, config: { ...spec.config, operations } });
    };
    const problems = drafts
        .map((d, i) => {
            if (d.field_id === null && d.op === null) return null;
            const r = draftToOperation(d, undefined, d.field_id ? byId.get(d.field_id)?.type : undefined);
            return r.ok ? null : `${i + 1}. ${r.error}`;
        })
        .filter((x): x is string => x !== null);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-auto-bulk-edit">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                <p className="imcrm-text-xs imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Qué registros')}</p>
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <input
                        type="checkbox"
                        checked={filter !== null}
                        onChange={(e) => {
                            const next = { ...spec.config };
                            if (e.target.checked) next.filter_tree = emptyTree();
                            else delete next.filter_tree;
                            onChange({ ...spec, config: next });
                        }}
                        data-testid="imcrm-auto-bulk-has-filter"
                    />
                    {__('Sólo los que cumplan…')}
                </label>
                {filter !== null ? (
                    <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2">
                        <FilterGroupView
                            root={filter}
                            path={[]}
                            fields={fields}
                            listId={listId}
                            onRootChange={(next) => onChange({ ...spec, config: { ...spec.config, filter_tree: next } })}
                        />
                    </div>
                ) : (
                    <p className="imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400">
                        {__('Sin filtro, cada vez que corra edita TODOS los registros de la lista (hasta 5.000).')}
                    </p>
                )}
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                <p className="imcrm-text-xs imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Qué cambiar')}</p>
                <ol className="imcrm-space-y-2.5">
                    {drafts.map((d, i) => (
                        <li key={d.key}>
                            <OperationRow
                                index={i}
                                draft={d}
                                fields={fields}
                                editable={editable}
                                onChange={(next) => commit(drafts.map((x) => (x.key === d.key ? next : x)))}
                                onRemove={drafts.length > 1 ? () => commit(drafts.filter((x) => x.key !== d.key)) : undefined}
                            />
                        </li>
                    ))}
                </ol>
                {drafts.length < 12 && (
                    <button
                        type="button"
                        onClick={() => setDrafts((all) => [...all, newDraft()])}
                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-self-start imcrm-text-sm imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                        data-testid="imcrm-auto-bulk-add-op"
                    >
                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Agregar otro cambio')}
                    </button>
                )}
                {problems.length > 0 && (
                    <p className="imcrm-rounded-md imcrm-bg-amber-500/10 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-amber-800 dark:imcrm-text-amber-300" role="alert">
                        {__('Estos cambios están incompletos y no se guardan:')} {problems.join(' · ')}
                    </p>
                )}
            </div>

            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Los cambios se aplican en orden y cada uno parte del valor de cada registro. El resultado queda en el historial de ediciones masivas de la lista (con «Deshacer») y estos cambios no vuelven a disparar automatizaciones.')}
            </p>
        </div>
    );
}
