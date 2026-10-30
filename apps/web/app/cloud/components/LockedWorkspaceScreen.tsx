import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Loader2, LogOut, PauseCircle, RefreshCw } from 'lucide-react';
import type { MembershipSummary } from '@imagina-base/shared';

import { getBootData } from '@/lib/boot';
import { api as listsApi } from '@/lib/api';
import { api, useSession } from '@/cloud/session';
import { switchWorkspace } from '@/cloud/workspaceSwitch';
import { SubscriptionPanel } from '@/cloud/components/SubscriptionPanel';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/tenantFormat';

interface ListRow {
    id: number;
    slug: string;
    name: string;
}

/**
 * v0.1.338 (ADR-S87) — La empresa está PAUSADA: terminó la prueba o venció el
 * plan sin renovarse (con la política "pausar"). En vez de la app, esto:
 * elegir un plan y pagar (admin), descargar los datos (ADR-S09: nunca se
 * secuestran) y moverse a otra empresa o salir. Al pagar, `/auth/me` trae la
 * empresa con acceso y la app se monta sola.
 */
export function LockedWorkspaceScreen({ membership }: { membership: MembershipSummary }): JSX.Element {
    const memberships = useSession((s) => s.memberships);
    const qc = useQueryClient();
    const [refreshing, setRefreshing] = useState(false);
    const admin = membership.role === 'admin';
    const access = membership.access;
    const trial = access?.reason === 'trial_ended';
    const ended = access?.ends_at ? formatDate(new Date(access.ends_at)) : null;
    const billing = useQuery({ queryKey: ['billing', membership.tenant_id], queryFn: () => api.billing(), enabled: admin });
    const others = memberships.filter((m) => m.tenant_id !== membership.tenant_id);

    const refresh = async (): Promise<void> => {
        setRefreshing(true);
        await qc.invalidateQueries({ queryKey: ['me'] });
        setRefreshing(false);
    };

    return (
        <div className="imcrm-min-h-screen imcrm-bg-canvas imcrm-px-4 imcrm-py-8 sm:imcrm-py-12" data-testid="locked-workspace">
            <div className="imcrm-mx-auto imcrm-flex imcrm-max-w-3xl imcrm-flex-col imcrm-gap-5">
                <header className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-sm sm:imcrm-p-6">
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-warning/15 imcrm-text-warning">
                            <PauseCircle className="imcrm-h-5 imcrm-w-5" aria-hidden />
                        </span>
                        <div className="imcrm-min-w-0">
                            <h1 className="imcrm-text-lg imcrm-font-semibold" data-testid="locked-title">
                                {trial
                                    ? `Terminó la prueba de «${membership.tenant_name}»`
                                    : `El plan de «${membership.tenant_name}» venció`}
                            </h1>
                            <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                                {trial
                                    ? `La prueba terminó${ended ? ` el ${ended}` : ''} y la cuenta quedó pausada.`
                                    : `El plan no se renovó${ended ? ` (venció el ${ended})` : ''} y la cuenta quedó pausada.`}{' '}
                                {admin
                                    ? 'Elige un plan para seguir: todo lo que armaste vuelve a funcionar al instante.'
                                    : 'Para seguir usándola, un administrador de la empresa tiene que elegir un plan.'}
                            </p>
                            <p className="imcrm-mt-2 imcrm-text-sm">
                                <strong>Tus datos están guardados:</strong> no se borró nada y puedes descargarlos cuando quieras.
                            </p>
                        </div>
                    </div>
                </header>

                {admin && billing.data && <SubscriptionPanel currentPlan={billing.data.plan} />}
                {admin && billing.isLoading && (
                    <div className="imcrm-h-56 imcrm-animate-pulse imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-muted/40" />
                )}

                <DataDownload />

                <footer className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-text-sm">
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing} data-testid="locked-refresh">
                            {refreshing ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <RefreshCw className="imcrm-h-3.5 imcrm-w-3.5" />}
                            Ya pagué: volver a revisar
                        </Button>
                        {others.map((m) => (
                            <Button key={m.tenant_id} variant="ghost" size="sm" onClick={() => switchWorkspace(m.tenant_id, qc)}>
                                Ir a «{m.tenant_name}»
                            </Button>
                        ))}
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void api.logout().finally(() => window.location.reload())}
                    >
                        <LogOut className="imcrm-h-3.5 imcrm-w-3.5" /> Cerrar sesión
                    </Button>
                </footer>
            </div>
        </div>
    );
}

/** Descargar los datos de cada lista en Excel (los mismos archivos que «Exportar»). */
function DataDownload(): JSX.Element | null {
    const lists = useQuery({
        queryKey: ['locked-lists'],
        queryFn: async () => (await listsApi.get<ListRow[]>('/lists')).data,
    });
    const [busy, setBusy] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    const download = async (l: ListRow): Promise<void> => {
        setBusy(l.id);
        setError(null);
        try {
            const boot = getBootData();
            const headers: Record<string, string> = {};
            if (boot.tenantId !== null) headers['X-Tenant-Id'] = String(boot.tenantId);
            const res = await fetch(`${boot.restRoot.replace(/\/$/, '')}/lists/${l.slug}/export?format=xlsx`, {
                headers,
                credentials: 'include',
            });
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
                throw new Error(typeof body?.message === 'string' ? body.message : 'No se pudo descargar.');
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${l.slug}.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo descargar.');
        } finally {
            setBusy(null);
        }
    };

    if (lists.isError) return null;
    return (
        <section className="imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-sm" data-testid="locked-download">
            <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                    <Download className="imcrm-h-4 imcrm-w-4" aria-hidden />
                </span>
                <div>
                    <h2 className="imcrm-font-semibold">Descargar tus datos</h2>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">Cada lista en un archivo de Excel, con todos sus registros.</p>
                </div>
            </div>
            <div className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border">
                {lists.isLoading && (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-p-3 imcrm-text-sm imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> Cargando listas…
                    </div>
                )}
                {lists.data?.length === 0 && <p className="imcrm-p-3 imcrm-text-sm imcrm-text-muted-foreground">Esta empresa no tiene listas.</p>}
                {lists.data?.map((l) => (
                    <div key={l.id} className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-px-3 imcrm-py-2">
                        <span className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                            <FileSpreadsheet className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                            <span className="imcrm-truncate">{l.name}</span>
                        </span>
                        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void download(l)} data-testid="locked-download-list">
                            {busy === l.id ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Download className="imcrm-h-3.5 imcrm-w-3.5" />}
                            Excel
                        </Button>
                    </div>
                ))}
            </div>
            {error && <p className="imcrm-mt-2 imcrm-text-sm imcrm-text-destructive">{error}</p>}
        </section>
    );
}
