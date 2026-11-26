import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { AutoLayoutFlavor } from '@imagina-base/shared';
import {
    Activity,
    Check,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    ChevronsLeft,
    ChevronsRight,
    ExternalLink,
    FileText,
    Loader2,
    MessageSquare,
    Paintbrush,
    Save,
    Trash2,
    X,
} from 'lucide-react';

import { ActivityPanel } from '@/admin/activity/ActivityPanel';
import { CommentsPanel } from '@/admin/comments/CommentsPanel';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import {
    Sheet,
    SheetDescription,
    SheetFooter,
    SheetTitle,
} from '@/components/ui/sheet';
import { markLocalRecordsChange, useDeleteRecord, useUpdateRecord } from '@/hooks/useRecords';
import { useTrashedToast } from '@/hooks/useTrash';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { notificationKeys } from '@/hooks/useNotifications';
import { forgetRecord, useRecordView } from '@/hooks/useRecordView';
import { ApiError } from '@/lib/api';
import { getBootData } from '@/lib/boot';
import { escapeIntent, FLOATING_MENU_ATTR, isInsideFloatingUi, leaveField, recordNavDirection } from '@/lib/escapeGuard';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCanAny } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { whenIdle } from '@/lib/whenIdle';
import type { FieldEntity } from '@/types/field';
import { useList, useUpdateList } from '@/hooks/useLists';
import { useDismissLayoutHint, useLayoutHints } from '@/hooks/useLayoutHints';
import { useSession } from '@/cloud/session';
import type { ListSummary } from '@/types/list';
import type { RecordEntity } from '@/types/record';

import { PortalAccessButton } from './crm/PortalAccessButton';
import { RecordFollowControls } from '@/admin/mywork/RecordFollowControls';
import { useIsGuest } from '@/lib/guest';
import { useGuestAccess } from '@/hooks/useGuests';
import { IssuedDocumentsSection } from '@/admin/documents/IssuedDocuments';
import { RecordPaymentsPanel } from '@/cloud/components/payments/RecordPaymentsPanel';
import { RecordSignaturesPanel } from '@/admin/signatures/RecordSignaturesPanel';
import { RecordSubscriptionPanel } from '@/cloud/components/subscriptions/RecordSubscriptionPanel';
import { RecordDataConsentLine } from '@/cloud/components/RecordDataConsentLine';
import { RecordBacklinks } from './RecordBacklinks';
import { RecordDescription, useDescriptionDraft } from './description/RecordDescription';
import { RecordFieldsForm } from './RecordFieldsForm';
import { RecordSubtasks } from './RecordSubtasks';
import { isCloseCancelled } from './dependencies/closeGuard';
import { RecordDependencies } from './dependencies/RecordDependencies';
import { RecordApprovals } from '@/admin/approvals/RecordApprovals';
import { RecordBookingPanel } from '@/admin/booking/RecordBookingPanel';
import { RecordShopOrderPanel } from '@/admin/shop/RecordShopOrderPanel';
import { RecordAgentProposals } from '@/admin/agents/AgentProposals';
import { RecordAgentRuns, RecordAiSummaryCard } from './ai/RecordAi';
import { RecordChecklists } from './checklists/RecordChecklists';
import { RecordAction, RecordActionGroup, RecordActionsMenu } from './actions/RecordAction';
import { RecordActionItems } from './actions/RecordActionItems';
import { Tip } from '@/components/ui/tooltip';
import { TimeTrackingPanel } from './time/TimeTrackingPanel';
import { RecordTitleInput } from './RecordTitleInput';
import { lockedReasonsFor, mirrorSourceOf, recordGoneInSource, useStoreRules } from './storeRules';
import { titleFieldOf } from '@/lib/recordTitle';
import { RecordDuplicateBanner } from './duplicates/DuplicateHints';
import { RecordMetaGrid } from './RecordMetaGrid';
import { parseUtcDate } from '@/lib/utcDate';
import { useRecordDraft } from './recordDraft';

import { formatLongDate } from '@/lib/tenantFormat';
import { managedLockedReasons, useManagedFields } from '@/admin/records/managedFields';
import { readonlyLockedReasons, useReadonlyFieldIds } from '@/admin/records/fieldAccess';
import {
    designRecordHref,
    recordSidePanel,
    shouldOfferDesignedLayout,
    usesDesignedLayout,
} from './layout/recordModalMode';
import { loadDesignedBody, warmDescriptionEditor, warmDesignedRecord } from './layout/warmRecordChunks';

