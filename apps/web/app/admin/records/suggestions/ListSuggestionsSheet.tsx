import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Check, ChevronDown, Info, Loader2, RotateCcw, Sparkles, X } from 'lucide-react';
import type { ListSuggestion, ListSuggestionMode, ListSuggestionsResponse } from '@imagina-base/shared';

import { ProposalPreview } from '@/admin/assistant/ProposalCard';
import { ideasThatFit } from '@/admin/ideas/IdeasForList';
import { ToneSquare } from '@/admin/learn/LearnIcon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import {
    useApplyListSuggestion,
    useDismissListSuggestion,
    useListSuggestions,
    useRunListSuggestionsAi,
    useUpdateListSuggestionsSettings,
} from '@/hooks/useListSuggestions';
import { formatDate } from '@/lib/tenantFormat';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { CATEGORY_LOOK, aiStageText, ideaSuggestions, splitSuggestions } from './suggestionsModel';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    list: { id: number; slug: string; name: string };
    fields: FieldEntity[];
}

const MODE_LABELS: Record<ListSuggestionMode, string> = {
    all: 'Con reglas y con IA (recomendado)',
    rules: 'Sólo sugerencias sin IA',
    off: 'Apagadas para toda la empresa',
};

/**
 * v0.1.341 (ADR-S89) — Panel «Sugerencias para esta lista»: lo que conviene
 * agregarle a la lista según SUS campos y SUS datos. Arriba, lo que sale de
 * reglas (gratis) y las ideas del catálogo que encajan; abajo, «Recomendar
 * con IA» a pedido. Cada tarjeta dice por qué y se aplica o se descarta con
 * un clic; nada se crea solo.
 */
export function ListSuggestionsSheet({ open, onOpenChange, list, fields }: Props): JSX.Element {
    const q = useListSuggestions(list.id, open);
    const canAuto = useCan(CAP.MANAGE_AUTOMATIONS);
    const data = q.data;
    const ideas = useMemo(() => {
        if (!canAuto || !data?.enabled) return [];
        const fit = ideasThatFit(list, fields).filter((i) => i.plan.kind === 'automations');
        return ideaSuggestions(fit, list.slug, data.marks ?? {});
    }, [canAuto, data?.enabled, data?.marks, list, fields]);
    const split = useMemo(() => (data ? splitSuggestions(data, ideas) : null), [data, ideas]);

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="sm:imcrm-w-[480px]" data-testid="list-suggestions" data-tour="list-suggestions-panel">
                <SheetHeader>
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1 imcrm-pr-8">
                        <SheetTitle className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <Sparkles className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                            <span className="imcrm-truncate">{sprintf(__('Sugerencias para «%s»'), list.name)}</span>
                        </SheetTitle>
                        <SheetDescription>
                            {data && data.sample.total > 0
                                ? data.sample.total > data.sample.sampled
                                    ? sprintf(__('Basadas en tus campos y en los %s registros más recientes. Nada se crea solo.'), String(data.sample.sampled))
                                    : sprintf(__('Basadas en tus campos y en tus %s registros. Nada se crea solo.'), String(data.sample.total))
                                : __('Basadas en los campos de la lista. Nada se crea solo: tú decides qué aplicar.')}
                        </SheetDescription>
                    </div>
                </SheetHeader>
                <SheetBody className="imcrm-flex imcrm-flex-col imcrm-gap-6">
                    {q.isLoading || !data || !split ? (
                        <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                            <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                            {__('Revisando la lista…')}
                        </p>
                    ) : !data.enabled ? (
                        <Disabled data={data} />
                    ) : (
                        <>
                            <section className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="list-suggestions-rules">
                                <SectionTitle title={__('Para tu lista')} count={split.rules.length} />
                                {split.rules.length === 0 ? (
                                    <p className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-p-3 imcrm-text-sm imcrm-text-muted-foreground">
                                        {__('Por ahora no hay nada más que sugerir: la lista ya tiene lo esencial. Prueba con la IA para ideas más finas.')}
                                    </p>
                                ) : (
                                    split.rules.map((s) => <SuggestionCard key={s.key} s={s} listId={list.id} />)
                                )}
                            </section>
                            {data.mode === 'all' && <AiSection data={data} list={list} items={split.ai} />}
                            {split.applied.length > 0 && <Applied items={split.applied} />}
                            {split.dismissed.length > 0 && <Dismissed items={split.dismissed} listId={list.id} />}
                        </>
                    )}
                </SheetBody>
                {data && <Footer data={data} />}
            </SheetContent>
        </Sheet>
    );
}

