import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CalendarDays, Check, CheckCircle2, ChevronDown, ClipboardList, Columns3, LayoutDashboard, Lightbulb, Loader2, UserPlus } from 'lucide-react';
import type { FileImportApplyResult, FileImportDataKind } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { useApplyDashboardTemplate, useDashboardTemplates } from '@/hooks/useDashboardTemplates';
import { fieldsKeys } from '@/hooks/useFields';
import { invalidateForList } from '@/hooks/useRecords';
import { viewsKeys } from '@/hooks/useSavedViews';
import { api } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { buildRecommendations, type RecList, type Recommendation } from './recommendations';

interface Props {
    result: FileImportApplyResult;
    kind: FileImportDataKind;
}

/**
 * v0.1.339 (ADR-S88) — Lo que quedó creado y lo que se RECOMIENDA a partir de
 * ahí: vistas, un tablero de la galería, ideas de automatizaciones y algún
 * ajuste. Cada recomendación se aprueba con un clic (nada se crea solo).
 */
export function FileImportDone({ result, kind }: Props): JSX.Element {
    const qc = useQueryClient();
    const canDash = useCan(CAP.MANAGE_DASHBOARDS);
    const canAuto = useCan(CAP.MANAGE_AUTOMATIONS);
    const canInvite = useCan('workspace_admin');
    const templates = useDashboardTemplates(canDash);
    const fieldQueries = useQueries({
        queries: result.lists.map((l) => ({
            queryKey: fieldsKeys.forList(l.id),
            queryFn: async () => (await api.get<FieldEntity[]>(`/lists/${l.id}/fields`)).data,
        })),
    });
    const loading = fieldQueries.some((q) => q.isLoading) || (canDash && templates.isLoading);
    const recs = useMemo<Recommendation[]>(() => {
        if (loading) return [];
        const lists: RecList[] = result.lists.map((l, i) => ({ id: l.id, slug: l.slug, name: l.name, fields: fieldQueries[i]?.data ?? [] }));
        return buildRecommendations({ lists, kind, templates: templates.data ?? [], canManageDashboards: canDash, canManageAutomations: canAuto, canInvite });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- los resultados de las queries cambian de identidad en cada render
    }, [loading, result.lists, kind, templates.data, canDash, canAuto, canInvite, ...fieldQueries.map((q) => q.dataUpdatedAt)]);

    const [done, setDone] = useState<Record<string, { href: string } | 'busy' | { error: string }>>({});
    const applyDash = useApplyDashboardTemplate();
    const first = result.lists[0];

    async function apply(r: Recommendation): Promise<void> {
        setDone((d) => ({ ...d, [r.id]: 'busy' }));
        try {
            if (r.kind === 'view_kanban' || r.kind === 'view_calendar') {
                const config = r.kind === 'view_kanban' ? { group_by_field_id: r.field.id } : { date_field_id: r.field.id };
                await api.post(`/lists/${r.list.id}/views`, { name: r.name, type: r.kind === 'view_kanban' ? 'kanban' : 'calendar', config });
                invalidateForList(qc, viewsKeys.all, r.list.id);
                setDone((d) => ({ ...d, [r.id]: { href: `/lists/${r.list.slug}/records` } }));
            } else if (r.kind === 'dashboard') {
                const res = await applyDash.mutateAsync({ id: r.template.id, input: { name: r.name, lists: r.mapping } });
                setDone((d) => ({ ...d, [r.id]: { href: `/dashboards/${res.dashboard.id}` } }));
            }
        } catch (err) {
            setDone((d) => ({ ...d, [r.id]: { error: err instanceof Error ? err.message : __('No se pudo crear.') } }));
        }
    }

    const quick = recs.filter((r) => (r.kind === 'view_kanban' || r.kind === 'view_calendar' || r.kind === 'dashboard') && done[r.id] === undefined);

    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-4xl imcrm-flex-col imcrm-gap-6 imcrm-py-4" data-testid="file-import-done">
            <section className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-text-center">
                <span className="imcrm-flex imcrm-h-14 imcrm-w-14 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-success/15 imcrm-text-success">
                    <CheckCircle2 className="imcrm-h-8 imcrm-w-8" aria-hidden />
                </span>
                <h1 className="imcrm-text-2xl imcrm-font-semibold imcrm-tracking-tight">
                    {result.lists.length === 1 ? sprintf(__('Listo: «%s» está creada'), first?.name ?? '') : sprintf(__('Listo: creaste %s listas'), String(result.lists.length))}
                </h1>
                <p className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="file-import-done-summary">
                    {sprintf(__('%s registros importados'), String(result.imported))}
                    {result.linked > 0 && ` · ${sprintf(__('%s vínculos entre listas'), String(result.linked))}`}
                    {result.skipped_duplicates > 0 && ` · ${sprintf(__('%s filas repetidas salteadas'), String(result.skipped_duplicates))}`}
                </p>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-justify-center imcrm-gap-2">
                    {result.lists.map((l) => (
                        <Button key={l.id} asChild variant={l === first ? 'default' : 'outline'} className="imcrm-gap-2">
                            <Link to={`/lists/${l.slug}/records`} data-testid={`file-import-open-${l.key}`}>
                                {sprintf(__('Ir a «%s»'), l.name)}
                                <ArrowRight className="imcrm-h-4 imcrm-w-4" />
                            </Link>
                        </Button>
                    ))}
                </div>
            </section>

            <Problems result={result} />

            <section className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="file-import-recs" data-tour="file-import-recs">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-end imcrm-justify-between imcrm-gap-2">
                    <div>
                        <h2 className="imcrm-text-base imcrm-font-semibold">{__('Recomendado para tus datos')}</h2>
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Nada se crea solo: aprueba lo que te sirva. Todo se puede cambiar o borrar después.')}</p>
                    </div>
                    {quick.length > 1 && (
                        <Button variant="outline" size="sm" onClick={() => quick.forEach((r) => void apply(r))} data-testid="file-import-apply-all">
                            {__('Crear las vistas y el tablero')}
                        </Button>
                    )}
                </div>
                {loading ? (
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                        {__('Buscando lo que mejor encaja…')}
                    </p>
                ) : recs.length === 0 ? (
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('No hay recomendaciones para estas listas por ahora.')}</p>
                ) : (
                    <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2">
                        {recs.map((r) => (
                            <RecCard key={r.id} rec={r} state={done[r.id]} onApply={() => void apply(r)} />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

function Problems({ result }: { result: FileImportApplyResult }): JSX.Element | null {
    const [open, setOpen] = useState(false);
    if (result.warnings.length === 0 && result.cell_warnings_total === 0 && result.left_out === 0) return null;
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-warning/40 imcrm-bg-warning/5 imcrm-p-4" data-testid="file-import-problems">
            {result.left_out > 0 && (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-warning" aria-hidden />
                    {sprintf(__('%s registros quedaron afuera por el límite de tu plan.'), String(result.left_out))}
                </p>
            )}
            {result.warnings.map((w) => (
                <p key={w} className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-warning" aria-hidden />
                    {w}
                </p>
            ))}
            {result.cell_warnings_total > 0 && (
                <>
                    <button type="button" className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-self-start imcrm-text-sm imcrm-font-medium" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="file-import-cells-toggle">
                        <ChevronDown className={cn('imcrm-h-4 imcrm-w-4 imcrm-transition-transform', open && 'imcrm-rotate-180')} />
                        {result.cell_warnings_total === 1 ? __('1 celda no se pudo guardar') : sprintf(__('%s celdas no se pudieron guardar (las filas sí entraron)'), String(result.cell_warnings_total))}
                    </button>
                    {open && (
                        <div className="imcrm-max-h-72 imcrm-overflow-auto imcrm-rounded-md imcrm-border imcrm-bg-card">
                            <table className="imcrm-w-full imcrm-text-left imcrm-text-xs">
                                <thead className="imcrm-sticky imcrm-top-0 imcrm-bg-muted">
                                    <tr>
                                        <th className="imcrm-px-3 imcrm-py-1.5 imcrm-font-medium">{__('Lista')}</th>
                                        <th className="imcrm-px-3 imcrm-py-1.5 imcrm-font-medium">{__('Fila')}</th>
                                        <th className="imcrm-px-3 imcrm-py-1.5 imcrm-font-medium">{__('Campo')}</th>
                                        <th className="imcrm-px-3 imcrm-py-1.5 imcrm-font-medium">{__('Motivo')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {result.cell_warnings.map((w, i) => (
                                        <tr key={i} className="imcrm-border-t">
                                            <td className="imcrm-px-3 imcrm-py-1.5">{w.list}</td>
                                            <td className="imcrm-px-3 imcrm-py-1.5">{w.row}</td>
                                            <td className="imcrm-px-3 imcrm-py-1.5">{w.field}</td>
                                            <td className="imcrm-px-3 imcrm-py-1.5">{w.message}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}

function RecCard({ rec, state, onApply }: { rec: Recommendation; state: { href: string } | 'busy' | { error: string } | undefined; onApply: () => void }): JSX.Element {
    const meta = describe(rec);
    const Icon = meta.icon;
    const applied = typeof state === 'object' && 'href' in state;
    return (
        <div className={cn('imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-bg-card imcrm-p-3', applied && 'imcrm-border-success/40 imcrm-bg-success/5')} data-testid={`file-import-rec-${rec.kind}`}>
            <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary/10 imcrm-text-primary">
                <Icon className="imcrm-h-4 imcrm-w-4" aria-hidden />
            </span>
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1">
                <span className="imcrm-text-sm imcrm-font-medium">{meta.title}</span>
                <span className="imcrm-text-xs imcrm-text-muted-foreground">{meta.text}</span>
                {typeof state === 'object' && 'error' in state && <span className="imcrm-text-xs imcrm-text-[hsl(var(--imcrm-destructive-ink))]">{state.error}</span>}
                <div className="imcrm-mt-1">
                    {applied ? (
                        <Link to={state.href} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-sm imcrm-font-medium imcrm-text-success hover:imcrm-underline">
                            <Check className="imcrm-h-4 imcrm-w-4" />
                            {__('Creado · ver')}
                        </Link>
                    ) : meta.href ? (
                        <Button asChild variant="outline" size="sm">
                            <Link to={meta.href}>{meta.action}</Link>
                        </Button>
                    ) : (
                        <Button size="sm" variant="outline" onClick={onApply} disabled={state === 'busy'} className="imcrm-gap-1.5" data-testid={`file-import-rec-apply-${rec.kind}`}>
                            {state === 'busy' && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                            {meta.action}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}

function describe(r: Recommendation): { icon: React.ComponentType<{ className?: string }>; title: string; text: string; action: string; href?: string } {
    switch (r.kind) {
        case 'view_kanban':
            return {
                icon: Columns3,
                title: sprintf(__('Tablero por «%s»'), r.field.label),
                text: sprintf(__('En «%1$s», tarjetas por columna según %2$s: se mueven arrastrando.'), r.list.name, r.field.label.toLocaleLowerCase('es')),
                action: __('Crear vista'),
            };
        case 'view_calendar':
            return {
                icon: CalendarDays,
                title: sprintf(__('Calendario de «%s»'), r.field.label),
                text: sprintf(__('Ve los registros de «%s» en el mes, la semana o el día.'), r.list.name),
                action: __('Crear vista'),
            };
        case 'dashboard':
            return { icon: LayoutDashboard, title: sprintf(__('Tablero «%s»'), r.template.name), text: r.template.description ?? __('Indicadores y gráficos listos con tus campos.'), action: __('Crear tablero') };
        case 'idea':
            return { icon: Lightbulb, title: r.idea.title, text: r.idea.summary, action: __('Ver y activar'), href: `/ideas/${r.idea.id}?lista=${encodeURIComponent(r.list.slug)}` };
        case 'form':
            return { icon: ClipboardList, title: __('Recibe nuevos registros con un formulario'), text: sprintf(__('Un enlace para que tus clientes llenen «%s» solos.'), r.list.name), action: __('Crear formulario'), href: `/lists/${r.list.slug}/edit?s=formularios` };
        case 'invite':
            return { icon: UserPlus, title: __('Invita a tu equipo'), text: __('Que trabajen sobre las mismas listas, cada uno con su rol.'), action: __('Invitar'), href: '/settings?s=miembros' };
    }
}
