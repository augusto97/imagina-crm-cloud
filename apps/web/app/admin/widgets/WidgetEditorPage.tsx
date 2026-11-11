import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import {
    BarChart3,
    Clock,
    Code2,
    Eye,
    EyeOff,
    Globe,
    Loader2,
    MessageCircle,
    MessageSquareText,
    Moon,
    MousePointerClick,
    Palette,
    Send,
    SlidersHorizontal,
    Sun,
    type LucideIcon,
} from 'lucide-react';
import { WIDGET_MAX_BUTTONS, readContactWidgetConfig, widgetEmbedCode, type ContactWidgetConfig, type ContactWidgetDto, type ContactWidgetOptions, type WidgetButtonType, type WidgetProblem } from '@imagina-base/shared';

import {
    BuilderMobileNav,
    BuilderMobileTopBar,
    BuilderModeSwitch,
    BuilderTopBar,
    InlineName,
    MobileBackBar,
    MoreMenu,
    PanelHeader,
    PublishSwitch,
    SaveButton,
    SettingsCard,
    SettingsMobileIndex,
    SettingsNav,
    SettingsPageHeader,
    type BuilderMode,
    type MenuAction,
    type SettingsNavItem,
} from '@/admin/builder/BuilderShell';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { __, sprintf } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

import { WidgetButtonsPanel } from './WidgetButtonsPanel';
import { WidgetDisplayEditor, WidgetGreetingEditor } from './WidgetDisplayEditor';
import { WidgetHoursEditor } from './WidgetHoursEditor';
import { WidgetInstallPanel } from './WidgetInstallPanel';
import { WidgetLookEditor } from './WidgetLookEditor';
import { WidgetPreview } from './WidgetPreview';
import { WidgetStatsPanel } from './WidgetStatsPanel';
import { addButton, editorProblems, newButton, previewMeta, sameConfig } from './widgetEditor';
import {
    WIDGET_SECTIONS,
    WIDGET_SECTION_INFO,
    problemSection,
    sectionsWithProblems,
    widgetLocation,
    widgetSectionSummary,
    type WidgetEditorMode,
    type WidgetSection,
} from './widgetSections';
import {
    useContactWidget,
    useDeleteContactWidget,
    useRegenerateContactWidget,
    useUpdateContactWidget,
    useWidgetOptions,
} from './useContactWidgets';

const SECTION_ICON: Record<WidgetSection, LucideIcon> = {
    buttons: MousePointerClick,
    look: Palette,
    hours: Clock,
    show: Globe,
    greeting: MessageCircle,
    publish: Code2,
};

/** La pantalla del editor tapa la app (como los editores de formularios y agenda). */
function Shell({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-fixed imcrm-inset-0 imcrm-z-40 imcrm-flex imcrm-flex-col imcrm-bg-background imcrm-text-foreground" data-testid="widget-editor">
            {children}
        </div>
    );
}

/**
 * v0.1.394 (ADR-S99) — El editor de un widget de contacto.
 *
 * v0.1.408 — A pantalla completa y con las piezas de los editores de
 * formularios y agenda: arriba el nombre, «Editar · Estadísticas», publicar y
 * guardar; a la izquierda las secciones (cada una dice cómo está); al centro
 * la sección elegida; a la derecha la vista previa, a todo el alto. En el
 * celular: el índice de secciones, la vista previa y las estadísticas en una
 * barra fija abajo.
 */
export function WidgetEditorPage(): JSX.Element {
    const { widgetId } = useParams();
    const nav = useNavigate();
    const id = Number(widgetId);
    const q = useContactWidget(id);
    const options = useWidgetOptions();

    if (q.isLoading || options.isLoading) {
        return (
            <Shell>
                <div className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    {__('Cargando…')}
                </div>
            </Shell>
        );
    }
    if (q.isError || !q.data || !options.data) {
        return (
            <Shell>
                <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-3 imcrm-p-6 imcrm-text-center">
                    <p className="imcrm-text-sm imcrm-text-destructive">{q.error instanceof Error ? q.error.message : __('No se pudo cargar el widget.')}</p>
                    <Button variant="outline" size="sm" onClick={() => nav('/settings?s=widgets')}>
                        {__('Volver a los widgets')}
                    </Button>
                </div>
            </Shell>
        );
    }
    return (
        <Shell>
            <Editor key={q.data.id} widget={q.data} options={options.data} />
        </Shell>
    );
}

