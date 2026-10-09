import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Check, LayoutTemplate, Loader2, Monitor, Redo2, RotateCcw, Smartphone, Undo2 } from 'lucide-react';
import type { RecordLayoutV3 } from '@imagina-base/shared';

import { RecordSelector } from '@/admin/lists/template-editor/RecordSelector';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { WidgetDataOverrideContext } from '@/hooks/useDashboards';
import { useRelationPaths } from '@/hooks/useRelationPaths';
import { useUpdateList } from '@/hooks/useLists';
import { ApiError } from '@/lib/api';
import { getBootData } from '@/lib/boot';
import { PAGE_FONT_STACKS, readPageSettings } from '@/lib/blockStyle';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { ListSummary } from '@/types/list';
import type { RecordEntity } from '@/types/record';

import { LayoutContext, type LayoutCtx } from '../LayoutContext';
import { resolveTheme } from '../layoutTheme';
import { useLayoutData } from '../useLayoutData';
import type { LayoutOrigin } from '../useRecordLayout';
import type { CatalogContext } from './blockCatalog';
import { EditorCanvas } from './EditorCanvas';
import { EditorContext, useEditorActions, useLayoutHistory, type EditorApi, type Selection } from './editorState';
import { Inspector } from './Inspector';
import { LibraryPane } from './LibraryPane';
import { PORTAL_TEMPLATE_INFO, PortalTemplateGallery } from './PortalTemplateGallery';
import { duplicateBlock, findBlock, removeBlock } from './layoutOps';

interface Props {
    list: ListSummary;
    fields: FieldEntity[];
    initial: RecordLayoutV3;
    origin: LayoutOrigin | 'legacy';
    initialRecord: RecordEntity;
    /**
     * v0.1.233 — qué se diseña: la ficha del equipo (`record_layout_v3`) o el
     * portal del cliente (`portal_layout_v3`, ADR-S26 fase C). Mismo editor.
     */
    target?: 'record' | 'portal';
    /** Portal: listas vinculadas al cliente por un campo persona. */
    portalLists?: Array<{ list_id: number; name: string }>;
}

/**
 * v0.1.231 — El editor de la ficha: biblioteca a la izquierda, la ficha REAL
 * en el centro (con los datos de un registro de verdad y los mismos
 * componentes que ve la persona) e inspector a la derecha. Deshacer/rehacer,
 * vista de celular y guardado explícito (diseñar no es editar datos: se
 * guarda cuando el diseño está listo, no a cada clic).
 */
