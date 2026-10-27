import { useId, useMemo, useState } from 'react';
import { BarChart3, FolderClosed, Loader2, Lock, Pencil, RotateCcw, Sparkles, Zap } from 'lucide-react';
import {
    pruneBlueprint,
    type BlueprintEdits,
    type BlueprintList,
    type OnboardingApplyResult,
    type OnboardingProposal,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApplyOnboarding } from '@/hooks/useOnboarding';
import { ApiError } from '@/lib/api';
import { FIELD_TYPE_CATALOG } from '@/lib/fieldTypeCatalog';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { __, _n, sprintf } from '@/lib/i18n';
import { DEFAULT_LIST_ICON, listColor, listIcon } from '@/lib/listIcons';
import { cn } from '@/lib/utils';
import { viewTypeIcon } from '@/lib/viewTypeIcons';

const FIELD_TYPE_LABEL = new Map(FIELD_TYPE_CATALOG.map((t) => [t.slug, t.label]));

const VIEW_TYPE_LABEL: Record<string, string> = {
    table: 'Tabla',
    kanban: 'Tablero por estado',
    calendar: 'Calendario',
    cards: 'Tarjetas',
    gantt: 'Gantt',
};

const TRIGGER_LABEL: Record<string, string> = {
    record_created: 'Cuando se crea un registro',
    record_updated: 'Cuando cambia un registro',
    due_date_reached: 'Cuando llega una fecha',
    scheduled: 'En un horario',
};

const EMPTY_EDITS: BlueprintEdits = {
    exclude_lists: [],
    exclude_fields: {},
    exclude_views: {},
    exclude_automations: {},
    exclude_dashboards: [],
    rename_lists: {},
};

interface Props {
    proposalId: string;
    proposal: OnboardingProposal;
    onCreated: (res: OnboardingApplyResult) => void;
    onRetry: () => void;
}

/**
 * La vista previa EDITABLE de lo que armó la IA: cada lista con sus campos
 * (con el ícono de su tipo), sus vistas y automatizaciones, y el tablero. Se
 * quita lo que no sirve y se renombran las listas antes de crear nada. Lo que
 * se cae por arrastre (una relación hacia una lista quitada, un gráfico de un
 * campo quitado) se calcula con la MISMA función que usa el servidor.
 */
