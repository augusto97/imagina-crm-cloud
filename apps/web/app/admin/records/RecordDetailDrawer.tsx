import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
    Activity,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    ChevronsLeft,
    ChevronsRight,
    ExternalLink,
    FileText,
    MessageSquare,
    Save,
    Trash2,
} from 'lucide-react';

import { ActivityPanel } from '@/admin/activity/ActivityPanel';
import { CommentsPanel } from '@/admin/comments/CommentsPanel';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import {
    Sheet,
    SheetCloseButton,
    SheetDescription,
    SheetFooter,
    SheetTitle,
} from '@/components/ui/sheet';
import { markLocalRecordsChange, useDeleteRecord, useUpdateRecord } from '@/hooks/useRecords';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { notificationKeys } from '@/hooks/useNotifications';
import { forgetRecord, useRecordView } from '@/hooks/useRecordView';
import { ApiError } from '@/lib/api';
import { getBootData } from '@/lib/boot';
import { escapeIntent, FLOATING_MENU_ATTR, isInsideFloatingUi, leaveField, recordNavDirection } from '@/lib/escapeGuard';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCanAny } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import { useList } from '@/hooks/useLists';
import type { RecordEntity } from '@/types/record';

import { PortalAccessButton } from './crm/PortalAccessButton';
import { RecordFollowControls } from '@/admin/mywork/RecordFollowControls';
import { GeneratePdfButton } from '@/admin/documents/GeneratePdfButton';
import { RecordPaymentsPanel } from '@/cloud/components/payments/RecordPaymentsPanel';
import { RecordBacklinks } from './RecordBacklinks';
import { RecordDescription } from './description/RecordDescription';
import { RecordFieldsForm } from './RecordFieldsForm';
import { RecordSubtasks } from './RecordSubtasks';
import { RecordTitleInput } from './RecordTitleInput';
import { lockedReasonsFor, useStoreRules } from './storeRules';
import { titleFieldOf } from '@/lib/recordTitle';
import { RecordMetaGrid } from './RecordMetaGrid';
import { parseUtcDate } from '@/lib/utcDate';
import { useRecordDraft } from './recordDraft';

import { formatLongDate } from '@/lib/tenantFormat';
interface RecordDetailDrawerProps {
    listId: number;
    /**
     * Slug actual de la lista. Usado para construir el link a la página
     * de Card. Opcional para retro-compatibilidad — si no se pasa, el
     * link no se muestra.
     */
    listSlug?: string;
    /**
     * Nombre humano de la lista para el breadcrumb de la barra superior
     * ("{lista} / {registro}"). Si no se pasa, cae al slug.
     */
    listName?: string;
    fields: FieldEntity[];
    record: RecordEntity | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * Registro anterior / siguiente en el orden de la tabla (↑/↓ y J/K).
     * `undefined` = sin navegación (la vista no tiene un orden plano).
     */
    onNavigate?: (dir: -1 | 1) => void;
    canPrev?: boolean;
    canNext?: boolean;
    /** Abrir OTRO registro en este mismo modal (subtareas, su padre). */
    onOpenRecord?: (id: number) => void;
}

/** Clave de localStorage para recordar si el aside de Actividad está abierto. */
const ASIDE_STORAGE_KEY = 'imcrm-record-modal-aside';

function readAsidePref(): boolean {
    try {
        return window.localStorage.getItem(ASIDE_STORAGE_KEY) !== '0';
    } catch {
        return true;
    }
}

/** Timestamps del API vienen naive-UTC (`YYYY-MM-DD HH:MM:SS`). */
function formatCreatedDate(value: string | null | undefined): string {
    if (!value) return '—';
    const d = parseUtcDate(value);
    return Number.isNaN(d.getTime())
        ? value
        : formatLongDate(d);
}

