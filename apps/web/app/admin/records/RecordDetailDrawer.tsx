import { useEffect, useMemo, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Link } from 'react-router-dom';
import {
    Activity,
    ChevronDown,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    ExternalLink,
    MessageSquare,
    Save,
    Trash2,
} from 'lucide-react';

import { ActivityPanel } from '@/admin/activity/ActivityPanel';
import { CommentsPanel } from '@/admin/comments/CommentsPanel';
import { Button } from '@/components/ui/button';
import {
    Sheet,
    SheetCloseButton,
    SheetDescription,
    SheetFooter,
    SheetTitle,
} from '@/components/ui/sheet';
import { useDeleteRecord, useUpdateRecord } from '@/hooks/useRecords';
import { ApiError } from '@/lib/api';
import { getBootData } from '@/lib/boot';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import { useList } from '@/hooks/useLists';
import type { RecordEntity } from '@/types/record';

import { PortalAccessButton } from './crm/PortalAccessButton';
import { RecordFieldsForm } from './RecordFieldsForm';
import { RecordMetaGrid } from './RecordMetaGrid';

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
     * ("{lista} / Registro #id"). Si no se pasa, cae al slug.
     */
    listName?: string;
    fields: FieldEntity[];
    record: RecordEntity | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
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
    const d = new Date(value + 'Z');
    return Number.isNaN(d.getTime())
        ? value
        : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
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
 * Las mutaciones reusan `useUpdateRecord` (con su optimistic update),
 * por lo que la tabla refleja el cambio en cuanto se guarda.
 *
 * Construido sobre el mismo Radix Dialog que el Sheet (reusa
 * SheetTitle/Description/Header/Footer para estilos + aria), pero con
 * Portal/Overlay/Content propios: la geometría es centrada, no lateral.
 */
