import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';

interface CustomRole {
    slug: string;
    label: string;
    capabilities: string[];
}

/**
 * Shape de `data` devuelto por `GET /roles`. El api.ts wrapper expone
 * solo `envelope.data` al cliente — el backend lo anida adentro
 * (`{ data: { roles, custom_roles, capabilities } }`).
 */
interface RolesData {
    roles: Array<{ slug: string; label: string; can_configure: boolean }>;
    custom_roles: CustomRole[];
    capabilities: string[];
}

/**
 * Card "Roles personalizados" (Fase 10 — pulidos).
 *
 * Permite al admin crear roles custom con su propio set de caps
 * `imcrm_*`. Útil para casos como "Vendedor Senior" (manager +
 * bulk_actions), "Soporte Cliente" (view only + comments), etc.
 *
 * UI:
 *  - Lista de roles existentes con tarjetas: label + caps badges +
 *    botón eliminar.
 *  - Botón "Agregar rol" abre form inline con: slug + label +
 *    checkboxes de caps.
 *  - Mismo form se usa para editar (click en el card del rol).
 *
 * El backend (RoleInstaller) sincroniza con WP roles después de cada
 * save/delete — el rol está disponible para asignar a users desde
 * wp-admin → Users inmediatamente.
 */
export function CustomRolesCard(): JSX.Element {
    const qc = useQueryClient();
    const [editingSlug, setEditingSlug] = useState<string | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);

    const rolesQuery = useQuery({
        queryKey: ['roles'],
        queryFn: async (): Promise<RolesData> => {
            const res = await api.get<RolesData>('/roles');
            return res.data;
        },
    });

    const saveMutation = useMutation({
        mutationFn: async (role: CustomRole): Promise<CustomRole[]> => {
            const res = await api.post<CustomRole[]>('/roles', role);
            return res.data;
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['roles'] });
            setEditingSlug(null);
            setShowAddForm(false);
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (slug: string): Promise<CustomRole[]> => {
            const res = await api.delete<CustomRole[]>(`/roles/${encodeURIComponent(slug)}`);
            return res.data;
        },
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['roles'] }),
    });

    if (rolesQuery.isLoading) {
        return (
            <Card>
                <CardContent className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    {__('Cargando roles…')}
                </CardContent>
            </Card>
        );
    }

    if (rolesQuery.isError || !rolesQuery.data) {
        return (
            <Card>
                <CardContent className="imcrm-py-6 imcrm-text-sm imcrm-text-destructive">
                    {__('No se pudieron cargar los roles.')}
                </CardContent>
            </Card>
        );
    }

    // Defensas con `??`: si el endpoint devuelve un shape distinto
    // (versión vieja del plugin, error en serialización, etc.), no
    // crashea la pantalla — muestra el card vacío.
    const customRoles = rolesQuery.data.custom_roles ?? [];
    const allCaps = rolesQuery.data.capabilities ?? [];

    return (
        <Card>
            <CardHeader>
                <CardTitle>{__('Roles personalizados')}</CardTitle>
                <CardDescription>
                    {__(
                        'Define roles con sets de capabilities personalizados. Útil cuando los 5 roles built-in (Admin, Manager, Agente, Visualizador, Cliente) no cubren tu caso de uso.',
                    )}
                </CardDescription>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                {customRoles.length === 0 && !showAddForm ? (
                    <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/30 imcrm-px-3 imcrm-py-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                        {__('No hay roles personalizados todavía.')}
                    </p>
                ) : null}

                {customRoles.map((role) => (
                    <RoleRow
                        key={role.slug}
                        role={role}
                        editing={editingSlug === role.slug}
                        allCaps={allCaps}
                        onEdit={() => setEditingSlug(role.slug)}
                        onCancel={() => setEditingSlug(null)}
                        onSave={(r) => saveMutation.mutate(r)}
                        onDelete={() => {
                            if (confirm(__('¿Eliminar este rol? Los users que lo tienen perderán las capabilities.'))) {
                                deleteMutation.mutate(role.slug);
                            }
                        }}
                        saving={saveMutation.isPending}
                    />
                ))}

                {showAddForm ? (
                    <RoleForm
                        initial={{ slug: '', label: '', capabilities: [] }}
                        allCaps={allCaps}
                        onSave={(r) => saveMutation.mutate(r)}
                        onCancel={() => setShowAddForm(false)}
                        saving={saveMutation.isPending}
                        error={saveMutation.error instanceof ApiError ? saveMutation.error.message : null}
                    />
                ) : (
                    <Button
                        variant="outline"
                        onClick={() => setShowAddForm(true)}
                        className="imcrm-gap-2 imcrm-self-start"
                    >
                        <Plus className="imcrm-h-4 imcrm-w-4" />
                        {__('Agregar rol')}
                    </Button>
                )}
            </CardContent>
        </Card>
    );
}

