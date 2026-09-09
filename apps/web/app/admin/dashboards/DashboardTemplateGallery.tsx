import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Check, LayoutTemplate, Loader2, Trash2 } from 'lucide-react';
import type { DashboardTemplateSummary, TemplateCategory, TemplateRoleList } from '@imagina-base/shared';

import { RoleFieldMapper } from '@/admin/templates/RoleFieldMapper';
import { suggestRoleMapping } from '@/admin/templates/roleMapping';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useApplyDashboardTemplate, useDashboardTemplates, useDeleteDashboardTemplate } from '@/hooks/useDashboardTemplates';
import { useFields } from '@/hooks/useFields';
import { useLists } from '@/hooks/useLists';
import { ApiError } from '@/lib/api';
import { __, _n, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { DashboardEntity, DashboardVisibility } from '@/types/dashboard';

import { DashboardVisibilityFields } from './DashboardVisibilityFields';

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
    ventas: 'Ventas',
    clientes: 'Clientes',
    proyectos: 'Proyectos',
    operaciones: 'Operaciones',
    finanzas: 'Finanzas',
    personas: 'Personas',
    otros: 'Otros',
};

const WIDGET_LABELS: Record<string, string> = {
    kpi: 'KPI',
    chart_bar: 'Barras',
    chart_pie: 'Donut',
    chart_line: 'Línea',
    chart_area: 'Área',
    stat_delta: 'Variación',
    table: 'Tabla',
    funnel: 'Embudo',
    gauge: 'Medidor',
    heading: 'Título',
    text: 'Texto',
    image: 'Imagen',
    divider: 'Separador',
    spacer: 'Espacio',
};

const NO_TEMPLATES: DashboardTemplateSummary[] = [];

interface Props {
    onCreated: (dashboard: DashboardEntity, warnings: string[]) => void;
}

/**
 * Galería de plantillas de dashboard (v0.1.167). A la izquierda las
 * plantillas (del workspace + del sistema) con filtro por categoría; a la
 * derecha, la elegida: qué widgets trae y el paso que las hace posibles —
 * elegir la LISTA y qué campo cumple cada rol (con sugerencia automática
 * por nombre y tipo). Es lo que ClickUp pide al usar una plantilla de
 * dashboard: "¿sobre qué ubicación?".
 */
