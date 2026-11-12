import { Plus } from 'lucide-react';
import {
    WIDGET_BUTTON_TYPES,
    WIDGET_MAX_BUTTONS,
    WIDGET_TYPE_INFO,
    type ContactWidgetConfig,
    type ContactWidgetOptions,
    type WidgetButton,
    type WidgetButtonType,
    type WidgetProblem,
} from '@imagina-base/shared';

import { __, sprintf } from '@/lib/i18n';

import { WidgetButtonEditor } from './WidgetButtonEditor';
import { WidgetIconView } from './WidgetIconView';
import { canAddButton, moveButton, removeButton, updateButton } from './widgetEditor';
import { SubSection } from './widgetUi';

/** El nombre de cada tipo en «Agregar un botón» (el del botón ya armado es otro: «Escríbenos»…). */
const TYPE_TILE: Record<WidgetButtonType, string> = {
    whatsapp: 'WhatsApp',
    form: 'Formulario',
    booking: 'Agenda',
    call: 'Llamada',
    email: 'Correo',
    link: 'Enlace',
    shop: 'Tienda',
};

/**
 * v0.1.408 — «Botones»: los botones del widget (cada uno se abre para
 * editarlo) y, debajo, los tipos para agregar uno más, cada uno con su ícono.
 */
export function WidgetButtonsPanel({
    config,
    options,
    problems,
    openId,
    onOpen,
    onConfig,
    onAdd,
}: {
    config: ContactWidgetConfig;
    options: ContactWidgetOptions;
    problems: WidgetProblem[];
    openId: string | null;
    onOpen: (id: string | null) => void;
    onConfig: (updater: (c: ContactWidgetConfig) => ContactWidgetConfig) => void;
    onAdd: (type: WidgetButtonType) => void;
}): JSX.Element {
    const canAdd = canAddButton(config);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-6 imcrm-px-4 imcrm-py-4" data-tour="widget-buttons" data-testid="widget-buttons">
            {config.buttons.length === 0 ? (
                <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-1 imcrm-rounded-xl imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-6 imcrm-text-center">
                    <p className="imcrm-text-sm imcrm-font-medium">{__('Todavía no hay botones')}</p>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Agrega el primero abajo: WhatsApp, un formulario, tu agenda…')}</p>
                </div>
            ) : (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    {config.buttons.map((b: WidgetButton, i) => (
                        <WidgetButtonEditor
                            key={b.id}
                            button={b}
                            options={options}
                            problems={problems.filter((p) => p.button_id === b.id)}
                            open={openId === b.id}
                            first={i === 0}
                            last={i === config.buttons.length - 1}
                            onToggle={() => onOpen(openId === b.id ? null : b.id)}
                            onChange={(patch) => onConfig((c) => updateButton(c, b.id, patch))}
                            onMove={(delta) => onConfig((c) => moveButton(c, b.id, delta))}
                            onRemove={() => onConfig((c) => removeButton(c, b.id))}
                            hoursEnabled={config.hours.enabled}
                        />
                    ))}
                </div>
            )}

            <SubSection
                title={__('Agregar un botón')}
                hint={canAdd ? undefined : sprintf(__('Llegaste al máximo de %d botones. Quita uno para agregar otro.'), WIDGET_MAX_BUTTONS)}
                tour="widget-add-button"
                testId="widget-add-button"
            >
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                    {WIDGET_BUTTON_TYPES.map((type) => {
                        const info = WIDGET_TYPE_INFO[type];
                        return (
                            <button
                                key={type}
                                type="button"
                                disabled={!canAdd}
                                onClick={() => onAdd(type)}
                                title={__(info.hint)}
                                className="imcrm-group imcrm-flex imcrm-items-center imcrm-gap-2.5 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2.5 imcrm-text-left imcrm-transition-colors hover:imcrm-border-primary/40 hover:imcrm-bg-primary/[0.04] disabled:imcrm-cursor-not-allowed disabled:imcrm-opacity-50"
                                data-testid={`widget-add-${type}`}
                            >
                                <span
                                    className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-primary"
                                    style={info.color ? { background: info.color, color: '#fff' } : undefined}
                                >
                                    <WidgetIconView icon={info.icon} className="imcrm-h-4 imcrm-w-4" />
                                </span>
                                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-text-[12.5px] imcrm-font-medium imcrm-leading-tight">{__(TYPE_TILE[type])}</span>
                                <Plus className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground imcrm-opacity-0 imcrm-transition-opacity group-hover:imcrm-opacity-100" aria-hidden />
                            </button>
                        );
                    })}
                </div>
            </SubSection>
        </div>
    );
}
