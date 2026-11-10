import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { AlertTriangle, ArrowLeft, Check, Copy, LayoutList, MessageSquareText, PanelBottom, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
    WIDGET_BUTTON_TYPES,
    WIDGET_MAX_BUTTONS,
    WIDGET_TYPE_INFO,
    readContactWidgetConfig,
    widgetEmbedCode,
    type ContactWidgetConfig,
    type ContactWidgetDto,
    type ContactWidgetOptions,
    type WidgetButtonType,
} from '@imagina-base/shared';

import { Row, Segmented, Toggle } from '@/admin/records/layout/editor/inspectorUi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { ColorChoice, IconSelect, WidgetButtonEditor } from './WidgetButtonEditor';
import { WidgetIconView } from './WidgetIconView';
import { WidgetPreview } from './WidgetPreview';
import {
    addButton,
    canAddButton,
    editorProblems,
    moveButton,
    newButton,
    parseDomains,
    previewMeta,
    removeButton,
    sameConfig,
    updateButton,
} from './widgetEditor';
import {
    useContactWidget,
    useDeleteContactWidget,
    useRegenerateContactWidget,
    useUpdateContactWidget,
    useWidgetOptions,
} from './useContactWidgets';

type Tab = 'buttons' | 'look' | 'publish';
const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'buttons', label: 'Botones' },
    { id: 'look', label: 'Apariencia' },
    { id: 'publish', label: 'Publicar' },
];

/**
 * v0.1.394 (ADR-S99) — El editor de un widget de contacto: los botones, cómo
 * se ve y el código para pegar, con la vista previa en vivo al lado.
 */
export function WidgetEditorPage(): JSX.Element {
    const { widgetId } = useParams();
    const id = Number(widgetId);
    const q = useContactWidget(id);
    const options = useWidgetOptions();

    const back = (
        <Link to="/settings?s=widgets" className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-sm imcrm-text-muted-foreground hover:imcrm-text-foreground">
            <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
            {__('Widget de contacto')}
        </Link>
    );
    if (q.isLoading || options.isLoading) return <div className="imcrm-p-6 imcrm-text-sm imcrm-text-muted-foreground">{__('Cargando…')}</div>;
    if (q.isError || !q.data || !options.data) {
        return (
            <div className="imcrm-mx-auto imcrm-max-w-4xl imcrm-space-y-4 imcrm-p-6">
                {back}
                <p className="imcrm-text-sm imcrm-text-destructive">
                    {q.error instanceof Error ? q.error.message : __('No se pudo cargar el widget.')}
                </p>
            </div>
        );
    }
    return <Editor key={q.data.id} widget={q.data} options={options.data} back={back} />;
}

