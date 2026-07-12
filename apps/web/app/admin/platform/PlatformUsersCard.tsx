import { useEffect, useState } from 'react';
import { KeyRound, Loader2, MoreHorizontal, Pencil, Save, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Sheet,
    SheetBody,
    SheetCloseButton,
    SheetContent,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
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

/**
 * Gestión de usuarios de la plataforma (operador, ADR-S15 F2): alta con
 * invitación por email, edición en panel lateral, desactivar/reactivar
 * (bloquea login + revoca sesiones), reset de contraseña y borrado. Los
 * superadmin no se pueden desactivar ni borrar.
 */
export function PlatformUsersCard(): JSX.Element {
    const users = usePlatformUsers();
    const create = useCreatePlatformUser();
    const setDisabled = useSetUserDisabled();
    const reset = useResetUserPassword();
    const del = useDeletePlatformUser();

    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [formError, setFormError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [sheetUserId, setSheetUserId] = useState<number | null>(null);

    const sheetUser = (users.data ?? []).find((u) => u.id === sheetUserId) ?? null;

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

    const fail = (err: unknown): void =>
        setFormError(err instanceof ApiError || err instanceof Error ? err.message : __('Error'));

    const doReset = async (u: PlatformUser): Promise<void> => {
        setFormError(null);
        setNotice(null);
        try {
            await reset.mutateAsync(u.id);
            setNotice(`${__('Email de restablecimiento enviado a')} ${u.email}`);
        } catch (err) {
            fail(err);
        }
    };

    const doRemove = async (u: PlatformUser): Promise<void> => {
        const typed = window.prompt(`${__('Esto borra la cuenta de forma irreversible. Escribí el email para confirmar:')}\n\n${u.email}`);
        if (typed === null) return;
        if (typed.trim().toLowerCase() !== u.email.toLowerCase()) {
            setFormError(__('El email no coincide; no se borró nada.'));
            return;
        }
        setFormError(null);
        try {
            await del.mutateAsync(u.id);
            if (sheetUserId === u.id) setSheetUserId(null);
        } catch (err) {
            fail(err);
        }
    };

    const rowBusy = setDisabled.isPending || reset.isPending || del.isPending;

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <Users className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div>
                        <CardTitle>{__('Usuarios')}</CardTitle>
                        <CardDescription>
                            {__('Todas las cuentas de la plataforma. Creá cuentas (se envía una invitación para definir contraseña), editá, desactivá o reseteá contraseñas.')}
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
                    <div className="imcrm-rounded-md imcrm-border imcrm-border-success/25 imcrm-bg-success/10 imcrm-p-3 imcrm-text-sm imcrm-text-success">
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
                                    <tr key={u.id} className="imcrm-border-b imcrm-border-border/60 imcrm-transition-colors last:imcrm-border-b-0 hover:imcrm-bg-muted/30">
                                        <td className="imcrm-py-2.5 imcrm-pr-3">
                                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2.5">
                                                <Avatar name={u.name} />
                                                <div className="imcrm-min-w-0">
                                                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                                        <button
                                                            type="button"
                                                            onClick={() => setSheetUserId(u.id)}
                                                            className="imcrm-truncate imcrm-font-medium imcrm-text-foreground hover:imcrm-text-primary hover:imcrm-underline"
                                                        >
                                                            {u.name}
                                                        </button>
                                                        {u.is_superadmin && (
                                                            <Badge className="imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]">
                                                                <ShieldCheck className="imcrm-h-2.5 imcrm-w-2.5" /> {__('Superadmin')}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <div className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{u.email}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-2.5 imcrm-text-center imcrm-tabular-nums imcrm-text-muted-foreground">{u.workspaces}</td>
                                        <td className="imcrm-px-2 imcrm-py-2.5">
                                            {u.disabled ? (
                                                <Badge variant="destructive" dot>{__('Desactivada')}</Badge>
                                            ) : (
                                                <Badge variant="success" dot>{__('Activa')}</Badge>
                                            )}
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-2.5">
                                            <div className="imcrm-flex imcrm-items-center imcrm-justify-end imcrm-gap-1">
                                                <Button variant="ghost" size="sm" className="imcrm-gap-1" disabled={rowBusy} onClick={() => setSheetUserId(u.id)}>
                                                    <Pencil className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Editar')}
                                                </Button>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="sm" aria-label={`${__('Acciones de')} ${u.name}`}>
                                                            <MoreHorizontal className="imcrm-h-4 imcrm-w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem onSelect={() => void doReset(u)}>
                                                            <KeyRound className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" /> {__('Enviar reset de contraseña')}
                                                        </DropdownMenuItem>
                                                        {!u.is_superadmin && (
                                                            <>
                                                                <DropdownMenuItem onSelect={() => setDisabled.mutate({ id: u.id, disabled: !u.disabled })}>
                                                                    <ShieldCheck className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" />
                                                                    {u.disabled ? __('Reactivar cuenta') : __('Desactivar cuenta')}
                                                                </DropdownMenuItem>
                                                                <DropdownMenuSeparator />
                                                                <DropdownMenuItem
                                                                    className="imcrm-text-destructive focus:imcrm-text-destructive"
                                                                    onSelect={() => {
                                                                        // El prompt es síncrono; diferir para no romper el cierre del menú.
                                                                        setTimeout(() => void doRemove(u), 0);
                                                                    }}
                                                                >
                                                                    <Trash2 className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" /> {__('Borrar…')}
                                                                </DropdownMenuItem>
                                                            </>
                                                        )}
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>

            <UserSheet user={sheetUser} onClose={() => setSheetUserId(null)} />
        </Card>
    );
}

/** Panel lateral de edición de una cuenta (nombre + email). */
function UserSheet({ user, onClose }: { user: PlatformUser | null; onClose: () => void }): JSX.Element {
    const update = useUpdatePlatformUser();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setName(user?.name ?? '');
        setEmail(user?.email ?? '');
        setError(null);
    }, [user]);

    const save = async (): Promise<void> => {
        if (!user) return;
        setError(null);
        try {
            await update.mutateAsync({ id: user.id, input: { name: name.trim(), email: email.trim() } });
            onClose();
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : __('Error'));
        }
    };

    return (
        <Sheet open={user !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
            <SheetContent aria-describedby={undefined}>
                <SheetHeader>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                        {user && <Avatar name={user.name} />}
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <SheetTitle className="imcrm-truncate">{user?.name ?? __('Usuario')}</SheetTitle>
                            {user?.is_superadmin && (
                                <Badge className="imcrm-mt-0.5 imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]">
                                    <ShieldCheck className="imcrm-h-2.5 imcrm-w-2.5" /> {__('Superadmin')}
                                </Badge>
                            )}
                        </div>
                        <SheetCloseButton aria-label={__('Cerrar')} />
                    </div>
                </SheetHeader>
                <SheetBody className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <Label htmlFor="us-name" className="imcrm-text-xs">{__('Nombre')}</Label>
                        <Input id="us-name" value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <Label htmlFor="us-email" className="imcrm-text-xs">{__('Email')}</Label>
                        <Input id="us-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                    </div>
                    {error !== null && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
                </SheetBody>
                <SheetFooter className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={update.isPending}>
                        {__('Cancelar')}
                    </Button>
                    <Button
                        size="sm"
                        className="imcrm-gap-1.5"
                        disabled={update.isPending || name.trim() === '' || email.trim() === ''}
                        onClick={() => void save()}
                    >
                        {update.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Save className="imcrm-h-4 imcrm-w-4" />}
                        {__('Guardar')}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}
