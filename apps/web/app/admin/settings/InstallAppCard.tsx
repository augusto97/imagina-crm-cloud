import { useState } from 'react';
import { CheckCircle2, ChevronDown, Download, MonitorSmartphone } from 'lucide-react';

import { InstallSteps } from '@/components/pwa/InstallSteps';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToastOptional } from '@/components/ui/toast';
import { __ } from '@/lib/i18n';
import { promptInstall, useInstallMode } from '@/lib/pwa/install';
import { cn } from '@/lib/utils';

/**
 * v0.1.321 — Ajustes → Cuenta → Avisos: instalar la app en ESTE dispositivo.
 * Con un clic si el navegador lo permite; si no, los pasos para este
 * navegador (y, con el selector, para otro). Ya instalada, lo dice. Va arriba
 * de las notificaciones: en el iPhone son la condición para recibirlas.
 */
export function InstallAppCard(): JSX.Element {
    const mode = useInstallMode();
    const toast = useToastOptional();
    const [otherOpen, setOtherOpen] = useState(false);
    const installed = mode === null;

    const install = (): void => {
        void promptInstall().then((ok) => {
            if (ok) toast?.success(__('App instalada'), __('Ábrela desde su ícono: se abre en su propia ventana.'));
        });
    };

    return (
        <Card data-testid="install-app-card" data-tour="install-card">
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-pt-4">
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span
                        className={cn(
                            'imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md',
                            installed ? 'imcrm-bg-success/15 imcrm-text-success' : 'imcrm-bg-muted imcrm-text-muted-foreground',
                        )}
                        aria-hidden
                    >
                        {installed ? <CheckCircle2 className="imcrm-h-4 imcrm-w-4" /> : <MonitorSmartphone className="imcrm-h-4 imcrm-w-4" />}
                    </span>
                    <div className="imcrm-min-w-0 imcrm-flex-1">
                        <p className="imcrm-text-sm imcrm-font-medium">{__('App en este dispositivo')}</p>
                        <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground" data-testid="install-state">
                            {installed
                                ? __('Estás usando la app instalada. Ábrela siempre desde su ícono.')
                                : __('Instálala en tu teléfono o computador: queda con tus aplicaciones, se abre en su propia ventana y te avisa aunque esté cerrada.')}
                        </p>
                    </div>
                </div>

                {mode === 'prompt' && (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <Button type="button" size="sm" onClick={install} data-testid="install-app-button">
                            <Download className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Instalar la app')}
                        </Button>
                        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Tu navegador la instala con un clic.')}</span>
                    </div>
                )}

                {mode === 'help' && <InstallSteps />}

                {mode !== 'help' && (
                    <div className="imcrm-border-t imcrm-border-border imcrm-pt-2">
                        <button
                            type="button"
                            onClick={() => setOtherOpen((v) => !v)}
                            aria-expanded={otherOpen}
                            className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                            data-testid="install-other-toggle"
                        >
                            <ChevronDown className={cn('imcrm-h-3.5 imcrm-w-3.5 imcrm-transition-transform', otherOpen && 'imcrm-rotate-180')} aria-hidden />
                            {__('Cómo instalarla en otro dispositivo')}
                        </button>
                        {otherOpen && <InstallSteps className="imcrm-mt-3" />}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
