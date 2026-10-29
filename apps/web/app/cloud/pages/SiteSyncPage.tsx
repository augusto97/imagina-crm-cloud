import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
    siteResourceKey,
    type SiteColumn,
    type SiteDiscovery,
    type SiteObject,
    type SiteObjectChoice,
    type SiteSyncMode,
    type SiteNovelty,
    type SiteSyncObjectState,
    type SiteSyncStatus,
    type SourceDeleteMode,
} from '@imagina-base/shared';
import {
    AlertTriangle,
    ArrowLeft,
    ArrowLeftRight,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    ExternalLink,
    FolderOpen,
    Images,
    Loader2,
    Lock,
    Plus,
    RefreshCw,
    Sparkles,
    Tags,
    FileText,
    X,
} from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { SiteEditableColumns } from '@/cloud/components/SiteEditableColumns';
import { SiteKits } from '@/cloud/components/SiteKits';
import { SitePluginCard } from '@/cloud/components/SitePluginCard';
import { SourceDeleteChoice, SourceDeleteSection } from '@/cloud/components/SourceDeleteSection';
import { SiteSyncModeChoice } from '@/cloud/components/SiteSyncMode';
import { siteColumnGroups, siteColumnOrigin } from '@/cloud/components/siteColumnGroups';
import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Select } from '@/components/ui/select';
import { listsKeys } from '@/hooks/useLists';
import { CloudApiError } from '@/lib/cloud/client';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTimeStr, formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

/**
 * El sitio WordPress sincronizado (v0.1.333, ADR-S83): el asistente para
 * elegir qué traer (páginas, entradas, tipos de contenido propios y
 * taxonomías) y qué columnas, cuáles se editan desde la app, y después el
 * estado de cada lista. El trabajo pesado corre en segundo plano; mientras hay
 * una corrida en curso esta pantalla pregunta el estado seguido.
 */

const TYPE_LABEL: Record<string, string> = {
    text: 'Texto',
    long_text: 'Texto largo',
    number: 'Número',
    date: 'Fecha',
    datetime: 'Fecha y hora',
    checkbox: 'Sí / No',
    url: 'Enlace',
    select: 'Selección',
    multi_select: 'Varias opciones',
};

function errText(err: unknown): string {
    if (err instanceof CloudApiError) return err.message;
    return err instanceof Error ? err.message : String(err);
}

function when(iso: string | null): string {
    if (!iso) return '—';
    return formatDateTimeStr(iso.replace('T', ' ').replace(/\.\d+Z$|Z$/, ''));
}

const objectKey = (o: Pick<SiteObject, 'kind' | 'object'>): string => siteResourceKey(o.kind, o.object);

const PROVIDER_LABEL: Record<string, string> = { acf: 'ACF', metabox: 'Meta Box', jetengine: 'JetEngine' };

function objectIcon(kind: SiteObject['kind']): typeof FileText {
    return kind === 'taxonomy' ? Tags : kind === 'media' ? Images : FileText;
}

function objectCount(kind: SiteObject['kind'], n: number): string {
    if (kind === 'taxonomy') return sprintf(n === 1 ? __('%s término') : __('%s términos'), formatNumber(n));
    if (kind === 'media') return sprintf(n === 1 ? __('%s archivo') : __('%s archivos'), formatNumber(n));
    return sprintf(n === 1 ? __('%s entrada') : __('%s entradas'), formatNumber(n));
}

/** Por qué no se puede elegir «Al instante» en el alta (null = se puede). */
function realtimeBlockedFor(d: Pick<SiteDiscovery, 'plugin'>): string | null {
    if (!d.plugin.installed) return __('Necesita el complemento en el sitio (arriba están los pasos para instalarlo).');
    if (!(d.plugin.can_hooks ?? d.plugin.can_manage)) return __('Necesita un usuario Administrador de WordPress, o el complemento 1.1 (o más nuevo) descargado desde esta app: con él también sirve un Editor.');
    return null;
}

