import { Fragment, useEffect, useState } from 'react';
import { Archive, ArchiveRestore, Building2, CalendarClock, ChevronDown, ChevronRight, Loader2, LogIn, Plus, Save, Search, Trash2, Users } from 'lucide-react';
import {
    BILLING_STATUSES,
    type BillingStatus,
    type Plan,
    type PlatformTenant,
} from '@imagina-base/shared';

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
    useCreateTenant,
    useDeleteTenant,
    useImpersonate,
    usePlatformPlans,
    usePlatformTenants,
    useTenantDetail,
    useUpdateTenant,
} from '@/hooks/usePlatform';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<BillingStatus, string> = {
    trialing: __('En prueba'),
    active: __('Activa'),
    past_due: __('Impaga'),
    canceled: __('Cancelada'),
};
const STATUS_TONE: Record<BillingStatus, string> = {
    trialing: 'imcrm-bg-blue-500/10 imcrm-text-blue-600 dark:imcrm-text-blue-400',
    active: 'imcrm-bg-emerald-500/10 imcrm-text-emerald-600 dark:imcrm-text-emerald-400',
    past_due: 'imcrm-bg-amber-500/10 imcrm-text-amber-600 dark:imcrm-text-amber-400',
    canceled: 'imcrm-bg-red-500/10 imcrm-text-red-600 dark:imcrm-text-red-400',
};
const fmtLimit = (v: number | null): string => (v === null ? '∞' : v.toLocaleString());

