import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, ExternalLink, Loader2, Plug, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * El complemento para WordPress (v0.1.334, ADR-S84) en la página del sitio:
 * si no está, qué suma, la descarga y los pasos para instalarlo; si está, su
 * versión, el plugin de SEO que encontró y si hay una más nueva. La app sirve
 * el archivo desde su propio servidor (y el complemento se actualiza desde
 * ahí, como cualquier plugin).
 */

export const SITE_PLUGIN_DOWNLOAD_URL = '/api/v1/public/wordpress-plugin/download';

export interface SitePluginCardState {
    installed: boolean;
    version: string | null;
    latest: string | null;
    seoName: string | null;
    /** Lo que da el sitio además del SEO (ACF, Meta Box, JetEngine). */
    providers?: string[];
    /** Estuvo y ya no está (se desinstaló o se desactivó). */
    missingSince?: string | null;
    /** El plugin de SEO tiene algo a medio configurar. */
    problem?: string | null;
}

function newer(a: string | null, b: string | null): boolean {
    if (!a || !b) return false;
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] ?? 0;
        const y = pb[i] ?? 0;
        if (x !== y) return x > y;
    }
    return false;
}

export function SitePluginCard({
    state,
    siteUrl,
    checking,
    onRecheck,
    recheckLabel,
}: {
    state: SitePluginCardState;
    siteUrl: string;
    checking: boolean;
    onRecheck: () => void;
    /** «Ya lo instalé» (alta) o «Ya lo activé» (sitio sincronizado). */
    recheckLabel?: string;
}): JSX.Element {
    const [showSteps, setShowSteps] = useState(!state.installed);
    const [showWithout, setShowWithout] = useState(false);
    const site = siteUrl.replace(/\/+$/, '');
    const uploadUrl = site ? `${site}/wp-admin/plugin-install.php?tab=upload` : null;
    const pluginsUrl = site ? `${site}/wp-admin/plugins.php` : null;
    const updatesUrl = site ? `${site}/wp-admin/update-core.php` : null;

    if (state.installed) {
        const outdated = newer(state.latest, state.version);
        return (
            <section className="imcrm-space-y-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4" data-testid="imcrm-site-plugin-card" data-state="installed" data-tour="site-plugin-card">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                    <Badge variant="success" className="imcrm-gap-1">
                        <CheckCircle2 className="imcrm-h-3 imcrm-w-3" />
                        {__('Complemento activo')}
                    </Badge>
                    {state.version && <span className="imcrm-text-xs imcrm-text-muted-foreground">{sprintf(__('Versión %s'), state.version)}</span>}
                </div>
                <p className="imcrm-text-sm" data-testid="imcrm-site-plugin-seo">
                    {state.seoName
                        ? sprintf(__('SEO con %s: el título y la descripción para Google, la palabra clave y si la página se indexa llegan como columnas.'), state.seoName)
                        : __('No hay un plugin de SEO activo en el sitio. Con Rank Math, Yoast SEO, SEOPress o All in One SEO, su SEO llega como columnas.')}
                </p>
                {state.providers && state.providers.length > 0 && (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{sprintf(__('Campos personalizados de %s, cada uno con su tipo.'), state.providers.join(', '))}</p>
                )}
                {state.problem && (
                    <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-warning">
                        <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                        {state.problem}
                    </p>
                )}
                {outdated && (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-muted/60 imcrm-px-3 imcrm-py-2 imcrm-text-xs" data-testid="imcrm-site-plugin-outdated">
                        <span className="imcrm-min-w-0 imcrm-flex-1">
                            {sprintf(__('Hay una versión nueva del complemento (%s). WordPress te la ofrece en «Actualizaciones», como cualquier plugin.'), state.latest ?? '')}
                        </span>
                        {updatesUrl && (
                            <Button size="sm" variant="outline" asChild>
                                <a href={updatesUrl} target="_blank" rel="noreferrer">
                                    {__('Abrir «Actualizaciones»')}
                                    <ExternalLink className="imcrm-h-3 imcrm-w-3" />
                                </a>
                            </Button>
                        )}
                    </div>
                )}
            </section>
        );
    }

    return (
        <section
            className={cn(
                'imcrm-space-y-3 imcrm-rounded-lg imcrm-border imcrm-p-4',
                state.missingSince ? 'imcrm-border-warning/40 imcrm-bg-warning/5' : 'imcrm-border-primary/30 imcrm-bg-primary/5',
            )}
            data-testid="imcrm-site-plugin-card"
            data-state={state.missingSince ? 'missing' : 'absent'}
            data-tour="site-plugin-card"
        >
            <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                    <Plug className="imcrm-h-4 imcrm-w-4" aria-hidden />
                </span>
                <div className="imcrm-min-w-0 imcrm-space-y-1">
                    <h2 className="imcrm-text-sm imcrm-font-semibold">
                        {state.missingSince ? __('El complemento ya no está en el sitio') : __('Suma el complemento para WordPress')}
                    </h2>
                    {state.missingSince ? (
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">
                            {__('Lo desactivaron o lo desinstalaron. Las columnas que daba (el SEO, los campos personalizados, el uso de cada imagen) quedan con lo último que llegó y no se pueden editar, y los avisos al instante se pausaron: el sitio se revisa cada cierto tiempo. Vuelve a activarlo para seguir como antes.')}
                        </p>
                    ) : (
                        <>
                            <p className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Es un plugin gratuito que instalas en tu sitio una sola vez. Con él, la app ve lo que WordPress no muestra por su cuenta:')}
                            </p>
                            <ul className="imcrm-list-disc imcrm-space-y-0.5 imcrm-pl-5 imcrm-text-sm">
                                <li>{__('El SEO de cada página: el título y la descripción para Google, la palabra clave y si se indexa (Rank Math, Yoast SEO, SEOPress o All in One SEO).')}</li>
                                <li>{__('Todos los campos personalizados con su tipo (ACF, Meta Box, JetEngine), aunque no estén a la vista de la API de WordPress.')}</li>
                                <li>{__('El texto alternativo de las imágenes y dónde se usa cada una.')}</li>
                                <li>{__('Cada cambio que hagas en WordPress llega en segundos, sin esperar la próxima revisión.')}</li>
                            </ul>
                        </>
                    )}
                </div>
            </div>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                <Button size="sm" asChild>
                    <a href={SITE_PLUGIN_DOWNLOAD_URL} download data-testid="imcrm-site-plugin-download">
                        <Download className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Descargar el complemento')}
                    </a>
                </Button>
                {(state.missingSince ? pluginsUrl : uploadUrl) && (
                    <Button size="sm" variant="outline" asChild>
                        <a href={(state.missingSince ? pluginsUrl : uploadUrl)!} target="_blank" rel="noreferrer" data-testid="imcrm-site-plugin-open-wp">
                            {state.missingSince ? __('Abrir «Plugins» en tu sitio') : __('Abrir «Subir plugin» en tu sitio')}
                            <ExternalLink className="imcrm-h-3 imcrm-w-3" />
                        </a>
                    </Button>
                )}
                <Button size="sm" variant="ghost" disabled={checking} onClick={onRecheck} data-testid="imcrm-site-plugin-recheck">
                    {checking ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <RefreshCw className="imcrm-h-3.5 imcrm-w-3.5" />}
                    {recheckLabel ?? __('Ya lo instalé')}
                </Button>
            </div>
            <div className="imcrm-space-y-2">
                <button
                    type="button"
                    className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-text-foreground"
                    onClick={() => setShowSteps((v) => !v)}
                    aria-expanded={showSteps}
                >
                    {showSteps ? <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5" /> : <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5" />}
                    {__('Cómo instalarlo')}
                </button>
                {showSteps && (
                    <ol className="imcrm-list-decimal imcrm-space-y-1 imcrm-pl-5 imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-site-plugin-steps">
                        <li>{__('Descarga el archivo con el botón de arriba. No lo descomprimas.')}</li>
                        <li>{__('En WordPress, ve a «Plugins» → «Añadir nuevo» → «Subir plugin», elige el archivo y toca «Instalar ahora».')}</li>
                        <li>{__('Toca «Activar plugin». Hace falta un usuario administrador del sitio.')}</li>
                        <li>{__('Vuelve aquí y toca «Ya lo instalé». Las actualizaciones te llegan después en WordPress, como las de cualquier plugin.')}</li>
                    </ol>
                )}
                {!state.missingSince && (
                    <>
                        <button
                            type="button"
                            className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-text-foreground"
                            onClick={() => setShowWithout((v) => !v)}
                            aria-expanded={showWithout}
                            data-testid="imcrm-site-plugin-without-toggle"
                        >
                            {showWithout ? <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5" /> : <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5" />}
                            {__('¿Y sin el complemento?')}
                        </button>
                        {showWithout && (
                            <div className="imcrm-space-y-1 imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-site-plugin-without">
                                <p>
                                    {__('Igual puedes traer páginas, entradas, tipos de contenido, taxonomías, los medios con su texto alternativo y los campos de ACF que tengan activado «Mostrar en la API REST», y editarlos desde aquí.')}
                                </p>
                                <p>
                                    {__('Lo que no se puede sin él: el SEO de cada página, los campos que no están a la vista de la API (Meta Box, JetEngine o ACF sin esa opción), el número de palabras, dónde se usa cada imagen y los avisos al instante: el sitio se revisa cada cierto tiempo.')}
                                </p>
                            </div>
                        )}
                    </>
                )}
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('El complemento sólo habla con esta app, con la misma contraseña de aplicación de la conexión. No trae ni cambia el contenido de tus páginas: sólo los datos que elijas.')}
                </p>
            </div>
        </section>
    );
}
