import { useEffect, useState } from 'react';
import {
    Archive,
    ArchiveRestore,
    Building2,
    CalendarClock,
    ChevronDown,
    ChevronRight,
    Database,
    Loader2,
    LogIn,
    MoreHorizontal,
    Plus,
    Save,
    Search,
    Trash2,
    Users,
    Zap,
} from 'lucide-react';
import {
    BILLING_STATUSES,
    type BillingStatus,
    type Plan,
    type PlatformTenant,
} from '@imagina-base/shared';

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
/** Dot de estado (tokens semánticos, no colores sueltos). */
const STATUS_DOT: Record<BillingStatus, string> = {
    trialing: 'imcrm-bg-info',
    active: 'imcrm-bg-success',
    past_due: 'imcrm-bg-warning',
    canceled: 'imcrm-bg-destructive',
};
const STATUS_BADGE: Record<BillingStatus, 'info' | 'success' | 'warning' | 'destructive'> = {
    trialing: 'info',
    active: 'success',
    past_due: 'warning',
    canceled: 'destructive',
};
const fmtLimit = (v: number | null): string => (v === null ? '∞' : v.toLocaleString());
/** Bytes → MB con 1 decimal (para comparar/mostrar contra `max_storage_mb`). */
const formatMb = (bytes: number): number => Math.round((bytes / (1024 * 1024)) * 10) / 10;

/** Confirmación de borrado por texto (escribir el nombre). Devuelve si procede. */
function confirmDeleteByName(name: string): boolean | null {
    const typed = window.prompt(
        `${__('Esto borra la empresa y TODOS sus datos (irreversible). Escribí el nombre para confirmar:')}\n\n${name}`,
    );
    if (typed === null) return null;
    return typed.trim() === name;
}

/**
 * Select "quiet" estilo Linear: en reposo parece un valor de la tabla (sin
 * borde); al hover aparece el borde. El dot opcional adelante da el color de
 * estado. Mucho menos ruidoso que un <select> nativo por celda.
 */
function QuietSelect({
    value,
    options,
    dotClass,
    disabled,
    ariaLabel,
    onChange,
}: {
    value: string;
    options: Array<{ value: string; label: string }>;
    dotClass?: string;
    disabled?: boolean;
    ariaLabel: string;
    onChange: (value: string) => void;
}): JSX.Element {
    return (
        <span className="imcrm-group/qs imcrm-relative imcrm-inline-flex imcrm-h-8 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-transparent imcrm-pl-2 imcrm-pr-1 imcrm-transition-colors hover:imcrm-border-input hover:imcrm-bg-background">
            {dotClass !== undefined && (
                <span aria-hidden className={cn('imcrm-h-2 imcrm-w-2 imcrm-shrink-0 imcrm-rounded-full', dotClass)} />
            )}
            <select
                className="imcrm-cursor-pointer imcrm-appearance-none imcrm-bg-transparent imcrm-pr-4 imcrm-text-sm imcrm-text-foreground focus:imcrm-outline-none disabled:imcrm-cursor-default"
                value={value}
                disabled={disabled}
                aria-label={ariaLabel}
                onChange={(e) => onChange(e.target.value)}
            >
                {options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                ))}
            </select>
            <ChevronDown
                aria-hidden
                className="imcrm-pointer-events-none imcrm-absolute imcrm-right-1 imcrm-h-3 imcrm-w-3 imcrm-text-muted-foreground imcrm-opacity-50 imcrm-transition-opacity group-hover/qs:imcrm-opacity-100"
            />
        </span>
    );
}