function RoleRow({
    role,
    editing,
    allCaps,
    onEdit,
    onCancel,
    onSave,
    onDelete,
    saving,
}: {
    role: CustomRole;
    editing: boolean;
    allCaps: string[];
    onEdit: () => void;
    onCancel: () => void;
    onSave: (role: CustomRole) => void;
    onDelete: () => void;
    saving: boolean;
}): JSX.Element {
    if (editing) {
        return (
            <RoleForm
                initial={role}
                allCaps={allCaps}
                onSave={onSave}
                onCancel={onCancel}
                saving={saving}
                error={null}
            />
        );
    }
    return (
        <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-3 imcrm-py-2">
            <button
                type="button"
                onClick={onEdit}
                className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-items-start imcrm-gap-1 imcrm-text-left"
            >
                <span className="imcrm-font-medium">{role.label}</span>
                <span className="imcrm-text-xs imcrm-font-mono imcrm-text-muted-foreground">
                    crm_custom_{role.slug}
                </span>
                <span className="imcrm-text-xs imcrm-text-muted-foreground">
                    {role.capabilities.length === 0
                        ? __('Sin capabilities')
                        : `${role.capabilities.length} ${__('capabilities')}`}
                </span>
            </button>
            <button
                type="button"
                onClick={onDelete}
                aria-label={__('Eliminar rol')}
                className="imcrm-rounded imcrm-p-1.5 imcrm-text-destructive hover:imcrm-bg-destructive/10"
            >
                <Trash2 className="imcrm-h-4 imcrm-w-4" />
            </button>
        </div>
    );
}

function RoleForm({
    initial,
    allCaps,
    onSave,
    onCancel,
    saving,
    error,
}: {
    initial: CustomRole;
    allCaps: string[];
    onSave: (role: CustomRole) => void;
    onCancel: () => void;
    saving: boolean;
    error: string | null;
}): JSX.Element {
    const [slug, setSlug] = useState(initial.slug);
    const [label, setLabel] = useState(initial.label);
    const [caps, setCaps] = useState<Set<string>>(new Set(initial.capabilities));

    const toggleCap = (cap: string, checked: boolean): void => {
        setCaps((prev) => {
            const next = new Set(prev);
            if (checked) next.add(cap);
            else next.delete(cap);
            return next;
        });
    };

    const handleSubmit = (e: React.FormEvent): void => {
        e.preventDefault();
        onSave({ slug: slug.trim(), label: label.trim(), capabilities: Array.from(caps) });
    };

    return (
        <form
            onSubmit={handleSubmit}
            className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-primary/30 imcrm-bg-primary/5 imcrm-px-3 imcrm-py-3"
        >
            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label htmlFor="role-slug">{__('Slug')}</Label>
                    <Input
                        id="role-slug"
                        value={slug}
                        onChange={(e) => {
                            const clean = e.target.value
                                .toLowerCase()
                                .replace(/[^a-z0-9_]/g, '')
                                .slice(0, 50);
                            setSlug(clean);
                        }}
                        disabled={initial.slug !== ''}
                        className="imcrm-font-mono"
                        placeholder="senior_seller"
                    />
                    {initial.slug === '' && (
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Solo a-z, 0-9, guion bajo. 3-50 chars. No se puede cambiar después.')}
                        </span>
                    )}
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label htmlFor="role-label">{__('Nombre legible')}</Label>
                    <Input
                        id="role-label"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder={__('Vendedor Senior')}
                        maxLength={100}
                    />
                </div>
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label>{__('Capabilities')}</Label>
                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-1.5 sm:imcrm-grid-cols-2">
                    {allCaps.map((cap) => (
                        <label
                            key={cap}
                            className="imcrm-inline-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm"
                        >
                            <input
                                type="checkbox"
                                checked={caps.has(cap)}
                                onChange={(e) => toggleCap(cap, e.target.checked)}
                                className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                            />
                            <span className="imcrm-font-mono imcrm-text-xs">{cap}</span>
                        </label>
                    ))}
                </div>
            </div>

            {error !== null && (
                <p className="imcrm-rounded imcrm-bg-destructive/10 imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-text-destructive">
                    {error}
                </p>
            )}

            <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                    {__('Cancelar')}
                </Button>
                <Button type="submit" size="sm" disabled={saving || slug === '' || label === ''}>
                    {saving ? __('Guardando…') : __('Guardar rol')}
                </Button>
            </div>
        </form>
    );
}
