import { useMemo, useState } from 'react';
import { Copy, EyeOff, GitMerge, Loader2, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import {
    DUPLICATE_MAX_RULE_FIELDS,
    DUPLICATE_MAX_RULES,
    MERGE_MAX_RECORDS,
    duplicateRuleLabel,
    isDuplicateRuleFieldType,
    type DuplicateGroup,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { useDismissDuplicates, useDuplicateGroups, useDuplicateSettings, useUpdateDuplicateSettings } from '@/hooks/useDuplicates';
import { __, _n, sprintf } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { CAP, useCan, useCanAny } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { MergeDialog } from './MergeDialog';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    list: { id: number; slug: string; name: string };
    fields: FieldEntity[];
    /** Abrir un registro (la ficha flotante de la lista). */
    onOpenRecord: (id: number) => void;
}

const PAGE = 20;
const PAGE_MAX = 50;

/**
 * A14 (v0.1.445, ADR-S106) — Panel «Duplicados» de una lista: con qué se
 * reconocen (reglas sugeridas o propias), los grupos de posibles duplicados
 * y, por grupo, «Fusionar» o «No son duplicados». Todo con el acceso de quien
 * mira: sólo aparecen registros que puede ver.
 */
export function DuplicatesSheet({ open, onOpenChange, list, fields, onOpenRecord }: Props): JSX.Element {
    const [limit, setLimit] = useState(PAGE);
    const settings = useDuplicateSettings(list.id, open);
    const groups = useDuplicateGroups(list.id, open && settings.data?.enabled !== false, limit);
    const canManage = useCan(CAP.MANAGE_LISTS);
    const canMerge = useCanAny(CAP.DELETE_RECORDS, CAP.DELETE_OWN_RECORDS);
    const canDismiss = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS);
    const [merging, setMerging] = useState<{ ids: number[] } | null>(null);
    const [editingRules, setEditingRules] = useState(false);

    const data = groups.data;
    return (
        <>
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent side="right" className="sm:imcrm-w-[520px]" data-testid="imcrm-duplicates-sheet" data-tour="duplicates-panel">
                    <SheetHeader>
                        <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1 imcrm-pr-8">
                            <SheetTitle className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                <Copy className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                                <span className="imcrm-truncate">{sprintf(__('Duplicados en «%s»'), list.name)}</span>
                            </SheetTitle>
                            <SheetDescription>
                                {__('Registros que parecen ser el mismo. Fusiónalos en uno solo o márcalos como distintos.')}
                            </SheetDescription>
                        </div>
                    </SheetHeader>
                    <SheetBody className="imcrm-flex imcrm-flex-col imcrm-gap-5">
                        {settings.data && (
                            <RulesCard
                                listId={list.id}
                                fields={fields}
                                settings={settings.data}
                                canManage={canManage}
                                editing={editingRules}
                                onEditing={setEditingRules}
                            />
                        )}

                        {settings.data && !settings.data.enabled ? (
                            <p className="imcrm-rounded-md imcrm-bg-muted/50 imcrm-p-3 imcrm-text-sm imcrm-text-muted-foreground">
                                {__('La búsqueda de duplicados está apagada en esta lista.')}
                            </p>
                        ) : groups.isLoading || !data ? (
                            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                                {__('Buscando duplicados…')}
                            </p>
                        ) : (
                            <section className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-duplicate-groups">
                                <h3 className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                    {data.total === 0
                                        ? __('Posibles duplicados')
                                        : sprintf(_n('%s grupo de posibles duplicados', '%s grupos de posibles duplicados', data.total), formatNumber(data.total))}
                                </h3>
                                {data.hidden_rules > 0 && (
                                    <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                                        <EyeOff className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                                        {sprintf(
                                            _n(
                                                '%s regla usa un campo que no ves: no se aplica para ti.',
                                                '%s reglas usan campos que no ves: no se aplican para ti.',
                                                data.hidden_rules,
                                            ),
                                            formatNumber(data.hidden_rules),
                                        )}
                                    </p>
                                )}
                                {data.total === 0 ? (
                                    <div className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-6 imcrm-text-center">
                                        <p className="imcrm-text-sm imcrm-font-medium">{__('No hay duplicados')}</p>
                                        <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">
                                            {data.settings.rules.length === 0
                                                ? __('Elige con qué campos se reconoce un duplicado.')
                                                : sprintf(__('Ningún registro repite %s.'), data.settings.rules.map((r) => duplicateRuleLabel(r, fields)).join(' ni '))}
                                        </p>
                                    </div>
                                ) : (
                                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                                        {data.groups.map((g) => (
                                            <GroupCard
                                                key={g.ids.join('-')}
                                                listId={list.id}
                                                group={g}
                                                canMerge={canMerge}
                                                canDismiss={canDismiss}
                                                onOpenRecord={onOpenRecord}
                                                onMerge={() => setMerging({ ids: g.ids.slice(0, MERGE_MAX_RECORDS) })}
                                            />
                                        ))}
                                    </ul>
                                )}
                                {data.total > data.groups.length &&
                                    (limit < PAGE_MAX ? (
                                        <Button variant="outline" size="sm" onClick={() => setLimit((l) => Math.min(PAGE_MAX, l + PAGE))}>
                                            {sprintf(__('Ver más (%s en total)'), formatNumber(data.total))}
                                        </Button>
                                    ) : (
                                        <p className="imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                                            {__('Se muestran los primeros 50 grupos: fusiona o descarta estos para ver los siguientes.')}
                                        </p>
                                    ))}
                                {data.truncated && (
                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                        {__('La lista tiene muchísimos valores repetidos: se revisó una parte. Ajusta las reglas para que sean más precisas.')}
                                    </p>
                                )}
                            </section>
                        )}
                    </SheetBody>
                </SheetContent>
            </Sheet>
            {merging && (
                <MergeDialog listId={list.id} fields={fields} ids={merging.ids} onClose={() => setMerging(null)} />
            )}
        </>
    );
}

