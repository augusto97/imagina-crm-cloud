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
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-rounded-xl imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-3" data-testid="form-widget-card" data-tour="form-widget-card">
            <div className="imcrm-flex imcrm-gap-2.5">
                <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-success/15 imcrm-text-success">
                    <MessageCircle className="imcrm-h-4 imcrm-w-4" />
                </span>
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <p className="imcrm-text-sm imcrm-font-medium">{__('Ponlo junto a tu WhatsApp')}</p>
                    <p className="imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">
                        {__('Un widget de contacto pone en tu sitio un botón con WhatsApp, este formulario (que se abre como un chat) y tu agenda.')}
                    </p>
                    {create.isError && (
                        <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-destructive">{create.error instanceof Error ? create.error.message : __('No se pudo crear.')}</p>
                    )}
                </div>
            </div>
            <Button
                size="sm"
                variant="outline"
                className="imcrm-h-8 imcrm-self-start imcrm-text-xs"
                disabled={create.isPending}
                onClick={() => create.mutate({ name: name.slice(0, 120) || __('Widget de contacto'), form_id: formId }, { onSuccess: (doc) => nav(`/settings/widgets/${doc.id}`) })}
                data-testid="form-widget-create"
            >
                {create.isPending ? __('Creando…') : __('Crear un widget con este formulario')}
            </Button>
        </div>
    );
}
