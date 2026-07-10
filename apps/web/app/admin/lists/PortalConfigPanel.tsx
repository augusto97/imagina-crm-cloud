import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, LayoutGrid, UserRound } from 'lucide-react';

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

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <UserRound className="imcrm-mt-0.5 imcrm-h-5 imcrm-w-5 imcrm-text-muted-foreground" />
                    <div>
                        <CardTitle>{__('Portal del cliente')}</CardTitle>
                        <CardDescription>
                            {__(
                                'Da a cada registro de esta lista un portal privado. El cliente accede con un enlace de acceso (magic link) que le emitís desde la ficha del registro; no necesita usuario ni contraseña.',
                            )}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                <label className="imcrm-inline-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                    <input
                        type="checkbox"
                        checked={portal.enabled}
                        disabled={update.isPending}
                        onChange={(e) => void handleToggle(e.target.checked)}
                        className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                    />
                    {__('Habilitar portal para esta lista')}
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
                                        {__('Diseñá qué ve el cliente: datos del registro, archivos, comentarios, KPIs, etc., con grid drag-and-drop.')}
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
