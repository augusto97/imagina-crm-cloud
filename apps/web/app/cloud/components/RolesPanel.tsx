import { useState } from 'react';
import { Check, KeyRound, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import {
    CAPABILITIES_BY_ROLE,
    CAPABILITY_GROUPS,
    CUSTOM_ROLE_BASES,
    TOGGLEABLE_CAPABILITIES,
    type Capability,
    type CustomRole,
    type CustomRoleBase,
} from '@imagina-base/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useCreateCustomRole, useCustomRoles, useDeleteCustomRole, useUpdateCustomRole } from '@/hooks/useCustomRoles';
import { __, _n, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { ROLE_LABELS } from './MemberControls';

/** Lo que hace cada rol fijo, en una línea. */
const BASE_HINTS: Record<string, string> = {
    admin: 'Todo: miembros, plan, ajustes de la empresa y cualquier lista.',
    manager: 'Trabaja con todos los registros, arma vistas y tableros.',
    agent: 'Trabaja con sus registros según los permisos de cada lista.',
    viewer: 'Mira los registros, sin cambiar nada.',
};

const ROLE_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#4b5563'];

/**
 * C2 — Ajustes → Roles (sólo el admin). Los cuatro roles de siempre quedan
 * FIJOS; los propios parten de uno de ellos (que decide el acceso por defecto
 * a cada lista) y ajustan qué puede hacer la persona módulo por módulo. El
 * servidor resuelve las capacidades en cada pedido: lo que se apaga aquí deja
 * de funcionar aunque alguien llame a la API directo.
 */
export function RolesPanel(): JSX.Element {
    const roles = useCustomRoles();
    const del = useDeleteCustomRole();
    const confirm = useConfirm();
    const toast = useToast();
    const [editing, setEditing] = useState<CustomRole | 'new' | null>(null);
    const [viewing, setViewing] = useState<string | null>(null);

    const base = roles.data?.base ?? [];
    const custom = roles.data?.custom ?? [];

    const remove = async (role: CustomRole): Promise<void> => {
        const baseLabel = ROLE_LABELS[role.base_role] ?? role.base_role;
        const ok = await confirm({
            title: sprintf(__('¿Eliminar el rol «%s»?'), role.name),
            description:
                role.member_count > 0
                    ? sprintf(
                          _n(
                              'La persona con este rol pasa a su rol base, «%2$s», con lo que ese rol permite.',
                              'Las %1$d personas con este rol pasan a su rol base, «%2$s», con lo que ese rol permite.',
                              role.member_count,
                          ),
                          role.member_count,
                          baseLabel,
                      )
                    : __('Nadie tiene este rol todavía.'),
            confirmLabel: __('Eliminar rol'),
            destructive: true,
        });
        if (!ok) return;
        try {
            await del.mutateAsync(role.id);
            toast.success(sprintf(__('Se eliminó «%s».'), role.name));
        } catch (err) {
            toast.error(__('No se pudo eliminar el rol.'), err instanceof Error ? err.message : undefined);
        }
    };

    return (
        <Card data-testid="imcrm-roles-panel">
            <CardHeader>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-3">
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                            <KeyRound className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <div>
                            <CardTitle>{__('Roles')}</CardTitle>
                            <CardDescription>
                                {__(
                                    'Los cuatro roles de siempre quedan fijos. Crea roles propios —por ejemplo «Supervisor» o «Contador»— a partir de uno de ellos y decide qué puede hacer cada uno en cada parte de la app.',
                                )}
                            </CardDescription>
                        </div>
                    </div>
                    <Button size="sm" onClick={() => setEditing('new')} data-testid="imcrm-role-new">
                        <Plus className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        {__('Nuevo rol')}
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="imcrm-space-y-4 imcrm-pt-0">
                {roles.isLoading && <div className="imcrm-h-24 imcrm-animate-pulse imcrm-rounded-lg imcrm-bg-muted/40" />}

                <div>
                    <p className="imcrm-mb-1 imcrm-text-xs imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        {__('Roles fijos')}
                    </p>
                    <ul className="imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border">
                        {base.map((b) => (
                            <li key={b.role} data-testid="imcrm-role-base" className="imcrm-px-3 imcrm-py-2.5">
                                <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                                    <Lock className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                                    <button
                                        type="button"
                                        className="imcrm-min-w-0 imcrm-flex-1 imcrm-text-left"
                                        onClick={() => setViewing((v) => (v === b.role ? null : b.role))}
                                        aria-expanded={viewing === b.role}
                                    >
                                        <span className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                                            {ROLE_LABELS[b.role] ?? b.role}
                                            <Badge variant="secondary" className="imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]">
                                                {__('Fijo')}
                                            </Badge>
                                        </span>
                                        <span className="imcrm-block imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                                            {__(BASE_HINTS[b.role] ?? '')}
                                        </span>
                                    </button>
                                    <span className="imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground">
                                        {sprintf(_n('%d persona', '%d personas', b.member_count), b.member_count)}
                                    </span>
                                </div>
                                {viewing === b.role && (
                                    <div className="imcrm-mt-2 imcrm-pl-7">
                                        <CapabilityList capabilities={CAPABILITIES_BY_ROLE[b.role]} readOnly />
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>

                <div>
                    <p className="imcrm-mb-1 imcrm-text-xs imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        {__('Roles propios')}
                    </p>
                    {!roles.isLoading && custom.length === 0 ? (
                        <div className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-6 imcrm-text-center">
                            <p className="imcrm-text-sm imcrm-font-medium">{__('Todavía no hay roles propios')}</p>
                            <p className="imcrm-mx-auto imcrm-mt-1 imcrm-max-w-md imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Por ejemplo, un «Agente» que además exporta, o un «Lector» que no ve los tableros.')}
                            </p>
                        </div>
                    ) : (
                        <ul className="imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border">
                            {custom.map((r) => (
                                <li key={r.id} data-testid="imcrm-role-row" className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-px-3 imcrm-py-2.5">
                                    <span
                                        className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-rounded-full imcrm-ring-1 imcrm-ring-border"
                                        style={{ background: r.color ?? 'hsl(var(--imcrm-muted))' }}
                                        aria-hidden
                                    />
                                    <button type="button" onClick={() => setEditing(r)} className="imcrm-min-w-0 imcrm-flex-1 imcrm-text-left">
                                        <span className="imcrm-block imcrm-truncate imcrm-text-sm imcrm-font-medium">{r.name}</span>
                                        <span className="imcrm-block imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                                            {sprintf(__('Basado en %s'), ROLE_LABELS[r.base_role] ?? r.base_role)}
                                            {r.description ? ` · ${r.description}` : ''}
                                        </span>
                                    </button>
                                    <span className="imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground">
                                        {sprintf(_n('%d persona', '%d personas', r.member_count), r.member_count)}
                                    </span>
                                    <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-0.5">
                                        <Button variant="ghost" size="icon" onClick={() => setEditing(r)} aria-label={sprintf(__('Editar «%s»'), r.name)} title={__('Editar')}>
                                            <Pencil className="imcrm-h-4 imcrm-w-4" aria-hidden />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => void remove(r)}
                                            aria-label={sprintf(__('Eliminar «%s»'), r.name)}
                                            title={__('Eliminar')}
                                            className="hover:imcrm-text-destructive"
                                        >
                                            <Trash2 className="imcrm-h-4 imcrm-w-4" aria-hidden />
                                        </Button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </CardContent>
            {editing !== null && <RoleEditor role={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
        </Card>
    );
}

/** Capacidades agrupadas por módulo, con interruptores (o sólo lectura). */
function CapabilityList({
    capabilities,
    readOnly = false,
    onToggle,
}: {
    capabilities: readonly Capability[];
    readOnly?: boolean;
    onToggle?: (cap: Capability, on: boolean) => void;
}): JSX.Element {
    const have = new Set(capabilities);
    return (
        <div className="imcrm-space-y-3">
            {CAPABILITY_GROUPS.map((g) => (
                <fieldset key={g.module} className="imcrm-space-y-1">
                    <legend className="imcrm-text-xs imcrm-font-semibold imcrm-text-foreground/80">{__(g.module)}</legend>
                    {g.items.map((it) => {
                        const on = have.has(it.capability);
                        return readOnly ? (
                            <div key={it.capability} className={cn('imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-xs', !on && 'imcrm-text-muted-foreground/70 imcrm-line-through')}>
                                <Check className={cn('imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0', on ? 'imcrm-text-success' : 'imcrm-opacity-0')} aria-hidden />
                                <span>{__(it.label)}</span>
                            </div>
                        ) : (
                            <label
                                key={it.capability}
                                className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2.5 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 hover:imcrm-bg-muted/40"
                                data-testid="imcrm-role-capability"
                                data-capability={it.capability}
                            >
                                <input
                                    type="checkbox"
                                    className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-accent-primary"
                                    checked={on}
                                    onChange={(e) => onToggle?.(it.capability, e.target.checked)}
                                />
                                <span className="imcrm-min-w-0">
                                    <span className="imcrm-block imcrm-text-sm">{__(it.label)}</span>
                                    <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{__(it.help)}</span>
                                </span>
                            </label>
                        );
                    })}
                </fieldset>
            ))}
        </div>
    );
}

function RoleEditor({ role, onClose }: { role: CustomRole | null; onClose: () => void }): JSX.Element {
    const create = useCreateCustomRole();
    const update = useUpdateCustomRole();
    const toast = useToast();
    const [name, setName] = useState(role?.name ?? '');
    const [description, setDescription] = useState(role?.description ?? '');
    const [color, setColor] = useState<string | null>(role?.color ?? ROLE_COLORS[0]!);
    const [base, setBase] = useState<CustomRoleBase>(role?.base_role ?? 'agent');
    const [caps, setCaps] = useState<Capability[]>(
        role?.capabilities ?? CAPABILITIES_BY_ROLE.agent.filter((c) => TOGGLEABLE_CAPABILITIES.includes(c)),
    );
    const [error, setError] = useState<string | null>(null);
    const busy = create.isPending || update.isPending;

    // Al elegir otro rol base (sólo al crear), se parte de sus capacidades.
    const pickBase = (b: CustomRoleBase): void => {
        setBase(b);
        setCaps(CAPABILITIES_BY_ROLE[b].filter((c) => TOGGLEABLE_CAPABILITIES.includes(c)));
    };

    const save = async (): Promise<void> => {
        setError(null);
        try {
            if (role) {
                await update.mutateAsync({ id: role.id, name: name.trim(), description: description.trim() || null, color, capabilities: caps });
                toast.success(__('Rol guardado.'));
            } else {
                await create.mutateAsync({ name: name.trim(), description: description.trim() || null, color, base_role: base, capabilities: caps });
                toast.success(sprintf(__('Se creó «%s».'), name.trim()));
            }
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : __('No se pudo guardar el rol.'));
        }
    };

    return (
        <Sheet open onOpenChange={(o) => !o && onClose()}>
            <SheetContent data-testid="imcrm-role-editor">
                <SheetHeader>
                    <div className="imcrm-min-w-0">
                        <SheetTitle>{role ? __('Editar rol') : __('Nuevo rol')}</SheetTitle>
                        <SheetDescription>
                            {__('El rol base decide qué registros ve por defecto en cada lista; lo que marques aquí, qué puede hacer.')}
                        </SheetDescription>
                    </div>
                </SheetHeader>
                <SheetBody className="imcrm-space-y-4">
                    <div className="imcrm-space-y-1.5">
                        <Label htmlFor="role-name">{__('Nombre')}</Label>
                        <Input id="role-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={__('Por ejemplo, Supervisor')} />
                    </div>
                    <div className="imcrm-space-y-1.5">
                        <Label htmlFor="role-description">{__('Descripción (opcional)')}</Label>
                        <Textarea id="role-description" rows={2} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
                    </div>
                    <div className="imcrm-space-y-1.5">
                        <Label>{__('Color')}</Label>
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                            {ROLE_COLORS.map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    onClick={() => setColor(c)}
                                    aria-label={c}
                                    aria-pressed={color === c}
                                    className={cn(
                                        'imcrm-h-6 imcrm-w-6 imcrm-rounded-full imcrm-ring-offset-2 imcrm-ring-offset-background',
                                        color === c && 'imcrm-ring-2 imcrm-ring-foreground',
                                    )}
                                    style={{ background: c }}
                                />
                            ))}
                        </div>
                    </div>
                    <div className="imcrm-space-y-1.5">
                        <Label htmlFor="role-base">{__('Basado en')}</Label>
                        {role ? (
                            <p className="imcrm-text-sm" id="role-base">
                                {ROLE_LABELS[role.base_role]}{' '}
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('(para cambiar la base, crea otro rol)')}
                                </span>
                            </p>
                        ) : (
                            <select
                                id="role-base"
                                data-testid="imcrm-role-base-select"
                                value={base}
                                onChange={(e) => pickBase(e.target.value as CustomRoleBase)}
                                className="imcrm-h-9 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                            >
                                {CUSTOM_ROLE_BASES.map((b) => (
                                    <option key={b} value={b}>
                                        {ROLE_LABELS[b]} — {__(BASE_HINTS[b] ?? '')}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>
                    <div className="imcrm-space-y-1.5">
                        <Label>{__('Qué puede hacer')}</Label>
                        <CapabilityList
                            capabilities={caps}
                            onToggle={(cap, on) => setCaps((prev) => (on ? [...new Set([...prev, cap])] : prev.filter((c) => c !== cap)))}
                        />
                    </div>
                    {error && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
                </SheetBody>
                <SheetFooter>
                    <Button variant="ghost" onClick={onClose}>
                        {__('Cancelar')}
                    </Button>
                    <Button onClick={() => void save()} disabled={busy || name.trim() === ''} data-testid="imcrm-role-save">
                        {role ? __('Guardar') : __('Crear rol')}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}
