import type { AiModelCatalog } from '@imagina-base/shared';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { relativeTime } from '@/admin/activity/activityText';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { buildModelOptions, modelNotes } from '@/lib/aiModels';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface Props {
    id: string;
    label: string;
    /** `''` = heredar (sólo cuando hay `inheritLabel`). */
    value: string;
    onChange: (value: string) => void;
    catalog: AiModelCatalog | undefined;
    refreshing: boolean;
    onRefresh: () => void;
    /** Empresa: la opción «El de la plataforma (…)». */
    inheritLabel?: string;
    hint?: string;
    testId?: string;
}

/**
 * Selector de modelo del asistente (ADR-S60). La lista sale del catálogo que
 * devuelve Anthropic con la clave en uso — un modelo nuevo aparece solo —, y
 * ofrece primero «el más reciente» de cada familia, que se actualiza sin
 * tocar nada. Lo comparten la consola de plataforma y los Ajustes de cada
 * empresa.
 */
export function AiModelSelect({ id, label, value, onChange, catalog, refreshing, onRefresh, inheritLabel, hint, testId }: Props): JSX.Element {
    const groups = buildModelOptions(catalog, value);
    const notes = modelNotes(catalog, value, catalog?.fetched_at ? relativeTime(catalog.fetched_at) : null);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <Label htmlFor={id} className="imcrm-text-xs">
                    {label}
                </Label>
                {catalog && !catalog.no_key && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="imcrm-h-7 imcrm-gap-1.5 imcrm-px-2 imcrm-text-xs"
                        onClick={onRefresh}
                        disabled={refreshing}
                        data-testid={testId ? `${testId}-refresh` : undefined}
                    >
                        <RefreshCw className={cn('imcrm-h-3.5 imcrm-w-3.5', refreshing && 'imcrm-animate-spin')} aria-hidden />
                        {refreshing ? __('Consultando…') : __('Actualizar lista')}
                    </Button>
                )}
            </div>
            <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
                {inheritLabel !== undefined && <option value="">{inheritLabel}</option>}
                {groups.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                        {g.options.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </optgroup>
                ))}
            </Select>
            {hint && <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{hint}</span>}
            {notes.map((n) => (
                <span
                    key={n.text}
                    className={cn(
                        'imcrm-flex imcrm-items-start imcrm-gap-1 imcrm-text-[11px]',
                        n.kind === 'warning' ? 'imcrm-text-warning' : 'imcrm-text-muted-foreground',
                    )}
                    data-testid={testId ? `${testId}-note` : undefined}
                >
                    {n.kind === 'warning' && <AlertTriangle className="imcrm-mt-px imcrm-h-3 imcrm-w-3 imcrm-shrink-0" aria-hidden />}
                    {n.text}
                </span>
            ))}
        </div>
    );
}