export function RecordDetailDrawer({
    listId,
    listSlug,
    listName,
    fields,
    record,
    open,
    onOpenChange,
}: RecordDetailDrawerProps): JSX.Element {
    const update = useUpdateRecord(listId);
    const remove = useDeleteRecord(listId);

    const initialValues = useMemo<Record<string, unknown>>(() => {
        if (!record) return {};
        return { ...record.fields, ...record.relations };
    }, [record]);

    const [values, setValues] = useState<Record<string, unknown>>(initialValues);
    const [error, setError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [tab, setTab] = useState<'comments' | 'activity'>('comments');
    const [fieldsOpen, setFieldsOpen] = useState(true);
    // Aside de Actividad colapsable (persistido en localStorage).
    const [asideOpen, setAsideOpen] = useState<boolean>(readAsidePref);
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
        setValues(initialValues);
        setError(null);
        setFieldErrors({});
        setTab('comments');
        setFieldsOpen(true);
        update.reset();
        remove.reset();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [record?.id]);

    // ListSummary para PortalAccessButton (cacheado por TanStack; el
    // drawer solo recibe listId/slug/nombre).
    const listData = useList(listId);

    if (!record) {
        return <Sheet open={open} onOpenChange={onOpenChange} />;
    }

    const dirty = JSON.stringify(values) !== JSON.stringify(initialValues);

    // Título del record (mismo criterio que RecordPage): valor del campo
    // primario — o del primer text — con fallback "Registro #id".
    const titleField =
        fields.find((f) => f.is_primary) ?? fields.find((f) => f.type === 'text');
    const titleValue = titleField ? record.fields[titleField.slug] : undefined;
    const title =
        typeof titleValue === 'string' && titleValue !== ''
            ? titleValue
            : sprintf(
                  /* translators: %d: record id */
                  __('Registro #%d'),
                  record.id,
              );

    const handleSave = async (): Promise<void> => {
        setError(null);
        setFieldErrors({});

        // Solo enviamos los slugs que cambiaron, comparando contra el snapshot.
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(values)) {
            if (JSON.stringify(v) !== JSON.stringify(initialValues[k])) {
                patch[k] = v;
            }
        }
        if (Object.keys(patch).length === 0) return;

        try {
            await update.mutateAsync({ id: record.id, values: patch });
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
        if (
            !confirm(
                sprintf(
                    /* translators: %d: record ID */
                    __('Eliminar el registro #%d? Los datos se preservan a menos que pidas purgarlos.'),
                    record.id,
                ),
            )
        ) {
            return;
        }
        try {
            await remove.mutateAsync({ id: record.id, purge: false });
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : __('Error al eliminar'));
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
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
                        className={cn(
                            'imcrm-flex imcrm-h-[88vh] imcrm-w-[min(1150px,94vw)] imcrm-flex-col imcrm-overflow-hidden',
                            'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-text-card-foreground imcrm-shadow-imcrm-xl',
                            'imcrm-animate-imcrm-scale-in',
                        )}
                    >
                        {/* ——— Barra superior full-width (patrón ClickUp) ——— */}
                        <div className="imcrm-flex imcrm-h-12 imcrm-shrink-0 imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-4">
                            <SheetDescription className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-[13px] imcrm-text-muted-foreground">
                                {(listName ?? listSlug) !== undefined && (
                                    <>
                                        {listName ?? listSlug}
                                        <span className="imcrm-mx-1.5 imcrm-text-muted-foreground/50">/</span>
                                    </>
                                )}
                                {sprintf(
                                    /* translators: %d: record id */
                                    __('Registro #%d'),
                                    record.id,
                                )}
                            </SheetDescription>
                            <span className="imcrm-hidden imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground sm:imcrm-inline">
                                {sprintf(
                                    /* translators: %s: fecha de creación del registro */
                                    __('Se creó el %s'),
                                    formatCreatedDate(record.created_at),
                                )}
                            </span>
                            {listSlug !== undefined && (
                                <Button
                                    asChild
                                    variant="ghost"
                                    size="icon"
                                    aria-label={__('Abrir página completa')}
                                    title={__('Abrir página completa')}
                                >
                                    <Link
                                        to={`/lists/${listSlug}/records/${record.id}`}
                                        onClick={() => onOpenChange(false)}
                                    >
                                        <ExternalLink className="imcrm-h-4 imcrm-w-4" />
                                    </Link>
                                </Button>
                            )}
                            <SheetCloseButton />
                        </div>

                        {/* ——— Fila: contenido + aside colapsable ——— */}
                        <div className="imcrm-relative imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col lg:imcrm-flex-row">
                            {/* ——— Columna de contenido con scroll propio ——— */}
                            <div className="imcrm-flex imcrm-min-h-0 imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                                <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto imcrm-px-6 imcrm-py-5 sm:imcrm-px-8">
                                    {/* Chip de tipo de entidad (como el chip "Tarea" de ClickUp). */}
                                    <span className="imcrm-inline-flex imcrm-w-fit imcrm-items-center imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                                        {__('Registro')}
                                    </span>

                                    <SheetTitle className="imcrm-mt-2 imcrm-text-2xl imcrm-font-bold imcrm-tracking-tight">
                                        {title}
                                    </SheetTitle>

                                    {/* Metadatos estilo ClickUp — 2 columnas (modal ancho). */}
                                    <RecordMetaGrid
                                        record={record}
                                        fields={fields}
                                        values={values}
                                        twoCols
                                        className="imcrm-mb-4 imcrm-mt-4"
                                    />

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
                                            {fields.length}
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

                                    {error !== null && (
                                        <div className="imcrm-mt-4 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                            {error}
                                        </div>
                                    )}
                                </div>

                                <SheetFooter>
                                    <Button
                                        variant="ghost"
                                        className="imcrm-mr-auto imcrm-gap-2 imcrm-text-destructive hover:imcrm-text-destructive"
                                        onClick={handleDelete}
                                        disabled={remove.isPending}
                                    >
                                        <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                        {__('Eliminar')}
                                    </Button>
                                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                                        {__('Cancelar')}
                                    </Button>
                                    <Button onClick={handleSave} disabled={!dirty || update.isPending} className="imcrm-gap-2">
                                        <Save className="imcrm-h-4 imcrm-w-4" />
                                        {update.isPending ? __('Guardando…') : __('Guardar cambios')}
                                    </Button>
                                </SheetFooter>
                            </div>

                            {/* Botón flotante para re-expandir el aside colapsado. */}
                            {!asideOpen && (
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
                                        {tab === 'comments' ? (
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
