import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { KeyRound, LayoutGrid, UserRound } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { useUpdateList } from '@/hooks/useLists';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import type { ListSummary } from '@/types/list';
import { PORTAL_DEFAULTS, type PortalSettings, type PortalTemplate } from '@/types/portal';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PortalRelatedList } from '@imagina-base/shared';

interface Props {
    list: ListSummary;
}

/**
 * Panel "Portal del cliente" del editor de lista.
 *
 * En Imagina Base cloud el portal NO se embebe con un shortcode de WordPress:
 * cada registro puede tener un portal privado al que su cliente accede con un
 * MAGIC LINK que el admin emite desde la ficha del registro (el link llega por
 * email y abre una sesión de un solo uso). Este panel:
 *  1. Habilita el portal para la lista (`settings.portal.enabled`).
 *  2. Enlaza al editor visual de la PLANTILLA (qué bloques ve el cliente).
 *  3. Explica cómo darle acceso a un cliente en la app cloud.
 */
export function PortalConfigPanel({ list }: Props): JSX.Element {
    const update = useUpdateList(list.id);

    const initialPortal = useMemo<PortalSettings>(() => readPortal(list.settings), [list.settings]);
    const template = useMemo<PortalTemplate>(() => readTemplate(list.settings), [list.settings]);

    const [portal, setPortal] = useState<PortalSettings>(initialPortal);
    const [submitError, setSubmitError] = useState<string | null>(null);

    useEffect(() => {
        setPortal(initialPortal);
    }, [initialPortal]);

    const handleToggle = async (enabled: boolean): Promise<void> => {
        setSubmitError(null);
        const next = { ...portal, enabled };
        setPortal(next);
        try {
            await update.mutateAsync({ settings: mergeIntoSettings(list.settings, next) });
        } catch (err) {
            setPortal(portal); // revertir
            setSubmitError(
                err instanceof ApiError || err instanceof Error ? err.message : __('Error desconocido'),
            );
        }
    };

    const handleRelated = async (ids: number[]): Promise<void> => {
        setSubmitError(null);
        const previous = portal;
        const next = { ...portal, related_lists: ids };
        setPortal(next);
        try {
            await update.mutateAsync({ settings: mergeIntoSettings(list.settings, next) });
        } catch (err) {
            setPortal(previous);
            setSubmitError(
                err instanceof ApiError || err instanceof Error ? err.message : __('Error desconocido'),
            );
        }
    };

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <UserRound className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1">
                        <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base">
                            {__('Portal del cliente')}
                            {portal.enabled && <Badge variant="success">{__('Activo')}</Badge>}
                        </CardTitle>
                        <CardDescription>
                            {__(
                                'Cada registro puede tener su propia página privada. Le mandás un enlace de acceso al cliente y entra sin usuario ni contraseña.',
                            )}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-px-4 imcrm-py-3">
                    <input
                        type="checkbox"
                        checked={portal.enabled}
                        disabled={update.isPending}
                        onChange={(e) => void handleToggle(e.target.checked)}
                        className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                    />
                    <span className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                        <span className="imcrm-text-sm imcrm-font-medium">
                            {__('Activar el portal en esta lista')}
                        </span>
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Después vas a poder diseñar qué ve el cliente.')}
                        </span>
                    </span>
                </label>

                {portal.enabled ? (
                    <>
                        {/* Plantilla del portal — el editor visual real. */}
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                            <span className="imcrm-text-sm imcrm-font-medium">{__('Diseño del portal')}</span>
                            <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-px-4 imcrm-py-3">
                                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-0.5">
                                    <p className="imcrm-text-sm imcrm-font-medium imcrm-text-foreground">
                                        {template.blocks.length === 0
                                            ? __('Sin bloques configurados')
                                            : `${template.blocks.length} ${template.blocks.length === 1 ? __('bloque') : __('bloques')} ${__('en la plantilla')}`}
                                    </p>
                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                        {__('Armá la página del cliente arrastrando bloques: sus datos, archivos, comentarios, indicadores…')}
                                    </p>
                                </div>
                                <Button asChild size="sm" variant="outline" className="imcrm-shrink-0 imcrm-gap-1.5">
                                    <Link to={`/lists/${list.slug}/portal-editor`}>
                                        <LayoutGrid className="imcrm-h-3.5 imcrm-w-3.5" />
                                        {template.blocks.length === 0 ? __('Crear') : __('Editar')}
                                    </Link>
                                </Button>
                            </div>
                        </div>

                        {/* v0.1.153 — "todo lo relacionado a mí": qué OTRAS
                            listas ve el cliente en su portal. Opt-in: por
                            defecto ninguna (una lista interna con un vínculo al
                            cliente no tiene por qué ser visible para él). */}
                        <RelatedListsPicker
                            list={list}
                            selected={portal.related_lists}
                            disabled={update.isPending}
                            onChange={(ids) => void handleRelated(ids)}
                        />

                        {/* Cómo accede el cliente — reemplaza al shortcode de WordPress. */}
                        <div className="imcrm-flex imcrm-items-start imcrm-gap-2.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-px-4 imcrm-py-3">
                            <KeyRound className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-primary" />
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <p className="imcrm-text-sm imcrm-font-medium imcrm-text-foreground">
                                    {__('¿Cómo le doy acceso a un cliente?')}
                                </p>
                                <ol className="imcrm-flex imcrm-list-decimal imcrm-flex-col imcrm-gap-0.5 imcrm-pl-4 imcrm-text-xs imcrm-text-muted-foreground">
                                    <li>{__('Abrí el registro del cliente (desde la tabla de la lista).')}</li>
                                    <li>{__('En la ficha, usá "Emitir acceso al portal" — se le envía el enlace por email.')}</li>
                                    <li>{__('El cliente abre el enlace y ve su portal, sin registrarse.')}</li>
                                </ol>
                            </div>
                        </div>
                    </>
                ) : (
                    <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/30 imcrm-px-3 imcrm-py-3 imcrm-text-xs imcrm-text-muted-foreground">
                        {__('El portal está desactivado para esta lista. Actívalo para diseñar la plantilla y poder emitir accesos a los clientes.')}
                    </p>
                )}

                {submitError !== null && (
                    <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                        {submitError}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

/**
 * Elige qué otras listas ve el cliente en su portal. Sólo aparecen las que de
 * verdad se pueden acotar a él: las que tienen un campo `relation` apuntando a
 * esta lista (sus facturas, sus tickets) o un campo `user`. Si una lista no
 * está acá, el backend no tendría forma de saber qué filas le pertenecen —y
 * por diseño no muestra nada antes que mostrar de más.
 */
function RelatedListsPicker({
    list,
    selected,
    disabled,
    onChange,
}: {
    list: ListSummary;
    selected: number[];
    disabled: boolean;
    onChange: (ids: number[]) => void;
}): JSX.Element {
    const options = useQuery({
        queryKey: ['portal-related-options', list.id],
        queryFn: async (): Promise<PortalRelatedList[]> => {
            const res = await api.get<{ options: PortalRelatedList[] }>(
                `/lists/${encodeURIComponent(list.slug)}/portal/related-options`,
            );
            return res.data.options;
        },
        retry: false,
    });

    const toggle = (id: number): void => {
        onChange(selected.includes(id) ? selected.filter((n) => n !== id) : [...selected, id]);
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
            <span className="imcrm-text-sm imcrm-font-medium">{__('Qué más ve el cliente')}</span>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-px-4 imcrm-py-3">
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Además de su ficha, el cliente puede ver los registros de otras listas que le pertenecen (sus facturas, sus tickets…). Elegí cuáles: por defecto no ve ninguna.')}
                </p>
                {options.isLoading && (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Buscando listas vinculadas…')}</p>
                )}
                {options.data?.length === 0 && (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Ninguna otra lista está vinculada a ésta. Agregá un campo de tipo "relación" apuntando a esta lista (por ejemplo, en Facturas un campo "Cliente") y aparecerá acá.')}
                    </p>
                )}
                {(options.data ?? []).map((o) => (
                    <label
                        key={o.list_id}
                        className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2.5 imcrm-text-sm"
                    >
                        <input
                            type="checkbox"
                            className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                            checked={selected.includes(o.list_id)}
                            disabled={disabled}
                            onChange={() => toggle(o.list_id)}
                        />
                        <span className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                            <span className="imcrm-font-medium">{o.name}</span>
                            <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                {o.via === 'relation'
                                    ? `${__('Se vincula por el campo')} «${o.via_field_label}»`
                                    : `${__('Se filtra por el campo de usuario')} «${o.via_field_label}»`}
                            </span>
                        </span>
                    </label>
                ))}
            </div>
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────

function readPortal(settings: Record<string, unknown>): PortalSettings {
    const raw = settings.portal;
    if (raw === null || raw === undefined || typeof raw !== 'object') {
        return { ...PORTAL_DEFAULTS };
    }
    const p = raw as Record<string, unknown>;
    return {
        related_lists: Array.isArray(p.related_lists)
            ? p.related_lists.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
            : [],
        enabled: Boolean(p.enabled),
        owner_field_id:
            typeof p.owner_field_id === 'number' && p.owner_field_id > 0 ? p.owner_field_id : null,
        default_template_id:
            typeof p.default_template_id === 'number' && p.default_template_id > 0
                ? p.default_template_id
                : null,
    };
}

function readTemplate(settings: Record<string, unknown>): PortalTemplate {
    const raw = settings.portal_template;
    if (Array.isArray(raw)) {
        // El backend guarda portal_template como ARRAY de bloques.
        return { blocks: raw as PortalTemplate['blocks'] };
    }
    if (raw !== null && typeof raw === 'object' && Array.isArray((raw as { blocks?: unknown }).blocks)) {
        return { blocks: (raw as PortalTemplate).blocks };
    }
    return { blocks: [] };
}

function mergeIntoSettings(
    current: Record<string, unknown>,
    portal: PortalSettings,
): Record<string, unknown> {
    return { ...current, portal };
}