function SectionTitle({ title, count, children }: { title: string; count?: number; children?: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
            <h3 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                {title}
                {count !== undefined && count > 0 && <span className="imcrm-rounded-full imcrm-bg-muted imcrm-px-1.5 imcrm-py-px imcrm-text-[10px] imcrm-tabular-nums">{count}</span>}
            </h3>
            {children}
        </div>
    );
}

function SuggestionCard({ s, listId }: { s: ListSuggestion; listId: number }): JSX.Element {
    const toast = useToast();
    const navigate = useNavigate();
    const apply = useApplyListSuggestion(listId);
    const dismiss = useDismissListSuggestion(listId);
    const [showPreview, setShowPreview] = useState(false);
    const look = CATEGORY_LOOK[s.category];
    const error = apply.error instanceof Error ? apply.error.message : null;
    const hasPreview = s.preview !== null && (s.preview.widgets.length > 0 || s.preview.changes.length > 0 || s.preview.fields.length > 0 || s.preview.automation !== null);

    async function onApply(): Promise<void> {
        try {
            const res = await apply.mutateAsync(s.key);
            const link = res.suggestion.applied?.links[0];
            toast.show({
                variant: res.warnings.length > 0 ? 'warning' : 'success',
                title: res.suggestion.applied?.message ?? __('Listo'),
                ...(res.warnings.length > 0 ? { description: res.warnings.slice(0, 2).join(' ') } : {}),
                duration: 6000,
                ...(link ? { action: { label: link.label, onClick: () => navigate(link.href) } } : {}),
            });
        } catch {
            // El error queda escrito en la tarjeta.
        }
    }

    return (
        <article
            className="imcrm-group imcrm-flex imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3 imcrm-transition-colors hover:imcrm-border-primary/30"
            data-testid="list-suggestion"
            data-key={s.key}
        >
            <ToneSquare icon={look.icon} tone={look.tone} size={30} />
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1">
                <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                        <span className="imcrm-text-sm imcrm-font-medium imcrm-leading-snug">{s.title}</span>
                        {s.source === 'ai' && (
                            <Badge variant="secondary" className="imcrm-gap-0.5 imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]">
                                <Sparkles className="imcrm-h-2.5 imcrm-w-2.5" aria-hidden /> {__('IA')}
                            </Badge>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => dismiss.mutate({ key: s.key, title: s.title })}
                        disabled={dismiss.isPending}
                        aria-label={sprintf(__('Descartar «%s»'), s.title)}
                        title={__('Descartar: no vuelve a aparecer')}
                        className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground imcrm-opacity-70 hover:imcrm-bg-accent hover:imcrm-text-foreground hover:imcrm-opacity-100"
                        data-testid="list-suggestion-dismiss"
                    >
                        <X className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    </button>
                </div>
                <p className="imcrm-text-xs imcrm-leading-relaxed imcrm-text-muted-foreground">{s.why}</p>
                {hasPreview && (
                    <>
                        <button
                            type="button"
                            onClick={() => setShowPreview((v) => !v)}
                            aria-expanded={showPreview}
                            className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-self-start imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                        >
                            <ChevronDown className={cn('imcrm-h-3 imcrm-w-3 imcrm-transition-transform', showPreview && 'imcrm-rotate-180')} />
                            {showPreview ? __('Ocultar el detalle') : __('Ver qué se crea')}
                        </button>
                        {showPreview && s.preview && (
                            <div className="imcrm-mt-1">
                                <ProposalPreview p={{ preview: s.preview, kind: 'create_view', destructive: false }} />
                            </div>
                        )}
                    </>
                )}
                {error && <p className="imcrm-text-xs imcrm-text-[hsl(var(--imcrm-destructive-ink))]">{error}</p>}
                <div className="imcrm-mt-1.5 imcrm-flex imcrm-items-center imcrm-gap-2">
                    {s.action.type === 'link' ? (
                        <Button asChild size="sm" variant="outline" className="imcrm-h-8">
                            <Link to={s.action.href} data-testid="list-suggestion-link">
                                {__(s.action.label)}
                            </Link>
                        </Button>
                    ) : (
                        <Button size="sm" className="imcrm-h-8 imcrm-gap-1.5" onClick={() => void onApply()} disabled={apply.isPending} data-testid="list-suggestion-apply">
                            {apply.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Check className="imcrm-h-3.5 imcrm-w-3.5" />}
                            {__(s.action.label)}
                        </Button>
                    )}
                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__(CATEGORY_LOOK[s.category].label)}</span>
                </div>
            </div>
        </article>
    );
}

