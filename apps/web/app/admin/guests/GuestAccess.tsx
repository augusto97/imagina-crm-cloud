import { useState } from 'react';
import { Loader2, MailPlus } from 'lucide-react';
import { GUEST_LEVELS, GUEST_LEVEL_LABELS, type GuestInviteResult, type GuestLevel } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
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
