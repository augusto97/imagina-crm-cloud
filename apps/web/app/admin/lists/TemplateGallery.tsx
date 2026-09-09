import { useMemo, useState } from 'react';
import { BarChart3, Check, LayoutTemplate, Loader2, Search, Trash2, Zap } from 'lucide-react';
import type { ListTemplateSummary, TemplateCategory } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useApplyListTemplate, useDeleteListTemplate, useListTemplates } from '@/hooks/useListTemplates';
import { ApiError } from '@/lib/api';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { __, _n, sprintf } from '@/lib/i18n';
import { DEFAULT_LIST_ICON, listColor, listIcon } from '@/lib/listIcons';
import { viewTypeIcon } from '@/lib/viewTypeIcons';
import { cn } from '@/lib/utils';
import type { ListSummary } from '@/types/list';

/**
 * Galería de plantillas (v0.1.166) — el Template Center, a escala de la app.
 *
 * Dos columnas: a la izquierda las plantillas (del workspace primero, después
 * las del sistema) filtrables por categoría y texto; a la derecha la vista
 * previa de la elegida —qué campos trae, con el icono de cada tipo, qué
 * vistas, qué automatizaciones y cuántos registros de muestra— y el
 * formulario para crearla (nombre + si se quieren los datos de ejemplo).
 * Elegir bien ANTES de crear es el punto: una lista que nace con 9 campos
 * equivocados cuesta más que una en blanco.
 */
/** Referencia estable mientras carga: sin ella cada render rearma los memos. */
const NO_TEMPLATES: ListTemplateSummary[] = [];

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
    ventas: 'Ventas',
    clientes: 'Clientes',
    proyectos: 'Proyectos',
    operaciones: 'Operaciones',
    finanzas: 'Finanzas',
    personas: 'Personas',
    otros: 'Otros',
};

interface Props {
    onCreated: (lists: ListSummary[], warnings: string[]) => void;
}

