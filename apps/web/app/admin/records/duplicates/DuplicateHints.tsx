import { Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Copy, GitMerge, X } from 'lucide-react';
import { duplicateKey } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useDismissDuplicates, useDuplicateCheck, useDuplicateSettings, useRecordDuplicates } from '@/hooks/useDuplicates';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCanAny } from '@/lib/permissions';
import { lazyWithReload } from '@/lib/lazyWithReload';
import type { FieldEntity } from '@/types/field';

const MergeDialog = lazyWithReload(() => import('./MergeDialog').then((m) => ({ default: m.MergeDialog })));

/** «Mismo correo o teléfono». */
function sameText(matched: string[]): string {
    return sprintf(__('mismo %s'), matched.map((m) => m.toLowerCase()).join(' o '));
}

/**
 * La firma de lo que se está escribiendo: las claves de los campos de las
 * reglas. Vacía cuando no hay nada que comparar (no se pregunta).
 */
export function duplicateSignature(rules: number[][], fields: FieldEntity[], values: Record<string, unknown>): string {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const parts: string[] = [];
    for (const rule of rules) {
        const keys = rule.map((id) => {
            const f = byId.get(id);
            return f ? duplicateKey(f.type, values[f.slug]) : '';
        });
        if (keys.length > 0 && keys.every((k) => k !== '')) parts.push(`${rule.join('+')}=${keys.join('|')}`);
    }
    return parts.join(';');
}

/**
 * A14 (v0.1.445) — En el alta: mientras se escribe, si ya existe un registro
 * con el mismo correo, teléfono, documento… (las reglas de la lista), lo dice
 * con un enlace para abrirlo. No bloquea: puede ser a propósito.
 */