/** Grilla de empresas + alta en un paso + detalle en panel lateral (ADR-S15). */
export function PlatformTenantsCard(): JSX.Element {
    const [showArchived, setShowArchived] = useState(false);
    const tenants = usePlatformTenants(showArchived);
    const plans = usePlatformPlans();
    const update = useUpdateTenant();
    const del = useDeleteTenant();
    const [sheetId, setSheetId] = useState<number | null>(null);
    const [showNew, setShowNew] = useState(false);
    const [search, setSearch] = useState('');
    const [rowError, setRowError] = useState<string | null>(null);

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

    const removeTenant = async (t: PlatformTenant): Promise<void> => {
        const ok = confirmDeleteByName(t.name);
        if (ok === null) return;
        if (!ok) {
            setRowError(__('El nombre no coincide; no se borró nada.'));
            return;
        }
        setRowError(null);
        try {
            await del.mutateAsync(t.id);
            if (sheetId === t.id) setSheetId(null);
        } catch (err) {
            setRowError(err instanceof ApiError || err instanceof Error ? err.message : __('Error'));
        }
    };

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3">
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                            <Building2 className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
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
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2.5">
                        <div className="imcrm-relative imcrm-w-full imcrm-max-w-sm">
                            <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-2.5 imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                            <Input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={__('Buscar por nombre, slug o email del admin…')}
                                className="imcrm-h-9 imcrm-pl-8"
                            />
                        </div>
                        <span className="imcrm-whitespace-nowrap imcrm-text-xs imcrm-text-muted-foreground imcrm-tabular-nums">
                            {filtered.length} / {(tenants.data ?? []).length}
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
                                    <tr key={t.id} className={cn('imcrm-border-b imcrm-border-border/60 imcrm-transition-colors hover:imcrm-bg-muted/30', t.archived && 'imcrm-opacity-70')}>
                                        <td className="imcrm-py-2.5 imcrm-pr-3">
                                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2.5">
                                                <Avatar name={t.name} />
                                                <div className="imcrm-min-w-0">
                                                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                                        <button
                                                            type="button"
                                                            onClick={() => setSheetId(t.id)}
                                                            className="imcrm-truncate imcrm-font-medium imcrm-text-foreground hover:imcrm-text-primary hover:imcrm-underline"
                                                        >
                                                            {t.name}
                                                        </button>
                                                        {t.archived && (
                                                            <Badge variant="secondary" className="imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]">
                                                                <Archive className="imcrm-h-2.5 imcrm-w-2.5" /> {__('Archivada')}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <div className="imcrm-truncate imcrm-font-mono imcrm-text-[11px] imcrm-text-muted-foreground">{t.slug}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-2.5 imcrm-text-muted-foreground">
                                            {t.owner ? t.owner.email : <span className="imcrm-italic imcrm-opacity-70">{__('sin admin')}</span>}
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-2.5">
                                            <QuietSelect
                                                value={t.plan}
                                                disabled={update.isPending}
                                                ariaLabel={`${__('Plan de')} ${t.name}`}
                                                onChange={(v) => setPlan(t, v as Plan)}
                                                options={[
                                                    ...(plans.data ?? []).map((p) => ({ value: p.slug, label: p.name })),
                                                    ...((plans.data ?? []).some((p) => p.slug === t.plan)
                                                        ? []
                                                        : [{ value: t.plan, label: t.plan }]),
                                                ]}
                                            />
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-2.5">
                                            <QuietSelect
                                                value={t.status}
                                                disabled={update.isPending}
                                                dotClass={STATUS_DOT[t.status]}
                                                ariaLabel={`${__('Estado de')} ${t.name}`}
                                                onChange={(v) => setStatus(t, v as BillingStatus)}
                                                options={BILLING_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
                                            />
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-2.5">
                                            <div
                                                className="imcrm-flex imcrm-items-center imcrm-justify-end imcrm-gap-3 imcrm-tabular-nums imcrm-text-muted-foreground"
                                                title={__('Registros · Usuarios · Automatizaciones')}
                                            >
                                                <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1"><Database className="imcrm-h-3 imcrm-w-3 imcrm-opacity-60" aria-hidden />{t.usage.records.toLocaleString()}</span>
                                                <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1"><Users className="imcrm-h-3 imcrm-w-3 imcrm-opacity-60" aria-hidden />{t.usage.users}</span>
                                                <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1"><Zap className="imcrm-h-3 imcrm-w-3 imcrm-opacity-60" aria-hidden />{t.usage.automations}</span>
                                            </div>
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-2.5 imcrm-text-xs imcrm-text-muted-foreground imcrm-whitespace-nowrap">
                                            {new Date(t.created_at).toLocaleDateString()}
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-2.5 imcrm-text-right">
                                            <div className="imcrm-flex imcrm-items-center imcrm-justify-end imcrm-gap-1">
                                                {t.archived && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="imcrm-gap-1.5"
                                                        disabled={update.isPending}
                                                        onClick={() => update.mutate({ id: t.id, input: { archived: false } })}
                                                        aria-label={`${__('Desarchivar')} ${t.name}`}
                                                    >
                                                        <ArchiveRestore className="imcrm-h-3.5 imcrm-w-3.5" />
                                                        {__('Desarchivar')}
                                                    </Button>
                                                )}
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="imcrm-gap-1"
                                                    onClick={() => setSheetId(t.id)}
                                                    aria-label={`${__('Detalle de')} ${t.name}`}
                                                >
                                                    <ChevronRight className="imcrm-h-4 imcrm-w-4" />
                                                    {__('Detalle')}
                                                </Button>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="sm" aria-label={`${__('Acciones de')} ${t.name}`}>
                                                            <MoreHorizontal className="imcrm-h-4 imcrm-w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        {t.archived ? (
                                                            <DropdownMenuItem onSelect={() => update.mutate({ id: t.id, input: { archived: false } })}>
                                                                <ArchiveRestore className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" /> {__('Desarchivar')}
                                                            </DropdownMenuItem>
                                                        ) : (
                                                            <DropdownMenuItem onSelect={() => update.mutate({ id: t.id, input: { archived: true } })}>
                                                                <Archive className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" /> {__('Archivar')}
                                                            </DropdownMenuItem>
                                                        )}
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem
                                                            className="imcrm-text-destructive focus:imcrm-text-destructive"
                                                            onSelect={() => {
                                                                // El prompt es síncrono; diferir para no romper el cierre del menú.
                                                                setTimeout(() => void removeTenant(t), 0);
                                                            }}
                                                        >
                                                            <Trash2 className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" /> {__('Borrar…')}
                                                        </DropdownMenuItem>
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
                {update.isError && (
                    <p className="imcrm-text-sm imcrm-text-destructive">{__('No se pudo aplicar el cambio.')}</p>
                )}
                {rowError !== null && <p className="imcrm-text-sm imcrm-text-destructive">{rowError}</p>}
            </CardContent>

            <TenantSheet id={sheetId} onClose={() => setSheetId(null)} />
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
            {ok !== null && <p className="imcrm-text-sm imcrm-text-success">{ok}</p>}
            <div className="imcrm-flex imcrm-justify-end">
                <Button type="submit" disabled={create.isPending} className="imcrm-gap-2">
                    {create.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Plus className="imcrm-h-4 imcrm-w-4" />}
                    {__('Crear empresa')}
                </Button>
            </div>
        </form>
    );
}