function GroupCard({
    listId,
    group,
    canMerge,
    canDismiss,
    onOpenRecord,
    onMerge,
}: {
    listId: number;
    group: DuplicateGroup;
    canMerge: boolean;
    canDismiss: boolean;
    onOpenRecord: (id: number) => void;
    onMerge: () => void;
}): JSX.Element {
    const dismiss = useDismissDuplicates(listId);
    const toast = useToast();
    const extra = group.ids.length - group.records.length;
    return (
        <li className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3" data-testid="imcrm-duplicate-group">
            <p className="imcrm-mb-2 imcrm-text-xs imcrm-text-muted-foreground">
                {sprintf(__('Mismo %s'), group.matched.map((m) => m.toLowerCase()).join(' o '))}
            </p>
            <ul className="imcrm-divide-y imcrm-divide-border">
                {group.records.map((r) => (
                    <li key={r.id} className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-py-1.5">
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <button
                                type="button"
                                className="imcrm-max-w-full imcrm-truncate imcrm-text-left imcrm-text-sm imcrm-font-medium hover:imcrm-text-primary hover:imcrm-underline"
                                onClick={() => onOpenRecord(r.id)}
                            >
                                {r.title}
                            </button>
                            {r.values.length > 0 && (
                                <p className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{r.values.map((v) => v.value).join(' · ')}</p>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
            {extra > 0 && (
                <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">
                    {sprintf(_n('Y %s más (se fusionan de a 10).', 'Y %s más (se fusionan de a 10).', extra), formatNumber(extra))}
                </p>
            )}
            <div className="imcrm-mt-2 imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                {canMerge && (
                    <Button size="sm" onClick={onMerge} data-testid="imcrm-duplicate-merge">
                        <GitMerge className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Fusionar')}
                    </Button>
                )}
                {canDismiss && (
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={dismiss.isPending}
                        data-testid="imcrm-duplicate-dismiss"
                        onClick={() =>
                            dismiss.mutate(group.ids.slice(0, MERGE_MAX_RECORDS), {
                                onSuccess: () => toast.success(__('Listo: no volverán a aparecer como duplicados')),
                                onError: (err) => toast.error(__('No se pudo guardar'), err instanceof Error ? err.message : undefined),
                            })
                        }
                    >
                        <X className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('No son duplicados')}
                    </Button>
                )}
            </div>
        </li>
    );
}

function RulesCard({
    listId,
    fields,
    settings,
    canManage,
    editing,
    onEditing,
}: {
    listId: number;
    fields: FieldEntity[];
    settings: { enabled: boolean; warn_on_create: boolean; rules: number[][]; custom: boolean };
    canManage: boolean;
    editing: boolean;
    onEditing: (v: boolean) => void;
}): JSX.Element {
    const update = useUpdateDuplicateSettings(listId);
    const toast = useToast();
    const eligible = useMemo(() => fields.filter((f) => isDuplicateRuleFieldType(f.type)), [fields]);
    const [draft, setDraft] = useState<number[][]>(settings.rules);

    const save = (input: Parameters<typeof update.mutate>[0], ok?: string): void =>
        update.mutate(input, {
            onSuccess: () => {
                if (ok) toast.success(ok);
                onEditing(false);
            },
            onError: (err) => toast.error(__('No se pudo guardar'), err instanceof Error ? err.message : undefined),
        });

    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3" data-tour="duplicates-rules">
            <Toggle
                label={__('Buscar duplicados en esta lista')}
                hint={__('Si lo apagas, esta lista no agrupa ni avisa nada.')}
                checked={settings.enabled}
                disabled={!canManage || update.isPending}
                onChange={(v) => save({ enabled: v })}
                testId="imcrm-duplicates-enabled"
            />
            {settings.enabled && (
                <Toggle
                    label={__('Avisar al crear un registro')}
                    hint={__('Mientras se escribe, dice si ya existe uno igual.')}
                    checked={settings.warn_on_create}
                    disabled={!canManage || update.isPending}
                    onChange={(v) => save({ warn_on_create: v })}
                    testId="imcrm-duplicates-warn"
                />
            )}
            {settings.enabled && !editing && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <p className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">
                        {settings.custom ? __('Se reconocen por (reglas propias):') : __('Se reconocen por (sugerido):')}
                    </p>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5" data-testid="imcrm-duplicate-rules">
                        {settings.rules.length === 0 ? (
                            <span className="imcrm-text-sm imcrm-text-muted-foreground">{__('Ningún campo todavía.')}</span>
                        ) : (
                            settings.rules.map((r) => (
                                <span key={r.join('+')} className="imcrm-rounded-full imcrm-bg-muted imcrm-px-2.5 imcrm-py-0.5 imcrm-text-xs imcrm-font-medium">
                                    {duplicateRuleLabel(r, fields)}
                                </span>
                            ))
                        )}
                    </div>
                    {canManage && (
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                            <Button
                                size="sm"
                                variant="ghost"
                                className="imcrm-self-start imcrm-px-2"
                                onClick={() => {
                                    setDraft(settings.rules.length > 0 ? settings.rules : [[]]);
                                    onEditing(true);
                                }}
                                data-testid="imcrm-duplicate-rules-edit"
                            >
                                {__('Cambiar con qué se reconocen')}
                            </Button>
                            {settings.custom && (
                                <Button size="sm" variant="ghost" className="imcrm-px-2" onClick={() => save({ rules: null }, __('Volviste a las reglas sugeridas'))}>
                                    <RotateCcw className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Volver a las sugeridas')}
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            )}
            {settings.enabled && editing && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="imcrm-duplicate-rules-editor">
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Cada regla es un dato (o varios a la vez) que si se repite, es un duplicado. Basta con que coincida UNA regla.')}
                    </p>
                    {draft.map((rule, i) => (
                        <div key={i} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-muted/40 imcrm-p-2">
                            {[...rule, ...(rule.length < DUPLICATE_MAX_RULE_FIELDS ? [0] : [])].map((fid, j) => (
                                <div key={j} className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                    {j > 0 && <span className="imcrm-text-xs imcrm-text-muted-foreground">+</span>}
                                    <Select
                                        className="imcrm-h-8 imcrm-w-40"
                                        value={fid > 0 ? String(fid) : ''}
                                        aria-label={sprintf(__('Campo %s de la regla %s'), String(j + 1), String(i + 1))}
                                        onChange={(e) => {
                                            const v = Number(e.target.value);
                                            setDraft((prev) =>
                                                prev.map((r, ri) => {
                                                    if (ri !== i) return r;
                                                    const next = [...r];
                                                    if (v > 0) next[j] = v;
                                                    else next.splice(j, 1);
                                                    return [...new Set(next.filter((x) => x > 0))];
                                                }),
                                            );
                                        }}
                                    >
                                        <option value="">{j === 0 ? __('Elige un campo') : __('+ otro campo (opcional)')}</option>
                                        {eligible.map((f) => (
                                            <option key={f.id} value={f.id}>
                                                {f.label}
                                            </option>
                                        ))}
                                    </Select>
                                </div>
                            ))}
                            <button
                                type="button"
                                aria-label={__('Quitar la regla')}
                                className="imcrm-ml-auto imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-destructive"
                                onClick={() => setDraft((prev) => prev.filter((_, ri) => ri !== i))}
                            >
                                <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            </button>
                        </div>
                    ))}
                    {draft.length < DUPLICATE_MAX_RULES && (
                        <Button size="sm" variant="ghost" className="imcrm-self-start imcrm-px-2" onClick={() => setDraft((prev) => [...prev, []])}>
                            <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Agregar regla')}
                        </Button>
                    )}
                    <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                        <Button size="sm" variant="ghost" onClick={() => onEditing(false)}>
                            {__('Cancelar')}
                        </Button>
                        <Button
                            size="sm"
                            disabled={update.isPending}
                            data-testid="imcrm-duplicate-rules-save"
                            onClick={() => save({ rules: draft.filter((r) => r.length > 0).map((r) => ({ fields: r })) }, __('Reglas guardadas'))}
                        >
                            {__('Guardar')}
                        </Button>
                    </div>
                </div>
            )}
        </section>
    );
}

function Toggle({
    label,
    hint,
    checked,
    disabled,
    onChange,
    testId,
}: {
    label: string;
    hint: string;
    checked: boolean;
    disabled: boolean;
    onChange: (v: boolean) => void;
    testId: string;
}): JSX.Element {
    return (
        <label className={cn('imcrm-flex imcrm-items-start imcrm-gap-3', disabled ? 'imcrm-opacity-70' : 'imcrm-cursor-pointer')}>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                disabled={disabled}
                data-testid={testId}
                onClick={() => onChange(!checked)}
                className={cn(
                    'imcrm-relative imcrm-mt-0.5 imcrm-inline-flex imcrm-h-5 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-rounded-full imcrm-transition-colors',
                    checked ? 'imcrm-bg-primary' : 'imcrm-bg-muted-foreground/30',
                )}
            >
                <span
                    className={cn(
                        'imcrm-inline-block imcrm-h-4 imcrm-w-4 imcrm-rounded-full imcrm-bg-white imcrm-shadow imcrm-transition-transform',
                        checked ? 'imcrm-translate-x-4' : 'imcrm-translate-x-0.5',
                    )}
                />
            </button>
            <span className="imcrm-min-w-0">
                <span className="imcrm-block imcrm-text-sm imcrm-font-medium">{label}</span>
                <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{hint}</span>
            </span>
        </label>
    );
}
