import * as Dialog from '@radix-ui/react-dialog';
import { Globe, Mail, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ViewSwitch } from '@/components/ui/view-switch';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { EmailSubscriptionsPanel } from './EmailSubscriptionsPanel';
import { PublicLinkPanel } from './PublicLinkPanel';
import { PlanModuleGate } from '@/components/PlanModuleNotice';

export type ShareTab = 'link' | 'email';

/**
 * v0.1.292 (ADR-S50) — Compartir un tablero hacia afuera: un enlace público
 * de sólo lectura (insertable en otro sitio) o un resumen programado por
 * correo. Lo de adentro del equipo sigue siendo la visibilidad del tablero.
 */
export function ShareDashboardDialog({
    dashboardId,
    dashboardName,
    open,
    onOpenChange,
    tab,
    onTabChange,
    canPublish,
}: {
    dashboardId: number;
    dashboardName: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tab: ShareTab;
    onTabChange: (tab: ShareTab) => void;
    canPublish: boolean;
}): JSX.Element {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[calc(100dvh-1.5rem)] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-2xl imcrm-flex-col',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-lg',
                    )}
                    data-testid="imcrm-share-dashboard"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-p-4 sm:imcrm-px-6">
                        <div className="imcrm-min-w-0">
                            <Dialog.Title className="imcrm-truncate imcrm-text-base imcrm-font-semibold">
                                {__('Compartir')} «{dashboardName}»
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Fuera del equipo: un enlace para verlo sin iniciar sesión o un resumen por correo.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>
                    <div className="imcrm-px-4 imcrm-pt-3 sm:imcrm-px-6">
                        <ViewSwitch
                            label={__('Cómo compartir')}
                            value={tab}
                            onChange={onTabChange}
                            testId="imcrm-share-tabs"
                            options={[
                                { value: 'link', label: __('Enlace público'), icon: Globe },
                                { value: 'email', label: __('Envío por correo'), icon: Mail },
                            ]}
                        />
                    </div>
                    <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto imcrm-p-4 sm:imcrm-px-6">
                        {tab === 'link' ? (
                            <PlanModuleGate module="public_sharing">
                                <PublicLinkPanel dashboardId={dashboardId} canPublish={canPublish} />
                            </PlanModuleGate>
                        ) : (
                            <EmailSubscriptionsPanel dashboardId={dashboardId} dashboardName={dashboardName} />
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
