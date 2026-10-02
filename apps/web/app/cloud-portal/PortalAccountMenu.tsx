import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Building2, Check, ChevronDown, LogOut, Mail } from 'lucide-react';
import type { PortalAccount } from '@imagina-base/shared';

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { portalApi } from '@/cloud-portal/portalClient';
import { CloudApiError } from '@/lib/cloud/client';

/**
 * v0.1.241 — el menú de la persona en el portal: qué CUENTA está viendo (una
 * por registro al que tiene acceso: su empresa, sus contratos…), cambiar a
 * otra, pedirse por correo el enlace que muestra las de OTRAS empresas, y
 * salir. Una cuenta de la misma empresa se cambia al toque; una de otra
 * empresa abre su portal con un enlace de un solo uso que acuña el servidor.
 */
export function PortalAccountMenu({
    accountId,
    onSelect,
    onLogout,
}: {
    accountId: number | null;
    onSelect: (id: number) => void;
    onLogout: () => void;
}): JSX.Element {
    const accounts = useQuery({
        queryKey: ['portal-accounts', accountId],
        queryFn: () => portalApi.portalAccounts(),
        retry: false,
        staleTime: 60_000,
    });
    const [notice, setNotice] = useState<string | null>(null);

    const switchTo = useMutation({
        mutationFn: (acc: PortalAccount) => portalApi.portalSwitchAccount(acc.id),
        onSuccess: (res, acc) => {
            if (res.path) window.location.assign(res.path);
            else onSelect(acc.id);
        },
        onError: (err) => setNotice(err instanceof CloudApiError ? err.message : 'No se pudo abrir esa cuenta.'),
    });
    const emailAll = useMutation({
        mutationFn: () => portalApi.portalEmailAllAccounts(),
        onSuccess: (r) =>
            setNotice(
                r.email_sent
                    ? `Te mandamos un enlace a ${r.email_hint}. Abrilo para ver todas tus cuentas juntas.`
                    : 'No pudimos mandar el correo. Probá de nuevo en unos minutos.',
            ),
        onError: (err) => setNotice(err instanceof CloudApiError ? err.message : 'No pudimos mandar el correo.'),
    });
    const logout = useMutation({
        mutationFn: () => portalApi.portalLogout(),
        onSettled: () => onLogout(),
    });

    const list = accounts.data?.accounts ?? [];
    const current = list.find((a) => a.current);
    const companies = new Set(list.map((a) => a.tenant_id));
    const multiCompany = companies.size > 1;
    const grouped = [...companies].map((tid) => list.filter((a) => a.tenant_id === tid));

    return (
        <div className="imcrm-ml-auto imcrm-flex imcrm-flex-col imcrm-items-end imcrm-gap-1">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        data-testid="portal-account-menu"
                        className="imcrm-flex imcrm-max-w-[16rem] imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2.5 imcrm-py-1.5 imcrm-text-left imcrm-text-sm hover:imcrm-bg-muted/60"
                    >
                        <span className="imcrm-min-w-0">
                            <span className="imcrm-block imcrm-truncate imcrm-font-medium">
                                {current?.record_title ?? 'Mi cuenta'}
                            </span>
                            {current && (multiCompany || list.length > 1) && (
                                <span className="imcrm-block imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                                    {multiCompany ? current.tenant_name : current.list_name}
                                </span>
                            )}
                        </span>
                        <ChevronDown className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="imcrm-w-72">
                    {list.length > 1 &&
                        grouped.map((group) => (
                            <div key={group[0]!.tenant_id}>
                                <DropdownMenuLabel className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                                    <Building2 className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                    {group[0]!.tenant_name}
                                </DropdownMenuLabel>
                                {group.map((acc) => (
                                    <DropdownMenuItem
                                        key={acc.id}
                                        data-testid="portal-account-item"
                                        disabled={!acc.available || switchTo.isPending}
                                        onSelect={() => {
                                            if (!acc.current) switchTo.mutate(acc);
                                        }}
                                        className="imcrm-flex imcrm-items-start imcrm-gap-2"
                                    >
                                        <span className="imcrm-mt-0.5 imcrm-w-4 imcrm-shrink-0">
                                            {acc.current && <Check className="imcrm-h-4 imcrm-w-4" aria-hidden />}
                                        </span>
                                        <span className="imcrm-min-w-0">
                                            <span className="imcrm-block imcrm-truncate">{acc.record_title}</span>
                                            <span className="imcrm-block imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                                                {acc.available ? acc.list_name : 'No disponible ahora'}
                                            </span>
                                        </span>
                                    </DropdownMenuItem>
                                ))}
                            </div>
                        ))}
                    {list.length > 1 && <DropdownMenuSeparator />}
                    {accounts.data && !accounts.data.all_companies && (
                        <DropdownMenuItem
                            data-testid="portal-email-all"
                            disabled={emailAll.isPending}
                            onSelect={() => emailAll.mutate()}
                            className="imcrm-flex imcrm-items-start imcrm-gap-2"
                        >
                            <Mail className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                            <span>
                                <span className="imcrm-block">¿Sos cliente de otra empresa?</span>
                                <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                    Te mandamos a tu correo un enlace para verlas todas juntas
                                </span>
                            </span>
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                        data-testid="portal-logout"
                        onSelect={() => logout.mutate()}
                        className="imcrm-flex imcrm-items-center imcrm-gap-2"
                    >
                        <LogOut className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        Salir
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            {notice && (
                <p role="status" className="imcrm-max-w-xs imcrm-text-right imcrm-text-xs imcrm-text-muted-foreground">
                    {notice}
                </p>
            )}
        </div>
    );
}