function AiSection({ data, list, items }: { data: ListSuggestionsResponse; list: { id: number; name: string }; items: ListSuggestion[] }): JSX.Element {
    const run = useRunListSuggestionsAi(list.id);
    const ai = data.ai;
    const [purpose, setPurpose] = useState(ai.purpose ?? '');
    const changedPurpose = purpose.trim() !== '' && purpose.trim() !== (ai.purpose ?? '');
    const canRun = ai.available && ai.state !== 'running' && (ai.analyzed_at === null || ai.can_reanalyze || changedPurpose);
    const error = run.error instanceof Error ? run.error.message : ai.state === 'error' ? ai.error : null;
    const showPurpose = ai.ask_purpose || ai.analyzed_at !== null || purpose !== '';

    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="list-suggestions-ai">
            <SectionTitle title={__('Con IA')} count={items.length} />
            {items.map((s) => (
                <SuggestionCard key={s.key} s={s} listId={list.id} />
            ))}
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-primary/25 imcrm-bg-primary/[0.04] imcrm-p-3">
                {ai.state === 'running' ? (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2.5 imcrm-text-sm" data-testid="list-suggestions-ai-running" role="status">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-animate-spin imcrm-text-primary" />
                        <span>{__(aiStageText(ai.stage))}</span>
                    </div>
                ) : (
                    <>
                        <div className="imcrm-flex imcrm-items-start imcrm-gap-2.5">
                            <Sparkles className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-primary" aria-hidden />
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                                <span className="imcrm-text-sm imcrm-font-medium">
                                    {ai.analyzed_at ? __('Ideas pensadas para esta lista') : __('Pide ideas pensadas para esta lista')}
                                </span>
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {ai.analyzed_at
                                        ? sprintf(__('Analizada el %s. Las sugerencias quedan guardadas: no hace falta volver a pedirlas.'), formatDate(new Date(ai.analyzed_at)))
                                        : __('La IA mira cómo usas la lista y propone vistas, tableros, automatizaciones o campos que te sirvan. Se pide una vez y queda guardado.')}
                                </span>
                            </div>
                        </div>
                        {showPurpose && (
                            <label className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <span className="imcrm-text-xs imcrm-font-medium">
                                    {ai.ask_purpose ? __('¿Para qué usas esta lista? (ayuda a que las ideas apunten bien)') : __('¿Para qué usas esta lista? (opcional)')}
                                </span>
                                <textarea
                                    value={purpose}
                                    onChange={(e) => setPurpose(e.target.value.slice(0, 500))}
                                    rows={2}
                                    placeholder={__('Por ejemplo: llevar los cobros a mis clientes y avisar cuando algo vence')}
                                    className="imcrm-w-full imcrm-resize-y imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2.5 imcrm-py-1.5 imcrm-text-sm placeholder:imcrm-text-muted-foreground focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                                    data-testid="list-suggestions-purpose"
                                />
                            </label>
                        )}
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                            <Button
                                size="sm"
                                variant={ai.analyzed_at ? 'outline' : 'default'}
                                className="imcrm-h-8 imcrm-gap-1.5"
                                disabled={!canRun || run.isPending}
                                onClick={() => run.mutate({ consent: true, ...(purpose.trim() ? { purpose: purpose.trim() } : {}) })}
                                data-testid="list-suggestions-ai-run"
                            >
                                {run.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Sparkles className="imcrm-h-3.5 imcrm-w-3.5" />}
                                {ai.analyzed_at ? __('Volver a analizar') : __('Recomendar con IA')}
                            </Button>
                            {ai.remaining !== null && ai.limit !== null && ai.available && (
                                <span className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="list-suggestions-ai-remaining">
                                    {sprintf(__('Te quedan %1$s de %2$s este mes'), String(ai.remaining), String(ai.limit))}
                                </span>
                            )}
                        </div>
                        {!ai.available && ai.reason && <p className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="list-suggestions-ai-reason">{ai.reason}</p>}
                        {ai.available && ai.analyzed_at && !ai.can_reanalyze && !changedPurpose && ai.reanalyze_hint && (
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">{ai.reanalyze_hint}</p>
                        )}
                        {error && <p className="imcrm-text-xs imcrm-text-[hsl(var(--imcrm-destructive-ink))]" data-testid="list-suggestions-ai-error">{error}</p>}
                        <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                            <Info className="imcrm-mt-px imcrm-h-3 imcrm-w-3 imcrm-shrink-0" aria-hidden />
                            {__('Al pedirlo aceptas enviar al proveedor de IA un resumen de la lista: nombres de campos, opciones y conteos. Nunca correos, teléfonos, nombres ni el texto de tus registros.')}
                        </p>
                    </>
                )}
            </div>
        </section>
    );
}

