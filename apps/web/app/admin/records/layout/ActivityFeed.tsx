import { useMemo, useState } from 'react';
import { Activity as ActivityIcon, Loader2, Mail, MessageSquare, Pencil, Phone, Plus, StickyNote, Trash2, Users, Zap } from 'lucide-react';

import { ActivityValue } from '@/admin/activity/ActivityPanel';
import { actionText, actorOf, changeSentence, changesOf, type FieldChange } from '@/admin/activity/activityText';
import { CommentContent } from '@/admin/comments/CommentContent';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useRecordActivity } from '@/hooks/useActivity';
import { useComments, useCreateComment, useDeleteComment, useUpdateComment } from '@/hooks/useComments';
import { useFields } from '@/hooks/useFields';
import { useWpUser } from '@/hooks/useWpUsers';
import { getBootData } from '@/lib/boot';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTimeStr, formatTimeOfDay } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { ActivityEntity } from '@/types/activity';
import type { CommentEntity, CommentKind, CommentMetadata } from '@/types/comment';
import type { FieldEntity } from '@/types/field';

import { buildFeed, groupByDay, type FeedFilter, type FeedItem } from './activityFeedModel';

/**
 * v0.1.234 — Actividad y comentarios de la ficha, rediseñados (reemplaza al
 * timeline del layout CRM viejo, que ocupaba media pantalla con un editor de
 * cuatro pestañas siempre abierto y una lista sin fin):
 *  - el composer arranca PLEGADO en una línea y se abre al escribir;
 *  - el hilo agrupa por día y junta las ediciones seguidas de una persona;
 *  - se ven las últimas entradas y "Ver más" trae el resto, así el bloque no
 *    se estira hasta el final de la página.
 */

const PAGE = 8;

interface ModeConfig {
    kind: CommentKind;
    label: string;
    icon: typeof MessageSquare;
    placeholder: string;
}

const MODES: ModeConfig[] = [
    { kind: 'note', label: 'Nota', icon: StickyNote, placeholder: 'Escribí un comentario…' },
    { kind: 'call', label: 'Llamada', icon: Phone, placeholder: 'Resumen de la llamada…' },
    { kind: 'email', label: 'Email', icon: Mail, placeholder: 'Resumen del email…' },
    { kind: 'meeting', label: 'Reunión', icon: Users, placeholder: 'Notas de la reunión…' },
];

const CALL_OUTCOMES: Array<{ value: string; label: string }> = [
    { value: 'connected', label: 'Hablamos' },
    { value: 'voicemail', label: 'Buzón de voz' },
    { value: 'no_answer', label: 'No contestó' },
    { value: 'busy', label: 'Ocupado' },
];