function Editor({ widget, options }: { widget: ContactWidgetDto; options: ContactWidgetOptions }): JSX.Element {
    const nav = useNavigate();
    const confirm = useConfirm();
    const toast = useToast();
    const appTheme = useTheme();
    const narrow = useMediaQuery('(max-width: 1023px)');
    const wide = useMediaQuery('(min-width: 1280px)');

    // La sección y el modo viven en la dirección (`?t=`): se pueden enlazar.
    const [params, setParams] = useSearchParams();
    const loc = widgetLocation(params.get('t'));
    const mode = loc.mode;
    const section = loc.section;
    const go = (next: { mode?: WidgetEditorMode; section?: WidgetSection }): void => {
        const m = next.mode ?? mode;
        const s = next.section ?? section;
        const p = new URLSearchParams(params);
        p.set('t', m === 'stats' ? 'stats' : s);
        setParams(p, { replace: true });
    };

    const [name, setName] = useState(widget.name);
    const [config, setConfig] = useState<ContactWidgetConfig>(() => readContactWidgetConfig(widget.config));
    const [openId, setOpenId] = useState<string | null>(widget.config.buttons[0]?.id ?? null);
    const saved = useRef({ name: widget.name, config: readContactWidgetConfig(widget.config) });

    const update = useUpdateContactWidget(widget.id);
    const regenerate = useRegenerateContactWidget(widget.id);
    const remove = useDeleteContactWidget();

    const dirty = name.trim() !== saved.current.name || !sameConfig(config, saved.current.config);
    const { confirmLeave } = useUnsavedChangesGuard(dirty);

    const problems = useMemo(() => editorProblems(config, options), [config, options]);
    const problemSections = useMemo(() => sectionsWithProblems(problems), [problems]);
    const meta = useMemo(() => previewMeta(config, options), [config, options]);

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
                if (extra?.enabled === undefined) toast.success(__('Widget guardado'));
            },
            onError: (e) => toast.error(__('No se pudo guardar'), e instanceof Error ? e.message : undefined),
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
    const fix = (p: WidgetProblem): void => {
        if (p.button_id) setOpenId(p.button_id);
        openSection(problemSection(p));
    };
    const togglePublish = (): void => {
        if (!enabled && problems.length > 0) {
            openSection('publish');
            toast.warning(__('Todavía no se puede publicar'), problems.length === 1 ? __('Falta una cosa: está en «Instalar».') : sprintf(__('Faltan %d cosas: están en «Instalar».'), problems.length));
            return;
        }
        save({ enabled: !enabled });
    };
    const close = async (): Promise<void> => {
        if (await confirmLeave()) nav('/settings?s=widgets');
    };

    // Ctrl/⌘ + S guarda.
    const saveRef = useRef(save);
    saveRef.current = save;
    const dirtyRef = useRef(dirty);
    dirtyRef.current = dirty;
    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                if (dirtyRef.current) saveRef.current();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // En el celular: el índice de secciones o una sección; la vista previa; las estadísticas.
    const [mobileTab, setMobileTab] = useState<'edit' | 'preview' | 'stats'>(mode === 'stats' ? 'stats' : 'edit');
    const [mobileSection, setMobileSection] = useState<WidgetSection | null>(params.get('t') && mode === 'edit' ? section : null);
    function openSection(s: WidgetSection): void {
        go({ mode: 'edit', section: s });
        setMobileTab('edit');
        setMobileSection(s);
    }

    const navItems: Array<SettingsNavItem<WidgetSection>> = WIDGET_SECTIONS.map((s) => ({
        id: s,
        label: __(WIDGET_SECTION_INFO[s].label),
        icon: SECTION_ICON[s],
        group: __(WIDGET_SECTION_INFO[s].group),
        summary: __(widgetSectionSummary(s, config, enabled)),
        problem: problemSections.has(s),
    }));

    const sectionBody = (s: WidgetSection): JSX.Element => {
        switch (s) {
            case 'buttons':
                return <WidgetButtonsPanel config={config} options={options} problems={problems} openId={openId} onOpen={setOpenId} onConfig={(fn) => setConfig(fn)} onAdd={onAdd} />;
            case 'look':
                return <WidgetLookEditor config={config} options={options} onChange={patchConfig} />;
            case 'hours':
                return <WidgetHoursEditor config={config} options={options} onChange={(hours) => patchConfig({ hours })} />;
            case 'show':
                return <WidgetDisplayEditor config={config} onDisplay={(display) => patchConfig({ display })} />;
            case 'greeting':
                return <WidgetGreetingEditor config={config} onGreeting={(greeting) => patchConfig({ greeting })} />;
            case 'publish':
                return (
                    <WidgetInstallPanel
                        enabled={enabled}
                        busy={update.isPending}
                        problems={problems}
                        onTogglePublish={togglePublish}
                        onFix={fix}
                        code={code}
                        domains={config.allowed_domains}
                        onDomains={(allowed_domains) => patchConfig({ allowed_domains })}
                        regenerating={regenerate.isPending}
                        onRegenerate={async () => {
                            const ok = await confirm({
                                title: __('¿Cambiar el código?'),
                                description: __('El código pegado en tu sitio deja de mostrar el widget hasta que pegues el nuevo.'),
                                confirmLabel: __('Cambiar el código'),
                            });
                            if (ok) regenerate.mutate();
                        }}
                        deleting={remove.isPending}
                        onDelete={async () => {
                            const ok = await confirm({
                                title: sprintf(__('¿Eliminar «%s»?'), widget.name),
                                description: __('El botón desaparece de tu sitio. Los registros que llegaron por él se quedan en sus listas.'),
                                confirmLabel: __('Eliminar'),
                                destructive: true,
                            });
                            if (!ok) return;
                            remove.mutate(widget.id, { onSuccess: () => nav('/settings?s=widgets') });
                        }}
                    />
                );
        }
    };
    const sectionHeader = (s: WidgetSection, mobile = false): JSX.Element => (
        <PanelHeader
            icon={mobile ? undefined : SECTION_ICON[s]}
            title={__(WIDGET_SECTION_INFO[s].title)}
            subtitle={__(WIDGET_SECTION_INFO[s].hint)}
            testId="widget-panel-header"
            actions={
                s === 'buttons' ? (
                    <span className="imcrm-rounded-full imcrm-bg-muted imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-medium imcrm-tabular-nums imcrm-text-muted-foreground">
                        {config.buttons.length}/{WIDGET_MAX_BUTTONS}
                    </span>
                ) : undefined
            }
        />
    );

    const stats = (
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-[960px] imcrm-flex-col imcrm-gap-5 imcrm-px-4 imcrm-py-5 sm:imcrm-px-8 sm:imcrm-py-8" data-testid="widget-stats-page">
            <SettingsPageHeader icon={BarChart3} title={__('Estadísticas')} hint={__('Cuántas veces apareció, cuántas lo abrieron, qué botón tocan más y cuántos te dejaron sus datos. Son conteos: nunca datos de una persona.')} />
            <SettingsCard>
                <div className="imcrm-p-4 sm:imcrm-p-5">
                    <WidgetStatsPanel widgetId={widget.id} config={config} />
                </div>
            </SettingsCard>
        </div>
    );

    const nameInput = <InlineName value={name} onChange={setName} label={__('Nombre del widget')} testId="widget-name" />;
    const themeAction: MenuAction = { label: appTheme.resolved === 'dark' ? __('Modo claro') : __('Modo oscuro'), icon: appTheme.resolved === 'dark' ? Sun : Moon, onSelect: appTheme.toggle };
    const saveButton = <SaveButton dirty={dirty} busy={update.isPending && enabledView === null} onClick={() => save()} testId="widget-save" />;

    if (narrow) {
        const items: Array<BuilderMode<'edit' | 'preview' | 'stats'>> = [
            { id: 'edit', label: __('Editar'), icon: SlidersHorizontal, problem: problems.length > 0, testId: 'widget-tab-edit' },
            { id: 'preview', label: __('Vista previa'), icon: Eye, testId: 'widget-tab-preview' },
            { id: 'stats', label: __('Estadísticas'), icon: BarChart3, testId: 'widget-tab-stats' },
        ];
        return (
            <div className="imcrm-flex imcrm-h-full imcrm-min-h-0 imcrm-flex-col">
                <BuilderMobileTopBar
                    onClose={() => void close()}
                    name={nameInput}
                    published={enabled}
                    statusText={enabled ? __('Publicado') : __('Sin publicar')}
                    more={
                        <MoreMenu
                            testId="widget-more"
                            actions={[
                                { label: enabled ? __('Dejar de mostrarlo') : __('Publicar'), icon: enabled ? EyeOff : Send, onSelect: togglePublish, testId: 'widget-publish-toggle' },
                                { label: __('Instalar en tu sitio'), icon: Code2, onSelect: () => openSection('publish') },
                                { ...themeAction, separated: true },
                            ]}
                        />
                    }
                    save={saveButton}
                />
                {mobileTab === 'edit' && mobileSection !== null && (
                    <MobileBackBar label={__('Widget')} title={__(WIDGET_SECTION_INFO[mobileSection].title)} onBack={() => setMobileSection(null)} testId="widget-section-back" />
                )}
                <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto imcrm-bg-canvas">
                    {mobileTab === 'edit' &&
                        (mobileSection === null ? (
                            <SettingsMobileIndex
                                items={navItems}
                                onPick={(s) => {
                                    setMobileSection(s);
                                    go({ mode: 'edit', section: s });
                                }}
                                testId="widget-section-index"
                                intro={
                                    <div className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3">
                                        <span className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-primary">
                                            <MessageSquareText className="imcrm-h-5 imcrm-w-5" />
                                        </span>
                                        <p className="imcrm-text-[13px] imcrm-leading-snug imcrm-text-muted-foreground">
                                            {__('Un botón fijo en tu sitio para que te escriban por WhatsApp, te dejen sus datos o agenden. Míralo en «Vista previa».')}
                                        </p>
                                    </div>
                                }
                            />
                        ) : (
                            <div className="imcrm-bg-card" data-testid="widget-section">
                                {sectionHeader(mobileSection, true)}
                                {sectionBody(mobileSection)}
                            </div>
                        ))}
                    {mobileTab === 'preview' && (
                        <div className="imcrm-h-full">
                            <WidgetPreview meta={meta} compact initialDevice="mobile" />
                        </div>
                    )}
                    {mobileTab === 'stats' && stats}
                </div>
                <BuilderMobileNav
                    items={items}
                    value={mobileTab}
                    onChange={(v) => {
                        setMobileTab(v);
                        if (v === 'stats') go({ mode: 'stats' });
                        else if (v === 'edit') go({ mode: 'edit' });
                    }}
                />
            </div>
        );
    }

    const modes: Array<BuilderMode<WidgetEditorMode>> = [
        { id: 'edit', label: __('Editar'), icon: SlidersHorizontal, problem: problems.length > 0, testId: 'widget-tab-edit' },
        { id: 'stats', label: __('Estadísticas'), icon: BarChart3, testId: 'widget-tab-stats', tour: 'widget-stats' },
    ];

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-min-h-0 imcrm-flex-col">
            <BuilderTopBar
                kindIcon={MessageSquareText}
                kindLabel={__('Widget de contacto')}
                onClose={() => void close()}
                name={nameInput}
                modes={<BuilderModeSwitch modes={modes} value={mode} onChange={(m) => go({ mode: m })} />}
                actions={
                    <>
                        {wide ? <ThemeToggle compact /> : <MoreMenu testId="widget-more" actions={[themeAction]} />}
                        <PublishSwitch enabled={enabled} busy={update.isPending} onClick={togglePublish} testId="widget-publish-switch" compact={!wide} />
                        <Button
                            variant="outline"
                            size="sm"
                            className={cn('imcrm-ml-1 imcrm-gap-1.5', mode === 'edit' && section === 'publish' && 'imcrm-border-primary/40 imcrm-text-primary')}
                            onClick={() => openSection('publish')}
                            data-testid="widget-install"
                            title={__('Instalar en tu sitio')}
                        >
                            <Code2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            {wide && <span>{__('Instalar')}</span>}
                        </Button>
                        {saveButton}
                    </>
                }
            />

            {mode === 'stats' ? (
                <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto imcrm-bg-canvas">{stats}</div>
            ) : (
                <div className={cn('imcrm-grid imcrm-min-h-0 imcrm-flex-1', wide ? 'imcrm-grid-cols-[252px_420px_minmax(0,1fr)]' : 'imcrm-grid-cols-[60px_380px_minmax(0,1fr)]')}>
                    <aside className="imcrm-min-h-0 imcrm-overflow-y-auto imcrm-border-r imcrm-border-border imcrm-bg-card" data-testid="widget-sections">
                        {wide ? (
                            <SettingsNav items={navItems} active={section} onPick={(s) => openSection(s)} label={__('Secciones del widget')} dense />
                        ) : (
                            <SectionRail items={navItems} active={section} onPick={(s) => openSection(s)} />
                        )}
                    </aside>
                    <aside className="imcrm-min-h-0 imcrm-overflow-y-auto imcrm-border-r imcrm-border-border imcrm-bg-card" data-testid="widget-section">
                        {sectionHeader(section)}
                        {sectionBody(section)}
                    </aside>
                    <div className="imcrm-min-h-0 imcrm-min-w-0">
                        <WidgetPreview meta={meta} showClosed={section === 'greeting' && config.greeting.enabled} />
                    </div>
                </div>
            )}
        </div>
    );
}

