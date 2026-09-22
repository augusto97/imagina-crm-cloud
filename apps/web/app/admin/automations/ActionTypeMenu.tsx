import { Plus } from 'lucide-react';
import { Link } from 'react-router';

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { __ } from '@/lib/i18n';
import type { LucideIcon } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import type { ActionMeta } from '@/types/automation';

import { actionMetaFor } from './automationMeta';

function Row({
    icon: Icon,
    title,
    description,
    onSelect,
}: {
    icon: LucideIcon;
    title: string;
    description: string;
    onSelect: () => void;
}): JSX.Element {
    return (
        <DropdownMenuItem onSelect={onSelect} className="imcrm-items-start imcrm-gap-2.5 imcrm-py-2">
            <span className="imcrm-mt-0.5 imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-muted imcrm-ring-1 imcrm-ring-border">
                <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-foreground/70" />
            </span>
            <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-0.5">
                <span className="imcrm-text-[13px] imcrm-font-medium">{title}</span>
                {description !== '' && (
                    <span className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                        {description}
                    </span>
                )}
            </span>
        </DropdownMenuItem>
    );
}

/**
 * Menú de tipos de acción (icono + título + descripción). Elegir un
 * tipo inserta la acción directamente — sin paso intermedio. Compartido
 * entre el flujo vertical y el lienzo visual.
 *
 * v0.1.198 — debajo de los tipos fijos aparecen las acciones CON NOMBRE de
 * lo que la empresa conectó ("Enviar WhatsApp"). Elegir una inserta ya
 * apuntada a esa conexión y esa acción: el menú deja de preguntar "¿qué
 * tipo?" para ofrecer lo que de verdad se hace. v0.1.203 — con el logo de
 * cada app y un atajo a conectar otras.
 */
export function ActionTypeMenu({
    actionsCatalog,
    onPick,
    children,
    exclude,
}: {
    actionsCatalog: ActionMeta[];
    /** `config` inicial: vacío en los tipos fijos, apuntado en un conector. */
    onPick: (type: string, config?: Record<string, unknown>) => void;
    children: React.ReactNode;
    /** Slugs a ocultar (ej. if_else cuando se alcanzó el anidado máximo). */
    exclude?: string[];
}): JSX.Element {
    const hidden = exclude ?? [];
    const builtins = actionsCatalog.filter((a) => !a.connector && !hidden.includes(a.slug));
    const connectors = actionsCatalog.filter((a) => a.connector && !hidden.includes(a.slug));

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="imcrm-max-h-[70vh] imcrm-w-[300px] imcrm-overflow-y-auto">
                {builtins.map((a) => {
                    const meta = actionMetaFor(a.slug);
                    return (
                        <Row
                            key={a.slug}
                            icon={meta.icon}
                            title={a.label}
                            description={meta.description !== '' ? __(meta.description) : ''}
                            onSelect={() => onPick(a.slug)}
                        />
                    );
                })}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="imcrm-text-[11px] imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                    {__('Apps conectadas')}
                </DropdownMenuLabel>
                {connectors.map((a) => (
                    <DropdownMenuItem
                        key={`${a.connector!.connection_id}:${a.connector!.action_key}`}
                        onSelect={() =>
                            onPick('connector_action', {
                                connection_id: a.connector!.connection_id,
                                action_key: a.connector!.action_key,
                                values: {},
                            })
                        }
                        className="imcrm-items-start imcrm-gap-2.5 imcrm-py-2"
                        data-testid="imcrm-action-connector"
                    >
                        <IntegrationLogo
                            integrationKey={a.connector!.integration_key ?? null}
                            size={28}
                            className="imcrm-mt-0.5"
                        />
                        <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-0.5">
                            <span className="imcrm-text-[13px] imcrm-font-medium">{a.label}</span>
                            <span className="imcrm-truncate imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                                {a.connector!.connection_name}
                            </span>
                        </span>
                    </DropdownMenuItem>
                ))}
                {/* v0.1.203 — el camino a conectar más apps, desde donde se las
                    necesita: sin esto, descubrir WhatsApp o Slack exigía saber
                    que existe Ajustes → Integraciones. Abre en otra pestaña
                    para no perder la automatización que se está armando; al
                    volver, el catálogo se refresca solo (refetch al enfocar). */}
                <DropdownMenuItem asChild className="imcrm-gap-2.5 imcrm-py-2">
                    <Link
                        to="/settings?s=conectores"
                        target="_blank"
                        rel="noreferrer"
                        data-testid="imcrm-action-connect-more"
                    >
                        <span className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border">
                            <Plus className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                        </span>
                        <span className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                            <span className="imcrm-text-[13px] imcrm-font-medium">
                                {connectors.length > 0 ? __('Conectar otra app') : __('Conectar una app')}
                            </span>
                            <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                {__('WhatsApp, Slack, Gmail, Google Calendar…')}
                            </span>
                        </span>
                    </Link>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