export function ActivityFeed({
    listId,
    recordId,
    currentUserId,
    isAdmin,
    initialFilter = 'all',
}: {
    listId: number;
    recordId: number;
    currentUserId: number;
    isAdmin: boolean;
    initialFilter?: FeedFilter;
}): JSX.Element {
    const comments = useComments(listId, recordId);
    const activity = useRecordActivity(listId, recordId);
    const fields = useFields(listId);
    const [filter, setFilter] = useState<FeedFilter>(initialFilter);
    const [visible, setVisible] = useState(PAGE);

    const items = useMemo(() => buildFeed(comments.data, activity.data, filter), [comments.data, activity.data, filter]);
    const days = useMemo(() => groupByDay(items.slice(0, visible)), [items, visible]);
    const loading = comments.isLoading || activity.isLoading;
    const counts = {
        comments: comments.data?.length ?? 0,
        changes: (activity.data ?? []).filter((a) => !a.action.startsWith('comment.')).length,
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-activity-feed">
            <Composer listId={listId} recordId={recordId} />
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs" role="tablist" aria-label={__('Filtrar actividad')}>
                <FilterTab active={filter === 'all'} onClick={() => setFilter('all')}>{__('Todo')}</FilterTab>
                <FilterTab active={filter === 'comments'} onClick={() => setFilter('comments')} count={counts.comments}>
                    {__('Comentarios')}
                </FilterTab>
                <FilterTab active={filter === 'changes'} onClick={() => setFilter('changes')} count={counts.changes}>
                    {__('Cambios')}
                </FilterTab>
            </div>

            {loading ? (
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-2 imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Cargando…')}
                </div>
            ) : items.length === 0 ? (
                <p className="imcrm-py-3 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                    {filter === 'comments'
                        ? __('Todavía no hay comentarios.')
                        : filter === 'changes'
                          ? __('Los cambios del registro van a aparecer acá.')
                          : __('Todavía no hay actividad.')}
                </p>
            ) : (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    {days.map((day) => (
                        <section key={day.key} className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <h4 className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{day.label}</h4>
                            <ol className="imcrm-relative imcrm-flex imcrm-flex-col">
                                {/* El riel que une las entradas del día. */}
                                <span aria-hidden className="imcrm-absolute imcrm-bottom-3 imcrm-left-[11px] imcrm-top-3 imcrm-w-px imcrm-bg-border" />
                                {day.items.map((item) => (
                                    <FeedRow
                                        key={item.key}
                                        item={item}
                                        fields={fields.data ?? []}
                                        listId={listId}
                                        recordId={recordId}
                                        canEditComment={(c) => isAdmin || c.user_id === currentUserId}
                                    />
                                ))}
                            </ol>
                        </section>
                    ))}
                    {items.length > visible && (
                        <button
                            type="button"
                            onClick={() => setVisible((v) => v + 15)}
                            className="imcrm-self-start imcrm-rounded-md imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-bg-accent"
                        >
                            {sprintf(__('Ver más (%d)'), items.length - visible)}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function FilterTab({ active, onClick, count, children }: { active: boolean; onClick: () => void; count?: number; children: React.ReactNode }): JSX.Element {
    return (
        <button
            type="button"
            role="tab"
            aria-selected={active}
            onClick={onClick}
            className={cn(
                'imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-2 imcrm-py-1 imcrm-font-medium imcrm-transition-colors',
                active ? 'imcrm-bg-accent imcrm-text-foreground' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
            )}
        >
            {children}
            {count !== undefined && count > 0 && <span className="imcrm-tabular-nums imcrm-text-muted-foreground">{count}</span>}
        </button>
    );
}

// ── Composer ─────────────────────────────────────────────────────────────

function Composer({ listId, recordId }: { listId: number; recordId: number }): JSX.Element {
    const create = useCreateComment(listId, recordId);
    const toast = useToast();
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<CommentKind>('note');
    const [draft, setDraft] = useState('');
    const [meta, setMeta] = useState<CommentMetadata>({});
    const me = getBootData().user.displayName;

    const reset = (): void => {
        setDraft('');
        setMeta({});
        setMode('note');
        setOpen(false);
    };

    const submit = async (): Promise<void> => {
        const content = draft.trim();
        if (content === '') return;
        const metadata: CommentMetadata | undefined = (() => {
            if (mode === 'note' && Object.keys(meta).length === 0) return undefined;
            const out: CommentMetadata = { ...meta, kind: mode };
            (Object.keys(out) as Array<keyof CommentMetadata>).forEach((k) => {
                if (out[k] === '' || out[k] === undefined || out[k] === null) delete out[k];
            });
            return out;
        })();
        try {
            await create.mutateAsync({ content, metadata });
            reset();
        } catch (err) {
            toast.error(__('No se pudo publicar'), err instanceof Error ? err.message : '');
        }
    };

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2.5 imcrm-py-2 imcrm-text-left imcrm-text-sm imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-border-primary/40"
                data-testid="imcrm-activity-composer"
            >
                <Avatar name={me} size={24} />
                {__('Escribí un comentario…')}
            </button>
        );
    }
    const active = MODES.find((m) => m.kind === mode) ?? MODES[0]!;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-primary/40 imcrm-bg-background imcrm-p-2 imcrm-shadow-imcrm-sm">
            <ModeFields mode={mode} meta={meta} onChange={setMeta} />
            <Textarea
                autoFocus
                rows={3}
                value={draft}
                placeholder={__(active.placeholder)}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault();
                        void submit();
                    }
                    if (e.key === 'Escape' && draft.trim() === '') reset();
                }}
                className="imcrm-min-h-[72px] imcrm-resize-none imcrm-border-0 imcrm-px-1 imcrm-shadow-none focus-visible:imcrm-ring-0"
            />
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                {MODES.map((m) => {
                    const Icon = m.icon;
                    const on = m.kind === mode;
                    return (
                        <button
                            key={m.kind}
                            type="button"
                            onClick={() => setMode(m.kind)}
                            title={__(m.label)}
                            aria-pressed={on}
                            className={cn(
                                'imcrm-inline-flex imcrm-h-7 imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-1.5 imcrm-text-xs imcrm-transition-colors',
                                on ? 'imcrm-bg-accent imcrm-font-medium imcrm-text-foreground' : 'imcrm-text-muted-foreground hover:imcrm-bg-accent/60',
                            )}
                        >
                            <Icon className="imcrm-h-3.5 imcrm-w-3.5" />
                            {on && __(m.label)}
                        </button>
                    );
                })}
                <span className="imcrm-flex-1" />
                <Button type="button" variant="ghost" size="sm" className="imcrm-h-7" onClick={reset}>
                    {__('Cancelar')}
                </Button>
                <Button type="button" size="sm" className="imcrm-h-7 imcrm-gap-1.5" disabled={draft.trim() === '' || create.isPending} onClick={() => void submit()}>
                    {create.isPending && <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />}
                    {__('Comentar')}
                </Button>
            </div>
        </div>
    );
}