function Applied({ items }: { items: ListSuggestion[] }): JSX.Element {
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid="list-suggestions-applied">
            <SectionTitle title={__('Aplicadas')} count={items.length} />
            {items.map((s) => (
                <div key={s.key} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-success/30 imcrm-bg-success/5 imcrm-px-3 imcrm-py-2 imcrm-text-xs">
                    <Check className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-success" aria-hidden />
                    <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{s.title}</span>
                    {s.applied?.links[0] && (
                        <Link to={s.applied.links[0].href} className="imcrm-shrink-0 imcrm-font-medium imcrm-text-success hover:imcrm-underline">
                            {__('Ver')}
                        </Link>
                    )}
                </div>
            ))}
        </section>
    );
}

function Dismissed({ items, listId }: { items: ListSuggestion[]; listId: number }): JSX.Element {
    const [open, setOpen] = useState(false);
    const restore = useDismissListSuggestion(listId);
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid="list-suggestions-dismissed">
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-self-start imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-text-foreground">
                <ChevronDown className={cn('imcrm-h-3.5 imcrm-w-3.5 imcrm-transition-transform', open && 'imcrm-rotate-180')} />
                {sprintf(__('Descartadas (%s)'), String(items.length))}
            </button>
            {open &&
                items.map((s) => (
                    <div key={s.key} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-px-3 imcrm-py-2 imcrm-text-xs">
                        <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-muted-foreground">{s.title}</span>
                        <Button size="sm" variant="ghost" className="imcrm-h-7 imcrm-gap-1 imcrm-px-2" onClick={() => restore.mutate({ key: s.key, title: s.title, restore: true })} data-testid="list-suggestion-restore">
                            <RotateCcw className="imcrm-h-3 imcrm-w-3" />
                            {__('Volver a mostrar')}
                        </Button>
                    </div>
                ))}
        </section>
    );
}

function Disabled({ data }: { data: ListSuggestionsResponse }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-dashed imcrm-p-4 imcrm-text-sm" data-testid="list-suggestions-off">
            <span className="imcrm-font-medium">{data.mode === 'off' ? __('Las sugerencias están apagadas') : __('Las sugerencias son para administradores y gerentes')}</span>
            <span className="imcrm-text-muted-foreground">
                {data.mode === 'off'
                    ? data.can_configure
                        ? __('Puedes volver a encenderlas abajo, para toda la empresa.')
                        : __('Un administrador de la empresa puede volver a encenderlas.')
                    : __('Pídele a un administrador o a un gerente que las revise.')}
            </span>
        </div>
    );
}

function Footer({ data }: { data: ListSuggestionsResponse }): JSX.Element {
    const update = useUpdateListSuggestionsSettings();
    const toast = useToast();
    // Optimistas: el control cambia al tocarlo, no cuando vuelve el servidor
    // (un control atado sólo a la respuesta no se mueve — lección de v0.1.207).
    const [showChip, setShowChip] = useState(!data.hidden_for_me);
    const [mode, setMode] = useState<ListSuggestionMode>(data.mode);
    useEffect(() => setShowChip(!data.hidden_for_me), [data.hidden_for_me]);
    useEffect(() => setMode(data.mode), [data.mode]);
    const save = (patch: { hidden_for_me?: boolean; mode?: ListSuggestionMode }): void => {
        update.mutate(patch, {
            onError: (err) => {
                setShowChip(!data.hidden_for_me);
                setMode(data.mode);
                toast.error(__('No se pudo guardar'), err instanceof Error ? err.message : undefined);
            },
        });
    };
    return (
        <SheetFooter className="imcrm-flex-col imcrm-items-stretch imcrm-gap-2 sm:imcrm-flex-row sm:imcrm-items-center sm:imcrm-justify-between">
            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                <input
                    type="checkbox"
                    checked={showChip}
                    onChange={(e) => {
                        setShowChip(e.target.checked);
                        save({ hidden_for_me: !e.target.checked });
                    }}
                    className="imcrm-h-3.5 imcrm-w-3.5 imcrm-accent-[hsl(var(--imcrm-primary))]"
                    data-testid="list-suggestions-chip-toggle"
                />
                {__('Avisarme en la cabecera de las listas')}
            </label>
            {data.can_configure && (
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                    <span className="imcrm-shrink-0 imcrm-text-muted-foreground">{__('Empresa:')}</span>
                    <Select
                        value={mode}
                        onChange={(e) => {
                            const next = e.target.value as ListSuggestionMode;
                            setMode(next);
                            save({ mode: next });
                        }}
                        className="imcrm-h-8 imcrm-text-xs"
                        data-testid="list-suggestions-mode"
                    >
                        {(Object.keys(MODE_LABELS) as ListSuggestionMode[]).map((m) => (
                            <option key={m} value={m}>
                                {__(MODE_LABELS[m])}
                            </option>
                        ))}
                    </Select>
                </label>
            )}
        </SheetFooter>
    );
}
