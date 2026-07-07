import {
    Activity,
    CircleCheck,
    CircleX,
    Loader2,
    MessageSquare,
    Pencil,
    Plus,
    Trash2,
    Workflow,
} from 'lucide-react';

import { useRecordActivity } from '@/hooks/useActivity';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ActivityAction, ActivityEntity } from '@/types/activity';

/**
 * Timeline de actividad de un registro.
 *
 * Cada entrada se renderiza con un ícono según `action`, fecha relativa
 * y, para `record.updated`, el diff de campos en una tabla compacta
 * "antes / después". Para `comment.*`, muestra el snippet (ya truncado
 * por el backend). Para `automation.run`, indica status y nombre de
 * la automatización.
 */
interface ActivityPanelProps {
    listId: number;
    recordId: number;
}

export function ActivityPanel({ listId, recordId }: ActivityPanelProps): JSX.Element {
    const activity = useRecordActivity(listId, recordId, 100);

    if (activity.isLoading) {
        return (
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                {__('Cargando actividad…')}
            </div>
        );
    }
    if (activity.isError) {
        return (
            <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                {(activity.error as Error).message}
            </div>
        );
    }
    if (!activity.data || activity.data.length === 0) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-py-8 imcrm-text-center imcrm-text-muted-foreground">
                <Activity className="imcrm-h-6 imcrm-w-6" />
                <p className="imcrm-text-sm">{__('Aún no hay actividad registrada para este registro.')}</p>
            </div>
        );
    }

    return (
        <ol className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            {activity.data.map((entry) => (
                <ActivityRow key={entry.id} entry={entry} />
            ))}
        </ol>
    );
}

function ActivityRow({ entry }: { entry: ActivityEntity }): JSX.Element {
    return (
        <li className="imcrm-flex imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3">
            <span
                className={cn(
                    'imcrm-mt-0.5 imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full',
                    iconBgFor(entry.action),
                )}
                aria-hidden
            >
                {iconFor(entry.action)}
            </span>
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1">
                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-text-xs">
                    <span className="imcrm-font-medium imcrm-text-foreground">
                        {labelFor(entry)}
                    </span>
                    <span className="imcrm-text-muted-foreground">
                        {new Date(entry.created_at + 'Z').toLocaleString()}
                    </span>
                </div>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                    {entry.user_id !== null && entry.user_id > 0 && (
                        <span>
                            {sprintf(
                                /* translators: %d: user id */
                                __('por usuario #%d'),
                                entry.user_id,
                            )}
                        </span>
                    )}
                </div>
                <ActivityDetail entry={entry} />
            </div>
        </li>
    );
}

function ActivityDetail({ entry }: { entry: ActivityEntity }): JSX.Element | null {
    if (entry.action === 'record.updated') {
        return <RecordUpdatedDetail changes={entry.changes} />;
    }
    if (entry.action === 'comment.created' || entry.action === 'comment.updated') {
        const content = String(
            (entry.changes as { content?: unknown; after?: unknown }).content ??
                (entry.changes as { after?: unknown }).after ??
                '',
        );
        if (content === '') return null;
        return (
            <p className="imcrm-mt-1 imcrm-rounded imcrm-bg-muted/40 imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-text-foreground">
                {content}
            </p>
        );
    }
    if (entry.action === 'automation.run') {
        const status = String(entry.changes.status ?? 'unknown');
        const name = String(entry.changes.automation_name ?? '');
        return (
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                <span className="imcrm-font-medium">{name}</span>
                {' — '}
                <span
                    className={
                        status === 'success'
                            ? 'imcrm-text-success'
                            : status === 'failed'
                              ? 'imcrm-text-destructive'
                              : ''
                    }
                >
                    {status}
                </span>
            </p>
        );
    }
    return null;
}

function RecordUpdatedDetail({
    changes,
}: {
    changes: Record<string, unknown>;
}): JSX.Element | null {
    const fields = changes.fields;
    if (!fields || typeof fields !== 'object') return null;

    const entries = Object.entries(fields as Record<string, { before?: unknown; after?: unknown }>);
    if (entries.length === 0) return null;

    return (
        <table className="imcrm-mt-1 imcrm-w-full imcrm-text-xs">
            <thead>
                <tr className="imcrm-text-muted-foreground">
                    <th className="imcrm-text-left imcrm-font-normal">{__('Campo')}</th>
                    <th className="imcrm-text-left imcrm-font-normal">{__('Antes')}</th>
                    <th className="imcrm-text-left imcrm-font-normal">{__('Después')}</th>
                </tr>
            </thead>
            <tbody>
                {entries.map(([slug, diff]) => (
                    <tr key={slug} className="imcrm-border-t imcrm-border-border/60">
                        <td className="imcrm-py-1 imcrm-pr-2 imcrm-font-mono imcrm-text-foreground">
                            {slug}
                        </td>
                        <td className="imcrm-py-1 imcrm-pr-2 imcrm-text-muted-foreground">
                            {renderValue(diff?.before)}
                        </td>
                        <td className="imcrm-py-1 imcrm-text-foreground">
                            {renderValue(diff?.after)}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function renderValue(v: unknown): string {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
}

function iconFor(action: ActivityAction): JSX.Element {
    switch (action) {
        case 'record.created':
            return <Plus className="imcrm-h-3.5 imcrm-w-3.5" />;
        case 'record.updated':
            return <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />;
        case 'record.deleted':
            return <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />;
        case 'comment.created':
        case 'comment.updated':
            return <MessageSquare className="imcrm-h-3.5 imcrm-w-3.5" />;
        case 'comment.deleted':
            return <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />;
        case 'automation.run':
            return <Workflow className="imcrm-h-3.5 imcrm-w-3.5" />;
        default:
            return <Activity className="imcrm-h-3.5 imcrm-w-3.5" />;
    }
}

function iconBgFor(action: ActivityAction): string {
    if (action === 'record.created') return 'imcrm-bg-success/15 imcrm-text-success';
    if (action === 'record.deleted' || action === 'comment.deleted')
        return 'imcrm-bg-destructive/15 imcrm-text-destructive';
    if (action === 'automation.run') return 'imcrm-bg-primary/15 imcrm-text-primary';
    return 'imcrm-bg-muted imcrm-text-muted-foreground';
}

function labelFor(entry: ActivityEntity): string {
    switch (entry.action) {
        case 'record.created':
            return __('Registro creado');
        case 'record.updated':
            return __('Registro actualizado');
        case 'record.deleted':
            return entry.changes.purge === true
                ? __('Registro purgado')
                : __('Registro eliminado');
        case 'comment.created':
            return __('Comentario añadido');
        case 'comment.updated':
            return __('Comentario editado');
        case 'comment.deleted':
            return __('Comentario eliminado');
        case 'automation.run':
            return __('Automatización ejecutada');
        default:
            return entry.action;
    }
}

// Iconos no usados arriba pero conservados para futuros tipos.
void CircleCheck;
void CircleX;
