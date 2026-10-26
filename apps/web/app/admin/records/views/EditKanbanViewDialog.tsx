import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { KANBAN_NULL_KEY, type KanbanSettings } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useFields } from '@/hooks/useFields';
import { useUpdateSavedView } from '@/hooks/useSavedViews';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { SavedViewEntity } from '@/types/view';

import { extractFieldOptions } from '../fieldOptions';
import { FieldChecklist, requirableFields } from './kanban/KanbanColumnSettingsDialog';
import { isValueCandidate } from './kanban/kanbanModel';
import { kanbanToViewConfig, viewConfigToKanban } from './savedViewMapping';

interface EditKanbanViewDialogProps {
    listId: number;
    view: SavedViewEntity;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/** Tipos por los que se arman las columnas del kanban. */
const GROUP_BY_TYPES = ['select', 'user', 'team', 'checkbox'] as const;
/** Tipos de los carriles. */
const LANE_TYPES = ['select', 'user', 'team', 'checkbox'] as const;

type SortChoice = { fieldId: number; dir: 'asc' | 'desc' } | null;

/**
 * «Configurar tablero» — v0.1.297 Kanban para ventas (B5). Todo lo del tablero en
 * un solo lugar: columnas y carriles, el total por columna (suma o promedio de
 * un campo numérico), el orden de las tarjetas, qué muestra cada tarjeta
 * (título, campos, portada, tamaño) y, por columna, si se ve, su límite de
 * tarjetas y qué campos pide al mover una tarjeta ahí.
 *
 * CRÍTICO: el `useEffect` de re-init sólo depende de `[open, view.id]` — no
 * de `view` ni `update` (objetos que cambian de identidad en cada render →
 * resetearían lo que la persona está editando).
 */
export function EditKanbanViewDialog({ listId, view, open, onOpenChange }: EditKanbanViewDialogProps): JSX.Element {
    const update = useUpdateSavedView(listId);
    const fieldsQuery = useFields(listId);
    const allFields = useMemo(() => fieldsQuery.data ?? [], [fieldsQuery.data]);

    const [name, setName] = useState(view.name);
    const [groupByFieldId, setGroupByFieldId] = useState<number>(view.config.group_by_field_id ?? 0);
    const [settings, setSettings] = useState<KanbanSettings>(() => viewConfigToKanban(view.config));
    const [sort, setSort] = useState<SortChoice>(null);
    const [wipDrafts, setWipDrafts] = useState<Record<string, string>>({});
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setName(view.name);
        setGroupByFieldId(view.config.group_by_field_id ?? 0);
        const s = viewConfigToKanban(view.config);
        setSettings(s);
        const first = view.config.sort?.[0];
        setSort(first ? { fieldId: first.field_id, dir: first.dir } : null);
        setWipDrafts(Object.fromEntries(Object.entries(s.wipLimits).map(([k, n]) => [k, String(n)])));
        setError(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, view.id]);

