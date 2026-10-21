import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { CornerDownRight, ListTree, Loader2, Plus } from 'lucide-react';
import { pickStatusField } from '@imagina-base/shared';

import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useCreateRecord, useRecord, useRecords } from '@/hooks/useRecords';
import { subtasksQuery } from '@/hooks/useRecordView';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import { titleFieldOf } from '@/lib/recordTitle';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { FieldValueDisplay } from './crm/FieldValueDisplay';
import { useStoreRules } from './storeRules';

interface RecordSubtasksProps {
    listId: number;
    listSlug: string;
    record: RecordEntity;
    fields: FieldEntity[];
    /**
     * Abrir una subtarea (o el padre) DENTRO de la misma superficie — el modal
     * cambia de registro. Sin esto se navega a la página del registro.
     */
    onOpenRecord?: (id: number) => void;
    className?: string;
}

function titleOf(record: RecordEntity | undefined, titleField: FieldEntity | undefined): string {
    if (!record) return '';
    const v = titleField ? record.fields[titleField.slug] : undefined;
    return typeof v === 'string' && v.trim() !== '' ? v : sprintf(/* translators: %d: record id */ __('Registro #%d'), record.id);
}

/**
 * Subtareas dentro de la ficha (v0.1.132 dio el modelo; faltaba verlas en el
 * registro): la lista de hijas con su estado, alta en línea y, si el registro
 * ES una subtarea, el vínculo a su padre. Un solo nivel, como en la tabla.
 */
export function RecordSubtasks({ listId, listSlug, record, fields, onOpenRecord, className }: RecordSubtasksProps): JSX.Element | null {
    const titleField = useMemo(() => titleFieldOf(fields), [fields]);
    const statusField = useMemo(() => pickStatusField(fields), [fields]);
    const storeRules = useStoreRules();
    const canCreate = useCan(CAP.CREATE_RECORDS) && !storeRules;
    const isSubtask = record.parent_id !== null && record.parent_id !== undefined;
    const parent = useRecord(isSubtask ? listId : undefined, isSubtask ? (record.parent_id as number) : undefined);
    const children = useRecords(isSubtask ? undefined : listId, subtasksQuery(record.id));
    const create = useCreateRecord(listId);
    const toast = useToast();
    const [draft, setDraft] = useState('');
    const [adding, setAdding] = useState(false);

    const open = (id: number, label: string): JSX.Element =>
        onOpenRecord ? (
            <button
                type="button"
                onClick={() => onOpenRecord(id)}
                className="imcrm-min-w-0 imcrm-truncate imcrm-text-left imcrm-font-medium hover:imcrm-underline"
            >
                {label}
            </button>
        ) : (
            <Link to={`/lists/${listSlug}/records/${id}`} className="imcrm-min-w-0 imcrm-truncate imcrm-font-medium hover:imcrm-underline">
                {label}
            </Link>
        );

    if (isSubtask) {
        return (
            <p
                className={cn('imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-text-[13px] imcrm-text-muted-foreground', className)}
                data-testid="imcrm-record-parent"
            >
                <CornerDownRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                <span className="imcrm-shrink-0">{__('Subtarea de')}</span>
                {parent.data ? open(parent.data.id, titleOf(parent.data, titleField)) : <span>#{record.parent_id}</span>}
            </p>
        );
    }

    const rows = children.data?.data ?? [];
    const total = children.data?.meta.total ?? rows.length;
    if (!children.isLoading && rows.length === 0 && !canCreate) return null;

    const submit = async (): Promise<void> => {
        const clean = draft.trim();
        if (clean === '') return;
        try {
            await create.mutateAsync({ values: titleField ? { [titleField.slug]: clean } : {}, parentId: record.id });
            setDraft('');
        } catch (err) {
            toast.error(__('No se pudo crear la subtarea'), err instanceof ApiError || err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <section className={cn('imcrm-flex imcrm-flex-col imcrm-gap-1.5', className)} data-testid="imcrm-record-subtasks">
            <h3 className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                <ListTree className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                {__('Subtareas')}
                {total > 0 && <span className="imcrm-font-normal imcrm-normal-case imcrm-text-muted-foreground/70">{total}</span>}
            </h3>
            {children.isLoading ? (
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-muted-foreground" />
            ) : (
                rows.length > 0 && (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-rounded-md imcrm-border imcrm-border-border">
                        {rows.map((r) => (
                            <li
                                key={r.id}
                                className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border/60 imcrm-px-3 imcrm-py-1.5 imcrm-text-sm last:imcrm-border-b-0"
                                data-testid="imcrm-subtask-row"
                            >
                                <CornerDownRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1">{open(r.id, titleOf(r, titleField))}</span>
                                {statusField && r.fields[statusField.slug] !== undefined && r.fields[statusField.slug] !== null && (
                                    <span className="imcrm-shrink-0">
                                        <FieldValueDisplay field={statusField} value={r.fields[statusField.slug]} />
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                )
            )}
            {total > rows.length && (
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {sprintf(__('Mostrando %1$s de %2$s.'), formatNumber(rows.length), formatNumber(total))}
                </p>
            )}
            {canCreate &&
                (adding ? (
                    <form
                        className="imcrm-flex imcrm-items-center imcrm-gap-2"
                        onSubmit={(e) => {
                            e.preventDefault();
                            void submit();
                        }}
                    >
                        <Input
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape' && draft === '') setAdding(false);
                            }}
                            placeholder={__('Nombre de la subtarea y Enter')}
                            className="imcrm-h-8 imcrm-text-sm"
                            aria-label={__('Nueva subtarea')}
                            disabled={create.isPending}
                        />
                        {create.isPending && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-animate-spin imcrm-text-muted-foreground" />}
                    </form>
                ) : (
                    <button
                        type="button"
                        onClick={() => setAdding(true)}
                        className="imcrm-flex imcrm-w-fit imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-1.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                        data-testid="imcrm-subtask-add"
                    >
                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Agregar subtarea')}
                    </button>
                ))}
        </section>
    );
}
