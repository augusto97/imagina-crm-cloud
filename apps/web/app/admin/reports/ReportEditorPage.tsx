import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
    AlignLeft,
    ArrowDown,
    ArrowUp,
    Columns2,
    Copy,
    Database,
    Eye,
    FileText,
    GripVertical,
    Heading,
    LayoutList,
    Loader2,
    Minus,
    Moon,
    Pencil,
    Redo2,
    Rows3,
    Scissors,
    Settings2,
    SlidersHorizontal,
    Sun,
    Trash2,
    Undo2,
    type LucideIcon,
} from 'lucide-react';
import { readReportSettings, reportDataBlocks, type Report, type ReportBlock } from '@imagina-base/shared';

import {
    BuilderMobileNav,
    BuilderMobileTopBar,
    BuilderModeSwitch,
    BuilderTopBar,
    InlineName,
    MoreMenu,
    PanelHeader,
    PreviewToolbar,
    SaveButton,
    type BuilderMode,
    type MenuAction,
} from '@/admin/builder/BuilderShell';
import { DashboardVisibilityFields } from '@/admin/dashboards/DashboardVisibilityFields';
import { WidgetFormDialog } from '@/admin/dashboards/WidgetFormDialog';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useLists } from '@/hooks/useLists';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { __, sprintf } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { WidgetSpec } from '@/types/dashboard';

import { ReportDocument } from './ReportDocument';
import { ReportScopeControls, sendablePeriod } from './ReportScopeControls';
import {
    addBlockProblem,
    blockLabel,
    commit,
    dataTypeLabel,
    dataWidgetFromSpec,
    draftDirty,
    duplicateBlock,
    findBlock,
    historyOf,
    insertBlock,
    joinWithNext,
    moveBlock,
    moveTo,
    newBlockId,
    redo,
    removeBlock,
    replaceBlock,
    specFromBlock,
    splitColumns,
    undo,
    type DraftHistory,
    type ReportDraft,
} from './reportEditor';
import { useReport, useReportPreview, useUpdateReport } from './useReports';

/** La pantalla del editor tapa la app (como los demás editores a pantalla completa). */
function Shell({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-fixed imcrm-inset-0 imcrm-z-40 imcrm-flex imcrm-flex-col imcrm-bg-background imcrm-text-foreground" data-testid="report-editor">
            {children}
        </div>
    );
}

/**
 * v0.1.464 (J1) — El editor de un informe, a pantalla completa: los bloques a
 * la izquierda (agregar, arrastrar, subir/bajar, duplicar, eliminar), el
 * informe REAL al centro (calculado con lo que se está editando, sin
 * guardar) y lo del bloque elegido a la derecha. Deshacer/rehacer, aviso de
 * cambios sin guardar y, en el celular, pestañas abajo.
 */
export function ReportEditorPage(): JSX.Element {
    const { reportId } = useParams();
    const nav = useNavigate();
    const id = Number(reportId);
    const q = useReport(id);
    if (q.isLoading) {
        return (
            <Shell>
                <div className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    {__('Cargando…')}
                </div>
            </Shell>
        );
    }
    if (q.isError || !q.data) {
        return (
            <Shell>
                <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-3 imcrm-p-6 imcrm-text-center">
                    <p className="imcrm-text-sm imcrm-text-destructive">{q.error instanceof Error ? q.error.message : __('No se pudo cargar el informe.')}</p>
                    <Button variant="outline" size="sm" onClick={() => nav('/dashboards?tab=informes')}>
                        {__('Volver a los informes')}
                    </Button>
                </div>
            </Shell>
        );
    }
    return (
        <Shell>
            <Editor key={q.data.id} report={q.data} />
        </Shell>
    );
}

function draftOf(r: Report): ReportDraft {
    const s = readReportSettings(r.settings);
    return {
        name: r.name,
        description: r.description ?? '',
        blocks: r.blocks,
        period: s.period,
        compare: s.compare,
        visibility: r.visibility,
        allowed_roles: r.allowed_roles,
    };
}

