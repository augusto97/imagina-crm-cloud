import { forwardRef, useMemo, useState } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import { Building2, Clock, Loader2, LogIn, MoreHorizontal, PauseCircle, Pencil, PlayCircle, Plus, Search, Users, X } from 'lucide-react';
import type { AgencyClient } from '@imagina-base/shared';

import { relativeTime } from '@/admin/activity/activityText';
import { initials } from '@/admin/layout/WorkspaceSwitcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import {
    useAgencyClients,
    useAgencyOverview,
    useCreateAgencyClient,
    useEnterAgencyClient,
    useIsAgencyAdmin,
    useUpdateAgencyClient,
} from './useAgency';
import { AgencyBrandCard } from './AgencyBrandCard';
import { clientStateLabel } from './agencyUi';

/**
 * v0.1.449 (I3, ADR-S108) — «Agencia»: las empresas de los clientes de la
 * agencia. Desde acá se crean, se entra a cualquiera como administrador (cada
 * entrada queda en su registro de actividad), se renombran y se pausan.
 */
export function AgencyPage(): JSX.Element {
    const isAgencyAdmin = useIsAgencyAdmin();
    const overview = useAgencyOverview(isAgencyAdmin);
    const clients = useAgencyClients(isAgencyAdmin);
    const [query, setQuery] = useState('');
    const [creating, setCreating] = useState(false);
    const [renaming, setRenaming] = useState<AgencyClient | null>(null);

    const shown = useMemo(() => {
        const q = normalize(query);
        const list = clients.data ?? [];
        return q ? list.filter((c) => normalize(`${c.name} ${c.slug} ${c.admins.map((a) => `${a.name} ${a.email}`).join(' ')}`).includes(q)) : list;
    }, [clients.data, query]);

    if (!isAgencyAdmin) {
        return (
            <div className="imcrm-mx-auto imcrm-max-w-xl imcrm-py-10 imcrm-text-center" data-testid="agency-not-admin">
                <Building2 className="imcrm-mx-auto imcrm-h-8 imcrm-w-8 imcrm-text-muted-foreground" aria-hidden />
                <h1 className="imcrm-mt-3 imcrm-text-lg imcrm-font-semibold">{__('Esta empresa no es una agencia')}</h1>
                <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Las empresas cliente las gestiona un administrador de la agencia, desde la cuenta de la agencia.')}
                </p>
            </div>
        );
    }

    const o = overview.data;
    const limitText =
        o && o.settings.max_clients !== null ? `${formatNumber(o.clients)} ${__('de')} ${formatNumber(o.settings.max_clients)}` : null;

    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-5xl imcrm-flex-col imcrm-gap-5 imcrm-py-2" data-testid="agency-page">
            <header className="imcrm-flex imcrm-flex-wrap imcrm-items-end imcrm-justify-between imcrm-gap-3">
                <div className="imcrm-min-w-0">
                    <h1 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xl imcrm-font-semibold">
                        <Building2 className="imcrm-h-5 imcrm-w-5 imcrm-text-muted-foreground" aria-hidden />
                        {__('Empresas cliente')}
                    </h1>
                    <p className="imcrm-max-w-2xl imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Las empresas de tus clientes. Entras a cualquiera como administrador, y cada entrada queda en su registro de actividad para que tu cliente sepa quién entró.')}
                    </p>
                </div>
                <Button
                    onClick={() => setCreating(true)}
                    disabled={!o?.can_create}
                    title={o && !o.can_create ? __('Llegaste al tope de empresas cliente de tu agencia.') : undefined}
                    data-testid="agency-new-client"
                    data-tour="agency-new-client"
                >
                    <Plus className="imcrm-h-4 imcrm-w-4" />
                    {__('Nueva empresa cliente')}
                </Button>
            </header>

            {o && (
                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-3" data-testid="agency-summary">
                    <Summary label={__('Empresas cliente')} value={limitText ?? formatNumber(o.clients)} hint={limitText ? __('con el tope de tu agencia') : __('sin tope')} />
                    <Summary label={__('Nacen con el plan')} value={o.client_plan?.name ?? '—'} hint={__('lo elige la plataforma')} />
                    <Summary
                        label={__('Con actividad de la agencia')}
                        value={formatNumber((clients.data ?? []).filter((c) => c.last_agency_access_at).length)}
                        hint={__('alguien de tu equipo entró')}
                    />
                </div>
            )}

            {(clients.data ?? []).length > 6 && (
                <label className="imcrm-relative imcrm-block imcrm-max-w-sm">
                    <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-1/2 imcrm-h-4 imcrm-w-4 imcrm--translate-y-1/2 imcrm-text-muted-foreground" aria-hidden />
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={__('Buscar por empresa o administrador…')}
                        className="imcrm-pl-8"
                        aria-label={__('Buscar empresas cliente')}
                    />
                </label>
            )}

            {clients.isLoading ? (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    {__('Cargando…')}
                </p>
            ) : clients.isError ? (
                <p className="imcrm-text-sm imcrm-text-destructive">{__('No se pudieron cargar las empresas cliente.')}</p>
            ) : (clients.data ?? []).length === 0 ? (
                <Card className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-p-8 imcrm-text-center" data-testid="agency-empty">
                    <Building2 className="imcrm-h-8 imcrm-w-8 imcrm-text-muted-foreground" aria-hidden />
                    <h2 className="imcrm-text-base imcrm-font-semibold">{__('Todavía no tienes empresas cliente')}</h2>
                    <p className="imcrm-max-w-md imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Crea la empresa de tu primer cliente: la armas tú y, cuando quieras, invitas a su equipo.')}
                    </p>
                    <Button className="imcrm-mt-2" onClick={() => setCreating(true)} disabled={!o?.can_create}>
                        <Plus className="imcrm-h-4 imcrm-w-4" />
                        {__('Nueva empresa cliente')}
                    </Button>
                </Card>
            ) : (
                <Card>
                    <ul className="imcrm-divide-y imcrm-divide-border" data-testid="agency-clients" data-tour="agency-clients">
                        {shown.map((c) => (
                            <ClientRow key={c.id} client={c} onRename={() => setRenaming(c)} />
                        ))}
                        {shown.length === 0 && (
                            <li className="imcrm-p-4 imcrm-text-sm imcrm-text-muted-foreground">{__('Ninguna empresa coincide con la búsqueda.')}</li>
                        )}
                    </ul>
                </Card>
            )}

            <AgencyBrandCard />

            {creating && <CreateClientDialog onClose={() => setCreating(false)} />}
            {renaming && <RenameClientDialog client={renaming} onClose={() => setRenaming(null)} />}
        </div>
    );
}

