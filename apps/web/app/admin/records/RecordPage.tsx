import { useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
    Activity as ActivityIcon,
    ArrowLeft,
    ChevronDown,
    ChevronRight,
    Loader2,
    MessageSquare,
    Save,
    Trash2,
} from 'lucide-react';

import { ActivityPanel } from '@/admin/activity/ActivityPanel';
import { CommentsPanel } from '@/admin/comments/CommentsPanel';
import { RecordLayoutView } from '@/admin/records/layout/RecordLayoutView';
import { PortalAccessButton } from '@/admin/records/crm/PortalAccessButton';
import { RecordFollowControls } from '@/admin/mywork/RecordFollowControls';
import { GeneratePdfButton } from '@/admin/documents/GeneratePdfButton';
import { RecordShareButton } from '@/admin/guests/RecordShareButton';
import { useIsGuest } from '@/lib/guest';
import { useGuestAccess } from '@/hooks/useGuests';
import { IssuedDocumentsSection } from '@/admin/documents/IssuedDocuments';
import { RecordPaymentsPanel } from '@/cloud/components/payments/RecordPaymentsPanel';
import { SendWhatsappButton } from '@/cloud/components/whatsapp/SendWhatsappButton';
import { SendSmsButton } from '@/cloud/components/sms/SendSmsButton';
import { RecordDataConsentLine } from '@/cloud/components/RecordDataConsentLine';
import { RecordBacklinks } from '@/admin/records/RecordBacklinks';
import { RecordDescription } from '@/admin/records/description/RecordDescription';
import { RecordFieldsForm } from '@/admin/records/RecordFieldsForm';
import { RecordSubtasks } from '@/admin/records/RecordSubtasks';
import { isCloseCancelled } from '@/admin/records/dependencies/closeGuard';
import { RecordDependencies } from '@/admin/records/dependencies/RecordDependencies';
import { RecordApprovals } from '@/admin/approvals/RecordApprovals';
import { RecordAgentProposals } from '@/admin/agents/AgentProposals';
import { RecordChecklists } from '@/admin/records/checklists/RecordChecklists';
import { SaveRecordAsTemplateButton } from '@/admin/records/templates/SaveRecordAsTemplateButton';
import { TimeTrackingPanel } from '@/admin/records/time/TimeTrackingPanel';
import { readMirrorListMarker } from '@imagina-base/shared';
import { RecordTitleInput } from '@/admin/records/RecordTitleInput';
import { useRecordDraft } from '@/admin/records/recordDraft';
import { lockedReasonsFor, StoreRulesContext, type StoreRules } from '@/admin/records/storeRules';
import { titleFieldOf } from '@/lib/recordTitle';
import { RecordMetaGrid } from '@/admin/records/RecordMetaGrid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useFields } from '@/hooks/useFields';
import { useList } from '@/hooks/useLists';
import { notificationKeys } from '@/hooks/useNotifications';
import { markLocalRecordsChange, useDeleteRecord, useRecord, useUpdateRecord } from '@/hooks/useRecords';
import { recordTitleFor, useTrashedToast } from '@/hooks/useTrash';
import { forgetRecord, useRecordView } from '@/hooks/useRecordView';
import { ApiError } from '@/lib/api';
import { getBootData } from '@/lib/boot';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCanAny } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { HelpdeskManagedContext, helpdeskLockedReasons, useHelpdeskManagedIds } from '@/admin/helpdesk/managedFields';

/**
 * Vista "Card" — página completa de un record con:
 * - Header: breadcrumb + acciones; abajo, el título (campo primario) + id.
 * - Columna principal (2/3): RecordFieldsForm completo, editable.
 * - Aside (1/3): tabs Comentarios / Actividad.
 *
 * Es el "primo grande" del RecordDetailDrawer: misma data, misma
 * lógica de save/delete; cambia el layout.
 *
 * Todo lo que la página necesita llega en UN request (`useRecordView`): antes
 * la ficha diseñada era una cascada de 4-5 pasos (lista → campos + registro →
 * relaciones → campos del otro lado → datos de los bloques).
 *
 * URL: `/lists/:listSlug/records/:recordId` — bookmarkable y
 * compartible.
 */
