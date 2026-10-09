import { useState } from 'react';
import { Loader2, MailPlus, RotateCw, UserPlus, X } from 'lucide-react';
import type { AddMemberResult, StaffRole } from '@imagina-base/shared';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { __ } from '@/lib/i18n';

/**
 * v0.1.240 — Piezas compartidas para gestionar el EQUIPO de una empresa: las
 * usan el panel de Miembros (admin de la empresa) y el detalle de empresa de la
 * consola de plataforma, así las dos superficies se comportan igual. Son
 * presentacionales: cada pantalla trae su propia capa de datos.
 */

export const STAFF_ROLES: StaffRole[] = ['admin', 'manager', 'agent', 'viewer'];
export const ROLE_LABELS: Record<string, string> = {
    admin: 'Admin',
    manager: 'Manager',
    agent: 'Agente',
    viewer: 'Lector',
    client: 'Cliente (portal)',
};

const ROLE_HINTS: Record<StaffRole, string> = {
    admin: 'Todo, incluidos miembros, plan y ajustes de la empresa',
    manager: 'Listas, campos, vistas y automatizaciones',
    agent: 'Trabaja con los registros según los permisos de cada lista',
    viewer: 'Sólo mira',
};

export function errorMessage(err: unknown, fallback = 'Error'): string {
    return err instanceof Error && err.message ? err.message : fallback;
}

/** Texto de confirmación tras sumar a alguien. */
export function addedNotice(r: AddMemberResult): string {
    if (r.invited) return `${__('Invitación enviada a')} ${r.email}. ${__('Va a aparecer como pendiente hasta que defina su contraseña.')}`;
    if (r.pending) return `${r.email} ${__('ya estaba invitado: le mandamos un enlace nuevo.')}`;
    return r.notified
        ? `${r.name} ${__('ya tenía cuenta: lo sumamos y le avisamos por correo.')}`
        : `${r.name} ${__('ya tenía cuenta: lo sumamos (el aviso por correo no salió).')}`;
}

export function RoleSelect({
    value,
    onChange,
    disabled,
    label,
    compact = false,
}: {
    value: StaffRole;
    onChange: (r: StaffRole) => void;
    disabled?: boolean;
    label: string;
    compact?: boolean;
}): JSX.Element {
    return (
        <select
            aria-label={label}
            value={value}
            onChange={(e) => onChange(e.target.value as StaffRole)}
            disabled={disabled}
            title={ROLE_HINTS[value]}
            className={
                compact
                    ? 'imcrm-h-8 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2 imcrm-text-sm'
                    : 'imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2 imcrm-text-sm'
            }
        >
            {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                </option>
            ))}
        </select>
    );
}

/**
 * Alta por email. Si la persona no tiene cuenta, se crea por invitación y le
 * llega un correo para definir su contraseña; el nombre es opcional.
 */
export function MemberInviteForm({
    onSubmit,
    idPrefix,
    stacked = false,
}: {
    onSubmit: (input: { email: string; name?: string; role: StaffRole }) => Promise<AddMemberResult>;
    idPrefix: string;
    /** Siempre en columna (paneles angostos, como el detalle de la consola). */
    stacked?: boolean;
}): JSX.Element {
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [role, setRole] = useState<StaffRole>('agent');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const submit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        if (!email.trim()) return;
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            const r = await onSubmit({ email: email.trim(), name: name.trim() || undefined, role });
            setEmail('');
            setName('');
            setNotice(addedNotice(r));
        } catch (err) {
            setError(errorMessage(err, __('No se pudo agregar')));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="imcrm-space-y-2">
            <form
                onSubmit={(e) => void submit(e)}
                className={
                    stacked
                        ? 'imcrm-grid imcrm-grid-cols-[minmax(0,1fr)_auto_auto] imcrm-items-end imcrm-gap-2 [&>div]:imcrm-col-span-3'
                        : 'imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] sm:imcrm-items-end'
                }
                data-testid="member-invite-form"
            >
                <div className="imcrm-space-y-1">
                    <label htmlFor={`${idPrefix}-email`} className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Email')}
                    </label>
                    <Input
                        id={`${idPrefix}-email`}
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="colega@empresa.com"
                    />
                </div>
                <div className="imcrm-space-y-1">
                    <label htmlFor={`${idPrefix}-name`} className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Nombre (si no tiene cuenta)')}
                    </label>
                    <Input
                        id={`${idPrefix}-name`}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={__('Opcional')}
                    />
                </div>
                <RoleSelect value={role} onChange={setRole} label={__('Rol')} />
                <Button type="submit" size="sm" className="imcrm-h-9 imcrm-gap-1.5" disabled={!email.trim() || busy}>
                    {busy ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <UserPlus className="imcrm-h-4 imcrm-w-4" />}
                    {__('Invitar')}
                </Button>
            </form>
            {error && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
            {notice && (
                <p role="status" className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-sm imcrm-text-success">
                    <MailPlus className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                    {notice}
                </p>
            )}
        </div>
    );
}

