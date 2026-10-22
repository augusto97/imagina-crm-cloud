import { useEffect, useState } from 'react';
import { Building2, Loader2, LogIn, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api as cloudApi } from '@/cloud/session';

interface Props {
    email: string;
    name: string;
    /** Sesión vieja sin contraseña: la consola no la acepta hasta reingresar. */
    needsReauth: boolean;
    /** Ya es miembro de una empresa: hay que releer la sesión. */
    onDone: () => void;
}

interface TenantOption {
    id: number;
    name: string;
    slug: string;
}

/**
 * v0.1.293 — Un superadmin sin ninguna empresa no podía abrir la app (ni la
 * consola de Plataforma, que vive adentro) y nadie podía devolverle una: las
 * invitaciones lo rechazan por ser un correo reservado. Aquí se crea una
 * empresa propia o se suma a una existente, con los MISMOS endpoints de la
 * consola (sólo superadmins con sesión de contraseña).
 */
export function SuperadminWorkspaceSetup({ email, name, needsReauth, onDone }: Props): JSX.Element {
    const [workspaceName, setWorkspaceName] = useState('');
    const [search, setSearch] = useState('');
    const [options, setOptions] = useState<TenantOption[]>([]);
    // Arranca "buscando": la primera consulta sale al montar y, hasta que
    // vuelve, «No hay empresas» sería mentira.
    const [searching, setSearching] = useState(!needsReauth);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (needsReauth) return;
        let alive = true;
        const t = setTimeout(() => {
            setSearching(true);
            cloudApi
                .platformTenantsSearch(search)
                .then((rows) => {
                    if (alive) setOptions(rows);
                })
                .catch(() => {
                    if (alive) setOptions([]);
                })
                .finally(() => {
                    if (alive) setSearching(false);
                });
        }, 250);
        return () => {
            alive = false;
            clearTimeout(t);
        };
    }, [search, needsReauth]);

    const run = async (key: string, action: () => Promise<void>): Promise<void> => {
        setBusy(key);
        setError(null);
        try {
            await action();
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo completar la acción.');
            setBusy(null);
        }
    };

    if (needsReauth) {
        return (
            <p className="imcrm-mt-3 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-3 imcrm-text-muted-foreground">
                Eres superadmin de la plataforma. Por seguridad, cierra sesión y vuelve a entrar con tu contraseña:
                después podrás crear tu empresa o sumarte a una desde aquí.
            </p>
        );
    }

    const create = (): void => {
        const ws = workspaceName.trim();
        if (!ws) return;
        void run('create', () => cloudApi.platformCreateOwnTenant({ workspace_name: ws, admin_email: email, admin_name: name || email }));
    };

    return (
        <div className="imcrm-mt-3 imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="superadmin-workspace-setup">
            <p className="imcrm-text-muted-foreground">
                Eres superadmin de la plataforma: puedes crearte una empresa o sumarte como administrador a una que ya
                existe.
            </p>

            <form
                className="imcrm-flex imcrm-flex-col imcrm-gap-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    create();
                }}
            >
                <label htmlFor="sa-new-ws" className="imcrm-text-xs imcrm-font-semibold imcrm-text-foreground">
                    Crear una empresa
                </label>
                <div className="imcrm-flex imcrm-gap-2">
                    <Input
                        id="sa-new-ws"
                        value={workspaceName}
                        onChange={(e) => setWorkspaceName(e.target.value)}
                        placeholder="Nombre de la empresa"
                        maxLength={120}
                        disabled={busy !== null}
                    />
                    <Button type="submit" className="imcrm-shrink-0 imcrm-gap-1" disabled={busy !== null || !workspaceName.trim()}>
                        {busy === 'create' ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Plus className="imcrm-h-4 imcrm-w-4" />}
                        Crear
                    </Button>
                </div>
            </form>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                <label htmlFor="sa-join-ws" className="imcrm-text-xs imcrm-font-semibold imcrm-text-foreground">
                    Sumarme a una empresa existente
                </label>
                <Input
                    id="sa-join-ws"
                    value={search}
                    onChange={(e) => {
                        setSearch(e.target.value);
                        setSearching(true);
                    }}
                    placeholder="Buscar por nombre…"
                    disabled={busy !== null}
                />
                <ul className="imcrm-flex imcrm-max-h-56 imcrm-flex-col imcrm-gap-1 imcrm-overflow-y-auto">
                    {searching && options.length === 0 && (
                        <li className="imcrm-text-xs imcrm-text-muted-foreground" aria-live="polite">
                            Buscando…
                        </li>
                    )}
                    {!searching && options.length === 0 && (
                        <li className="imcrm-text-xs imcrm-text-muted-foreground">No hay empresas que coincidan.</li>
                    )}
                    {options.map((t) => (
                        <li
                            key={t.id}
                            className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-1.5 imcrm-py-1 hover:imcrm-bg-muted/40"
                            data-testid="superadmin-join-row"
                        >
                            <Building2 className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
                            <div className="imcrm-min-w-0 imcrm-flex-1">
                                <div className="imcrm-truncate imcrm-font-medium">{t.name}</div>
                                <div className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{t.slug}</div>
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                className="imcrm-h-7 imcrm-shrink-0 imcrm-gap-1 imcrm-text-xs"
                                disabled={busy !== null}
                                onClick={() => void run(`join-${t.id}`, () => cloudApi.platformJoinTenant(t.id, email))}
                            >
                                {busy === `join-${t.id}` ? (
                                    <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                                ) : (
                                    <LogIn className="imcrm-h-3.5 imcrm-w-3.5" />
                                )}
                                Sumarme
                            </Button>
                        </li>
                    ))}
                </ul>
            </div>

            {error && (
                <p role="alert" className="imcrm-text-xs imcrm-text-destructive">
                    {error}
                </p>
            )}
        </div>
    );
}