export function RecordPage(): JSX.Element {
    const { listSlug, recordId } = useParams<{ listSlug: string; recordId: string }>();
    const navigate = useNavigate();
    const qc = useQueryClient();

    const id = Number(recordId);
    // Recién borrado: la página deja de pedir el registro AL INSTANTE (la
    // navegación a la lista es una transición y llega después del DELETE).
    const [deletedId, setDeletedId] = useState<number | null>(null);
    const liveId = deletedId === id ? undefined : id;
    const view = useRecordView(listSlug, liveId);
    // Hasta que el bundle sembró los caches, nada sale a pedir lo suyo.
    const list = useList(view.ready ? listSlug : undefined);
    const fields = useFields(view.ready ? list.data?.id : undefined);
    const record = useRecord(view.ready ? list.data?.id : undefined, liveId);
    const canEditByCaps = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS);
    // C3 — un invitado edita sólo con «Puede editar» (lista o registro).
    const guestAccess = useGuestAccess(list.data?.id, id);
    const canEditRecords = canEditByCaps && (!guestAccess.isGuest || guestAccess.record === 'edit');
    const update = useUpdateRecord(list.data?.id ?? 0);
    const remove = useDeleteRecord(list.data?.id ?? 0);
    // C3 — un invitado no sigue, no genera PDF ni comparte.
    const isGuest = useIsGuest();
    const confirm = useConfirm();
    const toast = useToast();
    const trashed = useTrashedToast();

    // Sólo lo que la persona tocó: un cambio de otra persona (o el
    // autoguardado de la descripción, que vuelve a pedir el registro) ya no
    // borra lo que se está escribiendo ni se revierte al guardar.
    const draft = useRecordDraft(record.data);
    const { values, setValues, dirty } = draft;
    // Salir con cambios sin guardar (enlace, Atrás, cerrar la pestaña) pregunta.
    useUnsavedChangesGuard(dirty);
    // v0.1.213 — lista de una tienda: sin borrar y con los campos de WooCommerce de lectura.
    // v0.1.333 — o de un sitio WordPress (mismas reglas).
    const storeMarker = readMirrorListMarker(list.data?.settings);
    const storeRules = useMemo<StoreRules | null>(
        () => (storeMarker && fields.data ? { marker: storeMarker, fields: fields.data } : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [JSON.stringify(storeMarker), fields.data],
    );
    // E5 — las columnas del SLA (si la lista es una mesa de ayuda) tampoco se editan a mano.
    const helpdeskManaged = useHelpdeskManagedIds(list.data?.settings);
    const lockedReasons = useMemo(
        () => ({ ...lockedReasonsFor(storeRules, fields.data ?? [], values), ...helpdeskLockedReasons(helpdeskManaged, fields.data ?? []) }),
        [storeRules, fields.data, values, helpdeskManaged],
    );
    const [error, setError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [tab, setTab] = useState<'comments' | 'activity'>('comments');
    const [fieldsOpen, setFieldsOpen] = useState(true);
    const boot = getBootData();

    // Declarado ANTES de los retornos tempranos: la ficha diseñada lo usa y,
    // declarado después, el botón «Eliminar» tiraba ReferenceError.
    const handleDelete = async (): Promise<void> => {
        if (!record.data || !list.data) return;
        const ok = await confirm({
            title: sprintf(
                /* translators: %d: record id */
                __('¿Eliminar el registro #%d?'),
                record.data.id,
            ),
            description: record.data.subtask_count > 0
                ? __('Va a la papelera junto con sus subtareas: puedes recuperarlo durante 30 días.')
                : __('Va a la papelera: puedes recuperarlo durante 30 días.'),
            destructive: true,
            confirmLabel: __('Eliminar'),
        });
        if (!ok) return;
        // Se sale ANTES de borrar: con la página montada, la invalidación de
        // la lista y el aviso del socket volvían a pedir el registro (404).
        const id = record.data.id;
        const listId = list.data.id;
        const deletedName = recordTitleFor(fields.data ?? [], record.data.fields);
        flushSync(() => {
            draft.reset();
            setDeletedId(id);
        });
        navigate(`/lists/${list.data.slug}/records`);
        markLocalRecordsChange(qc, listId);
        try {
            await remove.mutateAsync({ id, purge: false });
            forgetRecord(qc, listId, id);
            trashed({ type: 'record', id, name: deletedName });
        } catch (err) {
            toast.error(__('No se pudo eliminar el registro'), err instanceof Error ? err.message : undefined);
        }
    };

    if (deletedId === id) {
        return (
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-12 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                {__('Eliminando registro…')}
            </div>
        );
    }

    if (!view.ready || list.isLoading || fields.isLoading || record.isLoading) {
        return (
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-12 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                {__('Cargando registro…')}
            </div>
        );
    }

    if (!list.data) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-3">
                <Button asChild variant="ghost" size="sm" className="imcrm-gap-2">
                    <Link to="/lists">
                        <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                        {__('Listas')}
                    </Link>
                </Button>
                <p className="imcrm-text-sm imcrm-text-destructive">{__('Lista no encontrada.')}</p>
            </div>
        );
    }

    if (!record.data) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-3">
                <Button asChild variant="ghost" size="sm" className="imcrm-gap-2">
                    <Link to={`/lists/${list.data.slug}/records`}>
                        <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                        {list.data.name}
                    </Link>
                </Button>
                <p className="imcrm-text-sm imcrm-text-destructive">
                    {__('El registro no existe o fue eliminado.')}
                </p>
            </div>
        );
    }

    // Layout opt-in: cuando la lista tiene `settings.record_layout
    // === 'crm'`, la ficha DISEÑADA (plantillas v3, v0.1.230: cabecera,
    // pestañas, secciones, gráficos de los vinculados). Default 'classic'
    // = form lineal de toda la vida.
    const recordLayout = (list.data.settings as { record_layout?: string })?.record_layout;
    const useCrmLayout = recordLayout === 'crm';

    if (useCrmLayout && fields.data) {
        return (
            <StoreRulesContext.Provider value={storeRules}>
            <HelpdeskManagedContext.Provider value={helpdeskManaged}>
                <RecordLayoutView
                    key={record.data.id}
                    list={list.data}
                    record={record.data}
                    fields={fields.data}
                    currentUserId={boot.user.id}
                    isAdmin={boot.user.capabilities.workspace_admin === true}
                    onDelete={() => void handleDelete()}
                    deleting={remove.isPending}
                    actions={
                        <>
                            {/* Seguir / recordarme y el PDF, en la barra de la ficha. */}
                            {!isGuest && <RecordFollowControls listId={list.data.id} recordId={record.data.id} compact />}
                            {!isGuest && (
                                <GeneratePdfButton
                                    listId={list.data.id}
                                    listSlug={list.data.slug}
                                    recordId={record.data.id}
                                    fields={fields.data}
                                    compact
                                />
                            )}
                            {!isGuest && <SendWhatsappButton listId={list.data.id} recordId={record.data.id} compact />}
                            {!isGuest && <SendSmsButton listId={list.data.id} recordId={record.data.id} compact />}
                            {!storeRules && !isGuest && (
                                <SaveRecordAsTemplateButton
                                    listId={list.data.id}
                                    listSlug={list.data.slug}
                                    recordId={record.data.id}
                                    title={recordTitleFor(fields.data, record.data.fields) ?? ''}
                                    compact
                                />
                            )}
                            <RecordShareButton listId={list.data.id} recordId={record.data.id} compact />
                        </>
                    }
                />
            </HelpdeskManagedContext.Provider>
            </StoreRulesContext.Provider>
        );
    }

    const listInfo = list.data;
    const rec = record.data;
    const titleField = titleFieldOf(fields.data);
    const liveTitle = titleField ? values[titleField.slug] : undefined;
    const title =
        typeof liveTitle === 'string' && liveTitle.trim() !== ''
            ? liveTitle
            : sprintf(
                  /* translators: %d: record id */
                  __('Registro #%d'),
                  rec.id,
              );

    const handleSave = async (): Promise<void> => {
        setError(null);
        setFieldErrors({});

        const patch = draft.patch();
        if (Object.keys(patch).length === 0) return;

        try {
            const saved = await update.mutateAsync({ id: rec.id, values: patch });
            draft.markSaved(patch, saved ?? null);
            void qc.invalidateQueries({ queryKey: notificationKeys.follow(rec.id) });
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

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
            {/* Dos filas: navegación + acciones arriba y el título abajo, a todo
                el ancho. En una sola fila, a 1440px «Guardar cambios» se caía
                a un segundo renglón y el #id quedaba flotando. */}
            <header className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="imcrm-record-page-header">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                    <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="imcrm-gap-2 imcrm-text-muted-foreground"
                    >
                        <Link to={`/lists/${listInfo.slug}/records`}>
                            <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                            {listInfo.name}
                        </Link>
                    </Button>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-end imcrm-gap-1.5">
                        {!isGuest && <RecordFollowControls listId={listInfo.id} recordId={rec.id} compact />}
                        {!isGuest && (
                            <GeneratePdfButton listId={listInfo.id} listSlug={listInfo.slug} recordId={rec.id} fields={fields.data ?? []} compact />
                        )}
                        {!isGuest && <SendWhatsappButton listId={listInfo.id} recordId={rec.id} compact />}
                        {!isGuest && <SendSmsButton listId={listInfo.id} recordId={rec.id} compact />}
                        {!storeRules && !isGuest && (
                            <SaveRecordAsTemplateButton listId={listInfo.id} listSlug={listInfo.slug} recordId={rec.id} title={title} compact />
                        )}
                        <RecordShareButton listId={listInfo.id} recordId={rec.id} title={title} compact />
                        {!storeRules && !isGuest && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="imcrm-gap-2 imcrm-text-destructive hover:imcrm-text-destructive"
                                onClick={() => void handleDelete()}
                                disabled={remove.isPending}
                            >
                                <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                <span className="imcrm-hidden sm:imcrm-inline">{__('Eliminar')}</span>
                            </Button>
                        )}
                        {(!isGuest || canEditRecords) && (
                            <Button size="sm" onClick={() => void handleSave()} disabled={!dirty || update.isPending} className="imcrm-gap-2 imcrm-whitespace-nowrap">
                                <Save className="imcrm-h-4 imcrm-w-4" />
                                {update.isPending ? __('Guardando…') : __('Guardar cambios')}
                            </Button>
                        )}
                    </div>
                </div>
                {/* El título ES el campo primario y se edita aquí (v0.1.136). */}
                <div className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2">
                    <RecordTitleInput
                        field={titleField}
                        value={titleField ? values[titleField.slug] : undefined}
                        onChange={(next) =>
                            titleField && setValues((v) => ({ ...v, [titleField.slug]: next }))
                        }
                        fallback={title}
                        editable={canEditRecords && !(titleField && lockedReasons[titleField.slug])}
                        className="imcrm--ml-1.5 imcrm-min-w-0 imcrm-flex-1"
                    />
                    <Badge variant="outline" className="imcrm-shrink-0 imcrm-font-mono imcrm-text-xs">
                        #{rec.id}
                    </Badge>
                </div>
                {titleField && fieldErrors[titleField.slug] !== undefined && (
                    <p className="imcrm-text-xs imcrm-text-destructive">{fieldErrors[titleField.slug]}</p>
                )}
            </header>

            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-6 lg:imcrm-grid-cols-3">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-5 lg:imcrm-col-span-2">
                    {/* Cuándo se creó y cuándo cambió (lo que no es un campo). */}
                    <RecordMetaGrid record={rec} />
                    {rec.parent_id && !isGuest && (
                        <RecordSubtasks listId={listInfo.id} listSlug={listInfo.slug} record={rec} fields={fields.data ?? []} />
                    )}

                    {/* C5 — aprobación (sin flujos en la lista, no aparece; no para un invitado). */}
                    {/* E6 — lo que propone un agente de IA. */}
                    {!isGuest && <RecordAgentProposals listId={listInfo.id} recordId={rec.id} />}
                    {!isGuest && <RecordApprovals listId={listInfo.id} recordId={rec.id} />}

                    {/* Descripción rica (v0.1.133) — mismo componente que el
                        modal del registro. */}
                    <RecordDescription
                        listKey={listSlug ?? listInfo.id}
                        recordId={rec.id}
                        editable={canEditRecords}
                    />

                    {/* Sección "Campos" colapsable: una fila por campo custom
                     * (icono del tipo + label a la izquierda, editor inline a
                     * la derecha — CompactFieldRow, el mismo editor del drawer
                     * y del layout CRM). */}
                    <section className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                        <button
                            type="button"
                            onClick={() => setFieldsOpen((v) => !v)}
                            aria-expanded={fieldsOpen}
                            className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-self-start imcrm-rounded-md imcrm-py-1 imcrm-pr-2 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground hover:imcrm-text-foreground imcrm-transition-colors"
                        >
                            {fieldsOpen ? (
                                <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            ) : (
                                <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            )}
                            {__('Campos')}
                            {fields.data && (
                                <span className="imcrm-font-normal imcrm-normal-case imcrm-text-muted-foreground/70">
                                    {fields.data.length - (titleField ? 1 : 0)}
                                </span>
                            )}
                        </button>
                        {fieldsOpen && fields.data && (
                            <RecordFieldsForm
                                listId={listInfo.id}
                                recordId={id}
                                fields={fields.data}
                                values={values}
                                onChange={setValues}
                                fieldErrors={fieldErrors}
                                density="compact"
                                showTypeIcon
                                lockedReasons={lockedReasons}
                                hiddenSlugs={titleField ? [titleField.slug] : undefined}
                                history={{
                                    canRestore: canEditRecords,
                                    onRestored: (slug, v, saved) => draft.markSaved({ [slug]: v }, saved),
                                }}
                            />
                        )}

                        {/* C3 — a un invitado no se le muestra la operación interna
                            del registro (subtareas, dependencias, tiempo,
                            portal, cobros, documentos, vínculos). */}
                        {!isGuest && (
                            <>
                                {!rec.parent_id && (
                                    <RecordSubtasks
                                        listId={listInfo.id}
                                        listSlug={listInfo.slug}
                                        record={rec}
                                        fields={fields.data ?? []}
                                        className="imcrm-mt-4"
                                    />
                                )}

                                {/* A9 — checklists del registro. */}
                                <RecordChecklists
                                    listId={listInfo.id}
                                    recordId={id}
                                    isSubtask={rec.parent_id !== null}
                                    storeManaged={storeRules !== null}
                                    className="imcrm-mt-5"
                                />

                                {/* A8 — dependencias («bloqueado por» / «bloquea»). */}
                                <RecordDependencies listId={listInfo.id} listSlug={listInfo.slug} recordId={id} className="imcrm-mt-5" />

                                {/* v0.1.291 — registro de tiempo (cronómetro + cargas a mano). */}
                                <div className="imcrm-mt-4 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3">
                                    <TimeTrackingPanel listId={listInfo.id} listKey={listInfo.slug} recordId={id} />
                                </div>

                                {/* Acceso al portal del cliente — también sin
                                    plantilla CRM (se auto-oculta si el portal de
                                    la lista no está habilitado). */}
                                <div className="imcrm-mt-4">
                                    <PortalAccessButton list={listInfo} record={rec} />
                                </div>
                                {/* Ley 1581 — autorización de tratamiento de datos (formulario/portal). */}
                                <RecordDataConsentLine className="imcrm-mt-4" listId={listInfo.id} recordId={id} />
                                <div className="imcrm-mt-4">
                                    <RecordPaymentsPanel listId={listInfo.id} recordId={id} />
                                </div>
                                {/* v0.1.290 — documentos emitidos (numerados): congelados, anulados. */}
                                <IssuedDocumentsSection className="imcrm-mt-4" listId={listInfo.id} listSlug={listInfo.slug} recordId={id} />
                                <RecordBacklinks listId={listInfo.id} recordId={id} />
                            </>
                        )}
                        {error !== null && (
                            <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                {error}
                            </div>
                        )}
                    </section>
                </div>

                {/* Panel derecho "Actividad" estilo ClickUp: en lg+ pierde el
                 * chrome de card y queda como columna con hairline izquierda;
                 * en mobile sigue siendo la card apilada de siempre. */}
                <aside className="imcrm-flex imcrm-flex-col imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card lg:imcrm-rounded-none lg:imcrm-border-y-0 lg:imcrm-border-r-0 lg:imcrm-bg-transparent lg:imcrm-pl-6">
                    <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-pt-3 imcrm-text-sm imcrm-font-semibold imcrm-tracking-tight lg:imcrm-px-0 lg:imcrm-pt-1">
                        <ActivityIcon
                            className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground"
                            aria-hidden
                        />
                        {__('Actividad')}
                    </h2>
                    <div
                        role="tablist"
                        aria-label={__('Vista del registro')}
                        className="imcrm-flex imcrm-gap-1 imcrm-border-b imcrm-border-border imcrm-px-3 lg:imcrm-px-0"
                    >
                        <TabButton active={tab === 'comments'} onClick={() => setTab('comments')}>
                            <MessageSquare className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Comentarios')}
                        </TabButton>
                        <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>
                            <ActivityIcon className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Actividad')}
                        </TabButton>
                    </div>

                    <div className="imcrm-flex imcrm-min-h-[60vh] imcrm-flex-col imcrm-overflow-hidden imcrm-p-4 lg:imcrm-px-0">
                        {tab === 'comments' ? (
                            <CommentsPanel
                                listId={listInfo.id}
                                recordId={rec.id}
                                currentUserId={boot.user.id}
                                isAdmin={boot.user.capabilities.workspace_admin === true}
                            />
                        ) : (
                            <ActivityPanel listId={listInfo.id} recordId={rec.id} />
                        )}
                    </div>
                </aside>
            </div>
        </div>
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