export function LayoutEditor({ list, fields, initial, origin, initialRecord, target = 'record', portalLists }: Props): JSX.Element {
    const portal = target === 'portal';
    const history = useLayoutHistory(initial);
    const { layout, commit, undo, redo } = history;
    const [saved, setSaved] = useState<RecordLayoutV3>(initial);
    const [selection, setSelection] = useState<Selection>(null);
    const [pageId, setPageId] = useState<string>(initial.pages[0]!.id);
    const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
    const [record, setRecord] = useState<RecordEntity>(initialRecord);
    const update = useUpdateList(list.id);
    const toast = useToast();
    const paths = useRelationPaths(list.id);
    const boot = getBootData();
    const confirm = useConfirm();
    const navigate = useNavigate();

    const dirty = useMemo(() => JSON.stringify(layout) !== JSON.stringify(saved), [layout, saved]);
    // v0.1.237 — galería de plantillas del portal (`?plantillas=1` la abre al entrar).
    const [params, setParams] = useSearchParams();
    const [galleryOpen, setGalleryOpen] = useState(portal && params.get('plantillas') === '1');
    useEffect(() => {
        if (!params.has('plantillas')) return;
        const next = new URLSearchParams(params);
        next.delete('plantillas');
        setParams(next, { replace: true });
    }, [params, setParams]);
    // Si la página elegida desaparece (deshacer, borrar), vuelve a la primera.
    const activePage = layout.pages.some((p) => p.id === pageId) ? pageId : layout.pages[0]!.id;

    const catalog = useMemo<CatalogContext>(
        () => ({ fields, paths: paths.data ?? [], listId: list.id, target, portalLists }),
        [fields, paths.data, list.id, target, portalLists],
    );
    const actions = useEditorActions(layout, commit, setSelection, catalog, activePage, selection);
    const api = useMemo<EditorApi>(
        () => ({ layout, commit, selection, select: setSelection, pageId: activePage, catalog, ...actions }),
        [layout, commit, selection, activePage, catalog, actions],
    );

    // Datos de gráficos y vinculados de la plantilla EN EDICIÓN (sin guardar).
    // En el portal, con el alcance del cliente de ese registro.
    const { query, override, blockLists } = useLayoutData(list.id, list.slug, record.id, layout, portal ? 'portal' : 'record');
    const values = useMemo(() => ({ ...record.fields, ...record.relations }), [record]);
    const ctx: LayoutCtx = {
        list,
        record,
        fields,
        fieldsById: useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]),
        values,
        setValue: noop,
        errors: {},
        lockedReasons: {},
        canEdit: false,
        theme: resolveTheme(layout.theme),
        currentUserId: boot.user.id,
        isAdmin: boot.user.capabilities.workspace_admin === true,
        data: query.data,
        dataLoading: query.isLoading,
        preview: true,
        mode: portal ? 'portal' : 'record',
        blockLists,
    };

    const save = useCallback(() => {
        const settings = { ...(list.settings ?? {}) } as Record<string, unknown>;
        if (portal) {
            settings.portal_layout_v3 = layout;
            // La plantilla anterior ya quedó convertida en este diseño.
            delete settings.portal_template;
        } else {
            settings.record_layout = 'crm';
            settings.record_layout_v3 = layout;
        }
        update.mutate(
            { settings },
            {
                onSuccess: () => {
                    setSaved(layout);
                    toast.success(
                        __('Diseño guardado'),
                        portal ? __('Tus clientes ya ven su portal así.') : __('La ficha ya se ve así para todo el equipo.'),
                    );
                },
                onError: (err) => toast.error(__('No se pudo guardar'), err instanceof ApiError || err instanceof Error ? err.message : undefined),
            },
        );
    }, [update, list.settings, layout, toast, portal]);

    const resetToAuto = async (): Promise<void> => {
        const ok = await confirm({
            title: __('¿Volver al diseño automático?'),
            description: portal
                ? __('Se borra el diseño del portal y tus clientes ven sus datos en una página simple, de sólo lectura.')
                : __('Se borra el diseño guardado de esta ficha y se usa el que arma la app con los campos y las relaciones de la lista.'),
            confirmLabel: __('Volver al automático'),
            destructive: true,
        });
        if (!ok) return;
        const settings = { ...(list.settings ?? {}) } as Record<string, unknown>;
        if (portal) {
            delete settings.portal_layout_v3;
            delete settings.portal_template;
        } else {
            delete settings.record_layout_v3;
            settings.crm_template_id = 'auto';
        }
        update.mutate(
            { settings },
            {
                onSuccess: () => {
                    toast.success(__('Volviste al diseño automático'));
                    window.location.reload();
                },
                onError: (err) => toast.error(__('No se pudo restablecer'), err instanceof Error ? err.message : undefined),
            },
        );
    };

    // Atajos: deshacer/rehacer, guardar, borrar/duplicar el bloque elegido.
    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            const t = e.target as HTMLElement | null;
            const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
            const mod = e.metaKey || e.ctrlKey;
            if (mod && e.key.toLowerCase() === 's') {
                e.preventDefault();
                if (dirty && !update.isPending) save();
                return;
            }
            if (typing) return;
            if (mod && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) redo();
                else undo();
            } else if (mod && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                redo();
            } else if (mod && e.key.toLowerCase() === 'd' && selection?.kind === 'block') {
                e.preventDefault();
                const r = duplicateBlock(layout, selection.id);
                commit(r.layout);
                if (r.newId) setSelection({ kind: 'block', id: r.newId });
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection?.kind === 'block') {
                e.preventDefault();
                commit(removeBlock(layout, selection.id));
                setSelection(null);
            } else if (e.key === 'Escape') {
                setSelection(null);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [dirty, update.isPending, save, undo, redo, selection, layout, commit]);

    // Salir con cambios sin guardar: aviso del navegador y de la app.
    useEffect(() => {
        if (!dirty) return;
        const onBefore = (e: BeforeUnloadEvent): void => {
            e.preventDefault();
        };
        window.addEventListener('beforeunload', onBefore);
        return () => window.removeEventListener('beforeunload', onBefore);
    }, [dirty]);
    const backHref = portal ? `/lists/${list.slug}/edit?s=compartir` : `/lists/${list.slug}/records${record.id > 0 ? `/${record.id}` : ''}`;
    // Ajustes de página del portal (fondo, ancho, tipografía) en la vista previa.
    const page = portal ? readPageSettings((layout as { page?: unknown }).page) : {};
    const leave = async (e: React.MouseEvent): Promise<void> => {
        if (!dirty) return;
        e.preventDefault();
        const ok = await confirm({
            title: __('Tienes cambios sin guardar'),
            description: __('Si sales ahora se pierde lo que diseñaste desde la última vez que guardaste.'),
            confirmLabel: __('Salir sin guardar'),
            destructive: true,
        });
        if (ok) navigate(backHref);
    };

    // El editor usa toda la ventana: fuera el menú y la barra de la app.
    useEffect(() => {
        document.body.classList.add('imcrm-template-editor-fullscreen');
        return () => document.body.classList.remove('imcrm-template-editor-fullscreen');
    }, []);

    // Elegir un bloque de otra página la muestra.
    useEffect(() => {
        if (selection?.kind !== 'block') return;
        const at = findBlock(layout, selection.id);
        if (at && at.pageId !== activePage) setPageId(at.pageId);
    }, [selection, layout, activePage]);

    return (
        <EditorContext.Provider value={api}>
            <LayoutContext.Provider value={ctx}>
                <WidgetDataOverrideContext.Provider value={override}>
                    <div className="imcrm-flex imcrm-h-[calc(100vh-1rem)] imcrm-min-h-[560px] imcrm-flex-col imcrm-gap-2" data-testid="layout-editor">
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-pb-2">
                            <Button asChild variant="ghost" size="sm" className="imcrm-gap-1.5 imcrm-text-muted-foreground">
                                <Link to={backHref} onClick={(e) => void leave(e)}>
                                    <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                                    <span className="imcrm-hidden sm:imcrm-inline">{list.name}</span>
                                </Link>
                            </Button>
                            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
                                <span className="imcrm-text-sm imcrm-font-semibold imcrm-leading-tight">{portal ? __('Portal del cliente') : __('Diseño de la ficha')}</span>
                                <span className="imcrm-text-[11px] imcrm-leading-tight imcrm-text-muted-foreground">
                                    {origin === 'saved' || saved !== initial
                                        ? __('Diseño guardado')
                                        : origin === 'converted' || origin === 'legacy'
                                          ? __('Convertido de la plantilla anterior')
                                          : __('Diseño automático: personalízalo y guarda')}
                                </span>
                            </div>
                            <div className="imcrm-ml-2 imcrm-flex imcrm-items-center imcrm-gap-0.5">
                                <IconButton label={__('Deshacer (Ctrl+Z)')} onClick={undo} disabled={!history.canUndo}>
                                    <Undo2 />
                                </IconButton>
                                <IconButton label={__('Rehacer (Ctrl+Shift+Z)')} onClick={redo} disabled={!history.canRedo}>
                                    <Redo2 />
                                </IconButton>
                            </div>
                            <div className="imcrm-ml-auto imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                                <ThemeToggle compact />
                                <div className="imcrm-flex imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-0.5" role="group" aria-label={__('Vista previa')}>
                                    <DeviceButton active={device === 'desktop'} onClick={() => setDevice('desktop')} label={__('Escritorio')}>
                                        <Monitor />
                                    </DeviceButton>
                                    <DeviceButton active={device === 'mobile'} onClick={() => setDevice('mobile')} label={__('Celular')}>
                                        <Smartphone />
                                    </DeviceButton>
                                </div>
                                <div className="imcrm-w-[220px]" title={portal ? __('Cliente con el que se ve la vista previa (con sus datos, como los vería él)') : __('Registro con el que se ve la vista previa')}>
                                    <RecordSelector listId={list.id} fields={fields} value={record.id > 0 ? record : null} onChange={(r) => r && setRecord(r)} />
                                </div>
                                {portal && (
                                    <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={() => setGalleryOpen(true)} data-testid="portal-templates-open">
                                        <LayoutTemplate className="imcrm-h-3.5 imcrm-w-3.5" />
                                        <span className="imcrm-hidden lg:imcrm-inline">{__('Plantillas')}</span>
                                    </Button>
                                )}
                                {origin !== 'auto' && (
                                    <Button variant="ghost" size="sm" className="imcrm-gap-1.5 imcrm-text-muted-foreground" onClick={() => void resetToAuto()}>
                                        <RotateCcw className="imcrm-h-3.5 imcrm-w-3.5" />
                                        <span className="imcrm-hidden xl:imcrm-inline">{__('Automático')}</span>
                                    </Button>
                                )}
                                <Button size="sm" onClick={save} disabled={!dirty || update.isPending} className="imcrm-gap-1.5" data-testid="layout-editor-save">
                                    {update.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : !dirty ? <Check className="imcrm-h-3.5 imcrm-w-3.5" /> : null}
                                    {!dirty ? __('Guardado') : __('Guardar')}
                                </Button>
                            </div>
                        </div>

                        <p className="imcrm-rounded-lg imcrm-bg-muted/60 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground md:imcrm-hidden">
                            {__('El diseño se arma mejor en una pantalla más grande: aquí puedes agregar y mover bloques, pero no ajustarlos.')}
                        </p>
                        <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-gap-3">
                            <aside className="imcrm-hidden imcrm-w-[252px] imcrm-shrink-0 imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card lg:imcrm-flex">
                                <LibraryPane onPageChange={setPageId} />
                            </aside>
                            <div
                                className="imcrm-min-w-0 imcrm-flex-1 imcrm-overflow-auto imcrm-rounded-xl imcrm-bg-canvas imcrm-p-4 sm:imcrm-p-6"
                                onClick={(e) => {
                                    if (e.target === e.currentTarget) setSelection({ kind: 'page' });
                                }}
                                data-testid="layout-editor-canvas"
                            >
                                <div
                                    className={cn(
                                        'imcrm-mx-auto imcrm-transition-[max-width]',
                                        device === 'mobile'
                                            ? 'imcrm-max-w-[390px] imcrm-rounded-[28px] imcrm-border-[6px] imcrm-border-foreground/80 imcrm-bg-background imcrm-p-3 imcrm-shadow-imcrm-lg'
                                            : 'imcrm-max-w-[1180px]',
                                    )}
                                    data-device={device}
                                    style={
                                        portal
                                            ? {
                                                  ...(page.bg ? { background: page.bg, padding: 16, borderRadius: 14 } : {}),
                                                  ...(page.font ? { fontFamily: PAGE_FONT_STACKS[page.font] } : {}),
                                                  ...(device === 'desktop' ? { maxWidth: page.max_width ?? 1100 } : {}),
                                              }
                                            : undefined
                                    }
                                >
                                    <EditorCanvas onPageChange={setPageId} />
                                </div>
                            </div>
                            <aside className="imcrm-hidden imcrm-w-[320px] imcrm-shrink-0 imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card md:imcrm-flex">
                                <Inspector onPageChange={setPageId} />
                            </aside>
                        </div>
                    </div>

                    {portal && galleryOpen && (
                        <PortalTemplateGallery
                            open
                            onOpenChange={setGalleryOpen}
                            list={list}
                            fields={fields}
                            onApply={(next, kind) => {
                                commit(next);
                                setSelection(null);
                                setPageId(next.pages[0]!.id);
                                setGalleryOpen(false);
                                toast.success(
                                    `${__('Plantilla aplicada:')} ${PORTAL_TEMPLATE_INFO[kind].name}`,
                                    __('Revísala con un cliente de verdad y toca Guardar. Ctrl+Z la deshace.'),
                                );
                            }}
                        />
                    )}
                </WidgetDataOverrideContext.Provider>
            </LayoutContext.Provider>
        </EditorContext.Provider>
    );
}

function noop(): void {
    /* la vista previa no guarda datos */
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }): JSX.Element {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            disabled={disabled}
            className="imcrm-rounded-md imcrm-p-1.5 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground disabled:imcrm-pointer-events-none disabled:imcrm-opacity-40 [&>svg]:imcrm-h-4 [&>svg]:imcrm-w-4"
        >
            {children}
        </button>
    );
}

function DeviceButton({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }): JSX.Element {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={active}
            onClick={onClick}
            className={cn(
                'imcrm-rounded-md imcrm-px-2 imcrm-py-1 [&>svg]:imcrm-h-4 [&>svg]:imcrm-w-4',
                active ? 'imcrm-bg-accent imcrm-text-foreground' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
            )}
        >
            {children}
        </button>
    );
}
