import { useState } from 'react';
import { KeyRound, Loader2, Pencil, Save, ShieldCheck, Trash2, UserPlus, Users, X } from 'lucide-react';
import type { PlatformUser } from '@imagina-base/shared';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    useCreatePlatformUser,
    useDeletePlatformUser,
    usePlatformUsers,
    useResetUserPassword,
    useSetUserDisabled,
    useUpdatePlatformUser,
} from '@/hooks/usePlatform';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Gestión de usuarios de la plataforma (operador, ADR-S15 F2): alta con
 * invitación por email, desactivar/reactivar (bloquea login + revoca sesiones)
 * y reset de contraseña. Los superadmin no se pueden desactivar.
 */
export function PlatformUsersCard(): JSX.Element {
    const users = usePlatformUsers();
    const create = useCreatePlatformUser();

    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [formError, setFormError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const submit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setFormError(null);
        setNotice(null);
        try {
            const u = await create.mutateAsync({ email: email.trim(), name: name.trim() });
            setEmail('');
            setName('');
            setNotice(`${__('Cuenta creada e invitación enviada a')} ${u.email}`);
        } catch (err) {
            setFormError(err instanceof ApiError || err instanceof Error ? err.message : __('Error desconocido'));
        }
    };

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-tone-violet/10 imcrm-text-tone-violet">
                        <Users className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div>
                        <CardTitle>{__('Usuarios')}</CardTitle>
                        <CardDescription>
                            {__('Todas las cuentas de la plataforma. Creá cuentas (se envía una invitación para definir contraseña), desactivá/reactivá o reseteá contraseñas.')}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-5">
                {/* Alta */}
                <form onSubmit={submit} className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-3 sm:imcrm-flex-row sm:imcrm-items-end">
                    <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-1.5">
                        <Label htmlFor="new-user-email">{__('Email')}</Label>
                        <Input
                            id="new-user-email"
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="persona@empresa.com"
                        />
                    </div>
                    <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-1.5">
                        <Label htmlFor="new-user-name">{__('Nombre')}</Label>
                        <Input
                            id="new-user-name"
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={__('Nombre y apellido')}
                        />
                    </div>
                    <Button type="submit" disabled={create.isPending} className="imcrm-gap-2">
                        {create.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <UserPlus className="imcrm-h-4 imcrm-w-4" />}
                        {__('Crear e invitar')}
                    </Button>
                </form>

                {formError !== null && (
                    <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                        {formError}
                    </div>
                )}
                {notice !== null && (
                    <div className="imcrm-rounded-md imcrm-border imcrm-border-emerald-500/40 imcrm-bg-emerald-500/10 imcrm-p-3 imcrm-text-sm imcrm-text-emerald-700 dark:imcrm-text-emerald-400">
                        {notice}
                    </div>
                )}

                {/* Tabla */}
                {users.isLoading ? (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                        {__('Cargando usuarios…')}
                    </div>
                ) : users.isError ? (
                    <p className="imcrm-py-6 imcrm-text-sm imcrm-text-destructive">{__('No se pudieron cargar los usuarios.')}</p>
                ) : (
                    <div className="imcrm-overflow-x-auto">
                        <table className="imcrm-w-full imcrm-border-collapse imcrm-text-sm">
                            <thead>
                                <tr className="imcrm-border-b imcrm-border-border imcrm-text-left imcrm-text-xs imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                                    <th className="imcrm-py-2 imcrm-pr-3 imcrm-font-medium">{__('Usuario')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium imcrm-text-center">{__('Workspaces')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Estado')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium imcrm-text-right">{__('Acciones')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(users.data ?? []).map((u) => (
                                    <UserRow key={u.id} user={u} onNotice={setNotice} onError={setFormError} />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

/** Fila de usuario: estado + acciones (editar nombre/email, reset, desactivar, borrar). */
function UserRow({
    user: u,
    onNotice,
    onError,
}: {
    user: PlatformUser;
    onNotice: (msg: string) => void;
    onError: (msg: string | null) => void;
}): JSX.Element {
    const setDisabled = useSetUserDisabled();
    const reset = useResetUserPassword();
    const update = useUpdatePlatformUser();
    const del = useDeletePlatformUser();

    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(u.name);
    const [email, setEmail] = useState(u.email);

    const fail = (err: unknown): void =>
        onError(err instanceof ApiError || err instanceof Error ? err.message : __('Error'));

    const doReset = async (): Promise<void> => {
        onError(null);
        try {
            await reset.mutateAsync(u.id);
            onNotice(`${__('Email de restablecimiento enviado a')} ${u.email}`);
        } catch (err) {
            fail(err);
        }
    };

    const saveEdit = async (): Promise<void> => {
        onError(null);
        try {
            await update.mutateAsync({ id: u.id, input: { name: name.trim(), email: email.trim() } });
            setEditing(false);
        } catch (err) {
            fail(err);
        }
    };

    const remove = async (): Promise<void> => {
        const typed = window.prompt(`${__('Esto borra la cuenta de forma irreversible. Escribí el email para confirmar:')}\n\n${u.email}`);
        if (typed === null) return;
        if (typed.trim().toLowerCase() !== u.email.toLowerCase()) {
            onError(__('El email no coincide; no se borró nada.'));
            return;
        }
        onError(null);
        try {
            await del.mutateAsync(u.id);
        } catch (err) {
            fail(err);
        }
    };

    const busy = update.isPending || del.isPending || setDisabled.isPending || reset.isPending;

    return (
        <tr className="imcrm-border-b imcrm-border-border/60 imcrm-transition-colors last:imcrm-border-b-0 hover:imcrm-bg-muted/30">
            <td className="imcrm-py-2.5 imcrm-pr-3">
                {editing ? (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Input value={name} onChange={(e) => setName(e.target.value)} className="imcrm-h-8" placeholder={__('Nombre')} />
                        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="imcrm-h-8" placeholder="email@empresa.com" />
                    </div>
                ) : (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2.5">
                        <Avatar name={u.name} />
                        <div className="imcrm-min-w-0">
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                <span className="imcrm-truncate imcrm-font-medium imcrm-text-foreground">{u.name}</span>
                                {u.is_superadmin && (
                                    <Badge className="imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]">
                                        <ShieldCheck className="imcrm-h-2.5 imcrm-w-2.5" /> {__('Superadmin')}
                                    </Badge>
                                )}
                            </div>
                            <div className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{u.email}</div>
                        </div>
                    </div>
                )}
            </td>
            <td className="imcrm-px-2 imcrm-py-2.5 imcrm-text-center imcrm-tabular-nums imcrm-text-muted-foreground">{u.workspaces}</td>
            <td className="imcrm-px-2 imcrm-py-2.5">
                {u.disabled ? (
                    <Badge variant="destructive" dot>{__('Desactivada')}</Badge>
                ) : (
                    <Badge variant="success" dot>{__('Activa')}</Badge>
                )}
            </td>
            <td className="imcrm-px-2 imcrm-py-3">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-end imcrm-gap-2">
                    {editing ? (
                        <>
                            <Button variant="outline" size="sm" className="imcrm-gap-1.5" disabled={busy} onClick={() => void saveEdit()}>
                                <Save className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Guardar')}
                            </Button>
                            <Button variant="ghost" size="sm" className="imcrm-gap-1.5" disabled={busy} onClick={() => { setEditing(false); setName(u.name); setEmail(u.email); }}>
                                <X className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Cancelar')}
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button variant="outline" size="sm" className="imcrm-gap-1.5" disabled={busy} onClick={() => setEditing(true)}>
                                <Pencil className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Editar')}
                            </Button>
                            <Button variant="outline" size="sm" className="imcrm-gap-1.5" disabled={busy} onClick={() => void doReset()}>
                                <KeyRound className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Reset')}
                            </Button>
                            {!u.is_superadmin && (
                                <>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className={cn(u.disabled ? 'imcrm-text-emerald-600 hover:imcrm-text-emerald-600' : 'imcrm-text-amber-600 hover:imcrm-text-amber-600')}
                                        disabled={busy}
                                        onClick={() => setDisabled.mutate({ id: u.id, disabled: !u.disabled })}
                                    >
                                        {u.disabled ? __('Reactivar') : __('Desactivar')}
                                    </Button>
                                    <Button variant="outline" size="sm" className="imcrm-gap-1.5 imcrm-text-destructive hover:imcrm-text-destructive" disabled={busy} onClick={() => void remove()}>
                                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Borrar')}
                                    </Button>
                                </>
                            )}
                        </>
                    )}
                </div>
            </td>
        </tr>
    );
}