export function SiteSyncPage(): JSX.Element {
    const { connectionId } = useParams();
    const id = Number(connectionId);
    const qc = useQueryClient();
    const key = ['site-sync', id];
    const [params, setParams] = useSearchParams();
    const [notice, setNotice] = useState<string | null>(null);
    /** Una corrida pedida queda EN COLA hasta que el worker la toma (mismo criterio que la tienda). */
    const [queuedFrom, setQueuedFrom] = useState<{ lastRun: string | null; at: number } | null>(null);
    const query = useQuery({
        queryKey: key,
        queryFn: () => api.siteSyncStatus(id),
        enabled: Number.isInteger(id) && id > 0,
        refetchOnMount: 'always',
        refetchInterval: (q) => (q.state.data?.running || queuedFrom ? 2000 : 30_000),
    });
    const data = query.data;

    // La vuelta de «Autorizar aplicación» llega aquí con ?connected=1.
    const connected = params.get('connected');
    useEffect(() => {
        if (!connected) return;
        const warning = params.get('warning');
        setNotice(warning ? `${__('¡Listo! El sitio quedó conectado.')} ${warning}` : __('¡Listo! El sitio quedó conectado. Ahora elige qué traer.'));
        const next = new URLSearchParams(params);
        next.delete('connected');
        next.delete('warning');
        setParams(next, { replace: true });
        void qc.invalidateQueries({ queryKey: ['connections'] });
        // Sólo al llegar: re-correr esto pisaría el aviso recién mostrado.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connected]);

    useEffect(() => {
        if (!queuedFrom || !data) return;
        if (data.running || data.last_run_at !== queuedFrom.lastRun || Date.now() - queuedFrom.at > 120_000) setQueuedFrom(null);
    }, [data, queuedFrom]);
    const set = (s: SiteSyncStatus) => qc.setQueryData(key, s);
    const setQueued = (s: SiteSyncStatus) => {
        set(s);
        if (!s.running) setQueuedFrom({ lastRun: s.last_run_at, at: Date.now() });
    };

    if (query.isLoading) {
        return (
            <div className="imcrm-flex imcrm-h-64 imcrm-items-center imcrm-justify-center">
                <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />
            </div>
        );
    }
    if (query.isError || !data) {
        return (
            <div className="imcrm-mx-auto imcrm-max-w-3xl imcrm-p-6">
                <BackLink />
                <p className="imcrm-mt-4 imcrm-text-sm imcrm-text-destructive">{errText(query.error)}</p>
            </div>
        );
    }
    return (
        <div className="imcrm-mx-auto imcrm-max-w-4xl imcrm-space-y-6 imcrm-p-4 sm:imcrm-p-6" data-testid="imcrm-site-sync">
            <BackLink />
            <header className="imcrm-flex imcrm-items-center imcrm-gap-3">
                <IntegrationLogo integrationKey="wordpress" size={44} />
                <div className="imcrm-min-w-0">
                    <h1 className="imcrm-truncate imcrm-text-xl imcrm-font-semibold">{data.site_name}</h1>
                    <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Sitio WordPress')}
                        {data.site_url && (
                            <a href={data.site_url} target="_blank" rel="noreferrer" className="imcrm-inline-flex imcrm-items-center imcrm-gap-0.5 hover:imcrm-text-foreground hover:imcrm-underline">
                                {data.site_url.replace(/^https?:\/\//, '')}
                                <ExternalLink className="imcrm-h-3 imcrm-w-3" />
                            </a>
                        )}
                    </p>
                </div>
            </header>
            {notice && (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-success/25 imcrm-bg-success/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-success" data-testid="imcrm-site-sync-notice">
                    <CheckCircle2 className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                    {notice}
                </p>
            )}
            {data.configured ? (
                <Configured status={data} queued={queuedFrom !== null} connectionId={id} onChange={set} onQueued={setQueued} />
            ) : (
                <Setup connectionId={id} onDone={setQueued} />
            )}
        </div>
    );
}

function BackLink(): JSX.Element {
    return (
        <Link to="/settings?s=conectores" className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-sm imcrm-text-muted-foreground hover:imcrm-text-foreground">
            <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
            {__('Integraciones')}
        </Link>
    );
}

// ── Alta ────────────────────────────────────────────────────────────────

interface Choice {
    columns: Set<string>;
    editable: Set<string>;
}

function initialChoice(o: SiteObject): Choice {
    return {
        columns: new Set(o.columns.filter((c) => c.always || c.default_on).map((c) => c.key)),
        editable: new Set(o.columns.filter((c) => c.can_edit && c.default_edit && (c.always || c.default_on)).map((c) => c.key)),
    };
}

function Setup({ connectionId, onDone }: { connectionId: number; onDone: (s: SiteSyncStatus) => void }): JSX.Element {
    const discover = useQuery({
        queryKey: ['site-sync', connectionId, 'discover'],
        queryFn: () => api.siteSyncDiscover(connectionId),
        retry: false,
        staleTime: 60_000,
    });
    const [choices, setChoices] = useState<Record<string, Choice>>({});
    const [interval, setIntervalMin] = useState(60);
    /** null = lo recomendado: al instante si el sitio lo permite. */
    const [pickedMode, setPickedMode] = useState<SiteSyncMode | null>(null);
    const [writeBack, setWriteBack] = useState(true);
    const [onDelete, setOnDelete] = useState<SourceDeleteMode>('keep');
    const [error, setError] = useState<string | null>(null);
    const realtimeBlocked = discover.data ? realtimeBlockedFor(discover.data) : __('Revisando el sitio…');
    const mode: SiteSyncMode = realtimeBlocked !== null ? 'interval' : pickedMode ?? 'realtime';
    const setup = useMutation({
        mutationFn: () =>
            api.siteSyncSetup(connectionId, {
                objects: chosenObjects(discover.data, choices),
                write_back: writeBack,
                interval_minutes: interval,
                mode,
                on_source_delete: onDelete,
            }),
        onSuccess: onDone,
        onError: (err) => setError(errText(err)),
    });

    if (discover.isLoading) {
        return (
            <section className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                {__('Revisando qué tiene tu sitio…')}
            </section>
        );
    }
    if (discover.isError || !discover.data) {
        return (
            <section className="imcrm-space-y-3 imcrm-rounded-lg imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-p-5 imcrm-text-sm" data-testid="imcrm-site-sync-discover-error">
                <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-destructive">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                    {errText(discover.error)}
                </p>
                <div className="imcrm-flex imcrm-gap-2">
                    <Button size="sm" variant="outline" onClick={() => void discover.refetch()}>
                        <RefreshCw className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Volver a intentar')}
                    </Button>
                    <Button size="sm" variant="ghost" asChild>
                        <Link to="/settings?s=conectores">{__('Volver a conectar el sitio')}</Link>
                    </Button>
                </div>
            </section>
        );
    }
    const d = discover.data;
    const types = d.objects.filter((o) => o.kind === 'post_type');
    const taxes = d.objects.filter((o) => o.kind === 'taxonomy');
    const media = d.objects.filter((o) => o.kind === 'media');
    const chosen = d.objects.filter((o) => choices[objectKey(o)]);
    const toggleObject = (o: SiteObject): void =>
        setChoices((prev) => {
            const k = objectKey(o);
            const next = { ...prev };
            if (next[k]) delete next[k];
            else next[k] = initialChoice(o);
            return next;
        });

    return (
        <section className="imcrm-space-y-6 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5" data-testid="imcrm-site-sync-setup" data-tour="site-sync-setup">
            <div>
                <h2 className="imcrm-text-base imcrm-font-semibold">{__('Trae tu sitio a la app')}</h2>
                <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Elige qué traer: cada tipo de contenido llega a su propia lista, dentro de una carpeta con el nombre del sitio, y se mantiene al día sola. Lo nuevo se sigue creando en WordPress; desde aquí ves todo junto, lo filtras, lo organizas y cambias lo que habilites.')}
                </p>
                <p className="imcrm-mt-2 imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-site-sync-user">
                    {sprintf(__('Conectado como %s.'), d.user.name || d.user.login)}
                </p>
                {d.warnings.length > 0 && (
                    <ul className="imcrm-mt-2 imcrm-space-y-1">
                        {d.warnings.map((w) => (
                            <li key={w} className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-warning">
                                <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                                {w}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <SitePluginCard
                state={{
                    installed: d.plugin.installed,
                    version: d.plugin.version,
                    latest: d.plugin.latest,
                    seoName: d.plugin.seo?.name ?? null,
                    providers: (['acf', 'metabox', 'jetengine'] as const).filter((k) => d.plugin.providers[k]).map((k) => PROVIDER_LABEL[k]!),
                    problem: d.plugin.seo?.problem ?? d.plugin.error,
                    signed: d.plugin.signed ?? false,
                }}
                siteUrl={d.site_url}
                checking={discover.isFetching}
                onRecheck={() => void discover.refetch()}
            />

            <fieldset className="imcrm-space-y-3">
                <legend className="imcrm-text-sm imcrm-font-medium">{__('1. Qué traer')}</legend>
                <ObjectGrid title={__('Contenido')} icon={FileText} objects={types} choices={choices} onToggle={toggleObject} />
                {media.length > 0 && <ObjectGrid title={__('Medios')} icon={Images} objects={media} choices={choices} onToggle={toggleObject} />}
                {taxes.length > 0 && <ObjectGrid title={__('Taxonomías')} icon={Tags} objects={taxes} choices={choices} onToggle={toggleObject} />}
            </fieldset>

            {chosen.length > 0 && (
                <fieldset className="imcrm-space-y-3">
                    <legend className="imcrm-text-sm imcrm-font-medium">{__('2. Qué columnas y cuáles se editan desde aquí')}</legend>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Marca las columnas que quieres ver en la lista. Las que tienen «Editable» se pueden cambiar desde la app y el cambio viaja a WordPress; las demás son de sólo lectura. Nunca se trae el contenido completo de una entrada: para eso está «Editar en WordPress».')}
                    </p>
                    {chosen.map((o) => (
                        <ColumnPicker
                            key={objectKey(o)}
                            object={o}
                            seoName={d.plugin.seo?.name ?? null}
                            choice={choices[objectKey(o)]!}
                            writeBack={writeBack}
                            onChange={(c) => setChoices((prev) => ({ ...prev, [objectKey(o)]: c }))}
                        />
                    ))}
                </fieldset>
            )}

            <fieldset className="imcrm-space-y-3">
                <legend className="imcrm-text-sm imcrm-font-medium">{chosen.length > 0 ? __('3. Mantener al día') : __('2. Mantener al día')}</legend>
                <SiteSyncModeChoice mode={mode} interval={interval} onMode={setPickedMode} onInterval={setIntervalMin} realtimeBlocked={realtimeBlocked} idPrefix="imcrm-site-sync" />
                <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                    <input type="checkbox" className="imcrm-mt-0.5" checked={writeBack} onChange={(e) => setWriteBack(e.target.checked)} data-testid="imcrm-site-sync-writeback" />
                    <span>
                        <span className="imcrm-font-medium">{__('Editar desde la app')}</span>
                        <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Lo que cambies en una columna editable se manda a WordPress. Apagado, todo lo que viene del sitio es de sólo lectura.')}
                        </span>
                    </span>
                </label>
                <div className="imcrm-space-y-2">
                    <p className="imcrm-text-sm imcrm-font-medium">{__('Cuando algo se borre en WordPress')}</p>
                    <SourceDeleteChoice value={onDelete} onChange={setOnDelete} source="WordPress" />
                </div>
            </fieldset>

            {chosen.length > 0 && (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-bg-muted/60 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                    <FolderOpen className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                    {sprintf(
                        chosen.length === 1 ? __('Se crea la carpeta «WordPress · %1$s» con una lista: %2$s.') : __('Se crea la carpeta «WordPress · %1$s» con %3$d listas: %2$s.'),
                        d.site_name,
                        chosen.map((o) => o.label).join(', '),
                        chosen.length,
                    )}
                </p>
            )}

            {error && (
                <p className="imcrm-whitespace-pre-wrap imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-site-sync-error">
                    {error}
                </p>
            )}
            <div className="imcrm-flex imcrm-justify-end">
                <Button disabled={setup.isPending || chosen.length === 0} onClick={() => { setError(null); setup.mutate(); }} data-testid="imcrm-site-sync-start">
                    {setup.isPending ? __('Creando las listas…') : __('Empezar a sincronizar')}
                </Button>
            </div>
        </section>
    );
}

function chosenObjects(d: SiteDiscovery | undefined, choices: Record<string, Choice>): SiteObjectChoice[] {
    if (!d) return [];
    return d.objects
        .filter((o) => choices[objectKey(o)])
        .map((o) => {
            const c = choices[objectKey(o)]!;
            return {
                kind: o.kind,
                object: o.object,
                columns: [...c.columns],
                editable: [...c.editable].filter((k) => c.columns.has(k)),
            };
        });
}

function ObjectGrid({
    title,
    icon: Icon,
    objects,
    choices,
    onToggle,
}: {
    title: string;
    icon: typeof FileText;
    objects: SiteObject[];
    choices: Record<string, Choice>;
    onToggle: (o: SiteObject) => void;
}): JSX.Element {
    return (
        <div className="imcrm-space-y-1.5">
            <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">
                <Icon className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                {title}
            </p>
            <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2 lg:imcrm-grid-cols-3">
                {objects.map((o) => {
                    const on = choices[objectKey(o)] !== undefined;
                    return (
                        <label
                            key={objectKey(o)}
                            className={cn(
                                'imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-p-3 imcrm-text-sm imcrm-transition-colors',
                                on ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border hover:imcrm-bg-muted/40',
                                o.synced && 'imcrm-cursor-not-allowed imcrm-opacity-60',
                            )}
                            data-testid={`imcrm-site-object-${o.kind}-${o.object}`}
                        >
                            <input type="checkbox" className="imcrm-mt-0.5" checked={on} disabled={o.synced} onChange={() => onToggle(o)} />
                            <span className="imcrm-min-w-0">
                                <span className="imcrm-block imcrm-font-medium">{o.label}</span>
                                <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                    {o.synced ? __('Ya se sincroniza') : o.count === null ? o.object : objectCount(o.kind, o.count)}
                                </span>
                            </span>
                        </label>
                    );
                })}
            </div>
        </div>
    );
}

function ColumnPicker({
    object,
    seoName,
    choice,
    writeBack,
    onChange,
}: {
    object: SiteObject;
    seoName: string | null;
    choice: Choice;
    writeBack: boolean;
    onChange: (c: Choice) => void;
}): JSX.Element {
    const [open, setOpen] = useState(true);
    const [showPrivate, setShowPrivate] = useState(false);
    const groups = useMemo(() => siteColumnGroups(object.columns), [object]);
    const toggleCol = (c: SiteColumn, on: boolean): void => {
        const columns = new Set(choice.columns);
        const editable = new Set(choice.editable);
        if (on) {
            columns.add(c.key);
            if (c.can_edit && c.default_edit) editable.add(c.key);
        } else {
            columns.delete(c.key);
            editable.delete(c.key);
        }
        onChange({ columns, editable });
    };
    const toggleEdit = (c: SiteColumn, on: boolean): void => {
        const editable = new Set(choice.editable);
        if (on) editable.add(c.key);
        else editable.delete(c.key);
        onChange({ columns: choice.columns, editable });
    };
    const count = choice.columns.size;
    const row = (c: SiteColumn): JSX.Element => {
        const on = choice.columns.has(c.key);
        const editable = choice.editable.has(c.key);
        return (
            <li key={c.key} className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-gap-x-3 imcrm-gap-y-1 imcrm-py-1.5" data-testid={`imcrm-site-col-${object.object}-${c.key}`}>
                <label className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-basis-56 imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                    <input type="checkbox" className="imcrm-mt-0.5" checked={on} disabled={c.always} onChange={(e) => toggleCol(c, e.target.checked)} />
                    <span className="imcrm-min-w-0">
                        <span className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                            {c.label}
                            <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{c.image ? __('Imagen') : __(TYPE_LABEL[c.type] ?? c.type)}</span>
                            {c.always && <span className="imcrm-text-[11px] imcrm-text-muted-foreground">· {__('siempre')}</span>}
                        </span>
                        {c.sample !== null && <span className="imcrm-block imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">{sprintf(__('Ej.: %s'), c.sample)}</span>}
                        {c.hint && on && (editable || !c.can_edit) && <span className="imcrm-block imcrm-text-[11px] imcrm-text-warning">{c.hint}</span>}
                    </span>
                </label>
                {c.can_edit && on && (
                    <label className={cn('imcrm-flex imcrm-shrink-0 imcrm-cursor-pointer imcrm-items-center imcrm-gap-1.5 imcrm-text-xs', !writeBack && 'imcrm-opacity-50')}>
                        <input type="checkbox" checked={editable} disabled={!writeBack} onChange={(e) => toggleEdit(c, e.target.checked)} data-testid={`imcrm-site-edit-${object.object}-${c.key}`} />
                        <ArrowLeftRight className="imcrm-h-3 imcrm-w-3 imcrm-text-primary" aria-hidden />
                        {__('Editable')}
                    </label>
                )}
            </li>
        );
    };
    return (
        <div className="imcrm-rounded-md imcrm-border imcrm-border-border">
            <button
                type="button"
                className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-text-sm"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
            >
                {open ? <ChevronDown className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" /> : <ChevronRight className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />}
                <span className="imcrm-flex-1 imcrm-font-medium">{object.label}</span>
                <span className="imcrm-text-xs imcrm-text-muted-foreground">{sprintf(count === 1 ? __('%d columna') : __('%d columnas'), count)}</span>
            </button>
            {open && (
                <div className="imcrm-space-y-3 imcrm-border-t imcrm-border-border imcrm-px-3 imcrm-py-2">
                    <ColumnGroup title={__('De WordPress')}>{groups.core.map(row)}</ColumnGroup>
                    {groups.seo.length > 0 && (
                        <ColumnGroup title={seoName ? sprintf(__('SEO · %s'), seoName) : __('SEO')} testId={`imcrm-site-colgroup-${object.object}-seo`}>
                            {groups.seo.map(row)}
                        </ColumnGroup>
                    )}
                    {groups.acf.length > 0 && <ColumnGroup title={__('Campos de ACF')}>{groups.acf.map(row)}</ColumnGroup>}
                    {groups.metabox.length > 0 && <ColumnGroup title={__('Campos de Meta Box')}>{groups.metabox.map(row)}</ColumnGroup>}
                    {groups.jetengine.length > 0 && <ColumnGroup title={__('Campos de JetEngine')}>{groups.jetengine.map(row)}</ColumnGroup>}
                    {groups.meta.length > 0 && <ColumnGroup title={__('Campos personalizados')}>{groups.meta.map(row)}</ColumnGroup>}
                    {groups.plugin.length > 0 && <ColumnGroup title={__('Datos del complemento')}>{groups.plugin.map(row)}</ColumnGroup>}
                    {groups.internal.length > 0 && (
                        <div>
                            <button type="button" className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground" onClick={() => setShowPrivate((v) => !v)}>
                                {showPrivate ? <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5" /> : <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5" />}
                                {sprintf(__('Datos internos de plugins (%d)'), groups.internal.length)}
                            </button>
                            {showPrivate && <ul className="imcrm-mt-1 imcrm-divide-y imcrm-divide-border">{groups.internal.map(row)}</ul>}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function ColumnGroup({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }): JSX.Element {
    return (
        <div data-testid={testId}>
            <p className="imcrm-text-[11px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{title}</p>
            <ul className="imcrm-divide-y imcrm-divide-border">{children}</ul>
        </div>
    );
}

// ── Sincronizado ──────────────────────────────────────────────────────────

function Configured({
    status,
    queued,
    connectionId,
    onChange,
    onQueued,
}: {
    status: SiteSyncStatus;
    queued: boolean;
    connectionId: number;
    onChange: (s: SiteSyncStatus) => void;
    onQueued: (s: SiteSyncStatus) => void;
}): JSX.Element {
    const navigate = useNavigate();
    const confirm = useConfirm();
    const qc = useQueryClient();
    const [error, setError] = useState<string | null>(null);
    // Optimista: el interruptor se mueve al tocarlo (lección de v0.1.207/v0.1.209).
    const [writeBackLocal, setWriteBackLocal] = useState<boolean | null>(null);
    const onErr = (err: unknown) => setError(errText(err));
    const run = useMutation({ mutationFn: (full: boolean) => api.siteSyncRun(connectionId, full), onSuccess: onQueued, onError: onErr });
    const update = useMutation({
        mutationFn: (patch: Parameters<typeof api.siteSyncUpdate>[1]) => api.siteSyncUpdate(connectionId, patch),
        onSuccess: (s) => {
            // Cambia la marca de las listas: candados y banner.
            void qc.invalidateQueries({ queryKey: listsKeys.all });
            setWriteBackLocal(null);
            setModeLocal(null);
            onChange(s);
        },
        onError: (err) => {
            setWriteBackLocal(null);
            setModeLocal(null);
            onErr(err);
        },
    });
    const remove = useMutation({
        mutationFn: () => api.siteSyncRemove(connectionId),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['site-sync', connectionId] });
            void qc.invalidateQueries({ queryKey: listsKeys.all });
            navigate('/settings?s=conectores');
        },
        onError: onErr,
    });
    const writeBack = writeBackLocal ?? status.write_back;
    // Optimista también el modo (el alta de los avisos en el sitio tarda unos segundos).
    const [modeLocal, setModeLocal] = useState<SiteSyncMode | null>(null);
    const mode = modeLocal ?? status.mode;
    const pluginKnown = status.plugin !== null;
    const pluginInstalled = status.plugin?.installed === true;
    const authProblem = status.last_error !== null && /contraseña|Authorization|usuario/.test(status.last_error);
    const state: 'running' | 'queued' | 'error' | 'paused' | 'ok' | 'pending' = status.running
        ? 'running'
        : queued
          ? 'queued'
          : !status.enabled
            ? 'paused'
            : status.last_error
              ? 'error'
              : status.initial_done
                ? 'ok'
                : 'pending';
    const current = status.objects.find((o) => o.resource === status.current);

    return (
        <div className="imcrm-space-y-6">
            {pluginKnown && (
                <SitePluginCard
                    state={{
                        installed: pluginInstalled,
                        version: status.plugin?.version ?? null,
                        latest: status.plugin_latest,
                        seoName: status.plugin?.seo_name ?? null,
                        missingSince: status.plugin?.missing_since ?? null,
                    }}
                    siteUrl={status.site_url}
                    checking={status.running || queued || run.isPending}
                    onRecheck={() => run.mutate(false)}
                    recheckLabel={status.plugin?.missing_since ? __('Ya lo activé') : __('Ya lo instalé')}
                />
            )}
            <SiteNoveltiesCard status={status} connectionId={connectionId} onChange={onChange} onQueued={onQueued} />
            <section className="imcrm-space-y-4 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5" data-testid="imcrm-site-sync-status">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-3">
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <StateBadge state={state} current={current?.label ?? null} />
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Última vez al día')}: {when(status.last_success_at)}
                            {status.enabled && status.next_run_at && !status.running && ` · ${__('Próxima')}: ${when(status.next_run_at)}`}
                        </span>
                    </div>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                        <Button size="sm" variant="outline" disabled={status.running || queued || run.isPending} onClick={() => run.mutate(false)} data-testid="imcrm-site-sync-run">
                            <RefreshCw className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Sincronizar ahora')}
                        </Button>
                    </div>
                </div>

                {status.last_error && (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-site-sync-last-error">
                        <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                        <span className="imcrm-min-w-0 imcrm-flex-1">{status.last_error}</span>
                        {authProblem && (
                            <Button size="sm" variant="outline" asChild>
                                <Link to="/settings?s=conectores">{__('Volver a conectar')}</Link>
                            </Button>
                        )}
                    </div>
                )}
                {status.warnings.length > 0 && (
                    <ul className="imcrm-space-y-1">
                        {status.warnings.map((w) => (
                            <li key={w} className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-warning">
                                <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                                {w}
                            </li>
                        ))}
                    </ul>
                )}

                <div className="imcrm-space-y-2">
                    <p className="imcrm-text-xs imcrm-font-medium">{__('Cómo se mantiene al día')}</p>
                    <SiteSyncModeChoice
                        mode={mode}
                        interval={status.interval_minutes}
                        onMode={(m) => {
                            if (m === mode) return;
                            setModeLocal(m);
                            update.mutate({ mode: m });
                        }}
                        onInterval={(n) => update.mutate({ interval_minutes: n })}
                        realtimeBlocked={pluginInstalled || mode === 'realtime' ? null : __('Necesita el complemento en el sitio.')}
                        disabled={update.isPending}
                        idPrefix="imcrm-site-sync-cfg"
                    />
                    <RealtimeLine status={status} />
                    <button
                        type="button"
                        className="imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground hover:imcrm-underline"
                        onClick={() => update.mutate({ enabled: !status.enabled })}
                        data-testid="imcrm-site-sync-pause"
                    >
                        {status.enabled ? __('Pausar la sincronización') : __('Reanudar la sincronización')}
                    </button>
                </div>
                <div>
                    <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                        <input
                            type="checkbox"
                            className="imcrm-mt-0.5"
                            checked={writeBack}
                            onChange={(e) => {
                                setWriteBackLocal(e.target.checked);
                                update.mutate({ write_back: e.target.checked });
                            }}
                            data-testid="imcrm-site-sync-writeback-cfg"
                        />
                        <span>
                            <span className="imcrm-font-medium">{__('Editar desde la app')}</span>
                            <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                {status.write_back_status.pushed > 0 || status.write_back_status.failed > 0
                                    ? sprintf(__('%1$d cambios enviados al sitio · %2$d con error.'), status.write_back_status.pushed, status.write_back_status.failed)
                                    : __('Lo que cambies en una columna editable se manda a WordPress.')}
                            </span>
                            {status.write_back_status.last_error && (
                                <span className="imcrm-mt-1 imcrm-block imcrm-text-xs imcrm-text-destructive" data-testid="imcrm-site-sync-push-error">
                                    {status.write_back_status.last_error}
                                </span>
                            )}
                        </span>
                    </label>
                </div>
                {error && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
            </section>

            {status.objects.map((o) => (
                <ObjectCard key={o.resource} object={o} status={status} connectionId={connectionId} writeBack={writeBack} running={status.running && status.current === o.resource} onChange={onChange} onQueued={onQueued} />
            ))}

            <AddObjects status={status} connectionId={connectionId} onQueued={onQueued} />

            <SourceDeleteSection
                value={update.isPending && update.variables?.on_source_delete ? update.variables.on_source_delete : status.on_source_delete}
                gone={status.gone}
                source="WordPress"
                busy={update.isPending}
                onChange={(v) => {
                    setError(null);
                    update.mutate({ on_source_delete: v });
                }}
            />

            <section className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-4">
                <div className="imcrm-min-w-0 imcrm-text-sm">
                    <p className="imcrm-font-medium">{__('Dejar de sincronizar')}</p>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Las listas y lo que tienen quedan en tu empresa y pasan a ser listas comunes: se editan libremente y ya no viajan a WordPress.')}
                    </p>
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    disabled={remove.isPending}
                    onClick={() =>
                        void confirm({
                            title: __('¿Dejar de sincronizar el sitio?'),
                            description: __('Las listas y sus datos quedan. Lo que cambie en WordPress ya no llega, y lo que cambies aquí ya no viaja al sitio.'),
                            confirmLabel: __('Dejar de sincronizar'),
                            destructive: true,
                        }).then((ok) => ok && remove.mutate())
                    }
                    data-testid="imcrm-site-sync-remove"
                >
                    {__('Dejar de sincronizar')}
                </Button>
            </section>
        </div>
    );
}

/** El estado de los avisos al instante: cuántos llegaron, el último y si algo falló. */
function RealtimeLine({ status }: { status: SiteSyncStatus }): JSX.Element | null {
    const r = status.realtime;
    if (status.mode !== 'realtime' && !r.error) return null;
    if (status.mode === 'realtime' && status.effective_mode !== 'realtime') {
        return (
            <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-warning" data-testid="imcrm-site-sync-realtime" data-state="fallback">
                <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                {sprintf(__('Al instante necesita el complemento: mientras no esté, el sitio se revisa %s.'), siteIntervalText(status.interval_minutes))}
            </p>
        );
    }
    return (
        <div className="imcrm-space-y-1" data-testid="imcrm-site-sync-realtime" data-state={r.error ? 'error' : r.registered ? 'listening' : 'pending'}>
            {r.registered && !r.error && (
                <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                    <span className="imcrm-relative imcrm-flex imcrm-h-2 imcrm-w-2" aria-hidden>
                        <span className="imcrm-absolute imcrm-inline-flex imcrm-h-full imcrm-w-full imcrm-animate-ping imcrm-rounded-full imcrm-bg-success imcrm-opacity-60 motion-reduce:imcrm-animate-none" />
                        <span className="imcrm-relative imcrm-inline-flex imcrm-h-2 imcrm-w-2 imcrm-rounded-full imcrm-bg-success" />
                    </span>
                    <span className="imcrm-font-medium imcrm-text-foreground">{__('Escuchando al sitio')}</span>
                    <span>
                        {[
                            sprintf(r.received === 1 ? __('%s aviso recibido') : __('%s avisos recibidos'), formatNumber(r.received)),
                            r.last_at ? `${__('el último')}: ${when(r.last_at)}` : null,
                            __('revisión completa cada hora'),
                        ]
                            .filter(Boolean)
                            .join(' · ')}
                    </span>
                </p>
            )}
            {!r.registered && !r.error && <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Activando los avisos en el sitio…')}</p>}
            {r.error && (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-destructive" data-testid="imcrm-site-sync-realtime-error">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                    {r.error}
                </p>
            )}
        </div>
    );
}

function siteIntervalText(n: number): string {
    if (n === 60) return __('cada hora');
    if (n === 1440) return __('una vez por día');
    if (n % 60 === 0) return sprintf(__('cada %d horas'), n / 60);
    return sprintf(__('cada %d minutos'), n);
}

function StateBadge({ state, current }: { state: 'running' | 'queued' | 'error' | 'paused' | 'ok' | 'pending'; current: string | null }): JSX.Element {
    if (state === 'running') {
        return (
            <Badge variant="outline" className="imcrm-gap-1" data-testid="imcrm-site-sync-state" data-state="running">
                <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                {current ? sprintf(__('Trayendo %s…'), current.toLowerCase()) : __('Sincronizando…')}
            </Badge>
        );
    }
    if (state === 'queued') {
        return (
            <Badge variant="outline" className="imcrm-gap-1" data-testid="imcrm-site-sync-state" data-state="queued">
                <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                {__('En cola…')}
            </Badge>
        );
    }
    if (state === 'ok') {
        return (
            <Badge variant="success" className="imcrm-gap-1" data-testid="imcrm-site-sync-state" data-state="ok">
                <CheckCircle2 className="imcrm-h-3 imcrm-w-3" />
                {__('Al día')}
            </Badge>
        );
    }
    if (state === 'error') {
        return (
            <Badge variant="destructive" data-testid="imcrm-site-sync-state" data-state="error">
                {__('Con problemas')}
            </Badge>
        );
    }
    return (
        <Badge variant="outline" data-testid="imcrm-site-sync-state" data-state={state}>
            {state === 'paused' ? __('En pausa') : __('Esperando la primera vuelta')}
        </Badge>
    );
}

function ObjectCard({
    object: o,
    status,
    connectionId,
    writeBack,
    running,
    onChange,
    onQueued,
}: {
    object: SiteSyncObjectState;
    status: SiteSyncStatus;
    connectionId: number;
    writeBack: boolean;
    running: boolean;
    onChange: (s: SiteSyncStatus) => void;
    onQueued: (s: SiteSyncStatus) => void;
}): JSX.Element {
    const qc = useQueryClient();
    const [showColumns, setShowColumns] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const toggle = useMutation({
        mutationFn: (t: { key: string; on: boolean }) => api.siteSyncUpdate(connectionId, { editable_toggle: { resource: o.resource, key: t.key, on: t.on } }),
        onSuccess: (s) => {
            void qc.invalidateQueries({ queryKey: listsKeys.all });
            onChange(s);
        },
        onError: (err) => setError(errText(err)),
    });
    const removeCol = useMutation({
        mutationFn: (key: string) => api.siteSyncRemoveColumn(connectionId, { resource: o.resource, key }),
        onSuccess: (s) => {
            void qc.invalidateQueries({ queryKey: listsKeys.all });
            onChange(s);
        },
        onError: (err) => setError(errText(err)),
    });
    const addCol = useMutation({
        mutationFn: (key: string) => api.siteSyncAddColumn(connectionId, { resource: o.resource, key }),
        onSuccess: (s) => {
            void qc.invalidateQueries({ queryKey: listsKeys.all });
            onQueued(s);
        },
        onError: (err) => setError(errText(err)),
    });
    const discover = useQuery({
        queryKey: ['site-sync', connectionId, 'discover'],
        queryFn: () => api.siteSyncDiscover(connectionId),
        enabled: showColumns,
        retry: false,
        staleTime: 60_000,
    });
    const have = new Set(o.columns.map((c) => c.key));
    const more = (discover.data?.objects.find((x) => objectKey(x) === o.resource)?.columns ?? []).filter((c) => !have.has(c.key));
    const pct = o.total && o.total > 0 ? Math.min(100, Math.round((o.done / o.total) * 100)) : null;
    const needsPlugin = o.columns.filter((c) => c.needs_plugin);

    return (
        <section className="imcrm-space-y-4 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5" data-testid={`imcrm-site-object-card-${o.resource}`}>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-3">
                <div className="imcrm-min-w-0">
                    <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                        <ObjectIcon kind={o.kind} />
                        {o.label}
                    </h2>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {o.kind === 'media' ? objectCount('media', o.count) : sprintf(o.count === 1 ? __('%s registro') : __('%s registros'), formatNumber(o.count))}
                        {running && pct !== null && ` · ${sprintf(__('%d %% de esta vuelta'), pct)}`}
                    </p>
                </div>
                {o.list ? (
                    <Button size="sm" variant="outline" asChild>
                        <Link to={`/lists/${o.list.slug}`} data-testid={`imcrm-site-open-list-${o.resource}`}>
                            {__('Abrir la lista')}
                        </Link>
                    </Button>
                ) : (
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('La lista se borró: este contenido ya no se escribe.')}</span>
                )}
            </div>
            {running && pct !== null && (
                <div className="imcrm-h-1.5 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted" aria-hidden>
                    <div className="imcrm-h-full imcrm-rounded-full imcrm-bg-primary imcrm-transition-all" style={{ width: `${pct}%` }} />
                </div>
            )}

            <div className="imcrm-space-y-2" id={`editar-${o.resource}`}>
                <p className="imcrm-text-xs imcrm-font-medium">{__('Columnas que se editan desde la app')}</p>
                {!writeBack && (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('«Editar desde la app» está apagado: hasta que lo actives, todo lo que viene del sitio es de sólo lectura.')}</p>
                )}
                <SiteEditableColumns object={o} busy={toggle.isPending} onToggle={(key, on) => toggle.mutate({ key, on })} />
            </div>

            <div>
                <button
                    type="button"
                    className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground"
                    onClick={() => setShowColumns((v) => !v)}
                    aria-expanded={showColumns}
                    data-testid={`imcrm-site-columns-${o.resource}`}
                >
                    {showColumns ? <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5" /> : <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5" />}
                    {sprintf(__('Columnas que se traen (%d)'), o.columns.length)}
                </button>
                {showColumns && (
                    <div className="imcrm-mt-2 imcrm-space-y-3">
                        <ul className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                            {o.columns.map((c) => (
                                <li
                                    key={c.key}
                                    className={cn(
                                        'imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-border imcrm-px-2 imcrm-py-0.5 imcrm-text-xs',
                                        c.needs_plugin ? 'imcrm-border-warning/40 imcrm-text-muted-foreground' : 'imcrm-border-border',
                                    )}
                                    title={c.needs_plugin ? __('Viene del complemento, que ya no está en el sitio.') : undefined}
                                >
                                    {c.needs_plugin && <Lock className="imcrm-h-3 imcrm-w-3" aria-hidden />}
                                    {c.label}
                                    {!c.always && (
                                        <button
                                            type="button"
                                            className="imcrm-text-muted-foreground hover:imcrm-text-destructive"
                                            aria-label={sprintf(__('Dejar de traer «%s»'), c.label)}
                                            title={__('Dejar de traerla: la columna y lo que tiene quedan, como columna propia.')}
                                            disabled={removeCol.isPending}
                                            onClick={() => removeCol.mutate(c.key)}
                                        >
                                            <X className="imcrm-h-3 imcrm-w-3" />
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                        {discover.isLoading && <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Buscando más columnas en el sitio…')}</p>}
                        {more.length > 0 && (
                            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                                <Select
                                    aria-label={__('Traer otra columna')}
                                    className="imcrm-w-64"
                                    value=""
                                    onChange={(e) => e.target.value && addCol.mutate(e.target.value)}
                                    disabled={addCol.isPending}
                                    data-testid={`imcrm-site-add-column-${o.resource}`}
                                >
                                    <option value="">{__('Traer otra columna…')}</option>
                                    {more.map((c) => (
                                        <option key={c.key} value={c.key}>
                                            {c.label}
                                            {siteColumnOrigin(c) ? ` · ${__(siteColumnOrigin(c))}` : ''}
                                        </option>
                                    ))}
                                </Select>
                                <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground">
                                    <Plus className="imcrm-h-3 imcrm-w-3" />
                                    {__('Se crea la columna y se llena con lo que hay.')}
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </div>
            {needsPlugin.length > 0 && (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-warning" data-testid={`imcrm-site-needs-plugin-${o.resource}`}>
                    <Lock className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                    {sprintf(
                        needsPlugin.length === 1
                            ? __('%s viene del complemento, que ya no está en el sitio: queda con lo último que llegó y no se puede editar.')
                            : __('%s vienen del complemento, que ya no está en el sitio: quedan con lo último que llegó y no se pueden editar.'),
                        needsPlugin.map((c) => `«${c.label}»`).join(', '),
                    )}
                </p>
            )}
            {o.list && (o.kind === 'media' || o.kind === 'post_type' || o.kind === 'taxonomy') && <SiteKits object={o} status={status} connectionId={connectionId} />}
            {status.site_url && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {status.on_source_delete === 'remove'
                        ? o.kind === 'media'
                            ? __('Lo nuevo se sube en WordPress y llega solo; lo que se borra allá sale de aquí solo.')
                            : __('Lo nuevo se crea en WordPress y llega solo; lo que se borra allá sale de aquí solo.')
                        : o.kind === 'media'
                          ? __('Lo nuevo se sube en WordPress y llega solo; lo que se borra allá queda aquí en «Papelera» hasta que lo quites.')
                          : __('Lo nuevo se crea en WordPress y llega solo; lo que se borra allá queda aquí en «Papelera» hasta que lo quites.')}
                </p>
            )}
            {error && <p className="imcrm-text-xs imcrm-text-destructive">{error}</p>}
        </section>
    );
}

function ObjectIcon({ kind }: { kind: SiteObject['kind'] }): JSX.Element {
    const Icon = objectIcon(kind);
    return <Icon className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />;
}

function AddObjects({ status, connectionId, onQueued }: { status: SiteSyncStatus; connectionId: number; onQueued: (s: SiteSyncStatus) => void }): JSX.Element {
    const qc = useQueryClient();
    const [open, setOpen] = useState(false);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const discover = useQuery({
        queryKey: ['site-sync', connectionId, 'discover'],
        queryFn: () => api.siteSyncDiscover(connectionId),
        enabled: open,
        retry: false,
        staleTime: 60_000,
    });
    const synced = new Set(status.objects.map((o) => o.resource));
    const options = (discover.data?.objects ?? []).filter((o) => !synced.has(objectKey(o)));
    const add = useMutation({
        mutationFn: () =>
            api.siteSyncAddObjects(connectionId, {
                objects: options
                    .filter((o) => picked.has(objectKey(o)))
                    .map((o) => {
                        const c = initialChoice(o);
                        return { kind: o.kind, object: o.object, columns: [...c.columns], editable: [...c.editable] };
                    }),
            }),
        onSuccess: (s) => {
            setPicked(new Set());
            setOpen(false);
            void qc.invalidateQueries({ queryKey: listsKeys.all });
            void qc.invalidateQueries({ queryKey: ['site-sync', connectionId, 'discover'] });
            onQueued(s);
        },
        onError: (err) => setError(errText(err)),
    });
    return (
        <section className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-4">
            <button type="button" className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="imcrm-site-add-objects">
                <Plus className="imcrm-h-4 imcrm-w-4" />
                {__('Traer otro tipo de contenido')}
            </button>
            {open && (
                <div className="imcrm-mt-3 imcrm-space-y-3">
                    {discover.isLoading && <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Revisando qué tiene tu sitio…')}</p>}
                    {discover.isError && <p className="imcrm-text-xs imcrm-text-destructive">{errText(discover.error)}</p>}
                    {discover.data && options.length === 0 && <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Ya se trae todo lo que tiene el sitio.')}</p>}
                    <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2">
                        {options.map((o) => (
                            <label key={objectKey(o)} className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                <input
                                    type="checkbox"
                                    checked={picked.has(objectKey(o))}
                                    onChange={(e) =>
                                        setPicked((prev) => {
                                            const next = new Set(prev);
                                            if (e.target.checked) next.add(objectKey(o));
                                            else next.delete(objectKey(o));
                                            return next;
                                        })
                                    }
                                />
                                {o.label}
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">{o.kind === 'taxonomy' ? __('taxonomía') : o.kind === 'media' ? __('medios') : __('contenido')}</span>
                            </label>
                        ))}
                    </div>
                    {options.length > 0 && (
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Llegan con las columnas de siempre; después puedes traer más desde su tarjeta.')}</p>
                    )}
                    {error && <p className="imcrm-text-xs imcrm-text-destructive">{error}</p>}
                    {options.length > 0 && (
                        <Button size="sm" disabled={picked.size === 0 || add.isPending} onClick={() => { setError(null); add.mutate(); }}>
                            {add.isPending ? __('Creando…') : __('Traer')}
                        </Button>
                    )}
                </div>
            )}
        </section>
    );
}

// ── Novedades del sitio (v0.1.336) ──────────────────────────────────────

/**
 * Lo que apareció en WordPress desde la última revisión: un tipo de contenido
 * nuevo (un CPT recién creado) o columnas nuevas (un campo de ACF, un campo
 * personalizado) de lo que ya se trae. Se revisa solo una vez por día, y al
 * abrir «Traer otra columna» o «Traer otro tipo de contenido».
 */
function SiteNoveltiesCard({
    status,
    connectionId,
    onChange,
    onQueued,
}: {
    status: SiteSyncStatus;
    connectionId: number;
    onChange: (s: SiteSyncStatus) => void;
    onQueued: (s: SiteSyncStatus) => void;
}): JSX.Element {
    const qc = useQueryClient();
    const [error, setError] = useState<string | null>(null);
    const items = status.novelties?.items ?? [];
    const onErr = (err: unknown) => setError(errText(err));
    const check = useMutation({ mutationFn: () => api.siteSyncCheckNovelties(connectionId), onSuccess: (s) => { setError(null); onChange(s); }, onError: onErr });
    const dismiss = useMutation({
        mutationFn: (which?: SiteNovelty[]) => api.siteSyncDismissNovelties(connectionId, which?.map((n) => ({ resource: n.resource, key: n.column?.key ?? null }))),
        onSuccess: (s) => {
            void qc.invalidateQueries({ queryKey: listsKeys.all });
            onChange(s);
        },
        onError: onErr,
    });
    const addColumn = useMutation({
        mutationFn: (n: SiteNovelty) => api.siteSyncAddColumn(connectionId, { resource: n.resource, key: n.column!.key }),
        onSuccess: (s) => {
            void qc.invalidateQueries({ queryKey: listsKeys.all });
            void qc.invalidateQueries({ queryKey: ['site-sync', connectionId, 'discover'] });
            onQueued(s);
        },
        onError: onErr,
    });
    const addObject = useMutation({
        mutationFn: async (n: SiteNovelty) => {
            // Las columnas por defecto, como en «Traer otro tipo de contenido».
            const d = await qc.fetchQuery({ queryKey: ['site-sync', connectionId, 'discover'], queryFn: () => api.siteSyncDiscover(connectionId), staleTime: 60_000 });
            const o = d.objects.find((x) => objectKey(x) === n.resource);
            if (!o) throw new Error(__('El sitio ya no tiene ese tipo de contenido.'));
            const c = initialChoice(o);
            return api.siteSyncAddObjects(connectionId, { objects: [{ kind: o.kind, object: o.object, columns: [...c.columns], editable: [...c.editable] }] });
        },
        onSuccess: (s) => {
            void qc.invalidateQueries({ queryKey: listsKeys.all });
            void qc.invalidateQueries({ queryKey: ['site-sync', connectionId, 'discover'] });
            onQueued(s);
        },
        onError: onErr,
    });
    const busy = check.isPending || dismiss.isPending || addColumn.isPending || addObject.isPending;
    const checkedAt = status.novelties?.checked_at ?? null;
    const lastCheck = checkedAt ? sprintf(__('Revisado: %s'), when(checkedAt)) : __('Todavía no se revisó');

    if (items.length === 0) {
        return (
            <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-1 imcrm-px-1 imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-site-novelties-none">
                <Sparkles className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                {__('Sin tipos de contenido ni columnas nuevas en el sitio.')} {lastCheck}
                {status.novelties?.error && <span className="imcrm-text-warning">{status.novelties.error}</span>}
                <button
                    type="button"
                    className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline disabled:imcrm-opacity-60"
                    disabled={busy}
                    onClick={() => check.mutate()}
                    data-testid="imcrm-site-novelties-check"
                >
                    {check.isPending ? __('Buscando…') : __('Buscar novedades ahora')}
                </button>
                {error && <span className="imcrm-text-destructive">{error}</span>}
            </p>
        );
    }

    const objects = items.filter((n) => n.column === null);
    const columns = items.filter((n) => n.column !== null);
    const byResource = new Map<string, SiteNovelty[]>();
    for (const n of columns) byResource.set(n.resource, [...(byResource.get(n.resource) ?? []), n]);

    return (
        <section className="imcrm-space-y-3 imcrm-rounded-lg imcrm-border imcrm-border-primary/40 imcrm-bg-primary/5 imcrm-p-5" data-testid="imcrm-site-novelties" data-tour="site-novelties">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-min-w-0">
                    <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                        <Sparkles className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                        {__('Novedades en tu sitio')}
                    </h2>
                    <p className="imcrm-mt-0.5 imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Desde la última revisión aparecieron en WordPress estas cosas que todavía no se traen. Trae las que quieras: las columnas se llenan solas con lo que ya tiene el sitio.')}
                    </p>
                </div>
                <Button size="sm" variant="ghost" className="imcrm-ml-auto" disabled={busy} onClick={() => dismiss.mutate(undefined)} data-testid="imcrm-site-novelties-dismiss-all">
                    {__('Ya vi todo')}
                </Button>
            </div>

            {objects.length > 0 && (
                <ul className="imcrm-space-y-1.5">
                    {objects.map((n) => (
                        <li key={n.resource} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-card imcrm-px-3 imcrm-py-2 imcrm-text-sm" data-testid={`imcrm-site-novelty-object-${n.resource}`}>
                            <ObjectIcon kind={n.kind} />
                            <span className="imcrm-font-medium">{n.object_label}</span>
                            <Badge variant="outline">{n.kind === 'taxonomy' ? __('Taxonomía nueva') : __('Tipo de contenido nuevo')}</Badge>
                            <span className="imcrm-ml-auto imcrm-flex imcrm-gap-1.5">
                                <Button size="sm" disabled={busy} onClick={() => addObject.mutate(n)}>
                                    {addObject.isPending && addObject.variables?.resource === n.resource ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Plus className="imcrm-h-3.5 imcrm-w-3.5" />}
                                    {__('Traerlo')}
                                </Button>
                                <Button size="sm" variant="ghost" disabled={busy} onClick={() => dismiss.mutate([n])}>
                                    {__('Ya lo vi')}
                                </Button>
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            {[...byResource.entries()].map(([resource, list]) => (
                <div key={resource} className="imcrm-space-y-1.5" data-testid={`imcrm-site-novelty-columns-${resource}`}>
                    <p className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">
                        {sprintf(list.length === 1 ? __('Columna nueva en «%s»') : __('Columnas nuevas en «%s»'), list[0]!.object_label)}
                    </p>
                    <ul className="imcrm-space-y-1.5">
                        {list.map((n) => (
                            <li key={n.column!.key} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-card imcrm-px-3 imcrm-py-2 imcrm-text-sm">
                                <span className="imcrm-font-medium">{n.column!.label}</span>
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">{noveltySourceLabel(n)}</span>
                                <span className="imcrm-ml-auto imcrm-flex imcrm-gap-1.5">
                                    <Button size="sm" disabled={busy} onClick={() => addColumn.mutate(n)} data-testid={`imcrm-site-novelty-add-${n.column!.key}`}>
                                        {addColumn.isPending && addColumn.variables?.column?.key === n.column!.key ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Plus className="imcrm-h-3.5 imcrm-w-3.5" />}
                                        {__('Traer')}
                                    </Button>
                                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => dismiss.mutate([n])}>
                                        {__('Ya lo vi')}
                                    </Button>
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}

            <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                {lastCheck}
                <button type="button" className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline disabled:imcrm-opacity-60" disabled={busy} onClick={() => check.mutate()}>
                    {check.isPending ? __('Buscando…') : __('Buscar de nuevo')}
                </button>
            </p>
            {error && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
        </section>
    );
}

/** «Campo de ACF», «Campo personalizado», «SEO»… (de dónde sale la columna nueva). */
function noveltySourceLabel(n: SiteNovelty): string {
    const c = n.column!;
    const p = c.provider ?? '';
    if (p === 'acf' || c.source === 'acf') return __('Campo de ACF');
    if (p === 'metabox') return __('Campo de Meta Box');
    if (p === 'jetengine') return __('Campo de JetEngine');
    if (c.source === 'seo') return __('SEO');
    if (c.source === 'core') return __('De WordPress');
    return __('Campo personalizado');
}
