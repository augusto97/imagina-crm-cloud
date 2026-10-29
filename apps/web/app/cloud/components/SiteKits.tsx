import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertTriangle, CheckCircle2, ImageIcon, Loader2, SearchCheck, Sparkles } from 'lucide-react';
import type { SiteKit, SiteKitResult, SiteSyncObjectState, SiteSyncStatus } from '@imagina-base/shared';

import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { listsKeys } from '@/hooks/useLists';
import { api as dataApi } from '@/lib/api';
import { CloudApiError } from '@/lib/cloud/client';
import { __, sprintf } from '@/lib/i18n';

/**
 * Kits listos para usar sobre una lista del sitio (v0.1.334, ADR-S84):
 *  - «Auditoría SEO»: los largos de lo que ve Google, las vistas «Sin
 *    descripción», «Título de más de 60 caracteres», «Descripción de más de
 *    160» y «Sin palabra clave», y una columna con IA que propone la meta
 *    descripción;
 *  - «Texto alternativo con IA»: en los medios, la vista «Sin texto
 *    alternativo» y una columna con IA que lo propone mirando la imagen.
 * Lo que propone la IA no se escribe solo: se copia con «Editar en lote» y se
 * puede deshacer.
 */

function errText(err: unknown): string {
    if (err instanceof CloudApiError) return err.message;
    return err instanceof Error ? err.message : String(err);
}

export function siteKitFor(o: Pick<SiteSyncObjectState, 'kind'>): SiteKit {
    return o.kind === 'media' ? 'alt_text' : 'seo_audit';
}

/** Por qué no se puede armar el kit (null = se puede). */
export function siteKitBlocked(kit: SiteKit, status: Pick<SiteSyncStatus, 'plugin'>): string | null {
    if (kit === 'alt_text') return null;
    if (!status.plugin?.installed) return __('Necesita el complemento en el sitio: sin él, la app no ve el SEO de las páginas.');
    if (!status.plugin.seo_name) return __('Necesita un plugin de SEO activo en el sitio (Rank Math, Yoast SEO, SEOPress o All in One SEO).');
    return null;
}

