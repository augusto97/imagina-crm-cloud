import { useId, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Check, FolderClosed, LayoutTemplate, Loader2, X } from 'lucide-react';
import { ONBOARDING_BUSINESS_TYPES, type ListTemplateSummary, type OnboardingApplyResult } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useWorkspaces } from '@/cloud/workspaceSwitch';
import { useApplyOnboarding } from '@/hooks/useOnboarding';
import { useListTemplates } from '@/hooks/useListTemplates';
import { ApiError } from '@/lib/api';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { __, _n, sprintf } from '@/lib/i18n';
import { DEFAULT_LIST_ICON, listColor, listIcon } from '@/lib/listIcons';
import { cn } from '@/lib/utils';
import { viewTypeIcon } from '@/lib/viewTypeIcons';

import { combinedListNames } from './welcomeHelpers';

/** Lo que acepta el servidor de una vez (y el tope de listas de un blueprint). */
const MAX_TEMPLATES = 6;
const MAX_LISTS = 10;
const NO_TEMPLATES: ListTemplateSummary[] = [];

interface Props {
    onCreated: (res: OnboardingApplyResult) => void;
}

/**
 * «Elegir por tipo de negocio»: las plantillas del sistema agrupadas por el
 * tipo de negocio, con la misma tarjeta y vista previa de la galería — y se
 * pueden elegir VARIAS para crearlas juntas (CRM + Facturación + Proyectos).
 */