export function TemplateGallery({ onCreated }: Props): JSX.Element {
    const templates = useListTemplates();
    const apply = useApplyListTemplate();
    const remove = useDeleteListTemplate();
    const confirm = useConfirm();
    const toast = useToast();

    const [search, setSearch] = useState('');
    const [category, setCategory] = useState<TemplateCategory | 'all' | 'mine'>('all');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [withRecords, setWithRecords] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const all = templates.data ?? NO_TEMPLATES;
    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return all.filter((t) => {
            if (category === 'mine' && t.source !== 'workspace') return false;
            if (category !== 'all' && category !== 'mine' && t.category !== category) return false;
            if (q === '') return true;
            return (
                t.name.toLowerCase().includes(q)
                || (t.description ?? '').toLowerCase().includes(q)
                || t.lists.some((l) => l.fields.some((f) => f.label.toLowerCase().includes(q)))
            );
        });
    }, [all, category, search]);

    const categoriesPresent = useMemo(() => {
        const set = new Set<TemplateCategory>();
        for (const t of all) set.add(t.category);
        return (Object.keys(CATEGORY_LABELS) as TemplateCategory[]).filter((c) => set.has(c));
    }, [all]);
    const hasMine = all.some((t) => t.source === 'workspace');

    const selected = selectedId !== null ? all.find((t) => t.id === selectedId) ?? null : null;

    const pick = (t: ListTemplateSummary): void => {
        setSelectedId(t.id);
        setName(t.lists[0]?.name ?? t.name);
        setError(null);
    };

    const create = async (): Promise<void> => {
        if (!selected) return;
        setError(null);
        try {
            const res = await apply.mutateAsync({
                id: selected.id,
                input: { name: name.trim() || undefined, include_records: withRecords },
            });
            onCreated(res.lists, res.warnings);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    const handleDelete = async (t: ListTemplateSummary): Promise<void> => {
        const ok = await confirm({
            title: sprintf(
                /* translators: %s: nombre de la plantilla */
                __('¿Borrar la plantilla "%s"?'),
                t.name,
            ),
            description: __('Las listas creadas a partir de ella no se tocan.'),
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

    // En celular todo apila y scrollea COMO UN SOLO bloque; en escritorio el
    // catálogo y la vista previa scrollean cada uno por su lado.
    return (
        <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-3 imcrm-overflow-y-auto md:imcrm-flex-row md:imcrm-gap-0 md:imcrm-overflow-visible">
            {/* ── Catálogo ─────────────────────────────────────────────── */}
            {/* En celular NO se encoge (si no, el catálogo se aplasta y la
                vista previa se le dibuja encima); en escritorio toma el alto
                que sobra y scrollea adentro. */}
            <div className="imcrm-flex imcrm-min-w-0 imcrm-shrink-0 imcrm-flex-col imcrm-gap-3 md:imcrm-min-h-0 md:imcrm-flex-1 md:imcrm-shrink md:imcrm-pr-4">
                <div className="imcrm-relative">
                    <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-2.5 imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={__('Buscar plantillas')}
                        className="imcrm-pl-8"
                        autoFocus
                    />
                </div>
                {/* `overflow-y-hidden` explícito + un pelo de padding: si no,
                    el eje Y cae a `auto` y el ring del chip activo se recorta
                    (mismo traspié que v0.1.124). */}
                <div className="imcrm-flex imcrm-shrink-0 imcrm-gap-1.5 imcrm-overflow-x-auto imcrm-overflow-y-hidden imcrm-px-0.5 imcrm-py-1">
                    <Chip active={category === 'all'} onClick={() => setCategory('all')}>{__('Todas')}</Chip>
                    {hasMine && (
                        <Chip active={category === 'mine'} onClick={() => setCategory('mine')}>{__('Mis plantillas')}</Chip>
                    )}
                    {categoriesPresent.map((c) => (
                        <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
                            {CATEGORY_LABELS[c]}
                        </Chip>
                    ))}
                </div>

                {templates.isLoading ? (
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                        {__('Cargando plantillas…')}
                    </p>
                ) : visible.length === 0 ? (
                    <p className="imcrm-py-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Ninguna plantilla coincide.')}
                    </p>
                ) : (
                    <div className="imcrm-grid imcrm-min-h-0 imcrm-gap-2 sm:imcrm-grid-cols-2 md:imcrm-overflow-y-auto">
                        {visible.map((t) => {
                            const Icon = listIcon(t.icon) ?? DEFAULT_LIST_ICON;
                            const color = listColor(t.color);
                            const active = t.id === selectedId;
                            const first = t.lists[0];
                            return (
                                <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => pick(t)}
                                    className={cn(
                                        'imcrm-group imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-p-3 imcrm-text-left imcrm-transition-colors',
                                        active
                                            ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-ring-1 imcrm-ring-primary'
                                            : 'imcrm-border-border imcrm-bg-card hover:imcrm-border-primary/40 hover:imcrm-bg-accent/30',
                                    )}
                                >
                                    <span className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                        <span
                                            className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-ring-1 imcrm-ring-inset imcrm-ring-border"
                                            style={color ? { color } : undefined}
                                        >
                                            <Icon className="imcrm-h-4 imcrm-w-4" />
                                        </span>
                                        <span className="imcrm-min-w-0 imcrm-flex-1">
                                            <span className="imcrm-block imcrm-truncate imcrm-text-sm imcrm-font-semibold">{t.name}</span>
                                            <span className="imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">
                                                {t.source === 'workspace' ? __('Del workspace') : CATEGORY_LABELS[t.category]}
                                                {t.lists.length > 1 && ` · ${sprintf(
                                                    /* translators: %d: cantidad de listas del pack */
                                                    __('%d listas'),
                                                    t.lists.length,
                                                )}`}
                                            </span>
                                        </span>
                                        {active && <Check className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-primary" />}
                                    </span>
                                    {t.description && (
                                        <span className="imcrm-line-clamp-2 imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">
                                            {t.description}
                                        </span>
                                    )}
                                    {first && (
                                        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                            {sprintf(_n('%d campo', '%d campos', first.fields.length), first.fields.length)}
                                            {' · '}
                                            {sprintf(_n('%d vista', '%d vistas', first.views.length), first.views.length)}
                                            {first.automations.length > 0 && ` · ${sprintf(
                                                _n('%d automatización', '%d automatizaciones', first.automations.length),
                                                first.automations.length,
                                            )}`}
                                            {t.dashboards.length > 0 && ` · ${sprintf(
                                                _n('%d tablero', '%d tableros', t.dashboards.length),
                                                t.dashboards.length,
                                            )}`}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Vista previa + crear ─────────────────────────────────── */}
            <aside className="imcrm-flex imcrm-w-full imcrm-shrink-0 imcrm-flex-col imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-pt-3 md:imcrm-w-80 md:imcrm-border-l md:imcrm-border-t-0 md:imcrm-pl-4 md:imcrm-pt-0">
                {!selected ? (
                    <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-py-10 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                        <LayoutTemplate className="imcrm-h-6 imcrm-w-6 imcrm-opacity-50" />
                        {__('Elegí una plantilla para ver qué trae.')}
                    </div>
                ) : (
                    <>
                        <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                            <div className="imcrm-min-w-0">
                                <p className="imcrm-truncate imcrm-text-sm imcrm-font-semibold">{selected.name}</p>
                                {selected.description && (
                                    <p className="imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">{selected.description}</p>
                                )}
                            </div>
                            {selected.source === 'workspace' && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="imcrm-shrink-0 imcrm-text-muted-foreground"
                                    aria-label={__('Borrar plantilla')}
                                    onClick={() => void handleDelete(selected)}
                                >
                                    <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                </Button>
                            )}
                        </div>

                        <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-col imcrm-gap-3 imcrm-overflow-y-auto">
                            {selected.lists.map((l) => (
                                <div key={l.name} className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-2.5">
                                    {selected.lists.length > 1 && (
                                        <p className="imcrm-text-xs imcrm-font-semibold">{l.name}</p>
                                    )}
                                    <PreviewSection title={__('Campos')}>
                                        {l.fields.map((f, i) => {
                                            const FIcon = fieldTypeIcon(f.type);
                                            return (
                                                <span key={i} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px]">
                                                    <FIcon className="imcrm-h-3 imcrm-w-3 imcrm-text-muted-foreground" aria-hidden />
                                                    {f.label}
                                                </span>
                                            );
                                        })}
                                    </PreviewSection>
                                    {l.views.length > 0 && (
                                        <PreviewSection title={__('Vistas')}>
                                            {l.views.map((v, i) => {
                                                const VIcon = viewTypeIcon(v.type);
                                                return (
                                                    <span key={i} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                                                        <VIcon className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                                        {v.name}
                                                    </span>
                                                );
                                            })}
                                        </PreviewSection>
                                    )}
                                    {l.automations.length > 0 && (
                                        <PreviewSection title={__('Automatizaciones')}>
                                            {l.automations.map((a, i) => (
                                                <span key={i} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                                                    <Zap className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                                    {a}
                                                </span>
                                            ))}
                                        </PreviewSection>
                                    )}
                                    {l.records_count > 0 && (
                                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                            {sprintf(
                                                /* translators: %d: registros de muestra */
                                                __('%d registros de ejemplo'),
                                                l.records_count,
                                            )}
                                        </p>
                                    )}
                                </div>
                            ))}
                            {selected.dashboards.length > 0 && (
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3">
                                    <PreviewSection title={__('Tableros')}>
                                        {selected.dashboards.map((d, i) => (
                                            <span key={i} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                                                <BarChart3 className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                                {d}
                                            </span>
                                        ))}
                                    </PreviewSection>
                                </div>
                            )}
                        </div>

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label htmlFor="tpl-list-name">{__('Nombre de la lista')}</Label>
                                <Input id="tpl-list-name" value={name} onChange={(e) => setName(e.target.value)} />
                            </div>
                            {selected.lists.some((l) => l.records_count > 0) && (
                                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                    <input type="checkbox" checked={withRecords} onChange={(e) => setWithRecords(e.target.checked)} />
                                    {__('Incluir los registros de ejemplo')}
                                </label>
                            )}
                            {error !== null && (
                                <p className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-2 imcrm-text-xs imcrm-text-destructive">{error}</p>
                            )}
                            <Button onClick={() => void create()} disabled={apply.isPending || name.trim() === ''} className="imcrm-gap-2">
                                {apply.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <LayoutTemplate className="imcrm-h-4 imcrm-w-4" />}
                                {apply.isPending ? __('Creando…') : __('Usar plantilla')}
                            </Button>
                        </div>
                    </>
                )}
            </aside>
        </div>
    );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'imcrm-shrink-0 imcrm-rounded-full imcrm-border imcrm-px-2.5 imcrm-py-1 imcrm-text-xs',
                active
                    ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-font-medium imcrm-text-primary'
                    : 'imcrm-border-border imcrm-text-muted-foreground hover:imcrm-bg-accent',
            )}
        >
            {children}
        </button>
    );
}

function PreviewSection({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            <p className="imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{title}</p>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">{children}</div>
        </div>
    );
}
