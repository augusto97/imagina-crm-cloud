import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    Activity,
    ChevronDown,
    ChevronRight,
    ExternalLink,
    FileText,
    MessageSquare,
    Save,
    Trash2,
} from 'lucide-react';

import { ActivityPanel } from '@/admin/activity/ActivityPanel';
import { CommentsPanel } from '@/admin/comments/CommentsPanel';
import { Button } from '@/components/ui/button';
import {
    Sheet,
    SheetBody,
    SheetCloseButton,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { useDeleteRecord, useUpdateRecord } from '@/hooks/useRecords';
import { ApiError } from '@/lib/api';
import { getBootData } from '@/lib/boot';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

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
    fields: FieldEntity[];
    record: RecordEntity | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/**
 * Panel lateral con form completo del registro. Se usa como complemento
 * al inline edit: aquí se editan también los campos `user`, `file` y
 * `relation` (placeholders simples por ahora — los pickers definitivos
 * vienen en Fase 2/3).
 *
 * Las mutaciones reusan `useUpdateRecord` (con su optimistic update),
 * por lo que la tabla refleja el cambio en cuanto se guarda.
 */
export function RecordDetailDrawer({
    listId,
    listSlug,
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
    const [tab, setTab] = useState<'details' | 'comments' | 'activity'>('details');
    const [fieldsOpen, setFieldsOpen] = useState(true);
    const boot = getBootData();

    useEffect(() => {
        setValues(initialValues);
        setError(null);
        setFieldErrors({});
        setTab('details');
        setFieldsOpen(true);
        update.reset();
        remove.reset();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [record?.id]);

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
            <SheetContent>
                <SheetHeader>
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1">
                        <SheetTitle className="imcrm-text-2xl imcrm-font-bold imcrm-tracking-tight">
                            {title}
                        </SheetTitle>
                        <SheetDescription className="imcrm-text-xs">
                            {__('Registro')}{' '}
                            <span className="imcrm-font-mono">#{record.id}</span>
                        </SheetDescription>
                    </div>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
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
                </SheetHeader>

                <div
                    role="tablist"
                    aria-label={__('Vista del registro')}
                    className="imcrm-flex imcrm-gap-1 imcrm-border-b imcrm-border-border imcrm-px-6"
                >
                    <TabButton active={tab === 'details'} onClick={() => setTab('details')}>
                        <FileText className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Detalle')}
                    </TabButton>
                    <TabButton active={tab === 'comments'} onClick={() => setTab('comments')}>
                        <MessageSquare className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Comentarios')}
                    </TabButton>
                    <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>
                        <Activity className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Actividad')}
                    </TabButton>
                </div>

                <SheetBody>
                    {tab === 'details' ? (
                        <>
                            {/* Metadatos estilo ClickUp — 1 columna (drawer angosto). */}
                            <RecordMetaGrid
                                record={record}
                                fields={fields}
                                values={values}
                                twoCols={false}
                                className="imcrm-mb-4"
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
                                    fields={fields}
                                    values={values}
                                    onChange={setValues}
                                    fieldErrors={fieldErrors}
                                    density="compact"
                                    showTypeIcon
                                />
                            )}

                            {error !== null && (
                                <div className="imcrm-mt-4 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                    {error}
                                </div>
                            )}
                        </>
                    ) : tab === 'comments' ? (
                        <CommentsPanel
                            listId={listId}
                            recordId={record.id}
                            currentUserId={boot.user.id}
                            isAdmin={boot.user.capabilities.workspace_admin === true}
                        />
                    ) : (
                        <ActivityPanel listId={listId} recordId={record.id} />
                    )}
                </SheetBody>

                {tab === 'details' && (
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
                )}
            </SheetContent>
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
