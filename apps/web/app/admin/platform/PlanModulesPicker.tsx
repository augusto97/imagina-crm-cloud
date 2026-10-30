import { PLAN_MODULE_CATALOG, PLAN_MODULE_GROUPS, type PlanModule, type PlanModuleInfo } from '@imagina-base/shared';

import { __ } from '@/lib/i18n';

/**
 * v0.1.338 (ADR-S87) — Qué incluye un plan: una casilla por módulo, agrupados.
 * Se edita la lista de INCLUIDOS (lo natural al armar un plan) aunque lo que se
 * guarda son los desactivados: así un módulo de una versión futura queda
 * incluido en todos los planes hasta que el operador diga lo contrario.
 */
export function PlanModulesPicker({
    disabled,
    onChange,
    readOnly = false,
}: {
    disabled: PlanModule[];
    onChange: (next: PlanModule[]) => void;
    readOnly?: boolean;
}): JSX.Element {
    const groups = Object.keys(PLAN_MODULE_GROUPS) as PlanModuleInfo['group'][];
    const toggle = (key: PlanModule, on: boolean): void => {
        onChange(on ? disabled.filter((k) => k !== key) : [...disabled, key]);
    };
    const all = PLAN_MODULE_CATALOG.map((m) => m.key);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="plan-modules-picker">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                <span>
                    {disabled.length === 0
                        ? __('Incluye todo.')
                        : `${PLAN_MODULE_CATALOG.length - disabled.length} ${__('de')} ${PLAN_MODULE_CATALOG.length} ${__('incluidos')}`}
                </span>
                {!readOnly && (
                    <span className="imcrm-flex imcrm-gap-3">
                        <button type="button" className="imcrm-text-primary hover:imcrm-underline" onClick={() => onChange([])}>
                            {__('Incluir todo')}
                        </button>
                        <button type="button" className="imcrm-text-primary hover:imcrm-underline" onClick={() => onChange(all)}>
                            {__('Quitar todo')}
                        </button>
                    </span>
                )}
            </div>
            {groups.map((g) => (
                <div key={g} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <span className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        {PLAN_MODULE_GROUPS[g]}
                    </span>
                    {PLAN_MODULE_CATALOG.filter((m) => m.group === g).map((m) => {
                        const on = !disabled.includes(m.key);
                        return (
                            <label
                                key={m.key}
                                className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-2.5 imcrm-py-2 imcrm-text-sm hover:imcrm-bg-muted/40"
                            >
                                <input
                                    type="checkbox"
                                    className="imcrm-mt-0.5"
                                    checked={on}
                                    disabled={readOnly}
                                    onChange={(e) => toggle(m.key, e.target.checked)}
                                    data-testid={`plan-module-${m.key}`}
                                />
                                <span className="imcrm-min-w-0">
                                    <span className="imcrm-block imcrm-font-medium">{m.label}</span>
                                    <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{m.description}</span>
                                </span>
                            </label>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}
