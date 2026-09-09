import type { TemplateRoleField } from '@imagina-base/shared';

import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { fieldFitsRole, type MappableField } from './roleMapping';

interface Props {
    roles: TemplateRoleField[];
    fields: MappableField[];
    value: Record<string, number>;
    onChange: (next: Record<string, number>) => void;
    idPrefix?: string;
}

/**
 * Paso de mapeo rol → campo (v0.1.167), compartido por las plantillas de
 * dashboard y de automatización: una fila por rol con un select de los
 * campos COMPATIBLES de la lista (por tipo). Los obligatorios llevan
 * asterisco; sin elegirlos, los widgets/acciones que los usan se omiten.
 */
export function RoleFieldMapper({ roles, fields, value, onChange, idPrefix = 'role' }: Props): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
            {roles.map((role) => {
                const options = fields.filter((f) => fieldFitsRole(f, role));
                const current = value[role.key];
                const missing = role.required && current === undefined;
                const Icon = fieldTypeIcon(options.find((f) => f.id === current)?.type ?? role.types[0] ?? 'text');
                return (
                    <div key={role.key} className="imcrm-grid imcrm-grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] imcrm-items-center imcrm-gap-2">
                        <Label htmlFor={`${idPrefix}-${role.key}`} className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-text-sm">
                            <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                            <span className="imcrm-truncate">{role.label}</span>
                            {role.required && <span className="imcrm-text-destructive" aria-hidden>*</span>}
                        </Label>
                        <Select
                            id={`${idPrefix}-${role.key}`}
                            value={current === undefined ? '' : String(current)}
                            onChange={(e) => {
                                const next = { ...value };
                                if (e.target.value === '') delete next[role.key];
                                else next[role.key] = Number(e.target.value);
                                onChange(next);
                            }}
                            className={cn(missing && 'imcrm-border-amber-400')}
                            aria-invalid={missing || undefined}
                        >
                            <option value="">{options.length === 0 ? __('Ningún campo compatible') : __('— Sin asignar —')}</option>
                            {options.map((f) => (
                                <option key={f.id} value={f.id}>{f.label}</option>
                            ))}
                        </Select>
                    </div>
                );
            })}
            {roles.some((r) => r.required) && (
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('* Obligatorio: lo que dependa de un rol sin asignar no se crea.')}
                </p>
            )}
        </div>
    );
}