export interface MemberRowData {
    user_id: number;
    name: string;
    email: string;
    role: string;
    pending?: boolean;
    disabled?: boolean;
}

/**
 * Una persona del equipo: rol editable, "Invitación pendiente" + Reenviar, y
 * quitar con confirmación. Los clientes del portal se muestran sin controles
 * (su acceso vive en la ficha del registro).
 */
export function MemberRow({
    member,
    isSelf = false,
    onRole,
    onResend,
    onRemove,
    extra,
}: {
    member: MemberRowData;
    isSelf?: boolean;
    onRole: (role: StaffRole) => Promise<unknown>;
    onResend: () => Promise<unknown>;
    onRemove: () => Promise<unknown>;
    /** Acciones extra al final de la fila (p. ej. "Impersonar" en la consola). */
    extra?: React.ReactNode;
}): JSX.Element {
    const confirm = useConfirm();
    const [busy, setBusy] = useState<null | 'role' | 'resend' | 'remove'>(null);
    const [error, setError] = useState<string | null>(null);
    const [resent, setResent] = useState(false);
    const staff = member.role !== 'client';

    const run = async (kind: 'role' | 'resend' | 'remove', fn: () => Promise<unknown>): Promise<boolean> => {
        setBusy(kind);
        setError(null);
        try {
            await fn();
            return true;
        } catch (err) {
            setError(errorMessage(err));
            return false;
        } finally {
            setBusy(null);
        }
    };

    const remove = async (): Promise<void> => {
        const ok = await confirm({
            title: `${__('¿Quitar a')} ${member.name}?`,
            description: __('Deja de tener acceso a esta empresa al instante. Su cuenta y lo que escribió quedan; puedes volver a sumarla cuando quieras.'),
            confirmLabel: __('Quitar'),
            destructive: true,
        });
        if (ok) await run('remove', onRemove);
    };

    return (
        <li
            data-testid="member-row"
            data-email={member.email}
            className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-rounded-lg imcrm-px-2 imcrm-py-2 imcrm-transition-colors hover:imcrm-bg-muted/40"
        >
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-2.5">
                <Avatar name={member.name} />
                <div className="imcrm-min-w-0">
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                        <span className="imcrm-truncate">{member.name}</span>
                        {isSelf && <span className="imcrm-text-xs imcrm-font-normal imcrm-text-muted-foreground">({__('tú')})</span>}
                        {member.pending && (
                            <Badge variant="warning" className="imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]" data-testid="member-pending">
                                {__('Invitación pendiente')}
                            </Badge>
                        )}
                        {member.disabled && (
                            <Badge variant="destructive" className="imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]">
                                {__('Desactivada')}
                            </Badge>
                        )}
                    </div>
                    <div className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{member.email}</div>
                    {error && <div className="imcrm-text-xs imcrm-text-destructive">{error}</div>}
                </div>
            </div>
            <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1.5">
                {member.pending && staff && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="imcrm-h-8 imcrm-gap-1 imcrm-px-2 imcrm-text-xs"
                        disabled={busy !== null || resent}
                        onClick={() => void run('resend', onResend).then((ok) => ok && setResent(true))}
                        title={__('Manda un enlace nuevo para definir la contraseña (vence en 7 días)')}
                    >
                        {busy === 'resend' ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <RotateCw className="imcrm-h-3.5 imcrm-w-3.5" />}
                        {resent ? __('Reenviada') : __('Reenviar')}
                    </Button>
                )}
                {staff ? (
                    <RoleSelect
                        compact
                        value={member.role as StaffRole}
                        onChange={(r) => void run('role', () => onRole(r))}
                        disabled={busy !== null}
                        label={`${__('Rol de')} ${member.name}`}
                    />
                ) : (
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{ROLE_LABELS.client}</span>
                )}
                {extra}
                {!isSelf && staff && (
                    <button
                        type="button"
                        onClick={() => void remove()}
                        disabled={busy !== null}
                        aria-label={`${__('Quitar a')} ${member.name}`}
                        className="imcrm-inline-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive disabled:imcrm-opacity-50"
                    >
                        {busy === 'remove' ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <X className="imcrm-h-4 imcrm-w-4" />}
                    </button>
                )}
            </div>
        </li>
    );
}
