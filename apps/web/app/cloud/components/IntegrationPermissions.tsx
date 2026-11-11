import { useEffect, useState } from 'react';
import type { IntegrationPermissionGroup } from '@imagina-base/shared';
import { Check, ChevronDown, ChevronRight, Copy, KeyRound, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * v0.1.403 — Los permisos que tiene que tener la clave de una app (Whats),
 * agrupados por lo que habilitan. Antes los pasos de conexión nombraban sólo
 * los de conectar, y las acciones de contactos, etiquetas, grupos, flujos o la
 * bandeja fallaban después por un permiso que nadie había pedido.
 *
 * Con `granted` (lo que informa el servicio al revisar la clave) cada permiso
 * se marca como presente o faltante. `null` = todavía no se sabe.
 */
export function IntegrationPermissions({
    groups,
    granted,
    hint,
    className,
}: {
    groups: IntegrationPermissionGroup[];
    granted: string[] | null;
    /** Qué hacer para saber cuáles tiene la clave (cuando `granted` es null). */
    hint?: string;
    className?: string;
}): JSX.Element {
    const all = granted !== null && granted.includes('*');
    const has = (key: string): boolean | null => (granted === null ? null : all || granted.includes(key));
    const missingIn = (g: IntegrationPermissionGroup): string[] => (granted === null ? [] : g.permissions.filter((p) => !has(p.key)).map((p) => p.key));
    const required = groups.filter((g) => g.required);
    const optional = groups.filter((g) => !g.required);
    const missingOptional = optional.filter((g) => missingIn(g).length > 0);
    const missingAll = groups.flatMap(missingIn);
    // Las opcionales se pliegan: se abren solas cuando la revisión dice que a
    // la clave le falta alguna (y quedan como la persona las deje después).
    const [open, setOpen] = useState(missingOptional.length > 0);
    const [copied, setCopied] = useState(false);
    const grantedKey = granted === null ? '' : granted.join(',');
    const lacksOptional = missingOptional.length > 0;
    useEffect(() => {
        if (lacksOptional) setOpen(true);
    }, [grantedKey, lacksOptional]);
    const isOpen = open;

    const copy = async (): Promise<void> => {
        const keys = granted !== null && missingAll.length > 0 ? missingAll : groups.flatMap((g) => g.permissions.map((p) => p.key));
        try {
            await navigator.clipboard.writeText(keys.join(', '));
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
        } catch {
            // Sin portapapeles (http, permiso): los nombres igual están a la vista.
        }
    };

    return (
        <section
            className={cn('imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3 imcrm-text-xs', className)}
            data-testid="imcrm-integration-permissions"
            data-tour="integration-permissions"
            data-missing={granted === null ? undefined : missingAll.length}
        >
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <KeyRound className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                <h3 className="imcrm-text-sm imcrm-font-medium">{__('Permisos de la clave')}</h3>
                {granted !== null &&
                    (missingAll.length === 0 ? (
                        <Badge variant="success" data-testid="imcrm-integration-permissions-all">
                            {__('Tiene todos')}
                        </Badge>
                    ) : (
                        <Badge variant="warning" data-testid="imcrm-integration-permissions-missing">
                            {missingAll.length === 1 ? __('Le falta 1') : `${__('Le faltan')} ${missingAll.length}`}
                        </Badge>
                    ))}
                <Button type="button" variant="ghost" size="sm" className="imcrm-ml-auto imcrm-h-7 imcrm-px-2 imcrm-text-xs" onClick={() => void copy()} data-testid="imcrm-integration-permissions-copy">
                    <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                    {copied ? __('Copiado') : granted !== null && missingAll.length > 0 ? __('Copiar los que faltan') : __('Copiar los nombres')}
                </Button>
            </div>
            <p className="imcrm-mt-1 imcrm-text-muted-foreground">
                {granted === null
                    ? (hint ?? __('Márcalos al crear la clave en tu panel. Los nombres son los mismos que ves allá.'))
                    : missingAll.length === 0
                      ? __('Con esta clave funcionan todas las acciones y los disparadores.')
                      : __('Marca los que faltan al editar la clave en tu panel y vuelve a revisarla aquí.')}
            </p>

            <div className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-2">
                {required.map((g) => (
                    <PermissionGroupRow key={g.key} group={g} has={has} />
                ))}
            </div>

            {optional.length > 0 && (
                <div className="imcrm-mt-2 imcrm-border-t imcrm-border-border imcrm-pt-2">
                    <button
                        type="button"
                        className="imcrm-flex imcrm-w-full imcrm-items-start imcrm-gap-1 imcrm-text-left imcrm-font-medium hover:imcrm-text-foreground"
                        onClick={() => setOpen((v) => !v)}
                        aria-expanded={isOpen}
                        data-testid="imcrm-integration-permissions-toggle"
                    >
                        {isOpen ? <ChevronDown className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" /> : <ChevronRight className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />}
                        <span>
                            {__('Para más acciones y disparadores')}{' '}
                            <span className="imcrm-font-normal imcrm-text-muted-foreground">
                                ({optional.map((g) => g.title.toLowerCase()).join(', ')})
                            </span>
                        </span>
                    </button>
                    {isOpen && (
                        <div className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-2">
                            <p className="imcrm-text-muted-foreground">{__('Sólo hacen falta si vas a usar esas funciones. Puedes sumarlos después y actualizar la clave.')}</p>
                            {optional.map((g) => (
                                <PermissionGroupRow key={g.key} group={g} has={has} />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}

function PermissionGroupRow({ group, has }: { group: IntegrationPermissionGroup; has: (key: string) => boolean | null }): JSX.Element {
    return (
        <div data-testid={`imcrm-integration-permissions-group-${group.key}`}>
            <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-font-medium">
                {group.title}
                {group.required && <span className="imcrm-text-[10px] imcrm-font-normal imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Necesarios')}</span>}
            </p>
            <p className="imcrm-text-muted-foreground">{group.help}</p>
            <ul className="imcrm-mt-1 imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                {group.permissions.map((p) => {
                    const ok = has(p.key);
                    return (
                        <li
                            key={p.key}
                            title={p.label}
                            className={cn(
                                'imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-border imcrm-px-1.5 imcrm-py-0.5',
                                ok === null && 'imcrm-border-border imcrm-bg-muted',
                                ok === true && 'imcrm-border-emerald-300 imcrm-bg-emerald-50 imcrm-text-emerald-800 dark:imcrm-border-emerald-800 dark:imcrm-bg-emerald-950 dark:imcrm-text-emerald-300',
                                ok === false &&
                                    (group.required
                                        ? 'imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-text-destructive'
                                        : 'imcrm-border-amber-300 imcrm-bg-amber-50 imcrm-text-amber-800 dark:imcrm-border-amber-800 dark:imcrm-bg-amber-950 dark:imcrm-text-amber-300'),
                            )}
                            data-testid={`imcrm-integration-permission-${p.key}`}
                            data-state={ok === null ? 'unknown' : ok ? 'ok' : 'missing'}
                        >
                            {ok === true && <Check className="imcrm-h-3 imcrm-w-3" aria-label={__('La tiene')} />}
                            {ok === false && <X className="imcrm-h-3 imcrm-w-3" aria-label={__('Le falta')} />}
                            <code className="imcrm-font-mono imcrm-text-[11px]">{p.key}</code>
                            <span className="imcrm-text-[11px] imcrm-opacity-80">· {p.label}</span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
