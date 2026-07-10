import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StaffRole, WorkspaceMember } from '@imagina-base/shared';
import { CloudApiError } from '@/lib/cloud/client';
import { api, useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const STAFF_ROLES: StaffRole[] = ['admin', 'manager', 'agent', 'viewer'];
const ROLE_LABELS: Record<StaffRole, string> = {
    admin: 'Admin',
    manager: 'Manager',
    agent: 'Agente',
    viewer: 'Lector',
};

/**
 * Panel admin de miembros del workspace. Sólo se monta para el rol `admin`
 * (el backend igualmente lo exige, regla de oro: el front sólo oculta). Alta
 * por email (usuario ya registrado), cambio de rol y baja, con guard rails
 * server-side (último admin, auto-baja).
 */
export function MembersPanel(): JSX.Element {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const meId = useSession((s) => s.user?.id ?? null);
    const invalidate = () => qc.invalidateQueries({ queryKey: ['members', tenantId] });

    const membersQ = useQuery({
        queryKey: ['members', tenantId],
        queryFn: () => api.listMembers(),
    });

    const [email, setEmail] = useState('');
    const [role, setRole] = useState<StaffRole>('agent');
    const [error, setError] = useState<string | null>(null);

    const add = useMutation({
        mutationFn: () => api.addMember({ email: email.trim(), role }),
        onSuccess: () => {
            setEmail('');
            setError(null);
            void invalidate();
        },
        onError: (e) => setError(e instanceof CloudApiError ? e.message : 'No se pudo agregar'),
    });

    return (
        <Card>
            <CardHeader>
                <CardTitle>Miembros del workspace</CardTitle>
                <CardDescription>Agregá compañeros ya registrados y asigná su rol.</CardDescription>
            </CardHeader>
            <CardContent className="imcrm-space-y-4 imcrm-pt-0">
            <ul className="imcrm-space-y-1">
                {membersQ.data?.map((m) => (
                    <MemberRow
                        key={m.user_id}
                        member={m}
                        isSelf={m.user_id === meId}
                        onChanged={invalidate}
                    />
                ))}
                {membersQ.data?.length === 0 && (
                    <li className="imcrm-text-sm imcrm-text-muted-foreground">Sin miembros.</li>
                )}
            </ul>

            <form
                className="imcrm-flex imcrm-items-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-4"
                onSubmit={(e) => {
                    e.preventDefault();
                    if (email.trim()) add.mutate();
                }}
            >
                <div className="imcrm-flex-1 imcrm-space-y-1">
                    <label htmlFor="member-email" className="imcrm-text-xs imcrm-text-muted-foreground">
                        Email
                    </label>
                    <Input
                        id="member-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="colega@empresa.com"
                    />
                </div>
                <select
                    aria-label="Rol"
                    value={role}
                    onChange={(e) => setRole(e.target.value as StaffRole)}
                    className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                >
                    {STAFF_ROLES.map((r) => (
                        <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                        </option>
                    ))}
                </select>
                <Button type="submit" size="sm" disabled={!email.trim() || add.isPending}>
                    Agregar
                </Button>
            </form>
            {error && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
            </CardContent>
        </Card>
    );
}

function MemberRow({
    member,
    isSelf,
    onChanged,
}: {
    member: WorkspaceMember;
    isSelf: boolean;
    onChanged: () => void;
}): JSX.Element {
    const [error, setError] = useState<string | null>(null);

    const changeRole = useMutation({
        mutationFn: (role: StaffRole) => api.updateMemberRole(member.user_id, { role }),
        onSuccess: () => {
            setError(null);
            onChanged();
        },
        onError: (e) => setError(e instanceof CloudApiError ? e.message : 'Error'),
    });
    const remove = useMutation({
        mutationFn: () => api.removeMember(member.user_id),
        onSuccess: () => {
            setError(null);
            onChanged();
        },
        onError: (e) => setError(e instanceof CloudApiError ? e.message : 'Error'),
    });

    // `client` no se administra desde acá (se gestiona vía portal); si aparece
    // lo mostramos read-only por robustez.
    const editable = member.role !== 'client';

    return (
        <li className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 hover:imcrm-bg-muted/40">
            <div className="imcrm-min-w-0">
                <div className="imcrm-truncate imcrm-text-sm imcrm-font-medium">
                    {member.name}
                    {isSelf && <span className="imcrm-ml-1 imcrm-text-xs imcrm-text-muted-foreground">(vos)</span>}
                </div>
                <div className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{member.email}</div>
                {error && <div className="imcrm-text-xs imcrm-text-destructive">{error}</div>}
            </div>
            <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-2">
                {editable ? (
                    <select
                        aria-label={`Rol de ${member.name}`}
                        value={member.role}
                        onChange={(e) => changeRole.mutate(e.target.value as StaffRole)}
                        disabled={changeRole.isPending}
                        className="imcrm-h-8 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                    >
                        {STAFF_ROLES.map((r) => (
                            <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                            </option>
                        ))}
                    </select>
                ) : (
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">portal</span>
                )}
                {!isSelf && (
                    <button
                        onClick={() => remove.mutate()}
                        disabled={remove.isPending}
                        aria-label={`Quitar a ${member.name}`}
                        className="imcrm-px-1 imcrm-text-muted-foreground hover:imcrm-text-destructive"
                    >
                        ✕
                    </button>
                )}
            </div>
        </li>
    );
}
