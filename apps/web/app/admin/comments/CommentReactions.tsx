import { useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { COMMENT_REACTION_EMOJIS, type CommentReactionEmoji, type CommentReactionSummary } from '@imagina-base/shared';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getBootData } from '@/lib/boot';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { reactorsText } from './commentThreads';

/**
 * v0.1.291 — Reacciones de un comentario: una pastilla por emoji con su
 * contador (resaltada si es tuya; tocarla la pone o la quita) y el botón para
 * elegir otra del set curado. Quién reaccionó se ve en el tooltip de cada
 * pastilla y, en táctil (donde no hay tooltip), en la lista del selector.
 */
export function CommentReactions({
    reactions,
    onToggle,
    disabled = false,
    className,
}: {
    reactions: readonly CommentReactionSummary[] | undefined;
    onToggle: (emoji: CommentReactionEmoji) => void;
    disabled?: boolean;
    className?: string;
}): JSX.Element {
    const me = getBootData().user;
    const list = reactions ?? [];
    return (
        <div className={cn('imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1', className)} data-testid="imcrm-comment-reactions">
            {list.map((r) => {
                const mine = r.user_ids.includes(me.id);
                const who = reactorsText(r.user_names, me.displayName || null);
                return (
                    <button
                        key={r.emoji}
                        type="button"
                        disabled={disabled}
                        onClick={() => onToggle(r.emoji)}
                        aria-pressed={mine}
                        title={who ? sprintf(__('%1$s reaccionó con %2$s'), who, r.emoji) : undefined}
                        aria-label={sprintf(__('%1$s %2$d: %3$s'), r.emoji, r.count, who)}
                        data-testid="imcrm-reaction-pill"
                        data-emoji={r.emoji}
                        className={cn(
                            'imcrm-inline-flex imcrm-h-6 imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-border imcrm-px-1.5 imcrm-text-xs imcrm-tabular-nums imcrm-transition-colors disabled:imcrm-opacity-60',
                            mine
                                ? 'imcrm-border-primary/50 imcrm-bg-primary/10 imcrm-text-foreground'
                                : 'imcrm-border-border imcrm-bg-background imcrm-text-muted-foreground hover:imcrm-border-primary/40 hover:imcrm-text-foreground',
                        )}
                    >
                        <span aria-hidden className="imcrm-text-[13px] imcrm-leading-none">{r.emoji}</span>
                        <span>{r.count}</span>
                    </button>
                );
            })}
            <ReactionPicker reactions={list} onToggle={onToggle} disabled={disabled} />
        </div>
    );
}

function ReactionPicker({
    reactions,
    onToggle,
    disabled,
}: {
    reactions: readonly CommentReactionSummary[];
    onToggle: (emoji: CommentReactionEmoji) => void;
    disabled: boolean;
}): JSX.Element {
    const [open, setOpen] = useState(false);
    const me = getBootData().user;
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={disabled}
                    aria-label={__('Reaccionar')}
                    title={__('Reaccionar')}
                    data-testid="imcrm-reaction-add"
                    className="imcrm-inline-flex imcrm-h-6 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-bg-accent hover:imcrm-text-foreground disabled:imcrm-opacity-60"
                >
                    <SmilePlus className="imcrm-h-3.5 imcrm-w-3.5" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="imcrm-w-auto imcrm-max-w-[18rem] imcrm-p-2" data-testid="imcrm-reaction-picker">
                <div className="imcrm-grid imcrm-grid-cols-8 imcrm-gap-0.5" role="group" aria-label={__('Elige una reacción')}>
                    {COMMENT_REACTION_EMOJIS.map((emoji) => {
                        const mine = reactions.find((r) => r.emoji === emoji)?.user_ids.includes(me.id) ?? false;
                        return (
                            <button
                                key={emoji}
                                type="button"
                                aria-pressed={mine}
                                aria-label={emoji}
                                data-emoji={emoji}
                                onClick={() => {
                                    onToggle(emoji);
                                    setOpen(false);
                                }}
                                className={cn(
                                    'imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-lg imcrm-transition-colors hover:imcrm-bg-accent',
                                    mine && 'imcrm-bg-primary/10 imcrm-ring-1 imcrm-ring-primary/40',
                                )}
                            >
                                {emoji}
                            </button>
                        );
                    })}
                </div>
                {reactions.length > 0 && (
                    <ul className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-border-t imcrm-border-border imcrm-pt-2 imcrm-text-xs imcrm-text-muted-foreground">
                        {reactions.map((r) => (
                            <li key={r.emoji} className="imcrm-flex imcrm-gap-1.5">
                                <span aria-hidden>{r.emoji}</span>
                                <span className="imcrm-min-w-0">{reactorsText(r.user_names, me.displayName || null, 8)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </PopoverContent>
        </Popover>
    );
}
