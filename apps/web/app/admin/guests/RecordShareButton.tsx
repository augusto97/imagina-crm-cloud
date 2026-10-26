import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { UserRoundPlus, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useRecordShares, useSetRecordShareLevel, useShareRecord } from '@/hooks/useGuests';
import { useIsGuest } from '@/lib/guest';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCanAny } from '@/lib/permissions';
import { cn } from '@/lib/utils';

import { GuestInviteForm, GuestLevelSelect, guestInvitedNotice } from './GuestAccess';

/**
 * C3 — «Compartir este registro» con una persona de afuera (email + nivel).
 * Lo ofrece la barra de la ficha a quien puede editar registros; el servidor
 * exige además que pueda editar ESTE registro.
 */
export function RecordShareButton({
    listId,
    recordId,
    title,
    compact = false,
}: {
    listId: number;
    recordId: number;
    title?: string;
    compact?: boolean;
}): JSX.Element | null {
    const canEdit = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS);
    const isGuest = useIsGuest();
    const [open, setOpen] = useState(false);
    if (!canEdit || isGuest) return null;
    return (
        <>
            <Button
                variant="ghost"
                size={compact ? 'icon' : 'sm'}
                aria-label={__('Compartir este registro')}
                title={__('Compartir este registro con alguien de afuera')}
                onClick={() => setOpen(true)}
                data-testid="record-share-button"
            >
                <UserRoundPlus className="imcrm-h-4 imcrm-w-4" />
                {!compact && __('Compartir')}
            </Button>
            {open && <RecordShareDialog listId={listId} recordId={recordId} title={title} onClose={() => setOpen(false)} />}
        </>
    );
}

function RecordShareDialog({
    listId,
    recordId,
    title,
    onClose,
}: {
    listId: number;
    recordId: number;
    title?: string;
    onClose: () => void;
}): JSX.Element {
    const shares = useRecordShares(listId, recordId);
    const share = useShareRecord(listId, recordId);
    const setLevel = useSetRecordShareLevel();
    const toast = useToast();
    const rows = shares.data ?? [];
    const fail = (err: unknown): void => {
        toast.error(__('No se pudo cambiar el acceso.'), err instanceof Error ? err.message : undefined);
    };
    return (
        <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    data-testid="record-share-dialog"
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-lg',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-flex imcrm-max-h-[85vh] imcrm-flex-col imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-lg',
                    )}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-5 imcrm-py-3.5">
                        <div className="imcrm-min-w-0">
                            <Dialog.Title className="imcrm-truncate imcrm-text-base imcrm-font-semibold">
                                {title ? sprintf(__('Compartir «%s»'), title) : __('Compartir este registro')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Con alguien de afuera: ve SÓLO este registro (nada más de la empresa) y no ocupa un usuario de tu plan.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>
                    <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-4 imcrm-overflow-y-auto imcrm-px-5 imcrm-py-4">
                        <GuestInviteForm
                            idPrefix={`record-${recordId}`}
                            busy={share.isPending}
                            onInvite={async (input) => {
                                const r = await share.mutateAsync(input);
                                toast.success(
                                    guestInvitedNotice(input.email, {
                                        user_id: r.user_id,
                                        invited: r.pending,
                                        notified: true,
                                    }),
                                );
                            }}
                        />
                        {shares.isLoading ? (
                            <div className="imcrm-h-12 imcrm-animate-pulse imcrm-rounded-lg imcrm-bg-muted/40" />
                        ) : rows.length === 0 ? (
                            <p className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-3 imcrm-py-4 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Todavía no compartiste este registro con nadie de afuera.')}
                            </p>
                        ) : (
                            <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border">
                                {rows.map((s) => (
                                    <li key={s.id} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2" data-testid="record-share-row">
                                        <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                                            <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-truncate imcrm-text-sm imcrm-font-medium">
                                                {s.name}
                                                {s.pending && (
                                                    <Badge variant="warning" className="imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]">
                                                        {__('Invitación pendiente')}
                                                    </Badge>
                                                )}
                                            </span>
                                            <span className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{s.email}</span>
                                        </span>
                                        <GuestLevelSelect
                                            value={s.level}
                                            className="imcrm-h-8 imcrm-w-[140px]"
                                            label={sprintf(__('Acceso de %s'), s.name)}
                                            onChange={(level) => setLevel.mutate({ list: listId, recordId, shareId: s.id, level }, { onError: fail })}
                                        />
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={sprintf(__('Quitar el acceso de %s'), s.name)}
                                            className="imcrm-shrink-0 imcrm-text-muted-foreground"
                                            onClick={() => setLevel.mutate({ list: listId, recordId, shareId: s.id, level: null }, { onError: fail })}
                                        >
                                            <X className="imcrm-h-4 imcrm-w-4" />
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
