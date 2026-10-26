import { AI_EFFORT_LEVELS, nearestAiEffort, type AiEffort } from '@imagina-base/shared';
import { AlertTriangle } from 'lucide-react';

import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { effortDescription, effortLabel } from '@/lib/aiModels';
import { __, sprintf } from '@/lib/i18n';

interface Props {
    id: string;
    /** `''` = heredar (sólo cuando hay `inheritLabel`). */
    value: AiEffort | '';
    onChange: (value: AiEffort | '') => void;
    /** Niveles del modelo elegido: `[]` = no usa esfuerzo, `null` = todavía no se sabe. */
    levels: AiEffort[] | null;
    /** Empresa: la opción «El de la plataforma (Medio)». */
    inheritLabel?: string;
    /** Nivel que vale cuando se hereda (para avisar si el modelo no lo tiene). */
    inheritedValue?: AiEffort;
    disabled?: boolean;
    /** Por qué no se puede cambiar (se muestra en lugar de la ayuda). */
    disabledNote?: string;
    hint?: string;
    testId?: string;
}

const ASSUMED: readonly AiEffort[] = ['low', 'medium', 'high', 'max'];

/**
 * Nivel de esfuerzo del asistente (ADR-S61): cuánto piensa antes de
 * responder. Ofrece sólo los niveles que acepta el modelo elegido; si el
 * guardado no existe en ese modelo, dice cuál se usa en su lugar.
 */
export function AiEffortSelect({ id, value, onChange, levels, inheritLabel, inheritedValue, disabled, disabledNote, hint, testId }: Props): JSX.Element {
    const noEffort = levels !== null && levels.length === 0;
    const offered = levels === null ? ASSUMED : levels;
    const options = AI_EFFORT_LEVELS.filter((l) => offered.includes(l) || l === value);
    const effective = value === '' ? inheritedValue : value;
    const used = effective && levels ? nearestAiEffort(effective, levels) : null;
    const replaced = effective && used && used !== effective ? used : null;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            <Label htmlFor={id} className="imcrm-text-xs">
                {__('Nivel de esfuerzo')}
            </Label>
            <Select id={id} value={value} onChange={(e) => onChange(e.target.value as AiEffort | '')} disabled={disabled || noEffort} data-testid={testId}>
                {inheritLabel !== undefined && <option value="">{inheritLabel}</option>}
                {options.map((l) => (
                    <option key={l} value={l}>
                        {`${effortLabel(l)} — ${effortDescription(l)}`}
                    </option>
                ))}
            </Select>
            {noEffort ? (
                <span className="imcrm-text-[11px] imcrm-text-muted-foreground" data-testid={testId ? `${testId}-note` : undefined}>
                    {__('El modelo elegido no usa nivel de esfuerzo: piensa con un presupuesto fijo.')}
                </span>
            ) : disabled && disabledNote ? (
                <span className="imcrm-text-[11px] imcrm-text-muted-foreground" data-testid={testId ? `${testId}-note` : undefined}>
                    {disabledNote}
                </span>
            ) : (
                hint && <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{hint}</span>
            )}
            {replaced && effective && !noEffort && (
                <span className="imcrm-flex imcrm-items-start imcrm-gap-1 imcrm-text-[11px] imcrm-text-warning" data-testid={testId ? `${testId}-warning` : undefined}>
                    <AlertTriangle className="imcrm-mt-px imcrm-h-3 imcrm-w-3 imcrm-shrink-0" aria-hidden />
                    {sprintf(
                        /* translators: 1: chosen effort level, 2: level used instead */ __('El modelo elegido no tiene «%1$s»: se usa «%2$s».'),
                        effortLabel(effective),
                        effortLabel(replaced),
                    )}
                </span>
            )}
        </div>
    );
}