function Summary({ label, value, hint }: { label: string; value: string; hint: string }): JSX.Element {
    return (
        <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-3.5 imcrm-py-3">
            <div className="imcrm-text-[12px] imcrm-text-muted-foreground">{label}</div>
            <div className="imcrm-mt-0.5 imcrm-truncate imcrm-text-lg imcrm-font-semibold">{value}</div>
            <div className="imcrm-text-[11px] imcrm-text-muted-foreground">{hint}</div>
        </div>
    );
}

function ClientRow({ client: c, onRename }: { client: AgencyClient; onRename: () => void }): JSX.Element {
    const enter = useEnterAgencyClient();
    const update = useUpdateAgencyClient();
    const confirm = useConfirm();
    const toast = useToast();
    const state = clientStateLabel(c);
    const admin = c.admins[0] ?? null;

    const togglePause = async (): Promise<void> => {
        if (!c.paused) {
            const ok = await confirm({
                title: `${__('¿Pausar')} «${c.name}»?`,
                description: __('Queda en solo lectura para todo su equipo hasta que la reactives: pueden ver y descargar, no cambiar. No se borra nada.'),
                confirmLabel: __('Pausar'),
                destructive: true,
            });
            if (!ok) return;
        }
        update.mutate(
            { id: c.id, input: { paused: !c.paused } },
            {
                onSuccess: () => toast.success(c.paused ? __('Empresa reactivada') : __('Empresa pausada')),
                onError: (err) => toast.error(__('No se pudo cambiar'), errorText(err)),
            },
        );
    };

    return (
        <li className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3 imcrm-px-4 imcrm-py-3" data-testid="agency-client" data-client={c.slug}>
            <span
                aria-hidden
                className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-text-[12px] imcrm-font-semibold imcrm-text-foreground/80 imcrm-ring-1 imcrm-ring-border"
            >
                {initials(c.name)}
            </span>
            <div className="imcrm-min-w-0 imcrm-flex-1">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                    <span className="imcrm-truncate imcrm-font-medium" data-testid="agency-client-name">{c.name}</span>
                    <Badge
                        variant="outline"
                        className={cn(
                            'imcrm-font-normal',
                            state.tone === 'ok' && 'imcrm-border-success/40 imcrm-text-success',
                            state.tone === 'warn' && 'imcrm-border-warning/40 imcrm-text-warning',
                            state.tone === 'bad' && 'imcrm-border-destructive/40 imcrm-text-destructive',
                        )}
                        data-testid="agency-client-state"
                    >
                        {state.label}
                    </Badge>
                    {c.plan_name && <span className="imcrm-text-[12px] imcrm-text-muted-foreground">{c.plan_name}</span>}
                </div>
                <div className="imcrm-mt-0.5 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-0.5 imcrm-text-[12px] imcrm-text-muted-foreground">
                    <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1">
                        <Users className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {c.users === 1 ? __('1 persona') : `${formatNumber(c.users)} ${__('personas')}`} · {formatNumber(c.records)} {__('registros')}
                    </span>
                    <span className="imcrm-truncate">
                        {admin
                            ? `${__('Administra')}: ${admin.name}${admin.pending ? ` (${__('invitación pendiente')})` : ''}`
                            : __('Sin administrador propio')}
                    </span>
                    <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1">
                        <Clock className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {c.last_agency_access_at ? `${__('La agencia entró')} ${relativeTime(c.last_agency_access_at)}` : __('Nadie de la agencia entró todavía')}
                    </span>
                </div>
            </div>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                <Button
                    size="sm"
                    onClick={() =>
                        enter.mutate(c.id, {
                            onError: (err) => toast.error(__('No se pudo entrar'), errorText(err)),
                        })
                    }
                    disabled={enter.isPending}
                    data-testid="agency-client-enter"
                >
                    {enter.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <LogIn className="imcrm-h-4 imcrm-w-4" />}
                    {__('Entrar')}
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost" aria-label={`${__('Más acciones de')} ${c.name}`} data-testid="agency-client-menu">
                            <MoreHorizontal className="imcrm-h-4 imcrm-w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={onRename}>
                            <Pencil className="imcrm-h-4 imcrm-w-4" />
                            {__('Cambiar el nombre')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void togglePause()} data-testid="agency-client-pause">
                            {c.paused ? <PlayCircle className="imcrm-h-4 imcrm-w-4" /> : <PauseCircle className="imcrm-h-4 imcrm-w-4" />}
                            {c.paused ? __('Reactivar') : __('Pausar (solo lectura)')}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </li>
    );
}

