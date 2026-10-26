import { useState } from 'react';
import { Loader2, MailPlus, UserRoundPlus, X } from 'lucide-react';
import { GUEST_LEVELS, GUEST_LEVEL_LABELS, type GuestInviteResult, type GuestLevel } from '@imagina-base/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useListGuests, useSetListGuestLevel, useShareListWithGuest } from '@/hooks/useGuests';
import { __, sprintf } from '@/lib/i18n';

/** Qué deja hacer cada nivel, en una línea. */
export const GUEST_LEVEL_HINTS: Record<GuestLevel, string> = {
    view: 'Mira, sin cambiar nada.',
    comment: 'Mira y deja comentarios.',
    edit: 'Mira, comenta y cambia los datos (nunca borra).',
};

export function GuestLevelSelect({
    value,
    onChange,
    label,
    className,
    disabled,
}: {
    value: GuestLevel;
    onChange: (l: GuestLevel) => void;
    label: string;
    className?: string;
    disabled?: boolean;
}): JSX.Element {
    return (
        <Select
            value={value}
            onChange={(e) => onChange(e.target.value as GuestLevel)}
            aria-label={label}
            className={className ?? 'imcrm-h-9 imcrm-w-[150px]'}
            disabled={disabled}
            title={__(GUEST_LEVEL_HINTS[value])}
            data-testid="guest-level"
        >
            {GUEST_LEVELS.map((l) => (
                <option key={l} value={l}>
                    {__(GUEST_LEVEL_LABELS[l])}
                </option>
            ))}
        </Select>
    );
}

/** Texto tras invitar: cuenta nueva (correo de invitación) o existente (aviso). */
export function guestInvitedNotice(email: string, r: GuestInviteResult): string {
    if (r.invited) return sprintf(__('Le mandamos a %s una invitación para entrar.'), email);
    return r.notified
        ? sprintf(__('%s ya tenía cuenta: le avisamos por correo.'), email)
        : sprintf(__('%s ya tenía cuenta: ya puede entrar (el aviso por correo no salió).'), email);
}

/**
 * C3 — Formulario para invitar a alguien de AFUERA por email con un nivel.
 * Lo usan «Compartir» de la lista y «Compartir este registro».
 */
export function GuestInviteForm({
    onInvite,
    idPrefix,
    busy,
}: {
    onInvite: (input: { email: string; level: GuestLevel }) => Promise<void>;
    idPrefix: string;
    busy?: boolean;
}): JSX.Element {
    const [email, setEmail] = useState('');
    const [level, setLevel] = useState<GuestLevel>('view');
    const [error, setError] = useState<string | null>(null);
    const submit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        if (!email.trim()) return;
        setError(null);
        try {
            await onInvite({ email: email.trim(), level });
            setEmail('');
        } catch (err) {
            setError(err instanceof Error ? err.message : __('No se pudo compartir.'));
        }
    };
    return (
        <form onSubmit={(e) => void submit(e)} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid="guest-invite-form">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Input
                    id={`${idPrefix}-guest-email`}
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={__('correo@deafuera.com')}
                    aria-label={__('Correo de la persona invitada')}
                    className="imcrm-h-9 imcrm-min-w-[180px] imcrm-flex-1"
                />
                <GuestLevelSelect value={level} onChange={setLevel} label={__('Nivel de acceso de la persona invitada')} />
                <Button type="submit" size="sm" className="imcrm-h-9 imcrm-gap-1.5" disabled={!email.trim() || busy}>
                    {busy ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <MailPlus className="imcrm-h-4 imcrm-w-4" />}
                    {__('Invitar')}
                </Button>
            </div>
            {error && <p className="imcrm-text-xs imcrm-text-destructive">{error}</p>}
        </form>
    );
}

/**
 * C3 — Compartir la LISTA entera con personas de afuera (Compartir → Con tu
 * equipo → «Personas de afuera»). No ocupan un usuario del plan.
 */
export function ListGuestAccess({ listId }: { listId: number }): JSX.Element {
    const guests = useListGuests(listId);
    const share = useShareListWithGuest(listId);
    const setLevel = useSetListGuestLevel(listId);
    const toast = useToast();
    const rows = guests.data ?? [];
    const fail = (err: unknown): void => {
        toast.error(__('No se pudo cambiar el acceso.'), err instanceof Error ? err.message : undefined);
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="list-guest-access">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <h3 className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-semibold">
                    <UserRoundPlus className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                    {__('Personas de afuera')}
                </h3>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Un proveedor, un freelancer o el contador: ven sólo esta lista (nada más de la empresa) y no ocupan un usuario de tu plan.')}
                </p>
            </div>
            <GuestInviteForm
                idPrefix={`list-${listId}`}
                busy={share.isPending}
                onInvite={async (input) => {
                    const r = await share.mutateAsync(input);
                    toast.success(guestInvitedNotice(input.email, r));
                }}
            />
            {rows.length > 0 && (
                <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border">
                    {rows.map((g) => (
                        <li key={g.user_id} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2" data-testid="list-guest-row">
                            <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                                <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-truncate imcrm-text-sm imcrm-font-medium">
                                    {g.name}
                                    <Badge variant="secondary" className="imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]">
                                        {g.pending ? __('Invitación pendiente') : __('Invitado')}
                                    </Badge>
                                </span>
                                <span className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{g.email}</span>
                            </span>
                            <GuestLevelSelect
                                value={g.level}
                                className="imcrm-h-8 imcrm-w-[140px]"
                                label={sprintf(__('Acceso de %s'), g.name)}
                                onChange={(level) => setLevel.mutate({ userId: g.user_id, level }, { onError: fail })}
                            />
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label={sprintf(__('Quitar el acceso de %s'), g.name)}
                                className="imcrm-shrink-0 imcrm-text-muted-foreground"
                                onClick={() => setLevel.mutate({ userId: g.user_id, level: null }, { onError: fail })}
                            >
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