/**
 * Modal flotante grande (patrón ClickUp) con el form completo del
 * registro. Estructura calcada de la vista de tarea de ClickUp:
 * una barra superior full-width (breadcrumb lista/registro + fecha de
 * creación + link a página completa + cerrar), y debajo dos columnas en
 * lg+: a la izquierda el contenido (chip "Registro", título, metadatos,
 * sección "Campos" con filas separadas solo por hairlines) con scroll
 * propio; a la derecha un panel COLAPSABLE de 380px con las tabs
 * Comentarios/Actividad y el composer abajo. En <lg se apila:
 * contenido arriba, tabs debajo.
 *
 * Se usa como complemento al inline edit: aquí se editan también los
 * campos `user`, `file` y `relation`.
 *
 * Lo que abre la ficha (descripción, comentarios, actividad, vinculados,
 * cobros, PDF, seguir…) llega en UN request (`useRecordView`); mientras, esos
 * paneles muestran un esqueleto en vez de salir a pedir cada uno lo suyo.
 *
 * El borrador sólo guarda lo que la persona TOCÓ (`useRecordDraft`): un cambio
 * hecho por otra persona mientras el modal está abierto se ve al instante y
 * Guardar no lo revierte. Cerrar con cambios sin guardar (Esc, X, Cancelar,
 * click afuera, página completa, otro registro) pregunta antes.
 */
