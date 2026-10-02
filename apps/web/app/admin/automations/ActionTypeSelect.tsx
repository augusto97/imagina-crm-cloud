import { ChevronDown } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ActionMeta, ActionSpec } from '@/types/automation';

import { ActionTypeMenu } from './ActionTypeMenu';
import { actionOptionValue, actionTypeOptions, specForOption } from './actionTypeOptions';
import { actionMetaFor } from './automationMeta';

/**
 * Selector "Tipo de acción" de las tres superficies del editor (flujo, lienzo
 * y ramas de un si/sino). Cada acción de conector es su propia opción.
 *
 * v0.1.248 — era un `<select>` nativo y en Safari se veía crudo (y no podía
 * mostrar íconos ni logos). Ahora el disparador tiene la forma de los demás
 * campos y abre el MISMO menú que el «+» de agregar acción, con la elegida
 * marcada: una sola forma de elegir una acción en todo el editor.
 */
export function ActionTypeSelect({
    spec,
    actionsCatalog,
    onChange,
    exclude,
    className,
}: {
    spec: ActionSpec;
    actionsCatalog: ActionMeta[];
    onChange: (next: ActionSpec) => void;
    exclude?: string[];
    className?: string;
}): JSX.Element {
    const value = actionOptionValue(spec);
    const option = actionTypeOptions(actionsCatalog, spec, { exclude }).find((o) => o.value === value);
    const connector =
        spec.type === 'connector_action'
            ? actionsCatalog.find(
                  (a) =>
                      a.connector?.connection_id === Number(spec.config.connection_id)
                      && a.connector.action_key === spec.config.action_key,
              )
            : undefined;
    const meta = actionMetaFor(spec.type);
    const Icon = meta.icon;
    const title = connector ? connector.label : (option?.label ?? spec.type);
    const subtitle = connector
        ? connector.connector!.connection_name
        : option?.group === 'unknown'
          ? __('Ya no está disponible: elegí otra acción')
          : meta.description !== ''
            ? __(meta.description)
            : '';

    return (
        <ActionTypeMenu
            actionsCatalog={actionsCatalog}
            exclude={exclude}
            selectedValue={value}
            align="start"
            contentClassName="imcrm-max-h-[70vh] imcrm-w-[var(--radix-dropdown-menu-trigger-width)] imcrm-min-w-[280px] imcrm-overflow-y-auto"
            onPick={(type, config) =>
                onChange(type === 'connector_action' && config ? { type, config } : specForOption(type))
            }
        >
            <button
                type="button"
                aria-label={__('Tipo de acción')}
                data-testid="imcrm-action-type-select"
                data-value={value}
                className={cn(
                    'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2.5 imcrm-rounded-lg imcrm-border imcrm-border-input imcrm-bg-card imcrm-px-2.5 imcrm-py-2 imcrm-text-left',
                    'imcrm-shadow-imcrm-inset imcrm-transition-[border-color,box-shadow] imcrm-duration-150',
                    'hover:imcrm-border-foreground/25',
                    'focus-visible:imcrm-outline-none focus-visible:imcrm-border-primary focus-visible:imcrm-ring-4 focus-visible:imcrm-ring-primary/15',
                    'data-[state=open]:imcrm-border-primary data-[state=open]:imcrm-ring-4 data-[state=open]:imcrm-ring-primary/15',
                    className,
                )}
            >
                {connector ? (
                    <IntegrationLogo integrationKey={connector.connector!.integration_key ?? null} size={28} />
                ) : (
                    <span className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-ring-1 imcrm-ring-border">
                        <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-foreground/70" />
                    </span>
                )}
                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                    <span className="imcrm-truncate imcrm-text-sm imcrm-font-medium imcrm-text-foreground">{title}</span>
                    {subtitle !== '' && (
                        <span
                            className={cn(
                                'imcrm-truncate imcrm-text-[11px] imcrm-leading-snug',
                                option?.group === 'unknown' ? 'imcrm-text-destructive' : 'imcrm-text-muted-foreground',
                            )}
                        >
                            {subtitle}
                        </span>
                    )}
                </span>
                <ChevronDown className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
            </button>
        </ActionTypeMenu>
    );
}
