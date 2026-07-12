import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import type { DashboardVisibility } from '@/types/dashboard';

/**
 * Roles internos elegibles cuando la visibilidad es "roles". El admin
 * siempre ve todo (no se lista) y el rol `client` no aplica a
 * dashboards internos.
 */
const ROLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'manager', label: __('Manager') },
    { value: 'agent', label: __('Agente') },
    { value: 'viewer', label: __('Lector') },
];

interface DashboardVisibilityFieldsProps {
    /** Prefijo para los ids de los controles (evita colisiones entre dialogs). */
    idPrefix: string;
    visibility: DashboardVisibility;
    allowedRoles: string[];
    onVisibilityChange: (visibility: DashboardVisibility) => void;
    onAllowedRolesChange: (roles: string[]) => void;
}

/**
 * Selector de visibilidad del dashboard (workspace / private / roles) +
 * checkboxes de roles cuando aplica. Compartido por el dialog de
 * creación y el de configuración. El enforcement es del backend — esto
 * sólo pinta el selector y arma el payload.
 */
export function DashboardVisibilityFields({
    idPrefix,
    visibility,
    allowedRoles,
    onVisibilityChange,
    onAllowedRolesChange,
}: DashboardVisibilityFieldsProps): JSX.Element {
    const toggleRole = (role: string, checked: boolean): void => {
        onAllowedRolesChange(
            checked ? [...allowedRoles.filter((r) => r !== role), role] : allowedRoles.filter((r) => r !== role),
        );
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label htmlFor={`${idPrefix}-visibility`}>{__('Visibilidad')}</Label>
            <Select
                id={`${idPrefix}-visibility`}
                value={visibility}
                onChange={(e) => onVisibilityChange(e.target.value as DashboardVisibility)}
            >
                <option value="workspace">{__('Todo el workspace')}</option>
                <option value="private">{__('Sólo yo')}</option>
                <option value="roles">{__('Roles específicos')}</option>
            </Select>

            {visibility === 'roles' && (
                <div className="imcrm-mt-1 imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-3">
                    {ROLE_OPTIONS.map((role) => (
                        <label
                            key={role.value}
                            className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm"
                        >
                            <input
                                type="checkbox"
                                checked={allowedRoles.includes(role.value)}
                                onChange={(e) => toggleRole(role.value, e.target.checked)}
                            />
                            {role.label}
                        </label>
                    ))}
                </div>
            )}

            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Los administradores siempre ven todos los dashboards.')}
            </p>
        </div>
    );
}
