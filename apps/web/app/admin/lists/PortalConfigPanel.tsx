import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, LayoutGrid, UserRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useFields } from '@/hooks/useFields';
import { useUpdateList } from '@/hooks/useLists';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import type { ListSummary } from '@/types/list';
import { PORTAL_DEFAULTS, type PortalSettings, type PortalTemplate } from '@/types/portal';

// El editor visual del portal ahora vive en su propia ruta
// (`/lists/:slug/portal-editor`, ver `PortalTemplateEditorPage`).
// Desde acá solo enlazamos vía botón — replica el patrón del editor
// del CRM panel (Apariencia del registro).

interface Props {
    list: ListSummary;
}

/**
 * Tab "Configuración del portal" del List Builder (Fase 9 — UI admin).
 *
 * Permite al admin configurar:
 *  1. `settings.portal` — habilita la lista como lista-de-portal,
 *     elige el campo de owner (tipo user) que liga records a wp_users.
 *  2. `settings.portal_template` — define qué bloques aparecen en
 *     el portal del cliente.
 *
 * Editor del template: textarea JSON con validación. Un editor visual
 * drag-and-drop es trabajo significativo para una iteración futura —
 * por ahora el admin escribe (o copia/pega) la config del template.
 * Hay un botón "Insertar ejemplo" para cada tipo de bloque que ayuda
 * sin tener que memorizar el shape.
 */
export function PortalConfigPanel({ list }: Props): JSX.Element {
    const update = useUpdateList(list.id);
    const fields = useFields(list.id);

    const initialPortal = useMemo<PortalSettings>(() => readPortal(list.settings), [list.settings]);
    const initialTemplate = useMemo<PortalTemplate>(() => readTemplate(list.settings), [list.settings]);

    const [portal, setPortal] = useState<PortalSettings>(initialPortal);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [copyHint, setCopyHint] = useState<string | null>(null);

    useEffect(() => {
        setPortal(initialPortal);
    }, [initialPortal]);

    // El template solo se lee acá para mostrar el counter de bloques —
    // se modifica desde la página dedicada `/lists/:slug/portal-editor`.
    const template = initialTemplate;

    const userFields = useMemo(() => (fields.data ?? []).filter((f) => f.type === 'user'), [fields.data]);

    const handleSave = async (): Promise<void> => {
        setSubmitError(null);

        // Validación coherencia: si owner_field_id está seteado, debe
        // existir Y ser tipo `user`. El backend igual valida, pero
        // alertar acá ahorra un round-trip.
        if (portal.owner_field_id !== null) {
            const f = userFields.find((x) => x.id === portal.owner_field_id);
            if (f === undefined) {
                setSubmitError(__('El campo de owner seleccionado no existe o no es de tipo Usuario.'));
                return;
            }
        }

        if (portal.enabled && portal.owner_field_id === null) {
            setSubmitError(__('Para habilitar el portal debes elegir un campo de tipo Usuario como owner.'));
            return;
        }

        try {
            // No tocamos `portal_template` desde acá — se administra
            // desde la página dedicada `/lists/:slug/portal-editor`.
            // Si lo incluyéramos pisaríamos los cambios que el user
            // hizo allá sin haber refrescado este panel.
            const nextSettings = mergeIntoSettings(list.settings, portal);
            await update.mutateAsync({ settings: nextSettings });
        } catch (err) {
            setSubmitError(
                err instanceof ApiError || err instanceof Error ? err.message : __('Error desconocido'),
            );
        }
    };

    const handleCopyShortcode = async (): Promise<void> => {
        try {
            await navigator.clipboard.writeText('[imcrm-client-portal]');
            setCopyHint(__('Copiado al portapapeles.'));
            window.setTimeout(() => setCopyHint(null), 2000);
        } catch {
            setCopyHint(__('No se pudo copiar — selecciónalo manualmente.'));
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
                                'Marca esta lista como "lista de portal" para que sus registros se conviertan en cuentas accesibles desde el frontend. Cada record corresponde a un cliente.',
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
                        onChange={(e) => setPortal((p) => ({ ...p, enabled: e.target.checked }))}
                        className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                    />
                    {__('Habilitar como lista de portal')}
                </label>

                {portal.enabled && (
                    <>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="portal-owner-field">{__('Campo de owner (tipo Usuario)')}</Label>
                            <select
                                id="portal-owner-field"
                                className="imcrm-h-9 imcrm-w-full imcrm-max-w-md imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-3 imcrm-text-sm"
                                value={portal.owner_field_id ?? ''}
                                onChange={(e) =>
                                    setPortal((p) => ({
                                        ...p,
                                        owner_field_id: e.target.value === '' ? null : parseInt(e.target.value, 10),
                                    }))
                                }
                            >
                                <option value="">{__('— Elegir campo —')}</option>
                                {userFields.map((f) => (
                                    <option key={f.id} value={f.id}>
                                        {f.label} ({f.slug})
                                    </option>
                                ))}
                            </select>
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {__(
                                    'Este campo conecta cada record de cliente con su cuenta WP. Si no hay campos de tipo Usuario, agrega uno primero.',
                                )}
                            </p>
                        </div>

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                            <Label>{__('Diseño del portal')}</Label>
                            <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-px-4 imcrm-py-3">
                                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-0.5">
                                    <p className="imcrm-text-sm imcrm-font-medium imcrm-text-foreground">
                                        {template.blocks.length === 0
                                            ? __('Sin bloques configurados')
                                            : `${template.blocks.length} ${template.blocks.length === 1 ? __('bloque') : __('bloques')} ${__('en la plantilla')}`}
                                    </p>
                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                        {__('Abrí el editor visual para diseñar el portal con grid 12-col, drag-and-drop, palette de bloques y configuración por cada uno.')}
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

                        <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-px-3 imcrm-py-3">
                            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                                <code className="imcrm-truncate imcrm-font-mono imcrm-text-xs">
                                    [imcrm-client-portal]
                                </code>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void handleCopyShortcode()}
                                    className="imcrm-gap-1.5"
                                >
                                    <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Copiar')}
                                </Button>
                            </div>
                            <p className="imcrm-mt-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Pega este shortcode en cualquier página WP para mostrar el portal a los clientes logueados.')}
                            </p>
                            {copyHint !== null && (
                                <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-primary">{copyHint}</p>
                            )}
                        </div>
                    </>
                )}

                {!portal.enabled && (
                    <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/30 imcrm-px-3 imcrm-py-3 imcrm-text-xs imcrm-text-muted-foreground">
                        {__(
                            'Esta lista no está marcada como portal. Los endpoints /portal/* devuelven 404 cuando se pide referencia a esta lista.',
                        )}
                    </p>
                )}

                {submitError !== null && (
                    <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                        {submitError}
                    </div>
                )}

                <div className="imcrm-flex imcrm-justify-end">
                    <Button onClick={handleSave} disabled={update.isPending}>
                        {update.isPending ? __('Guardando…') : __('Guardar configuración del portal')}
                    </Button>
                </div>
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
    if (raw === null || raw === undefined || typeof raw !== 'object') {
        return { blocks: [] };
    }
    const t = raw as Record<string, unknown>;
    if (!Array.isArray(t.blocks)) return { blocks: [] };
    return { blocks: t.blocks as PortalTemplate['blocks'] };
}

function mergeIntoSettings(
    current: Record<string, unknown>,
    portal: PortalSettings,
): Record<string, unknown> {
    return {
        ...current,
        portal,
    };
}

