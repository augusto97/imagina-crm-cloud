import { useQueryClient } from '@tanstack/react-query';
import { Building2, Check, ChevronsUpDown } from 'lucide-react';

import { roleLabel, switchWorkspace, useWorkspaces } from '@/cloud/workspaceSwitch';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * v0.1.286 — Las empresas de la persona como items de un menú (la del panel
 * lateral y la del menú de usuario usan esta misma lista). La actual lleva
 * check; elegir otra cambia de empresa (`switchWorkspace`).
 */
export function WorkspaceMenuItems({ onSwitched }: { onSwitched?: () => void }): JSX.Element {
    const qc = useQueryClient();
    const { memberships, active } = useWorkspaces();
    return (
        <>
            {memberships.map((m) => {
                const current = m.tenant_id === active?.tenant_id;
                return (
                    <DropdownMenuItem
                        key={m.tenant_id}
                        data-testid="workspace-option"
                        data-current={current ? 'true' : undefined}
                        onSelect={() => {
                            if (current) return;
                            if (switchWorkspace(m.tenant_id, qc)) onSwitched?.();
                        }}
                        className="imcrm-gap-2.5"
                    >
                        <span
                            aria-hidden
                            className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-text-[11px] imcrm-font-semibold imcrm-text-foreground/80 imcrm-ring-1 imcrm-ring-border"
                        >
                            {initials(m.tenant_name)}
                        </span>
                        <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                            <span className={cn('imcrm-truncate', current && 'imcrm-font-semibold')}>{m.tenant_name}</span>
                            <span className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">{roleLabel(m.role)}</span>
                        </span>
                        {current && <Check className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-primary" aria-label={__('Empresa actual')} />}
                    </DropdownMenuItem>
                );
            })}
        </>
    );
}

export function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Título del panel lateral con el cambio de empresa: el nombre de la empresa
 * (o de la app white-label) y, si la persona es miembro de más de una, un
 * menú para pasar a otra. Con dominio propio la empresa queda fijada: sólo el
 * nombre.
 */
export function WorkspaceSwitcherTitle({ title }: { title: string }): JSX.Element {
    const { memberships, active, locked } = useWorkspaces();
    const canSwitch = memberships.length > 1 && !locked;
    if (!canSwitch) {
        return (
            <span
                className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-[15px] imcrm-font-semibold imcrm-text-foreground lg:imcrm-text-[14px]"
                title={active?.tenant_name}
            >
                {title}
            </span>
        );
    }
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    data-testid="workspace-switcher"
                    aria-label={__('Cambiar de empresa')}
                    title={__('Cambiar de empresa')}
                    onClick={(e) => e.stopPropagation()}
                    className="imcrm-group/ws -imcrm-ml-1.5 imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-px-1.5 imcrm-py-1 imcrm-text-left imcrm-transition-colors hover:imcrm-bg-muted data-[state=open]:imcrm-bg-muted"
                >
                    <span className="imcrm-min-w-0 imcrm-truncate imcrm-text-[15px] imcrm-font-semibold imcrm-text-foreground lg:imcrm-text-[14px]">
                        {title}
                    </span>
                    <ChevronsUpDown className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground group-hover/ws:imcrm-text-foreground" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="start"
                className="imcrm-w-72"
                onClick={(e) => e.stopPropagation()}
            >
                <DropdownMenuLabel className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                    <Building2 className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    {__('Tus empresas')}
                </DropdownMenuLabel>
                <WorkspaceMenuItems />
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