export function RecordDetailDrawer({
    listId,
    listSlug,
    listName,
    fields,
    record,
    open,
    onOpenChange,
    onNavigate,
    canPrev = false,
    canNext = false,
    onOpenRecord,
}: RecordDetailDrawerProps): JSX.Element {
    const update = useUpdateRecord(listId);
    const canEditRecords = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS);
    const remove = useDeleteRecord(listId);
    const confirm = useConfirm();
    const toast = useToast();
    const navigate = useNavigate();
    const qc = useQueryClient();
    // v0.1.213 — lista de una tienda: qué campos se editan en WooCommerce.
    const storeRules = useStoreRules();

    const draft = useRecordDraft(record);
    const { values, setValues, dirty } = draft;
    // Atrás del navegador (que cierra el modal: `?record=`), un enlace de la
    // app o cerrar la pestaña con cambios sin guardar → pregunta antes.
    useUnsavedChangesGuard(open && dirty);
    const view = useRecordView(listId, record?.id, open && record !== null);
    const lockedReasons = useMemo(() => lockedReasonsFor(storeRules, fields, values), [storeRules, fields, values]);
    const [error, setError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [tab, setTab] = useState<'comments' | 'activity'>('comments');
    const [fieldsOpen, setFieldsOpen] = useState(true);
    // Aside de Actividad colapsable (persistido en localStorage).
    const [asideOpen, setAsideOpen] = useState<boolean>(readAsidePref);
    // v0.1.258 — En pantallas angostas el aside apilado le robaba media
    // pantalla al formulario (con Guardar en el medio y dos scrolls): ahí se
    // usa UNA vista por vez con pestañas Detalles / Comentarios / Actividad.
    const narrow = useMediaQuery('(max-width: 1023px)');
    const [mobileTab, setMobileTab] = useState<'details' | 'comments' | 'activity'>('details');
    const contentRef = useRef<HTMLDivElement>(null);
    const boot = getBootData();

    const toggleAside = (): void => {
        setAsideOpen((v) => {
            const next = !v;
            try {
                window.localStorage.setItem(ASIDE_STORAGE_KEY, next ? '1' : '0');
            } catch {
                // localStorage no disponible — el estado queda solo en memoria.
            }
            return next;
        });
    };

    useEffect(() => {
        setError(null);
        setFieldErrors({});
        setTab('comments');
        setFieldsOpen(true);
        setMobileTab('details');
        update.reset();
        remove.reset();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [record?.id]);

    // ListSummary para PortalAccessButton (cacheado por TanStack; el
    // drawer solo recibe listId/slug/nombre).
    const listData = useList(view.ready ? listId : undefined);

    /** ¿Se pueden perder cambios? Pregunta y descarta si la persona acepta. */
    const dirtyRef = useRef(dirty);
    dirtyRef.current = dirty;
    const confirmDiscard = async (): Promise<boolean> => {
        if (!dirtyRef.current) return true;
        const ok = await confirm({
            title: __('¿Descartar los cambios?'),
            description: __('Hay cambios sin guardar en este registro. Si sales ahora, se pierden.'),
            confirmLabel: __('Descartar cambios'),
            cancelLabel: __('Seguir editando'),
            destructive: true,
        });
        // flushSync: la guardia de «cambios sin guardar» se apaga ANTES de que
        // el cierre mueva el historial (si no, «Atrás» preguntaba dos veces).
        if (ok) flushSync(() => draft.reset());
        return ok;
    };
    const requestClose = async (): Promise<void> => {
        if (await confirmDiscard()) onOpenChange(false);
    };
    const navRef = useRef<{ go: (dir: -1 | 1) => void }>({ go: () => undefined });
    navRef.current.go = (dir) => {
        if (!onNavigate || (dir === -1 ? !canPrev : !canNext)) return;
        void confirmDiscard().then((ok) => ok && onNavigate(dir));
    };

    // J / K (y ↓ / ↑, v0.1.286): registro siguiente / anterior (como en Gmail
    // o Linear), sólo si el foco no está en un campo ni en un control que ya
    // usa las flechas, y no hay otra capa encima (un menú, la confirmación).
    useEffect(() => {
        if (!open || !onNavigate) return;
        const onKey = (e: KeyboardEvent): void => {
            if (e.defaultPrevented) return;
            const dir = recordNavDirection(e, e.target as Element | null);
            if (dir === null) return;
            const content = contentRef.current;
            if (!content || !content.contains(document.activeElement ?? null) && document.activeElement !== document.body) return;
            if (document.querySelector(`[${FLOATING_MENU_ATTR}], [role="menu"], [role="listbox"], [role="alertdialog"]`)) return;
            e.preventDefault();
            navRef.current.go(dir);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onNavigate]);

    if (!record) {
        return <Sheet open={open} onOpenChange={onOpenChange} />;
    }

    // Título del record (mismo criterio que RecordPage): valor del campo
    // primario — o del primer text — con fallback "Registro #id".
    const titleField = titleFieldOf(fields);
    const liveTitle = titleField ? values[titleField.slug] : undefined;
    const title =
        typeof liveTitle === 'string' && liveTitle.trim() !== ''
            ? liveTitle
            : sprintf(
                  /* translators: %d: record id */
                  __('Registro #%d'),
                  record.id,
              );

    const handleSave = async (): Promise<void> => {
        setError(null);
        setFieldErrors({});

        // Sólo lo que la persona tocó y difiere del servidor (lo que cambió
        // otra persona mientras tanto NO se pisa).
        const patch = draft.patch();
        if (Object.keys(patch).length === 0) return;

        try {
            const saved = await update.mutateAsync({ id: record.id, values: patch });
            flushSync(() => draft.markSaved(patch, saved ?? null));
            // Asignarse un registro te suscribe a él (ADR-S40).
            void qc.invalidateQueries({ queryKey: notificationKeys.follow(record.id) });
            onOpenChange(false);
        } catch (err) {
            if (err instanceof ApiError) {
                setError(err.message);
                setFieldErrors(err.errors);
            } else if (err instanceof Error) {
                setError(err.message);
            }
        }
    };

    const handleDelete = async (): Promise<void> => {
        const ok = await confirm({
            title: sprintf(
                /* translators: %s: record title */
                __('¿Eliminar «%s»?'),
                title,
            ),
            description: record.subtask_count > 0
                ? __('Se elimina junto con sus subtareas. Esta acción no se puede deshacer.')
                : __('Esta acción no se puede deshacer.'),
            destructive: true,
            confirmLabel: __('Eliminar'),
        });
        if (!ok) return;
        // Se cierra ANTES de borrar: con la ficha montada, la invalidación de
        // la lista y el aviso del socket volvían a pedir el registro, su
        // descripción y sus comentarios (404 de un registro que ya no existe).
        const id = record.id;
        flushSync(() => {
            draft.reset();
            onOpenChange(false);
        });
        markLocalRecordsChange(qc, listId);
        try {
            await remove.mutateAsync({ id, purge: false });
            forgetRecord(qc, listId, id);
            toast.success(__('Registro eliminado'));
        } catch (err) {
            toast.error(__('No se pudo eliminar el registro'), err instanceof Error ? err.message : undefined);
        }
    };

    const openFullPage = async (): Promise<void> => {
        if (listSlug === undefined) return;
        if (!(await confirmDiscard())) return;
        // Reemplaza la entrada del modal (`?record=`): atrás vuelve a la lista.
        navigate(`/lists/${listSlug}/records/${record.id}`, { replace: true });
    };

    const openOther = onOpenRecord
        ? (id: number): void => {
              void confirmDiscard().then((ok) => ok && onOpenRecord(id));
          }
        : undefined;

    const skeleton = (h: string): JSX.Element => (
        <div className={cn('imcrm-animate-pulse imcrm-rounded-md imcrm-bg-muted/60', h)} aria-hidden />
    );

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (next) onOpenChange(true);
                else void requestClose();
            }}
        >
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-40 imcrm-bg-black/40 imcrm-backdrop-blur-sm imcrm-animate-imcrm-fade-in" />
                {/*
                 * Wrapper de centrado por flex (en vez de translate -50%)
                 * para que el transform de la animación scale-in no pelee
                 * con el de centrado. Click en el área vacía = pointer-down
                 * fuera del Content → Radix cierra igual que con overlay.
                 */}
                <div className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-flex imcrm-items-center imcrm-justify-center">
                    <DialogPrimitive.Content
                        ref={contentRef}
                        data-testid="imcrm-record-modal"
                        // Esc cierra la capa MÁS CERCANA: un menú propio
                        // abierto, después el campo donde se escribe y recién
                        // ahí la ficha (preguntando si hay cambios).
                        onEscapeKeyDown={(e) => {
                            const active = document.activeElement;
                            const intent = escapeIntent(active, contentRef.current);
                            e.preventDefault();
                            if (intent === 'field') leaveField(active);
                            else if (intent === 'close') void requestClose();
                        }}
                        // Un click en un menú flotante propio (barra del
                        // editor, «/», mención) no es "afuera".
                        onPointerDownOutside={(e) => {
                            if (isInsideFloatingUi(e.target as Element | null)) e.preventDefault();
                        }}
                        className={cn(
                            // Celular: pantalla completa (la tarjeta flotante dejaba
                            // márgenes y un formulario de media altura).
                            'imcrm-flex imcrm-h-[100dvh] imcrm-w-screen imcrm-flex-col imcrm-overflow-hidden',
                            'sm:imcrm-h-[88vh] sm:imcrm-w-[min(1150px,94vw)] sm:imcrm-rounded-lg sm:imcrm-border',
                            'imcrm-border-border imcrm-bg-card imcrm-text-card-foreground imcrm-shadow-imcrm-xl',
                            'imcrm-animate-imcrm-scale-in',
                        )}
                    >
                        {/* ——— Barra superior full-width (patrón ClickUp) ——— */}
                        <div className="imcrm-flex imcrm-h-12 imcrm-shrink-0 imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-4">
                            {onNavigate && (
                                <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="imcrm-h-8 imcrm-w-8"
                                        disabled={!canPrev}
                                        onClick={() => navRef.current.go(-1)}
                                        aria-label={__('Registro anterior (K o ↑)')}
                                        title={__('Registro anterior (K o ↑)')}
                                        data-testid="imcrm-record-prev"
                                    >
                                        <ChevronUp className="imcrm-h-4 imcrm-w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="imcrm-h-8 imcrm-w-8"
                                        disabled={!canNext}
                                        onClick={() => navRef.current.go(1)}
                                        aria-label={__('Registro siguiente (J o ↓)')}
                                        title={__('Registro siguiente (J o ↓)')}
                                        data-testid="imcrm-record-next"
                                    >
                                        <ChevronDown className="imcrm-h-4 imcrm-w-4" />
                                    </Button>
                                </div>
                            )}
                            <SheetDescription className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-[13px] imcrm-text-muted-foreground">
                                {(listName ?? listSlug) !== undefined && (
                                    <>
                                        {listName ?? listSlug}
                                        <span className="imcrm-mx-1.5 imcrm-text-muted-foreground/80">/</span>
                                    </>
                                )}
                                {/* El NOMBRE del registro, no su id (el id va aparte). */}
                                <span className="imcrm-text-foreground/80">{title}</span>
                                <span className="imcrm-ml-1.5 imcrm-font-mono imcrm-text-[11px] imcrm-text-muted-foreground/70">#{record.id}</span>
                            </SheetDescription>
                            <span className="imcrm-hidden imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground xl:imcrm-inline">
                                {sprintf(
                                    /* translators: %s: fecha de creación del registro */
                                    __('Se creó el %s'),
                                    formatCreatedDate(record.created_at),
                                )}
                            </span>
                            {view.ready && (
                                <>
                                    <RecordFollowControls listId={listId} recordId={record.id} compact />
                                    <GeneratePdfButton listId={listId} listSlug={listSlug} recordId={record.id} fields={fields} compact />
                                </>
                            )}
                            {listSlug !== undefined && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={__('Abrir página completa')}
                                    title={__('Abrir página completa')}
                                    onClick={() => void openFullPage()}
                                >
                                    <ExternalLink className="imcrm-h-4 imcrm-w-4" />
                                </Button>
                            )}
                            <SheetCloseButton />
                        </div>

                        {narrow && (
                            <div
                                role="tablist"
                                aria-label={__('Vista del registro')}
                                className="imcrm-flex imcrm-shrink-0 imcrm-gap-1 imcrm-border-b imcrm-border-border imcrm-px-3"
                                data-testid="imcrm-record-mobile-tabs"
                            >
                                <TabButton active={mobileTab === 'details'} onClick={() => setMobileTab('details')}>
                                    <FileText className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Detalles')}
                                </TabButton>
                                <TabButton active={mobileTab === 'comments'} onClick={() => setMobileTab('comments')}>
                                    <MessageSquare className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Comentarios')}
                                </TabButton>
                                <TabButton active={mobileTab === 'activity'} onClick={() => setMobileTab('activity')}>
                                    <Activity className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Actividad')}
                                </TabButton>
                            </div>
                        )}

                        {/* ——— Fila: contenido + aside colapsable ——— */}
                        <div className="imcrm-relative imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col lg:imcrm-flex-row">
                            {/* ——— Columna de contenido con scroll propio ——— */}
                            <div
                                className={cn(
                                    'imcrm-flex imcrm-min-h-0 imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col',
                                    narrow && mobileTab !== 'details' && 'imcrm-hidden',
                                )}
                            >
                                <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto imcrm-px-4 imcrm-py-4 sm:imcrm-px-8 sm:imcrm-py-5">
                                    {/* Chip de tipo de entidad (como el chip "Tarea" de ClickUp). */}
                                    <span className="imcrm-inline-flex imcrm-w-fit imcrm-items-center imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                                        {record.parent_id ? __('Subtarea') : __('Registro')}
                                    </span>

                                    {/* El título ES el campo primario (v0.1.136):
                                        se edita aquí (y no se repite como fila en
                                        "Campos"). */}
                                    <SheetTitle asChild>
                                        <div className="imcrm-mt-2">
                                            <RecordTitleInput
                                                field={titleField}
                                                value={titleField ? values[titleField.slug] : undefined}
                                                onChange={(next) =>
                                                    titleField
                                                    && setValues((v) => ({ ...v, [titleField.slug]: next }))
                                                }
                                                fallback={title}
                                                editable={canEditRecords && !(titleField && lockedReasons[titleField.slug])}
                                                className="imcrm--ml-1.5"
                                            />
                                            {titleField && fieldErrors[titleField.slug] !== undefined && (
                                                <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-destructive">{fieldErrors[titleField.slug]}</p>
                                            )}
                                        </div>
                                    </SheetTitle>

                                    {/* Cuándo se creó y cuándo cambió (lo que no es un campo). */}
                                    <RecordMetaGrid record={record} twoCols className="imcrm-mb-3 imcrm-mt-4" />
                                    {/* Subtarea de… (el registro es una subtarea). */}
                                    {record.parent_id && listSlug !== undefined && (
                                        <RecordSubtasks
                                            listId={listId}
                                            listSlug={listSlug}
                                            record={record}
                                            fields={fields}
                                            onOpenRecord={openOther}
                                            className="imcrm-mb-4"
                                        />
                                    )}

                                    {/* Descripción rica (v0.1.133) — el cuerpo tipo
                                        documento de la ficha, arriba de los campos
                                        (mismo lugar que en ClickUp). */}
                                    {view.ready ? (
                                        <RecordDescription
                                            listKey={listSlug ?? listId}
                                            recordId={record.id}
                                            editable={canEditRecords}
                                            className="imcrm-mb-5"
                                        />
                                    ) : (
                                        skeleton('imcrm-mb-5 imcrm-h-16')
                                    )}

                                    {/* Sección "Campos" colapsable con icono del tipo por fila. */}
                                    <button
                                        type="button"
                                        onClick={() => setFieldsOpen((v) => !v)}
                                        aria-expanded={fieldsOpen}
                                        className="imcrm-mb-2 imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-py-1 imcrm-pr-2 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground hover:imcrm-text-foreground imcrm-transition-colors"
                                    >
                                        {fieldsOpen ? (
                                            <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                        ) : (
                                            <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                        )}
                                        {__('Campos')}
                                        <span className="imcrm-font-normal imcrm-normal-case imcrm-text-muted-foreground/70">
                                            {fields.length - (titleField ? 1 : 0)}
                                        </span>
                                    </button>
                                    {fieldsOpen && (
                                        <RecordFieldsForm
                                            listId={listId}
                                            recordId={record.id}
                                            fields={fields}
                                            values={values}
                                            onChange={setValues}
                                            fieldErrors={fieldErrors}
                                            density="compact"
                                            showTypeIcon
                                            lockedReasons={lockedReasons}
                                            hiddenSlugs={titleField ? [titleField.slug] : undefined}
                                            history={{
                                                canRestore: canEditRecords,
                                                // Lo restaurado ya está guardado: el borrador no lo cuenta como cambio.
                                                onRestored: (slug, v, saved) => draft.markSaved({ [slug]: v }, saved),
                                            }}
                                        />
                                    )}

                                    {/* Subtareas (registro de primer nivel). */}
                                    {!record.parent_id && listSlug !== undefined && view.ready && (
                                        <RecordSubtasks
                                            listId={listId}
                                            listSlug={listSlug}
                                            record={record}
                                            fields={fields}
                                            onOpenRecord={openOther}
                                            className="imcrm-mt-5"
                                        />
                                    )}

                                    {/* Acceso al portal del cliente (magic link) —
                                        también en el layout SIN plantilla CRM. El
                                        botón se auto-oculta si la lista no tiene
                                        portal habilitado. */}
                                    {listData.data !== undefined && (
                                        <div className="imcrm-mt-4">
                                            <PortalAccessButton list={listData.data} record={record} />
                                        </div>
                                    )}
                                    {/* v0.1.251 — cobros (Mercado Pago / Wompi). Se oculta solo
                                        si la empresa no conectó ninguno. */}
                                    {listData.data !== undefined && view.ready && (
                                        <div className="imcrm-mt-4">
                                            <RecordPaymentsPanel listId={listData.data.id} recordId={record.id} />
                                        </div>
                                    )}

                                    {view.ready && <RecordBacklinks listId={listId} recordId={record.id} />}

                                    {error !== null && (
                                        <div className="imcrm-mt-4 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                            {error}
                                        </div>
                                    )}
                                </div>

                                <SheetFooter>
                                    {storeRules ? (
                                        // Los registros de una tienda se borran en WooCommerce.
                                        <span className="imcrm-mr-auto" />
                                    ) : (
                                        <Button
                                            variant="ghost"
                                            className="imcrm-mr-auto imcrm-gap-2 imcrm-text-destructive hover:imcrm-text-destructive"
                                            onClick={() => void handleDelete()}
                                            disabled={remove.isPending}
                                            aria-label={__('Eliminar')}
                                            title={__('Eliminar')}
                                        >
                                            <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                            <span className="imcrm-hidden sm:imcrm-inline">{__('Eliminar')}</span>
                                        </Button>
                                    )}
                                    <Button variant="outline" onClick={() => void requestClose()}>
                                        {__('Cancelar')}
                                    </Button>
                                    <Button onClick={() => void handleSave()} disabled={!dirty || update.isPending} className="imcrm-gap-2">
                                        <Save className="imcrm-h-4 imcrm-w-4" />
                                        {update.isPending ? __('Guardando…') : (
                                            <>
                                                <span className="sm:imcrm-hidden">{__('Guardar')}</span>
                                                <span className="imcrm-hidden sm:imcrm-inline">{__('Guardar cambios')}</span>
                                            </>
                                        )}
                                    </Button>
                                </SheetFooter>
                            </div>

                            {narrow && mobileTab !== 'details' && (
                                <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-px-4 imcrm-py-3">
                                    {!view.ready ? (
                                        skeleton('imcrm-h-24')
                                    ) : mobileTab === 'comments' ? (
                                        <CommentsPanel
                                            listId={listId}
                                            recordId={record.id}
                                            currentUserId={boot.user.id}
                                            isAdmin={boot.user.capabilities.workspace_admin === true}
                                        />
                                    ) : (
                                        <div className="imcrm-h-full imcrm-overflow-y-auto imcrm-pr-1">
                                            <ActivityPanel listId={listId} recordId={record.id} />
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Botón flotante para re-expandir el aside colapsado. */}
                            {!narrow && !asideOpen && (
                                <button
                                    type="button"
                                    onClick={toggleAside}
                                    aria-expanded={false}
                                    aria-label={__('Ampliar')}
                                    title={__('Ampliar')}
                                    className="imcrm-absolute imcrm-right-2 imcrm-top-2 imcrm-z-10 imcrm-inline-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground imcrm-transition-colors"
                                >
                                    <ChevronsLeft className="imcrm-h-4 imcrm-w-4" aria-hidden />
                                </button>
                            )}

                            {/* ——— Aside derecho colapsable: Comentarios / Actividad ——— */}
                            {!narrow && (
                            <aside
                                aria-hidden={!asideOpen}
                                className={cn(
                                    'imcrm-flex imcrm-min-h-0 imcrm-flex-col imcrm-overflow-hidden imcrm-border-border',
                                    'imcrm-transition-all imcrm-duration-200',
                                    asideOpen
                                        ? 'imcrm-h-[40%] imcrm-shrink-0 imcrm-border-t lg:imcrm-h-auto lg:imcrm-w-[380px] lg:imcrm-border-l lg:imcrm-border-t-0'
                                        : 'imcrm-pointer-events-none imcrm-h-0 imcrm-shrink-0 lg:imcrm-h-auto lg:imcrm-w-0',
                                )}
                            >
                                {/* Ancho interno fijo en lg: el contenido no se aplasta
                                 * mientras el width del aside anima. */}
                                <div className="imcrm-flex imcrm-h-full imcrm-min-h-0 imcrm-flex-col lg:imcrm-w-[380px]">
                                    <div className="imcrm-flex imcrm-h-9 imcrm-shrink-0 imcrm-items-center imcrm-gap-1.5 imcrm-border-b imcrm-border-border imcrm-px-2">
                                        <button
                                            type="button"
                                            onClick={toggleAside}
                                            aria-expanded
                                            aria-label={__('Contraer')}
                                            title={__('Contraer')}
                                            className="imcrm-inline-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground imcrm-transition-colors"
                                        >
                                            <ChevronsRight className="imcrm-h-4 imcrm-w-4" aria-hidden />
                                        </button>
                                        <span className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                            {__('Actividad')}
                                        </span>
                                    </div>

                                    <div
                                        role="tablist"
                                        aria-label={__('Vista del registro')}
                                        className="imcrm-flex imcrm-shrink-0 imcrm-gap-1 imcrm-border-b imcrm-border-border imcrm-px-4"
                                    >
                                        <TabButton active={tab === 'comments'} onClick={() => setTab('comments')}>
                                            <MessageSquare className="imcrm-h-3.5 imcrm-w-3.5" />
                                            {__('Comentarios')}
                                        </TabButton>
                                        <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>
                                            <Activity className="imcrm-h-3.5 imcrm-w-3.5" />
                                            {__('Actividad')}
                                        </TabButton>
                                    </div>

                                    <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-px-4 imcrm-py-3">
                                        {!view.ready ? (
                                            skeleton('imcrm-h-24')
                                        ) : tab === 'comments' ? (
                                            // CommentsPanel es h-full flex-col: lista con
                                            // scroll propio + composer abajo.
                                            <CommentsPanel
                                                listId={listId}
                                                recordId={record.id}
                                                currentUserId={boot.user.id}
                                                isAdmin={boot.user.capabilities.workspace_admin === true}
                                            />
                                        ) : (
                                            <div className="imcrm-h-full imcrm-overflow-y-auto imcrm-pr-1">
                                                <ActivityPanel listId={listId} recordId={record.id} />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </aside>
                            )}
                        </div>
                    </DialogPrimitive.Content>
                </div>
            </DialogPrimitive.Portal>
        </Sheet>
    );
}

interface TabButtonProps {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps): JSX.Element {
    return (
        <button
            type="button"
            role="tab"
            aria-selected={active}
            onClick={onClick}
            className={cn(
                'imcrm--mb-px imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-border-b-2 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-font-medium imcrm-transition-colors',
                active
                    ? 'imcrm-border-primary imcrm-text-foreground'
                    : 'imcrm-border-transparent imcrm-text-muted-foreground hover:imcrm-text-foreground',
            )}
        >
            {children}
        </button>
    );
}