/** Mini-barra de uso vs. límite del panel (misma semántica que Ajustes). */
function UsageRow({ label, used, limit, suffix = '' }: { label: string; used: number; limit: number | null; suffix?: string }): JSX.Element {
    const pct = limit === null ? 0 : Math.min(100, (used / limit) * 100);
    const fill = pct >= 90 ? 'imcrm-bg-destructive' : pct >= 75 ? 'imcrm-bg-warning' : 'imcrm-bg-primary';
    return (
        <div className="imcrm-space-y-1">
            <div className="imcrm-flex imcrm-items-baseline imcrm-justify-between imcrm-text-sm">
                <span>{label}</span>
                <span className="imcrm-tabular-nums imcrm-text-xs imcrm-text-muted-foreground">
                    <span className="imcrm-font-semibold imcrm-text-foreground">{used.toLocaleString()}{suffix}</span> / {fmtLimit(limit)}{limit === null ? '' : suffix}
                </span>
            </div>
            <div className="imcrm-h-1.5 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                {limit !== null && (
                    <div className={cn('imcrm-h-full imcrm-rounded-full', fill)} style={{ width: `${Math.max(pct, used > 0 ? 2 : 0)}%` }} />
                )}
            </div>
        </div>
    );
}

/**
 * Panel lateral de la empresa: identidad + gestión (renombrar, suscripción
 * 'paga hasta'), miembros con impersonación, uso vs. límites y las acciones
 * de archivo/borrado en el footer. Reemplaza a la vieja fila expandible.
 */
