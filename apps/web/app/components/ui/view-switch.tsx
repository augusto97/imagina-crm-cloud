import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Selector de modo de vista (v0.1.211): "Por carpeta / Todas", "Por carpeta /
 * Por tipo". Botones con `aria-pressed` dentro de un `role=group` — es una
 * elección de presentación, no un formulario.
 */
export function ViewSwitch<T extends string>({
    label,
    value,
    options,
    onChange,
    testId,
}: {
    label: string;
    value: T;
    options: Array<{ value: T; label: string; icon?: LucideIcon }>;
    onChange: (next: T) => void;
    testId?: string;
}): JSX.Element {
    return (
        <div
            role="group"
            aria-label={label}
            data-testid={testId}
            className="imcrm-inline-flex imcrm-shrink-0 imcrm-gap-0.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-p-0.5"
        >
            {options.map((o) => {
                const active = o.value === value;
                return (
                    <button
                        key={o.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(o.value)}
                        data-value={o.value}
                        className={cn(
                            'imcrm-inline-flex imcrm-h-7 imcrm-items-center imcrm-gap-1.5 imcrm-rounded imcrm-px-2.5 imcrm-text-xs imcrm-font-medium imcrm-transition-colors',
                            active
                                ? 'imcrm-bg-card imcrm-text-foreground imcrm-shadow-imcrm-sm imcrm-ring-1 imcrm-ring-border'
                                : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                        )}
                    >
                        {o.icon && <o.icon className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />}
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}
