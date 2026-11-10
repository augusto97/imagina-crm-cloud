import { useNavigate } from 'react-router';
import { MessageCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { __ } from '@/lib/i18n';

import { useCreateContactWidget } from './useContactWidgets';

/**
 * v0.1.394 (ADR-S99) — Desde «Compartir → Insertar en tu sitio» de un
 * formulario: arma un widget de contacto que ya lo trae (y suma tu WhatsApp
 * después, en el editor).
 */
export function WidgetFromFormCard({ formId, name }: { formId: number; name: string }): JSX.Element {
    const nav = useNavigate();
    const create = useCreateContactWidget();
    return (
        <div className="imcrm-mt-5 imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-4 sm:imcrm-flex-row sm:imcrm-items-center" data-testid="form-widget-card" data-tour="form-widget-card">
            <span className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-card imcrm-ring-1 imcrm-ring-border">
                <MessageCircle className="imcrm-h-5 imcrm-w-5 imcrm-text-muted-foreground" />
            </span>
            <div className="imcrm-min-w-0 imcrm-flex-1">
                <p className="imcrm-text-sm imcrm-font-medium">{__('¿Lo quieres junto a tu WhatsApp, en un botón de contacto?')}</p>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Un widget de contacto pone en tu sitio un botón con WhatsApp, este formulario (que se abre como un chat) y tu agenda. También puede pedir los datos antes de abrir WhatsApp.')}
                </p>
                {create.isError && (
                    <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-destructive">{create.error instanceof Error ? create.error.message : __('No se pudo crear.')}</p>
                )}
            </div>
            <Button
                size="sm"
                variant="outline"
                disabled={create.isPending}
                onClick={() => create.mutate({ name: name.slice(0, 120) || __('Widget de contacto'), form_id: formId }, { onSuccess: (doc) => nav(`/settings/widgets/${doc.id}`) })}
                data-testid="form-widget-create"
            >
                {create.isPending ? __('Creando…') : __('Crear un widget con este formulario')}
            </Button>
        </div>
    );
}
