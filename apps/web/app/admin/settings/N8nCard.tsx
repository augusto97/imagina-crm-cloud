import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Workflow } from 'lucide-react';

import { api } from '@/cloud/session';
import { __ } from '@/lib/i18n';

import { CopyField, Snippet } from './ApiTokensCard';

/**
 * v0.1.443 (G2) — Ajustes → API → «Conectar con n8n»: cómo instalar la app de
 * n8n que reparte ESTE servidor y qué poner en su credencial. Si el servidor
 * todavía no la trae (desarrollo, o una versión anterior), lo dice y ofrece el
 * camino que sirve igual: el nodo «HTTP Request» con el token.
 */
export function N8nCard(): JSX.Element {
    const info = useQuery({ queryKey: ['n8n-package'], queryFn: () => api.n8nPackage(), staleTime: 5 * 60_000, retry: false });
    const [copied, setCopied] = useState<string | null>(null);
    const copy = async (text: string, key: string): Promise<void> => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(key);
            setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
        } catch {
            // sin portapapeles: el texto queda seleccionable
        }
    };

    const appUrl = window.location.origin;
    const pkg = info.data;
    const install = pkg?.download_url ? `cd ~/.n8n/nodes\nnpm install ${pkg.download_url}` : null;

    return (
        <section className="imcrm-flex imcrm-max-w-3xl imcrm-flex-col imcrm-gap-4" data-testid="imcrm-n8n-card" data-tour="settings-n8n">
            <div>
                <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                    <Workflow className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    {__('Conectar con n8n')}
                </h2>
                <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Con la app de n8n tus flujos crean, buscan y cambian registros, agregan comentarios y arrancan solos cuando se crea un registro, se envía un formulario o entra un pago.')}
                </p>
            </div>

            <ol className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-text-sm">
                <li className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <span className="imcrm-font-medium">{__('1. Instala la app en tu n8n')}</span>
                    {install ? (
                        <>
                            <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                {__('En el servidor donde corre n8n (con Docker, dentro del volumen de /home/node/.n8n), y después reinicia n8n:')}
                            </span>
                            <Snippet label={pkg?.version ? `${pkg.package} ${pkg.version}` : (pkg?.package ?? '')} text={install} copied={copied === 'install'} onCopy={(t) => void copy(t, 'install')} />
                        </>
                    ) : (
                        <span className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-n8n-unavailable">
                            {info.isLoading
                                ? __('Revisando…')
                                : __('Este servidor todavía no trae la app de n8n: llega con la próxima actualización. Mientras tanto puedes usar el nodo «HTTP Request» de n8n con el token (cabecera Authorization: Bearer) y recibir avisos con el nodo «Webhook» y un webhook de la lista de arriba.')}
                        </span>
                    )}
                </li>
                <li className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <span className="imcrm-font-medium">{__('2. Crea la credencial «Imagina Base API» en n8n')}</span>
                    <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                        <CopyField label={__('Dirección de tu app')} value={appUrl} copied={copied === 'url'} onCopy={() => void copy(appUrl, 'url')} testId="imcrm-n8n-url" />
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <span className="imcrm-text-xs imcrm-font-medium">{__('Token')}</span>
                            <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Uno de arriba con «Leer y escribir» si vas a crear o cambiar registros, o a usar el disparador.')}
                            </span>
                        </div>
                    </div>
                </li>
                <li className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <span className="imcrm-font-medium">{__('3. Arma tu flujo')}</span>
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Busca «Imagina Base» entre los nodos: el de acciones trabaja sobre tus listas y el disparador («Trigger») registra solo su webhook al activar el flujo y lo borra al desactivarlo.')}
                    </span>
                </li>
            </ol>
        </section>
    );
}
