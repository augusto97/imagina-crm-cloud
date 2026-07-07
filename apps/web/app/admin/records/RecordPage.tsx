import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
    Activity as ActivityIcon,
    ArrowLeft,
    ExternalLink,
    Loader2,
    MessageSquare,
    Save,
    Trash2,
} from 'lucide-react';

import { ActivityPanel } from '@/admin/activity/ActivityPanel';
import { CommentsPanel } from '@/admin/comments/CommentsPanel';
import { RecordCrmLayout } from '@/admin/records/crm/RecordCrmLayout';
import { RecordFieldsForm } from '@/admin/records/RecordFieldsForm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useFields } from '@/hooks/useFields';
import { useList } from '@/hooks/useLists';
import { useDeleteRecord, useRecord, useUpdateRecord } from '@/hooks/useRecords';
import { ApiError } from '@/lib/api';
import { getBootData } from '@/lib/boot';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Vista "Card" — página completa de un record con:
 * - Header: breadcrumb + nombre/id + acciones.
 * - Columna principal (2/3): RecordFieldsForm completo, editable.
 * - Aside (1/3): tabs Comentarios / Actividad.
 *
 * Es el "primo grande" del RecordDetailDrawer: misma data, misma
 * lógica de save/delete; cambia el layout. Útil cuando el operador
 * necesita más espacio para editar campos largos o navegar
 * comentarios extensos sin sentirse encajonado en el drawer.
 *
 * URL: `/lists/:listSlug/records/:recordId` — bookmarkable y
 * compartible.
 */
export function RecordPage(): JSX.Element {
    const { listSlug, recordId } = useParams<{ listSlug: string; recordId: string }>();
    const navigate = useNavigate();

    const id = Number(recordId);
    const list = useList(listSlug);
    const fields = useFields(list.data?.id);
    const record = useRecord(list.data?.id, id);
    const update = useUpdateRecord(list.data?.id ?? 0);
    const remove = useDeleteRecord(list.data?.id ?? 0);
    const confirm = useConfirm();

    const initialValues = useMemo<Record<string, unknown>>(() => {
        if (!record.data) return {};
        return { ...record.data.fields, ...record.data.relations };
    }, [record.data]);

    const [values, setValues] = useState<Record<string, unknown>>(initialValues);
    const [error, setError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [tab, setTab] = useState<'comments' | 'activity'>('comments');
    const boot = getBootData();

    useEffect(() => {
        setValues(initialValues);
        setError(null);
        setFieldErrors({});
    }, [initialValues]);

    if (list.isLoading || fields.isLoading || record.isLoading) {
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
    // === 'crm'`, renderea el panel estilo CRM (header con avatar +
    // sidebar de propiedades + timeline). Default 'classic' = form
    // lineal de toda la vida.
    const recordLayout = (list.data.settings as { record_layout?: string })?.record_layout;
    const useCrmLayout = recordLayout === 'crm';

    if (useCrmLayout && fields.data) {
        return (
            <RecordCrmLayout
                list={list.data}
                record={record.data}
                fields={fields.data}
                currentUserId={boot.user.id}
                isAdmin={boot.user.capabilities.manage_options === true}
                onDelete={() => void handleDelete()}
                deleting={remove.isPending}
            />
        );
    }

    const dirty = JSON.stringify(values) !== JSON.stringify(initialValues);
    const titleField = fields.data?.find((f) => f.is_primary)
        ?? fields.data?.find((f) => f.type === 'text');
    const titleValue = titleField ? record.data.fields[titleField.slug] : undefined;
    const title =
        typeof titleValue === 'string' && titleValue !== ''
            ? titleValue
            : sprintf(
                  /* translators: %d: record id */
                  __('Registro #%d'),
                  record.data.id,
              );

    const handleSave = async (): Promise<void> => {
        setError(null);
        setFieldErrors({});

        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(values)) {
            if (JSON.stringify(v) !== JSON.stringify(initialValues[k])) {
                patch[k] = v;
            }
        }
        if (Object.keys(patch).length === 0) return;

        try {
            await update.mutateAsync({ id: record.data!.id, values: patch });
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
        if (!record.data) return;
        const ok = await confirm({
            title: sprintf(
                /* translators: %d: record id */
                __('¿Eliminar el registro #%d?'),
                record.data.id,
            ),
            description: __('Esta acción no se puede deshacer.'),
            destructive: true,
            confirmLabel: __('Eliminar'),
        });
        if (!ok) return;
        try {
            await remove.mutateAsync({ id: record.data.id, purge: false });
            navigate(`/lists/${list.data!.slug}/records`);
        } catch (err) {
            setError(err instanceof Error ? err.message : __('Error al eliminar'));
        }
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
            <header className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-4">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="imcrm-gap-2 imcrm-self-start imcrm-text-muted-foreground"
                    >
                        <Link to={`/lists/${list.data.slug}/records`}>
                            <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                            {list.data.name}
                        </Link>
                    </Button>
                    <h1 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-2xl imcrm-font-semibold imcrm-tracking-tight">
                        {title}
                        <Badge variant="outline" className="imcrm-font-mono imcrm-text-xs">
                            #{record.data.id}
                        </Badge>
                    </h1>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {sprintf(
                            /* translators: %s: localized creation date */
                            __('Creado %s'),
                            record.data.created_at
                                ? new Date(record.data.created_at + 'Z').toLocaleString()
                                : '—',
                        )}
                    </p>
                </div>
                <div className="imcrm-flex imcrm-gap-2">
                    <Button
                        variant="ghost"
                        className="imcrm-gap-2 imcrm-text-destructive hover:imcrm-text-destructive"
                        onClick={handleDelete}
                        disabled={remove.isPending}
                    >
                        <Trash2 className="imcrm-h-4 imcrm-w-4" />
                        {__('Eliminar')}
                    </Button>
                    <Button onClick={handleSave} disabled={!dirty || update.isPending} className="imcrm-gap-2">
                        <Save className="imcrm-h-4 imcrm-w-4" />
                        {update.isPending ? __('Guardando…') : __('Guardar cambios')}
                    </Button>
                </div>
            </header>

            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-6 lg:imcrm-grid-cols-3">
                <main className="imcrm-flex imcrm-flex-col imcrm-gap-4 lg:imcrm-col-span-2">
                    <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6">
                        {fields.data && (
                            <RecordFieldsForm
                                listId={list.data.id}
                                fields={fields.data}
                                values={values}
                                onChange={setValues}
                                fieldErrors={fieldErrors}
                            />
                        )}
                        {error !== null && (
                            <div className="imcrm-mt-4 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                {error}
                            </div>
                        )}
                    </section>
                </main>

                <aside className="imcrm-flex imcrm-flex-col imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
                    <div
                        role="tablist"
                        aria-label={__('Vista del registro')}
                        className="imcrm-flex imcrm-gap-1 imcrm-border-b imcrm-border-border imcrm-px-3"
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

                    <div className="imcrm-flex imcrm-min-h-[60vh] imcrm-flex-col imcrm-overflow-hidden imcrm-p-4">
                        {tab === 'comments' ? (
                            <CommentsPanel
                                listId={list.data.id}
                                recordId={record.data.id}
                                currentUserId={boot.user.id}
                                isAdmin={boot.user.capabilities.manage_options === true}
                            />
                        ) : (
                            <ActivityPanel listId={list.data.id} recordId={record.data.id} />
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

// Reservado para usar luego cuando el drawer enlace aquí.
void ExternalLink;