export function CreateDuplicateHint({
    listId,
    listSlug,
    fields,
    values,
}: {
    listId: number;
    listSlug?: string;
    fields: FieldEntity[];
    values: Record<string, unknown>;
}): JSX.Element | null {
    const settings = useDuplicateSettings(listId);
    const rules = useMemo(
        () => (settings.data?.enabled && settings.data.warn_on_create ? settings.data.rules : []),
        [settings.data],
    );
    const signature = useMemo(() => duplicateSignature(rules, fields, values), [rules, fields, values]);
    // Debounce: no se pregunta en cada tecla.
    const [debounced, setDebounced] = useState('');
    useEffect(() => {
        const t = window.setTimeout(() => setDebounced(signature), 450);
        return () => window.clearTimeout(t);
    }, [signature]);
    const ruleSlugs = useMemo(() => {
        const ids = new Set(rules.flat());
        return fields.filter((f) => ids.has(f.id)).map((f) => f.slug);
    }, [rules, fields]);
    const payload = useMemo(() => Object.fromEntries(ruleSlugs.map((s) => [s, values[s] ?? null])), [ruleSlugs, values]);
    const check = useDuplicateCheck(listId, debounced === signature ? payload : null, debounced === signature ? debounced : '');
    const hits = debounced !== '' && debounced === signature ? (check.data ?? []) : [];
    if (hits.length === 0) return null;
    return (
        <div
            className="imcrm-mt-3 imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-amber-300/70 imcrm-bg-amber-50 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-amber-900 dark:imcrm-border-amber-500/30 dark:imcrm-bg-amber-500/10 dark:imcrm-text-amber-100"
            role="status"
            data-testid="imcrm-create-duplicate-hint"
        >
            <Copy className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
            <div className="imcrm-min-w-0">
                <p className="imcrm-font-medium">{hits.length === 1 ? __('Ya existe un registro parecido') : __('Ya existen registros parecidos')}</p>
                <ul className="imcrm-mt-0.5 imcrm-space-y-0.5">
                    {hits.map((h) => (
                        <li key={h.id} className="imcrm-truncate">
                            {listSlug ? (
                                <Link to={`/lists/${listSlug}/records/${h.id}`} target="_blank" rel="noopener" className="imcrm-font-medium imcrm-underline imcrm-underline-offset-2">
                                    {h.title}
                                </Link>
                            ) : (
                                <span className="imcrm-font-medium">{h.title}</span>
                            )}{' '}
                            <span className="imcrm-text-xs imcrm-opacity-80">({sameText(h.matched)})</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

/**
 * A14 (v0.1.445) — En la ficha: «Posible duplicado de X (mismo correo)» con
 * «Fusionar» y «No es duplicado». Sin coincidencias no ocupa lugar.
 */
export function RecordDuplicateBanner({
    listId,
    listSlug,
    recordId,
    fields,
    onOpenRecord,
    className,
}: {
    listId: number;
    listSlug?: string;
    recordId: number;
    fields: FieldEntity[];
    onOpenRecord?: (id: number) => void;
    className?: string;
}): JSX.Element | null {
    const q = useRecordDuplicates(listId, recordId);
    const dismiss = useDismissDuplicates(listId);
    const toast = useToast();
    const canMerge = useCanAny(CAP.DELETE_RECORDS, CAP.DELETE_OWN_RECORDS);
    const canDismiss = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS);
    const [merging, setMerging] = useState(false);
    const hits = q.data ?? [];
    if (hits.length === 0) return null;
    const ids = [recordId, ...hits.map((h) => h.id)].slice(0, 10);
    return (
        <div
            className={
                'imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-2 imcrm-rounded-md imcrm-border imcrm-border-amber-300/70 imcrm-bg-amber-50 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-amber-900 dark:imcrm-border-amber-500/30 dark:imcrm-bg-amber-500/10 dark:imcrm-text-amber-100 ' +
                (className ?? '')
            }
            data-testid="imcrm-record-duplicate-banner"
            data-tour="record-duplicates"
        >
            <Copy className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-self-start imcrm-mt-0.5" aria-hidden />
            <p className="imcrm-min-w-[12rem] imcrm-flex-1">
                {hits.length === 1 ? __('Posible duplicado de') : __('Posibles duplicados:')}{' '}
                {hits.map((h, i) => (
                    <span key={h.id}>
                        {i > 0 && ', '}
                        {onOpenRecord ? (
                            <button type="button" className="imcrm-font-medium imcrm-underline imcrm-underline-offset-2" onClick={() => onOpenRecord(h.id)}>
                                {h.title}
                            </button>
                        ) : listSlug ? (
                            <Link to={`/lists/${listSlug}/records/${h.id}`} className="imcrm-font-medium imcrm-underline imcrm-underline-offset-2">
                                {h.title}
                            </Link>
                        ) : (
                            <span className="imcrm-font-medium">{h.title}</span>
                        )}{' '}
                        <span className="imcrm-text-xs imcrm-opacity-80">({sameText(h.matched)})</span>
                    </span>
                ))}
            </p>
            <div className="imcrm-flex imcrm-shrink-0 imcrm-gap-1.5">
                {canMerge && (
                    <Button size="sm" variant="outline" className="imcrm-h-7 imcrm-bg-background" onClick={() => setMerging(true)} data-testid="imcrm-record-duplicate-merge">
                        <GitMerge className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Fusionar')}
                    </Button>
                )}
                {canDismiss && (
                    <Button
                        size="sm"
                        variant="ghost"
                        className="imcrm-h-7"
                        disabled={dismiss.isPending}
                        data-testid="imcrm-record-duplicate-dismiss"
                        onClick={() =>
                            dismiss.mutate(ids, {
                                onSuccess: () => toast.success(hits.length === 1 ? __('Listo: no es un duplicado') : __('Listo: no son duplicados')),
                                onError: (err) => toast.error(__('No se pudo guardar'), err instanceof Error ? err.message : undefined),
                            })
                        }
                    >
                        <X className="imcrm-h-3.5 imcrm-w-3.5" />
                        {hits.length === 1 ? __('No es duplicado') : __('No son duplicados')}
                    </Button>
                )}
            </div>
            {merging && (
                <Suspense fallback={null}>
                <MergeDialog
                    listId={listId}
                    fields={fields}
                    ids={ids}
                    initialPrimaryId={recordId}
                    onClose={() => setMerging(false)}
                    onMerged={(primaryId, mergedIds) => {
                        // Si este registro se fue a la papelera, se abre el que quedó.
                        if (mergedIds.includes(recordId)) onOpenRecord?.(primaryId);
                    }}
                />
                </Suspense>
            )}
        </div>
    );
}