export function ProposalReview({ proposalId, proposal, onCreated, onRetry }: Props): JSX.Element {
    const [edits, setEdits] = useState<BlueprintEdits>(EMPTY_EDITS);
    const [folder, setFolder] = useState(proposal.business_name);
    const [samples, setSamples] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const apply = useApplyOnboarding();
    const folderId = useId();

    const source = proposal.blueprint;
    const { blueprint: pruned, report } = useMemo(() => pruneBlueprint(source, edits), [source, edits]);

    const keptLists = pruned.lists.length;
    const sampleCount = pruned.lists.reduce((n, l) => n + l.records.length, 0);
    const cascadeFields = new Set(report.fields.map((f) => `${f.list}:${f.slug}`));
    const cascadeViews = new Set(report.views.map((v) => `${v.list}:${v.name}`));
    const cascadeAutos = new Set(report.automations.map((a) => `${a.list}:${a.name}`));

    const toggleIn = <T,>(arr: T[], value: T): T[] => (arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]);
    const toggleList = (key: string): void => setEdits((e) => ({ ...e, exclude_lists: toggleIn(e.exclude_lists, key) }));
    const toggleField = (key: string, slug: string): void =>
        setEdits((e) => ({ ...e, exclude_fields: { ...e.exclude_fields, [key]: toggleIn(e.exclude_fields[key] ?? [], slug) } }));
    const toggleView = (key: string, i: number): void =>
        setEdits((e) => ({ ...e, exclude_views: { ...e.exclude_views, [key]: toggleIn(e.exclude_views[key] ?? [], i) } }));
    const toggleAuto = (key: string, i: number): void =>
        setEdits((e) => ({ ...e, exclude_automations: { ...e.exclude_automations, [key]: toggleIn(e.exclude_automations[key] ?? [], i) } }));
    const toggleDash = (i: number): void => setEdits((e) => ({ ...e, exclude_dashboards: toggleIn(e.exclude_dashboards, i) }));
    const rename = (list: BlueprintList, name: string): void =>
        setEdits((e) => {
            const next = { ...e.rename_lists };
            if (name.trim() === '' || name.trim() === list.name) delete next[list.key];
            else next[list.key] = name;
            return { ...e, rename_lists: next };
        });

    const create = async (): Promise<void> => {
        setError(null);
        try {
            const res = await apply.mutateAsync({
                source: 'ai',
                proposal_id: proposalId,
                folder_name: keptLists > 1 && folder.trim() !== '' ? folder.trim() : undefined,
                include_samples: samples && sampleCount > 0,
                edits,
            });
            onCreated(res);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : __('No se pudo crear tu espacio.'));
        }
    };

    return (
        <div className="imcrm-flex imcrm-w-full imcrm-flex-col imcrm-gap-4" data-testid="welcome-review">
            <div className="imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-primary/30 imcrm-bg-primary/5 imcrm-p-4">
                <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary/10 imcrm-text-primary">
                    <Sparkles className="imcrm-h-5 imcrm-w-5" aria-hidden />
                </span>
                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-0.5">
                    <h2 className="imcrm-text-base imcrm-font-semibold imcrm-text-foreground">
                        {sprintf(__('Tu espacio para «%s»'), proposal.business_name)}
                    </h2>
                    <p className="imcrm-text-[13px] imcrm-leading-snug imcrm-text-muted-foreground">{proposal.summary}</p>
                    <p className="imcrm-pt-1 imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Quita lo que no te sirva y cambia los nombres que quieras. Nada se crea hasta que confirmes.')}
                    </p>
                </div>
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-4 lg:imcrm-flex-row lg:imcrm-items-start">
                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-3">
                    {source.lists.map((list) => {
                        const excluded = edits.exclude_lists.includes(list.key);
                        const kept = pruned.lists.find((l) => l.key === list.key) ?? null;
                        return (
                            <ListCard
                                key={list.key}
                                list={list}
                                excluded={excluded}
                                displayName={edits.rename_lists[list.key] ?? list.name}
                                keptRecords={kept?.records.length ?? 0}
                                keptFields={kept?.fields.length ?? 0}
                                onToggle={() => toggleList(list.key)}
                                onRename={(name) => rename(list, name)}
                                fieldState={(slug) =>
                                    (edits.exclude_fields[list.key] ?? []).includes(slug) ? 'off' : cascadeFields.has(`${list.key}:${slug}`) ? 'cascade' : 'on'
                                }
                                viewState={(i, name) =>
                                    (edits.exclude_views[list.key] ?? []).includes(i) ? 'off' : cascadeViews.has(`${list.key}:${name}`) ? 'cascade' : 'on'
                                }
                                autoState={(i, name) =>
                                    (edits.exclude_automations[list.key] ?? []).includes(i) ? 'off' : cascadeAutos.has(`${list.key}:${name}`) ? 'cascade' : 'on'
                                }
                                onToggleField={(slug) => toggleField(list.key, slug)}
                                onToggleView={(i) => toggleView(list.key, i)}
                                onToggleAuto={(i) => toggleAuto(list.key, i)}
                            />
                        );
                    })}

                    {source.dashboards.map((d, i) => {
                        const off = edits.exclude_dashboards.includes(i);
                        const cascade = !off && report.dashboards.includes(d.name);
                        const keptDash = pruned.dashboards.find((x) => x.name === d.name);
                        const widgets = keptDash?.widgets ?? d.widgets;
                        return (
                            <section
                                key={`dash-${i}`}
                                className={cn('imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4', (off || cascade) && 'imcrm-opacity-60')}
                                data-testid="welcome-review-dashboard"
                            >
                                <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-2.5">
                                    <input type="checkbox" checked={!off && !cascade} disabled={cascade} onChange={() => toggleDash(i)} className="imcrm-h-4 imcrm-w-4" />
                                    <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-text-muted-foreground imcrm-ring-1 imcrm-ring-inset imcrm-ring-border">
                                        <BarChart3 className="imcrm-h-4 imcrm-w-4" aria-hidden />
                                    </span>
                                    <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
                                        <span className={cn('imcrm-truncate imcrm-text-sm imcrm-font-semibold', (off || cascade) && 'imcrm-line-through')}>{d.name}</span>
                                        <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                            {cascade
                                                ? __('Se quita: dependía de listas que quitaste.')
                                                : sprintf(_n('Tablero con %d gráfico', 'Tablero con %d gráficos', widgets.length), widgets.length)}
                                        </span>
                                    </span>
                                </label>
                                {!off && !cascade && (
                                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1 imcrm-pl-[3.25rem]">
                                        {widgets.map((w, wi) => (
                                            <span key={wi} className="imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px] imcrm-text-foreground/80">
                                                {w.title || __('Gráfico')}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </section>
                        );
                    })}
                </div>

                <aside className="imcrm-flex imcrm-w-full imcrm-shrink-0 imcrm-flex-col imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 lg:imcrm-sticky lg:imcrm-top-4 lg:imcrm-w-80">
                    <p className="imcrm-text-sm imcrm-font-semibold">{__('Resumen')}</p>
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-[13px] imcrm-text-muted-foreground">
                        <li>{sprintf(_n('%d lista', '%d listas', keptLists), keptLists)}</li>
                        <li>
                            {(() => {
                                const n = pruned.lists.reduce((s, l) => s + l.views.length, 0);
                                return sprintf(_n('%d vista', '%d vistas', n), n);
                            })()}
                        </li>
                        <li>
                            {(() => {
                                const n = pruned.lists.reduce((s, l) => s + l.automations.length, 0);
                                return sprintf(_n('%d automatización', '%d automatizaciones', n), n);
                            })()}
                        </li>
                        {pruned.dashboards.length > 0 && <li>{sprintf(_n('%d tablero', '%d tableros', pruned.dashboards.length), pruned.dashboards.length)}</li>}
                    </ul>

                    {keptLists > 1 && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor={folderId} className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                <FolderClosed className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />
                                {__('Carpeta')}
                            </Label>
                            <Input id={folderId} value={folder} maxLength={190} onChange={(e) => setFolder(e.target.value)} data-testid="welcome-review-folder" />
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Las listas quedan juntas en el menú.')}</p>
                        </div>
                    )}

                    {sampleCount > 0 && (
                        <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                            <input type="checkbox" checked={samples} onChange={(e) => setSamples(e.target.checked)} className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4" data-testid="welcome-review-samples" />
                            <span className="imcrm-flex imcrm-flex-col">
                                <span>{sprintf(__('Incluir datos de ejemplo (%d)'), sampleCount)}</span>
                                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Para ver cómo funciona. Se borran con un clic cuando quieras.')}</span>
                            </span>
                        </label>
                    )}

                    {error !== null && (
                        <p className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-2 imcrm-text-xs imcrm-text-destructive" role="alert">
                            {error}
                        </p>
                    )}
                    {keptLists === 0 && (
                        <p className="imcrm-text-xs imcrm-text-destructive" role="alert">
                            {__('Deja al menos una lista para crear tu espacio.')}
                        </p>
                    )}

                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-pt-1">
                        <Button onClick={() => void create()} disabled={apply.isPending || keptLists === 0} className="imcrm-hidden imcrm-gap-2 lg:imcrm-inline-flex" data-testid="welcome-review-create">
                            {apply.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Sparkles className="imcrm-h-4 imcrm-w-4" />}
                            {apply.isPending ? __('Creando tu espacio…') : __('Crear mi espacio')}
                        </Button>
                        <Button variant="ghost" onClick={onRetry} disabled={apply.isPending} className="imcrm-gap-1.5" data-testid="welcome-review-retry">
                            <RotateCcw className="imcrm-h-4 imcrm-w-4" />
                            {__('Volver a intentar')}
                        </Button>
                    </div>
                </aside>
            </div>

            {/* En el celular el resumen queda al final: el botón de crear acompaña siempre. */}
            <div className="imcrm-sticky imcrm-bottom-0 imcrm-z-10 -imcrm-mx-3 imcrm-border-t imcrm-border-border imcrm-bg-background/95 imcrm-px-3 imcrm-py-2.5 imcrm-backdrop-blur lg:imcrm-hidden">
                <Button onClick={() => void create()} disabled={apply.isPending || keptLists === 0} className="imcrm-w-full imcrm-gap-2" data-testid="welcome-review-create-sticky">
                    {apply.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Sparkles className="imcrm-h-4 imcrm-w-4" />}
                    {apply.isPending ? __('Creando tu espacio…') : sprintf(_n('Crear mi espacio (%d lista)', 'Crear mi espacio (%d listas)', keptLists), keptLists)}
                </Button>
            </div>
        </div>
    );
}

type ItemState = 'on' | 'off' | 'cascade';

/** El campo que hace de título: no se puede quitar (sin él el registro no tiene nombre). */
function titleSlug(list: BlueprintList): string | null {
    const ref = (list.settings as { title_field_id?: unknown }).title_field_id;
    if (ref && typeof ref === 'object' && typeof (ref as { $field?: unknown }).$field === 'string') return (ref as { $field: string }).$field;
    return list.fields.find((f) => f.type === 'text' || f.type === 'long_text')?.slug ?? null;
}

function ListCard({
    list,
    excluded,
    displayName,
    keptRecords,
    keptFields,
    onToggle,
    onRename,
    fieldState,
    viewState,
    autoState,
    onToggleField,
    onToggleView,
    onToggleAuto,
}: {
    list: BlueprintList;
    excluded: boolean;
    displayName: string;
    keptRecords: number;
    keptFields: number;
    onToggle: () => void;
    onRename: (name: string) => void;
    fieldState: (slug: string) => ItemState;
    viewState: (i: number, name: string) => ItemState;
    autoState: (i: number, name: string) => ItemState;
    onToggleField: (slug: string) => void;
    onToggleView: (i: number) => void;
    onToggleAuto: (i: number) => void;
}): JSX.Element {
    const Icon = listIcon(list.icon) ?? DEFAULT_LIST_ICON;
    const color = listColor(list.color);
    const title = titleSlug(list);
    const nameId = useId();
    return (
        <section
            className={cn('imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-bg-card imcrm-p-4', excluded ? 'imcrm-border-dashed imcrm-border-border imcrm-opacity-70' : 'imcrm-border-border')}
            data-testid="welcome-review-list"
            data-list-key={list.key}
        >
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2.5">
                <input
                    type="checkbox"
                    checked={!excluded}
                    onChange={onToggle}
                    aria-label={sprintf(__('Crear la lista «%s»'), displayName)}
                    className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0"
                    data-testid="welcome-review-list-toggle"
                />
                <span
                    className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-ring-1 imcrm-ring-inset imcrm-ring-border"
                    style={color ? { color } : undefined}
                >
                    <Icon className="imcrm-h-4 imcrm-w-4" />
                </span>
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <label htmlFor={nameId} className="imcrm-sr-only">
                        {__('Nombre de la lista')}
                    </label>
                    <div className="imcrm-group/name imcrm-relative imcrm-flex imcrm-items-center">
                        <input
                            id={nameId}
                            value={displayName}
                            disabled={excluded}
                            maxLength={190}
                            onChange={(e) => onRename(e.target.value)}
                            title={excluded ? undefined : __('Cambiar el nombre')}
                            className={cn(
                                'imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-transparent imcrm-bg-transparent imcrm-py-0.5 imcrm-pl-1.5 imcrm-pr-7 imcrm-text-sm imcrm-font-semibold imcrm-text-foreground',
                                'hover:imcrm-border-border focus:imcrm-border-primary focus:imcrm-outline-none focus:imcrm-ring-2 focus:imcrm-ring-primary/30',
                                excluded && 'imcrm-line-through',
                            )}
                            data-testid="welcome-review-list-name"
                        />
                        {!excluded && (
                            <Pencil
                                className="imcrm-pointer-events-none imcrm-absolute imcrm-right-2 imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground/70 group-focus-within/name:imcrm-opacity-0"
                                aria-hidden
                            />
                        )}
                    </div>
                    <p className="imcrm-px-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                        {excluded
                            ? __('No se va a crear.')
                            : [
                                  sprintf(_n('%d campo', '%d campos', keptFields), keptFields),
                                  keptRecords > 0 ? sprintf(_n('%d registro de ejemplo', '%d registros de ejemplo', keptRecords), keptRecords) : null,
                              ]
                                  .filter(Boolean)
                                  .join(' · ')}
                    </p>
                </div>
            </div>

            {!excluded && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 sm:imcrm-pl-[3.25rem]">
                    <Group title={__('Campos')} hint={__('Toca un campo para quitarlo.')}>
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                            {list.fields.map((f) => {
                                const FIcon = fieldTypeIcon(f.type);
                                const locked = f.slug === title;
                                const state = locked ? 'on' : fieldState(f.slug);
                                const typeLabel = FIELD_TYPE_LABEL.get(f.type as never) ?? f.type;
                                return (
                                    <button
                                        key={f.slug}
                                        type="button"
                                        disabled={locked || state === 'cascade'}
                                        aria-pressed={state === 'on'}
                                        onClick={() => onToggleField(f.slug)}
                                        title={
                                            locked
                                                ? __('Es el título de cada registro: no se puede quitar.')
                                                : state === 'cascade'
                                                  ? __('Se quita porque depende de algo que quitaste.')
                                                  : `${f.label} · ${typeLabel}`
                                        }
                                        className={cn(
                                            'imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-transition-colors focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/40',
                                            state === 'on'
                                                ? 'imcrm-border-border imcrm-bg-background imcrm-text-foreground hover:imcrm-border-primary/40'
                                                : 'imcrm-border-dashed imcrm-border-border imcrm-bg-transparent imcrm-text-muted-foreground imcrm-line-through',
                                            (locked || state === 'cascade') && 'imcrm-cursor-default',
                                        )}
                                        data-testid="welcome-review-field"
                                        data-field-slug={f.slug}
                                    >
                                        <FIcon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                                        {f.label}
                                        {locked && <Lock className="imcrm-h-3 imcrm-w-3 imcrm-text-muted-foreground" aria-label={__('Título')} />}
                                    </button>
                                );
                            })}
                        </div>
                    </Group>

                    {list.views.length > 0 && (
                        <Group title={__('Vistas')}>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                {list.views.map((v, i) => {
                                    const VIcon = viewTypeIcon(v.type);
                                    const state = viewState(i, v.name);
                                    return (
                                        <ToggleRow
                                            key={i}
                                            state={state}
                                            onToggle={() => onToggleView(i)}
                                            icon={<VIcon className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />}
                                            label={v.name}
                                            detail={state === 'cascade' ? __('Usaba un campo que quitaste') : __(VIEW_TYPE_LABEL[v.type] ?? v.type)}
                                            testId="welcome-review-view"
                                        />
                                    );
                                })}
                            </div>
                        </Group>
                    )}

                    {list.automations.length > 0 && (
                        <Group title={__('Automatizaciones')}>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                {list.automations.map((a, i) => {
                                    const state = autoState(i, a.name);
                                    return (
                                        <ToggleRow
                                            key={i}
                                            state={state}
                                            onToggle={() => onToggleAuto(i)}
                                            icon={<Zap className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />}
                                            label={a.name}
                                            detail={state === 'cascade' ? __('Usaba algo que quitaste') : __(TRIGGER_LABEL[a.trigger_type] ?? 'Automática')}
                                            testId="welcome-review-automation"
                                        />
                                    );
                                })}
                            </div>
                        </Group>
                    )}
                </div>
            )}
        </section>
    );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <p className="imcrm-flex imcrm-items-baseline imcrm-gap-2 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                {title}
                {hint && <span className="imcrm-font-normal imcrm-normal-case imcrm-tracking-normal">{hint}</span>}
            </p>
            {children}
        </div>
    );
}

function ToggleRow({
    state,
    onToggle,
    icon,
    label,
    detail,
    testId,
}: {
    state: ItemState;
    onToggle: () => void;
    icon: React.ReactNode;
    label: string;
    detail: string;
    testId: string;
}): JSX.Element {
    return (
        <label className={cn('imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-1.5 imcrm-py-1 imcrm-text-[13px]', state === 'cascade' ? 'imcrm-cursor-default' : 'imcrm-cursor-pointer hover:imcrm-bg-accent/50')} data-testid={testId}>
            <input type="checkbox" checked={state === 'on'} disabled={state === 'cascade'} onChange={onToggle} className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
            <span className="imcrm-text-muted-foreground">{icon}</span>
            <span className={cn('imcrm-min-w-0 imcrm-truncate', state !== 'on' && 'imcrm-text-muted-foreground imcrm-line-through')}>{label}</span>
            <span className="imcrm-ml-auto imcrm-shrink-0 imcrm-text-[11px] imcrm-text-muted-foreground">{detail}</span>
        </label>
    );
}