/** Grilla de empresas + alta en un paso + detalle expandible (ADR-S15 F1/F4). */
export function PlatformTenantsCard(): JSX.Element {
    const [showArchived, setShowArchived] = useState(false);
    const tenants = usePlatformTenants(showArchived);
    const plans = usePlatformPlans();
    const update = useUpdateTenant();
    const [expanded, setExpanded] = useState<number | null>(null);
    const [showNew, setShowNew] = useState(false);
    const [search, setSearch] = useState('');

    const filtered = (tenants.data ?? []).filter((t) => {
        const q = search.trim().toLowerCase();
        if (q === '') return true;
        return (
            t.name.toLowerCase().includes(q) ||
            t.slug.toLowerCase().includes(q) ||
            (t.owner?.email.toLowerCase().includes(q) ?? false)
        );
    });

    const setPlan = (t: PlatformTenant, plan: Plan): void => {
        if (plan !== t.plan) update.mutate({ id: t.id, input: { plan } });
    };
    const setStatus = (t: PlatformTenant, status: BillingStatus): void => {
        if (status !== t.status) update.mutate({ id: t.id, input: { status } });
    };

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3">
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <Building2 className="imcrm-mt-0.5 imcrm-h-5 imcrm-w-5 imcrm-text-muted-foreground" />
                        <div>
                            <CardTitle>{__('Empresas (clientes)')}</CardTitle>
                            <CardDescription>
                                {__('Cada fila es un workspace. Cambiar el estado a "Impaga/Cancelada" deja la cuenta en solo-lectura (los datos nunca se secuestran).')}
                            </CardDescription>
                        </div>
                    </div>
                    <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-3">
                        <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                            {__('Ver archivadas')}
                        </label>
                        <Button variant={showNew ? 'secondary' : 'default'} size="sm" className="imcrm-gap-1.5" onClick={() => setShowNew((v) => !v)}>
                            <Plus className="imcrm-h-4 imcrm-w-4" />
                            {__('Nueva empresa')}
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                {showNew && <NewTenantForm onDone={() => setShowNew(false)} />}

                {!tenants.isLoading && !tenants.isError && (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <Search className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={__('Buscar por nombre, slug o email del admin…')}
                            className="imcrm-h-9 imcrm-max-w-sm"
                        />
                        <span className="imcrm-text-xs imcrm-text-muted-foreground imcrm-tabular-nums">
                            {filtered.length}/{(tenants.data ?? []).length}
                        </span>
                    </div>
                )}

                {tenants.isLoading ? (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                        {__('Cargando empresas…')}
                    </div>
                ) : tenants.isError ? (
                    <p className="imcrm-py-6 imcrm-text-sm imcrm-text-destructive">{__('No se pudieron cargar las empresas.')}</p>
                ) : (
                    <div className="imcrm-overflow-x-auto">
                        <table className="imcrm-w-full imcrm-border-collapse imcrm-text-sm">
                            <thead>
                                <tr className="imcrm-border-b imcrm-border-border imcrm-text-left imcrm-text-xs imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                                    <th className="imcrm-py-2 imcrm-pr-3 imcrm-font-medium">{__('Empresa')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Owner')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Plan')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Estado')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium imcrm-text-right">{__('Uso')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Alta')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium" />
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((t) => (
                                    <Fragment key={t.id}>
                                        <tr className="imcrm-border-b imcrm-border-border/60">
                                            <td className="imcrm-py-3 imcrm-pr-3">
                                                <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                                    <span className="imcrm-font-medium imcrm-text-foreground">{t.name}</span>
                                                    {t.archived && (
                                                        <span className="imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-text-muted-foreground">
                                                            {__('Archivada')}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="imcrm-font-mono imcrm-text-xs imcrm-text-muted-foreground">{t.slug}</div>
                                            </td>
                                            <td className="imcrm-px-2 imcrm-py-3 imcrm-text-muted-foreground">
                                                {t.owner ? t.owner.email : <span className="imcrm-italic">{__('— sin admin —')}</span>}
                                            </td>
                                            <td className="imcrm-px-2 imcrm-py-3">
                                                <select
                                                    className="imcrm-h-8 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                                                    value={t.plan}
                                                    disabled={update.isPending}
                                                    onChange={(e) => setPlan(t, e.target.value as Plan)}
                                                    aria-label={`${__('Plan de')} ${t.name}`}
                                                >
                                                    {(plans.data ?? []).map((p) => (
                                                        <option key={p.slug} value={p.slug}>{p.name}</option>
                                                    ))}
                                                    {!(plans.data ?? []).some((p) => p.slug === t.plan) && (
                                                        <option value={t.plan}>{t.plan}</option>
                                                    )}
                                                </select>
                                            </td>
                                            <td className="imcrm-px-2 imcrm-py-3">
                                                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                                    <span className={cn('imcrm-inline-flex imcrm-shrink-0 imcrm-rounded-full imcrm-px-2 imcrm-py-0.5 imcrm-text-xs imcrm-font-medium', STATUS_TONE[t.status])}>
                                                        {STATUS_LABEL[t.status]}
                                                    </span>
                                                    <select
                                                        className="imcrm-h-8 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                                                        value={t.status}
                                                        disabled={update.isPending}
                                                        onChange={(e) => setStatus(t, e.target.value as BillingStatus)}
                                                        aria-label={`${__('Estado de')} ${t.name}`}
                                                    >
                                                        {BILLING_STATUSES.map((s) => (
                                                            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </td>
                                            <td className="imcrm-px-2 imcrm-py-3 imcrm-text-right imcrm-tabular-nums imcrm-text-muted-foreground">
                                                <span title={__('Registros / Usuarios / Automatizaciones')}>
                                                    {t.usage.records.toLocaleString()} · {t.usage.users} · {t.usage.automations}
                                                </span>
                                            </td>
                                            <td className="imcrm-px-2 imcrm-py-3 imcrm-text-muted-foreground imcrm-whitespace-nowrap">
                                                {new Date(t.created_at).toLocaleDateString()}
                                            </td>
                                            <td className="imcrm-px-2 imcrm-py-3 imcrm-text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="imcrm-gap-1"
                                                    onClick={() => setExpanded((cur) => (cur === t.id ? null : t.id))}
                                                    aria-label={`${__('Detalle de')} ${t.name}`}
                                                >
                                                    {expanded === t.id ? <ChevronDown className="imcrm-h-4 imcrm-w-4" /> : <ChevronRight className="imcrm-h-4 imcrm-w-4" />}
                                                    {__('Detalle')}
                                                </Button>
                                            </td>
                                        </tr>
                                        {expanded === t.id && (
                                            <tr className="imcrm-border-b imcrm-border-border/60 imcrm-bg-muted/20">
                                                <td colSpan={7} className="imcrm-px-4 imcrm-py-3">
                                                    <TenantDetail id={t.id} onCollapse={() => setExpanded(null)} />
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                {update.isError && (
                    <p className="imcrm-text-sm imcrm-text-destructive">{__('No se pudo aplicar el cambio.')}</p>
                )}
            </CardContent>
        </Card>
    );
}

function NewTenantForm({ onDone }: { onDone: () => void }): JSX.Element {
    const create = useCreateTenant();
    const plans = usePlatformPlans();
    const [ws, setWs] = useState('');
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [plan, setPlan] = useState('trial');
    const [error, setError] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);

    const submit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setError(null);
        setOk(null);
        try {
            const t = await create.mutateAsync({ workspace_name: ws.trim(), admin_email: email.trim(), admin_name: name.trim(), plan });
            setWs('');
            setEmail('');
            setName('');
            setOk(`${__('Empresa creada:')} ${t.name} · ${__('admin')} ${email.trim()}`);
            onDone();
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : __('Error'));
        }
    };

    return (
        <form onSubmit={submit} className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/30 imcrm-p-3">
            <span className="imcrm-text-sm imcrm-font-medium">{__('Alta de empresa + admin')}</span>
            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 md:imcrm-grid-cols-4">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label htmlFor="nt-ws" className="imcrm-text-xs">{__('Empresa')}</Label>
                    <Input id="nt-ws" required value={ws} onChange={(e) => setWs(e.target.value)} placeholder={__('Acme S.A.')} />
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label htmlFor="nt-email" className="imcrm-text-xs">{__('Email del admin')}</Label>
                    <Input id="nt-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@acme.com" />
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label htmlFor="nt-name" className="imcrm-text-xs">{__('Nombre del admin')}</Label>
                    <Input id="nt-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder={__('Nombre y apellido')} />
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label htmlFor="nt-plan" className="imcrm-text-xs">{__('Plan')}</Label>
                    <select id="nt-plan" className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm" value={plan} onChange={(e) => setPlan(e.target.value)}>
                        {(plans.data ?? []).map((p) => (
                            <option key={p.slug} value={p.slug}>{p.name}</option>
                        ))}
                    </select>
                </div>
            </div>
            {error !== null && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
            {ok !== null && <p className="imcrm-text-sm imcrm-text-emerald-700 dark:imcrm-text-emerald-400">{ok}</p>}
            <div className="imcrm-flex imcrm-justify-end">
                <Button type="submit" disabled={create.isPending} className="imcrm-gap-2">
                    {create.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Plus className="imcrm-h-4 imcrm-w-4" />}
                    {__('Crear empresa')}
                </Button>
            </div>
        </form>
    );
}

function TenantDetail({ id, onCollapse }: { id: number; onCollapse: () => void }): JSX.Element {
    const detail = useTenantDetail(id);
    const impersonate = useImpersonate();

    const doImpersonate = (userId: number, name: string): void => {
        if (confirm(`${__('¿Entrar como')} ${name}? ${__('Se abrirá una sesión de soporte (queda auditada).')}`)) {
            impersonate.mutate(userId);
        }
    };
    if (detail.isLoading) {
        return (
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Cargando detalle…')}
            </div>
        );
    }
    if (detail.isError || !detail.data) {
        return <p className="imcrm-text-sm imcrm-text-destructive">{__('No se pudo cargar el detalle.')}</p>;
    }
    const d = detail.data;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 md:imcrm-flex-row md:imcrm-gap-8">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                    <Users className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Miembros')} ({d.members.length})
                </span>
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                    {d.members.map((m) => (
                        <li key={m.user_id} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                            <span className="imcrm-font-medium">{m.name}</span>
                            <span className="imcrm-text-muted-foreground">{m.email}</span>
                            <span className="imcrm-rounded imcrm-bg-primary/10 imcrm-px-1.5 imcrm-py-0.5 imcrm-text-xs imcrm-text-primary">{m.role}</span>
                            {m.disabled ? (
                                <span className="imcrm-rounded imcrm-bg-red-500/10 imcrm-px-1.5 imcrm-py-0.5 imcrm-text-xs imcrm-text-red-600 dark:imcrm-text-red-400">{__('desactivado')}</span>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => doImpersonate(m.user_id, m.name)}
                                    disabled={impersonate.isPending}
                                    className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-border imcrm-border-border imcrm-px-1.5 imcrm-py-0.5 imcrm-text-xs imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-border-primary hover:imcrm-text-primary disabled:imcrm-opacity-50"
                                    title={__('Entrar como este usuario (soporte)')}
                                >
                                    <LogIn className="imcrm-h-3 imcrm-w-3" />
                                    {__('Impersonar')}
                                </button>
                            )}
                        </li>
                    ))}
                    {d.members.length === 0 && <li className="imcrm-text-sm imcrm-text-muted-foreground">{__('Sin miembros')}</li>}
                </ul>
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <span className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Uso / Límite')}</span>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-text-sm imcrm-tabular-nums">
                    <span>{__('Registros')}: {d.tenant.usage.records.toLocaleString()} / {fmtLimit(d.limits.max_records)}</span>
                    <span>{__('Usuarios')}: {d.tenant.usage.users} / {fmtLimit(d.limits.max_users)}</span>
                    <span>{__('Automatizaciones')}: {d.tenant.usage.automations} / {fmtLimit(d.limits.max_automations)}</span>
                </div>
            </div>
            <TenantManagement tenant={d.tenant} onDeleted={onCollapse} />
        </div>
    );
}

/**
 * Gestión de la empresa (operador): renombrar, suscripción manual con fecha
 * 'paga hasta', archivar/desarchivar y borrado real (confirmación por texto).
 */
function TenantManagement({ tenant, onDeleted }: { tenant: PlatformTenant; onDeleted: () => void }): JSX.Element {
    const update = useUpdateTenant();
    const del = useDeleteTenant();
    const [name, setName] = useState(tenant.name);
    // <input type="date"> quiere YYYY-MM-DD; el backend guarda ISO completo.
    const [until, setUntil] = useState(tenant.subscription_ends_at ? tenant.subscription_ends_at.slice(0, 10) : '');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setName(tenant.name);
        setUntil(tenant.subscription_ends_at ? tenant.subscription_ends_at.slice(0, 10) : '');
    }, [tenant]);

    const run = async (input: Parameters<typeof update.mutateAsync>[0]['input']): Promise<void> => {
        setError(null);
        try {
            await update.mutateAsync({ id: tenant.id, input });
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : __('Error'));
        }
    };

    const saveSubscription = (): void => {
        // Suscripción manual: activa + fecha (fin de ese día, UTC). Vacío = sin vencimiento.
        const iso = until ? new Date(`${until}T23:59:59.000Z`).toISOString() : null;
        void run({ status: 'active', subscription_ends_at: iso });
    };

    const remove = async (): Promise<void> => {
        const typed = window.prompt(`${__('Esto borra la empresa y TODOS sus datos (irreversible). Escribí el nombre para confirmar:')}\n\n${tenant.name}`);
        if (typed === null) return;
        if (typed.trim() !== tenant.name) {
            setError(__('El nombre no coincide; no se borró nada.'));
            return;
        }
        setError(null);
        try {
            await del.mutateAsync(tenant.id);
            onDeleted();
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : __('Error'));
        }
    };

    const busy = update.isPending || del.isPending;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 md:imcrm-min-w-[16rem]">
            <span className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Gestión')}</span>
            {/* Renombrar */}
            <div className="imcrm-flex imcrm-items-end imcrm-gap-2">
                <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs">{__('Nombre')}</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} className="imcrm-h-8" />
                </div>
                <Button size="sm" variant="outline" className="imcrm-gap-1.5" disabled={busy || name.trim() === '' || name.trim() === tenant.name} onClick={() => void run({ name: name.trim() })}>
                    <Save className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Guardar')}
                </Button>
            </div>
            {/* Suscripción manual con fecha 'paga hasta' */}
            <div className="imcrm-flex imcrm-items-end imcrm-gap-2">
                <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs"><CalendarClock className="imcrm-h-3 imcrm-w-3" /> {__('Suscripción paga hasta')}</Label>
                    <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="imcrm-h-8" />
                </div>
                <Button size="sm" variant="outline" className="imcrm-gap-1.5" disabled={busy} onClick={saveSubscription}>
                    <Save className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Aplicar')}
                </Button>
            </div>
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('Al vencer, la empresa pasa a solo-lectura automáticamente. Vacío = sin vencimiento.')}
            </p>
            {/* Archivar / borrar */}
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2 imcrm-pt-1">
                {tenant.archived ? (
                    <Button size="sm" variant="outline" className="imcrm-gap-1.5" disabled={busy} onClick={() => void run({ archived: false })}>
                        <ArchiveRestore className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Desarchivar')}
                    </Button>
                ) : (
                    <Button size="sm" variant="outline" className="imcrm-gap-1.5" disabled={busy} onClick={() => void run({ archived: true })}>
                        <Archive className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Archivar')}
                    </Button>
                )}
                <Button size="sm" variant="outline" className="imcrm-gap-1.5 imcrm-text-destructive hover:imcrm-text-destructive" disabled={busy} onClick={() => void remove()}>
                    <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Borrar')}
                </Button>
            </div>
            {error !== null && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
        </div>
    );
}
