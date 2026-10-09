import { useState } from 'react';
import { AlarmClock, Eye, EyeOff, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/components/ui/toast';
import { useDeleteReminder, useFollowState, useReminders, useSetFollow } from '@/hooks/useNotifications';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTime } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { ReminderForm } from './ReminderForm';

/**
 * v0.1.276 (ADR-S40) — «Seguir» y «Recordarme» de un registro (modal y página).
 * Seguir = enterarse de sus comentarios y cambios en la bandeja; quien crea,
 * comenta o tiene asignado un registro ya lo sigue solo.
 */
export function RecordFollowControls({ listId, recordId, compact = false }: { listId: number; recordId: number; compact?: boolean }): JSX.Element {
    const state = useFollowState(listId, recordId);
    const setFollow = useSetFollow(listId, recordId);
    const reminders = useReminders(recordId);
    const remove = useDeleteReminder();
    const toast = useToast();
    const [open, setOpen] = useState(false);
    const following = state.data?.following ?? false;
    const followers = state.data?.followers ?? 0;
    const pending = (reminders.data ?? []).filter((r) => !r.fired_at);

    const toggle = (): void =>
        setFollow.mutate(!following, {
            onSuccess: (s) => toast.success(s.following ? __('Sigues este registro') : __('Dejaste de seguirlo')),
            onError: (err) => toast.error(__('No se pudo'), err instanceof Error ? err.message : String(err)),
        });

    const followTitle = following
        ? sprintf(__('Lo sigues: te avisamos de comentarios y cambios (%d lo siguen)'), followers)
        : __('Seguir: avísame de comentarios y cambios');

    return (
        <div className="imcrm-flex imcrm-items-center imcrm-gap-1" data-testid="record-follow-controls">
            <Button
                variant={compact ? 'ghost' : 'outline'}
                size={compact ? 'icon' : 'sm'}
                className={cn(!compact && 'imcrm-gap-1.5', following && 'imcrm-text-primary')}
                onClick={toggle}
                disabled={setFollow.isPending || state.isLoading}
                aria-pressed={following}
                aria-label={following ? __('Siguiendo') : __('Seguir')}
                title={followTitle}
                data-testid="record-follow"
            >
                {following ? <Eye className="imcrm-h-4 imcrm-w-4" /> : <EyeOff className="imcrm-h-4 imcrm-w-4" />}
                {!compact && (following ? __('Siguiendo') : __('Seguir'))}
            </Button>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant={compact ? 'ghost' : 'outline'}
                        size={compact ? 'icon' : 'sm'}
                        className={cn('imcrm-relative', !compact && 'imcrm-gap-1.5', pending.length > 0 && 'imcrm-text-primary')}
                        aria-label={__('Recordarme')}
                        title={__('Recordarme')}
                        data-testid="record-remind"
                    >
                        <AlarmClock className="imcrm-h-4 imcrm-w-4" />
                        {!compact && __('Recordarme')}
                        {pending.length > 0 && (
                            <span className="imcrm-absolute imcrm--right-0.5 imcrm--top-0.5 imcrm-flex imcrm-h-3.5 imcrm-min-w-3.5 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary imcrm-px-0.5 imcrm-text-[9px] imcrm-font-semibold imcrm-text-primary-foreground">
                                {pending.length}
                            </span>
                        )}
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="imcrm-w-[340px] imcrm-max-w-[calc(100vw-1rem)] imcrm-p-3">
                    <p className="imcrm-mb-2 imcrm-text-sm imcrm-font-medium">{__('Recordarme este registro')}</p>
                    {pending.length > 0 && (
                        <ul className="imcrm-mb-3 imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded-md imcrm-bg-muted/50 imcrm-p-2">
                            {pending.map((r) => (
                                <li key={r.id} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                                    <AlarmClock className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                                    <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">
                                        {formatDateTime(new Date(r.remind_at))}
                                        {r.note ? ` · ${r.note}` : ''}
                                    </span>
                                    <button type="button" aria-label={__('Quitar')} className="imcrm-text-muted-foreground hover:imcrm-text-destructive" onClick={() => remove.mutate(r.id)}>
                                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <ReminderForm listId={listId} recordId={recordId} onDone={() => setOpen(false)} compact />
                </PopoverContent>
            </Popover>
        </div>
    );
}
