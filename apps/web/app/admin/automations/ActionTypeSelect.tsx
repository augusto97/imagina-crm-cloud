import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import type { ActionMeta, ActionSpec } from '@/types/automation';

import { actionOptionValue, actionTypeOptions, specForOption } from './actionTypeOptions';

/**
 * Selector "Tipo de acción" de las tres superficies del editor (flujo, lienzo
 * y ramas de un si/sino). Cada acción de conector es su propia opción.
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
    const options = actionTypeOptions(actionsCatalog, spec, { exclude });
    const builtins = options.filter((o) => o.group !== 'connector');
    const connectors = options.filter((o) => o.group === 'connector');
    return (
        <Select
            value={actionOptionValue(spec)}
            onChange={(e) => onChange(specForOption(e.target.value))}
            className={className}
            aria-label={__('Tipo de acción')}
            data-testid="imcrm-action-type-select"
        >
            {builtins.map((o) => (
                <option key={o.value} value={o.value}>
                    {o.label}
                </option>
            ))}
            {connectors.length > 0 && (
                <optgroup label={__('Apps conectadas')}>
                    {connectors.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </optgroup>
            )}
        </Select>
    );
}