/** El menú de secciones angosto (sólo íconos, con su nombre al pasar el mouse). */
function SectionRail({ items, active, onPick }: { items: ReadonlyArray<SettingsNavItem<WidgetSection>>; active: WidgetSection; onPick: (s: WidgetSection) => void }): JSX.Element {
    return (
        <nav aria-label={__('Secciones del widget')} className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-1 imcrm-py-3">
            {items.map((it) => {
                const on = it.id === active;
                return (
                    <button
                        key={it.id}
                        type="button"
                        onClick={() => onPick(it.id)}
                        aria-current={on ? 'page' : undefined}
                        aria-label={it.label}
                        title={it.summary ? `${it.label} · ${it.summary}` : it.label}
                        data-settings-group={it.id}
                        className={cn(
                            'imcrm-relative imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-transition-colors',
                            on ? 'imcrm-bg-primary imcrm-text-primary-foreground' : 'imcrm-text-muted-foreground hover:imcrm-bg-muted hover:imcrm-text-foreground',
                        )}
                    >
                        <it.icon className="imcrm-h-4 imcrm-w-4" />
                        {it.problem && <span className="imcrm-absolute imcrm-right-1.5 imcrm-top-1.5 imcrm-h-2 imcrm-w-2 imcrm-rounded-full imcrm-bg-destructive imcrm-ring-2 imcrm-ring-card" aria-label={__('Falta algo')} />}
                    </button>
                );
            })}
        </nav>
    );
}