type DialogTarget = { mode: 'new'; afterId: string | null } | { mode: 'edit'; blockId: string } | { mode: 'row'; rowId: string };

const isTyping = (t: EventTarget | null): boolean =>
    t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

function Editor({ report }: { report: Report }): JSX.Element {
    const nav = useNavigate();
    const toast = useToast();
    const appTheme = useTheme();
    const narrow = useMediaQuery('(max-width: 1023px)');
    const wide = useMediaQuery('(min-width: 1280px)');
    const lists = useLists();
    const listName = useCallback((id: number) => lists.data?.find((l) => l.id === id)?.name ?? null, [lists.data]);

    const [hist, setHist] = useState<DraftHistory>(() => historyOf(draftOf(report)));
    const draft = hist.present;
    const saved = useRef<ReportDraft>(draftOf(report));
    const dirty = draftDirty(draft, saved.current);
    const { confirmLeave } = useUnsavedChangesGuard(dirty);

    const [selected, setSelected] = useState<string | null>(null);
    const [mode, setMode] = useState<'edit' | 'preview'>('edit');
    const [mobileTab, setMobileTab] = useState<'blocks' | 'preview' | 'inspect'>('blocks');
    const [dialog, setDialog] = useState<DialogTarget | null>(null);
    const dragIndex = useRef<number | null>(null);
    const [dragOver, setDragOver] = useState<number | null>(null);

    /** Un cambio del borrador (`key` junta lo que se tipea seguido en un solo paso de deshacer). */
    const change = useCallback((f: (d: ReportDraft) => ReportDraft, key: string | null = null) => {
        setHist((h) => commit(h, f(h.present), key));
    }, []);
    const setBlocks = useCallback(
        (f: (b: ReportBlock[]) => ReportBlock[], key: string | null = null) => change((d) => ({ ...d, blocks: f(d.blocks) }), key),
        [change],
    );

    // Lo elegido puede desaparecer (deshacer, eliminar): se suelta.
    useEffect(() => {
        if (selected !== null && !findBlock(draft.blocks, selected)) setSelected(null);
    }, [draft.blocks, selected]);

    // Vista previa: sólo los bloques de DATOS cuentan (tipear un título no recalcula).
    const scope = useMemo(() => ({ period: sendablePeriod(draft.period), compare: draft.compare }), [draft.period, draft.compare]);
    const dataBlocks = useMemo(() => reportDataBlocks(draft.blocks), [draft.blocks]);
    const debouncedData = useDebouncedValue(dataBlocks, 450);
    const preview = useReportPreview(debouncedData.length > 0 ? debouncedData : null, scope);

    const update = useUpdateReport(report.id);
    const save = (): void => {
        if (draft.name.trim() === '') {
            toast.error(__('Ponle un nombre al informe.'));
            return;
        }
        update.mutate(
            {
                name: draft.name.trim(),
                description: draft.description.trim() === '' ? null : draft.description.trim(),
                blocks: draft.blocks,
                settings: { ...report.settings, period: sendablePeriod(draft.period), compare: draft.compare },
                visibility: draft.visibility,
                allowed_roles: draft.visibility === 'roles' ? draft.allowed_roles : [],
            },
            {
                onSuccess: (r) => {
                    const next = draftOf(r);
                    saved.current = next;
                    setHist((h) => ({ ...h, present: next }));
                    toast.success(__('Informe guardado'));
                },
                onError: (e) => toast.error(__('No se pudo guardar'), e instanceof Error ? e.message : undefined),
            },
        );
    };
    const saveRef = useRef(save);
    saveRef.current = save;

    const close = async (): Promise<void> => {
        if (await confirmLeave()) nav(`/reports/${report.id}`);
    };

    const select = (id: string | null): void => {
        setSelected(id);
        if (narrow && id !== null) setMobileTab('inspect');
    };

    const addBlock = (kind: 'heading' | 'text' | 'divider' | 'page_break'): void => {
        const problem = addBlockProblem(draft.blocks, false);
        if (problem) {
            toast.error(problem);
            return;
        }
        const id = newBlockId(draft.blocks);
        const after = selected ? findBlock(draft.blocks, selected) : null;
        const afterId = after ? draft.blocks[after.index]!.id : null;
        const block: ReportBlock =
            kind === 'heading'
                ? { id, type: 'heading', text: __('Título de sección'), subtitle: '' }
                : kind === 'text'
                  ? { id, type: 'text', text: '' }
                  : kind === 'divider'
                    ? { id, type: 'divider' }
                    : { id, type: 'page_break' };
        setBlocks((b) => insertBlock(b, block, afterId));
        select(id);
    };

    const openNewData = (): void => {
        const problem = addBlockProblem(draft.blocks, true);
        if (problem) {
            toast.error(problem);
            return;
        }
        const after = selected ? findBlock(draft.blocks, selected) : null;
        setDialog({ mode: 'new', afterId: after ? draft.blocks[after.index]!.id : null });
    };

    const onDialogSave = (spec: WidgetSpec): void => {
        const widget = dataWidgetFromSpec(spec);
        if (!widget || !dialog) {
            toast.error(__('Elige una lista y qué mostrar.'));
            return;
        }
        if (dialog.mode === 'edit') {
            setBlocks((b) => replaceBlock(b, dialog.blockId, (x) => (x.type === 'widget' ? { ...x, widget } : x)));
            return;
        }
        const id = newBlockId(draft.blocks);
        if (dialog.mode === 'row') {
            setBlocks((b) =>
                b.map((x) => (x.id === dialog.rowId && x.type === 'columns' && x.children.length < 3 ? { ...x, children: [...x.children, { id, type: 'widget' as const, widget }] } : x)),
            );
        } else {
            setBlocks((b) => insertBlock(b, { id, type: 'widget', widget }, dialog.afterId));
        }
        select(id);
    };

    const remove = (id: string): void => setBlocks((b) => removeBlock(b, id));
    const duplicate = (id: string): void => {
        const at = findBlock(draft.blocks, id);
        if (!at) return;
        const problem = addBlockProblem(draft.blocks, at.block.type === 'widget' || at.block.type === 'columns');
        if (problem) {
            toast.error(problem);
            return;
        }
        const r = duplicateBlock(draft.blocks, id);
        setBlocks(() => r.blocks);
        if (r.id) select(r.id);
    };

    // Atajos: deshacer/rehacer, guardar, borrar lo elegido, soltar la elección.
    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.key.toLowerCase() === 's') {
                e.preventDefault();
                saveRef.current();
                return;
            }
            if (isTyping(e.target) || document.querySelector('[role="dialog"]')) return;
            if (mod && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                setHist((h) => (e.shiftKey ? redo(h) : undo(h)));
            } else if (mod && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                setHist((h) => redo(h));
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== null) {
                e.preventDefault();
                setBlocks((b) => removeBlock(b, selected));
            } else if (e.key === 'Escape' && selected !== null) {
                setSelected(null);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [selected, setBlocks]);

    const dialogInitial: WidgetSpec | null = useMemo(() => {
        if (!dialog || dialog.mode !== 'edit') return null;
        const at = findBlock(draft.blocks, dialog.blockId);
        return at && at.block.type === 'widget' ? specFromBlock(at.block) : null;
    }, [dialog, draft.blocks]);

    // ───────────── Paneles ─────────────

    const palette = (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-px-3 imcrm-py-3" data-testid="report-palette">
            <p className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Agregar')}</p>
            <button
                type="button"
                onClick={openNewData}
                className="imcrm-flex imcrm-items-center imcrm-gap-2.5 imcrm-rounded-lg imcrm-border imcrm-border-primary/30 imcrm-bg-primary/5 imcrm-px-3 imcrm-py-2.5 imcrm-text-left imcrm-text-[13px] imcrm-font-medium imcrm-text-primary imcrm-transition-colors hover:imcrm-bg-primary/10"
                data-testid="report-add-data"
                data-tour="report-add-data"
            >
                <Database className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                <span className="imcrm-flex imcrm-flex-col">
                    {__('Datos de una lista')}
                    <span className="imcrm-text-[11px] imcrm-font-normal imcrm-text-muted-foreground">{__('Indicador, gráfico o tabla')}</span>
                </span>
            </button>
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-1.5">
                <PaletteButton icon={Heading} label={__('Título')} onClick={() => addBlock('heading')} testId="report-add-heading" />
                <PaletteButton icon={AlignLeft} label={__('Texto')} onClick={() => addBlock('text')} testId="report-add-text" />
                <PaletteButton icon={Minus} label={__('Separador')} onClick={() => addBlock('divider')} testId="report-add-divider" />
                <PaletteButton icon={Scissors} label={__('Salto de página')} onClick={() => addBlock('page_break')} testId="report-add-page-break" />
            </div>
        </div>
    );

    const blockRow = (b: ReportBlock, opts: { index?: number; child?: boolean }): JSX.Element => {
        const label = blockLabel(b, listName);
        const on = selected === b.id;
        const draggable = opts.index !== undefined;
        return (
            <div
                key={b.id}
                draggable={draggable}
                onDragStart={() => {
                    if (opts.index !== undefined) dragIndex.current = opts.index;
                }}
                onDragOver={(e) => {
                    if (opts.index === undefined || dragIndex.current === null) return;
                    e.preventDefault();
                    setDragOver(opts.index);
                }}
                onDragLeave={() => setDragOver((cur) => (cur === opts.index ? null : cur))}
                onDrop={(e) => {
                    e.preventDefault();
                    const from = dragIndex.current;
                    dragIndex.current = null;
                    setDragOver(null);
                    if (from !== null && opts.index !== undefined) setBlocks((x) => moveTo(x, from, opts.index!));
                }}
                onDragEnd={() => {
                    dragIndex.current = null;
                    setDragOver(null);
                }}
                className={cn(
                    'imcrm-group imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-px-2 imcrm-py-1.5 imcrm-transition-colors',
                    opts.child && 'imcrm-ml-5',
                    on ? 'imcrm-border-primary/50 imcrm-bg-primary/5' : 'imcrm-border-transparent hover:imcrm-bg-muted',
                    dragOver === opts.index && dragIndex.current !== opts.index && 'imcrm-ring-1 imcrm-ring-primary/50',
                )}
                data-testid="report-block-row"
                data-block-id={b.id}
            >
                {draggable ? (
                    <GripVertical className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-cursor-grab imcrm-text-muted-foreground/60" aria-hidden />
                ) : (
                    <span className="imcrm-w-3.5 imcrm-shrink-0" />
                )}
                <button type="button" onClick={() => select(b.id)} className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-text-left" data-testid="report-block-pick">
                    <span className="imcrm-text-[10.5px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{label.kind}</span>
                    <span className="imcrm-truncate imcrm-text-[13px] imcrm-text-foreground">{label.text}</span>
                </button>
                <div className={cn('imcrm-flex imcrm-shrink-0 imcrm-items-center', on ? 'imcrm-opacity-100' : 'imcrm-opacity-100 lg:imcrm-opacity-0 lg:group-hover:imcrm-opacity-100 lg:group-focus-within:imcrm-opacity-100')}>
                    <RowAction icon={ArrowUp} label={__('Subir')} onClick={() => setBlocks((x) => moveBlock(x, b.id, -1))} testId="report-block-up" />
                    <RowAction icon={ArrowDown} label={__('Bajar')} onClick={() => setBlocks((x) => moveBlock(x, b.id, 1))} testId="report-block-down" />
                    <RowAction icon={Copy} label={__('Duplicar')} onClick={() => duplicate(b.id)} testId="report-block-duplicate" />
                    <RowAction icon={Trash2} label={__('Eliminar')} onClick={() => remove(b.id)} testId="report-block-delete" danger />
                </div>
            </div>
        );
    };

    const blocksPanel = (
        <div className="imcrm-flex imcrm-flex-col" data-tour="report-editor-blocks" data-testid="report-blocks">
            {!narrow && <PanelHeader icon={LayoutList} title={__('Bloques')} subtitle={__('Arrastra para cambiar el orden. Toca uno para editarlo.')} />}
            {palette}
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-border-t imcrm-border-border imcrm-px-2 imcrm-py-3">
                <p className="imcrm-px-1 imcrm-pb-1 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                    {sprintf(__('En el informe (%d)'), draft.blocks.length)}
                </p>
                {draft.blocks.length === 0 && (
                    <p className="imcrm-px-1 imcrm-py-2 imcrm-text-[12.5px] imcrm-text-muted-foreground">{__('Todavía no hay bloques. Empieza con un título o con datos de una lista.')}</p>
                )}
                {draft.blocks.map((b, i) => (
                    <div key={b.id} className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                        {blockRow(b, { index: i })}
                        {b.type === 'columns' && b.children.map((c) => blockRow(c, { child: true }))}
                    </div>
                ))}
            </div>
        </div>
    );

    const selectedAt = selected ? findBlock(draft.blocks, selected) : null;

    const inspector = (): JSX.Element => {
        if (!selectedAt) {
            return (
                <div className="imcrm-flex imcrm-flex-col" data-testid="report-settings">
                    <PanelHeader icon={Settings2} title={__('Ajustes del informe')} subtitle={__('Lo que vale para todo el informe. Toca un bloque para editarlo.')} />
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-p-4">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="report-description">{__('Descripción')}</Label>
                            <Textarea
                                id="report-description"
                                rows={3}
                                value={draft.description}
                                maxLength={2000}
                                onChange={(e) => change((d) => ({ ...d, description: e.target.value }), 'description')}
                                placeholder={__('Para qué es y para quién (sale en la portada del PDF).')}
                            />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label>{__('Período y comparación')}</Label>
                            <ReportScopeControls
                                idPrefix="report-editor"
                                period={draft.period}
                                compare={draft.compare}
                                onPeriod={(v) => change((d) => ({ ...d, period: v }))}
                                onCompare={(v) => change((d) => ({ ...d, compare: v }))}
                            />
                            <p className="imcrm-text-[11.5px] imcrm-leading-snug imcrm-text-muted-foreground">
                                {__('Si eliges uno, pisa el de cada bloque que tenga campo de fecha. Quien mira el informe lo puede cambiar sin tocar lo guardado.')}
                            </p>
                        </div>
                        <DashboardVisibilityFields
                            idPrefix="report-editor"
                            visibility={draft.visibility}
                            allowedRoles={draft.allowed_roles}
                            onVisibilityChange={(v) => change((d) => ({ ...d, visibility: v }))}
                            onAllowedRolesChange={(r) => change((d) => ({ ...d, allowed_roles: r }))}
                        />
                    </div>
                </div>
            );
        }
        const b = selectedAt.block;
        const label = blockLabel(b, listName);
        const inRow = selectedAt.child !== null;
        const rowId = inRow ? draft.blocks[selectedAt.index]!.id : null;
        const canJoin = !inRow && joinWithNext(draft.blocks, b.id) !== null;
        return (
            <div className="imcrm-flex imcrm-flex-col" data-testid="report-inspector">
                <PanelHeader
                    icon={b.type === 'widget' ? Database : b.type === 'columns' ? Columns2 : b.type === 'text' ? AlignLeft : b.type === 'heading' ? Heading : Rows3}
                    title={label.kind}
                    subtitle={label.text}
                    back={{ label: __('Ajustes del informe'), onClick: () => setSelected(null) }}
                />
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-p-4">
                    {b.type === 'heading' && (
                        <>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label htmlFor="report-heading-text">{__('Título')}</Label>
                                <Input
                                    id="report-heading-text"
                                    value={b.text}
                                    maxLength={300}
                                    onChange={(e) => setBlocks((x) => replaceBlock(x, b.id, (y) => (y.type === 'heading' ? { ...y, text: e.target.value } : y)), `h:${b.id}`)}
                                    data-testid="report-heading-input"
                                />
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label htmlFor="report-heading-sub">{__('Línea debajo (opcional)')}</Label>
                                <Input
                                    id="report-heading-sub"
                                    value={b.subtitle}
                                    maxLength={500}
                                    onChange={(e) => setBlocks((x) => replaceBlock(x, b.id, (y) => (y.type === 'heading' ? { ...y, subtitle: e.target.value } : y)), `hs:${b.id}`)}
                                />
                            </div>
                        </>
                    )}
                    {b.type === 'text' && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="report-text">{__('Texto')}</Label>
                            <Textarea
                                id="report-text"
                                rows={10}
                                value={b.text}
                                onChange={(e) => setBlocks((x) => replaceBlock(x, b.id, (y) => (y.type === 'text' ? { ...y, text: e.target.value } : y)), `t:${b.id}`)}
                                placeholder={__('Escribe lo que quieras contar: un resumen, conclusiones, próximos pasos…')}
                                data-testid="report-text-input"
                            />
                            <p className="imcrm-text-[11.5px] imcrm-text-muted-foreground">
                                {__('Formato sencillo: **negrita**, *cursiva*, - viñetas, ## subtítulos y [enlace](https://…).')}
                            </p>
                        </div>
                    )}
                    {b.type === 'widget' && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-3 imcrm-text-[13px]">
                            <p>
                                <span className="imcrm-text-muted-foreground">{__('Qué muestra:')}</span> {dataTypeLabel(b.widget.type)}
                            </p>
                            <p>
                                <span className="imcrm-text-muted-foreground">{__('De la lista:')}</span> {listName(b.widget.list_id) ?? sprintf(__('Lista #%d'), b.widget.list_id)}
                            </p>
                            <Button size="sm" className="imcrm-mt-1 imcrm-gap-1.5 imcrm-self-start" onClick={() => setDialog({ mode: 'edit', blockId: b.id })} data-testid="report-configure-data">
                                <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Configurar los datos')}
                            </Button>
                            <p className="imcrm-text-[11.5px] imcrm-text-muted-foreground">
                                {__('Cada bloque tiene su lista, sus filtros, su período y su comparación, como un widget de un tablero.')}
                            </p>
                        </div>
                    )}
                    {b.type === 'columns' && (
                        <p className="imcrm-text-[13px] imcrm-text-muted-foreground">
                            {__('Estos bloques van lado a lado. En el celular y en el PDF angosto se ven uno debajo del otro.')}
                        </p>
                    )}
                    {b.type === 'divider' && <p className="imcrm-text-[13px] imcrm-text-muted-foreground">{__('Una línea para separar secciones.')}</p>}
                    {b.type === 'page_break' && (
                        <p className="imcrm-text-[13px] imcrm-text-muted-foreground">{__('En el PDF, lo que sigue empieza en una página nueva. En la pantalla no se ve.')}</p>
                    )}

                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-border-t imcrm-border-border imcrm-pt-4">
                        <p className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Acomodar')}</p>
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                            <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={() => setBlocks((x) => moveBlock(x, b.id, -1))}>
                                <ArrowUp className="imcrm-h-3.5 imcrm-w-3.5" />
                                {inRow ? __('A la izquierda') : __('Subir')}
                            </Button>
                            <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={() => setBlocks((x) => moveBlock(x, b.id, 1))}>
                                <ArrowDown className="imcrm-h-3.5 imcrm-w-3.5" />
                                {inRow ? __('A la derecha') : __('Bajar')}
                            </Button>
                            {canJoin && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="imcrm-gap-1.5"
                                    onClick={() => setBlocks((x) => joinWithNext(x, b.id) ?? x)}
                                    data-testid="report-block-join"
                                >
                                    <Columns2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Poner al lado del siguiente')}
                                </Button>
                            )}
                            {(b.type === 'columns' || inRow) && (
                                <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={() => setBlocks((x) => splitColumns(x, rowId ?? b.id))} data-testid="report-block-split">
                                    <Rows3 className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Uno debajo del otro')}
                                </Button>
                            )}
                            {b.type === 'columns' && b.children.length < 3 && (
                                <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={() => setDialog({ mode: 'row', rowId: b.id })}>
                                    <Database className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Agregar a esta fila')}
                                </Button>
                            )}
                        </div>
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                            <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={() => duplicate(b.id)}>
                                <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Duplicar')}
                            </Button>
                            <Button variant="outline" size="sm" className="imcrm-gap-1.5 imcrm-text-destructive hover:imcrm-text-destructive" onClick={() => remove(b.id)}>
                                <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Eliminar')}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const canvas = (compact: boolean): JSX.Element => (
        <div className={cn('imcrm-mx-auto imcrm-w-full imcrm-max-w-4xl', compact ? 'imcrm-p-3' : 'imcrm-p-6')} onClick={() => mode === 'edit' && setSelected(null)} data-testid="report-canvas">
            <div className="imcrm-mb-5 imcrm-border-b imcrm-border-border imcrm-pb-4">
                <h1 className="imcrm-text-2xl imcrm-font-semibold imcrm-tracking-tight">{draft.name || __('Informe sin nombre')}</h1>
                {draft.description && <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">{draft.description}</p>}
            </div>
            {draft.blocks.length === 0 ? (
                <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-10 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                    <FileText className="imcrm-h-6 imcrm-w-6" />
                    {__('Agrega bloques desde la izquierda: títulos, textos e indicadores, gráficos o tablas de cualquiera de tus listas.')}
                </div>
            ) : (
                <ReportDocument
                    blocks={draft.blocks}
                    data={preview.data?.data}
                    loading={preview.isLoading || (preview.isFetching && preview.data === undefined)}
                    error={preview.error instanceof Error ? preview.error : null}
                    period={scope.period}
                    compare={scope.compare}
                    editing={mode === 'edit'}
                    selectedId={mode === 'edit' ? selected : null}
                    onSelect={mode === 'edit' ? (id) => select(id) : undefined}
                />
            )}
        </div>
    );

    const themeAction: MenuAction = { label: appTheme.resolved === 'dark' ? __('Modo claro') : __('Modo oscuro'), icon: appTheme.resolved === 'dark' ? Sun : Moon, onSelect: appTheme.toggle };
    const nameInput = <InlineName value={draft.name} onChange={(v) => change((d) => ({ ...d, name: v }), 'name')} label={__('Nombre del informe')} testId="report-name" />;
    const saveButton = <SaveButton dirty={dirty} busy={update.isPending} onClick={save} testId="report-save" />;
    const widgetDialog = (
        <WidgetFormDialog
            open={dialog !== null}
            onOpenChange={(o) => {
                if (!o) setDialog(null);
            }}
            initial={dialogInitial}
            onSave={onDialogSave}
            report={scope}
        />
    );

    if (narrow) {
        const items: Array<BuilderMode<'blocks' | 'preview' | 'inspect'>> = [
            { id: 'blocks', label: __('Bloques'), icon: LayoutList, testId: 'report-tab-blocks' },
            { id: 'preview', label: __('Vista previa'), icon: Eye, testId: 'report-tab-preview' },
            { id: 'inspect', label: selectedAt ? __('Editar') : __('Ajustes'), icon: SlidersHorizontal, testId: 'report-tab-inspect' },
        ];
        return (
            <div className="imcrm-flex imcrm-h-full imcrm-min-h-0 imcrm-flex-col">
                <BuilderMobileTopBar
                    onClose={() => void close()}
                    name={nameInput}
                    published={!dirty}
                    statusText={dirty ? __('Sin guardar') : __('Guardado')}
                    more={
                        <MoreMenu
                            testId="report-editor-more"
                            actions={[
                                { label: __('Deshacer'), icon: Undo2, onSelect: () => setHist((h) => undo(h)), disabled: hist.past.length === 0 },
                                { label: __('Rehacer'), icon: Redo2, onSelect: () => setHist((h) => redo(h)), disabled: hist.future.length === 0 },
                                {
                                    label: __('Ajustes del informe'),
                                    icon: Settings2,
                                    onSelect: () => {
                                        setSelected(null);
                                        setMobileTab('inspect');
                                    },
                                    separated: true,
                                },
                                themeAction,
                            ]}
                        />
                    }
                    save={saveButton}
                />
                <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto imcrm-bg-canvas">
                    {mobileTab === 'blocks' && <div className="imcrm-bg-card">{blocksPanel}</div>}
                    {mobileTab === 'preview' && canvas(true)}
                    {mobileTab === 'inspect' && <div className="imcrm-bg-card">{inspector()}</div>}
                </div>
                <BuilderMobileNav items={items} value={mobileTab} onChange={setMobileTab} />
                {widgetDialog}
            </div>
        );
    }

    const modes: Array<BuilderMode<'edit' | 'preview'>> = [
        { id: 'edit', label: __('Editar'), icon: SlidersHorizontal, testId: 'report-mode-edit' },
        { id: 'preview', label: __('Vista previa'), icon: Eye, testId: 'report-mode-preview' },
    ];

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-min-h-0 imcrm-flex-col">
            <BuilderTopBar
                kindIcon={FileText}
                kindLabel={__('Informe')}
                onClose={() => void close()}
                name={nameInput}
                modes={<BuilderModeSwitch modes={modes} value={mode} onChange={setMode} compact={!wide} />}
                actions={
                    <>
                        <Button variant="ghost" size="icon" aria-label={__('Deshacer')} title={__('Deshacer (Ctrl+Z)')} disabled={hist.past.length === 0} onClick={() => setHist((h) => undo(h))} data-testid="report-undo">
                            <Undo2 className="imcrm-h-4 imcrm-w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={__('Rehacer')} title={__('Rehacer (Ctrl+Y)')} disabled={hist.future.length === 0} onClick={() => setHist((h) => redo(h))} data-testid="report-redo">
                            <Redo2 className="imcrm-h-4 imcrm-w-4" />
                        </Button>
                        {wide ? <ThemeToggle compact /> : <MoreMenu testId="report-editor-more" actions={[themeAction]} />}
                        {saveButton}
                    </>
                }
            />
            {mode === 'preview' ? (
                <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto imcrm-bg-canvas">{canvas(false)}</div>
            ) : (
                <div className={cn('imcrm-grid imcrm-min-h-0 imcrm-flex-1', wide ? 'imcrm-grid-cols-[300px_minmax(0,1fr)_340px]' : 'imcrm-grid-cols-[260px_minmax(0,1fr)_300px]')}>
                    <aside className="imcrm-min-h-0 imcrm-overflow-y-auto imcrm-border-r imcrm-border-border imcrm-bg-card">{blocksPanel}</aside>
                    <div className="imcrm-flex imcrm-min-h-0 imcrm-min-w-0 imcrm-flex-col imcrm-bg-canvas">
                        <PreviewToolbar hint={__('el informe real, con lo que estás editando (sin guardar)')}>
                            {preview.isFetching && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin imcrm-text-muted-foreground" aria-label={__('Calculando…')} />}
                        </PreviewToolbar>
                        <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto">{canvas(false)}</div>
                    </div>
                    <aside className="imcrm-min-h-0 imcrm-overflow-y-auto imcrm-border-l imcrm-border-border imcrm-bg-card">{inspector()}</aside>
                </div>
            )}
            {widgetDialog}
        </div>
    );
}

function PaletteButton({ icon: Icon, label, onClick, testId }: { icon: LucideIcon; label: string; onClick: () => void; testId: string }): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2.5 imcrm-py-2 imcrm-text-left imcrm-text-[12.5px] imcrm-transition-colors hover:imcrm-border-primary/40 hover:imcrm-bg-primary/5"
            data-testid={testId}
        >
            <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
            <span className="imcrm-truncate">{label}</span>
        </button>
    );
}

function RowAction({ icon: Icon, label, onClick, testId, danger }: { icon: LucideIcon; label: string; onClick: () => void; testId: string; danger?: boolean }): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={label}
            data-testid={testId}
            className={cn(
                'imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-background hover:imcrm-text-foreground',
                danger && 'hover:imcrm-text-destructive',
            )}
        >
            <Icon className="imcrm-h-3.5 imcrm-w-3.5" />
        </button>
    );
}
