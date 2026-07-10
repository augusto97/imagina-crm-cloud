import { useState } from 'react';
import { KeyRound, Loader2, ShieldCheck, UserPlus, Users } from 'lucide-react';

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
    usePlatformUsers,
    useResetUserPassword,
    useSetUserDisabled,
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
    const setDisabled = useSetUserDisabled();
    const reset = useResetUserPassword();

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

    const toggle = (id: number, disabled: boolean): void => {
        setDisabled.mutate({ id, disabled });
    };

    const doReset = async (id: number, mail: string): Promise<void> => {
        setNotice(null);
        await reset.mutateAsync(id);
        setNotice(`${__('Email de restablecimiento enviado a')} ${mail}`);
    };

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <Users className="imcrm-mt-0.5 imcrm-h-5 imcrm-w-5 imcrm-text-muted-foreground" />
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
                                    <tr key={u.id} className="imcrm-border-b imcrm-border-border/60 last:imcrm-border-b-0">
                                        <td className="imcrm-py-3 imcrm-pr-3">
                                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                                <span className="imcrm-font-medium imcrm-text-foreground">{u.name}</span>
                                                {u.is_superadmin && (
                                                    <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-bg-primary/10 imcrm-px-2 imcrm-py-0.5 imcrm-text-xs imcrm-font-medium imcrm-text-primary">
                                                        <ShieldCheck className="imcrm-h-3 imcrm-w-3" /> {__('Superadmin')}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="imcrm-text-xs imcrm-text-muted-foreground">{u.email}</div>
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-3 imcrm-text-center imcrm-tabular-nums imcrm-text-muted-foreground">
                                            {u.workspaces}
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-3">
                                            <span
                                                className={cn(
                                                    'imcrm-inline-flex imcrm-rounded-full imcrm-px-2 imcrm-py-0.5 imcrm-text-xs imcrm-font-medium',
                                                    u.disabled
                                                        ? 'imcrm-bg-red-500/10 imcrm-text-red-600 dark:imcrm-text-red-400'
                                                        : 'imcrm-bg-emerald-500/10 imcrm-text-emerald-600 dark:imcrm-text-emerald-400',
                                                )}
                                            >
                                                {u.disabled ? __('Desactivada') : __('Activa')}
                                            </span>
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-3">
                                            <div className="imcrm-flex imcrm-items-center imcrm-justify-end imcrm-gap-2">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="imcrm-gap-1.5"
                                                    disabled={reset.isPending}
                                                    onClick={() => void doReset(u.id, u.email)}
                                                >
                                                    <KeyRound className="imcrm-h-3.5 imcrm-w-3.5" />
                                                    {__('Reset')}
                                                </Button>
                                                {!u.is_superadmin && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className={cn(
                                                            u.disabled
                                                                ? 'imcrm-text-emerald-600 hover:imcrm-text-emerald-600'
                                                                : 'imcrm-text-destructive hover:imcrm-text-destructive',
                                                        )}
                                                        disabled={setDisabled.isPending}
                                                        onClick={() => toggle(u.id, !u.disabled)}
                                                    >
                                                        {u.disabled ? __('Reactivar') : __('Desactivar')}
                                                    </Button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