function CreateClientDialog({ onClose }: { onClose: () => void }): JSX.Element {
    const create = useCreateAgencyClient();
    const toast = useToast();
    const [name, setName] = useState('');
    const [invite, setInvite] = useState(false);
    const [email, setEmail] = useState('');
    const [adminName, setAdminName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const emailOk = !invite || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

    const submit = (e: React.FormEvent): void => {
        e.preventDefault();
        if (!name.trim() || !emailOk) return;
        setError(null);
        create.mutate(
            {
                name: name.trim(),
                ...(invite && email.trim() ? { admin_email: email.trim(), ...(adminName.trim() ? { admin_name: adminName.trim() } : {}) } : {}),
            },
            {
                onSuccess: (c) => {
                    toast.success(`${__('Empresa creada:')} ${c.name}`, invite ? __('Le llegó la invitación por correo a su administrador.') : undefined);
                    onClose();
                },
                onError: (err) => setError(errorText(err)),
            },
        );
    };

    return (
        <Dialog onClose={onClose} testId="agency-create-dialog">
            <form onSubmit={submit} className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-pr-8">
                    <RDialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Nueva empresa cliente')}</RDialog.Title>
                    <RDialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                        {__('La empresa nace contigo como administrador por la agencia. Su equipo lo invitas ahora o después.')}
                    </RDialog.Description>
                </div>
                <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm">
                    <span className="imcrm-font-medium">{__('Nombre de la empresa')}</span>
                    <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} data-testid="agency-create-name" />
                </label>
                <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                    <input
                        type="checkbox"
                        className="imcrm-mt-0.5"
                        checked={invite}
                        onChange={(e) => setInvite(e.target.checked)}
                        data-testid="agency-create-invite"
                    />
                    <span>
                        <span className="imcrm-font-medium">{__('Invitar ya a un administrador de tu cliente')}</span>
                        <span className="imcrm-block imcrm-text-[12px] imcrm-text-muted-foreground">
                            {__('Le llega un correo para definir su contraseña. Será el administrador propio de su empresa.')}
                        </span>
                    </span>
                </label>
                {invite && (
                    <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2">
                        <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm">
                            <span className="imcrm-font-medium">{__('Correo')}</span>
                            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="agency-create-email" />
                        </label>
                        <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm">
                            <span className="imcrm-font-medium">{__('Nombre (opcional)')}</span>
                            <Input value={adminName} onChange={(e) => setAdminName(e.target.value)} />
                        </label>
                    </div>
                )}
                {error && <p className="imcrm-text-sm imcrm-text-destructive" role="alert">{error}</p>}
                <div className="imcrm-flex imcrm-flex-wrap imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
                    <Button type="button" variant="ghost" onClick={onClose}>{__('Cancelar')}</Button>
                    <Button type="submit" disabled={!name.trim() || !emailOk || create.isPending} data-testid="agency-create-submit">
                        {create.isPending && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                        {__('Crear empresa')}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}

function RenameClientDialog({ client, onClose }: { client: AgencyClient; onClose: () => void }): JSX.Element {
    const update = useUpdateAgencyClient();
    const [name, setName] = useState(client.name);
    const [error, setError] = useState<string | null>(null);
    const submit = (e: React.FormEvent): void => {
        e.preventDefault();
        if (!name.trim() || name.trim() === client.name) return onClose();
        update.mutate({ id: client.id, input: { name: name.trim() } }, { onSuccess: onClose, onError: (err) => setError(errorText(err)) });
    };
    return (
        <Dialog onClose={onClose} testId="agency-rename-dialog">
            <form onSubmit={submit} className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                <RDialog.Title className="imcrm-pr-8 imcrm-text-base imcrm-font-semibold">{__('Cambiar el nombre')}</RDialog.Title>
                <RDialog.Description className="imcrm-sr-only">{__('El nombre nuevo de la empresa cliente')}</RDialog.Description>
                <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} />
                {error && <p className="imcrm-text-sm imcrm-text-destructive" role="alert">{error}</p>}
                <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                    <Button type="button" variant="ghost" onClick={onClose}>{__('Cancelar')}</Button>
                    <Button type="submit" disabled={!name.trim() || update.isPending}>{__('Guardar')}</Button>
                </div>
            </form>
        </Dialog>
    );
}

const Dialog = forwardRef<HTMLDivElement, { onClose: () => void; testId: string; children: React.ReactNode }>(function Dialog(
    { onClose, testId, children },
    ref,
) {
    return (
        <RDialog.Root open onOpenChange={(o) => !o && onClose()}>
            <RDialog.Portal>
                <RDialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <RDialog.Content
                    ref={ref}
                    data-testid={testId}
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[92vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-lg imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-flex-col imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg"
                >
                    <RDialog.Close asChild>
                        <button type="button" aria-label={__('Cerrar')} className="imcrm-absolute imcrm-right-3 imcrm-top-3 imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent">
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </button>
                    </RDialog.Close>
                    {children}
                </RDialog.Content>
            </RDialog.Portal>
        </RDialog.Root>
    );
});

function errorText(err: unknown): string {
    if (err instanceof ApiError || err instanceof Error) return err.message;
    return String(err);
}

function normalize(s: string): string {
    return s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim();
}