function TenantSheet({ id, onClose }: { id: number | null; onClose: () => void }): JSX.Element {
    const open = id !== null;
    const detail = useTenantDetail(id);
    const update = useUpdateTenant();
    const del = useDeleteTenant();
    const impersonate = useImpersonate();
    const [name, setName] = useState('');
    // <input type="date"> quiere YYYY-MM-DD; el backend guarda ISO completo.
    const [until, setUntil] = useState('');
    const [error, setError] = useState<string | null>(null);

    const t = detail.data?.tenant;

    useEffect(() => {
        setName(t?.name ?? '');
        setUntil(t?.subscription_ends_at ? t.subscription_ends_at.slice(0, 10) : '');
        setError(null);
    }, [t]);

    const run = async (input: Parameters<typeof update.mutateAsync>[0]['input']): Promise<void> => {
        if (id === null) return;
        setError(null);
        try {
            await update.mutateAsync({ id, input });
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
        if (!t || id === null) return;
        const ok = confirmDeleteByName(t.name);
        if (ok === null) return;
        if (!ok) {
            setError(__('El nombre no coincide; no se borró nada.'));
            return;
        }
        try {
            await del.mutateAsync(id);
            onClose();
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : __('Error'));
        }
    };

    const doImpersonate = (userId: number, who: string): void => {
        if (confirm(`${__('¿Entrar como')} ${who}? ${__('Se abrirá una sesión de soporte (queda auditada).')}`)) {
            impersonate.mutate(userId);
        }
    };

    const busy = update.isPending || del.isPending;

    return (
        <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
            <SheetContent aria-describedby={undefined}>
                <SheetHeader>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                        {t && <Avatar name={t.name} />}
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <SheetTitle className="imcrm-truncate">{t?.name ?? __('Empresa')}</SheetTitle>
                            {t && (
                                <div className="imcrm-mt-0.5 imcrm-flex imcrm-items-center imcrm-gap-2">
                                    <span className="imcrm-font-mono imcrm-text-[11px] imcrm-text-muted-foreground">{t.slug}</span>
                                    <Badge dot variant={STATUS_BADGE[t.status]} className="imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]">
                                        {STATUS_LABEL[t.status]}
                                    </Badge>
                                    {t.archived && (
                                        <Badge variant="secondary" className="imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]">
                                            <Archive className="imcrm-h-2.5 imcrm-w-2.5" /> {__('Archivada')}
                                        </Badge>
                                    )}
                                </div>
                            )}
                        </div>
                        <SheetCloseButton aria-label={__('Cerrar')} />
                    </div>
                </SheetHeader>

                <SheetBody className="imcrm-flex imcrm-flex-col imcrm-gap-6">
                    {detail.isLoading && (
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                            <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Cargando detalle…')}
                        </div>
                    )}
                    {detail.isError && (
                        <p className="imcrm-text-sm imcrm-text-destructive">{__('No se pudo cargar el detalle.')}</p>
                    )}
                    {detail.data && t && (
                        <>
                            {/* Gestión */}
                            <section className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                                <h3 className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                    {__('Gestión')}
                                </h3>
                                <div className="imcrm-flex imcrm-items-end imcrm-gap-2">
                                    <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-1">
                                        <Label className="imcrm-text-xs">{__('Nombre')}</Label>
                                        <Input value={name} onChange={(e) => setName(e.target.value)} className="imcrm-h-9" />
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="imcrm-gap-1.5"
                                        disabled={busy || name.trim() === '' || name.trim() === t.name}
                                        onClick={() => void run({ name: name.trim() })}
                                    >
                                        <Save className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Guardar')}
                                    </Button>
                                </div>
                                <div className="imcrm-flex imcrm-items-end imcrm-gap-2">
                                    <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-1">
                                        <Label className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs">
                                            <CalendarClock className="imcrm-h-3 imcrm-w-3" /> {__('Suscripción paga hasta')}
                                        </Label>
                                        <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="imcrm-h-9" />
                                    </div>
                                    <Button size="sm" variant="outline" className="imcrm-gap-1.5" disabled={busy} onClick={saveSubscription}>
                                        <Save className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Aplicar')}
                                    </Button>
                                </div>
                                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                    {__('Al vencer, la empresa pasa a solo-lectura automáticamente. Vacío = sin vencimiento.')}
                                </p>
                            </section>

                            {/* Uso vs. límites */}
                            <section className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                                <h3 className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                    {__('Uso vs. límites del plan')}
                                </h3>
                                <UsageRow label={__('Registros')} used={t.usage.records} limit={detail.data.limits.max_records} />
                                <UsageRow label={__('Usuarios')} used={t.usage.users} limit={detail.data.limits.max_users} />
                                <UsageRow label={__('Automatizaciones')} used={t.usage.automations} limit={detail.data.limits.max_automations} />
                                <UsageRow label={__('Storage')} used={formatMb(t.usage.storage_bytes)} limit={detail.data.limits.max_storage_mb} suffix=" MB" />
                            </section>

                            {/* Miembros */}
                            <section className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                                <h3 className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                    <Users className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Miembros')} ({detail.data.members.length})
                                </h3>
                                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                    {detail.data.members.map((m) => (
                                        <li key={m.user_id} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-px-1.5 imcrm-py-1.5 imcrm-text-sm imcrm-transition-colors hover:imcrm-bg-muted/40">
                                            <Avatar name={m.name} size="sm" />
                                            <div className="imcrm-min-w-0 imcrm-flex-1">
                                                <div className="imcrm-truncate imcrm-font-medium">{m.name}</div>
                                                <div className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{m.email}</div>
                                            </div>
                                            <Badge variant="outline" className="imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]">{m.role}</Badge>
                                            {m.disabled ? (
                                                <Badge variant="destructive" dot className="imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]">{__('desactivada')}</Badge>
                                            ) : (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="imcrm-h-7 imcrm-gap-1 imcrm-px-2 imcrm-text-xs"
                                                    disabled={impersonate.isPending}
                                                    onClick={() => doImpersonate(m.user_id, m.name)}
                                                    title={__('Entrar como este usuario (soporte)')}
                                                >
                                                    <LogIn className="imcrm-h-3 imcrm-w-3" />
                                                    {__('Impersonar')}
                                                </Button>
                                            )}
                                        </li>
                                    ))}
                                    {detail.data.members.length === 0 && (
                                        <li className="imcrm-text-sm imcrm-text-muted-foreground">{__('Sin miembros')}</li>
                                    )}
                                </ul>
                            </section>

                            {error !== null && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
                        </>
                    )}
                </SheetBody>

                {t && (
                    <SheetFooter className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                        {t.archived ? (
                            <Button size="sm" variant="outline" className="imcrm-gap-1.5" disabled={busy} onClick={() => void run({ archived: false })}>
                                <ArchiveRestore className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Desarchivar')}
                            </Button>
                        ) : (
                            <Button size="sm" variant="outline" className="imcrm-gap-1.5" disabled={busy} onClick={() => void run({ archived: true })}>
                                <Archive className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Archivar')}
                            </Button>
                        )}
                        <Button size="sm" variant="outline" className="imcrm-gap-1.5 imcrm-text-destructive hover:imcrm-text-destructive" disabled={busy} onClick={() => void remove()}>
                            <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Borrar empresa')}
                        </Button>
                    </SheetFooter>
                )}
            </SheetContent>
        </Sheet>
    );
}
