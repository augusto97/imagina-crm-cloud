import { useEffect, useMemo, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { useFields } from '@/hooks/useFields';
import {
    useListPermissions,
    useUpdateListPermissions,
} from '@/hooks/usePermissions';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import type { RolePermissions, Scope } from '@/types/permissions';

interface Props {
    listId: number;
}

const SCOPE_OPTIONS: Array<{ value: Scope; label: string }> = [
    { value: 'all', label: __('Todos') },
    { value: 'assigned', label: __('Asignados') },
    { value: 'own', label: __('Propios') },
    { value: 'none', label: __('Ninguno') },
];

/**
 * Panel de "Permisos por rol" del List Builder (Fase 7 — 1.E).
 *
 * Renderiza una matriz `rol × operación` (view/create/edit/delete) editable
 * por el admin de la lista. `crm_admin` y `crm_client` no aparecen — el
 * primero tiene bypass total, el segundo solo va al portal (Fase 9).
 *
 * El `assignment_field_id` (necesario cuando scope=assigned) se elige
 * del subset de fields de tipo `user` de la lista.
 */
export function PermissionsPanel({ listId }: Props): JSX.Element {
    const query = useListPermissions(listId);
    const update = useUpdateListPermissions(listId);
    const fields = useFields(listId);

    const [perms, setPerms] = useState<Record<string, RolePermissions>>({});
    const [assignmentFieldId, setAssignmentFieldId] = useState<number | null>(null);
    const [dirty, setDirty] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    useEffect(() => {
        if (query.data) {
            setPerms(query.data.permissions);
            setAssignmentFieldId(query.data.assignment_field_id);
            setDirty(false);
        }
    }, [query.data]);

    const configurableRoles = useMemo(
        () => (query.data?.roles ?? []).filter((r) => r.can_configure),
        [query.data?.roles],
    );

    const userFields = useMemo(
        () => (fields.data ?? []).filter((f) => f.type === 'user'),
        [fields.data],
    );

    const usesAssigned = useMemo(
        () =>
            Object.values(perms).some(
                (p) => p.view === 'assigned' || p.edit === 'assigned' || p.delete === 'assigned',
            ),
        [perms],
    );

    const setRoleScope = (role: string, op: 'view' | 'edit' | 'delete', scope: Scope): void => {
        setPerms((prev) => {
            const current = prev[role] ?? blankRolePermissions();
            return { ...prev, [role]: { ...current, [op]: scope } };
        });
        setDirty(true);
    };

    const setRoleCreate = (role: string, value: boolean): void => {
        setPerms((prev) => {
            const current = prev[role] ?? blankRolePermissions();
            return { ...prev, [role]: { ...current, create: value } };
        });
        setDirty(true);
    };

    const toggleHiddenField = (role: string, slug: string, hide: boolean): void => {
        setPerms((prev) => {
            const current = prev[role] ?? blankRolePermissions();
            const hiddenSet = new Set(current.fields_hidden);
            if (hide) hiddenSet.add(slug);
            else hiddenSet.delete(slug);
            return {
                ...prev,
                [role]: { ...current, fields_hidden: Array.from(hiddenSet) },
            };
        });
        setDirty(true);
    };

    const allFields = fields.data ?? [];

    const handleSave = async (): Promise<void> => {
        setSubmitError(null);
        try {
            await update.mutateAsync({
                permissions: perms,
                assignment_field_id: assignmentFieldId,
            });
            setDirty(false);
        } catch (err) {
            setSubmitError(
                err instanceof ApiError || err instanceof Error ? err.message : __('Error desconocido'),
            );
        }
    };

    if (query.isLoading) {
        return (
            <Card>
                <CardContent className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    {__('Cargando permisos…')}
                </CardContent>
            </Card>
        );
    }

    if (query.isError) {
        return (
            <Card>
                <CardContent className="imcrm-py-6 imcrm-text-sm imcrm-text-destructive">
                    {__('No se pudieron cargar los permisos.')}
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <ShieldCheck className="imcrm-mt-0.5 imcrm-h-5 imcrm-w-5 imcrm-text-muted-foreground" />
                    <div>
                        <CardTitle>{__('Permisos')}</CardTitle>
                        <CardDescription>
                            {__(
                                'Define qué roles pueden ver, crear, editar y eliminar registros en esta lista. Administradores y administradores del CRM tienen acceso total siempre.',
                            )}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                <div className="imcrm-overflow-x-auto">
                    <table className="imcrm-w-full imcrm-border-collapse imcrm-text-sm">
                        <thead>
                            <tr className="imcrm-border-b imcrm-border-border imcrm-text-left imcrm-text-xs imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                                <th className="imcrm-py-2 imcrm-pr-3 imcrm-font-medium">{__('Rol')}</th>
                                <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Ver')}</th>
                                <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Crear')}</th>
                                <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Editar')}</th>
                                <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Eliminar')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {configurableRoles.map((role) => {
                                const p = perms[role.slug];
                                if (!p) return null;
                                return (
                                    <tr
                                        key={role.slug}
                                        className="imcrm-border-b imcrm-border-border/60 last:imcrm-border-b-0"
                                    >
                                        <td className="imcrm-py-3 imcrm-pr-3 imcrm-font-medium imcrm-text-foreground">
                                            {role.label}
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-3">
                                            <ScopeSelect
                                                value={p.view}
                                                onChange={(v) => setRoleScope(role.slug, 'view', v)}
                                            />
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-3">
                                            <label className="imcrm-inline-flex imcrm-items-center imcrm-gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={p.create}
                                                    onChange={(e) =>
                                                        setRoleCreate(role.slug, e.target.checked)
                                                    }
                                                    className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                                                />
                                                <span className="imcrm-text-muted-foreground">
                                                    {p.create ? __('Sí') : __('No')}
                                                </span>
                                            </label>
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-3">
                                            <ScopeSelect
                                                value={p.edit}
                                                onChange={(v) => setRoleScope(role.slug, 'edit', v)}
                                            />
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-3">
                                            <ScopeSelect
                                                value={p.delete}
                                                onChange={(v) => setRoleScope(role.slug, 'delete', v)}
                                            />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {allFields.length > 0 && (
                    <details className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-px-3 imcrm-py-2">
                        <summary className="imcrm-cursor-pointer imcrm-text-sm imcrm-font-medium">
                            {__('Campos ocultos por rol')}
                            <span className="imcrm-ml-2 imcrm-text-xs imcrm-text-muted-foreground">
                                {__('(opcional — Fase 10)')}
                            </span>
                        </summary>
                        <p className="imcrm-mt-2 imcrm-text-xs imcrm-text-muted-foreground">
                            {__(
                                'Marca un campo para OCULTARLO al rol. El backend lo remueve de las respuestas REST y rechaza intentos de edición. Si un campo se oculta para TODOS los roles del user, no aparece en su tabla.',
                            )}
                        </p>
                        <div className="imcrm-mt-3 imcrm-overflow-x-auto">
                            <table className="imcrm-w-full imcrm-border-collapse imcrm-text-sm">
                                <thead>
                                    <tr className="imcrm-border-b imcrm-border-border imcrm-text-left imcrm-text-xs imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                                        <th className="imcrm-py-2 imcrm-pr-3 imcrm-font-medium">
                                            {__('Campo')}
                                        </th>
                                        {configurableRoles.map((role) => (
                                            <th
                                                key={role.slug}
                                                className="imcrm-px-2 imcrm-py-2 imcrm-text-center imcrm-font-medium"
                                            >
                                                {role.label}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {allFields.map((field) => (
                                        <tr
                                            key={field.id}
                                            className="imcrm-border-b imcrm-border-border/60 last:imcrm-border-b-0"
                                        >
                                            <td className="imcrm-py-2 imcrm-pr-3">
                                                <span className="imcrm-font-medium">{field.label}</span>
                                                <span className="imcrm-ml-1 imcrm-text-xs imcrm-text-muted-foreground imcrm-font-mono">
                                                    ({field.slug})
                                                </span>
                                            </td>
                                            {configurableRoles.map((role) => {
                                                const p = perms[role.slug];
                                                const isHidden = p?.fields_hidden.includes(field.slug) ?? false;
                                                return (
                                                    <td
                                                        key={role.slug}
                                                        className="imcrm-px-2 imcrm-py-2 imcrm-text-center"
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={isHidden}
                                                            onChange={(e) =>
                                                                toggleHiddenField(
                                                                    role.slug,
                                                                    field.slug,
                                                                    e.target.checked,
                                                                )
                                                            }
                                                            className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                                                            aria-label={`${__('Ocultar')} ${field.label} ${__('a')} ${role.label}`}
                                                        />
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </details>
                )}

                {usesAssigned && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-px-3 imcrm-py-3">
                        <label
                            htmlFor="assignment-field"
                            className="imcrm-text-sm imcrm-font-medium"
                        >
                            {__('Campo de asignación')}
                        </label>
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__(
                                'Algún rol usa scope "Asignados". Elige el campo (tipo Usuario) que representa al responsable del registro. Sin esto, ese scope no devolverá nada.',
                            )}
                        </p>
                        <select
                            id="assignment-field"
                            className="imcrm-h-9 imcrm-w-full imcrm-max-w-md imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-3 imcrm-text-sm"
                            value={assignmentFieldId ?? ''}
                            onChange={(e) => {
                                const v = e.target.value === '' ? null : parseInt(e.target.value, 10);
                                setAssignmentFieldId(v);
                                setDirty(true);
                            }}
                        >
                            <option value="">{__('— Sin asignar —')}</option>
                            {userFields.map((f) => (
                                <option key={f.id} value={f.id}>
                                    {f.label}
                                </option>
                            ))}
                        </select>
                        {userFields.length === 0 && (
                            <p className="imcrm-text-xs imcrm-text-amber-600 dark:imcrm-text-amber-400">
                                {__(
                                    'No hay campos de tipo Usuario en esta lista. Agrega uno para poder usar el scope "Asignados".',
                                )}
                            </p>
                        )}
                    </div>
                )}

                {submitError !== null && (
                    <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                        {submitError}
                    </div>
                )}

                <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__(
                            'Scopes: "Todos" = todos los registros · "Asignados" = los del campo de asignación · "Propios" = los creados por el usuario.',
                        )}
                    </p>
                    <Button
                        onClick={handleSave}
                        disabled={!dirty || update.isPending}
                        className="imcrm-gap-2"
                    >
                        {update.isPending ? __('Guardando…') : __('Guardar permisos')}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

function blankRolePermissions(): RolePermissions {
    return {
        view: 'none',
        create: false,
        edit: 'none',
        delete: 'none',
        fields_hidden: [],
    };
}

function ScopeSelect({
    value,
    onChange,
}: {
    value: Scope;
    onChange: (v: Scope) => void;
}): JSX.Element {
    return (
        <select
            className="imcrm-h-8 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
            value={value}
            onChange={(e) => onChange(e.target.value as Scope)}
        >
            {SCOPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                    {o.label}
                </option>
            ))}
        </select>
    );
}
