import { useState } from 'react';
import { ArrowUpCircle, FileText, List as ListIcon, Loader2, RotateCw, UserRoundPlus, X } from 'lucide-react';
import { GUEST_LEVELS, GUEST_LEVEL_LABELS, type GuestLevel, type GuestSummary, type StaffRole } from '@imagina-base/shared';
import { useQueryClient } from '@tanstack/react-query';

import { api as cloudApi, useSession } from '@/cloud/session';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useRemoveGuest, useResendGuestInvite, useSetListGuestLevel, useSetRecordShareLevel, useWorkspaceGuests } from '@/hooks/useGuests';
import { __, _n, sprintf } from '@/lib/i18n';

import { ROLE_LABELS } from './MemberControls';

/**
 * C3 — Ajustes → Miembros → «Invitados». Las personas de afuera con algo
 * compartido: cada lista y cada registro con su nivel (cambiarlo o quitarlo),
 * reenviar la invitación, pasarla a miembro (ahí sí ocupa un usuario del
 * plan) o quitarla de la empresa con todo lo compartido.
 */
export function GuestsPanel(): JSX.Element {
    const guests = useWorkspaceGuests();
    const data = guests.data ?? [];
    return (
        <Card data-testid="imcrm-guests-panel">
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <UserRoundPlus className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div>
                        <CardTitle>{__('Invitados')}</CardTitle>
                        <CardDescription>
                            {__(
                                'Personas de afuera —un proveedor, un freelancer, el contador— que ven SÓLO lo que les compartiste: una lista entera o algunos registros. No ocupan un usuario de tu plan. Se invitan desde «Compartir» de cada lista o registro.',
                            )}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-space-y-2 imcrm-pt-0">
                {guests.isLoading && <div className="imcrm-h-16 imcrm-animate-pulse imcrm-rounded-lg imcrm-bg-muted/40" />}
                {!guests.isLoading && data.length === 0 && (
                    <p className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-5 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Todavía no compartiste nada con personas de afuera.')}
                    </p>
                )}
                {data.length > 0 && (
                    <ul className="imcrm-space-y-2">
                        {data.map((g) => (
                            <GuestRow key={g.user_id} guest={g} />
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}

function LevelSelect({ value, onChange, label, disabled }: { value: GuestLevel; onChange: (l: GuestLevel) => void; label: string; disabled?: boolean }): JSX.Element {
    return (
        <select
            aria-label={label}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value as GuestLevel)}
            className="imcrm-h-7 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-1.5 imcrm-text-xs"
            data-testid="guest-level-select"
        >
            {GUEST_LEVELS.map((l) => (
                <option key={l} value={l}>
                    {__(GUEST_LEVEL_LABELS[l])}
                </option>
            ))}
        </select>
    );
}

function GuestRow({ guest }: { guest: GuestSummary }): JSX.Element {
    const confirm = useConfirm();
    const toast = useToast();
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const remove = useRemoveGuest();
    const resend = useResendGuestInvite();
    const setRecordLevel = useSetRecordShareLevel();
    const [promoteRole, setPromoteRole] = useState<StaffRole | ''>('');
    const [busy, setBusy] = useState(false);

    const fail = (err: unknown, fallback: string): void => {
        toast.error(fallback, err instanceof Error ? err.message : undefined);
    };

    const removeAll = async (): Promise<void> => {
        const ok = await confirm({
            title: sprintf(__('¿Quitar a %s?'), guest.name),
            description: __('Deja de ver todo lo que le compartiste, al instante. Su cuenta queda (puede ser invitada de otras empresas).'),
            confirmLabel: __('Quitar'),
            destructive: true,
        });
        if (!ok) return;
        try {
            await remove.mutateAsync(guest.user_id);
        } catch (err) {
            fail(err, __('No se pudo quitar.'));
        }
    };

    const promote = async (role: StaffRole): Promise<void> => {
        const ok = await confirm({
            title: sprintf(__('¿Pasar a %s a miembro?'), guest.name),
            description: sprintf(
                __('Pasa a ser parte del equipo con el rol «%s» y ocupa un usuario de tu plan. Los registros sueltos que le compartiste dejan de aplicar: verá lo que su rol le deja ver; las listas compartidas siguen como acceso por persona.'),
                ROLE_LABELS[role] ?? role,
            ),
            confirmLabel: __('Pasar a miembro'),
        });
        if (!ok) {
            setPromoteRole('');
            return;
        }
        setBusy(true);
        try {
            await cloudApi.updateMemberRole(guest.user_id, { role });
            await Promise.all([
                qc.invalidateQueries({ queryKey: ['guests'] }),
                qc.invalidateQueries({ queryKey: ['members', tenantId] }),
            ]);
            toast.success(sprintf(__('%s ahora es miembro.'), guest.name));
        } catch (err) {
            fail(err, __('No se pudo pasar a miembro.'));
        } finally {
            setBusy(false);
            setPromoteRole('');
        }
    };

    return (
        <li data-testid="guest-row" data-email={guest.email} className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2.5">
                <Avatar name={guest.name} />
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                        <span className="imcrm-truncate">{guest.name}</span>
                        <Badge variant="secondary" className="imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]">
                            {__('Invitado')}
                        </Badge>
                        {guest.pending && (
                            <Badge variant="warning" className="imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]">
                                {__('Invitación pendiente')}
                            </Badge>
                        )}
                    </div>
                    <div className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{guest.email}</div>
                </div>
                <div className="imcrm-flex imcrm-shrink-0 imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                    {guest.pending && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="imcrm-h-8 imcrm-gap-1 imcrm-px-2 imcrm-text-xs"
                            disabled={resend.isPending || resend.isSuccess}
                            onClick={() => resend.mutate(guest.user_id, { onError: (e) => fail(e, __('No se pudo reenviar.')) })}
                        >
                            <RotateCw className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {resend.isSuccess ? __('Reenviada') : __('Reenviar')}
                        </Button>
                    )}
                    <label className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground" title={__('Ocupa un usuario de tu plan')}>
                        <ArrowUpCircle className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        <select
                            aria-label={sprintf(__('Pasar a %s a miembro'), guest.name)}
                            value={promoteRole}
                            disabled={busy}
                            data-testid="guest-promote"
                            onChange={(e) => {
                                const r = e.target.value as StaffRole | '';
                                setPromoteRole(r);
                                if (r) void promote(r);
                            }}
                            className="imcrm-h-8 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-1.5 imcrm-text-xs"
                        >
                            <option value="">{__('Pasar a miembro…')}</option>
                            {(['viewer', 'agent', 'manager'] as StaffRole[]).map((r) => (
                                <option key={r} value={r}>
                                    {ROLE_LABELS[r]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <button
                        type="button"
                        onClick={() => void removeAll()}
                        aria-label={sprintf(__('Quitar a %s'), guest.name)}
                        className="imcrm-inline-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                    >
                        {remove.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <X className="imcrm-h-4 imcrm-w-4" />}
                    </button>
                </div>
            </div>
            <p className="imcrm-mt-2 imcrm-text-xs imcrm-text-muted-foreground">
                {sprintf(
                    __('%1$s y %2$s compartidos'),
                    sprintf(_n('%d lista', '%d listas', guest.lists.length), guest.lists.length),
                    sprintf(_n('%d registro', '%d registros', guest.records.length), guest.records.length),
                )}
            </p>
            {(guest.lists.length > 0 || guest.records.length > 0) && (
                <ul className="imcrm-mt-1.5 imcrm-space-y-1">
                    {guest.lists.map((l) => (
                        <GuestListShareRow key={`l-${l.list_id}`} guestId={guest.user_id} share={l} />
                    ))}
                    {guest.records.map((r) => (
                        <li key={`r-${r.share_id}`} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm" data-testid="guest-record-share">
                            <FileText className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                            <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">
                                <a href={`#/lists/${r.list_slug}/records/${r.record_id}`} className="hover:imcrm-underline">
                                    {r.title}
                                </a>
                                <span className="imcrm-text-xs imcrm-text-muted-foreground"> · {r.list_name}</span>
                            </span>
                            <LevelSelect
                                value={r.level}
                                label={sprintf(__('Nivel en «%s»'), r.title)}
                                onChange={(level) =>
                                    setRecordLevel.mutate(
                                        { list: r.list_id, recordId: r.record_id, shareId: r.share_id, level },
                                        { onError: (e) => fail(e, __('No se pudo cambiar el nivel.')) },
                                    )
                                }
                            />
                            <button
                                type="button"
                                aria-label={sprintf(__('Dejar de compartir «%s»'), r.title)}
                                onClick={() =>
                                    setRecordLevel.mutate(
                                        { list: r.list_id, recordId: r.record_id, shareId: r.share_id, level: null },
                                        { onError: (e) => fail(e, __('No se pudo quitar.')) },
                                    )
                                }
                                className="imcrm-inline-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-text-destructive"
                            >
                                <X className="imcrm-h-3.5 imcrm-w-3.5" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </li>
    );
}

function GuestListShareRow({
    guestId,
    share,
}: {
    guestId: number;
    share: GuestSummary['lists'][number];
}): JSX.Element {
    const setLevel = useSetListGuestLevel(share.list_id);
    const toast = useToast();
    const fail = (err: unknown): void => {
        toast.error(__('No se pudo cambiar el acceso.'), err instanceof Error ? err.message : undefined);
    };
    return (
        <li className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm" data-testid="guest-list-share">
            <ListIcon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
            <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">
                <a href={`#/lists/${share.list_slug}/records`} className="hover:imcrm-underline">
                    {share.list_name}
                </a>
                <span className="imcrm-text-xs imcrm-text-muted-foreground"> · {__('lista entera')}</span>
            </span>
            <LevelSelect
                value={share.level}
                label={sprintf(__('Nivel en «%s»'), share.list_name)}
                onChange={(level) => setLevel.mutate({ userId: guestId, level }, { onError: fail })}
            />
            <button
                type="button"
                aria-label={sprintf(__('Dejar de compartir «%s»'), share.list_name)}
                onClick={() => setLevel.mutate({ userId: guestId, level: null }, { onError: fail })}
                className="imcrm-inline-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-text-destructive"
            >
                <X className="imcrm-h-3.5 imcrm-w-3.5" />
            </button>
        </li>
    );
}
