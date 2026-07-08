import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { CloudApiError } from '@/lib/cloud/client';
import { api, useSession } from '@/cloud/session';
import { useRealtime } from '@/cloud/useRealtime';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Shell del workspace: switcher de workspace + logout arriba, sidebar de
 * listas a la izquierda, contenido a la derecha (Outlet). El identificador
 * canónico en las queryKeys es el tenant_id numérico (HANDOFF §2.1).
 */
export function Shell(): JSX.Element {
    const memberships = useSession((s) => s.memberships);
    const activeTenantId = useSession((s) => s.activeTenantId);
    const setActiveTenant = useSession((s) => s.setActiveTenant);
    const clear = useSession((s) => s.clear);
    const navigate = useNavigate();
    const qc = useQueryClient();
    const [newList, setNewList] = useState('');
    const [error, setError] = useState<string | null>(null);

    // Realtime: la UI se actualiza sola ante mutaciones de otros usuarios.
    useRealtime();

    const lists = useQuery({
        queryKey: ['lists', activeTenantId],
        queryFn: () => api.listLists(),
        enabled: activeTenantId !== null,
    });

    const createList = useMutation({
        mutationFn: (name: string) => api.createList({ name }),
        onSuccess: (list) => {
            setNewList('');
            setError(null);
            void qc.invalidateQueries({ queryKey: ['lists', activeTenantId] });
            navigate(`/lists/${list.slug}`);
        },
        onError: (err) =>
            setError(err instanceof CloudApiError ? err.message : 'No se pudo crear la lista'),
    });

    async function logout(): Promise<void> {
        await api.logout().catch(() => undefined);
        clear();
        qc.clear();
    }

    return (
        <div className="imcrm-flex imcrm-h-screen imcrm-flex-col imcrm-bg-background imcrm-text-foreground">
            <header className="imcrm-flex imcrm-h-12 imcrm-shrink-0 imcrm-items-center imcrm-justify-between imcrm-border-b imcrm-border-border imcrm-px-4">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <span className="imcrm-text-sm imcrm-font-semibold imcrm-tracking-tight">
                        Imagina Base
                    </span>
                    {memberships.length > 0 && (
                        <select
                            aria-label="Workspace"
                            value={activeTenantId ?? ''}
                            onChange={(e) => {
                                setActiveTenant(Number(e.target.value));
                                void qc.invalidateQueries();
                                navigate('/lists');
                            }}
                            className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-py-1 imcrm-text-sm"
                        >
                            {memberships.map((m) => (
                                <option key={m.tenant_id} value={m.tenant_id}>
                                    {m.tenant_name}
                                </option>
                            ))}
                        </select>
                    )}
                </div>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                    <NavLink
                        to="/settings"
                        className="imcrm-rounded-md imcrm-px-2 imcrm-py-1 imcrm-text-sm imcrm-text-muted-foreground hover:imcrm-text-foreground"
                    >
                        Ajustes
                    </NavLink>
                    <Button variant="ghost" size="sm" onClick={logout}>
                        Salir
                    </Button>
                </div>
            </header>

            <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1">
                <aside className="imcrm-flex imcrm-w-64 imcrm-shrink-0 imcrm-flex-col imcrm-gap-1 imcrm-border-r imcrm-border-border imcrm-p-3">
                    <p className="imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        Listas
                    </p>
                    <nav className="imcrm-flex imcrm-flex-col imcrm-gap-0.5" data-testid="lists-nav">
                        {lists.data?.map((list) => (
                            <NavLink
                                key={list.id}
                                to={`/lists/${list.slug}`}
                                className={({ isActive }) =>
                                    [
                                        'imcrm-truncate imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-sm',
                                        isActive
                                            ? 'imcrm-bg-accent imcrm-font-medium imcrm-text-accent-foreground'
                                            : 'imcrm-text-foreground hover:imcrm-bg-muted',
                                    ].join(' ')
                                }
                            >
                                {list.name}
                            </NavLink>
                        ))}
                        {lists.data?.length === 0 && (
                            <p className="imcrm-px-2 imcrm-py-1 imcrm-text-sm imcrm-text-muted-foreground">
                                Sin listas todavía.
                            </p>
                        )}
                    </nav>

                    <form
                        className="imcrm-mt-3 imcrm-space-y-2"
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (newList.trim()) createList.mutate(newList.trim());
                        }}
                    >
                        <Input
                            value={newList}
                            onChange={(e) => setNewList(e.target.value)}
                            placeholder="Nueva lista…"
                            aria-label="Nueva lista"
                        />
                        <Button
                            type="submit"
                            size="sm"
                            className="imcrm-w-full"
                            disabled={createList.isPending || !newList.trim()}
                        >
                            + Crear lista
                        </Button>
                        {error && <p className="imcrm-text-xs imcrm-text-destructive">{error}</p>}
                    </form>
                </aside>

                <main className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-auto">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