export function BusinessTypePath({ onCreated }: Props): JSX.Element {
    const templates = useListTemplates();
    const apply = useApplyOnboarding();
    const { active } = useWorkspaces();
    const folderId = useId();

    const [type, setType] = useState<string>(ONBOARDING_BUSINESS_TYPES[0]!.id);
    const [selected, setSelected] = useState<string[]>([]);
    const [focusId, setFocusId] = useState<string | null>(null);
    const [folder, setFolder] = useState(active?.tenant_name ?? '');
    const [samples, setSamples] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const all = templates.data ?? NO_TEMPLATES;
    const byId = useMemo(() => new Map(all.filter((t) => t.source === 'system').map((t) => [t.id, t])), [all]);
    const current = ONBOARDING_BUSINESS_TYPES.find((t) => t.id === type) ?? ONBOARDING_BUSINESS_TYPES[0]!;
    const visible = current.templates.map((k) => byId.get(`sys:${k}`)).filter((t): t is ListTemplateSummary => t !== undefined);

    const chosen = selected.map((id) => byId.get(id)).filter((t): t is ListTemplateSummary => t !== undefined);
    const listNames = useMemo(() => combinedListNames(chosen), [chosen]);
    const tooMany = listNames.length > MAX_LISTS;
    const hasSamples = chosen.some((t) => t.lists.some((l) => l.records_count > 0));
    const focused = (focusId ? byId.get(focusId) : null) ?? chosen[chosen.length - 1] ?? null;

    const toggle = (t: ListTemplateSummary): void => {
        setError(null);
        setFocusId(t.id);
        setSelected((prev) => (prev.includes(t.id) ? prev.filter((x) => x !== t.id) : prev.length >= MAX_TEMPLATES ? prev : [...prev, t.id]));
    };

    const create = async (): Promise<void> => {
        setError(null);
        try {
            const res = await apply.mutateAsync({
                source: 'templates',
                template_ids: selected,
                folder_name: listNames.length > 1 && folder.trim() !== '' ? folder.trim() : undefined,
                include_samples: samples && hasSamples,
            });
            onCreated(res);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : __('No se pudo crear tu espacio.'));
        }
    };

    return (
        <div className="imcrm-flex imcrm-w-full imcrm-flex-col imcrm-gap-4" data-testid="welcome-types">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <h2 className="imcrm-text-lg imcrm-font-semibold imcrm-text-foreground">{__('Elige por tipo de negocio')}</h2>
                <p className="imcrm-text-[13px] imcrm-text-muted-foreground">
                    {__('Marca una o varias plantillas: se crean juntas y quedan conectadas cuando corresponde.')}
                </p>
            </div>

            <div className="imcrm-flex imcrm-gap-1.5 imcrm-overflow-x-auto imcrm-overflow-y-hidden imcrm-px-0.5 imcrm-py-1 sm:imcrm-flex-wrap sm:imcrm-overflow-visible" role="group" aria-label={__('Tipos de negocio')}>
                {ONBOARDING_BUSINESS_TYPES.map((t) => {
                    const Icon = listIcon(t.icon) ?? DEFAULT_LIST_ICON;
                    const on = t.id === type;
                    const count = t.templates.filter((k) => selected.includes(`sys:${k}`)).length;
                    return (
                        <button
                            key={t.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setType(t.id)}
                            className={cn(
                                'imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-border imcrm-px-3 imcrm-py-1.5 imcrm-text-[13px] imcrm-transition-colors focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/40',
                                on ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-font-medium imcrm-text-primary' : 'imcrm-border-border imcrm-text-foreground/80 hover:imcrm-bg-accent',
                            )}
                            data-testid="welcome-type"
                            data-type-id={t.id}
                        >
                            <Icon className="imcrm-h-4 imcrm-w-4" style={on ? undefined : { color: t.color }} />
                            {__(t.label)}
                            {count > 0 && (
                                <span className="imcrm-rounded-full imcrm-bg-primary imcrm-px-1.5 imcrm-text-[10px] imcrm-font-semibold imcrm-text-primary-foreground">{count}</span>
                            )}
                        </button>
                    );
                })}
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-4 lg:imcrm-flex-row lg:imcrm-items-start">
                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-2">
                    <p className="imcrm-text-[13px] imcrm-text-muted-foreground">{__(current.description)}</p>
                    {templates.isLoading ? (
                        <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">
                            <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                            {__('Cargando plantillas…')}
                        </p>
                    ) : (
                        <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2">
                            {visible.map((t) => {
                                const on = selected.includes(t.id);
                                const full = !on && selected.length >= MAX_TEMPLATES;
                                const Icon = listIcon(t.icon) ?? DEFAULT_LIST_ICON;
                                const color = listColor(t.color);
                                return (
                                    <button
                                        key={t.id}
                                        type="button"
                                        aria-pressed={on}
                                        disabled={full}
                                        onClick={() => toggle(t)}
                                        onFocus={() => setFocusId(t.id)}
                                        onMouseEnter={() => setFocusId(t.id)}
                                        className={cn(
                                            'imcrm-group imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-p-3 imcrm-text-left imcrm-transition-colors focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/40',
                                            on
                                                ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-ring-1 imcrm-ring-primary'
                                                : 'imcrm-border-border imcrm-bg-card hover:imcrm-border-primary/40 hover:imcrm-bg-accent/30',
                                            full && 'imcrm-cursor-not-allowed imcrm-opacity-50',
                                        )}
                                        data-testid="welcome-template"
                                        data-template-id={t.id}
                                    >
                                        <span className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                            <span
                                                className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-ring-1 imcrm-ring-inset imcrm-ring-border"
                                                style={color ? { color } : undefined}
                                            >
                                                <Icon className="imcrm-h-4 imcrm-w-4" />
                                            </span>
                                            <span className="imcrm-min-w-0 imcrm-flex-1">
                                                <span className="imcrm-line-clamp-2 imcrm-text-sm imcrm-font-semibold imcrm-leading-tight">{t.name}</span>
                                                <span className="imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">{templateMeta(t)}</span>
                                            </span>
                                            <span
                                                className={cn(
                                                    'imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-border',
                                                    on ? 'imcrm-border-primary imcrm-bg-primary imcrm-text-primary-foreground' : 'imcrm-border-border imcrm-bg-background',
                                                )}
                                                aria-hidden
                                            >
                                                {on && <Check className="imcrm-h-3.5 imcrm-w-3.5" />}
                                            </span>
                                        </span>
                                        {t.description && <span className="imcrm-line-clamp-2 imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">{t.description}</span>}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {focused && <TemplatePreview template={focused} />}
                </div>

                <aside className="imcrm-flex imcrm-w-full imcrm-shrink-0 imcrm-flex-col imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 lg:imcrm-sticky lg:imcrm-top-4 lg:imcrm-w-80" data-testid="welcome-types-selection">
                    <p className="imcrm-text-sm imcrm-font-semibold">{__('Tu selección')}</p>
                    {chosen.length === 0 ? (
                        <p className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-py-4 imcrm-text-center imcrm-text-[13px] imcrm-text-muted-foreground">
                            <LayoutTemplate className="imcrm-h-5 imcrm-w-5 imcrm-opacity-60" aria-hidden />
                            {__('Marca las plantillas que quieras usar. Puedes combinar de distintos tipos.')}
                        </p>
                    ) : (
                        <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            {chosen.map((t) => (
                                <li key={t.id} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-muted/60 imcrm-px-2 imcrm-py-1.5 imcrm-text-[13px]">
                                    <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{t.name}</span>
                                    <button
                                        type="button"
                                        onClick={() => toggle(t)}
                                        className="imcrm-rounded imcrm-p-0.5 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                        aria-label={sprintf(__('Quitar «%s»'), t.name)}
                                    >
                                        <X className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}

                    {chosen.length > 0 && (
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {sprintf(_n('Se crea %d lista: %s.', 'Se crean %d listas: %s.', listNames.length), listNames.length, listNames.join(', '))}
                        </p>
                    )}
                    {selected.length >= MAX_TEMPLATES && (
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">{sprintf(__('Puedes elegir hasta %d plantillas a la vez.'), MAX_TEMPLATES)}</p>
                    )}
                    {tooMany && (
                        <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-destructive" role="alert">
                            <AlertTriangle className="imcrm-mt-px imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                            {sprintf(__('Son demasiadas listas de una vez (máximo %d). Quita alguna plantilla; después puedes agregar más.'), MAX_LISTS)}
                        </p>
                    )}

                    {listNames.length > 1 && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor={folderId} className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                <FolderClosed className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />
                                {__('Carpeta')}
                            </Label>
                            <Input id={folderId} value={folder} maxLength={190} onChange={(e) => setFolder(e.target.value)} data-testid="welcome-types-folder" />
                        </div>
                    )}

                    {hasSamples && (
                        <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                            <input type="checkbox" checked={samples} onChange={(e) => setSamples(e.target.checked)} className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4" data-testid="welcome-types-samples" />
                            <span className="imcrm-flex imcrm-flex-col">
                                <span>{__('Incluir datos de ejemplo')}</span>
                                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Para ver cómo funciona. Se borran con un clic cuando quieras.')}</span>
                            </span>
                        </label>
                    )}

                    {error !== null && (
                        <p className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-2 imcrm-text-xs imcrm-text-destructive" role="alert">
                            {error}
                        </p>
                    )}

                    <Button onClick={() => void create()} disabled={chosen.length === 0 || tooMany || apply.isPending} className="imcrm-hidden imcrm-gap-2 lg:imcrm-inline-flex" data-testid="welcome-types-create">
                        {apply.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <LayoutTemplate className="imcrm-h-4 imcrm-w-4" />}
                        {apply.isPending ? __('Creando tu espacio…') : __('Crear mi espacio')}
                    </Button>
                </aside>
            </div>

            {/* En el celular la selección queda al final: un atajo fijo para crear. */}
            {chosen.length > 0 && (
                <div className="imcrm-sticky imcrm-bottom-0 imcrm-z-10 -imcrm-mx-3 imcrm-border-t imcrm-border-border imcrm-bg-background/95 imcrm-px-3 imcrm-py-2.5 imcrm-backdrop-blur lg:imcrm-hidden">
                    <Button onClick={() => void create()} disabled={tooMany || apply.isPending} className="imcrm-w-full imcrm-gap-2" data-testid="welcome-types-create-sticky">
                        {apply.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <LayoutTemplate className="imcrm-h-4 imcrm-w-4" />}
                        {apply.isPending ? __('Creando tu espacio…') : sprintf(_n('Crear mi espacio (%d lista)', 'Crear mi espacio (%d listas)', listNames.length), listNames.length)}
                    </Button>
                </div>
            )}
        </div>
    );
}

function templateMeta(t: ListTemplateSummary): string {
    const parts = [sprintf(_n('%d lista', '%d listas', t.lists.length), t.lists.length)];
    const autos = t.lists.reduce((n, l) => n + l.automations.length, 0);
    if (autos > 0) parts.push(sprintf(_n('%d automatización', '%d automatizaciones', autos), autos));
    if (t.dashboards.length > 0) parts.push(sprintf(_n('%d tablero', '%d tableros', t.dashboards.length), t.dashboards.length));
    return parts.join(' · ');
}

function TemplatePreview({ template }: { template: ListTemplateSummary }): JSX.Element {
    return (
        <div className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3" data-testid="welcome-template-preview" aria-live="polite">
            <p className="imcrm-text-xs imcrm-font-semibold imcrm-text-muted-foreground">{sprintf(__('Qué trae «%s»'), template.name)}</p>
            {template.lists.map((l) => (
                <div key={l.name} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    {template.lists.length > 1 && <p className="imcrm-text-xs imcrm-font-semibold">{l.name}</p>}
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                        {l.fields.map((f, i) => {
                            const FIcon = fieldTypeIcon(f.type);
                            return (
                                <span key={i} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px]">
                                    <FIcon className="imcrm-h-3 imcrm-w-3 imcrm-text-muted-foreground" aria-hidden />
                                    {f.label}
                                </span>
                            );
                        })}
                    </div>
                    {l.views.length > 0 && (
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-3 imcrm-gap-y-1">
                            {l.views.map((v, i) => {
                                const VIcon = viewTypeIcon(v.type);
                                return (
                                    <span key={i} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                                        <VIcon className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                        {v.name}
                                    </span>
                                );
                            })}
                        </div>
                    )}
                </div>
            ))}
            {template.dashboards.length > 0 && (
                <p className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                    <BarChart3 className="imcrm-h-3 imcrm-w-3" aria-hidden />
                    {template.dashboards.join(', ')}
                </p>
            )}
        </div>
    );
}