// v0.1.470 — La ficha diseñada y la invitación a probarla van en sus propios
// chunks: la tabla no paga el motor de la ficha hasta que se abre un registro
// de una lista que la usa.
const DrawerDesignedBody = lazy(loadDesignedBody);
const LayoutSuggestion = lazy(() => import('./layout/LayoutSuggestion'));

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
    /**
     * v0.1.470 — La lista (con sus ajustes): con `record_layout: 'crm'` la
     * ventana muestra la ficha diseñada. Sin ella, se pide.
     */
    list?: ListSummary;
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
    list,
}: RecordDetailDrawerProps): JSX.Element {
    const update = useUpdateRecord(listId);
    const canEditByCaps = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS);
    const remove = useDeleteRecord(listId);
    // C3 — un invitado no sigue, no genera PDF, no comparte, no borra y
    // edita sólo con «Puede editar» (la lista entera o este registro).
    const isGuest = useIsGuest();
    const guestAccess = useGuestAccess(listId, record?.id);
    const canEditRecords = canEditByCaps && (!isGuest || guestAccess.record === 'edit');
    const confirm = useConfirm();
    const toast = useToast();
    const trashed = useTrashedToast();
    const navigate = useNavigate();
    const location = useLocation();
    const qc = useQueryClient();
    // v0.1.213 — lista de una tienda: qué campos se editan en WooCommerce.
    const storeRules = useStoreRules();
    const goneInSource = recordGoneInSource(storeRules, record);

    const draft = useRecordDraft(record);
    const { values, setValues } = draft;
    // v0.1.420 — La descripción se guarda con «Guardar cambios», como los campos.
    const descDraft = useDescriptionDraft(listSlug ?? listId, record?.id ?? null);
    const dirty = draft.dirty || descDraft.dirty;
    // Atrás del navegador (que cierra el modal: `?record=`), un enlace de la
    // app o cerrar la pestaña con cambios sin guardar → pregunta antes.
    useUnsavedChangesGuard(open && dirty);
    const view = useRecordView(listId, record?.id, open && record !== null);
    const managedLocks = useManagedFields();
    // v0.1.457 (C4) — lo que quien mira ve pero no puede cambiar.
    const readonlyIds = useReadonlyFieldIds();
    const lockedReasons = useMemo(
        () => ({
            ...lockedReasonsFor(storeRules, fields, values),
            ...readonlyLockedReasons(readonlyIds, fields),
            ...managedLockedReasons(managedLocks, fields),
        }),
        [storeRules, fields, values, managedLocks, readonlyIds],
    );
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
    const listData = useList(view.ready && list === undefined ? listId : undefined);
    const listInfo = list ?? listData.data;
    const listSettings = listInfo?.settings as Record<string, unknown> | undefined;

    // ——— v0.1.470: la ficha diseñada en la ventana ———
    // «Probar»: la ficha diseñada con una plantilla integrada, SIN guardarla.
    const [preview, setPreview] = useState<AutoLayoutFlavor | null>(null);
    const designed = preview !== null || usesDesignedLayout(listSettings);
    const designedRef = useRef(designed);
    designedRef.current = designed;
    // v0.1.472 — el código de la ficha se baja antes: la diseñada cuando la
    // tabla queda quieta, y al abrir, a la par del pedido de los datos.
    useEffect(() => {
        if (!designed || open) return;
        return whenIdle(warmDesignedRecord, { delay: 1500, timeout: 4000 });
    }, [designed, open]);
    useEffect(() => {
        if (!open) return;
        if (designed) warmDesignedRecord();
        warmDescriptionEditor();
    }, [open, designed]);
    // La ficha diseñada se guarda sola: la barra dice «Guardando…/Guardado».
    const [designedSaving, setDesignedSaving] = useState(false);
    const flushRef = useRef<(() => Promise<void>) | null>(null);
    // ¿El diseño ya trae la conversación? (sin panel al costado). `null` = carga.
    const [hasConversation, setHasConversation] = useState<boolean | null>(null);
    const onConversationInLayout = useCallback((has: boolean) => setHasConversation(has), []);
    const side = recordSidePanel({ designed, hasConversation, narrow });
    // Con muchas acciones y poco ancho, van en un «…»: la ficha diseñada suma
    // botones a la barra (guardado, diseñar, eliminar) y los agrupa antes; la
    // simple, sólo en el teléfono (donde ya no entraban).
    const phoneBar = useMediaQuery('(max-width: 639px)');
    const canManageLists = useCanAny(CAP.MANAGE_LISTS);
    const impersonating = useSession((s) => s.impersonating !== undefined && s.impersonating !== null);
    const mayOffer = open && !designed && canManageLists && !isGuest && !impersonating && !storeRules;
    const hints = useLayoutHints(mayOffer);
    const dismissHint = useDismissLayoutHint();
    const updateList = useUpdateList(listId);
    const offerDesigned =
        listInfo !== undefined &&
        shouldOfferDesignedLayout({
            listId,
            settings: listSettings,
            canManageLists,
            isGuest,
            impersonating,
            mirror: !!storeRules,
            dismissed: hints.data?.dismissed_lists ?? null,
        });
    // Al cerrar, la vista previa se descarta.
    useEffect(() => {
        if (!open) setPreview(null);
    }, [open]);
    // Otra plantilla en la vista previa: hasta saber si trae la conversación, sin panel.
    useEffect(() => {
        setHasConversation(null);
    }, [preview]);
    // Sin pestañas (la ficha ya trae la conversación), se vuelve a la ficha.
    useEffect(() => {
        if (side !== 'tabs' && mobileTab !== 'details') setMobileTab('details');
    }, [side, mobileTab]);
    // «Usar este diseño»: la vista previa se queda hasta que la lista ya lo dice.
    const adoptingRef = useRef(false);
    useEffect(() => {
        if (adoptingRef.current && usesDesignedLayout(listSettings)) {
            adoptingRef.current = false;
            setPreview(null);
        }
    }, [listSettings]);

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
        if (ok)
            flushSync(() => {
                draft.reset();
                descDraft.discard();
            });
        return ok;
    };
    /**
     * Antes de salir del registro: la ficha diseñada descarga lo pendiente de
     * su autoguardado; la simple pregunta si hay cambios sin guardar.
     */
    const prepareLeave = async (): Promise<boolean> => {
        if (designedRef.current) {
            await flushRef.current?.();
            return true;
        }
        return confirmDiscard();
    };
    const requestClose = async (): Promise<void> => {
        if (await prepareLeave()) onOpenChange(false);
    };
    const navRef = useRef<{ go: (dir: -1 | 1) => void }>({ go: () => undefined });
    navRef.current.go = (dir) => {
        if (!onNavigate || (dir === -1 ? !canPrev : !canNext)) return;
        void prepareLeave().then((ok) => ok && onNavigate(dir));
    };
    const [moreOpen, setMoreOpen] = useState(false);
    useEffect(() => {
        setMoreOpen(false);
    }, [record?.id, open]);

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
        const hasFields = Object.keys(patch).length > 0;
        if (!hasFields && !descDraft.dirty) return;

        try {
            // La descripción (v0.1.420) y los campos, a la vez.
            const [saved] = await Promise.all([
                hasFields ? update.mutateAsync({ id: record.id, values: patch }) : Promise.resolve(null),
                descDraft.commit(),
            ]);
            if (hasFields) flushSync(() => draft.markSaved(patch, saved ?? null));
            // Asignarse un registro te suscribe a él (ADR-S40).
            if (hasFields) void qc.invalidateQueries({ queryKey: notificationKeys.follow(record.id) });
            onOpenChange(false);
        } catch (err) {
            // A8 — canceló el cierre de algo bloqueado: el borrador queda como estaba.
            if (isCloseCancelled(err)) return;
            if (err instanceof ApiError) {
                setError(err.message);
                setFieldErrors(err.errors);
            } else if (err instanceof Error) {
                setError(err.message);
            }
        }
    };

    const handleDelete = async (): Promise<void> => {
        const ok = await confirm(
            goneInSource
                ? {
                      title: sprintf(__('¿Quitar «%s» de la app?'), title),
                      description: sprintf(
                          __('Ya se borró en %s. Va a la papelera de la app (puedes recuperarlo durante 30 días) y deja de contar para tu plan. Si vuelve a aparecer allá, vuelve solo.'),
                          mirrorSourceOf(storeRules) ?? '',
                      ),
                      destructive: true,
                      confirmLabel: __('Quitar de la app'),
                  }
                : {
                      title: sprintf(
                          /* translators: %s: record title */
                          __('¿Eliminar «%s»?'),
                          title,
                      ),
                      description: record.subtask_count > 0
                          ? __('Va a la papelera junto con sus subtareas: puedes recuperarlo durante 30 días.')
                          : __('Va a la papelera: puedes recuperarlo durante 30 días.'),
                      destructive: true,
                      confirmLabel: __('Eliminar'),
                  },
        );
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
            trashed({ type: 'record', id, name: title });
        } catch (err) {
            toast.error(__('No se pudo eliminar el registro'), err instanceof Error ? err.message : undefined);
        }
    };

    const openFullPage = async (): Promise<void> => {
        if (listSlug === undefined) return;
        if (!(await prepareLeave())) return;
        // Reemplaza la entrada del modal (`?record=`): atrás vuelve a la lista.
        navigate(`/lists/${listSlug}/records/${record.id}`, { replace: true });
    };

    const openOther = onOpenRecord
        ? (id: number): void => {
              void prepareLeave().then((ok) => ok && onOpenRecord(id));
          }
        : undefined;

    // «Diseñar esta ficha»: el editor con ESTE registro de muestra; al salir vuelve aquí.
    const canDesign = canManageLists && !isGuest && preview === null && listSlug !== undefined;
    const openDesigner = async (): Promise<void> => {
        if (listSlug === undefined) return;
        if (!(await prepareLeave())) return;
        navigate(designRecordHref(listSlug, record.id, `${location.pathname}${location.search}`));
    };

    // «Probar» / «Usar este diseño» / «Ahora no».
    const tryDesigned = async (template: AutoLayoutFlavor): Promise<void> => {
        if (!(await confirmDiscard())) return;
        setPreview(template);
    };
    const adoptDesign = async (template: AutoLayoutFlavor): Promise<void> => {
        try {
            adoptingRef.current = true;
            await updateList.mutateAsync({ settings: { record_layout: 'crm', crm_template_id: template } });
            toast.success(__('Listo: la lista ya muestra sus registros como ficha'), __('Lo puedes cambiar cuando quieras en Configuración de la lista → Apariencia.'));
        } catch (err) {
            adoptingRef.current = false;
            toast.error(__('No se pudo guardar el diseño'), err instanceof Error ? err.message : undefined);
        }
    };
    const dismissSuggestion = (): void => {
        setPreview(null);
        dismissHint.mutate(listId);
    };
    const canDeleteHere = !((storeRules && !goneInSource) || isGuest);

    // v0.1.471 — Las acciones del registro: «Seguir» y «Recordarme» quedan a la
    // vista (dicen el estado); el resto va en el menú «Acciones», cada una con su
    // nombre y para qué sirve. En el teléfono, todo va en el menú.
    const deleteLabel = goneInSource ? __('Quitar de la app') : __('Eliminar');
    const deleteHint = goneInSource
        ? __('Ya se borró en el sitio o la tienda: lo quita sólo de aquí')
        : __('Va a la papelera: lo recuperas durante 30 días');
    const designHint = __('Elige qué se ve y cómo, para todos los registros de esta lista');
    const actionsBar = (
        <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-0.5" data-tour="record-toolbar">
            {!phoneBar && !isGuest && <RecordFollowControls listId={listId} recordId={record.id} compact />}
            <RecordActionsMenu
                open={moreOpen}
                onOpenChange={setMoreOpen}
                scopeRef={contentRef}
                showLabel={!phoneBar}
                deferKey={isGuest ? undefined : record.id}
            >
                <RecordActionItems
                    listId={listId}
                    listSlug={listSlug}
                    recordId={record.id}
                    fields={fields}
                    listSettings={listSettings}
                    title={title}
                    isGuest={isGuest}
                    storeRules={Boolean(storeRules)}
                    includeFollow={phoneBar}
                    extra={
                        phoneBar && designed && (canDesign || canDeleteHere) ? (
                            <RecordActionGroup title={__('Esta ficha')}>
                                {canDesign && (
                                    <RecordAction
                                        icon={<Paintbrush className="imcrm-h-4 imcrm-w-4" />}
                                        label={__('Diseñar esta ficha')}
                                        hint={designHint}
                                        onClick={() => void openDesigner()}
                                        data-testid="imcrm-record-design"
                                    />
                                )}
                                {canDeleteHere && (
                                    <RecordAction
                                        icon={<Trash2 className="imcrm-h-4 imcrm-w-4" />}
                                        label={deleteLabel}
                                        hint={deleteHint}
                                        tone="danger"
                                        onClick={() => void handleDelete()}
                                        disabled={remove.isPending}
                                        data-testid="imcrm-record-delete"
                                    />
                                )}
                            </RecordActionGroup>
                        ) : undefined
                    }
                />
            </RecordActionsMenu>
        </div>
    );

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
                            if (intent === 'menu' && moreOpen) setMoreOpen(false);
                            else if (intent === 'field') leaveField(active);
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
                                    <RecordAction
                                        icon={<ChevronUp className="imcrm-h-4 imcrm-w-4" />}
                                        label={__('Registro anterior')}
                                        hint={__('El de arriba en la lista')}
                                        shortcut={__('K o ↑')}
                                        disabled={!canPrev}
                                        onClick={() => navRef.current.go(-1)}
                                        data-testid="imcrm-record-prev"
                                    />
                                    <RecordAction
                                        icon={<ChevronDown className="imcrm-h-4 imcrm-w-4" />}
                                        label={__('Registro siguiente')}
                                        hint={__('El de abajo en la lista')}
                                        shortcut={__('J o ↓')}
                                        disabled={!canNext}
                                        onClick={() => navRef.current.go(1)}
                                        data-testid="imcrm-record-next"
                                    />
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
                            {designed && <AutosaveStatus saving={designedSaving} />}
                            {view.ready && actionsBar}
                            {designed && canDesign && !phoneBar && (
                                <Tip label={__('Diseñar esta ficha')} hint={designHint}>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="imcrm-h-8 imcrm-shrink-0 imcrm-gap-1.5 imcrm-px-2"
                                        onClick={() => void openDesigner()}
                                        aria-label={__('Diseñar esta ficha')}
                                        data-tour="record-modal-design"
                                        data-testid="imcrm-record-design"
                                    >
                                        <Paintbrush className="imcrm-h-4 imcrm-w-4" />
                                        <span className="imcrm-hidden lg:imcrm-inline">{__('Diseñar esta ficha')}</span>
                                    </Button>
                                </Tip>
                            )}
                            {designed && canDeleteHere && !phoneBar && (
                                <RecordAction
                                    icon={<Trash2 className="imcrm-h-4 imcrm-w-4" />}
                                    label={deleteLabel}
                                    hint={deleteHint}
                                    tone="danger"
                                    onClick={() => void handleDelete()}
                                    disabled={remove.isPending}
                                    data-testid="imcrm-record-delete"
                                />
                            )}
                            {listSlug !== undefined && (
                                <RecordAction
                                    icon={<ExternalLink className="imcrm-h-4 imcrm-w-4" />}
                                    label={__('Abrir página completa')}
                                    hint={__('El registro en su propia página, con una dirección para compartir')}
                                    onClick={() => void openFullPage()}
                                    data-testid="imcrm-record-open-page"
                                />
                            )}
                            <Tip label={__('Cerrar')} shortcut="Esc">
                                <DialogPrimitive.Close
                                    className="imcrm-inline-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                                    aria-label={__('Cerrar')}
                                >
                                    <X className="imcrm-h-4 imcrm-w-4" />
                                </DialogPrimitive.Close>
                            </Tip>
                        </div>

                        {side === 'tabs' && (
                            <div
                                role="tablist"
                                aria-label={__('Vista del registro')}
                                className="imcrm-flex imcrm-shrink-0 imcrm-gap-1 imcrm-border-b imcrm-border-border imcrm-px-3"
                                data-testid="imcrm-record-mobile-tabs"
                                data-tour="record-side"
                            >
                                <TabButton active={mobileTab === 'details'} onClick={() => setMobileTab('details')}>
                                    <FileText className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {designed ? __('Ficha') : __('Detalles')}
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
                                    side === 'tabs' && mobileTab !== 'details' && 'imcrm-hidden',
                                )}
                            >
                                {designed ? (
                                    <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto imcrm-px-4 imcrm-py-4 sm:imcrm-px-6 sm:imcrm-py-5" data-testid="imcrm-record-designed">
                                        <SheetTitle className="imcrm-sr-only">{title}</SheetTitle>
                                        {preview !== null && (
                                            <Suspense fallback={null}>
                                                <LayoutSuggestion
                                                    mode="banner"
                                                    list={listInfo ?? { name: listName ?? '' }}
                                                    fields={fields}
                                                    preview={preview}
                                                    busy={updateList.isPending || adoptingRef.current}
                                                    onTry={setPreview}
                                                    onUse={(t) => void adoptDesign(t)}
                                                    onChangeTemplate={setPreview}
                                                    onDismiss={dismissSuggestion}
                                                />
                                            </Suspense>
                                        )}
                                        {view.ready && listInfo !== undefined ? (
                                            <Suspense fallback={skeleton('imcrm-h-64')}>
                                                <DrawerDesignedBody
                                                    list={listInfo}
                                                    record={record}
                                                    fields={fields}
                                                    previewTemplate={preview ?? undefined}
                                                    onSavingChange={setDesignedSaving}
                                                    flushRef={flushRef}
                                                    onConversationInLayout={onConversationInLayout}
                                                    onOpenRecord={openOther}
                                                    onDelete={() => void handleDelete()}
                                                    deleting={remove.isPending}
                                                />
                                            </Suspense>
                                        ) : (
                                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                                                {skeleton('imcrm-h-24')}
                                                {skeleton('imcrm-h-40')}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                <>
                                <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto imcrm-px-4 imcrm-py-4 sm:imcrm-px-8 sm:imcrm-py-5">
                                    {/* v0.1.470 — «Esta lista se puede ver como ficha · Probar». */}
                                    {view.ready && offerDesigned && (
                                        <Suspense fallback={null}>
                                            <LayoutSuggestion
                                                mode="card"
                                                list={listInfo!}
                                                fields={fields}
                                                preview={null}
                                                busy={false}
                                                onTry={(t) => void tryDesigned(t)}
                                                onUse={(t) => void adoptDesign(t)}
                                                onChangeTemplate={setPreview}
                                                onDismiss={dismissSuggestion}
                                            />
                                        </Suspense>
                                    )}
                                    {/* Chip de tipo de entidad (como el chip "Tarea" de ClickUp). */}
                                    <span className="imcrm-inline-flex imcrm-w-fit imcrm-items-center imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                                        {record.parent_id ? __('Subtarea') : __('Registro')}
                                    </span>

                                    {/* El título ES el campo primario (v0.1.136):
                                        se edita aquí (y no se repite como fila en
                                        "Campos"). */}
                                    <SheetTitle asChild>
                                        <div className="imcrm-mt-2" data-tour="record-title">
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
                                    {/* A14 — «Posible duplicado de X» (Fusionar / No es duplicado). */}
                                    {!isGuest && !storeRules && !record.parent_id && (
                                        <RecordDuplicateBanner
                                            listId={listId}
                                            listSlug={listSlug}
                                            recordId={record.id}
                                            fields={fields}
                                            onOpenRecord={openOther}
                                            className="imcrm-mb-3"
                                        />
                                    )}
                                    {/* Subtarea de… (el registro es una subtarea). */}
                                    {record.parent_id && listSlug !== undefined && !isGuest && (
                                        <RecordSubtasks
                                            listId={listId}
                                            listSlug={listSlug}
                                            record={record}
                                            fields={fields}
                                            onOpenRecord={openOther}
                                            className="imcrm-mb-4"
                                        />
                                    )}

                                    {/* C5 — aprobación: «Pendiente de tu aprobación», las
                                        solicitudes y «Pedir aprobación». Sin flujos, no ocupa lugar. */}
                                    {/* E6 — lo que propone un agente de IA (Aplicar / Descartar). */}
                                    {/* v0.1.456 — «Resumir con IA» y lo que se le pidió a un agente. */}
                                    {view.ready && !isGuest && <RecordAiSummaryCard listId={listId} recordId={record.id} className="imcrm-mb-4" />}
                                    {view.ready && !isGuest && <RecordAgentRuns listId={listId} recordId={record.id} className="imcrm-mb-4" />}
                                    {view.ready && !isGuest && <RecordAgentProposals listId={listId} recordId={record.id} className="imcrm-mb-5" />}
                                    {view.ready && !isGuest && <RecordApprovals listId={listId} recordId={record.id} className="imcrm-mb-5" />}
                                    {/* v0.1.353 — la cita de la agenda: aprobar o rechazar si está por confirmar. */}
                                    {view.ready && !isGuest && <RecordBookingPanel listId={listId} recordId={record.id} className="imcrm-mb-5" />}
                                    {/* v0.1.412 — un pedido de la tienda: cómo se pagó y «Marcar como pagado». */}
                                    {view.ready && !isGuest && <RecordShopOrderPanel listId={listId} recordId={record.id} className="imcrm-mb-5" />}

                                    {/* Descripción rica (v0.1.133) — el cuerpo tipo
                                        documento de la ficha, arriba de los campos
                                        (mismo lugar que en ClickUp). */}
                                    {view.ready ? (
                                        <div data-tour="record-description">
                                            <RecordDescription
                                                listKey={listSlug ?? listId}
                                                recordId={record.id}
                                                editable={canEditRecords}
                                                className="imcrm-mb-5"
                                                draft={descDraft}
                                            />
                                        </div>
                                    ) : (
                                        skeleton('imcrm-mb-5 imcrm-h-16')
                                    )}

                                    {/* Sección "Campos" colapsable con icono del tipo por fila. */}
                                    <button
                                        type="button"
                                        onClick={() => setFieldsOpen((v) => !v)}
                                        aria-expanded={fieldsOpen}
                                        data-tour="record-fields"
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
                                    {!record.parent_id && listSlug !== undefined && view.ready && !isGuest && (
                                        <RecordSubtasks
                                            listId={listId}
                                            listSlug={listSlug}
                                            record={record}
                                            fields={fields}
                                            onOpenRecord={openOther}
                                            className="imcrm-mt-5"
                                        />
                                    )}

                                    {/* A9 — checklists del registro (no para un invitado). */}
                                    {view.ready && !isGuest && (
                                        <RecordChecklists
                                            listId={listId}
                                            recordId={record.id}
                                            isSubtask={record.parent_id !== null}
                                            storeManaged={!!storeRules}
                                            onOpenRecord={openOther}
                                            className="imcrm-mt-5"
                                        />
                                    )}

                                    {/* A8 — dependencias («bloqueado por» / «bloquea»). */}
                                    {view.ready && !isGuest && (
                                        <RecordDependencies
                                            listId={listId}
                                            listSlug={listSlug}
                                            recordId={record.id}
                                            onOpenRecord={openOther}
                                            className="imcrm-mt-5"
                                        />
                                    )}

                                    {/* v0.1.291 — registro de tiempo (cronómetro + cargas a mano). */}
                                    {view.ready && !isGuest && (
                                        <div className="imcrm-mt-5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3">
                                            <TimeTrackingPanel listId={listId} listKey={listSlug ?? String(listId)} recordId={record.id} />
                                        </div>
                                    )}

                                    {/* Acceso al portal del cliente (magic link) —
                                        también en el layout SIN plantilla CRM. El
                                        botón se auto-oculta si la lista no tiene
                                        portal habilitado. */}
                                    {listData.data !== undefined && !isGuest && (
                                        <div className="imcrm-mt-4">
                                            <PortalAccessButton list={listData.data} record={record} />
                                        </div>
                                    )}
                                    {/* Ley 1581 — autorización de tratamiento de datos (formulario/portal). */}
                                    {listData.data !== undefined && view.ready && !isGuest && (
                                        <RecordDataConsentLine className="imcrm-mt-4" listId={listData.data.id} recordId={record.id} />
                                    )}
                                    {/* v0.1.251 — cobros (Mercado Pago / Wompi). Se oculta solo
                                        si la empresa no conectó ninguno. */}
                                    {listData.data !== undefined && view.ready && !isGuest && (
                                        <div className="imcrm-mt-4">
                                            <RecordPaymentsPanel listId={listData.data.id} recordId={record.id} />
                                            {/* v0.1.367 — suscripción de Mercado Pago (débito automático). */}
                                            <div className="imcrm-mt-3 empty:imcrm-hidden">
                                                <RecordSubscriptionPanel listId={listData.data.id} recordId={record.id} />
                                            </div>
                                            {/* D6 — firma electrónica de documentos. */}
                                            <div className="imcrm-mt-3 imcrm-flex imcrm-flex-col empty:imcrm-hidden">
                                                <RecordSignaturesPanel listId={listData.data.id} recordId={record.id} fields={fields} record={record} />
                                            </div>
                                        </div>
                                    )}

                                    {/* v0.1.290 — documentos emitidos (numerados): congelados, anulados. */}
                                    {listData.data !== undefined && view.ready && !isGuest && (
                                        <IssuedDocumentsSection className="imcrm-mt-4" listId={listData.data.id} listSlug={listData.data.slug} recordId={record.id} />
                                    )}

                                    {view.ready && !isGuest && <RecordBacklinks listId={listId} recordId={record.id} />}

                                    {error !== null && (
                                        <div className="imcrm-mt-4 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                            {error}
                                        </div>
                                    )}
                                </div>

                                <SheetFooter>
                                    {(storeRules && !goneInSource) || isGuest ? (
                                        // Los registros de una tienda (o un sitio) se borran allá
                                        // —lo que ya se borró allá sí se quita, v0.1.336—;
                                        // un invitado de afuera nunca borra.
                                        <span className="imcrm-mr-auto" />
                                    ) : (
                                        <Button
                                            variant="ghost"
                                            className="imcrm-mr-auto imcrm-gap-2 imcrm-text-destructive hover:imcrm-text-destructive"
                                            onClick={() => void handleDelete()}
                                            disabled={remove.isPending}
                                            aria-label={goneInSource ? __('Quitar de la app') : __('Eliminar')}
                                            title={goneInSource ? __('Quitar de la app') : __('Eliminar')}
                                            data-testid="imcrm-record-delete"
                                        >
                                            <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                            <span className="imcrm-hidden sm:imcrm-inline">{goneInSource ? __('Quitar de la app') : __('Eliminar')}</span>
                                        </Button>
                                    )}
                                    <Button variant="outline" onClick={() => void requestClose()}>
                                        {__('Cancelar')}
                                    </Button>
                                    <Button onClick={() => void handleSave()} disabled={!dirty || update.isPending || descDraft.saving} className="imcrm-gap-2" data-testid="imcrm-record-save">
                                        <Save className="imcrm-h-4 imcrm-w-4" />
                                        {update.isPending || descDraft.saving ? __('Guardando…') : (
                                            <>
                                                <span className="sm:imcrm-hidden">{__('Guardar')}</span>
                                                <span className="imcrm-hidden sm:imcrm-inline">{__('Guardar cambios')}</span>
                                            </>
                                        )}
                                    </Button>
                                </SheetFooter>
                                </>
                                )}
                            </div>

                            {side === 'tabs' && mobileTab !== 'details' && (
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
                            {side === 'aside' && !asideOpen && (
                                <Tip label={__('Mostrar comentarios y actividad')} side="left">
                                <button
                                    type="button"
                                    onClick={toggleAside}
                                    aria-expanded={false}
                                    aria-label={__('Mostrar comentarios y actividad')}
                                    data-tour="record-side"
                                    className="imcrm-absolute imcrm-right-2 imcrm-top-2 imcrm-z-10 imcrm-inline-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground imcrm-transition-colors"
                                >
                                    <ChevronsLeft className="imcrm-h-4 imcrm-w-4" aria-hidden />
                                </button>
                                </Tip>
                            )}

                            {/* ——— Aside derecho colapsable: Comentarios / Actividad ——— */}
                            {side === 'aside' && (
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
                                <div className="imcrm-flex imcrm-h-full imcrm-min-h-0 imcrm-flex-col lg:imcrm-w-[380px]" data-tour={asideOpen ? 'record-side' : undefined}>
                                    <div className="imcrm-flex imcrm-h-9 imcrm-shrink-0 imcrm-items-center imcrm-gap-1.5 imcrm-border-b imcrm-border-border imcrm-px-2">
                                        <Tip label={__('Ocultar comentarios y actividad')} hint={__('La ficha usa todo el ancho')}>
                                            <button
                                                type="button"
                                                onClick={toggleAside}
                                                aria-expanded
                                                aria-label={__('Ocultar comentarios y actividad')}
                                                className="imcrm-inline-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground imcrm-transition-colors"
                                            >
                                                <ChevronsRight className="imcrm-h-4 imcrm-w-4" aria-hidden />
                                            </button>
                                        </Tip>
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

/** v0.1.470 — la ficha diseñada se guarda sola: lo que dice la barra. */
function AutosaveStatus({ saving }: { saving: boolean }): JSX.Element {
    return (
        <span
            className="imcrm-inline-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground"
            data-testid="imcrm-record-autosave"
            data-state={saving ? 'saving' : 'saved'}
            aria-live="polite"
            title={saving ? __('Guardando…') : __('Guardado: los cambios se guardan solos')}
        >
            {saving ? (
                <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" aria-hidden />
            ) : (
                <Check className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
            )}
            <span className="imcrm-hidden sm:imcrm-inline">{saving ? __('Guardando…') : __('Guardado')}</span>
        </span>
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