    useEffect(() => {
        if (!open) update.reset();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const patch = (p: Partial<KanbanSettings>): void => setSettings((prev) => ({ ...prev, ...p }));

    const groupField = allFields.find((f) => f.id === groupByFieldId);
    const groupByCandidates = allFields.filter((f) => (GROUP_BY_TYPES as readonly string[]).includes(f.type) || f.id === groupByFieldId);
    const laneCandidates = allFields.filter((f) => (LANE_TYPES as readonly string[]).includes(f.type) && f.id !== groupByFieldId);
    const valueCandidates = allFields.filter(isValueCandidate);
    const titleCandidates = allFields.filter((f) => f.id !== groupByFieldId && (f.type === 'text' || f.type === 'email' || f.is_primary));
    // El título ya se ve arriba de la tarjeta: no se ofrece otra vez como campo.
    const metaCandidates = allFields.filter(
        (f) =>
            f.id !== groupByFieldId &&
            (settings.titleFieldId !== null ? f.id !== settings.titleFieldId : !f.is_primary) &&
            f.type !== 'long_text' &&
            f.type !== 'relation' &&
            f.type !== 'button',
    );
    const coverCandidates = allFields.filter((f) => f.type === 'file' || f.type === 'url');
    const sortCandidates = allFields.filter((f) => !['relation', 'file', 'long_text', 'button'].includes(f.type));

    // Columnas conocidas del campo (catálogo de un select; Sí/No de una casilla).
    const knownColumns = useMemo(() => columnsOf(groupField), [groupField]);
    // Las que tienen ajustes guardados aunque no estén en el catálogo (valores sueltos, personas).
    const extraColumns = useMemo(() => {
        const keys = new Set([
            ...Object.keys(settings.wipLimits),
            ...Object.keys(settings.moveRules),
            ...settings.hiddenColumns,
        ]);
        return [...keys].filter((k) => !knownColumns.some((c) => c.key === k)).map((k) => ({ key: k, label: k === KANBAN_NULL_KEY ? __('Sin valor') : k }));
    }, [knownColumns, settings]);
    const columnRows = [...knownColumns, ...extraColumns];
    const [rulesFor, setRulesFor] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setError(null);
        if (groupByFieldId === 0) {
            setError(__('Elige el campo de las columnas.'));
            return;
        }
        const wipLimits: Record<string, number> = {};
        for (const [k, raw] of Object.entries(wipDrafts)) {
            const t = raw.trim();
            if (t === '') continue;
            const n = Number(t);
            if (!Number.isInteger(n) || n < 1 || n > 10_000) {
                setError(sprintf(__('El límite de «%s» tiene que ser un número entero entre 1 y 10.000.'), columnRows.find((c) => c.key === k)?.label ?? k));
                return;
            }
            wipLimits[k] = n;
        }
        // Cambiar el campo de las columnas deja sin sentido lo que estaba por columna.
        const groupChanged = groupByFieldId !== (view.config.group_by_field_id ?? 0);
        const next: KanbanSettings = {
            ...settings,
            laneFieldId: settings.laneFieldId === groupByFieldId ? null : settings.laneFieldId,
            wipLimits: groupChanged ? {} : wipLimits,
            moveRules: groupChanged ? {} : settings.moveRules,
            collapsedColumns: groupChanged ? [] : settings.collapsedColumns,
            hiddenColumns: groupChanged ? [] : settings.hiddenColumns,
        };
        try {
            await update.mutateAsync({
                id: view.id,
                name: name.trim() || view.name,
                config: {
                    ...kanbanToViewConfig(view.config, next),
                    group_by_field_id: groupByFieldId,
                    sort: sort ? [{ field_id: sort.fieldId, dir: sort.dir }] : [],
                },
            });
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    const toggleMeta = (id: number): void =>
        patch({ metaFieldIds: settings.metaFieldIds.includes(id) ? settings.metaFieldIds.filter((x) => x !== id) : [...settings.metaFieldIds, id] });
    const moveMeta = (id: number, dir: -1 | 1): void => {
        const prev = settings.metaFieldIds;
        const idx = prev.indexOf(id);
        const target = idx + dir;
        if (idx < 0 || target < 0 || target >= prev.length) return;
        const next = [...prev];
        [next[idx], next[target]] = [next[target]!, next[idx]!];
        patch({ metaFieldIds: next });
    };
    const fieldLabel = (id: number): string => allFields.find((f) => f.id === id)?.label ?? `#${id}`;

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-2xl',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg sm:imcrm-p-6',
                        'imcrm-max-h-[88vh] imcrm-overflow-y-auto',
                    )}
                    data-testid="imcrm-kanban-settings-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Configurar tablero')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Columnas, carriles, totales, tarjetas y reglas de cada columna.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <form onSubmit={handleSubmit} className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-6">
                        <Section title={__('General')}>
                            <Row label={__('Nombre')} htmlFor="kanban-name">
                                <Input id="kanban-name" value={name} onChange={(e) => setName(e.target.value)} />
                            </Row>
                            <Row label={__('Columnas por')} htmlFor="kanban-groupby" hint={groupByCandidates.length === 0 ? __('Necesitas un campo de selección, de persona o una casilla.') : undefined}>
                                <Select id="kanban-groupby" value={groupByFieldId} onChange={(e) => setGroupByFieldId(Number(e.target.value))}>
                                    <option value="0">{__('— Elegir campo —')}</option>
                                    {groupByCandidates.map((f) => (
                                        <option key={f.id} value={f.id}>
                                            {f.label}
                                        </option>
                                    ))}
                                </Select>
                            </Row>
                            <Row label={__('Carriles por')} htmlFor="kanban-lanes" hint={__('Filas horizontales por un segundo campo (p. ej. vendedor o prioridad). Arrastrar entre carriles cambia los dos campos.')}>
                                <Select
                                    id="kanban-lanes"
                                    value={settings.laneFieldId ?? ''}
                                    onChange={(e) => patch({ laneFieldId: e.target.value === '' ? null : Number(e.target.value), collapsedLanes: [] })}
                                >
                                    <option value="">{__('Sin carriles')}</option>
                                    {laneCandidates.map((f) => (
                                        <option key={f.id} value={f.id}>
                                            {f.label}
                                        </option>
                                    ))}
                                </Select>
                            </Row>
                            <Row label={__('Total por columna')} htmlFor="kanban-value" hint={__('Se calcula sobre todos los registros de la vista (filtros y búsqueda incluidos), no sólo sobre las tarjetas cargadas.')}>
                                <div className="imcrm-flex imcrm-gap-2">
                                    <Select
                                        id="kanban-value"
                                        value={settings.valueFieldId ?? ''}
                                        onChange={(e) => patch({ valueFieldId: e.target.value === '' ? null : Number(e.target.value) })}
                                        className="imcrm-flex-1"
                                    >
                                        <option value="">{__('Sólo la cantidad de tarjetas')}</option>
                                        {valueCandidates.map((f) => (
                                            <option key={f.id} value={f.id}>
                                                {f.label}
                                            </option>
                                        ))}
                                    </Select>
                                    <Select
                                        aria-label={__('Cálculo')}
                                        value={settings.valueMetric}
                                        onChange={(e) => patch({ valueMetric: e.target.value === 'avg' ? 'avg' : 'sum' })}
                                        disabled={settings.valueFieldId === null}
                                        className="imcrm-w-32"
                                    >
                                        <option value="sum">{__('Suma')}</option>
                                        <option value="avg">{__('Promedio')}</option>
                                    </Select>
                                </div>
                            </Row>
                            <Row label={__('Ordenar tarjetas por')} htmlFor="kanban-sort">
                                <div className="imcrm-flex imcrm-gap-2">
                                    <Select
                                        id="kanban-sort"
                                        value={sort?.fieldId ?? ''}
                                        onChange={(e) => setSort(e.target.value === '' ? null : { fieldId: Number(e.target.value), dir: sort?.dir ?? 'asc' })}
                                        className="imcrm-flex-1"
                                    >
                                        <option value="">{__('Actualizadas recientemente primero')}</option>
                                        {sortCandidates.map((f) => (
                                            <option key={f.id} value={f.id}>
                                                {f.label}
                                            </option>
                                        ))}
                                    </Select>
                                    <Select
                                        aria-label={__('Dirección')}
                                        value={sort?.dir ?? 'asc'}
                                        onChange={(e) => sort && setSort({ ...sort, dir: e.target.value === 'desc' ? 'desc' : 'asc' })}
                                        disabled={sort === null}
                                        className="imcrm-w-32"
                                    >
                                        <option value="asc">{__('Ascendente')}</option>
                                        <option value="desc">{__('Descendente')}</option>
                                    </Select>
                                </div>
                            </Row>
                        </Section>

                        <Section title={__('Tarjetas')}>
                            <Row label={__('Título')} htmlFor="kanban-title">
                                <Select
                                    id="kanban-title"
                                    value={settings.titleFieldId ?? ''}
                                    onChange={(e) => patch({ titleFieldId: e.target.value === '' ? null : Number(e.target.value) })}
                                >
                                    <option value="">{__('Automático (el título de la lista)')}</option>
                                    {titleCandidates.map((f) => (
                                        <option key={f.id} value={f.id}>
                                            {f.label}
                                        </option>
                                    ))}
                                </Select>
                            </Row>
                            <Row label={__('Portada')} htmlFor="kanban-cover" hint={__('Una imagen arriba de la tarjeta: un campo de archivo o un enlace de imagen.')}>
                                <Select
                                    id="kanban-cover"
                                    value={settings.coverFieldId ?? ''}
                                    onChange={(e) => patch({ coverFieldId: e.target.value === '' ? null : Number(e.target.value) })}
                                >
                                    <option value="">{__('Sin portada')}</option>
                                    {coverCandidates.map((f) => (
                                        <option key={f.id} value={f.id}>
                                            {f.label}
                                        </option>
                                    ))}
                                </Select>
                            </Row>
                            <Row label={__('Tamaño')}>
                                <div className="imcrm-inline-flex imcrm-self-start imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-0.5" role="radiogroup">
                                    {(['normal', 'compact'] as const).map((size) => (
                                        <button
                                            key={size}
                                            type="button"
                                            role="radio"
                                            aria-checked={settings.cardSize === size}
                                            onClick={() => patch({ cardSize: size })}
                                            className={cn(
                                                'imcrm-rounded-md imcrm-px-3 imcrm-py-1 imcrm-text-xs imcrm-font-medium',
                                                settings.cardSize === size ? 'imcrm-bg-primary imcrm-text-primary-foreground' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                                            )}
                                        >
                                            {size === 'normal' ? __('Normal') : __('Compacta')}
                                        </button>
                                    ))}
                                </div>
                            </Row>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label>{__('Campos visibles en la tarjeta')}</Label>
                                {settings.metaFieldIds.length > 0 && (
                                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-2">
                                        {settings.metaFieldIds.map((id, i) => (
                                            <li key={id} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-bg-card imcrm-px-2 imcrm-py-1 imcrm-text-xs">
                                                <span className="imcrm-flex-1 imcrm-truncate">{fieldLabel(id)}</span>
                                                <button type="button" onClick={() => moveMeta(id, -1)} disabled={i === 0} className="imcrm-text-muted-foreground hover:imcrm-text-foreground disabled:imcrm-opacity-30" title={__('Subir')}>
                                                    <ArrowUp className="imcrm-h-3 imcrm-w-3" />
                                                </button>
                                                <button type="button" onClick={() => moveMeta(id, 1)} disabled={i === settings.metaFieldIds.length - 1} className="imcrm-text-muted-foreground hover:imcrm-text-foreground disabled:imcrm-opacity-30" title={__('Bajar')}>
                                                    <ArrowDown className="imcrm-h-3 imcrm-w-3" />
                                                </button>
                                                <button type="button" onClick={() => toggleMeta(id)} className="imcrm-text-muted-foreground hover:imcrm-text-destructive" title={__('Quitar')}>
                                                    <X className="imcrm-h-3 imcrm-w-3" />
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-1.5 sm:imcrm-grid-cols-3">
                                    {metaCandidates
                                        .filter((f) => !settings.metaFieldIds.includes(f.id))
                                        .map((f) => (
                                            <button
                                                key={f.id}
                                                type="button"
                                                onClick={() => toggleMeta(f.id)}
                                                className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-2 imcrm-py-1 imcrm-text-left imcrm-text-xs hover:imcrm-border-primary hover:imcrm-bg-accent/40"
                                            >
                                                <span className="imcrm-truncate">+ {f.label}</span>
                                            </button>
                                        ))}
                                </div>
                                {settings.metaFieldIds.length === 0 && (
                                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Sin elegir, la tarjeta muestra los primeros campos de la lista.')}</p>
                                )}
                            </div>
                        </Section>

                        <Section title={__('Columnas')}>
                            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                <input
                                    type="checkbox"
                                    checked={settings.hideEmpty}
                                    onChange={(e) => patch({ hideEmpty: e.target.checked })}
                                    className="imcrm-h-4 imcrm-w-4 imcrm-accent-[hsl(var(--imcrm-primary))]"
                                    data-testid="imcrm-kanban-hide-empty"
                                />
                                {__('Ocultar las columnas y carriles sin tarjetas')}
                            </label>
                            {columnRows.length > 0 ? (
                                <div className="imcrm-overflow-x-auto">
                                    <table className="imcrm-w-full imcrm-text-sm">
                                        <thead>
                                            <tr className="imcrm-text-left imcrm-text-[11px] imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                                <th className="imcrm-py-1.5 imcrm-pr-2 imcrm-font-medium">{__('Columna')}</th>
                                                <th className="imcrm-py-1.5 imcrm-pr-2 imcrm-font-medium">{__('Visible')}</th>
                                                <th className="imcrm-py-1.5 imcrm-pr-2 imcrm-font-medium">{__('Límite')}</th>
                                                <th className="imcrm-py-1.5 imcrm-font-medium">{__('Al mover aquí, pedir')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {columnRows.map((col) => {
                                                const hidden = settings.hiddenColumns.includes(col.key);
                                                const req = settings.moveRules[col.key] ?? [];
                                                return (
                                                    <tr key={col.key} className="imcrm-border-t imcrm-border-border/60 imcrm-align-top" data-testid="imcrm-kanban-settings-column" data-column={col.key}>
                                                        <td className="imcrm-py-2 imcrm-pr-2 imcrm-font-medium">{col.label}</td>
                                                        <td className="imcrm-py-2 imcrm-pr-2">
                                                            <input
                                                                type="checkbox"
                                                                aria-label={sprintf(__('Mostrar «%s»'), col.label)}
                                                                checked={!hidden}
                                                                onChange={() =>
                                                                    patch({
                                                                        hiddenColumns: hidden ? settings.hiddenColumns.filter((k) => k !== col.key) : [...settings.hiddenColumns, col.key],
                                                                    })
                                                                }
                                                                className="imcrm-h-4 imcrm-w-4 imcrm-accent-[hsl(var(--imcrm-primary))]"
                                                            />
                                                        </td>
                                                        <td className="imcrm-py-1.5 imcrm-pr-2">
                                                            <Input
                                                                aria-label={sprintf(__('Límite de «%s»'), col.label)}
                                                                inputMode="numeric"
                                                                placeholder="—"
                                                                value={wipDrafts[col.key] ?? ''}
                                                                onChange={(e) => setWipDrafts((p) => ({ ...p, [col.key]: e.target.value }))}
                                                                className="imcrm-h-8 imcrm-w-20"
                                                                data-testid="imcrm-kanban-settings-wip"
                                                            />
                                                        </td>
                                                        <td className="imcrm-py-1.5">
                                                            <button
                                                                type="button"
                                                                onClick={() => setRulesFor(rulesFor === col.key ? null : col.key)}
                                                                className="imcrm-text-left imcrm-text-xs imcrm-text-primary hover:imcrm-underline"
                                                                data-testid="imcrm-kanban-settings-rules"
                                                            >
                                                                {req.length > 0 ? req.map(fieldLabel).join(', ') : __('Nada')}
                                                            </button>
                                                            {rulesFor === col.key && (
                                                                <div className="imcrm-mt-2">
                                                                    <FieldChecklist
                                                                        candidates={requirableFields(allFields, [groupByFieldId, settings.laneFieldId ?? 0])}
                                                                        value={req}
                                                                        onChange={(ids) => {
                                                                            const moveRules = { ...settings.moveRules };
                                                                            if (ids.length === 0) delete moveRules[col.key];
                                                                            else moveRules[col.key] = ids;
                                                                            patch({ moveRules });
                                                                        }}
                                                                        idPrefix={`kanban-rule-${col.key}`}
                                                                    />
                                                                </div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('Las columnas de este campo salen de los valores de los registros: sus límites y reglas se ajustan desde el menú de cada columna en el tablero.')}
                                </p>
                            )}
                        </Section>

                        {error !== null && (
                            <div role="alert" className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                {error}
                            </div>
                        )}

                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                            <Dialog.Close asChild>
                                <Button type="button" variant="outline">
                                    {__('Cancelar')}
                                </Button>
                            </Dialog.Close>
                            <Button type="submit" disabled={update.isPending} data-testid="imcrm-kanban-settings-save">
                                {update.isPending ? __('Guardando…') : __('Guardar cambios')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function columnsOf(field: FieldEntity | undefined): Array<{ key: string; label: string }> {
    if (!field) return [];
    if (field.type === 'select') return extractFieldOptions(field).map((o) => ({ key: o.value, label: o.label }));
    if (field.type === 'checkbox') return [{ key: 'true', label: __('Sí') }, { key: 'false', label: __('No') }];
    return [];
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
    return (
        <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <legend className="imcrm-mb-1 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">{title}</legend>
            {children}
        </fieldset>
    );
}

function Row({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label htmlFor={htmlFor}>{label}</Label>
            {children}
            {hint && <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{hint}</p>}
        </div>
    );
}