export function DashboardTemplateGallery({ onCreated }: Props): JSX.Element {
    const templates = useDashboardTemplates();
    const apply = useApplyDashboardTemplate();
    const remove = useDeleteDashboardTemplate();
    const confirm = useConfirm();
    const toast = useToast();

    const [category, setCategory] = useState<TemplateCategory | 'all' | 'mine'>('all');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [visibility, setVisibility] = useState<DashboardVisibility>('workspace');
    const [allowedRoles, setAllowedRoles] = useState<string[]>([]);
    const [mapping, setMapping] = useState<Record<string, { listId: number; fields: Record<string, number> }>>({});
    const [error, setError] = useState<string | null>(null);

    const all = templates.data ?? NO_TEMPLATES;
    const visible = useMemo(
        () =>
            all.filter((t) => {
                if (category === 'mine') return t.source === 'workspace';
                if (category === 'all') return true;
                return t.category === category;
            }),
        [all, category],
    );
    const categoriesPresent = useMemo(() => {
        const set = new Set(all.map((t) => t.category));
        return (Object.keys(CATEGORY_LABELS) as TemplateCategory[]).filter((c) => set.has(c));
    }, [all]);
    const hasMine = all.some((t) => t.source === 'workspace');
    const selected = selectedId !== null ? all.find((t) => t.id === selectedId) ?? null : null;

    const pick = (t: DashboardTemplateSummary): void => {
        setSelectedId(t.id);
        setName(t.name);
        setMapping({});
        setError(null);
    };

    const handleDelete = async (t: DashboardTemplateSummary): Promise<void> => {
        const ok = await confirm({
            title: sprintf(
                /* translators: %s: nombre de la plantilla */
                __('¿Borrar la plantilla "%s"?'),
                t.name,
            ),
            description: __('Los dashboards creados a partir de ella no se tocan.'),
            confirmLabel: __('Borrar plantilla'),
            destructive: true,
        });
        if (!ok) return;
        try {
            await remove.mutateAsync(t.id);
            if (selectedId === t.id) setSelectedId(null);
            toast.success(__('Plantilla borrada'));
        } catch (err) {
            toast.error(__('No se pudo borrar la plantilla'), err instanceof Error ? err.message : undefined);
        }
    };

    const missingList = selected ? selected.lists.some((l) => mapping[l.key] === undefined) : true;

    const create = async (): Promise<void> => {
        if (!selected) return;
        setError(null);
        try {
            const lists: Record<string, { list_id: number; fields: Record<string, number> }> = {};
            for (const l of selected.lists) {
                const m = mapping[l.key];
                if (m) lists[l.key] = { list_id: m.listId, fields: m.fields };
            }
            const res = await apply.mutateAsync({
                id: selected.id,
                input: {
                    name: name.trim(),
                    visibility,
                    allowed_roles: visibility === 'roles' ? allowedRoles : [],
                    lists,
                },
            });
            onCreated(res.dashboard, res.warnings);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    return (
        <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-3 imcrm-overflow-y-auto md:imcrm-flex-row md:imcrm-gap-0 md:imcrm-overflow-visible">
            {/* ── Catálogo ─────────────────────────────────────────────── */}
            <div className="imcrm-flex imcrm-min-w-0 imcrm-shrink-0 imcrm-flex-col imcrm-gap-3 md:imcrm-min-h-0 md:imcrm-w-[46%] md:imcrm-shrink md:imcrm-pr-4">
                <div className="imcrm-flex imcrm-shrink-0 imcrm-gap-1.5 imcrm-overflow-x-auto imcrm-overflow-y-hidden imcrm-px-0.5 imcrm-py-1">
                    <Chip active={category === 'all'} onClick={() => setCategory('all')}>{__('Todas')}</Chip>
                    {hasMine && <Chip active={category === 'mine'} onClick={() => setCategory('mine')}>{__('Mis plantillas')}</Chip>}
                    {categoriesPresent.map((c) => (
                        <Chip key={c} active={category === c} onClick={() => setCategory(c)}>{CATEGORY_LABELS[c]}</Chip>
                    ))}
                </div>
                {templates.isLoading ? (
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                        {__('Cargando plantillas…')}
                    </p>
                ) : (
                    <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-col imcrm-gap-2 md:imcrm-overflow-y-auto">
                        {visible.map((t) => {
                            const active = t.id === selectedId;
                            return (
                                <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => pick(t)}
                                    className={cn(
                                        'imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-p-3 imcrm-text-left imcrm-transition-colors',
                                        active
                                            ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-ring-1 imcrm-ring-primary'
                                            : 'imcrm-border-border imcrm-bg-card hover:imcrm-border-primary/40 hover:imcrm-bg-accent/30',
                                    )}
                                >
                                    <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-ring-1 imcrm-ring-inset imcrm-ring-border">
                                        <BarChart3 className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                                    </span>
                                    <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-0.5">
                                        <span className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                            <span className="imcrm-truncate imcrm-text-sm imcrm-font-semibold">{t.name}</span>
                                            {active && <Check className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-primary" />}
                                        </span>
                                        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                            {t.source === 'workspace' ? __('Del workspace') : CATEGORY_LABELS[t.category]}
                                            {' · '}
                                            {sprintf(_n('%d widget', '%d widgets', t.widgets.length), t.widgets.length)}
                                        </span>
                                        {t.description && (
                                            <span className="imcrm-line-clamp-2 imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">{t.description}</span>
                                        )}
                                    </span>
                                </button>
                            );
                        })}
                        {visible.length === 0 && (
                            <p className="imcrm-py-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">{__('Ninguna plantilla coincide.')}</p>
                        )}
                    </div>
                )}
            </div>

            {/* ── Detalle + mapeo ──────────────────────────────────────── */}
            <aside className="imcrm-flex imcrm-w-full imcrm-shrink-0 imcrm-flex-col imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-pt-3 md:imcrm-min-h-0 md:imcrm-w-[54%] md:imcrm-border-l md:imcrm-border-t-0 md:imcrm-pl-4 md:imcrm-pt-0">
                {!selected ? (
                    <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-py-10 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                        <LayoutTemplate className="imcrm-h-6 imcrm-w-6 imcrm-opacity-50" />
                        {__('Elegí una plantilla y después la lista sobre la que se arma.')}
                    </div>
                ) : (
                    <>
                        <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                            <div className="imcrm-min-w-0">
                                <h3 className="imcrm-text-sm imcrm-font-semibold">{selected.name}</h3>
                                {selected.description && <p className="imcrm-text-xs imcrm-text-muted-foreground">{selected.description}</p>}
                            </div>
                            {selected.source === 'workspace' && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-text-muted-foreground"
                                    onClick={() => void handleDelete(selected)}
                                    aria-label={__('Borrar plantilla')}
                                    title={__('Borrar plantilla')}
                                >
                                    <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                </Button>
                            )}
                        </div>
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                            {selected.widgets.map((wd, i) => (
                                <span key={i} className="imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px]">
                                    <span className="imcrm-text-muted-foreground">{WIDGET_LABELS[wd.type] ?? wd.type}</span>
                                    {wd.title && ` · ${wd.title}`}
                                </span>
                            ))}
                        </div>

                        <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-col imcrm-gap-3 md:imcrm-overflow-y-auto">
                            {selected.lists.map((roleList) => (
                                <RoleListMapping
                                    key={`${selected.id}:${roleList.key}`}
                                    roleList={roleList}
                                    single={selected.lists.length === 1}
                                    value={mapping[roleList.key]}
                                    onChange={(v) => setMapping((prev) => ({ ...prev, [roleList.key]: v }))}
                                />
                            ))}
                        </div>

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="tpl-dash-name">{__('Nombre del dashboard')}</Label>
                            <Input id="tpl-dash-name" value={name} onChange={(e) => setName(e.target.value)} />
                        </div>
                        <DashboardVisibilityFields
                            idPrefix="tpl-dash"
                            visibility={visibility}
                            allowedRoles={allowedRoles}
                            onVisibilityChange={setVisibility}
                            onAllowedRolesChange={setAllowedRoles}
                        />
                        {error !== null && (
                            <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">{error}</div>
                        )}
                        <Button onClick={() => void create()} disabled={apply.isPending || name.trim() === '' || missingList} className="imcrm-gap-2">
                            {apply.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <LayoutTemplate className="imcrm-h-4 imcrm-w-4" />}
                            {apply.isPending ? __('Creando…') : __('Crear dashboard')}
                        </Button>
                    </>
                )}
            </aside>
        </div>
    );
}

/**
 * Mapeo de UN rol de lista: el select de la lista y, debajo, el mapeo de sus
 * roles de campo (sugerido al elegir la lista, editable).
 */
function RoleListMapping({
    roleList,
    single,
    value,
    onChange,
}: {
    roleList: TemplateRoleList;
    single: boolean;
    value: { listId: number; fields: Record<string, number> } | undefined;
    onChange: (v: { listId: number; fields: Record<string, number> }) => void;
}): JSX.Element {
    const lists = useLists();
    const listId = value?.listId;
    const fields = useFields(listId);

    // Al cargar los campos de la lista recién elegida, sugerir el mapeo.
    useEffect(() => {
        if (listId === undefined || !fields.data) return;
        if (value && Object.keys(value.fields).length > 0) return;
        const suggested = suggestRoleMapping(roleList.fields, fields.data);
        if (Object.keys(suggested).length > 0) onChange({ listId, fields: suggested });
        // Sólo cuando cambia la lista o llegan sus campos.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [listId, fields.data]);

    return (
        <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-3">
            <legend className="imcrm-px-1 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                {single ? __('Sobre qué lista') : roleList.label}
            </legend>
            <Select
                aria-label={__('Lista')}
                value={listId === undefined ? '' : String(listId)}
                onChange={(e) => {
                    const id = Number(e.target.value);
                    if (e.target.value === '') return;
                    onChange({ listId: id, fields: {} });
                }}
            >
                <option value="">{__('Elegí una lista…')}</option>
                {(lists.data ?? []).map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                ))}
            </Select>
            {listId !== undefined && fields.data && (
                <RoleFieldMapper
                    idPrefix={`map-${roleList.key}`}
                    roles={roleList.fields}
                    fields={fields.data}
                    value={value?.fields ?? {}}
                    onChange={(next) => onChange({ listId, fields: next })}
                />
            )}
        </fieldset>
    );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'imcrm-shrink-0 imcrm-rounded-full imcrm-border imcrm-px-2.5 imcrm-py-0.5 imcrm-text-xs imcrm-transition-colors',
                active
                    ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-primary'
                    : 'imcrm-border-border imcrm-text-muted-foreground hover:imcrm-text-foreground',
            )}
        >
            {children}
        </button>
    );
}
