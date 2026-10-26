import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, EyeOff, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useFields } from '@/hooks/useFields';
import { useListPermissions, useUpdateListPermissions } from '@/hooks/usePermissions';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { RolePermissions, Scope } from '@imagina-base/shared';

import { ACCESS_LEVELS, blankRolePermissions, levelOf, type AccessLevel } from './listAccessLevels';
import { ListTeamAccess } from './ListTeamAccess';

interface Props {
    listId: number;
}

const SCOPE_OPTIONS: Array<{ value: Scope; label: string }> = [
    { value: 'all', label: __('Todos los registros') },
    { value: 'assigned', label: __('Los asignados a la persona (y los que creó)') },
    { value: 'own', label: __('Los que creó') },
    { value: 'none', label: __('Ninguno') },
];

/**
 * Sección "Quién puede hacer qué" (permisos por rol de la lista).
 *
 * Una tarjeta por rol con un nivel de acceso elegible de un vistazo y
 * un "Ajuste fino" plegado con los cuatro ejes (ver / crear / editar /
 * eliminar) y los campos que ese rol no debe ver. Los administradores
 * del workspace tienen acceso total siempre y no aparecen aquí.
 */
export function PermissionsPanel({ listId }: Props): JSX.Element {
    const query = useListPermissions(listId);
    const update = useUpdateListPermissions(listId);
    const fields = useFields(listId);

    const [perms, setPerms] = useState<Record<string, RolePermissions>>({});
    const [assignmentFieldId, setAssignmentFieldId] = useState<number | null>(null);
    const [assignmentTeamFieldId, setAssignmentTeamFieldId] = useState<number | null>(null);
    const [dirty, setDirty] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    // C2 — filas de roles PROPIOS que heredan la de su rol base (no se guardan).
    const [inherit, setInherit] = useState<Record<string, boolean>>({});

    useEffect(() => {
        if (query.data) {
            setPerms(query.data.permissions);
            setAssignmentFieldId(query.data.assignment_field_id);
            setAssignmentTeamFieldId(query.data.assignment_team_field_id ?? null);
            setInherit(Object.fromEntries(query.data.roles.filter((r) => r.custom_role_id).map((r) => [r.slug, r.inherited === true])));
            setDirty(false);
        }
    }, [query.data]);

    const setInherited = (slug: string, on: boolean, base: string | undefined): void => {
        setInherit((prev) => ({ ...prev, [slug]: on }));
        // Al volver a heredar, la fila muestra otra vez la de su base.
        if (on && base && perms[base]) setPerms((prev) => ({ ...prev, [slug]: { ...prev[base]! } }));
        setDirty(true);
    };

    const configurableRoles = useMemo(
        () => (query.data?.roles ?? []).filter((r) => r.can_configure),
        [query.data?.roles],
    );

    const userFields = useMemo(
        () => (fields.data ?? []).filter((f) => f.type === 'user'),
        [fields.data],
    );
    const teamFields = useMemo(
        () => (fields.data ?? []).filter((f) => f.type === 'team'),
        [fields.data],
    );

    const usesAssigned = useMemo(
        () =>
            Object.values(perms).some(
                (p) => p.view === 'assigned' || p.edit === 'assigned' || p.delete === 'assigned',
            ),
        [perms],
    );

    const patchRole = (role: string, patch: Partial<RolePermissions>): void => {
        setPerms((prev) => {
            const next = { ...(prev[role] ?? blankRolePermissions()), ...patch };
            // v0.1.253 — quien crea ve, como mínimo, lo que creó (el backend
            // aplica la misma regla): "Ver: nada" con "Crear: sí" dejaba al
            // registro recién creado invisible para quien lo creó.
            if (next.create && next.view === 'none') next.view = 'own';
            return { ...prev, [role]: next };
        });
        setDirty(true);
    };

    const applyLevel = (role: string, level: AccessLevel): void => {
        patchRole(role, level.perms);
    };

    const toggleHiddenField = (role: string, slug: string, hide: boolean): void => {
        const current = perms[role] ?? blankRolePermissions();
        const hiddenSet = new Set(current.fields_hidden);
        if (hide) hiddenSet.add(slug);
        else hiddenSet.delete(slug);
        patchRole(role, { fields_hidden: Array.from(hiddenSet) });
    };

    const allFields = fields.data ?? [];

    const handleSave = async (): Promise<void> => {
        setSubmitError(null);
        try {
            const inheritedKeys = Object.entries(inherit)
                .filter(([, on]) => on)
                .map(([k]) => k);
            await update.mutateAsync({
                // Las filas de roles propios que heredan no se guardan: siguen a su base.
                permissions: Object.fromEntries(Object.entries(perms).filter(([k]) => !inheritedKeys.includes(k))),
                assignment_field_id: assignmentFieldId,
                assignment_team_field_id: assignmentTeamFieldId,
                ...(inheritedKeys.length > 0 ? { reset_roles: inheritedKeys } : {}),
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
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                {__('Cargando permisos…')}
            </div>
        );
    }

    if (query.isError) {
        return (
            <p className="imcrm-py-6 imcrm-text-sm imcrm-text-destructive">
                {__('No se pudieron cargar los permisos.')}
            </p>
        );
    }

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
            {configurableRoles.map((role) => {
                const p = perms[role.slug];
                if (!p) return null;
                const level = levelOf(p);
                const isCustom = role.custom_role_id !== undefined && role.custom_role_id !== null;
                const baseLabel = configurableRoles.find((r) => r.slug === role.base_role)?.label ?? role.base_role ?? '';
                if (isCustom && inherit[role.slug]) {
                    // C2 — rol propio que todavía usa la fila de su base (en vivo).
                    const baseLevel = levelOf(perms[role.base_role ?? ''] ?? p);
                    return (
                        <section
                            key={role.slug}
                            data-testid="perm-role-inherited"
                            data-role={role.slug}
                            className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-card imcrm-p-4"
                        >
                            <div className="imcrm-min-w-0">
                                <h3 className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                                    {role.label}
                                    <span className="imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium imcrm-text-muted-foreground">
                                        {__('Rol propio')}
                                    </span>
                                </h3>
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {`${__('Usa los mismos permisos que')} «${baseLabel}»${baseLevel !== null ? ` — ${ACCESS_LEVELS.find((l) => l.id === baseLevel)?.label ?? ''}` : ''}.`}
                                </p>
                            </div>
                            <Button size="sm" variant="outline" onClick={() => setInherited(role.slug, false, role.base_role)}>
                                {__('Personalizar para este rol')}
                            </Button>
                        </section>
                    );
                }
                return (
                    <section
                        key={role.slug}
                        data-role={role.slug}
                        className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4"
                    >
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-baseline imcrm-justify-between imcrm-gap-2">
                            <h3 className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                                {role.label}
                                {isCustom && (
                                    <span className="imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium imcrm-text-muted-foreground">
                                        {`${__('Rol propio · basado en')} ${baseLabel}`}
                                    </span>
                                )}
                            </h3>
                            <span className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                {level === null && (
                                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                        {__('Configuración personalizada')}
                                    </span>
                                )}
                                {isCustom && (
                                    <button
                                        type="button"
                                        onClick={() => setInherited(role.slug, true, role.base_role)}
                                        className="imcrm-text-xs imcrm-text-primary hover:imcrm-underline"
                                    >
                                        {`${__('Volver a usar los de')} «${baseLabel}»`}
                                    </button>
                                )}
                            </span>
                        </div>

                        <div
                            role="radiogroup"
                            aria-label={`${__('Nivel de acceso')} — ${role.label}`}
                            className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5"
                        >
                            {ACCESS_LEVELS.map((l) => (
                                <button
                                    key={l.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={level === l.id}
                                    title={l.hint}
                                    onClick={() => applyLevel(role.slug, l)}
                                    className={cn(
                                        'imcrm-rounded-md imcrm-border imcrm-px-2.5 imcrm-py-1.5 imcrm-text-xs imcrm-font-medium imcrm-transition-colors',
                                        level === l.id
                                            ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-primary'
                                            : 'imcrm-border-border imcrm-text-muted-foreground hover:imcrm-border-primary/40 hover:imcrm-text-foreground',
                                    )}
                                >
                                    {l.label}
                                </button>
                            ))}
                        </div>

                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {level !== null
                                ? (ACCESS_LEVELS.find((l) => l.id === level)?.hint ?? '')
                                : __('Este rol usa una combinación propia — mírala en el ajuste fino.')}
                        </p>

                        <details className="imcrm-group imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20">
                            <summary className="imcrm-flex imcrm-cursor-pointer imcrm-list-none imcrm-items-center imcrm-gap-1.5 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">
                                <ChevronDown
                                    className="imcrm-h-3.5 imcrm-w-3.5 imcrm-transition-transform group-open:imcrm-rotate-180"
                                    aria-hidden
                                />
                                {__('Ajuste fino')}
                            </summary>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-px-3 imcrm-py-3">
                                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-3">
                                    <ScopeField
                                        label={__('Puede ver')}
                                        value={p.view}
                                        onChange={(v) => patchRole(role.slug, { view: v })}
                                    />
                                    <ScopeField
                                        label={__('Puede editar')}
                                        value={p.edit}
                                        onChange={(v) => patchRole(role.slug, { edit: v })}
                                    />
                                    <ScopeField
                                        label={__('Puede eliminar')}
                                        value={p.delete}
                                        onChange={(v) => patchRole(role.slug, { delete: v })}
                                    />
                                </div>

                                <label className="imcrm-inline-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                    <input
                                        type="checkbox"
                                        checked={p.create}
                                        onChange={(e) => patchRole(role.slug, { create: e.target.checked })}
                                        className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                                    />
                                    {__('Puede crear registros nuevos')}
                                </label>

                                {allFields.length > 0 && (
                                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                        <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-medium imcrm-text-foreground">
                                            <EyeOff className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                            {__('Campos que este rol NO debe ver')}
                                        </span>
                                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                                            {allFields.map((field) => {
                                                const hidden = p.fields_hidden.includes(field.slug);
                                                return (
                                                    <button
                                                        key={field.id}
                                                        type="button"
                                                        aria-pressed={hidden}
                                                        onClick={() =>
                                                            toggleHiddenField(role.slug, field.slug, !hidden)
                                                        }
                                                        className={cn(
                                                            'imcrm-rounded-md imcrm-border imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-transition-colors',
                                                            hidden
                                                                ? 'imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-text-destructive'
                                                                : 'imcrm-border-border imcrm-text-muted-foreground hover:imcrm-text-foreground',
                                                        )}
                                                    >
                                                        {field.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                            {__(
                                                'Los campos marcados no llegan a la pantalla de ese rol ni puede modificarlos.',
                                            )}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </details>
                    </section>
                );
            })}

            {usesAssigned && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-4">
                    <label htmlFor="assignment-field" className="imcrm-text-sm imcrm-font-medium">
                        {__('¿Qué campo dice quién es el responsable?')}
                    </label>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__(
                            'Algún rol ve "los asignados a la persona". Elige el campo de tipo Usuario que marca al responsable del registro. Sin campo elegido, esa persona ve sólo los que creó.',
                        )}
                    </p>
                    <Select
                        id="assignment-field"
                        className="imcrm-max-w-md"
                        value={assignmentFieldId ?? ''}
                        onChange={(e) => {
                            const v = e.target.value === '' ? null : parseInt(e.target.value, 10);
                            setAssignmentFieldId(v);
                            setDirty(true);
                        }}
                    >
                        <option value="">{__('— Sin definir —')}</option>
                        {userFields.map((f) => (
                            <option key={f.id} value={f.id}>
                                {f.label}
                            </option>
                        ))}
                    </Select>
                    {teamFields.length > 0 && (
                        <>
                            <label htmlFor="assignment-team-field" className="imcrm-mt-2 imcrm-text-sm imcrm-font-medium">
                                {__('¿Y qué campo dice qué equipo lo atiende? (opcional)')}
                            </label>
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Con un campo Equipo elegido, un registro también cuenta como asignado a todas las personas de los equipos que tiene.')}
                            </p>
                            <Select
                                id="assignment-team-field"
                                className="imcrm-max-w-md"
                                value={assignmentTeamFieldId ?? ''}
                                onChange={(e) => {
                                    setAssignmentTeamFieldId(e.target.value === '' ? null : parseInt(e.target.value, 10));
                                    setDirty(true);
                                }}
                                data-testid="imcrm-assignment-team-field"
                            >
                                <option value="">{__('— Ninguno —')}</option>
                                {teamFields.map((f) => (
                                    <option key={f.id} value={f.id}>
                                        {f.label}
                                    </option>
                                ))}
                            </Select>
                        </>
                    )}
                    {userFields.length === 0 && teamFields.length === 0 && (
                        <p className="imcrm-text-xs imcrm-text-warning">
                            {__(
                                'Esta lista no tiene ningún campo de tipo Usuario ni Equipo. Crea uno en la pestaña Campos para poder usar este nivel de acceso.',
                            )}
                        </p>
                    )}
                </div>
            )}

            <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4">
                <ListTeamAccess listId={listId} />
            </section>

            {submitError !== null && (
                <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                    {submitError}
                </div>
            )}

            <div className="imcrm-flex imcrm-justify-end">
                <Button onClick={() => void handleSave()} disabled={!dirty || update.isPending}>
                    {update.isPending ? __('Guardando…') : __('Guardar permisos')}
                </Button>
            </div>
        </div>
    );
}

function ScopeField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: Scope;
    onChange: (v: Scope) => void;
}): JSX.Element {
    return (
        <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">
            {label}
            <Select value={value} onChange={(e) => onChange(e.target.value as Scope)}>
                {SCOPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                        {o.label}
                    </option>
                ))}
            </Select>
        </label>
    );
}