function Editor({ widget, options, back }: { widget: ContactWidgetDto; options: ContactWidgetOptions; back: JSX.Element }): JSX.Element {
    const nav = useNavigate();
    const confirm = useConfirm();
    const [params, setParams] = useSearchParams();
    const tab: Tab = (TABS.find((t) => t.id === params.get('t'))?.id ?? 'buttons') as Tab;
    const setTab = (t: Tab): void => {
        const next = new URLSearchParams(params);
        next.set('t', t);
        setParams(next, { replace: true });
    };

    const [name, setName] = useState(widget.name);
    const [config, setConfig] = useState<ContactWidgetConfig>(() => readContactWidgetConfig(widget.config));
    const [openId, setOpenId] = useState<string | null>(widget.config.buttons[0]?.id ?? null);
    const saved = useRef({ name: widget.name, config: readContactWidgetConfig(widget.config) });
    const [domainsText, setDomainsText] = useState(widget.config.allowed_domains.join('\n'));

    const update = useUpdateContactWidget(widget.id);
    const regenerate = useRegenerateContactWidget(widget.id);
    const remove = useDeleteContactWidget();

    const dirty = name.trim() !== saved.current.name || !sameConfig(config, saved.current.config);
    useUnsavedChangesGuard(dirty);

    const problems = useMemo(() => editorProblems(config, options), [config, options]);
    const meta = useMemo(() => previewMeta(config, options), [config, options]);
    const [justSaved, setJustSaved] = useState(false);
    useEffect(() => {
        if (!justSaved) return;
        const t = window.setTimeout(() => setJustSaved(false), 2000);
        return () => window.clearTimeout(t);
    }, [justSaved]);

    // El interruptor se mueve al tocarlo (no espera la respuesta del servidor).
    const [enabledView, setEnabledView] = useState<boolean | null>(null);
    const save = (extra?: { enabled?: boolean }): void => {
        const body = { name: name.trim() || widget.name, config, ...(extra ?? {}) };
        if (extra?.enabled !== undefined) setEnabledView(extra.enabled);
        update.mutate(body, {
            onSuccess: (doc) => {
                saved.current = { name: doc.name, config: readContactWidgetConfig(doc.config) };
                setName(doc.name);
                setConfig(readContactWidgetConfig(doc.config));
                setJustSaved(true);
            },
            onSettled: () => setEnabledView(null),
        });
    };

    const live = update.data ?? widget;
    const enabled = enabledView ?? live.enabled;
    const code = widgetEmbedCode(window.location.origin, live.public_path);

    const patchConfig = (patch: Partial<ContactWidgetConfig>): void => setConfig((c) => ({ ...c, ...patch }));

    const onAdd = (type: WidgetButtonType): void => {
        const b = newButton(type, config, options);
        setConfig((c) => addButton(c, b));
        setOpenId(b.id);
    };

    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-[1400px] imcrm-flex-col imcrm-gap-4 imcrm-p-4 sm:imcrm-p-6" data-testid="widget-editor">
            {back}
            <header className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3">
                <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={120}
                    aria-label={__('Nombre del widget')}
                    className="imcrm-h-9 imcrm-max-w-sm imcrm-text-base imcrm-font-semibold"
                    data-testid="widget-name"
                />
                <Badge variant={enabled ? 'success' : 'secondary'} dot data-testid="widget-status">
                    {enabled ? __('Publicado') : __('Sin publicar')}
                </Badge>
                <div className="imcrm-ml-auto imcrm-flex imcrm-items-center imcrm-gap-2">
                    {justSaved && (
                        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-success">
                            <Check className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Guardado')}
                        </span>
                    )}
                    <Button size="sm" onClick={() => save()} disabled={!dirty || update.isPending} data-testid="widget-save">
                        {update.isPending ? __('Guardando…') : __('Guardar')}
                    </Button>
                </div>
            </header>
            {update.isError && (
                <p className="imcrm-rounded-lg imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-p-2.5 imcrm-text-sm imcrm-text-destructive" data-testid="widget-error">
                    {update.error instanceof Error ? update.error.message : __('No se pudo guardar.')}
                </p>
            )}

            <div className="imcrm-grid imcrm-gap-6 lg:imcrm-grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-4">
                    <div className="imcrm-flex imcrm-gap-1 imcrm-border-b imcrm-border-border" role="tablist">
                        {TABS.map((t) => (
                            <button
                                key={t.id}
                                type="button"
                                role="tab"
                                aria-selected={tab === t.id}
                                onClick={() => setTab(t.id)}
                                className={cn(
                                    '-imcrm-mb-px imcrm-border-b-2 imcrm-px-3 imcrm-py-2 imcrm-text-sm',
                                    tab === t.id ? 'imcrm-border-primary imcrm-font-semibold imcrm-text-foreground' : 'imcrm-border-transparent imcrm-text-muted-foreground hover:imcrm-text-foreground',
                                )}
                                data-testid={`widget-tab-${t.id}`}
                            >
                                {__(t.label)}
                                {t.id === 'publish' && problems.length > 0 && <span className="imcrm-ml-1.5 imcrm-inline-block imcrm-h-1.5 imcrm-w-1.5 imcrm-rounded-full imcrm-bg-warning imcrm-align-middle" />}
                            </button>
                        ))}
                    </div>

                    {tab === 'buttons' && (
                        <section className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-tour="widget-buttons">
                            {config.buttons.length === 0 && (
                                <p className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-4 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                                    {__('Agrega el primer botón: WhatsApp, un formulario, tu agenda…')}
                                </p>
                            )}
                            {config.buttons.map((b, i) => (
                                <WidgetButtonEditor
                                    key={b.id}
                                    button={b}
                                    options={options}
                                    problems={problems.filter((p) => p.button_id === b.id)}
                                    open={openId === b.id}
                                    first={i === 0}
                                    last={i === config.buttons.length - 1}
                                    onToggle={() => setOpenId((cur) => (cur === b.id ? null : b.id))}
                                    onChange={(patch) => setConfig((c) => updateButton(c, b.id, patch))}
                                    onMove={(delta) => setConfig((c) => moveButton(c, b.id, delta))}
                                    onRemove={() => setConfig((c) => removeButton(c, b.id))}
                                />
                            ))}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm" className="imcrm-self-start" disabled={!canAddButton(config)} data-testid="widget-add-button" data-tour="widget-add-button">
                                        <Plus className="imcrm-h-4 imcrm-w-4" />
                                        {canAddButton(config) ? __('Agregar un botón') : sprintf(__('Máximo %d botones'), WIDGET_MAX_BUTTONS)}
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="imcrm-w-80">
                                    {WIDGET_BUTTON_TYPES.map((type) => (
                                        <DropdownMenuItem key={type} onSelect={() => onAdd(type)} className="imcrm-items-start imcrm-gap-2.5 imcrm-py-2" data-testid={`widget-add-${type}`}>
                                            <span
                                                className="imcrm-mt-0.5 imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted"
                                                style={WIDGET_TYPE_INFO[type].color ? { background: WIDGET_TYPE_INFO[type].color!, color: '#fff' } : undefined}
                                            >
                                                <WidgetIconView icon={WIDGET_TYPE_INFO[type].icon} className="imcrm-h-3.5 imcrm-w-3.5" />
                                            </span>
                                            <span className="imcrm-flex imcrm-flex-col">
                                                <span className="imcrm-text-sm imcrm-font-medium">{__(WIDGET_TYPE_INFO[type].label)}</span>
                                                <span className="imcrm-text-xs imcrm-text-muted-foreground">{__(WIDGET_TYPE_INFO[type].hint)}</span>
                                            </span>
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </section>
                    )}

                    {tab === 'look' && (
                        <section className="imcrm-flex imcrm-flex-col imcrm-gap-5" data-tour="widget-look">
                            <Row label={__('Al tocar el botón')}>
                                <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2" role="radiogroup">
                                    <LayoutCard
                                        active={config.layout === 'card'}
                                        onClick={() => patchConfig({ layout: 'card' })}
                                        icon={<MessageSquareText className="imcrm-h-5 imcrm-w-5" />}
                                        title={__('Panel tipo chat')}
                                        hint={__('Un saludo y los botones; un formulario o la agenda se abren ahí mismo.')}
                                        testId="widget-layout-card"
                                    />
                                    <LayoutCard
                                        active={config.layout === 'menu'}
                                        onClick={() => patchConfig({ layout: 'menu' })}
                                        icon={<LayoutList className="imcrm-h-5 imcrm-w-5" />}
                                        title={__('Botones apilados')}
                                        hint={__('Los botones salen uno sobre otro, encima del botón redondo.')}
                                        testId="widget-layout-menu"
                                    />
                                </div>
                            </Row>
                            {config.layout === 'card' && (
                                <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                                    <Row label={__('Saludo')}>
                                        <Input value={config.title} maxLength={80} onChange={(e) => patchConfig({ title: e.target.value })} data-testid="widget-title" />
                                    </Row>
                                    <Row label={__('Debajo del saludo')}>
                                        <Input value={config.subtitle} maxLength={200} onChange={(e) => patchConfig({ subtitle: e.target.value })} />
                                    </Row>
                                    <Toggle
                                        label={__('Mostrar el logo de la empresa')}
                                        hint={options.logo_url ? undefined : __('Sube tu logo en Ajustes → Marca.')}
                                        checked={config.show_logo}
                                        onChange={(v) => patchConfig({ show_logo: v })}
                                    />
                                </div>
                            )}
                            <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                                <Row label={__('Color')}>
                                    <ColorChoice value={config.color} fallbackLabel={__('El de tu marca')} onChange={(c) => patchConfig({ color: c })} />
                                </Row>
                                <Row label={__('Lado de la pantalla')}>
                                    <Segmented<'right' | 'left'>
                                        ariaLabel={__('Lado de la pantalla')}
                                        value={config.position}
                                        onChange={(v) => patchConfig({ position: v })}
                                        options={[
                                            { value: 'left', label: __('Izquierda') },
                                            { value: 'right', label: __('Derecha') },
                                        ]}
                                    />
                                </Row>
                                <Row label={__('Separación del borde (px)')}>
                                    <div className="imcrm-flex imcrm-gap-2">
                                        <NumberInput label={__('Del costado')} value={config.offset_x} onChange={(v) => patchConfig({ offset_x: v })} />
                                        <NumberInput label={__('De abajo')} value={config.offset_y} onChange={(v) => patchConfig({ offset_y: v })} />
                                    </div>
                                </Row>
                                <Row label={__('Texto al lado del botón (opcional)')} hint={__('Por ejemplo, «¿Hablamos?». Vacío = sólo el ícono.')}>
                                    <Input value={config.launcher_label} maxLength={40} onChange={(e) => patchConfig({ launcher_label: e.target.value })} data-testid="widget-launcher-label" />
                                </Row>
                            </div>
                            <Row label={__('Ícono del botón redondo')}>
                                <IconSelect value={config.launcher_icon} onChange={(icon) => patchConfig({ launcher_icon: icon ?? 'chat' })} />
                            </Row>
                            <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3">
                                <PanelBottom className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
                                <Toggle
                                    label={__('En el celular, una barra fija abajo')}
                                    hint={__('En vez del botón redondo, los botones van en una barra a lo ancho de la pantalla (con más de tres, los demás en «Más»).')}
                                    checked={config.mobile_bar}
                                    onChange={(v) => patchConfig({ mobile_bar: v })}
                                />
                            </div>
                        </section>
                    )}

                    {tab === 'publish' && (
                        <section className="imcrm-flex imcrm-flex-col imcrm-gap-5" data-tour="widget-publish">
                            {problems.length > 0 && (
                                <div className="imcrm-rounded-lg imcrm-border imcrm-border-warning/30 imcrm-bg-warning/10 imcrm-p-3" data-testid="widget-problems">
                                    <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                                        <AlertTriangle className="imcrm-h-4 imcrm-w-4 imcrm-text-warning" />
                                        {__('Antes de publicar')}
                                    </p>
                                    <ul className="imcrm-mt-1.5 imcrm-list-disc imcrm-space-y-0.5 imcrm-pl-6 imcrm-text-sm">
                                        {problems.map((p, i) => (
                                            <li key={i}>
                                                {p.button_id ? (
                                                    <button
                                                        type="button"
                                                        className="imcrm-text-left imcrm-underline-offset-2 hover:imcrm-underline"
                                                        onClick={() => {
                                                            setOpenId(p.button_id);
                                                            setTab('buttons');
                                                        }}
                                                    >
                                                        {p.message}
                                                    </button>
                                                ) : (
                                                    p.message
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <label className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-4 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3">
                                <span className="imcrm-flex imcrm-flex-col">
                                    <span className="imcrm-text-sm imcrm-font-medium">{__('Publicado')}</span>
                                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                        {enabled
                                            ? __('Se ve en los sitios donde pegaste el código.')
                                            : __('Sin publicar, el código pegado no muestra nada.')}
                                    </span>
                                </span>
                                <input
                                    type="checkbox"
                                    role="switch"
                                    className="imcrm-mt-0.5 imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-accent-primary"
                                    checked={enabled}
                                    disabled={update.isPending || (!enabled && problems.length > 0)}
                                    onChange={(e) => save({ enabled: e.target.checked })}
                                    data-testid="widget-enabled"
                                />
                            </label>

                            <Row
                                label={__('Código para tu sitio')}
                                hint={__('Pégalo una sola vez en el pie de tu sitio (antes de </body>) y el botón aparece en todas las páginas. En WordPress, con un plugin para agregar código al pie o en el tema.')}
                            >
                                <Textarea readOnly rows={3} value={code} className="imcrm-font-mono imcrm-text-xs" onFocus={(e) => e.currentTarget.select()} data-testid="widget-code" />
                                <div className="imcrm-mt-1.5">
                                    <CopyCode value={code} />
                                </div>
                            </Row>

                            <Row
                                label={__('Sólo en estos sitios (opcional)')}
                                hint={__('Uno por renglón, por ejemplo «tuempresa.com». Vacío = cualquier sitio. Si un formulario sólo se puede insertar en ciertos sitios, agrega ahí también este.')}
                            >
                                <Textarea
                                    rows={3}
                                    value={domainsText}
                                    placeholder="tuempresa.com"
                                    onChange={(e) => {
                                        setDomainsText(e.target.value);
                                        patchConfig({ allowed_domains: parseDomains(e.target.value) });
                                    }}
                                    data-testid="widget-domains"
                                />
                            </Row>

                            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-4">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={regenerate.isPending}
                                    onClick={async () => {
                                        const ok = await confirm({
                                            title: __('¿Cambiar el código?'),
                                            description: __('El código pegado en tu sitio deja de mostrar el widget hasta que pegues el nuevo.'),
                                            confirmLabel: __('Cambiar el código'),
                                        });
                                        if (ok) regenerate.mutate();
                                    }}
                                >
                                    <RefreshCw className="imcrm-h-4 imcrm-w-4" />
                                    {__('Cambiar el código')}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="imcrm-text-destructive hover:imcrm-text-destructive"
                                    disabled={remove.isPending}
                                    onClick={async () => {
                                        const ok = await confirm({
                                            title: sprintf(__('¿Eliminar «%s»?'), widget.name),
                                            description: __('El botón desaparece de tu sitio. Los registros que llegaron por él se quedan en sus listas.'),
                                            confirmLabel: __('Eliminar'),
                                            destructive: true,
                                        });
                                        if (!ok) return;
                                        remove.mutate(widget.id, { onSuccess: () => nav('/settings?s=widgets') });
                                    }}
                                    data-testid="widget-delete"
                                >
                                    <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                    {__('Eliminar el widget')}
                                </Button>
                            </div>
                        </section>
                    )}
                </div>

                <div className="imcrm-min-w-0 lg:imcrm-sticky lg:imcrm-top-2 lg:imcrm-self-start">
                    <WidgetPreview meta={meta} />
                </div>
            </div>
        </div>
    );
}

function LayoutCard({
    active,
    onClick,
    icon,
    title,
    hint,
    testId,
}: {
    active: boolean;
    onClick: () => void;
    icon: JSX.Element;
    title: string;
    hint: string;
    testId: string;
}): JSX.Element {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={active}
            onClick={onClick}
            className={cn(
                'imcrm-flex imcrm-items-start imcrm-gap-2.5 imcrm-rounded-lg imcrm-border imcrm-p-3 imcrm-text-left',
                active ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border hover:imcrm-border-primary/40',
            )}
            data-testid={testId}
        >
            <span className={cn('imcrm-mt-0.5', active ? 'imcrm-text-primary' : 'imcrm-text-muted-foreground')}>{icon}</span>
            <span className="imcrm-flex imcrm-flex-col">
                <span className="imcrm-text-sm imcrm-font-medium">{title}</span>
                <span className="imcrm-text-xs imcrm-text-muted-foreground">{hint}</span>
            </span>
        </button>
    );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }): JSX.Element {
    return (
        <label className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground">
            {label}
            <Input
                type="number"
                min={0}
                max={200}
                value={value}
                onChange={(e) => {
                    const n = Math.round(Number(e.target.value));
                    if (Number.isFinite(n)) onChange(Math.max(0, Math.min(200, n)));
                }}
            />
        </label>
    );
}

function CopyCode({ value }: { value: string }): JSX.Element {
    const [copied, setCopied] = useState(false);
    return (
        <Button
            variant="outline"
            size="sm"
            onClick={() => {
                void navigator.clipboard?.writeText(value).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1600);
                });
            }}
            data-testid="widget-copy-code"
        >
            {copied ? <Check className="imcrm-h-4 imcrm-w-4" /> : <Copy className="imcrm-h-4 imcrm-w-4" />}
            {copied ? __('Copiado') : __('Copiar el código')}
        </Button>
    );
}