export function SiteKits({ object: o, status, connectionId }: { object: SiteSyncObjectState; status: SiteSyncStatus; connectionId: number }): JSX.Element | null {
    const qc = useQueryClient();
    const kit = siteKitFor(o);
    const blocked = siteKitBlocked(kit, status);
    const [result, setResult] = useState<SiteKitResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [fillNote, setFillNote] = useState<string | null>(null);
    const apply = useMutation({
        mutationFn: () => api.siteSyncApplyKit(connectionId, { resource: o.resource, kit }),
        onSuccess: (r) => {
            setResult(r);
            setError(null);
            void qc.invalidateQueries({ queryKey: listsKeys.all });
            void qc.invalidateQueries({ queryKey: ['site-sync', connectionId] });
        },
        onError: (err) => setError(errText(err)),
    });
    const fill = useMutation({
        mutationFn: async () => {
            const r = result!;
            return (await dataApi.post<{ queued: number; capped: boolean; reason?: string }>(`/lists/${r.list.id}/fields/${r.ai_field!.id}/ai-fill`, { only_empty: true })).data;
        },
        onSuccess: (r) =>
            setFillNote(
                r.queued === 0
                    ? r.reason ?? __('No hay filas sin sugerencia.')
                    : sprintf(r.queued === 1 ? __('Se está calculando %d sugerencia. Aparecen en la lista a medida que llegan.') : __('Se están calculando %d sugerencias. Aparecen en la lista a medida que llegan.'), r.queued) +
                          (r.capped ? ` ${r.reason ?? __('Llegaste al tope de esta vez: vuelve a tocarlo para seguir.')}` : ''),
            ),
        onError: (err) => setFillNote(errText(err)),
    });
    if (!o.list) return null;
    const isSeo = kit === 'seo_audit';
    const Icon = isSeo ? SearchCheck : ImageIcon;
    const target = isSeo ? __('Descripción SEO') : __('Texto alternativo');
    return (
        <div className="imcrm-space-y-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-3" data-testid={`imcrm-site-kit-${o.resource}`} data-tour={isSeo ? 'site-kit-seo' : 'site-kit-alt'}>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-min-w-0 imcrm-flex-1 imcrm-basis-64">
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                        <Icon className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                        {isSeo ? __('Auditoría SEO') : __('Texto alternativo con IA')}
                    </p>
                    <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                        {isSeo
                            ? __('Arma en esta lista lo necesario para revisar el SEO: cuántos caracteres tienen el título y la descripción que ve Google, las vistas «Sin descripción», «Título de más de 60 caracteres» y «Sin palabra clave», y una columna con IA que propone la meta descripción.')
                            : __('Arma en esta lista la vista «Sin texto alternativo» y una columna con IA que lo propone mirando cada imagen. También la vista «Imágenes de más de 300 KB», para encontrar las que hacen lento el sitio.')}
                    </p>
                    {blocked && (
                        <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-warning" data-testid={`imcrm-site-kit-blocked-${o.resource}`}>
                            {blocked}
                        </p>
                    )}
                </div>
                <Button size="sm" variant="outline" disabled={blocked !== null || apply.isPending} onClick={() => apply.mutate()} data-testid={`imcrm-site-kit-apply-${o.resource}`}>
                    {apply.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Sparkles className="imcrm-h-3.5 imcrm-w-3.5" />}
                    {result ? __('Armar de nuevo') : __('Armar')}
                </Button>
            </div>
            {error && <p className="imcrm-text-xs imcrm-text-destructive">{error}</p>}
            {result && (
                <div className="imcrm-space-y-2 imcrm-rounded-md imcrm-border imcrm-border-success/25 imcrm-bg-success/10 imcrm-p-3 imcrm-text-xs" data-testid={`imcrm-site-kit-result-${o.resource}`}>
                    <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-success">
                        <CheckCircle2 className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                        {result.views.length === 0 && result.fields.length === 0
                            ? __('Ya estaba todo armado en esta lista.')
                            : sprintf(
                                  __('Listo: %s.'),
                                  [
                                      result.views.length > 0 ? sprintf(result.views.length === 1 ? __('la vista %s') : __('las vistas %s'), result.views.map((v) => `«${v.name}»`).join(', ')) : null,
                                      result.fields.length > 0 ? sprintf(result.fields.length === 1 ? __('la columna %s') : __('las columnas %s'), result.fields.map((f) => `«${f.label}»`).join(', ')) : null,
                                  ]
                                      .filter(Boolean)
                                      .join(__(' y ')),
                              )}
                    </p>
                    {result.warnings.map((w) => (
                        <p key={w} className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-warning">
                            <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                            {w}
                        </p>
                    ))}
                    {result.ai_field && (
                        <ol className="imcrm-list-decimal imcrm-space-y-0.5 imcrm-pl-5 imcrm-text-foreground" data-testid={`imcrm-site-kit-steps-${o.resource}`}>
                            <li>{sprintf(__('Calcula las sugerencias: la columna «%s» las pide a la IA (usa los pedidos de IA de tu plan).'), result.ai_field.label)}</li>
                            <li>{sprintf(__('Revísalas en la lista. Elige las filas que te convencen y toca «Editar en lote» → «%1$s» → «Copiar de otra columna» → «%2$s».'), target, result.ai_field.label)}</li>
                            <li>{__('El cambio viaja a WordPress. Si algo no te gusta, lo deshaces desde el historial de ediciones en lote.')}</li>
                        </ol>
                    )}
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                        {result.ai_field && (
                            <Button size="sm" disabled={fill.isPending} onClick={() => fill.mutate()} data-testid={`imcrm-site-kit-fill-${o.resource}`}>
                                {fill.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Sparkles className="imcrm-h-3.5 imcrm-w-3.5" />}
                                {__('Calcular las sugerencias')}
                            </Button>
                        )}
                        <Button size="sm" variant="outline" asChild>
                            <Link to={`/lists/${result.list.slug}`} data-testid={`imcrm-site-kit-open-${o.resource}`}>
                                {__('Abrir la lista')}
                            </Link>
                        </Button>
                    </div>
                    {fillNote && <p className="imcrm-text-muted-foreground" data-testid={`imcrm-site-kit-fill-note-${o.resource}`}>{fillNote}</p>}
                </div>
            )}
        </div>
    );
}