function ModeFields({ mode, meta, onChange }: { mode: CommentKind; meta: CommentMetadata; onChange: (m: CommentMetadata) => void }): JSX.Element | null {
    const field = 'imcrm-h-8 imcrm-text-xs';
    if (mode === 'call') {
        return (
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <Input
                    type="number"
                    min={0}
                    className={field}
                    placeholder={__('Duración (min)')}
                    aria-label={__('Duración (min)')}
                    value={meta.duration_minutes ?? ''}
                    onChange={(e) => onChange({ ...meta, duration_minutes: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
                <select
                    aria-label={__('Resultado')}
                    value={meta.outcome ?? ''}
                    onChange={(e) => onChange({ ...meta, outcome: e.target.value || undefined })}
                    className="imcrm-h-8 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-xs"
                >
                    <option value="">{__('Resultado…')}</option>
                    {CALL_OUTCOMES.map((o) => (
                        <option key={o.value} value={o.value}>{__(o.label)}</option>
                    ))}
                </select>
            </div>
        );
    }
    if (mode === 'email') {
        return (
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <Input className={field} placeholder={__('Para')} aria-label={__('Para')} value={meta.to ?? ''} onChange={(e) => onChange({ ...meta, to: e.target.value })} />
                <Input className={field} placeholder={__('Asunto')} aria-label={__('Asunto')} value={meta.subject ?? ''} onChange={(e) => onChange({ ...meta, subject: e.target.value })} />
            </div>
        );
    }
    if (mode === 'meeting') {
        return (
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <Input className={field} placeholder={__('Asistentes')} aria-label={__('Asistentes')} value={meta.attendees ?? ''} onChange={(e) => onChange({ ...meta, attendees: e.target.value })} />
                <Input className={field} type="datetime-local" aria-label={__('Cuándo')} value={meta.occurred_at ?? ''} onChange={(e) => onChange({ ...meta, occurred_at: e.target.value })} />
            </div>
        );
    }
    return null;
}

// ── Filas ────────────────────────────────────────────────────────────────

function FeedRow({
    item,
    fields,
    listId,
    recordId,
    canEditComment,
}: {
    item: FeedItem;
    fields: FieldEntity[];
    listId: number;
    recordId: number;
    canEditComment: (c: CommentEntity) => boolean;
}): JSX.Element {
    if (item.kind === 'comment') {
        return <CommentRow comment={item.comment} canEdit={canEditComment(item.comment)} listId={listId} recordId={recordId} />;
    }
    return <ChangeRow entries={item.entries} fields={fields} />;
}

function ChangeRow({ entries, fields }: { entries: ActivityEntity[]; fields: FieldEntity[] }): JSX.Element {
    const first = entries[0]!;
    const changes = entries.flatMap((e) => changesOf(e, fields));
    const actor = actorOf(first);
    const verb = actionText(first, changes.length);
    const created = first.action === 'record_created' || first.action === 'record.created';
    const Icon = created ? Plus : first.action === 'automation.run' ? Zap : first.action.includes('deleted') ? Trash2 : Pencil;
    // Lo que cambió de un registro recién creado son TODOS sus valores: el
    // alta se lee mejor como una frase sola.
    const shown = created ? [] : dedupeChanges(changes);
    return (
        <li className="imcrm-relative imcrm-flex imcrm-gap-2.5 imcrm-py-1.5">
            <span
                aria-hidden
                className={cn(
                    'imcrm-relative imcrm-z-[1] imcrm-mt-px imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-card imcrm-ring-1 imcrm-ring-border',
                    created ? 'imcrm-text-success' : 'imcrm-text-muted-foreground',
                )}
            >
                <Icon className="imcrm-h-3 imcrm-w-3" />
            </span>
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1 imcrm-pt-0.5">
                <div className="imcrm-flex imcrm-items-baseline imcrm-justify-between imcrm-gap-2">
                    <p className="imcrm-min-w-0 imcrm-text-[13px] imcrm-leading-snug imcrm-text-muted-foreground">
                        <span className="imcrm-font-medium imcrm-text-foreground">{actor}</span>{' '}
                        {created ? verb : shown.length === 0 ? verb : shown.length === 1 ? changeSentence(shown[0]!).verb : sprintf(__('editó %d campos'), shown.length)}
                        {shown.length === 1 && (
                            <>
                                {' '}
                                <span className="imcrm-font-medium imcrm-text-foreground">{shown[0]!.label}</span>
                            </>
                        )}
                    </p>
                    <Time iso={first.created_at} />
                </div>
                {shown.length > 0 && (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        {shown.map((c, i) => (
                            <ChangeLine key={`${c.label}-${i}`} change={c} withLabel={shown.length > 1} />
                        ))}
                    </ul>
                )}
            </div>
        </li>
    );
}

/** Si un mismo campo cambió varias veces en el grupo, se ve del primer valor al último. */
function dedupeChanges(changes: FieldChange[]): FieldChange[] {
    // `changes` viene de lo más nuevo a lo más viejo.
    const byLabel = new Map<string, FieldChange>();
    for (const c of changes) {
        const prev = byLabel.get(c.label);
        byLabel.set(c.label, prev ? { ...prev, from: c.from } : c);
    }
    return [...byLabel.values()];
}

function ChangeLine({ change, withLabel }: { change: FieldChange; withLabel: boolean }): JSX.Element {
    const { from, to } = changeSentence(change);
    return (
        <li className="imcrm-flex imcrm-min-w-0 imcrm-flex-wrap imcrm-items-center imcrm-gap-1 imcrm-text-[12.5px] imcrm-text-muted-foreground">
            {withLabel && <span className="imcrm-mr-0.5 imcrm-text-foreground/80">{change.label}:</span>}
            {from !== null && <ActivityValue field={change.field} raw={change.from} text={from} old />}
            {from !== null && to !== null && <span aria-hidden>→</span>}
            {to !== null ? (
                <ActivityValue field={change.field} raw={change.to} text={to} />
            ) : (
                <span className="imcrm-italic">{__('vacío')}</span>
            )}
        </li>
    );
}

function CommentRow({ comment, canEdit, listId, recordId }: { comment: CommentEntity; canEdit: boolean; listId: number; recordId: number }): JSX.Element {
    const author = useWpUser(comment.user_id);
    const name = author.data?.display_name ?? sprintf(__('Usuario #%d'), comment.user_id);
    const update = useUpdateComment(listId, recordId);
    const remove = useDeleteComment(listId, recordId);
    const confirm = useConfirm();
    const toast = useToast();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(comment.content);
    const meta = comment.metadata ?? {};
    const kind = MODES.find((m) => m.kind === (meta.kind ?? 'note'));
    const KindIcon = kind?.icon ?? MessageSquare;

    const save = async (): Promise<void> => {
        if (draft.trim() === '') return;
        try {
            await update.mutateAsync({ id: comment.id, content: draft.trim() });
            setEditing(false);
        } catch (err) {
            toast.error(__('No se pudo editar'), err instanceof Error ? err.message : '');
        }
    };
    const del = async (): Promise<void> => {
        const ok = await confirm({ title: __('Eliminar comentario'), description: __('Esta acción no se puede deshacer.'), destructive: true, confirmLabel: __('Eliminar') });
        if (ok) remove.mutate(comment.id);
    };

    return (
        <li className="imcrm-group imcrm-relative imcrm-flex imcrm-gap-2.5 imcrm-py-1.5">
            <span className="imcrm-relative imcrm-z-[1]">
                <Avatar name={name} size={24} />
            </span>
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1">
                <div className="imcrm-flex imcrm-items-baseline imcrm-justify-between imcrm-gap-2">
                    <p className="imcrm-flex imcrm-min-w-0 imcrm-flex-wrap imcrm-items-center imcrm-gap-x-1.5 imcrm-text-[13px]">
                        <span className="imcrm-font-medium imcrm-text-foreground">{name}</span>
                        {meta.kind && meta.kind !== 'note' && (
                            <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground">
                                <KindIcon className="imcrm-h-3 imcrm-w-3" />
                                {describeMode(meta)}
                            </span>
                        )}
                    </p>
                    <Time iso={comment.created_at} />
                </div>
                {editing ? (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                        <Textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                        <div className="imcrm-flex imcrm-gap-2">
                            <Button size="sm" className="imcrm-h-7" onClick={() => void save()} disabled={draft.trim() === ''}>{__('Guardar')}</Button>
                            <Button size="sm" variant="ghost" className="imcrm-h-7" onClick={() => setEditing(false)}>{__('Cancelar')}</Button>
                        </div>
                    </div>
                ) : (
                    <div className="imcrm-rounded-lg imcrm-rounded-tl-sm imcrm-bg-muted/60 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-foreground">
                        <CommentContent content={comment.content} />
                    </div>
                )}
                {canEdit && !editing && (
                    <div className="imcrm-flex imcrm-gap-3 imcrm-text-xs imcrm-text-muted-foreground imcrm-opacity-0 imcrm-transition-opacity focus-within:imcrm-opacity-100 group-hover:imcrm-opacity-100">
                        <button type="button" onClick={() => setEditing(true)} className="hover:imcrm-text-foreground">{__('Editar')}</button>
                        <button type="button" onClick={() => void del()} className="hover:imcrm-text-destructive">{__('Eliminar')}</button>
                    </div>
                )}
            </div>
        </li>
    );
}

function describeMode(meta: CommentMetadata): string {
    const parts: string[] = [];
    if (meta.kind === 'call') {
        parts.push(__('Llamada'));
        if (meta.duration_minutes !== undefined) parts.push(sprintf(__('%d min'), meta.duration_minutes));
        if (meta.outcome) parts.push(__(CALL_OUTCOMES.find((o) => o.value === meta.outcome)?.label ?? meta.outcome));
    } else if (meta.kind === 'email') {
        parts.push(__('Email'));
        if (meta.to) parts.push(`→ ${meta.to}`);
        if (meta.subject) parts.push(`«${meta.subject}»`);
    } else if (meta.kind === 'meeting') {
        parts.push(__('Reunión'));
        if (meta.attendees) parts.push(meta.attendees);
    }
    return parts.join(' · ');
}

function Time({ iso }: { iso: string }): JSX.Element {
    const d = new Date(iso.includes('Z') || iso.includes('+') ? iso : `${iso.replace(' ', 'T')}Z`);
    return (
        <time dateTime={iso} title={formatDateTimeStr(iso)} className="imcrm-shrink-0 imcrm-whitespace-nowrap imcrm-text-[11px] imcrm-tabular-nums imcrm-text-muted-foreground">
            {Number.isNaN(d.getTime()) ? '' : formatTimeOfDay(d)}
        </time>
    );
}

export function Avatar({ name, size = 24 }: { name: string; size?: number }): JSX.Element {
    const initials =
        name
            .replace(/#\d+/g, '')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((w) => w.charAt(0).toUpperCase())
            .join('') || <ActivityIcon className="imcrm-h-3 imcrm-w-3" />;
    return (
        <span
            aria-hidden
            className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-font-semibold imcrm-text-foreground/75 imcrm-ring-1 imcrm-ring-border"
            style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
        >
            {initials}
        </span>
    );
}
