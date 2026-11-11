import type { WhatsappSendResult } from '@imagina-base/shared';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { __, sprintf } from '@/lib/i18n';

/**
 * Resultado de un envío de WhatsApp (de la ficha o de «Probar ahora»). En su
 * propio archivo: el botón de la ficha lo usa y, viviendo dentro del editor de
 * la acción, arrastraba TODOS los editores de automatizaciones al chunk de la
 * app (el que se baja al entrar a una lista).
 */
export function SendReport({ result }: { result: WhatsappSendResult }): JSX.Element {
    return (
        <div className="imcrm-space-y-1.5 imcrm-rounded-md imcrm-bg-muted/50 imcrm-p-2 imcrm-text-xs" data-testid="imcrm-whatsapp-send-report" data-ok={result.ok ? '1' : '0'}>
            {result.ok ? (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-font-medium imcrm-text-emerald-700 dark:imcrm-text-emerald-400">
                    <CheckCircle2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    {sprintf(/* translators: %s: teléfono */ __('Enviado a %s. Quedó en camino; el estado (entregado, leído) llega solo.'), result.to)}
                </p>
            ) : (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-font-medium imcrm-text-destructive">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                    {result.error ?? __('No se pudo enviar.')}
                </p>
            )}
            {result.text !== '' && <p className="imcrm-whitespace-pre-wrap imcrm-text-muted-foreground">{result.text}</p>}
            {(result.request || result.response) && (
                <details>
                    <summary className="imcrm-cursor-pointer imcrm-text-muted-foreground">{__('Ver lo que se envió y la respuesta')}</summary>
                    {result.request && (
                        <pre className="imcrm-mt-1 imcrm-max-h-48 imcrm-overflow-auto imcrm-whitespace-pre-wrap imcrm-break-all imcrm-rounded imcrm-bg-background imcrm-p-2 imcrm-text-[11px]">
                            {`POST ${result.request.url}\n\n${prettyJson(result.request.body)}`}
                        </pre>
                    )}
                    {result.response && (
                        <pre className="imcrm-mt-1 imcrm-max-h-48 imcrm-overflow-auto imcrm-whitespace-pre-wrap imcrm-break-all imcrm-rounded imcrm-bg-background imcrm-p-2 imcrm-text-[11px]">
                            {`HTTP ${result.response.status}\n\n${prettyJson(result.response.body)}`}
                        </pre>
                    )}
                </details>
            )}
        </div>
    );
}

function prettyJson(body: string): string {
    try {
        return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
        return body;
    }
}
