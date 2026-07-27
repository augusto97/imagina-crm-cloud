import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download, Loader2, Trash2 } from 'lucide-react';

import { api, useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { __ } from '@/lib/i18n';

/**
 * v0.1.121 — Tus datos (GDPR art. 15 y 17).
 *
 * El borrado anonimiza la identidad pero CONSERVA lo que la persona escribió
 * dentro de cada empresa: esos registros son del cliente, no suyos. El texto
 * de la interfaz lo dice explícitamente para que nadie se lleve una sorpresa.
 */
export function PersonalDataCard(): JSX.Element {
    const toast = useToast();
    const user = useSession((s) => s.user);
    const [confirming, setConfirming] = useState(false);
    const [password, setPassword] = useState('');

    // Se consulta al entrar: si es el único admin de alguna empresa, el borrado
    // no va a poder completarse y conviene decirlo ANTES de pedir la contraseña.
    const blockers = useQuery({
        queryKey: ['deletion-blockers'],
        queryFn: () => api.deletionBlockers(),
        staleTime: 30_000,
    });

    const download = useMutation({
        mutationFn: () => api.exportPersonalData(),
        onSuccess: (data) => {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `imagina-base-mis-datos-${data.generated_at.slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        },
        onError: (e: unknown) =>
            toast.error(__('No se pudo generar la descarga'), e instanceof Error ? e.message : undefined),
    });

    const remove = useMutation({
        mutationFn: () => api.deleteAccount(password),
        onSuccess: () => {
            // La sesión ya está revocada del lado del servidor: recargar deja
            // al usuario en el login, que es lo que corresponde.
            window.location.assign('/');
        },
        onError: (e: unknown) =>
            toast.error(__('No se pudo borrar la cuenta'), e instanceof Error ? e.message : undefined),
    });

    const blocking = blockers.data?.workspaces ?? [];

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-8">
            <section className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                <div>
                    <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                        <Download className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                        {__('Descargar tus datos')}
                    </h2>
                    <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Un archivo JSON con tu cuenta, las empresas donde participás y lo que escribiste en cada una (comentarios, actividad, menciones, filtros y archivos subidos).')}
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    className="imcrm-self-start"
                    disabled={download.isPending}
                    onClick={() => download.mutate()}
                >
                    {download.isPending && <Loader2 className="imcrm-mr-2 imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                    {__('Descargar JSON')}
                </Button>
            </section>

            <section className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                <div>
                    <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                        <Trash2 className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                        {__('Borrar tu cuenta')}
                    </h2>
                    <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Se borran tu email, tu nombre, tu contraseña, tu segundo factor y tu acceso a todas las empresas. Es irreversible.')}
                    </p>
                    <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Lo que escribiste dentro de una empresa (registros, comentarios, historial) NO se borra: esos datos son de la empresa. Quedan atribuidos a «Usuario eliminado».')}
                    </p>
                </div>

                {blocking.length > 0 ? (
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-warning/30 imcrm-bg-warning/10 imcrm-p-4">
                        <AlertTriangle className="imcrm-mt-0.5 imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-text-warning" />
                        <div className="imcrm-text-sm">
                            <p className="imcrm-font-medium imcrm-text-foreground">
                                {__('Primero nombrá otro administrador')}
                            </p>
                            <p className="imcrm-text-muted-foreground">
                                {__('Sos el único administrador de')}{' '}
                                <strong>{blocking.map((w) => w.name).join(', ')}</strong>.{' '}
                                {__('Si te vas, nadie podría administrar esa empresa.')}
                            </p>
                        </div>
                    </div>
                ) : !confirming ? (
                    <Button
                        variant="outline"
                        size="sm"
                        className="imcrm-self-start imcrm-text-destructive"
                        onClick={() => setConfirming(true)}
                    >
                        <Trash2 className="imcrm-mr-2 imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Borrar mi cuenta')}
                    </Button>
                ) : (
                    <form
                        className="imcrm-flex imcrm-max-w-md imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-p-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (password !== '') remove.mutate();
                        }}
                    >
                        <p className="imcrm-text-sm imcrm-text-foreground">
                            {__('Vas a borrar la cuenta')} <strong>{user?.email}</strong>.{' '}
                            {__('Confirmá con tu contraseña.')}
                        </p>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="delete-pw">{__('Contraseña')}</Label>
                            <Input
                                id="delete-pw"
                                type="password"
                                autoComplete="current-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </div>
                        <div className="imcrm-flex imcrm-gap-2">
                            <Button
                                type="submit"
                                size="sm"
                                variant="destructive"
                                disabled={password === '' || remove.isPending}
                            >
                                {remove.isPending && (
                                    <Loader2 className="imcrm-mr-2 imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                                )}
                                {__('Borrar definitivamente')}
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setConfirming(false);
                                    setPassword('');
                                }}
                            >
                                {__('Cancelar')}
                            </Button>
                        </div>
                    </form>
                )}
            </section>
        </div>
    );
}
